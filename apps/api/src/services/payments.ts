/**
 * Thin REST clients for the two payment providers. They only fetch and shape data; deciding
 * whether a payment is acceptable happens in services/billing.ts.
 *
 * - PortOne V2: GET /payments/{paymentId} (and a best-effort cancel) with `Authorization: PortOne <secret>`.
 * - PayPal Orders v2: OAuth client credentials → create order → (buyer approves) → capture.
 *
 * Every call goes through deps.fetch (mocked in tests) with a timeout and `redirect: "manual"`.
 */
import { ApiError } from "../errors.js";
import type { AppDeps } from "../deps.js";
import type { PaypalEnv } from "./billing-settings.js";

export const PORTONE_API = "https://api.portone.io";
export const PAYPAL_API: Record<PaypalEnv, string> = { live: "https://api-m.paypal.com", sandbox: "https://api-m.sandbox.paypal.com" };

function upstream(provider: string, detail: string): ApiError {
  return new ApiError(502, "upstream_error", `Payment provider ${provider} could not be reached`, { provider, detail });
}

async function call(deps: AppDeps, provider: string, url: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  let res: Response;
  try {
    res = await deps.fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(deps.config.billingTimeoutMs) });
  } catch (err) {
    deps.logger.warn("billing.upstream_unreachable", { provider, error: (err as Error).name });
    throw upstream(provider, (err as Error).name === "TimeoutError" ? "timeout" : "network");
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

/* ------------------------------------------------------------------- PortOne */

/** The fields of a PortOne V2 Payment we rely on. */
export interface PortonePayment {
  id?: string;
  status?: string;
  storeId?: string;
  currency?: string;
  amount?: { total?: number; paid?: number };
  channel?: { key?: string; pgProvider?: string };
  paidAt?: string;
}

/** null when PortOne has no such payment (404). */
export async function portoneGetPayment(deps: AppDeps, apiSecret: string, paymentId: string): Promise<PortonePayment | null> {
  const r = await call(deps, "portone", `${PORTONE_API}/payments/${encodeURIComponent(paymentId)}`, {
    method: "GET",
    headers: { Authorization: `PortOne ${apiSecret}`, Accept: "application/json" },
  });
  if (r.status === 404) return null;
  if (r.status !== 200 || !r.body || typeof r.body !== "object") {
    deps.logger.warn("billing.portone_error", { status: r.status, type: (r.body as { type?: string } | null)?.type });
    throw upstream("portone", `status ${r.status}`);
  }
  return r.body as PortonePayment;
}

/** Refund a payment we refuse to honour (e.g. amount mismatch). Failures are logged, not thrown. */
export async function portoneCancel(deps: AppDeps, apiSecret: string, paymentId: string, reason: string): Promise<boolean> {
  try {
    const r = await call(deps, "portone", `${PORTONE_API}/payments/${encodeURIComponent(paymentId)}/cancel`, {
      method: "POST",
      headers: { Authorization: `PortOne ${apiSecret}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (r.status >= 300) deps.logger.warn("billing.portone_cancel_failed", { status: r.status });
    return r.status < 300;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------- PayPal */

export interface PaypalCreds {
  env: PaypalEnv;
  clientId: string;
  clientSecret: string;
}

export interface PaypalAmount {
  currency_code?: string;
  value?: string;
}

export interface PaypalCapture {
  id?: string;
  status?: string;
  amount?: PaypalAmount;
}

export interface PaypalOrder {
  id?: string;
  status?: string;
  purchase_units?: { reference_id?: string; custom_id?: string; amount?: PaypalAmount; payments?: { captures?: PaypalCapture[] } }[];
  links?: { rel?: string; href?: string }[];
}

/** Access tokens are cached per fetch implementation (one per app instance; tests stay isolated). */
const tokenCache = new WeakMap<typeof fetch, Map<string, { token: string; expiresAt: number }>>();

async function paypalToken(deps: AppDeps, c: PaypalCreds): Promise<string> {
  let cache = tokenCache.get(deps.fetch);
  if (!cache) tokenCache.set(deps.fetch, (cache = new Map()));
  const key = `${c.env}:${c.clientId}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.token;
  const r = await call(deps, "paypal", `${PAYPAL_API[c.env]}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: "grant_type=client_credentials",
  });
  const body = r.body as { access_token?: string; expires_in?: number } | null;
  if (r.status !== 200 || !body?.access_token) {
    deps.logger.warn("billing.paypal_auth_failed", { status: r.status });
    throw upstream("paypal", `auth status ${r.status}`);
  }
  // Refresh a minute early.
  cache.set(key, { token: body.access_token, expiresAt: Date.now() + Math.max(0, (body.expires_in ?? 300) - 60) * 1000 });
  return body.access_token;
}

async function paypalCall(deps: AppDeps, c: PaypalCreds, method: "GET" | "POST", path: string, opts: { body?: unknown; requestId?: string } = {}) {
  const token = await paypalToken(deps, c);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  // PayPal-Request-Id makes create/capture idempotent on PayPal's side as well.
  if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;
  return call(deps, "paypal", `${PAYPAL_API[c.env]}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}

export async function paypalCreateOrder(
  deps: AppDeps,
  c: PaypalCreds,
  o: { orderId: string; value: string; currency: string; description: string; returnUrl: string; cancelUrl: string },
): Promise<{ id: string; approveUrl: string }> {
  const r = await paypalCall(deps, c, "POST", "/v2/checkout/orders", {
    requestId: `create-${o.orderId}`,
    body: {
      intent: "CAPTURE",
      purchase_units: [{ reference_id: o.orderId, custom_id: o.orderId, description: o.description, amount: { currency_code: o.currency, value: o.value } }],
      payment_source: {
        paypal: {
          experience_context: { brand_name: "AutoFlow", user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING", return_url: o.returnUrl, cancel_url: o.cancelUrl },
        },
      },
    },
  });
  const body = r.body as PaypalOrder | null;
  const approve = body?.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
  if (r.status >= 300 || !body?.id || !approve || !/^https:\/\/(www\.)?(sandbox\.)?paypal\.com\//.test(approve)) {
    deps.logger.warn("billing.paypal_create_failed", { status: r.status });
    throw upstream("paypal", `create status ${r.status}`);
  }
  return { id: body.id, approveUrl: approve };
}

/** null when PayPal has no such order. */
export async function paypalGetOrder(deps: AppDeps, c: PaypalCreds, id: string): Promise<PaypalOrder | null> {
  const r = await paypalCall(deps, c, "GET", `/v2/checkout/orders/${encodeURIComponent(id)}`);
  if (r.status === 404) return null;
  if (r.status !== 200 || !r.body) throw upstream("paypal", `get status ${r.status}`);
  return r.body as PaypalOrder;
}

/** Capture an approved order. Returns the order as PayPal reports it after the attempt. */
export async function paypalCaptureOrder(deps: AppDeps, c: PaypalCreds, id: string, requestId: string): Promise<{ status: number; order: PaypalOrder | null; issue?: string }> {
  const r = await paypalCall(deps, c, "POST", `/v2/checkout/orders/${encodeURIComponent(id)}/capture`, { requestId, body: {} });
  if (r.status === 200 || r.status === 201) return { status: r.status, order: r.body as PaypalOrder };
  const issue = (r.body as { details?: { issue?: string }[] } | null)?.details?.[0]?.issue;
  if (r.status >= 500) throw upstream("paypal", `capture status ${r.status}`);
  return { status: r.status, order: null, issue };
}
