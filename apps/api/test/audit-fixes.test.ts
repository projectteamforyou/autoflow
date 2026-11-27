/** Regression tests for the 2026-11 API audit: link base, hostile text, login limiter race, sync delete, Atlas moderation. */
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { MemoryTokenBucket } from "../src/lib/rate-limit.js";
import { createLogger } from "../src/logger.js";
import { b64, makeApp, sampleFlow, useTestDb } from "./helpers.js";

const db = useTestDb();

describe("public app URL", () => {
  it("defaults to the web app under /app so mail and share links resolve", async () => {
    const c = loadConfig({ DATABASE_URL: "postgres://x/y" });
    expect(c.publicAppUrl).toBe("https://autoflowmacro.com/app");

    const t = makeApp(db);
    t.config.publicAppUrl = c.publicAppUrl;
    const u = await t.signup();
    expect(t.mailer.last(u.email, "verify_email")!.text).toContain("https://autoflowmacro.com/app/verify-email#token=");
    await t.call("POST", "/v1/auth/password/forgot", { body: { email: u.email } });
    expect(t.mailer.last(u.email, "password_reset")!.text).toContain("https://autoflowmacro.com/app/reset-password#token=");
    const s = await t.call("POST", "/v1/shares", { body: { flow: sampleFlow() } });
    expect(s.json.share.url).toBe(`https://autoflowmacro.com/app/s/${s.json.share.id}`);
  });
});

describe("text PostgreSQL cannot store", () => {
  it("answers 400 validation_failed for NUL bytes and unpaired surrogates instead of 500", async () => {
    const lines: string[] = [];
    const t = makeApp(db, { logger: createLogger("error", {}, (l) => lines.push(l)) });
    const u = await t.signup({ verified: true });
    const loneSurrogate = (body: unknown) => ({ raw: JSON.stringify(body).replace('"X"', '"\\ud800"'), headers: { "Content-Type": "application/json" } });

    const cases: [string, Promise<{ status: number; json: any }>][] = [
      ["signup displayName", t.call("POST", "/v1/auth/signup", { body: { email: "nul1@example.com", password: "correct horse battery staple", displayName: "a\u0000b" } })],
      ["device name", t.call("POST", "/v1/devices", { token: u.token, body: { name: "pc\u0000x", platform: "windows" } })],
      ["profile displayName", t.call("PATCH", "/v1/me", { token: u.token, body: { displayName: "z\u0000" } })],
      ["profile displayName (surrogate)", t.call("PATCH", "/v1/me", { token: u.token, ...loneSurrogate({ displayName: "X" }) })],
      ["atlas publish", t.call("POST", "/v1/atlas/templates", { token: u.token, body: { flow: sampleFlow({ description: "d\u0000" }), category: "clicking" } })],
      ["atlas publish (surrogate)", t.call("POST", "/v1/atlas/templates", { token: u.token, ...loneSurrogate({ flow: sampleFlow({ description: "X" }), category: "clicking" }) })],
      ["share", t.call("POST", "/v1/shares", { body: { flow: sampleFlow({ name: "n\u0000m" }) } })],
      ["share (surrogate)", t.call("POST", "/v1/shares", loneSurrogate({ flow: sampleFlow({ description: "X" }) }))],
      ["share (nested value)", t.call("POST", "/v1/shares", { body: { flow: sampleFlow({ steps: [{ id: "w", type: "wait", ms: 1, note: ["ok", { deep: "x\u0000" }] }] }) } })],
      ["share (object key)", t.call("POST", "/v1/shares", { body: { flow: sampleFlow({ extra: { "k\u0000": "v" } }) } })],
      ["atlas search", t.call("GET", `/v1/atlas/templates?q=${encodeURIComponent("a\u0000b")}`)],
    ];
    for (const [name, pending] of cases) {
      const r = await pending;
      expect([name, r.status, r.json?.error?.code]).toEqual([name, 400, "validation_failed"]);
      expect(r.json.error.details[0]).toMatchObject({ path: expect.any(String), message: expect.stringMatching(/NUL|surrogate/) });
    }
    expect((await t.call("POST", "/v1/shares", { body: { flow: sampleFlow({ extra: { "k\u0000": "v" } }) } })).json.error.details[0].path).toBe("flow.extra");
    expect(lines).toEqual([]);

    // Well-formed text outside the BMP (surrogate pairs) is still accepted.
    const ok = await t.call("PATCH", "/v1/me", { token: u.token, body: { displayName: "Félix 🚀 한글" } });
    expect(ok.status).toBe(200);
    expect(ok.json.user.displayName).toBe("Félix 🚀 한글");
    expect((await t.call("GET", `/v1/atlas/templates?q=${encodeURIComponent("🚀")}`)).status).toBe(200);
  });
});

