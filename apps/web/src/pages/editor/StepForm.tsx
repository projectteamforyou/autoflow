import { useState, type ReactNode } from "react";
import { FUNCTION_NAMES, STEP_CAPABILITIES, checkExpr, type Flow, type LintIssue, type Step, type Target } from "@autoflow/core";
import { Icon } from "../../components/Icon";
import { Field, HotkeyInput, Seg, Switch } from "../../components/ui";
import { STEP_BY_TYPE } from "../../lib/steps";
import { useStore } from "../../lib/store";
import { useT } from "../../i18n";
import { hasNativeBridge, invoke, platform } from "../../platform";

type Props = { step: Step; flow: Flow; issues: LintIssue[]; onChange: (s: Step) => void; onDelete: () => void; onDuplicate: () => void; onClose: () => void };

export function StepForm({ step, issues, onChange, onDelete, onDuplicate, onClose }: Props) {
  const t = useT();
  const meta = STEP_BY_TYPE[step.type];
  const cap = STEP_CAPABILITIES[step.type][platform];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const set = (patch: Record<string, unknown>) => onChange({ ...step, ...patch } as any);
  return (
    <div className="stack">
      <div className="row">
        <span className="tile-icon" style={{ background: meta.color, width: 34, height: 34 }}>
          <Icon name={meta.icon} size={17} />
        </span>
        <div className="grow">
          <h3>{t(`step.${step.type}`)}</h3>
          <div className="small subtle mono">{step.id}</div>
        </div>
        <button className="btn ghost icon sm" onClick={onClose} aria-label={t("common.close")}><Icon name="X" size={16} /></button>
      </div>
      <p className="small muted">{t(`step.${step.type}.desc`)}</p>
      {cap.support !== "supported" && (
        <div className={`callout ${cap.support === "unsupported" ? "err" : "warn"} small`}>
          <Icon name="Info" size={16} /> {cap.noteKey ? t(cap.noteKey) : t(`cap.${cap.support}`)}
        </div>
      )}
      {issues.map((i, n) => (
        <div key={n} className={`callout ${i.severity === "error" ? "err" : "warn"} small`}>
          <Icon name="Bug" size={16} /> {t(i.key, i.params as Record<string, string | number>)}
        </div>
      ))}

      <TypeFields step={step} set={set} />

      <div className="divider" />
      <Field label={t("editor.label")} hint={t("editor.labelHint")}>
        <input className="input" value={step.label ?? ""} maxLength={120} onChange={(e) => set({ label: e.target.value || undefined })} />
      </Field>
      <OnErrorEditor step={step} set={set} />
      <div className="row between">
        <span className="label">{t("editor.disabledStep")}</span>
        <Switch checked={!!step.disabled} onChange={(v) => set({ disabled: v || undefined })} label={t("editor.disabledStep")} />
      </div>
      <div className="row between">
        <span className="label">{t("editor.breakpoint")}</span>
        <Switch checked={!!step.breakpoint} onChange={(v) => set({ breakpoint: v || undefined })} label={t("editor.breakpoint")} />
      </div>
      <div className="row">
        <button className="btn sm" onClick={onDuplicate}><Icon name="Copy" size={14} /> {t("flows.duplicate")}</button>
        <button className="btn sm danger" onClick={onDelete}><Icon name="Trash2" size={14} /> {t("common.delete")}</button>
      </div>
      <p className="hint">{t("editor.shortcuts")}</p>
    </div>
  );
}

