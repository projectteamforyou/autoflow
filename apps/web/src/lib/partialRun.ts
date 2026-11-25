/**
 * "Run from here" / "Run only this step": builds a temporary copy of a flow in which the steps
 * that must not run are `disabled`. Uses only the existing schema field, so every executor
 * (TypeScript, Rust, Kotlin) behaves the same. The result is never saved.
 *
 * - "from": every step before the chosen one is disabled — at the top level and, when the step is
 *   nested, the earlier siblings in each ancestor container's list.
 * - "only": everything except the chosen step is disabled; its ancestors stay enabled (a disabled
 *   container skips its whole body) but all their other children are disabled.
 *
 * The chosen step and its ancestors are force-enabled: asking to run a skipped step means run it.
 * Limits that follow from reusing `disabled`: an ancestor `if` still evaluates its condition (a
 * step in the branch not taken does not run), a step inside `catch` only runs when the try body
 * fails, and inside a loop the skipped siblings are skipped on every round.
 */
import type { Flow, Step } from "@autoflow/core";

export type PartialMode = "from" | "only";

const off = (s: Step): Step => (s.disabled ? s : ({ ...s, disabled: true } as Step));
const on = (s: Step): Step => {
  if (!s.disabled) return s;
  const { disabled: _drop, ...rest } = s;
  return rest as Step;
};

function contains(s: Step, id: string): boolean {
  return s.id === id || slots(s).some((l) => l.some((c) => contains(c, id)));
}

function slots(s: Step): Step[][] {
  if (s.type === "if") return [s.then, s.else];
  if (s.type === "try") return [s.body, s.catch];
  if (s.type === "loop" || s.type === "forEach" || s.type === "group") return [s.body];
  return [];
}

/** Rewrites the one list (at any depth) that holds the path to `id`; null when `id` is not in it. */
function rewrite(list: Step[], id: string, mode: PartialMode): Step[] | null {
  const at = list.findIndex((s) => contains(s, id));
  if (at < 0) return null;
  return list.map((s, i) => {
    if (i < at) return off(s);
    if (i > at) return mode === "only" ? off(s) : s;
    if (s.id === id) return on(s);
    // An ancestor: keep it running, recurse into the slot with the target.
    const c = { ...on(s) } as Step;
    const inner = (l: Step[]): Step[] => rewrite(l, id, mode) ?? (mode === "only" ? l.map(off) : l);
    if (c.type === "if") { c.then = inner(c.then); c.else = inner(c.else); }
    else if (c.type === "try") { c.body = inner(c.body); c.catch = inner(c.catch); }
    else if (c.type === "loop" || c.type === "forEach" || c.type === "group") c.body = inner(c.body);
    return c;
  });
}

/** Temporary flow for a partial run, or null when the step is not part of the flow. */
export function partialFlow(flow: Flow, stepId: string, mode: PartialMode): Flow | null {
  const steps = rewrite(flow.steps, stepId, mode);
  return steps ? { ...flow, steps } : null;
}