describe("per-account login limit", () => {
  it("refunds tokens to the bucket, never above capacity and without tracking unseen keys", () => {
    const b = new MemoryTokenBucket({ capacity: 2, refillPerMinute: 0 }, () => 0);
    b.refund("unseen");
    expect(b.size).toBe(0);
    b.consume("k");
    b.consume("k");
    expect(b.consume("k").allowed).toBe(false);
    b.refund("k");
    expect(b.peek("k")).toMatchObject({ allowed: true, remaining: 1 });
    b.refund("k", 5);
    expect(b.peek("k").remaining).toBe(2);
  });

  it("holds under parallel wrong passwords: at most `capacity` reach the password check", async () => {
    const t = makeApp(db, { limits: { rate: { authAccount: { capacity: 3, refillPerMinute: 0.001 } } } });
    const u = await t.signup();
    const rs = await Promise.all(
      Array.from({ length: 15 }, (_, i) => t.call("POST", "/v1/auth/login", { ip: `203.0.113.${i + 1}`, body: { email: u.email, password: `wrong password number ${i}` } })),
    );
    const count = (status: number) => rs.filter((r) => r.status === status).length;
    expect({ 401: count(401), 429: count(429) }).toEqual({ 401: 3, 429: 12 });
    expect((await t.call("POST", "/v1/auth/login", { body: { email: u.email, password: u.password } })).status).toBe(429);
  });

  it("does not spend the budget on successful logins, sequential or parallel", async () => {
    const t = makeApp(db, { limits: { rate: { authAccount: { capacity: 3, refillPerMinute: 0.001 } } } });
    const u = await t.signup();
    const login = (password: string) => t.call("POST", "/v1/auth/login", { body: { email: u.email, password } });
    for (let i = 0; i < 6; i++) expect((await login(u.password)).status).toBe(200);
    const parallel = await Promise.all(Array.from({ length: 3 }, () => login(u.password)));
    expect(parallel.map((r) => r.status)).toEqual([200, 200, 200]);
    // The whole budget is still there for wrong guesses.
    expect((await login("wrong password aaa")).status).toBe(401);
    expect((await login("wrong password bbb")).status).toBe(401);
    expect((await login("wrong password ccc")).status).toBe(401);
    expect((await login("wrong password ddd")).status).toBe(429);
  });
});

describe("sync DELETE", () => {
  it("is idempotent on a tombstone whatever If-Match says, and still guards live items", async () => {
    const t = makeApp(db);
    const u = await t.signup();
    const body = { ciphertext: b64(30), iv: b64(12), contentHash: "a".repeat(64) };
    const put = (id: string, rev: string) => t.call("PUT", `/v1/sync/items/flow/${id}`, { token: u.token, body, headers: { "If-Match": rev } });
    const del = (id: string, rev: string) => t.call("DELETE", `/v1/sync/items/flow/${id}`, { token: u.token, headers: { "If-Match": rev } });

    await put("a", "0");
    const first = await del("a", "1");
    expect(first.status).toBe(200);
    expect(first.json.item).toMatchObject({ revision: 2, deleted: true });
    // A retry (lost response) or a second device still holds revision 1.
    for (const rev of ["1", "2", "0", "7"]) {
      const again = await del("a", rev);
      expect([rev, again.status]).toEqual([rev, 200]);
      expect(again.json.item).toMatchObject({ id: "a", revision: 2, deleted: true });
      expect(again.headers.get("etag")).toBe(first.headers.get("etag"));
    }

    await put("b", "0");
    await put("b", "1");
    const stale = await del("b", "1");
    expect(stale.status).toBe(409);
    expect(stale.json.error.details.current).toMatchObject({ id: "b", revision: 2, deleted: false });
    expect((await t.call("GET", "/v1/sync/items/flow/b", { token: u.token })).json.item.deleted).toBe(false);

    for (const rev of ["0", "3"]) expect((await del("never", rev)).status).toBe(404);
  });
});

describe("password change", () => {
  it("invalidates a password reset link requested earlier", async () => {
    const t = makeApp(db);
    const u = await t.signup();
    await t.call("POST", "/v1/auth/password/forgot", { body: { email: u.email } });
    const resetToken = t.tokenFromMail(u.email, "password_reset");
    const verifyToken = t.tokenFromMail(u.email, "verify_email");
    const changed = await t.call("POST", "/v1/auth/password/change", { token: u.token, body: { currentPassword: u.password, newPassword: "brand new password 123" } });
    expect(changed.status).toBe(200);

    const reset = await t.call("POST", "/v1/auth/password/reset", { body: { token: resetToken, password: "attacker chosen password 9" } });
    expect(reset.status).toBe(400);
    expect(reset.json.error.code).toBe("invalid_token");
    expect((await t.call("POST", "/v1/auth/login", { body: { email: u.email, password: "brand new password 123" } })).status).toBe(200);
    // Only reset links are affected.
    expect((await t.call("POST", "/v1/auth/verify-email", { body: { token: verifyToken } })).status).toBe(200);
  });
});

