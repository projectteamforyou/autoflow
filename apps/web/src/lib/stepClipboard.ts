/**
 * Editor clipboard for one step. Kept in localStorage (not component state) so a step copied in
 * one flow can be pasted into another, also after a reload. What comes back is untrusted (another
 * tab, an older app version, a hand-edited value), so it is re-validated with the core schema.
 */
import { StepSchema, type Step } from "@autoflow/core";

const KEY = "af.editor.clip";
/** Fallback when localStorage is unavailable (private mode, quota): same-session copy & paste still works. */
let memory: string | null = null;

export function copyStep(step: Step): void {
  const text = JSON.stringify(step);
  memory = text;
  try {
    localStorage.setItem(KEY, text);
  } catch {
    /* private mode / quota: the in-memory copy is used */
  }
}

/** The copied step with schema defaults applied, or null when there is none or it is not a valid step. */
export function readCopiedStep(): Step | null {
  let text = memory;
  try {
    text = localStorage.getItem(KEY) ?? memory;
  } catch {
    /* fall back to memory */
  }
  if (!text) return null;
  try {
    const r = StepSchema.safeParse(JSON.parse(text));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export function clearCopiedStep(): void {
  memory = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
