import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Flow } from "@autoflow/core";
import { Shell } from "../components/Shell";
import { Icon } from "../components/Icon";
import { Empty, Seg, download } from "../components/ui";
import { RunStatus } from "./Home";
import { EventRow } from "./Canvas";
import { useStore, type RunRecord } from "../lib/store";
import { confirmDialog } from "../lib/dialog";
import { startFlow } from "../lib/actions";
import { eventLine, foldRun, runLogText, spanStatus, stepLabels, type FoldedRun } from "../lib/runTrace";
import { formatDuration, formatRelative, useT } from "../i18n";

/** Step rows rendered at once; a long loop can produce thousands of spans. */
const MAX_ROWS = 400;

export function LedgerPage() {
  const t = useT();
  const { id } = useParams();
  const navigate = useNavigate();
  const runs = useStore((s) => s.runs);
  const flows = useStore((s) => s.flows);
  const ready = useStore((s) => s.ready);
  const clear = useStore((s) => s.clearRuns);
  const deleteRun = useStore((s) => s.deleteRun);
  const toast = useStore((s) => s.toast);
  const [filter, setFilter] = useState<"all" | "completed" | "stopped" | "failed">("all");
  const [flowId, setFlowId] = useState("");
  // Flows that have runs, named as of their latest run (the flow itself may be renamed or deleted since).
  const ran = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of runs) if (!m.has(r.flowId)) m.set(r.flowId, r.flowName);
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [runs]);
  const list = useMemo(() => runs.filter((r) => (filter === "all" || r.status === filter) && (!flowId || r.flowId === flowId)), [runs, filter, flowId]);
  const run = id ? runs.find((r) => r.id === id) : undefined;

  // /ledger/<id> that no longer resolves (deleted, expired): say so and go back to the list.
  useEffect(() => {
    if (!ready || !id || run) return;
    toast("info", t("common.noResults"));
    navigate("/ledger", { replace: true });
  }, [ready, id, run, navigate, toast, t]);

  if (run) return <RunDetail run={run} flow={flows.find((f) => f.id === run.flowId)} />;

  return (
    <Shell title={<h2>{t("nav.ledger")}</h2>} actions={runs.length ? <button className="btn sm ghost" onClick={async () => (await confirmDialog({ title: t("ledger.clearTitle"), body: t("ledger.clearBody"), tone: "danger", confirmLabel: t("ledger.clear") })) && clear()}><Icon name="Trash2" size={15} /> {t("ledger.clear")}</button> : null}>
      <div className="page">
        <div className="page-head">
          <div>
            <h1>{t("nav.ledger")}</h1>
            <p>{t("ledger.sub")}</p>
          </div>
          <div className="row wrap">
            {ran.length > 1 && (
              <select className="select" style={{ width: "auto", maxWidth: 240 }} value={flowId} onChange={(e) => setFlowId(e.target.value)} aria-label={t("ledger.allFlows")}>
                <option value="">{t("ledger.allFlows")}</option>
                {ran.map(([fid, name]) => <option key={fid} value={fid}>{name}</option>)}
              </select>
            )}
            <Seg value={filter} onChange={setFilter} label={t("ledger.status")} options={[{ value: "all", label: t("flows.all") }, { value: "completed", label: t("run.status.completed") }, { value: "stopped", label: t("run.status.stopped") }, { value: "failed", label: t("run.status.failed") }]} />
          </div>
        </div>
        {list.length === 0 ? (
          <div className="card"><Empty icon="History" title={runs.length ? t("common.noResults") : t("ledger.empty")} body={runs.length ? undefined : t("ledger.emptyBody")} /></div>
        ) : (
          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table className="table">
              <thead><tr><th>{t("ledger.status")}</th><th>{t("flows.col.name")}</th><th>{t("ledger.when")}</th><th>{t("ledger.duration")}</th><th>{t("ledger.actions")}</th><th>{t("ledger.where")}</th><th /></tr></thead>
              <tbody>
                {list.map((r) => {
                  const flow = flows.find((f) => f.id === r.flowId);
                  return (
                    <tr key={r.id} onClick={() => navigate(`/ledger/${r.id}`)} style={{ cursor: "pointer" }}>
                      <td><RunStatus status={r.status} /></td>
                      <td className="truncate" style={{ maxWidth: 280 }}>{r.flowName}{r.error && <div className="small" style={{ color: "#f87171" }}>{r.error.message.slice(0, 80)}</div>}</td>
                      <td className="small muted">{formatRelative(r.startedAt)}</td>
                      <td className="small">{formatDuration(r.durationMs)}</td>
                      <td className="small">{r.actions}</td>
                      <td><span className="badge">{r.where === "canvas" ? t("pulse.canvas") : t(`platform.${r.platform}`)}</span></td>
                      <td>
                        <div className="row end" style={{ gap: 4 }}>
                          {flow && (
                            <button className="btn ghost icon sm" title={t("ledger.runAgain")} aria-label={t("ledger.runAgain")} onClick={(e) => { e.stopPropagation(); void startFlow(flow, navigate); }}>
                              <Icon name="Play" size={14} />
                            </button>
                          )}
                          <button className="btn ghost icon sm" title={t("ledger.deleteRun")} aria-label={t("ledger.deleteRun")} onClick={(e) => { e.stopPropagation(); void deleteRun(r.id); }}>
                            <Icon name="Trash2" size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  );
}

function RunDetail({ run, flow }: { run: RunRecord; flow?: Flow }) {
  const t = useT();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"steps" | "log">("steps");
  const [q, setQ] = useState("");
  const t0 = run.events[0]?.at ?? 0;
  const labels = useMemo(() => stepLabels(flow), [flow]);
  const folded = useMemo(() => foldRun(run.events), [run.events]);
  // Successful step ends have no row of their own (see EventRow), so they are not search hits either.
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return run.events.filter((e) => !(e.type === "stepEnd" && e.ok) && (!needle || eventLine(e, labels).toLowerCase().includes(needle)));
  }, [run.events, labels, q]);
  const safe = run.flowName.replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 40) || "run";
  // ?step= makes the Pro editor select and reveal that step (ProEditor `revealStep`); Easy mode ignores it.
  const openStep = (stepId?: string) => flow && navigate(stepId ? `/flows/${flow.id}?step=${encodeURIComponent(stepId)}` : `/flows/${flow.id}`);
  return (
    <Shell
      title={<div className="row"><button className="btn ghost icon sm" onClick={() => navigate("/ledger")} aria-label={t("common.back")}><Icon name="ArrowLeft" size={16} /></button><h2 className="truncate">{run.flowName}</h2></div>}
      actions={
        <div className="row">
          {flow && <button className="btn sm primary" onClick={() => void startFlow(flow, navigate)}><Icon name="Play" size={15} /> {t("ledger.runAgain")}</button>}
          {flow && <button className="btn sm" onClick={() => openStep()}><Icon name="Pen" size={15} /> {t("ledger.fix")}</button>}
          <button className="btn sm ghost" onClick={() => download(`run-${safe}-${run.id}.txt`, runLogText(run, labels), "text/plain")}><Icon name="FileText" size={15} /> {t("ledger.exportLog")}</button>
          <button className="btn sm ghost" onClick={() => download(`run-${safe}-${run.id}.json`, JSON.stringify(run, null, 2))}><Icon name="Download" size={15} /> {t("ledger.export")}</button>
        </div>
      }
    >
      <div className="page">
        <div className="grid cols-4">
          <div className="card"><div className="small muted">{t("ledger.status")}</div><RunStatus status={run.status} /></div>
          <div className="card"><div className="small muted">{t("ledger.duration")}</div><b>{formatDuration(run.durationMs)}</b></div>
          <div className="card"><div className="small muted">{t("ledger.when")}</div><b>{formatRelative(run.startedAt)}</b></div>
          <div className="card"><div className="small muted">{t("ledger.where")}</div><b>{run.where === "canvas" ? t("pulse.canvas") : t(`platform.${run.platform}`)}</b></div>
          <div className="card"><div className="small muted">{t("ledger.actions")}</div><b>{run.actions}</b></div>
          <div className="card"><div className="small muted">{t("stage.hud.rounds")}</div><b>{run.iterations}</b></div>
          {/* Older records have no step counter: count the step starts that are still in the log. */}
          <div className="card"><div className="small muted">{t("ledger.steps")}</div><b>{run.steps ?? `${run.dropped ? "≥ " : ""}${folded.spans.length}`}</b></div>
          <div className="card"><div className="small muted">{t("ledger.retries")}</div><b>{folded.retries}</b>{folded.timeouts > 0 && <span className="badge warn" style={{ marginLeft: 8 }}>{t("errcat.timeout")} · {folded.timeouts}</span>}</div>
        </div>
        {!flow && <div className="callout small"><Icon name="Info" size={16} /> {t("ledger.flowGone")}</div>}
        {!!run.dropped && <div className="callout warn small"><Icon name="Info" size={16} /> {t("ledger.dropped", { n: run.dropped })}</div>}
        {run.error && (
          <div className="callout err">
            <Icon name="OctagonX" />
            <div className="stack-sm">
              <b>{t(`errcat.${run.error.category}`)}</b>
              <span>{run.error.message}</span>
              {run.error.stepId && <span className="small muted">{t("ledger.atStep", { id: labels.get(run.error.stepId) ?? run.error.stepId })}</span>}
              <div className="small">{t(`errhelp.${run.error.category}`)}</div>
              {flow && (
                <div className="row">
                  <button className="btn sm" onClick={() => openStep(run.error?.stepId)}><Icon name="Pen" size={14} /> {t("ledger.fix")}</button>
                  <button className="btn sm ghost" onClick={() => navigate(`/canvas?flow=${flow.id}`)}><Icon name="Target" size={14} /> {t("editor.practice")}</button>
                </div>
              )}
            </div>
          </div>
        )}
        <Slowest folded={folded} labels={labels} onOpen={flow ? openStep : undefined} />
        <div className="card stack-sm">
          <div className="row wrap between">
            <h3>{t("ledger.timeline")}</h3>
            <div className="row wrap">
              {tab === "log" && (
                <div className="input-group" style={{ width: 240 }}>
                  <Icon name="Search" size={15} />
                  <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ledger.search")} aria-label={t("ledger.search")} />
                </div>
              )}
              <Seg value={tab} onChange={setTab} label={t("ledger.timeline")} options={[{ value: "steps", label: t("ledger.tab.steps"), icon: "ListOrdered" }, { value: "log", label: t("ledger.tab.log"), icon: "ScrollText" }]} />
            </div>
          </div>
          {tab === "steps" ? (
            <StepTrace folded={folded} labels={labels} t0={t0} onOpen={flow ? openStep : undefined} />
          ) : (
            <div className="stack-xs" style={{ maxHeight: 520, overflowY: "auto" }}>
              {shown.length === 0 && <p className="small muted">{t("common.noResults")}</p>}
              {shown.map((e, i) => <EventRow key={i} e={e} t0={t0} flow={flow} />)}
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}

/** Where the time went: the five steps with the most own time (containers without their children). */
function Slowest({ folded, labels, onOpen }: { folded: FoldedRun; labels: Map<string, string>; onOpen?: (stepId: string) => void }) {
  const t = useT();
  const top = folded.slowest.filter((s) => s.selfMs > 0).slice(0, 5);
  if (top.length < 2) return null; // a one-step run has no ranking to show
  const max = top[0]!.selfMs;
  return (
    <div className="card stack-sm">
      <h3>{t("ledger.slowest")}</h3>
      <div className="stack-xs">
        {top.map((s) => (
          <div key={s.stepId} className="slow-step">
            <button className="btn ghost sm truncate" style={{ justifyContent: "flex-start" }} disabled={!onOpen} onClick={() => onOpen?.(s.stepId)} title={onOpen ? t("ledger.fix") : undefined}>
              <span className="truncate">{t(`step.${s.stepType}`)}{labels.has(s.stepId) ? ` · ${labels.get(s.stepId)}` : ""}</span>
            </button>
            <div className="bar" aria-hidden="true"><span style={{ width: `${Math.max(2, Math.round((s.selfMs / max) * 100))}%` }} /></div>
            <span className="small mono">{formatDuration(Math.round(s.selfMs))}</span>
            <span className="small muted">×{s.runs}</span>
            <span className="row" style={{ gap: 4 }}>
              {s.retries > 0 && <span className="badge warn">↻ {s.retries}</span>}
              {s.failures > 0 && <span className="badge err">✕ {s.failures}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The run as nested step spans: one row per executed step with duration, status and retries. */
function StepTrace({ folded, labels, t0, onOpen }: { folded: FoldedRun; labels: Map<string, string>; t0: number; onOpen?: (stepId: string) => void }) {
  const t = useT();
  const spans = folded.spans;
  if (!spans.length) return <p className="small muted">{t("common.noResults")}</p>;
  // A long run is shown from its end: that is where it stopped or failed.
  const rows = spans.length > MAX_ROWS ? spans.slice(-MAX_ROWS) : spans;
  const hidden = spans.length - rows.length + folded.trace.dropped;
  return (
    <div className="stack-xs" style={{ maxHeight: 520, overflowY: "auto" }}>
      {hidden > 0 && <p className="small muted">{t("ledger.moreSpans", { n: hidden })}</p>}
      {rows.map((s) => {
        const status = spanStatus(s);
        const bad = status === "failed" || status === "timeout";
        return (
          <div key={s.index} className={`event span${bad ? " err" : status === "interrupted" || s.retries.length ? " warn" : ""}`}>
            <time>+{((s.start - t0) / 1000).toFixed(2)}s</time>
            <div className="row wrap" style={{ gap: 6, paddingLeft: Math.min(s.depth, 8) * 14, minWidth: 0 }}>
              <span style={{ overflowWrap: "anywhere" }}>{t(`step.${s.stepType}`)}{labels.has(s.stepId) ? ` · ${labels.get(s.stepId)}` : ""}</span>
              {s.durationMs !== undefined && <span className="small muted mono">{formatDuration(Math.round(s.durationMs))}</span>}
              {status === "ok" ? <Icon name="Check" size={13} /> : <span className={`badge ${bad ? "err" : "warn"}`}>{status === "failed" ? t("run.status.failed") : status === "timeout" ? t("errcat.timeout") : status === "interrupted" ? t("ledger.span.interrupted") : t("run.status.running")}</span>}
              {s.attempts > 1 && <span className="badge warn">{t("ledger.span.attempts", { n: s.attempts })}</span>}
              {s.error && <span className="small" style={{ overflowWrap: "anywhere" }}>{s.error.message}</span>}
              {bad && onOpen && <button className="btn ghost sm" onClick={() => onOpen(s.stepId)}><Icon name="Pen" size={13} /> {t("ledger.fix")}</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
