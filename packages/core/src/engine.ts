/**
 * Deterministic flow interpreter.
 *
 * - Executes a validated Flow against a platform Backend (sandbox, Tauri bridge, Android bridge…).
 * - Enforces limits (duration, actions, iterations), stop within one sleep slice, pause/resume,
 *   breakpoints and single-stepping, per-step error policies, and pre-run checks
 *   (unsupported steps, risky steps needing confirmation, screen-geometry drift).
 * - Emits structured events so every surface can show live state and a run ledger.
 * - Engine v2 (all opt-in through optional schema fields, identical in the Rust and Kotlin engines):
 *   per-step timeouts (`stepTimeoutMs`), retry backoff curves with cap and jitter (`onError.backoff`,
 *   `maxBackoffMs`, `jitter`), a deterministic step budget (`limits.maxSteps`), seeded humanization
 *   of input actions (`humanize`) and richer trace events (see trace.ts).
 * - Multi-monitor (opt-in, see displays.ts): display-relative targets are placed on absolute
 *   virtual-desktop pixels here, a missing display follows `onMissingDisplay` (never a silent
 *   wrong-screen click), Stage mode pauses when the user takes over the pointer, and scene / pixel
 *   probes let conditions react to what a display shows. Loops can keep a `cooldownMs` rhythm.
 */
import type { Condition, DisplayRef, Flow, Humanize, OnError, Platform, Scene, Step, Target, Hotkey } from "./schema.js";
import { walkSteps } from "./schema.js";
import { evalExpr, interpolate, toStr, truthy, type ExprEnv, type Value } from "./expr.js";
import {
  colorDistance,
  displayRefKey,
  displayRefLabel,
  findDisplay,
  hashSimilarity,
  onDisplay,
  parseColor,
  placePoint,
  placeRect,
  rectOnDisplay,
  sortDisplays,
  toHexColor,
  type DisplayInfo,
  type Rect,
} from "./displays.js";
import { compatibility, type CompatIssue } from "./capabilities.js";
import { analyzeRisk, type RiskReport } from "./risk.js";

/* ----------------------------------------------------------------- backend */

export type InputAction =
  | { type: "click"; target: Target; button: string; clicks: number; holdMs: number; modifiers: string[] }
  | { type: "move"; target: Target; durationMs: number }
  | { type: "drag"; from: Target; to: Target; durationMs: number; button: string }
  | { type: "scroll"; dx: number; dy: number; target?: Target }
  | { type: "key"; key: string; modifiers: string[]; action: "press" | "down" | "up" }
  | { type: "type"; text: string; perCharDelayMs: number }
  | { type: "launchApp"; app: string; args: string[] }
  | { type: "openUrl"; url: string }
  | { type: "window"; op: string; match: { title?: string; app?: string }; rect?: { x: number; y: number; w: number; h: number } }
  | { type: "androidGlobal"; action: string }
  | { type: "clipboardSet"; value: string }
  | { type: "clipboardGet" }
  | { type: "notify"; title: string; body: string }
  | { type: "http"; method: string; url: string; headers: Record<string, string>; body?: string }
  | { type: "file"; op: string; path: string; dest?: string; content?: string }
  | { type: "ocr"; region: { x: number; y: number; w: number; h: number } }
  /** `region` (virtual-desktop px) is set when the step is scoped to a display. */
  | { type: "findImage"; ref: string; confidence: number; timeoutMs: number; region?: Rect }
  | { type: "switchProfile"; profileId: string }
  /** Probe: color of one virtual-desktop pixel as "#rrggbb". */
  | { type: "pixel"; x: number; y: number }
  /** Probe: dHash (16 hex digits) of a virtual-desktop rectangle. */
  | { type: "sceneHash"; region: Rect };

export interface ScreenInfo {
  width: number;
  height: number;
  scale: number;
}

export interface Backend {
  readonly platform: Platform;
  /** Performs one action. Must honour `signal` (stop) promptly. May return a value for get-style actions. */
  perform(action: InputAction, signal: AbortSignal): Promise<Value | void>;
  /** Asks the user a yes/no question (confirm step). */
  confirm(message: string, signal: AbortSignal): Promise<boolean>;
  screen?(): Promise<ScreenInfo | undefined>;
  /** Connected monitors (any order; the engine sorts them). Without it the primary screen is the only display. */
  displays?(): Promise<DisplayInfo[]>;
  /** Current pointer position in virtual-desktop px (Stage takeover detection); undefined when there is none. */
  pointerPosition?(): Promise<{ x: number; y: number } | undefined>;
}

export interface Clock {
  now(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  /**
   * Optional timer used to preempt a backend action that outlives its step timeout. Returns a
   * cancel function. Without it, timeouts are still enforced at every sleep slice and step boundary.
   */
  setTimer?(ms: number, fn: () => void): () => void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      const t = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(t);
        reject(signal.reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }),
  setTimer: (ms, fn) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
};

/** Virtual clock for tests, previews and simulations: sleeping advances time instantly. */
export function createVirtualClock(start = 0): Clock & { advance(ms: number): void } {
  let t = start;
  const timers = new Set<{ at: number; fn: () => void }>();
  const fire = () => {
    for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
      if (timer.at > t) continue;
      timers.delete(timer);
      timer.fn();
    }
  };
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
      fire();
    },
    sleep: async (ms, signal) => {
      if (signal.aborted) throw signal.reason;
      t += ms;
      fire();
      await Promise.resolve();
      if (signal.aborted) throw signal.reason;
    },
    setTimer: (ms, fn) => {
      const timer = { at: t + ms, fn };
      timers.add(timer);
      return () => timers.delete(timer);
    },
  };
}

