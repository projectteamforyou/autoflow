/**
 * Plan & billing: the Sync policy (free during launch, personal use free, business use free until
 * BUSINESS_FREE_UNTIL), the account's usage type, and — for business use once an operator has
 * configured a provider — one-time Business plan purchases. Also the /billing/return page that
 * PortOne (mobile redirect) and PayPal send buyers back to.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  BILLING_CONTACT_EMAIL,
  BUSINESS_FREE_UNTIL,
  BUSINESS_PRICES,
  PROVIDER_CURRENCY,
  formatPolicyDate,
  formatPrice,
  preferredProvider,
  type BillingPeriod,
  type PaymentProvider,
  type PlanStatus,
} from "@autoflow/core";
import { Shell } from "../components/Shell";
import { Icon } from "../components/Icon";
import { Seg } from "../components/ui";
import { ApiError, auth, type User } from "../lib/api";
import { billingApi, startCheckout, type BillingConfig, type BillingStatus, type OrderDto } from "../lib/billing";
import { SITE_URL } from "../lib/site";
import { useStore } from "../lib/store";
import { getLocale, useLocale, useT } from "../i18n";
import { hasNativeBridge } from "../platform";

const formatDate = (iso: string) => new Intl.DateTimeFormat(getLocale(), { dateStyle: "long" }).format(new Date(iso));

const STATUS_TONE: Record<PlanStatus, string> = { personal_free: "ok", business_free: "ok", business_active: "primary", business_required: "warn" };

function statusLabel(t: ReturnType<typeof useT>, s: BillingStatus | null, usageType: string | undefined): string {
  const freeUntil = formatPolicyDate(BUSINESS_FREE_UNTIL, getLocale());
  const status: PlanStatus = s?.status ?? (usageType === "business" ? "business_free" : "personal_free");
  if (status === "business_active") return t("billing.status.business_active", { date: formatDate(s!.entitlement!.validUntil) });
  if (status === "business_free") return t("billing.status.business_free", { date: freeUntil });
  return t(`billing.status.${status}`);
}

/** The policy in one place, as stated on the website's pricing page. */
export function BillingPolicy() {
  const t = useT();
  const loc = useLocale();
  return (
    <div className="stack-sm small">
      <p style={{ margin: 0 }}>
        <b>{t("billing.policy.sync")}</b> {t("billing.policy.personal")} {t("billing.policy.business", { date: formatPolicyDate(BUSINESS_FREE_UNTIL, loc) })}
      </p>
      <p className="muted" style={{ margin: 0 }}>{t("billing.policy.later")}</p>
    </div>
  );
}

