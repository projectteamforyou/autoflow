import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { STEP_CAPABILITIES, describeStep, describeTrigger, findStep, type Flow, type LintIssue, type Step } from "@autoflow/core";
import { Icon } from "../../components/Icon";
import { STEP_BY_TYPE, STEP_CATEGORIES, STEP_META, ancestorsOf, childLists, cloneWithNewIds, countNested, insertStep, isContainer, locate, moveStep, removeStep, siblingsAt, updateStep, visibleStepIds, wrapStep, type Location, type Slot, type WrapKind } from "../../lib/steps";
import { copyStep, readCopiedStep } from "../../lib/stepClipboard";
import type { PartialMode } from "../../lib/partialRun";
import { tp, useT } from "../../i18n";
import { platform } from "../../platform";
import { useStore } from "../../lib/store";
import { StepForm } from "./StepForm";
import { FlowSettings } from "./FlowSettings";
import { isTypingTarget } from "./Shortcuts";
import { isImeKey } from "../../lib/ime";
import { openModalCount } from "../../lib/modalStack";

const DND_NEW = "application/x-autoflow-new";
const DND_MOVE = "application/x-autoflow-move";

export function ProEditor({ flow, onChange, lint, onRunPartial, onShortcuts, revealStep }: { flow: Flow; onChange: (f: Flow) => void; lint: LintIssue[]; onRunPartial: (stepId: string, mode: PartialMode) => void; onShortcuts: () => void; /** Step to select and reveal (deep link `?step=`); unknown ids are ignored. */ revealStep?: string | null }) {
  const t = useT();
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState("");
  // Collapsed if / loop / forEach / try containers: a view preference of this session only.
  // Groups persist theirs in the schema's `collapsed` field instead.
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const activeStep = useStore((s) => (s.active && s.active.flowId === flow.id ? s.active.stepId : undefined));
  const setSteps = (steps: Step[]) => onChange({ ...flow, steps });
  const sel = selected ? findStep(flow.steps, selected) : undefined;
  const flowRef = useRef(flow);
  flowRef.current = flow;
  // The "Step deleted · Undo" toast outlives this editor (other flow, Easy mode, another page).
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const canvasRef = useRef<HTMLDivElement>(null);

  const isCollapsed = (s: Step) => (s.type === "group" ? !!s.collapsed : folded.has(s.id));
  const toggleCollapse = (s: Step) => {
    if (s.type === "group") return setSteps(updateStep(flow.steps, s.id, (x) => ({ ...x, collapsed: !s.collapsed || undefined }) as Step));
    setFolded((cur) => {
      const next = new Set(cur);
      if (!next.delete(s.id)) next.add(s.id);
      return next;
    });
  };
  /** Selects a step that may sit inside collapsed containers (lint list): opens every ancestor first. */
  const reveal = (id: string) => {
    const closed = ancestorsOf(flow.steps, id).filter(isCollapsed);
    if (closed.some((a) => a.type !== "group")) setFolded((cur) => new Set([...cur].filter((x) => !closed.some((a) => a.id === x))));
    setSelected(id);
    const groups = closed.filter((a) => a.type === "group");
    if (groups.length) setSteps(groups.reduce((steps, g) => updateStep(steps, g.id, (x) => ({ ...x, collapsed: undefined }) as Step), flow.steps));
  };

  // Deep link: once per flow + step, so later edits (or collapsing it again) do not re-select it.
  const revealedLink = useRef<string | null>(null);
  useEffect(() => {
    const key = revealStep ? `${flow.id}:${revealStep}` : null;
    if (!revealStep || !key || revealedLink.current === key || !findStep(flow.steps, revealStep)) return;
    revealedLink.current = key;
    reveal(revealStep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealStep, flow.id]);

  const nodeOf = (id: string) => [...(canvasRef.current?.querySelectorAll<HTMLElement>("[data-step-id]") ?? [])].find((el) => el.dataset.stepId === id);
  // Keep the selection (arrow keys, lint click) and the step a run is executing in view.
  // A running step inside a collapsed container has no node: nothing scrolls, nothing is forced open.
  useEffect(() => {
    if (selected) nodeOf(selected)?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);
  useEffect(() => {
    if (activeStep) nodeOf(activeStep)?.scrollIntoView?.({ block: "nearest" });
  }, [activeStep]);

  /** Removes a step and offers Undo (re-inserts it at its old location in whatever the flow is by then). */
  const remove = (id: string) => {
    const loc = locate(flow.steps, id);
    const { steps, removed } = removeStep(flow.steps, id);
    if (selected === id) setSelected(null);
    // A stale id (the step is already gone): nothing to remove, so no edit and no undo entry either.
    if (!removed || !loc) return;
    setSteps(steps);
    const flowId = flow.id;
    useStore.getState().toast("info", t("editor.stepDeleted"), {
      label: t("common.undo"),
      run: () => {
        const cur = flowRef.current;
        // The toast is sticky, so by now the editor may show another flow or be closed — and the step
        // may be back already (Ctrl+Z). Inserting it a second time would give the flow duplicate step
        // ids, which the store refuses to load.
        if (!mounted.current || cur.id !== flowId || !canReinsert(cur.steps, removed)) return;
        // The container it came from may be gone by now (deleted, undone): put it back at the end of the
        // flow rather than nowhere.
        const parentThere = loc.parentId === null || locate(cur.steps, loc.parentId) !== null;
        onChange({ ...cur, steps: insertStep(cur.steps, parentThere ? loc : { parentId: null, slot: loc.slot, index: cur.steps.length }, removed) });
        setSelected(removed.id);
      },
    });
  };
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

  const toggleFlag = (id: string, flag: "disabled" | "breakpoint") => setSteps(updateStep(flow.steps, id, (s) => ({ ...s, [flag]: !s[flag] || undefined }) as Step));
  /** Moves a step one place among its siblings (Alt+arrows and the inspector's buttons). */
  const move = (id: string, dir: -1 | 1) => {
    const loc = locate(flow.steps, id);
    if (!loc) return;
    setSteps(moveStep(flow.steps, id, { ...loc, index: dir < 0 ? Math.max(0, loc.index - 1) : loc.index + 2 }));
  };
  const duplicate = (s: Step) => setSteps(insertStep(flow.steps, afterLoc(flow.steps, s.id), cloneWithNewIds(s)));
  const wrap = (id: string, kind: WrapKind) => {
    const r = wrapStep(flow.steps, id, kind);
    if (!r.wrapperId) return;
    setSteps(r.steps);
    setSelected(r.wrapperId);
  };
  const paste = () => {
    const clip = readCopiedStep();
    if (!clip) return false;
    // Fresh ids every time: the same step can be pasted repeatedly and into the flow it came from.
    const step = cloneWithNewIds(clip);
    setSteps(insertStep(flow.steps, selected ? afterLoc(flow.steps, selected) : { parentId: null, slot: "steps", index: flow.steps.length }, step));
    setSelected(step.id);
    return true;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      // Not while typing, and not from inside a dialog or the add-step menu (Delete there must not remove a step).
      // Nor behind any open dialog, wherever the focus happens to be.
      if (isTypingTarget(el) || el.tagName === "SELECT" || el.closest?.(".modal, .quick-add") || openModalCount() > 0) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "v") {
        // Works without a selection too (appends), so a step copied in another flow can go into an empty one.
        if (paste()) e.preventDefault();
        return;
      }
      if (!selected) return;
      const step = findStep(flow.steps, selected);
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        if (selected !== "__flow" && step) remove(selected);
      } else if (mod && k === "d") {
        e.preventDefault();
        if (step) duplicate(step);
      } else if (mod && k === "c") {
        // Text selected on the page (a description, a lint message): Ctrl+C is the browser's copy, not "copy step".
        if (step && !window.getSelection?.()?.toString()) {
          copyStep(step);
          useStore.getState().toast("info", t("editor.stepCopied"));
        }
      } else if (mod && k === "x") {
        if (!step) return;
        e.preventDefault();
        copyStep(step);
        setSteps(removeStep(flow.steps, step.id).steps);
        setSelected(null);
        useStore.getState().toast("info", t("editor.stepCut"));
      } else if (mod && (e.key === "/" || e.code === "Slash")) {
        e.preventDefault();
        if (step) toggleFlag(step.id, "disabled");
      } else if (e.key === "F9" && !mod && !e.altKey) {
        e.preventDefault();
        if (step) toggleFlag(step.id, "breakpoint");
      } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        move(selected, e.key === "ArrowUp" ? -1 : 1);
      } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !mod && !e.shiftKey) {
        // Plain arrows walk the visible nodes (trigger first). Inside the inspector they keep scrolling it.
        if (el.closest?.(".inspector")) return;
        const order = ["__flow", ...visibleStepIds(flow.steps, isCollapsed)];
        const at = order.indexOf(selected);
        const next = at < 0 ? undefined : order[at + (e.key === "ArrowUp" ? -1 : 1)];
        e.preventDefault();
        if (next) setSelected(next);
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

      <div className="canvas-area" ref={canvasRef} onClick={(e) => e.target === e.currentTarget && setSelected(null)}>
        <div className="flow-col">
          <div
            className={`node trigger${selected === "__flow" ? " selected" : ""}`}
            data-step-id="__flow"
            role="button"
            tabIndex={0}
            aria-selected={selected === "__flow"}
            aria-label={`${t("editor.trigger")}: ${tp(describeTrigger(flow.trigger))}`}
            onClick={() => setSelected("__flow")}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              setSelected("__flow");
            }}
          >
            <span className="ic" style={{ background: "var(--af-gradient)" }}>
              <Icon name="Zap" size={16} />
            </span>
            <div className="grow">
              <div className="title">{t("editor.trigger")}</div>
              <div className="desc">{tp(describeTrigger(flow.trigger))}</div>
            </div>
            <span className="badge">{t("editor.settings")}</span>
          </div>
          <StepList steps={flow.steps} parentId={null} slot="steps" flow={flow} setSteps={setSteps} selected={selected} setSelected={setSelected} activeStep={activeStep} lintBy={lintBy} onAdd={add} onDelete={remove} isCollapsed={isCollapsed} onToggleCollapse={toggleCollapse} onToggleDisabled={(id) => toggleFlag(id, "disabled")} />
          <div className="connector" />
          <div className="node end">{t("editor.end")}</div>
          {lint.length > 0 && (
            <div className="card" style={{ marginTop: 24 }}>
              <h3 style={{ marginBottom: 10 }}><Icon name="Bug" size={15} /> {t("editor.problems", { n: lint.length })}</h3>
              <div className="lint-list">
                {lint.map((l, i) => {
                  const body = (
                    <>
                      <span className={`badge ${l.severity === "error" ? "err" : l.severity === "warning" ? "warn" : "primary"}`}>{t(`lint.sev.${l.severity}`)}</span>
                      <span>{t(l.key, l.params as Record<string, string | number>)}</span>
                    </>
                  );
                  // A real button when it leads to a step (keyboard reachable); flow-level findings are plain text.
                  return l.stepId ? (
                    <button key={i} type="button" className={`lint-item ${l.severity}`} onClick={() => reveal(l.stepId!)}>{body}</button>
                  ) : (
                    <div key={i} className={`lint-item ${l.severity}`} style={{ cursor: "default" }}>{body}</div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* On phones the inspector is a bottom sheet that opens only while something is selected (see app.css). */}
      <aside className={`inspector${selected ? " open" : ""}`} aria-label={t("editor.inspector")}>
        {selected === "__flow" || !sel ? (
          <>
            <div className="inspector-head">
              <b>{t("editor.settings")}</b>
              <button className="btn ghost icon sm" onClick={() => setSelected(null)} aria-label={t("common.close")}><Icon name="X" size={16} /></button>
            </div>
            <FlowSettings flow={flow} onChange={onChange} />
          </>
        ) : (
          <StepForm
            key={sel.id}
            step={sel}
            flow={flow}
            issues={lintBy.get(sel.id) ?? []}
            onChange={(s) => setSteps(updateStep(flow.steps, sel.id, () => s))}
            onDelete={() => remove(sel.id)}
            onDuplicate={() => duplicate(sel)}
            onClose={() => setSelected(null)}
            onMove={(dir) => move(sel.id, dir)}
            position={positionOf(flow.steps, sel.id)}
            onWrap={(kind) => wrap(sel.id, kind)}
            onRun={(mode) => onRunPartial(sel.id, mode)}
            onShortcuts={onShortcuts}
          />
        )}
      </aside>
    </div>
  );
}

/** False when `step` (or anything nested in it) has an id that is already in `root`: re-inserting it would duplicate ids. */
export function canReinsert(root: Step[], step: Step): boolean {
  if (findStep(root, step.id)) return false;
  return childLists(step).every((list) => list.every((c) => canReinsert(root, c)));
}

function afterLoc(root: Step[], id: string): Location {
  const loc = locate(root, id);
  return loc ? { ...loc, index: loc.index + 1 } : { parentId: null, slot: "steps", index: root.length };
}

/** Where a step sits among its siblings (drives the Move up / Move down buttons). */
function positionOf(root: Step[], id: string): { first: boolean; last: boolean } {
  const loc = locate(root, id);
  if (!loc) return { first: true, last: true };
  return { first: loc.index === 0, last: loc.index >= siblingsAt(root, loc).length - 1 };
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
  onDelete: (id: string) => void;
  isCollapsed: (s: Step) => boolean;
  onToggleCollapse: (s: Step) => void;
  onToggleDisabled: (id: string) => void;
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
      <div
        className={`drop-empty${over ? " drop" : ""}`}
        {...handlers}
        role="button"
        tabIndex={0}
        aria-label={t("editor.addStep")}
        onClick={() => setMenu(true)}
        onKeyDown={(e) => {
          // Only the zone itself: keys typed in the open menu's search box bubble up through here.
          if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
          e.preventDefault();
          setMenu(true);
        }}
      >
        {label}
        {menu && <QuickAdd onPick={(ty) => { onAdd(ty, loc); setMenu(false); }} onClose={() => setMenu(false)} />}
      </div>
    );
  }
  return (
    <div className={`connector${over ? " drop" : ""}`} {...handlers} style={{ position: "relative" }}>
      <button className="add" onClick={() => setMenu((v) => !v)} aria-label={t("editor.addStep")} aria-expanded={menu}>
        <Icon name="Plus" size={14} />
      </button>
      {menu && <QuickAdd onPick={(ty) => { onAdd(ty, loc); setMenu(false); }} onClose={() => setMenu(false)} />}
    </div>
  );
}

const QUICK_TYPES: Step["type"][] = ["click", "key", "type", "wait", "if", "loop", "setVar", "notify", "drag", "scroll", "launchApp", "stop"];

/**
 * Add-step menu of a connector. On phones the palette is hidden, so this is the only way to add a
 * step there: a search box and the whole catalogue (the 12 everyday types first, then by category).
 */
function QuickAdd({ onPick, onClose }: { onPick: (t: Step["type"]) => void; onClose: () => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const c = () => onClose();
    window.addEventListener("keydown", h);
    const timer = setTimeout(() => window.addEventListener("click", c), 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", h);
      window.removeEventListener("click", c);
    };
  }, [onClose]);
  const needle = q.trim().toLowerCase();
  const matches = (m: (typeof STEP_META)[number]) => !needle || t(`step.${m.type}`).toLowerCase().includes(needle) || m.type.toLowerCase().includes(needle);
  const sections: { key: string; title?: string; items: typeof STEP_META }[] = [
    // While searching, the shortlist would only repeat the category results.
    ...(needle ? [] : [{ key: "quick", items: QUICK_TYPES.map((ty) => STEP_BY_TYPE[ty]) }]),
    ...STEP_CATEGORIES.map((cat) => ({ key: cat, title: t(`stepcat.${cat}`), items: STEP_META.filter((m) => m.category === cat && matches(m)) })),
  ].filter((s) => s.items.length > 0);
  const first = sections[0]?.items[0];
  // A touch keyboard covering half the screen right away gets in the way; with a real keyboard, type to filter.
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  return (
    <div className="card quick-add" role="dialog" aria-label={t("editor.addStep")} onClick={(e) => e.stopPropagation()}>
      <div className="input-group">
        <Icon name="Search" size={15} />
        <input
          className="input"
          autoFocus={!coarse}
          placeholder={t("editor.searchSteps")}
          aria-label={t("editor.searchSteps")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            // Enter that confirms an IME composition (Korean, Japanese…) must not pick a step.
            if (isImeKey(e)) return;
            if (e.key !== "Enter" || !first) return;
            e.preventDefault();
            onPick(first.type);
          }}
        />
      </div>
      <div className="quick-add-list">
        {sections.map((s) => (
          <div key={s.key}>
            {s.title && <h4>{s.title}</h4>}
            <div className="quick-add-grid">
              {s.items.map((m) => {
                const cap = STEP_CAPABILITIES[m.type][platform];
                return (
                  <button key={m.type} type="button" className={`palette-item${cap.support === "unsupported" ? " unsupported" : ""}`} onClick={() => onPick(m.type)} title={t(`step.${m.type}.desc`)}>
                    <span className="ic" style={{ color: m.color }}>
                      <Icon name={m.icon} size={14} />
                    </span>
                    <b>{t(`step.${m.type}`)}</b>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {sections.length === 0 && <p className="small muted">{t("common.noResults")}</p>}
      </div>
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
          data-step-id={step.id}
          aria-pressed={p.selected === step.id}
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
  const container = isContainer(step);
  const collapsed = container && p.isCollapsed(step);
  const title = step.label ?? t(`step.${step.type}`);
  const desc = tp(describeStep(step));
  return (
    <div>
      <div
        className={cls}
        data-step-id={step.id}
        role="button"
        aria-selected={p.selected === step.id}
        aria-label={`${title}: ${desc}${step.disabled ? ` (${t("editor.disabledStep")})` : ""}`}
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
        onKeyDown={(e) => {
          // Only the node itself: Enter / Space on its inner buttons must press those buttons.
          if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
          e.preventDefault();
          p.setSelected(step.id);
        }}
      >
        {container && (
          <button
            className="btn ghost icon sm fold"
            aria-expanded={!collapsed}
            aria-label={collapsed ? t("editor.expand") : t("editor.collapse")}
            title={collapsed ? t("editor.expand") : t("editor.collapse")}
            onClick={(e) => { e.stopPropagation(); p.onToggleCollapse(step); }}
          >
            <Icon name={collapsed ? "ChevronRight" : "ChevronDown"} size={14} />
          </button>
        )}
        <span className="ic" style={{ background: meta.color }}>
          <Icon name={meta.icon} size={16} />
        </span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="title row" style={{ gap: 6 }}>
            {title}
            {collapsed && <span className="badge" style={{ height: 18 }}>{countNested(step) === 1 ? t("editor.oneStep") : t("editor.nSteps", { n: countNested(step) })}</span>}
            {step.breakpoint && <span className="badge err" style={{ height: 18 }}>●</span>}
            {step.onError && step.onError.strategy !== "stop" && <span className="badge" style={{ height: 18 }}>{t(`onError.${step.onError.strategy}`)}</span>}
            {cap.support !== "supported" && cap.noteKey !== "cap.sandbox" && <span className={`badge ${cap.support === "unsupported" ? "err" : "warn"}`} style={{ height: 18 }} title={cap.noteKey ? t(cap.noteKey) : undefined}>{t(`cap.${cap.support}`)}</span>}
          </div>
          <div className="desc">{desc}</div>
          {issues.length > 0 && <div className="small" style={{ color: hasError ? "#f87171" : "#fbbf24", marginTop: 4 }}>{t(issues[0]!.key, issues[0]!.params as Record<string, string | number>)}</div>}
        </div>
        <div className="tools">
          {/* The icon shows what the button does: an open eye brings a skipped step back, a crossed one skips it. */}
          <button className="btn ghost icon sm" title={step.disabled ? t("editor.enable") : t("editor.disable")} aria-label={step.disabled ? t("editor.enable") : t("editor.disable")} onClick={(e) => { e.stopPropagation(); p.onToggleDisabled(step.id); }}>
            <Icon name={step.disabled ? "Eye" : "EyeOff"} size={14} />
          </button>
          <button className="btn ghost icon sm" title={t("common.delete")} aria-label={t("common.delete")} onClick={(e) => { e.stopPropagation(); p.onDelete(step.id); }}>
            <Icon name="Trash2" size={14} />
          </button>
        </div>
      </div>
      {!collapsed && children.map((c) => (
        <div key={c.slot} className="container-body">
          {c.label && <div className="container-label">{c.label}</div>}
          <StepList {...p} steps={c.list} parentId={step.id} slot={c.slot} />
        </div>
      ))}
    </div>
  );
}
