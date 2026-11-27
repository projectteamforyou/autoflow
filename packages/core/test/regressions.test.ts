import { describe, expect, it } from "vitest";
import {
  ExprError,
  FlowRun,
  SandboxBackend,
  analyzeRisk,
  analyzeRiskWithCalls,
  applyEasy,
  toEasy,
  createFlow,
  createVirtualClock,
  evalExpr,
  isLocalNetworkUrl,
  licenseCheckSymbol,
  normalizeLicenseKey,
  parseFlow,
  sanitizeForSharing,
  type Flow,
  type Step,
  type Value,
} from "../src/index.js";

const mk = (steps: unknown[], extra: Partial<Flow> = {}): Flow => {
  const p = parseFlow({ ...createFlow({ name: "t" }), steps, ...extra });
  if (!p.ok) throw new Error(JSON.stringify(p.issues));
  return p.flow;
};

describe("engine: stop() reaches loops whose bodies never wait", () => {
  const busy = (clock: boolean) => async (steps: unknown[]) => {
    const base = createFlow({ name: "t" });
    const flow = mk(steps, {
      variables: [{ name: "n", type: "number", initial: 0 }] as Flow["variables"],
      limits: { ...base.limits, maxIterations: 100_000_000, maxActions: 100_000_000, maxDurationMs: 3_600_000 },
    });
    const r = new FlowRun(flow, new SandboxBackend(), { skipCountdown: true, ...(clock ? { clock: createVirtualClock() } : {}) });
    const done = r.start();
    await new Promise((res) => setTimeout(res, 50));
    const t0 = Date.now();
    r.stop("test");
    const result = await done;
    return { result, ms: Date.now() - t0 };
  };
  const inc = { id: "s", type: "setVar", name: "n", value: "n + 1" };

  for (const virtual of [false, true]) {
    const go = busy(virtual);
    it(`forever loop (${virtual ? "virtual" : "real"} clock)`, async () => {
      const { result, ms } = await go([{ id: "l", type: "loop", mode: "forever", body: [inc] }]);
      expect(result.status).toBe("stopped");
      expect(result.reason).toBe("test");
      expect(ms).toBeLessThan(1000);
      expect(result.vars.n as number).toBeGreaterThan(0);
    });
  }

  it("forEach over a long list", async () => {
    const { result, ms } = await busy(true)([
      { id: "o", type: "loop", mode: "forever", body: [{ id: "f", type: "forEach", list: "range(100000)", itemVar: "x", body: [inc] }] },
    ]);
    expect(result.status).toBe("stopped");
    expect(ms).toBeLessThan(1000);
  });

  it("goto (on-error jump) cycles", async () => {
    const { result, ms } = await busy(true)([
      { id: "a", type: "setVar", name: "n", value: "n + 1" },
      { id: "b", type: "setVar", name: "n", value: "nope", onError: { strategy: "goto", gotoStepId: "a" } },
    ]);
    expect(result.status).toBe("stopped");
    expect(ms).toBeLessThan(1000);
  });

  it("virtual-clock runs stay fast and deterministic", async () => {
    const flow = mk([{ id: "l", type: "loop", mode: "count", count: 2000, body: [inc] }], {
      variables: [{ name: "n", type: "number", initial: 0 }] as Flow["variables"],
    });
    const t0 = Date.now();
    const result = await new FlowRun(flow, new SandboxBackend(), { skipCountdown: true, clock: createVirtualClock(1_000_000) }).start();
    expect(result.status).toBe("completed");
    expect(result.vars.n).toBe(2000);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe("expressions: bounded work", () => {
  it("charges deep equality on shared nested lists to the step budget", () => {
    let v: Value = [1];
    for (let i = 0; i < 40; i++) v = [v, v];
    const env = { vars: { v, w: [v] } };
    const t0 = Date.now();
    expect(() => evalExpr("v == v", env)).toThrow(ExprError);
    expect(() => evalExpr("v != v", env)).toThrow(/too expensive/);
    expect(() => evalExpr("contains(w, v)", env)).toThrow(/too expensive/);
    expect(Date.now() - t0).toBeLessThan(1000);
    // Ordinary comparisons are unaffected.
    expect(evalExpr("[1, [2, 3]] == [1, [2, 3]]", { vars: {} })).toBe(true);
    expect(evalExpr("contains([[1], [2]], [2])", { vars: {} })).toBe(true);
  });

  it("rejects a self-nesting list (v = [v, v]) once its total node count passes the list limit", async () => {
    // 25 levels of `[v, v]` would be 2^25 leaves behind a top-level length of 2.
    let v: Value = 1;
    let depth = 0;
    const t0 = Date.now();
    expect(() => {
      for (; depth < 25; depth++) v = evalExpr("[v, v]", { vars: { v } });
    }).toThrow(/list too large/);
    expect(depth).toBeGreaterThanOrEqual(10);
    expect(depth).toBeLessThan(25);
    expect(Date.now() - t0).toBeLessThan(1000);
    // Same through the engine: setVar v = [v, v] in a loop fails the run instead of exhausting memory.
    const flow = mk([{ id: "l", type: "loop", mode: "count", count: 30, body: [{ id: "s", type: "setVar", name: "v", value: "[v, v]" }] }], {
      variables: [{ name: "v", type: "list", initial: [1] }] as Flow["variables"],
    });
    const result = await new FlowRun(flow, new SandboxBackend(), { skipCountdown: true, clock: createVirtualClock() }).start();
    expect(result.status).toBe("failed");
    expect(result.error?.message).toMatch(/list too large/);
    // Ordinary nesting is unaffected.
    expect(evalExpr("len([[1, [2]], [3]])", { vars: {} })).toBe(2);
  });

  it("range() rejects bounds beyond the safe-integer range instead of hanging", () => {
    for (const src of ["range(1e17, 1e17 + 32)", "range(-1e17, -1e17 + 5)", "range(1e300)", "range(0 - 1e300, 0)"]) {
      expect(() => evalExpr(src, { vars: {} }), src).toThrow(ExprError);
    }
    expect(evalExpr("range(2, 5)", { vars: {} })).toEqual([2, 3, 4]);
    expect(evalExpr("range(0.5, 3)", { vars: {} })).toEqual([0.5, 1.5, 2.5]);
  });
});

describe("engine: variables named like Object.prototype members", () => {
  it("treats __proto__ / constructor as ordinary variables", async () => {
    const flow = mk(
      [
        { id: "a", type: "setVar", name: "__proto__", value: "[1, 2]" },
        { id: "b", type: "setVar", name: "n", value: "len(__proto__) + len(constructor)" },
      ],
      {
        variables: [
          { name: "__proto__", type: "list", initial: [] },
          { name: "constructor", type: "string" },
          { name: "n", type: "number", initial: 0 },
        ] as Flow["variables"],
      },
    );
    const result = await new FlowRun(flow, new SandboxBackend(), { skipCountdown: true, clock: createVirtualClock(), inputs: {} }).start();
    expect(result.status).toBe("completed");
    expect(Object.prototype.hasOwnProperty.call(result.vars, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(result.vars, "__proto__")?.value).toEqual([1, 2]);
    expect(result.vars.constructor).toBe("");
    expect(result.vars.n).toBe(2);
  });
});

describe("risk: dynamic and local targets", () => {
  const risk = (steps: unknown[]) => analyzeRisk(mk(steps));
  const keys = (steps: unknown[]) => risk(steps).findings.map((f) => f.key);

  it("dynamic openUrl needs confirmation", () => {
    const r = risk([{ id: "o", type: "openUrl", url: "https://my{{'ba'}}nk.com/trans{{'fer'}}" }]);
    expect(r.needsConfirm).toBe(true);
    expect(r.findings.map((f) => f.key)).toContain("risk.dynamicUrl");
    expect(risk([{ id: "o", type: "openUrl", url: "https://example.com/" }]).needsConfirm).toBe(false);
  });

  it("http GET with interpolated url/headers or a local host needs confirmation", () => {
    const get = (url: string, headers: Record<string, string> = {}) => [{ id: "h", type: "http", method: "GET", url, headers }];
    expect(risk(get("https://example.com/data")).needsConfirm).toBe(false);
    expect(keys(get("https://example.com/?q={{name}}"))).toContain("risk.dynamicUrl");
    expect(risk(get("https://example.com/?q={{name}}")).needsConfirm).toBe(true);
    const hdr = risk(get("https://example.com/", { Authorization: "Bearer {{secret:tok}}" }));
    expect(hdr.needsConfirm).toBe(true);
    expect(hdr.findings.map((f) => f.key)).toContain("risk.requestVars");
    for (const u of [
      "http://localhost:8080/",
      "http://LOCALHOST./",
      "http://api.localhost/",
      "http://127.0.0.1/",
      "http://2130706433/",
      "http://10.1.2.3/",
      "http://172.16.0.1/",
      "http://172.31.255.255/",
      "http://192.168.0.1/admin",
      "http://169.254.169.254/latest/meta-data",
      "http://0.0.0.0/",
      "http://[::1]/",
      "http://[fc00::1]/",
      "http://[fd12:3456::1]/",
      "http://[fe80::1]/",
      "http://[::ffff:192.168.1.1]/",
    ]) {
      const r = risk(get(u));
      expect(r.needsConfirm, u).toBe(true);
      expect(r.findings.map((f) => f.key), u).toContain("risk.localNetwork");
    }
    for (const u of ["http://172.32.0.1/", "http://8.8.8.8/", "http://[2001:db8::1]/", "https://localhost.example.com/"]) {
      expect(isLocalNetworkUrl(u), u).toBe(false);
    }
  });

  it("file append and copy need confirmation", () => {
    for (const op of ["append", "copy"]) {
      expect(risk([{ id: "f", type: "file", op, path: "a.txt", dest: "b.txt", content: "x" }]).needsConfirm, op).toBe(true);
    }
    expect(risk([{ id: "f", type: "file", op: "read", path: "a.txt" }]).needsConfirm).toBe(false);
  });
});

describe("license check symbol", () => {
  it("documents the one adjacent swap Luhn mod 32 cannot see (0 <-> Z)", () => {
    const tail = "5".repeat(17);
    expect(licenseCheckSymbol(`0Z${tail}`)).toBe(licenseCheckSymbol(`Z0${tail}`));
    const body = `Z0${tail}${licenseCheckSymbol(`0Z${tail}`)}`;
    expect(normalizeLicenseKey(body)).not.toBeNull();
    // Every other adjacent swap is caught.
    expect(licenseCheckSymbol(`12${tail}`)).not.toBe(licenseCheckSymbol(`21${tail}`));
    expect(licenseCheckSymbol(`0Y${tail}`)).not.toBe(licenseCheckSymbol(`Y0${tail}`));
  });
});

describe("sharing: literal credentials never pass as secret-only", () => {
  it("replaces literal header values and keeps pure secret references", () => {
    const headers: Record<string, string> = {
      "X-Api-Key": "sk-ABCdef ",
      Authorization: "Bearer {{secret:tok}}",
      "X-Auth-Token": "",
      "Api-Key": " {{secret:a}} {{secret:b}} ",
      Cookie: "Bearer sk-live",
      "Proxy-Authorization": "Basic ",
    };
    const flow = mk([{ id: "h", type: "http", method: "GET", url: "https://example.com/", headers }]);
    const out = sanitizeForSharing(flow).steps[0] as Extract<Step, { type: "http" }>;
    expect(out.headers["X-Api-Key"]).toBe("{{secret:http_x_api_key}}");
    expect(out.headers.Authorization).toBe("Bearer {{secret:tok}}");
    expect(out.headers["X-Auth-Token"]).toBe("");
    expect(out.headers["Api-Key"]).toBe(" {{secret:a}} {{secret:b}} ");
    expect(out.headers.Cookie).toBe("Bearer {{secret:http_cookie}}");
    expect(out.headers["Proxy-Authorization"]).toBe("Basic {{secret:http_proxy_authorization}}");
  });
});

describe("2026-11-27 audit", () => {
  const click = (id: string, extra: Record<string, unknown> = {}): Step => ({ id, type: "click", target: { kind: "point", x: 0.5, y: 0.5, space: "normalized" }, button: "left", clicks: 1, holdMs: 0, modifiers: [], ...extra }) as Step;
  const wait = (id: string): Step => ({ id, type: "wait", ms: 250, jitterMs: 0 }) as Step;
  const easyShaped = (loopExtra: Record<string, unknown> = {}, clickExtra: Record<string, unknown> = {}, before: Step[] = []): Flow => {
    const r = parseFlow({
      ...createFlow({ name: "x" }),
      mode: "pro",
      steps: [...before, { id: "L", type: "loop", mode: "count", count: 3, body: [click("c", clickExtra), wait("w")], ...loopExtra }],
      hotkeys: { start: { key: "F6", modifiers: ["ctrl"] }, stop: { key: "Escape", modifiers: ["ctrl", "alt"] } },
    });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    return r.flow;
  };

  it("Easy mode is offered only when its model can hold everything in the flow", () => {
    expect(toEasy(easyShaped())).not.toBeNull();
    expect(toEasy(easyShaped({ label: "Farm loop" }))).toBeNull();
    expect(toEasy(easyShaped({ stepTimeoutMs: 60_000 }))).toBeNull();
    expect(toEasy(easyShaped({ onError: { strategy: "retry", retries: 3, backoffMs: 500 } }))).toBeNull();
    expect(toEasy(easyShaped({}, { stepTimeoutMs: 2000 }))).toBeNull();
    expect(toEasy(easyShaped({}, { breakpoint: true }))).toBeNull();
    expect(toEasy(easyShaped({}, {}, [{ id: "note", type: "log", level: "info", message: "later", disabled: true } as Step]))).toBeNull();
  });

  it("clearing the start hotkey in Easy mode clears it on the flow", () => {
    const flow = easyShaped();
    const m = toEasy(flow)!;
    expect(applyEasy(flow, m).hotkeys.start).toEqual({ key: "F6", modifiers: ["ctrl"] });
    expect(applyEasy(flow, { ...m, startHotkey: undefined }).hotkeys.start).toBeUndefined();
  });

  it("the risk report of a caller covers the flows it runs", () => {
    const callee = { ...createFlow({ name: "callee", id: "f_callee" }), steps: [{ id: "h", type: "http", method: "POST", url: "https://example.com/x", headers: {}, body: "{{secret:k}}", timeoutMs: 5000 } as Step] };
    const caller = { ...createFlow({ name: "caller", id: "f_caller" }), steps: [{ id: "r", type: "runFlow", flowId: "f_callee" } as Step] };
    const resolve = (id: string) => (id === "f_callee" ? callee : id === "f_caller" ? caller : undefined);
    expect(analyzeRisk(callee).needsConfirm).toBe(true);
    expect(analyzeRisk(caller).needsConfirm).toBe(false);
    expect(analyzeRiskWithCalls(caller, resolve).needsConfirm).toBe(true);
    expect(FlowRun.preflight(caller as Flow, "web", resolve as (id: string) => Flow | undefined).risk.needsConfirm).toBe(true);
    // A cycle or an unknown id does not loop or throw.
    const loopy = { ...caller, steps: [...caller.steps, { id: "r2", type: "runFlow", flowId: "f_caller" } as Step, { id: "r3", type: "runFlow", flowId: "f_missing" } as Step] };
    expect(analyzeRiskWithCalls(loopy, resolve).needsConfirm).toBe(true);
  });

  it("Halt ends an open sandbox question instead of waiting for an answer", async () => {
    const backend = new SandboxBackend({ platform: "web", confirm: () => new Promise<boolean>(() => undefined) });
    const ctrl = new AbortController();
    const asked = backend.confirm("Continue?", ctrl.signal);
    ctrl.abort(new Error("halt"));
    await expect(asked).rejects.toThrow("halt");
  });

  it("a called flow gets its own declared variables; the caller's values win", async () => {
    const callee = mk([{ id: "s", type: "setVar", name: "out", value: 'greeting + "!"' }], {
      id: "f_callee",
      variables: [
        { name: "greeting", type: "string", initial: "hi" },
        { name: "out", type: "string", initial: "" },
      ] as Flow["variables"],
    });
    const run = async (callerVars: Flow["variables"]) => {
      const caller = mk([{ id: "r", type: "runFlow", flowId: "f_callee" }], { variables: callerVars });
      const fr = new FlowRun(caller, new SandboxBackend({ platform: "web" }), { skipCountdown: true, clock: createVirtualClock(), resolveFlow: (id) => (id === "f_callee" ? callee : undefined), inputs: { greeting: "from input" } });
      const r = await fr.start();
      return { status: r.status, out: r.vars.out };
    };
    // Not declared by the caller: the callee's own initial value is used (run inputs are for the caller only).
    expect(await run([])).toEqual({ status: "completed", out: "hi!" });
    // Declared by the caller: its value is kept.
    expect(await run([{ name: "greeting", type: "string", initial: "yo" }] as Flow["variables"])).toEqual({ status: "completed", out: "from input!" });
  });
});
