import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FlowRun,
  PracticeWorld,
  SandboxBackend,
  TEMPLATES,
  analyzeRisk,
  createFlow,
  createVirtualClock,
  dhash,
  displayRefs,
  eventsToSteps,
  explainFlowEn,
  findDisplay,
  hammingDistance,
  hashSimilarity,
  lintFlow,
  parseFlow,
  practiceDisplays,
  practiceSceneHash,
  realClock,
  sortDisplays,
  compatibility,
  type DisplayInfo,
  type Flow,
  type FlowInput,
  type RunEvent,
  type Step,
} from "../src/index.js";

const mk = (steps: unknown[], extra: Partial<FlowInput> = {}): Flow => {
  const r = parseFlow({ schemaVersion: "1.0", id: "f_disp", name: "t", createdAt: "2026-10-19T00:00:00.000Z", updatedAt: "2026-10-19T00:00:00.000Z", steps, ...extra });
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.flow;
};
const display = (id: string, primary: boolean, x: number, y: number, w: number, h: number): DisplayInfo => ({ id, name: id, primary, bounds: { x, y, w, h }, workArea: { x, y, w, h }, scale: 1, orientation: w >= h ? "landscape" : "portrait" });
const DESK = [display("RIGHT", false, 1920, 0, 1280, 1024), display("MAIN", true, 0, 0, 1920, 1080), display("LEFT", false, -1080, 0, 1080, 1920)];

const run = async (flow: Flow, backend: SandboxBackend, opts: ConstructorParameters<typeof FlowRun>[2] = {}) => {
  const clock = createVirtualClock(1_000_000);
  const events: RunEvent[] = [];
  const r = new FlowRun(flow, backend, { clock, skipCountdown: true, random: () => 0, confirmRisk: async () => true, onEvent: (e) => events.push(e), ...opts });
  const result = await r.start();
  return { result, events, clock };
};
const clicks = (b: SandboxBackend) => b.effects.filter((e) => e.action.type === "click").map((e) => e.points![0]);

describe("display model", () => {
  it("sorts displays canonically and resolves every kind of reference", () => {
    const sorted = sortDisplays(DESK);
    expect(sorted.map((d) => d.id)).toEqual(["MAIN", "LEFT", "RIGHT"]);
    expect(findDisplay(sorted, "primary")?.id).toBe("MAIN");
    expect(findDisplay(sorted, "secondary")?.id).toBe("LEFT");
    expect(findDisplay(sorted, { index: 2 })?.id).toBe("RIGHT");
    expect(findDisplay(sorted, "RIGHT")?.id).toBe("RIGHT");
    expect(findDisplay(sorted, { index: 3 })).toBeUndefined();
  });

  it("computes bit-exact dHashes (shared fixture) and similarities", () => {
    const fx = JSON.parse(readFileSync(new URL("../fixtures/engine/dhash.json", import.meta.url), "utf8")) as { images: { name: string; w: number; h: number; rgb: string; hash: string }[]; pairs: { a: string; b: string; similarity: number }[] };
    expect(fx.images.length).toBeGreaterThanOrEqual(8);
    const byName = new Map(fx.images.map((i) => [i.name, i]));
    for (const im of fx.images) expect(dhash(Buffer.from(im.rgb, "hex"), im.w, im.h, 3), im.name).toBe(im.hash);
    for (const p of fx.pairs) expect(hashSimilarity(byName.get(p.a)!.hash, byName.get(p.b)!.hash)).toBe(p.similarity);
    expect(hammingDistance("ffffffffffffffff", "0000000000000000")).toBe(64);
    expect(hammingDistance("zz", "0000000000000000")).toBe(64);
    expect(hashSimilarity("f0f0f0f0f0f0f0f0", "f0f0f0f0f0f0f0f3")).toBe(62 / 64);
  });

  it("tells the practice scenes apart and keeps them stable across resolutions", () => {
    const [lobby, battle, reward] = (["lobby", "battle", "reward"] as const).map((s) => practiceSceneHash(s));
    expect(hashSimilarity(lobby!, battle!)).toBeLessThan(0.7);
    expect(hashSimilarity(lobby!, reward!)).toBeLessThan(0.7);
    const big = new PracticeWorld({ displays: 1, displayWidth: 2560, displayHeight: 1440, now: () => 0 });
    expect(hashSimilarity(big.sceneHash({ x: 0, y: 144, w: 2560, h: 1296 }), lobby!)).toBeGreaterThanOrEqual(0.9);
  });
});

