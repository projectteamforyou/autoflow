/**
 * Business plan billing for the Sync account.
 *
 * Flow (no webhooks, no stored cards):
 * 1. POST /v1/billing/checkout — the server prices the order from @autoflow/core (or the admin
 *    override) and records a pending order. PortOne: we mint the paymentId the browser SDK must use.
 *    PayPal: we create the PayPal order and hand back its approval link.
 * 2. The buyer pays (PortOne/KCP in an in-page iframe on PC or a same-tab redirect on mobile;
 *    PayPal by redirect) and lands on /app/billing/return.
 * 3. POST /v1/billing/confirm — the server asks the provider itself (PortOne GET /payments/{id},
 *    PayPal GET + capture) and only then settles: amount, currency, status and the pending order
 *    must all match. The client's own report is never trusted.
 *
 * Settling is idempotent: pending → paid happens once per order under a row lock, and the
 * entitlement is extended in the same transaction while the user's row is locked.
 *
 * License keys (design): a paid order extends the buyer's own entitlement, as before, and in the
 * same transaction issues one license key for that order, recorded as already redeemed by the
 * buyer. The plaintext goes back once, in the confirm response that settled the order, and serves
 * as the buyer's license number (proof of license) — it cannot be redeemed a second time, so one
 * payment never buys two licenses. Licenses for other accounts (e.g. a company licensing its
 * staff) are keys issued by an operator and redeemed once with POST /v1/billing/redeem.
 */
import {
  BILLING_PERIODS,
  BUSINESS_FREE_UNTIL,
  BUSINESS_PLAN_REQUIRED_FROM,
  POLICY_TIME_ZONE,
  PROVIDER_CURRENCY,
  SYNC_LAUNCH_PRICE,
  addMonths,
  extendEntitlement,
  fromDecimalAmount,
  generateLicenseKey,
  licenseKeyHint,
  maskLicenseKey,
  normalizeLicenseKey,
  isBusinessGraceOver,
  planStatus,
  priceFor,
  requiresBusinessPlan,
  toDecimalAmount,
  type BillingPeriod,
  type PaymentProvider,
} from "@autoflow/core";
import { ApiError, errors } from "../errors.js";
import type { AppDeps, AuthContext } from "../deps.js";
import * as db from "../db/billing.js";
import type { LicenseKey, Order } from "../db/billing.js";
import { findUserByEmail, lockUser, updateUsageType, type User } from "../db/users.js";
import type { Db } from "../db/client.js";
import { base62Id, sha256Hex } from "../lib/crypto.js";
import { loadBillingSettings, type BillingSettings } from "./billing-settings.js";
import { normalizeEmail } from "./auth.js";
import * as pay from "./payments.js";

const PLAN = "business" as const;

export function orderDto(o: Order) {
  return {
    id: o.id,
    provider: o.provider,
    plan: o.plan,
    period: o.period,
    amount: o.amount,
    currency: o.currency,
    status: o.status,
    createdAt: o.createdAt.toISOString(),
    paidAt: o.paidAt?.toISOString() ?? null,
    validUntil: o.validUntil?.toISOString() ?? null,
  };
}

export function adminOrderDto(o: Order) {
  return { ...orderDto(o), userId: o.userId, buyerEmail: o.buyerEmail, providerPaymentId: o.providerPaymentId, failureReason: o.failureReason };
}

const checkoutReady = (s: BillingSettings) => s.portone.ready || s.paypal.ready;

/* ------------------------------------------------------------- public config */

/** Everything a browser needs to render plans and start checkout — and nothing secret. */
export async function publicConfig(deps: AppDeps) {
  const s = await loadBillingSettings(deps);
  return {
    checkoutEnabled: checkoutReady(s),
    providers: {
      portone: s.portone.ready ? { enabled: true, storeId: s.portone.storeId, channelKey: s.portone.channelKey, currency: PROVIDER_CURRENCY.portone } : { enabled: false },
      paypal: s.paypal.ready ? { enabled: true, clientId: s.paypal.clientId, env: s.paypal.env, currency: PROVIDER_CURRENCY.paypal } : { enabled: false },
    },
    plans: { business: { periods: BILLING_PERIODS, prices: s.prices } },
    policy: {
      syncLaunchPrice: SYNC_LAUNCH_PRICE,
      personalUse: "free",
      businessFreeUntil: BUSINESS_FREE_UNTIL,
      businessPlanRequiredFrom: BUSINESS_PLAN_REQUIRED_FROM,
      timeZone: POLICY_TIME_ZONE,
    },
  };
}

