// Writes fixtures/engine/conformance.json: engine-v2 scenarios (timeouts, retry backoff, step budget,
// humanization, secret masking) with the outcome produced by the TypeScript engine. The Rust
// (crates/engine/tests/conformance.rs) and Kotlin (engine ConformanceTest) executors replay every
// case and must produce the same status, error, virtual duration, counters, retry delays, timeouts,
// log lines and click coordinates.
//
// Multi-monitor cases add `displays` (reported in this order; engines sort them), scripted probe
// answers (`pixels` keyed "x,y" and `sceneHashes` keyed "x,y,w,h": each call takes the next value,
// the last one repeats; unknown keys answer #000000 / 0000000000000000) and expect the final `vars`
// and every probe in call order (`probes`: [x, y] pixels and [x, y, w, h] scene regions).
//
// Also writes fixtures/engine/dhash.json: fixed RGB images with their dHash, which every engine's
// dHash implementation must reproduce bit for bit, plus pairwise similarities.
import { mkdirSync, writeFileSync } from "node:fs";
import { FlowRun, SandboxBackend, createVirtualClock, dhash, hashSimilarity, mulberry32, parseFlow } from "../dist/index.js";

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

/* ------------------------------------------------------------ multi-monitor */

const display = (id, primary, x, y, w, h, scale = 1) => ({ id, name: id, primary, bounds: { x, y, w, h }, workArea: { x, y, w, h: h - 40 }, scale, orientation: w >= h ? "landscape" : "portrait" });
// Reported out of order on purpose. Canonical order: MAIN (primary), LEFT (x -1080), RIGHT (x 1920).
const DESK = [display("RIGHT", false, 1920, -200, 1280, 1024, 1.25), display("LEFT", false, -1080, 0, 1080, 1920), display("MAIN", true, 0, 0, 1920, 1080)];
const MAIN_ONLY = [display("MAIN", true, 0, 0, 1920, 1080)];
const pt = (x, y, space, extra = {}) => ({ kind: "point", x, y, space, ...extra });
const H = { lobby: "ffffffffffcfffff", reward: "000c0c0c0c0c0c00", battle: "a5a5a5a5a5a5a5a5" };
// Hashes 2 / 5 / 10 bits away from the live answer "f0f0f0f0f0f0f0f0".
const LIVE = "f0f0f0f0f0f0f0f0";
const SCENES = [
  { name: "near", region: { x: 0, y: 0, w: 1, h: 1 }, hash: "f0f0f0f0f0f0f0f3" },
  { name: "mid", region: { x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, display: "LEFT", hash: "f0f0f0f0f0f0f01f" },
  { name: "far", region: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 }, display: { index: 2 }, hash: "f0f0f0f0f0f00f03" },
];

