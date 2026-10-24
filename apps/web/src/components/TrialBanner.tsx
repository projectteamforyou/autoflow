/**
 * Browser-only nudges: the web app runs flows on the Practice Canvas (a virtual screen), so it tells people where
 * the real thing is. Downloads go through the API's counting redirect to the signed builds on dl.autoflowmacro.com.
 * Never rendered inside the Windows/Android apps.
 */
import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "./Icon";
import { Modal } from "./ui";
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

/**
 * A download button that first asks "where will you use AutoFlow?": personal use downloads for free; work use goes to
 * /business to buy a license (the downloads appear there after payment); a licensed user downloads directly.
 */
function DownloadButton({ href, className, children }: { href: string; className: string; children: ReactNode }) {
  const t = useT();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const download = () => { setOpen(false); window.location.href = href; };
  return (
    <>
      <a className={className} href={href} onClick={(e) => { e.preventDefault(); setOpen(true); }}>{children}</a>
      {open && (
        <Modal title={t("dl.title")} icon="Download" onClose={() => setOpen(false)} footer={<button className="btn" onClick={() => setOpen(false)}>{t("dl.close")}</button>}>
          <div className="stack">
            <p className="small muted">{t("dl.body")}</p>
            <button className="btn primary" onClick={download}><Icon name="Download" size={16} /> {t("dl.personal")}</button>
            <button className="btn" onClick={() => { setOpen(false); nav("/business"); }}><Icon name="KeyRound" size={16} /> {t("dl.business")}</button>
            <button className="btn ghost sm" onClick={download}>{t("dl.have")}</button>
            <p className="small muted">{t("dl.note")}</p>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Large banner at the top of Home. */
export function TrialHero() {
  const t = useT();
  const links = useDownloadLinks();
  if (hasNativeBridge) return null;
  const os = detectOs();
  const win = <DownloadButton key="w" className={`btn ${os === "android" ? "" : "primary"}`} href={links.windows}><Icon name="Download" size={16} /> {t("trial.windows")}</DownloadButton>;
  const and = <DownloadButton key="a" className={`btn ${os === "android" ? "primary" : ""}`} href={links.android}><Icon name="Smartphone" size={16} /> {t("trial.android")}</DownloadButton>;
  return (
    <section className="trial-hero" aria-label={t("trial.title")}>
      <div className="trial-hero-text">
        <span className="badge primary"><Icon name="FlaskConical" size={13} /> {t("trial.chip")}</span>
        <h2>{t("trial.title")}</h2>
        <p>{t("trial.body")}</p>
        {os === "other" && <p className="small muted">{t("trial.otherOs")}</p>}
        <p className="trial-hero-biz small">
          <Icon name="KeyRound" size={14} />
          <span>{t("trial.business")} <Link className="text-link" to="/business">{t("business.cta")} →</Link></span>
        </p>
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
      <DownloadButton className="btn sm primary" href={os === "android" ? links.android : links.windows}><Icon name="Download" size={14} /> {os === "android" ? t("trial.android") : t("trial.windows")}</DownloadButton>
    </div>
  );
}

/** Download buttons after a Business purchase (/business): the licensed account now gets the real apps. */
export function LicensedDownloads() {
  const t = useT();
  const links = useDownloadLinks();
  if (hasNativeBridge) return null;
  return (
    <div className="callout info stack-sm">
      <b>{t("business.downloadNow")}</b>
      <div className="row wrap">
        <a className="btn primary" href={links.windows}><Icon name="Download" size={16} /> {t("trial.windows")}</a>
        <a className="btn" href={links.android}><Icon name="Smartphone" size={16} /> {t("trial.android")}</a>
      </div>
    </div>
  );
}
