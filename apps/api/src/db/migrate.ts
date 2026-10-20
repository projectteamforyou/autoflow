/**
 * Minimal SQL migrator. Applies `migrations/*.sql` in lexical order inside one transaction
 * guarded by a transaction-scoped advisory lock, so concurrent instances starting at the same
 * time never race. Applied files are checksummed; editing an applied migration is an error.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Sql } from "./client.js";
import type { Logger } from "../logger.js";

/** Arbitrary constant: "autoflow" as a 63-bit key. */
const LOCK_KEY = 0x6175746f666c6f77n;

export const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations/", import.meta.url));

export interface Migration {
  version: string;
  sql: string;
  checksum: string;
}

export async function loadMigrations(dir = MIGRATIONS_DIR): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => /^\d{3,}_[a-z0-9_]+\.sql$/.test(f)).sort();
  return Promise.all(
    files.map(async (f) => {
      const sql = await readFile(`${dir}/${f}`, "utf8");
      return { version: f.replace(/\.sql$/, ""), sql, checksum: createHash("sha256").update(sql).digest("hex") };
    }),
  );
}

export async function migrate(sql: Sql, logger?: Logger, dir = MIGRATIONS_DIR): Promise<string[]> {
  const migrations = await loadMigrations(dir);
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${LOCK_KEY.toString()}::bigint)`;
    await tx`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`;
    const rows = await tx<{ version: string; checksum: string }[]>`SELECT version, checksum FROM schema_migrations`;
    const applied = new Map(rows.map((r) => [r.version, r.checksum]));
    const done: string[] = [];
    for (const m of migrations) {
      const prev = applied.get(m.version);
      if (prev !== undefined) {
        if (prev !== m.checksum) throw new Error(`Migration ${m.version} was modified after being applied`);
        continue;
      }
      logger?.info("db.migration_apply", { migration: m.version });
      await tx.unsafe(m.sql);
      await tx`INSERT INTO schema_migrations (version, checksum) VALUES (${m.version}, ${m.checksum})`;
      done.push(m.version);
    }
    return done;
  });
}