/**
 * mulberry32: tiny, fast, seedable PRNG returning [0, 1). Bit-identical implementations live in
 * the Rust and Kotlin engines so seeded humanization replays the same everywhere.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Delay before retry `attempt` (1-based) under an onError policy. Draws one random number only
 * when `jitter` > 0, so flows without jitter replay exactly as before.
 */
export function retryDelayMs(policy: Pick<OnError, "backoffMs" | "backoff" | "maxBackoffMs" | "jitter">, attempt: number, random: () => number): number {
  const base = policy.backoffMs;
  const mode = policy.backoff ?? "linear";
  let d = mode === "fixed" ? base : mode === "linear" ? base * attempt : base * 2 ** (attempt - 1);
  if (policy.maxBackoffMs !== undefined) d = Math.min(d, policy.maxBackoffMs);
  const j = policy.jitter ?? 0;
  if (j > 0) d -= Math.floor(d * j * random());
  return Math.max(0, Math.floor(d));
}

/** Random pixel offset in [-max, max] (integer, no rounding ambiguity across languages). */
function offset(max: number, rnd: () => number): number {
  return Math.min(2 * max, Math.floor(rnd() * (2 * max + 1))) - max;
}

/** Applies the humanize offset to pixel point targets; other targets are returned unchanged. */
export function humanizeTarget(t: Target, h: Pick<Humanize, "offsetPx">, rnd: () => number): Target {
  if (h.offsetPx <= 0 || t.kind !== "point" || t.space === "normalized") return t;
  const dx = offset(h.offsetPx, rnd);
  const dy = offset(h.offsetPx, rnd);
  return { ...t, x: t.x + dx, y: t.y + dy };
}

/* ------------------------------------------------------------------ events */

export type RunState = "idle" | "preflight" | "countdown" | "running" | "paused" | "stopped" | "completed" | "failed";

export type ErrorCategory = "validation" | "unsupported" | "permission" | "environment" | "target" | "limit" | "expression" | "action" | "user" | "internal" | "timeout" | "display";

export interface RunError {
  stepId?: string;
  path?: string;
  message: string;
  category: ErrorCategory;
}

export type RunEvent =
  | { type: "state"; state: RunState; at: number }
  | { type: "countdown"; remainingMs: number; at: number }
  | { type: "stepStart"; stepId: string; stepType: Step["type"]; path: string; at: number }
  | { type: "stepEnd"; stepId: string; ok: boolean; durationMs: number; at: number; attempts?: number; error?: RunError }
  | { type: "breakpoint"; stepId: string; at: number }
  | { type: "log"; level: "info" | "warn" | "error"; message: string; stepId?: string; at: number }
  | { type: "var"; name: string; value: Value; at: number }
  | { type: "retry"; stepId: string; attempt: number; at: number; delayMs?: number; error?: string }
  | { type: "timeout"; stepId: string; timeoutMs: number; at: number }
  | { type: "error"; error: RunError; at: number };

export interface RunResult {
  status: "completed" | "stopped" | "failed";
  reason?: string;
  error?: RunError;
  actions: number;
  iterations: number;
  /** Executed steps (attempts included), the quantity bounded by limits.maxSteps. */
  steps: number;
  durationMs: number;
  vars: Record<string, Value>;
  startedAt: number;
  endedAt: number;
}

export interface RunOptions {
  clock?: Clock;
  random?: () => number;
  onEvent?: (e: RunEvent) => void;
  /** Values for variables that declare a `prompt`, collected by the UI before the run. */
  inputs?: Record<string, Value>;
  /** Secret resolver for {{secret:name}} — values come from the OS keystore, never from the flow. */
  secret?: (name: string) => string | undefined;
  /** Called once before the run when the flow contains steps that need explicit approval. */
  confirmRisk?: (report: RiskReport) => Promise<boolean>;
  /** Called when the recorded screen geometry differs from the live screen. */
  confirmScreenChange?: (recorded: ScreenInfo, live: ScreenInfo) => Promise<boolean>;
  /**
   * onMissingDisplay "ask": may the run use the primary display instead of the missing one (label
   * such as `"secondary"`)? Without it the backend's confirm dialog asks. Asked once per display and run.
   */
  confirmMissingDisplay?: (label: string) => Promise<boolean>;
  /** Resolve flows for runFlow steps. */
  resolveFlow?: (flowId: string) => Flow | undefined;
  /** Honour step.breakpoint flags (Pro debugger). */
  debug?: boolean;
  /** Skip the pre-start countdown (tests / sandbox). */
  skipCountdown?: boolean;
  /** Max nesting of runFlow calls. */
  maxCallDepth?: number;
}

/* ----------------------------------------------------------- control flow */

class Interrupt {
  constructor(public readonly kind: "break" | "continue" | "stop" | "goto", public readonly value?: string) {}
}

/** One active step timeout. */
interface Deadline {
  stepId: string;
  path: string;
  timeoutMs: number;
  /** The step times out once the clock is strictly past this instant. */
  at: number;
  ctrl: AbortController;
  unlink: () => void;
}

/** Thrown when a deadline passes; only the step that owns the deadline handles it. */
class StepTimeout {
  constructor(public readonly deadline: Deadline) {}
}

export class RunFailure extends Error {
  constructor(public readonly runError: RunError) {
    super(runError.message);
    this.name = "RunFailure";
  }
}

const STOP_REASON = Symbol("stop");
const TAKEOVER_PX = 24;
const INPUT_TYPES = new Set<Step["type"]>(["click", "move", "drag", "scroll", "key", "type"]);
/** Stop latency target is 500 ms; long waits are sliced so pause/stop/limits are observed quickly. */
const SLICE_MS = 100;

/* -------------------------------------------------------------------- run */

