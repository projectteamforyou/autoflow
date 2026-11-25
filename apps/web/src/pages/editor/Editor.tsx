import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { FlowRun, countSteps, explainFlow, lintFlow, parseFlow, toEasy, type Flow } from "@autoflow/core";
import { Shell } from "../../components/Shell";
import { Icon, FLOW_ICON_CHOICES } from "../../components/Icon";
import { Modal, SafetyBadge, Seg } from "../../components/ui";
import { useStore, type Version } from "../../lib/store";
import { confirmDialog } from "../../lib/dialog";
import { exportToFile, shareLink, startFlow } from "../../lib/actions";
import { formatRelative, tp, useT } from "../../i18n";
import { platform } from "../../platform";
import { canRedo, canUndo, createHistory, editKind, record, redo as redoHistory, undo as undoHistory, type History } from "../../lib/history";
import { partialFlow, type PartialMode } from "../../lib/partialRun";
import { EasyEditor } from "./EasyEditor";
import { ProEditor } from "./ProEditor";
import { ShortcutsSheet, isTypingTarget } from "./Shortcuts";
import { openModalCount } from "../../lib/modalStack";

/**
 * One editor instance per flow. Going from /flows/A to /flows/B (command palette, Pulse bar pen,
 * Secrets links) keeps the route element mounted, so without the key A's session state would leak
 * into B: undo history, "Not saved", selection, the version-snapshot flag, a pending save.
 * Unmounting A runs its cleanup, which flushes a pending save.
 */
export function EditorPage() {
  const { id } = useParams();
  return <EditorInner key={id} />;
}

