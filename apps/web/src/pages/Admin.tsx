/**
 * Operator page (only for accounts the server reports as isAdmin): payment keys, prices,
 * recent orders, Business entitlements and the audit log. Secrets are write-only here — the
 * server returns whether each one is set and at most its last four characters.
 */
import { useCallback, useEffect, useState } from "react";
import { CURRENCIES, formatPrice, fromDecimalAmount, toDecimalAmount, type BillingPeriod, type Currency, type PriceTable } from "@autoflow/core";
import { Shell } from "../components/Shell";
import { Icon } from "../components/Icon";
import { Empty, Field, Seg, Switch } from "../components/ui";
import { api, auth, type User } from "../lib/api";
import { useStore } from "../lib/store";
import { getLocale, useLocale, useT } from "../i18n";

interface SecretView {
  set: boolean;
  last4: string | null;
}

interface AdminSettings {
  encryptionAvailable: boolean;
  portone: { enabled: boolean; ready: boolean; storeId: string; channelKey: string; apiSecret: SecretView };
  paypal: { enabled: boolean; ready: boolean; env: "live" | "sandbox"; clientId: string; clientSecret: SecretView };
  prices: PriceTable;
}

interface AdminOrder {
  id: string;
  provider: string;
  period: BillingPeriod;
  amount: number;
  currency: Currency;
  status: string;
  createdAt: string;
  buyerEmail: string;
  failureReason: string | null;
}

interface Lookup {
  user: { email: string; usageType: string; emailVerified: boolean };
  status: string;
  entitlement: { validUntil: string } | null;
}

