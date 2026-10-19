import { describe, expect, it } from "vitest";
import {
  FlowRun,
  SandboxBackend,
  TEMPLATES,
  analyzeRisk,
  applyEasy,
  checkExpr,
  createFlow,
  createVirtualClock,
  decodeShareCode,
  defaultEasyModel,
  encodeShareCode,
  evalExpr,
  eventsToSteps,
  explainFlowEn,
  exportFlow,
  findConflicts,
  importFlow,
  interpolate,
  lintFlow,
  matchLocale,
  parseFlow,
  resolveActiveProfile,
  toEasy,
  createProfile,
  type Flow,
  type Step,
  type RunEvent,
} from "../src/index.js";

const mk = (steps: Step[], extra: Partial<Flow> = {}): Flow => ({ ...createFlow({ name: "t", steps }), ...extra });
const run = async (flow: Flow, opts: ConstructorParameters<typeof FlowRun>[2] = {}, backend = new SandboxBackend()) => {
  const clock = createVirtualClock(1_000_000);
  const events: RunEvent[] = [];
  const r = new FlowRun(flow, backend, { clock, skipCountdown: true, onEvent: (e) => events.push(e), random: () => 0, ...opts });
  const result = await r.start();
  return { result, backend, events, run: r };
};

describe("expressions", () => {
  const env = { vars: { a: 2, s: "Hello", l: [1, 2, 3] }, now: () => 0 };
  it("evaluates arithmetic, precedence and logic", () => {
    expect(evalExpr("1 + 2 * 3", env)).toBe(7);
    expect(evalExpr("(1 + 2) * 3", env)).toBe(9);
    expect(evalExpr("a > 1 && !false", env)).toBe(true);
    expect(evalExpr("a == '2'", env)).toBe(true);
    expect(evalExpr("a > 5 ? 'big' : 'small'", env)).toBe("small");
    expect(evalExpr("-a + 10 % 4", env)).toBe(0);
  });
  it("supports strings, lists and functions", () => {
    expect(evalExpr("upper(s) + '!'", env)).toBe("HELLO!");
    expect(evalExpr("len(l)", env)).toBe(3);
    expect(evalExpr("l[1] + l[-1]", env)).toBe(5);
    expect(evalExpr("split('a,b,c', ',')[2]", env)).toBe("c");
    expect(evalExpr("contains(l, 2)", env)).toBe(true);
    expect(evalExpr("join(range(3), '-')", env)).toBe("0-1-2");
    expect(evalExpr("round(3.14159, 2)", env)).toBe(3.14);
    expect(evalExpr("[1, 'x'][1]", env)).toBe("x");
  });
  it("is sandboxed", () => {
    expect(() => evalExpr("constructor", env)).toThrow(/unknown variable/);
    expect(() => evalExpr("eval('1')", env)).toThrow(/unknown function/);
    expect(() => evalExpr("toString()", env)).toThrow(/unknown function/);
    expect(() => evalExpr("1 / 0", env)).toThrow(/division by zero/);
    expect(() => evalExpr("range(0, 1e9)", env)).toThrow(/too large/);
    expect(() => evalExpr("matches('aaaa', '(a+)+$')", env)).toThrow(/too complex/);
    expect(checkExpr("1 +")).not.toBeNull();
    expect(checkExpr("a && (b || c)")).toBeNull();
  });
  it("interpolates text and resolves secrets without inlining them", () => {
    expect(interpolate("Hi {{ s }} x{{a*2}}", env)).toBe("Hi Hello x4");
    expect(interpolate("pw={{secret:main}}", env, (n) => (n === "main" ? "s3cret" : undefined))).toBe("pw=s3cret");
    expect(() => interpolate("{{secret:none}}", env, () => undefined)).toThrow(/not available/);
  });
});

describe("schema", () => {
  it("validates every template and rejects bad input", () => {
    for (const t of TEMPLATES) expect(parseFlow(t.flow).ok, t.id).toBe(true);
    expect(parseFlow({ name: "x" }).ok).toBe(false);
    const dup = mk([{ id: "a", type: "wait", ms: 1, jitterMs: 0 }, { id: "a", type: "wait", ms: 1, jitterMs: 0 }]);
    const r = parseFlow(dup);
    expect(r.ok).toBe(false);
  });
  it("requires count for count loops", () => {
    const f = { ...mk([]), steps: [{ id: "l", type: "loop", mode: "count", body: [] }] };
    expect(parseFlow(f).ok).toBe(false);
  });
});

