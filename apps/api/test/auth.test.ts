import { describe, expect, it } from "vitest";
import { makeApp, useTestDb } from "./helpers.js";
import { sha256 } from "../src/lib/crypto.js";

const db = useTestDb();

describe("signup / login / logout", () => {
  it("signs up, returns an opaque bearer token and stores only its hash", async () => {
    const t = makeApp(db);
    const r = await t.call("POST", "/v1/auth/signup", { body: { email: "Alice@Example.com", password: "a long passphrase!", locale: "ko", displayName: "Alice" } });
    expect(r.status).toBe(201);
    expect(r.json.user).toMatchObject({ email: "Alice@Example.com", emailVerified: false, locale: "ko", displayName: "Alice", role: "user" });
    const token: string = r.json.session.token;
    expect(token).toMatch(/^afs_[A-Za-z0-9_-]{43}$/);
    expect(new Date(r.json.session.expiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);

    const rows = await db.sql`SELECT token_hash FROM sessions WHERE user_id = ${r.json.user.id}`;
    expect(rows).toHaveLength(1);
    expect(Buffer.compare(rows[0]!.token_hash, sha256(token))).toBe(0);
    expect(JSON.stringify(rows)).not.toContain(token);

    const [u] = await db.sql`SELECT password_hash FROM users WHERE id = ${r.json.user.id}`;
    expect(u!.password_hash).toMatch(/^scrypt\$15\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);

    const me = await t.call("GET", "/v1/me", { token });
    expect(me.status).toBe(200);
    expect(me.json.user.email).toBe("Alice@Example.com");
  });

  it("rejects duplicate emails case-insensitively", async () => {
    const t = makeApp(db);
    await t.signup({ email: "dup@example.com" });
    const r = await t.call("POST", "/v1/auth/signup", { body: { email: "DUP@example.com ", password: "another passphrase" } });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("email_taken");
  });

  it("enforces the password policy and validates input", async () => {
    const t = makeApp(db);
    const short = await t.call("POST", "/v1/auth/signup", { body: { email: "p1@example.com", password: "short" } });
    expect(short.status).toBe(400);
    expect(short.json.error.code).toBe("validation_failed");
    const same = await t.call("POST", "/v1/auth/signup", { body: { email: "samesame1@example.com", password: "samesame1@example.com" } });
    expect(same.status).toBe(400);
    const bad = await t.call("POST", "/v1/auth/signup", { body: { email: "not-an-email", password: "long enough password" } });
    expect(bad.status).toBe(400);
    expect(bad.json.error.details[0].path).toBe("email");
    const invalidJson = await t.call("POST", "/v1/auth/signup", { raw: "{nope", headers: { "Content-Type": "application/json" } });
    expect(invalidJson.status).toBe(400);
    expect(invalidJson.json.error.code).toBe("invalid_json");
    const wrongType = await t.call("POST", "/v1/auth/signup", { raw: "email=a", headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    expect(wrongType.status).toBe(415);
  });

  it("logs in with the right password only, with identical errors for unknown accounts", async () => {
    const t = makeApp(db);
    const u = await t.signup();
    const ok = await t.call("POST", "/v1/auth/login", { body: { email: u.email.toUpperCase(), password: u.password } });
    expect(ok.status).toBe(200);
    expect(ok.json.session.token).not.toBe(u.token);
    const wrong = await t.call("POST", "/v1/auth/login", { body: { email: u.email, password: "wrong password!!" } });
    expect(wrong.status).toBe(401);
    const unknown = await t.call("POST", "/v1/auth/login", { body: { email: "nobody-here@example.com", password: "wrong password!!" } });
    expect(unknown.status).toBe(401);
    expect(unknown.json).toEqual(wrong.json);
  });

  it("logout revokes the current session only; logout-all revokes every session", async () => {
    const t = makeApp(db);
    const u = await t.signup();
    const second = (await t.call("POST", "/v1/auth/login", { body: { email: u.email, password: u.password } })).json.session.token;
    const third = (await t.call("POST", "/v1/auth/login", { body: { email: u.email, password: u.password } })).json.session.token;

    const sessions = await t.call("GET", "/v1/auth/sessions", { token: u.token });
    expect(sessions.json.sessions).toHaveLength(3);
    expect(sessions.json.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

    expect((await t.call("POST", "/v1/auth/logout", { token: u.token })).status).toBe(204);
    const after = await t.call("GET", "/v1/me", { token: u.token });
    expect(after.status).toBe(401);
    expect(after.headers.get("www-authenticate")).toContain("Bearer");
    expect((await t.call("GET", "/v1/me", { token: second })).status).toBe(200);

    const all = await t.call("POST", "/v1/auth/logout-all", { token: second });
    expect(all.json.revoked).toBe(2);
    expect((await t.call("GET", "/v1/me", { token: second })).status).toBe(401);
    expect((await t.call("GET", "/v1/me", { token: third })).status).toBe(401);
  });

  it("rejects missing, malformed and unknown tokens", async () => {
    const t = makeApp(db);
    expect((await t.call("GET", "/v1/me")).status).toBe(401);
    expect((await t.call("GET", "/v1/me", { headers: { Authorization: "Basic abc" } })).status).toBe(401);
    expect((await t.call("GET", "/v1/me", { token: `afs_${"A".repeat(43)}` })).status).toBe(401);
  });
});

describe("session expiry", () => {
  it("expires sessions after 30 days of inactivity and slides the window on use", async () => {
    let now = new Date("2030-01-01T00:00:00Z");
    const t = makeApp(db, { now: () => now });
    const u = await t.signup();
    const [s0] = await db.sql<{ expires_at: Date }[]>`SELECT expires_at FROM sessions WHERE user_id = ${u.user.id}`;
    expect(s0!.expires_at.toISOString()).toBe("2030-01-31T00:00:00.000Z");

    // 20 days later the session is used → expiry slides to day 50.
    now = new Date("2030-01-21T00:00:00Z");
    expect((await t.call("GET", "/v1/me", { token: u.token })).status).toBe(200);
    const [s1] = await db.sql<{ expires_at: Date }[]>`SELECT expires_at FROM sessions WHERE user_id = ${u.user.id}`;
    expect(s1!.expires_at.toISOString()).toBe("2030-02-20T00:00:00.000Z");

    // Day 49: still valid. Day 81 (31 days idle): expired.
    now = new Date("2030-02-19T00:00:00Z");
    expect((await t.call("GET", "/v1/me", { token: u.token })).status).toBe(200);
    now = new Date("2030-03-22T00:00:00Z");
    expect((await t.call("GET", "/v1/me", { token: u.token })).status).toBe(401);
  });
});

describe("email verification and password reset", () => {
  it("verifies email with a single-use hashed token", async () => {
    const t = makeApp(db);
    const u = await t.signup();
    const token = t.tokenFromMail(u.email, "verify_email");
    expect(token).toMatch(/^afv_/);
    const stored = await db.sql`SELECT token_hash FROM email_tokens WHERE user_id = ${u.user.id}`;
    expect(Buffer.compare(stored[0]!.token_hash, sha256(token))).toBe(0);

    expect((await t.call("POST", "/v1/auth/verify-email", { body: { token } })).status).toBe(200);
    expect((await t.call("GET", "/v1/me", { token: u.token })).json.user.emailVerified).toBe(true);
    const again = await t.call("POST", "/v1/auth/verify-email", { body: { token } });
    expect(again.status).toBe(400);
    expect(again.json.error.code).toBe("invalid_token");
  });

  it("resend issues a new verification link and invalidates the old one", async () => {
    const t = makeApp(db);
    const u = await t.signup();
    const first = t.tokenFromMail(u.email, "verify_email");
    expect((await t.call("POST", "/v1/auth/verify-email/resend", { token: u.token })).status).toBe(202);
    const second = t.tokenFromMail(u.email, "verify_email");
    expect(second).not.toBe(first);
    expect((await t.call("POST", "/v1/auth/verify-email", { body: { token: first } })).status).toBe(400);
    expect((await t.call("POST", "/v1/auth/verify-email", { body: { token: second } })).status).toBe(200);
  });

  it("resets the password, revoking all sessions; does not reveal unknown emails", async () => {
    const t = makeApp(db);
    const u = await t.signup();
    const unknown = await t.call("POST", "/v1/auth/password/forgot", { body: { email: "ghost@example.com" } });
    expect(unknown.status).toBe(202);
    const known = await t.call("POST", "/v1/auth/password/forgot", { body: { email: u.email } });
    expect(known.status).toBe(202);
    expect(known.json).toEqual(unknown.json);

    const token = t.tokenFromMail(u.email, "password_reset");
    expect(token).toMatch(/^afr_/);
    const weak = await t.call("POST", "/v1/auth/password/reset", { body: { token, password: "short" } });
    expect(weak.status).toBe(400);
    // A failed policy check must not burn the token.
    const r = await t.call("POST", "/v1/auth/password/reset", { body: { token, password: "brand new passphrase" } });
    expect(r.status).toBe(200);
    expect((await t.call("GET", "/v1/me", { token: u.token })).status).toBe(401);
    expect((await t.call("POST", "/v1/auth/login", { body: { email: u.email, password: u.password } })).status).toBe(401);
    expect((await t.call("POST", "/v1/auth/login", { body: { email: u.email, password: "brand new passphrase" } })).status).toBe(200);
    expect((await t.call("POST", "/v1/auth/password/reset", { body: { token, password: "another passphrase" } })).status).toBe(400);
    expect(t.mailer.last(u.email, "password_changed")).toBeDefined();
  });

  it("rejects expired reset tokens", async () => {
    let now = new Date();
    const t = makeApp(db, { now: () => now });
    const u = await t.signup();
    await t.call("POST", "/v1/auth/password/forgot", { body: { email: u.email } });
    const token = t.tokenFromMail(u.email, "password_reset");
    now = new Date(now.getTime() + 61 * 60_000);
    expect((await t.call("POST", "/v1/auth/password/reset", { body: { token, password: "brand new passphrase" } })).status).toBe(400);
  });

  it("changes the password with the current one and signs out other sessions", async () => {
    const t = makeApp(db);
    const u = await t.signup();
    const other = (await t.call("POST", "/v1/auth/login", { body: { email: u.email, password: u.password } })).json.session.token;
    const bad = await t.call("POST", "/v1/auth/password/change", { token: u.token, body: { currentPassword: "nope nope nope", newPassword: "fresh passphrase 1" } });
    expect(bad.status).toBe(401);
    const ok = await t.call("POST", "/v1/auth/password/change", { token: u.token, body: { currentPassword: u.password, newPassword: "fresh passphrase 1" } });
    expect(ok.status).toBe(200);
    expect((await t.call("GET", "/v1/me", { token: u.token })).status).toBe(200);
    expect((await t.call("GET", "/v1/me", { token: other })).status).toBe(401);
  });

  it("updates the profile", async () => {
    const t = makeApp(db);
    const u = await t.signup();
    const r = await t.call("PATCH", "/v1/me", { token: u.token, body: { displayName: "Neo", locale: "ja" } });
    expect(r.status).toBe(200);
    expect(r.json.user).toMatchObject({ displayName: "Neo", locale: "ja" });
    expect((await t.call("PATCH", "/v1/me", { token: u.token, body: { locale: "xx" } })).status).toBe(400);
    expect((await t.call("PATCH", "/v1/me", { token: u.token, body: {} })).status).toBe(400);
  });
});

describe("rate limits", () => {
  it("limits auth attempts per IP", async () => {
    const t = makeApp(db, { limits: { rate: { authIp: { capacity: 3, refillPerMinute: 1 } } } });
    const body = { email: "rl-ip@example.com", password: "whatever password" };
    for (let i = 0; i < 3; i++) expect((await t.call("POST", "/v1/auth/login", { body, ip: "203.0.113.9" })).status).toBe(401);
    const limited = await t.call("POST", "/v1/auth/login", { body, ip: "203.0.113.9" });
    expect(limited.status).toBe(429);
    expect(limited.json.error.code).toBe("rate_limited");
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    // A different client is unaffected.
    expect((await t.call("POST", "/v1/auth/login", { body, ip: "203.0.113.10" })).status).toBe(401);
  });

  it("limits login attempts per account across IPs", async () => {
    const t = makeApp(db, { limits: { rate: { authAccount: { capacity: 2, refillPerMinute: 1 } } } });
    const u = await t.signup();
    for (let i = 0; i < 2; i++) expect((await t.call("POST", "/v1/auth/login", { body: { email: u.email, password: "bad password!!" }, ip: `192.0.2.${i + 1}` })).status).toBe(401);
    const limited = await t.call("POST", "/v1/auth/login", { body: { email: u.email, password: u.password }, ip: "192.0.2.99" });
    expect(limited.status).toBe(429);
  });

  it("applies a global per-IP limit and uses the proxy-appended X-Forwarded-For entry", async () => {
    const t = makeApp(db, { limits: { rate: { global: { capacity: 2, refillPerMinute: 1 } } } });
    expect((await t.call("GET", "/v1/meta", { headers: { "X-Forwarded-For": "1.1.1.1, 10.0.0.1" } })).status).toBe(200);
    // Spoofed left-most entries do not create a fresh bucket: the proxy-appended one is used.
    expect((await t.call("GET", "/v1/meta", { headers: { "X-Forwarded-For": "2.2.2.2, 10.0.0.1" } })).status).toBe(200);
    expect((await t.call("GET", "/v1/meta", { headers: { "X-Forwarded-For": "3.3.3.3, 10.0.0.1" } })).status).toBe(429);
    expect((await t.call("GET", "/health", { headers: { "X-Forwarded-For": "10.0.0.1" } })).status).toBe(200);
  });
});
