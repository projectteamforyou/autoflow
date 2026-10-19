import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { TEMPLATES, TEMPLATE_CATEGORIES, analyzeRisk, explainFlow, parseFlow, type Flow, type Platform, type TemplateCategory } from "@autoflow/core";
import { Shell } from "../components/Shell";
import { Icon } from "../components/Icon";
import { Empty, FlowIcon, Modal, SafetyBadge, Seg } from "../components/ui";
import { useStore } from "../lib/store";
import { api, ApiError, getToken } from "../lib/api";
import { promptDialog } from "../lib/dialog";
import { getLocale, tp, useT } from "../i18n";

interface CommunityTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  platforms: Platform[];
  author: { name: string };
  risk: { level: "low" | "medium" | "high"; score: number; permissions: string[] };
  installs: number;
  rating: { average: number; count: number };
  flow?: Flow;
}

export function AtlasPage() {
  const t = useT();
  const { id } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"official" | "community">("official");
  const [cat, setCat] = useState<TemplateCategory | "all">("all");
  const [plat, setPlat] = useState<Platform | "all">("all");
  const [q, setQ] = useState("");
  const [community, setCommunity] = useState<CommunityTemplate[] | null>(null);
  const [communityError, setCommunityError] = useState<string | null>(null);

  const official = useMemo(
    () =>
      TEMPLATES.filter((tpl) => (cat === "all" || tpl.category === cat) && (plat === "all" || tpl.platforms.includes(plat)) && (!q || `${t(`tpl.${tpl.id}.name`)} ${t(`tpl.${tpl.id}.desc`)}`.toLowerCase().includes(q.toLowerCase()))),
    [cat, plat, q, t],
  );

  useEffect(() => {
    if (tab !== "community") return;
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (cat !== "all") params.set("category", cat);
    if (plat !== "all") params.set("platform", plat);
    setCommunityError(null);
    api<{ templates: CommunityTemplate[] }>(`/v1/atlas/templates?${params}`, { auth: false })
      .then((r) => setCommunity(r.templates))
      .catch((e: ApiError) => {
        setCommunity([]);
        setCommunityError(e.status === 0 ? t("atlas.offline") : e.message);
      });
  }, [tab, q, cat, plat, t]);

  const tplDetail = id ? TEMPLATES.find((x) => x.id === id) : undefined;

  return (
    <Shell title={<h2>{t("nav.atlas")}</h2>} actions={<PublishButton />}>
      <div className="page">
        <div className="page-head">
          <div>
            <h1>{t("atlas.title")}</h1>
            <p>{t("atlas.sub")}</p>
          </div>
          <Seg value={tab} onChange={setTab} options={[{ value: "official", label: t("atlas.official"), icon: "BadgeCheck" }, { value: "community", label: t("atlas.community"), icon: "Globe" }]} />
        </div>
        <div className="row wrap">
          <div className="input-group" style={{ flex: "1 1 260px", maxWidth: 380 }}>
            <Icon name="Search" size={16} />
            <input className="input" placeholder={t("atlas.search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("atlas.search")} />
          </div>
          <select className="select" style={{ width: "auto" }} value={plat} onChange={(e) => setPlat(e.target.value as Platform | "all")} aria-label={t("atlas.platform")}>
            <option value="all">{t("atlas.allPlatforms")}</option>
            {(["windows", "android", "web"] as const).map((p) => <option key={p} value={p}>{t(`platform.${p}`)}</option>)}
          </select>
        </div>
        <div className="row wrap">
          <button className={`badge${cat === "all" ? " primary" : ""}`} style={{ cursor: "pointer" }} onClick={() => setCat("all")}>{t("flows.all")}</button>
          {TEMPLATE_CATEGORIES.map((c) => (
            <button key={c} className={`badge${cat === c ? " primary" : ""}`} style={{ cursor: "pointer" }} onClick={() => setCat(c)}>{t(`atlas.cat.${c}`)}</button>
          ))}
        </div>

        {tab === "official" ? (
          <div className="grid auto">
            {official.map((tpl) => (
              <div key={tpl.id} className="card hover flow-card" onClick={() => navigate(`/atlas/${tpl.id}`)} role="link" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && navigate(`/atlas/${tpl.id}`)}>
                <div className="row">
                  <FlowIcon flow={tpl.flow} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <b className="truncate" style={{ display: "block" }}>{t(`tpl.${tpl.id}.name`)}</b>
                    <span className="small muted">{t(`atlas.cat.${tpl.category}`)} · {t(`atlas.diff.${tpl.difficulty}`)}</span>
                  </div>
                  <Icon name="BadgeCheck" size={18} className="gradient-text" />
                </div>
                <p className="small muted">{t(`tpl.${tpl.id}.desc`)}</p>
                <div className="meta">
                  <SafetyBadge flow={tpl.flow} />
                  {tpl.platforms.map((p) => <span key={p} className="badge"><Icon name={p === "windows" ? "Monitor" : p === "android" ? "Smartphone" : "Globe"} size={12} /> {t(`platform.${p}`)}</span>)}
                </div>
              </div>
            ))}
            {official.length === 0 && <div className="card"><Empty icon="Search" title={t("common.noResults")} /></div>}
          </div>
        ) : community === null ? (
          <p className="muted">{t("common.loading")}</p>
        ) : community.length === 0 ? (
          <div className="card"><Empty icon="Globe" title={communityError ?? t("atlas.communityEmpty")} body={communityError ? undefined : t("atlas.communityEmptyBody")} /></div>
        ) : (
          <div className="grid auto">
            {community.map((c) => <CommunityCard key={c.id} item={c} />)}
          </div>
        )}
      </div>
      {tplDetail && <TemplateDetail id={tplDetail.id} onClose={() => navigate("/atlas")} />}
    </Shell>
  );
}

function TemplateDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const install = useStore((s) => s.installTemplate);
  const tpl = TEMPLATES.find((x) => x.id === id)!;
  const risk = analyzeRisk(tpl.flow);
  return (
    <Modal
      wide
      title={t(`tpl.${tpl.id}.name`)}
      icon={tpl.flow.icon}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={async () => { const f = await install(tpl.id); if (f) navigate(`/canvas?flow=${f.id}&autorun=1`); }}><Icon name="Target" size={15} /> {t("atlas.tryInCanvas")}</button>
          <button className="btn primary" onClick={async () => { const f = await install(tpl.id); if (f) navigate(`/flows/${f.id}`); }}><Icon name="Download" size={15} /> {t("atlas.install")}</button>
        </>
      }
    >
      <p className="muted">{t(`tpl.${tpl.id}.desc`)}</p>
      <div className="row wrap">
        <SafetyBadge flow={tpl.flow} />
        <span className="badge primary"><Icon name="BadgeCheck" size={12} /> {t("atlas.verified", { date: tpl.verifiedAt.slice(0, 10) })}</span>
        {tpl.platforms.map((p) => <span key={p} className="badge">{t(`platform.${p}`)}</span>)}
      </div>
      {risk.permissions.length > 0 && (
        <div className="stack-sm">
          <span className="label">{t("import.permissions")}</span>
          <div className="row wrap">{risk.permissions.map((p) => <span key={p} className="badge">{t(p)}</span>)}</div>
        </div>
      )}
      <div className="card" style={{ background: "var(--af-bg-2)" }}>
        <span className="label">{t("editor.explain")}</span>
        <div className="stack-xs small" style={{ marginTop: 8 }}>
          {explainFlow(tpl.flow).map((l, i) => <div key={i} style={{ paddingLeft: l.depth * 16 }}>{tp(l.phrase)}</div>)}
        </div>
      </div>
    </Modal>
  );
}

