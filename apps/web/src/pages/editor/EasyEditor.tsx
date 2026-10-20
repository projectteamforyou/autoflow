import { useEffect, useMemo, useRef, useState } from "react";
import { INTERVAL_PRESETS, applyEasy, hotkeyToString, toEasy, type EasyModel, type EasyPoint, type Flow } from "@autoflow/core";
import { Icon } from "../../components/Icon";
import { Field, HotkeyInput, Seg, keyFromEvent } from "../../components/ui";
import { formatDuration, useT } from "../../i18n";
import { hasNativeBridge, invoke } from "../../platform";

export function EasyEditor({ flow, onChange }: { flow: Flow; onChange: (f: Flow) => void }) {
  const t = useT();
  const model = useMemo(() => toEasy(flow), [flow]);
  if (!model) return null;
  const set = (patch: Partial<EasyModel>) => onChange(applyEasy(flow, { ...model, ...patch }));
  const preset = (Object.entries(INTERVAL_PRESETS).find(([, v]) => v === model.intervalMs)?.[0] ?? "custom") as keyof typeof INTERVAL_PRESETS | "custom";
  const kindUi = model.kind === "multiClick" ? "click" : model.kind;

  const est = (() => {
    const per = (model.kind === "keys" ? model.keys.length : model.kind === "text" ? 1 : model.points.length) * model.intervalMs;
    if (model.repeat.mode === "count") return formatDuration(per * model.repeat.count);
    if (model.repeat.mode === "duration") return formatDuration(model.repeat.ms);
    return t("easy.untilStopped");
  })();

  return (
    <div className="easy-wrap">
      <section className="card pad-lg stack">
        <div>
          <h2>{t("easy.what")}</h2>
          <p className="muted small">{t("easy.whatHint")}</p>
        </div>
        <div className="choice-grid">
          {(["click", "keys", "text"] as const).map((k) => (
            <button
              key={k}
              className="choice"
              aria-pressed={kindUi === k}
              onClick={() => {
                if (kindUi === k) return;
                set({ kind: k, points: k === "click" ? (model.points.length ? model.points : [{ x: 0.5, y: 0.5, button: "left", clicks: 1, holdMs: 0 }]) : model.points, keys: k === "keys" && !model.keys.length ? [{ key: "Space", modifiers: [] }] : model.keys });
              }}
            >
              <Icon name={k === "click" ? "MousePointerClick" : k === "keys" ? "Keyboard" : "Type"} />
              <b>{t(`easy.kind.${k}`)}</b>
              <small>{t(`easy.kind.${k}.desc`)}</small>
            </button>
          ))}
        </div>
      </section>

      {kindUi === "click" && <PointsSection model={model} set={set} />}
      {kindUi === "keys" && <KeysSection model={model} set={set} />}
      {kindUi === "text" && (
        <section className="card pad-lg stack">
          <h2>{t("easy.textTitle")}</h2>
          <textarea className="textarea" rows={4} value={model.text} onChange={(e) => set({ text: e.target.value })} placeholder={t("easy.textPlaceholder")} />
          <p className="hint">{t("easy.textHint")}</p>
        </section>
      )}

      <section className="card pad-lg stack">
        <h2>{t("easy.howFast")}</h2>
        <div className="row wrap">
          <Seg
            value={preset}
            onChange={(v) => v !== "custom" && set({ intervalMs: INTERVAL_PRESETS[v] })}
            options={[
              { value: "fast", label: t("easy.fast") },
              { value: "normal", label: t("easy.normal") },
              { value: "slow", label: t("easy.slow") },
              { value: "custom", label: t("easy.custom") },
            ]}
          />
          <div className="input-group" style={{ width: 200 }}>
            <input className="input" type="number" min={10} max={3_600_000} value={model.intervalMs} onChange={(e) => set({ intervalMs: Math.max(10, Math.min(3_600_000, Number(e.target.value) || 10)) })} aria-label={t("easy.intervalMs")} />
            <span className="muted small">ms</span>
          </div>
        </div>
        {model.intervalMs < 50 && <div className="callout warn small"><Icon name="ShieldAlert" /> {t("easy.fastWarning")}</div>}
      </section>

      <section className="card pad-lg stack">
        <h2>{t("easy.howLong")}</h2>
        <Seg
          value={model.repeat.mode}
          onChange={(m) => set({ repeat: m === "count" ? { mode: "count", count: 100 } : m === "duration" ? { mode: "duration", ms: 60_000 } : { mode: "untilStopped" } })}
          options={[
            { value: "count", label: t("easy.repeat.count"), icon: "Repeat" },
            { value: "duration", label: t("easy.repeat.duration"), icon: "Timer" },
            { value: "untilStopped", label: t("easy.repeat.until"), icon: "Hand" },
          ]}
        />
        {model.repeat.mode === "count" && (
          <Field label={t("easy.times")}>
            <input className="input" type="number" min={1} max={10_000_000} value={model.repeat.count} onChange={(e) => set({ repeat: { mode: "count", count: Math.max(1, Math.min(10_000_000, Number(e.target.value) || 1)) } })} style={{ maxWidth: 220 }} />
          </Field>
        )}
        {model.repeat.mode === "duration" && (
          <Field label={t("easy.minutes")}>
            <input className="input" type="number" min={0.1} max={1440} step={0.5} value={+(model.repeat.ms / 60_000).toFixed(2)} onChange={(e) => set({ repeat: { mode: "duration", ms: Math.round(Math.max(0.1, Number(e.target.value) || 1) * 60_000) } })} style={{ maxWidth: 220 }} />
          </Field>
        )}
        {model.repeat.mode === "untilStopped" && <p className="small muted">{t("easy.untilHint", { s: formatDuration(flow.limits.maxDurationMs) })}</p>}
      </section>

      <section className="card pad-lg stack">
        <h2>{t("easy.hotkeys")}</h2>
        <div className="grid cols-2">
          <Field label={t("easy.startHotkey")} hint={t("easy.startHotkeyHint")}>
            <HotkeyInput value={model.startHotkey} allowClear onChange={(h) => set({ startHotkey: h })} />
          </Field>
          <Field label={t("easy.stopHotkey")} hint={t("easy.stopHotkeyHint")}>
            <HotkeyInput value={model.stopHotkey} onChange={(h) => h && set({ stopHotkey: h })} />
          </Field>
        </div>
      </section>

      <section className="card pad-lg stack" style={{ background: "linear-gradient(135deg, rgba(124,92,255,.12), rgba(34,195,166,.08))" }}>
        <h2>{t("easy.summary")}</h2>
        <div className="summary-line">
          <Icon name="Zap" size={16} />
          {kindUi === "click" ? t("easy.sum.click", { n: model.points.length }) : kindUi === "keys" ? t("easy.sum.keys", { keys: model.keys.map((k) => hotkeyToString(k)).join(" → ") }) : t("easy.sum.text")}
          <span className="badge">{t("easy.sum.every", { ms: model.intervalMs })}</span>
          <span className="badge">{est}</span>
          <span className="badge err"><Icon name="OctagonX" size={12} /> {hotkeyToString(model.stopHotkey)}</span>
          <span className="badge">{t("easy.sum.countdown", { s: Math.round(flow.limits.countdownMs / 1000) })}</span>
        </div>
      </section>
    </div>
  );
}