describe("schema", () => {
  it("accepts the new optional fields and keeps old flows unchanged", () => {
    const f = mk([{ id: "c", type: "click", target: { kind: "point", x: 0.5, y: 0.5, space: "normalized", display: { index: 1 } } }], {
      stage: { display: "secondary" },
      onMissingDisplay: "primary",
      scenes: [{ name: "lobby", region: { x: 0, y: 0, w: 1, h: 1 }, hash: "00ff00ff00ff00ff" }],
    });
    expect(f.stage?.display).toBe("secondary");
    const old = mk([{ id: "i", type: "if", condition: { expr: "1 < 2" }, then: [], else: [] }]);
    expect(old.steps[0]).toEqual({ id: "i", type: "if", condition: { expr: "1 < 2" }, then: [], else: [] });
    // A scene-only condition gets expr "true".
    const sc = mk([{ id: "w", type: "waitFor", condition: { scene: { name: "lobby" } } }], { scenes: [{ name: "lobby", region: { x: 0, y: 0, w: 1, h: 1 }, hash: "00ff00ff00ff00ff" }] });
    expect(sc.steps[0]).toMatchObject({ condition: { expr: "true", scene: { name: "lobby", minSimilarity: 0.9 } } });
  });

  it("rejects bad scenes, duplicate names and oversized thumbnails", () => {
    const base = { schemaVersion: "1.0", id: "f", name: "t", createdAt: "2026-10-19T00:00:00.000Z", updatedAt: "2026-10-19T00:00:00.000Z", steps: [] };
    const scene = (extra: object) => ({ name: "a", region: { x: 0, y: 0, w: 1, h: 1 }, hash: "0123456789abcdef", ...extra });
    expect(parseFlow({ ...base, scenes: [scene({ hash: "xyz" })] }).ok).toBe(false);
    expect(parseFlow({ ...base, scenes: [scene({ region: { x: 0.5, y: 0, w: 0.6, h: 1 } })] }).ok).toBe(false);
    expect(parseFlow({ ...base, scenes: [scene({}), scene({})] }).ok).toBe(false);
    expect(parseFlow({ ...base, scenes: [scene({ thumb: `data:image/png;base64,${"A".repeat(30_000)}` })] }).ok).toBe(false);
    expect(parseFlow({ ...base, scenes: [scene({ thumb: "javascript:alert(1)" })] }).ok).toBe(false);
    expect(parseFlow({ ...base, scenes: [scene({ thumb: "data:image/png;base64,iVBORw0KGgo=" })] }).ok).toBe(true);
    expect(parseFlow({ ...base, stage: { display: { index: 99 } } }).ok).toBe(false);
  });
});

