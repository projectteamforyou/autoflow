/** /v1/sync — end-to-end encrypted item sync with revision-based optimistic concurrency. */
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../deps.js";
import { ApiError } from "../errors.js";
import { parseJson, parseParams, parseQuery, requireAuth } from "../lib/http.js";
import { ITEM_KINDS } from "../db/items.js";
import * as sync from "../services/sync.js";

const Params = z.object({ kind: z.enum(ITEM_KINDS), id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) });

const Base64 = z
  .string()
  .regex(/^[A-Za-z0-9+/]*={0,2}$/, "must be base64")
  .refine((s) => s.length % 4 === 0, "must be padded base64");

const PutBody = z.object({
  ciphertext: Base64.pipe(z.string().min(4).max(3_000_000)),
  iv: Base64.pipe(z.string().min(12).max(64)),
  contentHash: z.string().regex(/^[A-Za-z0-9+/=_-]{16,128}$/, "must be a hex or base64 digest"),
});

/** `If-Match: "3"` (or bare `3`). Revision 0 means "create; must not exist yet". */
function ifMatchRevision(c: Context<AppEnv>): number {
  const raw = c.req.header("if-match");
  if (raw === undefined) throw new ApiError(428, "precondition_required", 'If-Match header with the base revision is required (use "0" to create)');
  const m = /^\s*(?:W\/)?"?(\d{1,9})"?\s*$/.exec(raw);
  if (!m) throw new ApiError(400, "bad_request", "If-Match must be a revision number");
  return Number(m[1]);
}

export function syncRoutes() {
  const r = new Hono<AppEnv>();

  r.get("/", async (c) => {
    const a = requireAuth(c);
    const deps = c.get("deps");
    const { pageSize, maxPageSize } = deps.config.limits.sync;
    const q = parseQuery(
      c,
      z.object({
        since: z.string().regex(/^\d{1,19}$/, "cursor must be a non-negative integer").default("0"),
        limit: z.coerce.number().int().min(1).max(maxPageSize).default(pageSize),
      }),
    );
    const page = await sync.pull(deps, a, q.since, q.limit);
    return c.json({ items: page.items.map((i) => sync.toItemDto(i, true)), cursor: page.cursor, hasMore: page.hasMore });
  });

  r.get("/usage", async (c) => c.json(await sync.usage(c.get("deps"), requireAuth(c))));

  r.get("/items/:kind/:id", async (c) => {
    const a = requireAuth(c);
    const { kind, id } = parseParams(c, Params);
    const item = await sync.getItem(c.get("deps"), a, kind, id);
    if (!item) throw new ApiError(404, "not_found", "Item not found");
    c.header("ETag", `"${item.revision}"`);
    return c.json({ item: sync.toItemDto(item, true) });
  });

  r.put("/items/:kind/:id", async (c) => {
    const a = requireAuth(c);
    const { kind, id } = parseParams(c, Params);
    const base = ifMatchRevision(c);
    const body = await parseJson(c, PutBody);
    const saved = await sync.putItem(c.get("deps"), a, kind, id, base, body);
    c.header("ETag", `"${saved.revision}"`);
    return c.json({ item: sync.toItemDto(saved, false) }, saved.revision === 1 ? 201 : 200);
  });

  r.delete("/items/:kind/:id", async (c) => {
    const a = requireAuth(c);
    const { kind, id } = parseParams(c, Params);
    const base = ifMatchRevision(c);
    const saved = await sync.deleteItem(c.get("deps"), a, kind, id, base);
    c.header("ETag", `"${saved.revision}"`);
    return c.json({ item: sync.toItemDto(saved, false) });
  });

  return r;
}
