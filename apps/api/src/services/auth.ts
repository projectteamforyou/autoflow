/**
 * Accounts and sessions: signup, login, opaque bearer sessions with sliding expiry, logout,
 * email verification and password reset.
 */
import { ApiError, errors } from "../errors.js";
import type { AppDeps, AuthContext } from "../deps.js";
import { dummyPasswordHash, hashPassword, needsRehash, newOpaqueToken, sha256, verifyPassword } from "../lib/crypto.js";
import * as users from "../db/users.js";
import type { User } from "../db/users.js";
import { passwordChangedMessage, passwordResetMessage, verifyEmailMessage } from "../mail/templates.js";

export function normalizeEmail(email: string): string {
  return email.normalize("NFKC").trim().toLowerCase();
}

export interface PublicUser {
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  locale: string;
  role: users.Role;
  usageType: users.UsageType;
  /** Operator of this deployment (billing settings, orders, entitlements). */
  isAdmin: boolean;
  createdAt: string;
}

/**
 * Operators are the accounts whose email is listed in ADMIN_EMAILS — and only once that email is
 * verified, so registering the address without controlling the inbox grants nothing.
 */
export function isOperator(u: User, adminEmails: readonly string[]): boolean {
  return u.emailVerifiedAt !== null && adminEmails.includes(u.emailNormalized);
}

export function toPublicUser(u: User, adminEmails: readonly string[] = []): PublicUser {
  return {
    id: u.id,
    email: u.email,
    emailVerified: u.emailVerifiedAt !== null,
    displayName: u.displayName,
    locale: u.locale,
    role: u.role,
    usageType: u.usageType,
    isAdmin: isOperator(u, adminEmails),
    createdAt: u.createdAt.toISOString(),
  };
}

export interface IssuedSession {
  token: string;
  sessionId: string;
  expiresAt: Date;
}

async function issueSession(deps: AppDeps, userId: string, userAgent: string | null): Promise<IssuedSession> {
  const token = newOpaqueToken("afs");
  const expiresAt = new Date(deps.now().getTime() + deps.config.limits.session.ttlMs);
  const s = await users.insertSession(deps.sql, { userId, tokenHash: sha256(token), userAgent: userAgent?.slice(0, 200) ?? null, expiresAt });
  return { token, sessionId: s.id, expiresAt };
}

async function sendVerification(deps: AppDeps, user: User): Promise<void> {
  const token = newOpaqueToken("afv");
  await users.insertEmailToken(deps.sql, {
    userId: user.id,
    purpose: "verify_email",
    tokenHash: sha256(token),
    expiresAt: new Date(deps.now().getTime() + deps.config.limits.tokens.verifyTtlMs),
  });
  const link = `${deps.config.publicAppUrl}/verify-email#token=${encodeURIComponent(token)}`;
  await deps.mailer.send(verifyEmailMessage(user.email, link));
}

export async function signup(
  deps: AppDeps,
  input: { email: string; password: string; displayName?: string | null; locale?: string },
  userAgent: string | null,
): Promise<{ user: User; session: IssuedSession }> {
  const emailNormalized = normalizeEmail(input.email);
  assertPasswordPolicy(input.password, emailNormalized);
  const passwordHash = await hashPassword(input.password);
  const user = await users.insertUser(deps.sql, {
    email: input.email.trim(),
    emailNormalized,
    passwordHash,
    locale: input.locale ?? "en",
    displayName: input.displayName ?? null,
  });
  if (!user) throw new ApiError(409, "email_taken", "An account with this email already exists");
  const session = await issueSession(deps, user.id, userAgent);
  await sendVerification(deps, user);
  deps.logger.info("auth.signup", { userId: user.id });
  return { user, session };
}

export async function login(deps: AppDeps, input: { email: string; password: string }, userAgent: string | null): Promise<{ user: User; session: IssuedSession }> {
  const user = await users.findUserByEmail(deps.sql, normalizeEmail(input.email));
  if (!user) {
    // Spend the same time as a real check so response timing does not reveal registered emails.
    await verifyPassword(input.password, await dummyPasswordHash());
    throw new ApiError(401, "invalid_credentials", "Email or password is incorrect");
  }
  if (!(await verifyPassword(input.password, user.passwordHash))) {
    deps.logger.info("auth.login_failed", { userId: user.id });
    throw new ApiError(401, "invalid_credentials", "Email or password is incorrect");
  }
  if (needsRehash(user.passwordHash)) await users.updatePasswordHash(deps.sql, user.id, await hashPassword(input.password), false);
  const session = await issueSession(deps, user.id, userAgent);
  deps.logger.info("auth.login", { userId: user.id });
  return { user, session };
}

