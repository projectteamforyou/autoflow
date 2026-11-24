/**
 * Conflict handling of the sync pull: a remote edit or tombstone must never discard a local edit.
 * The API is mocked; crypto, IndexedDB (fake-indexeddb) and the store are real.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createFlow, createProfile, flowContentHash, sha256Hex, stableStringify, type Flow, type InputProfile } from "@autoflow/core";

type Call = { path: string; method: string; headers?: Record<string, string> };
const calls: Call[] = [];
let pullItems: unknown[] = [];
let revision = 10;

vi.mock("./api", async (orig) => {
  const mod = await orig<typeof import("./api")>();
  return {
    ...mod,
    api: vi.fn(async (path: string, init: { method?: string; headers?: Record<string, string> } = {}) => {
      calls.push({ path, method: init.method ?? "GET", headers: init.headers });
      if (path.startsWith("/v1/sync?")) return { items: pullItems, cursor: "1", hasMore: false };
      if (init.method === "PUT" || init.method === "DELETE") return { item: { revision: ++revision } };
      throw new Error(`unexpected ${init.method} ${path}`);
    }),
  };
});

const { kv } = await import("./db");
const { seal } = await import("./crypto");
const { useStore } = await import("./store");
const { setSyncKey, syncNow } = await import("./sync");

const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);

async function remote(kind: "flow" | "profile", value: Flow | InputProfile, rev: number) {
  const sealed = await seal(JSON.stringify(value), key);
  const contentHash = kind === "flow" ? await flowContentHash(value as Flow) : await sha256Hex(stableStringify(value));
  return { kind, id: value.id, revision: rev, deleted: false, contentHash, ciphertext: sealed.data, iv: sealed.iv };
}

beforeEach(async () => {
  calls.length = 0;
  pullItems = [];
  setSyncKey(key);
  await useStore.getState().init();
});

afterEach(async () => {
  const st = useStore.getState();
  for (const f of st.flows) await st.deleteFlow(f.id, { remote: false });
  for (const p of st.profiles) await st.deleteProfile(p.id, { remote: false });
  await kv.del("sync:state");
});

describe("sync conflicts", () => {
  test("a profile edited on both sides keeps the local one and adds a (conflict) copy", async () => {
    const st = useStore.getState();
    const base = createProfile("Work", "p_1");
    await st.saveProfile(base);
    const synced = useStore.getState().profiles[0]!;
    await kv.set("sync:state", { "profile:p_1": { rev: 1, hash: await sha256Hex(stableStringify(synced)) } });
    // Local edit after the last sync…
    await st.saveProfile({ ...synced, name: "Work (laptop)" });
    // …and a different edit from another device.
    pullItems = [await remote("profile", { ...synced, name: "Work (desktop)" }, 2)];

    const report = await syncNow();

    const names = useStore.getState().profiles.map((p) => p.name).sort();
    expect(names).toEqual(["Work (desktop) (conflict)", "Work (laptop)"]);
    expect(report.conflicts).toBe(1);
    // The local version goes up on top of the server revision we just saw.
    const put = calls.find((c) => c.method === "PUT" && c.path.endsWith("/profile/p_1"));
    expect(put?.headers?.["If-Match"]).toBe("2");
  });

  test("a remote tombstone does not delete a flow edited locally; it is re-uploaded", async () => {
    const st = useStore.getState();
    await st.saveFlow(createFlow({ id: "f_1", name: "Daily report" }), { snapshot: false });
    const synced = useStore.getState().flows[0]!;
    await kv.set("sync:state", { "flow:f_1": { rev: 1, hash: await flowContentHash(synced) } });
    await st.saveFlow({ ...synced, name: "Daily report v2" }, { snapshot: false });
    pullItems = [{ kind: "flow", id: "f_1", revision: 2, deleted: true, contentHash: null }];

    const report = await syncNow();

    expect(useStore.getState().flows.map((f) => f.name)).toEqual(["Daily report v2"]);
    expect(report.conflicts).toBe(1);
    expect(report.deleted).toBe(0);
    const put = calls.find((c) => c.method === "PUT" && c.path.endsWith("/flow/f_1"));
    expect(put?.headers?.["If-Match"]).toBe("2");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  test("a remote tombstone deletes an unchanged flow locally without a DELETE round-trip", async () => {
    const st = useStore.getState();
    await st.saveFlow(createFlow({ id: "f_2", name: "Old" }), { snapshot: false });
    const synced = useStore.getState().flows[0]!;
    await kv.set("sync:state", { "flow:f_2": { rev: 1, hash: await flowContentHash(synced) } });
    pullItems = [{ kind: "flow", id: "f_2", revision: 2, deleted: true, contentHash: null }];

    const report = await syncNow();
    // deleteRemote is fire-and-forget; give it a tick so a regression would show up here.
    await new Promise((r) => setTimeout(r, 20));

    expect(useStore.getState().flows).toEqual([]);
    expect(report.deleted).toBe(1);
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });
});