describe("engine", () => {
  it("runs loops, variables and conditions deterministically", async () => {
    const flow = mk([
      { id: "v", type: "setVar", name: "n", value: "0" },
      {
        id: "l",
        type: "loop",
        mode: "count",
        count: 5,
        indexVar: "i",
        body: [
          { id: "inc", type: "setVar", name: "n", value: "n + i" },
          { id: "if", type: "if", condition: { expr: "i == 3" }, then: [{ id: "b", type: "break" }], else: [] },
          { id: "c", type: "click", target: { kind: "point", x: 10, y: 20, space: "screen" }, button: "left", clicks: 1, holdMs: 0, modifiers: [] },
        ],
      },
    ]);
    const { result, backend } = await run(flow);
    expect(result.status).toBe("completed");
    expect(result.vars.n).toBe(0 + 1 + 2 + 3);
    expect(backend.effects.filter((e) => e.action.type === "click")).toHaveLength(3);
  });

  it("enforces the max-actions limit", async () => {
    const flow = mk([{ id: "l", type: "loop", mode: "forever", body: [{ id: "k", type: "key", key: "a", modifiers: [], action: "press", repeat: 1 }, { id: "w", type: "wait", ms: 1, jitterMs: 0 }] }]);
    flow.limits.maxActions = 50;
    const { result } = await run(flow);
    expect(result.status).toBe("failed");
    expect(result.error?.category).toBe("limit");
    expect(result.actions).toBe(51);
  });

  it("enforces the max-duration limit and keeps time virtual", async () => {
    const flow = mk([{ id: "l", type: "loop", mode: "forever", body: [{ id: "w", type: "wait", ms: 1000, jitterMs: 0 }] }]);
    flow.limits.maxDurationMs = 10_000;
    const { result } = await run(flow);
    expect(result.status).toBe("failed");
    expect(result.error?.category).toBe("limit");
    expect(result.durationMs).toBeGreaterThanOrEqual(10_000);
    expect(result.durationMs).toBeLessThan(11_200);
  });

  it("stops promptly on request", async () => {
    const flow = mk([{ id: "l", type: "loop", mode: "forever", body: [{ id: "w", type: "wait", ms: 50, jitterMs: 0 }] }]);
    const backend = new SandboxBackend();
    const r = new FlowRun(flow, backend, { skipCountdown: true });
    const done = r.start();
    await new Promise((res) => setTimeout(res, 30));
    const t0 = Date.now();
    r.stop("test");
    const result = await done;
    expect(Date.now() - t0).toBeLessThan(500);
    expect(result.status).toBe("stopped");
    expect(result.reason).toBe("test");
  });

  it("pauses and resumes", async () => {
    const flow = mk([{ id: "l", type: "loop", mode: "count", count: 3, body: [{ id: "w", type: "wait", ms: 20, jitterMs: 0 }] }]);
    const r = new FlowRun(flow, new SandboxBackend(), { skipCountdown: true });
    const done = r.start();
    await new Promise((res) => setTimeout(res, 10));
    r.pause();
    expect(r.currentState).toBe("paused");
    await new Promise((res) => setTimeout(res, 50));
    expect(r.currentState).toBe("paused");
    r.resume();
    expect((await done).status).toBe("completed");
  });

  it("retries, continues, and catches errors", async () => {
    let failures = 2;
    const backend = new SandboxBackend();
    const orig = backend.perform.bind(backend);
    backend.perform = async (a, s) => {
      if (a.type === "click" && failures-- > 0) throw new Error("target missing");
      return orig(a, s);
    };
    const flow = mk([
      { id: "c", type: "click", target: { kind: "current" }, button: "left", clicks: 1, holdMs: 0, modifiers: [], onError: { strategy: "retry", retries: 3, backoffMs: 10 } },
      { id: "t", type: "try", errorVar: "e", body: [{ id: "bad", type: "setVar", name: "x", value: "1/0" }], catch: [{ id: "ok", type: "setVar", name: "caught", value: "e" }] },
      { id: "skip", type: "setVar", name: "y", value: "unknownVar", onError: { strategy: "continue", retries: 0, backoffMs: 0 } },
      { id: "end", type: "setVar", name: "done", value: "true" },
    ]);
    const { result, events } = await run(flow, {}, backend);
    expect(result.status).toBe("completed");
    expect(events.filter((e) => e.type === "retry")).toHaveLength(2);
    expect(String(result.vars.caught)).toMatch(/division by zero/);
    expect(result.vars.done).toBe(true);
  });

  it("blocks unsupported steps before running", async () => {
    const flow = mk([{ id: "w", type: "window", op: "close", match: { title: "x" } }]);
    const { result, backend } = await run(flow);
    expect(result.status).toBe("failed");
    expect(result.error?.category).toBe("unsupported");
    expect(backend.effects).toHaveLength(0);
  });

  it("requires approval for risky steps", async () => {
    const flow = mk([{ id: "h", type: "http", method: "POST", url: "https://example.com/api", headers: {} }]);
    expect((await run(flow)).result.error?.category).toBe("user");
    expect((await run(flow, { confirmRisk: async () => true })).result.status).toBe("completed");
  });

  it("asks before running when the screen changed", async () => {
    const flow = mk([{ id: "c", type: "click", target: { kind: "point", x: 1, y: 1, space: "screen" }, button: "left", clicks: 1, holdMs: 0, modifiers: [] }], { screen: { width: 1920, height: 1080, scale: 1 } });
    expect((await run(flow)).result.error?.category).toBe("environment");
    expect((await run(flow, { confirmScreenChange: async () => true })).result.status).toBe("completed");
  });

  it("stops via a declined confirm and via stop step", async () => {
    const b = new SandboxBackend({ confirm: () => false });
    const r1 = await run(mk([{ id: "q", type: "confirm", message: "ok?" }, { id: "x", type: "setVar", name: "after", value: "1" }]), {}, b);
    expect(r1.result.status).toBe("stopped");
    expect(r1.result.vars.after).toBeUndefined();
    const r2 = await run(mk([{ id: "s", type: "stop", reason: "done" }]));
    expect(r2.result).toMatchObject({ status: "stopped", reason: "done" });
  });

  it("debug breakpoints pause the run", async () => {
    const flow = mk([{ id: "a", type: "setVar", name: "x", value: "1" }, { id: "b", type: "setVar", name: "x", value: "2", breakpoint: true }]);
    const r = new FlowRun(flow, new SandboxBackend(), { skipCountdown: true, debug: true });
    const done = r.start();
    await new Promise((res) => setTimeout(res, 10));
    expect(r.currentState).toBe("paused");
    r.resume();
    expect((await done).vars.x).toBe(2);
  });

  it("runs nested flows and goto error recovery", async () => {
    const child = mk([{ id: "cc", type: "setVar", name: "fromChild", value: "'yes'" }], { id: "child" });
    const flow = mk([
      { id: "start", type: "setVar", name: "tries", value: "tries + 1" },
      { id: "call", type: "runFlow", flowId: "child" },
      { id: "fail", type: "setVar", name: "z", value: "tries < 3 ? 1/0 : 1", onError: { strategy: "goto", gotoStepId: "start", retries: 0, backoffMs: 0 } },
    ], { variables: [{ name: "tries", type: "number", initial: 0 }] });
    const { result } = await run(flow, { resolveFlow: (id) => (id === "child" ? child : undefined) });
    expect(result.status).toBe("completed");
    expect(result.vars.tries).toBe(3);
    expect(result.vars.fromChild).toBe("yes");
  });

  it("runs every template in the sandbox (approving risk)", async () => {
    for (const t of TEMPLATES) {
      const flow = structuredClone(t.flow);
      flow.limits.maxDurationMs = Math.min(flow.limits.maxDurationMs, 120_000);
      const { result } = await run(flow, { confirmRisk: async () => true }, new SandboxBackend({ platform: t.platforms.includes("web") ? "web" : t.platforms[0]! }));
      // Forever loops end at the duration limit; everything else completes.
      expect(["completed", "failed"], t.id).toContain(result.status);
      if (result.status === "failed") expect(result.error?.category, t.id).toBe("limit");
    }
  });
});

