import { useNavigate } from "react-router-dom";
import { PLATFORMS, TRIGGER_CAPABILITIES, analyzeRisk, describeDisplay, type Flow, type OnMissingDisplay, type Trigger, type VariableDef } from "@autoflow/core";
import { Icon } from "../../components/Icon";
import { Field, HotkeyInput, Switch } from "../../components/ui";
import { DraftInput, parseNumberDraft } from "../../components/DraftInput";
import { formatDuration, tp, useT } from "../../i18n";
import { platform } from "../../platform";
import { isoToLocalInput, localInputToIso } from "../../lib/datetime";
import { AppInput } from "./NativePickers";

const TRIGGERS: Trigger["type"][] = ["manual", "hotkey", "schedule", "appEvent", "deviceEvent", "location", "notification"];
const DEVICE_EVENTS = ["charging", "batteryLow", "wifiConnected", "wifiDisconnected", "bluetoothConnected", "headsetPlugged", "bootCompleted", "deviceConnected", "deviceDisconnected"] as const;

function defaultTrigger(type: Trigger["type"]): Trigger {
  switch (type) {
    case "manual": return { type };
    case "hotkey": return { type, hotkey: { key: "F6", modifiers: ["ctrl"] }, scope: "global" };
    case "schedule": return { type, everyMs: 3_600_000 };
    case "appEvent": return { type, event: "launched", app: "notepad.exe" };
    case "deviceEvent": return { type, event: "charging" };
    case "location": return { type, lat: 37.5665, lng: 126.978, radiusM: 300, on: "enter" };
    case "notification": return { type, app: "com.example.app" };
  }
}

