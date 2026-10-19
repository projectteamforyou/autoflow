// Writes fixtures/engine/conformance.json: engine-v2 scenarios (timeouts, retry backoff, step budget,
// humanization, secret masking) with the outcome produced by the TypeScript engine. The Rust
// (crates/engine/tests/conformance.rs) and Kotlin (engine ConformanceTest) executors replay every
// case and must produce the same status, error, virtual duration, counters, retry delays, timeouts,
// log lines and click coordinates.
import { mkdirSync, writeFileSync } from "node:fs";
import { FlowRun, SandboxBackend, createVirtualClock, parseFlow } from "../dist/index.js";

const T = "2026-10-19T00:00:00.000Z";
const flow = (steps, extra = {}) => ({ schemaVersion: "1.0", id: "f_conf", name: "conformance", createdAt: T, updatedAt: T, steps, ...extra });
const click = (id, x = 100, y = 100, extra = {}) => ({ id, type: "click", target: { kind: "point", x, y, space: "screen" }, ...extra });
const wait = (id, ms, extra = {}) => ({ id, type: "wait", ms, ...extra });

const cases = [
  {
    name: "retry-exponential-capped",
    failFirst: { type: "click", count: 3 },
    flow: flow([click("c", 100, 100, { onError: { strategy: "retry", retries: 4, backoffMs: 100, backoff: "exponential", maxBackoffMs: 300 } })]),
  },
  {
    name: "retry-fixed-jitter",
    random: 0.5,
    failFirst: { type: "click", count: 2 },
    flow: flow([click("c", 100, 100, { onError: { strategy: "retry", retries: 2, backoffMs: 400, backoff: "fixed", jitter: 0.5 } })]),
  },
  {
    name: "retry-legacy-linear-exhausted",
    failFirst: { type: "click", count: 10 },
    flow: flow([click("c", 100, 100, { onError: { strategy: "retry", retries: 2, backoffMs: 250 } })]),
  },
  { name: "step-timeout", flow: flow([wait("w", 5000, { stepTimeoutMs: 1000 })]) },
  { name: "step-timeout-not-reached", flow: flow([wait("w", 1000, { stepTimeoutMs: 1000 }), click("c")]) },
  {
    name: "step-timeout-continue",
    flow: flow([wait("w", 5000, { stepTimeoutMs: 100, onError: { strategy: "continue" } }), click("c")]),
  },
  {
    name: "step-timeout-retried",
    flow: flow([wait("w", 5000, { stepTimeoutMs: 100, onError: { strategy: "retry", retries: 2, backoffMs: 10, backoff: "fixed" } })]),
  },
  {
    name: "step-timeout-caught",
    flow: flow([{ id: "t", type: "try", errorVar: "err", body: [wait("w", 5000, { stepTimeoutMs: 100 })], catch: [{ id: "l", type: "log", message: "caught: {{err}}" }] }]),
  },
  {
    name: "container-timeout-wins",
    flow: flow([
      {
        id: "loop",
        type: "loop",
        mode: "forever",
        stepTimeoutMs: 1000,
        body: [{ id: "t", type: "try", body: [wait("w", 300, { onError: { strategy: "retry", retries: 10, backoffMs: 1, backoff: "fixed" } })], catch: [] }],
      },
    ]),
  },
  {
    name: "wait-for-keeps-its-own-timeout",
    flow: flow([{ id: "wf", type: "waitFor", condition: { expr: "false" }, timeoutMs: 500, pollMs: 100, onError: { strategy: "continue" } }]),
  },
  {
    name: "max-steps",
    flow: flow([{ id: "l", type: "loop", mode: "forever", body: [{ id: "s", type: "setVar", name: "x", value: "1" }, wait("w", 10)] }], { limits: { maxSteps: 25 } }),
  },
  {
    name: "humanize-seeded",
    flow: flow([{ id: "l", type: "loop", mode: "count", count: 6, body: [click("c", 200, 300), { id: "n", type: "click", target: { kind: "point", x: 0.5, y: 0.5, space: "normalized" } }] }], {
      humanize: { offsetPx: 5, delayMs: 40, seed: 42 },
    }),
  },
  {
    name: "humanize-run-random",
    random: 0.75,
    flow: flow([{ id: "d", type: "drag", from: { kind: "point", x: 10, y: 10 }, to: { kind: "point", x: 50, y: 60 } }, { id: "k", type: "key", key: "a", repeat: 2 }], {
      humanize: { offsetPx: 4, delayMs: 20 },
    }),
  },
  {
    name: "log-masks-secrets",
    secrets: { api: "s3cr3t" },
    flow: flow([{ id: "l", type: "log", message: "key={{secret:api}} n={{1 + 1}}" }, { id: "t", type: "type", text: "{{secret:api}}" }]),
  },
];

class Backend extends SandboxBackend {
  constructor(failFirst) {
    super({ platform: "windows" });
    this.failFirst = failFirst;
    this.failed = 0;
  }
  async perform(action, signal) {
    if (this.failFirst && action.type === this.failFirst.type && this.failed < this.failFirst.count) {
      this.failed++;
      throw Object.assign(new Error("target not found"), { category: "target" });
    }
    return super.perform(action, signal);
  }
}

const out = [];
for (const c of cases) {
  const parsed = parseFlow(c.flow);
  if (!parsed.ok) throw new Error(`${c.name}: ${JSON.stringify(parsed.issues)}`);
  const backend = new Backend(c.failFirst);
  const events = [];
  const random = c.random ?? 0;
  const run = new FlowRun(parsed.flow, backend, {
    clock: createVirtualClock(1_000_000),
    skipCountdown: true,
    random: () => random,
    confirmRisk: async () => true,
    secret: (n) => c.secrets?.[n],
    onEvent: (e) => events.push(e),
  });
  const r = await run.start();
  const expect = {
    status: r.status,
    error: r.error ? { category: r.error.category, stepId: r.error.stepId ?? null, message: r.error.message } : null,
    durationMs: r.durationMs,
    actions: r.actions,
    iterations: r.iterations,
    steps: r.steps,
    retryDelays: events.filter((e) => e.type === "retry").map((e) => e.delayMs),
    timeouts: events.filter((e) => e.type === "timeout").map((e) => e.stepId),
    logs: events.filter((e) => e.type === "log").map((e) => e.message),
    targets: backend.effects
      .filter((e) => e.action.type === "click" || e.action.type === "drag")
      .flatMap((e) => (e.action.type === "drag" ? [e.action.from, e.action.to] : [e.action.target]))
      .map((t) => [t.x, t.y]),
    typed: backend.typed,
  };
  out.push({ name: c.name, random, failFirst: c.failFirst ?? null, secrets: c.secrets ?? {}, flow: c.flow, expect });
}
const dir = new URL("../fixtures/engine/", import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL("conformance.json", dir), JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${out.length} conformance cases`);
