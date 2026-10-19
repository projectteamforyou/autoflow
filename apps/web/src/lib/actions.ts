/**
 * Cross-page actions: start a flow on the best target, export/share, create from a kind.
 */
import type { NavigateFunction } from "react-router-dom";
import { applyEasy, createFlow, defaultEasyModel, encodeShareCode, exportFlow, newId, type EasyKind, type Flow } from "@autoflow/core";
import { hasNativeBridge } from "../platform";
import { runNative } from "./runner";
import { useStore } from "./store";
import { download } from "../components/ui";
import { promptDialog } from "./dialog";
import { t } from "../i18n";

/** Collects declared input values (variables with a prompt) before a run. */
export async function collectInputs(flow: Flow): Promise<Record<string, string> | null> {
  const out: Record<string, string> = {};
  for (const v of flow.variables.filter((x) => x.prompt)) {
    const val = await promptDialog({ title: flow.name, input: { label: v.prompt!, value: v.initial !== undefined ? String(v.initial) : "", type: "textarea" }, confirmLabel: t("common.next") });
    if (val === null) return null;
    out[v.name] = val;
  }
  return out;
}

/** Native app → native executor; browser → Practice Canvas. */
export async function startFlow(flow: Flow, navigate: NavigateFunction): Promise<void> {
  if (hasNativeBridge) {
    const inputs = await collectInputs(flow);
    if (inputs === null) return;
    try {
      await runNative(flow, inputs);
    } catch (e) {
      useStore.getState().toast("error", (e as Error).message);
    }
    return;
  }
  navigate(`/canvas?flow=${encodeURIComponent(flow.id)}&autorun=1`);
}

export async function exportToFile(flow: Flow): Promise<void> {
  const text = await exportFlow(flow);
  const safe = flow.name.replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 40) || "flow";
  download(`${safe}.autoflow.json`, text);
}

export async function shareLink(flow: Flow): Promise<string> {
  const code = await encodeShareCode(flow);
  const base = location.href.split("#")[0];
  const url = `${base}#/import?code=${code}`;
  try {
    if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) await navigator.share({ title: flow.name, text: t("share.text"), url });
    else await navigator.clipboard.writeText(url);
    useStore.getState().toast("success", t("share.copied"));
  } catch {
    /* user cancelled share */
  }
  return url;
}

export async function createFromKind(kind: string): Promise<Flow> {
  const st = useStore.getState();
  const s = st.settings;
  const base = createFlow({ name: t(`new.name.${kind}`), id: newId("f"), limits: { countdownMs: s.countdownMs, maxDurationMs: s.maxDurationMs }, hotkeys: { stop: s.haltHotkey } });
  let flow: Flow;
  if (kind === "click" || kind === "multiClick" || kind === "keys" || kind === "text") {
    const m = defaultEasyModel(kind as EasyKind);
    if (kind === "multiClick") m.points = [{ x: 0.35, y: 0.5, button: "left", clicks: 1, holdMs: 0 }, { x: 0.65, y: 0.5, button: "left", clicks: 1, holdMs: 0 }];
    flow = applyEasy(base, m);
    flow.icon = kind === "keys" ? "keyboard" : kind === "text" ? "pen" : kind === "multiClick" ? "target" : "cursor";
  } else {
    flow = { ...base, mode: "pro", icon: kind === "record" ? "sparkles" : "workflow", color: kind === "record" ? "#EF4444" : "#F59E0B" };
  }
  return st.saveFlow(flow, { snapshot: false });
}
