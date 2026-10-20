import { describe, expect, it } from "vitest";
import {
  ExprError,
  FlowRun,
  SandboxBackend,
  analyzeRisk,
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