export class FlowRun {
  readonly id: string;
  private state: RunState = "idle";
  private ctrl = new AbortController();
  private pauseGate: Promise<void> | null = null;
  private releasePause: (() => void) | null = null;
  private stepOnce = false;
  private stopReason: string | undefined;
  private vars: Record<string, Value> = {};
  private actions = 0;
  private iterations = 0;
  private stepCount = 0;
  private readonly deadlines: Deadline[] = [];
  private readonly humanize: Humanize | undefined;
  private readonly humanRandom: () => number;
  private startedAt = 0;
  private callDepth = 0;
  /** Where AutoFlow last put the pointer (Stage takeover detection). */
  private lastPointer: { x: number; y: number } | undefined;
  private readonly displayWarned = new Set<string>();
  private readonly displayAnswers = new Map<string, boolean>();
  private readonly clock: Clock;
  private readonly env: ExprEnv;

  constructor(private readonly flow: Flow, private readonly backend: Backend, private readonly opts: RunOptions = {}) {
    this.id = `run_${Math.random().toString(36).slice(2, 10)}`;
    this.clock = opts.clock ?? realClock;
    this.env = { vars: this.vars, now: () => this.clock.now(), random: opts.random };
    const h = flow.humanize;
    this.humanize = h && (h.offsetPx > 0 || h.delayMs > 0) ? h : undefined;
    this.humanRandom = h?.seed !== undefined ? mulberry32(h.seed) : (opts.random ?? Math.random);
  }

  /** Signal of the innermost active scope: aborted by stop or by an enclosing step timeout. */
  private get signal(): AbortSignal {
    return this.deadlines.length ? this.deadlines[this.deadlines.length - 1]!.ctrl.signal : this.ctrl.signal;
  }

  get currentState(): RunState {
    return this.state;
  }

  /** Live counters (HUDs): input actions, loop rounds and executed steps so far. */
  get counters(): { actions: number; iterations: number; steps: number } {
    return { actions: this.actions, iterations: this.iterations, steps: this.stepCount };
  }

  /** Static pre-run checks shared by every surface. */
  static preflight(flow: Flow, platform: Platform): { compat: CompatIssue[]; blocked: CompatIssue[]; risk: RiskReport } {
    const compat = compatibility(flow.steps, platform);
    return { compat, blocked: compat.filter((c) => c.support === "unsupported"), risk: analyzeRisk(flow) };
  }

  pause(): void {
    if (this.state !== "running") return;
    this.pauseGate = new Promise((r) => (this.releasePause = r));
    this.setState("paused");
  }

  resume(): void {
    if (this.state !== "paused") return;
    this.setState("running");
    const r = this.releasePause;
    this.pauseGate = null;
    this.releasePause = null;
    r?.();
  }

  /** In debug mode while paused at a breakpoint: execute exactly one more step, then pause again. */
  stepOver(): void {
    if (this.state !== "paused") return;
    this.stepOnce = true;
    this.resume();
  }

  stop(reason = "user"): void {
    if (this.state === "completed" || this.state === "failed" || this.state === "stopped") return;
    this.stopReason = reason;
    this.ctrl.abort(STOP_REASON);
    const r = this.releasePause;
    this.pauseGate = null;
    this.releasePause = null;
    r?.();
  }

  async start(): Promise<RunResult> {
    if (this.state !== "idle") throw new Error("a FlowRun can only be started once");
    this.startedAt = this.clock.now();
    this.setState("preflight");
    try {
      await this.preflightChecks();
      this.initVars();
      if (!this.opts.skipCountdown && this.flow.limits.countdownMs > 0) {
        this.setState("countdown");
        let remaining = this.flow.limits.countdownMs;
        while (remaining > 0) {
          this.emit({ type: "countdown", remainingMs: remaining, at: this.clock.now() });
          const slice = Math.min(remaining, 1000);
          await this.clock.sleep(slice, this.ctrl.signal);
          remaining -= slice;
        }
      }
      this.startedAt = this.clock.now();
      this.setState("running");
      await this.runTopLevel(this.flow.steps);
      return this.finish("completed");
    } catch (e) {
      return this.handleTerminal(e);
    }
  }

  /* ------------------------------------------------------------ internals */

  private async preflightChecks(): Promise<void> {
    const { blocked, risk } = FlowRun.preflight(this.flow, this.backend.platform);
    if (blocked.length) {
      throw new RunFailure({
        stepId: blocked[0]!.stepId,
        message: `${blocked.length} step(s) are not supported on ${this.backend.platform}: ${blocked.map((b) => b.stepType).join(", ")}`,
        category: "unsupported",
      });
    }
    if (risk.needsConfirm) {
      const ok = this.opts.confirmRisk ? await this.opts.confirmRisk(risk) : false;
      if (!ok) throw new RunFailure({ message: "risky steps were not approved", category: "user" });
    }
    if (this.flow.screen && this.backend.screen) {
      const live = await this.backend.screen();
      const rec = { ...this.flow.screen, scale: this.flow.screen.scale ?? 1 };
      if (live && (live.width !== rec.width || live.height !== rec.height || Math.abs(live.scale - rec.scale) > 0.01) && usesScreenCoordinates(this.flow.steps)) {
        const ok = this.opts.confirmScreenChange ? await this.opts.confirmScreenChange(rec, live) : false;
        if (!ok) throw new RunFailure({ message: `screen changed from ${rec.width}x${rec.height}@${rec.scale} to ${live.width}x${live.height}@${live.scale}`, category: "environment" });
      }
    }
    // A missing stage fails (or falls back, or asks) before the countdown, not at the first click.
    if (this.flow.stage) await this.display(this.flow.stage.display);
  }

  /* ---------------------------------------------------------- displays */

