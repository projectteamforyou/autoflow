/**
 * Resolves `Authorization: Bearer <token>` into `c.var.auth`. Bearer-only (no cookies), so the
 * API has no ambient credentials and therefore no CSRF surface.
 * An invalid or expired token leaves the request anonymous; routes that need a user reject it
 * with 401 via `requireAuth`, while public routes (login, Atlas browsing) keep working.
 */
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../deps.js";
import { authenticate } from "../services/auth.js";

export function sessionAuth(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set("auth", undefined);
    const header = c.req.header("authorization");
    const m = header ? /^Bearer\s+(\S{1,200})$/i.exec(header) : null;
    if (m) {
      const auth = await authenticate(c.get("deps"), m[1]!);
      if (auth) c.set("auth", auth);
    }
    await next();
  };
}
