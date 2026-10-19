/** Users, sessions and single-use email tokens. */
import type { Db } from "./client.js";

export type Role = "user" | "admin";

export interface User {
  id: string;
  email: string;
  emailNormalized: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
  displayName: string | null;
  locale: string;
  role: Role;
  createdAt: Date;
  updatedAt: Date;
  passwordChangedAt: Date;
}

interface UserRow {
  id: string;
  email: string;
  email_normalized: string;
  password_hash: string;
  email_verified_at: Date | null;
  display_name: string | null;
  locale: string;
  role: Role;
  created_at: Date;
  updated_at: Date;
  password_changed_at: Date;
}

const mapUser = (r: UserRow): User => ({
  id: r.id,
  email: r.email,
  emailNormalized: r.email_normalized,
  passwordHash: r.password_hash,
  emailVerifiedAt: r.email_verified_at,
  displayName: r.display_name,
  locale: r.locale,
  role: r.role,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  passwordChangedAt: r.password_changed_at,
});

/** Insert a user; returns null when the normalized email is already taken. */
export async function insertUser(db: Db, u: { email: string; emailNormalized: string; passwordHash: string; locale: string; displayName: string | null }): Promise<User | null> {
  const rows = await db<UserRow[]>`
    INSERT INTO users (email, email_normalized, password_hash, locale, display_name)
    VALUES (${u.email}, ${u.emailNormalized}, ${u.passwordHash}, ${u.locale}, ${u.displayName})
    ON CONFLICT (email_normalized) DO NOTHING
    RETURNING *`;
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function findUserByEmail(db: Db, emailNormalized: string): Promise<User | null> {
  const rows = await db<UserRow[]>`SELECT * FROM users WHERE email_normalized = ${emailNormalized}`;
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function findUserById(db: Db, id: string): Promise<User | null> {
  const rows = await db<UserRow[]>`SELECT * FROM users WHERE id = ${id}`;
  return rows[0] ? mapUser(rows[0]) : null;
}

/** Lock the user's row for the rest of the transaction (serializes per-user sync writes). */
export async function lockUser(db: Db, id: string): Promise<boolean> {
  const rows = await db`SELECT 1 FROM users WHERE id = ${id} FOR UPDATE`;
  return rows.length === 1;
}

export async function updatePasswordHash(db: Db, id: string, passwordHash: string, changed: boolean): Promise<void> {
  if (changed) await db`UPDATE users SET password_hash = ${passwordHash}, password_changed_at = now(), updated_at = now() WHERE id = ${id}`;
  else await db`UPDATE users SET password_hash = ${passwordHash} WHERE id = ${id}`;
}

export async function updateProfile(db: Db, id: string, p: { displayName?: string | null; locale?: string }): Promise<User | null> {
  const rows = await db<UserRow[]>`
    UPDATE users SET
      display_name = CASE WHEN ${p.displayName !== undefined} THEN ${p.displayName ?? null} ELSE display_name END,
      locale = COALESCE(${p.locale ?? null}, locale),
      updated_at = now()
    WHERE id = ${id}
    RETURNING *`;
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function markEmailVerified(db: Db, id: string): Promise<void> {
  await db`UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = ${id}`;
}

export async function deleteUser(db: Db, id: string): Promise<boolean> {
  const rows = await db`DELETE FROM users WHERE id = ${id} RETURNING id`;
  return rows.length === 1;
}

/* ----------------------------------------------------------------- sessions */

export interface Session {
  id: string;
  userId: string;
  deviceId: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
}

interface SessionRow {
  id: string;
  user_id: string;
  device_id: string | null;
  user_agent: string | null;
  created_at: Date;
  last_used_at: Date;
  expires_at: Date;
}

const mapSession = (r: SessionRow): Session => ({
  id: r.id,
  userId: r.user_id,
  deviceId: r.device_id,
  userAgent: r.user_agent,
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at,
  expiresAt: r.expires_at,
});

export async function insertSession(db: Db, s: { userId: string; tokenHash: Buffer; userAgent: string | null; expiresAt: Date }): Promise<Session> {
  const rows = await db<SessionRow[]>`
    INSERT INTO sessions (user_id, token_hash, user_agent, expires_at)
    VALUES (${s.userId}, ${s.tokenHash}, ${s.userAgent}, ${s.expiresAt})
    RETURNING id, user_id, device_id, user_agent, created_at, last_used_at, expires_at`;
  return mapSession(rows[0]!);
}

/** Active (not revoked, not expired) session + its user, by token hash. */
export async function findActiveSession(db: Db, tokenHash: Buffer, now: Date): Promise<{ session: Session; user: User } | null> {
  const rows = await db<(UserRow & { s_id: string; s_device_id: string | null; s_user_agent: string | null; s_created_at: Date; s_last_used_at: Date; s_expires_at: Date })[]>`
    SELECT u.*, s.id AS s_id, s.device_id AS s_device_id, s.user_agent AS s_user_agent,
           s.created_at AS s_created_at, s.last_used_at AS s_last_used_at, s.expires_at AS s_expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${tokenHash} AND s.revoked_at IS NULL AND s.expires_at > ${now}`;
  const r = rows[0];
  if (!r) return null;
  return {
    session: { id: r.s_id, userId: r.id, deviceId: r.s_device_id, userAgent: r.s_user_agent, createdAt: r.s_created_at, lastUsedAt: r.s_last_used_at, expiresAt: r.s_expires_at },
    user: mapUser(r),
  };
}

/** Sliding expiry: extend the session and mark its device as seen. */
export async function touchSession(db: Db, sessionId: string, now: Date, expiresAt: Date): Promise<void> {
  await db`UPDATE sessions SET last_used_at = ${now}, expires_at = ${expiresAt} WHERE id = ${sessionId} AND revoked_at IS NULL`;
  await db`UPDATE devices SET last_seen_at = ${now} WHERE id = (SELECT device_id FROM sessions WHERE id = ${sessionId})`;
}

export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db`UPDATE sessions SET revoked_at = now() WHERE id = ${sessionId} AND revoked_at IS NULL`;
}

export async function revokeUserSessions(db: Db, userId: string, exceptSessionId?: string): Promise<number> {
  const rows = exceptSessionId
    ? await db`UPDATE sessions SET revoked_at = now() WHERE user_id = ${userId} AND revoked_at IS NULL AND id <> ${exceptSessionId} RETURNING id`
    : await db`UPDATE sessions SET revoked_at = now() WHERE user_id = ${userId} AND revoked_at IS NULL RETURNING id`;
  return rows.length;
}

export async function listSessions(db: Db, userId: string, now: Date): Promise<Session[]> {
  const rows = await db<SessionRow[]>`
    SELECT id, user_id, device_id, user_agent, created_at, last_used_at, expires_at
    FROM sessions WHERE user_id = ${userId} AND revoked_at IS NULL AND expires_at > ${now}
    ORDER BY last_used_at DESC`;
  return rows.map(mapSession);
}

/** Housekeeping: drop sessions that expired or were revoked more than a week ago. */
export async function purgeDeadSessions(db: Db, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - 7 * 86_400_000);
  const rows = await db`DELETE FROM sessions WHERE expires_at < ${cutoff} OR revoked_at < ${cutoff} RETURNING id`;
  return rows.length;
}

/* ------------------------------------------------------------- email tokens */

export type TokenPurpose = "verify_email" | "password_reset";

export async function insertEmailToken(db: Db, t: { userId: string; purpose: TokenPurpose; tokenHash: Buffer; expiresAt: Date }): Promise<void> {
  // Only the most recent token of a purpose stays valid.
  await db`UPDATE email_tokens SET used_at = now() WHERE user_id = ${t.userId} AND purpose = ${t.purpose} AND used_at IS NULL`;
  await db`INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at) VALUES (${t.userId}, ${t.purpose}, ${t.tokenHash}, ${t.expiresAt})`;
}

/** Atomically consume a token; returns the owning user id or null if invalid/expired/used. */
export async function consumeEmailToken(db: Db, purpose: TokenPurpose, tokenHash: Buffer, now: Date): Promise<string | null> {
  const rows = await db<{ user_id: string }[]>`
    UPDATE email_tokens SET used_at = ${now}
    WHERE token_hash = ${tokenHash} AND purpose = ${purpose} AND used_at IS NULL AND expires_at > ${now}
    RETURNING user_id`;
  return rows[0]?.user_id ?? null;
}
