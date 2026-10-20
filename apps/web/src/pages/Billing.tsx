/**
 * Plan & billing: the license policy (personal use free; any other use needs a Business license),
 * the account's usage type, license-key activation and — once an operator has configured a
 * provider — one-time Business license purchases. The provider is fixed by the app language
 * (Korean → PortOne/KRW, others → PayPal/USD). Also the /billing/return page that PortOne
 * (mobile redirect) and PayPal send buyers back to, which shows the order's license key once.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  BILLING_CONTACT_EMAIL,
  BUSINESS_PRICES,
  LICENSE_KEY_PLACEHOLDER,
  PROVIDER_CURRENCY,
  formatPrice,
  normalizeLicenseKey,
  type BillingPeriod,
  type PaymentProvider,
  type PlanStatus,
} from "@autoflow/core";
import { Shell } from "../components/Shell";
import { Icon } from "../components/Icon";
import { EditionNote } from "../components/Edition";
import { LicensedDownloads } from "../components/TrialBanner";
import { Seg } from "../components/ui";
import { ApiError, auth, type User } from "../lib/api";
import { billingApi, providerForLocale, startCheckout, type BillingConfig, type BillingStatus, type LicenseDto, type OrderDto } from "../lib/billing";
import { SITE_URL } from "../lib/site";
import { useStore } from "../lib/store";
import { getLocale, useLocale, useT } from "../i18n";
import { hasNativeBridge } from "../platform";

const formatDate = (iso: string) => new Intl.DateTimeFormat(getLocale(), { dateStyle: "long" }).format(new Date(iso));

const STATUS_TONE: Record<PlanStatus, string> = { personal_free: "ok", business_free: "warn", business_active: "primary", business_required: "warn" };

function statusLabel(t: ReturnType<typeof useT>, s: BillingStatus | null, usageType: string | undefined): string {
  const status: PlanStatus = s?.status ?? (usageType === "business" ? "business_required" : "personal_free");
  if (status === "business_active") return t("billing.status.business_active", { date: formatDate(s!.entitlement!.validUntil) });
  // The free period for work use is over; "business_free" can only be a stale server clock.
  if (status === "business_free") return t("billing.status.business_required");
  return t(`billing.status.${status}`);
}

/** The policy in one place, as stated on the website's pricing page. */
export function BillingPolicy() {
  const t = useT();
  return (
    <div className="stack-sm small">
      <p style={{ margin: 0 }}>
        <b>{t("billing.policy.personal")}</b> {t("billing.policy.business")}
      </p>
      <p className="muted" style={{ margin: 0 }}>{t("billing.policy.honest")}</p>
    </div>
  );
}

function copy(text: string, toast: ReturnType<typeof useStore.getState>["toast"], t: ReturnType<typeof useT>) {
  navigator.clipboard.writeText(text).then(
    () => toast("success", t("billing.license.copied")),
    () => toast("error", t("billing.license.copyFailed")),
  );
}

/** A plaintext license key shown exactly once, with a copy button and a warning to keep it. */
export function IssuedKey({ licenseKey, title }: { licenseKey: string; title?: string }) {
  const t = useT();
  const toast = useStore((s) => s.toast);
  return (
    <div className="callout info stack-sm" style={{ display: "grid" }}>
      <b><Icon name="KeyRound" size={16} /> {title ?? t("billing.license.issuedTitle")}</b>
      <div className="row wrap" style={{ gap: 8 }}>
        <code className="mono license-key">{licenseKey}</code>
        <button className="btn sm" onClick={() => copy(licenseKey, toast, t)}><Icon name="Copy" size={14} /> {t("common.copy")}</button>
      </div>
      <small>{t("billing.license.issuedBody")}</small>
    </div>
  );
}