  private async displayList(): Promise<DisplayInfo[]> {
    if (this.backend.displays) return sortDisplays(await this.backend.displays());
    const s = this.backend.screen ? await this.backend.screen() : undefined;
    if (!s) return [];
    const bounds = { x: 0, y: 0, w: s.width, h: s.height };
    return [{ id: "primary", name: "Primary", primary: true, bounds, workArea: bounds, scale: s.scale, orientation: s.width >= s.height ? "landscape" : "portrait" }];
  }

  /** Resolves a display reference, applying `onMissingDisplay` when it is not connected. */
  private async display(ref: DisplayRef): Promise<DisplayInfo> {
    const list = await this.displayList();
    const found = findDisplay(list, ref);
    if (found) return found;
    const key = displayRefKey(ref);
    const label = displayRefLabel(ref);
    const policy = this.flow.onMissingDisplay ?? "fail";
    const primary = list[0];
    let use = false;
    if (primary && policy === "primary") use = true;
    else if (primary && policy === "ask") {
      let ok = this.displayAnswers.get(key);
      if (ok === undefined) {
        ok = this.opts.confirmMissingDisplay
          ? await this.opts.confirmMissingDisplay(label)
          : await this.backend.confirm(`Display ${label} is not connected. Use the primary display instead?`, this.signal);
        this.displayAnswers.set(key, ok);
      }
      use = ok;
    }
    if (!use || !primary) throw new RunFailure({ message: `display ${label} is not connected`, category: "display" });
    if (!this.displayWarned.has(key)) {
      this.displayWarned.add(key);
      this.emit({ type: "log", level: "warn", message: `display ${label} is not connected; using the primary display`, at: this.clock.now() });
    }
    return primary;
  }

  /**
   * Places display-relative point/region/image targets on absolute pixels. Targets without a display
   * reference (and outside Stage mode) are returned unchanged, so old flows behave exactly as before.
   */
  private async place(t: Target): Promise<Target> {
    if (t.kind === "image") {
      if (t.display === undefined) return t;
      const d = await this.display(t.display);
      const { display: _omit, ...rest } = t;
      return { ...rest, region: t.region ? placeRect(d.bounds, t.region, "display") : { ...d.bounds } };
    }
    if ((t.kind !== "point" && t.kind !== "region") || t.space === "window") return t;
    const stage = this.flow.stage?.display;
    const ref = t.display ?? (t.space === "display" || (t.space === "normalized" && stage !== undefined) ? (stage ?? "primary") : undefined);
    if (ref === undefined) return t;
    const d = await this.display(ref);
    if (t.kind === "point") {
      const p = placePoint(d.bounds, t.x, t.y, t.space);
      if (!onDisplay(d.bounds, p.x, p.y)) throw new RunFailure({ message: `point (${p.x}, ${p.y}) is outside display ${displayRefLabel(ref)}`, category: "display" });
      return { kind: "point", x: p.x, y: p.y, space: "screen" };
    }
    const r = placeRect(d.bounds, t, t.space);
    if (!rectOnDisplay(d.bounds, r)) throw new RunFailure({ message: `region (${r.x}, ${r.y}) ${r.w}x${r.h} is outside display ${displayRefLabel(ref)}`, category: "display" });
    return { kind: "region", x: r.x, y: r.y, w: r.w, h: r.h, space: "screen", pick: t.pick };
  }

  /** Remembers where an input action left the pointer (unknown for non-pixel targets). */
  private track(t: Target | undefined): void {
    this.lastPointer = t && t.kind === "point" && t.space === "screen" ? { x: t.x, y: t.y } : undefined;
  }

  /**
   * Stage mode guard: once AutoFlow has placed the pointer, a pointer that moved more than
   * `takeoverPx` or left the stage display means the user took over — the run pauses.
   */
  private async checkTakeover(): Promise<void> {
    const st = this.flow.stage;
    const last = this.lastPointer;
    if (!st || st.pauseOnTakeover === false || !this.backend.pointerPosition || !last) return;
    const p = await this.backend.pointerPosition();
    if (!p) return;
    const limit = st.takeoverPx ?? TAKEOVER_PX;
    const dx = p.x - last.x;
    const dy = p.y - last.y;
    const stage = await this.display(st.display);
    const off = !onDisplay(stage.bounds, p.x, p.y);
    if (!off && dx * dx + dy * dy <= limit * limit) return;
    this.lastPointer = undefined;
    this.emit({ type: "log", level: "warn", message: off ? "takeover: pointer left the stage display, run paused" : "takeover: pointer moved, run paused", at: this.clock.now() });
    this.pause();
    await this.gate();
  }

  /** Absolute pixel of a probe position (pixel conditions / steps). */
  private async probePoint(at: Extract<Target, { kind: "point" }>): Promise<{ x: number; y: number }> {
    if (at.space === "window") throw new RunFailure({ message: "pixel positions cannot be window-relative", category: "validation" });
    const ref = at.display ?? (at.space === "screen" ? undefined : (this.flow.stage?.display ?? "primary"));
    if (ref === undefined) return placePoint({ x: 0, y: 0, w: 0, h: 0 }, at.x, at.y, "screen");
    const d = await this.display(ref);
    const p = placePoint(d.bounds, at.x, at.y, at.space);
    if (!onDisplay(d.bounds, p.x, p.y)) throw new RunFailure({ message: `point (${p.x}, ${p.y}) is outside display ${displayRefLabel(ref)}`, category: "display" });
    return p;
  }

  private async readPixel(at: Extract<Target, { kind: "point" }>): Promise<[number, number, number]> {
    const p = await this.probePoint(at);
    const c = parseColor(await this.perform({ type: "pixel", x: p.x, y: p.y }));
    if (!c) throw new RunFailure({ message: "this device cannot read screen pixels", category: "unsupported" });
    return c;
  }

