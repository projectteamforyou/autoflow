/** `pnpm migrate` — apply pending migrations and exit. */
import { loadConfig } from "../config.js";
import { createLogger } from "../logger.js";
import { createDb } from "./client.js";
import { migrate } from "./migrate.js";

const config = loadConfig();
const logger = createLogger(config.logLevel === "silent" ? "info" : config.logLevel, { service: "autoflow-api" });
const sql = createDb(config.databaseUrl, { max: 1 });
try {
  const applied = await migrate(sql, logger);
  logger.info("db.migrations_done", { applied });
} catch (err) {
  logger.error("db.migrations_failed", { err });
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
