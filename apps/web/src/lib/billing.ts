/**
 * Business plan checkout for the Sync account. Prices and policy come from @autoflow/core and
 * /v1/billing/config; the server creates every order and verifies every payment itself — this
 * file only starts checkout and reports where the buyer came back.
 *
 * - PortOne (KCP, KRW): the V2 browser SDK in an in-page iframe on PC and a same-tab redirect on
 *   mobile (windowType { pc: IFRAME, mobile: REDIRECTION }). Never a popup or new window.
 * - PayPal (USD): same-tab redirect to PayPal's approval page; PayPal sends the buyer back to
 *   /billing/return, where the server captures.
 */
import { preferredProvider, type BillingPeriod, type Currency, type PaymentProvider, type PlanStatus, type PriceTable, type UsageType } from "@autoflow/core";
import { api } from "./api";

export interface BillingConfig {
  checkoutEnabled: boolean;
  providers: {
    portone: { enabled: boolean; storeId?: string; channelKey?: string; currency?: Currency };
    paypal: { enabled: boolean; clientId?: string; env?: "live" | "sandbox"; currency?: Currency };
  };
  plans: { business: { periods: BillingPeriod[]; prices: PriceTable } };
  policy: { businessFreeUntil: string; businessPlanRequiredFrom: string; timeZone: string };
}

export interface OrderDto {
  id: string;
  provider: PaymentProvider;
  plan: "business";
  period: BillingPeriod;
  amount: number;
  currency: Currency;
  status: "pending" | "paid" | "failed" | "cancelled";
  createdAt: string;
  paidAt: string | null;
  validUntil: string | null;
}

export interface LicenseDto {
  id: string;
  /** Masked: AFB-•••••-•••••-•••••-•NHC8 */
  key: string;
  period: BillingPeriod;
  source: "purchase" | "key";
  redeemedAt: string | null;
  validUntil: string | null;
}

export interface BillingStatus {
  usageType: UsageType;
  status: PlanStatus;
  entitlement: { plan: string; validUntil: string; active: boolean } | null;
  checkoutEnabled: boolean;
  businessFreeUntil: string;
  orders: OrderDto[];
  licenseKeys?: LicenseDto[];
}

export interface ConfirmResult {
  order: OrderDto;
  /** The order's license key, in plaintext — only in the response that settled the order. */
  licenseKey: string | null;
  billing: BillingStatus;
}

interface CheckoutResponse {
  order: OrderDto;
  portone?: { storeId: string; channelKey: string; paymentId: string; orderName: string; totalAmount: number; currency: string; payMethod: string; customer: { email: string } };
  paypal?: { orderId: string; approveUrl: string };
}

export const billingApi = {
  config: () => api<BillingConfig>("/v1/billing/config", { auth: false }),
  status: () => api<BillingStatus>("/v1/billing/status"),
  confirm: (provider: PaymentProvider, paymentId: string) => api<ConfirmResult>("/v1/billing/confirm", { method: "POST", json: { provider, paymentId } }),
  redeem: (key: string) => api<{ redeemed: { id: string; period: BillingPeriod; validUntil: string }; billing: BillingStatus }>("/v1/billing/redeem", { method: "POST", json: { key } }),
};

/**
 * The payment provider is fixed by the app language: Korean → PortOne (KRW), every other
 * language → PayPal (USD). There is no switch; the server still prices and verifies every order.
 */
export function providerForLocale(locale: string): PaymentProvider {
  return preferredProvider(locale);
}

/* ------------------------------------------------------------------ PortOne */

const PORTONE_SDK = "https://cdn.portone.io/v2/browser-sdk.js";

interface PortOneResult {
  paymentId?: string;
  code?: string;
  message?: string;
}

declare global {
  interface Window {
    PortOne?: { requestPayment(request: Record<string, unknown>): Promise<PortOneResult | undefined> };
  }
}

let sdk: Promise<NonNullable<Window["PortOne"]>> | null = null;

/** Loads the PortOne V2 browser SDK once (allowed by the app CSP: script-src https://cdn.portone.io). */
function loadPortOne(): Promise<NonNullable<Window["PortOne"]>> {
  if (window.PortOne) return Promise.resolve(window.PortOne);
  sdk ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = PORTONE_SDK;
    s.async = true;
    s.onload = () => (window.PortOne ? resolve(window.PortOne) : reject(new Error("PortOne SDK unavailable")));
    s.onerror = () => {
      sdk = null;
      s.remove();
      reject(new Error("PortOne SDK could not be loaded"));
    };
    document.head.appendChild(s);
  });
  return sdk;
}

/** Where providers send the buyer back: /app/billing/return on the website, /billing/return in dev. */
export function billingReturnUrl(): string {
  return new URL("billing/return", `${location.origin}${location.pathname.replace(/[^/]*$/, "")}`).href;
}

export type CheckoutOutcome =
  /** PortOne iframe finished; the caller should confirm with the server. */
  | { kind: "confirm"; provider: PaymentProvider; paymentId: string }
  /** The buyer closed the payment window or the PG reported an error. */
  | { kind: "failed"; message: string }
  /** The page is navigating to the provider (redirect flow); nothing else to do here. */
  | { kind: "redirect" };

export async function startCheckout(provider: PaymentProvider, period: BillingPeriod): Promise<CheckoutOutcome> {
  const returnUrl = billingReturnUrl();
  const co = await api<CheckoutResponse>("/v1/billing/checkout", { method: "POST", json: { provider, period, returnUrl } });
  if (co.paypal) {
    location.assign(co.paypal.approveUrl);
    return { kind: "redirect" };
  }
  const p = co.portone!;
  const PortOne = await loadPortOne();
  const res = await PortOne.requestPayment({
    storeId: p.storeId,
    channelKey: p.channelKey,
    paymentId: p.paymentId,
    orderName: p.orderName,
    totalAmount: p.totalAmount,
    currency: p.currency,
    payMethod: p.payMethod,
    customer: { email: p.customer.email },
    // KCP would otherwise open its own window: keep it in-page on PC, same tab on mobile.
    windowType: { pc: "IFRAME", mobile: "REDIRECTION" },
    // Mobile (redirection) comes back here with ?paymentId=…&code=…; the server verifies either way.
    redirectUrl: returnUrl,
  });
  if (!res) return { kind: "redirect" };
  if (res.code) return { kind: "failed", message: res.message ?? res.code };
  return { kind: "confirm", provider: "portone", paymentId: res.paymentId ?? p.paymentId };
}
