import { describe, expect, it } from "vitest";
import { b64, makeApp, useTestDb } from "./helpers.js";

const db = useTestDb();

const payload = (bytes = 64) => ({ ciphertext: b64(bytes), iv: b64(12), contentHash: "a".repeat(64) });

describe("encrypted sync", () => {
  it("creates, reads, updates and pages items with a server cursor", async () => {
    const t = makeApp(db);
    const u = await t.signup();
    const p1 = payload();
    const created = await t.call("PUT", "/v1/sync/items/flow/f_1", { token: u.token, body: p1, headers: { "If-Match": "0" } });
    expect(created.status).toBe(201);
    expect(created.headers.get("etag")).toBe('"1"');
    expect(created.json.item).toMatchObject({ kind: "flow", id: "f_1", revision: 1, deleted: false, sizeBytes: 64 });
    expect(created.json.item.ciphertext).toBeUndefined();

    const one = await t.call("GET", "/v1/sync/items/flow/f_1", { token: u.token });
    expect(one.json.item.ciphertext).toBe(p1.ciphertext);
    expect(one.json.item.iv).toBe(p1.iv);

    const p2 = payload(100);
    const updated = await t.call("PUT", "/v1/sync/items/flow/f_1", { token: u.token, body: p2, headers: { "If-Match": '"1"' } });
    expect(updated.status).toBe(200);
    expect(updated.json.item.revision).toBe(2);

    await t.call("PUT", "/v1/sync/items/profile/p_1", { token: u.token, body: payload(), headers: { "If-Match": "0" } });
    await t.call("PUT", "/v1/sync/items/settings/main", { token: u.token, body: payload(), headers: { "If-Match": "0" } });

    const all = await t.call("GET", "/v1/sync", { token: u.token });
    expect(all.status).toBe(200);
    expect(all.json.items.map((i: { id: string }) => i.id)).toEqual(["f_1", "p_1", "main"]);
    expect(all.json.items[0].ciphertext).toBe(p2.ciphertext);
    expect(all.json.hasMore).toBe(false);

    const page1 = await t.call("GET", "/v1/sync?since=0&limit=2", { token: u.token });
    expect(page1.json.items).toHaveLength(2);
    expect(page1.json.hasMore).toBe(true);
    const page2 = await t.call("GET", `/v1/sync?since=${page1.json.cursor}&limit=2`, { token: u.token });
    expect(page2.json.items.map((i: { id: string }) => i.id)).toEqual(["main"]);
    expect(page2.json.hasMore).toBe(false);

    const empty = await t.call("GET", `/v1/sync?since=${page2.json.cursor}`, { token: u.token });
    expect(empty.json.items).toEqual([]);
    expect(empty.json.cursor).toBe(page2.json.cursor);

    // Editing an item moves it to the end of the change feed.
    await t.call("PUT", "/v1/sync/items/flow/f_1", { token: u.token, body: payload(), headers: { "If-Match": "2" } });
    const delta = await t.call("GET", `/v1/sync?since=${page2.json.cursor}`, { token: u.token });
    expect(delta.json.items.map((i: { id: string; revision: number }) => [i.id, i.revision])).toEqual([["f_1", 3]]);
  });

  it("returns 409 with the server copy on revision conflicts", async () => {
    const t = makeApp(db);
    const u = await t.signup();
    const server = payload();
    await t.call("PUT", "/v1/sync/items/flow/c1", { token: u.token, body: server, headers: { "If-Match": "0" } });

    const stale = await t.call("PUT", "/v1/sync/items/flow/c1", { token: u.token, body: payload(), headers: { "If-Match": "0" } });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe("conflict");
    expect(stale.json.error.details.current).toMatchObject({ id: "c1", revision: 1, ciphertext: server.ciphertext, iv: server.iv });

    const ahead = await t.call("PUT", "/v1/sync/items/flow/c1", { token: u.token, body: payload(), headers: { "If-Match": "7" } });
    expect(ahead.status).toBe(409);

    const missingCreate = await t.call("PUT", "/v1/sync/items/flow/nope", { token: u.token, body: payload(), headers: { "If-Match": "3" } });
    expect(missingCreate.status).toBe(409);
    expect(missingCreate.json.error.details.current).toBeNull();
  });

  it("requires If-Match and validates payloads and ids", async () => {
    const t = makeApp(db);
    const u = await t.signup();
    const noIfMatch = await t.call("PUT", "/v1/sync/items/flow/x", { token: u.token, body: payload() });
    expect(noIfMatch.status).toBe(428);
    expect((await t.call("PUT", "/v1/sync/items/flow/x", { token: u.token, body: payload(), headers: { "If-Match": "abc" } })).status).toBe(400);
    expect((await t.call("PUT", "/v1/sync/items/flow/x", { token: u.token, body: { ...payload(), ciphertext: "not base64!" }, headers: { "If-Match": "0" } })).status).toBe(400);
    expect((await t.call("PUT", "/v1/sync/items/flow/x", { token: u.token, body: { ...payload(), iv: "" }, headers: { "If-Match": "0" } })).status).toBe(400);
    expect((await t.call("PUT", "/v1/sync/items/secrets/x", { token: u.token, body: payload(), headers: { "If-Match": "0" } })).status).toBe(404);
    expect((await t.call("PUT", "/v1/sync/items/flow/bad%20id", { token: u.token, body: payload(), headers: { "If-Match": "0" } })).status).toBe(404);
    expect((await t.call("GET", "/v1/sync?since=-1", { token: u.token })).status).toBe(400);
    expect((await t.call("GET", "/v1/sync")).status).toBe(401);
  });

  it("deletes with tombstones that propagate through the change feed", async () => {
    const t = makeApp(db);
    const u = await t.signup();
    await t.call("PUT", "/v1/sync/items/flow/d1", { token: u.token, body: payload(), headers: { "If-Match": "0" } });
    const cursor = (await t.call("GET", "/v1/sync", { token: u.token })).json.cursor;

    expect((await t.call("DELETE", "/v1/sync/items/flow/d1", { token: u.token, headers: { "If-Match": "0" } })).status).toBe(409);
    const del = await t.call("DELETE", "/v1/sync/items/flow/d1", { token: u.token, headers: { "If-Match": "1" } });
    expect(del.status).toBe(200);
    expect(del.json.item).toMatchObject({ id: "d1", revision: 2, deleted: true, sizeBytes: 0 });

    const feed = await t.call("GET", `/v1/sync?since=${cursor}`, { token: u.token });
    expect(feed.json.items).toHaveLength(1);
    expect(feed.json.items[0]).toMatchObject({ id: "d1", deleted: true, ciphertext: null, iv: null, contentHash: null });

    const [row] = await db.sql`SELECT ciphertext FROM items WHERE item_id = 'd1'`;
    expect(row!.ciphertext).toBeNull();
    expect((await t.call("DELETE", "/v1/sync/items/flow/missing", { token: u.token, headers: { "If-Match": "1" } })).status).toBe(404);

    // Re-creating on top of a tombstone continues the revision chain.
    const again = await t.call("PUT", "/v1/sync/items/flow/d1", { token: u.token, body: payload(), headers: { "If-Match": "2" } });
    expect(again.status).toBe(200);
    expect(again.json.item).toMatchObject({ revision: 3, deleted: false });
  });

  it("isolates users from each other", async () => {
    const t = makeApp(db);
    const a = await t.signup();
    const b = await t.signup();
    await t.call("PUT", "/v1/sync/items/flow/shared-id", { token: a.token, body: payload(), headers: { "If-Match": "0" } });
    expect((await t.call("GET", "/v1/sync/items/flow/shared-id", { token: b.token })).status).toBe(404);
    expect((await t.call("GET", "/v1/sync", { token: b.token })).json.items).toEqual([]);
    // Same item id for user B is an independent item.
    expect((await t.call("PUT", "/v1/sync/items/flow/shared-id", { token: b.token, body: payload(), headers: { "If-Match": "0" } })).status).toBe(201);
  });

  it("enforces item-count, byte and per-item quotas", async () => {
    const t = makeApp(db, { limits: { sync: { maxItems: 3, maxBytes: 1000, maxItemBytes: 600 } } });
    const u = await t.signup();
    for (let i = 0; i < 3; i++) expect((await t.call("PUT", `/v1/sync/items/flow/q${i}`, { token: u.token, body: payload(10), headers: { "If-Match": "0" } })).status).toBe(201);
    const over = await t.call("PUT", "/v1/sync/items/flow/q3", { token: u.token, body: payload(10), headers: { "If-Match": "0" } });
    expect(over.status).toBe(403);
    expect(over.json.error.code).toBe("quota_exceeded");
    // Updating an existing item is fine at the item limit; deleting frees a slot.
    expect((await t.call("PUT", "/v1/sync/items/flow/q0", { token: u.token, body: payload(20), headers: { "If-Match": "1" } })).status).toBe(200);
    await t.call("DELETE", "/v1/sync/items/flow/q1", { token: u.token, headers: { "If-Match": "1" } });
    expect((await t.call("PUT", "/v1/sync/items/flow/q3", { token: u.token, body: payload(10), headers: { "If-Match": "0" } })).status).toBe(201);

    const big = await t.call("PUT", "/v1/sync/items/flow/q0", { token: u.token, body: payload(601), headers: { "If-Match": "2" } });
    expect(big.status).toBe(413);
    await t.call("PUT", "/v1/sync/items/flow/q0", { token: u.token, body: payload(600), headers: { "If-Match": "2" } });
    const bytes = await t.call("PUT", "/v1/sync/items/flow/q2", { token: u.token, body: payload(500), headers: { "If-Match": "1" } });
    expect(bytes.status).toBe(403);
    expect(bytes.json.error.message).toMatch(/Storage limit/);

    const usage = await t.call("GET", "/v1/sync/usage", { token: u.token });
    expect(usage.json).toMatchObject({ items: 3, bytes: 620, limits: { maxItems: 3, maxBytes: 1000, maxItemBytes: 600 } });
  });

  it("rejects bodies above the sync body limit before parsing", async () => {
    const t = makeApp(db, { limits: { sync: { maxItemBytes: 1024 } } });
    const u = await t.signup();
    const r = await t.call("PUT", "/v1/sync/items/flow/huge", { token: u.token, body: payload(64 * 1024), headers: { "If-Match": "0" } });
    expect(r.status).toBe(413);
    expect(r.json.error.code).toBe("payload_too_large");
  });

  it("keeps per-user revision order under concurrent writers", async () => {
    const t = makeApp(db);
    const u = await t.signup();
    await t.call("PUT", "/v1/sync/items/flow/race", { token: u.token, body: payload(), headers: { "If-Match": "0" } });
    const results = await Promise.all(Array.from({ length: 8 }, () => t.call("PUT", "/v1/sync/items/flow/race", { token: u.token, body: payload(), headers: { "If-Match": "1" } })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(7);
  });
});

describe("devices", () => {
  it("registers, lists, renames and revokes devices; revoking signs the device out", async () => {
    const t = makeApp(db);
    const u = await t.signup();
    const laptop = (await t.call("POST", "/v1/auth/login", { body: { email: u.email, password: u.password } })).json.session.token;

    const reg = await t.call("POST", "/v1/devices", { token: u.token, body: { name: "Pixel 9", platform: "android", appVersion: "1.2.0" } });
    expect(reg.status).toBe(201);
    expect(reg.json.device).toMatchObject({ name: "Pixel 9", platform: "android", appVersion: "1.2.0", current: true });
    const phoneId = reg.json.device.id;

    // Re-registering from the same session updates instead of duplicating.
    const rereg = await t.call("POST", "/v1/devices", { token: u.token, body: { name: "Pixel 9 Pro", platform: "android", appVersion: "1.3.0" } });
    expect(rereg.json.device.id).toBe(phoneId);

    const pc = await t.call("POST", "/v1/devices", { token: laptop, body: { name: "Desk PC", platform: "windows" } });
    expect(pc.status).toBe(201);

    const list = await t.call("GET", "/v1/devices", { token: laptop });
    expect(list.json.devices).toHaveLength(2);
    expect(list.json.devices.find((d: { id: string }) => d.id === pc.json.device.id).current).toBe(true);
    expect(list.json.devices.find((d: { id: string }) => d.id === phoneId).current).toBe(false);

    const renamed = await t.call("PATCH", `/v1/devices/${phoneId}`, { token: laptop, body: { name: "Old phone" } });
    expect(renamed.json.device.name).toBe("Old phone");

    // Sync writes are attributed to the device.
    const w = await t.call("PUT", "/v1/sync/items/flow/dev", { token: u.token, body: payload(), headers: { "If-Match": "0" } });
    expect(w.json.item.deviceId).toBe(phoneId);

    expect((await t.call("DELETE", `/v1/devices/${phoneId}`, { token: laptop })).status).toBe(204);
    expect((await t.call("GET", "/v1/me", { token: u.token })).status).toBe(401);
    expect((await t.call("GET", "/v1/me", { token: laptop })).status).toBe(200);
    expect((await t.call("GET", "/v1/devices", { token: laptop })).json.devices).toHaveLength(1);
  });

  it("validates input, scopes devices to their owner and caps the count", async () => {
    const t = makeApp(db, { limits: { devices: { maxPerUser: 1 } } });
    const a = await t.signup();
    const b = await t.signup();
    expect((await t.call("POST", "/v1/devices", { token: a.token, body: { name: "", platform: "android" } })).status).toBe(400);
    expect((await t.call("POST", "/v1/devices", { token: a.token, body: { name: "x", platform: "toaster" } })).status).toBe(400);
    const d = await t.call("POST", "/v1/devices", { token: a.token, body: { name: "A1", platform: "web" } });
    expect((await t.call("PATCH", `/v1/devices/${d.json.device.id}`, { token: b.token, body: { name: "stolen" } })).status).toBe(404);
    expect((await t.call("DELETE", `/v1/devices/${d.json.device.id}`, { token: b.token })).status).toBe(404);
    expect((await t.call("DELETE", "/v1/devices/not-a-uuid", { token: a.token })).status).toBe(404);
    const second = (await t.call("POST", "/v1/auth/login", { body: { email: a.email, password: a.password } })).json.session.token;
    const over = await t.call("POST", "/v1/devices", { token: second, body: { name: "A2", platform: "web" } });
    expect(over.status).toBe(403);
  });

  it("updates last_seen when a device's session is used", async () => {
    let now = new Date("2031-05-01T00:00:00Z");
    const t = makeApp(db, { now: () => now });
    const u = await t.signup();
    const d = await t.call("POST", "/v1/devices", { token: u.token, body: { name: "Tab", platform: "android" } });
    now = new Date("2031-05-02T00:00:00Z");
    await t.call("GET", "/v1/me", { token: u.token });
    const list = await t.call("GET", "/v1/devices", { token: u.token });
    expect(list.json.devices[0].id).toBe(d.json.device.id);
    expect(list.json.devices[0].lastSeenAt).toBe("2031-05-02T00:00:00.000Z");
  });
});
