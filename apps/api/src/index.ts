/** Process entry point: config → DB → migrations → HTTP server, with graceful shutdown. */
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { migrate } from "./db/migrate.js";
import { purgeExpiredShares } from "./db/shares.js";
import { purgeDeadSessions } from "./db/users.js";
import { createMemoryLimiters } from "./lib/rate-limit.js";
import { purgeStalePresence } from "./db/stats.js";
import { createLogger } from "./logger.js";
import { expirePendingOrders, reconcilePendingOrders } from "./services/billing.js";
import { ConsoleMailer, DisabledMailer, ResendMailer, fireAndForget, type Mailer } from "./mail/mailer.js";

const config = loadConfig();
const logger = createLogger(config.logLevel, { service: "autoflow-api", version: config.version });

process.on("unhandledRejection", (reason) => logger.error("process.unhandled_rejection", { error: reason instanceof Error ? { name: reason.name, message: reason.message } : String(reason) }));

if (config.env === "production" && !config.settingsEncryptionKey)
  logger.warn("billing.disabled", { hint: "set SETTINGS_ENCRYPTION_KEY so operators can store payment keys in the Admin page" });

const sql = createDb(config.databaseUrl);
const applied = await migrate(sql, logger);
logger.info("db.ready", { appliedMigrations: applied });

let mailer: Mailer;
if (config.resendApiKey) mailer = new ResendMailer(config.resendApiKey, config.mailFrom, logger);
else if (config.env === "production") {
  // Never print token-bearing emails into production logs.
  logger.warn("mail.disabled", { hint: "set RESEND_API_KEY to deliver verification and reset emails" });
  mailer = new DisabledMailer(logger);
} else mailer = new ConsoleMailer(logger);

const deps = {
  config,
  sql,
  logger,
  mailer: fireAndForget(mailer, logger),
  limiters: createMemoryLimiters(config.limits.rate),
  fetch: globalThis.fetch,
  now: () => new Date(),
};
const app = createApp(deps);

const server = serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
  logger.info("http.listening", { port: info.port, env: config.env, origins: config.appOrigins });
});

const housekeeping = setInterval(async () => {
  try {
    const now = new Date();
    const sessions = await purgeDeadSessions(sql, now);
    const shares = await purgeExpiredShares(sql, now);
    await purgeStalePresence(sql);
    if (sessions || shares) logger.info("housekeeping.purged", { sessions, shares });
  } catch (err) {
    logger.warn("housekeeping.failed", { error: (err as Error).message });
  }
  // Orders paid but never confirmed by the browser are settled here; stale ones are closed.
  try {
    const reconciled = await reconcilePendingOrders(deps);
    const expired = await expirePendingOrders(deps);
    if (reconciled.checked || expired) logger.info("housekeeping.orders", { ...reconciled, expired });
  } catch (err) {
    logger.warn("housekeeping.orders_failed", { error: (err as Error).message });
  }
}, 60 * 60_000);
housekeeping.unref();

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("process.shutdown", { signal });
  clearInterval(housekeeping);
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  server.close(async () => {
    await sql.end({ timeout: 5 });
    process.exit(0);
  });
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
