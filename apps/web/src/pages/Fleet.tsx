import { SITE_URL } from "../lib/site";
import { useEffect, useState } from "react";
import type { DeviceInfo, PermissionStatus } from "@autoflow/core";
import { Shell } from "../components/Shell";
import { Icon } from "../components/Icon";
import { useT } from "../i18n";
import { hasNativeBridge, invoke, onBridgeEvent, platform, shell } from "../platform";
import { useStore } from "../lib/store";

export function FleetPage() {
  const t = useT();
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  const [perms, setPerms] = useState<PermissionStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const toast = useStore((s) => s.toast);

  const refresh = async () => {
    if (!hasNativeBridge) return;
    try {
      setInfo(await invoke("device_info", {}));
      setPerms(await invoke("permissions_status", {}));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void refresh();
    return onBridgeEvent((e) => e.kind === "permission" && void refresh());
  }, []);

  const browserCaps = [
    { k: "fleet.cap.canvas", ok: true },
    { k: "fleet.cap.storage", ok: typeof indexedDB !== "undefined" },
    { k: "fleet.cap.crypto", ok: !!globalThis.crypto?.subtle },
    { k: "fleet.cap.offline", ok: "serviceWorker" in navigator },
    { k: "fleet.cap.notifications", ok: "Notification" in window },
  ];

  return (
    <Shell title={<h2>{t("nav.fleet")}</h2>} actions={hasNativeBridge ? <button className="btn sm" onClick={refresh}><Icon name="RotateCcw" size={15} /> {t("common.refresh")}</button> : null}>
      <div className="page">
        <div className="page-head">
          <div>
            <h1>{t("fleet.title")}</h1>
            <p>{t("fleet.sub")}</p>
          </div>
        </div>
        <div className="grid cols-3">
          <div className="card stack-sm">
            <div className="row"><Icon name={platform === "windows" ? "Monitor" : platform === "android" ? "Smartphone" : "Globe"} /><h3>{t("fleet.thisDevice")}</h3></div>
            <div className="small muted">{shell === "browser" ? navigator.userAgent.slice(0, 120) : `${info?.os ?? ""} ${info?.osVersion ?? ""}`}</div>
            <div className="row wrap">
              <span className={`badge ${hasNativeBridge ? "ok" : "primary"}`}>{hasNativeBridge ? t("platform.native") : t("platform.sandbox")}</span>
              {info && <span className="badge">{t("fleet.engine")} {info.engineVersion}</span>}
              {info?.apiLevel && <span className="badge">API {info.apiLevel}</span>}
              {info?.manufacturer && <span className="badge">{info.manufacturer}</span>}
            </div>
          </div>
          <div className="card stack-sm">
            <div className="row"><Icon name="Monitor" /><h3>{t("fleet.screens")}</h3></div>
            {info ? info.screens.map((s, i) => <div key={i} className="small">{s.primary ? "★ " : ""}{s.width}×{s.height} @{s.scale}x ({s.x},{s.y})</div>) : <div className="small muted">{window.screen.width}×{window.screen.height} @{window.devicePixelRatio}x</div>}
          </div>
          <div className="card stack-sm">
            <div className="row"><Icon name="Keyboard" /><h3>{t("fleet.inputDevices")}</h3></div>
            {info?.inputDevices.length ? info.inputDevices.map((d) => <div key={d.id} className="small row"><span className="badge">{t(`fleet.kind.${d.kind}`)}</span><span className="truncate">{d.name}</span></div>) : <div className="small muted">{hasNativeBridge ? t("fleet.noDevices") : t("fleet.nativeOnly")}</div>}
          </div>
        </div>

        {hasNativeBridge ? (
          <div className="card stack">
            <h3><Icon name="Lock" size={16} /> {t("fleet.permissions")}</h3>
            {error && <div className="callout err small">{error}</div>}
            {perms.map((p) => (
              <div key={p.permission} className="row">
                <span className={`badge ${p.granted ? "ok" : "warn"}`}>{p.granted ? t("fleet.granted") : t("fleet.notGranted")}</span>
                <div className="grow">
                  <b>{t(`perm.native.${p.permission}`)}</b>
                  <div className="small muted">{t(`perm.native.${p.permission}.why`)}</div>
                  {p.detail && <div className="small subtle">{p.detail}</div>}
                </div>
                {!p.granted && (
                  <button className="btn sm" onClick={async () => {
                    // Accessibility: the Android app shows its own native disclosure (Play policy) before opening Settings.
                    try { await invoke("permission_request", { permission: p.permission }); } catch (e) { toast("error", (e as Error).message); }
                    void refresh();
                  }}>{t("fleet.grant")}</button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="card stack">
            <h3><Icon name="Globe" size={16} /> {t("fleet.browserCaps")}</h3>
            {browserCaps.map((c) => (
              <div key={c.k} className="row small"><Icon name={c.ok ? "Check" : "X"} size={15} /> {t(c.k)}</div>
            ))}
            <div className="callout info small"><Icon name="Download" size={16} /> {t("fleet.getNative")} <a href={`${SITE_URL}/download/`} target="_blank" rel="noopener">{t("home.getApps")}</a></div>
          </div>
        )}
      </div>
    </Shell>
  );
}