/* ------------------------------------------------------------------- status */

export async function status(deps: AppDeps, auth: AuthContext) {
  const now = deps.now();
  const [ent, orders, s, keys] = await Promise.all([
    db.getEntitlement(deps.sql, auth.user.id, PLAN),
    db.listUserOrders(deps.sql, auth.user.id, 20),
    loadBillingSettings(deps),
    db.listUserLicenseKeys(deps.sql, auth.user.id, 20),
  ]);
  return {
    usageType: auth.user.usageType,
    status: planStatus({ usageType: auth.user.usageType, validUntil: ent?.validUntil }, now),
    entitlement: ent ? { plan: ent.plan, validUntil: ent.validUntil.toISOString(), active: ent.validUntil.getTime() > now.getTime() } : null,
    checkoutEnabled: checkoutReady(s),
    businessFreeUntil: BUSINESS_FREE_UNTIL,
    orders: orders.map(orderDto),
    licenseKeys: keys.map(userLicenseDto),
  };
}

/* ------------------------------------------------------------- license keys */

export function userLicenseDto(k: LicenseKey) {
  return { id: k.id, key: maskLicenseKey(k.keyHint), period: k.period, source: k.orderId ? "purchase" : "key", redeemedAt: k.redeemedAt?.toISOString() ?? null, validUntil: k.validUntil?.toISOString() ?? null };
}

export function adminLicenseDto(k: LicenseKey) {
  return {
    id: k.id,
    key: maskLicenseKey(k.keyHint),
    plan: k.plan,
    period: k.period,
    status: k.status,
    orderId: k.orderId,
    redeemedBy: k.redeemedBy,
    redeemedByEmail: k.redeemedByEmail,
    redeemedAt: k.redeemedAt?.toISOString() ?? null,
    validUntil: k.validUntil?.toISOString() ?? null,
    revokedAt: k.revokedAt?.toISOString() ?? null,
    note: k.note,
    createdAt: k.createdAt.toISOString(),
  };
}

type KeyFields = Omit<Parameters<typeof db.insertLicenseKey>[1], "keyHash" | "keyHint">;

/** A fresh key and its stored form (hash + hint). Retries the astronomically unlikely hash collision. */
async function issueKey(tx: Db, fields: KeyFields): Promise<{ key: string; row: LicenseKey }> {
  for (let attempt = 0; ; attempt++) {
    const key = generateLicenseKey();
    try {
      const row = await db.insertLicenseKey(tx, { ...fields, keyHash: sha256Hex(key), keyHint: licenseKeyHint(key) });
      return { key, row };
    } catch (err) {
      const e = err as { code?: string; constraint_name?: string };
      if (attempt < 2 && e.code === "23505" && e.constraint_name === "license_keys_key_hash_key") continue;
      throw err;
    }
  }
}

/**
 * Redeem a key once: issued → redeemed under the key's row lock, then the user's Business
 * entitlement is extended by the key's period and their usage type becomes business.
 * Only a SHA-256 of the key ever reaches the database, so lookups leak nothing about other keys.
 */
