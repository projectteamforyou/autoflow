/**
 * Turns raw recorded input events into editable steps.
 * - mouse down/up pairs become clicks (or drags when the pointer moved),
 * - consecutive printable keys become one `type` step,
 * - pauses become `wait` steps (rounded, tiny gaps dropped),
 * - input into sensitive fields (password boxes, flagged apps) is never kept: it becomes
 *   {{secret:…}} so the value is supplied from the OS keystore at run time.
 */
import type { Step, Target } from "./schema.js";
import { newId } from "./schema.js";

export type RecordedEvent =
  | { t: number; kind: "mouseDown" | "mouseUp"; x: number; y: number; button: "left" | "right" | "middle" | "x1" | "x2" }
  | { t: number; kind: "wheel"; dx: number; dy: number; x: number; y: number }
  | { t: number; kind: "keyDown" | "keyUp"; key: string; modifiers: ("ctrl" | "alt" | "shift" | "meta")[]; sensitive?: boolean };

export interface RecordOptions {
  /** Pauses shorter than this are dropped. */
  minWaitMs?: number;
  /** Waits are rounded to this granularity. */
  roundMs?: number;
  /** Pixels of movement that turn a click into a drag. */
  dragThreshold?: number;
  /** Store points as normalized coordinates relative to this screen size. */
  screen?: { width: number; height: number };
  /** Hold time (ms) above which a click is stored as press-and-hold. */
  holdThresholdMs?: number;
}

export function eventsToSteps(events: RecordedEvent[], opts: RecordOptions = {}): Step[] {
  const minWait = opts.minWaitMs ?? 40;
  const round = opts.roundMs ?? 10;
  const dragT = opts.dragThreshold ?? 8;
  const holdT = opts.holdThresholdMs ?? 450;
  const point = (x: number, y: number): Target =>
    opts.screen ? { kind: "point", x: +(x / opts.screen.width).toFixed(4), y: +(y / opts.screen.height).toFixed(4), space: "normalized" } : { kind: "point", x, y, space: "screen" };

  const sorted = [...events].sort((a, b) => a.t - b.t);
  const steps: Step[] = [];
  let lastT: number | undefined;
  let textBuf = "";
  let textSensitive = false;
  let secretCount = 0;

  const pushWait = (t: number) => {
    if (lastT === undefined) return;
    const gap = Math.round((t - lastT) / round) * round;
    if (gap >= minWait) steps.push({ id: newId(), type: "wait", ms: gap, jitterMs: 0 });
  };
  const flushText = () => {
    if (!textBuf && !textSensitive) return;
    if (textSensitive) {
      secretCount++;
      steps.push({ id: newId(), type: "type", label: "Sensitive input (masked)", text: `{{secret:recorded_${secretCount}}}`, perCharDelayMs: 0 });
    } else steps.push({ id: newId(), type: "type", text: textBuf, perCharDelayMs: 0 });
    textBuf = "";
    textSensitive = false;
  };

  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i]!;
    if (e.kind === "keyDown") {
      const printable = e.key.length === 1 && !e.modifiers.some((m) => m !== "shift");
      if (printable) {
        if (!textBuf && !textSensitive) {
          pushWait(e.t);
        }
        if (e.sensitive) textSensitive = true;
        else textBuf += e.key;
        lastT = e.t;
        continue;
      }
      flushText();
      pushWait(e.t);
      if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) {
        lastT = e.t;
        continue;
      }
      steps.push({ id: newId(), type: "key", key: e.key, modifiers: e.modifiers, action: "press", repeat: 1 });
      lastT = e.t;
    } else if (e.kind === "mouseDown") {
      flushText();
      type MouseEv = Extract<RecordedEvent, { kind: "mouseDown" | "mouseUp" }>;
      const up = sorted.slice(i + 1).find((x) => x.kind === "mouseUp" && (x as MouseEv).button === e.button) as MouseEv | undefined;
      if (!up) continue;
      const moved = Math.hypot(up.x - e.x, up.y - e.y) > dragT;
      const held = up.t - e.t;
      const prevStep = steps[steps.length - 1];
      const isSecondClick = !moved && prevStep?.type === "click" && prevStep.clicks === 1 && prevStep.target.kind === "point" && sameSpot(prevStep.target, point(e.x, e.y)) && lastT !== undefined && e.t - lastT < 350;
      if (!isSecondClick) pushWait(e.t);
      if (moved) steps.push({ id: newId(), type: "drag", from: point(e.x, e.y), to: point(up.x, up.y), durationMs: Math.max(50, Math.round(held / round) * round), button: e.button });
      else {
        // merge quick second click at the same spot into a double click
        if (isSecondClick && prevStep?.type === "click") {
          prevStep.clicks = 2;
        } else {
          steps.push({ id: newId(), type: "click", target: point(e.x, e.y), button: e.button, clicks: 1, holdMs: held >= holdT ? Math.round(held / round) * round : 0, modifiers: [] });
        }
      }
      lastT = up.t;
    } else if (e.kind === "wheel") {
      flushText();
      pushWait(e.t);
      const prev = steps[steps.length - 1];
      if (prev && prev.type === "scroll" && lastT !== undefined && e.t - lastT < 150) {
        prev.dx += e.dx;
        prev.dy += e.dy;
      } else steps.push({ id: newId(), type: "scroll", dx: e.dx, dy: e.dy, target: point(e.x, e.y) });
      lastT = e.t;
    }
  }
  flushText();
  // Remove waits that ended up between two collapsed steps (e.g. before a merged double click).
  return steps.filter((s, i) => !(s.type === "wait" && steps[i + 1]?.type === "wait"));
}

function sameSpot(a: Target, b: Target): boolean {
  return a.kind === "point" && b.kind === "point" && Math.abs(a.x - b.x) < (a.space === "normalized" ? 0.005 : 4) && Math.abs(a.y - b.y) < (a.space === "normalized" ? 0.005 : 4);
}
