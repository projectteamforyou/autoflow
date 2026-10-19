import { describe, expect, it } from "vitest";
import { makeApp, sampleFlow, useTestDb } from "./helpers.js";

const db = useTestDb();

describe("share links", () => {
  it("stores a sanitized, validated flow behind a 10-char base62 id", async () => {
    const t = makeApp(db);
    const flow = sampleFlow({ name: "Shared!", favorite: true, folder: "secret folder" });
    const r = await t.call("POST", "/v1/shares", { body: { flow } });
    expect(r.status).toBe(201);
    const s = r.json.share;
    expect(s.id).toMatch(/^[0-9A-Za-z]{10}$/);
    expect(s.url).toBe(`https://autoflow-651.pages.dev/s/${s.id}`);
    expect(s.flow.folder).toBeUndefined();
    expect(s.flow.favorite).toBe(false);
    expect(s.risk.level).toBe("low");
    expect(s.expiresAt).toBeNull();
    expect(s.owned).toBe(false);

    const got = await t.call("GET", `/v1/shares/${s.id}`);
    expect(got.status).toBe(200);
    expect(got.json.share.flow.name).toBe("Shared!");
    expect(got.json.share.contentHash).toBe(s.contentHash);
    expect(got.json.share.views).toBe(1);
    expect((await t.call("GET", `/v1/shares/${s.id}`)).json.share.views).toBe(2);
  });

  it("rejects invalid and lint-error flows and oversize bodies", async () => {
    const t = makeApp(db, { limits: { shares: { maxFlowBytes: 2048 } } });
    expect((await t.call("POST", "/v1/shares", { body: { flow: { name: "x" } } })).json.error.code).toBe("invalid_flow");
    expect((await t.call("POST", "/v1/shares", { body: { flow: sampleFlow({ steps: [{ id: "b", type: "break" }] }) } })).json.error.code).toBe("lint_failed");
    const big = await t.call("POST", "/v1/shares", { body: { flow: sampleFlow({ description: "x".repeat(3000) }) } });
    expect(big.status).toBe(413);
    expect((await t.call("POST", "/v1/shares", { body: { flow: sampleFlow(), expiresInDays: 0 } })).status).toBe(400);
    expect((await t.call("POST", "/v1/shares", { body: { flow: "nope" } })).status).toBe(400);
  });

  it("expires links and lets owners list and delete them", async () => {
    let now = new Date("2032-01-01T00:00:00Z");
    const t = makeApp(db, { now: () => now });
    const u = await t.signup();
    const other = await t.signup();
    const r = await t.call("POST", "/v1/shares", { token: u.token, body: { flow: sampleFlow({ name: "Temp" }), expiresInDays: 7 } });
    expect(r.json.share.owned).toBe(true);
    expect(r.json.share.expiresAt).toBe("2032-01-08T00:00:00.000Z");
    const id = r.json.share.id;

    expect((await t.call("GET", "/v1/shares/mine", { token: u.token })).json.shares.map((s: { id: string }) => s.id)).toEqual([id]);
    now = new Date("2032-01-07T23:59:00Z");
    expect((await t.call("GET", `/v1/shares/${id}`)).status).toBe(200);
    now = new Date("2032-01-08T00:00:01Z");
    expect((await t.call("GET", `/v1/shares/${id}`)).status).toBe(404);

    const keep = (await t.call("POST", "/v1/shares", { token: u.token, body: { flow: sampleFlow({ name: "Keep" }) } })).json.share.id;
    expect((await t.call("DELETE", `/v1/shares/${keep}`, { token: other.token })).status).toBe(404);
    expect((await t.call("DELETE", `/v1/shares/${keep}`, { token: u.token })).status).toBe(204);
    expect((await t.call("GET", `/v1/shares/${keep}`)).status).toBe(404);
    expect((await t.call("GET", "/v1/shares/short")).status).toBe(404);
  });

  it("rate-limits anonymous share creation per IP", async () => {
    const t = makeApp(db, { limits: { rate: { shareIp: { capacity: 1, refillPerMinute: 1 } } } });
    expect((await t.call("POST", "/v1/shares", { body: { flow: sampleFlow() }, ip: "198.51.100.200" })).status).toBe(201);
    expect((await t.call("POST", "/v1/shares", { body: { flow: sampleFlow() }, ip: "198.51.100.200" })).status).toBe(429);
  });
});
