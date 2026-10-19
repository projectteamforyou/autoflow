import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Shell } from "../components/Shell";
import { Icon } from "../components/Icon";
import { Empty, Seg, download } from "../components/ui";
import { RunStatus } from "./Home";
import { EventRow } from "./Canvas";
import { useStore } from "../lib/store";
import { confirmDialog } from "../lib/dialog";
import { formatDuration, formatRelative, useT } from "../i18n";

export function LedgerPage() {
  const t = useT();
  const { id } = useParams();
  const navigate = useNavigate();
  const runs = useStore((s) => s.runs);
  const flows = useStore((s) => s.flows);
  const clear = useStore((s) => s.clearRuns);
  const [filter, setFilter] = useState<"all" | "completed" | "stopped" | "failed">("all");
  const list = useMemo(() => runs.filter((r) => filter === "all" || r.status === filter), [runs, filter]);
  const run = id ? runs.find((r) => r.id === id) : undefined;

  if (run) {
    const flow = flows.find((f) => f.id === run.flowId);
    const t0 = run.events[0]?.at ?? 0;
    return (
      <Shell title={<div className="row"><button className="btn ghost icon sm" onClick={() => navigate("/ledger")} aria-label={t("common.back")}><Icon name="ArrowLeft" size={16} /></button><h2 className="truncate">{run.flowName}</h2></div>}
        actions={<button className="btn sm ghost" onClick={() => download(`run-${run.id}.json`, JSON.stringify(run, null, 2))}><Icon name="Download" size={15} /> {t("ledger.export")}</button>}>
        <div className="page">
          <div className="grid cols-4">
            <div className="card"><div className="small muted">{t("ledger.status")}</div><RunStatus status={run.status} /></div>
            <div className="card"><div className="small muted">{t("ledger.duration")}</div><b>{formatDuration(run.durationMs)}</b></div>
            <div className="card"><div className="small muted">{t("ledger.actions")}</div><b>{run.actions}</b></div>
            <div className="card"><div className="small muted">{t("ledger.where")}</div><b>{run.where === "canvas" ? t("pulse.canvas") : t(`platform.${run.platform}`)}</b></div>
          </div>
          {run.error && (
            <div className="callout err">
              <Icon name="OctagonX" />
              <div className="stack-sm">
                <b>{t(`errcat.${run.error.category}`)}</b>
                <span>{run.error.message}</span>
                {run.error.stepId && <span className="small muted">{t("ledger.atStep", { id: run.error.stepId })}</span>}
                <div className="small">{t(`errhelp.${run.error.category}`)}</div>
                {flow && (
                  <div className="row">
                    <button className="btn sm" onClick={() => navigate(`/flows/${flow.id}`)}><Icon name="Pen" size={14} /> {t("ledger.fix")}</button>
                    <button className="btn sm ghost" onClick={() => navigate(`/canvas?flow=${flow.id}`)}><Icon name="Target" size={14} /> {t("editor.practice")}</button>
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="card stack-sm">
            <h3>{t("ledger.timeline")}</h3>
            <div className="stack-xs" style={{ maxHeight: 520, overflowY: "auto" }}>
              {run.events.map((e, i) => <EventRow key={i} e={e} t0={t0} flow={flow} />)}
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title={<h2>{t("nav.ledger")}</h2>} actions={runs.length ? <button className="btn sm ghost" onClick={async () => (await confirmDialog({ title: t("ledger.clearTitle"), body: t("ledger.clearBody"), tone: "danger", confirmLabel: t("ledger.clear") })) && clear()}><Icon name="Trash2" size={15} /> {t("ledger.clear")}</button> : null}>
      <div className="page">
        <div className="page-head">
          <div>
            <h1>{t("nav.ledger")}</h1>
            <p>{t("ledger.sub")}</p>
          </div>
          <Seg value={filter} onChange={setFilter} options={[{ value: "all", label: t("flows.all") }, { value: "completed", label: t("run.status.completed") }, { value: "stopped", label: t("run.status.stopped") }, { value: "failed", label: t("run.status.failed") }]} />
        </div>
        {list.length === 0 ? (
          <div className="card"><Empty icon="History" title={t("ledger.empty")} body={t("ledger.emptyBody")} /></div>
        ) : (
          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table className="table">
              <thead><tr><th>{t("ledger.status")}</th><th>{t("flows.col.name")}</th><th>{t("ledger.when")}</th><th>{t("ledger.duration")}</th><th>{t("ledger.actions")}</th><th>{t("ledger.where")}</th></tr></thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} onClick={() => navigate(`/ledger/${r.id}`)} style={{ cursor: "pointer" }}>
                    <td><RunStatus status={r.status} /></td>
                    <td className="truncate" style={{ maxWidth: 280 }}>{r.flowName}{r.error && <div className="small" style={{ color: "#f87171" }}>{r.error.message.slice(0, 80)}</div>}</td>
                    <td className="small muted">{formatRelative(r.startedAt)}</td>
                    <td className="small">{formatDuration(r.durationMs)}</td>
                    <td className="small">{r.actions}</td>
                    <td><span className="badge">{r.where === "canvas" ? t("pulse.canvas") : t(`platform.${r.platform}`)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  );
}
