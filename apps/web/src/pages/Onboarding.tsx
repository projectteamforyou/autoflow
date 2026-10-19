import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { LOCALES, type LocaleCode } from "@autoflow/core";
import { Icon } from "../components/Icon";
import { useStore } from "../lib/store";
import { setLocale, useLocale, useT } from "../i18n";

const SLIDES = [
  { icon: "Zap", key: "onboard.s1" },
  { icon: "Workflow", key: "onboard.s2" },
  { icon: "ShieldCheck", key: "onboard.s3" },
];

export function Onboarding() {
  const t = useT();
  const loc = useLocale();
  const navigate = useNavigate();
  const update = useStore((s) => s.updateSettings);
  const [params] = useSearchParams();
  const [i, setI] = useState(params.get("step") === "choose" ? SLIDES.length : 0);
  const current = useStore((s) => s.settings.defaultMode);
  const onboarded = useStore((s) => s.settings.onboarded);
  const last = i === SLIDES.length;
  const finish = async (mode: "easy" | "pro") => {
    await update({ onboarded: true, defaultMode: mode });
    // First visit: jump straight into a first flow. Later visits (logo): just switch and go home.
    navigate(onboarded ? "/" : mode === "easy" ? "/new/click" : "/new/pro", { replace: true });
  };
  return (
    <div className="onboard">
      <div className="panel">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="AutoFlow" width={72} height={72} style={{ borderRadius: 20 }} />
        {!last ? (
          <>
            <div className="tile-icon" style={{ width: 56, height: 56, background: "var(--af-gradient)" }}><Icon name={SLIDES[i]!.icon} size={28} /></div>
            <h1>{t(`${SLIDES[i]!.key}.title`)}</h1>
            <p className="lead">{t(`${SLIDES[i]!.key}.body`)}</p>
          </>
        ) : (
          <>
            <h1>{t("onboard.choose")}</h1>
            <p className="lead">{t("onboard.chooseBody")}</p>
            <div className="grid cols-2" style={{ width: "100%" }}>
              <button className="choice" aria-pressed={onboarded && current === "easy"} onClick={() => void finish("easy")} style={{ padding: 20 }}>
                <Icon name="Sparkles" size={24} />
                <b style={{ fontSize: 17 }}>{t("mode.easy")}</b>
                <small>{t("onboard.easyBody")}</small>
              </button>
              <button className="choice" aria-pressed={onboarded && current === "pro"} onClick={() => void finish("pro")} style={{ padding: 20 }}>
                <Icon name="Workflow" size={24} />
                <b style={{ fontSize: 17 }}>{t("mode.pro")}</b>
                <small>{t("onboard.proBody")}</small>
              </button>
            </div>
            <p className="small subtle">{t("onboard.switchLater")}</p>
          </>
        )}
        <div className="dots">{[...SLIDES, null].map((_, j) => <span key={j} className={j === i ? "on" : ""} />)}</div>
        <div className="row">
          {i > 0 && <button className="btn" onClick={() => setI(i - 1)}>{t("common.back")}</button>}
          {!last && <button className="btn primary lg" onClick={() => setI(i + 1)}>{t("common.next")} <Icon name="ChevronRight" size={16} /></button>}
        </div>
        <select className="select" style={{ width: "auto" }} value={loc} onChange={(e) => void setLocale(e.target.value as LocaleCode)} aria-label={t("settings.language")}>
          {LOCALES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
        </select>
        <button className="btn ghost sm" onClick={() => void update({ onboarded: true }).then(() => navigate("/", { replace: true }))}>{onboarded ? t("common.back") : t("onboard.skip")}</button>
      </div>
    </div>
  );
}