  private scene(name: string): Scene {
    const s = this.flow.scenes?.find((x) => x.name === name);
    if (!s) throw new RunFailure({ message: `scene "${name}" is not defined in this flow`, category: "validation" });
    return s;
  }

  /** Similarity (0..1) between the live display region of a scene and its remembered hash. */
  private async sceneSimilarity(s: Scene): Promise<number> {
    const d = await this.display(s.display ?? this.flow.stage?.display ?? "primary");
    const b = d.bounds;
    const r = placeRect(b, s.region, "normalized");
    r.w = Math.max(1, Math.min(r.w, b.x + b.w - r.x));
    r.h = Math.max(1, Math.min(r.h, b.y + b.h - r.y));
    const v = await this.perform({ type: "sceneHash", region: r });
    if (typeof v !== "string" || !/^[0-9a-fA-F]{16}$/.test(v)) throw new RunFailure({ message: "this device cannot capture the screen for scenes", category: "unsupported" });
    return hashSimilarity(v.toLowerCase(), s.hash);
  }

  /** Evaluates a condition: scene, then pixel, then expression (short-circuit AND). */
  private async holds(c: Condition): Promise<boolean> {
    if (c.scene) {
      const showing = (await this.sceneSimilarity(this.scene(c.scene.name))) >= c.scene.minSimilarity;
      if (showing === (c.scene.not === true)) return false;
    }
    if (c.pixel) {
      const match = colorDistance(await this.readPixel(c.pixel.at), parseColor(c.pixel.color)!) <= c.pixel.tolerance;
      if (match === (c.pixel.not === true)) return false;
    }
    return truthy(evalExpr(c.expr ?? "true", this.env));
  }

  private initVars(): void {
    for (const v of this.flow.variables) {
      const input = this.opts.inputs?.[v.name];
      let val: Value = input ?? (v.initial as Value | undefined) ?? defaultFor(v.type);
      if (v.type === "number") val = Number(val);
      if (v.type === "boolean") val = val === true || val === "true";
      this.vars[v.name] = val;
    }
  }

  private async runTopLevel(steps: Step[]): Promise<void> {
    let i = 0;
    let gotos = 0;
    while (i < steps.length) {
      try {
        await this.runStep(steps[i]!, `${i}`);
        i++;
      } catch (e) {
        if (e instanceof Interrupt && e.kind === "goto") {
          const idx = steps.findIndex((s) => s.id === e.value);
          if (idx < 0) throw new RunFailure({ message: `goto target "${e.value}" not found at top level`, category: "validation" });
          if (++gotos > this.flow.limits.maxIterations) throw new RunFailure({ message: "too many error jumps", category: "limit" });
          i = idx;
          continue;
        }
        if (e instanceof Interrupt && (e.kind === "break" || e.kind === "continue")) {
          i++;
          continue;
        }
        throw e;
      }
    }
  }

  private async runList(steps: Step[], path: string): Promise<void> {
    for (let i = 0; i < steps.length; i++) await this.runStep(steps[i]!, `${path}.${i}`);
  }

  private async gate(): Promise<void> {
    if (this.ctrl.signal.aborted) throw this.ctrl.signal.reason;
    if (this.clock.now() - this.startedAt > this.flow.limits.maxDurationMs) {
      throw new RunFailure({ message: `maximum run time reached (${Math.round(this.flow.limits.maxDurationMs / 1000)}s)`, category: "limit" });
    }
    this.checkDeadlines();
    while (this.pauseGate) await this.pauseGate;
    if (this.ctrl.signal.aborted) throw this.ctrl.signal.reason;
  }

  /** Outermost expired deadline wins, so an enclosing container's timeout is not swallowed inside. */
  private checkDeadlines(): void {
    const now = this.clock.now();
    for (const d of this.deadlines) if (now > d.at) throw new StepTimeout(d);
  }

  /** Time until the nearest deadline expires (exclusive), so sleeps end exactly when it does. */
  private untilDeadline(): number {
    let min = Infinity;
    const now = this.clock.now();
    for (const d of this.deadlines) min = Math.min(min, d.at + 1 - now);
    return Math.max(1, min);
  }

  private async sleep(ms: number): Promise<void> {
    let remaining = Math.max(0, ms);
    while (remaining > 0) {
      await this.gate();
      const slice = Math.min(remaining, SLICE_MS, this.untilDeadline());
      await this.clock.sleep(slice, this.signal);
      remaining -= slice;
    }
  }

  private pushDeadline(step: Step, path: string, timeoutMs: number): Deadline {
    const parent = this.signal;
    const ctrl = new AbortController();
    const d: Deadline = { stepId: step.id, path, timeoutMs, at: this.clock.now() + timeoutMs, ctrl, unlink: () => {} };
    const onParent = () => ctrl.abort(parent.reason);
    if (parent.aborted) onParent();
    else parent.addEventListener("abort", onParent, { once: true });
    // Preempts a backend action that hangs past the deadline (real clock; virtual clocks fire on advance).
    const cancelTimer = this.clock.setTimer?.(timeoutMs + 1, () => ctrl.abort(new StepTimeout(d)));
    d.unlink = () => {
      parent.removeEventListener("abort", onParent);
      cancelTimer?.();
    };
    this.deadlines.push(d);
    return d;
  }

  private popDeadline(d: Deadline): void {
    const i = this.deadlines.lastIndexOf(d);
    if (i >= 0) this.deadlines.splice(i, 1);
    d.unlink();
  }

  private countStep(): void {
    const max = this.flow.limits.maxSteps;
    this.stepCount++;
    if (max !== undefined && this.stepCount > max) {
      throw new RunFailure({ message: `maximum number of steps reached (${max})`, category: "limit" });
    }
  }

