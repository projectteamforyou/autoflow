/** Request helpers: typed JSON/query validation, client IP resolution and rate-limit enforcement. */
import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { z, type ZodTypeAny } from "zod";
import { ApiError, errors } from "../errors.js";
import type { AppEnv, AuthContext } from "../deps.js";
import type { RateLimiter } from "./rate-limit.js";

export function zodDetails(err: z.ZodError) {
  return err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

export async function parseJson<S extends ZodTypeAny>(c: Context<AppEnv>, schema: S): Promise<z.output<S>> {
  const ct = c.req.header("content-type") ?? "";
  if (!/^application\/(.+\+)?json\b/i.test(ct)) throw new ApiError(415, "unsupported_media_type","Content-Type must be application/json");
  let data: unknown;
  try {
    data = await c.req.json();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(400, "invalid_json", "Request body is not valid JSON");
  }
  const r = schema.safeParse(data);
  if (!r.success) throw errors.validation(zodDetails(r.error));
  return r.data;
}

export function parseQuery<S extends ZodTypeAny>(c: Context<AppEnv>, schema: S): z.output<S> {
  const r = schema.safeParse(c.req.query());
  if (!r.success) throw errors.validation(zodDetails(r.error));
  return r.data;
}

export function parseParams<S extends ZodTypeAny>(c: Context<AppEnv>, schema: S): z.output<S> {
  const r = schema.safeParse(c.req.param());
  if (!r.success) throw errors.notFound();
  return r.data;
}

const IP_RE = /^[0-9a-fA-F:.]{2,45}$/;

/**
 * Client IP. With `trustProxyHops` = n, the n-th address from the right of X-Forwarded-For is the
 * one our own proxy saw (addresses further left are client-supplied and spoofable).
 */
export function resolveClientIp(c: Context<AppEnv>, trustProxyHops: number): string {
  if (trustProxyHops > 0) {
    const xff = c.req.header("x-forwarded-for");
    if (xff) {
      const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
      const candidate = parts[Math.max(0, parts.length - trustProxyHops)];
      if (candidate && IP_RE.test(candidate)) return candidate;
    }
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

export async function enforce(limiter: RateLimiter, key: string, cost = 1): Promise<void> {
  const r = await limiter.consume(key, cost);
  if (!r.allowed) throw errors.rateLimited(r.retryAfterMs);
}

export function requireAuth(c: Context<AppEnv>): AuthContext {
  const auth = c.get("auth");
  if (!auth) throw errors.unauthorized(c.req.header("authorization") ? "Session is invalid or has expired" : "Authentication required");
  return auth;
}

export function requireAdmin(c: Context<AppEnv>): AuthContext {
  const auth = requireAuth(c);
  if (auth.user.role !== "admin") throw errors.forbidden("Administrator role required");
  return auth;
}

export const uuidParam = z.string().uuid();
export const base62Param = z.string().regex(/^[0-9A-Za-z]{10}$/);
