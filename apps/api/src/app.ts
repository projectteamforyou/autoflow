/**
 * HTTP application. Middleware order matters:
 * request id → context (deps, client IP) → access log → secure headers → CORS → no-store default
 * → global rate limit → body size limit → session auth → routes.
 */
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppDeps, AppEnv } from "./deps.js";
import { ApiError, type ErrorBody } from "./errors.js";
import { enforce, resolveClientIp } from "./lib/http.js";
import { sessionAuth } from "./middleware/auth.js";
import { statsRoutes } from "./routes/stats.js";
import { aiRoutes } from "./routes/ai.js";
import { adminAtlasRoutes, atlasRoutes } from "./routes/atlas.js";
import { authRoutes } from "./routes/auth.js";
import { deviceRoutes } from "./routes/devices.js";
import { healthRoutes, metaRoutes } from "./routes/meta.js";
import { meRoutes } from "./routes/me.js";
import { shareRoutes } from "./routes/shares.js";
import { syncRoutes } from "./routes/sync.js";

export const CORS_ALLOW_HEADERS = ["Authorization", "Content-Type", "If-Match", "X-Provider-Key", "X-Request-Id"];
export const CORS_EXPOSE_HEADERS = ["ETag", "Retry-After", "X-Request-Id"];

const DEFAULT_BODY_LIMIT = 64 * 1024;

function errorJson(code: ErrorBody["error"]["code"], message: string): ErrorBody {
  return { error: { code, message } };
}

/** Pick a body limit by route: large for encrypted sync items, moderate for flows, small elsewhere. */
function bodyLimits(deps: AppDeps): MiddlewareHandler<AppEnv> {
  const l = deps.config.limits;
  const onError: Parameters<typeof bodyLimit>[0]["onError"] = (c) => c.json(errorJson("payload_too_large", "Request body is too large"), 413);
  const sync = bodyLimit({ maxSize: Math.ceil(l.sync.maxItemBytes / 3) * 4 + 16 * 1024, onError });
  const flows = bodyLimit({ maxSize: Math.max(l.atlas.maxFlowBytes, l.shares.maxFlowBytes) + 16 * 1024, onError });
  const relay = bodyLimit({ maxSize: l.relay.maxBodyBytes, onError });
  const fallback = bodyLimit({ maxSize: DEFAULT_BODY_LIMIT, onError });
  return async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") return next();
    const p = c.req.path;
    if (p.startsWith("/v1/sync/items/")) return sync(c, next);
    if (p === "/v1/atlas/templates" || p === "/v1/shares") return flows(c, next);
    if (p === "/v1/ai/relay") return relay(c, next);
    return fallback(c, next);
  };
}

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { config, logger } = deps;
  const isProd = config.env === "production";
  const origins = new Set(config.appOrigins);

  app.use(requestId({ limitLength: 64, generator: () => crypto.randomUUID() }));

  app.use(async (c, next) => {
    c.set("deps", deps);
    c.set("clientIp", resolveClientIp(c, config.trustProxyHops));
    await next();
  });

  // Access log: method, path (never the query string — it may carry cursors or search text), status, latency.
  app.use(async (c, next) => {
    const started = performance.now();
    await next();
    logger.info("http.request", {
      requestId: c.get("requestId"),
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - started),
      userId: c.get("auth")?.user.id,
    });
  });

  app.use(
    secureHeaders({
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] },
      strictTransportSecurity: "max-age=63072000; includeSubDomains",
      referrerPolicy: "no-referrer",
      crossOriginResourcePolicy: "cross-origin",
      xFrameOptions: "DENY",
      permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
    }),
  );

  app.use(
    cors({
      origin: (origin) => (origins.has(origin) ? origin : null),
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: CORS_ALLOW_HEADERS,
      exposeHeaders: CORS_EXPOSE_HEADERS,
      maxAge: 600,
      credentials: false,
    }),
  );

  // API responses are per-user by default; routes that are safe to cache override this.
  app.use(async (c, next) => {
    await next();
    if (!c.res.headers.has("Cache-Control")) c.res.headers.set("Cache-Control", "no-store");
  });

  app.use(async (c, next) => {
    if (c.req.path === "/health" || c.req.method === "OPTIONS") return next();
    await enforce(deps.limiters.global, `ip:${c.get("clientIp")}`);
    await next();
  });

  app.use(bodyLimits(deps));
  app.use(sessionAuth());

  app.route("/", healthRoutes());
  app.route("/v1", metaRoutes());
  app.route("/v1/auth", authRoutes());
  app.route("/v1/me", meRoutes());
  app.route("/v1/sync", syncRoutes());
  app.route("/v1/devices", deviceRoutes());
  app.route("/v1/atlas", atlasRoutes());
  app.route("/v1/admin/atlas", adminAtlasRoutes());
  app.route("/v1/shares", shareRoutes());
  app.route("/v1/ai", aiRoutes());
  app.route("/v1/stats", statsRoutes());

  app.get("/", (c) => c.json({ name: "AutoFlow API", version: config.version, docs: "/v1/openapi.yaml" }));

  app.notFound((c) => c.json(errorJson("not_found", "Route not found"), 404));

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      for (const [k, v] of Object.entries(err.headers ?? {})) c.header(k, v);
      if (err.status >= 500) logger.warn("http.api_error", { requestId: c.get("requestId"), code: err.code, status: err.status });
      return c.json(err.toBody(), err.status);
    }
    if (err instanceof HTTPException) {
      const status = err.status as ContentfulStatusCode;
      return c.json(errorJson(status === 413 ? "payload_too_large" : status === 401 ? "unauthorized" : "bad_request", err.message || "Request failed"), status);
    }
    const code = (err as { code?: string }).code;
    if (code && /^(ECONNREFUSED|ECONNRESET|ETIMEDOUT|CONNECT_TIMEOUT|CONNECTION_(CLOSED|ENDED|DESTROYED)|57P01|53300)$/.test(code)) {
      logger.error("db.unavailable", { requestId: c.get("requestId"), code });
      return c.json(errorJson("service_unavailable", "Service temporarily unavailable"), 503);
    }
    logger.error("http.unhandled_error", { requestId: c.get("requestId"), error: { name: err.name, message: err.message, stack: err.stack } });
    return c.json(errorJson("internal_error", isProd ? "Internal server error" : `Internal server error: ${err.message}`), 500);
  });

  return app;
}