function RedeemForm({ onDone }: { onDone: (s: BillingStatus) => void }) {
  const t = useT();
  const toast = useStore((s) => s.toast);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const key = normalizeLicenseKey(value);
    // The checksum catches typos before anything is sent.
    if (!key) return setError(t("billing.license.invalid"));
    setBusy(true);
    setError(null);
    try {
      const r = await billingApi.redeem(key);
      setValue("");
      onDone(r.billing);
      toast("success", t("billing.license.done", { date: formatDate(r.redeemed.validUntil) }));
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      setError(code === "license_key_used" ? t("billing.license.used") : code === "license_key_revoked" ? t("billing.license.revoked") : code === "invalid_license_key" ? t("billing.license.invalid") : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack-sm" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <span className="label">{t("billing.license.title")}</span>
      <div className="row wrap" style={{ gap: 8 }}>
        <input
          className="input mono grow"
          style={{ minWidth: 0, flexBasis: 240 }}
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(null); }}
          placeholder={LICENSE_KEY_PLACEHOLDER}
          aria-label={t("billing.license.title")}
          autoComplete="off"
          spellCheck={false}
          maxLength={80}
        />
        <button className="btn" disabled={busy || !value.trim()}><Icon name="KeyRound" size={15} /> {t("billing.license.redeem")}</button>
      </div>
      {error ? <small className="hint" style={{ color: "var(--af-danger)" }}>{error}</small> : <small className="hint">{t("billing.license.hint")}</small>}
    </form>
  );
}

/** `purchase`: the /business page — buy buttons show for personal accounts too; paying switches the account to business. */
export function BillingSection({ user, onUser, purchase = false }: { user: User; onUser: (u: User) => void; purchase?: boolean }) {
  const t = useT();
  const loc = useLocale();
  const toast = useStore((s) => s.toast);
  const [config, setConfig] = useState<BillingConfig | null>(null);
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);

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

  // Fixed by language: Korean pays with PortOne in won, everyone else with PayPal in dollars.
  const provider: PaymentProvider = providerForLocale(loc);
  const providerReady = !!config?.providers[provider].enabled;

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
    if (!providerReady) return;
    if (!consent) return toast("info", t("billing.consentNeeded"));
    setBusy(true);
    try {
      // Buying a Business license means the account is used for work.
      if (user.usageType !== "business") onUser(await auth.update({ usageType: "business" }));
      const r = await startCheckout(provider, period);
      if (r.kind === "failed") toast("warning", t("billing.failed", { message: r.message }));
      else if (r.kind === "confirm") {
        const done = await billingApi.confirm(r.provider, r.paymentId);
        setStatus(done.billing);
        if (done.licenseKey) setNewKey(done.licenseKey);
        toast("success", t("billing.paid", { date: formatDate(done.billing.entitlement!.validUntil) }));
      }
    } catch (e) {
      toast("error", e instanceof ApiError && e.code === "payment_not_completed" ? t("billing.pendingCheck") : (e as Error).message);
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  const onRedeemed = (s: BillingStatus) => {
    setStatus(s);
    if (s.usageType !== user.usageType) onUser({ ...user, usageType: s.usageType });
  };

  const prices = config?.plans.business.prices ?? BUSINESS_PRICES;
  const currency = PROVIDER_CURRENCY[provider];
  const isBusiness = user.usageType === "business";
  const canBuy = isBusiness || purchase;
  const st = status?.status;
  const licensed = st === "business_active";

  return (
    <section className="card stack">
      <h3><Icon name="CreditCard" size={16} /> {t("billing.title")}</h3>
      <div className="row wrap">
        <span className={`badge ${STATUS_TONE[st ?? (isBusiness ? "business_required" : "personal_free")]}`}>{statusLabel(t, status, user.usageType)}</span>
      </div>
      {!licensed && <EditionNote />}
      <BillingPolicy />
      {(st === "business_required" || st === "business_free") && (
        <div className="callout warn small"><Icon name="Info" size={16} /> {t("billing.requiredBody")}</div>
      )}

      <div className="stack-sm">
        <span className="label">{t("billing.usageType")}</span>
        <Seg value={user.usageType ?? "personal"} onChange={(v) => void setUsage(v)} options={[{ value: "personal", label: t("billing.usage.personal"), icon: "User" }, { value: "business", label: t("billing.usage.business"), icon: "Boxes" }]} />
        <small className="hint">{t("billing.usageHint")}</small>
      </div>

      {failed && <p className="small muted">{t("billing.unavailable")}</p>}
      {newKey && <IssuedKey licenseKey={newKey} />}
      {purchase && licensed && <LicensedDownloads />}

      {canBuy && config && (!config.checkoutEnabled || !providerReady) && (
        <div className="callout info small"><Icon name="Info" size={16} /> {t("billing.checkoutOff", { email: BILLING_CONTACT_EMAIL })}</div>
      )}

      {canBuy && config?.checkoutEnabled && providerReady && (
        hasNativeBridge ? (
          // Native shells hand checkout to the browser, where the payment pages and the return URL work.
          <div className="row wrap">
            <span className="small muted">{t("billing.openBrowser")}</span>
            <a className="btn sm" href={`${SITE_URL}/app/#/business`} target="_blank" rel="noopener"><Icon name="ExternalLink" size={14} /> {t("billing.openBrowserBtn")}</a>
          </div>
        ) : (
          <div className="stack-sm">
            <span className="small muted">{t(`billing.payWith.${provider}`)}</span>
            <label className="row small" style={{ alignItems: "flex-start", gap: 8 }}>
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>
                {t("billing.consent")} <a href={`${SITE_URL}/${loc}/terms/`} target="_blank" rel="noopener">{t("settings.terms")}</a>
              </span>
            </label>
            <div className="row wrap">
              {(["month", "year"] as const).map((period) => (
                <button key={period} className={`btn${period === "year" ? " primary" : ""}`} disabled={busy || !consent} onClick={() => void buy(period)}>
                  <Icon name="CreditCard" size={15} /> {t(period === "month" ? "billing.buyMonth" : "billing.buyYear", { price: formatPrice(prices[period][currency], currency, loc) })}
                </button>
              ))}
            </div>
            <small className="hint">{t("billing.oneTime")}</small>
          </div>
        )
      )}

      {!canBuy && !licensed && (
        <div className="row wrap"><Link className="btn sm primary" to="/business"><Icon name="BadgeCheck" size={14} /> {t("business.cta")}</Link></div>
      )}

      <RedeemForm onDone={onRedeemed} />
      {!!status?.licenseKeys?.length && <Licenses keys={status.licenseKeys} />}
      {!!status?.orders.length && <Orders orders={status.orders} />}
      <small className="hint">{t("billing.contact", { email: BILLING_CONTACT_EMAIL })}</small>
    </section>
  );
}