describe("easy mode round-trip", () => {
  it("is lossless for every repeat mode", () => {
    for (const repeat of [{ mode: "count", count: 7 }, { mode: "duration", ms: 60_000 }, { mode: "untilStopped" }] as const) {
      const m = { ...defaultEasyModel("multiClick"), repeat, points: [{ x: 0.1, y: 0.2, button: "left" as const, clicks: 1 as const, holdMs: 0 }, { x: 0.3, y: 0.4, button: "right" as const, clicks: 2 as const, holdMs: 0 }] };
      const flow = applyEasy(createFlow({ name: "e" }), m);
      const back = toEasy(flow)!;
      expect(back.repeat).toEqual(repeat);
      expect(back.points).toEqual(m.points);
      expect(back.kind).toBe("multiClick");
      expect(parseFlow(flow).ok).toBe(true);
    }
  });
  it("keys and text kinds round-trip", () => {
    const k = applyEasy(createFlow({ name: "k" }), { ...defaultEasyModel("keys"), keys: [{ key: "F5", modifiers: ["ctrl"] }] });
    expect(toEasy(k)?.keys).toEqual([{ key: "F5", modifiers: ["ctrl"] }]);
    const t = applyEasy(createFlow({ name: "t" }), { ...defaultEasyModel("text"), text: "hello" });
    expect(toEasy(t)?.text).toBe("hello");
  });
  it("reports advanced flows as not easy-editable (and never mutates them)", () => {
    const f = TEMPLATES.find((t) => t.id === "form-filler")!.flow;
    const before = JSON.stringify(f);
    expect(toEasy(f)).toBeNull();
    expect(JSON.stringify(f)).toBe(before);
    expect(toEasy(TEMPLATES.find((t) => t.id === "auto-clicker")!.flow)).not.toBeNull();
  });
});

