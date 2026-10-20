/**
 * Structured run trace for the debugger timeline and the run ledger.
 *
 * Folds the flat RunEvent stream (identical from the TypeScript, Rust and Kotlin engines) into
 * nested step spans with timing, attempts, retries, timeouts, logs and variable changes. Spans
 * that end without a stepEnd (break / continue / stop / goto unwinding) are closed as
 * `interrupted` when the next sibling or ancestor starts, or when the run ends.
 */
import type { RunError, RunEvent, RunState } from "./engine.js";
import type { Value } from "./expr.js";

export interface TraceSpan {
  /** Position in start order. */
  index: number;
  /** Index of the enclosing span, or -1 at top level. */
  parent: number;
  depth: number;
  stepId: string;
  stepType: string;
  path: string;
  start: number;
  end?: number;
  durationMs?: number;
  /** undefined while running or when interrupted. */
  ok?: boolean;
  interrupted?: boolean;
  attempts: number;
  retries: { attempt: number; at: number; delayMs?: number; error?: string }[];
  timedOut: boolean;
  error?: RunError;
  logs: { level: "info" | "warn" | "error"; message: string; at: number }[];
  vars: { name: string; value: Value; at: number }[];
  breakpointHits: number;
}

export interface RunTrace {
  spans: TraceSpan[];
  states: { state: RunState; at: number }[];
  /** Logs and variable changes that happened outside any step (e.g. none today; kept for safety). */
  orphanLogs: { level: "info" | "warn" | "error"; message: string; at: number }[];
  error?: RunError;
  finalState?: RunState;
  startedAt?: number;
  endedAt?: number;
  /** Step spans per step id (all executions). */
  byStep: Record<string, number[]>;
  /** Spans not kept because maxSpans was reached. */
  dropped: number;
}

const TERMINAL = new Set<RunState>(["completed", "stopped", "failed"]);

function isWithin(child: string, parent: string): boolean {
  return child.startsWith(`${parent}.`) || child.startsWith(`${parent}>`);
}

export interface TraceRecorder {
  onEvent(e: RunEvent): void;
  trace(): RunTrace;
}

/** Collects events into a RunTrace. Bounded: at most `maxSpans` spans are kept (oldest dropped from byStep). */
export function createTraceRecorder(opts: { maxSpans?: number; maxLogsPerSpan?: number } = {}): TraceRecorder {
  const maxSpans = opts.maxSpans ?? 20_000;
  const maxLogs = opts.maxLogsPerSpan ?? 200;
  const spans: TraceSpan[] = [];
  const open: TraceSpan[] = [];
  const t: RunTrace = { spans, states: [], orphanLogs: [], byStep: Object.create(null) as Record<string, number[]>, dropped: 0 };
  let dropped = 0;
  /** Breakpoint events arrive just before the stepStart of the step they pause on. */
  const pendingBreakpoints = new Map<string, number>();

  const top = () => open[open.length - 1];
  const close = (span: TraceSpan, at: number) => {
    span.end = at;
    span.durationMs = at - span.start;
  };
  const closeUntil = (keep: (s: TraceSpan) => boolean, at: number) => {
    while (open.length && !keep(top()!)) {
      const s = open.pop()!;
      s.interrupted = true;
      close(s, at);
    }
  };

  return {
    onEvent(e) {
      switch (e.type) {
        case "state":
          t.states.push({ state: e.state, at: e.at });
          if (e.state === "running" && t.startedAt === undefined) t.startedAt = e.at;
          if (TERMINAL.has(e.state)) {
            t.finalState = e.state;
            t.endedAt = e.at;
            closeUntil(() => false, e.at);
          }
          return;
        case "stepStart": {
          closeUntil((s) => isWithin(e.path, s.path), e.at);
          if (spans.length >= maxSpans) {
            dropped++;
            open.push({ index: -1, parent: -1, depth: open.length, stepId: e.stepId, stepType: e.stepType, path: e.path, start: e.at, attempts: 1, retries: [], timedOut: false, logs: [], vars: [], breakpointHits: 0 });
            return;
          }
          const parent = top();
          const span: TraceSpan = {
            index: spans.length,
            parent: parent && parent.index >= 0 ? parent.index : -1,
            depth: open.length,
            stepId: e.stepId,
            stepType: e.stepType,
            path: e.path,
            start: e.at,
            attempts: 1,
            retries: [],
            timedOut: false,
            logs: [],
            vars: [],
            breakpointHits: pendingBreakpoints.get(e.stepId) ?? 0,
          };
          pendingBreakpoints.delete(e.stepId);
          spans.push(span);
          (t.byStep[e.stepId] ??= []).push(span.index);
          open.push(span);
          return;
        }
        case "stepEnd": {
          // Close the innermost open span of this step (children that never ended were interrupted).
          const idx = open.map((s) => s.stepId).lastIndexOf(e.stepId);
          if (idx < 0) return;
          closeUntil((s) => open.indexOf(s) <= idx, e.at);
          const span = open.pop()!;
          close(span, e.at);
          span.ok = e.ok;
          if (e.attempts !== undefined) span.attempts = e.attempts;
          if (e.error) span.error = e.error;
          return;
        }
        case "retry": {
          const span = [...open].reverse().find((s) => s.stepId === e.stepId);
          if (span) {
            span.retries.push({ attempt: e.attempt, at: e.at, delayMs: e.delayMs, error: e.error });
            span.attempts = e.attempt + 1;
          }
          return;
        }
        case "timeout": {
          const span = [...open].reverse().find((s) => s.stepId === e.stepId);
          if (span) span.timedOut = true;
          return;
        }
        case "breakpoint": {
          pendingBreakpoints.set(e.stepId, (pendingBreakpoints.get(e.stepId) ?? 0) + 1);
          return;
        }
        case "log": {
          const span = (e.stepId && [...open].reverse().find((s) => s.stepId === e.stepId)) || top();
          const entry = { level: e.level, message: e.message, at: e.at };
          if (span && span.logs.length < maxLogs) span.logs.push(entry);
          else if (!span && t.orphanLogs.length < maxLogs) t.orphanLogs.push(entry);
          return;
        }
        case "var": {
          const span = top();
          if (span && span.vars.length < maxLogs) span.vars.push({ name: e.name, value: e.value, at: e.at });
          return;
        }
        case "error":
          t.error = e.error;
          return;
        case "countdown":
          return;
      }
    },
    trace() {
      return { ...t, spans: [...spans], dropped };
    },
  };
}

/** Convenience: total time spent per step id (sum over spans that ended), for "hot step" views. */
export function stepTimings(trace: RunTrace): { stepId: string; runs: number; totalMs: number; failures: number; timeouts: number; retries: number }[] {
  const out = new Map<string, { stepId: string; runs: number; totalMs: number; failures: number; timeouts: number; retries: number }>();
  for (const s of trace.spans) {
    const r = out.get(s.stepId) ?? { stepId: s.stepId, runs: 0, totalMs: 0, failures: 0, timeouts: 0, retries: 0 };
    r.runs++;
    r.totalMs += s.durationMs ?? 0;
    if (s.ok === false) r.failures++;
    if (s.timedOut) r.timeouts++;
    r.retries += s.retries.length;
    out.set(s.stepId, r);
  }
  return [...out.values()].sort((a, b) => b.totalMs - a.totalMs);
}
