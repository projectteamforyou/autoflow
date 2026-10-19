/**
 * Test database bootstrap.
 *
 * - If TEST_DATABASE_URL is set (CI: postgres service container), it is used as the admin connection.
 * - Otherwise a throw-away PostgreSQL cluster is created with initdb in a temp dir on a free port.
 *   initdb/postgres refuse to run as root, so when we are root the cluster is owned by and run as
 *   `nobody` via runuser (falling back to su).
 *
 * A migrated template database is prepared once; each test file clones it (CREATE DATABASE …
 * TEMPLATE …) so files run in parallel against isolated databases.
 */
import { spawnSync } from "node:child_process";
import { chownSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GlobalSetupContext } from "vitest/node";
import postgres from "postgres";
import { migrate } from "../src/db/migrate.js";

declare module "vitest" {
  export interface ProvidedContext {
    adminDatabaseUrl: string;
    templateDatabase: string;
  }
}

const TEMPLATE_DB = "autoflow_test_template";
const NOBODY_UID = 65534;
const NOBODY_GID = 65534;

function findPgBin(): string | null {
  const candidates = [process.env.PG_BIN, "/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/17/bin", "/usr/local/pgsql/bin", "/opt/homebrew/opt/postgresql@16/bin"].filter(Boolean) as string[];
  for (const dir of candidates) if (existsSync(join(dir, "initdb"))) return dir;
  const which = spawnSync("sh", ["-c", "command -v initdb"], { encoding: "utf8" });
  const p = which.stdout.trim();
  return p ? p.replace(/\/initdb$/, "") : null;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

function runPg(bin: string, args: string[]): void {
  let cmd = bin;
  let argv = args;
  if (isRoot) {
    if (existsSync("/usr/sbin/runuser") || existsSync("/sbin/runuser")) {
      cmd = "runuser";
      argv = ["-u", "nobody", "--", bin, ...args];
    } else {
      cmd = "su";
      argv = ["-s", "/bin/sh", "nobody", "-c", [bin, ...args].map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(" ")];
    }
  }
  const r = spawnSync(cmd, argv, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${bin} ${args.join(" ")} failed (${r.status}):\n${r.stdout}\n${r.stderr}`);
}

export default async function setup({ provide }: GlobalSetupContext) {
  let adminUrl = process.env.TEST_DATABASE_URL;
  let teardownCluster: (() => void) | undefined;

  if (!adminUrl) {
    const bin = findPgBin();
    if (!bin) throw new Error("No PostgreSQL binaries found (set PG_BIN) and TEST_DATABASE_URL is not set");
    const root = mkdtempSync(join(tmpdir(), "autoflow-pg-"));
    const data = join(root, "data");
    if (isRoot) chownSync(root, NOBODY_UID, NOBODY_GID);
    const port = await freePort();
    runPg(join(bin, "initdb"), ["-D", data, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--no-locale", "--no-sync"]);
    runPg(join(bin, "pg_ctl"), [
      "-D",
      data,
      "-l",
      join(root, "postgres.log"),
      "-w",
      "-t",
      "60",
      "-o",
      `-p ${port} -k ${root} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_connections=300`,
      "start",
    ]);
    adminUrl = `postgres://postgres@127.0.0.1:${port}/postgres`;
    teardownCluster = () => {
      try {
        runPg(join(bin, "pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    };
  }

  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEMPLATE_DB} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${TEMPLATE_DB}`);
  } finally {
    await admin.end();
  }
  const tplUrl = new URL(adminUrl);
  tplUrl.pathname = `/${TEMPLATE_DB}`;
  const tpl = postgres(tplUrl.toString(), { max: 1, onnotice: () => {} });
  try {
    await migrate(tpl);
  } finally {
    await tpl.end();
  }

  provide("adminDatabaseUrl", adminUrl);
  provide("templateDatabase", TEMPLATE_DB);

  return async () => {
    if (teardownCluster) {
      teardownCluster();
      return;
    }
    const a = postgres(adminUrl!, { max: 1, onnotice: () => {} });
    try {
      await a.unsafe(`DROP DATABASE IF EXISTS ${TEMPLATE_DB} WITH (FORCE)`);
    } finally {
      await a.end();
    }
  };
}