cases.push(
  {
    name: "display-targets",
    displays: DESK,
    flow: flow([
      { id: "a", type: "click", target: pt(0.5, 0.25, "normalized", { display: "secondary" }) },
      { id: "b", type: "click", target: pt(10.5, 20.5, "display", { display: { index: 2 } }) },
      { id: "c", type: "click", target: pt(10.5, 7.5, "display", { display: "LEFT" }) },
      { id: "d", type: "click", target: pt(100, 100, "screen", { display: "primary" }) },
      { id: "e", type: "click", target: pt(0.5, 0.5, "normalized") },
      { id: "f", type: "click", target: { kind: "region", x: 0.25, y: 0.25, w: 0.5, h: 0.5, space: "normalized", display: "RIGHT" } },
      { id: "g", type: "drag", from: pt(0.1, 0.9, "normalized", { display: "LEFT" }), to: pt(5, 5, "display") },
    ]),
  },
  { name: "display-missing-fails", displays: DESK, flow: flow([click("ok"), { id: "x", type: "click", target: pt(0.5, 0.5, "normalized", { display: { index: 5 } }) }]) },
  {
    name: "display-missing-uses-primary",
    displays: MAIN_ONLY,
    flow: flow([{ id: "l", type: "loop", mode: "count", count: 2, body: [{ id: "c", type: "click", target: pt(0.25, 0.5, "normalized", { display: "secondary" }) }] }], { onMissingDisplay: "primary" }),
  },
  {
    name: "display-missing-asks-once",
    displays: MAIN_ONLY,
    flow: flow([{ id: "l", type: "loop", mode: "count", count: 2, body: [{ id: "c", type: "click", target: pt(3, 4, "display", { display: "RIGHT" }) }] }], { onMissingDisplay: "ask" }),
  },
  { name: "display-point-outside", displays: DESK, flow: flow([{ id: "o", type: "click", target: pt(2000, 10, "display", { display: "primary" }), onError: { strategy: "continue" } }, click("after")]) },
  {
    name: "stage-places-normalized-targets",
    displays: DESK,
    flow: flow(
      [
        { id: "s", type: "click", target: pt(0.5, 0.5, "normalized") },
        { id: "t", type: "click", target: pt(0.75, 0.1, "normalized") },
        { id: "u", type: "scroll", dy: 3, target: pt(1, 1, "display") },
        { id: "v", type: "click", target: pt(10, 10, "screen") },
      ],
      { stage: { display: "secondary" }, humanize: { offsetPx: 5, delayMs: 30, seed: 7 } },
    ),
  },
  { name: "stage-missing-fails-before-running", displays: MAIN_ONLY, flow: flow([click("never")], { stage: { display: "secondary" } }) },
  {
    name: "pixel-steps",
    displays: DESK,
    pixels: { "960,540": ["#2ECC71", "#2ecc71", "#102030"], "-540,960": ["#000000", "#000000", "#2ecc71"], "1984,-149": ["#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff"] },
    flow: flow([
      { id: "read", type: "pixelCheck", at: pt(0.5, 0.5, "normalized", { display: "primary" }), resultVar: "c" },
      { id: "cmp", type: "pixelCheck", at: pt(960, 540, "screen"), color: "#30d080", tolerance: 24, resultVar: "ok" },
      { id: "strict", type: "pixelCheck", at: pt(960, 540, "display"), color: "#30d080", tolerance: 4, resultVar: "strict" },
      { id: "wait", type: "waitForPixel", at: pt(0.5, 0.5, "normalized", { display: "secondary" }), color: "#2ecc71", pollMs: 100, timeoutMs: 1000 },
      { id: "gone", type: "waitForPixel", at: pt(0.05, 0.05, "normalized", { display: "RIGHT" }), color: "#FFFFFF", not: true, tolerance: 0, pollMs: 200, timeoutMs: 1000, onError: { strategy: "continue" } },
      { id: "log", type: "log", message: "c={{c}} ok={{ok}} strict={{strict}}" },
    ]),
  },
  {
    name: "scene-conditions",
    displays: DESK,
    sceneHashes: { "-1080,0,1080,1920": [H.battle, H.battle, H.lobby, H.reward], "1952,-98,384,307": [H.lobby] },
    flow: flow(
      [
        { id: "w", type: "waitFor", condition: { scene: { name: "lobby" } }, pollMs: 100, timeoutMs: 1000 },
        { id: "if", type: "if", condition: { scene: { name: "lobby", not: true }, expr: "1 + 1 == 2" }, then: [{ id: "yes", type: "log", message: "not lobby any more" }], else: [{ id: "no", type: "log", message: "still lobby" }] },
        { id: "far", type: "if", condition: { scene: { name: "corner", minSimilarity: 0.5 } }, then: [{ id: "c1", type: "log", message: "corner" }], else: [] },
        { id: "loop", type: "loop", mode: "while", condition: { scene: { name: "reward", not: true } }, body: [wait("pause", 50)] },
      ],
      { stage: { display: "secondary" }, scenes: [{ name: "lobby", region: { x: 0, y: 0, w: 1, h: 1 }, hash: H.lobby }, { name: "reward", region: { x: 0, y: 0, w: 1, h: 1 }, hash: H.reward }, { name: "corner", display: { index: 2 }, region: { x: 0.025, y: 0.1, w: 0.3, h: 0.3 }, hash: H.lobby }] },
    ),
  },
  {
    name: "match-scene",
    displays: DESK,
    sceneHashes: { "0,0,1920,1080": [LIVE], "-810,960,540,480": [LIVE], "2048,-98,384,307": [LIVE] },
    flow: flow(
      [
        { id: "all", type: "matchScene", resultVar: "best", similarityVar: "sim" },
        { id: "strict", type: "matchScene", scenes: ["far", "mid"], minSimilarity: 0.95, resultVar: "none", similarityVar: "sim2" },
        { id: "two", type: "matchScene", scenes: ["far", "mid"], minSimilarity: 0.9, resultVar: "mid" },
        { id: "empty", type: "matchScene", scenes: [], resultVar: "nothing", similarityVar: "sim0" },
        { id: "log", type: "log", message: "{{best}} {{sim}} [{{none}}] {{sim2}} {{mid}} [{{nothing}}] {{sim0}}" },
      ],
      { scenes: SCENES },
    ),
  },
  {
    name: "scene-unknown-fails",
    displays: DESK,
    flow: flow([{ id: "m", type: "matchScene", scenes: ["ghost"], resultVar: "r" }], { scenes: SCENES }),
  },
  {
    name: "loop-cooldown",
    flow: flow([
      { id: "a", type: "loop", mode: "count", count: 3, cooldownMs: 1000, indexVar: "i", body: [wait("w", 300), { id: "l", type: "log", message: "round {{i}}" }] },
      { id: "slow", type: "loop", mode: "count", count: 2, cooldownMs: 100, body: [wait("w2", 250)] },
      { id: "b", type: "loop", mode: "while", condition: { expr: "n < 2" }, cooldownMs: 500, body: [{ id: "inc", type: "setVar", name: "n", value: "n + 1" }] },
    ], { variables: [{ name: "n", type: "number", initial: 0 }] }),
  },
);

