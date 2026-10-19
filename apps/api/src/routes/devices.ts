/** /v1/devices — register, list, rename and revoke devices. */
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../deps.js";
import { parseJson, parseParams, requireAuth, uuidParam } from "../lib/http.js";
import { DEVICE_PLATFORMS } from "../db/devices.js";
import * as devices from "../services/devices.js";

const Name = z.string().trim().min(1).max(60);
const AppVersion = z.string().trim().regex(/^[0-9A-Za-z.+_-]{1,32}$/, "invalid version");
const RegisterBody = z.object({ name: Name, platform: z.enum(DEVICE_PLATFORMS), appVersion: AppVersion.nullish() });
const RenameBody = z.object({ name: Name });
const Params = z.object({ id: uuidParam });

export function deviceRoutes() {
  const r = new Hono<AppEnv>();

  r.get("/", async (c) => {
    const a = requireAuth(c);
    const list = await devices.list(c.get("deps"), a);
    return c.json({ devices: list.map((d) => devices.toDeviceDto(d, a.session.deviceId)) });
  });

  r.post("/", async (c) => {
    const a = requireAuth(c);
    const body = await parseJson(c, RegisterBody);
    const d = await devices.register(c.get("deps"), a, body);
    return c.json({ device: devices.toDeviceDto(d, a.session.deviceId) }, 201);
  });

  r.patch("/:id", async (c) => {
    const a = requireAuth(c);
    const { id } = parseParams(c, Params);
    const { name } = await parseJson(c, RenameBody);
    const d = await devices.rename(c.get("deps"), a, id, name);
    return c.json({ device: devices.toDeviceDto(d, a.session.deviceId) });
  });

  r.delete("/:id", async (c) => {
    const a = requireAuth(c);
    const { id } = parseParams(c, Params);
    await devices.revoke(c.get("deps"), a, id);
    return c.body(null, 204);
  });

  return r;
}
