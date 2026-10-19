/** /v1/atlas — official templates (read-only, from @autoflow/core) and community templates. */
import { Hono } from "hono";
import { z } from "zod";
import { PLATFORMS, TEMPLATE_CATEGORIES, type TemplateCategory } from "@autoflow/core";
import type { AppEnv } from "../deps.js";
import { errors } from "../errors.js";
import { base62Param, enforce, parseJson, parseParams, parseQuery, requireAdmin, requireAuth } from "../lib/http.js";
import { REPORT_REASONS } from "../db/atlas.js";
import * as atlas from "../services/atlas.js";
import { LocaleSchema } from "./auth.js";

const Category = z.enum(TEMPLATE_CATEGORIES as [TemplateCategory, ...TemplateCategory[]]);
const IdParams = z.object({ id: base62Param });

const ListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category: Category.optional(),
  platform: z.enum(PLATFORMS).optional(),
  sort: z.enum(["popular", "new", "rating"]).default("popular"),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

const PublishBody = z.object({ flow: z.record(z.unknown()), category: Category, locale: LocaleSchema.optional() });
const RatingBody = z.object({ stars: z.number().int().min(1).max(5) });
const ReportBody = z.object({ reason: z.enum(REPORT_REASONS), details: z.string().trim().max(1000).default("") });
const ModerateBody = z.object({ action: z.enum(["approve", "remove"]) });

export function atlasRoutes() {
  const r = new Hono<AppEnv>();

  r.get("/categories", (c) => {
    c.header("Cache-Control", "public, max-age=3600");
    return c.json({ categories: TEMPLATE_CATEGORIES });
  });

  r.get("/official", (c) => {
    c.header("Cache-Control", "public, max-age=300");
    return c.json({ templates: atlas.official().list });
  });

  r.get("/official/:id", (c) => {
    const id = c.req.param("id");
    const tpl = atlas.official().byId.get(id);
    const summary = atlas.official().list.find((t) => t.id === id);
    if (!tpl || !summary) throw errors.notFound("Template");
    c.header("Cache-Control", "public, max-age=300");
    return c.json({ template: { ...summary, flow: tpl.flow } });
  });

  r.get("/templates", async (c) => {
    const q = parseQuery(c, ListQuery);
    const { items, total } = await atlas.search(c.get("deps"), {
      q: q.q,
      category: q.category,
      platform: q.platform,
      sort: q.sort,
      limit: q.pageSize,
      offset: (q.page - 1) * q.pageSize,
    });
    return c.json({ templates: items.map(atlas.toSummaryDto), page: q.page, pageSize: q.pageSize, total });
  });

  r.post("/templates", async (c) => {
    const a = requireAuth(c);
    const deps = c.get("deps");
    await enforce(deps.limiters.publish, `publish:${a.user.id}`);
    const body = await parseJson(c, PublishBody);
    const { template, warnings } = await atlas.publish(deps, a, body);
    const full = await atlas.get(deps, template.id, a);
    return c.json({ template: atlas.toDetailDto(full), warnings }, 201);
  });

  r.get("/templates/mine", async (c) => {
    const list = await atlas.mine(c.get("deps"), requireAuth(c));
    return c.json({ templates: list.map(atlas.toSummaryDto) });
  });

  r.get("/templates/:id", async (c) => {
    const { id } = parseParams(c, IdParams);
    const t = await atlas.get(c.get("deps"), id, c.get("auth"));
    return c.json({ template: atlas.toDetailDto(t) });
  });

  r.delete("/templates/:id", async (c) => {
    const a = requireAuth(c);
    const { id } = parseParams(c, IdParams);
    await atlas.unpublish(c.get("deps"), a, id);
    return c.body(null, 204);
  });

  r.post("/templates/:id/install", async (c) => {
    const deps = c.get("deps");
    const { id } = parseParams(c, IdParams);
    const viewer = c.get("auth");
    await enforce(deps.limiters.install, viewer ? `install:u:${viewer.user.id}` : `install:ip:${c.get("clientIp")}`);
    const result = await atlas.install(deps, id, viewer);
    return c.json(result);
  });

  r.get("/templates/:id/rating", async (c) => {
    const a = requireAuth(c);
    const { id } = parseParams(c, IdParams);
    return c.json({ stars: await atlas.myRating(c.get("deps"), a, id) });
  });

  r.put("/templates/:id/rating", async (c) => {
    const a = requireAuth(c);
    const { id } = parseParams(c, IdParams);
    const { stars } = await parseJson(c, RatingBody);
    return c.json(await atlas.rate(c.get("deps"), a, id, stars));
  });

  r.post("/templates/:id/reports", async (c) => {
    const a = requireAuth(c);
    const deps = c.get("deps");
    await enforce(deps.limiters.publish, `report:${a.user.id}`);
    const { id } = parseParams(c, IdParams);
    const body = await parseJson(c, ReportBody);
    await atlas.report(deps, a, id, body.reason, body.details);
    // The reporter is not told whether the template got hidden (avoids gaming the threshold).
    return c.json({ received: true }, 202);
  });

  return r;
}

/** /v1/admin/atlas — moderation queue for accounts with role=admin. */
export function adminAtlasRoutes() {
  const r = new Hono<AppEnv>();

  r.get("/queue", async (c) => {
    requireAdmin(c);
    const { limit } = parseQuery(c, z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }));
    const queue = await atlas.moderationQueue(c.get("deps"), limit);
    return c.json({ queue: queue.map((e) => ({ template: atlas.toSummaryDto(e.template), pendingReports: e.pendingReports, reasons: e.reasons })) });
  });

  r.post("/templates/:id/moderate", async (c) => {
    const a = requireAdmin(c);
    const { id } = parseParams(c, IdParams);
    const { action } = await parseJson(c, ModerateBody);
    await atlas.moderate(c.get("deps"), a, id, action);
    return c.json({ ok: true });
  });

  return r;
}
