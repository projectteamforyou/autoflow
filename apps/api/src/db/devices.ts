/** Registered devices (one per app install). Deleting a device revokes its sessions (FK cascade). */
import type { Db } from "./client.js";

export const DEVICE_PLATFORMS = ["windows", "android", "web", "macos", "linux", "ios", "other"] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export interface Device {
  id: string;
  userId: string;
  name: string;
  platform: DevicePlatform;
  appVersion: string | null;
  createdAt: Date;
  lastSeenAt: Date;
}

interface DeviceRow {
  id: string;
  user_id: string;
  name: string;
  platform: DevicePlatform;
  app_version: string | null;
  created_at: Date;
  last_seen_at: Date;
}

const mapDevice = (r: DeviceRow): Device => ({
  id: r.id,
  userId: r.user_id,
  name: r.name,
  platform: r.platform,
  appVersion: r.app_version,
  createdAt: r.created_at,
  lastSeenAt: r.last_seen_at,
});

export async function countDevices(db: Db, userId: string): Promise<number> {
  const [r] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM devices WHERE user_id = ${userId}`;
  return r!.n;
}

export async function insertDevice(db: Db, d: { userId: string; name: string; platform: DevicePlatform; appVersion: string | null }): Promise<Device> {
  const rows = await db<DeviceRow[]>`
    INSERT INTO devices (user_id, name, platform, app_version)
    VALUES (${d.userId}, ${d.name}, ${d.platform}, ${d.appVersion})
    RETURNING *`;
  return mapDevice(rows[0]!);
}

export async function updateDevice(db: Db, userId: string, id: string, p: { name?: string; appVersion?: string | null }): Promise<Device | null> {
  const rows = await db<DeviceRow[]>`
    UPDATE devices SET
      name = COALESCE(${p.name ?? null}, name),
      app_version = CASE WHEN ${p.appVersion !== undefined} THEN ${p.appVersion ?? null} ELSE app_version END
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING *`;
  return rows[0] ? mapDevice(rows[0]) : null;
}

export async function listDevices(db: Db, userId: string): Promise<Device[]> {
  const rows = await db<DeviceRow[]>`SELECT * FROM devices WHERE user_id = ${userId} ORDER BY last_seen_at DESC, created_at DESC`;
  return rows.map(mapDevice);
}

export async function findDevice(db: Db, userId: string, id: string): Promise<Device | null> {
  const rows = await db<DeviceRow[]>`SELECT * FROM devices WHERE id = ${id} AND user_id = ${userId}`;
  return rows[0] ? mapDevice(rows[0]) : null;
}

export async function deleteDevice(db: Db, userId: string, id: string): Promise<boolean> {
  const rows = await db`DELETE FROM devices WHERE id = ${id} AND user_id = ${userId} RETURNING id`;
  return rows.length === 1;
}

export async function bindSessionToDevice(db: Db, sessionId: string, deviceId: string): Promise<void> {
  await db`UPDATE sessions SET device_id = ${deviceId} WHERE id = ${sessionId}`;
}
