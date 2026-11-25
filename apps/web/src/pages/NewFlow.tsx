import { SITE_URL } from "../lib/site";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createFlow, eventsToSteps, hotkeyToString, newId } from "@autoflow/core";
import { Shell } from "../components/Shell";
import { Icon } from "../components/Icon";
import { Switch } from "../components/ui";
import { createFromKind } from "../lib/actions";
import { useStore } from "../lib/store";
import { useT } from "../i18n";
import { hasNativeBridge, invoke, onBridgeEvent } from "../platform";
import { trimStopHotkey } from "../lib/recording";

/** /new/:kind — creates a flow and opens it. "record" opens the native recorder or the canvas recorder. */
export function NewFlowPage() {
  const { kind = "click" } = useParams();
  const t = useT();
  const navigate = useNavigate();
  const once = useRef(false);
  useEffect(() => {
    if (once.current || kind === "record") return;
    once.current = true;
    createFromKind(kind)
      .then((f) => navigate(`/flows/${f.id}`, { replace: true }))
      .catch((e: Error) => {
        useStore.getState().toast("error", e.message);
        navigate("/flows", { replace: true });
      });
  }, [kind, navigate]);
  if (kind === "record") return hasNativeBridge ? <NativeRecorder /> : <RecordIntro />;
  return (
    <Shell title={<h2>{t("flows.new")}</h2>}>
      <div className="page"><p className="muted">{t("common.loading")}</p></div>
    </Shell>
  );
}

function RecordIntro() {
  const t = useT();
  const navigate = useNavigate();
  return (
    <Shell title={<h2>{t("home.quick.record")}</h2>}>
      <div className="page" style={{ maxWidth: 680 }}>
        <div className="card pad-lg stack">
          <div className="tile-icon" style={{ background: "#EF4444" }}><Icon name="Radio" /></div>
          <h1>{t("record.webTitle")}</h1>
          <p className="muted">{t("record.webBody")}</p>
          <div className="row wrap">
            <button className="btn primary" onClick={() => navigate("/canvas")}><Icon name="Target" size={16} /> {t("record.openCanvas")}</button>
            <a className="btn" href={`${SITE_URL}/download/`} target="_blank" rel="noopener"><Icon name="Download" size={16} /> {t("home.getApps")}</a>
          </div>
        </div>
      </div>
    </Shell>
  );
}

function NativeRecorder() {
  const t = useT();
  const navigate = useNavigate();
  const save = useStore((s) => s.saveFlow);
  const toast = useStore((s) => s.toast);
  const [mask, setMask] = useState(true);
  const [recording, setRecording] = useState(false);
  const [count, setCount] = useState(0);

  const haltHotkey = useStore((s) => s.settings.haltHotkey);
  // One stop at a time: the Stop button and the hotkey can arrive together.
  const stopping = useRef(false);

  const start = async () => {
    try {
      await invoke("record_start", { maskSensitive: mask });
      setCount(0);
      setRecording(true);
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };
  const stop = async (byHotkey = false) => {
    if (stopping.current) return;
    stopping.current = true;
    try {
      const r = await invoke("record_stop", {});
      // Stopped with the emergency-stop hotkey: that key press is not part of the macro.
      const events = byHotkey ? trimStopHotkey(r.events, haltHotkey) : r.events;
      // With several monitors, points are stored relative to the monitor they were recorded on.
      const displays = await invoke("displays_list", {}).catch(() => []);
      const multi = displays.length > 1;
      const steps = eventsToSteps(events, multi ? { displays } : { screen: { width: r.screen.width, height: r.screen.height } });
      if (!steps.length) return toast("info", t("canvas.recordEmpty"));
      const f = await save(createFlow({ name: t("canvas.recordedName", { date: new Date().toLocaleString() }), id: newId("f"), mode: "pro", icon: "sparkles", color: "#EF4444", steps, ...(multi ? { onMissingDisplay: "ask" as const } : { screen: r.screen }) }), { snapshot: false });
      navigate(`/flows/${f.id}`, { replace: true });
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      stopping.current = false;
      setRecording(false);
    }
  };
  const stopRef = useRef(stop);
  stopRef.current = stop;

  // While recording: count the events, and let the emergency-stop hotkey (bridge event "hotkey" / "halt",
  // also sent by the tray's Halt item) end the recording — it used to do nothing here.
  useEffect(() => {
    if (!recording) return;
    return onBridgeEvent((e) => {
      if (e.kind === "recording") setCount((c) => c + 1);
      else if (e.kind === "hotkey" && e.action === "halt") void stopRef.current(true);
    });
  }, [recording]);

  return (
    <Shell title={<h2>{t("home.quick.record")}</h2>}>
      <div className="page" style={{ maxWidth: 680 }}>
        <div className="card pad-lg stack">
          <div className="tile-icon" style={{ background: "#EF4444" }}><Icon name="Radio" /></div>
          <h1>{recording ? t("record.recording") : t("record.title")}</h1>
          <p className="muted">{recording ? t("record.recordingBody", { n: count }) : t("record.body")}</p>
          {recording && <p className="small muted" role="status"><Icon name="Keyboard" size={14} /> {t("record.stopHotkey", { hotkey: hotkeyToString(haltHotkey) })}</p>}
          <div className="callout warn small"><Icon name="Lock" size={16} /> {t("record.privacy")}</div>
          <div className="row between"><span className="label">{t("record.mask")}</span><Switch checked={mask} onChange={setMask} label={t("record.mask")} /></div>
          {recording ? (
            <button className="btn danger lg" onClick={() => void stop()}><Icon name="Square" size={16} /> {t("canvas.stopRecording")}</button>
          ) : (
            <button className="btn primary lg" onClick={start}><Icon name="Radio" size={16} /> {t("record.start")}</button>
          )}
        </div>
      </div>
    </Shell>
  );
}