export async function redeem(deps: AppDeps, auth: AuthContext, input: { key: string }) {
  const canonical = normalizeLicenseKey(input.key);
  // Format and checksum fail fast without touching the database.
  if (!canonical) throw new ApiError(400, "invalid_license_key", "This license key is not valid. Check it for typos.");
  const keyHash = sha256Hex(canonical);
  const applied = await deps.sql.begin(async (tx) => {
    await lockUser(tx, auth.user.id);
    const now = deps.now();
    const claimed = await db.claimLicenseKey(tx, keyHash, auth.user.id, now);
    if (!claimed) {
      const existing = await db.findLicenseKeyByHash(tx, keyHash);
      if (!existing) throw new ApiError(404, "invalid_license_key", "This license key does not exist. Check it for typos.");
      if (existing.status === "revoked") throw new ApiError(410, "license_key_revoked", "This license key has been revoked.");
      throw new ApiError(409, "license_key_used", "This license key has already been used.");
    }
    const validUntil = extendEntitlement((await db.getEntitlement(tx, auth.user.id, PLAN))?.validUntil, now, claimed.period);
    await db.upsertEntitlement(tx, auth.user.id, PLAN, validUntil);
    await db.setLicenseKeyValidUntil(tx, claimed.id, validUntil);
    if (auth.user.usageType !== "business") await updateUsageType(tx, auth.user.id, "business");
    return { id: claimed.id, period: claimed.period, validUntil };
  });
  deps.logger.info("billing.license_redeemed", { userId: auth.user.id, keyId: applied.id, period: applied.period, validUntil: applied.validUntil.toISOString() });
  const fresh: AuthContext = { ...auth, user: { ...auth.user, usageType: "business" } };
  return { redeemed: { id: applied.id, period: applied.period, validUntil: applied.validUntil.toISOString() }, billing: await status(deps, fresh) };
}

/** Operator-issued keys for other accounts; the plaintext is in this response only. */
export async function adminIssueKeys(deps: AppDeps, actor: AuthContext, input: { period: BillingPeriod; count: number; note?: string }) {
  return deps.sql.begin(async (tx) => {
    const out: { key: string; license: ReturnType<typeof adminLicenseDto> }[] = [];
    for (let i = 0; i < input.count; i++) {
      const { key, row } = await issueKey(tx, { period: input.period, issuedBy: actor.user.id, note: input.note ?? null });
      out.push({ key, license: adminLicenseDto(row) });
    }
    return out;
  });
}

/** issued → revoked. A redeemed key stays as history (revoke the entitlement instead). */
export async function adminRevokeKey(deps: AppDeps, id: string) {
  const revoked = await db.revokeLicenseKey(deps.sql, id, deps.now());
  if (revoked) return adminLicenseDto(revoked);
  const existing = await db.getLicenseKey(deps.sql, id);
  if (!existing) throw errors.notFound("License key");
  throw errors.conflict(existing.status === "revoked" ? "This key is already revoked" : "A redeemed key cannot be revoked; revoke the entitlement instead");
}

/* ----------------------------------------------------------------- the gate */

/**
 * Called before every Sync write. Refuses with 402 `business_plan_required` only for business use,
 * after the free period, without a valid entitlement — and only while checkout is actually
 * available, so nobody is blocked from a plan they could not buy. Reads, export and deletion
 * never call this.
 */
export async function assertSyncWriteAllowed(deps: AppDeps, auth: AuthContext): Promise<void> {
  const now = deps.now();
  if (auth.user.usageType !== "business" || !isBusinessGraceOver(now)) return;
  const ent = await db.getEntitlement(deps.sql, auth.user.id, PLAN);
  if (!requiresBusinessPlan({ usageType: "business", validUntil: ent?.validUntil }, now)) return;
  if (!checkoutReady(await loadBillingSettings(deps))) return;
  throw new ApiError(402, "business_plan_required", "Business use of Sync needs a Business plan. Your synced data stays readable, exportable and deletable.", {
    plan: PLAN,
    businessFreeUntil: BUSINESS_FREE_UNTIL,
    expiredAt: ent?.validUntil.toISOString() ?? null,
  });
}

/* ----------------------------------------------------------------- checkout */

/** PayPal returns the buyer to a URL we pass along, so it must be one of our own app origins. */
export function validateReturnUrl(deps: AppDeps, raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw errors.badRequest("returnUrl is not a URL");
  }
  const local = u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  if ((u.protocol !== "https:" && !local) || u.username || u.password || !deps.config.appOrigins.includes(u.origin) || !/\/billing\/return\/?$/.test(u.pathname))
    throw errors.badRequest("returnUrl must be the app's /billing/return page");
  u.search = "";
  u.hash = "";
  return u;
}

