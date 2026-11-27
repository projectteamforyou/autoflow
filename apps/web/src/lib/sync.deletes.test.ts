/**
 * Regressions found in the 2026-11-27 audit: deletes that raced or never reached the server, a sync
 * download that moved a flow out of its folder, and copies of paused flows that were armed.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createFlow, flowContentHash, type Flow } from "@autoflow/core";
type Call = { path: string; method: string };
const calls: Call[] = [];
let pullItems: unknown[] = [];
let revision = 10;
let deleteDelay = 0;
vi.mock("./api", async (orig) => {
  const mod = await orig<any>();
  return { ...mod, api: vi.fn(async (path: string, init: any = {}) => {
    calls.push({ path, method: init.method ?? "GET" });
    if (path.startsWith("/v1/sync?")) return { items: pullItems, cursor: "1", hasMore: false };
    if (init.method === "DELETE") { await new Promise((r) => setTimeout(r, deleteDelay)); return { item: { revision: ++revision } }; }
    if (init.method === "PUT") return { item: { revision: ++revision } };
    throw new Error("unexpected");
  }) };
});
const { kv } = await import("./db");
const { seal } = await import("./crypto");
const { useStore } = await import("./store");
const { setSyncKey, syncNow } = await import("./sync");
const { armedFlows } = await import("./triggers");
const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
async function remote(value: Flow, rev: number) {
  const sealed = await seal(JSON.stringify(value), key);
  return { kind: "flow", id: value.id, revision: rev, deleted: false, contentHash: await flowContentHash(value), ciphertext: sealed.data, iv: sealed.iv };
}
beforeEach(async () => { calls.length = 0; pullItems = []; setSyncKey(key); await useStore.getState().init(); });
afterEach(async () => {
  const st = useStore.getState();
  for (const f of st.flows) await st.deleteFlow(f.id, { remote: false });
  await kv.del("sync:state");
  await st.updateSettings({ pausedTriggers: [] });
});
const step = (id: string, ms = 10) => ({ id, type: "wait" as const, ms, jitterMs: 0 });

describe("sync: deletes, per-device fields, paused copies", () => {
  test("a downloaded edit from another device keeps this device's folder and favourite", async () => {
    const st = useStore.getState();
    const base = await st.saveFlow({ ...createFlow({ name: "X", id: "f_a" }), steps: [step("s1")], folder: "Work", favorite: true } as Flow, { snapshot: false });
    await kv.set("sync:state", { "flow:f_a": { rev: 1, hash: await flowContentHash(base) } });
    // other device: same flow, no folder there, edited a step
    const other: Flow = { ...base, folder: undefined, favorite: false, steps: [step("s1", 99)] as any };
    delete (other as any).folder;
    pullItems = [await remote(other, 2)];
    const r = await syncNow();
    const now = useStore.getState().flows.find((f: Flow) => f.id === "f_a")!;
    expect(now.folder).toBe("Work");
  });

  test("bulk delete, Undo, then sync: the restored flows stay", async () => {
    const st = useStore.getState();
    const flows: Flow[] = [];
    const state: any = {};
    for (const id of ["f_1", "f_2", "f_3"]) {
      const f = await st.saveFlow({ ...createFlow({ name: id, id }), steps: [step("s1")] } as Flow, { snapshot: false });
      flows.push(f); state[`flow:${id}`] = { rev: 1, hash: await flowContentHash(f) };
    }
    await kv.set("sync:state", state);
    deleteDelay = 5;
    // Library.removeMany: for (const f of list) await del(f.id)
    for (const f of flows) await useStore.getState().deleteFlow(f.id);
    await new Promise((r) => setTimeout(r, 200)); // tombstones reach the server
    // Undo toast: for (const f of list) await saveFlow(f, { snapshot: false })
    for (const f of flows) await useStore.getState().saveFlow(f, { snapshot: false });
    expect(useStore.getState().flows.length).toBe(3);
    // next sync: server returns the three tombstones
    pullItems = ["f_1", "f_2", "f_3"].map((id, i) => ({ kind: "flow", id, revision: 11 + i, deleted: true, contentHash: null }));
    const r = await syncNow();
    expect(useStore.getState().flows.length).toBe(3);
  });

  test("single delete, Undo, then sync: the flow stays", async () => {
    const st = useStore.getState();
    const f = await st.saveFlow({ ...createFlow({ name: "one", id: "f_9" }), steps: [step("s1")] } as Flow, { snapshot: false });
    await kv.set("sync:state", { "flow:f_9": { rev: 1, hash: await flowContentHash(f) } });
    await useStore.getState().deleteFlow("f_9");
    await new Promise((r) => setTimeout(r, 100));
    await useStore.getState().saveFlow(f, { snapshot: false });
    pullItems = [{ kind: "flow", id: "f_9", revision: 20, deleted: true, contentHash: null }];
    const r = await syncNow();
    expect(useStore.getState().flows.length).toBe(1);
  });

  test("a delete made while sync was locked is sent by the next sync", async () => {
    const st = useStore.getState();
    const f = await st.saveFlow({ ...createFlow({ name: "one", id: "f_8" }), steps: [step("s1")] } as Flow, { snapshot: false });
    await kv.set("sync:state", { "flow:f_8": { rev: 1, hash: await flowContentHash(f) } });
    setSyncKey(null);
    await useStore.getState().deleteFlow("f_8");
    await new Promise((r) => setTimeout(r, 100));
    setSyncKey(key);
    calls.length = 0;
    await syncNow();
    expect(calls.some((c) => c.method === "DELETE")).toBe(true);
  });

  test("the copy of a flow with a paused trigger is paused too", async () => {
    const st = useStore.getState();
    const f = await st.saveFlow({ ...createFlow({ name: "sched", id: "f_s" }), trigger: { type: "schedule", everyMs: 60000 }, steps: [step("s1")] } as Flow, { snapshot: false });
    await st.setTriggerPaused([f.id], true);
    const copy = await useStore.getState().duplicateFlow(f.id);
    const s2 = useStore.getState();
    const armed = armedFlows(s2.flows, s2.settings.pausedTriggers).map((x: Flow) => x.name);
    expect(armed).toEqual([]);
  });

  test("a stored flow that could not be loaded is not deleted on the server", async () => {
    await kv.set("sync:state", { "flow:f_bad": { rev: 3, hash: "abc" } });
    useStore.setState({ unreadable: [{ id: "f_bad", name: "broken", issue: "x", raw: {} }] });
    await syncNow();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    useStore.setState({ unreadable: [] });
  });

  test("two settings changes that overlap both land", async () => {
    const st = useStore.getState();
    await Promise.all([st.updateSettings({ pausedTriggers: ["f_x"] }), st.updateSettings({ canvasSpeed: 2 })]);
    expect(useStore.getState().settings.pausedTriggers).toEqual(["f_x"]);
    expect(useStore.getState().settings.canvasSpeed).toBe(2);
  });
});
