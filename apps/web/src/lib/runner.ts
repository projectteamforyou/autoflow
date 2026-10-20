/**
 * Run orchestration for every surface:
 * - "canvas": the TypeScript engine against the SandboxBackend (browser, previews, practice)
 * - "native": the Rust (Windows) or Kotlin (Android) executor through the bridge
 * Both feed the same Pulse bar and Ledger.
 */
import { createElement } from "react";
import {
  FlowRun,
  SandboxBackend,
  type DisplayInfo,
  type PracticeWorld,
  type Flow,
  type Platform,
  type RiskReport,
  type RunEvent,
  type RunResult,
  type SandboxEffect,
  type ScreenInfo,
  type BridgeEvent,
} from "@autoflow/core";
import { useStore, type RunRecord } from "./store";
import { confirmDialog } from "./dialog";
import { vault } from "./crypto";
import { t } from "../i18n";
import { hasNativeBridge, invoke, onBridgeEvent, platform } from "../platform";

interface Live {
  runId: string;
  record: RunRecord;
  engine?: FlowRun;
}

const live = new Map<string, Live>();

function simulatedPlatform(flow: Flow): Platform {
  if (flow.targets.includes("windows")) return "windows";
  if (flow.targets.includes("android")) return "android";
  return "web";
}

export async function askRisk(report: RiskReport): Promise<boolean> {
  return confirmDialog({
    title: t("run.risk.title"),
    tone: report.level === "high" ? "danger" : "warning",
    body: createElement(
      "div",
      { className: "stack-sm" },
      createElement("p", null, t("run.risk.body", { score: report.score })),
      createElement(
        "ul",
        { className: "bullets" },
        report.findings.filter((f) => f.needsConfirm).map((f, i) => createElement("li", { key: i }, t(f.key))),
      ),
    ),
    confirmLabel: t("run.risk.approve"),
  });
}

export async function askScreenChange(rec: ScreenInfo, now: ScreenInfo): Promise<boolean> {
  return confirmDialog({
    title: t("run.screen.title"),
    tone: "warning",
    body: t("run.screen.body", { from: `${rec.width}×${rec.height} @${rec.scale}x`, to: `${now.width}×${now.height} @${now.scale}x` }),
    confirmLabel: t("run.screen.continue"),
  });
}

function begin(flow: Flow, where: "canvas" | "native", runId: string, plat: Platform): Live {
  const record: RunRecord = { id: runId, flowId: flow.id, flowName: flow.name, platform: plat, where, status: "running", actions: 0, iterations: 0, durationMs: 0, startedAt: Date.now(), events: [] };
  const l: Live = { runId, record };
  live.set(runId, l);
  useStore.getState().setActive({ runId, flowId: flow.id, flowName: flow.name, where, state: "preflight", startedAt: Date.now(), actions: 0 });
  return l;
}

function onEvent(l: Live, e: RunEvent): void {
  l.record.events.push(e);
  if (l.record.events.length > 2500) l.record.events.splice(0, 500);
  const set = useStore.getState().setActive;
  if (e.type === "state") set((a) => (a && a.runId === l.runId ? { ...a, state: e.state, countdownMs: e.state === "countdown" ? a.countdownMs : undefined } : a));
  else if (e.type === "countdown") set((a) => (a && a.runId === l.runId ? { ...a, countdownMs: e.remainingMs } : a));
  else if (e.type === "stepStart") set((a) => (a && a.runId === l.runId ? { ...a, stepId: e.stepId, actions: a.actions + (["click", "move", "drag", "scroll", "key", "type"].includes(e.stepType) ? 1 : 0) } : a));
}

async function end(l: Live, result: RunResult): Promise<void> {
  live.delete(l.runId);
  Object.assign(l.record, { status: result.status, reason: result.reason, error: result.error, actions: result.actions, iterations: result.iterations, durationMs: result.durationMs, endedAt: Date.now() });
  const st = useStore.getState();
  await st.recordRun(l.record);
  st.setActive((a) => (a && a.runId === l.runId ? null : a));
  if (result.status === "completed") st.toast("success", t("run.done", { name: l.record.flowName }));
  else if (result.status === "stopped") st.toast("info", t("run.stopped", { name: l.record.flowName }));
  else st.toast("error", t("run.failed", { name: l.record.flowName, error: result.error?.message ?? "" }));
}

export interface CanvasRunOptions {
  onEffect?: (e: SandboxEffect) => void;
  screen?: ScreenInfo;
  debug?: boolean;
  speed?: number;
  skipCountdown?: boolean;
  inputs?: Record<string, string | number | boolean>;
  notify?: (title: string, body: string) => void;
  /** Simulated monitors, pixels and scenes (Stage / multi-monitor practice). */
  world?: PracticeWorld;
  displays?: DisplayInfo[];
}

/** onMissingDisplay "ask" on the canvas: the same question native runs ask in a system dialog. */
export async function askMissingDisplay(label: string): Promise<boolean> {
  return confirmDialog({ title: t("stage.missing.title"), tone: "warning", body: t("stage.missing.body", { display: label }), confirmLabel: t("stage.missing.usePrimary") });
}