function OnErrorEditor({ step, set }: { step: Step; set: (p: Record<string, unknown>) => void }) {
  const t = useT();
  const oe = step.onError ?? { strategy: "stop" as const, retries: 0, backoffMs: 500 };
  return (
    <Field label={t("editor.onError")}>
      <select className="select" value={oe.strategy} onChange={(e) => set({ onError: e.target.value === "stop" ? undefined : { ...oe, strategy: e.target.value, retries: e.target.value === "retry" ? Math.max(1, oe.retries) : oe.retries } })}>
        {(["stop", "continue", "retry", "goto"] as const).map((s) => (
          <option key={s} value={s}>{t(`onError.${s}`)}</option>
        ))}
      </select>
      {oe.strategy === "retry" && (
        <div className="row">
          <input className="input" type="number" min={1} max={10} value={oe.retries} onChange={(e) => set({ onError: { ...oe, retries: Math.max(1, Math.min(10, Number(e.target.value) || 1)) } })} aria-label={t("editor.retries")} />
          <span className="small muted">{t("editor.retries")}</span>
          <input className="input" type="number" min={0} max={60000} step={100} value={oe.backoffMs} onChange={(e) => set({ onError: { ...oe, backoffMs: Math.max(0, Number(e.target.value) || 0) } })} aria-label={t("editor.backoff")} />
          <span className="small muted">ms</span>
        </div>
      )}
      {oe.strategy === "goto" && <input className="input mono" placeholder="step id" value={oe.gotoStepId ?? ""} onChange={(e) => set({ onError: { ...oe, gotoStepId: e.target.value || undefined } })} />}
    </Field>
  );
}

function ExprInput({ value, onChange, label, hint }: { value: string; onChange: (v: string) => void; label: ReactNode; hint?: ReactNode }) {
  const t = useT();
  const err = checkExpr(value);
  return (
    <Field label={label} error={err} hint={hint ?? t("editor.exprHint", { fns: FUNCTION_NAMES.slice(0, 12).join(", ") })}>
      <input className={`input mono${err ? " invalid" : ""}`} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
    </Field>
  );
}

function Num({ label, value, onChange, min = 0, max = 86_400_000, step = 1, suffix }: { label: ReactNode; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; suffix?: string }) {
  return (
    <Field label={label}>
      <div className="input-group">
        <input className="input" type="number" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))} />
        {suffix && <span className="small muted">{suffix}</span>}
      </div>
    </Field>
  );
}

