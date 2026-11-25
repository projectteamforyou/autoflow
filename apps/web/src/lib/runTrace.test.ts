import { describe, expect, it } from "vitest";
import type { RunEvent } from "@autoflow/core";
import { eventLine, foldRun, runLogText, spanStatus } from "./runTrace";

const start = (stepId: string, stepType: string, path: string, at: number) => ({ type: "stepStart", stepId, stepType, path, at }) as RunEvent;
const end = (stepId: string, ok: boolean, at: number, extra: object = {}) => ({ type: "stepEnd", stepId, ok, durationMs: 0, at, ...extra }) as RunEvent;

/** loop L (2 rounds) containing click C (fast) and wait W (slow, one retry, then a timeout failure). */
const EVENTS: RunEvent[] = [
  { type: "state", state: "running", at: 0 },
  start("L", "loop", "0", 0),
  start("C", "click", "0.0", 10),
  end("C", true, 30),
  start("W", "wait", "0.1", 30),
  end("W", true, 530),
  start("C", "click", "0.0", 540),
  end("C", true, 550),
  start("W", "wait", "0.1", 550),
  { type: "retry", stepId: "W", attempt: 1, at: 800, delayMs: 100, error: "not yet" },
  { type: "timeout", stepId: "W", timeoutMs: 1000, at: 1550 },
  end("W", false, 1550, { attempts: 2, error: { stepId: "W", message: "step timed out after 1000 ms", category: "timeout" } }),
  end("L", false, 1560),
  { type: "error", error: { stepId: "W", message: "step timed out after 1000 ms", category: "timeout" }, at: 1560 },
  { type: "state", state: "failed", at: 1560 },
];

describe("foldRun", () => {
  it("builds nested spans with duration, status, attempts and retries", () => {
    const f = foldRun(EVENTS);
    expect(f.spans.map((s) => [s.stepId, s.depth, s.durationMs, spanStatus(s)])).toEqual([
      ["L", 0, 1560, "failed"],
      ["C", 1, 20, "ok"],
      ["W", 1, 500, "ok"],
      ["C", 1, 10, "ok"],
      ["W", 1, 1000, "timeout"],
    ]);
    expect(f.spans[4]).toMatchObject({ attempts: 2, timedOut: true, parent: 0 });
    expect(f.spans[4]!.retries).toHaveLength(1);
    expect([f.failed, f.retries, f.timeouts]).toEqual([2, 1, 1]);
    expect(f.trace.finalState).toBe("failed");
  });

  it("ranks the slowest steps by their own time, not by the time of what they contain", () => {
    const f = foldRun(EVENTS);
    expect(f.slowest.map((s) => [s.stepId, s.stepType, s.runs, s.selfMs, s.totalMs])).toEqual([
      ["W", "wait", 2, 1500, 1500],
      // Equal own time: the one with the larger total comes first.
      ["L", "loop", 1, 30, 1560],
      ["C", "click", 2, 30, 30],
    ]);
    expect(f.slowest[0]).toMatchObject({ failures: 1, timeouts: 1, retries: 1 });
  });

  it("copes with a log whose beginning was cut off and with steps that never ended", () => {
    const f = foldRun([end("gone", true, 5), start("A", "click", "0", 10), start("B", "click", "1", 20), { type: "state", state: "stopped", at: 50 }]);
    expect(f.spans.map((s) => [s.stepId, spanStatus(s), s.durationMs])).toEqual([["A", "interrupted", 10], ["B", "interrupted", 30]]);
    expect(foldRun([start("A", "click", "0", 10)]).spans.map(spanStatus)).toEqual(["running"]);
    expect(foldRun([]).spans).toEqual([]);
  });

  it("respects maxSpans and reports what it dropped", () => {
    const f = foldRun(EVENTS, { maxSpans: 2 });
    expect(f.spans).toHaveLength(2);
    expect(f.trace.dropped).toBe(3);
  });
});

describe("log text", () => {
  it("has a line for every event variant", () => {
    const labels = new Map([["W", "Wait for page"]]);
    for (const e of EVENTS) expect(eventLine(e, labels)).not.toBe("");
    expect(eventLine(EVENTS[10]!, labels)).toBe("timeout Wait for page after 1000ms");
    expect(eventLine({ type: "countdown", remainingMs: 2100, at: 0 })).toBe("countdown 3s");
    expect(eventLine({ type: "breakpoint", stepId: "C", at: 0 })).toBe("breakpoint C");
    expect(eventLine({ type: "log", level: "warn", message: "hi", at: 0 })).toBe("warn hi");
    expect(eventLine({ type: "var", name: "n", value: 3, at: 0 })).toBe("var n = 3");
  });

  it("exports a header and one timed line per event", () => {
    const text = runLogText({ id: "r1", flowName: "Demo", status: "failed", where: "canvas", platform: "web", startedAt: 0, durationMs: 1560, actions: 2, iterations: 2, steps: 5, dropped: 500, events: EVENTS });
    const lines = text.trimEnd().split("\n");
    expect(lines[0]).toBe("AutoFlow run r1");
    expect(text).toContain("actions: 2  iterations: 2  steps: 5");
    expect(text).toContain("(500 oldest events were not kept)");
    expect(lines.filter((l) => l.startsWith("+"))).toHaveLength(EVENTS.length);
    expect(lines[lines.length - 1]).toBe("+1.560s  state failed");
  });
});
