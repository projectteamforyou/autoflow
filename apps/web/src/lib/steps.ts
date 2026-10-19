/**
 * Step catalog for the Pro editor palette: category, icon, color and a factory with sensible defaults.
 */
import { newId, type Step, type StepType } from "@autoflow/core";

export type StepCategory = "input" | "timing" | "logic" | "data" | "apps" | "system" | "vision";

export interface StepMeta {
  type: StepType;
  category: StepCategory;
  icon: string;
  color: string;
  create(): Step;
}

const pt = { kind: "point", x: 0.5, y: 0.5, space: "normalized" } as const;

export const STEP_META: StepMeta[] = [
  { type: "click", category: "input", icon: "MousePointerClick", color: "#7C5CFF", create: () => ({ id: newId(), type: "click", target: { ...pt }, button: "left", clicks: 1, holdMs: 0, modifiers: [] }) },
  { type: "move", category: "input", icon: "Move", color: "#7C5CFF", create: () => ({ id: newId(), type: "move", target: { ...pt }, durationMs: 200 }) },
  { type: "drag", category: "input", icon: "Hand", color: "#7C5CFF", create: () => ({ id: newId(), type: "drag", from: { kind: "point", x: 0.4, y: 0.6, space: "normalized" }, to: { kind: "point", x: 0.6, y: 0.4, space: "normalized" }, durationMs: 300, button: "left" }) },
  { type: "scroll", category: "input", icon: "ArrowDownUp", color: "#7C5CFF", create: () => ({ id: newId(), type: "scroll", dx: 0, dy: 240 }) },
  { type: "key", category: "input", icon: "Keyboard", color: "#3B82F6", create: () => ({ id: newId(), type: "key", key: "Enter", modifiers: [], action: "press", repeat: 1 }) },
  { type: "type", category: "input", icon: "Type", color: "#3B82F6", create: () => ({ id: newId(), type: "type", text: "", perCharDelayMs: 0 }) },
  { type: "wait", category: "timing", icon: "Hourglass", color: "#64748B", create: () => ({ id: newId(), type: "wait", ms: 500, jitterMs: 0 }) },
  { type: "waitFor", category: "timing", icon: "TimerReset", color: "#64748B", create: () => ({ id: newId(), type: "waitFor", condition: { expr: "true" }, pollMs: 250, timeoutMs: 10_000 }) },
  { type: "if", category: "logic", icon: "GitBranch", color: "#F59E0B", create: () => ({ id: newId(), type: "if", condition: { expr: "true" }, then: [], else: [] }) },
  { type: "loop", category: "logic", icon: "Repeat", color: "#F59E0B", create: () => ({ id: newId(), type: "loop", mode: "count", count: 10, body: [] }) },
  { type: "forEach", category: "logic", icon: "ListOrdered", color: "#F59E0B", create: () => ({ id: newId(), type: "forEach", list: "range(3)", itemVar: "item", body: [] }) },
  { type: "try", category: "logic", icon: "ShieldAlert", color: "#F59E0B", create: () => ({ id: newId(), type: "try", body: [], catch: [], errorVar: "error" }) },
  { type: "group", category: "logic", icon: "Boxes", color: "#F59E0B", create: () => ({ id: newId(), type: "group", name: "Group", body: [] }) },
  { type: "break", category: "logic", icon: "CornerDownRight", color: "#F59E0B", create: () => ({ id: newId(), type: "break" }) },
  { type: "continue", category: "logic", icon: "SkipForward", color: "#F59E0B", create: () => ({ id: newId(), type: "continue" }) },
  { type: "stop", category: "logic", icon: "OctagonX", color: "#EF4444", create: () => ({ id: newId(), type: "stop" }) },
  { type: "runFlow", category: "logic", icon: "Workflow", color: "#F59E0B", create: () => ({ id: newId(), type: "runFlow", flowId: "f_unset" }) },
  { type: "setVar", category: "data", icon: "Variable", color: "#10B981", create: () => ({ id: newId(), type: "setVar", name: "count", value: "0" }) },
  { type: "clipboard", category: "data", icon: "Clipboard", color: "#10B981", create: () => ({ id: newId(), type: "clipboard", op: "get", var: "clip" }) },
  { type: "log", category: "data", icon: "ScrollText", color: "#10B981", create: () => ({ id: newId(), type: "log", message: "", level: "info" }) },
  { type: "http", category: "data", icon: "Globe", color: "#10B981", create: () => ({ id: newId(), type: "http", method: "GET", url: "https://example.com", headers: {}, resultVar: "response" }) },
  { type: "file", category: "data", icon: "FileText", color: "#10B981", create: () => ({ id: newId(), type: "file", op: "read", path: "C:/Users/Public/notes.txt", resultVar: "text" }) },
  { type: "notify", category: "apps", icon: "Bell", color: "#EC4899", create: () => ({ id: newId(), type: "notify", title: "AutoFlow", body: "" }) },
  { type: "confirm", category: "apps", icon: "MessageCircleQuestion", color: "#EC4899", create: () => ({ id: newId(), type: "confirm", message: "Continue?", resultVar: "ok" }) },
  { type: "launchApp", category: "apps", icon: "AppWindow", color: "#EC4899", create: () => ({ id: newId(), type: "launchApp", app: "notepad.exe", args: [] }) },
  { type: "openUrl", category: "apps", icon: "ExternalLink", color: "#EC4899", create: () => ({ id: newId(), type: "openUrl", url: "https://example.com" }) },
  { type: "window", category: "system", icon: "PanelsTopLeft", color: "#0EA5E9", create: () => ({ id: newId(), type: "window", op: "focus", match: { title: "" } }) },
  { type: "androidGlobal", category: "system", icon: "Smartphone", color: "#0EA5E9", create: () => ({ id: newId(), type: "androidGlobal", action: "back" }) },
  { type: "switchProfile", category: "system", icon: "Keyboard", color: "#0EA5E9", create: () => ({ id: newId(), type: "switchProfile", profileId: "default" }) },
  { type: "ocr", category: "vision", icon: "ScanText", color: "#A855F7", create: () => ({ id: newId(), type: "ocr", region: { x: 0, y: 0, w: 400, h: 200 }, resultVar: "text" }) },
  { type: "findImage", category: "vision", icon: "ScanSearch", color: "#A855F7", create: () => ({ id: newId(), type: "findImage", target: { kind: "image", ref: "", confidence: 0.9 }, resultVar: "found", timeoutMs: 5000 }) },
];

