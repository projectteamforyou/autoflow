/**
 * Trigger helpers shared by the Library badges and the native trigger sync (pure, unit-tested).
 *
 * A flow is "armed" when the native side has something to watch for it: a non-manual trigger or a
 * start hotkey. Pausing keeps the flow untouched and only leaves it out of `triggers_sync`.
 */
import { hotkeyToString, type Flow, type Hotkey } from "@autoflow/core";

/** Every new flow gets this stop hotkey, so sharing it is by design and never a conflict. */
export const DEFAULT_STOP_HOTKEY: Hotkey = { key: "Escape", modifiers: ["ctrl", "alt"] };

export type HotkeyRole = "trigger" | "start" | "pause" | "stop";

export interface HotkeyConflict {
  /** Display form, e.g. "Ctrl+Alt+K". */
  combo: string;
  role: HotkeyRole;
  otherFlowId: string;
  otherFlowName: string;
  otherRole: HotkeyRole;
}

/** True when the native side has to watch something for this flow (trigger or start hotkey). */
export function hasTrigger(flow: Pick<Flow, "trigger" | "hotkeys">): boolean {
  return flow.trigger.type !== "manual" || !!flow.hotkeys.start;
}

/** Flows handed to `triggers_sync`: armed and not paused by the user. */
export function armedFlows(flows: Flow[], paused: readonly string[] = []): Flow[] {
  const off = new Set(paused);
  return flows.filter((f) => hasTrigger(f) && !off.has(f.id));
}

/** Comparison key: modifier order and letter case must not hide a clash. */
export function comboKey(h: Hotkey): string {
  return hotkeyToString(h).toLowerCase();
}

interface Use {
  flow: Flow;
  role: HotkeyRole;
  hotkey: Hotkey;
  /** Set for an app-scoped hotkey trigger: it only fires while that app is in front. */
  app?: string;
}

function usesOf(flow: Flow, shared: Set<string>): Use[] {
  const out: Use[] = [];
  if (flow.trigger.type === "hotkey") out.push({ flow, role: "trigger", hotkey: flow.trigger.hotkey, app: flow.trigger.scope === "app" ? (flow.trigger.app ?? "").toLowerCase() : undefined });
  if (flow.hotkeys.start) out.push({ flow, role: "start", hotkey: flow.hotkeys.start });
  if (flow.hotkeys.pause) out.push({ flow, role: "pause", hotkey: flow.hotkeys.pause });
  // The emergency stop is the same on every flow on purpose.
  if (!shared.has(comboKey(flow.hotkeys.stop))) out.push({ flow, role: "stop", hotkey: flow.hotkeys.stop });
  return out;
}

/**
 * Hotkey combinations used by more than one armed flow, per flow id. Paused and manual flows are
 * ignored (nothing is registered for them). `emergencyStop` is the user's Halt hotkey: like the
 * default Ctrl+Alt+Esc it may be every flow's stop hotkey without counting as a clash.
 */
export function hotkeyConflicts(flows: Flow[], opts: { paused?: readonly string[]; emergencyStop?: Hotkey } = {}): Record<string, HotkeyConflict[]> {
  const shared = new Set([comboKey(DEFAULT_STOP_HOTKEY)]);
  if (opts.emergencyStop) shared.add(comboKey(opts.emergencyStop));
  const byCombo = new Map<string, Use[]>();
  for (const f of armedFlows(flows, opts.paused)) {
    for (const u of usesOf(f, shared)) {
      const k = comboKey(u.hotkey);
      const list = byCombo.get(k);
      if (list) list.push(u);
      else byCombo.set(k, [u]);
    }
  }
  const out: Record<string, HotkeyConflict[]> = {};
  for (const uses of byCombo.values()) {
    if (uses.length < 2) continue;
    for (const a of uses) {
      for (const b of uses) {
        if (a.flow.id === b.flow.id) continue;
        // Two app-scoped triggers for different apps can never fire at the same time.
        if (a.app !== undefined && b.app !== undefined && a.app !== b.app) continue;
        (out[a.flow.id] ??= []).push({ combo: hotkeyToString(a.hotkey), role: a.role, otherFlowId: b.flow.id, otherFlowName: b.flow.name, otherRole: b.role });
      }
    }
  }
  return out;
}