/** Resolve a bearer token to its user and slide the expiry window (throttled to limit writes). */
export async function authenticate(deps: AppDeps, token: string): Promise<AuthContext | null> {
  if (!/^afs_[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const now = deps.now();
  const found = await users.findActiveSession(deps.sql, sha256(token), now);
  if (!found) return null;
  const { ttlMs, touchIntervalMs } = deps.config.limits.session;
  if (now.getTime() - found.session.lastUsedAt.getTime() >= touchIntervalMs) {
    const expiresAt = new Date(now.getTime() + ttlMs);
    await users.touchSession(deps.sql, found.session.id, now, expiresAt);
    found.session.lastUsedAt = now;
    found.session.expiresAt = expiresAt;
  }
  return found;
}

export async function logout(deps: AppDeps, auth: AuthContext): Promise<void> {
  await users.revokeSession(deps.sql, auth.session.id);
}

export async function logoutAll(deps: AppDeps, auth: AuthContext): Promise<number> {
  return users.revokeUserSessions(deps.sql, auth.user.id);
}

export async function resendVerification(deps: AppDeps, auth: AuthContext): Promise<void> {
  if (auth.user.emailVerifiedAt) return;
  await sendVerification(deps, auth.user);
}

export async function verifyEmail(deps: AppDeps, token: string): Promise<void> {
  const userId = await users.consumeEmailToken(deps.sql, "verify_email", sha256(token), deps.now());
  if (!userId) throw new ApiError(400, "invalid_token", "This verification link is invalid or has expired");
  await users.markEmailVerified(deps.sql, userId);
}

/** Always succeeds from the caller's point of view, so it cannot be used to probe for accounts. */
export async function requestPasswordReset(deps: AppDeps, email: string): Promise<void> {
  const user = await users.findUserByEmail(deps.sql, normalizeEmail(email));
  if (!user) return;
  const token = newOpaqueToken("afr");
  const ttl = deps.config.limits.tokens.resetTtlMs;
  await users.insertEmailToken(deps.sql, { userId: user.id, purpose: "password_reset", tokenHash: sha256(token), expiresAt: new Date(deps.now().getTime() + ttl) });
  const link = `${deps.config.publicAppUrl}/reset-password#token=${encodeURIComponent(token)}`;
  await deps.mailer.send(passwordResetMessage(user.email, link, Math.round(ttl / 60_000)));
}

export async function resetPassword(deps: AppDeps, token: string, newPassword: string): Promise<void> {
  const tokenHash = sha256(token);
  const user = await deps.sql.begin(async (tx) => {
    const id = await users.consumeEmailToken(tx, "password_reset", tokenHash, deps.now());
    if (!id) throw new ApiError(400, "invalid_token", "This reset link is invalid or has expired");
    const found = await users.findUserById(tx, id);
    if (!found) throw new ApiError(400, "invalid_token", "This reset link is invalid or has expired");
    assertPasswordPolicy(newPassword, found.emailNormalized);
    await users.updatePasswordHash(tx, id, await hashPassword(newPassword), true);
    // Proving control of the inbox also verifies the address.
    await users.markEmailVerified(tx, id);
    await users.revokeUserSessions(tx, id);
    return found;
  });
  await deps.mailer.send(passwordChangedMessage(user.email));
  deps.logger.info("auth.password_reset", { userId: user.id });
}

export async function changePassword(deps: AppDeps, auth: AuthContext, currentPassword: string, newPassword: string): Promise<void> {
  if (!(await verifyPassword(currentPassword, auth.user.passwordHash))) throw new ApiError(401, "invalid_credentials", "Current password is incorrect");
  assertPasswordPolicy(newPassword, auth.user.emailNormalized);
  await deps.sql.begin(async (tx) => {
    await users.updatePasswordHash(tx, auth.user.id, await hashPassword(newPassword), true);
    await users.revokeUserSessions(tx, auth.user.id, auth.session.id);
  });
  await deps.mailer.send(passwordChangedMessage(auth.user.email));
}

export async function confirmPassword(auth: AuthContext, password: string): Promise<void> {
  if (!(await verifyPassword(password, auth.user.passwordHash))) throw new ApiError(401, "invalid_credentials", "Password is incorrect");
}

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 256;

export function assertPasswordPolicy(password: string, emailNormalized: string): void {
  const len = [...password].length;
  if (len < PASSWORD_MIN || len > PASSWORD_MAX) throw errors.validation([{ path: "password", message: `Password must be ${PASSWORD_MIN}–${PASSWORD_MAX} characters` }]);
  const lower = password.toLowerCase();
  if (lower === emailNormalized || lower === emailNormalized.split("@")[0]) throw errors.validation([{ path: "password", message: "Password must not be your email" }]);
  if (/^(.)\1+$/.test(password)) throw errors.validation([{ path: "password", message: "Password is too simple" }]);
}
