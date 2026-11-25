/**
 * Ledger view model: folds a stored run's flat event list into per-step rows (pure, unit-tested).
 * The folding itself is `createTraceRecorder` from @autoflow/core, the same one the debugger uses.
 */
import { createTraceRecorder, stepTimings, walkSteps, type Flow, type RunEvent, type RunTrace, type TraceSpan } from "@autoflow/core";

export type SpanStatus = "ok" | "failed" | "timeout" | "interrupted" | "running";

export function spanStatus(s: TraceSpan): SpanStatus {
  if (s.timedOut && s.ok !== true) return "timeout";
  if (s.ok === false) return "failed";
  if (s.ok === true) return "ok";
  return s.interrupted ? "interrupted" : "running";
}

export interface SlowStep {
  stepId: string;
  stepType: string;
  runs: number;
  totalMs: number;
  /** Time in the step itself, without the steps nested inside it. */
  selfMs: number;
  failures: number;
  timeouts: number;
  retries: number;
}

export interface FoldedRun {
  trace: RunTrace;
  spans: TraceSpan[];
  /** Steps ordered by their own time, slowest first. */
  slowest: SlowStep[];
  failed: number;
  retries: number;
  timeouts: number;
}

/**
 * Folds events into a trace. A stored run may have lost its oldest events (the log is capped), so
 * the list can begin mid-step: ends without a start are ignored by the recorder.
 */
export function foldRun(events: readonly RunEvent[], opts: { maxSpans?: number } = {}): FoldedRun {
  const rec = createTraceRecorder({ maxSpans: opts.maxSpans ?? 5000, maxLogsPerSpan: 50 });
  for (const e of events) rec.onEvent(e);
  const trace = rec.trace();
  const spans = trace.spans;
  // Containers (loop, if, group…) include their children; ranking by total time would always put
  // the outermost loop first, so subtract the direct children to get each step's own time.
  const childMs = new Array<number>(spans.length).fill(0);
  for (const s of spans) if (s.parent >= 0) childMs[s.parent]! += s.durationMs ?? 0;
  const self = new Map<string, number>();
  const types = new Map<string, string>();
  for (const s of spans) {
    self.set(s.stepId, (self.get(s.stepId) ?? 0) + Math.max(0, (s.durationMs ?? 0) - childMs[s.index]!));
    types.set(s.stepId, s.stepType);
  }
  const slowest = stepTimings(trace)
    .map((r) => ({ ...r, stepType: types.get(r.stepId) ?? "", selfMs: self.get(r.stepId) ?? 0 }))
    .sort((a, b) => b.selfMs - a.selfMs || b.totalMs - a.totalMs);
  let failed = 0;
  let retries = 0;
  let timeouts = 0;
  for (const s of spans) {
    if (s.ok === false) failed++;
    if (s.timedOut) timeouts++;
    retries += s.retries.length;
  }
  return { trace, spans, slowest, failed, retries, timeouts };
}

/** step id → user label, for the steps that have one. */
export function stepLabels(flow: Pick<Flow, "steps"> | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (flow) walkSteps(flow.steps, (s) => void (s.label && out.set(s.id, s.label)));
  return out;
}

/** One line of plain text per event (log search and the .txt export). Not localized: it is a log. */
export function eventLine(e: RunEvent, labels?: ReadonlyMap<string, string>): string {
  const name = (id: string) => labels?.get(id) ?? id;
  switch (e.type) {
    case "state": return `state ${e.state}`;
    case "countdown": return `countdown ${Math.ceil(e.remainingMs / 1000)}s`;
    case "stepStart": return `start ${e.stepType} ${name(e.stepId)}`;
    case "stepEnd": return `${e.ok ? "ok" : "FAILED"} ${name(e.stepId)} ${e.durationMs}ms${e.attempts && e.attempts > 1 ? ` attempts=${e.attempts}` : ""}${e.error ? ` ${e.error.category}: ${e.error.message}` : ""}`;
    case "breakpoint": return `breakpoint ${name(e.stepId)}`;
    case "log": return `${e.level} ${e.message}`;
    case "var": return `var ${e.name} = ${JSON.stringify(e.value)?.slice(0, 200)}`;
    case "retry": return `retry #${e.attempt} ${name(e.stepId)}${e.delayMs ? ` in ${e.delayMs}ms` : ""}${e.error ? ` ${e.error}` : ""}`;
    case "timeout": return `timeout ${name(e.stepId)} after ${e.timeoutMs}ms`;
    case "error": return `ERROR ${e.error.category}: ${e.error.message}${e.error.stepId ? ` (step ${name(e.error.stepId)})` : ""}`;
  }
}

export interface RunLogInput {
  id: string;
  flowName: string;
  status: string;
  where: string;
  platform: string;
  startedAt: number;
  durationMs: number;
  actions: number;
  iterations: number;
  steps?: number;
  dropped?: number;
  events: readonly RunEvent[];
}

/** Plain-text log of a run: a short header, then one line per event with the offset from the first event. */
export function runLogText(run: RunLogInput, labels?: ReadonlyMap<string, string>): string {
  const t0 = run.events[0]?.at ?? 0;
  const head = [
    `AutoFlow run ${run.id}`,
    `flow: ${run.flowName}`,
    `status: ${run.status}`,
    `where: ${run.where} (${run.platform})`,
    `started: ${new Date(run.startedAt).toISOString()}`,
    `duration: ${run.durationMs} ms`,
    `actions: ${run.actions}  iterations: ${run.iterations}${run.steps !== undefined ? `  steps: ${run.steps}` : ""}`,
    ...(run.dropped ? [`(${run.dropped} oldest events were not kept)`] : []),
    "",
  ];
  return [...head, ...run.events.map((e) => `+${((e.at - t0) / 1000).toFixed(3)}s  ${eventLine(e, labels)}`)].join("\n") + "\n";
}
