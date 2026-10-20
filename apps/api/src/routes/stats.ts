/**
 * /v1/stats — public, anonymous counters shown on the website and in the apps.
 *   POST /hit            { sid, surface, newVisit } → counts a visit (once per browser session) and marks the tab online
 *   POST /leave          { sid }                    → removes the tab from "online now" (sent on page hide)
 *   GET  /               → { visitsTotal, onlineNow, downloads, today }
 *   GET  /download/:p    → counts a download and redirects to the official download page
 * Nothing personal is stored: no IP, no user id, no user agent — only a random id per tab.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../deps.js";
import { enforce, parseJson, parseParams } from "../lib/http.js";
import * as stats from "../db/stats.js";

export const DOWNLOAD_TARGETS: Record<stats.DownloadPlatform, string> = {
  windows: "https://dl.autoflowmacro.com/windows/AutoFlow-Setup-x64.exe",
  android: "https://dl.autoflowmacro.com/android/AutoFlow.apk",
};

const Sid = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

/** Short cache so a busy site doesn't hit the database on every page view. */
let cached: { at: number; value: stats.Snapshot } | null = null;
const CACHE_MS = 10_000;

export function statsRoutes() {
  const r = new Hono<AppEnv>();

  r.get("/", async (c) => {
    const deps = c.get("deps");
    if (!cached || Date.now() - cached.at > CACHE_MS) cached = { at: Date.now(), value: await stats.snapshot(deps.sql) };
    c.header("Cache-Control", "public, max-age=10");
    return c.json({ ...cached.value, updatedAt: new Date(cached.at).toISOString() });
  });

  r.post("/hit", async (c) => {
    const deps = c.get("deps");
    await enforce(deps.limiters.stats, `stats:${c.get("clientIp")}`);
    const body = await parseJson(c, z.object({ sid: Sid, surface: z.enum(["site", "app", "windows", "android"]), newVisit: z.boolean().default(false) }));
    if (body.newVisit) await stats.increment(deps.sql, "visits_total");
    await stats.touchPresence(deps.sql, body.sid, body.surface);
    cached = null;
    return c.body(null, 204);
  });

  r.post("/leave", async (c) => {
    const deps = c.get("deps");
    await enforce(deps.limiters.stats, `stats:${c.get("clientIp")}`);
    const raw = await c.req.text();
    const parsed = z.object({ sid: Sid }).safeParse(safeJson(raw));
    if (parsed.success) await stats.leave(deps.sql, parsed.data.sid);
    cached = null;
    return c.body(null, 204);
  });

  r.get("/download/:platform", async (c) => {
    const deps = c.get("deps");
    const { platform } = parseParams(c, z.object({ platform: z.enum(["windows", "android"]) }));
    // Counting is best-effort and rate-limited; the redirect always happens.
    const ok = await Promise.resolve(deps.limiters.stats.consume(`dl:${c.get("clientIp")}`)).then((x) => x.allowed).catch(() => false);
    if (ok) await stats.increment(deps.sql, `downloads_${platform}`).catch(() => undefined);
    cached = null;
    c.header("Cache-Control", "no-store");
    return c.redirect(DOWNLOAD_TARGETS[platform], 302);
  });

  return r;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
