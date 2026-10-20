import { useEffect, useMemo, useState, type DragEvent } from "react";
import { STEP_CAPABILITIES, describeStep, describeTrigger, findStep, type Flow, type LintIssue, type Step } from "@autoflow/core";
import { Icon } from "../../components/Icon";
import { STEP_BY_TYPE, STEP_CATEGORIES, STEP_META, cloneWithNewIds, insertStep, locate, moveStep, removeStep, updateStep, type Location, type Slot } from "../../lib/steps";
import { tp, useT } from "../../i18n";
import { platform } from "../../platform";
import { useStore } from "../../lib/store";
import { StepForm } from "./StepForm";
import { FlowSettings } from "./FlowSettings";

const DND_NEW = "application/x-autoflow-new";
const DND_MOVE = "application/x-autoflow-move";

export function ProEditor({ flow, onChange, lint }: { flow: Flow; onChange: (f: Flow) => void; lint: LintIssue[] }) {
  const t = useT();
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [clip, setClip] = useState<Step | null>(null);
  const activeStep = useStore((s) => (s.active && s.active.flowId === flow.id ? s.active.stepId : undefined));
  const setSteps = (steps: Step[]) => onChange({ ...flow, steps });
  const sel = selected ? findStep(flow.steps, selected) : undefined;
  const lintBy = useMemo(() => {
    const m = new Map<string, LintIssue[]>();
    for (const l of lint) if (l.stepId) m.set(l.stepId, [...(m.get(l.stepId) ?? []), l]);
    return m;
  }, [lint]);

  const add = (type: Step["type"], loc?: Location) => {
    const step = STEP_BY_TYPE[type].create();
    const where = loc ?? (sel ? afterLoc(flow.steps, sel.id) : { parentId: null, slot: "steps" as Slot, index: flow.steps.length });
    setSteps(insertStep(flow.steps, where, step));
    setSelected(step.id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target as HTMLElement).isContentEditable) return;
      if (!selected) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        setSteps(removeStep(flow.steps, selected).steps);
        setSelected(null);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        const s = findStep(flow.steps, selected);
        if (s) setSteps(insertStep(flow.steps, afterLoc(flow.steps, selected), cloneWithNewIds(s)));
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        const s = findStep(flow.steps, selected);
        if (s) setClip(s);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v" && clip) {
        e.preventDefault();
        setSteps(insertStep(flow.steps, afterLoc(flow.steps, selected), cloneWithNewIds(clip)));
      } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const loc = locate(flow.steps, selected);
        if (!loc) return;
        const index = e.key === "ArrowUp" ? Math.max(0, loc.index - 1) : loc.index + 2;
        setSteps(moveStep(flow.steps, selected, { ...loc, index }));
      } else if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const filtered = STEP_META.filter((m) => !q || t(`step.${m.type}`).toLowerCase().includes(q.toLowerCase()) || m.type.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="editor">
      <aside className="palette" aria-label={t("editor.palette")}>
        <div className="input-group">
          <Icon name="Search" size={15} />
          <input className="input" placeholder={t("editor.searchSteps")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("editor.searchSteps")} />
        </div>
        {STEP_CATEGORIES.map((cat) => {
          const items = filtered.filter((m) => m.category === cat);
          if (!items.length) return null;
          return (
            <div key={cat}>
              <h4>{t(`stepcat.${cat}`)}</h4>
              {items.map((m) => {
                const cap = STEP_CAPABILITIES[m.type][platform];
                return (
                  <button
                    key={m.type}
                    className={`palette-item${cap.support === "unsupported" ? " unsupported" : ""}`}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData(DND_NEW, m.type)}
                    onClick={() => add(m.type)}
                    title={cap.noteKey ? t(cap.noteKey) : undefined}
                  >
                    <span className="ic" style={{ color: m.color }}>
                      <Icon name={m.icon} size={16} />
                    </span>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <b>{t(`step.${m.type}`)}</b>
                      <small>{t(`step.${m.type}.desc`)}</small>
                    </span>
                    {cap.support !== "supported" && cap.noteKey !== "cap.sandbox" && <span className={`badge ${cap.support === "unsupported" ? "err" : "warn"}`} style={{ height: 18, fontSize: 10 }}>{t(`cap.${cap.support}`)}</span>}
                  </button>
                );
              })}
            </div>
          );
        })}
      </aside>

      <div className="canvas-area" onClick={(e) => e.target === e.currentTarget && setSelected(null)}>
        <div className="flow-col">
          <div className={`node trigger${selected === "__flow" ? " selected" : ""}`} onClick={() => setSelected("__flow")}>
            <span className="ic" style={{ background: "var(--af-gradient)" }}>
              <Icon name="Zap" size={16} />
            </span>
            <div className="grow">
              <div className="title">{t("editor.trigger")}</div>
              <div className="desc">{tp(describeTrigger(flow.trigger))}</div>
            </div>
            <span className="badge">{t("editor.settings")}</span>
          </div>
          <StepList steps={flow.steps} parentId={null} slot="steps" flow={flow} setSteps={setSteps} selected={selected} setSelected={setSelected} activeStep={activeStep} lintBy={lintBy} onAdd={add} />
          <div className="connector" />
          <div className="node end">{t("editor.end")}</div>
          {lint.length > 0 && (
            <div className="card" style={{ marginTop: 24 }}>
              <h3 style={{ marginBottom: 10 }}><Icon name="Bug" size={15} /> {t("editor.problems", { n: lint.length })}</h3>
              <div className="lint-list">
                {lint.map((l, i) => (
                  <div key={i} className={`lint-item ${l.severity}`} onClick={() => l.stepId && setSelected(l.stepId)}>
                    <span className={`badge ${l.severity === "error" ? "err" : l.severity === "warning" ? "warn" : "primary"}`}>{t(`lint.sev.${l.severity}`)}</span>
                    <span>{t(l.key, l.params as Record<string, string | number>)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <aside className="inspector" aria-label={t("editor.inspector")}>
        {selected === "__flow" || !sel ? (
          <FlowSettings flow={flow} onChange={onChange} />
        ) : (
          <StepForm
            key={sel.id}
            step={sel}
            flow={flow}
            issues={lintBy.get(sel.id) ?? []}
            onChange={(s) => setSteps(updateStep(flow.steps, sel.id, () => s))}
            onDelete={() => {
              setSteps(removeStep(flow.steps, sel.id).steps);
              setSelected(null);
            }}
            onDuplicate={() => setSteps(insertStep(flow.steps, afterLoc(flow.steps, sel.id), cloneWithNewIds(sel)))}
            onClose={() => setSelected(null)}
          />
        )}
      </aside>
    </div>
  );
}

function afterLoc(root: Step[], id: string): Location {
  const loc = locate(root, id);
  return loc ? { ...loc, index: loc.index + 1 } : { parentId: null, slot: "steps", index: root.length };
}

interface ListProps {
  steps: Step[];
  parentId: string | null;
  slot: Slot;
  flow: Flow;
  setSteps: (s: Step[]) => void;
  selected: string | null;
  setSelected: (id: string | null) => void;
  activeStep?: string;
  lintBy: Map<string, LintIssue[]>;
  onAdd: (type: Step["type"], loc: Location) => void;
}

function StepList(p: ListProps) {
  const t = useT();
  if (p.steps.length === 0 && p.parentId !== null) {
    return <DropZone {...p} index={0} empty label={t("editor.dropHere")} />;
  }
  return (
    <>
      {p.steps.map((s, i) => (
        <div key={s.id} style={{ display: "contents" }}>
          {s.type === "wait" && !s.label ? null : <DropZone {...p} index={i} />}
          {s.type === "wait" && !s.label ? (
            <WaitPill step={s} {...p} index={i} />
          ) : (
            <StepNode step={s} {...p} />
          )}
        </div>
      ))}
      <DropZone {...p} index={p.steps.length} />
    </>
  );
}

function DropZone({ flow, parentId, slot, index, setSteps, onAdd, empty, label }: ListProps & { index: number; empty?: boolean; label?: string }) {
  const t = useT();
  const [over, setOver] = useState(false);
  const loc: Location = { parentId, slot, index };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const n = e.dataTransfer.getData(DND_NEW);
    const m = e.dataTransfer.getData(DND_MOVE);
    if (n) onAdd(n as Step["type"], loc);
    else if (m) setSteps(moveStep(flow.steps, m, loc));
  };
  const handlers = {
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop,
  };
  const [menu, setMenu] = useState(false);
  if (empty) {
    return (
      <div className={`drop-empty${over ? " drop" : ""}`} {...handlers} onClick={() => setMenu(true)}>
        {label}
        {menu && <QuickAdd onPick={(ty) => { onAdd(ty, loc); setMenu(false); }} onClose={() => setMenu(false)} />}
      </div>
    );
  }
  return (
    <div className={`connector${over ? " drop" : ""}`} {...handlers} style={{ position: "relative" }}>
      <button className="add" onClick={() => setMenu((v) => !v)} aria-label={t("editor.addStep")}>
        <Icon name="Plus" size={14} />
      </button>
      {menu && <QuickAdd onPick={(ty) => { onAdd(ty, loc); setMenu(false); }} onClose={() => setMenu(false)} />}
    </div>
  );
}

const QUICK_TYPES: Step["type"][] = ["click", "key", "type", "wait", "if", "loop", "setVar", "notify", "drag", "scroll", "launchApp", "stop"];

function QuickAdd({ onPick, onClose }: { onPick: (t: Step["type"]) => void; onClose: () => void }) {
  const t = useT();
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const c = () => onClose();
    window.addEventListener("keydown", h);
    setTimeout(() => window.addEventListener("click", c), 0);
    return () => {
      window.removeEventListener("keydown", h);
      window.removeEventListener("click", c);
    };
  }, [onClose]);
  return (
    <div className="card" style={{ position: "absolute", zIndex: 20, top: 30, left: "50%", transform: "translateX(-50%)", width: 300, padding: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, boxShadow: "var(--af-shadow)" }} onClick={(e) => e.stopPropagation()}>
      {QUICK_TYPES.map((ty) => (
        <button key={ty} className="palette-item" style={{ cursor: "pointer", padding: 6 }} onClick={() => onPick(ty)}>
          <span className="ic" style={{ color: STEP_BY_TYPE[ty].color, width: 26, height: 26 }}>
            <Icon name={STEP_BY_TYPE[ty].icon} size={14} />
          </span>
          <b style={{ fontSize: 12.5 }}>{t(`step.${ty}`)}</b>
        </button>
      ))}
    </div>
  );
}

function WaitPill({ step, index, ...p }: ListProps & { step: Extract<Step, { type: "wait" }>; index: number }) {
  return (
    <>
      <DropZone {...p} index={index} />
      <div className="connector" style={{ height: "auto", padding: "2px 0" }}>
        <button
          className={`wait-pill${p.selected === step.id ? " selected" : ""}`}
          onClick={() => p.setSelected(step.id)}
          draggable
          onDragStart={(e) => e.dataTransfer.setData(DND_MOVE, step.id)}
          style={{ opacity: step.disabled ? 0.5 : 1, borderColor: p.activeStep === step.id ? "var(--af-accent)" : undefined }}
        >
          <Icon name="Hourglass" size={12} /> {tp(describeStep(step))}
        </button>
      </div>
    </>
  );
}

function StepNode({ step, ...p }: ListProps & { step: Step }) {
  const t = useT();
  const meta = STEP_BY_TYPE[step.type];
  const issues = p.lintBy.get(step.id) ?? [];
  const hasError = issues.some((i) => i.severity === "error");
  const cap = STEP_CAPABILITIES[step.type][platform];
  const cls = ["node", p.selected === step.id && "selected", p.activeStep === step.id && "running", step.disabled && "disabled", hasError && "error"].filter(Boolean).join(" ");
  const children: { slot: Slot; label: string; list: Step[] }[] =
    step.type === "if"
      ? [{ slot: "then", label: t("editor.then"), list: step.then }, { slot: "else", label: t("editor.else"), list: step.else }]
      : step.type === "try"
        ? [{ slot: "body", label: t("editor.try"), list: step.body }, { slot: "catch", label: t("editor.catch"), list: step.catch }]
        : step.type === "loop" || step.type === "forEach" || step.type === "group"
          ? [{ slot: "body", label: "", list: step.body }]
          : [];
  return (
    <div>
      <div
        className={cls}
        onClick={(e) => {
          e.stopPropagation();
          p.setSelected(step.id);
        }}
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.setData(DND_MOVE, step.id);
        }}
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && p.setSelected(step.id)}
        aria-label={t(`step.${step.type}`)}
      >
        <span className="ic" style={{ background: meta.color }}>
          <Icon name={meta.icon} size={16} />
        </span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="title row" style={{ gap: 6 }}>
            {step.label ?? t(`step.${step.type}`)}
            {step.breakpoint && <span className="badge err" style={{ height: 18 }}>●</span>}
            {step.onError && step.onError.strategy !== "stop" && <span className="badge" style={{ height: 18 }}>{t(`onError.${step.onError.strategy}`)}</span>}
            {cap.support !== "supported" && cap.noteKey !== "cap.sandbox" && <span className={`badge ${cap.support === "unsupported" ? "err" : "warn"}`} style={{ height: 18 }} title={cap.noteKey ? t(cap.noteKey) : undefined}>{t(`cap.${cap.support}`)}</span>}
          </div>
          <div className="desc">{tp(describeStep(step))}</div>
          {issues.length > 0 && <div className="small" style={{ color: hasError ? "#f87171" : "#fbbf24", marginTop: 4 }}>{t(issues[0]!.key, issues[0]!.params as Record<string, string | number>)}</div>}
        </div>
        <div className="tools">
          <button className="btn ghost icon sm" title={step.disabled ? t("editor.enable") : t("editor.disable")} onClick={(e) => { e.stopPropagation(); p.setSteps(updateStep(p.flow.steps, step.id, (s) => ({ ...s, disabled: !s.disabled }) as Step)); }}>
            <Icon name={step.disabled ? "Eye" : "Eraser"} size={14} />
          </button>
          <button className="btn ghost icon sm" title={t("common.delete")} onClick={(e) => { e.stopPropagation(); p.setSteps(removeStep(p.flow.steps, step.id).steps); }}>
            <Icon name="Trash2" size={14} />
          </button>
        </div>
      </div>
      {children.map((c) => (
        <div key={c.slot} className="container-body">
          {c.label && <div className="container-label">{c.label}</div>}
          <StepList {...p} steps={c.list} parentId={step.id} slot={c.slot} />
        </div>
      ))}
    </div>
  );
}
