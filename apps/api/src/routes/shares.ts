/** /v1/shares — short links for sanitized, validated flows. */
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../deps.js";
import { base62Param, enforce, parseJson, parseParams, requireAuth } from "../lib/http.js";
import * as shares from "../services/shares.js";

const IdParams = z.object({ id: base62Param });

export function shareRoutes() {
  const r = new Hono<AppEnv>();

  r.post("/", async (c) => {
    const deps = c.get("deps");
    const viewer = c.get("auth");
    await enforce(deps.limiters.shareIp, viewer ? `share:u:${viewer.user.id}` : `share:ip:${c.get("clientIp")}`);
    const body = await parseJson(c, z.object({ flow: z.record(z.unknown()), expiresInDays: z.number().int().min(1).max(deps.config.limits.shares.maxExpiryDays).optional() }));
    const share = await shares.create(deps, viewer, body);
    return c.json({ share: shares.toShareDto(deps, share, viewer?.user.id) }, 201);
  });

  r.get("/mine", async (c) => {
    const a = requireAuth(c);
    const deps = c.get("deps");
    const list = await shares.mine(deps, a);
    return c.json({
      shares: list.map((s) => ({ id: s.id, name: s.flow.name, views: s.views, createdAt: s.createdAt.toISOString(), expiresAt: s.expiresAt?.toISOString() ?? null })),
    });
  });

  r.get("/:id", async (c) => {
    const deps = c.get("deps");
    const { id } = parseParams(c, IdParams);
    const share = await shares.view(deps, id);
    return c.json({ share: shares.toShareDto(deps, share, c.get("auth")?.user.id) });
  });

  r.delete("/:id", async (c) => {
    const a = requireAuth(c);
    const { id } = parseParams(c, IdParams);
    await shares.remove(c.get("deps"), a, id);
    return c.body(null, 204);
  });

  return r;
}