describe("multi-monitor engine", () => {
  it("places display-relative targets and leaves legacy targets alone", async () => {
    const b = new SandboxBackend({ displays: DESK, screen: { width: 1920, height: 1080, scale: 1 } });
    const { result } = await run(
      mk([
        { id: "a", type: "click", target: { kind: "point", x: 0.5, y: 0.5, space: "normalized", display: "RIGHT" } },
        { id: "b", type: "click", target: { kind: "point", x: 10.5, y: 10, space: "display", display: "secondary" } },
        { id: "c", type: "click", target: { kind: "point", x: 0.5, y: 0.5, space: "normalized" } },
      ]),
      b,
    );
    expect(result.status).toBe("completed");
    expect(clicks(b)).toEqual([{ x: 2560, y: 512 }, { x: -1069, y: 10 }, { x: 960, y: 540 }]);
  });

  it("never clicks a missing display silently", async () => {
    const one = [display("MAIN", true, 0, 0, 1920, 1080)];
    const flow = (policy?: "fail" | "primary" | "ask") => mk([{ id: "c", type: "click", target: { kind: "point", x: 0.5, y: 0.5, space: "normalized", display: "secondary" } }], policy ? { onMissingDisplay: policy } : {});
    const failed = await run(flow(), new SandboxBackend({ displays: one }));
    expect(failed.result.error).toMatchObject({ category: "display", message: 'display "secondary" is not connected' });
    const b = new SandboxBackend({ displays: one });
    const used = await run(flow("primary"), b);
    expect(used.result.status).toBe("completed");
    expect(clicks(b)).toEqual([{ x: 960, y: 540 }]);
    expect(used.events.some((e) => e.type === "log" && e.level === "warn" && e.message.includes("not connected"))).toBe(true);
    const asked: string[] = [];
    const declined = await run(flow("ask"), new SandboxBackend({ displays: one }), { confirmMissingDisplay: async (l) => (asked.push(l), false) });
    expect(asked).toEqual(['"secondary"']);
    expect(declined.result.error?.category).toBe("display");
  });

  it("puts normalized targets on the stage and fails a missing stage before the countdown", async () => {
    const b = new SandboxBackend({ displays: DESK });
    await run(mk([{ id: "c", type: "click", target: { kind: "point", x: 0.25, y: 0.5, space: "normalized" } }], { stage: { display: "RIGHT" } }), b);
    expect(clicks(b)).toEqual([{ x: 2240, y: 512 }]);
    const r = await run(mk([{ id: "c", type: "click", target: { kind: "point", x: 1, y: 1 } }], { stage: { display: "RIGHT" } }), new SandboxBackend({ displays: [DESK[1]!] }), { skipCountdown: false });
    expect(r.result.error?.category).toBe("display");
    expect(r.events.some((e) => e.type === "countdown")).toBe(false);
  });

  it("pauses when the user takes over the pointer and resumes on request", async () => {
    const b = new SandboxBackend({ displays: DESK });
    const flow = mk(
      [
        { id: "a", type: "click", target: { kind: "point", x: 0.5, y: 0.5, space: "normalized" } },
        { id: "w", type: "wait", ms: 100 },
        { id: "b", type: "click", target: { kind: "point", x: 0.6, y: 0.5, space: "normalized" } },
      ],
      { stage: { display: "RIGHT" } },
    );
    const events: RunEvent[] = [];
    const r = new FlowRun(flow, b, { clock: createVirtualClock(0), skipCountdown: true, onEvent: (e) => events.push(e) });
    const origWait = b.perform.bind(b);
    b.perform = async (a, s) => {
      const v = await origWait(a, s);
      if (a.type === "click" && b.effects.length === 1) b.pointer = { x: 100, y: 100 }; // the user grabs the mouse on the deck
      return v;
    };
    const done = r.start();
    for (let i = 0; i < 50 && r.currentState !== "paused"; i++) await new Promise((res) => setTimeout(res, 1));
    expect(r.currentState).toBe("paused");
    expect(events.some((e) => e.type === "log" && e.message.startsWith("takeover:"))).toBe(true);
    expect(clicks(b)).toHaveLength(1);
    r.resume();
    expect((await done).status).toBe("completed");
    expect(clicks(b)).toHaveLength(2);
  });

  it("does not pause when takeover detection is off", async () => {
    const b = new SandboxBackend({ displays: DESK });
    b.perform = ((orig) => async (a, s) => {
      const v = await orig(a, s);
      b.pointer = { x: 5, y: 5 };
      return v;
    })(b.perform.bind(b));
    const { result } = await run(mk([{ id: "a", type: "click", target: { kind: "point", x: 0.5, y: 0.5, space: "normalized" } }, { id: "b", type: "click", target: { kind: "point", x: 0.6, y: 0.5, space: "normalized" } }], { stage: { display: "RIGHT", pauseOnTakeover: false } }), b);
    expect(result.status).toBe("completed");
  });

  it("keeps a loop cooldown between round starts", async () => {
    const { result } = await run(mk([{ id: "l", type: "loop", mode: "count", count: 3, cooldownMs: 1000, body: [{ id: "w", type: "wait", ms: 200 }] }]), new SandboxBackend());
    expect(result.durationMs).toBe(2200);
  });

  it("plays the idle-game template on a two-monitor practice world", async () => {
    const tpl = TEMPLATES.find((x) => x.id === "idle-collect")!;
    const clock = createVirtualClock(0);
    const world = new PracticeWorld({ displays: 2, now: () => clock.now() });
    const b = new SandboxBackend({ world, now: () => clock.now() });
    const events: RunEvent[] = [];
    const r = await new FlowRun(tpl.flow, b, { clock, skipCountdown: true, random: () => 0.5, confirmRisk: async () => true, onEvent: (e) => events.push(e) }).start();
    expect(r.status).toBe("completed");
    expect(world.coins).toBe(30);
    expect(r.vars.collected).toBe(3);
    expect(clicks(b).every((p) => p!.x >= 1280)).toBe(true); // every click landed on the stage (monitor 2)
    expect(events.filter((e) => e.type === "log").map((e) => (e as { message: string }).message)).toContain("Collected round 3 of 3");
  });

  it("matches scenes, reads pixels and waits for a pixel in the practice world", async () => {
    const clock = createVirtualClock(0);
    const world = new PracticeWorld({ displays: 3, stageIndex: 2, now: () => clock.now() });
    const b = new SandboxBackend({ world });
    const scenes = (["lobby", "battle", "reward"] as const).map((name) => ({ name, region: { x: 0, y: 0.1, w: 1, h: 0.9 }, hash: practiceSceneHash(name) }));
    const { result } = await run(
      mk(
        [
          { id: "m1", type: "matchScene", resultVar: "s1" },
          { id: "px", type: "pixelCheck", at: { kind: "point", x: 0.5, y: 0.68, space: "normalized" }, resultVar: "color" },
          { id: "go", type: "click", target: { kind: "point", x: 0.5, y: 0.68, space: "normalized" } },
          { id: "m2", type: "matchScene", resultVar: "s2", similarityVar: "sim" },
          { id: "wp", type: "waitForPixel", at: { kind: "point", x: 0.5, y: 0.76, space: "normalized" }, color: "#f1c40f", pollMs: 100, timeoutMs: 5000 },
          { id: "m3", type: "matchScene", resultVar: "s3" },
        ],
        { stage: { display: { index: 2 } }, scenes },
      ),
      b,
      { clock },
    );
    expect(result.status).toBe("completed");
    expect(result.vars).toMatchObject({ s1: "lobby", color: "#2ecc71", s2: "battle", sim: 1, s3: "reward" });
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
  });
});

