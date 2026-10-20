/**
 * End-to-end encrypted sync (plan §3.6). Clients encrypt on device; the server only keeps
 * ciphertext + iv + content hash + revision and resolves writes by optimistic concurrency:
 * a write carries the revision it was based on (If-Match) and loses with 409 if the server moved on.
 */
import { ApiError } from "../errors.js";
import type { AppDeps, AuthContext } from "../deps.js";
import * as items from "../db/items.js";
import type { ItemKind, SyncItem } from "../db/items.js";
import { lockUser } from "../db/users.js";

export interface ItemPayload {
  ciphertext: string;
  iv: string;
  contentHash: string;
}

/** Decoded byte length of a validated base64 string. */
export function base64Bytes(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return (b64.length / 4) * 3 - pad;
}

export interface ItemDto {
  kind: ItemKind;
  id: string;
  revision: number;
  deleted: boolean;
  contentHash: string | null;
  sizeBytes: number;
  seq: string;
  updatedAt: string;
  deviceId: string | null;
  ciphertext?: string | null;
  iv?: string | null;
}

export function toItemDto(i: SyncItem, withPayload: boolean): ItemDto {
  const dto: ItemDto = {
    kind: i.kind,
    id: i.id,
    revision: i.revision,
    deleted: i.deleted,
    contentHash: i.contentHash,
    sizeBytes: i.sizeBytes,
    seq: i.seq,
    updatedAt: i.updatedAt.toISOString(),
    deviceId: i.deviceId,
  };
  if (withPayload) {
    dto.ciphertext = i.ciphertext;
    dto.iv = i.iv;
  }
  return dto;
}

function conflict(current: SyncItem | null): ApiError {
  return new ApiError(409, "conflict", "The item changed on the server; merge and retry with the current revision", {
    current: current ? toItemDto(current, true) : null,
  });
}

/**
 * Create or update an item. `baseRevision` is the revision the client last saw
 * (0 = "I believe this item does not exist yet").
 */
export async function putItem(deps: AppDeps, auth: AuthContext, kind: ItemKind, itemId: string, baseRevision: number, payload: ItemPayload): Promise<SyncItem> {
  const { maxItems, maxBytes, maxItemBytes } = deps.config.limits.sync;
  const sizeBytes = base64Bytes(payload.ciphertext);
  if (sizeBytes > maxItemBytes) throw new ApiError(413, "payload_too_large", `Item exceeds ${maxItemBytes} bytes`);
  const userId = auth.user.id;

  return deps.sql.begin(async (tx) => {
    // Serialize this user's writes: keeps quota checks exact and seq order == commit order.
    if (!(await lockUser(tx, userId))) throw new ApiError(401, "unauthorized", "Account no longer exists");
    const current = await items.getItem(tx, userId, kind, itemId);
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== baseRevision) throw conflict(current);

    const u = await items.usage(tx, userId);
    const liveBefore = current && !current.deleted ? 1 : 0;
    const bytesAfter = u.bytes - (current?.sizeBytes ?? 0) + sizeBytes;
    if (u.items - liveBefore + 1 > maxItems) throw new ApiError(403, "quota_exceeded", `Item limit reached (${maxItems})`, { limit: maxItems, used: u.items });
    if (bytesAfter > maxBytes) throw new ApiError(403, "quota_exceeded", `Storage limit reached (${maxBytes} bytes)`, { limit: maxBytes, used: u.bytes });

    const write: items.ItemWrite = {
      userId,
      kind,
      itemId,
      revision: currentRevision + 1,
      ciphertext: payload.ciphertext,
      iv: payload.iv,
      contentHash: payload.contentHash,
      sizeBytes,
      deleted: false,
      deviceId: auth.session.deviceId,
    };
    const saved = current ? await items.updateItem(tx, write, currentRevision) : await items.insertItem(tx, write);
    if (!saved) throw conflict(await items.getItem(tx, userId, kind, itemId));
    return saved;
  });
}

/** Replace an item with a tombstone so other devices learn about the deletion. */
export async function deleteItem(deps: AppDeps, auth: AuthContext, kind: ItemKind, itemId: string, baseRevision: number): Promise<SyncItem> {
  const userId = auth.user.id;
  return deps.sql.begin(async (tx) => {
    if (!(await lockUser(tx, userId))) throw new ApiError(401, "unauthorized", "Account no longer exists");
    const current = await items.getItem(tx, userId, kind, itemId);
    if (!current) throw new ApiError(404, "not_found", "Item not found");
    if (current.revision !== baseRevision) throw conflict(current);
    if (current.deleted) return current;
    const saved = await items.updateItem(
      tx,
      { userId, kind, itemId, revision: current.revision + 1, ciphertext: null, iv: null, contentHash: null, sizeBytes: 0, deleted: true, deviceId: auth.session.deviceId },
      current.revision,
    );
    if (!saved) throw conflict(await items.getItem(tx, userId, kind, itemId));
    return saved;
  });
}

export async function getItem(deps: AppDeps, auth: AuthContext, kind: ItemKind, itemId: string): Promise<SyncItem | null> {
  return items.getItem(deps.sql, auth.user.id, kind, itemId);
}

export async function pull(deps: AppDeps, auth: AuthContext, since: string, limit: number): Promise<{ items: SyncItem[]; cursor: string; hasMore: boolean }> {
  const page = await items.changesSince(deps.sql, auth.user.id, since, limit, deps.config.limits.sync.pageByteBudget);
  const last = page.items[page.items.length - 1];
  return { items: page.items, cursor: last ? last.seq : since, hasMore: page.hasMore };
}

export async function usage(deps: AppDeps, auth: AuthContext) {
  const u = await items.usage(deps.sql, auth.user.id);
  const { maxItems, maxBytes, maxItemBytes } = deps.config.limits.sync;
  return { items: u.items, bytes: u.bytes, limits: { maxItems, maxBytes, maxItemBytes } };
}
