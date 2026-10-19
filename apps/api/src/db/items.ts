/** Encrypted sync items. Callers must hold the user's row lock for writes (see services/sync). */
import type { Db } from "./client.js";

export const ITEM_KINDS = ["flow", "profile", "settings"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export interface SyncItem {
  kind: ItemKind;
  id: string;
  revision: number;
  deleted: boolean;
  ciphertext: string | null;
  iv: string | null;
  contentHash: string | null;
  sizeBytes: number;
  /** Server sequence (bigint as decimal string). */
  seq: string;
  deviceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ItemRow {
  kind: ItemKind;
  item_id: string;
  revision: number;
  deleted: boolean;
  ciphertext: string | null;
  iv: string | null;
  content_hash: string | null;
  size_bytes: number;
  seq: string;
  device_id: string | null;
  created_at: Date;
  updated_at: Date;
}

const mapItem = (r: ItemRow): SyncItem => ({
  kind: r.kind,
  id: r.item_id,
  revision: r.revision,
  deleted: r.deleted,
  ciphertext: r.ciphertext,
  iv: r.iv,
  contentHash: r.content_hash,
  sizeBytes: r.size_bytes,
  seq: String(r.seq),
  deviceId: r.device_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function getItem(db: Db, userId: string, kind: ItemKind, itemId: string): Promise<SyncItem | null> {
  const rows = await db<ItemRow[]>`SELECT * FROM items WHERE user_id = ${userId} AND kind = ${kind} AND item_id = ${itemId}`;
  return rows[0] ? mapItem(rows[0]) : null;
}

export async function usage(db: Db, userId: string): Promise<{ items: number; bytes: number }> {
  const [r] = await db<{ items: number; bytes: string }[]>`
    SELECT count(*) FILTER (WHERE NOT deleted)::int AS items, COALESCE(sum(size_bytes), 0)::bigint AS bytes
    FROM items WHERE user_id = ${userId}`;
  return { items: r!.items, bytes: Number(r!.bytes) };
}

export interface ItemWrite {
  userId: string;
  kind: ItemKind;
  itemId: string;
  revision: number;
  ciphertext: string | null;
  iv: string | null;
  contentHash: string | null;
  sizeBytes: number;
  deleted: boolean;
  deviceId: string | null;
}

export async function insertItem(db: Db, w: ItemWrite): Promise<SyncItem> {
  const rows = await db<ItemRow[]>`
    INSERT INTO items (user_id, kind, item_id, revision, ciphertext, iv, content_hash, size_bytes, deleted, seq, device_id)
    VALUES (${w.userId}, ${w.kind}, ${w.itemId}, ${w.revision}, ${w.ciphertext}, ${w.iv}, ${w.contentHash}, ${w.sizeBytes}, ${w.deleted}, nextval('item_seq'), ${w.deviceId})
    RETURNING *`;
  return mapItem(rows[0]!);
}

/** Compare-and-set update: only applies when the stored revision equals `expectedRevision`. */
export async function updateItem(db: Db, w: ItemWrite, expectedRevision: number): Promise<SyncItem | null> {
  const rows = await db<ItemRow[]>`
    UPDATE items SET
      revision = ${w.revision}, ciphertext = ${w.ciphertext}, iv = ${w.iv}, content_hash = ${w.contentHash},
      size_bytes = ${w.sizeBytes}, deleted = ${w.deleted}, seq = nextval('item_seq'), device_id = ${w.deviceId}, updated_at = now()
    WHERE user_id = ${w.userId} AND kind = ${w.kind} AND item_id = ${w.itemId} AND revision = ${expectedRevision}
    RETURNING *`;
  return rows[0] ? mapItem(rows[0]) : null;
}

/**
 * Changes after `since` in sequence order (tombstones included). Returns at most `limit` items and
 * stops early once `byteBudget` of ciphertext has been gathered (always at least one item), so a
 * page stays bounded in memory. `hasMore` tells the client to ask again with the returned cursor.
 */
export async function changesSince(db: Db, userId: string, since: string, limit: number, byteBudget: number): Promise<{ items: SyncItem[]; hasMore: boolean }> {
  const rows = await db<(ItemRow & { page_total: number })[]>`
    WITH p AS (
      SELECT seq, size_bytes FROM items
      WHERE user_id = ${userId} AND seq > ${since}::bigint
      ORDER BY seq ASC LIMIT ${limit + 1}
    ), w AS (
      SELECT seq, sum(size_bytes) OVER (ORDER BY seq) - size_bytes AS before, count(*) OVER () AS total FROM p
    )
    SELECT i.*, w.total::int AS page_total
    FROM w JOIN items i ON i.user_id = ${userId} AND i.seq = w.seq
    WHERE w.before < ${byteBudget}
    ORDER BY i.seq ASC`;
  const taken = rows.slice(0, limit);
  const total = rows[0]?.page_total ?? 0;
  return { items: taken.map(mapItem), hasMore: total > taken.length };
}

export async function listAllItems(db: Db, userId: string): Promise<SyncItem[]> {
  const rows = await db<ItemRow[]>`SELECT * FROM items WHERE user_id = ${userId} ORDER BY seq ASC`;
  return rows.map(mapItem);
}
