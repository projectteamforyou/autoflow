import { describe, expect, it } from "vitest";
import { createFlow, type Flow, type Hotkey } from "@autoflow/core";
import { armedFlows, comboKey, hasTrigger, hotkeyConflicts } from "./triggers";

const hk = (key: string, ...modifiers: Hotkey["modifiers"]): Hotkey => ({ key, modifiers });
const flow = (id: string, patch: Partial<Flow> = {}): Flow => ({ ...createFlow({ name: id, id }), ...patch });
const hotkeyTrigger = (h: Hotkey, app?: string): Flow["trigger"] => ({ type: "hotkey", hotkey: h, scope: app ? "app" : "global", app });

describe("hasTrigger / armedFlows", () => {
  it("counts non-manual triggers and start hotkeys, and leaves paused flows out", () => {
    const manual = flow("f_manual");
    const start = flow("f_start", { hotkeys: { stop: hk("Escape", "ctrl", "alt"), start: hk("F6") } });
    const sched = flow("f_sched", { trigger: { type: "schedule", everyMs: 60_000 } as Flow["trigger"] });
    expect(hasTrigger(manual)).toBe(false);
    expect(hasTrigger(start)).toBe(true);
    expect(hasTrigger(sched)).toBe(true);
    expect(armedFlows([manual, start, sched]).map((f) => f.id)).toEqual(["f_start", "f_sched"]);
    expect(armedFlows([manual, start, sched], ["f_sched"]).map((f) => f.id)).toEqual(["f_start"]);
  });
});

describe("hotkeyConflicts", () => {
  it("ignores modifier order and letter case", () => {
    expect(comboKey(hk("k", "alt", "ctrl"))).toBe(comboKey(hk("K", "ctrl", "alt")));
  });

  it("reports the same combination on two armed flows, on both of them", () => {
    const a = flow("f_a", { trigger: hotkeyTrigger(hk("K", "ctrl", "alt")) });
    const b = flow("f_b", { hotkeys: { stop: hk("Escape", "ctrl", "alt"), start: hk("k", "alt", "ctrl") } });
    const c = flow("f_c", { trigger: hotkeyTrigger(hk("J", "ctrl")) });
    const r = hotkeyConflicts([a, b, c]);
    expect(Object.keys(r).sort()).toEqual(["f_a", "f_b"]);
    expect(r.f_a).toEqual([{ combo: "Ctrl+Alt+K", role: "trigger", otherFlowId: "f_b", otherFlowName: "f_b", otherRole: "start" }]);
    expect(r.f_b![0]).toMatchObject({ role: "start", otherFlowId: "f_a", otherRole: "trigger" });
  });

  it("does not count the shared default stop hotkey or the user's Halt hotkey", () => {
    const a = flow("f_a", { trigger: hotkeyTrigger(hk("F1")) });
    const b = flow("f_b", { trigger: hotkeyTrigger(hk("F2")) });
    expect(hotkeyConflicts([a, b])).toEqual({});
    const halt = hk("F12", "ctrl");
    const a2 = { ...a, hotkeys: { stop: halt } };
    const b2 = { ...b, hotkeys: { stop: halt } };
    expect(hotkeyConflicts([a2, b2], { emergencyStop: halt })).toEqual({});
    // The same custom stop key without being the Halt hotkey is a clash like any other.
    expect(Object.keys(hotkeyConflicts([a2, b2])).sort()).toEqual(["f_a", "f_b"]);
  });

  it("sees pause/stop hotkeys clashing with another flow's trigger", () => {
    const a = flow("f_a", { trigger: hotkeyTrigger(hk("F8")) });
    const b = flow("f_b", { trigger: hotkeyTrigger(hk("F9")), hotkeys: { stop: hk("Escape", "ctrl", "alt"), pause: hk("F8") } });
    expect(hotkeyConflicts([a, b]).f_b).toEqual([{ combo: "F8", role: "pause", otherFlowId: "f_a", otherFlowName: "f_a", otherRole: "trigger" }]);
  });

  it("ignores paused flows, manual flows and a combination reused inside one flow", () => {
    const a = flow("f_a", { trigger: hotkeyTrigger(hk("F8")) });
    const b = flow("f_b", { trigger: hotkeyTrigger(hk("F8")) });
    const manual = flow("f_m", { hotkeys: { stop: hk("Escape", "ctrl", "alt"), pause: hk("F8") } });
    const self = flow("f_s", { trigger: hotkeyTrigger(hk("F3")), hotkeys: { stop: hk("Escape", "ctrl", "alt"), pause: hk("F3") } });
    expect(hotkeyConflicts([a, b], { paused: ["f_b"] })).toEqual({});
    expect(hotkeyConflicts([a, manual, self])).toEqual({});
  });

  it("lets two app-scoped triggers share a combination when the apps differ", () => {
    const a = flow("f_a", { trigger: hotkeyTrigger(hk("F8"), "notepad.exe") });
    const b = flow("f_b", { trigger: hotkeyTrigger(hk("F8"), "calc.exe") });
    const c = flow("f_c", { trigger: hotkeyTrigger(hk("F8"), "Notepad.exe") });
    const g = flow("f_g", { trigger: hotkeyTrigger(hk("F8")) });
    expect(hotkeyConflicts([a, b])).toEqual({});
    expect(Object.keys(hotkeyConflicts([a, c])).sort()).toEqual(["f_a", "f_c"]);
    expect(Object.keys(hotkeyConflicts([a, g])).sort()).toEqual(["f_a", "f_g"]);
  });
});