function PointsSection({ model, set }: { model: EasyModel; set: (p: Partial<EasyModel>) => void }) {
  const t = useT();
  const board = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const pts = model.points;
  const sel = pts[selected];

  const toNorm = (e: { clientX: number; clientY: number }) => {
    const r = board.current!.getBoundingClientRect();
    return { x: +Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)).toFixed(4), y: +Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)).toFixed(4) };
  };
  const setPoint = (i: number, patch: Partial<EasyPoint>) => set({ points: pts.map((p, j) => (j === i ? { ...p, ...patch } : p)), kind: pts.length > 1 ? "multiClick" : "click" });

  useEffect(() => {
    if (drag === null) return;
    const move = (e: PointerEvent) => setPoint(drag, toNorm(e));
    const up = () => setDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, pts]);

  const pickOnScreen = async () => {
    try {
      const r = await invoke("pick_point", {});
      const next = [...pts, { x: +(r.x / r.screen.width).toFixed(4), y: +(r.y / r.screen.height).toFixed(4), button: "left" as const, clicks: 1 as const, holdMs: 0 }];
      set({ points: next, kind: next.length > 1 ? "multiClick" : "click" });
      setSelected(next.length - 1);
    } catch {
      /* cancelled */
    }
  };

  return (
    <section className="card pad-lg stack">
      <div className="row between wrap">
        <div>
          <h2>{t("easy.where")}</h2>
          <p className="muted small">{t("easy.whereHint")}</p>
        </div>
        {hasNativeBridge && (
          <button className="btn" onClick={pickOnScreen}>
            <Icon name="Target" size={16} /> {t("easy.pickOnScreen")}
          </button>
        )}
      </div>
      <div
        ref={board}
        className="point-board"
        onPointerDown={(e) => {
          if (e.target !== board.current || pts.length >= 20) return;
          const p = toNorm(e);
          const next = [...pts, { ...p, button: "left" as const, clicks: 1 as const, holdMs: 0 }];
          set({ points: next, kind: next.length > 1 ? "multiClick" : "click" });
          setSelected(next.length - 1);
        }}
        role="application"
        aria-label={t("easy.boardLabel")}
      >
        {pts.map((p, i) => (
          <div
            key={i}
            className={`point-dot ${p.button}`}
            style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, outline: i === selected ? "3px solid rgba(255,255,255,.5)" : undefined }}
            onPointerDown={(e) => {
              e.stopPropagation();
              setSelected(i);
              setDrag(i);
            }}
            tabIndex={0}
            aria-label={t("easy.pointN", { n: i + 1 })}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 0.05 : 0.01;
              const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
              if (d) {
                e.preventDefault();
                setPoint(i, { x: +Math.min(1, Math.max(0, p.x + d[0]!)).toFixed(4), y: +Math.min(1, Math.max(0, p.y + d[1]!)).toFixed(4) });
              }
            }}
          >
            {i + 1}
          </div>
        ))}
      </div>
      {sel && (
        <div className="row wrap">
          <span className="badge primary">{t("easy.pointN", { n: selected + 1 })}</span>
          <Seg value={sel.button} onChange={(b) => setPoint(selected, { button: b })} options={[{ value: "left", label: t("button.left") }, { value: "right", label: t("button.right") }, { value: "middle", label: t("button.middle") }]} />
          <Seg value={String(sel.clicks) as "1" | "2"} onChange={(c) => setPoint(selected, { clicks: Number(c) as 1 | 2 })} options={[{ value: "1", label: t("easy.single") }, { value: "2", label: t("easy.double") }]} />
          <label className="row small">
            {t("easy.hold")}
            <input className="input" type="number" min={0} max={60_000} step={100} value={sel.holdMs} onChange={(e) => setPoint(selected, { holdMs: Math.max(0, Math.min(60_000, Number(e.target.value) || 0)) })} style={{ width: 100 }} />
            ms
          </label>
          <span className="small subtle mono">x {Math.round(sel.x * 100)}% · y {Math.round(sel.y * 100)}%</span>
          <span className="grow" />
          <button
            className="btn sm ghost"
            disabled={pts.length <= 1}
            onClick={() => {
              const next = pts.filter((_, j) => j !== selected);
              set({ points: next, kind: next.length > 1 ? "multiClick" : "click" });
              setSelected(Math.max(0, selected - 1));
            }}
          >
            <Icon name="Trash2" size={14} /> {t("common.remove")}
          </button>
        </div>
      )}
    </section>
  );
}