describe("risk, lint and explain", () => {
  it("scores risky flows", () => {
    const f = mk([{ id: "d", type: "file", op: "delete", path: "C:/x" }, { id: "h", type: "http", method: "POST", url: "https://bank.example/transfer", headers: {} }]);
    const r = analyzeRisk(f);
    expect(r.level).toBe("high");
    expect(r.needsConfirm).toBe(true);
    expect(r.permissions).toEqual(["perm.files", "perm.network"]);
    expect(analyzeRisk(TEMPLATES[0]!.flow).level).toBe("low");
  });
  it("lints common mistakes", () => {
    const f = mk([
      { id: "l", type: "loop", mode: "forever", body: [{ id: "c", type: "click", target: { kind: "current" }, button: "left", clicks: 1, holdMs: 0, modifiers: [] }] },
      { id: "b", type: "break" },
      { id: "v", type: "setVar", name: "x", value: "missing + 1" },
      { id: "s", type: "stop" },
      { id: "after", type: "log", message: "never", level: "info" },
    ]);
    const keys = lintFlow(f).map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining(["lint.loopNoWait", "lint.breakOutsideLoop", "lint.unknownVar", "lint.unreachable"]));
    for (const t of TEMPLATES) expect(lintFlow(t.flow).filter((i) => i.severity === "error"), t.id).toEqual([]);
  });
  it("explains flows in plain language", () => {
    const text = explainFlowEn(TEMPLATES[0]!.flow);
    expect(text).toContain("Repeat 100 times:");
    expect(text).toContain("Click left at 50% across, 50% down the screen");
    expect(text).toContain("emergency stop Ctrl+Alt+Escape");
  });
});

