import { SITE_URL } from "../lib/site";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createFlow, eventsToSteps, newId } from "@autoflow/core";
import { Shell } from "../components/Shell";
import { Icon } from "../components/Icon";
import { Switch } from "../components/ui";
import { createFromKind } from "../lib/actions";
import { useStore } from "../lib/store";
import { useT } from "../i18n";
import { hasNativeBridge, invoke } from "../platform";

/** /new/:kind — creates a flow and opens it. "record" opens the native recorder or the canvas recorder. */
export function NewFlowPage() {
  const { kind = "click" } = useParams();
  const navigate = useNavigate();
  const once = useRef(false);
  useEffect(() => {
    if (once.current || kind === "record") return;
    once.current = true;
    void createFromKind(kind).then((f) => navigate(`/flows/${f.id}`, { replace: true }));
  }, [kind, navigate]);
  if (kind === "record") return hasNativeBridge ? <NativeRecorder /> : <RecordIntro />;
  return null;
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

  useEffect(() => {
    if (!recording) return;
    let unsub: (() => void) | undefined;
    void import("../platform").then(({ onBridgeEvent }) => {
      unsub = onBridgeEvent((e) => e.kind === "recording" && setCount((c) => c + 1));
    });
    return () => unsub?.();
  }, [recording]);

  const start = async () => {
    try {
      await invoke("record_start", { maskSensitive: mask });
      setCount(0);
      setRecording(true);
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };
  const stop = async () => {
    try {
      const r = await invoke("record_stop", {});
      setRecording(false);
      const steps = eventsToSteps(r.events, { screen: { width: r.screen.width, height: r.screen.height } });
      if (!steps.length) return toast("info", t("canvas.recordEmpty"));
      const f = await save(createFlow({ name: t("canvas.recordedName", { date: new Date().toLocaleString() }), id: newId("f"), mode: "pro", icon: "sparkles", color: "#EF4444", steps, screen: r.screen }), { snapshot: false });
      navigate(`/flows/${f.id}`, { replace: true });
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };

  return (
    <Shell title={<h2>{t("home.quick.record")}</h2>}>
      <div className="page" style={{ maxWidth: 680 }}>
        <div className="card pad-lg stack">
          <div className="tile-icon" style={{ background: "#EF4444" }}><Icon name="Radio" /></div>
          <h1>{recording ? t("record.recording") : t("record.title")}</h1>
          <p className="muted">{recording ? t("record.recordingBody", { n: count }) : t("record.body")}</p>
          <div className="callout warn small"><Icon name="Lock" size={16} /> {t("record.privacy")}</div>
          <div className="row between"><span className="label">{t("record.mask")}</span><Switch checked={mask} onChange={setMask} label={t("record.mask")} /></div>
          {recording ? (
            <button className="btn danger lg" onClick={stop}><Icon name="Square" size={16} /> {t("canvas.stopRecording")}</button>
          ) : (
            <button className="btn primary lg" onClick={start}><Icon name="Radio" size={16} /> {t("record.start")}</button>
          )}
        </div>
      </div>
    </Shell>
  );
}