function CommunityCard({ item }: { item: CommunityTemplate }) {
  const t = useT();
  const navigate = useNavigate();
  const save = useStore((s) => s.saveFlow);
  const toast = useStore((s) => s.toast);
  const installIt = async () => {
    try {
      const r = await api<{ template: CommunityTemplate & { flow: Flow } }>(`/v1/atlas/templates/${item.id}`, { auth: false });
      const parsed = parseFlow(r.template.flow);
      if (!parsed.ok) return toast("error", t("import.invalid"));
      void api(`/v1/atlas/templates/${item.id}/install`, { method: "POST", auth: false }).catch(() => undefined);
      const now = new Date().toISOString();
      const f = await save({ ...parsed.flow, id: `f_${item.id.slice(0, 20)}_${Date.now().toString(36)}`, createdAt: now, updatedAt: now, revision: 0 }, { snapshot: false });
      navigate(`/flows/${f.id}`);
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };
  const report = async () => {
    const reason = await promptDialog({ title: t("atlas.report"), input: { label: t("atlas.reportReason"), type: "textarea" } });
    if (!reason) return;
    try {
      await api(`/v1/atlas/templates/${item.id}/reports`, { method: "POST", json: { reason: "other", details: reason.slice(0, 1000) } });
      toast("success", t("atlas.reported"));
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };
  return (
    <div className="card flow-card">
      <div className="row">
        <div className="tile-icon" style={{ background: "var(--af-gradient)" }}><Icon name="Globe" /></div>
        <div className="grow" style={{ minWidth: 0 }}>
          <b className="truncate" style={{ display: "block" }}>{item.name}</b>
          <span className="small muted">{item.author.name} · ★ {item.rating.average.toFixed(1)} ({item.rating.count}) · {t("atlas.installs", { n: item.installs })}</span>
        </div>
      </div>
      <p className="small muted">{item.description}</p>
      <div className="meta">
        <SafetyBadge level={item.risk.level} />
        {item.risk.permissions.slice(0, 3).map((p) => <span key={p} className="badge">{t(p)}</span>)}
      </div>
      <div className="row end">
        <button className="btn sm ghost" onClick={report}><Icon name="ShieldAlert" size={14} /> {t("atlas.report")}</button>
        <button className="btn sm primary" onClick={installIt}><Icon name="Download" size={14} /> {t("atlas.install")}</button>
      </div>
    </div>
  );
}

function PublishButton() {
  const t = useT();
  const flows = useStore((s) => s.flows);
  const toast = useStore((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [flowId, setFlowId] = useState("");
  const [category, setCategory] = useState<TemplateCategory>("clicking");
  const publish = async () => {
    const flow = flows.find((f) => f.id === flowId);
    if (!flow) return;
    if (!(await getToken())) return toast("warning", t("atlas.signInFirst"));
    try {
      await api("/v1/atlas/templates", { method: "POST", json: { flow, category, locale: getLocale() } });
      toast("success", t("atlas.published"));
      setOpen(false);
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };
  return (
    <>
      <button className="btn sm" onClick={() => setOpen(true)} disabled={!flows.length}><Icon name="Upload" size={15} /> {t("atlas.publish")}</button>
      {open && (
        <Modal title={t("atlas.publish")} icon="Upload" onClose={() => setOpen(false)} footer={<><button className="btn" onClick={() => setOpen(false)}>{t("common.cancel")}</button><button className="btn primary" onClick={publish} disabled={!flowId}>{t("atlas.publish")}</button></>}>
          <p className="small muted">{t("atlas.publishHint")}</p>
          <select className="select" value={flowId} onChange={(e) => setFlowId(e.target.value)} aria-label={t("editor.flow")}>
            <option value="">—</option>
            {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value as TemplateCategory)} aria-label={t("atlas.category")}>
            {TEMPLATE_CATEGORIES.map((c) => <option key={c} value={c}>{t(`atlas.cat.${c}`)}</option>)}
          </select>
        </Modal>
      )}
    </>
  );
}
