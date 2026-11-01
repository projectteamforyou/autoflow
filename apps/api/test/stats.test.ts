import { describe, expect, it } from "vitest";
import { makeApp, useTestDb } from "./helpers.js";

const db = useTestDb();

const WINDOWS_EXE = "https://dl.autoflowmacro.com/windows/AutoFlow-Setup-x64.exe";

function clock(start: Date) {
  const c = { t: start, now: () => c.t, tick: (ms: number) => (c.t = new Date(c.t.getTime() + ms)) };
  return c;
}

/** latest.json is fetched with the global fetch (not deps.fetch); restore it after each use. */
async function withFetch<T>(impl: () => Response | Promise<Response>, run: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => impl()) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = realFetch;
  }
}

describe("public stats", () => {
  it("counts visits once per new session, online tabs, leaves and downloads — through a 10 s cache", async () => {
    const c = clock(new Date("2026-10-01T00:00:00Z"));
    const t = makeApp(db, { now: c.now });
    const sid = (n: number) => `tab_${String(n).padStart(16, "0")}`;
    expect((await t.call("POST", "/v1/stats/hit", { body: { sid: sid(1), surface: "site", newVisit: true } })).status).toBe(204);
    await t.call("POST", "/v1/stats/hit", { body: { sid: sid(1), surface: "site", newVisit: false } });
    await t.call("POST", "/v1/stats/hit", { body: { sid: sid(2), surface: "app", newVisit: true } });
    let s = (await withFetch(() => Response.json({ version: "9.8.7" }), () => t.call("GET", "/v1/stats"))).json;
    expect(s.visitsTotal).toBe(2);
    expect(s.onlineNow).toBe(2);
    expect(s.onlineBySurface).toMatchObject({ site: 1, app: 1 });

    expect((await t.call("POST", "/v1/stats/leave", { body: { sid: sid(2) } })).status).toBe(204);
    const dl = await withFetch(() => Response.json({ version: "9.8.7" }), () => t.call("GET", "/v1/stats/download/windows"));
    expect(dl.status).toBe(302);
    expect(dl.headers.get("location")).toBe(`${WINDOWS_EXE}?v=9.8.7`);
    // The site shows the same version next to its download button.
    expect((await t.call("GET", "/v1/stats")).json.windowsVersion).toBe("9.8.7");
    await t.call("GET", "/v1/stats/download/android");
    // A HEAD (link checker, download manager probe) redirects the same way but is not a download.
    const head = await t.call("HEAD", "/v1/stats/download/android");
    expect(head.status).toBe(302);
    expect(head.text).toBe("");

    // Hits, leaves and downloads do not flush the snapshot cache: within 10 s the old numbers are served...
    s = (await t.call("GET", "/v1/stats")).json;
    expect(s.onlineNow).toBe(2);
    expect(s.downloads.total).toBe(0);
    // ...and after it expires the real ones are.
    c.tick(10_001);
    s = (await t.call("GET", "/v1/stats")).json;
    expect(s.onlineNow).toBe(1);
    expect(s.downloads).toEqual({ windows: 1, android: 1, total: 2 });
    expect(s.today.visits).toBe(2);

    // Release version: served stale while a refresh runs in the background once the 5 min TTL passed.
    c.tick(6 * 60_000);
    const stale = await withFetch(() => Response.json({ version: "10.0.0" }), async () => {
      const r = await t.call("GET", "/v1/stats/download/windows");
      await new Promise((resolve) => setTimeout(resolve, 20));
      return r;
    });
    expect(stale.headers.get("location")).toBe(`${WINDOWS_EXE}?v=9.8.7`);
    expect((await t.call("GET", "/v1/stats/download/windows")).headers.get("location")).toBe(`${WINDOWS_EXE}?v=10.0.0`);
    // A failing refresh keeps the last known version.
    c.tick(6 * 60_000);
    await withFetch(() => Promise.reject(new Error("dns down")), async () => {
      await t.call("GET", "/v1/stats/download/windows");
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect((await t.call("GET", "/v1/stats/download/windows")).headers.get("location")).toBe(`${WINDOWS_EXE}?v=10.0.0`);
  });

  it("rejects bad input and unknown download targets", async () => {
    const t = makeApp(db);
    expect((await t.call("POST", "/v1/stats/hit", { body: { sid: "short", surface: "site" } })).status).toBe(400);
    expect((await t.call("POST", "/v1/stats/hit", { body: { sid: "x".repeat(20), surface: "evil" } })).status).toBe(400);
    expect([400, 404]).toContain((await t.call("GET", "/v1/stats/download/linux")).status);
  });
});
