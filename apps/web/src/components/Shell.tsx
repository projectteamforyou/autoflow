import { useEffect, useMemo, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { LOCALES, hotkeyToString, type LocaleCode } from "@autoflow/core";
import { Icon } from "./Icon";
import { Modal } from "./ui";
import { useStore } from "../lib/store";
import { useDialogs } from "../lib/dialog";
import { haltAll, pauseRun, resumeRun, stopRun } from "../lib/runner";
import { setLocale, useLocale, useT } from "../i18n";
import { platform, shell } from "../platform";

const NAV = [
  { to: "/", icon: "Home", key: "nav.home", end: true },
  { to: "/flows", icon: "Workflow", key: "nav.flows" },
  { to: "/canvas", icon: "Target", key: "nav.canvas" },
  { to: "/keyforge", icon: "Keyboard", key: "nav.keyforge" },
  { to: "/atlas", icon: "Map", key: "nav.atlas" },
  { to: "/ledger", icon: "History", key: "nav.ledger" },
];
const NAV2 = [
  { to: "/copilot", icon: "Sparkles", key: "nav.copilot" },
  { to: "/studio", icon: "Palette", key: "nav.studio" },
  { to: "/fleet", icon: "Monitor", key: "nav.fleet" },
  { to: "/settings", icon: "Settings", key: "nav.settings" },
];

export function Shell({ children, flush, title, actions }: { children: ReactNode; flush?: boolean; title?: ReactNode; actions?: ReactNode }) {
  const t = useT();
  const flows = useStore((s) => s.flows.length);
  const [cmd, setCmd] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmd((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="shell">
      <a href="#main" className="sr-only">{t("a11y.skip")}</a>
      <aside className="sidebar" aria-label={t("a11y.mainNav")}>
        <NavLink to="/" className="brand">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
          <b>AutoFlow</b>
        </NavLink>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            <Icon name={n.icon} />
            {t(n.key)}
            {n.to === "/flows" && flows > 0 && <span className="count">{flows}</span>}
          </NavLink>
        ))}
        <div className="nav-section">{t("nav.tools")}</div>
        {NAV2.map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            <Icon name={n.icon} />
            {t(n.key)}
          </NavLink>
        ))}
        <div className="sidebar-foot">
          <PlatformChip />
          <button className="btn sm ghost" onClick={() => setCmd(true)} style={{ justifyContent: "flex-start" }}>
            <Icon name="Command" size={15} /> {t("cmd.open")} <kbd style={{ marginLeft: "auto" }}>Ctrl K</kbd>
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="grow row" style={{ minWidth: 0 }}>{title}</div>
          {actions}
          <LangMenu />
          <ThemeToggle />
        </header>
        <main id="main" className={`content${flush ? " flush" : ""}`}>{children}</main>
      </div>
      <nav className="mobile-nav" aria-label={t("a11y.mainNav")}>
        {[NAV[0]!, NAV[1]!, NAV[2]!, NAV[4]!, NAV2[3]!].map((n) => (
          <NavLink key={n.to} to={n.to} end={"end" in n} className={({ isActive }) => (isActive ? "active" : "")}>
            <Icon name={n.icon} size={20} />
            {t(n.key)}
          </NavLink>
        ))}
      </nav>
      {cmd && <CommandPalette onClose={() => setCmd(false)} />}
    </div>
  );
}

function PlatformChip() {
  const t = useT();
  const label = shell === "tauri" ? "Windows" : shell === "capacitor" ? "Android" : t("platform.browser");
  return (
    <NavLink to="/fleet" className="nav-link" style={{ fontSize: 12.5 }}>
      <Icon name={platform === "windows" ? "Monitor" : platform === "android" ? "Smartphone" : "Globe"} size={16} />
      <span className="grow truncate">{label}</span>
      <span className={`badge ${shell === "browser" ? "primary" : "ok"}`}>{shell === "browser" ? t("platform.sandbox") : t("platform.native")}</span>
    </NavLink>
  );
}