function billingDisabled(provider: PaymentProvider): ApiError {
  return new ApiError(503, "billing_disabled", `Checkout with ${provider} is not available right now`, { provider });
}

const orderName = (period: BillingPeriod) => `AutoFlow Business (${period === "month" ? "1 month" : "12 months"})`;

export async function checkout(deps: AppDeps, auth: AuthContext, input: { provider: PaymentProvider; period: BillingPeriod; returnUrl?: string }) {
  if (auth.user.usageType !== "business") throw errors.conflict("The Business plan is only needed for business use. Set your usage type to business first.");
  const s = await loadBillingSettings(deps);
  const currency = PROVIDER_CURRENCY[input.provider];
  const amount = priceFor(input.period, currency, s.prices);
  const base = { userId: auth.user.id, buyerEmail: auth.user.email, provider: input.provider, plan: PLAN, period: input.period, amount, currency };

  if (input.provider === "portone") {
    if (!s.portone.ready) throw billingDisabled("portone");
    // The paymentId is ours: confirmation only accepts payments that match a pending order we created.
    const paymentId = `af-${base62Id(24)}`;
    const order = await db.insertOrder(deps.sql, { ...base, providerPaymentId: paymentId });
    deps.logger.info("billing.checkout", { userId: auth.user.id, orderId: order.id, provider: "portone", period: input.period });
    return {
      order: orderDto(order),
      portone: {
        storeId: s.portone.storeId,
        channelKey: s.portone.channelKey,
        paymentId,
        orderName: orderName(input.period),
        totalAmount: amount,
        currency: "CURRENCY_KRW",
        payMethod: "CARD",
        customer: { email: auth.user.email },
      },
    };
  }

  if (!s.paypal.ready) throw billingDisabled("paypal");
  if (!input.returnUrl) throw errors.badRequest("returnUrl is required for PayPal");
  const ret = validateReturnUrl(deps, input.returnUrl);
  const order = await db.insertOrder(deps.sql, { ...base, providerPaymentId: null });
  const creds = { env: s.paypal.env, clientId: s.paypal.clientId, clientSecret: s.paypal.clientSecret! };
  let created: { id: string; approveUrl: string };
  try {
    created = await pay.paypalCreateOrder(deps, creds, {
      orderId: order.id,
      value: toDecimalAmount(amount, currency),
      currency,
      description: orderName(input.period),
      returnUrl: `${ret.href}?provider=paypal`,
      cancelUrl: `${ret.href}?provider=paypal&cancelled=1`,
    });
  } catch (err) {
    await db.markOrderFailed(deps.sql, order.id, "failed", "paypal_create_failed", undefined);
    throw err;
  }
  await db.setProviderPaymentId(deps.sql, order.id, created.id);
  deps.logger.info("billing.checkout", { userId: auth.user.id, orderId: order.id, provider: "paypal", period: input.period });
  return { order: orderDto({ ...order, providerPaymentId: created.id }), paypal: { orderId: created.id, approveUrl: created.approveUrl } };
}

/* -------------------------------------------------------------- confirmation */

export interface Settled {
  order: Order;
  applied: boolean;
  /** Plaintext license key — only in the one call that settled the order. */
  licenseKey: string | null;
}

/** pending → paid, extend the entitlement and issue the order's license key, exactly once (see file comment). */
export async function settle(deps: AppDeps, order: Order, raw: unknown): Promise<Settled> {
  return deps.sql.begin(async (tx) => {
    const userAlive = order.userId ? await lockUser(tx, order.userId) : false;
    const now = deps.now();
    let validUntil: Date | null = null;
    if (userAlive) validUntil = extendEntitlement((await db.getEntitlement(tx, order.userId!, order.plan))?.validUntil, now, order.period);
    const paid = await db.markOrderPaid(tx, order.id, now, validUntil, raw);
    if (!paid) return { order: (await db.getOrder(tx, order.id))!, applied: false, licenseKey: null };
    let licenseKey: string | null = null;
    if (userAlive && validUntil) {
      await db.upsertEntitlement(tx, order.userId!, order.plan, validUntil);
      // The buyer's license number for this order — already applied to their own account.
      licenseKey = (await issueKey(tx, { period: order.period, orderId: order.id, redeemedBy: order.userId, redeemedAt: now, validUntil })).key;
    } else deps.logger.warn("billing.paid_without_account", { orderId: order.id });
    deps.logger.info("billing.paid", { orderId: order.id, userId: order.userId, provider: order.provider, validUntil: validUntil?.toISOString() });
    return { order: paid, applied: true, licenseKey };
  });
}

