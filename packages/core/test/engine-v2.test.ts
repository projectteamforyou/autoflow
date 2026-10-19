import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FlowRun,
  SandboxBackend,
  TEMPLATES,
  createFlow,
  createTraceRecorder,
  createVirtualClock,
  decodeShareCode,
  encodeShareCode,
  evalExpr,
  importFlow,
  interpolate,
  mulberry32,
  parseFlow,
  realClock,
  retryDelayMs,
  sanitizeForSharing,
  scanPlaceholders,
  stepTimings,
  type Backend,
  type Flow,
  type InputAction,
  type RunEvent,
  type Step,
} from "../src/index.js";

const mk = (steps: Step[], extra: Partial<Flow> = {}): Flow => ({ ...createFlow({ name: "t", steps }), ...extra });
const run = async (flow: Flow, opts: ConstructorParameters<typeof FlowRun>[2] = {}, backend: Backend = new SandboxBackend()) => {
  const clock = createVirtualClock(1_000_000);
  const events: RunEvent[] = [];
  const r = new FlowRun(flow, backend, { clock, skipCountdown: true, onEvent: (e) => events.push(e), random: () => 0, ...opts });
  const result = await r.start();
  return { result, events, clock };
};

/** Fails the first `failures` actions of the given type, then behaves like the sandbox. */
class FlakyBackend extends SandboxBackend {
  calls = 0;
  constructor(private failures: number, private failType = "click") {
    super();
  }
  override async perform(action: InputAction, signal: AbortSignal) {
    if (action.type === this.failType && this.calls++ < this.failures) throw Object.assign(new Error("target not found"), { category: "target" });
    return super.perform(action, signal);
  }
}

const click = (id: string, extra: Partial<Step> = {}): Step => ({ id, type: "click", target: { kind: "point", x: 10, y: 10, space: "screen" }, button: "left", clicks: 1, holdMs: 0, modifiers: [], ...extra }) as Step;
const wait = (id: string, ms: number, extra: Partial<Step> = {}): Step => ({ id, type: "wait", ms, jitterMs: 0, ...extra }) as Step;

describe("retry backoff", () => {
  it("computes fixed, linear (default) and exponential delays with cap and jitter", () => {
    const zero = () => 0;
    expect([1, 2, 3].map((n) => retryDelayMs({ backoffMs: 500 }, n, zero))).toEqual([500, 1000, 1500]);
    expect([1, 2, 3].map((n) => retryDelayMs({ backoffMs: 500, backoff: "fixed" }, n, zero))).toEqual([500, 500, 500]);
    expect([1, 2, 3, 4, 5].map((n) => retryDelayMs({ backoffMs: 100, backoff: "exponential", maxBackoffMs: 1000 }, n, zero))).toEqual([100, 200, 400, 800, 1000]);
    // Jitter removes up to `jitter` × delay: with r = 0.5 and jitter 0.5 → 25 % less.
    expect(retryDelayMs({ backoffMs: 400, backoff: "fixed", jitter: 0.5 }, 1, () => 0.5)).toBe(300);
    expect(retryDelayMs({ backoffMs: 400, backoff: "fixed", jitter: 1 }, 1, () => 0.999)).toBe(1);
  });

  it("retries with exponential backoff and reports delays and errors", async () => {
    const backend = new FlakyBackend(3);
    const flow = mk([click("c", { onError: { strategy: "retry", retries: 4, backoffMs: 100, backoff: "exponential" } })]);
    const { result, events } = await run(flow, {}, backend);
    expect(result.status).toBe("completed");
    const retries = events.filter((e) => e.type === "retry");
    expect(retries.map((e) => (e as { delayMs: number }).delayMs)).toEqual([100, 200, 400]);
    expect((retries[0] as { error: string }).error).toBe("target not found");
    expect(result.durationMs).toBe(700);
    const end = events.find((e) => e.type === "stepEnd") as { attempts?: number; ok: boolean };
    expect(end).toMatchObject({ ok: true, attempts: 4 });
    expect(result.steps).toBe(4);
  });

  it("keeps the legacy linear schedule when no curve is given", async () => {
    const { result, events } = await run(mk([click("c", { onError: { strategy: "retry", retries: 2, backoffMs: 500 } })]), {}, new FlakyBackend(2));
    expect(result.status).toBe("completed");
    expect(events.filter((e) => e.type === "retry").map((e) => (e as { delayMs: number }).delayMs)).toEqual([500, 1000]);
  });
});

