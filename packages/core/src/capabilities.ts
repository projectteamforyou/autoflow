/**
 * Platform capability matrix. Every step type is supported, limited or unsupported per platform.
 * Unsupported steps are blocked before a run starts — never silently skipped.
 */
import type { Platform, Step, StepType, Target, Trigger } from "./schema.js";
import { walkSteps } from "./schema.js";

export type Support = "supported" | "limited" | "unsupported";

export interface CapabilityNote {
  support: Support;
  /** i18n key with an explanation and, when relevant, the alternative to use. */
  noteKey?: string;
}

const S: CapabilityNote = { support: "supported" };
const L = (noteKey: string): CapabilityNote => ({ support: "limited", noteKey });
const U = (noteKey: string): CapabilityNote => ({ support: "unsupported", noteKey });

export const STEP_CAPABILITIES: Record<StepType, Record<Platform, CapabilityNote>> = {
  click: { windows: S, android: L("cap.click.android"), web: L("cap.sandbox") },
  move: { windows: S, android: U("cap.move.android"), web: L("cap.sandbox") },
  drag: { windows: S, android: S, web: L("cap.sandbox") },
  scroll: { windows: S, android: L("cap.scroll.android"), web: L("cap.sandbox") },
  key: { windows: S, android: L("cap.key.android"), web: L("cap.sandbox") },
  type: { windows: S, android: L("cap.type.android"), web: L("cap.sandbox") },
  wait: { windows: S, android: S, web: S },
  waitFor: { windows: S, android: S, web: S },
  setVar: { windows: S, android: S, web: S },
  log: { windows: S, android: S, web: S },
  notify: { windows: S, android: S, web: S },
  confirm: { windows: S, android: S, web: S },
  clipboard: { windows: S, android: L("cap.clipboard.android"), web: L("cap.clipboard.web") },
  launchApp: { windows: S, android: S, web: U("cap.launchApp.web") },
  openUrl: { windows: S, android: S, web: S },
  window: { windows: S, android: U("cap.window.android"), web: U("cap.native") },
  androidGlobal: { windows: U("cap.androidOnly"), android: L("cap.androidGlobal"), web: L("cap.sandbox") },
  http: { windows: S, android: S, web: L("cap.http.web") },
  file: { windows: S, android: L("cap.file.android"), web: U("cap.native") },
  ocr: { windows: S, android: L("cap.ocr.android"), web: U("cap.native") },
  findImage: { windows: S, android: L("cap.findImage.android"), web: U("cap.native") },
  pixelCheck: { windows: S, android: U("cap.screenProbe.android"), web: L("cap.sandbox") },
  waitForPixel: { windows: S, android: U("cap.screenProbe.android"), web: L("cap.sandbox") },
  matchScene: { windows: S, android: U("cap.screenProbe.android"), web: L("cap.sandbox") },
  runFlow: { windows: S, android: S, web: S },
  switchProfile: { windows: S, android: L("cap.switchProfile.android"), web: U("cap.native") },
  stop: { windows: S, android: S, web: S },
  break: { windows: S, android: S, web: S },
  continue: { windows: S, android: S, web: S },
  if: { windows: S, android: S, web: S },
  loop: { windows: S, android: S, web: S },
  forEach: { windows: S, android: S, web: S },
  try: { windows: S, android: S, web: S },
  group: { windows: S, android: S, web: S },
};

export const TRIGGER_CAPABILITIES: Record<Trigger["type"], Record<Platform, CapabilityNote>> = {
  manual: { windows: S, android: S, web: S },
  hotkey: { windows: S, android: L("cap.hotkey.android"), web: L("cap.hotkey.web") },
  schedule: { windows: S, android: L("cap.schedule.android"), web: L("cap.schedule.web") },
  appEvent: { windows: S, android: L("cap.appEvent.android"), web: U("cap.native") },
  deviceEvent: { windows: L("cap.deviceEvent.windows"), android: S, web: U("cap.native") },
  location: { windows: U("cap.location.windows"), android: L("cap.location.android"), web: U("cap.native") },
  notification: { windows: U("cap.notification.windows"), android: L("cap.notification.android"), web: U("cap.native") },
};

/**
 * Scene and pixel conditions read the screen. Android has no screen-capture (MediaProjection)
 * integration, so they are blocked there with a clear note instead of silently never matching.
 */
export const CONDITION_PROBE_CAPABILITY: Record<Platform, CapabilityNote> = { windows: S, android: U("cap.screenProbe.android"), web: L("cap.sandbox") };

/** True when the step's own condition reads the screen (scene or pixel). */
export function usesScreenProbe(s: Step): boolean {
  const c = s.type === "if" || s.type === "waitFor" ? s.condition : s.type === "loop" ? s.condition : undefined;
  return !!c && (c.scene !== undefined || c.pixel !== undefined);
}

export function targetSupport(t: Target, platform: Platform): CapabilityNote {
  if (t.kind === "element" && platform === "web") return U("cap.element.web");
  if (t.kind === "image" && platform === "web") return U("cap.native");
  if (t.kind === "current" && platform === "android") return U("cap.current.android");
  return S;
}

export interface CompatIssue {
  stepId: string;
  stepType: StepType;
  support: Support;
  noteKey?: string;
}

/** Lists every enabled step that is not fully supported on the platform. */
export function compatibility(steps: Step[], platform: Platform): CompatIssue[] {
  const out: CompatIssue[] = [];
  walkSteps(steps, (s) => {
    if (s.disabled) return;
    const cap = STEP_CAPABILITIES[s.type][platform];
    let worst = cap;
    const targets: Target[] = [];
    if ("target" in s && s.target) targets.push(s.target as Target);
    if (s.type === "drag") targets.push(s.from, s.to);
    for (const t of targets) {
      const tc = targetSupport(t, platform);
      if (rank(tc.support) > rank(worst.support)) worst = tc;
    }
    if (usesScreenProbe(s) && rank(CONDITION_PROBE_CAPABILITY[platform].support) > rank(worst.support)) worst = CONDITION_PROBE_CAPABILITY[platform];
    if (worst.support !== "supported") out.push({ stepId: s.id, stepType: s.type, support: worst.support, noteKey: worst.noteKey });
  });
  return out;
}

function rank(s: Support): number {
  return s === "supported" ? 0 : s === "limited" ? 1 : 2;
}

export function isRunnableOn(steps: Step[], platform: Platform): boolean {
  return !compatibility(steps, platform).some((i) => i.support === "unsupported");
}
