import { SITE_URL } from "../lib/site";
import { Link, useNavigate } from "react-router-dom";
import { TEMPLATES, describeTrigger } from "@autoflow/core";
import { Shell } from "../components/Shell";
import { Icon } from "../components/Icon";
import { StudioPromoCard } from "../components/StudioPromo";
import { TrialHero } from "../components/TrialBanner";
import { FlowIcon, SafetyBadge } from "../components/ui";
import { useStore } from "../lib/store";
import { formatDuration, formatRelative, tp, useT } from "../i18n";
import { hasNativeBridge } from "../platform";
import { startFlow } from "../lib/actions";

const QUICK = [
  { kind: "click", icon: "MousePointerClick", color: "#7C5CFF" },
  { kind: "multiClick", icon: "Target", color: "#22C3A6" },
  { kind: "keys", icon: "Keyboard", color: "#3B82F6" },
  { kind: "record", icon: "Radio", color: "#EF4444" },
  { kind: "pro", icon: "Workflow", color: "#F59E0B" },
  { kind: "keyforge", icon: "KeyRound", color: "#EC4899" },
];

export function Home() {
  const t = useT();
  const navigate = useNavigate();
  const flows = useStore((s) => s.flows);
  const runs = useStore((s) => s.runs);
  const mode = useStore((s) => s.settings.defaultMode);
  const quick = mode === "pro" ? [QUICK[4]!, QUICK[3]!, QUICK[0]!, QUICK[1]!, QUICK[2]!, QUICK[5]!] : QUICK;
  const favorites = flows.filter((f) => f.favorite).slice(0, 6);
  const recent = flows.slice(0, 6);
  const picks = TEMPLATES.slice(0, 4);
  const hour = new Date().getHours();
  const greet = hour < 5 ? "home.greet.night" : hour < 12 ? "home.greet.morning" : hour < 18 ? "home.greet.afternoon" : "home.greet.evening";
  const week = runs.filter((r) => r.startedAt > Date.now() - 7 * 86_400_000);
  const ok = week.filter((r) => r.status === "completed").length;

  return (
    <Shell title={<h2>{t("nav.home")}</h2>}>
      <div className="page">
        <TrialHero />
        <section className="hero">
          <h1>
            {t(greet)} <span className="gradient-text">{t("home.headline")}</span>
          </h1>
          <p>{t(mode === "pro" ? "home.subPro" : "home.sub")}</p>
          <div className="quick">
            {quick.map((q) => (
              <button key={q.kind} onClick={() => navigate(q.kind === "keyforge" ? "/keyforge" : `/new/${q.kind}`)}>
                <div className="tile-icon" style={{ background: `linear-gradient(135deg, ${q.color}, ${q.color}aa)` }}>
                  <Icon name={q.icon} />
                </div>
                <div>
                  <b>{t(`home.quick.${q.kind === "multiClick" ? "multi" : q.kind}`)}</b>
                  <small style={{ display: "block" }}>{t(`home.quick.${q.kind === "multiClick" ? "multi" : q.kind}.desc`)}</small>
                </div>
              </button>
            ))}
          </div>
        </section>

        <div className="grid cols-4">
          <Stat icon="Workflow" label={t("home.stat.flows")} value={String(flows.length)} />
          <Stat icon="Play" label={t("home.stat.runs7")} value={String(week.length)} />
          <Stat icon="BadgeCheck" label={t("home.stat.success")} value={week.length ? `${Math.round((ok / week.length) * 100)}%` : "—"} />
          <Stat icon="Timer" label={t("home.stat.time")} value={formatDuration(week.reduce((a, r) => a + r.durationMs, 0))} />
        </div>

        {favorites.length > 0 && (
          <section className="stack">
            <div className="row between">
              <h2>{t("home.favorites")}</h2>
            </div>
            <div className="grid auto">
              {favorites.map((f) => (
                <FlowCard key={f.id} id={f.id} />
              ))}
            </div>
          </section>
        )}

        <section className="stack">
          <div className="row between">
            <h2>{t("home.recent")}</h2>
            <Link className="btn sm ghost" to="/flows">{t("common.viewAll")} <Icon name="ChevronRight" size={14} /></Link>
          </div>
          {recent.length ? (
            <div className="grid auto">
              {recent.map((f) => (
                <FlowCard key={f.id} id={f.id} />
              ))}
            </div>
          ) : (
            <div className="card">
              <div className="empty">
                <div className="tile-icon"><Icon name="Sparkles" size={26} /></div>
                <h3>{t("home.empty.title")}</h3>
                <p className="small">{t("home.empty.body")}</p>
                <div className="row wrap" style={{ justifyContent: "center" }}>
                  <button className="btn primary" onClick={() => navigate(mode === "pro" ? "/new/pro" : "/new/click")}><Icon name="Plus" size={16} /> {t(mode === "pro" ? "home.quick.pro" : "home.quick.click")}</button>
                  <button className="btn" onClick={() => navigate("/atlas")}><Icon name="Map" size={16} /> {t("nav.atlas")}</button>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="stack">
          <div className="row between">
            <h2>{t("home.atlasPicks")}</h2>
            <Link className="btn sm ghost" to="/atlas">{t("nav.atlas")} <Icon name="ChevronRight" size={14} /></Link>
          </div>
          <div className="grid cols-4">
            {picks.map((tpl) => (
              <Link key={tpl.id} to={`/atlas/${tpl.id}`} className="card hover flow-card">
                <div className="row">
                  <FlowIcon flow={tpl.flow} size={36} />
                  <b className="grow truncate">{t(`tpl.${tpl.id}.name`)}</b>
                </div>
                <p className="small muted">{t(`tpl.${tpl.id}.desc`)}</p>
                <div className="meta">
                  <SafetyBadge flow={tpl.flow} />
                  <span className="badge">{t(`atlas.cat.${tpl.category}`)}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {runs.length > 0 && (
          <section className="stack">
            <div className="row between">
              <h2>{t("home.lastRuns")}</h2>
              <Link className="btn sm ghost" to="/ledger">{t("nav.ledger")} <Icon name="ChevronRight" size={14} /></Link>
            </div>
            <div className="card" style={{ padding: 0 }}>
              <table className="table">
                <tbody>
                  {runs.slice(0, 5).map((r) => (
                    <tr key={r.id} onClick={() => navigate(`/ledger/${r.id}`)} style={{ cursor: "pointer" }}>
                      <td><RunStatus status={r.status} /></td>
                      <td className="truncate" style={{ maxWidth: 260 }}>{r.flowName}</td>
                      <td className="muted small">{formatRelative(r.startedAt)}</td>
                      <td className="muted small">{formatDuration(r.durationMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        <StudioPromoCard />
      </div>
    </Shell>
  );
}

function Stat({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="card row">
      <div className="tile-icon" style={{ background: "var(--af-surface-2)", color: "var(--af-text)" }}>
        <Icon name={icon} />
      </div>
      <div>
        <div className="small muted">{label}</div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
      </div>
    </div>
  );
}

export function RunStatus({ status }: { status: string }) {
  const t = useT();
  const cls = status === "completed" ? "ok" : status === "failed" ? "err" : status === "stopped" ? "warn" : "primary";
  return <span className={`badge ${cls}`}>{t(`run.status.${status}`)}</span>;
}

export function FlowCard({ id }: { id: string }) {
  const t = useT();
  const flow = useStore((s) => s.flows.find((f) => f.id === id));
  const save = useStore((s) => s.saveFlow);
  const navigate = useNavigate();
  if (!flow) return null;
  return (
    <div className="card hover flow-card" onClick={() => navigate(`/flows/${flow.id}`)} role="link" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && navigate(`/flows/${flow.id}`)}>
      <div className="row">
        <FlowIcon flow={flow} />
        <div className="grow" style={{ minWidth: 0 }}>
          <b className="truncate" style={{ display: "block" }}>{flow.name}</b>
          <span className="small muted truncate" style={{ display: "block" }}>{tp(describeTrigger(flow.trigger))}</span>
        </div>
        <button
          className="btn ghost icon sm"
          aria-label={t("flows.favorite")}
          onClick={(e) => {
            e.stopPropagation();
            void save({ ...flow, favorite: !flow.favorite }, { snapshot: false });
          }}
        >
          <Icon name="Star" size={16} className={flow.favorite ? "gradient-text" : ""} strokeWidth={flow.favorite ? 3 : 2} />
        </button>
      </div>
      <div className="meta">
        <span className="badge">{flow.mode === "easy" ? t("mode.easy") : t("mode.pro")}</span>
        <SafetyBadge flow={flow} />
        {flow.tags.slice(0, 2).map((tag) => (
          <span key={tag} className="badge">#{tag}</span>
        ))}
      </div>
      <div className="row between">
        <span className="small subtle">{formatRelative(Date.parse(flow.updatedAt))}</span>
        <button
          className="btn sm primary"
          onClick={(e) => {
            e.stopPropagation();
            void startFlow(flow, navigate);
          }}
        >
          <Icon name="Play" size={14} /> {t("flows.run")}
        </button>
      </div>
    </div>
  );
}
