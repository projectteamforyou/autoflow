import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { decodeShareCode, importFlow, type Flow } from "@autoflow/core";
import { Shell } from "../components/Shell";
import { Icon } from "../components/Icon";
import { Empty, FlowIcon, SafetyBadge, Seg, download, pickFile } from "../components/ui";
import { FlowCard } from "./Home";
import { useStore } from "../lib/store";
import { confirmDialog, promptDialog } from "../lib/dialog";
import { exportToFile, shareLink, startFlow } from "../lib/actions";
import { formatRelative, useT } from "../i18n";
import { ImportReview } from "./ImportFlow";

export function Library() {
  const t = useT();
  const navigate = useNavigate();
  const flows = useStore((s) => s.flows);
  const del = useStore((s) => s.deleteFlow);
  const dup = useStore((s) => s.duplicateFlow);
  const toast = useStore((s) => s.toast);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "favorites" | "easy" | "pro">("all");
  const [view, setView] = useState<"grid" | "list">(() => (localStorage.getItem("af.libView") as "grid" | "list") ?? "grid");
  const [tag, setTag] = useState<string | null>(null);
  const [pending, setPending] = useState<Awaited<ReturnType<typeof importFlow>> | null>(null);

  const tags = useMemo(() => [...new Set(flows.flatMap((f) => f.tags))].sort(), [flows]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return flows.filter(
      (f) =>
        (filter === "all" || (filter === "favorites" ? f.favorite : f.mode === filter)) &&
        (!tag || f.tags.includes(tag)) &&
        (!needle || f.name.toLowerCase().includes(needle) || f.description.toLowerCase().includes(needle) || f.tags.some((x) => x.toLowerCase().includes(needle))),
    );
  }, [flows, q, filter, tag]);

  const onImportFile = async () => {
    const file = await pickFile(".json,application/json");
    if (!file) return;
    if (file.size > 2_000_000) return toast("error", t("import.tooLarge"));
    const text = await file.text();
    // Backup files contain several flows.
    try {
      const data = JSON.parse(text);
      if (data?.format === "autoflow.backup" && Array.isArray(data.flows)) {
        const ok: Flow[] = [];
        for (const f of data.flows) {
          const r = await importFlow(JSON.stringify(f));
          if (r.ok && r.flow) ok.push(r.flow);
        }
        const n = await useStore.getState().importFlows(ok);
        return toast("success", t("import.restored", { n }));
      }
    } catch {
      /* fall through to single-flow import */
    }
    setPending(await importFlow(text));
  };

  const onImportCode = async () => {
    const code = await promptDialog({ title: t("import.codeTitle"), input: { label: t("import.codeLabel"), placeholder: "https://…#/import?code=…" } });
    if (!code) return;
    const m = /code=([A-Za-z0-9_-]+)/.exec(code);
    setPending(await decodeShareCode(m ? m[1]! : code.trim()));
  };

  const exportAll = async () => {
    download(`autoflow-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ format: "autoflow.backup", version: 1, exportedAt: new Date().toISOString(), flows, profiles: useStore.getState().profiles }, null, 2));
  };

  return (
    <Shell
      title={<h2>{t("nav.flows")}</h2>}
      actions={
        <div className="row">
          <button className="btn sm" onClick={onImportCode}><Icon name="Link" size={15} /> {t("import.code")}</button>
          <button className="btn sm" onClick={onImportFile}><Icon name="Upload" size={15} /> {t("import.file")}</button>
          <button className="btn sm primary" onClick={() => navigate("/new/click")}><Icon name="Plus" size={15} /> {t("flows.new")}</button>
        </div>
      }
    >
      <div className="page">
        <div className="row wrap between">
          <div className="input-group" style={{ flex: "1 1 280px", maxWidth: 420 }}>
            <Icon name="Search" size={16} />
            <input className="input" placeholder={t("flows.search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("flows.search")} />
          </div>
          <div className="row wrap">
            <Seg value={filter} onChange={setFilter} label={t("flows.filter")} options={[{ value: "all", label: t("flows.all") }, { value: "favorites", label: t("flows.favorites"), icon: "Star" }, { value: "easy", label: t("mode.easy") }, { value: "pro", label: t("mode.pro") }]} />
            <Seg value={view} onChange={(v) => { setView(v); localStorage.setItem("af.libView", v); }} label={t("flows.view")} options={[{ value: "grid", label: "", icon: "LayoutGrid" }, { value: "list", label: "", icon: "ListOrdered" }]} />
            <button className="btn sm ghost" onClick={exportAll} disabled={!flows.length}><Icon name="Download" size={15} /> {t("flows.backup")}</button>
          </div>
        </div>
        {tags.length > 0 && (
          <div className="row wrap">
            <button className={`badge${tag === null ? " primary" : ""}`} onClick={() => setTag(null)} style={{ cursor: "pointer" }}>{t("flows.allTags")}</button>
            {tags.map((x) => (
              <button key={x} className={`badge${tag === x ? " primary" : ""}`} onClick={() => setTag(tag === x ? null : x)} style={{ cursor: "pointer" }}>#{x}</button>
            ))}
          </div>
        )}
        {list.length === 0 ? (
          <div className="card">
            <Empty icon="Workflow" title={flows.length ? t("common.noResults") : t("flows.empty")} body={flows.length ? undefined : t("flows.emptyBody")} action={!flows.length ? <button className="btn primary" onClick={() => navigate("/atlas")}><Icon name="Map" size={16} /> {t("nav.atlas")}</button> : undefined} />
          </div>
        ) : view === "grid" ? (
          <div className="grid auto">
            {list.map((f) => (
              <FlowCard key={f.id} id={f.id} />
            ))}
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{t("flows.col.name")}</th>
                  <th>{t("flows.col.mode")}</th>
                  <th>{t("flows.col.safety")}</th>
                  <th>{t("flows.col.updated")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <button className="row btn ghost" style={{ height: "auto", padding: 0 }} onClick={() => navigate(`/flows/${f.id}`)}>
                        <FlowIcon flow={f} size={30} />
                        <span className="truncate" style={{ maxWidth: 320 }}>{f.name}</span>
                      </button>
                    </td>
                    <td><span className="badge">{t(`mode.${f.mode}`)}</span></td>
                    <td><SafetyBadge flow={f} /></td>
                    <td className="small muted">{formatRelative(Date.parse(f.updatedAt))}</td>
                    <td>
                      <div className="row end">
                        <button className="btn sm primary" onClick={() => void startFlow(f, navigate)}><Icon name="Play" size={14} /></button>
                        <button className="btn sm ghost" title={t("flows.duplicate")} onClick={() => void dup(f.id)}><Icon name="Copy" size={14} /></button>
                        <button className="btn sm ghost" title={t("flows.share")} onClick={() => void shareLink(f)}><Icon name="Share2" size={14} /></button>
                        <button className="btn sm ghost" title={t("flows.export")} onClick={() => void exportToFile(f)}><Icon name="Download" size={14} /></button>
                        <button
                          className="btn sm ghost"
                          title={t("common.delete")}
                          onClick={async () => {
                            if (await confirmDialog({ title: t("flows.deleteTitle"), body: t("flows.deleteBody", { name: f.name }), tone: "danger", confirmLabel: t("common.delete") })) await del(f.id);
                          }}
                        >
                          <Icon name="Trash2" size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {pending && <ImportReview result={pending} onClose={() => setPending(null)} />}
    </Shell>
  );
}
