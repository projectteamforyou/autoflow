import { describe, expect, it } from "vitest";
import { makeApp, useTestDb } from "./helpers.js";

const db = useTestDb();

describe("public stats", () => {
  it("counts visits once per new session, online tabs, leaves and downloads", async () => {
    const t = makeApp(db);
    const sid = (n: number) => `tab_${String(n).padStart(16, "0")}`;
    expect((await t.call("POST", "/v1/stats/hit", { body: { sid: sid(1), surface: "site", newVisit: true } })).status).toBe(204);
    await t.call("POST", "/v1/stats/hit", { body: { sid: sid(1), surface: "site", newVisit: false } });
    await t.call("POST", "/v1/stats/hit", { body: { sid: sid(2), surface: "app", newVisit: true } });
    let s = (await t.call("GET", "/v1/stats")).json;
    expect(s.visitsTotal).toBe(2);
    expect(s.onlineNow).toBe(2);
    expect(s.onlineBySurface).toMatchObject({ site: 1, app: 1 });

    expect((await t.call("POST", "/v1/stats/leave", { body: { sid: sid(2) } })).status).toBe(204);
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ version: "9.8.7" }), { status: 200 })) as typeof fetch;
    const dl = await t.call("GET", "/v1/stats/download/windows").finally(() => (globalThis.fetch = realFetch));
    expect(dl.status).toBe(302);
    expect(dl.headers.get("location")).toBe("https://dl.autoflowmacro.com/windows/AutoFlow-Setup-x64.exe?v=9.8.7");
    await t.call("GET", "/v1/stats/download/android");
    s = (await t.call("GET", "/v1/stats")).json;
    expect(s.onlineNow).toBe(1);
    expect(s.downloads).toEqual({ windows: 1, android: 1, total: 2 });
    expect(s.today.visits).toBe(2);
  });

  it("rejects bad input and unknown download targets", async () => {
    const t = makeApp(db);
    expect((await t.call("POST", "/v1/stats/hit", { body: { sid: "short", surface: "site" } })).status).toBe(400);
    expect((await t.call("POST", "/v1/stats/hit", { body: { sid: "x".repeat(20), surface: "evil" } })).status).toBe(400);
    expect([400, 404]).toContain((await t.call("GET", "/v1/stats/download/linux")).status);
  });
});
