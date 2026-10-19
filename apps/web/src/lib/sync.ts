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

/** Applies one remote item locally. Returns "conflict" when both sides changed. */
async function applyRemote(item: RemoteItem, state: SyncState, report: SyncReport): Promise<void> {
  const key = `${item.kind}:${item.id}`;
  const st = useStore.getState();
  const known = state[key];
  if (item.deleted) {
    if (item.kind === "flow" && st.flows.some((f) => f.id === item.id)) await st.deleteFlow(item.id);
    if (item.kind === "profile" && st.profiles.some((p) => p.id === item.id)) await st.deleteProfile(item.id);
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
  if (item.kind === "flow") {
    const parsed = parseFlow(JSON.parse(plain));
    if (!parsed.ok) return;
    const local = st.flows.find((f) => f.id === item.id);
    const lh = local ? await localHash("flow", local) : undefined;
    const localChanged = local && known && lh !== known.hash;
    if (localChanged && lh !== item.contentHash) {
      await st.saveFlow({ ...parsed.flow, id: newId("f"), name: `${parsed.flow.name} (conflict)`.slice(0, 120) }, { snapshot: false });
      report.conflicts++;
      // Keep the local version; it will be uploaded on top of the server revision.
      state[key] = { rev: item.revision, hash: known!.hash };
      return;
    }
    await st.saveFlow(parsed.flow, { snapshot: true, note: "sync" });
  } else {
    const r = InputProfileSchema.safeParse(JSON.parse(plain));
    if (!r.success) return;
    await st.saveProfile(r.data);
  }
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
  for (const f of useStore.getState().flows) await push("flow", f.id, f);
  for (const p of useStore.getState().profiles) await push("profile", p.id, p);

  await kv.set(STATE, state);
  await useStore.getState().updateSettings({ sync: { ...useStore.getState().settings.sync, cursor, lastSyncAt: Date.now() } });
  return report;
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