describe("recording", () => {
  it("builds clicks, double clicks, drags, waits and masks sensitive typing", () => {
    const steps = eventsToSteps([
      { t: 0, kind: "mouseDown", x: 100, y: 100, button: "left" },
      { t: 50, kind: "mouseUp", x: 100, y: 100, button: "left" },
      { t: 150, kind: "mouseDown", x: 101, y: 100, button: "left" },
      { t: 190, kind: "mouseUp", x: 101, y: 100, button: "left" },
      { t: 1000, kind: "mouseDown", x: 10, y: 10, button: "left" },
      { t: 1300, kind: "mouseUp", x: 200, y: 10, button: "left" },
      { t: 2000, kind: "keyDown", key: "h", modifiers: [] },
      { t: 2050, kind: "keyDown", key: "i", modifiers: [] },
      { t: 2400, kind: "keyDown", key: "Enter", modifiers: [] },
      { t: 3000, kind: "keyDown", key: "p", modifiers: [], sensitive: true },
      { t: 3050, kind: "keyDown", key: "w", modifiers: [], sensitive: true },
    ]);
    const types = steps.map((s) => s.type);
    expect(types).toEqual(["click", "wait", "drag", "wait", "type", "wait", "key", "wait", "type"]);
    expect(steps[0]).toMatchObject({ clicks: 2 });
    expect(steps[4]).toMatchObject({ text: "hi" });
    expect(JSON.stringify(steps)).not.toContain('"pw"');
    expect(steps[8]).toMatchObject({ text: "{{secret:recorded_1}}" });
  });
});

describe("sharing", () => {
  it("round-trips through share codes and export files", async () => {
    const flow = TEMPLATES[4]!.flow;
    const code = await encodeShareCode(flow);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    const back = await decodeShareCode(code);
    expect(back.ok).toBe(true);
    expect(back.flow?.steps).toEqual(flow.steps);
    const file = await exportFlow(flow);
    const imp = await importFlow(file);
    expect(imp.ok && imp.hashMatches).toBe(true);
    const tampered = file.replace("Submit", "Send");
    expect((await importFlow(tampered)).hashMatches).toBe(false);
    expect((await decodeShareCode("!!!")).ok).toBe(false);
  });
});

describe("keyforge profiles", () => {
  it("finds conflicts and resolves the active profile", () => {
    const p = createProfile("Work", "work");
    p.layers[0]!.mappings.push(
      { id: "m1", from: { kind: "key", key: "CapsLock", modifiers: [] }, to: { kind: "key", key: "Escape", modifiers: [] }, repeat: "none", repeatMs: 100, enabled: true },
      { id: "m2", from: { kind: "key", key: "CapsLock", modifiers: [] }, to: { kind: "disabled" }, repeat: "none", repeatMs: 100, enabled: true },
      { id: "m3", from: { kind: "key", key: "Tab", modifiers: ["alt"] }, to: { kind: "disabled" }, repeat: "none", repeatMs: 100, enabled: true },
      { id: "m4", from: { kind: "key", key: "F9", modifiers: [] }, to: { kind: "text", text: "x" }, repeat: "none", repeatMs: 100, enabled: true },
    );
    const kinds = findConflicts(p, [{ flowId: "f1", hotkey: { key: "F9", modifiers: [] } }]).map((c) => c.kind);
    expect(kinds).toEqual(["duplicate", "reserved", "flowHotkey"]);

    const game = { ...createProfile("Game", "game"), priority: 50, rules: [{ kind: "app" as const, app: "game.exe" }] };
    const base = { ...createProfile("Default", "def"), priority: 0 };
    const night = { ...createProfile("Night", "night"), priority: 20, rules: [{ kind: "time" as const, from: "22:00", to: "06:00", days: [0, 1, 2, 3, 4, 5, 6] }] };
    expect(resolveActiveProfile([base, game, night], { app: "game.exe", date: new Date(2026, 0, 1, 12) })?.id).toBe("game");
    expect(resolveActiveProfile([base, game, night], { app: "x.exe", date: new Date(2026, 0, 1, 23) })?.id).toBe("night");
    expect(resolveActiveProfile([base, game, night], { app: "x.exe", date: new Date(2026, 0, 1, 12) })?.id).toBe("def");
  });
});

describe("locales", () => {
  it("matches browser preferences", () => {
    expect(matchLocale(["ko-KR", "en"])).toBe("ko");
    expect(matchLocale(["zh-HK"])).toBe("zh-TW");
    expect(matchLocale(["zh"])).toBe("zh-CN");
    expect(matchLocale(["pt-PT"])).toBe("pt-BR");
    expect(matchLocale(["xx"])).toBe("en");
  });
});
