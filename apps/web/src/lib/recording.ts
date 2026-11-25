import type { Hotkey, RecordedEvent } from "@autoflow/core";

const MODIFIER_KEYS = new Set(["control", "alt", "shift", "meta", "altgraph"]);

/**
 * A recording that was ended with the emergency-stop hotkey ends with that key press itself
 * (modifiers going down, possibly the key). Those trailing key events are dropped so the new flow
 * does not finish by pressing the stop hotkey — replaying that would halt the run.
 */
export function trimStopHotkey(events: RecordedEvent[], hotkey: Hotkey): RecordedEvent[] {
  const key = hotkey.key.toLowerCase();
  let end = events.length;
  while (end > 0) {
    const e = events[end - 1]!;
    if (e.kind !== "keyDown" && e.kind !== "keyUp") break;
    const k = e.key.toLowerCase();
    if (!MODIFIER_KEYS.has(k) && k !== key) break;
    // The stop key counts only with the hotkey's modifiers held; a plain press of the same key was the user's own.
    if (k === key && hotkey.modifiers.some((m) => !e.modifiers.includes(m))) break;
    end--;
  }
  return end === events.length ? events : events.slice(0, end);
}