export function FlowSettings({ flow, onChange }: { flow: Flow; onChange: (f: Flow) => void }) {
  const t = useT();
  const navigate = useNavigate();
  const tr = flow.trigger;
  const risk = analyzeRisk(flow);
  const setTrigger = (trigger: Trigger) => onChange({ ...flow, trigger });
  const setLimits = (patch: Partial<Flow["limits"]>) => onChange({ ...flow, limits: { ...flow.limits, ...patch } });
  const setVars = (variables: VariableDef[]) => onChange({ ...flow, variables });

  return (
    <div className="stack">
      <h3><Icon name="Settings" size={16} /> {t("editor.flowSettings")}</h3>
      <Field label={t("editor.description")}>
        <textarea className="textarea" rows={3} value={flow.description} maxLength={4000} onChange={(e) => onChange({ ...flow, description: e.target.value })} />
      </Field>
      <Field label={t("editor.tags")} hint={t("editor.tagsHint")}>
        <DraftInput className="input" value={flow.tags} show={(tags) => tags.join(", ")} parse={(text) => text.split(",").map((x) => x.trim().slice(0, 32)).filter(Boolean).slice(0, 20)} onChange={(tags) => onChange({ ...flow, tags })} />
      </Field>

      <div className="divider" />
      <h3><Icon name="Zap" size={16} /> {t("editor.trigger")}</h3>
      <Field label={t("editor.when")}>
        <select className="select" value={tr.type} onChange={(e) => setTrigger(defaultTrigger(e.target.value as Trigger["type"]))}>
          {TRIGGERS.map((ty) => {
            const c = TRIGGER_CAPABILITIES[ty][platform];
            return <option key={ty} value={ty}>{t(`triggerType.${ty}`)}{c.support !== "supported" ? ` (${t(`cap.${c.support}`)})` : ""}</option>;
          })}
        </select>
      </Field>
      {TRIGGER_CAPABILITIES[tr.type][platform].noteKey && <p className="hint">{t(TRIGGER_CAPABILITIES[tr.type][platform].noteKey!)}</p>}
      {tr.type === "hotkey" && (
        <div className="row wrap">
          <HotkeyInput value={tr.hotkey} onChange={(h) => h && setTrigger({ ...tr, hotkey: h })} />
          <select className="select" style={{ width: "auto" }} value={tr.scope} onChange={(e) => setTrigger({ ...tr, scope: e.target.value as "global" | "app" })}>
            <option value="global">{t("editor.scope.global")}</option>
            <option value="app">{t("editor.scope.app")}</option>
          </select>
          {tr.scope === "app" && <AppInput placeholder="app.exe" label={t("editor.app")} value={tr.app ?? ""} onChange={(v) => setTrigger({ ...tr, app: v || undefined })} />}
        </div>
      )}
      {tr.type === "schedule" && (
        <>
          <Field label={t("editor.every")} hint={t("editor.everyHint")}>
            <div className="input-group">
              <input className="input" type="number" min={1} max={10080} value={tr.everyMs ? Math.round(tr.everyMs / 60_000) : ""} placeholder="60" onChange={(e) => setTrigger({ ...tr, everyMs: e.target.value ? Math.max(1, Math.min(10080, Math.round(Number(e.target.value)) || 1)) * 60_000 : undefined, cron: e.target.value ? undefined : tr.cron })} />
              <span className="small muted">{t("common.minutes")}</span>
            </div>
          </Field>
          <Field label="cron" hint={t("editor.cronHint")}>
            <input className="input mono" value={tr.cron ?? ""} placeholder="0 9 * * 1-5" onChange={(e) => setTrigger({ ...tr, cron: e.target.value || undefined, everyMs: e.target.value ? undefined : tr.everyMs })} />
          </Field>
          {/* Optional active window. The picker works in local time; the flow stores UTC instants. */}
          <div className="grid cols-2">
            <Field label={t("editor.startAt")}>
              <input className="input" type="datetime-local" value={isoToLocalInput(tr.startAt)} max={isoToLocalInput(tr.endAt) || undefined} onChange={(e) => setTrigger({ ...tr, startAt: localInputToIso(e.target.value) })} />
            </Field>
            <Field label={t("editor.endAt")}>
              <input className="input" type="datetime-local" value={isoToLocalInput(tr.endAt)} min={isoToLocalInput(tr.startAt) || undefined} onChange={(e) => setTrigger({ ...tr, endAt: localInputToIso(e.target.value) })} />
            </Field>
          </div>
          <p className="hint">{t("editor.scheduleWindowHint")}</p>
        </>
      )}
      {tr.type === "appEvent" && (
        <div className="grid cols-2">
          <select className="select" value={tr.event} onChange={(e) => setTrigger({ ...tr, event: e.target.value as "launched" })}>
            {["launched", "closed", "focused"].map((x) => <option key={x} value={x}>{t(`trigger.app.${x}`, { app: "…" })}</option>)}
          </select>
          <AppInput label={t("editor.app")} value={tr.app} onChange={(app) => setTrigger({ ...tr, app })} />
        </div>
      )}
      {tr.type === "deviceEvent" && (
        <select className="select" value={tr.event} onChange={(e) => setTrigger({ ...tr, event: e.target.value as (typeof DEVICE_EVENTS)[number] })}>
          {DEVICE_EVENTS.map((x) => <option key={x} value={x}>{t(`trigger.device.${x}`)}</option>)}
        </select>
      )}
      {tr.type === "location" && (
        <>
          <div className="grid cols-2">
            <Field label="lat"><input className="input" type="number" step={0.0001} value={tr.lat} onChange={(e) => setTrigger({ ...tr, lat: Math.max(-90, Math.min(90, Number(e.target.value) || 0)) })} /></Field>
            <Field label="lng"><input className="input" type="number" step={0.0001} value={tr.lng} onChange={(e) => setTrigger({ ...tr, lng: Math.max(-180, Math.min(180, Number(e.target.value) || 0)) })} /></Field>
            <Field label={t("editor.radius")}><input className="input" type="number" min={50} max={50000} value={tr.radiusM} onChange={(e) => setTrigger({ ...tr, radiusM: Math.max(50, Math.min(50_000, Number(e.target.value) || 50)) })} /></Field>
            <Field label={t("editor.on")}>
              <select className="select" value={tr.on} onChange={(e) => setTrigger({ ...tr, on: e.target.value as "enter" | "exit" })}>
                <option value="enter">{t("trigger.location.enter", { r: tr.radiusM })}</option>
                <option value="exit">{t("trigger.location.exit", { r: tr.radiusM })}</option>
              </select>
            </Field>
          </div>
          <p className="hint">{t("editor.locationPrivacy")}</p>
        </>
      )}
      {tr.type === "notification" && (
        <div className="grid cols-2">
          <Field label={t("editor.app")}><AppInput label={t("editor.app")} value={tr.app} onChange={(app) => setTrigger({ ...tr, app })} /></Field>
          <Field label={t("editor.contains")}><input className="input" value={tr.contains ?? ""} onChange={(e) => setTrigger({ ...tr, contains: e.target.value || undefined })} /></Field>
        </div>
      )}

      <div className="divider" />
      <h3><Icon name="Shield" size={16} /> {t("editor.guardrails")}</h3>
      <Field label={t("editor.stopHotkey")} hint={t("easy.stopHotkeyHint")}>
        <HotkeyInput value={flow.hotkeys.stop} onChange={(h) => h && onChange({ ...flow, hotkeys: { ...flow.hotkeys, stop: h } })} />
      </Field>
      <Field label={t("easy.startHotkey")}>
        <HotkeyInput value={flow.hotkeys.start} allowClear onChange={(h) => onChange({ ...flow, hotkeys: { ...flow.hotkeys, start: h } })} />
      </Field>
      <Field label={t("editor.pauseHotkey")}>
        <HotkeyInput value={flow.hotkeys.pause} allowClear onChange={(h) => onChange({ ...flow, hotkeys: { ...flow.hotkeys, pause: h } })} />
      </Field>
      <Field label={t("editor.maxDuration")} hint={formatDuration(flow.limits.maxDurationMs)}>
        <div className="input-group">
          <input className="input" type="number" min={1} max={10080} value={Math.round(flow.limits.maxDurationMs / 60_000) || 1} onChange={(e) => setLimits({ maxDurationMs: Math.max(1, Math.min(10080, Math.round(Number(e.target.value)) || 1)) * 60_000 })} />
          <span className="small muted">{t("common.minutes")}</span>
        </div>
      </Field>
      <div className="grid cols-2">
        <Field label={t("editor.maxActions")}><input className="input" type="number" min={1} value={flow.limits.maxActions} onChange={(e) => setLimits({ maxActions: Math.max(1, Math.min(100_000_000, Math.round(Number(e.target.value)) || 1)) })} /></Field>
        <Field label={t("editor.maxIterations")}><input className="input" type="number" min={1} value={flow.limits.maxIterations} onChange={(e) => setLimits({ maxIterations: Math.max(1, Math.min(100_000_000, Math.round(Number(e.target.value)) || 1)) })} /></Field>
        <Field label={t("editor.countdown")}>
          <div className="input-group"><input className="input" type="number" min={0} max={60} value={flow.limits.countdownMs / 1000} onChange={(e) => setLimits({ countdownMs: Math.round(Math.max(0, Math.min(60, Number(e.target.value) || 0)) * 1000) })} /><span className="small muted">s</span></div>
        </Field>
        <Field label={t("editor.cooldown")}>
          <div className="input-group"><input className="input" type="number" min={0} value={flow.limits.cooldownMs / 1000} onChange={(e) => setLimits({ cooldownMs: Math.round(Math.max(0, Math.min(86_400, Number(e.target.value) || 0)) * 1000) })} /><span className="small muted">s</span></div>
        </Field>
        {/* Optional watchdog on executed steps of any type; empty = no limit (the field stays unset). */}
        <Field label={t("editor.maxSteps")}>
          <input className="input" type="number" min={1} max={1_000_000_000} placeholder="—" value={flow.limits.maxSteps ?? ""} onChange={(e) => setLimits({ maxSteps: e.target.value === "" ? undefined : Math.max(1, Math.min(1_000_000_000, Math.round(Number(e.target.value)) || 1)) })} />
        </Field>
      </div>
      <div className="row between">
        <span className="label">{t("editor.preventOverlap")}</span>
        <Switch checked={flow.limits.preventOverlap} onChange={(v) => setLimits({ preventOverlap: v })} label={t("editor.preventOverlap")} />
      </div>
      <div className="row between">
        <span className="label">{t("editor.humanize")}</span>
        {/* Off removes the block. On starts with small visible values (all-zero would do nothing). The seed stays unset. */}
        <Switch checked={!!flow.humanize} onChange={(v) => onChange({ ...flow, humanize: v ? { offsetPx: 2, delayMs: 40 } : undefined })} label={t("editor.humanize")} />
      </div>
      {flow.humanize && (
        <>
          <div className="grid cols-2">
            <Field label={t("editor.humanizeOffset")}>
              <div className="input-group"><input className="input" type="number" min={0} max={50} value={flow.humanize.offsetPx} onChange={(e) => onChange({ ...flow, humanize: { ...flow.humanize!, offsetPx: Math.max(0, Math.min(50, Math.round(Number(e.target.value)) || 0)) } })} /><span className="small muted">px</span></div>
            </Field>
            <Field label={t("editor.humanizeDelay")}>
              <div className="input-group"><input className="input" type="number" min={0} max={5000} step={10} value={flow.humanize.delayMs} onChange={(e) => onChange({ ...flow, humanize: { ...flow.humanize!, delayMs: Math.max(0, Math.min(5000, Math.round(Number(e.target.value)) || 0)) } })} /><span className="small muted">ms</span></div>
            </Field>
          </div>
          <p className="hint">{t("editor.humanizeHint")}</p>
        </>
      )}
      <div className={`callout ${risk.level === "high" ? "err" : risk.level === "medium" ? "warn" : "info"} small`}>
        <Icon name="ShieldCheck" size={16} />
        <div>
          <b>{t("safety.score", { n: risk.score })}</b> — {t(`safety.${risk.level}`)}
          {risk.permissions.length > 0 && <div className="muted">{risk.permissions.map((p) => t(p)).join(" · ")}</div>}
        </div>
      </div>

      <div className="divider" />
      <h3><Icon name="MonitorPlay" size={16} /> {t("stage.title")}</h3>
      <p className="small muted">{flow.stage ? t("stage.current", { display: tp(describeDisplay(flow.stage.display)) }) : t("stage.none")}</p>
      <Field label={t("stage.onMissing")}>
        <select className="select" value={flow.onMissingDisplay ?? ""} onChange={(e) => onChange({ ...flow, onMissingDisplay: (e.target.value || undefined) as OnMissingDisplay | undefined })}>
          <option value="">{t("stage.onMissing.default")}</option>
          {(["ask", "fail", "primary"] as const).map((m) => <option key={m} value={m}>{t(`stage.onMissing.${m}`)}</option>)}
        </select>
      </Field>
      {(flow.scenes?.length ?? 0) > 0 && <p className="small muted">{t("scene.count", { n: flow.scenes!.length })}</p>}
      <button className="btn sm" onClick={() => navigate(`/stage?flow=${flow.id}`)}><Icon name="MonitorPlay" size={14} /> {t("stage.open")}</button>

      <div className="divider" />
      <h3><Icon name="Variable" size={16} /> {t("editor.variables")}</h3>
      {flow.variables.map((v, i) => (
        <div key={i} className="card stack-sm" style={{ padding: 10, background: "var(--af-bg-2)" }}>
          <div className="row">
            <input className="input mono" value={v.name} onChange={(e) => setVars(flow.variables.map((x, j) => (j === i ? { ...x, name: e.target.value.replace(/[^A-Za-z0-9_]/g, "").slice(0, 48) || "v" } : x)))} aria-label={t("editor.varName")} />
            <select className="select" style={{ width: 110 }} value={v.type} onChange={(e) => setVars(flow.variables.map((x, j) => (j === i ? { ...x, type: e.target.value as VariableDef["type"] } : x)))} aria-label={t("editor.varType")}>
              {(["string", "number", "boolean", "list"] as const).map((ty) => <option key={ty} value={ty}>{t(`editor.varType.${ty}`)}</option>)}
            </select>
            <button className="btn ghost icon sm" onClick={() => setVars(flow.variables.filter((_, j) => j !== i))} aria-label={t("common.remove")}><Icon name="Trash2" size={14} /></button>
          </div>
          {v.type === "number" ? (
            // "-5" and "1.5" are typed one character at a time: nothing is stored until the text is a number.
            <DraftInput className="input" inputMode="decimal" placeholder={t("editor.initial")} value={typeof v.initial === "number" ? v.initial : Number(v.initial ?? 0) || 0} show={String} parse={(text) => parseNumberDraft(text, -Number.MAX_VALUE, Number.MAX_VALUE, false)} onChange={(n) => setVars(flow.variables.map((x, j) => (j === i ? { ...x, initial: n } : x)))} />
          ) : (
            <input className="input" placeholder={t("editor.initial")} value={v.initial === undefined ? "" : String(v.initial)} onChange={(e) => setVars(flow.variables.map((x, j) => (j === i ? { ...x, initial: e.target.value } : x)))} />
          )}
          <input className="input" placeholder={t("editor.promptPlaceholder")} value={v.prompt ?? ""} onChange={(e) => setVars(flow.variables.map((x, j) => (j === i ? { ...x, prompt: e.target.value || undefined } : x)))} />
        </div>
      ))}
      <button className="btn sm" onClick={() => setVars([...flow.variables, { name: `var${flow.variables.length + 1}`, type: "string" }])}><Icon name="Plus" size={14} /> {t("editor.addVariable")}</button>

      <div className="divider" />
      <h3><Icon name="Monitor" size={16} /> {t("editor.targets")}</h3>
      <div className="row wrap">
        {PLATFORMS.map((p) => (
          <button key={p} className={`btn sm${flow.targets.includes(p) ? " primary" : ""}`} onClick={() => {
            const next = flow.targets.includes(p) ? flow.targets.filter((x) => x !== p) : [...flow.targets, p];
            if (next.length) onChange({ ...flow, targets: next });
          }}>
            <Icon name={p === "windows" ? "Monitor" : p === "android" ? "Smartphone" : "Globe"} size={14} /> {t(`platform.${p}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