describe("tooling", () => {
  it("lints missing scenes, display fallbacks and open-ended pixel waits", () => {
    const f = mk([
      { id: "w", type: "waitFor", condition: { scene: { name: "ghost" } } },
      { id: "p", type: "waitForPixel", at: { kind: "point", x: 1, y: 1, space: "display", display: "secondary" }, color: "#000000" },
      { id: "m", type: "matchScene", resultVar: "r" },
    ]);
    const keys = lintFlow(f).map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining(["lint.sceneMissing", "lint.pixelNoTimeout", "lint.displayNoFallback", "lint.noScenes"]));
    expect(displayRefs(f)).toEqual(["secondary"]);
    const ok = mk([{ id: "l", type: "loop", mode: "forever", cooldownMs: 1000, body: [{ id: "c", type: "click", target: { kind: "point", x: 1, y: 1 } }] }], { onMissingDisplay: "fail", stage: { display: "secondary" } });
    expect(lintFlow(ok).map((i) => i.key)).not.toContain("lint.loopNoWait");
    expect(lintFlow(ok).map((i) => i.key)).not.toContain("lint.displayNoFallback");
  });

  it("scores stage runs without the takeover pause and blocks screen probes on Android", () => {
    const steps = [{ id: "i", type: "if", condition: { pixel: { at: { kind: "point", x: 1, y: 1 }, color: "#ffffff" } }, then: [], else: [] }];
    const paused = analyzeRisk(mk(steps, { stage: { display: "secondary" } }));
    const free = analyzeRisk(mk(steps, { stage: { display: "secondary", pauseOnTakeover: false } }));
    expect(free.score).toBeGreaterThan(paused.score);
    expect(free.findings.map((f) => f.key)).toContain("risk.stageNoTakeover");
    expect(paused.permissions).toContain("perm.screen");
    expect(compatibility(mk(steps).steps, "android")[0]).toMatchObject({ support: "unsupported", noteKey: "cap.screenProbe.android" });
    expect(compatibility(mk(steps).steps, "windows")).toEqual([]);
  });

  it("explains stage, scenes, pixels and cooldowns", () => {
    const tpl = TEMPLATES.find((x) => x.id === "idle-collect")!;
    const text = explainFlowEn(tpl.flow);
    expect(text).toContain("Plays on the second display; pauses as soon as you move the mouse");
    expect(text).toContain("Repeat while collected < rounds, at most once every 400ms:");
    const f = mk([{ id: "p", type: "waitForPixel", at: { kind: "point", x: 0.5, y: 0.5, space: "normalized", display: { index: 1 } }, color: "#00ff00", timeoutMs: 2000 }, { id: "i", type: "if", condition: { scene: { name: "a", not: true }, expr: "x > 1" }, then: [], else: [] }]);
    const lines = explainFlowEn(f);
    expect(lines).toContain("Wait until 50% across, 50% down display 2 shows #00ff00 (up to 2s)");
    expect(lines).toContain("If the screen does not show scene “a” and x > 1:");
  });

  it("records points relative to the display they happened on", () => {
    const steps = eventsToSteps(
      [
        { t: 0, kind: "mouseDown", x: -540, y: 960, button: "left" },
        { t: 50, kind: "mouseUp", x: -540, y: 960, button: "left" },
        { t: 900, kind: "mouseDown", x: 2560, y: 512, button: "left", displayId: "RIGHT" },
        { t: 950, kind: "mouseUp", x: 2560, y: 512, button: "left", displayId: "RIGHT" },
      ],
      { displays: DESK },
    );
    const targets = steps.filter((s): s is Extract<Step, { type: "click" }> => s.type === "click").map((s) => s.target);
    expect(targets).toEqual([
      { kind: "point", x: 0.5, y: 0.5, space: "normalized", display: "LEFT" },
      { kind: "point", x: 0.5, y: 0.5, space: "normalized", display: "RIGHT" },
    ]);
  });

  it("ships verified stage templates that pass lint without errors", () => {
    for (const id of ["idle-collect", "stage-ready-clicker", "daily-check-in"]) {
      const tpl = TEMPLATES.find((x) => x.id === id)!;
      expect(tpl.category).toBe("gaming");
      expect(lintFlow(tpl.flow).filter((i) => i.severity === "error")).toEqual([]);
    }
    expect(practiceDisplays(3).map((d) => d.bounds.x)).toEqual([0, 1280, 2560]);
    expect(createFlow({ name: "x" }).stage).toBeUndefined();
    void realClock;
  });
});
