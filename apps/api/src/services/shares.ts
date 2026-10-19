/** Short share links: validated, sanitized flows behind a 10-character base62 id. */
import { analyzeRisk, lintFlow, type Flow } from "@autoflow/core";
import { ApiError, errors } from "../errors.js";
import type { AppDeps, AuthContext } from "../deps.js";
import * as shares from "../db/shares.js";
import type { Share } from "../db/shares.js";
import { base62Id } from "../lib/crypto.js";
import { vetFlow } from "./atlas.js";

export interface ShareDto {
  id: string;
  url: string;
  flow: Flow;
  contentHash: string;
  risk: { level: string; score: number; permissions: string[]; needsConfirm: boolean; findings: ReturnType<typeof analyzeRisk>["findings"] };
  lint: ReturnType<typeof lintFlow>;
  views: number;
  createdAt: string;
  expiresAt: string | null;
  owned: boolean;
}

export function toShareDto(deps: AppDeps, s: Share, viewerId: string | undefined): ShareDto {
  const risk = analyzeRisk(s.flow);
  return {
    id: s.id,
    url: `${deps.config.publicAppUrl}/s/${s.id}`,
    flow: s.flow,
    contentHash: s.contentHash,
    risk: { level: risk.level, score: risk.score, permissions: risk.permissions, needsConfirm: risk.needsConfirm, findings: risk.findings },
    lint: lintFlow(s.flow, { knownFlowIds: [] }),
    views: s.views,
    createdAt: s.createdAt.toISOString(),
    expiresAt: s.expiresAt?.toISOString() ?? null,
    owned: viewerId !== undefined && viewerId === s.ownerId,
  };
}

export async function create(deps: AppDeps, auth: AuthContext | undefined, input: { flow: unknown; expiresInDays?: number }): Promise<Share> {
  const sizeBytes = Buffer.byteLength(JSON.stringify(input.flow ?? null));
  if (sizeBytes > deps.config.limits.shares.maxFlowBytes) throw new ApiError(413, "payload_too_large", `Shared flows are limited to ${deps.config.limits.shares.maxFlowBytes} bytes`);
  const { flow, risk, contentHash } = await vetFlow(input.flow);
  const expiresAt = input.expiresInDays ? new Date(deps.now().getTime() + input.expiresInDays * 86_400_000) : null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const share = await shares.insertShare(deps.sql, {
      id: base62Id(10),
      ownerId: auth?.user.id ?? null,
      flow,
      contentHash,
      riskLevel: risk.level,
      riskScore: risk.score,
      permissions: risk.permissions,
      sizeBytes,
      expiresAt,
    });
    if (share) return share;
  }
  throw new ApiError(503, "service_unavailable", "Could not allocate a share id, try again");
}

export async function view(deps: AppDeps, id: string): Promise<Share> {
  const s = await shares.viewShare(deps.sql, id, deps.now());
  if (!s) throw errors.notFound("Share");
  return s;
}

export async function remove(deps: AppDeps, auth: AuthContext, id: string): Promise<void> {
  if (!(await shares.deleteShare(deps.sql, id, auth.user.id))) throw errors.notFound("Share");
}

export async function mine(deps: AppDeps, auth: AuthContext): Promise<Share[]> {
  return shares.listOwnerShares(deps.sql, auth.user.id);
}