function EditorInner() {
  const { id } = useParams();
  // /flows/<id>?step=<stepId> (Ledger "failed step", Pulse bar): the Pro editor selects and reveals that step.
  const [query] = useSearchParams();
  const stepParam = query.get("step");
  const t = useT();
  const navigate = useNavigate();
  const stored = useStore((s) => s.flows.find((f) => f.id === id));
  const ready = useStore((s) => s.ready);
  const save = useStore((s) => s.saveFlow);
  const [flow, setFlow] = useState<Flow | undefined>(stored);
  const [dirty, setDirty] = useState(false);
  // Why the last save was refused (the schema rejected the flow); the edit stays in memory and the next edit retries.
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveFailing = useRef(false);
  const [panel, setPanel] = useState<null | "explain" | "versions" | "json" | "icon" | "shortcuts">(null);
  // True once this session has put a version snapshot of the pre-session steps into the history.
  const sessionSnap = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  // Latest edit + dirty flag, so leaving the page inside the debounce window still saves it.
  const flowRef = useRef<Flow | undefined>(flow);
  const dirtyRef = useRef(false);
  // The undo stack needs the state an edit replaces, also when the flow arrived after mount.
  flowRef.current = flow;
  // Undo / redo for this editor session (lib/history.ts). Kept in a ref so `update` stays stable;
  // `hist` mirrors what the two top-bar buttons need.
  const history = useRef<History<Flow>>(createHistory());
  const [hist, setHist] = useState({ undo: false, redo: false });
  const setHistory = useCallback((h: History<Flow>) => {
    history.current = h;
    setHist((cur) => (cur.undo === canUndo(h) && cur.redo === canRedo(h) ? cur : { undo: canUndo(h), redo: canRedo(h) }));
  }, []);

  useEffect(() => {
    if (stored && (!flow || stored.id !== flow.id)) {
      setFlow(stored);
      // Another flow: its history must not be undone into this one.
      setHistory(createHistory());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored?.id]);

  /**
   * Saves the flow. Never rejects: a flow the schema refuses stays in memory (still dirty, so the next
   * edit and leaving the page try again), the bar shows "Not saved: …" and a toast appears once per
   * failing streak — or every time when the save was asked for explicitly (`loud`: Ctrl+S, Run).
   */
  const persist = useCallback(
    async (f: Flow, loud: boolean | "leaving" = false): Promise<Flow | null> => {
      dirtyRef.current = false;
      try {
        // The store snapshots only when the steps differ from the stored flow (saveFlow). A save that
        // changed nothing but the name, or a Run, must not use up this session's one snapshot.
        const before = sessionSnap.current ? undefined : useStore.getState().flows.find((x) => x.id === f.id);
        const saved = await save(f, { snapshot: !sessionSnap.current });
        if (before && JSON.stringify(before.steps) !== JSON.stringify(saved.steps)) sessionSnap.current = true;
        saveFailing.current = false;
        setSaveError(null);
        // A newer edit made while this save was running is still waiting for its own save.
        if (!dirtyRef.current) setDirty(false);
        return saved;
      } catch (e) {
        // Only when no newer edit is already queued: that one will report its own result.
        if (flowRef.current === f) dirtyRef.current = true;
        const issue = saveIssue(e);
        setSaveError(issue);
        // Leaving the editor: the edits are gone with it, so say which flow lost them — and keep the toast until it is read.
        if (loud === "leaving") useStore.getState().toast("warning", t("editor.leftUnsaved", { name: f.name.trim() || "?", issue }), { label: t("common.ok"), run: () => undefined });
        else if (loud || !saveFailing.current) useStore.getState().toast("error", t("editor.notSavedToast", { issue }));
        saveFailing.current = true;
        return null;
      }
    },
    [save, t],
  );

  /** Shows `next` and schedules the save — without touching the undo stack (undo, redo and restore use it directly). */
  const commit = useCallback(
    (next: Flow) => {
      setFlow(next);
      setDirty(true);
      flowRef.current = next;
      dirtyRef.current = true;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void persist(next), 700);
    },
    [persist],
  );

  /**
   * Every edit goes through here: remembers the state it replaces, then commits.
   * `own: true` gives the edit an undo entry of its own (restoring a version), never merged into a burst.
   */
  const update = useCallback(
    (next: Flow, opts: { own?: boolean } = {}) => {
      const prev = flowRef.current;
      if (prev && prev !== next) {
        // The Easy editor rebuilds the steps (new ids) on every change: there the burst is recognised by time alone.
        const easy = prev.mode === "easy" && next.mode === "easy" && toEasy(prev) !== null;
        setHistory(record(history.current, prev, opts.own ? null : editKind(prev, next, easy), Date.now()));
      }
      commit(next);
    },
    [commit, setHistory],
  );

  const undo = useCallback(() => {
    const cur = flowRef.current;
    const r = cur && undoHistory(history.current, cur);
    if (!r) return;
    setHistory(r.history);
    commit(r.value);
  }, [commit, setHistory]);

  const redo = useCallback(() => {
    const cur = flowRef.current;
    const r = cur && redoHistory(history.current, cur);
    if (!r) return;
    setHistory(r.history);
    commit(r.value);
  }, [commit, setHistory]);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      // Flush the edit that is still inside the debounce window. In the "Not saved" state this is one
      // more attempt; if it is refused again the edits are lost with the editor, and a toast says so.
      if (dirtyRef.current && flowRef.current) void persist(flowRef.current, "leaving");
    },
    [persist],
  );

  /**
   * Back / Practice: with a refused save the edits exist only in this editor. Tries once more, then
   * asks before leaving. Resolves true when it is fine to go.
   */
  const mayLeave = useCallback(async (): Promise<boolean> => {
    const f = flowRef.current;
    if (!f || (!dirtyRef.current && !saveFailing.current)) return true;
    clearTimeout(timer.current);
    if (await persist(f)) return true;
    const ok = await confirmDialog({ title: t("editor.leaveUnsaved.title"), body: t("editor.leaveUnsaved.body", { name: f.name.trim() || "?" }), tone: "warning", confirmLabel: t("editor.leaveUnsaved.leave"), cancelLabel: t("editor.leaveUnsaved.stay") });
    // Confirmed: the unmount must not try again and warn a second time.
    if (ok) dirtyRef.current = false;
    return ok;
  }, [persist, t]);

  const lint = useMemo(() => (flow ? lintFlow(flow, { knownFlowIds: useStore.getState().flows.map((f) => f.id) }) : []), [flow]);
  const easyOk = useMemo(() => (flow ? toEasy(flow) !== null : false), [flow]);
  const blocked = useMemo(() => (flow ? FlowRun.preflight(flow, platform === "web" ? "web" : platform).blocked : []), [flow]);
  const hasErrors = lint.some((l) => l.severity === "error");

  const run = useCallback(async () => {
    if (!flow || hasErrors) return;
    clearTimeout(timer.current);
    const saved = await persist(flow, true);
    if (saved) await startFlow(saved, navigate);
  }, [flow, hasErrors, persist, navigate]);

  /** "Run from here" / "Run only this step": a temporary flow with the other steps disabled — never saved. */
  const runPartial = useCallback(
    async (stepId: string, mode: PartialMode) => {
      if (!flow) return;
      if (hasErrors) return useStore.getState().toast("error", t("editor.fixErrors"));
      const temp = partialFlow(flow, stepId, mode);
      if (temp) await startFlow(temp, navigate, { transient: true });
    },
    [flow, hasErrors, navigate, t],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!flow) return;
      const typing = isTypingTarget(e.target);
      // Any open dialog (this editor's panels, confirm / prompt dialogs, step pickers) owns the keyboard.
      const modal = panel !== null || openModalCount() > 0;
      if (e.key === "?" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && !modal) {
        e.preventDefault();
        setPanel("shortcuts");
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      // Undo / redo: in a text field the browser's own text undo wins; behind an open dialog nothing happens.
      if ((k === "z" || k === "y") && !e.altKey) {
        if (typing || modal) return;
        e.preventDefault();
        if (k === "y" || e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        clearTimeout(timer.current);
        void persist(flow, true).then((saved) => saved && useStore.getState().toast("success", t("editor.saved")));
      } else if (e.key === "Enter") {
        e.preventDefault();
        void run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flow, persist, run, t, panel, undo, redo]);

  if (!ready) return null;
  if (!flow) {
    return (
      <Shell title={<h2>{t("editor.notFound")}</h2>}>
        <div className="page">
          <button className="btn" onClick={() => navigate("/flows")}><Icon name="ArrowLeft" size={16} /> {t("nav.flows")}</button>
        </div>
      </Shell>
    );
  }

  const errors = lint.filter((l) => l.severity === "error").length;
  const warnings = lint.filter((l) => l.severity === "warning").length;

  return (
    <Shell
      flush
      title={
        <div className="editor-bar grow">
          <button className="btn ghost icon sm" onClick={() => void mayLeave().then((ok) => ok && navigate(-1))} aria-label={t("common.back")}><Icon name="ArrowLeft" size={16} /></button>
          <button className="tile-icon" style={{ width: 32, height: 32, border: 0, cursor: "pointer", background: `linear-gradient(135deg, ${flow.color}, ${flow.color}99)` }} onClick={() => setPanel("icon")} aria-label={t("editor.icon")}>
            <Icon name={flow.icon} size={16} />
          </button>
          <input className="name" value={flow.name} onChange={(e) => update({ ...flow, name: e.target.value.slice(0, 120) || " " })} aria-label={t("editor.name")} />
          {saveError ? (
            <span className="small truncate save-error" role="status" title={t("editor.notSaved", { issue: saveError })}>{t("editor.notSaved", { issue: saveError })}</span>
          ) : (
            <span className="small subtle">{dirty ? t("editor.saving") : t("editor.savedShort")}</span>
          )}
          <Seg
            value={flow.mode}
            label={t("editor.mode")}
            onChange={async (m) => {
              if (m === "easy" && !easyOk) {
                const ok = await confirmDialog({ title: t("editor.easyBlockedTitle"), body: t("editor.easyBlockedBody"), confirmLabel: t("editor.keepPro") });
                void ok;
                return;
              }
              update({ ...flow, mode: m });
            }}
            options={[{ value: "easy", label: t("mode.easy"), icon: "Sparkles" }, { value: "pro", label: t("mode.pro"), icon: "Workflow" }]}
          />
          {!easyOk && flow.mode === "pro" && <span className="badge primary" title={t("editor.advancedHint")}>{t("editor.advanced")}</span>}
        </div>
      }
      actions={
        <div className="row">
          <button className="btn sm ghost" disabled={!hist.undo} onClick={undo} title={`${t("common.undo")} (Ctrl+Z)`} aria-label={t("common.undo")}><Icon name="Undo2" size={15} /></button>
          <button className="btn sm ghost" disabled={!hist.redo} onClick={redo} title={`${t("common.redo")} (Ctrl+Shift+Z)`} aria-label={t("common.redo")}><Icon name="Redo2" size={15} /></button>
          <SafetyBadge flow={flow} />
          {(errors > 0 || warnings > 0) && <span className={`badge ${errors ? "err" : "warn"}`}><Icon name="Bug" size={13} /> {errors + warnings}</span>}
          <button className="btn sm ghost" onClick={() => setPanel("explain")} title={t("editor.explain")}><Icon name="BookOpen" size={15} /></button>
          <button className="btn sm ghost" onClick={() => setPanel("versions")} title={t("editor.versions")}><Icon name="History" size={15} /></button>
          <button className="btn sm ghost" onClick={() => setPanel("json")} title="JSON"><Icon name="FileJson" size={15} /></button>
          <button className="btn sm ghost" onClick={() => void shareLink(flow)} title={t("flows.share")}><Icon name="Share2" size={15} /></button>
          <button className="btn sm ghost" onClick={() => void exportToFile(flow)} title={t("flows.export")}><Icon name="Download" size={15} /></button>
          <button className="btn sm ghost" onClick={() => setPanel("shortcuts")} title={`${t("shortcuts.title")} (?)`} aria-label={t("shortcuts.title")}><Icon name="Keyboard" size={15} /></button>
          <button className="btn sm" onClick={() => void mayLeave().then((ok) => ok && navigate(`/canvas?flow=${flow.id}`))}><Icon name="Target" size={15} /> {t("editor.practice")}</button>
          <button
            className="btn sm primary"
            disabled={errors > 0}
            title={errors ? t("editor.fixErrors") : blocked.length ? t("run.unsupported", { n: blocked.length }) : undefined}
            onClick={() => void run()}
          >
            <Icon name="Play" size={15} /> {t("flows.run")}
          </button>
        </div>
      }
    >
      {flow.mode === "easy" && easyOk ? <EasyEditor flow={flow} onChange={update} /> : <ProEditor flow={flow} onChange={update} lint={lint} revealStep={stepParam} onRunPartial={(id, mode) => void runPartial(id, mode)} onShortcuts={() => setPanel("shortcuts")} />}
      {panel === "explain" && <ExplainPanel flow={flow} onClose={() => setPanel(null)} />}
      {panel === "versions" && <VersionsPanel flow={flow} onRestore={(v) => { sessionSnap.current = false; update({ ...v.flow, id: flow.id, revision: flow.revision }, { own: true }); setPanel(null); }} onClose={() => setPanel(null)} />}
      {panel === "json" && <JsonPanel flow={flow} onApply={(f) => { update(f); setPanel(null); }} onClose={() => setPanel(null)} />}
      {panel === "icon" && <IconPanel flow={flow} onChange={update} onClose={() => setPanel(null)} />}
      {panel === "shortcuts" && <ShortcutsSheet pro={!(flow.mode === "easy" && easyOk)} onClose={() => setPanel(null)} />}
    </Shell>
  );
}

