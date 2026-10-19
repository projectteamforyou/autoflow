/**
 * Easy mode ⇄ Pro mode, lossless.
 *
 * Easy mode edits a small model (what to repeat, how often, for how long). It is stored as
 * ordinary Pro steps with a recognisable shape. `toEasy` reads that shape back; anything it
 * does not recognise stays untouched and the editor shows an "advanced steps" badge.
 */
import type { Flow, Step, Hotkey } from "./schema.js";
import { newId } from "./schema.js";

export type EasyKind = "click" | "multiClick" | "keys" | "text";

export interface EasyPoint {
  x: number;
  y: number;
  button: "left" | "right" | "middle";
  clicks: 1 | 2;
  holdMs: number;
}

export interface EasyKeys {
  key: string;
  modifiers: ("ctrl" | "alt" | "shift" | "meta")[];
}

export type EasyRepeat = { mode: "count"; count: number } | { mode: "duration"; ms: number } | { mode: "untilStopped" };

export interface EasyModel {
  kind: EasyKind;
  points: EasyPoint[];
  keys: EasyKeys[];
  text: string;
  intervalMs: number;
  repeat: EasyRepeat;
  startHotkey?: Hotkey;
  stopHotkey: Hotkey;
}

export const INTERVAL_PRESETS = { fast: 50, normal: 250, slow: 1000 } as const;

export function defaultEasyModel(kind: EasyKind = "click"): EasyModel {
  return {
    kind,
    points: kind === "click" || kind === "multiClick" ? [{ x: 0.5, y: 0.5, button: "left", clicks: 1, holdMs: 0 }] : [],
    keys: kind === "keys" ? [{ key: "Space", modifiers: [] }] : [],
    text: kind === "text" ? "" : "",
    intervalMs: INTERVAL_PRESETS.normal,
    repeat: { mode: "count", count: 100 },
    stopHotkey: { key: "Escape", modifiers: ["ctrl", "alt"] },
  };
}

const START_VAR = "__easyStart";

/** Builds Pro steps from the Easy model. Points are normalized (0..1) so they survive resolution changes. */
export function easyToSteps(m: EasyModel): Step[] {
  const body: Step[] = [];
  if (m.kind === "click" || m.kind === "multiClick") {
    for (const p of m.points) {
      body.push({ id: newId(), type: "click", target: { kind: "point", x: p.x, y: p.y, space: "normalized" }, button: p.button, clicks: p.clicks, holdMs: p.holdMs, modifiers: [] });
      body.push({ id: newId(), type: "wait", ms: m.intervalMs, jitterMs: 0 });
    }
  } else if (m.kind === "keys") {
    for (const k of m.keys) {
      body.push({ id: newId(), type: "key", key: k.key, modifiers: k.modifiers, action: "press", repeat: 1 });
      body.push({ id: newId(), type: "wait", ms: m.intervalMs, jitterMs: 0 });
    }
  } else {
    body.push({ id: newId(), type: "type", text: m.text, perCharDelayMs: 0 });
    body.push({ id: newId(), type: "wait", ms: m.intervalMs, jitterMs: 0 });
  }
  const loopId = newId("easy");
  if (m.repeat.mode === "count") return [{ id: loopId, type: "loop", mode: "count", count: m.repeat.count, body }];
  if (m.repeat.mode === "untilStopped") return [{ id: loopId, type: "loop", mode: "forever", body }];
  return [
    { id: newId("easy"), type: "setVar", name: START_VAR, value: "now()" },
    { id: loopId, type: "loop", mode: "while", condition: { expr: `now() - ${START_VAR} < ${Math.round(m.repeat.ms)}` }, body },
  ];
}

/** Applies an Easy model to a flow, keeping every other property (and id/limits) intact. */
export function applyEasy(flow: Flow, m: EasyModel): Flow {
  const steps = easyToSteps(m);
  const limits = { ...flow.limits };
  if (m.repeat.mode === "duration") limits.maxDurationMs = Math.max(limits.maxDurationMs, m.repeat.ms + 60_000);
  return {
    ...flow,
    mode: "easy",
    steps,
    limits,
    hotkeys: { ...flow.hotkeys, stop: m.stopHotkey, ...(m.startHotkey ? { start: m.startHotkey } : {}) },
    updatedAt: new Date().toISOString(),
    revision: flow.revision + 1,
  };
}

/** Reads an Easy model back from Pro steps. Returns null when the flow has advanced structure. */
export function toEasy(flow: Flow): EasyModel | null {
  let steps = flow.steps.filter((s) => !s.disabled);
  let durationMs: number | undefined;
  if (steps.length === 2 && steps[0]!.type === "setVar" && steps[0]!.name === START_VAR && steps[0]!.value === "now()") {
    const loop = steps[1]!;
    if (loop.type !== "loop" || loop.mode !== "while") return null;
    const m = new RegExp(`^now\\(\\) - ${START_VAR} < (\\d+)$`).exec(loop.condition?.expr ?? "");
    if (!m) return null;
    durationMs = Number(m[1]);
    steps = [loop];
  }
  if (steps.length !== 1) return null;
  const loop = steps[0]!;
  if (loop.type !== "loop" || loop.indexVar) return null;
  const body = loop.body.filter((s) => !s.disabled);
  if (body.length === 0 || body.length % 2 !== 0) return null;

  const points: EasyPoint[] = [];
  const keys: EasyKeys[] = [];
  let text: string | undefined;
  let interval: number | undefined;
  let kind: EasyKind | undefined;

  for (let i = 0; i < body.length; i += 2) {
    const a = body[i]!;
    const w = body[i + 1]!;
    if (w.type !== "wait" || w.jitterMs !== 0 || w.onError || a.onError) return null;
    if (interval === undefined) interval = w.ms;
    else if (interval !== w.ms) return null;
    if (a.type === "click") {
      if (a.target.kind !== "point" || a.target.space !== "normalized" || a.modifiers.length) return null;
      if (a.button !== "left" && a.button !== "right" && a.button !== "middle") return null;
      if (a.clicks !== 1 && a.clicks !== 2) return null;
      if (kind && kind !== "click" && kind !== "multiClick") return null;
      kind = "click";
      points.push({ x: a.target.x, y: a.target.y, button: a.button, clicks: a.clicks, holdMs: a.holdMs });
    } else if (a.type === "key") {
      if (a.action !== "press" || a.repeat !== 1 || (kind && kind !== "keys")) return null;
      kind = "keys";
      keys.push({ key: a.key, modifiers: a.modifiers });
    } else if (a.type === "type") {
      if (kind || body.length !== 2 || a.perCharDelayMs !== 0) return null;
      kind = "text";
      text = a.text;
    } else return null;
  }
  if (!kind || interval === undefined) return null;
  if (kind === "click" && points.length > 1) kind = "multiClick";

  let repeat: EasyRepeat;
  if (durationMs !== undefined) repeat = { mode: "duration", ms: durationMs };
  else if (loop.mode === "count") repeat = { mode: "count", count: loop.count ?? 1 };
  else if (loop.mode === "forever") repeat = { mode: "untilStopped" };
  else return null;

  return { kind, points, keys, text: text ?? "", intervalMs: interval, repeat, startHotkey: flow.hotkeys.start, stopHotkey: flow.hotkeys.stop };
}

export function isEasyCompatible(flow: Flow): boolean {
  return toEasy(flow) !== null;
}
