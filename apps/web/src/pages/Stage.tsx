/**
 * Stage — multi-monitor runs. The flow plays on one monitor (the stage) while AutoFlow stays on
 * another (the deck): pick the stage on a to-scale map of every monitor, flash their numbers, pin
 * the deck, remember screens as Scenes, and watch the run in a live HUD with a minimap of the
 * stage, the next click point, pause / resume / Halt and the takeover guard.
 *
 * In the browser the monitors are the simulated Practice layout (a deterministic idle game on
 * monitor 2), so Stage and Scenes can be tried without installing anything.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  MAX_SCENE_THUMB_CHARS,
  analyzeRisk,
  describeDisplay,
  describeStep,
  findStep,
  hashSimilarity,
  hotkeyToString,
  placeRect,
  previewPoint,
  walkSteps,
  type DisplayInfo,
  type Flow,
  type OnMissingDisplay,
  type Rect,
  type RunEvent,
  type SandboxBackend,
  type Scene,
  type Step,
} from "@autoflow/core";
import { Shell } from "../components/Shell";
import { Icon } from "../components/Icon";
import { Field, Seg, Switch } from "../components/ui";
import { useStore } from "../lib/store";
import { practiceWorld, refFor, renderPractice, sameDisplay, useDisplays } from "../lib/displays";
import { haltAll, liveCounters, liveEvents, pauseRun, resumeRun, runInCanvas, runNative, stopRun } from "../lib/runner";
import { collectInputs } from "../lib/actions";
import { formatDuration, tp, useT } from "../i18n";
import { hasNativeBridge, invoke } from "../platform";

const REGIONS: Record<string, Rect> = {
  content: { x: 0, y: 0.1, w: 1, h: 0.9 },
  full: { x: 0, y: 0, w: 1, h: 1 },
  center: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
};

/** Bounding box of all monitors, for drawing the map to scale. */
function extent(displays: DisplayInfo[]) {
  const xs = displays.flatMap((d) => [d.bounds.x, d.bounds.x + d.bounds.w]);
  const ys = displays.flatMap((d) => [d.bounds.y, d.bounds.y + d.bounds.h]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x || 1, h: Math.max(...ys) - y || 1 };
}

/** A small data-URL preview of a practice region, kept under the schema's size cap. */
function practiceThumb(rect: Rect, count: number): string | undefined {
  const world = practiceWorld(count);
  for (const width of [160, 112, 80]) {
    const height = Math.max(1, Math.round((width * rect.h) / rect.w));
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d");
    if (!ctx) return undefined;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(world.sample(rect, width, height)), width, height), 0, 0);
    for (const url of [c.toDataURL("image/png"), c.toDataURL("image/jpeg", 0.7)]) if (url.length <= MAX_SCENE_THUMB_CHARS && /^data:image\/(png|jpeg);base64,/.test(url)) return url;
  }
  return undefined;
}

/** The next click/move/drag point after (or at) the current step, in document order. */
function nextPointStep(flow: Flow, currentId: string | undefined): Step | undefined {
  const order: Step[] = [];
  walkSteps(flow.steps, (s) => order.push(s));
  const start = Math.max(0, order.findIndex((s) => s.id === currentId));
  const pick = (s: Step) => s.type === "click" || s.type === "move" || s.type === "drag";
  return order.slice(start).find(pick) ?? order.find(pick);
}