describe("Atlas moderation", () => {
  it("keeps a removed template's row so its author cannot delete it and republish the same content", async () => {
    const t = makeApp(db);
    const author = await t.signup({ verified: true });
    const op = await t.signup({ email: "operator@example.com", verified: true });
    const flow = sampleFlow({ name: "Evade" });
    const publish = () => t.call("POST", "/v1/atlas/templates", { token: author.token, body: { flow, category: "clicking" } });
    const id = (await publish()).json.template.id as string;
    expect((await t.call("POST", `/v1/admin/atlas/templates/${id}/moderate`, { token: op.token, body: { action: "remove" } })).status).toBe(200);

    const del = await t.call("DELETE", `/v1/atlas/templates/${id}`, { token: author.token });
    expect(del.status).toBe(403);
    expect(del.json.error.code).toBe("forbidden");
    const again = await publish();
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe("duplicate");
    expect((await t.call("GET", "/v1/atlas/templates/mine", { token: author.token })).json.templates).toMatchObject([{ id, status: "removed" }]);
    expect((await t.call("GET", "/v1/atlas/templates")).json.total).toBe(0);

    // Someone else's delete still looks like an unknown id; the author can still unpublish live templates.
    const other = await t.signup({ verified: true });
    expect((await t.call("DELETE", `/v1/atlas/templates/${id}`, { token: other.token })).status).toBe(404);
    const live = await t.call("POST", "/v1/atlas/templates", { token: author.token, body: { flow: sampleFlow({ name: "Fine" }), category: "clicking" } });
    expect((await t.call("DELETE", `/v1/atlas/templates/${live.json.template.id}`, { token: author.token })).status).toBe(204);
  });

  it("lets an operator (ADMIN_EMAILS without role=admin) open the templates they can moderate", async () => {
    const t = makeApp(db, { adminEmails: ["operator2@example.com"] });
    const author = await t.signup({ verified: true });
    const op = await t.signup({ email: "operator2@example.com", verified: true });
    expect((await db.sql`SELECT role FROM users WHERE id = ${op.user.id}`)[0]!.role).not.toBe("admin");
    const stranger = await t.signup({ verified: true });
    const p = await t.call("POST", "/v1/atlas/templates", { token: author.token, body: { flow: sampleFlow({ name: "Under review" }), category: "clicking" } });
    expect(p.status).toBe(201);
    const id = p.json.template.id as string;
    const view = (token?: string) => t.call("GET", `/v1/atlas/templates/${id}`, { token });

    await db.sql`UPDATE atlas_templates SET status = 'pending_review' WHERE id = ${id}`;
    expect((await view(op.token)).status).toBe(200);
    expect((await view(op.token)).json.template).toMatchObject({ id, status: "pending_review" });
    expect((await view(stranger.token)).status).toBe(404);
    expect((await view()).status).toBe(404);

    expect((await t.call("POST", `/v1/admin/atlas/templates/${id}/moderate`, { token: op.token, body: { action: "remove" } })).status).toBe(200);
    expect((await view(op.token)).json.template).toMatchObject({ id, status: "removed" });
    expect((await view(stranger.token)).status).toBe(404);
  });
});

describe("Atlas search total", () => {
  it("reports the real total when paging past the end", async () => {
    const t = makeApp(db);
    const u = await t.signup({ verified: true });
    await db.sql`DELETE FROM atlas_templates`;
    for (const name of ["Totals one", "Totals two", "Totals three"]) {
      expect((await t.call("POST", "/v1/atlas/templates", { token: u.token, body: { flow: sampleFlow({ name }), category: "clicking" } })).status).toBe(201);
    }
    const page = async (qs: string) => (await t.call("GET", `/v1/atlas/templates?${qs}`)).json;
    expect(await page("pageSize=2")).toMatchObject({ total: 3, templates: [{}, {}] });
    expect((await page("pageSize=2&page=2")).templates).toHaveLength(1);
    expect(await page("pageSize=2&page=2")).toMatchObject({ total: 3 });
    expect(await page("pageSize=2&page=3")).toEqual({ templates: [], page: 3, pageSize: 2, total: 3 });
    expect(await page("page=5")).toMatchObject({ templates: [], total: 3 });
    expect(await page("q=two&page=4")).toMatchObject({ templates: [], total: 1 });
    expect(await page("q=nothing-matches-this")).toEqual({ templates: [], page: 1, pageSize: 20, total: 0 });
  });
});
