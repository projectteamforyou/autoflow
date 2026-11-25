import { describe, expect, test } from "vitest";
import { FlowSchema, createFlow, type Flow, type Step } from "@autoflow/core";
import { partialFlow } from "./partialRun";

const wait = (id: string, extra: Partial<Step> = {}): Step => ({ id, type: "wait", ms: 10, jitterMs: 0, ...extra }) as Step;

/**
 * a, loop L [ b, if I { then: [c, d, e], else: [x] }, f ], try T { body: [g], catch: [h] }, z
 */
function sample(): Flow {
  const steps: Step[] = [
    wait("a"),
    {
      id: "L", type: "loop", mode: "count", count: 2,
      body: [wait("b"), { id: "I", type: "if", condition: { expr: "true" }, then: [wait("c"), wait("d"), wait("e")], else: [wait("x")] }, wait("f")],
    },
    { id: "T", type: "try", body: [wait("g")], catch: [wait("h")] },
    wait("z"),
  ];
  return { ...createFlow({ name: "sample" }), steps };
}

/** Ids of every step that would be skipped: disabled itself or inside a disabled container. */
function skipped(flow: Flow): string[] {
  const out: string[] = [];
  const walk = (list: Step[], parentOff: boolean) => {
    for (const s of list) {
      const offNow = parentOff || !!s.disabled;
      if (offNow) out.push(s.id);
      if (s.type === "if") { walk(s.then, offNow); walk(s.else, offNow); }
      else if (s.type === "try") { walk(s.body, offNow); walk(s.catch, offNow); }
      else if (s.type === "loop" || s.type === "forEach" || s.type === "group") walk(s.body, offNow);
    }
  };
  walk(flow.steps, false);
  return out.sort();
}

describe("partialFlow — from here", () => {
  test("first top-level step: nothing is skipped", () => {
    expect(skipped(partialFlow(sample(), "a", "from")!)).toEqual([]);
  });

  test("last top-level step: everything before it is skipped", () => {
    const f = partialFlow(sample(), "z", "from")!;
    // containers are disabled as a whole; their children count as skipped
    expect(f.steps.map((s) => !!s.disabled)).toEqual([true, true, true, false]);
    expect(skipped(f)).toEqual(["I", "L", "T", "a", "b", "c", "d", "e", "f", "g", "h", "x"].sort());
  });

  test("nested: earlier top-level steps and earlier siblings in every ancestor", () => {
    const f = partialFlow(sample(), "d", "from")!;
    // a (before L), b (before I inside L), c (before d inside then) — nothing after, and not the other branch
    expect(skipped(f)).toEqual(["a", "b", "c"]);
  });

  test("a container as the starting point keeps its whole body", () => {
    expect(skipped(partialFlow(sample(), "T", "from")!)).toEqual(["I", "L", "a", "b", "c", "d", "e", "f", "x"].sort());
  });
});

describe("partialFlow — only this", () => {
  test("top-level step: every other top-level step is disabled", () => {
    const f = partialFlow(sample(), "a", "only")!;
    expect(f.steps.map((s) => !!s.disabled)).toEqual([false, true, true, true]);
  });

  test("nested: ancestors stay enabled, all their other children are disabled", () => {
    const f = partialFlow(sample(), "d", "only")!;
    expect(skipped(f)).toEqual(["T", "a", "b", "c", "e", "f", "g", "h", "x", "z"].sort());
    const loop = f.steps[1] as Extract<Step, { type: "loop" }>;
    expect(loop.disabled).toBeUndefined();
    expect(loop.count).toBe(2); // structure of the ancestors is untouched
  });

  test("a step in catch: the try body is disabled too", () => {
    expect(skipped(partialFlow(sample(), "h", "only")!)).toEqual(["I", "L", "a", "b", "c", "d", "e", "f", "g", "x", "z"].sort());
  });

  test("last step", () => {
    const f = partialFlow(sample(), "z", "only")!;
    expect(f.steps.map((s) => !!s.disabled)).toEqual([true, true, true, false]);
  });
});

describe("partialFlow — general", () => {
  test("the chosen step and its ancestors are force-enabled", () => {
    const base = sample();
    const loop = base.steps[1] as Extract<Step, { type: "loop" }>;
    loop.disabled = true;
    (loop.body[1] as Extract<Step, { type: "if" }>).then[1]!.disabled = true; // d
    for (const mode of ["from", "only"] as const) {
      const f = partialFlow(base, "d", mode)!;
      expect(skipped(f)).not.toContain("d");
      expect(skipped(f)).not.toContain("L");
    }
  });

  test("steps that were already disabled stay disabled", () => {
    const base = sample();
    base.steps[3]!.disabled = true; // z, after the starting point
    expect(skipped(partialFlow(base, "T", "from")!)).toContain("z");
  });

  test("the source flow is not modified and the result is still a valid flow", () => {
    const base = sample();
    const before = JSON.stringify(base);
    for (const mode of ["from", "only"] as const) {
      const f = partialFlow(base, "d", mode)!;
      expect(f).not.toBe(base);
      expect(f.id).toBe(base.id);
      expect(FlowSchema.safeParse(f).success).toBe(true);
    }
    expect(JSON.stringify(base)).toBe(before);
  });

  test("unknown step id", () => {
    expect(partialFlow(sample(), "nope", "from")).toBeNull();
    expect(partialFlow(sample(), "nope", "only")).toBeNull();
  });
});
