/** Request helpers: typed JSON/query validation, client IP resolution and rate-limit enforcement. */
import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { z, type ZodTypeAny } from "zod";
import { ApiError, errors } from "../errors.js";
import type { AppEnv, AuthContext } from "../deps.js";
import type { RateLimiter } from "./rate-limit.js";
import { isModerator, isOperator } from "../services/auth.js";

export function zodDetails(err: z.ZodError) {
  return err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

/** NUL or an unpaired surrogate (with the `u` flag a well-formed pair is one code point, not two `Cs`). */
const UNSTORABLE_TEXT = /[\0\p{Cs}]/u;
const UNSTORABLE_MESSAGE = "Text must not contain NUL characters or unpaired surrogates";

/**
 * PostgreSQL cannot store U+0000 or unpaired surrogates in text/jsonb and fails the statement,
 * which would surface as a 500. Reject them up front: one pass over every string (object keys
 * included, any depth) of a parsed body or query. Iterative, so deep nesting cannot overflow the stack.
 */
export function assertStorableText(input: unknown): void {
  const values: unknown[] = [input];
  const paths: string[] = [""];
  while (values.length) {
    const v = values.pop();
    const path = paths.pop()!;
    if (typeof v === "string") {
      if (UNSTORABLE_TEXT.test(v)) throw errors.validation([{ path, message: UNSTORABLE_MESSAGE }]);
    } else if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) {
        const item = v[i];
        if (typeof item === "string" ? UNSTORABLE_TEXT.test(item) : item !== null && typeof item === "object") {
          values.push(item);
          paths.push(path ? `${path}.${i}` : String(i));
        }
      }
    } else if (v !== null && typeof v === "object") {
      for (const k of Object.keys(v)) {
        // The offending key itself is not echoed back; the path names the object that holds it.
        if (UNSTORABLE_TEXT.test(k)) throw errors.validation([{ path, message: UNSTORABLE_MESSAGE }]);
        const item = (v as Record<string, unknown>)[k];
        if (typeof item === "string" ? UNSTORABLE_TEXT.test(item) : item !== null && typeof item === "object") {
          values.push(item);
          paths.push(path ? `${path}.${k}` : k);
        }
      }
    }
  }
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
  assertStorableText(data);
  const r = schema.safeParse(data);
  if (!r.success) throw errors.validation(zodDetails(r.error));
  return r.data;
}

export function parseQuery<S extends ZodTypeAny>(c: Context<AppEnv>, schema: S): z.output<S> {
  const query = c.req.query();
  assertStorableText(query);
  const r = schema.safeParse(query);
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

/** Atlas moderators (role=admin) and deployment operators. */
export function requireAdmin(c: Context<AppEnv>): AuthContext {
  const auth = requireAuth(c);
  if (!isModerator(auth.user, c.get("deps").config.adminEmails)) throw errors.forbidden("Administrator role required");
  return auth;
}

/** Deployment operators only (ADMIN_EMAILS, verified): payment keys, orders, entitlements. */
export function requireOperator(c: Context<AppEnv>): AuthContext {
  const auth = requireAuth(c);
  if (!isOperator(auth.user, c.get("deps").config.adminEmails)) throw errors.forbidden("Operator access required");
  return auth;
}

export const uuidParam = z.string().uuid();
export const base62Param = z.string().regex(/^[0-9A-Za-z]{10}$/);
