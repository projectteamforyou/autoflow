/**
 * Browser-only nudges: the web app runs flows on the Practice Canvas (a virtual screen), so it tells people where
 * the real thing is. Downloads go through the API's counting redirect to the signed builds on dl.autoflowmacro.com.
 * Never rendered inside the Windows/Android apps.
 */
import { Icon } from "./Icon";
import { useStore } from "../lib/store";
import { SITE_URL } from "../lib/site";
import { useT } from "../i18n";
import { hasNativeBridge } from "../platform";

type Os = "windows" | "android" | "other";

function detectOs(): Os {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  if (/Windows/i.test(ua)) return "windows";
  return "other";
}

function useDownloadLinks() {
  const api = useStore((s) => s.settings.apiUrl).replace(/\/+$/, "");
  return {
    windows: `${api}/v1/stats/download/windows`,
    android: `${api}/v1/stats/download/android`,
    page: `${SITE_URL}/download/`,
  };
}

/** Large banner at the top of Home. */
export function TrialHero() {
  const t = useT();
  const links = useDownloadLinks();
  if (hasNativeBridge) return null;
  const os = detectOs();
  const win = <a key="w" className={`btn ${os === "android" ? "" : "primary"}`} href={links.windows}><Icon name="Download" size={16} /> {t("trial.windows")}</a>;
  const and = <a key="a" className={`btn ${os === "android" ? "primary" : ""}`} href={links.android}><Icon name="Smartphone" size={16} /> {t("trial.android")}</a>;
  return (
    <section className="trial-hero" aria-label={t("trial.title")}>
      <div className="trial-hero-text">
        <span className="badge primary"><Icon name="FlaskConical" size={13} /> {t("trial.chip")}</span>
        <h2>{t("trial.title")}</h2>
        <p>{t("trial.body")}</p>
        {os === "other" && <p className="small muted">{t("trial.otherOs")}</p>}
      </div>
      <div className="trial-hero-cta">
        {os === "android" ? [and, win] : [win, and]}
        <a className="text-link small" href={links.page} target="_blank" rel="noopener">{t("trial.more")} <Icon name="ExternalLink" size={13} /></a>
      </div>
    </section>
  );
}

/** Compact chip for the top bar on every page. */
export function TrialChip() {
  const t = useT();
  if (hasNativeBridge) return null;
  return (
    <a className="trial-chip" href={`${SITE_URL}/download/`} target="_blank" rel="noopener" title={t("trial.body")}>
      <Icon name="FlaskConical" size={14} /> <span>{t("trial.chip")}</span> <b>{t("trial.install")}</b>
    </a>
  );
}

/** Shown on the Practice Canvas after a run finishes. */
export function TrialAfterRun() {
  const t = useT();
  const links = useDownloadLinks();
  if (hasNativeBridge) return null;
  const os = detectOs();
  return (
    <div className="callout info trial-after" role="status">
      <Icon name="Sparkles" size={16} />
      <div className="grow small">{t("trial.afterRun")}</div>
      <a className="btn sm primary" href={os === "android" ? links.android : links.windows}><Icon name="Download" size={14} /> {os === "android" ? t("trial.android") : t("trial.windows")}</a>
    </div>
  );
}