  private async runStep(step: Step, path: string): Promise<void> {
    if (step.disabled) return;
    await this.gate();
    if (this.opts.debug && (step.breakpoint || this.stepOnce)) {
      this.stepOnce = false;
      this.emit({ type: "breakpoint", stepId: step.id, at: this.clock.now() });
      this.pause();
      await this.gate();
    }
    const t0 = this.clock.now();
    this.emit({ type: "stepStart", stepId: step.id, stepType: step.type, path, at: t0 });
    const policy = step.onError;
    let attempt = 0;
    for (;;) {
      let deadline: Deadline | undefined;
      try {
        this.countStep();
        if (step.stepTimeoutMs !== undefined) deadline = this.pushDeadline(step, path, step.stepTimeoutMs);
        try {
          await this.exec(step, path);
          // Work that finished after the deadline (an action the backend could not interrupt) still timed out.
          if (deadline && this.clock.now() > deadline.at) throw new StepTimeout(deadline);
        } catch (e) {
          // A preempted backend action rejects with the abort reason of the timed-out scope.
          if (deadline && !this.ctrl.signal.aborted && deadline.ctrl.signal.aborted && !(e instanceof StepTimeout) && !(e instanceof Interrupt)) {
            const reason = deadline.ctrl.signal.reason;
            if (reason instanceof StepTimeout) throw reason;
          }
          throw e;
        } finally {
          if (deadline) this.popDeadline(deadline);
        }
        this.emit({ type: "stepEnd", stepId: step.id, ok: true, durationMs: this.clock.now() - t0, at: this.clock.now(), ...(attempt > 0 ? { attempts: attempt + 1 } : {}) });
        return;
      } catch (e) {
        if (e instanceof Interrupt || e === STOP_REASON || this.ctrl.signal.aborted) throw e;
        // Somebody else's deadline (an enclosing step): let it unwind to its owner.
        if (e instanceof StepTimeout && e.deadline !== deadline) throw e;
        let err: RunError;
        if (e instanceof StepTimeout) {
          err = { stepId: step.id, path, message: `step timed out after ${e.deadline.timeoutMs} ms`, category: "timeout" };
          this.emit({ type: "timeout", stepId: step.id, timeoutMs: e.deadline.timeoutMs, at: this.clock.now() });
        } else err = toRunError(e, step.id, path);
        if (err.category === "limit") throw new RunFailure(err);
        if (policy?.strategy === "retry" && attempt < policy.retries) {
          attempt++;
          const delayMs = retryDelayMs(policy, attempt, this.opts.random ?? Math.random);
          this.emit({ type: "retry", stepId: step.id, attempt, at: this.clock.now(), delayMs, error: err.message });
          await this.sleep(delayMs);
          continue;
        }
        this.emit({ type: "stepEnd", stepId: step.id, ok: false, durationMs: this.clock.now() - t0, at: this.clock.now(), attempts: attempt + 1, error: err });
        if (policy?.strategy === "continue") {
          this.emit({ type: "log", level: "warn", message: `step failed and was skipped: ${err.message}`, stepId: step.id, at: this.clock.now() });
          return;
        }
        if (policy?.strategy === "goto" && policy.gotoStepId) {
          this.emit({ type: "log", level: "warn", message: `step failed, jumping to ${policy.gotoStepId}: ${err.message}`, stepId: step.id, at: this.clock.now() });
          throw new Interrupt("goto", policy.gotoStepId);
        }
        throw new RunFailure(err);
      }
    }
  }

  private countAction(): void {
    if (++this.actions > this.flow.limits.maxActions) {
      throw new RunFailure({ message: `maximum number of actions reached (${this.flow.limits.maxActions})`, category: "limit" });
    }
  }

  private countIteration(): void {
    if (++this.iterations > this.flow.limits.maxIterations) {
      throw new RunFailure({ message: `maximum number of loop iterations reached (${this.flow.limits.maxIterations})`, category: "limit" });
    }
  }

  private text(s: string, maskSecrets = false): string {
    return interpolate(s, this.env, this.opts.secret, { maskSecrets });
  }

  private setVar(name: string, value: Value): void {
    this.vars[name] = value;
    this.emit({ type: "var", name, value, at: this.clock.now() });
  }

  private async perform(action: InputAction): Promise<Value | void> {
    return this.backend.perform(action, this.signal);
  }

  /** Humanization: optional bounded random delay before an input action. */
  private async humanDelay(): Promise<void> {
    const h = this.humanize;
    if (h && h.delayMs > 0) await this.sleep(Math.floor(this.humanRandom() * (h.delayMs + 1)));
  }

  /** Placement on displays, then humanization (in that order in every engine). */
  private async target(t: Target): Promise<Target> {
    const placed = await this.place(t);
    return this.humanize ? humanizeTarget(placed, this.humanize, this.humanRandom) : placed;
  }