function notCompleted(status: string | undefined): ApiError {
  return new ApiError(409, "payment_not_completed", "The payment has not been completed yet", { providerStatus: status ?? null });
}

async function reject(deps: AppDeps, order: Order, kind: "failed" | "cancelled", reason: string, raw: unknown, code: "payment_failed" | "payment_mismatch"): Promise<never> {
  await db.markOrderFailed(deps.sql, order.id, kind, reason, raw);
  deps.logger.warn("billing.rejected", { orderId: order.id, provider: order.provider, reason });
  throw new ApiError(code === "payment_mismatch" ? 409 : 402, code, code === "payment_mismatch" ? "The payment does not match the order" : "The payment failed or was cancelled", { reason });
}

async function confirmPortone(deps: AppDeps, s: BillingSettings, order: Order): Promise<Settled> {
  // A provider switched off after checkout must still be verifiable, so only the secret matters here.
  if (!s.portone.apiSecret) throw billingDisabled("portone");
  const paymentId = order.providerPaymentId!;
  const p = await pay.portoneGetPayment(deps, s.portone.apiSecret, paymentId);
  if (!p) throw notCompleted(undefined);
  switch (p.status) {
    case "PAID": {
      const currencyOk = p.currency === "KRW" || p.currency === "CURRENCY_KRW";
      const matches = currencyOk && p.amount?.total === order.amount && (p.id === undefined || p.id === paymentId) && (!p.storeId || !s.portone.storeId || p.storeId === s.portone.storeId);
      if (!matches) {
        // Money moved but not for what we sold: refund it rather than keep it.
        const refunded = await pay.portoneCancel(deps, s.portone.apiSecret, paymentId, "Amount or currency did not match the order");
        return reject(deps, order, "failed", refunded ? "amount_mismatch_refunded" : "amount_mismatch", p, "payment_mismatch");
      }
      return settle(deps, order, p);
    }
    case "FAILED":
      return reject(deps, order, "failed", "provider_failed", p, "payment_failed");
    case "CANCELLED":
    case "PARTIAL_CANCELLED":
      return reject(deps, order, "cancelled", "provider_cancelled", p, "payment_failed");
    default:
      throw notCompleted(p.status);
  }
}

function paypalAmountOk(order: Order, amount: pay.PaypalAmount | undefined): boolean {
  return amount?.currency_code === order.currency && typeof amount.value === "string" && fromDecimalAmount(amount.value, order.currency) === order.amount;
}

