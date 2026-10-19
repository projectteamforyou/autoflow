/**
 * Editor fields for multi-monitor flows: display references, pixel probes, scene conditions and the
 * pixel / scene steps. Kept apart from StepForm so the common step form stays readable.
 */
import { type ReactNode } from "react";
import { FUNCTION_NAMES, checkExpr, type Condition, type DisplayRef, type Flow } from "@autoflow/core";
import { Field, Seg, Switch } from "../../components/ui";
import { useDisplays } from "../../lib/displays";
import { useT } from "../../i18n";

type Point = { kind: "point"; x: number; y: number; space: "screen" | "window" | "normalized" | "display"; monitor?: number; display?: DisplayRef };

const refKey = (r: DisplayRef | undefined) => (r === undefined ? "" : typeof r === "object" ? `#${r.index}` : `=${r}`);
const fromKey = (k: string): DisplayRef | undefined => (k === "" ? undefined : k.startsWith("#") ? { index: Number(k.slice(1)) } : k.slice(1));

/** Display chip / select: unset, primary, secondary, by position, or a connected display's id. */
export function DisplayPicker({ value, onChange, label, allowUnset = true }: { value: DisplayRef | undefined; onChange: (r: DisplayRef | undefined) => void; label?: ReactNode; allowUnset?: boolean }) {
  const t = useT();
  const { displays, practice } = useDisplays();
  const options: { key: string; label: string }[] = [
    ...(allowUnset ? [{ key: "", label: t("display.unset") }] : []),
    { key: "=primary", label: t("display.primaryOpt") },
    { key: "=secondary", label: t("display.secondaryOpt") },
    { key: "#2", label: t("display.nth", { n: 3 }) },
    { key: "#3", label: t("display.nth", { n: 4 }) },
    ...(practice ? [] : displays.map((d, i) => ({ key: `=${d.id}`, label: `${i + 1} · ${d.name} (${d.bounds.w}×${d.bounds.h})` }))),
  ];
  const current = refKey(value);
  if (!options.some((o) => o.key === current)) options.push({ key: current, label: typeof value === "string" ? value : current });
  return (
    <Field label={label ?? t("display.label")} hint={t("display.hint")}>
      <select className="select" value={current} onChange={(e) => onChange(fromKey(e.target.value))} aria-label={t("display.label")}>
        {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    </Field>
  );
}

function Pct({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <Field label={label}>
      <div className="input-group">
        <input className="input" type="number" min={0} max={100} step={0.5} value={+(value * 100).toFixed(2)} onChange={(e) => onChange(Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100)} />
        <span className="small muted">%</span>
      </div>
    </Field>
  );
}

/** A pixel position: % of a display (default) or px on a display. */
export function ProbePointEditor({ at, onChange }: { at: Point; onChange: (p: Point) => void }) {
  const t = useT();
  const pct = at.space === "normalized";
  return (
    <div className="card stack-sm" style={{ padding: 12, background: "var(--af-bg-2)" }}>
      <span className="label">{t("pixel.position")}</span>
      {pct ? (
        <div className="grid cols-2">
          <Pct label="x" value={at.x} onChange={(x) => onChange({ ...at, x })} />
          <Pct label="y" value={at.y} onChange={(y) => onChange({ ...at, y })} />
        </div>
      ) : (
        <div className="grid cols-2">
          {(["x", "y"] as const).map((k) => (
            <Field key={k} label={k}><input className="input" type="number" value={at[k]} min={-20000} max={20000} onChange={(e) => onChange({ ...at, [k]: Number(e.target.value) || 0 })} /></Field>
          ))}
        </div>
      )}
      <Seg value={at.space === "window" ? "screen" : at.space} onChange={(space) => onChange({ ...at, space, x: space === "normalized" ? 0.5 : 100, y: space === "normalized" ? 0.5 : 100 })} options={[{ value: "normalized", label: "%" }, { value: "display", label: t("editor.space.display") }, { value: "screen", label: t("editor.space.screen") }]} />
      <DisplayPicker value={at.display} onChange={(display) => onChange({ ...at, display })} />
    </div>
  );
}

export function ColorField({ value, onChange, label }: { value: string; onChange: (c: string) => void; label?: string }) {
  const t = useT();
  return (
    <Field label={label ?? t("pixel.color")}>
      <div className="row">
        <input type="color" value={value.toLowerCase()} onChange={(e) => onChange(e.target.value)} aria-label={label ?? t("pixel.color")} style={{ width: 44, height: 34, padding: 0, border: 0, background: "none" }} />
        <input className="input mono" value={value} maxLength={7} onChange={(e) => /^#[0-9a-fA-F]{6}$/.test(e.target.value) && onChange(e.target.value)} />
      </div>
    </Field>
  );
}

function Tolerance({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const t = useT();
  return (
    <Field label={t("pixel.tolerance")} hint={t("pixel.toleranceHint")}>
      <input className="input" type="range" min={0} max={128} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={t("pixel.tolerance")} />
      <span className="small muted">±{value}</span>
    </Field>
  );
}

function ExprField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  const err = checkExpr(value);
  return (
    <Field label={t("editor.condition")} error={err} hint={t("editor.exprHint", { fns: FUNCTION_NAMES.slice(0, 12).join(", ") })}>
      <input className={`input mono${err ? " invalid" : ""}`} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
    </Field>
  );
}

const defaultPoint = (): Point => ({ kind: "point", x: 0.5, y: 0.5, space: "normalized" });

/** if / waitFor / loop-while condition: expression, plus an optional scene and pixel check (all must hold). */
export function ConditionEditor({ value, onChange, flow }: { value: Condition; onChange: (c: Condition) => void; flow: Flow }) {
  const t = useT();
  const scenes = flow.scenes ?? [];
  const sc = value.scene;
  const px = value.pixel;
  return (
    <div className="stack-sm">
      <ExprField value={value.expr} onChange={(expr) => onChange({ ...value, expr })} />
      <div className="row between">
        <span className="label">{t("cond.useScene")}</span>
        <Switch checked={!!sc} onChange={(on) => onChange({ ...value, scene: on ? { name: scenes[0]?.name ?? "lobby", minSimilarity: 0.9 } : undefined })} label={t("cond.useScene")} />
      </div>
      {sc && (
        <div className="card stack-sm" style={{ padding: 12, background: "var(--af-bg-2)" }}>
          <Field label={t("scene.name")} hint={scenes.length ? undefined : t("scene.noneYet")}>
            <select className="select" value={sc.name} onChange={(e) => onChange({ ...value, scene: { ...sc, name: e.target.value } })}>
              {!scenes.some((s) => s.name === sc.name) && <option value={sc.name}>{sc.name} ⚠</option>}
              {scenes.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          </Field>
          <Field label={t("scene.minSimilarity")}>
            <input className="input" type="range" min={50} max={100} value={Math.round(sc.minSimilarity * 100)} onChange={(e) => onChange({ ...value, scene: { ...sc, minSimilarity: Number(e.target.value) / 100 } })} aria-label={t("scene.minSimilarity")} />
            <span className="small muted">{Math.round(sc.minSimilarity * 100)}%</span>
          </Field>
          <Seg value={sc.not ? "not" : "is"} onChange={(v) => onChange({ ...value, scene: { ...sc, not: v === "not" || undefined } })} options={[{ value: "is", label: t("cond.showing") }, { value: "not", label: t("cond.notShowing") }]} />
        </div>
      )}
      <div className="row between">
        <span className="label">{t("cond.usePixel")}</span>
        <Switch checked={!!px} onChange={(on) => onChange({ ...value, pixel: on ? { at: defaultPoint(), color: "#2ecc71", tolerance: 24 } : undefined })} label={t("cond.usePixel")} />
      </div>
      {px && (
        <div className="stack-sm">
          <ProbePointEditor at={px.at} onChange={(at) => onChange({ ...value, pixel: { ...px, at } })} />
          <ColorField value={px.color} onChange={(color) => onChange({ ...value, pixel: { ...px, color } })} />
          <Tolerance value={px.tolerance} onChange={(tolerance) => onChange({ ...value, pixel: { ...px, tolerance } })} />
          <Seg value={px.not ? "not" : "is"} onChange={(v) => onChange({ ...value, pixel: { ...px, not: v === "not" || undefined } })} options={[{ value: "is", label: t("cond.showing") }, { value: "not", label: t("cond.notShowing") }]} />
        </div>
      )}
    </div>
  );
}

const cleanVar = (v: string, fallback: string) => v.replace(/[^A-Za-z0-9_]/g, "").slice(0, 48) || fallback;

export function PixelCheckFields({ step, set }: { step: { at: Point; color?: string; tolerance: number; resultVar: string }; set: (p: Record<string, unknown>) => void }) {
  const t = useT();
  return (
    <>
      <ProbePointEditor at={step.at} onChange={(at) => set({ at })} />
      <div className="row between">
        <span className="label">{t("pixel.compare")}</span>
        <Switch checked={step.color !== undefined} onChange={(on) => set({ color: on ? "#2ecc71" : undefined })} label={t("pixel.compare")} />
      </div>
      {step.color !== undefined && (
        <>
          <ColorField value={step.color} onChange={(color) => set({ color })} />
          <Tolerance value={step.tolerance} onChange={(tolerance) => set({ tolerance })} />
        </>
      )}
      <Field label={t("editor.resultVar")} hint={step.color !== undefined ? t("pixel.resultBool") : t("pixel.resultColor")}>
        <input className="input mono" value={step.resultVar} onChange={(e) => set({ resultVar: cleanVar(e.target.value, "color") })} />
      </Field>
    </>
  );
}

export function WaitForPixelFields({ step, set }: { step: { at: Point; color: string; tolerance: number; not?: boolean; pollMs: number; timeoutMs?: number }; set: (p: Record<string, unknown>) => void }) {
  const t = useT();
  return (
    <>
      <ProbePointEditor at={step.at} onChange={(at) => set({ at })} />
      <ColorField value={step.color} onChange={(color) => set({ color })} />
      <Tolerance value={step.tolerance} onChange={(tolerance) => set({ tolerance })} />
      <Seg value={step.not ? "not" : "is"} onChange={(v) => set({ not: v === "not" || undefined })} options={[{ value: "is", label: t("pixel.untilShows") }, { value: "not", label: t("pixel.untilGone") }]} />
      <div className="grid cols-2">
        <Field label={t("editor.poll")}>
          <input className="input" type="number" min={50} max={60000} value={step.pollMs} onChange={(e) => set({ pollMs: Math.max(50, Math.min(60000, Number(e.target.value) || 250)) })} />
        </Field>
        <Field label={t("editor.timeout")} hint={step.timeoutMs === undefined ? t("pixel.noTimeout") : undefined}>
          <div className="row">
            <Switch checked={step.timeoutMs !== undefined} onChange={(on) => set({ timeoutMs: on ? 10_000 : undefined })} label={t("editor.timeout")} />
            {step.timeoutMs !== undefined && <input className="input" type="number" min={0} max={86_400_000} step={500} value={step.timeoutMs} onChange={(e) => set({ timeoutMs: Math.max(0, Number(e.target.value) || 0) })} />}
          </div>
        </Field>
      </div>
    </>
  );
}

export function MatchSceneFields({ step, set, flow }: { step: { scenes?: string[]; minSimilarity: number; resultVar: string; similarityVar?: string }; set: (p: Record<string, unknown>) => void; flow: Flow }) {
  const t = useT();
  const all = (flow.scenes ?? []).map((s) => s.name);
  const chosen = step.scenes;
  return (
    <>
      <Field label={t("scene.candidates")} hint={all.length ? t("scene.candidatesHint") : t("scene.noneYet")}>
        <div className="row wrap">
          <button type="button" className={`btn sm${chosen === undefined ? " primary" : ""}`} onClick={() => set({ scenes: undefined })}>{t("scene.all")}</button>
          {all.map((n) => {
            const on = chosen?.includes(n) ?? false;
            return (
              <button key={n} type="button" className={`btn sm${on ? " primary" : ""}`} onClick={() => set({ scenes: on ? chosen!.filter((x) => x !== n) : [...(chosen ?? []), n] })}>{n}</button>
            );
          })}
        </div>
      </Field>
      <Field label={t("scene.minSimilarity")}>
        <input className="input" type="range" min={50} max={100} value={Math.round(step.minSimilarity * 100)} onChange={(e) => set({ minSimilarity: Number(e.target.value) / 100 })} aria-label={t("scene.minSimilarity")} />
        <span className="small muted">{Math.round(step.minSimilarity * 100)}%</span>
      </Field>
      <Field label={t("editor.resultVar")} hint={t("scene.resultHint")}>
        <input className="input mono" value={step.resultVar} onChange={(e) => set({ resultVar: cleanVar(e.target.value, "scene") })} />
      </Field>
      <Field label={t("scene.similarityVar")}>
        <input className="input mono" value={step.similarityVar ?? ""} onChange={(e) => set({ similarityVar: e.target.value.replace(/[^A-Za-z0-9_]/g, "") || undefined })} />
      </Field>
    </>
  );
}
