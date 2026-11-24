/**
 * End-to-end encrypted sync against /v1/sync. Each flow/profile is sealed on the device with the
 * sync key (derived from the user's passphrase) and uploaded as ciphertext + content hash. The
 * server orders writes with revisions (optimistic concurrency, If-Match). Conflicts never lose
 * data: the remote copy is kept as a "(conflict)" duplicate.
 */
import { InputProfileSchema, flowContentHash, newId, parseFlow, sha256Hex, stableStringify, type Flow, type InputProfile } from "@autoflow/core";
import { api, ApiError } from "./api";
import { open, seal } from "./crypto";
import { kv } from "./db";
import { useStore } from "./store";

type Kind = "flow" | "profile";

interface RemoteItem {
  kind: Kind | "settings";
  id: string;
  revision: number;
  deleted: boolean;
  contentHash: string | null;
  ciphertext?: string | null;
  iv?: string | null;
}

interface SyncPage {
  items: RemoteItem[];
  cursor: string;
  hasMore: boolean;
}

/** What this device last saw for each item: server revision and content hash. */
type SyncState = Record<string, { rev: number; hash: string | null }>;

let syncKey: CryptoKey | null = null;

export function setSyncKey(k: CryptoKey | null): void {
  syncKey = k;
}

export function hasSyncKey(): boolean {
  return !!syncKey;
}

const STATE = "sync:state";

export interface SyncReport {
  uploaded: number;
  downloaded: number;
  conflicts: number;
  deleted: number;
}

async function localHash(kind: Kind, value: Flow | InputProfile): Promise<string> {
  return kind === "flow" ? flowContentHash(value as Flow) : sha256Hex(stableStringify(value));
}

/** Applies one remote item locally. Counts a conflict when both sides changed; local data is never lost. */
async function applyRemote(item: RemoteItem, state: SyncState, report: SyncReport): Promise<void> {
  const key = `${item.kind}:${item.id}`;
  const st = useStore.getState();
  const known = state[key];
  const kind = item.kind as Kind;
  const local = kind === "flow" ? st.flows.find((f) => f.id === item.id) : st.profiles.find((p) => p.id === item.id);
  // Local hash vs. what this device last synced: a mismatch (or no record at all) means it was edited here.
  const lh = local ? await localHash(kind, local) : undefined;
  if (item.deleted) {
    if (local && lh !== known?.hash) {
      // Edited here after another device deleted it: keep the local copy. With hash null the push step
      // below sees a mismatch and uploads it as a new revision on top of the tombstone.
      state[key] = { rev: item.revision, hash: null };
      report.conflicts++;
      return;
    }
    // Local-only delete: the server already holds the tombstone, so no DELETE goes back out.
    if (local) await (kind === "flow" ? st.deleteFlow(item.id, { remote: false }) : st.deleteProfile(item.id, { remote: false }));
    state[key] = { rev: item.revision, hash: null };
    report.deleted++;
    return;
  }
  if (!item.ciphertext || !item.iv) return;
  if (known && known.hash === item.contentHash) {
    state[key] = { rev: item.revision, hash: item.contentHash };
    return;
  }
  const plain = await open({ iv: item.iv, data: item.ciphertext }, syncKey!);
  let remote: Flow | InputProfile;
  if (kind === "flow") {
    const parsed = parseFlow(JSON.parse(plain));
    if (!parsed.ok) return;
    remote = parsed.flow;
  } else {
    const r = InputProfileSchema.safeParse(JSON.parse(plain));
    if (!r.success) return;
    remote = r.data;
  }
  if (local && lh !== known?.hash && lh !== item.contentHash) {
    // Both sides changed: keep the remote copy as a "(conflict)" duplicate and the local version as is;
    // it will be uploaded on top of the server revision.
    const name = `${remote.name} (conflict)`;
    if (kind === "flow") await st.saveFlow({ ...(remote as Flow), id: newId("f"), name: name.slice(0, 120) }, { snapshot: false });
    else await st.saveProfile({ ...(remote as InputProfile), id: newId("p"), name: name.slice(0, 80) });
    report.conflicts++;
    state[key] = { rev: item.revision, hash: known?.hash ?? null };
    return;
  }
  if (kind === "flow") await st.saveFlow(remote as Flow, { snapshot: true, note: "sync" });
  else await st.saveProfile(remote as InputProfile);
  state[key] = { rev: item.revision, hash: item.contentHash };
  report.downloaded++;
}