describe("step timeouts", () => {
  it("fails a step that runs past its timeout at exactly timeout + 1 ms", async () => {
    const { result, events } = await run(mk([wait("w", 5000, { stepTimeoutMs: 1000 })]));
    expect(result.status).toBe("failed");
    expect(result.error).toMatchObject({ stepId: "w", category: "timeout" });
    expect(result.durationMs).toBe(1001);
    expect(events.some((e) => e.type === "timeout" && e.stepId === "w")).toBe(true);
  });

  it("does not fire when the step finishes in time", async () => {
    const { result } = await run(mk([wait("w", 1000, { stepTimeoutMs: 1000 }), click("c")]));
    expect(result.status).toBe("completed");
  });

  it("is subject to onError (continue, retry) and to try/catch", async () => {
    const cont = await run(mk([wait("w", 5000, { stepTimeoutMs: 100, onError: { strategy: "continue", retries: 0, backoffMs: 0 } }), click("c")]));
    expect(cont.result.status).toBe("completed");
    expect(cont.result.actions).toBe(1);

    const retry = await run(mk([wait("w", 5000, { stepTimeoutMs: 100, onError: { strategy: "retry", retries: 2, backoffMs: 10, backoff: "fixed" } })]));
    expect(retry.result.status).toBe("failed");
    expect(retry.events.filter((e) => e.type === "timeout")).toHaveLength(3);

    const caught = await run(
      mk([{ id: "t", type: "try", errorVar: "err", body: [wait("w", 5000, { stepTimeoutMs: 100 })], catch: [{ id: "l", type: "log", level: "info", message: "caught {{err}}" } as Step] } as Step]),
    );
    expect(caught.result.status).toBe("completed");
    expect(caught.result.vars.err).toBe("step timed out after 100 ms");
  });

  it("an enclosing container's timeout is not swallowed by inner retry policies or try steps", async () => {
    const inner = wait("w", 300, { onError: { strategy: "retry", retries: 10, backoffMs: 1, backoff: "fixed" } });
    const body: Step[] = [{ id: "t", type: "try", body: [inner], catch: [] } as Step];
    const loop = { id: "loop", type: "loop", mode: "forever", body, stepTimeoutMs: 1000 } as Step;
    const { result, events } = await run(mk([loop]));
    expect(result.status).toBe("failed");
    expect(result.error).toMatchObject({ stepId: "loop", category: "timeout" });
    expect(result.durationMs).toBe(1001);
    expect(events.filter((e) => e.type === "retry")).toHaveLength(0);
  });

  it("preempts a backend action that hangs (real clock)", async () => {
    class Hanging extends SandboxBackend {
      override perform(_a: InputAction, signal: AbortSignal) {
        return new Promise<void>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      }
    }
    const t0 = Date.now();
    const r = new FlowRun(mk([click("c", { stepTimeoutMs: 50 })]), new Hanging(), { clock: realClock, skipCountdown: true });
    const result = await r.start();
    expect(result.status).toBe("failed");
    expect(result.error).toMatchObject({ category: "timeout", stepId: "c" });
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe("step budget (watchdog)", () => {
  it("stops a runaway flow deterministically after limits.maxSteps", async () => {
    const flow = mk([{ id: "l", type: "loop", mode: "forever", body: [{ id: "s", type: "setVar", name: "x", value: "1" } as Step] } as Step]);
    flow.limits.maxSteps = 50;
    const { result } = await run(flow);
    expect(result.status).toBe("failed");
    expect(result.error).toMatchObject({ category: "limit", message: "maximum number of steps reached (50)" });
    expect(result.steps).toBe(51);
  });
});

describe("humanization", () => {
  it("mulberry32 is the reference generator (values shared with the Rust and Kotlin tests)", () => {
    const r = mulberry32(42);
    expect([r(), r(), r()].map((x) => Math.round(x * 1e9))).toEqual([601103752, 448290559, 852465793]);
  });

  const flow = (seed?: number) =>
    mk(
      [
        { id: "l", type: "loop", mode: "count", count: 20, body: [click("c"), { id: "n", type: "click", target: { kind: "point", x: 0.5, y: 0.5, space: "normalized" }, button: "left", clicks: 1, holdMs: 0, modifiers: [] } as Step] } as Step,
      ],
      { humanize: { offsetPx: 3, delayMs: 50, seed } },
    );

  it("offsets pixel targets within bounds, leaves normalized targets alone and is reproducible with a seed", async () => {
    const a = new SandboxBackend();
    const b = new SandboxBackend();
    const ra = await run(flow(7), {}, a);
    await run(flow(7), {}, b);
    const pts = (s: SandboxBackend) => s.effects.map((e) => e.action).filter((x) => x.type === "click").map((x) => (x as { target: { x: number; y: number } }).target);
    expect(pts(a)).toEqual(pts(b));
    const pixel = pts(a).filter((_, i) => i % 2 === 0);
    const normalized = pts(a).filter((_, i) => i % 2 === 1);
    expect(pixel.every((p) => Math.abs(p.x - 10) <= 3 && Math.abs(p.y - 10) <= 3)).toBe(true);
    expect(new Set(pixel.map((p) => `${p.x},${p.y}`)).size).toBeGreaterThan(3);
    expect(normalized.every((p) => p.x === 0.5 && p.y === 0.5)).toBe(true);
    // 40 actions, each delayed by 0..50 ms.
    expect(ra.result.durationMs).toBeGreaterThan(0);
    expect(ra.result.durationMs).toBeLessThanOrEqual(40 * 50);
    const other = new SandboxBackend();
    await run(flow(8), {}, other);
    expect(pts(other)).not.toEqual(pts(a));
  });

  it("is off unless configured: flows without humanize replay exactly as before", async () => {
    const plain = new SandboxBackend();
    const { result } = await run(mk([click("c"), click("d")]), {}, plain);
    expect(result.durationMs).toBe(0);
    expect(plain.effects.map((e) => (e.action as { target: { x: number } }).target.x)).toEqual([10, 10]);
  });
});

describe("trace recorder", () => {
  it("folds events into nested spans with attempts, retries, timeouts and interrupted exits", async () => {
    const rec = createTraceRecorder();
    const flow = mk([
      click("c", { onError: { strategy: "retry", retries: 2, backoffMs: 10, backoff: "fixed" } }),
      { id: "loop", type: "loop", mode: "count", count: 3, indexVar: "i", body: [{ id: "if", type: "if", condition: { expr: "i == 1" }, then: [{ id: "brk", type: "break" } as Step], else: [] } as Step] } as Step,
      wait("slow", 500, { stepTimeoutMs: 100, onError: { strategy: "continue", retries: 0, backoffMs: 0 } }),
      { id: "log", type: "log", level: "info", message: "done" } as Step,
    ]);
    await run(flow, { onEvent: rec.onEvent }, new FlakyBackend(1));
    const t = rec.trace();
    expect(t.finalState).toBe("completed");
    const c = t.spans[t.byStep.c![0]!]!;
    expect(c).toMatchObject({ ok: true, attempts: 2, depth: 0, parent: -1 });
    expect(c.retries).toHaveLength(1);
    const brk = t.spans[t.byStep.brk![0]!]!;
    expect(brk.interrupted).toBe(true);
    expect(t.spans[brk.parent]!.stepId).toBe("if");
    const slow = t.spans[t.byStep.slow![0]!]!;
    expect(slow).toMatchObject({ ok: false, timedOut: true });
    expect(slow.error?.category).toBe("timeout");
    expect(t.spans[t.byStep.log![0]!]!.logs[0]!.message).toBe("done");
    expect(t.spans.every((s) => s.end !== undefined)).toBe(true);
    expect(stepTimings(t)[0]!.stepId).toBe("slow");
  });
});

describe("secrets", () => {
  it("never writes secret values into log events, but still uses them for actions", async () => {
    const backend = new SandboxBackend();
    const flow = mk([
      { id: "l", type: "log", level: "info", message: "key={{secret:api}}" } as Step,
      { id: "t", type: "type", text: "{{secret:api}}", perCharDelayMs: 0 } as Step,
    ]);
    const { events } = await run(flow, { secret: (n) => (n === "api" ? "s3cr3t" : undefined) }, backend);
    expect(JSON.stringify(events)).not.toContain("s3cr3t");
    expect(events.find((e) => e.type === "log")).toMatchObject({ message: "key=••••" });
    expect(backend.typed).toEqual(["s3cr3t"]);
  });

  it("replaces literal credential headers with secret references when sharing", () => {
    const flow = mk([
      { id: "h", type: "http", method: "GET", url: "https://example.com", headers: { Authorization: "Bearer abc123", "X-Api-Key": "k", Accept: "text/plain", Cookie: "{{secret:c}}" } } as Step,
    ]);
    const s = sanitizeForSharing(flow).steps[0] as { headers: Record<string, string> };
    expect(s.headers).toEqual({ Authorization: "Bearer {{secret:http_authorization}}", "X-Api-Key": "{{secret:http_x_api_key}}", Accept: "text/plain", Cookie: "{{secret:c}}" });
  });
});

describe("hardening", () => {
  it("rejects hostile documents with issues instead of crashing", () => {
    let deep: unknown = { id: "x", type: "group", name: "g", body: [] };
    for (let i = 0; i < 5000; i++) deep = { id: `g${i}`, type: "group", name: "g", body: [deep] };
    const base = createFlow({ name: "t" });
    const r1 = parseFlow({ ...base, steps: [deep] });
    expect(r1.ok).toBe(false);

    let nested: Step = wait("w", 1);
    for (let i = 0; i < 40; i++) nested = { id: `g${i}`, type: "group", name: "g", body: [nested] } as Step;
    const r2 = parseFlow({ ...base, steps: [nested] });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.issues[0]!.message).toMatch(/nested/);

    // Validation is linear in nesting depth (a plain z.union was ~4^depth: depth 30 never finished).
    let mixed: Step = wait("w", 1);
    for (let i = 0; i < 30; i++) {
      const kind = i % 3;
      mixed = (kind === 0 ? { id: `n${i}`, type: "loop", mode: "count", count: 1, body: [mixed] } : kind === 1 ? { id: `n${i}`, type: "try", body: [mixed], catch: [] } : { id: `n${i}`, type: "if", condition: { expr: "true" }, then: [mixed], else: [] }) as Step;
    }
    const t0 = Date.now();
    expect(parseFlow({ ...base, steps: [mixed] }).ok).toBe(true);
    expect(parseFlow({ ...base, steps: [{ ...(mixed as object), type: "nope" }] }).ok).toBe(false);
    expect(Date.now() - t0).toBeLessThan(1000);

    const many = Array.from({ length: 6 }, (_, g) => ({ id: `g${g}`, type: "group", name: "g", body: Array.from({ length: 2000 }, (_, i) => wait(`w${g}_${i}`, 1)) }));
    const r3 = parseFlow({ ...base, steps: many });
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.issues[0]!.message).toMatch(/at most/);

    const r4 = parseFlow({ ...base, steps: [click("c", { target: { kind: "point", x: 1e300, y: 0, space: "screen" } } as Partial<Step>)] });
    expect(r4.ok).toBe(false);
    const headers = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`h${i}`, "v"]));
    expect(parseFlow({ ...base, steps: [{ id: "h", type: "http", method: "GET", url: "https://x.dev", headers }] }).ok).toBe(false);
    expect(parseFlow({ ...base, steps: [{ id: "h", type: "http", method: "GET", url: "https://x.dev", headers: { "bad header": "v" } }] }).ok).toBe(false);
  });

  it("caps share codes while inflating (deflate bombs)", async () => {
    const bomb = await (async () => {
      const big = new TextEncoder().encode(" ".repeat(5_000_000));
      const s = new Blob([big]).stream().pipeThrough(new CompressionStream("deflate-raw"));
      const bytes = new Uint8Array(await new Response(s).arrayBuffer());
      let b = "";
      for (const x of bytes) b += String.fromCharCode(x);
      return btoa(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    })();
    expect(bomb.length).toBeLessThan(200_000);
    const r = await decodeShareCode(bomb);
    expect(r.ok).toBe(false);
    expect(r.issues[0]!.message).toBe("share code too large");
    const ok = await decodeShareCode(await encodeShareCode(mk([click("c")])));
    expect(ok.ok).toBe(true);
    expect((await importFlow("[".repeat(100_000) + "]".repeat(100_000))).ok).toBe(false);
  });

  it("bounds expression work: replace amplification, nested list stringification, placeholder scanning", () => {
    const env = { vars: { s: "a".repeat(2000), r: Array.from({ length: 100_000 }, (_, i) => i) } };
    const t0 = Date.now();
    expect(() => evalExpr('replace(s, "", s)', env)).toThrow(/too large/);
    expect(() => evalExpr("str([r, r, r, r, r, r, r, r, r, r, r, r, r, r, r, r, r, r, r, r])", env)).toThrow(/too large/);
    expect(() => evalExpr('join([r, r, r, r, r, r, r, r, r, r, r, r, r, r, r, r, r, r, r, r], "")', env)).toThrow(/too large/);
    expect(evalExpr('replace("a-b-c", "-", "+")', env)).toBe("a+b+c");
    expect(evalExpr('replace("abc", "", "-")', env)).toBe("a-b-c");
    const hostile = "{{" + " ".repeat(20_000) + "{".repeat(20_000);
    expect(interpolate(hostile, { vars: {} })).toBe(hostile);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("scans placeholders exactly like the previous regular expression", () => {
    const re = /\{\{\s*([^}]+?)\s*\}\}/g;
    const samples = ["", "{{a}}", "x {{ a + 1 }} y {{b}}", "{{}}", "{{ }}", "{{{a}}}", "{{a}", "{{a} }}", "}}{{a}}{{", "{{ secret:k }}", "{{a}}}}", "{{{{a}}", "a{{b\n}}c", "{{ x }}{{y}}"];
    const rnd = mulberry32(1);
    const alphabet = ["{", "}", " ", "a", "+", "\n"];
    for (let i = 0; i < 2000; i++) samples.push(Array.from({ length: 1 + Math.floor(rnd() * 14) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join(""));
    for (const s of samples) {
      const expected = [...s.matchAll(re)].map((m) => ({ start: m.index, end: m.index! + m[0].length, inner: m[1] }));
      expect([s, scanPlaceholders(s)]).toEqual([s, expected]);
    }
  });

  it("keeps existing documents byte-identical: new fields are optional and never materialized", () => {
    const dir = new URL("../fixtures/", import.meta.url);
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".json") && n !== "index.json")) {
      const raw = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
      const parsed = parseFlow(raw);
      expect(parsed.ok, f).toBe(true);
      if (parsed.ok) expect(JSON.parse(JSON.stringify(parsed.flow))).toEqual(raw);
    }
    expect(TEMPLATES.length).toBeGreaterThan(0);
  });
});
