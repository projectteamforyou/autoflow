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

/**
 * The download URLs above never change between releases, so a browser that fetched an older build can hand it back
 * from its cache. The redirect carries the current release version (from latest.json) to make each release's URL unique.
 */
const LATEST_URL = "https://dl.autoflowmacro.com/latest.json";
const VERSION_TTL_MS = 5 * 60_000;
let latest: { at: number; version: string | null } | null = null;
let refreshing: Promise<string | null> | null = null;

/** One fetch at a time; a failure keeps the last known version (the redirect still works without one). */
function refreshLatestVersion(now: number): Promise<string | null> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    let version: string | null = latest?.version ?? null;
    try {
      const res = await fetch(LATEST_URL, { signal: AbortSignal.timeout(2_000) });
      const body = (await res.json()) as { version?: unknown };
      if (res.ok && typeof body.version === "string" && /^\d+\.\d+\.\d+$/.test(body.version)) version = body.version;
    } catch {
      // Keep the last known version.
    }
    latest = { at: now, version };
    return version;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/**
 * Stale-while-revalidate: only the very first download waits for latest.json; afterwards the
 * last known version is returned at once and refreshed in the background once the TTL passed.
 */
/** For the public counters: never waits on latest.json — null until the first refresh has landed. */
function peekLatestVersion(now: number): string | null {
  if (!latest || now - latest.at >= VERSION_TTL_MS) void refreshLatestVersion(now);
  return latest?.version ?? null;
}

async function latestVersion(now: number): Promise<string | null> {
  if (!latest) return refreshLatestVersion(now);
  if (now - latest.at >= VERSION_TTL_MS) void refreshLatestVersion(now);
  return latest.version;
}

export async function downloadTarget(platform: stats.DownloadPlatform, now = Date.now()): Promise<string> {
  const v = platform === "windows" ? await latestVersion(now) : null;
  return v ? `${DOWNLOAD_TARGETS[platform]}?v=${v}` : DOWNLOAD_TARGETS[platform];
}

const Sid = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

/**
 * Short cache so a busy site doesn't hit the database on every page view. Hits, leaves and
 * downloads deliberately do not invalidate it: on a busy site that would mean a query per view.
 */
let cached: { at: number; value: stats.Snapshot } | null = null;
const CACHE_MS = 10_000;

export function statsRoutes() {
  const r = new Hono<AppEnv>();

  r.get("/", async (c) => {
    const deps = c.get("deps");
    const now = deps.now().getTime();
    if (!cached || now - cached.at > CACHE_MS) cached = { at: now, value: await stats.snapshot(deps.sql) };
    c.header("Cache-Control", "public, max-age=10");
    // The site shows the current Windows version next to its download button; same cached latest.json as the redirect.
    return c.json({ ...cached.value, updatedAt: new Date(cached.at).toISOString(), windowsVersion: peekLatestVersion(now) });
  });

  r.post("/hit", async (c) => {
    const deps = c.get("deps");
    await enforce(deps.limiters.stats, `stats:${c.get("clientIp")}`);
    const body = await parseJson(c, z.object({ sid: Sid, surface: z.enum(["site", "app", "windows", "android"]), newVisit: z.boolean().default(false) }));
    if (body.newVisit) await stats.increment(deps.sql, "visits_total");
    await stats.touchPresence(deps.sql, body.sid, body.surface);
    return c.body(null, 204);
  });

  r.post("/leave", async (c) => {
    const deps = c.get("deps");
    await enforce(deps.limiters.stats, `stats:${c.get("clientIp")}`);
    const raw = await c.req.text();
    const parsed = z.object({ sid: Sid }).safeParse(safeJson(raw));
    if (parsed.success) await stats.leave(deps.sql, parsed.data.sid);
    return c.body(null, 204);
  });

  r.get("/download/:platform", async (c) => {
    const deps = c.get("deps");
    const { platform } = parseParams(c, z.object({ platform: z.enum(["windows", "android"]) }));
    // Counting is best-effort and rate-limited; the redirect always happens. Hono answers HEAD
    // with the GET handler, and a HEAD (link checkers, download managers probing) is not a download.
    const ok = c.req.method !== "HEAD" && (await Promise.resolve(deps.limiters.stats.consume(`dl:${c.get("clientIp")}`)).then((x) => x.allowed).catch(() => false));
    if (ok) await stats.increment(deps.sql, `downloads_${platform}`).catch(() => undefined);
    c.header("Cache-Control", "no-store");
    return c.redirect(await downloadTarget(platform, deps.now().getTime()), 302);
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