/** First problem of a refused save, short enough for the editor bar: "steps.2.url: Invalid url". */
function saveIssue(e: unknown): string {
  const first = (e as { issues?: { path?: (string | number)[]; message?: string }[] } | null)?.issues?.[0];
  if (first?.message) return `${first.path?.length ? `${first.path.join(".")}: ` : ""}${first.message}`.slice(0, 200);
  return (e instanceof Error ? e.message : String(e)).slice(0, 200);
}

function ExplainPanel({ flow, onClose }: { flow: Flow; onClose: () => void }) {
  const t = useT();
  const lines = explainFlow(flow);
  return (
    <Modal wide title={t("editor.explain")} icon="BookOpen" onClose={onClose}>
      <p className="muted small">{t("editor.explainHint")}</p>
      <ol className="stack-xs" style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
        {lines.map((l, i) => (
          <li key={i} style={{ paddingLeft: l.depth * 18, borderLeft: l.depth ? "2px solid var(--af-border)" : undefined }}>
            {tp(l.phrase)}
          </li>
        ))}
      </ol>
    </Modal>
  );
}

function VersionsPanel({ flow, onRestore, onClose }: { flow: Flow; onRestore: (v: Version) => void; onClose: () => void }) {
  const t = useT();
  const versions = useStore((s) => s.versions);
  const [list, setList] = useState<Version[] | null>(null);
  const [diff, setDiff] = useState<Version | null>(null);
  useEffect(() => void versions(flow.id).then(setList), [flow.id, versions]);
  return (
    <Modal wide title={t("editor.versions")} icon="History" onClose={onClose}>
      {!list ? (
        <p className="muted">{t("common.loading")}</p>
      ) : list.length === 0 ? (
        <p className="muted">{t("editor.noVersions")}</p>
      ) : (
        <div className="stack-sm">
          {list.map((v) => (
            <div key={v.key} className="row card" style={{ padding: 12 }}>
              <Icon name="History" size={16} />
              <div className="grow">
                <b>{t("editor.revision", { n: v.revision })}</b> <span className="small muted">· {formatRelative(v.at)} · {t("editor.stepCount", { n: countSteps(v.flow.steps) })}</span>
                {v.note && <span className="badge" style={{ marginLeft: 6 }}>{v.note}</span>}
              </div>
              <button className="btn sm ghost" onClick={() => setDiff(diff?.key === v.key ? null : v)}>{t("editor.diff")}</button>
              <button className="btn sm" onClick={() => onRestore(v)}><Icon name="RotateCcw" size={14} /> {t("editor.restore")}</button>
            </div>
          ))}
          {diff && <DiffView a={diff.flow} b={flow} />}
        </div>
      )}
    </Modal>
  );
}

