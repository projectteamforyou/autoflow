/** Anonymous public counters: cumulative visits, people online now, downloads. */
import type { Db } from "./client.js";

export type Surface = "site" | "app" | "windows" | "android";
export type DownloadPlatform = "windows" | "android";

/** A session counts as online if it pinged within this window (clients ping every 60 s). */
export const ONLINE_WINDOW_SECONDS = 150;

export async function increment(db: Db, key: string, by = 1): Promise<void> {
  await db`
    WITH c AS (
      INSERT INTO stats_counters (key, value) VALUES (${key}, ${by})
      ON CONFLICT (key) DO UPDATE SET value = stats_counters.value + ${by}
    )
    INSERT INTO stats_daily (day, key, value) VALUES ((now() AT TIME ZONE 'utc')::date, ${key}, ${by})
    ON CONFLICT (day, key) DO UPDATE SET value = stats_daily.value + ${by}`;
}

export async function touchPresence(db: Db, sessionId: string, surface: Surface): Promise<void> {
  await db`
    INSERT INTO stats_presence (session_id, surface, last_seen) VALUES (${sessionId}, ${surface}, now())
    ON CONFLICT (session_id) DO UPDATE SET last_seen = now(), surface = EXCLUDED.surface`;
}

export async function leave(db: Db, sessionId: string): Promise<void> {
  await db`DELETE FROM stats_presence WHERE session_id = ${sessionId}`;
}

export interface Snapshot {
  visitsTotal: number;
  onlineNow: number;
  onlineBySurface: Record<Surface, number>;
  downloads: { windows: number; android: number; total: number };
  today: { visits: number; downloads: number };
}

export async function snapshot(db: Db): Promise<Snapshot> {
  const [counters, online, today] = await Promise.all([
    db<{ key: string; value: string }[]>`SELECT key, value FROM stats_counters`,
    db<{ surface: Surface; n: string }[]>`SELECT surface, count(*) AS n FROM stats_presence WHERE last_seen > now() - make_interval(secs => ${ONLINE_WINDOW_SECONDS}) GROUP BY surface`,
    db<{ key: string; value: string }[]>`SELECT key, value FROM stats_daily WHERE day = (now() AT TIME ZONE 'utc')::date`,
  ]);
  const c = Object.fromEntries(counters.map((r) => [r.key, Number(r.value)]));
  const d = Object.fromEntries(today.map((r) => [r.key, Number(r.value)]));
  const bySurface: Record<Surface, number> = { site: 0, app: 0, windows: 0, android: 0 };
  for (const r of online) bySurface[r.surface] = Number(r.n);
  const win = c.downloads_windows ?? 0;
  const and = c.downloads_android ?? 0;
  return {
    visitsTotal: c.visits_total ?? 0,
    onlineNow: Object.values(bySurface).reduce((a, b) => a + b, 0),
    onlineBySurface: bySurface,
    downloads: { windows: win, android: and, total: win + and },
    today: { visits: d.visits_total ?? 0, downloads: (d.downloads_windows ?? 0) + (d.downloads_android ?? 0) },
  };
}

export async function purgeStalePresence(db: Db): Promise<number> {
  const r = await db`DELETE FROM stats_presence WHERE last_seen < now() - interval '1 day'`;
  return r.count;
}
