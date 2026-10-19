/** Everything the app needs from the outside world — injected so tests can swap any part. */
import type { Config } from "./config.js";
import type { Sql } from "./db/client.js";
import type { Logger } from "./logger.js";
import type { Mailer } from "./mail/mailer.js";
import type { Limiters } from "./lib/rate-limit.js";
import type { User, Session } from "./db/users.js";

export interface AppDeps {
  config: Config;
  sql: Sql;
  logger: Logger;
  mailer: Mailer;
  limiters: Limiters;
  /** Used only by the Copilot relay. */
  fetch: typeof fetch;
  now: () => Date;
}

export interface AuthContext {
  user: User;
  session: Session;
}

export type AppEnv = {
  Variables: {
    requestId: string;
    deps: AppDeps;
    auth: AuthContext | undefined;
    clientIp: string;
  };
};
