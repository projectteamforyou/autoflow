/**
 * Atlas (plan §3.7): community templates are re-validated on the server with the same core
 * engine the apps use — parseFlow → sanitizeForSharing → lintFlow (no errors) → analyzeRisk —
 * and labelled with their risk level and permissions. High-risk flows wait for moderator review;
 * enough user reports hide a template until a moderator looks at it.
 */
import { TEMPLATES, TEMPLATE_CATEGORIES, analyzeRisk, flowContentHash, lintFlow, parseFlow, sanitizeForSharing, type Flow, type RiskReport, type Template, type TemplateCategory } from "@autoflow/core";
import { ApiError, errors } from "../errors.js";
import type { AppDeps, AuthContext } from "../deps.js";
import * as atlas from "../db/atlas.js";
import type { AtlasTemplate, AtlasTemplateWithFlow, ReportReason, SearchQuery } from "../db/atlas.js";
import { base62Id } from "../lib/crypto.js";

export { TEMPLATE_CATEGORIES };

export interface TemplateSummaryDto {
  id: string;
  name: string;
  description: string;
  category: string;
  locale: string;
  platforms: string[];
  author: { name: string | null };
  risk: { level: atlas.RiskLevel; score: number; permissions: string[] };
  installs: number;
  rating: { average: number | null; count: number };
  status: atlas.TemplateStatus;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateDetailDto extends TemplateSummaryDto {
  flow: Flow;
  riskFindings: RiskReport["findings"];
  needsConfirm: boolean;
}

export function toSummaryDto(t: AtlasTemplate): TemplateSummaryDto {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    locale: t.locale,
    platforms: t.platforms,
    author: { name: t.authorName },
    risk: { level: t.riskLevel, score: t.riskScore, permissions: t.permissions },
    installs: t.installs,
    rating: { average: t.ratingAverage, count: t.ratingCount },
    status: t.status,
    contentHash: t.contentHash,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export function toDetailDto(t: AtlasTemplateWithFlow): TemplateDetailDto {
  const risk = analyzeRisk(t.flow);
  return { ...toSummaryDto(t), flow: t.flow, riskFindings: risk.findings, needsConfirm: risk.needsConfirm };
}

/** Validate a submitted flow the same way the apps do on import. Throws 422 with details. */
export async function vetFlow(raw: unknown): Promise<{ flow: Flow; risk: RiskReport; contentHash: string; warnings: ReturnType<typeof lintFlow> }> {
  const parsed = parseFlow(raw);
  if (!parsed.ok) throw new ApiError(422, "invalid_flow", "The flow does not match the AutoFlow schema", { issues: parsed.issues });
  const flow = sanitizeForSharing(parsed.flow);
  flow.revision = 0;
  // A shared flow cannot reference the author's other flows, so any runFlow target is unknown.
  const lint = lintFlow(flow, { knownFlowIds: [] });
  const lintErrors = lint.filter((i) => i.severity === "error");
  if (lintErrors.length) throw new ApiError(422, "lint_failed", "The flow has errors that must be fixed before sharing", { issues: lintErrors });
  return { flow, risk: analyzeRisk(flow), contentHash: await flowContentHash(flow), warnings: lint.filter((i) => i.severity !== "error") };
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  const e = err as { code?: string; constraint_name?: string };
  return e?.code === "23505" && e.constraint_name === constraint;
}

export async function publish(
  deps: AppDeps,
  auth: AuthContext,
  input: { flow: unknown; category: TemplateCategory; locale?: string },
): Promise<{ template: AtlasTemplate; warnings: ReturnType<typeof lintFlow> }> {
  if (deps.config.limits.atlas.requireVerifiedEmail && !auth.user.emailVerifiedAt) {
    throw new ApiError(403, "email_not_verified", "Verify your email address before publishing to Atlas");
  }
  const { flow, risk, contentHash, warnings } = await vetFlow(input.flow);
  if ((await atlas.countAuthorTemplates(deps.sql, auth.user.id)) >= deps.config.limits.atlas.maxPerAuthor) {
    throw new ApiError(403, "quota_exceeded", `You can publish at most ${deps.config.limits.atlas.maxPerAuthor} templates`);
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const template = await atlas.insertTemplate(deps.sql, {
        id: base62Id(10),
        authorId: auth.user.id,
        name: flow.name,
        description: flow.description,
        category: input.category,
        locale: input.locale ?? auth.user.locale,
        platforms: flow.targets,
        flow,
        contentHash,
        riskLevel: risk.level,
        riskScore: risk.score,
        permissions: risk.permissions,
        status: risk.level === "high" ? "pending_review" : "published",
      });
      if (!template) throw new ApiError(409, "duplicate", "You already published this flow");
      deps.logger.info("atlas.published", { templateId: template.id, userId: auth.user.id, risk: risk.level, status: template.status });
      return { template, warnings };
    } catch (err) {
      if (isUniqueViolation(err, "atlas_templates_pkey")) continue;
      throw err;
    }
  }
  throw new ApiError(503, "service_unavailable", "Could not allocate a template id, try again");
}

export async function search(deps: AppDeps, q: SearchQuery) {
  return atlas.searchTemplates(deps.sql, q);
}

/** Published templates are public; others are visible only to their author and admins. */
export async function get(deps: AppDeps, id: string, viewer: AuthContext | undefined): Promise<AtlasTemplateWithFlow> {
  const t = await atlas.getTemplate(deps.sql, id);
  if (!t) throw errors.notFound("Template");
  if (t.status !== "published" && viewer?.user.id !== t.authorId && viewer?.user.role !== "admin") throw errors.notFound("Template");
  return t;
}

async function getPublished(deps: AppDeps, id: string): Promise<AtlasTemplateWithFlow> {
  const t = await atlas.getTemplate(deps.sql, id);
  if (!t || t.status !== "published") throw errors.notFound("Template");
  return t;
}

export async function install(deps: AppDeps, id: string, viewer: AuthContext | undefined): Promise<{ installs: number; flow: Flow }> {
  const t = await getPublished(deps, id);
  const installs = await atlas.recordInstall(deps.sql, id, viewer?.user.id ?? null);
  return { installs: installs ?? t.installs, flow: t.flow };
}

export async function rate(deps: AppDeps, auth: AuthContext, id: string, stars: number) {
  const t = await getPublished(deps, id);
  if (t.authorId === auth.user.id) throw errors.forbidden("You cannot rate your own template");
  const agg = await atlas.upsertRating(deps.sql, id, auth.user.id, stars);
  return { stars, average: agg.ratingAverage, count: agg.ratingCount };
}

export async function myRating(deps: AppDeps, auth: AuthContext, id: string): Promise<number | null> {
  return atlas.getUserRating(deps.sql, id, auth.user.id);
}

export async function report(deps: AppDeps, auth: AuthContext, id: string, reason: ReportReason, details: string): Promise<{ hidden: boolean }> {
  const t = await atlas.getTemplate(deps.sql, id);
  // Only what the reporter can see: pending, hidden or removed templates answer 404 exactly like
  // unknown ids, so reports cannot be used to probe for unpublished templates.
  if (!t || t.status !== "published") throw errors.notFound("Template");
  if (t.authorId === auth.user.id) throw errors.forbidden("You cannot report your own template");
  const created = await atlas.insertReport(deps.sql, { templateId: id, reporterId: auth.user.id, reason, details });
  if (!created) throw new ApiError(409, "duplicate", "You already reported this template");
  const pending = await atlas.countPendingReports(deps.sql, id);
  let hidden = false;
  if (pending >= deps.config.limits.atlas.reportHideThreshold) {
    await atlas.setTemplateStatus(deps.sql, id, "hidden");
    hidden = true;
    deps.logger.warn("atlas.auto_hidden", { templateId: id, pendingReports: pending });
  }
  return { hidden };
}

export async function unpublish(deps: AppDeps, auth: AuthContext, id: string): Promise<void> {
  if (!(await atlas.deleteTemplate(deps.sql, id, auth.user.id))) throw errors.notFound("Template");
  deps.logger.info("atlas.unpublished", { templateId: id, userId: auth.user.id });
}

export async function mine(deps: AppDeps, auth: AuthContext): Promise<AtlasTemplate[]> {
  return atlas.listAuthorTemplates(deps.sql, auth.user.id);
}

export async function moderationQueue(deps: AppDeps, limit: number) {
  return atlas.moderationQueue(deps.sql, limit);
}

export async function moderate(deps: AppDeps, auth: AuthContext, id: string, action: "approve" | "remove"): Promise<void> {
  await deps.sql.begin(async (tx) => {
    const ok = await atlas.setTemplateStatus(tx, id, action === "approve" ? "published" : "removed");
    if (!ok) throw errors.notFound("Template");
    await atlas.resolveReports(tx, id, action === "approve" ? "dismissed" : "actioned");
  });
  deps.logger.info("atlas.moderated", { templateId: id, action, adminId: auth.user.id });
}

/* ---------------------------------------------------------- official (core) */

export interface OfficialTemplateDto {
  id: string;
  category: TemplateCategory;
  platforms: string[];
  name: string;
  description: string;
  difficulty: Template["difficulty"];
  verifiedAt: string;
  author: "AutoFlow";
  nameKey: string;
  descriptionKey: string;
  risk: { level: atlas.RiskLevel; score: number; permissions: string[] };
}

let officialCache: { list: OfficialTemplateDto[]; byId: Map<string, Template> } | undefined;

export function official() {
  if (!officialCache) {
    const list = TEMPLATES.map((t): OfficialTemplateDto => {
      const risk = analyzeRisk(t.flow);
      return {
        id: t.id,
        category: t.category,
        platforms: t.platforms,
        name: t.name,
        description: t.description,
        difficulty: t.difficulty,
        verifiedAt: t.verifiedAt,
        author: t.author,
        nameKey: `tpl.${t.id}.name`,
        descriptionKey: `tpl.${t.id}.desc`,
        risk: { level: risk.level, score: risk.score, permissions: risk.permissions },
      };
    });
    officialCache = { list, byId: new Map(TEMPLATES.map((t) => [t.id, t])) };
  }
  return officialCache;
}
