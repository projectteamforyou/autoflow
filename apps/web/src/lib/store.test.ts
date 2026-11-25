/**
 * Store ↔ IndexedDB contract (real store, fake-indexeddb): whatever `saveFlow` accepts must load
 * again in `init`, and a stored flow that `init` cannot load is reported — never dropped silently.
 */
import { beforeEach, describe, expect, test } from "vitest";
import { createFlow, type Flow, type Step } from "@autoflow/core";
import { db, kv } from "./db";
import { DEFAULT_SETTINGS, remapRunFlow, useStore } from "./store";
import { copyStep, readCopiedStep } from "./stepClipboard";

const wait = (id: string): Step => ({ id, type: "wait", ms: 100, jitterMs: 0 });
const runFlow = (id: string, flowId: string): Step => ({ id, type: "runFlow", flowId }) as Step;
const flow = (id: string, steps: Step[] = [], name = id): Flow => ({ ...createFlow({ name, id }), steps });

beforeEach(async () => {
  await db.clearAll();
  useStore.setState({ flows: [], unreadable: [], profiles: [], runs: [], settings: DEFAULT_SETTINGS, toasts: [], ready: false });
});

describe("saveFlow validates like init", () => {
  test("a flow with a duplicate step id is refused and nothing is written", async () => {
    const st = useStore.getState();
    await st.saveFlow(flow("f_a", [wait("s1")]));
    const bad = flow("f_a", [wait("s1"), { id: "g", type: "group", name: "G", body: [wait("s1")] }]);
    await expect(st.saveFlow(bad)).rejects.toThrow(/duplicate step id "s1"/);
    // The stored copy is still the good one, and the next start loads it.
    expect(((await db.get<Flow>("flows", "f_a"))!.steps)).toHaveLength(1);
    await useStore.getState().init();
    expect(useStore.getState().flows.map((f) => f.id)).toEqual(["f_a"]);
    expect(useStore.getState().unreadable).toEqual([]);
  });

  test("schema errors and too deep nesting are refused with the first issue as the message", async () => {
    const st = useStore.getState();
    await expect(st.saveFlow({ ...flow("f_b"), color: "red" })).rejects.toThrow(/^color: /);
    let deep: Step = wait("leaf");
    for (let i = 0; i < 40; i++) deep = { id: `g${i}`, type: "group", name: "G", body: [deep] };
    await expect(st.saveFlow(flow("f_c", [deep]))).rejects.toThrow(/nested more than 32 levels/);
    expect(useStore.getState().flows).toEqual([]);
  });

  test("legitimate saves pass, bump the revision and snapshot only when the steps changed", async () => {
    const st = useStore.getState();
    const a = await st.saveFlow(flow("f_d", [wait("s1")]));
    expect(a.revision).toBe(0);
    const renamed = await st.saveFlow({ ...a, name: "renamed" });
    expect(renamed.revision).toBe(1);
    expect(await st.versions("f_d")).toHaveLength(0);
    await st.saveFlow({ ...renamed, steps: [wait("s1"), wait("s2")] });
    expect(await st.versions("f_d")).toHaveLength(1);
  });
});

describe("init never drops a stored flow silently", () => {
  test("unreadable flows are recorded, stay in IndexedDB and keep their paused trigger", async () => {
    const good = flow("f_ok", [wait("s1")]);
    const dup = { ...flow("f_dup", [wait("x"), wait("x")], "Broken one") };
    await db.put("flows", good);
    await db.put("flows", dup);
    await db.put("flows", { id: "f_junk", steps: "nope" });
    await kv.set("settings", { ...DEFAULT_SETTINGS, pausedTriggers: ["f_dup", "f_ok", "f_gone"] });
    await useStore.getState().init();
    const st = useStore.getState();
    expect(st.ready).toBe(true);
    expect(st.flows.map((f) => f.id)).toEqual(["f_ok"]);
    expect(st.unreadable.map((u) => u.id).sort()).toEqual(["f_dup", "f_junk"]);
    const u = st.unreadable.find((x) => x.id === "f_dup")!;
    expect(u.name).toBe("Broken one");
    expect(u.issue).toBe('steps: duplicate step id "x"');
    expect(u.raw).toEqual(dup);
    expect(st.unreadable.find((x) => x.id === "f_junk")!.name).toBeUndefined();
    // Nothing was deleted, and only the id of a flow that is really gone was pruned.
    expect((await db.all("flows")).length).toBe(3);
    expect(st.settings.pausedTriggers.sort()).toEqual(["f_dup", "f_ok"]);
  });
});

describe("importFlows", () => {
  test("one flow that cannot be saved does not abort the rest", async () => {
    const st = useStore.getState();
    const r = await st.importFlows([flow("f_1", [wait("a")]), flow("f_2", [wait("d"), wait("d")], "Bad"), flow("f_3", [wait("b")])]);
    expect(r.count).toBe(2);
    expect(r.failed).toEqual([{ name: "Bad", issue: 'steps: duplicate step id "d"' }]);
    expect(useStore.getState().flows.map((f) => f.id).sort()).toEqual(["f_1", "f_3"]);
  });

  test("keep both: restored copies call the restored copies (runFlow.flowId follows the id map)", async () => {
    const st = useStore.getState();
    await st.saveFlow(flow("f_main", [runFlow("r", "f_sub")]));
    await st.saveFlow(flow("f_sub", [wait("w")]));
    const backup = [flow("f_main", [{ id: "g", type: "group", name: "G", body: [runFlow("r", "f_sub")] }, runFlow("r2", "f_other")]), flow("f_sub", [wait("w")])];
    const { idMap, count } = await st.importFlows(backup, "copy");
    expect(count).toBe(2);
    const mainCopy = useStore.getState().flows.find((f) => f.id === idMap.get("f_main"))!;
    const inner = (mainCopy.steps[0] as Extract<Step, { type: "group" }>).body[0] as Extract<Step, { type: "runFlow" }>;
    expect(inner.flowId).toBe(idMap.get("f_sub"));
    expect((mainCopy.steps[1] as Extract<Step, { type: "runFlow" }>).flowId).toBe("f_other");
    // The local originals are untouched.
    expect((useStore.getState().flows.find((f) => f.id === "f_main")!.steps[0] as Extract<Step, { type: "runFlow" }>).flowId).toBe("f_sub");
  });

  test("remapRunFlow keeps list identity when nothing matches", () => {
    const steps = [wait("a"), runFlow("r", "f_x")];
    expect(remapRunFlow(steps, new Map([["f_y", "f_z"]]))).toBe(steps);
    const out = remapRunFlow([{ id: "t", type: "try", body: [runFlow("r", "f_x")], catch: [runFlow("c", "f_x")] } as Step], new Map([["f_x", "f_n"]]));
    const t = out[0] as Extract<Step, { type: "try" }>;
    expect((t.body[0] as { flowId: string }).flowId).toBe("f_n");
    expect((t.catch[0] as { flowId: string }).flowId).toBe("f_n");
  });
});

describe("wipeLocalData", () => {
  test("also removes the copied step (localStorage, outside IndexedDB)", async () => {
    copyStep(wait("c"));
    expect(readCopiedStep()).not.toBeNull();
    await useStore.getState().wipeLocalData();
    expect(readCopiedStep()).toBeNull();
    expect(localStorage.getItem("af.editor.clip")).toBeNull();
  });
});