interface AuditEntry {
  id: string;
  actorEmail: string;
  action: string;
  target: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

const when = (iso: string) => new Intl.DateTimeFormat(getLocale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

export function AdminPage() {
  const t = useT();
  const [me, setMe] = useState<User | null | undefined>(undefined);
  useEffect(() => {
    auth.me().then(setMe).catch(() => setMe(null));
  }, []);
  return (
    <Shell title={<h2>{t("admin.title")}</h2>}>
      <div className="page" style={{ maxWidth: 980 }}>
        {me === undefined ? (
          <p className="muted small">{t("common.loading")}</p>
        ) : !me?.isAdmin ? (
          <Empty icon="Shield" title={t("admin.forbidden")} />
        ) : (
          <>
            <KeysCard />
            <EntitlementCard />
            <OrdersCard />
            <AuditCard />
          </>
        )}
      </div>
    </Shell>
  );
}

function SecretInput({ label, view, value, onChange, onClear }: { label: string; view: SecretView; value: string; onChange: (v: string) => void; onClear: () => void }) {
  const t = useT();
  const hint = view.set ? (view.last4 ? t("admin.secretSet", { last4: view.last4 }) : t("admin.secretSetNoHint")) : t("admin.secretNotSet");
  return (
    <Field label={label} hint={`${hint} · ${t("admin.secretKeep")}`}>
      <div className="input-group">
        <input className="input mono" type="password" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder={view.set ? `••••${view.last4 ?? ""}` : ""} />
        {view.set && <button type="button" className="btn ghost" onClick={onClear}>{t("admin.clear")}</button>}
      </div>
    </Field>
  );
}

function KeysCard() {
  const t = useT();
  const loc = useLocale();
  const toast = useStore((s) => s.toast);
  const [s, setS] = useState<AdminSettings | null>(null);
  const [form, setForm] = useState({ portoneEnabled: false, storeId: "", channelKey: "", apiSecret: "", paypalEnabled: false, env: "sandbox" as "live" | "sandbox", clientId: "", clientSecret: "" });
  const [clear, setClear] = useState<{ apiSecret?: boolean; clientSecret?: boolean }>({});
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback((v: AdminSettings) => {
    setS(v);
    setForm({ portoneEnabled: v.portone.enabled, storeId: v.portone.storeId, channelKey: v.portone.channelKey, apiSecret: "", paypalEnabled: v.paypal.enabled, env: v.paypal.env, clientId: v.paypal.clientId, clientSecret: "" });
    setClear({});
    const p: Record<string, string> = {};
    for (const period of ["month", "year"] as const) for (const c of CURRENCIES) p[`${period}.${c}`] = toDecimalAmount(v.prices[period][c], c);
    setPrices(p);
  }, []);

  useEffect(() => {
    api<{ settings: AdminSettings }>("/v1/admin/billing/settings").then((r) => load(r.settings)).catch((e) => toast("error", (e as Error).message));
  }, [load, toast]);

  if (!s) return <p className="muted small">{t("common.loading")}</p>;

  const save = async () => {
    const pricePatch: Record<string, Record<string, number>> = {};
    for (const [k, v] of Object.entries(prices)) {
      const [period, cur] = k.split(".") as [BillingPeriod, Currency];
      const minor = fromDecimalAmount(v, cur);
      if (minor === null || minor <= 0) return toast("error", `${t("admin.prices")}: ${period} ${cur}`);
      (pricePatch[period] ??= {})[cur] = minor;
    }
    const body = {
      portone: { enabled: form.portoneEnabled, storeId: form.storeId, channelKey: form.channelKey, ...(form.apiSecret ? { apiSecret: form.apiSecret } : clear.apiSecret ? { apiSecret: null } : {}) },
      paypal: { enabled: form.paypalEnabled, env: form.env, clientId: form.clientId, ...(form.clientSecret ? { clientSecret: form.clientSecret } : clear.clientSecret ? { clientSecret: null } : {}) },
      prices: pricePatch,
    };
    setBusy(true);
    try {
      const r = await api<{ settings: AdminSettings }>("/v1/admin/billing/settings", { method: "PUT", json: body });
      load(r.settings);
      toast("success", t("admin.saved"));
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const f = <K extends keyof typeof form>(k: K) => (v: (typeof form)[K]) => setForm((x) => ({ ...x, [k]: v }));
  const readyBadge = (ready: boolean) => <span className={`badge ${ready ? "ok" : "warn"}`}>{ready ? t("admin.ready") : t("admin.notReady")}</span>;

  return (
    <section className="card stack">
      <h3><Icon name="KeyRound" size={16} /> {t("admin.keys")}</h3>
      {!s.encryptionAvailable && <div className="callout warn small"><Icon name="ShieldAlert" size={16} /> {t("admin.encryptionMissing")}</div>}
      <div className="grid cols-2">
        <div className="stack-sm">
          <div className="row between"><b>PortOne · KCP (KRW)</b>{readyBadge(s.portone.ready)}</div>
          <div className="row between"><span className="label">{t("admin.enabled")}</span><Switch checked={form.portoneEnabled} onChange={f("portoneEnabled")} label={t("admin.enabled")} /></div>
          <Field label={t("admin.storeId")}><input className="input mono" value={form.storeId} onChange={(e) => f("storeId")(e.target.value.trim())} /></Field>
          <Field label={t("admin.channelKey")}><input className="input mono" value={form.channelKey} onChange={(e) => f("channelKey")(e.target.value.trim())} /></Field>
          <SecretInput label={t("admin.apiSecret")} view={clear.apiSecret ? { set: false, last4: null } : s.portone.apiSecret} value={form.apiSecret} onChange={f("apiSecret")} onClear={() => setClear((c) => ({ ...c, apiSecret: true }))} />
        </div>
        <div className="stack-sm">
          <div className="row between"><b>PayPal (USD)</b>{readyBadge(s.paypal.ready)}</div>
          <div className="row between"><span className="label">{t("admin.enabled")}</span><Switch checked={form.paypalEnabled} onChange={f("paypalEnabled")} label={t("admin.enabled")} /></div>
          <Field label={t("admin.env")}><Seg value={form.env} onChange={f("env")} options={[{ value: "sandbox", label: "Sandbox" }, { value: "live", label: "Live" }]} /></Field>
          <Field label={t("admin.clientId")}><input className="input mono" value={form.clientId} onChange={(e) => f("clientId")(e.target.value.trim())} /></Field>
          <SecretInput label={t("admin.clientSecret")} view={clear.clientSecret ? { set: false, last4: null } : s.paypal.clientSecret} value={form.clientSecret} onChange={f("clientSecret")} onClear={() => setClear((c) => ({ ...c, clientSecret: true }))} />
        </div>
      </div>
      <h4 style={{ margin: 0 }}>{t("admin.prices")}</h4>
      <div className="grid cols-2">
        {(["month", "year"] as const).flatMap((period) =>
          CURRENCIES.map((c) => (
            <Field key={`${period}.${c}`} label={`${t(`billing.period.${period}`)} · ${c}`} hint={fromDecimalAmount(prices[`${period}.${c}`] ?? "", c) ? formatPrice(fromDecimalAmount(prices[`${period}.${c}`]!, c)!, c, loc) : undefined}>
              <input className="input mono" inputMode="decimal" value={prices[`${period}.${c}`] ?? ""} onChange={(e) => setPrices((p) => ({ ...p, [`${period}.${c}`]: e.target.value }))} />
            </Field>
          )),
        )}
      </div>
      <div className="row"><button className="btn primary" disabled={busy} onClick={() => void save()}><Icon name="Save" size={15} /> {t("common.save")}</button></div>
    </section>
  );
}

function EntitlementCard() {
  const t = useT();
  const toast = useStore((s) => s.toast);
  const [email, setEmail] = useState("");
  const [months, setMonths] = useState(1);
  const [note, setNote] = useState("");
  const [found, setFound] = useState<Lookup | null>(null);

  const lookup = async () => {
    try {
      setFound(await api<Lookup>(`/v1/admin/billing/users?email=${encodeURIComponent(email)}`));
    } catch (e) {
      setFound(null);
      toast("error", (e as Error).message);
    }
  };
  const change = async (action: "grant" | "revoke") => {
    try {
      await api("/v1/admin/billing/entitlements", { method: "POST", json: { email, action, ...(action === "grant" ? { months } : {}), ...(note ? { note } : {}) } });
      toast("success", t("admin.granted"));
      await lookup();
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };

  return (
    <section className="card stack">
      <h3><Icon name="BadgeCheck" size={16} /> {t("admin.entitlements")}</h3>
      <form className="row wrap" onSubmit={(e) => { e.preventDefault(); void lookup(); }}>
        <input className="input grow" type="email" required placeholder={t("admin.email")} aria-label={t("admin.email")} value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="btn"><Icon name="Search" size={15} /> {t("admin.lookup")}</button>
      </form>
      {found && (
        <div className="stack-sm">
          <div className="row wrap small">
            <b>{found.user.email}</b>
            <span className="badge">{found.user.usageType}</span>
            <span className="badge">{found.status}</span>
            <span className="muted">{found.entitlement ? t("admin.validUntil", { date: when(found.entitlement.validUntil) }) : t("admin.noEntitlement")}</span>
          </div>
          <div className="row wrap">
            <label className="row small">{t("admin.months")} <input className="input" type="number" min={1} max={120} value={months} onChange={(e) => setMonths(Math.max(1, Math.min(120, Number(e.target.value) || 1)))} style={{ width: 90 }} /></label>
            <input className="input grow" placeholder={t("admin.note")} aria-label={t("admin.note")} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
            <button className="btn primary" onClick={() => void change("grant")}>{t("admin.grant")}</button>
            <button className="btn danger" onClick={() => void change("revoke")}>{t("admin.revoke")}</button>
          </div>
        </div>
      )}
    </section>
  );
}

function OrdersCard() {
  const t = useT();
  const loc = useLocale();
  const [status, setStatus] = useState("");
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const load = useCallback(() => {
    api<{ orders: AdminOrder[] }>(`/v1/admin/billing/orders?limit=100${status ? `&status=${status}` : ""}`).then((r) => setOrders(r.orders)).catch(() => setOrders([]));
  }, [status]);
  useEffect(load, [load]);
  return (
    <section className="card stack">
      <div className="row between">
        <h3><Icon name="ListOrdered" size={16} /> {t("admin.orders")}</h3>
        <div className="row">
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("admin.orders")}>
            <option value="">{t("admin.allStatuses")}</option>
            {(["pending", "paid", "failed", "cancelled"] as const).map((s) => <option key={s} value={s}>{t(`billing.order.status.${s}`)}</option>)}
          </select>
          <button className="btn ghost icon sm" onClick={load} aria-label={t("common.refresh")}><Icon name="RotateCcw" size={15} /></button>
        </div>
      </div>
      {!orders ? (
        <p className="muted small">{t("common.loading")}</p>
      ) : !orders.length ? (
        <p className="muted small">{t("admin.noOrders")}</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="table small">
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>{when(o.createdAt)}</td>
                  <td>{o.buyerEmail}</td>
                  <td>{o.provider}</td>
                  <td>{t(`billing.period.${o.period}`)}</td>
                  <td>{formatPrice(o.amount, o.currency, loc)}</td>
                  <td><span className={`badge ${o.status === "paid" ? "ok" : o.status === "failed" ? "err" : ""}`} title={o.failureReason ?? undefined}>{t(`billing.order.status.${o.status}`)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AuditCard() {
  const t = useT();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  useEffect(() => {
    api<{ entries: AuditEntry[] }>("/v1/admin/billing/audit?limit=50").then((r) => setEntries(r.entries)).catch(() => setEntries([]));
  }, []);
  return (
    <section className="card stack-sm">
      <h3><Icon name="ScrollText" size={16} /> {t("admin.audit")}</h3>
      {!entries ? (
        <p className="muted small">{t("common.loading")}</p>
      ) : (
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {entries.map((e) => (
            <li key={e.id}>
              <span className="muted">{when(e.createdAt)}</span> · {e.actorEmail} · <code>{e.action}</code>
              {e.target ? ` · ${e.target}` : ""}
              {Array.isArray(e.details.changed) ? ` · ${(e.details.changed as string[]).join(", ")}` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
