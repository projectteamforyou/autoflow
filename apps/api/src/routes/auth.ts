/** /v1/auth — signup, login, logout, sessions, email verification and password reset. */
import { Hono } from "hono";
import { z } from "zod";
import { LOCALE_CODES, type LocaleCode } from "@autoflow/core";
import type { AppEnv } from "../deps.js";
import { enforce, parseJson, requireAuth } from "../lib/http.js";
import * as auth from "../services/auth.js";
import { listSessions } from "../db/users.js";

export const LocaleSchema = z.enum(LOCALE_CODES as [LocaleCode, ...LocaleCode[]]);
const Email = z.string().trim().max(254).email();
// Upper bound only here; the real policy (length, not-your-email…) lives in services/auth.
const Password = z.string().min(1).max(1024);
const Token = z.string().min(10).max(200);

const SignupBody = z.object({
  email: Email,
  password: Password,
  displayName: z.string().trim().min(1).max(60).nullish(),
  locale: LocaleSchema.optional(),
});
const LoginBody = z.object({ email: z.string().trim().max(254), password: Password });
const TokenBody = z.object({ token: Token });
const ForgotBody = z.object({ email: Email });
const ResetBody = z.object({ token: Token, password: Password });
const ChangeBody = z.object({ currentPassword: Password, newPassword: Password });

function sessionDto(s: auth.IssuedSession) {
  return { token: s.token, expiresAt: s.expiresAt.toISOString() };
}

export function authRoutes() {
  const r = new Hono<AppEnv>();

  r.post("/signup", async (c) => {
    const deps = c.get("deps");
    await enforce(deps.limiters.authIp, `ip:${c.get("clientIp")}`);
    const body = await parseJson(c, SignupBody);
    const { user, session } = await auth.signup(deps, body, c.req.header("user-agent") ?? null);
    return c.json({ user: auth.toPublicUser(user, deps.config.adminEmails), session: sessionDto(session) }, 201);
  });

  r.post("/login", async (c) => {
    const deps = c.get("deps");
    await enforce(deps.limiters.authIp, `ip:${c.get("clientIp")}`);
    const body = await parseJson(c, LoginBody);
    // Per-account bucket stops distributed guessing against one account.
    await enforce(deps.limiters.authAccount, `login:${auth.normalizeEmail(body.email)}`);
    const { user, session } = await auth.login(deps, body, c.req.header("user-agent") ?? null);
    return c.json({ user: auth.toPublicUser(user, deps.config.adminEmails), session: sessionDto(session) });
  });

  r.post("/logout", async (c) => {
    await auth.logout(c.get("deps"), requireAuth(c));
    return c.body(null, 204);
  });

  r.post("/logout-all", async (c) => {
    const revoked = await auth.logoutAll(c.get("deps"), requireAuth(c));
    return c.json({ revoked });
  });

  r.get("/sessions", async (c) => {
    const a = requireAuth(c);
    const deps = c.get("deps");
    const sessions = await listSessions(deps.sql, a.user.id, deps.now());
    return c.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        deviceId: s.deviceId,
        userAgent: s.userAgent,
        createdAt: s.createdAt.toISOString(),
        lastUsedAt: s.lastUsedAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
        current: s.id === a.session.id,
      })),
    });
  });

  r.post("/verify-email", async (c) => {
    const deps = c.get("deps");
    await enforce(deps.limiters.authIp, `ip:${c.get("clientIp")}`);
    const { token } = await parseJson(c, TokenBody);
    await auth.verifyEmail(deps, token);
    return c.json({ verified: true });
  });

  r.post("/verify-email/resend", async (c) => {
    const a = requireAuth(c);
    const deps = c.get("deps");
    await enforce(deps.limiters.authAccount, `verify:${a.user.id}`);
    await auth.resendVerification(deps, a);
    return c.json({ sent: a.user.emailVerifiedAt === null }, 202);
  });

  r.post("/password/forgot", async (c) => {
    const deps = c.get("deps");
    await enforce(deps.limiters.authIp, `ip:${c.get("clientIp")}`);
    const { email } = await parseJson(c, ForgotBody);
    await enforce(deps.limiters.authAccount, `reset:${auth.normalizeEmail(email)}`);
    await auth.requestPasswordReset(deps, email);
    return c.json({ ok: true }, 202);
  });

  r.post("/password/reset", async (c) => {
    const deps = c.get("deps");
    await enforce(deps.limiters.authIp, `ip:${c.get("clientIp")}`);
    const { token, password } = await parseJson(c, ResetBody);
    await auth.resetPassword(deps, token, password);
    return c.json({ ok: true });
  });

  r.post("/password/change", async (c) => {
    const a = requireAuth(c);
    const deps = c.get("deps");
    await enforce(deps.limiters.authAccount, `change:${a.user.id}`);
    const { currentPassword, newPassword } = await parseJson(c, ChangeBody);
    await auth.changePassword(deps, a, currentPassword, newPassword);
    return c.json({ ok: true });
  });

  return r;
}
