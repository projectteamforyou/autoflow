/**
 * Undo / redo stack for an editor session — pure, so it is unit-tested without React.
 *
 * `past` holds the states *before* each recorded edit (oldest first), `future` the states undone
 * so far (next redo last). A burst of edits of the same kind (typing in one field) is coalesced
 * into one entry: the state before the burst stays on the stack and the later ones are not pushed.
 */
import type { Flow, Step } from "@autoflow/core";

export const HISTORY_CAP = 60;
export const COALESCE_MS = 700;

export interface History<T> {
  past: T[];
  future: T[];
  /** Time and kind of the last recorded edit (coalescing window). */
  lastAt: number;
  lastKind: string | null;
}

export function createHistory<T>(): History<T> {
  return { past: [], future: [], lastAt: 0, lastKind: null };
}

/**
 * Records that `prev` is about to be replaced by an edit of `kind` at time `now` (ms).
 * A new edit always drops the redo stack. `kind: null` never coalesces.
 */
export function record<T>(h: History<T>, prev: T, kind: string | null, now: number, cap = HISTORY_CAP): History<T> {
  const coalesce = kind !== null && h.lastKind === kind && h.past.length > 0 && now - h.lastAt >= 0 && now - h.lastAt < COALESCE_MS;
  const past = coalesce ? h.past : [...h.past, prev].slice(-cap);
  return { past, future: [], lastAt: now, lastKind: kind };
}

export function canUndo<T>(h: History<T>): boolean {
  return h.past.length > 0;
}

export function canRedo<T>(h: History<T>): boolean {
  return h.future.length > 0;
}

/** Steps back: returns the state to show, or null when there is nothing to undo. */
export function undo<T>(h: History<T>, present: T, cap = HISTORY_CAP): { history: History<T>; value: T } | null {
  if (!h.past.length) return null;
  const value = h.past[h.past.length - 1]!;
  // lastKind is cleared so the next edit starts a new entry instead of merging into an older burst.
  return { value, history: { past: h.past.slice(0, -1), future: [...h.future, present].slice(-cap), lastAt: 0, lastKind: null } };
}

export function redo<T>(h: History<T>, present: T, cap = HISTORY_CAP): { history: History<T>; value: T } | null {
  if (!h.future.length) return null;
  const value = h.future[h.future.length - 1]!;
  return { value, history: { past: [...h.past, present].slice(-cap), future: h.future.slice(0, -1), lastAt: 0, lastKind: null } };
}

/**
 * The "kind" of an edit for coalescing: the step structure (ids in tree order) of the flow before
 * and after. Typing in a field keeps both the same, so a burst merges; adding, removing, moving or
 * wrapping a step changes the structure and therefore always gets its own undo entry.
 */
export function editKind(prev: Flow, next: Flow): string | null {
  const a = structureKey(prev.steps);
  return a === structureKey(next.steps) ? a : null;
}

export function structureKey(steps: Step[]): string {
  const out: string[] = [];
  const walk = (list: Step[]) => {
    out.push("[");
    for (const s of list) {
      out.push(s.id);
      if (s.type === "if") { walk(s.then); walk(s.else); }
      else if (s.type === "try") { walk(s.body); walk(s.catch); }
      else if (s.type === "loop" || s.type === "forEach" || s.type === "group") walk(s.body);
    }
    out.push("]");
  };
  walk(steps);
  return out.join(" ");
}
