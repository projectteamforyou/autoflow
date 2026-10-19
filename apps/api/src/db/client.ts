/**
 * PostgreSQL client (porsager/postgres). All queries use tagged templates, which are always
 * sent as parameterized statements — there is no string-built SQL in this codebase.
 */
import postgres from "postgres";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;
/** Either the pool or a transaction — repository functions accept both. */
export type Db = Sql | Tx;

export interface DbOptions {
  max?: number;
  /** Seconds a connection may stay idle before it is closed. */
  idleTimeout?: number;
}

export function createDb(url: string, opts: DbOptions = {}): Sql {
  return postgres(url, {
    max: opts.max ?? 10,
    idle_timeout: opts.idleTimeout ?? 30,
    connect_timeout: 10,
    // Suppress NOTICE output (e.g. "relation already exists, skipping").
    onnotice: () => {},
    connection: { application_name: "autoflow-api" },
  });
}

export async function pingDb(sql: Sql): Promise<boolean> {
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
