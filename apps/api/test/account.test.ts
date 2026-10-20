import { describe, expect, it } from "vitest";
import { b64, makeApp, sampleFlow, useTestDb } from "./helpers.js";

const db = useTestDb();

const TABLES_WITH_USER = [
  ["sessions", "user_id"],
  ["devices", "user_id"],
  ["email_tokens", "user_id"],
  ["items", "user_id"],
  ["atlas_templates", "author_id"],
  ["atlas_ratings", "user_id"],
  ["atlas_reports", "reporter_id"],
  ["atlas_installs", "user_id"],
  ["shares", "owner_id"],
] as const;

async function countRows(userId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [table, col] of TABLES_WITH_USER) {
    const [r] = await db.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ${db.sql(table)} WHERE ${db.sql(col)} = ${userId}`;
    out[table] = r!.n;
  }
  return out;
}

async function populate(t: ReturnType<typeof makeApp>) {
  const u = await t.signup({ verified: true, displayName: "Export Me" });
  const other = await t.signup({ verified: true });
  await t.call("POST", "/v1/devices", { token: u.token, body: { name: "Laptop", platform: "windows", appVersion: "1.0.0" } });
  await t.call("PUT", "/v1/sync/items/flow/f1", { token: u.token, body: { ciphertext: b64(32), iv: b64(12), contentHash: "b".repeat(64) }, headers: { "If-Match": "0" } });
  const mine = (await t.call("POST", "/v1/atlas/templates", { token: u.token, body: { flow: sampleFlow({ name: "Mine to export" }), category: "testing" } })).json.template.id;
  const theirs = (await t.call("POST", "/v1/atlas/templates", { token: other.token, body: { flow: sampleFlow({ name: "Theirs" }), category: "testing" } })).json.template.id;
  await t.call("PUT", `/v1/atlas/templates/${theirs}/rating`, { token: u.token, body: { stars: 4 } });
  await t.call("POST", `/v1/atlas/templates/${theirs}/reports`, { token: u.token, body: { reason: "broken", details: "does nothing" } });
  await t.call("POST", `/v1/atlas/templates/${theirs}/install`, { token: u.token });
  await t.call("PUT", `/v1/atlas/templates/${mine}/rating`, { token: other.token, body: { stars: 5 } });
  await t.call("POST", "/v1/shares", { token: u.token, body: { flow: sampleFlow({ name: "My share" }) } });
  return { u, other, mine, theirs };
}

describe("data export", () => {
  it("returns every piece of user data as JSON", async () => {
    const t = makeApp(db);
    const { u, mine, theirs } = await populate(t);
    const r = await t.call("GET", "/v1/me/export", { token: u.token });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toMatch(/^attachment; filename="autoflow-export-\d{4}-\d{2}-\d{2}\.json"$/);
    const e = r.json;
    expect(e).toMatchObject({ format: "autoflow.account-export", version: 1, user: { email: u.email, displayName: "Export Me", emailVerified: true } });
    expect(e.sessions).toHaveLength(1);
    expect(e.sessions[0].current).toBe(true);
    expect(JSON.stringify(e)).not.toContain(u.token);
    expect(JSON.stringify(e)).not.toMatch(/password_?hash|scrypt\$/i);
    expect(e.devices[0]).toMatchObject({ name: "Laptop", platform: "windows" });
    expect(e.syncItems).toHaveLength(1);
    expect(e.syncItems[0].ciphertext).toBeTruthy();
    expect(e.atlas.templates.map((x: { id: string }) => x.id)).toEqual([mine]);
    expect(e.atlas.templates[0].flow.name).toBe("Mine to export");
    expect(e.atlas.ratings).toEqual([expect.objectContaining({ templateId: theirs, stars: 4 })]);
    expect(e.atlas.reports).toEqual([expect.objectContaining({ templateId: theirs, reason: "broken", details: "does nothing" })]);
    expect(e.atlas.installs).toEqual([expect.objectContaining({ templateId: theirs })]);
    expect(e.shares[0].flow.name).toBe("My share");
    expect((await t.call("GET", "/v1/me/export")).status).toBe(401);
  });
});

describe("account deletion", () => {
  it("requires the password and cascades every user-owned row", async () => {
    const t = makeApp(db);
    const { u, other, mine, theirs } = await populate(t);
    const before = await countRows(u.user.id);
    for (const [table] of TABLES_WITH_USER) expect(before[table], table).toBeGreaterThan(0);

    const wrong = await t.call("DELETE", "/v1/me", { token: u.token, body: { password: "not my password" } });
    expect(wrong.status).toBe(401);
    expect((await t.call("GET", "/v1/me", { token: u.token })).status).toBe(200);

    const del = await t.call("DELETE", "/v1/me", { token: u.token, body: { password: u.password } });
    expect(del.status).toBe(204);
    expect(await countRows(u.user.id)).toEqual(Object.fromEntries(TABLES_WITH_USER.map(([table]) => [table, 0])));
    expect((await db.sql`SELECT 1 FROM users WHERE id = ${u.user.id}`).length).toBe(0);

    // Their session is gone, the email is free again, and other users' data is intact.
    expect((await t.call("GET", "/v1/me", { token: u.token })).status).toBe(401);
    expect((await t.call("POST", "/v1/auth/login", { body: { email: u.email, password: u.password } })).status).toBe(401);
    expect((await t.call("GET", `/v1/atlas/templates/${mine}`)).status).toBe(404);
    const theirsAfter = await t.call("GET", `/v1/atlas/templates/${theirs}`);
    expect(theirsAfter.status).toBe(200);
    // The deleted user's 4-star rating no longer counts.
    expect(theirsAfter.json.template.rating).toEqual({ average: null, count: 0 });
    expect((await t.call("GET", "/v1/me", { token: other.token })).status).toBe(200);
    expect(t.mailer.last(u.email, "account_deleted")).toBeDefined();

    expect((await t.call("POST", "/v1/auth/signup", { body: { email: u.email, password: "a whole new passphrase" } })).status).toBe(201);
  });
});