function LangMenu() {
  const t = useT();
  const loc = useLocale();
  return (
    <label className="row" style={{ gap: 6 }} title={t("settings.language")}>
      <Icon name="Languages" size={16} />
      <select className="select" style={{ height: 32, width: "auto", paddingRight: 8 }} value={loc} onChange={(e) => void setLocale(e.target.value as LocaleCode)} aria-label={t("settings.language")}>
        {LOCALES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function applyTheme(theme: "system" | "dark" | "light") {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

function ThemeToggle() {
  const t = useT();
  const theme = useStore((s) => s.settings.theme);
  const update = useStore((s) => s.updateSettings);
  const next = theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
  return (
    <button className="btn ghost icon sm" onClick={() => void update({ theme: next })} title={t(`settings.theme.${theme}`)} aria-label={t("settings.theme")}>
      <Icon name={theme === "dark" ? "Moon" : theme === "light" ? "Sun" : "Monitor"} size={16} />
    </button>
  );
}

/** Always-visible run state with Halt. */
export function PulseBar() {
  const t = useT();
  const active = useStore((s) => s.active);
  const halt = useStore((s) => s.settings.haltHotkey);
  const navigate = useNavigate();
  if (!active) return null;
  const paused = active.state === "paused";
  const counting = active.state === "countdown";
  return (
    <div className="pulse" role="status" aria-live="polite">
      <span className={`beat${paused ? " paused" : counting ? " countdown" : ""}`} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="truncate" style={{ fontWeight: 650 }}>{active.flowName}</div>
        <div className="small muted truncate">
          {counting ? t("pulse.countdown", { s: Math.ceil((active.countdownMs ?? 0) / 1000) }) : t(`pulse.state.${active.state}`)} · {active.where === "canvas" ? t("pulse.canvas") : t("pulse.native")} · {t("pulse.actions", { n: active.actions })}
        </div>
      </div>
      {active.where === "canvas" && (
        <button className="btn ghost icon sm" onClick={() => navigate("/canvas")} title={t("nav.canvas")}>
          <Icon name="Eye" size={16} />
        </button>
      )}
      <button className="btn sm" onClick={() => (paused ? resumeRun(active.runId) : pauseRun(active.runId))} disabled={counting}>
        <Icon name={paused ? "Play" : "Pause"} size={15} />
        {paused ? t("pulse.resume") : t("pulse.pause")}
      </button>
      <button className="btn sm" onClick={() => stopRun(active.runId)}>
        <Icon name="Square" size={14} /> {t("pulse.stop")}
      </button>
      <button className="btn sm halt" onClick={haltAll} title={hotkeyToString(halt)}>
        <Icon name="OctagonX" size={15} /> {t("pulse.halt")}
      </button>
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  const icon = { success: "Check", error: "OctagonX", warning: "ShieldAlert", info: "Info" } as const;
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((tt) => (
        <div key={tt.id} className={`toast ${tt.kind}`} role={tt.kind === "error" ? "alert" : "status"}>
          <Icon name={icon[tt.kind]} size={18} />
          <div className="grow">{tt.text}</div>
          {tt.action && (
            <button className="btn sm" onClick={() => { tt.action!.run(); dismiss(tt.id); }}>
              {tt.action.label}
            </button>
          )}
          <button className="btn ghost icon sm" onClick={() => dismiss(tt.id)} aria-label="Dismiss">
            <Icon name="X" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function DialogHost() {
  const t = useT();
  const stack = useDialogs((s) => s.stack);
  const close = useDialogs((s) => s.close);
  const top = stack[stack.length - 1];
  const [value, setValue] = useState("");
  useEffect(() => setValue(top?.input?.value ?? ""), [top?.id]);
  if (!top) return null;
  const submit = () => close(top.id, { ok: true, value });
  return (
    <Modal
      title={top.title}
      icon={top.tone === "danger" ? "ShieldAlert" : top.tone === "warning" ? "ShieldAlert" : undefined}
      onClose={() => close(top.id, { ok: false })}
      footer={
        <>
          <button className="btn" onClick={() => close(top.id, { ok: false })}>{top.cancelLabel ?? t("common.cancel")}</button>
          <button className={`btn ${top.tone === "danger" ? "danger" : "primary"}`} onClick={submit}>{top.confirmLabel ?? t("common.ok")}</button>
        </>
      }
    >
      {top.body && <div className="muted">{top.body}</div>}
      {top.input && (
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="field">
          <span>{top.input.label}</span>
          {top.input.type === "textarea" ? (
            <textarea className="textarea mono" value={value} onChange={(e) => setValue(e.target.value)} placeholder={top.input.placeholder} rows={6} />
          ) : (
            <input className="input" type={top.input.type ?? "text"} value={value} onChange={(e) => setValue(e.target.value)} placeholder={top.input.placeholder} autoComplete="off" />
          )}
        </form>
      )}
    </Modal>
  );
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const flows = useStore((s) => s.flows);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const location = useLocation();
  useEffect(() => onClose, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = useMemo(() => {
    const base = [
      { icon: "MousePointerClick", label: t("home.quick.click"), go: "/new/click" },
      { icon: "Target", label: t("home.quick.multi"), go: "/new/multiClick" },
      { icon: "Keyboard", label: t("home.quick.keys"), go: "/new/keys" },
      { icon: "Radio", label: t("home.quick.record"), go: "/new/record" },
      { icon: "Workflow", label: t("home.quick.pro"), go: "/new/pro" },
      ...[...NAV, ...NAV2].map((n) => ({ icon: n.icon, label: t(n.key), go: n.to })),
      ...flows.map((f) => ({ icon: f.icon, label: f.name, go: `/flows/${f.id}` })),
    ];
    const needle = q.trim().toLowerCase();
    return needle ? base.filter((i) => i.label.toLowerCase().includes(needle)) : base;
  }, [q, flows, t]);
  const go = (i: number) => {
    const it = items[i];
    if (it) {
      navigate(it.go);
      onClose();
    }
  };
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette-cmd" role="dialog" aria-modal="true" aria-label={t("cmd.open")}>
        <input
          autoFocus
          placeholder={t("cmd.placeholder")}
          value={q}
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            if (e.key === "Enter") go(sel);
            if (e.key === "Escape") onClose();
          }}
          aria-label={t("cmd.placeholder")}
        />
        <ul role="listbox">
          {items.slice(0, 40).map((it, i) => (
            <li key={`${it.go}-${i}`} role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => go(i)}>
              <Icon name={it.icon} size={16} />
              <span className="truncate">{it.label}</span>
            </li>
          ))}
          {items.length === 0 && <li className="muted">{t("common.noResults")}</li>}
        </ul>
      </div>
    </div>
  );
}