export async function syncNow(): Promise<SyncReport> {
  if (!syncKey) throw new Error("sync key not unlocked");
  const report: SyncReport = { uploaded: 0, downloaded: 0, conflicts: 0, deleted: 0 };
  const state: SyncState = (await kv.get<SyncState>(STATE)) ?? {};
  let cursor = useStore.getState().settings.sync.cursor ?? "0";

  // 1. Pull everything that changed since our cursor.
  for (;;) {
    const page = await api<SyncPage>(`/v1/sync?since=${encodeURIComponent(cursor)}`);
    for (const item of page.items) if (item.kind === "flow" || item.kind === "profile") await applyRemote(item, state, report);
    cursor = page.cursor;
    if (!page.hasMore) break;
  }

  // 2. Push local changes with the last known server revision.
  const push = async (kind: Kind, id: string, value: Flow | InputProfile, retry = true): Promise<void> => {
    const key = `${kind}:${id}`;
    const hash = await localHash(kind, value);
    const known = state[key];
    if (known && known.hash === hash) return;
    const sealed = await seal(JSON.stringify(value), syncKey!);
    try {
      const r = await api<{ item: RemoteItem }>(`/v1/sync/items/${kind}/${encodeURIComponent(id)}`, {
        method: "PUT",
        json: { ciphertext: sealed.data, iv: sealed.iv, contentHash: hash },
        headers: { "If-Match": String(known?.rev ?? 0) },
      });
      state[key] = { rev: r.item.revision, hash };
      report.uploaded++;
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 409 || !retry) throw e;
      const current = (e.body as { error?: { details?: { current?: RemoteItem | null } } })?.error?.details?.current;
      if (current) {
        await applyRemote(current, state, report);
        if (state[key]) state[key]!.hash = known?.hash ?? null; // make sure our local copy is pushed next
        const latest = kind === "flow" ? useStore.getState().flows.find((f) => f.id === id) : useStore.getState().profiles.find((p) => p.id === id);
        if (latest) await push(kind, id, latest, false);
      }
    }
  };
  // Business use without a plan (after the free period) pauses uploads only: what was pulled above
  // is still recorded, and the caller gets the 402 to explain why nothing went up.
  let paused: ApiError | null = null;
  try {
    for (const f of useStore.getState().flows) await push("flow", f.id, f);
    for (const p of useStore.getState().profiles) await push("profile", p.id, p);
  } catch (e) {
    if (!(e instanceof ApiError && e.code === "business_plan_required")) throw e;
    paused = e;
  }

  await kv.set(STATE, state);
  await useStore.getState().updateSettings({ sync: { ...useStore.getState().settings.sync, cursor, lastSyncAt: Date.now() } });
  if (paused) throw paused;
  return report;
}

/** Forgets what this device synced (revisions/hashes). Called when the session ends so another account starts clean. */
export async function resetSyncState(): Promise<void> {
  syncKey = null;
  await kv.del(STATE);
}

/** Tombstones an item on the server after a local delete. */
export async function deleteRemote(kind: Kind, id: string): Promise<void> {
  if (!syncKey) return;
  const state: SyncState = (await kv.get<SyncState>(STATE)) ?? {};
  const known = state[`${kind}:${id}`];
  if (!known) return;
  try {
    const r = await api<{ item: RemoteItem }>(`/v1/sync/items/${kind}/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "If-Match": String(known.rev) } });
    state[`${kind}:${id}`] = { rev: r.item.revision, hash: null };
    await kv.set(STATE, state);
  } catch {
    /* next sync reconciles */
  }
}
