/**
 * End-to-end encrypted sync. Each flow/profile is sealed on the device with the sync key
 * (derived from the user's passphrase) and uploaded as ciphertext + content hash + revision.
 * Conflicts never lose data: the remote copy is kept as "(conflict)" duplicate.
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
  ciphertext: string;
  iv: string;
  contentHash: string;
  revision: number;
  deleted: boolean;
  updatedAt: string;
}

interface SyncPage {
  items: RemoteItem[];
  cursor: string;
  hasMore: boolean;
}

let syncKey: CryptoKey | null = null;

export function setSyncKey(k: CryptoKey | null): void {
  syncKey = k;
}

export function hasSyncKey(): boolean {
  return !!syncKey;
}

/** Map of item key → last synced content hash, to only upload what changed. */
async function syncedHashes(): Promise<Record<string, string>> {
  return (await kv.get<Record<string, string>>("sync:hashes")) ?? {};
}

export interface SyncReport {
  uploaded: number;
  downloaded: number;
  conflicts: number;
  deleted: number;
}

export async function syncNow(): Promise<SyncReport> {
  if (!syncKey) throw new Error("sync key not unlocked");
  const st = useStore.getState();
  const report: SyncReport = { uploaded: 0, downloaded: 0, conflicts: 0, deleted: 0 };
  const hashes = await syncedHashes();
  let cursor = st.settings.sync.cursor ?? "0";

  // 1. Pull remote changes.
  for (;;) {
    const page = await api<SyncPage>(`/v1/sync?since=${encodeURIComponent(cursor)}`);
    for (const item of page.items) {
      if (item.kind !== "flow" && item.kind !== "profile") continue;
      const key = `${item.kind}:${item.id}`;
      if (item.deleted) {
        if (item.kind === "flow" && useStore.getState().flows.some((f) => f.id === item.id)) await useStore.getState().deleteFlow(item.id);
        if (item.kind === "profile") await useStore.getState().deleteProfile(item.id);
        delete hashes[key];
        report.deleted++;
        continue;
      }
      if (hashes[key] === item.contentHash) continue;
      const plain = await open({ iv: item.iv, data: item.ciphertext }, syncKey);
      if (item.kind === "flow") {
        const parsed = parseFlow(JSON.parse(plain));
        if (!parsed.ok) continue;
        const local = useStore.getState().flows.find((f) => f.id === item.id);
        const localHash = local ? await flowContentHash(local) : undefined;
        if (local && hashes[key] && localHash !== hashes[key] && localHash !== item.contentHash) {
          // both sides changed: keep local, add remote as a conflict copy
          await useStore.getState().saveFlow({ ...parsed.flow, id: newId("f"), name: `${parsed.flow.name} (conflict)`.slice(0, 120) }, { snapshot: false });
          report.conflicts++;
        } else {
          await useStore.getState().saveFlow({ ...parsed.flow, revision: item.revision }, { snapshot: true, note: "sync" });
          hashes[key] = item.contentHash;
          report.downloaded++;
        }
      } else {
        const r = InputProfileSchema.safeParse(JSON.parse(plain));
        if (r.success) {
          await useStore.getState().saveProfile(r.data);
          hashes[key] = item.contentHash;
          report.downloaded++;
        }
      }
    }
    cursor = page.cursor;
    if (!page.hasMore) break;
  }

  // 2. Push local changes.
  const pushItem = async (kind: Kind, id: string, value: Flow | InputProfile, revision: number) => {
    const key = `${kind}:${id}`;
    const contentHash = kind === "flow" ? await flowContentHash(value as Flow) : await sha256Hex(stableStringify(value));
    if (hashes[key] === contentHash) return;
    const sealed = await seal(JSON.stringify(value), syncKey!);
    try {
      await api(`/v1/sync/items/${kind}/${encodeURIComponent(id)}`, { method: "PUT", json: { ciphertext: sealed.data, iv: sealed.iv, contentHash, revision }, headers: { "If-Match": String(revision) } });
      hashes[key] = contentHash;
      report.uploaded++;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) report.conflicts++;
      else throw e;
    }
  };
  for (const f of useStore.getState().flows) await pushItem("flow", f.id, f, f.revision);
  for (const p of useStore.getState().profiles) await pushItem("profile", p.id, p, 0);

  await kv.set("sync:hashes", hashes);
  await useStore.getState().updateSettings({ sync: { ...useStore.getState().settings.sync, cursor, lastSyncAt: Date.now() } });
  return report;
}

export async function deleteRemote(kind: Kind, id: string): Promise<void> {
  if (!syncKey) return;
  try {
    await api(`/v1/sync/items/${kind}/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {
    /* next sync retries */
  }
}
