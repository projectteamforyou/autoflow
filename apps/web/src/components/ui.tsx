import { useEffect, useRef, useState, type ReactNode } from "react";
import { analyzeRisk, hotkeyToString, type Flow, type Hotkey, type RiskLevel } from "@autoflow/core";
import { Icon } from "./Icon";
import { useT } from "../i18n";

export function Modal({ title, icon, onClose, children, footer, wide }: { title: ReactNode; icon?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.querySelector<HTMLElement>("input, textarea, select, button.primary, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab" && el) {
        const items = [...el.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex='-1'])")];
        if (!items.length) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined} ref={ref}>
        <div className="modal-head">
          {icon && (
            <div className="tile-icon" style={{ background: "var(--af-gradient)" }}>
              <Icon name={icon} />
            </div>
          )}
          <h2 className="grow">{title}</h2>
          <button className="btn ghost icon sm" onClick={onClose} aria-label="Close">
            <Icon name="X" />
          </button>
        </div>
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch" title={label}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span />
    </label>
  );
}

export function Field({ label, hint, children, error }: { label: ReactNode; hint?: ReactNode; children: ReactNode; error?: string | null }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error ? <small className="hint" style={{ color: "var(--af-danger)" }}>{error}</small> : hint ? <small className="hint">{hint}</small> : null}
    </label>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode; icon?: string }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} size={15} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SafetyBadge({ flow, level }: { flow?: Pick<Flow, "steps" | "trigger" | "limits">; level?: RiskLevel }) {
  const t = useT();
  const r = level ? { level, score: undefined as number | undefined } : analyzeRisk(flow!);
  return (
    <span className={`badge ${r.level}`} title={t("safety.tooltip")}>
      <Icon name={r.level === "low" ? "ShieldCheck" : "ShieldAlert"} size={13} />
      {t(`safety.${r.level}`)}
      {r.score !== undefined && r.score > 0 ? ` · ${r.score}` : ""}
    </span>
  );
}

export function FlowIcon({ flow, size = 40 }: { flow: Pick<Flow, "icon" | "color">; size?: number }) {
  return (
    <div className="tile-icon" style={{ width: size, height: size, background: `linear-gradient(135deg, ${flow.color}, ${flow.color}99)` }}>
      <Icon name={flow.icon} size={Math.round(size * 0.48)} />
    </div>
  );
}

export function Empty({ icon, title, body, action }: { icon: string; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="tile-icon">
        <Icon name={icon} size={26} />
      </div>
      <h3>{title}</h3>
      {body && <p className="small">{body}</p>}
      {action}
    </div>
  );
}

const MOD_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "OS"]);

export function keyFromEvent(e: KeyboardEvent | React.KeyboardEvent): Hotkey | null {
  if (MOD_KEYS.has(e.key)) return null;
  const modifiers: Hotkey["modifiers"] = [];
  if (e.ctrlKey) modifiers.push("ctrl");
  if (e.altKey) modifiers.push("alt");
  if (e.shiftKey && e.key.length !== 1) modifiers.push("shift");
  if (e.metaKey) modifiers.push("meta");
  let key = e.key === " " ? "Space" : e.key;
  if (key.length === 1) key = e.code.startsWith("Key") ? e.code.slice(3) : e.code.startsWith("Digit") ? e.code.slice(5) : key.toUpperCase();
  return { key, modifiers };
}

/** Click, then press a key combination. Esc cancels; Backspace clears (when allowed). */
export function HotkeyInput({ value, onChange, allowClear, label }: { value?: Hotkey; onChange: (h: Hotkey | undefined) => void; allowClear?: boolean; label?: string }) {
  const t = useT();
  const [listening, setListening] = useState(false);
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape" && !e.ctrlKey && !e.altKey) return setListening(false);
      if (e.key === "Backspace" && allowClear && !e.ctrlKey && !e.altKey) {
        onChange(undefined);
        return setListening(false);
      }
      const h = keyFromEvent(e);
      if (h) {
        onChange(h);
        setListening(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listening, allowClear, onChange]);
  return (
    <button type="button" className={`btn sm capture${listening ? " listening" : ""}`} onClick={() => setListening((v) => !v)} aria-label={label}>
      <Icon name="Keyboard" size={14} />
      {listening ? t("hotkey.listening") : value ? <kbd>{hotkeyToString(value)}</kbd> : t("hotkey.none")}
    </button>
  );
}

export function Kbd({ hotkey }: { hotkey: Hotkey }) {
  return <kbd>{hotkeyToString(hotkey)}</kbd>;
}

export function download(name: string, data: BlobPart, type = "application/json") {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