export function StagePage() {
  const t = useT();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const flows = useStore((s) => s.flows);
  const active = useStore((s) => s.active);
  const save = useStore((s) => s.saveFlow);
  const toast = useStore((s) => s.toast);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const { displays, practice, error } = useDisplays(2);
  const count = displays.length;
  const [flowId, setFlowId] = useState<string>(params.get("flow") ?? flows.find((f) => f.stage)?.id ?? flows[0]?.id ?? "");
  const flow = flows.find((f) => f.id === flowId);

  const initialStage = () => {
    const i = displays.findIndex((d) => sameDisplay(displays, flow?.stage?.display, d));
    return i >= 0 ? i : Math.min(1, Math.max(0, displays.length - 1));
  };
  const [sel, setSel] = useState(initialStage);
  const [deck, setDeck] = useState(0);
  const [flash, setFlash] = useState(false);
  const [pause, setPause] = useState(flow?.stage?.pauseOnTakeover !== false);
  const [px, setPx] = useState(flow?.stage?.takeoverPx ?? 24);
  const [missing, setMissing] = useState<OnMissingDisplay>(flow?.onMissingDisplay ?? "ask");
  useEffect(() => {
    setSel(initialStage());
    setPause(flow?.stage?.pauseOnTakeover !== false);
    setPx(flow?.stage?.takeoverPx ?? 24);
    setMissing(flow?.onMissingDisplay ?? "ask");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowId, count]);
  useEffect(() => {
    if (deck === sel || deck >= count) setDeck(displays.findIndex((_, i) => i !== sel) >= 0 ? displays.findIndex((_, i) => i !== sel) : 0);
  }, [sel, deck, count, displays]);

  const stageDisplay = displays[sel];
  const box = useMemo(() => extent(displays.length ? displays : [{ bounds: { x: 0, y: 0, w: 16, h: 9 } } as DisplayInfo]), [displays]);

  /* ------------------------------------------------------------ actions */

  const identify = async () => {
    setFlash(true);
    setTimeout(() => setFlash(false), 2500);
    if (hasNativeBridge) await invoke("displays_identify", { durationMs: 2500 }).catch((e: Error) => toast("warning", e.message));
  };

  const pinDeck = async () => {
    const d = displays[deck];
    if (d) await invoke("deck_pin", { displayId: d.id }).then(() => toast("success", t("stage.deckPinned", { n: deck + 1 })), (e: Error) => toast("error", e.message));
  };

  const applyStage = async () => {
    if (!flow || !stageDisplay) return;
    const next: Flow = {
      ...flow,
      stage: { display: refFor(displays, stageDisplay), ...(pause ? {} : { pauseOnTakeover: false }), ...(px !== 24 ? { takeoverPx: px } : {}) },
      onMissingDisplay: missing,
    };
    await save(next);
    toast("success", t("stage.applied", { n: sel + 1 }));
  };

  const clearStage = async () => {
    if (!flow) return;
    const { stage: _s, ...rest } = flow;
    await save(rest as Flow);
  };

  /* -------------------------------------------------------------- scenes */

  const [sceneName, setSceneName] = useState("lobby");
  const [preset, setPreset] = useState("content");
  const [busy, setBusy] = useState(false);
  const [matches, setMatches] = useState<Record<string, number>>({});

  const sceneDisplay = (s: Scene): DisplayInfo | undefined => displays.find((d) => sameDisplay(displays, s.display ?? flow?.stage?.display ?? "primary", d));

  const liveHash = async (d: DisplayInfo, region: Rect): Promise<{ hash: string; thumb?: string }> => {
    if (practice) {
      const rect = placeRect(d.bounds, region, "normalized");
      return { hash: practiceWorld(count).sceneHash(rect), thumb: practiceThumb(rect, count) };
    }
    return invoke("scene_capture", { displayId: d.id, region });
  };

  const captureScene = async () => {
    if (!flow || !stageDisplay) return;
    const name = sceneName.trim();
    if (!/^[A-Za-z0-9_-]{1,48}$/.test(name)) return toast("error", t("scene.badName"));
    setBusy(true);
    try {
      const region = REGIONS[preset] ?? REGIONS.content!;
      const { hash, thumb } = await liveHash(stageDisplay, region);
      const onStage = sameDisplay(displays, flow.stage?.display, stageDisplay);
      const scene: Scene = { name, region, hash, ...(onStage ? {} : { display: refFor(displays, stageDisplay) }), ...(thumb ? { thumb } : {}) };
      const others = (flow.scenes ?? []).filter((s) => s.name !== name);
      if (others.length >= 32) return toast("error", t("scene.tooMany"));
      await save({ ...flow, scenes: [...others, scene] });
      toast("success", t("scene.saved", { name }));
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const testScenes = async () => {
    if (!flow?.scenes?.length) return;
    setBusy(true);
    try {
      const out: Record<string, number> = {};
      for (const s of flow.scenes) {
        const d = sceneDisplay(s);
        if (d) out[s.name] = hashSimilarity((await liveHash(d, s.region)).hash, s.hash);
      }
      setMatches(out);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const deleteScene = async (name: string) => {
    if (!flow) return;
    const scenes = (flow.scenes ?? []).filter((s) => s.name !== name);
    const { scenes: _old, ...rest } = flow;
    await save(scenes.length ? { ...flow, scenes } : (rest as Flow));
  };

  /* ------------------------------------------------------------------ run */

  const myActive = active && flow && active.flowId === flow.id ? active : null;
  const backend = useRef<SandboxBackend | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [now, setNow] = useState(Date.now());
  // Keyed by run id: the active-run object changes on every step, which would keep resetting the timer.
  const runId = myActive?.runId;
  useEffect(() => {
    if (!runId) return;
    const tick = () => {
      setNow(Date.now());
      const ev = liveEvents(runId);
      if (ev) setEvents([...ev]);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [runId]);
  // After a run, keep showing its log from the Ledger record.
  const runs = useStore((s) => s.runs);
  useEffect(() => {
    if (!runId && runs[0] && runs[0].flowId === flow?.id) setEvents(runs[0].events);
  }, [runId, runs, flow?.id]);

  const run = useCallback(async () => {
    if (!flow || myActive) return;
    const inputs = await collectInputs(flow);
    if (inputs === null) return;
    setEvents([]);
    if (hasNativeBridge) {
      await runNative(flow, inputs);
      return;
    }
    const world = practiceWorld(count);
    const r = await runInCanvas(flow, { world, displays: world.displays, speed: settings.canvasSpeed, inputs, notify: (title, body) => toast("info", `${title} — ${body}`) });
    backend.current = r.backend;
    void r.done.finally(() => (backend.current = null));
  }, [flow, myActive, count, settings.canvasSpeed, toast]);

  /** Browser practice: move the virtual pointer onto the deck as if you grabbed the mouse. */
  const simulateTakeover = () => {
    const d = displays[deck] ?? displays[0];
    if (backend.current && d) backend.current.pointer = { x: d.bounds.x + d.bounds.w / 2, y: d.bounds.y + d.bounds.h / 2 };
  };

  const step = flow && myActive?.stepId ? findStep(flow.steps, myActive.stepId) : undefined;
  const lastStart = [...events].reverse().find((e): e is Extract<RunEvent, { type: "stepStart" }> => e.type === "stepStart");
  const rounds = myActive ? (liveCounters(myActive.runId)?.iterations ?? events.filter((e) => e.type === "stepStart" && e.stepType === "loop").length) : 0;
  const lastLog = [...events].reverse().find((e): e is Extract<RunEvent, { type: "log" }> => e.type === "log");
  const tookOver = myActive?.state === "paused" && !!lastLog?.message.startsWith("takeover:");
  let next = t("stage.hud.now");
  if (step?.type === "wait" && lastStart) next = formatDuration(Math.max(0, step.ms - (now - lastStart.at)));
  else if (step && (step.type === "waitFor" || step.type === "waitForPixel" || step.type === "matchScene")) next = t("stage.hud.watching");
  else if (step?.type === "loop" && step.cooldownMs) next = t("stage.hud.cooldown");
  const pointStep = flow ? nextPointStep(flow, myActive?.stepId) : undefined;
  const pointTarget = pointStep?.type === "drag" ? pointStep.from : pointStep && "target" in pointStep ? pointStep.target : undefined;
  const nextPoint = pointTarget && flow ? previewPoint(pointTarget, displays, flow.stage?.display) : undefined;

  /* ------------------------------------------------------------ minimap */

  const mini = useRef<HTMLCanvasElement>(null);
  const shownStage = displays.find((d) => sameDisplay(displays, flow?.stage?.display, d)) ?? stageDisplay;
  useEffect(() => {
    const draw = () => {
      const c = mini.current;
      const d = shownStage;
      if (!c || !d) return;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      if (practice) {
        const img = renderPractice(practiceWorld(count), d, 160, Math.max(1, Math.round((160 * d.bounds.h) / d.bounds.w)));
        const tmp = document.createElement("canvas");
        tmp.width = img.width;
        tmp.height = img.height;
        tmp.getContext("2d")?.putImageData(img, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tmp, 0, 0, c.width, c.height);
      } else {
        ctx.fillStyle = "#14162b";
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.strokeStyle = "rgba(255,255,255,.08)";
        for (let i = 1; i < 10; i++) {
          ctx.beginPath();
          ctx.moveTo((c.width * i) / 10, 0);
          ctx.lineTo((c.width * i) / 10, c.height);
          ctx.moveTo(0, (c.height * i) / 10);
          ctx.lineTo(c.width, (c.height * i) / 10);
          ctx.stroke();
        }
      }
      if (nextPoint && nextPoint.display.id === d.id) {
        const x = ((nextPoint.x - d.bounds.x) / d.bounds.w) * c.width;
        const y = ((nextPoint.y - d.bounds.y) / d.bounds.h) * c.height;
        ctx.strokeStyle = "#22C3A6";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "#22C3A6";
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    draw();
    const id = setInterval(draw, runId ? 200 : 1000);
    return () => clearInterval(id);
  }, [shownStage, practice, count, nextPoint?.x, nextPoint?.y, nextPoint?.display.id, runId]);

  const world = practice ? practiceWorld(count) : null;
  const risk = flow ? analyzeRisk(flow) : undefined;
  const elapsed = myActive ? Math.max(0, now - myActive.startedAt) : 0;

  return (
    <Shell
      title={
        <div className="row grow">
          <h2 className="truncate">{t("nav.stage")}</h2>
          <select className="select" style={{ width: "auto", maxWidth: "min(260px, 42vw)", height: 32 }} value={flowId} disabled={!!myActive} aria-label={t("canvas.pickFlow")} onChange={(e) => { setFlowId(e.target.value); params.set("flow", e.target.value); setParams(params, { replace: true }); }}>
            {!flows.length && <option value="">{t("canvas.noFlows")}</option>}
            {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
      }
      actions={
        <div className="row stage-actions">
          {flow && <button className="btn sm ghost" onClick={() => navigate(`/flows/${flow.id}`)}><Icon name="Pen" size={14} /> {t("common.edit")}</button>}
          {myActive ? (
            <>
              {myActive.state === "paused" ? (
                <button className="btn sm primary" onClick={() => resumeRun(myActive.runId)}><Icon name="Play" size={14} /> {t("pulse.resume")}</button>
              ) : (
                <button className="btn sm" onClick={() => pauseRun(myActive.runId)}><Icon name="Pause" size={14} /> {t("pulse.pause")}</button>
              )}
              <button className="btn sm danger" onClick={() => stopRun(myActive.runId)}><Icon name="Square" size={14} /> {t("pulse.stop")}</button>
            </>
          ) : (
            <button className="btn sm primary" onClick={() => void run()} disabled={!flow}><Icon name="Play" size={14} /> {t("stage.run")}</button>
          )}
        </div>
      }
    >
      <div className="page stage-page">
        <div className="page-head">
          <div>
            <h1>{t("stage.title")}</h1>
            <p>{t("stage.sub")}</p>
          </div>
        </div>
        <div className="callout warn small"><Icon name="ShieldAlert" size={16} /> <span>{t("stage.tos")}</span></div>
        {practice && <div className="callout info small"><Icon name="Info" size={16} /> <span>{t("stage.practiceNote")}</span></div>}
        {error && <div className="callout err small">{error}</div>}

        <div className="grid cols-2 stage-grid">
          <section className="card stack" aria-label={t("stage.monitors")}>
            <div className="row between wrap">
              <h3><Icon name="Monitor" size={16} /> {t("stage.monitors")}</h3>
              <div className="row wrap">
                {practice && <Seg value={String(count)} onChange={(v) => void updateSettings({ practiceDisplays: Number(v) })} label={t("stage.practiceCount")} options={["2", "3", "4"].map((v) => ({ value: v, label: t("stage.nMonitors", { n: v }) }))} />}
                <button className="btn sm" onClick={() => void identify()}><Icon name="Hash" size={14} /> {t("stage.identify")}</button>
              </div>
            </div>
            <div className="monitor-map" style={{ aspectRatio: `${box.w} / ${box.h}` }}>
              {displays.map((d, i) => (
                <button
                  key={d.id}
                  type="button"
                  className={`monitor${i === sel ? " is-stage" : ""}${i === deck ? " is-deck" : ""}`}
                  style={{ left: `${((d.bounds.x - box.x) / box.w) * 100}%`, top: `${((d.bounds.y - box.y) / box.h) * 100}%`, width: `${(d.bounds.w / box.w) * 100}%`, height: `${(d.bounds.h / box.h) * 100}%` }}
                  onClick={() => setSel(i)}
                  aria-pressed={i === sel}
                  aria-label={t("stage.monitorLabel", { n: i + 1, w: d.bounds.w, h: d.bounds.h })}
                >
                  <b className={`num${flash ? " flash" : ""}`}>{i + 1}</b>
                  <span className="small">{d.bounds.w}×{d.bounds.h}{d.scale !== 1 ? ` · ${Math.round(d.scale * 100)}%` : ""}</span>
                  <span className="row wrap" style={{ justifyContent: "center", gap: 4 }}>
                    {d.primary && <span className="badge">{t("stage.primary")}</span>}
                    {i === sel && <span className="badge accent">{t("stage.stage")}</span>}
                    {i === deck && <span className="badge primary">{t("stage.deck")}</span>}
                  </span>
                </button>
              ))}
            </div>
            {count < 2 && !practice && <div className="callout warn small"><Icon name="Info" size={16} /> {t("stage.oneMonitor")}</div>}
            <div className="row wrap">
              <Field label={t("stage.deckLabel")}>
                <select className="select" value={deck} onChange={(e) => setDeck(Number(e.target.value))}>
                  {displays.map((d, i) => i !== sel && <option key={d.id} value={i}>{t("stage.monitorN", { n: i + 1 })}</option>)}
                </select>
              </Field>
              {hasNativeBridge && <button className="btn sm" onClick={() => void pinDeck()} disabled={count < 2}><Icon name="MonitorCog" size={14} /> {t("stage.pinDeck")}</button>}
            </div>
            <p className="hint">{t("stage.haltHint", { key: hotkeyToString(settings.haltHotkey) })}</p>
          </section>

          <section className="card stack" aria-label={t("stage.settings")}>
            <h3><Icon name="MonitorPlay" size={16} /> {t("stage.settings")}</h3>
            {!flow ? (
              <p className="muted small">{t("canvas.noFlows")}</p>
            ) : (
              <>
                <div className="small muted">{flow.stage ? t("stage.current", { display: tp(describeDisplay(flow.stage.display)) }) : t("stage.none")}</div>
                <div className="row between">
                  <span className="label">{t("stage.pauseOnTakeover")}</span>
                  <Switch checked={pause} onChange={setPause} label={t("stage.pauseOnTakeover")} />
                </div>
                <p className="hint">{pause ? t("stage.pauseHint") : t("stage.noPauseWarn")}</p>
                {pause && (
                  <Field label={t("stage.sensitivity")}>
                    <div className="input-group">
                      <input className="input" type="number" min={4} max={500} value={px} onChange={(e) => setPx(Math.max(4, Math.min(500, Number(e.target.value) || 24)))} />
                      <span className="small muted">px</span>
                    </div>
                  </Field>
                )}
                <Field label={t("stage.onMissing")}>
                  <select className="select" value={missing} onChange={(e) => setMissing(e.target.value as OnMissingDisplay)}>
                    {(["ask", "fail", "primary"] as const).map((m) => <option key={m} value={m}>{t(`stage.onMissing.${m}`)}</option>)}
                  </select>
                </Field>
                <div className="row wrap">
                  <button className="btn primary sm" onClick={() => void applyStage()} disabled={!stageDisplay || !!myActive}><Icon name="Check" size={14} /> {t("stage.apply", { n: sel + 1 })}</button>
                  {flow.stage && <button className="btn sm ghost" onClick={() => void clearStage()} disabled={!!myActive}>{t("stage.clear")}</button>}
                  {risk && <span className={`badge ${risk.level}`}><Icon name="Shield" size={12} /> {t("stage.safety", { score: risk.score })}</span>}
                </div>
              </>
            )}
          </section>
        </div>

        <section className="card stack" aria-label={t("stage.hud")}>
          <div className="row between wrap">
            <h3><Icon name="Activity" size={16} /> {t("stage.hud")}</h3>
            {myActive ? <span className="badge accent">{t(`pulse.state.${myActive.state}`)}</span> : <span className="badge">{t("stage.hud.idle")}</span>}
          </div>
          {tookOver && <div className="callout warn small"><Icon name="Hand" size={16} /> {t("stage.tookOver")}</div>}
          <div className="stage-hud">
            <canvas ref={mini} className="minimap" width={320} height={shownStage ? Math.round((320 * shownStage.bounds.h) / shownStage.bounds.w) : 180} aria-label={t("stage.minimap")} />
            <dl className="hud-list">
              <div><dt>{t("stage.hud.step")}</dt><dd>{step ? (step.label ?? tp(describeStep(step))) : "—"}</dd></div>
              <div><dt>{t("stage.hud.rounds")}</dt><dd>{rounds}</dd></div>
              <div><dt>{t("stage.hud.elapsed")}</dt><dd>{myActive ? formatDuration(elapsed) : "—"}</dd></div>
              <div><dt>{t("stage.hud.next")}</dt><dd>{myActive ? next : "—"}</dd></div>
              {world && <div><dt>{t("stage.hud.coins")}</dt><dd data-testid="practice-coins">{world.coins}</dd></div>}
            </dl>
          </div>
          {myActive && (
            <div className="row wrap">
              {myActive.state === "paused" ? (
                <button className="btn sm primary" onClick={() => resumeRun(myActive.runId)}><Icon name="Play" size={14} /> {t("pulse.resume")}</button>
              ) : (
                <button className="btn sm" onClick={() => pauseRun(myActive.runId)}><Icon name="Pause" size={14} /> {t("pulse.pause")}</button>
              )}
              <button className="btn sm danger" onClick={haltAll}><Icon name="OctagonX" size={14} /> {t("pulse.halt")}</button>
              {practice && <button className="btn sm ghost" onClick={simulateTakeover}><Icon name="Hand" size={14} /> {t("stage.simulateTakeover")}</button>}
            </div>
          )}
          {events.filter((e) => e.type === "log").slice(-4).map((e, i) => <div key={i} className="small mono muted">{(e as { message: string }).message}</div>)}
        </section>

        <section className="card stack" aria-label={t("scene.title")}>
          <div className="row between wrap">
            <h3><Icon name="Images" size={16} /> {t("scene.title")}</h3>
            <button className="btn sm" onClick={() => void testScenes()} disabled={busy || !flow?.scenes?.length}><Icon name="ScanEye" size={14} /> {t("scene.test")}</button>
          </div>
          <p className="small muted">{t("scene.sub")}</p>
          <div className="scene-grid">
            {(flow?.scenes ?? []).map((s) => (
              <div key={s.name} className="scene-card">
                {s.thumb ? <img src={s.thumb} alt="" /> : <div className="scene-ph"><Icon name="Image" size={22} /></div>}
                <div className="row between">
                  <b className="truncate">{s.name}</b>
                  <button className="btn ghost icon sm" onClick={() => void deleteScene(s.name)} aria-label={t("common.delete")}><Icon name="Trash2" size={14} /></button>
                </div>
                <div className="small subtle mono">{s.hash}</div>
                {matches[s.name] !== undefined && <span className={`badge ${matches[s.name]! >= 0.9 ? "ok" : "warn"}`}>{t("scene.match", { pct: Math.round(matches[s.name]! * 100) })}</span>}
              </div>
            ))}
            {!flow?.scenes?.length && <p className="small muted">{t("scene.empty")}</p>}
          </div>
          {flow && (
            <div className="row wrap" style={{ alignItems: "flex-end" }}>
              <Field label={t("scene.name")}>
                <input className="input mono" value={sceneName} maxLength={48} onChange={(e) => setSceneName(e.target.value.replace(/[^A-Za-z0-9_-]/g, ""))} />
              </Field>
              <Field label={t("scene.area")}>
                <select className="select" value={preset} onChange={(e) => setPreset(e.target.value)}>
                  {Object.keys(REGIONS).map((k) => <option key={k} value={k}>{t(`scene.area.${k}`)}</option>)}
                </select>
              </Field>
              <button className="btn sm primary" onClick={() => void captureScene()} disabled={busy || !stageDisplay || platformBlocksScenes()}><Icon name="Camera" size={14} /> {t("scene.capture", { n: sel + 1 })}</button>
            </div>
          )}
          {platformBlocksScenes() && <div className="callout warn small"><Icon name="Info" size={16} /> {t("cap.screenProbe.android")}</div>}
        </section>
      </div>
    </Shell>
  );
}

function platformBlocksScenes(): boolean {
  return hasNativeBridge && !window.__TAURI_INTERNALS__;
}