function KeysSection({ model, set }: { model: EasyModel; set: (p: Partial<EasyModel>) => void }) {
  const t = useT();
  const [listening, setListening] = useState(false);
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape" && !e.ctrlKey) return setListening(false);
      const h = keyFromEvent(e);
      if (h) {
        set({ keys: [...model.keys, h].slice(0, 20) });
        setListening(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listening, model.keys, set]);
  return (
    <section className="card pad-lg stack">
      <div>
        <h2>{t("easy.whichKeys")}</h2>
        <p className="muted small">{t("easy.whichKeysHint")}</p>
      </div>
      <div className="row wrap">
        {model.keys.map((k, i) => (
          <span key={i} className="row" style={{ gap: 4 }}>
            {i > 0 && <Icon name="ChevronRight" size={14} className="subtle" />}
            <span className="keycap">{hotkeyToString(k)}</span>
            <button className="btn ghost icon sm" onClick={() => set({ keys: model.keys.filter((_, j) => j !== i) })} disabled={model.keys.length <= 1} aria-label={t("common.remove")}>
              <Icon name="X" size={13} />
            </button>
          </span>
        ))}
        <button className={`btn sm capture${listening ? " listening" : ""}`} onClick={() => setListening(true)}>
          <Icon name="Plus" size={14} /> {listening ? t("hotkey.listening") : t("easy.addKey")}
        </button>
      </div>
    </section>
  );
}
