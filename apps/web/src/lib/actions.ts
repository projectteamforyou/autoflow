/**
 * Cross-page actions: start a flow on the best target, export/share, create from a kind.
 */
import type { NavigateFunction } from "react-router-dom";
import { applyEasy, createFlow, defaultEasyModel, encodeShareCode, exportFlow, newId, type EasyKind, type Flow } from "@autoflow/core";
import { hasNativeBridge } from "../platform";
import { runInCanvas, runNative } from "./runner";
import { useStore } from "./store";
import { download } from "../components/ui";
import { confirmDialog, promptDialog } from "./dialog";
import { backupFileName, buildBackup, mergePausedTriggers, parseBackup } from "./backup";
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

/**
 * Native app → native executor; browser → Practice Canvas.
 * `transient`: the flow object is a temporary, unsaved variant (editor "run from here"). The native
 * executor takes the object as is; the Practice Canvas page loads flows from the store by id, so in
 * the browser a transient flow runs right here in the sandbox instead (Pulse bar + Ledger as usual).
 */
export async function startFlow(flow: Flow, navigate: NavigateFunction, opts: { transient?: boolean } = {}): Promise<void> {
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
  if (opts.transient) {
    const inputs = await collectInputs(flow);
    if (inputs === null) return;
    try {
      await runInCanvas(flow, { inputs, speed: useStore.getState().settings.canvasSpeed });
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
  } catch (e) {
    // Cancelling the share sheet is not an error; anything else (clipboard blocked…) gets a manual-copy fallback.
    if ((e as Error).name !== "AbortError") await promptDialog({ title: t("flows.share"), body: t("share.copyManually"), input: { label: "URL", value: url }, confirmLabel: t("common.close") });
  }
  return url;
}

/** Downloads a backup file. No `flows` = the whole library with Keyforge profiles and settings; with `flows` = just those flows. */
export function downloadBackup(flows?: Flow[]): void {
  const st = useStore.getState();
  const backup = flows ? buildBackup({ flows }) : buildBackup({ flows: st.flows, profiles: st.profiles, settings: st.settings });
  download(backupFileName(new Date(), flows ? `-${flows.length}-flows` : ""), JSON.stringify(backup, null, 2));
}

export interface RestoreResult {
  flows: number;
  profiles: number;
  settings: boolean;
}

/** "Replace / Keep both" for imported flows whose id is already in the library. Closing the dialog keeps both (nothing is overwritten). */
async function askConflict(names: string[]): Promise<"replace" | "copy"> {
  const body = names.length === 1 ? t("import.conflict.one", { name: names[0]! }) : t("import.conflict.many", { n: names.length });
  return (await confirmDialog({ title: t("import.conflict.title"), body, tone: "warning", confirmLabel: t("import.conflict.replace"), cancelLabel: t("import.conflict.keepBoth") })) ? "replace" : "copy";
}

/**
 * Restores an "autoflow.backup" file (flows, Keyforge profiles, settings) into the local store.
 * Resolves null when the file is not a backup, so callers can fall back to single-flow import.
 * Flows that already exist ask "Replace / Keep both"; settings are applied only after a confirm.
 */
export async function restoreBackupFile(file: File): Promise<RestoreResult | null> {
  if (file.size > 2_000_000) throw new Error(t("import.tooLarge"));
  const backup = parseBackup(await file.text());
  if (!backup) return null;
  const st = useStore.getState();
  const have = new Map(st.flows.map((f) => [f.id, f.name]));
  const clashes = backup.flows.filter((f) => have.has(f.id)).map((f) => have.get(f.id)!);
  const { count, idMap } = await st.importFlows(backup.flows, clashes.length ? await askConflict(clashes) : "copy");
  for (const p of backup.profiles) await st.saveProfile(p);
  let settings = false;
  if (Object.keys(backup.settings).length && (await confirmDialog({ title: t("import.settings.title"), body: t("import.settings.body"), confirmLabel: t("import.settings.apply"), cancelLabel: t("import.settings.skip") }))) {
    const now = useStore.getState();
    await now.updateSettings({ ...backup.settings, pausedTriggers: mergePausedTriggers(now.settings.pausedTriggers, backup.settings.pausedTriggers, idMap, new Set(now.flows.map((f) => f.id))) });
    settings = true;
  }
  return { flows: count, profiles: backup.profiles.length, settings };
}

/** Toast for a finished restore (counts profiles only when the backup had any). */
export function toastRestored(r: { flows: number; profiles: number; settings?: boolean }): void {
  const text = r.profiles ? t("import.restoredProfiles", { n: r.flows, p: r.profiles }) : t("import.restored", { n: r.flows });
  useStore.getState().toast("success", r.settings ? `${text} ${t("import.settings.applied")}` : text);
}

/**
 * Saves a reviewed single-flow import. When a flow with the same id is already in the library the
 * user picks "Replace" (same id, old steps go to the version history) or "Keep both" (new id).
 */
export async function saveImportedFlow(flow: Flow): Promise<Flow> {
  const st = useStore.getState();
  const existing = st.flows.find((f) => f.id === flow.id);
  const now = new Date().toISOString();
  if (existing && (await askConflict([existing.name])) === "replace") {
    // Local-only fields follow the library copy: a shared file carries neither folder nor favorite.
    return st.saveFlow({ ...flow, favorite: existing.favorite, folder: existing.folder, createdAt: existing.createdAt, updatedAt: now }, { note: "import" });
  }
  return st.saveFlow({ ...flow, id: existing ? newId("f") : flow.id, createdAt: now, updatedAt: now, revision: 0 }, { snapshot: false });
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
    // Pro users get the same flow opened in the full editor (it stays Easy-compatible).
    if (s.defaultMode === "pro") flow = { ...flow, mode: "pro" };
    flow.icon = kind === "keys" ? "keyboard" : kind === "text" ? "pen" : kind === "multiClick" ? "target" : "cursor";
  } else {
    flow = { ...base, mode: "pro", icon: kind === "record" ? "sparkles" : "workflow", color: kind === "record" ? "#EF4444" : "#F59E0B" };
  }
  return st.saveFlow(flow, { snapshot: false });
}