export const STEP_BY_TYPE = Object.fromEntries(STEP_META.map((m) => [m.type, m])) as Record<StepType, StepMeta>;
export const STEP_CATEGORIES: StepCategory[] = ["input", "timing", "logic", "data", "apps", "system", "vision"];

/** Deep-copies a step with fresh ids everywhere (duplicate / paste). */
export function cloneWithNewIds(s: Step): Step {
  const c = structuredClone(s) as Step;
  const visit = (x: Step) => {
    x.id = newId();
    if (x.type === "if") [...x.then, ...x.else].forEach(visit);
    else if (x.type === "try") [...x.body, ...x.catch].forEach(visit);
    else if (x.type === "loop" || x.type === "forEach" || x.type === "group") x.body.forEach(visit);
  };
  visit(c);
  return c;
}

/* ------------------------------------------------- immutable tree editing */

export type Slot = "steps" | "then" | "else" | "body" | "catch";
export interface Location {
  parentId: string | null;
  slot: Slot;
  index: number;
}

function listOf(s: Step, slot: Slot): Step[] | undefined {
  if (slot === "then" && s.type === "if") return s.then;
  if (slot === "else" && s.type === "if") return s.else;
  if (slot === "catch" && s.type === "try") return s.catch;
  if (slot === "body" && (s.type === "loop" || s.type === "forEach" || s.type === "group" || s.type === "try")) return s.body;
  return undefined;
}

function mapTree(list: Step[], fn: (list: Step[], parent: Step | null) => Step[], parent: Step | null = null): Step[] {
  const mapped = fn(list, parent).map((s) => {
    const c = { ...s } as Step;
    if (c.type === "if") {
      c.then = mapTree(c.then, fn, c);
      c.else = mapTree(c.else, fn, c);
    } else if (c.type === "try") {
      c.body = mapTree(c.body, fn, c);
      c.catch = mapTree(c.catch, fn, c);
    } else if (c.type === "loop" || c.type === "forEach" || c.type === "group") c.body = mapTree(c.body, fn, c);
    return c;
  });
  return mapped;
}

export function insertStep(root: Step[], loc: Location, step: Step): Step[] {
  if (loc.parentId === null) {
    const copy = [...root];
    copy.splice(loc.index, 0, step);
    return copy;
  }
  return mapTree(root, (list) =>
    list.map((s) => {
      if (s.id !== loc.parentId) return s;
      const c = structuredClone(s) as Step;
      const l = listOf(c, loc.slot);
      l?.splice(loc.index, 0, step);
      return c;
    }),
  );
}

export function removeStep(root: Step[], id: string): { steps: Step[]; removed?: Step } {
  let removed: Step | undefined;
  const steps = mapTree(root, (list) =>
    list.filter((s) => {
      if (s.id === id) {
        removed = s;
        return false;
      }
      return true;
    }),
  );
  return { steps, removed };
}

export function updateStep(root: Step[], id: string, patch: (s: Step) => Step): Step[] {
  return mapTree(root, (list) => list.map((s) => (s.id === id ? patch(s) : s)));
}

export function locate(root: Step[], id: string): Location | null {
  const search = (list: Step[], parentId: string | null, slot: Slot): Location | null => {
    for (let i = 0; i < list.length; i++) {
      const s = list[i]!;
      if (s.id === id) return { parentId, slot, index: i };
      for (const sl of ["then", "else", "body", "catch"] as Slot[]) {
        const l = listOf(s, sl);
        if (l) {
          const r = search(l, s.id, sl);
          if (r) return r;
        }
      }
    }
    return null;
  };
  return search(root, null, "steps");
}

export function moveStep(root: Step[], id: string, to: Location): Step[] {
  const from = locate(root, id);
  if (!from) return root;
  const { steps, removed } = removeStep(root, id);
  if (!removed) return root;
  // forbid moving a container into itself
  if (to.parentId && JSON.stringify(removed).includes(`"id":"${to.parentId}"`)) return root;
  const adj = from.parentId === to.parentId && from.slot === to.slot && from.index < to.index ? { ...to, index: to.index - 1 } : to;
  return insertStep(steps, adj, removed);
}