/** Minimal line diff (LCS) of pretty JSON — enough to see what changed between versions. */
function DiffView({ a, b }: { a: Flow; b: Flow }) {
  const t = useT();
  const strip = (f: Flow) => JSON.stringify({ ...f, updatedAt: undefined, revision: undefined, createdAt: undefined }, null, 2).split("\n");
  const A = strip(a);
  const B = strip(b);
  const n = A.length;
  const m = B.length;
  if (n * m > 4_000_000) return <p className="muted small">{t("editor.diffTooLarge")}</p>;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = A[i] === B[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: { k: " " | "-" | "+"; s: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ k: " ", s: A[i]! }); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) out.push({ k: "-", s: A[i++]! });
    else out.push({ k: "+", s: B[j++]! });
  }
  while (i < n) out.push({ k: "-", s: A[i++]! });
  while (j < m) out.push({ k: "+", s: B[j++]! });
  const changed = out.map((l, idx) => (l.k !== " " ? idx : -1)).filter((x) => x >= 0);
  const show = new Set<number>();
  for (const c of changed) for (let d = -2; d <= 2; d++) show.add(c + d);
  return (
    <pre className="card mono small" style={{ maxHeight: 360, overflow: "auto", margin: 0, background: "var(--af-bg-2)" }}>
      {out.map((l, idx) =>
        show.has(idx) ? (
          <div key={idx} style={{ color: l.k === "+" ? "#4ade80" : l.k === "-" ? "#f87171" : undefined }}>
            {l.k} {l.s}
          </div>
        ) : null,
      )}
      {changed.length === 0 && t("editor.diffNone")}
    </pre>
  );
}

