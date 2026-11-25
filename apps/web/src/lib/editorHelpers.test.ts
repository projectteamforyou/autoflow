/** Editor helpers: wrap / collapse navigation (steps.ts), the step clipboard and the datetime-local conversion. */
import { beforeEach, describe, expect, test } from "vitest";
import type { Step } from "@autoflow/core";
import { ancestorsOf, countNested, siblingsAt, visibleStepIds, wrapStep } from "./steps";
import { clearCopiedStep, copyStep, readCopiedStep } from "./stepClipboard";
import { isoToLocalInput, localInputToIso } from "./datetime";

const wait = (id: string): Step => ({ id, type: "wait", ms: 10, jitterMs: 0 });
const tree = (): Step[] => [
  wait("a"),
  { id: "G", type: "group", name: "G", body: [wait("b"), { id: "I", type: "if", condition: { expr: "true" }, then: [wait("c")], else: [wait("d")] }] },
  wait("e"),
];

describe("steps helpers", () => {
  test("wrapStep keeps the step's ids and its place; only the wrapper is new", () => {
    for (const kind of ["group", "loop", "try"] as const) {
      const r = wrapStep(tree(), "I", kind);
      const g = r.steps[1] as Extract<Step, { type: "group" }>;
      const w = g.body[1] as Extract<Step, { type: "group" | "loop" | "try" }>;
      expect(w.type).toBe(kind);
      expect(w.id).toBe(r.wrapperId);
      expect(["a", "G", "b", "I", "c", "d", "e"]).not.toContain(w.id);
      expect(JSON.stringify(w.body)).toBe(JSON.stringify([(tree()[1] as Extract<Step, { type: "group" }>).body[1]]));
      expect(g.body).toHaveLength(2);
    }
    expect(wrapStep(tree(), "nope", "group")).toEqual({ steps: expect.any(Array) });
  });

  test("ancestors, nested count, siblings", () => {
    expect(ancestorsOf(tree(), "d").map((s) => s.id)).toEqual(["G", "I"]);
    expect(ancestorsOf(tree(), "a")).toEqual([]);
    expect(countNested(tree()[1]!)).toBe(4);
    expect(siblingsAt(tree(), { parentId: "I", slot: "else" }).map((s) => s.id)).toEqual(["d"]);
    expect(siblingsAt(tree(), { parentId: null, slot: "steps" })).toHaveLength(3);
  });

  test("visibleStepIds skips the children of collapsed containers", () => {
    expect(visibleStepIds(tree(), () => false)).toEqual(["a", "G", "b", "I", "c", "d", "e"]);
    expect(visibleStepIds(tree(), (s) => s.id === "I")).toEqual(["a", "G", "b", "I", "e"]);
    expect(visibleStepIds(tree(), (s) => s.id === "G")).toEqual(["a", "G", "e"]);
  });
});

describe("step clipboard", () => {
  beforeEach(() => clearCopiedStep());

  test("round-trips through localStorage with schema defaults", () => {
    expect(readCopiedStep()).toBeNull();
    copyStep(tree()[1]!);
    expect(JSON.parse(localStorage.getItem("af.editor.clip")!).id).toBe("G");
    expect(readCopiedStep()).toEqual(tree()[1]);
  });

  test("rejects anything that is not a valid step", () => {
    copyStep(wait("a"));
    for (const bad of ["not json", JSON.stringify({ id: "x", type: "nope" }), JSON.stringify({ type: "wait", ms: -5 }), "null"]) {
      localStorage.setItem("af.editor.clip", bad);
      expect(readCopiedStep()).toBeNull();
    }
  });
});

describe("datetime-local conversion", () => {
  test("round-trips to the minute and yields schema-style UTC instants", () => {
    const iso = localInputToIso("2026-03-01T09:30")!;
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
    expect(isoToLocalInput(iso)).toBe("2026-03-01T09:30");
  });

  test("empty and invalid values are unset", () => {
    expect(localInputToIso("")).toBeUndefined();
    expect(localInputToIso("garbage")).toBeUndefined();
    expect(isoToLocalInput(undefined)).toBe("");
    expect(isoToLocalInput("garbage")).toBe("");
  });
});
