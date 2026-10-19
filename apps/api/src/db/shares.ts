/** Short share links for sanitized flows. */
import type { Flow } from "@autoflow/core";
import type { Db } from "./client.js";
import type { RiskLevel } from "./atlas.js";

export interface Share {
  id: string;
  ownerId: string | null;
  flow: Flow;
  contentHash: string;
  riskLevel: RiskLevel;
  riskScore: number;
  permissions: string[];
  sizeBytes: number;
  views: number;
  createdAt: Date;
  expiresAt: Date | null;
}

interface ShareRow {
  id: string;
  owner_id: string | null;
  flow: Flow;
  content_hash: string;
  risk_level: RiskLevel;
  risk_score: number;
  permissions: string[];
  size_bytes: number;
  views: string;
  created_at: Date;
  expires_at: Date | null;
}

const mapShare = (r: ShareRow): Share => ({
  id: r.id,
  ownerId: r.owner_id,
  flow: r.flow,
  contentHash: r.content_hash,
  riskLevel: r.risk_level,
  riskScore: r.risk_score,
  permissions: r.permissions,
  sizeBytes: r.size_bytes,
  views: Number(r.views),
  createdAt: r.created_at,
  expiresAt: r.expires_at,
});

/** Returns null on id collision (caller retries with a fresh id). */
export async function insertShare(db: Db, s: Omit<Share, "views" | "createdAt">): Promise<Share | null> {
  const rows = await db<ShareRow[]>`
    INSERT INTO shares (id, owner_id, flow, content_hash, risk_level, risk_score, permissions, size_bytes, expires_at)
    VALUES (${s.id}, ${s.ownerId}, ${db.json(s.flow as never)}, ${s.contentHash}, ${s.riskLevel}, ${s.riskScore}, ${s.permissions}, ${s.sizeBytes}, ${s.expiresAt})
    ON CONFLICT (id) DO NOTHING
    RETURNING *`;
  return rows[0] ? mapShare(rows[0]) : null;
}

/** Fetch a live (unexpired) share and count the view. */
export async function viewShare(db: Db, id: string, now: Date): Promise<Share | null> {
  const rows = await db<ShareRow[]>`
    UPDATE shares SET views = views + 1
    WHERE id = ${id} AND (expires_at IS NULL OR expires_at > ${now})
    RETURNING *`;
  return rows[0] ? mapShare(rows[0]) : null;
}

export async function deleteShare(db: Db, id: string, ownerId: string): Promise<boolean> {
  const rows = await db`DELETE FROM shares WHERE id = ${id} AND owner_id = ${ownerId} RETURNING id`;
  return rows.length === 1;
}

export async function listOwnerShares(db: Db, ownerId: string): Promise<Share[]> {
  const rows = await db<ShareRow[]>`SELECT * FROM shares WHERE owner_id = ${ownerId} ORDER BY created_at DESC`;
  return rows.map(mapShare);
}

export async function purgeExpiredShares(db: Db, now: Date): Promise<number> {
  const rows = await db`DELETE FROM shares WHERE expires_at IS NOT NULL AND expires_at < ${now} RETURNING id`;
  return rows.length;
}