export function BillingSection({ user, onUser }: { user: User; onUser: (u: User) => void }) {
  const t = useT();
  const loc = useLocale();
  const toast = useStore((s) => s.toast);
  const [config, setConfig] = useState<BillingConfig | null>(null);
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [provider, setProvider] = useState<PaymentProvider>(preferredProvider(loc));
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([billingApi.config(), billingApi.status()]);
      setConfig(c);
      setStatus(s);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => void refresh(), [refresh, user.usageType]);

  // Prefer the locale's provider, but fall back to whichever one is enabled.
  const enabled = (["portone", "paypal"] as const).filter((p) => config?.providers[p].enabled);
  const active: PaymentProvider | undefined = enabled.includes(provider) ? provider : enabled[0];

  const setUsage = async (usageType: "personal" | "business") => {
    if (usageType === user.usageType) return;
    try {
      onUser(await auth.update({ usageType }));
      toast("success", t("billing.usageSaved"));
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };

  const buy = async (period: BillingPeriod) => {
    if (!active) return;
    if (!consent) return toast("info", t("billing.consentNeeded"));
    setBusy(true);
    try {
      const r = await startCheckout(active, period);
      if (r.kind === "failed") toast("warning", t("billing.failed", { message: r.message }));
      else if (r.kind === "confirm") {
        const done = await billingApi.confirm(r.provider, r.paymentId);
        setStatus(done.billing);
        toast("success", t("billing.paid", { date: formatDate(done.billing.entitlement!.validUntil) }));
      }
    } catch (e) {
      toast("error", e instanceof ApiError && e.code === "payment_not_completed" ? t("billing.pendingCheck") : (e as Error).message);
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  const prices = config?.plans.business.prices ?? BUSINESS_PRICES;
  const isBusiness = user.usageType === "business";
  const st = status?.status;

  return (
    <section className="card stack">
      <h3><Icon name="CreditCard" size={16} /> {t("billing.title")}</h3>
      <div className="row wrap">
        <span className={`badge ${STATUS_TONE[st ?? (isBusiness ? "business_free" : "personal_free")]}`}>{statusLabel(t, status, user.usageType)}</span>
      </div>
      <BillingPolicy />
      {st === "business_required" && (
        <div className="callout warn small"><Icon name="Info" size={16} /> {t("billing.requiredBody", { date: formatPolicyDate(BUSINESS_FREE_UNTIL, loc) })}</div>
      )}

      <div className="stack-sm">
        <span className="label">{t("billing.usageType")}</span>
        <Seg value={user.usageType ?? "personal"} onChange={(v) => void setUsage(v)} options={[{ value: "personal", label: t("billing.usage.personal"), icon: "User" }, { value: "business", label: t("billing.usage.business"), icon: "Boxes" }]} />
        <small className="hint">{t("billing.usageHint")}</small>
      </div>

      {failed && <p className="small muted">{t("billing.unavailable")}</p>}

      {isBusiness && config && !config.checkoutEnabled && <div className="callout info small"><Icon name="Info" size={16} /> {t("billing.checkoutOff")}</div>}

      {isBusiness && config?.checkoutEnabled && active && (
        hasNativeBridge ? (
          // Native shells hand checkout to the browser, where the payment pages and the return URL work.
          <div className="row wrap">
            <span className="small muted">{t("billing.openBrowser")}</span>
            <a className="btn sm" href={`${SITE_URL}/app/#/settings`} target="_blank" rel="noopener"><Icon name="ExternalLink" size={14} /> {t("billing.openBrowserBtn")}</a>
          </div>
        ) : (
          <div className="stack-sm">
            {enabled.length > 1 && (
              <>
                <span className="label">{t("billing.provider")}</span>
                <Seg value={active} onChange={setProvider} options={enabled.map((p) => ({ value: p, label: t(`billing.provider.${p}`) }))} />
              </>
            )}
            <label className="row small" style={{ alignItems: "flex-start", gap: 8 }}>
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>
                {t("billing.consent")} <a href={`${SITE_URL}/${loc}/terms/`} target="_blank" rel="noopener">{t("settings.terms")}</a>
              </span>
            </label>
            <div className="row wrap">
              {(["month", "year"] as const).map((period) => (
                <button key={period} className={`btn${period === "year" ? " primary" : ""}`} disabled={busy || !consent} onClick={() => void buy(period)}>
                  <Icon name="CreditCard" size={15} /> {t(period === "month" ? "billing.buyMonth" : "billing.buyYear", { price: formatPrice(prices[period][PROVIDER_CURRENCY[active]], PROVIDER_CURRENCY[active], loc) })}
                </button>
              ))}
            </div>
            <small className="hint">{t("billing.oneTime")}</small>
          </div>
        )
      )}

      {!!status?.orders.length && <Orders orders={status.orders} />}
      <small className="hint">{t("billing.contact", { email: BILLING_CONTACT_EMAIL })}</small>
    </section>
  );
}

function Orders({ orders }: { orders: OrderDto[] }) {
  const t = useT();
  const loc = useLocale();
  const tone = { paid: "ok", pending: "", failed: "err", cancelled: "" } as const;
  return (
    <details className="small">
      <summary className="label" style={{ cursor: "pointer" }}>{t("billing.orders")}</summary>
      <table className="table" style={{ marginTop: 8 }}>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td>{formatDate(o.createdAt)}</td>
              <td>{t(`billing.period.${o.period}`)}</td>
              <td>{formatPrice(o.amount, o.currency, loc)}</td>
              <td><span className={`badge ${tone[o.status]}`}>{t(`billing.order.status.${o.status}`)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/**
 * /billing/return — PortOne mobile redirects arrive with ?paymentId=…(&code=…&message=…);
 * PayPal with ?provider=paypal&token=<order id>(&cancelled=1). The server does the verification.
 */
export function BillingReturnPage() {
  const t = useT();
  const [params] = useSearchParams();
  const [state, setState] = useState<{ kind: "working" | "ok" | "pending" | "error" | "signin"; text: string }>({ kind: "working", text: "" });

  const provider: PaymentProvider = params.get("provider") === "paypal" || (params.has("token") && !params.has("paymentId")) ? "paypal" : "portone";
  const paymentId = provider === "paypal" ? params.get("token") : params.get("paymentId");

  const run = useCallback(async () => {
    if (params.get("cancelled") === "1") return setState({ kind: "error", text: t("billing.cancelled") });
    const code = params.get("code");
    if (code) return setState({ kind: "error", text: t("billing.failed", { message: params.get("message") || code }) });
    if (!paymentId) return setState({ kind: "error", text: t("billing.failed", { message: "missing payment id" }) });
    if (!(await auth.me().catch(() => null))) return setState({ kind: "signin", text: t("billing.signInFirst") });
    setState({ kind: "working", text: t("billing.verifying") });
    // A card payment can take a moment to settle at the PG; ask a few times before giving up.
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await billingApi.confirm(provider, paymentId);
        return setState({ kind: "ok", text: t("billing.paid", { date: formatDate(r.billing.entitlement!.validUntil) }) });
      } catch (e) {
        if (e instanceof ApiError && e.code === "payment_not_completed" && attempt < 4) {
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          continue;
        }
        if (e instanceof ApiError && e.code === "payment_not_completed") return setState({ kind: "pending", text: t("billing.pendingCheck") });
        return setState({ kind: "error", text: e instanceof ApiError && e.code === "payment_failed" ? t("billing.failed", { message: e.message }) : (e as Error).message });
      }
    }
  }, [params, paymentId, provider, t]);

  useEffect(() => void run(), [run]);

  const icon = state.kind === "ok" ? "BadgeCheck" : state.kind === "working" ? "Hourglass" : "Info";
  return (
    <Shell title={<h2>{t("billing.returnTitle")}</h2>}>
      <div className="page" style={{ maxWidth: 640 }}>
        <section className="card stack">
          <div className={`callout ${state.kind === "ok" ? "info" : state.kind === "error" ? "err" : state.kind === "working" ? "" : "warn"}`}>
            <Icon name={icon} size={18} /> <span>{state.text || t("billing.verifying")}</span>
          </div>
          <div className="row wrap">
            {state.kind === "pending" && <button className="btn" onClick={() => void run()}><Icon name="RotateCcw" size={15} /> {t("billing.retry")}</button>}
            <Link className="btn primary" to="/settings">{t("billing.backToSettings")}</Link>
          </div>
        </section>
      </div>
    </Shell>
  );
}
