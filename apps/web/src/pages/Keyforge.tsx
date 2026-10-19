import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createProfile, findConflicts, hotkeyToString, newId, sourceKey, type InputOutput, type InputProfile, type InputSource, type Mapping, type ProfileRule } from "@autoflow/core";
import { Shell } from "../components/Shell";
import { Icon } from "../components/Icon";
import { Empty, Field, HotkeyInput, Seg, Switch, keyFromEvent } from "../components/ui";
import { useStore } from "../lib/store";
import { confirmDialog } from "../lib/dialog";
import { useT } from "../i18n";
import { hasNativeBridge, invoke } from "../platform";

export function KeyforgePage() {
  const t = useT();
  const { id } = useParams();
  const navigate = useNavigate();
  const profiles = useStore((s) => s.profiles);
  const save = useStore((s) => s.saveProfile);
  const profile = profiles.find((p) => p.id === id);

  const create = async () => {
    const p = createProfile(t("keyforge.newProfile"), newId("p"));
    if (!profiles.length) p.priority = 0;
    await save(p);
    navigate(`/keyforge/${p.id}`);
  };

  const apply = async () => {
    try {
      const r = await invoke("profiles_apply", { profiles, enabled: true });
      useStore.getState().toast("success", t("keyforge.applied", { name: profiles.find((p) => p.id === r.active)?.name ?? "—" }));
      for (const w of r.warnings) useStore.getState().toast("warning", w);
    } catch (e) {
      useStore.getState().toast("error", (e as Error).message);
    }
  };

  if (profile) return <ProfileEditor key={profile.id} profile={profile} onApply={apply} />;

  return (
    <Shell title={<h2>{t("nav.keyforge")}</h2>} actions={<div className="row">{hasNativeBridge && profiles.length > 0 && <button className="btn sm" onClick={apply}><Icon name="Zap" size={15} /> {t("keyforge.apply")}</button>}<button className="btn sm primary" onClick={create}><Icon name="Plus" size={15} /> {t("keyforge.create")}</button></div>}>
      <div className="page">
        <div className="page-head">
          <div>
            <h1>{t("keyforge.title")}</h1>
            <p>{t("keyforge.sub")}</p>
          </div>
        </div>
        {!hasNativeBridge && (
          <div className="callout info small"><Icon name="Info" size={16} /> {t("keyforge.webNote")}</div>
        )}
        {profiles.length === 0 ? (
          <div className="card">
            <Empty icon="Keyboard" title={t("keyforge.empty")} body={t("keyforge.emptyBody")} action={<button className="btn primary" onClick={create}><Icon name="Plus" size={16} /> {t("keyforge.create")}</button>} />
          </div>
        ) : (
          <div className="grid auto">
            {profiles.map((p) => {
              const conflicts = findConflicts(p);
              return (
                <div key={p.id} className="card hover flow-card" onClick={() => navigate(`/keyforge/${p.id}`)} role="link" tabIndex={0}>
                  <div className="row">
                    <div className="tile-icon" style={{ background: "linear-gradient(135deg,#EC4899,#7C5CFF)" }}><Icon name="Keyboard" /></div>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <b className="truncate" style={{ display: "block" }}>{p.name}</b>
                      <span className="small muted">{p.rules.length ? p.rules.map((r) => ruleLabel(r, t)).join(" · ") : t("keyforge.default")}</span>
                    </div>
                    <span className={`badge ${p.enabled ? "ok" : ""}`}>{p.enabled ? t("common.on") : t("common.off")}</span>
                  </div>
                  <div className="meta">
                    <span className="badge">{t("keyforge.mappingsN", { n: p.layers.reduce((a, l) => a + l.mappings.length, 0) })}</span>
                    <span className="badge">{t("keyforge.expansionsN", { n: p.textExpansions.length })}</span>
                    <span className="badge">{t("keyforge.priorityN", { n: p.priority })}</span>
                    {conflicts.length > 0 && <span className="badge warn">{t("keyforge.conflictsN", { n: conflicts.length })}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Shell>
  );
}

function ruleLabel(r: ProfileRule, t: (k: string, p?: Record<string, string | number>) => string): string {
  if (r.kind === "app") return r.app;
  if (r.kind === "device") return r.name;
  return `${r.from}–${r.to}`;
}

const KB_ROWS: { k: string; w?: string; label?: string }[][] = [
  [{ k: "Escape", label: "Esc" }, { k: "F1" }, { k: "F2" }, { k: "F3" }, { k: "F4" }, { k: "F5" }, { k: "F6" }, { k: "F7" }, { k: "F8" }, { k: "F9" }, { k: "F10" }, { k: "F11" }, { k: "F12" }],
  [{ k: "`" }, { k: "1" }, { k: "2" }, { k: "3" }, { k: "4" }, { k: "5" }, { k: "6" }, { k: "7" }, { k: "8" }, { k: "9" }, { k: "0" }, { k: "-" }, { k: "=" }, { k: "Backspace", w: "w2", label: "⌫" }],
  [{ k: "Tab", w: "w15" }, ..."QWERTYUIOP".split("").map((k) => ({ k })), { k: "[" }, { k: "]" }, { k: "\\", w: "w15" }],
  [{ k: "CapsLock", w: "w2", label: "Caps" }, ..."ASDFGHJKL".split("").map((k) => ({ k })), { k: ";" }, { k: "'" }, { k: "Enter", w: "w2" }],
  [{ k: "Shift", w: "w25" }, ..."ZXCVBNM".split("").map((k) => ({ k })), { k: "," }, { k: "." }, { k: "/" }, { k: "Shift", w: "w25" }],
  [{ k: "Control", w: "w15", label: "Ctrl" }, { k: "Meta", w: "w15", label: "Win" }, { k: "Alt", w: "w15" }, { k: "Space", w: "w6" }, { k: "Alt", w: "w15" }, { k: "ContextMenu", w: "w15", label: "Menu" }, { k: "Control", w: "w15", label: "Ctrl" }],
];

function ProfileEditor({ profile, onApply }: { profile: InputProfile; onApply: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const save = useStore((s) => s.saveProfile);
  const del = useStore((s) => s.deleteProfile);
  const flows = useStore((s) => s.flows);
  const [p, setP] = useState(profile);
  const [layerId, setLayerId] = useState(profile.layers[0]!.id);
  const [tab, setTab] = useState<"keys" | "mouse" | "text" | "rules">("keys");
  const [pressed, setPressed] = useState<string | null>(null);
  const [testOut, setTestOut] = useState<string>("");
  const layer = p.layers.find((l) => l.id === layerId) ?? p.layers[0]!;
  const flowHotkeys = flows.flatMap((f) => [...(f.trigger.type === "hotkey" ? [{ flowId: f.id, hotkey: f.trigger.hotkey }] : []), ...(f.hotkeys.start ? [{ flowId: f.id, hotkey: f.hotkeys.start }] : [])]);
  const conflicts = useMemo(() => findConflicts(p, flowHotkeys), [p, flowHotkeys]);

  useEffect(() => {
    const id = setTimeout(() => void save(p), 500);
    return () => clearTimeout(id);
  }, [p, save]);

  const setLayer = (mappings: Mapping[]) => setP({ ...p, layers: p.layers.map((l) => (l.id === layer.id ? { ...l, mappings } : l)) });
  const mappedKeys = new Set(layer.mappings.filter((m) => m.from.kind === "key" && m.from.modifiers.length === 0).map((m) => (m.from as { key: string }).key.toUpperCase()));

  // Live tester: shows what a key press would produce under this layer.
  useEffect(() => {
    if (tab !== "keys") return;
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const h = keyFromEvent(e);
      if (!h) return;
      setPressed(h.key.toUpperCase());
      const m = layer.mappings.find((x) => x.enabled && x.from.kind === "key" && sourceKey(x.from) === sourceKey({ kind: "key", key: h.key, modifiers: h.modifiers }));
      setTestOut(`${hotkeyToString(h)} → ${m ? outputLabel(m.to, t) : t("keyforge.passThrough")}`);
    };
    const up = () => setPressed(null);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [tab, layer, t]);

  const addMapping = (from: InputSource) => setLayer([...layer.mappings, { id: newId("m"), from, to: { kind: "key", key: "Escape", modifiers: [] }, repeat: "none", repeatMs: 100, enabled: true }]);

  return (
    <Shell
      title={
        <div className="row grow">
          <button className="btn ghost icon sm" onClick={() => navigate("/keyforge")} aria-label={t("common.back")}><Icon name="ArrowLeft" size={16} /></button>
          <input className="input" style={{ maxWidth: 280, height: 32 }} value={p.name} onChange={(e) => setP({ ...p, name: e.target.value.slice(0, 80) || " " })} aria-label={t("editor.name")} />
          <Switch checked={p.enabled} onChange={(v) => setP({ ...p, enabled: v })} label={t("common.on")} />
        </div>
      }
      actions={
        <div className="row">
          {conflicts.length > 0 && <span className="badge warn">{t("keyforge.conflictsN", { n: conflicts.length })}</span>}
          {hasNativeBridge && <button className="btn sm primary" onClick={onApply}><Icon name="Zap" size={15} /> {t("keyforge.apply")}</button>}
          <button className="btn sm ghost" onClick={async () => { if (await confirmDialog({ title: t("keyforge.deleteTitle"), tone: "danger", confirmLabel: t("common.delete") })) { await del(p.id); navigate("/keyforge"); } }}><Icon name="Trash2" size={15} /></button>
        </div>
      }
    >
      <div className="page">
        <div className="row wrap between">
          <Seg value={tab} onChange={setTab} options={[{ value: "keys", label: t("keyforge.tab.keys"), icon: "Keyboard" }, { value: "mouse", label: t("keyforge.tab.mouse"), icon: "MousePointer2" }, { value: "text", label: t("keyforge.tab.text"), icon: "Type" }, { value: "rules", label: t("keyforge.tab.rules"), icon: "Layers" }]} />
          {(tab === "keys" || tab === "mouse") && (
            <div className="row">
              <span className="label">{t("keyforge.layer")}</span>
              <select className="select" style={{ width: "auto" }} value={layer.id} onChange={(e) => setLayerId(e.target.value)}>
                {p.layers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <button className="btn sm" onClick={() => { const id = newId("l"); setP({ ...p, layers: [...p.layers, { id, name: `${t("keyforge.layer")} ${p.layers.length + 1}`, mappings: [] }] }); setLayerId(id); }} disabled={p.layers.length >= 16}><Icon name="Plus" size={14} /></button>
            </div>
          )}
        </div>

        {conflicts.length > 0 && (
          <div className="callout warn small">
            <Icon name="ShieldAlert" size={16} />
            <ul className="bullets">{conflicts.map((c, i) => <li key={i}>{t(`keyforge.conflict.${c.kind}`, { detail: c.detail })}</li>)}</ul>
          </div>
        )}

        {tab === "keys" && (
          <>
            <div className="card stack">
              <div className="row between wrap">
                <h3>{t("keyforge.keyboard")}</h3>
                <span className="small muted">{t("keyforge.tester")}: <b className="mono">{testOut || t("keyforge.pressAny")}</b></span>
              </div>
              <div className="kb" aria-hidden="true">
                {KB_ROWS.map((row, i) => (
                  <div key={i} className="kb-row">
                    {row.map((k, j) => (
                      <div key={j} className={`kb-key ${k.w ?? ""}${mappedKeys.has(k.k.toUpperCase()) ? " mapped" : ""}${pressed === k.k.toUpperCase() ? " pressed" : ""}`} onClick={() => addMapping({ kind: "key", key: k.k === "Space" ? "Space" : k.k, modifiers: [] })} style={{ cursor: "pointer" }}>
                        {k.label ?? k.k}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <p className="hint">{t("keyforge.keyboardHint")}</p>
            </div>
            <MappingTable mappings={layer.mappings.filter((m) => m.from.kind === "key")} all={layer.mappings} onChange={setLayer} flows={flows.map((f) => ({ id: f.id, name: f.name }))} layers={p.layers.map((l) => ({ id: l.id, name: l.name }))} />
            <AddKeyMapping onAdd={addMapping} />
          </>
        )}

        {tab === "mouse" && (
          <>
            <div className="grid cols-2">
              <div className="card stack">
                <h3>{t("keyforge.buttons")}</h3>
                <MouseDiagram mappings={layer.mappings} onPick={(button) => addMapping({ kind: "mouse", button, gesture: "single" })} />
                <div className="row wrap">
                  {(["up", "down", "left", "right"] as const).map((d) => (
                    <button key={d} className="btn sm" onClick={() => addMapping({ kind: "wheel", direction: d })}><Icon name="ArrowDownUp" size={14} /> {t(`keyforge.wheel.${d}`)}</button>
                  ))}
                </div>
              </div>
              <div className="card stack">
                <h3>{t("keyforge.mouseSettings")}</h3>
                <p className="hint">{t("keyforge.mouseSettingsHint")}</p>
                <div className="row between"><span className="label">{t("keyforge.swap")}</span><Switch checked={!!p.mouse.swapButtons} onChange={(v) => setP({ ...p, mouse: { ...p.mouse, swapButtons: v } })} label={t("keyforge.swap")} /></div>
                <div className="row between"><span className="label">{t("keyforge.precision")}</span><Switch checked={!!p.mouse.enhancePrecision} onChange={(v) => setP({ ...p, mouse: { ...p.mouse, enhancePrecision: v } })} label={t("keyforge.precision")} /></div>
                <div className="row between"><span className="label">{t("keyforge.invertWheel")}</span><Switch checked={!!p.mouse.invertWheel} onChange={(v) => setP({ ...p, mouse: { ...p.mouse, invertWheel: v } })} label={t("keyforge.invertWheel")} /></div>
                <Field label={`${t("keyforge.pointerSpeed")} · ${p.mouse.pointerSpeed ?? 10}`}><input type="range" min={1} max={20} value={p.mouse.pointerSpeed ?? 10} onChange={(e) => setP({ ...p, mouse: { ...p.mouse, pointerSpeed: Number(e.target.value) } })} /></Field>
                <Field label={`${t("keyforge.doubleClick")} · ${p.mouse.doubleClickMs ?? 500} ms`}><input type="range" min={100} max={900} step={10} value={p.mouse.doubleClickMs ?? 500} onChange={(e) => setP({ ...p, mouse: { ...p.mouse, doubleClickMs: Number(e.target.value) } })} /></Field>
                <Field label={`${t("keyforge.wheelLines")} · ${p.mouse.wheelLines ?? 3}`}><input type="range" min={1} max={20} value={p.mouse.wheelLines ?? 3} onChange={(e) => setP({ ...p, mouse: { ...p.mouse, wheelLines: Number(e.target.value) } })} /></Field>
                <div className="callout small"><Icon name="Cpu" size={16} /> {t("keyforge.vendorNote")}</div>
              </div>
            </div>
            <MappingTable mappings={layer.mappings.filter((m) => m.from.kind !== "key")} all={layer.mappings} onChange={setLayer} flows={flows.map((f) => ({ id: f.id, name: f.name }))} layers={p.layers.map((l) => ({ id: l.id, name: l.name }))} />
          </>
        )}

        {tab === "text" && (
          <div className="card stack">
            <h3>{t("keyforge.expansions")}</h3>
            <p className="hint">{t("keyforge.expansionsHint")}</p>
            {p.textExpansions.map((x, i) => (
              <div key={x.id} className="row wrap">
                <input className="input mono" style={{ maxWidth: 160 }} value={x.abbreviation} onChange={(e) => setP({ ...p, textExpansions: p.textExpansions.map((y, j) => (j === i ? { ...y, abbreviation: e.target.value.slice(0, 40) } : y)) })} aria-label={t("keyforge.abbr")} />
                <Icon name="ChevronRight" size={14} />
                <input className="input grow" value={x.text} onChange={(e) => setP({ ...p, textExpansions: p.textExpansions.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)) })} aria-label={t("keyforge.expandsTo")} />
                <button className="btn ghost icon sm" onClick={() => setP({ ...p, textExpansions: p.textExpansions.filter((_, j) => j !== i) })} aria-label={t("common.remove")}><Icon name="Trash2" size={14} /></button>
              </div>
            ))}
            <button className="btn sm" onClick={() => setP({ ...p, textExpansions: [...p.textExpansions, { id: newId("x"), abbreviation: `;sig${p.textExpansions.length + 1}`, text: "", apps: [] }] })}><Icon name="Plus" size={14} /> {t("keyforge.addExpansion")}</button>
          </div>
        )}

        {tab === "rules" && (
          <div className="card stack">
            <h3>{t("keyforge.when")}</h3>
            <p className="hint">{t("keyforge.rulesHint")}</p>
            <Field label={t("keyforge.priority")} hint={t("keyforge.priorityHint")}>
              <input className="input" type="number" min={0} max={1000} value={p.priority} onChange={(e) => setP({ ...p, priority: Math.max(0, Math.min(1000, Number(e.target.value) || 0)) })} style={{ maxWidth: 160 }} />
            </Field>
            {p.rules.map((r, i) => (
              <div key={i} className="row wrap">
                <span className="badge">{t(`keyforge.rule.${r.kind}`)}</span>
                {r.kind === "app" && <input className="input mono" value={r.app} onChange={(e) => setP({ ...p, rules: p.rules.map((x, j) => (j === i ? { ...r, app: e.target.value } : x)) })} />}
                {r.kind === "device" && <input className="input" value={r.name} onChange={(e) => setP({ ...p, rules: p.rules.map((x, j) => (j === i ? { ...r, name: e.target.value } : x)) })} />}
                {r.kind === "time" && (
                  <>
                    <input className="input" type="time" value={r.from} onChange={(e) => setP({ ...p, rules: p.rules.map((x, j) => (j === i ? { ...r, from: e.target.value } : x)) })} style={{ width: 130 }} />
                    <input className="input" type="time" value={r.to} onChange={(e) => setP({ ...p, rules: p.rules.map((x, j) => (j === i ? { ...r, to: e.target.value } : x)) })} style={{ width: 130 }} />
                  </>
                )}
                <button className="btn ghost icon sm" onClick={() => setP({ ...p, rules: p.rules.filter((_, j) => j !== i) })} aria-label={t("common.remove")}><Icon name="Trash2" size={14} /></button>
              </div>
            ))}
            <div className="row wrap">
              <button className="btn sm" onClick={() => setP({ ...p, rules: [...p.rules, { kind: "app", app: "game.exe" }] })}><Icon name="AppWindow" size={14} /> {t("keyforge.rule.app")}</button>
              <button className="btn sm" onClick={() => setP({ ...p, rules: [...p.rules, { kind: "time", from: "09:00", to: "18:00", days: [1, 2, 3, 4, 5] }] })}><Icon name="Timer" size={14} /> {t("keyforge.rule.time")}</button>
              <button className="btn sm" onClick={() => setP({ ...p, rules: [...p.rules, { kind: "device", name: "Keyboard" }] })}><Icon name="Keyboard" size={14} /> {t("keyforge.rule.device")}</button>
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}

function outputLabel(o: InputOutput, t: (k: string, p?: Record<string, string | number>) => string): string {
  switch (o.kind) {
    case "key": return hotkeyToString({ key: o.key, modifiers: o.modifiers });
    case "mouse": return t(`button.${o.button}`);
    case "text": return `“${o.text.slice(0, 30)}”`;
    case "launch": return `▶ ${o.app}`;
    case "flow": return `⚡ ${o.flowId}`;
    case "media": return t(`keyforge.media.${o.action}`);
    case "layer": return `${t("keyforge.layer")} ${o.layerId} (${o.mode})`;
    case "disabled": return t("keyforge.disabled");
  }
}

function sourceLabel(s: InputSource, t: (k: string) => string): string {
  if (s.kind === "key") return hotkeyToString({ key: s.key, modifiers: s.modifiers });
  if (s.kind === "mouse") return `${t(`button.${s.button}`)} · ${t(`keyforge.gesture.${s.gesture}`)}`;
  return t(`keyforge.wheel.${s.direction}`);
}

function MappingTable({ mappings, all, onChange, flows, layers }: { mappings: Mapping[]; all: Mapping[]; onChange: (m: Mapping[]) => void; flows: { id: string; name: string }[]; layers: { id: string; name: string }[] }) {
  const t = useT();
  if (!mappings.length) return null;
  const upd = (id: string, patch: Partial<Mapping>) => onChange(all.map((m) => (m.id === id ? ({ ...m, ...patch } as Mapping) : m)));
  return (
    <div className="card" style={{ padding: 0, overflowX: "auto" }}>
      <table className="table">
        <thead><tr><th>{t("keyforge.from")}</th><th>{t("keyforge.to")}</th><th>{t("keyforge.repeat")}</th><th /></tr></thead>
        <tbody>
          {mappings.map((m) => (
            <tr key={m.id} style={{ opacity: m.enabled ? 1 : 0.5 }}>
              <td>
                <span className="keycap">{sourceLabel(m.from, t)}</span>
                {m.from.kind === "mouse" && (
                  <select className="select" style={{ width: "auto", height: 28, marginLeft: 6 }} value={m.from.gesture} onChange={(e) => upd(m.id, { from: { ...m.from, gesture: e.target.value } as InputSource })}>
                    {["single", "double", "hold"].map((g) => <option key={g} value={g}>{t(`keyforge.gesture.${g}`)}</option>)}
                  </select>
                )}
              </td>
              <td>
                <div className="row wrap">
                  <select className="select" style={{ width: "auto", height: 30 }} value={m.to.kind} onChange={(e) => {
                    const k = e.target.value as InputOutput["kind"];
                    const to: InputOutput = k === "key" ? { kind: "key", key: "Escape", modifiers: [] } : k === "mouse" ? { kind: "mouse", button: "left" } : k === "text" ? { kind: "text", text: "" } : k === "launch" ? { kind: "launch", app: "notepad.exe" } : k === "flow" ? { kind: "flow", flowId: flows[0]?.id ?? "f_unset" } : k === "media" ? { kind: "media", action: "playPause" } : k === "layer" ? { kind: "layer", layerId: layers[0]!.id, mode: "hold" } : { kind: "disabled" };
                    upd(m.id, { to });
                  }} aria-label={t("keyforge.to")}>
                    {["key", "mouse", "text", "launch", "flow", "media", "layer", "disabled"].map((k) => <option key={k} value={k}>{t(`keyforge.out.${k}`)}</option>)}
                  </select>
                  {m.to.kind === "key" && <HotkeyInput value={{ key: m.to.key, modifiers: m.to.modifiers }} onChange={(h) => h && upd(m.id, { to: { kind: "key", key: h.key, modifiers: h.modifiers } })} />}
                  {m.to.kind === "mouse" && (
                    <select className="select" style={{ width: "auto", height: 30 }} value={m.to.button} onChange={(e) => upd(m.id, { to: { kind: "mouse", button: e.target.value as "left" } })}>
                      {["left", "right", "middle", "x1", "x2"].map((b) => <option key={b} value={b}>{t(`button.${b}`)}</option>)}
                    </select>
                  )}
                  {m.to.kind === "text" && <input className="input" style={{ minWidth: 200 }} value={m.to.text} onChange={(e) => upd(m.id, { to: { kind: "text", text: e.target.value } })} />}
                  {m.to.kind === "launch" && <input className="input mono" value={m.to.app} onChange={(e) => upd(m.id, { to: { kind: "launch", app: e.target.value } })} />}
                  {m.to.kind === "flow" && (
                    <select className="select" style={{ width: "auto", height: 30 }} value={m.to.flowId} onChange={(e) => upd(m.id, { to: { kind: "flow", flowId: e.target.value } })}>
                      {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                  )}
                  {m.to.kind === "media" && (
                    <select className="select" style={{ width: "auto", height: 30 }} value={m.to.action} onChange={(e) => upd(m.id, { to: { kind: "media", action: e.target.value as "playPause" } })}>
                      {["playPause", "next", "previous", "volumeUp", "volumeDown", "mute"].map((a) => <option key={a} value={a}>{t(`keyforge.media.${a}`)}</option>)}
                    </select>
                  )}
                  {m.to.kind === "layer" && (
                    <>
                      <select className="select" style={{ width: "auto", height: 30 }} value={m.to.layerId} onChange={(e) => upd(m.id, { to: { ...(m.to as Extract<InputOutput, { kind: "layer" }>), layerId: e.target.value } })}>
                        {layers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                      <select className="select" style={{ width: "auto", height: 30 }} value={m.to.mode} onChange={(e) => upd(m.id, { to: { ...(m.to as Extract<InputOutput, { kind: "layer" }>), mode: e.target.value as "hold" } })}>
                        <option value="hold">{t("keyforge.hold")}</option>
                        <option value="toggle">{t("keyforge.toggle")}</option>
                      </select>
                    </>
                  )}
                </div>
              </td>
              <td>
                <select className="select" style={{ width: "auto", height: 30 }} value={m.repeat} onChange={(e) => upd(m.id, { repeat: e.target.value as Mapping["repeat"] })}>
                  {["none", "whileHeld", "toggle"].map((r) => <option key={r} value={r}>{t(`keyforge.rep.${r}`)}</option>)}
                </select>
                {m.repeat !== "none" && <input className="input" type="number" min={10} max={60000} value={m.repeatMs} onChange={(e) => upd(m.id, { repeatMs: Math.max(10, Number(e.target.value) || 10) })} style={{ width: 90, marginLeft: 6, height: 30 }} aria-label="ms" />}
              </td>
              <td>
                <div className="row end">
                  <Switch checked={m.enabled} onChange={(v) => upd(m.id, { enabled: v })} label={t("common.on")} />
                  <button className="btn ghost icon sm" onClick={() => onChange(all.filter((x) => x.id !== m.id))} aria-label={t("common.remove")}><Icon name="Trash2" size={14} /></button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddKeyMapping({ onAdd }: { onAdd: (s: InputSource) => void }) {
  const t = useT();
  return (
    <div className="row">
      <span className="label">{t("keyforge.addCombo")}</span>
      <HotkeyInput onChange={(h) => h && onAdd({ kind: "key", key: h.key, modifiers: h.modifiers })} />
    </div>
  );
}

function MouseDiagram({ mappings, onPick }: { mappings: Mapping[]; onPick: (b: "left" | "right" | "middle" | "x1" | "x2") => void }) {
  const t = useT();
  const has = (b: string) => mappings.some((m) => m.from.kind === "mouse" && m.from.button === b);
  return (
    <svg className="mouse-svg" viewBox="0 0 200 280" style={{ width: 180, margin: "0 auto", display: "block" }} role="img" aria-label={t("keyforge.buttons")}>
      <rect x="30" y="10" width="140" height="260" rx="70" fill="var(--af-surface-2)" stroke="var(--af-border-strong)" strokeWidth="2" />
      <path className={`zone${has("left") ? " mapped" : ""}`} d="M100 12 L100 110 L32 110 L32 80 A68 68 0 0 1 100 12 Z" fill="transparent" stroke="var(--af-border-strong)" onClick={() => onPick("left")}><title>{t("button.left")}</title></path>
      <path className={`zone${has("right") ? " mapped" : ""}`} d="M100 12 L100 110 L168 110 L168 80 A68 68 0 0 0 100 12 Z" fill="transparent" stroke="var(--af-border-strong)" onClick={() => onPick("right")}><title>{t("button.right")}</title></path>
      <rect className={`zone${has("middle") ? " mapped" : ""}`} x="90" y="40" width="20" height="44" rx="10" fill="var(--af-bg-2)" stroke="var(--af-border-strong)" onClick={() => onPick("middle")}><title>{t("button.middle")}</title></rect>
      <rect className={`zone${has("x2") ? " mapped" : ""}`} x="24" y="130" width="14" height="34" rx="6" fill="var(--af-bg-2)" stroke="var(--af-border-strong)" onClick={() => onPick("x2")}><title>{t("button.x2")}</title></rect>
      <rect className={`zone${has("x1") ? " mapped" : ""}`} x="24" y="170" width="14" height="34" rx="6" fill="var(--af-bg-2)" stroke="var(--af-border-strong)" onClick={() => onPick("x1")}><title>{t("button.x1")}</title></rect>
    </svg>
  );
}
