/** Atlas community templates, ratings, reports and installs. */
import type { Flow } from "@autoflow/core";
import type { Db } from "./client.js";

export type TemplateStatus = "published" | "pending_review" | "hidden" | "removed";
export type RiskLevel = "low" | "medium" | "high";
export const REPORT_REASONS = ["spam", "malicious", "cheating", "inappropriate", "copyright", "broken", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export interface AtlasTemplate {
  id: string;
  authorId: string;
  authorName: string | null;
  name: string;
  description: string;
  category: string;
  locale: string;
  platforms: string[];
  contentHash: string;
  riskLevel: RiskLevel;
  riskScore: number;
  permissions: string[];
  status: TemplateStatus;
  installs: number;
  ratingAverage: number | null;
  ratingCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AtlasTemplateWithFlow extends AtlasTemplate {
  flow: Flow;
}

interface TemplateRow {
  id: string;
  author_id: string;
  author_name: string | null;
  name: string;
  description: string;
  category: string;
  locale: string;
  platforms: string[];
  content_hash: string;
  risk_level: RiskLevel;
  risk_score: number;
  permissions: string[];
  status: TemplateStatus;
  installs: string;
  rating_sum: number;
  rating_count: number;
  created_at: Date;
  updated_at: Date;
  flow?: Flow;
}

const mapTemplate = (r: TemplateRow): AtlasTemplate => ({
  id: r.id,
  authorId: r.author_id,
  authorName: r.author_name,
  name: r.name,
  description: r.description,
  category: r.category,
  locale: r.locale,
  platforms: r.platforms,
  contentHash: r.content_hash,
  riskLevel: r.risk_level,
  riskScore: r.risk_score,
  permissions: r.permissions,
  status: r.status,
  installs: Number(r.installs),
  ratingAverage: r.rating_count > 0 ? Math.round((r.rating_sum / r.rating_count) * 100) / 100 : null,
  ratingCount: r.rating_count,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface NewTemplate {
  id: string;
  authorId: string;
  name: string;
  description: string;
  category: string;
  locale: string;
  platforms: string[];
  flow: Flow;
  contentHash: string;
  riskLevel: RiskLevel;
  riskScore: number;
  permissions: string[];
  status: TemplateStatus;
}

/** Returns null when the author already published identical content. */
export async function insertTemplate(db: Db, t: NewTemplate): Promise<AtlasTemplate | null> {
  const rows = await db<TemplateRow[]>`
    INSERT INTO atlas_templates (id, author_id, name, description, category, locale, platforms, flow, content_hash, risk_level, risk_score, permissions, status)
    VALUES (${t.id}, ${t.authorId}, ${t.name}, ${t.description}, ${t.category}, ${t.locale}, ${t.platforms}, ${db.json(t.flow as never)},
            ${t.contentHash}, ${t.riskLevel}, ${t.riskScore}, ${t.permissions}, ${t.status})
    ON CONFLICT (author_id, content_hash) DO NOTHING
    RETURNING *, NULL::text AS author_name`;
  return rows[0] ? mapTemplate(rows[0]) : null;
}

export async function countAuthorTemplates(db: Db, authorId: string): Promise<number> {
  const [r] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM atlas_templates WHERE author_id = ${authorId}`;
  return r!.n;
}

export type SortKey = "popular" | "new" | "rating";

export interface SearchQuery {
  q?: string;
  category?: string;
  platform?: string;
  sort: SortKey;
  limit: number;
  offset: number;
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export async function searchTemplates(db: Db, s: SearchQuery): Promise<{ items: AtlasTemplate[]; total: number }> {
  const q = s.q?.trim() || null;
  const like = q ? `%${escapeLike(q)}%` : null;
  // Bayesian average (prior: 5 votes of 3.5 stars) so one 5-star vote does not top the chart.
  const order =
    s.sort === "new"
      ? db`t.created_at DESC, t.id`
      : s.sort === "rating"
        ? db`(t.rating_sum + 17.5) / (t.rating_count + 5) DESC, t.rating_count DESC, t.id`
        : db`t.installs DESC, t.created_at DESC, t.id`;
  const rows = await db<(TemplateRow & { total: number })[]>`
    SELECT t.id, t.author_id, u.display_name AS author_name, t.name, t.description, t.category, t.locale, t.platforms,
           t.content_hash, t.risk_level, t.risk_score, t.permissions, t.status, t.installs, t.rating_sum, t.rating_count,
           t.created_at, t.updated_at, count(*) OVER ()::int AS total
    FROM atlas_templates t JOIN users u ON u.id = t.author_id
    WHERE t.status = 'published'
      AND (${s.category ?? null}::text IS NULL OR t.category = ${s.category ?? null})
      AND (${s.platform ?? null}::text IS NULL OR ${s.platform ?? null} = ANY (t.platforms))
      AND (${q}::text IS NULL OR t.search @@ websearch_to_tsquery('simple', ${q}) OR t.name ILIKE ${like} OR t.description ILIKE ${like})
    ORDER BY ${order}
    LIMIT ${s.limit} OFFSET ${s.offset}`;
  return { items: rows.map(mapTemplate), total: rows[0]?.total ?? 0 };
}

export async function getTemplate(db: Db, id: string): Promise<AtlasTemplateWithFlow | null> {
  const rows = await db<TemplateRow[]>`
    SELECT t.*, u.display_name AS author_name FROM atlas_templates t JOIN users u ON u.id = t.author_id WHERE t.id = ${id}`;
  const r = rows[0];
  return r ? { ...mapTemplate(r), flow: r.flow as Flow } : null;
}

export async function listAuthorTemplates(db: Db, authorId: string): Promise<AtlasTemplate[]> {
  const rows = await db<TemplateRow[]>`
    SELECT t.*, u.display_name AS author_name FROM atlas_templates t JOIN users u ON u.id = t.author_id
    WHERE t.author_id = ${authorId} ORDER BY t.created_at DESC`;
  return rows.map(mapTemplate);
}

export async function listAuthorTemplatesWithFlow(db: Db, authorId: string): Promise<AtlasTemplateWithFlow[]> {
  const rows = await db<TemplateRow[]>`
    SELECT t.*, u.display_name AS author_name FROM atlas_templates t JOIN users u ON u.id = t.author_id
    WHERE t.author_id = ${authorId} ORDER BY t.created_at DESC`;
  return rows.map((r) => ({ ...mapTemplate(r), flow: r.flow as Flow }));
}

export async function deleteTemplate(db: Db, id: string, authorId: string): Promise<boolean> {
  const rows = await db`DELETE FROM atlas_templates WHERE id = ${id} AND author_id = ${authorId} RETURNING id`;
  return rows.length === 1;
}

export async function setTemplateStatus(db: Db, id: string, status: TemplateStatus): Promise<boolean> {
  const rows = await db`UPDATE atlas_templates SET status = ${status}, updated_at = now() WHERE id = ${id} RETURNING id`;
  return rows.length === 1;
}

/** Counts an install once per signed-in user; anonymous installs always count. Returns the new total. */
export async function recordInstall(db: Db, id: string, userId: string | null): Promise<number | null> {
  if (userId) {
    const inserted = await db`
      INSERT INTO atlas_installs (template_id, user_id) VALUES (${id}, ${userId})
      ON CONFLICT DO NOTHING RETURNING template_id`;
    if (inserted.length === 0) {
      const [r] = await db<{ installs: string }[]>`SELECT installs FROM atlas_templates WHERE id = ${id}`;
      return r ? Number(r.installs) : null;
    }
  }
  const rows = await db<{ installs: string }[]>`UPDATE atlas_templates SET installs = installs + 1 WHERE id = ${id} RETURNING installs`;
  return rows[0] ? Number(rows[0].installs) : null;
}

export async function upsertRating(db: Db, templateId: string, userId: string, stars: number): Promise<{ ratingAverage: number | null; ratingCount: number }> {
  await db`
    INSERT INTO atlas_ratings (template_id, user_id, stars) VALUES (${templateId}, ${userId}, ${stars})
    ON CONFLICT (template_id, user_id) DO UPDATE SET stars = EXCLUDED.stars, updated_at = now()`;
  const [r] = await db<{ rating_sum: number; rating_count: number }[]>`SELECT rating_sum, rating_count FROM atlas_templates WHERE id = ${templateId}`;
  return { ratingAverage: r && r.rating_count > 0 ? Math.round((r.rating_sum / r.rating_count) * 100) / 100 : null, ratingCount: r?.rating_count ?? 0 };
}

export async function getUserRating(db: Db, templateId: string, userId: string): Promise<number | null> {
  const [r] = await db<{ stars: number }[]>`SELECT stars FROM atlas_ratings WHERE template_id = ${templateId} AND user_id = ${userId}`;
  return r?.stars ?? null;
}

/** Insert a report; returns false if this user already reported the template. */
export async function insertReport(db: Db, r: { templateId: string; reporterId: string; reason: ReportReason; details: string }): Promise<boolean> {
  const rows = await db`
    INSERT INTO atlas_reports (template_id, reporter_id, reason, details)
    VALUES (${r.templateId}, ${r.reporterId}, ${r.reason}, ${r.details})
    ON CONFLICT (template_id, reporter_id) DO NOTHING RETURNING id`;
  return rows.length === 1;
}

export async function countPendingReports(db: Db, templateId: string): Promise<number> {
  const [r] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM atlas_reports WHERE template_id = ${templateId} AND status = 'pending'`;
  return r!.n;
}

export async function resolveReports(db: Db, templateId: string, status: "dismissed" | "actioned"): Promise<void> {
  await db`UPDATE atlas_reports SET status = ${status}, resolved_at = now() WHERE template_id = ${templateId} AND status = 'pending'`;
}

export interface ModerationEntry {
  template: AtlasTemplate;
  pendingReports: number;
  reasons: Record<string, number>;
}

/** Hidden / pending-review templates and templates with pending reports, most reported first. */
export async function moderationQueue(db: Db, limit: number): Promise<ModerationEntry[]> {
  const rows = await db<(TemplateRow & { pending: number; reasons: Record<string, number> | null })[]>`
    SELECT t.id, t.author_id, u.display_name AS author_name, t.name, t.description, t.category, t.locale, t.platforms,
           t.content_hash, t.risk_level, t.risk_score, t.permissions, t.status, t.installs, t.rating_sum, t.rating_count,
           t.created_at, t.updated_at,
           COALESCE(r.pending, 0)::int AS pending, r.reasons
    FROM atlas_templates t
    JOIN users u ON u.id = t.author_id
    LEFT JOIN (
      SELECT template_id, count(*) AS pending, jsonb_object_agg(reason, n) AS reasons
      FROM (SELECT template_id, reason, count(*) AS n FROM atlas_reports WHERE status = 'pending' GROUP BY template_id, reason) x
      GROUP BY template_id
    ) r ON r.template_id = t.id
    WHERE t.status IN ('hidden', 'pending_review') OR r.pending > 0
    ORDER BY COALESCE(r.pending, 0) DESC, t.created_at ASC
    LIMIT ${limit}`;
  return rows.map((r) => ({ template: mapTemplate(r), pendingReports: r.pending, reasons: r.reasons ?? {} }));
}

export async function listUserRatings(db: Db, userId: string): Promise<{ templateId: string; stars: number; updatedAt: Date }[]> {
  const rows = await db<{ template_id: string; stars: number; updated_at: Date }[]>`
    SELECT template_id, stars, updated_at FROM atlas_ratings WHERE user_id = ${userId} ORDER BY updated_at DESC`;
  return rows.map((r) => ({ templateId: r.template_id, stars: r.stars, updatedAt: r.updated_at }));
}

export async function listUserReports(db: Db, userId: string): Promise<{ templateId: string; reason: string; details: string; status: string; createdAt: Date }[]> {
  const rows = await db<{ template_id: string; reason: string; details: string; status: string; created_at: Date }[]>`
    SELECT template_id, reason, details, status, created_at FROM atlas_reports WHERE reporter_id = ${userId} ORDER BY created_at DESC`;
  return rows.map((r) => ({ templateId: r.template_id, reason: r.reason, details: r.details, status: r.status, createdAt: r.created_at }));
}

export async function listUserInstalls(db: Db, userId: string): Promise<{ templateId: string; createdAt: Date }[]> {
  const rows = await db<{ template_id: string; created_at: Date }[]>`SELECT template_id, created_at FROM atlas_installs WHERE user_id = ${userId} ORDER BY created_at DESC`;
  return rows.map((r) => ({ templateId: r.template_id, createdAt: r.created_at }));
}
