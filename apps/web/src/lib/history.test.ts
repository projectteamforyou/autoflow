import { describe, expect, test } from "vitest";
import { createFlow, type Flow, type Step } from "@autoflow/core";
import { COALESCE_MS, EASY_KIND, HISTORY_CAP, canRedo, canUndo, createHistory, editKind, record, redo, structureKey, undo } from "./history";

describe("history stack", () => {
  test("undo and redo walk the recorded states", () => {
    let h = createHistory<string>();
    expect(canUndo(h)).toBe(false);
    expect(undo(h, "a")).toBeNull();
    expect(redo(h, "a")).toBeNull();

    h = record(h, "a", null, 0); // a → b
    h = record(h, "b", null, 10); // b → c
    expect(h.past).toEqual(["a", "b"]);

    const u1 = undo(h, "c")!;
    expect(u1.value).toBe("b");
    const u2 = undo(u1.history, "b")!;
    expect(u2.value).toBe("a");
    expect(canUndo(u2.history)).toBe(false);
    expect(canRedo(u2.history)).toBe(true);

    const r1 = redo(u2.history, "a")!;
    expect(r1.value).toBe("b");
    const r2 = redo(r1.history, "b")!;
    expect(r2.value).toBe("c");
    expect(canRedo(r2.history)).toBe(false);
    expect(r2.history.past).toEqual(["a", "b"]);
  });

  test("a new edit drops the redo stack", () => {
    let h = record(createHistory<string>(), "a", null, 0);
    h = undo(h, "b")!.history;
    expect(canRedo(h)).toBe(true);
    h = record(h, "a", null, 5000);
    expect(canRedo(h)).toBe(false);
    expect(h.past).toEqual(["a"]);
  });

  test("a burst of same-kind edits is one entry; the window slides with each edit", () => {
    let h = createHistory<string>();
    h = record(h, "", "k", 1000); // "" → "h"
    h = record(h, "h", "k", 1000 + COALESCE_MS - 1); // → "he"
    h = record(h, "he", "k", 1000 + 2 * (COALESCE_MS - 1)); // → "hel": within 700 ms of the previous edit
    expect(h.past).toEqual([""]);
    expect(undo(h, "hel")!.value).toBe("");
  });

  test("a pause, another kind or a structural edit starts a new entry", () => {
    let h = record(createHistory<string>(), "a", "k", 0);
    h = record(h, "b", "k", COALESCE_MS); // too late
    expect(h.past).toEqual(["a", "b"]);
    h = record(h, "c", "other", COALESCE_MS + 1); // different kind
    expect(h.past).toEqual(["a", "b", "c"]);
    h = record(h, "d", null, COALESCE_MS + 2); // null never coalesces
    h = record(h, "e", null, COALESCE_MS + 3);
    expect(h.past).toEqual(["a", "b", "c", "d", "e"]);
  });

  test("the edit right after an undo is never merged into the older burst", () => {
    let h = record(createHistory<string>(), "a", "k", 0);
    h = record(h, "b", "k2", 10);
    h = undo(h, "c")!.history; // back at "b", past = ["a"]
    h = record(h, "b", "k", 20);
    expect(h.past).toEqual(["a", "b"]);
  });

  test("the stack is capped, dropping the oldest states", () => {
    let h = createHistory<number>();
    for (let i = 0; i < HISTORY_CAP + 15; i++) h = record(h, i, null, i);
    expect(h.past).toHaveLength(HISTORY_CAP);
    expect(h.past[0]).toBe(15);
    expect(h.past[h.past.length - 1]).toBe(HISTORY_CAP + 14);
    // the redo side is capped as well
    let present = -1;
    for (let i = 0; i < HISTORY_CAP; i++) {
      const u = undo(h, present)!;
      present = u.value;
      h = u.history;
    }
    expect(h.future).toHaveLength(HISTORY_CAP);
    expect(canUndo(h)).toBe(false);
  });
});

describe("edit kind", () => {
  const wait = (id: string, ms = 100): Step => ({ id, type: "wait", ms, jitterMs: 0 });
  const flow = (steps: Step[], name = "f"): Flow => ({ ...createFlow({ name }), steps });

  test("field edits keep the kind, structure edits have none", () => {
    const a = flow([wait("a"), { id: "g", type: "group", name: "G", body: [wait("b")] }]);
    const renamed = { ...a, name: "other" };
    const retimed = flow([wait("a", 900), { id: "g", type: "group", name: "G", body: [wait("b")] }]);
    expect(editKind(a, renamed)).toBe(structureKey(a.steps));
    expect(editKind(a, retimed)).toBe(structureKey(a.steps));
    // added, moved out of the container, reordered
    expect(editKind(a, flow([...a.steps, wait("c")]))).toBeNull();
    expect(editKind(a, flow([wait("a"), wait("b"), { id: "g", type: "group", name: "G", body: [] }]))).toBeNull();
    expect(editKind(a, flow([a.steps[1]!, a.steps[0]!]))).toBeNull();
  });

  test("Easy-mode edits are one kind although every edit regenerates the step ids", () => {
    const a = flow([wait("a1")]);
    const b = flow([wait("b1", 250)]); // what applyEasy does: same shape, new ids
    expect(editKind(a, b)).toBeNull();
    expect(editKind(a, b, true)).toBe(EASY_KIND);
    // …so a burst within the window is one undo entry, and a later edit a second one.
    let h = record(createHistory<Flow>(), a, editKind(a, b, true), 1000);
    h = record(h, b, editKind(b, a, true), 1300);
    expect(h.past).toEqual([a]);
    h = record(h, a, editKind(a, b, true), 1300 + COALESCE_MS);
    expect(h.past).toEqual([a, a]);
  });

  test("the same ids in another slot are a different structure", () => {
    const inThen = flow([{ id: "i", type: "if", condition: { expr: "true" }, then: [wait("a")], else: [] }]);
    const inElse = flow([{ id: "i", type: "if", condition: { expr: "true" }, then: [], else: [wait("a")] }]);
    expect(structureKey(inThen.steps)).not.toBe(structureKey(inElse.steps));
  });
});