/** Runs a flow in the Practice Canvas sandbox (real engine, virtual screen). */
export async function runInCanvas(flow: Flow, opts: CanvasRunOptions = {}): Promise<{ run: FlowRun; done: Promise<RunResult>; backend: SandboxBackend }> {
  const plat = simulatedPlatform(flow);
  const runId = `canvas_${Date.now().toString(36)}`;
  const l = begin(flow, "canvas", runId, plat);
  const flows = useStore.getState().flows;
  const secrets = await vault.snapshot();
  const backend = new SandboxBackend({
    platform: plat,
    screen: opts.screen,
    onEffect: opts.onEffect,
    notify: opts.notify,
    confirm: (msg) => confirmDialog({ title: t("run.confirmStep"), body: msg, confirmLabel: t("common.yes"), cancelLabel: t("common.no") }),
    actionDelayMs: Math.round(60 / (opts.speed ?? 1)),
    world: opts.world,
    displays: opts.displays,
  });
  const run = new FlowRun(flow, backend, {
    onEvent: (e) => onEvent(l, e),
    confirmRisk: askRisk,
    confirmScreenChange: async () => true, // the virtual screen always matches by construction
    confirmMissingDisplay: askMissingDisplay,
    resolveFlow: (id) => flows.find((f) => f.id === id),
    secret: (name) => secrets[name],
    debug: opts.debug,
    skipCountdown: opts.skipCountdown ?? true,
    inputs: opts.inputs,
  });
  l.engine = run;
  const done = run.start().then(async (r) => {
    await end(l, r);
    return r;
  });
  return { run, done, backend };
}

let bridgeAttached = false;
function attachBridge(): void {
  if (bridgeAttached || !hasNativeBridge) return;
  bridgeAttached = true;
  onBridgeEvent((e: BridgeEvent) => {
    if (e.kind === "run") {
      const l = live.get(e.runId);
      if (l) onEvent(l, e.event);
    } else if (e.kind === "runEnded") {
      const l = live.get(e.runId);
      if (l) void end(l, e.result);
    } else if (e.kind === "hotkey" && e.action === "halt") {
      useStore.getState().toast("warning", t("pulse.halted"));
    }
  });
}

/** Runs a flow on this device's native executor (Windows / Android app). */
export async function runNative(flow: Flow, inputs?: Record<string, unknown>): Promise<string | null> {
  attachBridge();
  const { risk } = FlowRun.preflight(flow, platform);
  const blocked = FlowRun.preflight(flow, platform).blocked;
  if (blocked.length) {
    useStore.getState().toast("error", t("run.unsupported", { n: blocked.length }));
    return null;
  }
  let approvedRisk = !risk.needsConfirm;
  if (risk.needsConfirm) approvedRisk = await askRisk(risk);
  if (!approvedRisk) return null;
  let approvedScreenChange = false;
  if (flow.screen) {
    try {
      const info = await invoke("device_info", {});
      const live0 = info.screens.find((s) => s.primary) ?? info.screens[0];
      if (live0 && (live0.width !== flow.screen.width || live0.height !== flow.screen.height)) {
        approvedScreenChange = await askScreenChange({ ...flow.screen, scale: flow.screen.scale ?? 1 }, live0);
        if (!approvedScreenChange) return null;
      }
    } catch {
      /* device_info unavailable — the executor will re-check */
    }
  }
  const { runId } = await invoke("run_start", { flow, inputs, approvedRisk, approvedScreenChange });
  begin(flow, "native", runId, platform);
  return runId;
}

export function pauseRun(runId: string): void {
  const l = live.get(runId);
  if (l?.engine) l.engine.pause();
  else void invoke("run_pause", { runId }).catch(() => undefined);
}

export function resumeRun(runId: string): void {
  const l = live.get(runId);
  if (l?.engine) l.engine.resume();
  else void invoke("run_resume", { runId }).catch(() => undefined);
}

export function stepRun(runId: string): void {
  live.get(runId)?.engine?.stepOver();
}

export function stopRun(runId: string, reason = "user"): void {
  const l = live.get(runId);
  if (l?.engine) l.engine.stop(reason);
  else void invoke("run_stop", { runId, reason }).catch(() => undefined);
}

/** Halt: stop everything, everywhere, immediately. */
export function haltAll(): void {
  for (const l of live.values()) l.engine?.stop("halt");
  if (hasNativeBridge) void invoke("halt_all", {}).catch(() => undefined);
  useStore.getState().toast("warning", t("pulse.halted"));
}

export function liveEngine(runId: string): FlowRun | undefined {
  return live.get(runId)?.engine;
}

/** Live counters of a canvas run (loop rounds for the Stage HUD); native runs report none. */
export function liveCounters(runId: string): { actions: number; iterations: number; steps: number } | undefined {
  return live.get(runId)?.engine?.counters;
}

/** Live event buffer of a running flow (for the Practice Canvas log). */
export function liveEvents(runId: string): RunEvent[] | undefined {
  return live.get(runId)?.record.events;
}