function Licenses({ keys }: { keys: LicenseDto[] }) {
  const t = useT();
  return (
    <details className="small">
      <summary className="label" style={{ cursor: "pointer" }}>{t("billing.license.yours")}</summary>
      <div style={{ overflowX: "auto" }}>
        <table className="table" style={{ marginTop: 8 }}>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td className="mono">{k.key}</td>
                <td>{t(`billing.period.${k.period}`)}</td>
                <td>{t(`billing.license.source.${k.source}`)}</td>
                <td>{k.redeemedAt ? formatDate(k.redeemedAt) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
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
 * PayPal with ?provider=paypal&token=<order id>(&cancelled=1). The server does the verification
 * and, in the one response that settles the order, returns its license key to show once.
 */
export function BillingReturnPage() {
  const t = useT();
  const [params] = useSearchParams();
  const [state, setState] = useState<{ kind: "working" | "ok" | "pending" | "error" | "signin"; text: string; licenseKey?: string | null }>({ kind: "working", text: "" });

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
        return setState((prev) => ({ kind: "ok", text: t("billing.paid", { date: formatDate(r.billing.entitlement!.validUntil) }), licenseKey: r.licenseKey ?? prev.licenseKey ?? null }));
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
          {state.kind === "ok" && state.licenseKey && <IssuedKey licenseKey={state.licenseKey} />}
          <div className="row wrap">
            {state.kind === "pending" && <button className="btn" onClick={() => void run()}><Icon name="RotateCcw" size={15} /> {t("billing.retry")}</button>}
            <Link className="btn primary" to="/settings">{t("billing.backToSettings")}</Link>
          </div>
        </section>
      </div>
    </Shell>
  );
}