async function confirmPaypal(deps: AppDeps, s: BillingSettings, order: Order): Promise<Settled> {
  if (!s.paypal.clientId || !s.paypal.clientSecret) throw billingDisabled("paypal");
  const creds = { env: s.paypal.env, clientId: s.paypal.clientId, clientSecret: s.paypal.clientSecret };
  const id = order.providerPaymentId!;
  let ord = await pay.paypalGetOrder(deps, creds, id);
  if (!ord) return reject(deps, order, "failed", "provider_not_found", null, "payment_failed");
  const unit = ord.purchase_units?.[0];
  // Check what the buyer approved before taking any money.
  if (!unit || unit.custom_id !== order.id || !paypalAmountOk(order, unit.amount)) return reject(deps, order, "failed", "amount_mismatch", ord, "payment_mismatch");
  if (ord.status === "VOIDED") return reject(deps, order, "cancelled", "provider_voided", ord, "payment_failed");
  if (ord.status === "APPROVED") {
    const cap = await pay.paypalCaptureOrder(deps, creds, id, `capture-${order.id}`);
    if (cap.order) ord = cap.order;
    else if (cap.issue === "ORDER_ALREADY_CAPTURED") ord = (await pay.paypalGetOrder(deps, creds, id)) ?? ord;
    else throw new ApiError(402, "payment_failed", "PayPal declined the payment", { reason: cap.issue ?? `status_${cap.status}` });
  }
  if (ord.status !== "COMPLETED") throw notCompleted(ord.status);
  const capture = ord.purchase_units?.[0]?.payments?.captures?.find((c) => c.status === "COMPLETED");
  if (!capture) throw notCompleted(ord.purchase_units?.[0]?.payments?.captures?.[0]?.status ?? ord.status);
  if (!paypalAmountOk(order, capture.amount)) {
    deps.logger.error("billing.paypal_capture_mismatch", { orderId: order.id, captureId: capture.id });
    return reject(deps, order, "failed", "capture_amount_mismatch", ord, "payment_mismatch");
  }
  return settle(deps, order, ord);
}

export async function confirm(deps: AppDeps, auth: AuthContext, input: { provider: PaymentProvider; paymentId: string }) {
  const order = await db.findOrderByPayment(deps.sql, input.provider, input.paymentId);
  // Someone else's (or an unknown) payment looks exactly like a missing one.
  if (!order || order.userId !== auth.user.id) throw errors.notFound("Order");
  let result = order;
  let licenseKey: string | null = null;
  if (order.status === "pending") {
    const s = await loadBillingSettings(deps);
    const settled = input.provider === "portone" ? await confirmPortone(deps, s, order) : await confirmPaypal(deps, s, order);
    result = settled.order;
    licenseKey = settled.licenseKey;
  } else if (order.status !== "paid") {
    throw new ApiError(402, "payment_failed", "The payment failed or was cancelled", { reason: order.failureReason });
  }
  // Shown once: a repeated confirmation of an already-paid order returns licenseKey: null.
  return { order: orderDto(result), licenseKey, billing: await status(deps, auth) };
}

/* -------------------------------------------------------------------- admin */

export async function findUserForAdmin(deps: AppDeps, email: string): Promise<User> {
  const user = await findUserByEmail(deps.sql, normalizeEmail(email));
  if (!user) throw errors.notFound("Account");
  return user;
}

export async function adminLookup(deps: AppDeps, email: string) {
  const user = await findUserForAdmin(deps, email);
  const [ent, orders] = await Promise.all([db.getEntitlement(deps.sql, user.id, PLAN), db.listUserOrders(deps.sql, user.id, 20)]);
  return {
    user: { id: user.id, email: user.email, usageType: user.usageType, emailVerified: user.emailVerifiedAt !== null },
    status: planStatus({ usageType: user.usageType, validUntil: ent?.validUntil }, deps.now()),
    entitlement: ent ? { plan: ent.plan, validUntil: ent.validUntil.toISOString() } : null,
    orders: orders.map(adminOrderDto),
  };
}

/** Grant (extend by months, or set an end date) or revoke a user's Business entitlement. */
export async function adminSetEntitlement(deps: AppDeps, input: { email: string; action: "grant" | "revoke"; months?: number; until?: string }) {
  const user = await findUserForAdmin(deps, input.email);
  return deps.sql.begin(async (tx) => {
    await lockUser(tx, user.id);
    const now = deps.now();
    const cur = await db.getEntitlement(tx, user.id, PLAN);
    let validUntil: Date;
    if (input.action === "revoke") validUntil = now;
    else if (input.until) validUntil = new Date(input.until);
    else validUntil = addMonths(cur && cur.validUntil > now ? cur.validUntil : now, input.months ?? 1);
    const saved = await db.upsertEntitlement(tx, user.id, PLAN, validUntil);
    return { userId: user.id, email: user.email, previous: cur?.validUntil.toISOString() ?? null, validUntil: saved.validUntil.toISOString() };
  });
}
