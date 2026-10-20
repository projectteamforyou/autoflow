/** Device registry. Registering binds the calling session to the device; revoking signs it out. */
import { ApiError, errors } from "../errors.js";
import type { AppDeps, AuthContext } from "../deps.js";
import * as devices from "../db/devices.js";
import type { Device, DevicePlatform } from "../db/devices.js";
import { lockUser } from "../db/users.js";

export interface DeviceDto {
  id: string;
  name: string;
  platform: DevicePlatform;
  appVersion: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export function toDeviceDto(d: Device, currentDeviceId: string | null): DeviceDto {
  return {
    id: d.id,
    name: d.name,
    platform: d.platform,
    appVersion: d.appVersion,
    createdAt: d.createdAt.toISOString(),
    lastSeenAt: d.lastSeenAt.toISOString(),
    current: d.id === currentDeviceId,
  };
}

export async function register(deps: AppDeps, auth: AuthContext, input: { name: string; platform: DevicePlatform; appVersion?: string | null }): Promise<Device> {
  return deps.sql.begin(async (tx) => {
    await lockUser(tx, auth.user.id);
    // Re-registering from an already bound session updates that device instead of adding one.
    if (auth.session.deviceId) {
      const existing = await devices.updateDevice(tx, auth.user.id, auth.session.deviceId, { name: input.name, appVersion: input.appVersion ?? null });
      if (existing) return existing;
    }
    if ((await devices.countDevices(tx, auth.user.id)) >= deps.config.limits.devices.maxPerUser) {
      throw new ApiError(403, "quota_exceeded", `Device limit reached (${deps.config.limits.devices.maxPerUser}); revoke an old device first`);
    }
    const d = await devices.insertDevice(tx, { userId: auth.user.id, name: input.name, platform: input.platform, appVersion: input.appVersion ?? null });
    await devices.bindSessionToDevice(tx, auth.session.id, d.id);
    auth.session.deviceId = d.id;
    return d;
  });
}

export async function list(deps: AppDeps, auth: AuthContext): Promise<Device[]> {
  return devices.listDevices(deps.sql, auth.user.id);
}

export async function rename(deps: AppDeps, auth: AuthContext, id: string, name: string): Promise<Device> {
  const d = await devices.updateDevice(deps.sql, auth.user.id, id, { name });
  if (!d) throw errors.notFound("Device");
  return d;
}

export async function revoke(deps: AppDeps, auth: AuthContext, id: string): Promise<void> {
  if (!(await devices.deleteDevice(deps.sql, auth.user.id, id))) throw errors.notFound("Device");
  deps.logger.info("device.revoked", { userId: auth.user.id, deviceId: id });
}
