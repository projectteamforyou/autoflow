import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createFlow, eventsToSteps, newId, previewPoint, walkSteps, type Flow, type RecordedEvent, type RunEvent, type SandboxBackend, type SandboxEffect, type FlowRun } from "@autoflow/core";
import { Shell } from "../components/Shell";
import { TrialAfterRun } from "../components/TrialBanner";
import { Icon } from "../components/Icon";
import { Seg, Switch } from "../components/ui";
import { useStore } from "../lib/store";
import { liveEvents, runInCanvas, stepRun, stopRun } from "../lib/runner";
import { practiceWorld, renderPractice, usePracticeCount } from "../lib/displays";
import { collectInputs } from "../lib/actions";
import { useT } from "../i18n";

/** Classic single practice screen; with 2–4 simulated monitors each one is 1280×720 (see lib/displays). */
const SINGLE = { w: 1600, h: 1000 };

interface Fx {
  id: number;
  kind: "ripple" | "trail";
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  right?: boolean;
}

let fxSeq = 0;

export function CanvasPage() {
  const t = useT();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const flows = useStore((s) => s.flows);
  const active = useStore((s) => s.active);
  const save = useStore((s) => s.saveFlow);
  const speed = useStore((s) => s.settings.canvasSpeed);
  const updateSettings = useStore((s) => s.updateSettings);
  const [flowId, setFlowId] = useState<string>(params.get("flow") ?? flows[0]?.id ?? "");
  const flow = flows.find((f) => f.id === flowId);
  const monitors = usePracticeCount(1);
  const world = monitors > 1 ? practiceWorld(monitors) : null;
  const W = world ? monitors * 1280 : SINGLE.w;
  const H = world ? 720 : SINGLE.h;
  const backendRef = useRef<SandboxBackend | null>(null);
  const [cursor, setCursor] = useState({ x: W / 2, y: H / 2 });
  const [fx, setFx] = useState<Fx[]>([]);
  const [typed, setTyped] = useState("");
  const [notif, setNotif] = useState<{ title: string; body: string } | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [hits, setHits] = useState<Record<number, number>>({});
  const [debug, setDebug] = useState(false);
  const [recording, setRecording] = useState(false);
  const recEvents = useRef<RecordedEvent[]>([]);
  const stage = useRef<HTMLDivElement>(null);
  const runRef = useRef<FlowRun | null>(null);
  const autorun = useRef(params.get("autorun") === "1");

  const myActive = active && active.where === "canvas" ? active : null;

  /** Practice targets = every normalized click/drag point in the flow (accuracy at a glance). */
  const targets = useMemo(() => {
    const pts: { x: number; y: number }[] = [];
    if (!flow) return pts;
    walkSteps(flow.steps, (s) => {
      if (s.type !== "click" || s.target.kind !== "point") return;
      if (world) {
        const p = previewPoint(s.target, world.displays, flow.stage?.display);
        if (p) pts.push({ x: p.x, y: p.y });
      } else pts.push(s.target.space === "normalized" ? { x: s.target.x * W, y: s.target.y * H } : { x: s.target.x, y: s.target.y });
    });
    return pts.slice(0, 24);
  }, [flow, world, W, H]);

  const onEffect = useCallback(
    (e: SandboxEffect) => {
      const a = e.action;
      if (a.type === "click" || a.type === "move") {
        const p = e.points![0]!;
        setCursor(p);
        if (a.type === "click") {
          const id = ++fxSeq;
          setFx((f) => [...f.slice(-30), { id, kind: "ripple", x: p.x, y: p.y, right: a.button === "right" }]);
          setTimeout(() => setFx((f) => f.filter((x) => x.id !== id)), 650);
          const idx = targets.findIndex((tg) => Math.hypot(tg.x - p.x, tg.y - p.y) < 40);
          if (idx >= 0) setHits((h) => ({ ...h, [idx]: (h[idx] ?? 0) + a.clicks }));
        }
      } else if (a.type === "drag") {
        const [p1, p2] = e.points!;
        setCursor(p2!);
        const id = ++fxSeq;
        setFx((f) => [...f.slice(-30), { id, kind: "trail", x: p1!.x, y: p1!.y, x2: p2!.x, y2: p2!.y }]);
        setTimeout(() => setFx((f) => f.filter((x) => x.id !== id)), 1000);
      } else if (a.type === "type") setTyped((s) => (s + a.text).slice(-600));
      else if (a.type === "key") setTyped((s) => (s + (a.key.length === 1 ? a.key : ` [${a.key}] `)).slice(-600));
      else if (a.type === "scroll") setTyped((s) => (s + ` ⇅${a.dy} `).slice(-600));
    },
    [targets],
  );

  const start = useCallback(async () => {
    if (!flow || myActive) return;
    const inputs = await collectInputs(flow);
    if (inputs === null) return;
    setEvents([]);
    setTyped("");
    setHits({});
    setNotif(null);
    const { run, done, backend } = await runInCanvas(flow, {
      onEffect,
      screen: world ? { width: 1280, height: 720, scale: 1 } : { width: W, height: H, scale: 1 },
      debug,
      speed,
      inputs,
      notify: (title, body) => {
        setNotif({ title, body });
        setTimeout(() => setNotif(null), 3500);
      },
      ...(world ? { world, displays: world.displays } : {}),
    });
    runRef.current = run;
    backendRef.current = backend;
    void done.finally(() => {
      runRef.current = null;
      backendRef.current = null;
    });
  }, [flow, myActive, onEffect, debug, speed, world, W, H]);

  /** Moves the virtual pointer onto monitor 1 as if you grabbed the mouse (Stage takeover guard). */
  const simulateTakeover = () => {
    if (backendRef.current) backendRef.current.pointer = { x: 200, y: 200 };
  };

  // Live pixels of the simulated monitors (the idle game on monitor 2).
  const monitorCanvases = useRef<(HTMLCanvasElement | null)[]>([]);
  useEffect(() => {
    if (!world) return;
    const draw = () => {
      world.displays.forEach((d, i) => {
        const c = monitorCanvases.current[i];
        const ctx = c?.getContext("2d");
        if (c && ctx) ctx.putImageData(renderPractice(world, d, c.width, c.height), 0, 0);
      });
    };
    draw();
    const id = setInterval(draw, 200);
    return () => clearInterval(id);
  }, [world]);

  const runs = useStore((s) => s.runs);
  useEffect(() => {
    // after a run ends, show its events from the ledger record
    if (!myActive && runs[0]?.where === "canvas" && runs[0].flowId === flowId) setEvents(runs[0].events);
  }, [myActive, runs, flowId]);

  useEffect(() => {
    if (autorun.current && flow) {
      autorun.current = false;
      params.delete("autorun");
      setParams(params, { replace: true });
      void start();
    }
  }, [flow, start, params, setParams]);

  /* ---------------- recording on the stage ---------------- */
  const toVirtual = (e: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: Math.round(((e.clientX - r.left) / r.width) * W), y: Math.round(((e.clientY - r.top) / r.height) * H) };
  };
  const startRecording = () => {
    recEvents.current = [];
    setRecording(true);
    setTyped("");
    stage.current?.focus();
  };
  const stopRecording = async () => {
    setRecording(false);
    const steps = eventsToSteps(recEvents.current, world ? { displays: world.displays } : { screen: { width: W, height: H } });
    if (!steps.length) return useStore.getState().toast("info", t("canvas.recordEmpty"));
    const f = createFlow({ name: t("canvas.recordedName", { date: new Date().toLocaleString() }), id: newId("f"), mode: "pro", icon: "sparkles", color: "#EF4444", steps: [{ id: newId(), type: "group", name: t("canvas.recording"), body: steps }], ...(world ? {} : { screen: { width: W, height: H, scale: 1 } }) });
    const saved = await save(f, { snapshot: false });
    navigate(`/flows/${saved.id}`);
  };
  const recHandlers = recording
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          const p = toVirtual(e);
          setCursor(p);
          recEvents.current.push({ t: performance.now(), kind: "mouseDown", ...p, button: e.button === 2 ? "right" : e.button === 1 ? "middle" : "left" });
          const id = ++fxSeq;
          setFx((f) => [...f, { id, kind: "ripple", ...p, right: e.button === 2 }]);
          setTimeout(() => setFx((f) => f.filter((x) => x.id !== id)), 650);
        },
        onPointerUp: (e: React.PointerEvent) => recEvents.current.push({ t: performance.now(), kind: "mouseUp", ...toVirtual(e), button: e.button === 2 ? "right" : e.button === 1 ? "middle" : "left" }),
        onWheel: (e: React.WheelEvent) => recEvents.current.push({ t: performance.now(), kind: "wheel", dx: Math.round(e.deltaX), dy: Math.round(e.deltaY), ...toVirtual(e) }),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Escape" && e.ctrlKey && e.altKey) return void stopRecording();
          e.preventDefault();
          const mods = (["ctrl", "alt", "shift", "meta"] as const).filter((m) => (m === "ctrl" ? e.ctrlKey : m === "alt" ? e.altKey : m === "shift" ? e.shiftKey : e.metaKey));
          recEvents.current.push({ t: performance.now(), kind: "keyDown", key: e.key === " " ? " " : e.key, modifiers: [...mods] });
          setTyped((s) => (s + (e.key.length === 1 ? e.key : ` [${e.key}] `)).slice(-600));
        },
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
      }
    : {};

  // Mirror live events from the active run record (runner keeps them on the record).
  const [liveEventList, setLiveEvents] = useState<RunEvent[]>([]);
  // Keyed on the run id: myActive is a new object on every step, which would reset the interval before it fires.
  const activeRunId = myActive?.runId;
  useEffect(() => {
    if (!activeRunId) return;
    const id = setInterval(() => {
      const ev = liveEvents(activeRunId);
      if (ev) setLiveEvents([...ev]);
    }, 200);
    return () => clearInterval(id);
  }, [activeRunId]);
  const shownEvents = myActive ? liveEventList : events;
  const lastVars = useMemo(() => {
    const v: Record<string, string> = {};
    for (const e of shownEvents) if (e.type === "var") v[e.name] = JSON.stringify(e.value).slice(0, 60);
    return v;
  }, [shownEvents]);
  const t0 = shownEvents[0]?.at ?? 0;

  // Last run on this canvas ended: point browser users at the real apps.
  const lastState = [...events].reverse().find((e) => e.type === "state");
  const runFinished = !myActive && !!lastState && lastState.type === "state" && (lastState.state === "completed" || lastState.state === "stopped");

  return (
    <Shell
      flush
      title={
        <div className="row grow">
          <h2 className="truncate">{t("nav.canvas")}</h2>
          <select className="select" style={{ width: "auto", maxWidth: 260, height: 32 }} value={flowId} onChange={(e) => { setFlowId(e.target.value); params.set("flow", e.target.value); setParams(params, { replace: true }); }} aria-label={t("canvas.pickFlow")} disabled={!!myActive}>
            {!flows.length && <option value="">{t("canvas.noFlows")}</option>}
            {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
      }
      actions={
        <div className="row">
          <Seg value={String(monitors)} onChange={(v) => void updateSettings({ practiceDisplays: Number(v) })} label={t("canvas.monitors")} options={["1", "2", "3", "4"].map((v) => ({ value: v, label: v === "1" ? t("canvas.oneScreen") : t("stage.nMonitors", { n: v }) }))} />
          <label className="row small muted">{t("canvas.debug")}<Switch checked={debug} onChange={setDebug} label={t("canvas.debug")} /></label>
          <Seg value={String(speed)} onChange={(v) => void updateSettings({ canvasSpeed: Number(v) })} label={t("canvas.speed")} options={["0.5", "1", "2", "4"].map((v) => ({ value: v, label: `${v}×` }))} />
          {flow && <button className="btn sm ghost" onClick={() => navigate(`/flows/${flow.id}`)}><Icon name="Pen" size={14} /> {t("common.edit")}</button>}
          {recording ? (
            <button className="btn sm danger" onClick={stopRecording}><Icon name="Square" size={14} /> {t("canvas.stopRecording")}</button>
          ) : (
            <button className="btn sm" onClick={startRecording} disabled={!!myActive}><Icon name="Radio" size={14} /> {t("canvas.record")}</button>
          )}
          {myActive ? (
            <>
              {myActive.state === "paused" && debug && <button className="btn sm" onClick={() => stepRun(myActive.runId)}><Icon name="StepForward" size={14} /> {t("canvas.step")}</button>}
              {world && flow?.stage && <button className="btn sm ghost" onClick={simulateTakeover}><Icon name="Hand" size={14} /> {t("stage.simulateTakeover")}</button>}
              <button className="btn sm danger" onClick={() => stopRun(myActive.runId)}><Icon name="Square" size={14} /> {t("pulse.stop")}</button>
            </>
          ) : (
            <button className="btn sm primary" onClick={() => void start()} disabled={!flow || recording}><Icon name="Play" size={14} /> {t("canvas.run")}</button>
          )}
        </div>
      }
    >
      {runFinished && <TrialAfterRun />}
      <div className="practice">
        <div className="stage-wrap">
          <div
            ref={stage}
            className="stage"
            tabIndex={recording ? 0 : -1}
            aria-label={t("canvas.stageLabel")}
            style={{ outline: recording ? "3px solid var(--af-danger)" : undefined, cursor: recording ? "crosshair" : "default", ...(world ? { aspectRatio: `${W} / ${H}`, width: "min(100%, 1500px)" } : {}) }}
            {...recHandlers}
          >
            {world ? (
              <div className="practice-monitors" style={{ gridTemplateColumns: `repeat(${monitors}, 1fr)` }} aria-hidden="true">
                {world.displays.map((d, i) => (
                  <div key={d.id} className="pm">
                    <canvas ref={(el) => { monitorCanvases.current[i] = el; }} width={160} height={90} />
                    <span className="pm-num">{i + 1}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid-lines" />
            )}
            <div className="hud">
              <span className="badge primary">{W}×{H}</span>
              {recording && <span className="badge err">● {t("canvas.recording")} · Ctrl+Alt+Esc</span>}
              {myActive && <span className="badge accent">{t(`pulse.state.${myActive.state}`)}</span>}
              {targets.length > 0 && <span className="badge">{t("canvas.hits", { n: Object.values(hits).reduce((a, b) => a + b, 0) })}</span>}
            </div>
            {targets.map((tg, i) => (
              <div key={i} className={`target${hits[i] ? " hit" : ""}`} style={{ left: `${(tg.x / W) * 100}%`, top: `${(tg.y / H) * 100}%` }}>
                {hits[i] ?? i + 1}
              </div>
            ))}
            {fx.map((f) =>
              f.kind === "ripple" ? (
                <div key={f.id} className={`ripple${f.right ? " right" : ""}`} style={{ left: `${(f.x / W) * 100}%`, top: `${(f.y / H) * 100}%` }} />
              ) : (
                <TrailLine key={f.id} f={f} W={W} H={H} />
              ),
            )}
            <svg className="cursor" viewBox="0 0 24 24" style={{ left: `${(cursor.x / W) * 100}%`, top: `${(cursor.y / H) * 100}%` }} aria-hidden="true">
              <path d="M3 2l7.5 19 2.4-7.6L20.5 11z" fill="#fff" stroke="#0B0B1A" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
            {notif && (
              <div className="notif">
                <b>{notif.title}</b>
                <div className="small muted">{notif.body}</div>
              </div>
            )}
            {myActive?.state === "countdown" && <div className="countdown">{Math.ceil((myActive.countdownMs ?? 0) / 1000)}</div>}
            <div className="typed" aria-live="polite">{typed || <span style={{ opacity: 0.5 }}>{recording ? t("canvas.recordHint") : t("canvas.typedHint")}</span>}</div>
          </div>
        </div>
        <aside className="event-log" aria-label={t("canvas.events")}>
          <div className="row between" style={{ marginBottom: 6 }}>
            <b>{t("canvas.events")}</b>
            <span className="small subtle">{shownEvents.length}</span>
          </div>
          {Object.keys(lastVars).length > 0 && (
            <div className="card" style={{ padding: 10, marginBottom: 8 }}>
              <div className="label" style={{ marginBottom: 4 }}>{t("canvas.vars")}</div>
              {Object.entries(lastVars).map(([k, v]) => (
                <div key={k} className="mono small row between"><span>{k}</span><span className="muted truncate" style={{ maxWidth: 180 }}>{v}</span></div>
              ))}
            </div>
          )}
          {shownEvents.length === 0 && <p className="small muted">{flow ? t("canvas.eventsEmpty") : t("canvas.noFlows")}</p>}
          {shownEvents.slice(-300).map((e, i) => <EventRow key={i} e={e} t0={t0} flow={flow} />)}
        </aside>
      </div>
    </Shell>
  );
}

function TrailLine({ f, W, H }: { f: Fx; W: number; H: number }) {
  const dx = ((f.x2! - f.x) / W) * 100;
  const dy = ((f.y2! - f.y) / H) * 100;
  // percent lengths differ per axis; compute in px via the stage's aspect ratio
  const len = Math.hypot(dx * W, dy * H) / W;
  const ang = (Math.atan2(dy * H, dx * W) * 180) / Math.PI;
  return <div className="trail" style={{ left: `${(f.x / W) * 100}%`, top: `${(f.y / H) * 100}%`, width: `${len}%`, transform: `rotate(${ang}deg)` }} />;
}

export function EventRow({ e, t0, flow }: { e: RunEvent; t0: number; flow?: Flow }) {
  const t = useT();
  const time = `+${((e.at - t0) / 1000).toFixed(2)}s`;
  let text = "";
  let cls = "";
  switch (e.type) {
    case "state": text = t(`pulse.state.${e.state}`); break;
    case "countdown": text = t("pulse.countdown", { s: Math.ceil(e.remainingMs / 1000) }); break;
    case "stepStart": text = `▶ ${t(`step.${e.stepType}`)} ${labelOf(flow, e.stepId)}`; break;
    case "stepEnd": if (e.ok) return null; text = `✕ ${e.stepId}`; cls = "err"; break;
    case "breakpoint": text = `● ${t("editor.breakpoint")} ${e.stepId}`; cls = "warn"; break;
    case "log": text = e.message; cls = e.level === "error" ? "err" : e.level === "warn" ? "warn" : ""; break;
    case "var": text = `${e.name} = ${JSON.stringify(e.value).slice(0, 80)}`; break;
    case "retry": text = `↻ ${t("onError.retry")} #${e.attempt}`; cls = "warn"; break;
    case "error": text = `${t(`errcat.${e.error.category}`)}: ${e.error.message}`; cls = "err"; break;
  }
  return (
    <div className={`event ${cls}`}>
      <time>{time}</time>
      <span style={{ overflowWrap: "anywhere" }}>{text}</span>
    </div>
  );
}

function labelOf(flow: Flow | undefined, id: string): string {
  if (!flow) return "";
  let label = "";
  walkSteps(flow.steps, (s) => {
    if (s.id === id && s.label) label = `· ${s.label}`;
  });
  return label;
}
