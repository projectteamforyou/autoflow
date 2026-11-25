import { describeTrigger, hotkeyToString, type Flow, type Hotkey } from "@autoflow/core";
import { Icon } from "./Icon";
import { Switch } from "./ui";
import { useStore } from "../lib/store";
import { hasTrigger, hotkeyConflicts, type HotkeyConflict } from "../lib/triggers";
import { tp, useT } from "../i18n";

// One conflict scan per library state, shared by every badge on the page (each card would otherwise rescan all flows).
let memo: { flows: Flow[]; paused: string[]; halt: Hotkey; out: Record<string, HotkeyConflict[]> } | null = null;
function conflictsOf(flows: Flow[], paused: string[], halt: Hotkey): Record<string, HotkeyConflict[]> {
  if (!memo || memo.flows !== flows || memo.paused !== paused || memo.halt !== halt) memo = { flows, paused, halt, out: hotkeyConflicts(flows, { paused, emergencyStop: halt }) };
  return memo.out;
}

/**
 * What starts a flow by itself (trigger and/or start hotkey) with a switch that pauses it without
 * editing the flow, plus warnings: a hotkey shared with another armed flow, and the reason the
 * native side gave when it could not register the trigger. Renders nothing for purely manual flows.
 */
export function TriggerBadge({ flow }: { flow: Flow }) {
  const t = useT();
  const paused = useStore((s) => s.settings.pausedTriggers);
  const halt = useStore((s) => s.settings.haltHotkey);
  const flows = useStore((s) => s.flows);
  const failure = useStore((s) => s.triggerFailures[flow.id]);
  const setPaused = useStore((s) => s.setTriggerPaused);
  const toast = useStore((s) => s.toast);
  if (!hasTrigger(flow)) return null;
  const off = paused.includes(flow.id);
  const conflicts = off ? [] : (conflictsOf(flows, paused, halt)[flow.id] ?? []);
  const parts: string[] = [];
  if (flow.trigger.type !== "manual") parts.push(tp(describeTrigger(flow.trigger)));
  if (flow.hotkeys.start) parts.push(t("triggers.startHotkey", { key: hotkeyToString(flow.hotkeys.start) }));
  const label = parts.join(" · ");
  // Same combination listed once per other flow, not once per role pair.
  const conflictText = [...new Set(conflicts.map((c) => t("triggers.conflictWith", { key: c.combo, name: c.otherFlowName })))].join("\n");
  return (
    <span className={`trigger-badge${off ? " off" : ""}`}>
      <span className="badge" title={label}>
        <Icon name={flow.trigger.type === "hotkey" || flow.trigger.type === "manual" ? "Keyboard" : "Zap"} size={12} />
        <span className="truncate">{off ? t("triggers.paused") : label}</span>
      </span>
      <Switch checked={!off} onChange={(on) => void setPaused([flow.id], !on)} label={t("triggers.switch", { name: flow.name })} />
      {conflicts.length > 0 && (
        <button type="button" className="badge warn" title={conflictText} onClick={() => toast("warning", conflictText)}>
          <Icon name="TriangleAlert" size={12} /> {t("triggers.conflict")}
        </button>
      )}
      {failure && !off && (
        <button type="button" className="badge err" title={failure} onClick={() => toast("error", `${flow.name}: ${failure}`)}>
          <Icon name="TriangleAlert" size={12} /> <span className="truncate">{t("triggers.failed", { reason: failure })}</span>
        </button>
      )}
    </span>
  );
}