function JsonPanel({ flow, onApply, onClose }: { flow: Flow; onApply: (f: Flow) => void; onClose: () => void }) {
  const t = useT();
  const [text, setText] = useState(() => JSON.stringify(flow, null, 2));
  const [errors, setErrors] = useState<string[]>([]);
  const apply = () => {
    try {
      const r = parseFlow(JSON.parse(text));
      if (!r.ok) return setErrors(r.issues.slice(0, 6).map((i) => `${i.path || "/"}: ${i.message}`));
      onApply({ ...r.flow, id: flow.id });
    } catch (e) {
      setErrors([(e as Error).message]);
    }
  };
  return (
    <Modal wide title={t("editor.json")} icon="FileJson" onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t("common.cancel")}</button><button className="btn primary" onClick={apply}>{t("editor.applyJson")}</button></>}>
      <p className="small muted">{t("editor.jsonHint")}</p>
      <textarea className="textarea mono" value={text} onChange={(e) => setText(e.target.value)} rows={22} spellCheck={false} aria-label="JSON" />
      {errors.length > 0 && (
        <div className="callout err small">
          <Icon name="Bug" />
          <ul className="bullets">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
    </Modal>
  );
}

const COLORS = ["#7C5CFF", "#22C3A6", "#3B82F6", "#F59E0B", "#EF4444", "#EC4899", "#10B981", "#0EA5E9", "#A855F7", "#64748B"];

function IconPanel({ flow, onChange, onClose }: { flow: Flow; onChange: (f: Flow) => void; onClose: () => void }) {
  const t = useT();
  return (
    <Modal title={t("editor.icon")} icon="Palette" onClose={onClose}>
      <div className="row wrap">
        {FLOW_ICON_CHOICES.map((i) => (
          <button key={i} className={`btn icon${flow.icon === i ? " primary" : ""}`} onClick={() => onChange({ ...flow, icon: i })} aria-label={i}>
            <Icon name={i} size={18} />
          </button>
        ))}
      </div>
      <div className="row wrap">
        {COLORS.map((c) => (
          <button key={c} onClick={() => onChange({ ...flow, color: c })} aria-label={c} style={{ width: 30, height: 30, borderRadius: 10, border: flow.color === c ? "2px solid var(--af-text)" : "1px solid var(--af-border)", background: c, cursor: "pointer" }} />
        ))}
      </div>
    </Modal>
  );
}