  private async exec(s: Step, path: string): Promise<void> {
    if (INPUT_TYPES.has(s.type)) {
      this.countAction();
      await this.checkTakeover();
      if (s.type !== "key") await this.humanDelay();
    }
    switch (s.type) {
      case "click": {
        const target = await this.target(s.target);
        await this.perform({ type: "click", target, button: s.button, clicks: s.clicks, holdMs: s.holdMs, modifiers: s.modifiers });
        this.track(target);
        return;
      }
      case "move": {
        const target = await this.target(s.target);
        await this.perform({ type: "move", target, durationMs: s.durationMs });
        this.track(target);
        return;
      }
      case "drag": {
        const from = await this.target(s.from);
        const to = await this.target(s.to);
        await this.perform({ type: "drag", from, to, durationMs: s.durationMs, button: s.button });
        this.track(to);
        return;
      }
      case "scroll": {
        const target = s.target ? await this.place(s.target) : undefined;
        await this.perform({ type: "scroll", dx: s.dx, dy: s.dy, target });
        if (target) this.track(target);
        return;
      }
      case "key":
        for (let i = 0; i < s.repeat; i++) {
          if (i > 0) {
            await this.gate();
            this.countAction();
          }
          await this.humanDelay();
          await this.perform({ type: "key", key: s.key, modifiers: s.modifiers, action: s.action });
        }
        return;
      case "type":
        await this.perform({ type: "type", text: this.text(s.text), perCharDelayMs: s.perCharDelayMs });
        return;
      case "wait": {
        const jitter = s.jitterMs > 0 ? Math.floor((this.opts.random ?? Math.random)() * (s.jitterMs + 1)) : 0;
        await this.sleep(s.ms + jitter);
        return;
      }
      case "waitFor": {
        const deadline = this.clock.now() + s.timeoutMs;
        for (;;) {
          if (await this.holds(s.condition)) return;
          if (this.clock.now() >= deadline) throw new RunFailure({ stepId: s.id, path, message: `condition not met within ${s.timeoutMs} ms`, category: "target" });
          await this.sleep(s.pollMs);
        }
      }
      case "setVar":
        this.setVar(s.name, evalExpr(s.value, this.env));
        return;
      case "log":
        // Log lines end up in the run ledger: secrets are verified but never written out.
        this.emit({ type: "log", level: s.level, message: this.text(s.message, true), stepId: s.id, at: this.clock.now() });
        return;
      case "notify":
        await this.perform({ type: "notify", title: this.text(s.title), body: this.text(s.body) });
        return;
      case "confirm": {
        const ok = await this.backend.confirm(this.text(s.message), this.signal);
        if (s.resultVar) this.setVar(s.resultVar, ok);
        else if (!ok) throw new Interrupt("stop", "declined");
        return;
      }
      case "clipboard":
        if (s.op === "set") await this.perform({ type: "clipboardSet", value: this.text(s.value ?? "") });
        else {
          const v = await this.perform({ type: "clipboardGet" });
          if (s.var) this.setVar(s.var, (v ?? "") as Value);
        }
        return;
      case "launchApp":
        await this.perform({ type: "launchApp", app: s.app, args: s.args });
        return;
      case "openUrl":
        await this.perform({ type: "openUrl", url: this.text(s.url) });
        return;
      case "window":
        await this.perform({ type: "window", op: s.op, match: s.match, rect: s.rect });
        return;
      case "androidGlobal":
        await this.perform({ type: "androidGlobal", action: s.action });
        return;
      case "http": {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(s.headers)) headers[k] = this.text(v);
        const res = await this.perform({ type: "http", method: s.method, url: this.text(s.url), headers, body: s.body === undefined ? undefined : this.text(s.body) });
        if (s.resultVar) this.setVar(s.resultVar, (res ?? null) as Value);
        return;
      }
      case "file": {
        const res = await this.perform({ type: "file", op: s.op, path: this.text(s.path), dest: s.dest && this.text(s.dest), content: s.content === undefined ? undefined : this.text(s.content) });
        if (s.resultVar) this.setVar(s.resultVar, (res ?? null) as Value);
        return;
      }
      case "ocr": {
        const region = s.display === undefined ? s.region : placeRect((await this.display(s.display)).bounds, s.region, "display");
        const res = await this.perform({ type: "ocr", region });
        this.setVar(s.resultVar, toStr((res ?? "") as Value));
        return;
      }
      case "findImage": {
        // The search region is only passed for display-scoped steps (older flows keep searching the whole screen).
        const placed = s.target.display === undefined ? undefined : await this.place(s.target);
        const region = placed?.kind === "image" ? placed.region : undefined;
        const res = await this.perform({ type: "findImage", ref: s.target.ref, confidence: s.target.confidence, timeoutMs: s.timeoutMs, ...(region ? { region } : {}) });
        this.setVar(s.resultVar, (res ?? null) as Value);
        return;
      }
      case "pixelCheck": {
        const c = await this.readPixel(s.at);
        this.setVar(s.resultVar, s.color ? colorDistance(c, parseColor(s.color)!) <= s.tolerance : toHexColor(c[0], c[1], c[2]));
        return;
      }
      case "waitForPixel": {
        const deadline = s.timeoutMs === undefined ? undefined : this.clock.now() + s.timeoutMs;
        const want = parseColor(s.color)!;
        for (;;) {
          const match = colorDistance(await this.readPixel(s.at), want) <= s.tolerance;
          if (match !== (s.not === true)) return;
          if (deadline !== undefined && this.clock.now() >= deadline) throw new RunFailure({ stepId: s.id, path, message: `pixel condition not met within ${s.timeoutMs} ms`, category: "target" });
          await this.sleep(s.pollMs);
        }
      }
      case "matchScene": {
        const names = s.scenes ?? (this.flow.scenes ?? []).map((x) => x.name);
        let bestName = "";
        let bestSim = -1;
        for (const name of names) {
          const sim = await this.sceneSimilarity(this.scene(name));
          if (sim > bestSim) {
            bestSim = sim;
            bestName = name;
          }
        }
        this.setVar(s.resultVar, bestSim >= s.minSimilarity ? bestName : "");
        if (s.similarityVar) this.setVar(s.similarityVar, Math.max(0, bestSim));
        return;
      }
      case "switchProfile":
        await this.perform({ type: "switchProfile", profileId: s.profileId });
        return;
      case "runFlow": {
        const max = this.opts.maxCallDepth ?? 8;
        const target = this.opts.resolveFlow?.(s.flowId);
        if (!target) throw new RunFailure({ stepId: s.id, path, message: `flow "${s.flowId}" not found`, category: "validation" });
        if (this.callDepth >= max) throw new RunFailure({ stepId: s.id, path, message: "runFlow nesting too deep", category: "limit" });
        this.callDepth++;
        try {
          await this.runList(target.steps, `${path}>${s.flowId}`);
        } finally {
          this.callDepth--;
        }
        return;
      }
      case "stop":
        throw new Interrupt("stop", s.reason ?? "stop step");
      case "break":
        throw new Interrupt("break");
      case "continue":
        throw new Interrupt("continue");
      case "group":
        await this.runList(s.body, path);
        return;
      case "if":
        if (await this.holds(s.condition)) await this.runList(s.then, `${path}.then`);
        else await this.runList(s.else, `${path}.else`);
        return;
      case "loop": {
        let i = 0;
        let roundStart = 0;
        for (;;) {
          if (s.mode === "count" && i >= (s.count ?? 0)) return;
          if (s.cooldownMs && i > 0) {
            const rest = roundStart + s.cooldownMs - this.clock.now();
            if (rest > 0) await this.sleep(rest);
          }
          if (s.mode === "while" && !(await this.holds(s.condition!))) return;
          this.countIteration();
          roundStart = this.clock.now();
          if (s.indexVar) this.setVar(s.indexVar, i);
          try {
            await this.runList(s.body, `${path}.body`);
          } catch (e) {
            if (e instanceof Interrupt && e.kind === "break") return;
            if (!(e instanceof Interrupt && e.kind === "continue")) throw e;
          }
          i++;
          // A loop whose body never waits would spin; always yield so stop/pause stay responsive.
          await this.gate();
          if (s.body.length === 0) await this.sleep(SLICE_MS);
        }
      }
      case "forEach": {
        const list = evalExpr(s.list, this.env);
        const items = Array.isArray(list) ? list : [list];
        for (const item of items) {
          this.countIteration();
          this.setVar(s.itemVar, item);
          try {
            await this.runList(s.body, `${path}.body`);
          } catch (e) {
            if (e instanceof Interrupt && e.kind === "break") return;
            if (!(e instanceof Interrupt && e.kind === "continue")) throw e;
          }
          await this.gate();
        }
        return;
      }
      case "try":
        try {
          await this.runList(s.body, `${path}.body`);
        } catch (e) {
          if (e instanceof Interrupt || e instanceof StepTimeout || e === STOP_REASON || this.ctrl.signal.aborted) throw e;
          const err = toRunError(e, s.id, path);
          if (err.category === "limit") throw e;
          if (s.errorVar) this.setVar(s.errorVar, err.message);
          await this.runList(s.catch, `${path}.catch`);
        }
        return;
    }
  }

  private handleTerminal(e: unknown): RunResult {
    if (e === STOP_REASON || this.ctrl.signal.aborted) return this.finish("stopped", this.stopReason ?? "user");
    if (e instanceof Interrupt && e.kind === "stop") return this.finish("stopped", e.value);
    if (e instanceof Interrupt) return this.finish("completed");
    const err = e instanceof RunFailure ? e.runError : toRunError(e);
    this.emit({ type: "error", error: err, at: this.clock.now() });
    return this.finish("failed", err.message, err);
  }

  private finish(status: RunResult["status"], reason?: string, error?: RunError): RunResult {
    this.setState(status);
    const endedAt = this.clock.now();
    for (const d of this.deadlines.splice(0)) d.unlink();
    return { status, reason, error, actions: this.actions, iterations: this.iterations, steps: this.stepCount, durationMs: endedAt - this.startedAt, vars: { ...this.vars }, startedAt: this.startedAt, endedAt };
  }

  private setState(s: RunState): void {
    this.state = s;
    this.emit({ type: "state", state: s, at: this.clock.now() });
  }

  private emit(e: RunEvent): void {
    try {
      this.opts.onEvent?.(e);
    } catch {
      /* a broken listener must never break a run */
    }
  }
}

