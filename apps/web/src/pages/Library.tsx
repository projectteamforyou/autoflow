import { useMemo, useRef, useState, type DragEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { decodeShareCode, importFlow, walkSteps, type Flow } from "@autoflow/core";
import { Shell } from "../components/Shell";
import { Icon } from "../components/Icon";
import { Empty, FlowIcon, Modal, SafetyBadge, Seg, pickFile } from "../components/ui";
import { TriggerBadge } from "../components/TriggerBadge";
import { FlowCard } from "./Home";
import { useStore } from "../lib/store";
import { confirmDialog, promptDialog } from "../lib/dialog";
import { downloadBackup, exportToFile, restoreBackupFile, shareLink, startFlow, toastRestored } from "../lib/actions";
import { formatRelative, useT } from "../i18n";
import { ImportReview } from "./ImportFlow";

type Sort = "updated" | "name" | "created" | "lastRun";

/** Schema limits (packages/core FlowSchema): folder ≤ 120 chars, tag ≤ 32 chars, ≤ 20 tags per flow. */
const MAX_FOLDER = 120;
const MAX_TAG = 32;
const MAX_TAGS = 20;

/** Everything the search box matches, lower-cased: name, description, tags, folder, step labels and typed text. */
function haystack(f: Flow): string {
  const parts = [f.name, f.description, f.folder ?? "", ...f.tags];
  walkSteps(f.steps, (s) => {
    if (s.label) parts.push(s.label);
    if (s.type === "type") parts.push(s.text);
  });
  return parts.join("\n").toLowerCase();
}

export function Library() {
  const t = useT();
  const navigate = useNavigate();
  const flows = useStore((s) => s.flows);
  const runs = useStore((s) => s.runs);
  const del = useStore((s) => s.deleteFlow);
  const dup = useStore((s) => s.duplicateFlow);
  const saveFlow = useStore((s) => s.saveFlow);
  const toast = useStore((s) => s.toast);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "favorites" | "easy" | "pro">("all");
  const [view, setView] = useState<"grid" | "list">(() => (localStorage.getItem("af.libView") as "grid" | "list") ?? "grid");
  const [sort, setSort] = useState<Sort>(() => (localStorage.getItem("af.libSort") as Sort) ?? "updated");
  const [tag, setTag] = useState<string | null>(null);
  const [pending, setPending] = useState<Awaited<ReturnType<typeof importFlow>> | null>(null);
  // The folder filter lives in the URL (#/flows?folder=Work) so the command palette can link to a folder.
  // No parameter = all flows; an empty value = flows without a folder.
  const [params, setParams] = useSearchParams();
  const folder = params.get("folder");
  const setFolder = (f: string | null) => setParams(f === null ? {} : { folder: f }, { replace: true });
  /** null = not in selection mode. */
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [moving, setMoving] = useState<Flow[] | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const tags = useMemo(() => [...new Set(flows.flatMap((f) => f.tags))].sort(), [flows]);
  const folders = useMemo(() => [...new Set(flows.map((f) => f.folder).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b)), [flows]);
  const unfiled = useMemo(() => flows.filter((f) => !f.folder).length, [flows]);
  const lastRun = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of runs) if ((m.get(r.flowId) ?? 0) < r.startedAt) m.set(r.flowId, r.startedAt);
    return m;
  }, [runs]);
  // Built once per library change, not per keystroke: walking every step of every flow is the costly part.
  const texts = useMemo(() => new Map(flows.map((f) => [f.id, haystack(f)])), [flows]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/^#/, "");
    const out = flows.filter(
      (f) =>
        (filter === "all" || (filter === "favorites" ? f.favorite : f.mode === filter)) &&
        (folder === null || (f.folder ?? "") === folder) &&
        (!tag || f.tags.includes(tag)) &&
        (!needle || texts.get(f.id)!.includes(needle)),
    );
    // The store already orders by favorite + updatedAt; the other sorts are applied here.
    if (sort === "name") out.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "created") out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    else if (sort === "lastRun") out.sort((a, b) => (lastRun.get(b.id) ?? 0) - (lastRun.get(a.id) ?? 0)); // never-run flows last, in store order
    return out;
  }, [flows, texts, q, filter, folder, tag, sort, lastRun]);
  const picked = useMemo(() => (selected ? flows.filter((f) => selected.has(f.id)) : []), [flows, selected]);

  const importFile = async (file: File) => {
    if (file.size > 2_000_000) return toast("error", t("import.tooLarge"));
    // Backup files contain several flows (and Keyforge profiles, settings).
    try {
      const r = await restoreBackupFile(file);
      if (r) return toastRestored(r);
    } catch (e) {
      return toast("error", (e as Error).message);
    }
    setPending(await importFlow(await file.text()));
  };

  const onImportFile = async () => {
    const file = await pickFile(".json,application/json");
    if (file) await importFile(file);
  };

  // Dropping a .json file anywhere on the page imports it. enter/leave fire for every child element, hence the depth counter.
  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");
  const onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current++;
    setDragging(true);
  };
  const onDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!/\.json$/i.test(file.name) && file.type !== "application/json") return toast("error", t("import.invalid"));
    void importFile(file);
  };

  const removeMany = async (list: Flow[]) => {
    if (!list.length) return;
    const one = list.length === 1 ? list[0]! : null;
    if (!(await confirmDialog({ title: one ? t("flows.deleteTitle") : t("flows.bulk.deleteTitle", { n: list.length }), body: one ? t("flows.deleteBody", { name: one.name }) : t("flows.bulk.deleteBody"), tone: "danger", confirmLabel: t("common.delete") }))) return;
    for (const f of list) await del(f.id);
    setSelected((s) => (s ? new Set([...s].filter((id) => !list.some((f) => f.id === id))) : s));
    // Undo re-saves the flows as they were (their version history is gone, as with a single delete).
    toast("info", one ? t("flows.deleted") : t("flows.bulk.deleted", { n: list.length }), { label: t("common.undo"), run: () => void (async () => { for (const f of list) await saveFlow(f, { snapshot: false }); })() });
  };

  const rename = async (f: Flow) => {
    const name = await promptDialog({ title: t("flows.rename"), input: { label: t("flows.col.name"), value: f.name }, confirmLabel: t("common.save") });
    const next = name?.trim().slice(0, 120);
    if (next && next !== f.name) await saveFlow({ ...f, name: next }, { snapshot: false });
  };

  const moveTo = async (list: Flow[], name: string | undefined) => {
    const target = name?.trim().slice(0, MAX_FOLDER) || undefined;
    const changed = list.filter((f) => (f.folder ?? undefined) !== target);
    for (const f of changed) await saveFlow({ ...f, folder: target }, { snapshot: false });
    setMoving(null);
    if (changed.length) toast("success", target ? t("flows.folder.moved", { n: changed.length, folder: target }) : t("flows.folder.cleared", { n: changed.length }));
  };

  const addTag = async (list: Flow[]) => {
    const raw = await promptDialog({ title: t("flows.bulk.tag"), input: { label: t("flows.bulk.tagLabel"), placeholder: tags[0] ?? "" }, confirmLabel: t("common.save") });
    const name = raw?.trim().replace(/^#+/, "").slice(0, MAX_TAG);
    if (!name) return;
    const changed = list.filter((f) => !f.tags.includes(name) && f.tags.length < MAX_TAGS);
    for (const f of changed) await saveFlow({ ...f, tags: [...f.tags, name] }, { snapshot: false });
    toast("success", t("flows.bulk.tagged", { n: changed.length, tag: name }));
  };

  const onImportCode = async () => {
    const code = await promptDialog({ title: t("import.codeTitle"), input: { label: t("import.codeLabel"), placeholder: "https://…#/import?code=…" } });
    if (!code) return;
    const m = /code=([A-Za-z0-9_-]+)/.exec(code);
    setPending(await decodeShareCode(m ? m[1]! : code.trim()));
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s ?? []);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const allShown = list.length > 0 && list.every((f) => selected?.has(f.id));
  const menuFlow = menu ? flows.find((f) => f.id === menu) : undefined;
  const moreBtn = (f: Flow) => (
    <button className="btn ghost icon sm" title={t("flows.more")} aria-label={t("flows.more")} aria-haspopup="dialog" onClick={() => setMenu(f.id)}><Icon name="Ellipsis" size={14} /></button>
  );

  return (
    <Shell
      title={<h2>{t("nav.flows")}</h2>}
      actions={
        <div className="row">
          <button className="btn sm" onClick={onImportCode}><Icon name="Link" size={15} /> {t("import.code")}</button>
          <button className="btn sm" onClick={onImportFile}><Icon name="Upload" size={15} /> {t("import.file")}</button>
          <button className="btn sm primary" onClick={() => navigate(useStore.getState().settings.defaultMode === "pro" ? "/new/pro" : "/new/click")}><Icon name="Plus" size={15} /> {t("flows.new")}</button>
        </div>
      }
    >
      <div className={`page lib-drop${dragging ? " over" : ""}`} onDragEnter={onDragEnter} onDragOver={(e) => hasFiles(e) && e.preventDefault()} onDragLeave={onDragLeave} onDrop={onDrop}>
        {dragging && <div className="lib-drop-hint" aria-hidden="true"><Icon name="Upload" size={22} /> {t("flows.drop")}</div>}
        <div className="row wrap between">
          <div className="input-group" style={{ flex: "1 1 280px", maxWidth: 420 }}>
            <Icon name="Search" size={16} />
            <input className="input" placeholder={t("flows.searchAll")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("flows.searchAll")} />
          </div>
          <div className="row wrap">
            <Seg value={filter} onChange={setFilter} label={t("flows.filter")} options={[{ value: "all", label: t("flows.all") }, { value: "favorites", label: t("flows.favorites"), icon: "Star" }, { value: "easy", label: t("mode.easy") }, { value: "pro", label: t("mode.pro") }]} />
            <Seg value={sort} onChange={(v) => { setSort(v); localStorage.setItem("af.libSort", v); }} label={t("flows.sort")} options={[{ value: "updated", label: t("flows.sort.updated") }, { value: "name", label: t("flows.sort.name") }, { value: "created", label: t("flows.sort.created") }, { value: "lastRun", label: t("flows.sort.lastRun") }]} />
            <Seg value={view} onChange={(v) => { setView(v); localStorage.setItem("af.libView", v); }} label={t("flows.view")} options={[{ value: "grid", label: "", icon: "LayoutGrid" }, { value: "list", label: "", icon: "ListOrdered" }]} />
            <button className="btn sm ghost" aria-pressed={!!selected} onClick={() => setSelected(selected ? null : new Set())} disabled={!flows.length}><Icon name="ListChecks" size={15} /> {t("flows.select")}</button>
            <button className="btn sm ghost" onClick={() => downloadBackup()} disabled={!flows.length}><Icon name="Download" size={15} /> {t("flows.backup")}</button>
          </div>
        </div>
        {(folders.length > 0 || folder !== null) && (
          <div className="row wrap" role="group" aria-label={t("flows.folders")}>
            <Icon name="Folder" size={15} className="subtle" />
            <button className={`badge chip${folder === null ? " primary" : ""}`} aria-pressed={folder === null} onClick={() => setFolder(null)}>{t("flows.all")} · {flows.length}</button>
            {folders.map((x) => (
              <button key={x} className={`badge chip${folder === x ? " primary" : ""}`} aria-pressed={folder === x} onClick={() => setFolder(folder === x ? null : x)}><span className="truncate" style={{ maxWidth: 180 }}>{x}</span> · {flows.filter((f) => f.folder === x).length}</button>
            ))}
            {unfiled > 0 && <button className={`badge chip${folder === "" ? " primary" : ""}`} aria-pressed={folder === ""} onClick={() => setFolder(folder === "" ? null : "")}>{t("flows.folder.none")} · {unfiled}</button>}
          </div>
        )}
        {tags.length > 0 && (
          <div className="row wrap">
            <button className={`badge${tag === null ? " primary" : ""}`} onClick={() => setTag(null)} style={{ cursor: "pointer" }}>{t("flows.allTags")}</button>
            {tags.map((x) => (
              <button key={x} className={`badge${tag === x ? " primary" : ""}`} onClick={() => setTag(tag === x ? null : x)} style={{ cursor: "pointer" }}>#{x}</button>
            ))}
          </div>
        )}
        {selected && (
          <div className="bulk-bar" role="toolbar" aria-label={t("flows.select")}>
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" className="check" checked={allShown} onChange={() => setSelected(allShown ? new Set() : new Set(list.map((f) => f.id)))} />
              {t("flows.select.all")}
            </label>
            <b aria-live="polite">{t("flows.select.count", { n: picked.length })}</b>
            <span className="grow" />
            <button className="btn sm" disabled={!picked.length} onClick={() => setMoving(picked)}><Icon name="FolderInput" size={14} /> {t("flows.folder.move")}</button>
            <button className="btn sm" disabled={!picked.length} onClick={() => void addTag(picked)}><Icon name="Tag" size={14} /> {t("flows.bulk.tag")}</button>
            <button className="btn sm" disabled={!picked.length} onClick={() => downloadBackup(picked)}><Icon name="Download" size={14} /> {t("flows.bulk.export")}</button>
            <button className="btn sm danger" disabled={!picked.length} onClick={() => void removeMany(picked)}><Icon name="Trash2" size={14} /> {t("common.delete")}</button>
            <button className="btn sm ghost" onClick={() => setSelected(null)}>{t("flows.select.done")}</button>
          </div>
        )}
        {list.length === 0 ? (
          <div className="card">
            <Empty icon="Workflow" title={flows.length ? t("common.noResults") : t("flows.empty")} body={flows.length ? undefined : t("flows.emptyBody")} action={!flows.length ? <button className="btn primary" onClick={() => navigate("/atlas")}><Icon name="Map" size={16} /> {t("nav.atlas")}</button> : undefined} />
          </div>
        ) : view === "grid" ? (
          <div className="grid auto">
            {list.map((f) => (
              <FlowCard
                key={f.id}
                id={f.id}
                select={selected ? { checked: selected.has(f.id), onToggle: () => toggle(f.id) } : undefined}
                actions={
                  <>
                    <button className="btn ghost icon sm" title={t("flows.duplicate")} aria-label={t("flows.duplicate")} onClick={() => void dup(f.id)}><Icon name="Copy" size={14} /></button>
                    {moreBtn(f)}
                  </>
                }
              />
            ))}
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  {selected && <th />}
                  <th>{t("flows.col.name")}</th>
                  <th>{t("editor.trigger")}</th>
                  <th>{t("flows.col.mode")}</th>
                  <th>{t("flows.col.safety")}</th>
                  <th>{sort === "lastRun" ? t("flows.sort.lastRun") : t("flows.col.updated")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((f) => (
                  <tr key={f.id} className={selected?.has(f.id) ? "selected" : undefined}>
                    {selected && <td style={{ width: 1 }}><input type="checkbox" className="check" checked={selected.has(f.id)} onChange={() => toggle(f.id)} aria-label={t("flows.select.one", { name: f.name })} /></td>}
                    <td>
                      <button className="row btn ghost" style={{ height: "auto", padding: 0 }} onClick={() => navigate(`/flows/${f.id}`)}>
                        <FlowIcon flow={f} size={30} />
                        <span className="truncate" style={{ maxWidth: 320 }}>{f.name}</span>
                      </button>
                      {f.folder && folder === null && <div className="small subtle row" style={{ gap: 4, marginTop: 2 }}><Icon name="Folder" size={12} /> <span className="truncate" style={{ maxWidth: 260 }}>{f.folder}</span></div>}
                    </td>
                    <td><TriggerBadge flow={f} /></td>
                    <td><span className="badge">{t(`mode.${f.mode}`)}</span></td>
                    <td><SafetyBadge flow={f} /></td>
                    <td className="small muted">{sort === "lastRun" ? (lastRun.has(f.id) ? formatRelative(lastRun.get(f.id)!) : "—") : formatRelative(Date.parse(f.updatedAt))}</td>
                    <td>
                      <div className="row end">
                        <button className="btn sm primary" aria-label={t("flows.run")} onClick={() => void startFlow(f, navigate)}><Icon name="Play" size={14} /></button>
                        <button className="btn sm ghost" title={t("flows.rename")} aria-label={t("flows.rename")} onClick={() => void rename(f)}><Icon name="Pen" size={14} /></button>
                        <button className="btn sm ghost" title={t("flows.duplicate")} aria-label={t("flows.duplicate")} onClick={() => void dup(f.id)}><Icon name="Copy" size={14} /></button>
                        <button className="btn sm ghost" title={t("flows.share")} aria-label={t("flows.share")} onClick={() => void shareLink(f)}><Icon name="Share2" size={14} /></button>
                        <button className="btn sm ghost" title={t("flows.export")} aria-label={t("flows.export")} onClick={() => void exportToFile(f)}><Icon name="Download" size={14} /></button>
                        {moreBtn(f)}
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
      {menuFlow && (
        <FlowMenu
          flow={menuFlow}
          onClose={() => setMenu(null)}
          items={[
            { icon: "Play", label: t("flows.run"), run: () => void startFlow(menuFlow, navigate) },
            { icon: "Pen", label: t("flows.rename"), run: () => void rename(menuFlow) },
            { icon: "Copy", label: t("flows.duplicate"), run: () => void dup(menuFlow.id) },
            { icon: "FolderInput", label: t("flows.folder.move"), run: () => setMoving([menuFlow]) },
            { icon: "Share2", label: t("flows.share"), run: () => void shareLink(menuFlow) },
            { icon: "Download", label: t("flows.export"), run: () => void exportToFile(menuFlow) },
            { icon: "Trash2", label: t("common.delete"), danger: true, run: () => void removeMany([menuFlow]) },
          ]}
        />
      )}
      {moving && <FolderPicker flows={moving} folders={folders} onPick={(name) => void moveTo(moving, name)} onClose={() => setMoving(null)} />}
    </Shell>
  );
}

/** "More" sheet of one flow: the same actions on grid cards and list rows (a sheet works with touch and keyboard alike). */
function FlowMenu({ flow, items, onClose }: { flow: Flow; items: { icon: string; label: string; danger?: boolean; run: () => void }[]; onClose: () => void }) {
  return (
    <Modal title={<span className="truncate" style={{ display: "block" }}>{flow.name}</span>} icon={flow.icon} onClose={onClose}>
      <div className="stack-xs">
        {items.map((it) => (
          // Close first: the action may open a dialog of its own.
          <button key={it.label} className="nav-link" style={it.danger ? { color: "var(--af-danger)" } : undefined} onClick={() => { onClose(); it.run(); }}>
            <Icon name={it.icon} />
            {it.label}
          </button>
        ))}
      </div>
    </Modal>
  );
}

/** "Move to folder…": pick an existing folder, type a new name, or take the flows out of their folder. */
function FolderPicker({ flows, folders, onPick, onClose }: { flows: Flow[]; folders: string[]; onPick: (name: string | undefined) => void; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const current = flows.length === 1 ? flows[0]!.folder : undefined;
  return (
    <Modal title={t("flows.folder.move")} icon="FolderInput" onClose={onClose}>
      <div className="stack">
        <p className="small muted truncate">{flows.length === 1 ? flows[0]!.name : t("flows.select.count", { n: flows.length })}</p>
        <form className="input-group" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onPick(name); }}>
          <input className="input" value={name} maxLength={MAX_FOLDER} onChange={(e) => setName(e.target.value)} placeholder={t("flows.folder.new")} aria-label={t("flows.folder.new")} />
          <button className="btn primary" disabled={!name.trim()}><Icon name="Plus" size={15} /> {t("flows.folder.create")}</button>
        </form>
        <div className="stack-xs" style={{ maxHeight: "40vh", overflowY: "auto" }}>
          {folders.map((x) => (
            <button key={x} className={`nav-link${x === current ? " active" : ""}`} onClick={() => onPick(x)}>
              <Icon name="Folder" />
              <span className="truncate">{x}</span>
            </button>
          ))}
          <button className={`nav-link${flows.length === 1 && !current ? " active" : ""}`} onClick={() => onPick(undefined)}>
            <Icon name="X" />
            {t("flows.folder.none")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
