import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadMigrations, migrate } from "../src/db/migrate.js";
import { useTestDb } from "./helpers.js";

const db = useTestDb();

describe("migrator", () => {
  it("records applied migrations and is idempotent, also under concurrent starts", async () => {
    const rows = await db.sql<{ version: string }[]>`SELECT version FROM schema_migrations ORDER BY version`;
    expect(rows.map((r) => r.version)).toEqual((await loadMigrations()).map((m) => m.version));
    const results = await Promise.all([migrate(db.sql), migrate(db.sql), migrate(db.sql)]);
    expect(results).toEqual([[], [], []]);
  });

  it("applies new files in order and refuses edited ones", async () => {
    const dir = mkdtempSync(join(tmpdir(), "af-mig-"));
    try {
      const existing = await loadMigrations();
      for (const m of existing) writeFileSync(join(dir, `${m.version}.sql`), m.sql);
      writeFileSync(join(dir, "999_test_extra.sql"), "CREATE TABLE migrate_probe (id int);");
      writeFileSync(join(dir, "README.md"), "ignored");
      expect(await migrate(db.sql, undefined, dir)).toEqual(["999_test_extra"]);
      expect(await migrate(db.sql, undefined, dir)).toEqual([]);
      writeFileSync(join(dir, "999_test_extra.sql"), "CREATE TABLE migrate_probe (id bigint);");
      await expect(migrate(db.sql, undefined, dir)).rejects.toThrow(/modified/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rolls back a failing migration completely", async () => {
    const dir = mkdtempSync(join(tmpdir(), "af-mig-"));
    try {
      for (const m of await loadMigrations()) writeFileSync(join(dir, `${m.version}.sql`), m.sql);
      writeFileSync(join(dir, "998_half.sql"), "CREATE TABLE half_applied (id int); SELECT * FROM does_not_exist;");
      await expect(migrate(db.sql, undefined, dir)).rejects.toThrow();
      const [r] = await db.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_tables WHERE tablename = 'half_applied'`;
      expect(r!.n).toBe(0);
      expect((await db.sql`SELECT 1 FROM schema_migrations WHERE version = '998_half'`).length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