class Backend extends SandboxBackend {
  constructor(c) {
    super({ platform: "windows", ...(c.displays ? { displays: c.displays } : {}) });
    this.failFirst = c.failFirst;
    this.failed = 0;
    this.pixels = structuredClone(c.pixels ?? {});
    this.sceneHashes = structuredClone(c.sceneHashes ?? {});
    this.probes = [];
  }
  async perform(action, signal) {
    if (this.failFirst && action.type === this.failFirst.type && this.failed < this.failFirst.count) {
      this.failed++;
      throw Object.assign(new Error("target not found"), { category: "target" });
    }
    const next = (seq, fallback) => (seq ? (seq.length > 1 ? seq.shift() : seq[0]) : fallback);
    if (action.type === "pixel") {
      this.probes.push([action.x, action.y]);
      return next(this.pixels[`${action.x},${action.y}`], "#000000");
    }
    if (action.type === "sceneHash") {
      const r = action.region;
      this.probes.push([r.x, r.y, r.w, r.h]);
      return next(this.sceneHashes[`${r.x},${r.y},${r.w},${r.h}`], "0000000000000000");
    }
    return super.perform(action, signal);
  }
}

const out = [];
for (const c of cases) {
  const parsed = parseFlow(c.flow);
  if (!parsed.ok) throw new Error(`${c.name}: ${JSON.stringify(parsed.issues)}`);
  const backend = new Backend(c);
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
      .map((t) => (t.kind === "region" ? [t.x, t.y, t.w, t.h] : [t.x, t.y])),
    typed: backend.typed,
  };
  const multi = c.displays !== undefined;
  if (multi) Object.assign(expect, { vars: r.vars, probes: backend.probes });
  out.push({
    name: c.name,
    random,
    failFirst: c.failFirst ?? null,
    secrets: c.secrets ?? {},
    ...(multi ? { displays: c.displays, pixels: c.pixels ?? {}, sceneHashes: c.sceneHashes ?? {} } : {}),
    flow: c.flow,
    expect,
  });
}
const dir = new URL("../fixtures/engine/", import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL("conformance.json", dir), JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${out.length} conformance cases`);

/* --------------------------------------------------------------- dHash images */

const img = (name, w, h, f) => {
  const rgb = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgb.push(...f(x, y).map((v) => Math.max(0, Math.min(255, Math.floor(v)))));
  return { name, w, h, rgb: Buffer.from(rgb).toString("hex") };
};
const noise = (seed) => {
  const r = mulberry32(seed);
  return () => [r() * 256, r() * 256, r() * 256];
};
const images = [
  img("gradient-16x12", 16, 12, (x, y) => [255 - x * 15, y * 20, (x * y * 5) % 256]),
  img("tiny-7x5", 7, 5, (x, y) => [(x * 37 + y * 11) % 256, (x * x * 9) % 256, y * 50]),
  img("exact-9x8", 9, 8, (x, y) => [(x * 29 + y * 7) % 256, ((x + 1) * (y + 3) * 13) % 256, 128]),
  img("checker-40x30", 40, 30, (x, y) => ((Math.floor(x / 5) + Math.floor(y / 5)) % 2 ? [230, 230, 230] : [20, 30, 40])),
  img("noise-33x21", 33, 21, noise(2026)),
  img("noise-33x21-b", 33, 21, noise(2027)),
  img("strip-100x3", 100, 3, (x) => [x * 2.5, 255 - x * 2.5, (x * 7) % 256]),
  img("dot-1x1", 1, 1, () => [12, 200, 99]),
  img("flat-20x20", 20, 20, () => [77, 77, 77]),
];
for (const im of images) im.hash = dhash(Buffer.from(im.rgb, "hex"), im.w, im.h, 3);
const pairs = [];
for (let i = 0; i < images.length; i++) for (let j = i + 1; j < images.length; j++) pairs.push({ a: images[i].name, b: images[j].name, similarity: hashSimilarity(images[i].hash, images[j].hash) });
writeFileSync(new URL("dhash.json", dir), JSON.stringify({ images, pairs }, null, 2) + "\n");
console.log(`wrote ${images.length} dHash images`);