const KEYS = ["Enter", "Tab", "Escape", "Space", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12", "MediaPlayPause", "MediaTrackNext", "AudioVolumeUp", "AudioVolumeDown"];

function TypeFields({ step, set }: { step: Step; set: (p: Record<string, unknown>) => void }) {
  const t = useT();
  const flows = useStore((s) => s.flows);
  const profiles = useStore((s) => s.profiles);
  switch (step.type) {
    case "click":
      return (
        <>
          <TargetEditor target={step.target} onChange={(target) => set({ target })} />
          <Field label={t("editor.button")}>
            <Seg value={step.button} onChange={(button) => set({ button })} options={(["left", "right", "middle", "x1", "x2"] as const).map((b) => ({ value: b, label: t(`button.${b}`) }))} />
          </Field>
          <div className="grid cols-2">
            <Num label={t("editor.clicks")} value={step.clicks} min={1} max={3} onChange={(clicks) => set({ clicks })} />
            <Num label={t("easy.hold")} value={step.holdMs} max={60000} step={50} suffix="ms" onChange={(holdMs) => set({ holdMs })} />
          </div>
          <ModifierPicker value={step.modifiers} onChange={(modifiers) => set({ modifiers })} />
        </>
      );
    case "move":
      return (
        <>
          <TargetEditor target={step.target} onChange={(target) => set({ target })} />
          <Num label={t("editor.duration")} value={step.durationMs} max={60000} step={50} suffix="ms" onChange={(durationMs) => set({ durationMs })} />
        </>
      );
    case "drag":
      return (
        <>
          <span className="label">{t("editor.from")}</span>
          <TargetEditor target={step.from} onChange={(from) => set({ from })} />
          <span className="label">{t("editor.to")}</span>
          <TargetEditor target={step.to} onChange={(to) => set({ to })} />
          <Num label={t("editor.duration")} value={step.durationMs} max={60000} step={50} suffix="ms" onChange={(durationMs) => set({ durationMs })} />
        </>
      );
    case "scroll":
      return (
        <div className="grid cols-2">
          <Num label={t("editor.dx")} value={step.dx} min={-10000} max={10000} step={40} onChange={(dx) => set({ dx })} />
          <Num label={t("editor.dy")} value={step.dy} min={-10000} max={10000} step={40} onChange={(dy) => set({ dy })} />
        </div>
      );
    case "key":
      return (
        <>
          <Field label={t("editor.key")}>
            <div className="row">
              <HotkeyInput value={{ key: step.key, modifiers: step.modifiers }} onChange={(h) => h && set({ key: h.key, modifiers: h.modifiers })} />
              <select className="select" value={KEYS.includes(step.key) ? step.key : ""} onChange={(e) => e.target.value && set({ key: e.target.value })} aria-label={t("editor.key")}>
                <option value="">…</option>
                {KEYS.map((k) => <option key={k}>{k}</option>)}
              </select>
            </div>
          </Field>
          <Field label={t("editor.keyAction")}>
            <Seg value={step.action} onChange={(action) => set({ action })} options={[{ value: "press", label: t("editor.press") }, { value: "down", label: t("editor.down") }, { value: "up", label: t("editor.up") }]} />
          </Field>
          <Num label={t("editor.repeat")} value={step.repeat} min={1} max={1000} onChange={(repeat) => set({ repeat })} />
        </>
      );
    case "type":
      return (
        <>
          <Field label={t("editor.text")} hint={t("editor.textHint")}>
            <textarea className="textarea" rows={5} value={step.text} onChange={(e) => set({ text: e.target.value })} />
          </Field>
          <Num label={t("editor.perChar")} value={step.perCharDelayMs} max={2000} suffix="ms" onChange={(perCharDelayMs) => set({ perCharDelayMs })} />
        </>
      );
    case "wait":
      return (
        <>
          <Num label={t("editor.waitMs")} value={step.ms} step={50} suffix="ms" onChange={(ms) => set({ ms })} />
          <Num label={t("editor.jitter")} value={step.jitterMs} max={600000} step={50} suffix="ms" onChange={(jitterMs) => set({ jitterMs })} />
          {step.jitterMs > 0 && <p className="hint">{t("editor.jitterHint")}</p>}
        </>
      );
    case "waitFor":
      return (
        <>
          <ExprInput label={t("editor.condition")} value={step.condition.expr} onChange={(expr) => set({ condition: { expr } })} />
          <div className="grid cols-2">
            <Num label={t("editor.poll")} value={step.pollMs} min={50} max={60000} suffix="ms" onChange={(pollMs) => set({ pollMs })} />
            <Num label={t("editor.timeout")} value={step.timeoutMs} step={500} suffix="ms" onChange={(timeoutMs) => set({ timeoutMs })} />
          </div>
        </>
      );
    case "setVar":
      return (
        <>
          <Field label={t("editor.varName")}>
            <input className="input mono" value={step.name} onChange={(e) => set({ name: e.target.value.replace(/[^A-Za-z0-9_]/g, "").slice(0, 48) || "v" })} />
          </Field>
          <ExprInput label={t("editor.value")} value={step.value} onChange={(value) => set({ value })} />
        </>
      );
    case "log":
      return (
        <>
          <Field label={t("editor.message")}><input className="input" value={step.message} onChange={(e) => set({ message: e.target.value })} /></Field>
          <Seg value={step.level} onChange={(level) => set({ level })} options={[{ value: "info", label: "info" }, { value: "warn", label: "warn" }, { value: "error", label: "error" }]} />
        </>
      );
    case "notify":
      return (
        <>
          <Field label={t("editor.title")}><input className="input" value={step.title} onChange={(e) => set({ title: e.target.value })} /></Field>
          <Field label={t("editor.body")}><textarea className="textarea" rows={3} value={step.body} onChange={(e) => set({ body: e.target.value })} /></Field>
        </>
      );
    case "confirm":
      return (
        <>
          <Field label={t("editor.message")}><input className="input" value={step.message} onChange={(e) => set({ message: e.target.value })} /></Field>
          <Field label={t("editor.resultVar")} hint={t("editor.confirmHint")}><input className="input mono" value={step.resultVar ?? ""} onChange={(e) => set({ resultVar: e.target.value.replace(/[^A-Za-z0-9_]/g, "") || undefined })} /></Field>
        </>
      );
    case "clipboard":
      return (
        <>
          <Seg value={step.op} onChange={(op) => set({ op })} options={[{ value: "get", label: t("editor.clipGet") }, { value: "set", label: t("editor.clipSet") }]} />
          {step.op === "set" ? (
            <Field label={t("editor.text")}><textarea className="textarea" rows={3} value={step.value ?? ""} onChange={(e) => set({ value: e.target.value })} /></Field>
          ) : (
            <Field label={t("editor.resultVar")}><input className="input mono" value={step.var ?? ""} onChange={(e) => set({ var: e.target.value.replace(/[^A-Za-z0-9_]/g, "") || undefined })} /></Field>
          )}
        </>
      );
    case "launchApp":
      return (
        <>
          <Field label={t("editor.app")} hint={t("editor.appHint")}><input className="input mono" value={step.app} onChange={(e) => set({ app: e.target.value || "app" })} /></Field>
          <Field label={t("editor.args")}><input className="input mono" value={step.args.join(" ")} onChange={(e) => set({ args: e.target.value.split(" ").filter(Boolean).slice(0, 16) })} /></Field>
        </>
      );
    case "openUrl":
      return <UrlField value={step.url} onChange={(url) => set({ url })} />;
    case "window":
      return (
        <>
          <Field label={t("editor.windowOp")}>
            <select className="select" value={step.op} onChange={(e) => set({ op: e.target.value })}>
              {["focus", "minimize", "maximize", "restore", "close", "move", "resize"].map((o) => <option key={o} value={o}>{t(`explain.window.${o}`, { title: "" }).trim()}</option>)}
            </select>
          </Field>
          <Field label={t("editor.windowTitle")}><input className="input" value={step.match.title ?? ""} onChange={(e) => set({ match: { ...step.match, title: e.target.value || undefined } })} /></Field>
          <Field label={t("editor.app")}><input className="input mono" value={step.match.app ?? ""} onChange={(e) => set({ match: { ...step.match, app: e.target.value || undefined } })} /></Field>
          {(step.op === "move" || step.op === "resize") && (
            <div className="grid cols-2">
              {(["x", "y", "w", "h"] as const).map((k) => (
                <Num key={k} label={k} value={step.rect?.[k] ?? 0} min={-10000} max={10000} onChange={(v) => set({ rect: { x: 0, y: 0, w: 800, h: 600, ...step.rect, [k]: v } })} />
              ))}
            </div>
          )}
        </>
      );
    case "androidGlobal":
      return (
        <Field label={t("editor.action")}>
          <select className="select" value={step.action} onChange={(e) => set({ action: e.target.value })}>
            {["back", "home", "recents", "notifications", "quickSettings", "lockScreen", "screenshot", "powerDialog"].map((a) => <option key={a} value={a}>{t(`explain.android.${a}`)}</option>)}
          </select>
        </Field>
      );
    case "http":
      return (
        <>
          <Field label={t("editor.method")}>
            <Seg value={step.method} onChange={(method) => set({ method })} options={(["GET", "POST", "PUT", "PATCH", "DELETE"] as const).map((m) => ({ value: m, label: m }))} />
          </Field>
          <UrlField value={step.url} onChange={(url) => set({ url })} />
          <Field label={t("editor.headers")} hint="Header: value">
            <textarea className="textarea mono" rows={3} value={Object.entries(step.headers).map(([k, v]) => `${k}: ${v}`).join("\n")} onChange={(e) => set({ headers: Object.fromEntries(e.target.value.split("\n").map((l) => l.split(/:\s*/)).filter((p) => p[0] && p.length > 1).map((p) => [p[0]!, p.slice(1).join(":")])) })} />
          </Field>
          {step.method !== "GET" && <Field label={t("editor.body")}><textarea className="textarea mono" rows={4} value={step.body ?? ""} onChange={(e) => set({ body: e.target.value || undefined })} /></Field>}
          <Field label={t("editor.resultVar")}><input className="input mono" value={step.resultVar ?? ""} onChange={(e) => set({ resultVar: e.target.value.replace(/[^A-Za-z0-9_]/g, "") || undefined })} /></Field>
        </>
      );
    case "file":
      return (
        <>
          <Field label={t("editor.fileOp")}>
            <select className="select" value={step.op} onChange={(e) => set({ op: e.target.value })}>
              {["read", "write", "append", "copy", "move", "delete", "exists"].map((o) => <option key={o} value={o}>{t(`explain.file.${o}`, { path: "" }).trim()}</option>)}
            </select>
          </Field>
          <Field label={t("editor.path")}><input className="input mono" value={step.path} onChange={(e) => set({ path: e.target.value })} /></Field>
          {(step.op === "copy" || step.op === "move") && <Field label={t("editor.dest")}><input className="input mono" value={step.dest ?? ""} onChange={(e) => set({ dest: e.target.value })} /></Field>}
          {(step.op === "write" || step.op === "append") && <Field label={t("editor.content")}><textarea className="textarea mono" rows={4} value={step.content ?? ""} onChange={(e) => set({ content: e.target.value })} /></Field>}
          <Field label={t("editor.resultVar")}><input className="input mono" value={step.resultVar ?? ""} onChange={(e) => set({ resultVar: e.target.value.replace(/[^A-Za-z0-9_]/g, "") || undefined })} /></Field>
        </>
      );
    case "ocr":
      return (
        <>
          <div className="grid cols-2">
            {(["x", "y", "w", "h"] as const).map((k) => (
              <Num key={k} label={k} value={step.region[k]} min={0} max={20000} onChange={(v) => set({ region: { ...step.region, [k]: v } })} />
            ))}
          </div>
          <Field label={t("editor.resultVar")}><input className="input mono" value={step.resultVar} onChange={(e) => set({ resultVar: e.target.value.replace(/[^A-Za-z0-9_]/g, "") || "text" })} /></Field>
        </>
      );
    case "findImage":
      return (
        <>
          <Field label={t("editor.imageRef")} hint={t("editor.imageRefHint")}><input className="input mono" value={step.target.ref} onChange={(e) => set({ target: { ...step.target, ref: e.target.value } })} /></Field>
          <Num label={t("editor.confidence")} value={Math.round(step.target.confidence * 100)} min={50} max={100} suffix="%" onChange={(v) => set({ target: { ...step.target, confidence: v / 100 } })} />
          <Num label={t("editor.timeout")} value={step.timeoutMs} step={500} suffix="ms" onChange={(timeoutMs) => set({ timeoutMs })} />
          <Field label={t("editor.resultVar")}><input className="input mono" value={step.resultVar} onChange={(e) => set({ resultVar: e.target.value.replace(/[^A-Za-z0-9_]/g, "") || "found" })} /></Field>
        </>
      );
    case "runFlow":
      return (
        <Field label={t("editor.flow")}>
          <select className="select" value={step.flowId} onChange={(e) => set({ flowId: e.target.value })}>
            <option value="f_unset">—</option>
            {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </Field>
      );
    case "switchProfile":
      return (
        <Field label={t("nav.keyforge")}>
          <select className="select" value={step.profileId} onChange={(e) => set({ profileId: e.target.value })}>
            <option value="default">—</option>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      );
    case "stop":
      return <Field label={t("editor.reason")}><input className="input" value={step.reason ?? ""} onChange={(e) => set({ reason: e.target.value || undefined })} /></Field>;
    case "if":
      return <ExprInput label={t("editor.condition")} value={step.condition.expr} onChange={(expr) => set({ condition: { expr } })} />;
    case "loop":
      return (
        <>
          <Field label={t("editor.loopMode")}>
            <Seg value={step.mode} onChange={(mode) => set({ mode, count: mode === "count" ? (step.count ?? 10) : step.count, condition: mode === "while" ? (step.condition ?? { expr: "true" }) : step.condition })} options={[{ value: "count", label: t("easy.repeat.count") }, { value: "while", label: t("editor.while") }, { value: "forever", label: t("easy.repeat.until") }]} />
          </Field>
          {step.mode === "count" && <Num label={t("easy.times")} value={step.count ?? 1} min={1} max={10_000_000} onChange={(count) => set({ count })} />}
          {step.mode === "while" && <ExprInput label={t("editor.condition")} value={step.condition?.expr ?? ""} onChange={(expr) => set({ condition: { expr } })} />}
          <Field label={t("editor.indexVar")} hint={t("editor.indexVarHint")}><input className="input mono" value={step.indexVar ?? ""} onChange={(e) => set({ indexVar: e.target.value.replace(/[^A-Za-z0-9_]/g, "") || undefined })} /></Field>
        </>
      );
    case "forEach":
      return (
        <>
          <ExprInput label={t("editor.list")} value={step.list} onChange={(list) => set({ list })} hint={t("editor.listHint")} />
          <Field label={t("editor.itemVar")}><input className="input mono" value={step.itemVar} onChange={(e) => set({ itemVar: e.target.value.replace(/[^A-Za-z0-9_]/g, "") || "item" })} /></Field>
        </>
      );
    case "try":
      return <Field label={t("editor.errorVar")}><input className="input mono" value={step.errorVar ?? ""} onChange={(e) => set({ errorVar: e.target.value.replace(/[^A-Za-z0-9_]/g, "") || undefined })} /></Field>;
    case "group":
      return <Field label={t("editor.groupName")}><input className="input" value={step.name} onChange={(e) => set({ name: e.target.value })} /></Field>;
    case "break":
    case "continue":
      return null;
  }
}

function UrlField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  const [draft, setDraft] = useState(value);
  let valid = true;
  try {
    new URL(draft);
  } catch {
    valid = false;
  }
  return (
    <Field label="URL" error={valid ? null : t("editor.badUrl")}>
      <input className={`input mono${valid ? "" : " invalid"}`} value={draft} onChange={(e) => { setDraft(e.target.value); try { new URL(e.target.value); onChange(e.target.value); } catch { /* keep draft */ } }} />
    </Field>
  );
}

function ModifierPicker({ value, onChange }: { value: string[]; onChange: (v: ("ctrl" | "alt" | "shift" | "meta")[]) => void }) {
  const t = useT();
  return (
    <Field label={t("editor.modifiers")}>
      <div className="row wrap">
        {(["ctrl", "alt", "shift", "meta"] as const).map((m) => (
          <button key={m} type="button" className={`btn sm${value.includes(m) ? " primary" : ""}`} onClick={() => onChange(value.includes(m) ? (value.filter((x) => x !== m) as ("ctrl" | "alt" | "shift" | "meta")[]) : [...(value as ("ctrl" | "alt" | "shift" | "meta")[]), m])}>
            {m}
          </button>
        ))}
      </div>
    </Field>
  );
}

export function TargetEditor({ target, onChange }: { target: Target; onChange: (t: Target) => void }) {
  const t = useT();
  const kinds: Target["kind"][] = ["point", "current", "region", "element", "image"];
  const pick = async () => {
    try {
      const r = await invoke("pick_point", {});
      onChange({ kind: "point", x: +(r.x / r.screen.width).toFixed(4), y: +(r.y / r.screen.height).toFixed(4), space: "normalized" });
    } catch {
      /* cancelled */
    }
  };
  return (
    <div className="card stack-sm" style={{ padding: 12, background: "var(--af-bg-2)" }}>
      <div className="row between">
        <span className="label">{t("editor.target")}</span>
        <select className="select" style={{ width: "auto", height: 30 }} value={target.kind} onChange={(e) => {
          const k = e.target.value as Target["kind"];
          onChange(k === "point" ? { kind: "point", x: 0.5, y: 0.5, space: "normalized" } : k === "current" ? { kind: "current" } : k === "region" ? { kind: "region", x: 0.4, y: 0.4, w: 0.2, h: 0.2, space: "normalized", pick: "center" } : k === "element" ? { kind: "element", selector: {} } : { kind: "image", ref: "", confidence: 0.9 });
        }} aria-label={t("editor.target")}>
          {kinds.map((k) => <option key={k} value={k}>{t(`targetKind.${k}`)}</option>)}
        </select>
      </div>
      {target.kind === "point" && (
        <>
          <div className="grid cols-2">
            <Num label="x" value={target.space === "normalized" ? +(target.x * 100).toFixed(2) : target.x} min={target.space === "normalized" ? 0 : -20000} max={target.space === "normalized" ? 100 : 20000} step={target.space === "normalized" ? 0.5 : 1} suffix={target.space === "normalized" ? "%" : "px"} onChange={(v) => onChange({ ...target, x: target.space === "normalized" ? v / 100 : v })} />
            <Num label="y" value={target.space === "normalized" ? +(target.y * 100).toFixed(2) : target.y} min={target.space === "normalized" ? 0 : -20000} max={target.space === "normalized" ? 100 : 20000} step={target.space === "normalized" ? 0.5 : 1} suffix={target.space === "normalized" ? "%" : "px"} onChange={(v) => onChange({ ...target, y: target.space === "normalized" ? v / 100 : v })} />
          </div>
          <div className="row wrap">
            <Seg value={target.space} onChange={(space) => onChange({ ...target, space, x: space === "normalized" ? 0.5 : 400, y: space === "normalized" ? 0.5 : 300 })} options={[{ value: "normalized", label: "%" }, { value: "screen", label: t("editor.space.screen") }, { value: "window", label: t("editor.space.window") }]} />
            {hasNativeBridge && <button className="btn sm" onClick={pick}><Icon name="Target" size={14} /> {t("easy.pickOnScreen")}</button>}
          </div>
        </>
      )}
      {target.kind === "region" && (
        <>
          <div className="grid cols-2">
            {(["x", "y", "w", "h"] as const).map((k) => (
              <Num key={k} label={k} value={target.space === "normalized" ? +(target[k] * 100).toFixed(2) : target[k]} min={0} max={target.space === "normalized" ? 100 : 20000} step={0.5} suffix={target.space === "normalized" ? "%" : "px"} onChange={(v) => onChange({ ...target, [k]: target.space === "normalized" ? Math.max(k === "w" || k === "h" ? 0.001 : 0, v / 100) : Math.max(k === "w" || k === "h" ? 1 : 0, v) })} />
            ))}
          </div>
          <Seg value={target.pick} onChange={(pick) => onChange({ ...target, pick })} options={[{ value: "center", label: t("editor.center") }, { value: "random", label: t("editor.randomPoint") }]} />
        </>
      )}
      {target.kind === "element" && (
        <div className="grid cols-2">
          {(["app", "window", "name", "role", "automationId", "text"] as const).map((k) => (
            <Field key={k} label={k}><input className="input" value={target.selector[k] ?? ""} onChange={(e) => onChange({ ...target, selector: { ...target.selector, [k]: e.target.value || undefined } })} /></Field>
          ))}
        </div>
      )}
      {target.kind === "image" && (
        <Field label={t("editor.imageRef")} hint={t("editor.imageRefHint")}><input className="input mono" value={target.ref} onChange={(e) => onChange({ ...target, ref: e.target.value })} /></Field>
      )}
      {target.kind === "current" && <p className="hint">{t("editor.currentHint")}</p>}
    </div>
  );
}