function defaultFor(t: string): Value {
  return t === "number" ? 0 : t === "boolean" ? false : t === "list" ? [] : "";
}

function toRunError(e: unknown, stepId?: string, path?: string): RunError {
  if (e instanceof RunFailure) return { stepId: e.runError.stepId ?? stepId, path: e.runError.path ?? path, message: e.runError.message, category: e.runError.category };
  if (e instanceof StepTimeout) return { stepId: e.deadline.stepId, path: e.deadline.path, message: `step timed out after ${e.deadline.timeoutMs} ms`, category: "timeout" };
  const err = e as { name?: string; message?: string; category?: ErrorCategory };
  if (err?.name === "ExprError") return { stepId, path, message: err.message ?? "expression error", category: "expression" };
  return { stepId, path, message: err?.message ?? String(e), category: err?.category ?? "action" };
}

function usesScreenCoordinates(steps: Step[]): boolean {
  let uses = false;
  walkSteps(steps, (s) => {
    const ts: Target[] = [];
    if ("target" in s && s.target) ts.push(s.target as Target);
    if (s.type === "drag") ts.push(s.from, s.to);
    if (ts.some((t) => (t.kind === "point" || t.kind === "region") && t.space === "screen")) uses = true;
  });
  return uses;
}

/** Convenience: run a flow to completion. */
export function runFlow(flow: Flow, backend: Backend, opts?: RunOptions): { run: FlowRun; done: Promise<RunResult> } {
  const run = new FlowRun(flow, backend, opts);
  return { run, done: run.start() };
}

export function hotkeyToString(h: Hotkey): string {
  const order = ["ctrl", "alt", "shift", "meta"];
  return [...[...h.modifiers].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((m) => m[0]!.toUpperCase() + m.slice(1)), h.key.length === 1 ? h.key.toUpperCase() : h.key].join("+");
}
