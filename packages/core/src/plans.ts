/**
 * Plans, prices and the usage policy for the optional encrypted Sync account — the one place the
 * API (entitlement gate, checkout amounts), the web app (Billing section) and the site (pricing
 * copy) read them from.
 *
 * Policy ("license approach"):
 * - Personal (individual, non-commercial) use of AutoFlow is free, including Sync.
 * - Any other use (business, organisation, commercial, work) needs a Business license from
 *   BUSINESS_PLAN_REQUIRED_FROM (2026-10-20 00:00 in Asia/Seoul). Local features stay available
 *   (honour-based licence); the only technical gate is Sync writes for business accounts, and
 *   only while a payment provider is configured.
 * - Reads, export and deletion are never blocked, paid or not.
 * - A Business license can also be delivered as a license key (see license.ts).
 *
 * Payments are one-time purchases of 1 or 12 months of Business entitlement (no stored cards,
 * no auto-renewal); a purchase extends whatever entitlement is still running.
 */

export const USAGE_TYPES = ["personal", "business"] as const;
export type UsageType = (typeof USAGE_TYPES)[number];
export const DEFAULT_USAGE_TYPE: UsageType = "personal";

export const PLAN_IDS = ["business"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/** One-time purchase lengths. */
export const BILLING_PERIODS = ["month", "year"] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];
export const PERIOD_MONTHS: Record<BillingPeriod, number> = { month: 1, year: 12 };

export const CURRENCIES = ["KRW", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];
/** Digits after the decimal point; amounts are always stored as integers in minor units. */
export const CURRENCY_DECIMALS: Record<Currency, number> = { KRW: 0, USD: 2 };

export const PAYMENT_PROVIDERS = ["portone", "paypal"] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];
/** PortOne (KCP) charges in won; PayPal charges in US dollars. */
export const PROVIDER_CURRENCY: Record<PaymentProvider, Currency> = { portone: "KRW", paypal: "USD" };

export type PriceTable = Record<BillingPeriod, Record<Currency, number>>;

/**
 * Business plan list prices in minor units (₩9,900 / US$7.99 a month, ₩99,000 / US$79.99 a year).
 * Change them here; an administrator can also override them at runtime (stored server-side).
 */
export const BUSINESS_PRICES: PriceTable = {
  month: { KRW: 9_900, USD: 799 },
  year: { KRW: 99_000, USD: 7_999 },
};

/** Sync itself costs nothing for personal use; business use is covered by the Business license. */
export const SYNC_LAUNCH_PRICE: Record<Currency, number> = { KRW: 0, USD: 0 };

/** Last moment non-personal use was free: 2026-10-19 23:59:59 in Seoul (KST, UTC+9). */
export const BUSINESS_FREE_UNTIL = "2026-10-19T23:59:59+09:00";
/** First instant a Business license is required (exclusive end of the free period). */
export const BUSINESS_PLAN_REQUIRED_FROM = "2026-10-20T00:00:00+09:00";
const REQUIRED_FROM_MS = Date.parse(BUSINESS_PLAN_REQUIRED_FROM);

export const POLICY_TIME_ZONE = "Asia/Seoul";
export const BILLING_CONTACT_EMAIL = "projectteamforyou@gmail.com";

/** True once the free period for non-personal use has ended. */
export function isBusinessGraceOver(now: Date): boolean {
  return now.getTime() >= REQUIRED_FROM_MS;
}

export type PlanStatus =
  /** Personal use — free. */
  | "personal_free"
  /** Business use inside the free period. */
  | "business_free"
  /** Business use with a paid entitlement that is still valid. */
  | "business_active"
  /** Business use after the free period with no valid entitlement: Sync writes are blocked. */
  | "business_required";

export interface PlanState {
  usageType: UsageType;
  /** End of the paid Business entitlement, if any (may be in the past). */
  validUntil?: Date | null;
}

export function planStatus(state: PlanState, now: Date): PlanStatus {
  if (state.usageType !== "business") return "personal_free";
  if (state.validUntil && state.validUntil.getTime() > now.getTime()) return "business_active";
  return isBusinessGraceOver(now) ? "business_required" : "business_free";
}

/** Whether a Sync write must be refused with `business_plan_required`. Reads/export/delete never are. */
export function requiresBusinessPlan(state: PlanState, now: Date): boolean {
  return planStatus(state, now) === "business_required";
}

/** Calendar-month addition in UTC, clamping to the last day of the month (Jan 31 + 1 → Feb 28/29). */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/**
 * New end of a Business entitlement after buying `period`: it extends a running entitlement,
 * or starts now if there is none (or it has lapsed).
 */
export function extendEntitlement(current: Date | null | undefined, now: Date, period: BillingPeriod): Date {
  const base = current && current.getTime() > now.getTime() ? current : now;
  return addMonths(base, PERIOD_MONTHS[period]);
}

export function priceFor(period: BillingPeriod, currency: Currency, table: PriceTable = BUSINESS_PRICES): number {
  return table[period][currency];
}

/** Minor units → decimal string as payment APIs expect it (USD 799 → "7.99", KRW 9900 → "9900"). */
export function toDecimalAmount(amount: number, currency: Currency): string {
  const d = CURRENCY_DECIMALS[currency];
  if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError(`invalid amount ${amount}`);
  if (d === 0) return String(amount);
  const s = String(amount).padStart(d + 1, "0");
  return `${s.slice(0, -d)}.${s.slice(-d)}`;
}

/** Decimal string → minor units; null when it is not an exact amount in that currency. */
export function fromDecimalAmount(value: string, currency: Currency): number | null {
  const d = CURRENCY_DECIMALS[currency];
  const m = /^(\d{1,12})(?:\.(\d+))?$/.exec(value.trim());
  if (!m) return null;
  const frac = (m[2] ?? "").replace(/0+$/, "");
  if (frac.length > d) return null;
  return Number(m[1]) * 10 ** d + Number(frac.padEnd(d, "0") || "0");
}

/** Localised price label, e.g. "₩9,900" or "$7.99". */
export function formatPrice(amount: number, currency: Currency, locale = "en"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: CURRENCY_DECIMALS[currency], maximumFractionDigits: CURRENCY_DECIMALS[currency] }).format(
    amount / 10 ** CURRENCY_DECIMALS[currency],
  );
}

/** Localised policy date ("October 25, 2026", "2026년 10월 25일" …), always as seen in Seoul. */
export function formatPolicyDate(iso: string, locale = "en"): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: POLICY_TIME_ZONE }).format(new Date(iso));
}

/** Korean users pay in won through PortOne (KCP); everyone else through PayPal. Users can switch. */
export function preferredProvider(locale: string): PaymentProvider {
  return locale.toLowerCase().startsWith("ko") ? "portone" : "paypal";
}
