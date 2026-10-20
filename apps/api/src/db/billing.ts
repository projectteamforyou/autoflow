/** Orders, entitlements, admin-managed settings and the admin audit log. */
import type { BillingPeriod, Currency, PaymentProvider, PlanId } from "@autoflow/core";
import type { Db } from "./client.js";

export type OrderStatus = "pending" | "paid" | "failed" | "cancelled";

export interface Order {
  id: string;
  userId: string | null;
  buyerEmail: string;
  provider: PaymentProvider;
  providerPaymentId: string | null;
  plan: PlanId;
  period: BillingPeriod;
  amount: number;
  currency: Currency;
  status: OrderStatus;
  failureReason: string | null;
  validUntil: Date | null;
  createdAt: Date;
  paidAt: Date | null;
}

interface OrderRow {
  id: string;
  user_id: string | null;
  buyer_email: string;
  provider: PaymentProvider;
  provider_payment_id: string | null;
  plan: PlanId;
  period: BillingPeriod;
  amount: number;
  currency: Currency;
  status: OrderStatus;
  failure_reason: string | null;
  valid_until: Date | null;
  created_at: Date;
  paid_at: Date | null;
}

/** Everything but `raw` (provider payloads stay in the database unless someone looks them up). */
const ORDER_COLS = ["id", "user_id", "buyer_email", "provider", "provider_payment_id", "plan", "period", "amount", "currency", "status", "failure_reason", "valid_until", "created_at", "paid_at"];

const mapOrder = (r: OrderRow): Order => ({
  id: r.id,
  userId: r.user_id,
  buyerEmail: r.buyer_email,
  provider: r.provider,
  providerPaymentId: r.provider_payment_id,
  plan: r.plan,
  period: r.period,
  amount: r.amount,
  currency: r.currency,
  status: r.status,
  failureReason: r.failure_reason,
  validUntil: r.valid_until,
  createdAt: r.created_at,
  paidAt: r.paid_at,
});

export async function insertOrder(
  db: Db,
  o: { userId: string; buyerEmail: string; provider: PaymentProvider; providerPaymentId: string | null; plan: PlanId; period: BillingPeriod; amount: number; currency: Currency },
): Promise<Order> {
  const rows = await db<OrderRow[]>`
    INSERT INTO orders (user_id, buyer_email, provider, provider_payment_id, plan, period, amount, currency)
    VALUES (${o.userId}, ${o.buyerEmail}, ${o.provider}, ${o.providerPaymentId}, ${o.plan}, ${o.period}, ${o.amount}, ${o.currency})
    RETURNING ${db(ORDER_COLS)}`;
  return mapOrder(rows[0]!);
}

export async function setProviderPaymentId(db: Db, orderId: string, providerPaymentId: string): Promise<void> {
  await db`UPDATE orders SET provider_payment_id = ${providerPaymentId} WHERE id = ${orderId} AND provider_payment_id IS NULL`;
}

export async function findOrderByPayment(db: Db, provider: PaymentProvider, providerPaymentId: string): Promise<Order | null> {
  const rows = await db<OrderRow[]>`SELECT ${db(ORDER_COLS)} FROM orders WHERE provider = ${provider} AND provider_payment_id = ${providerPaymentId}`;
  return rows[0] ? mapOrder(rows[0]) : null;
}

/**
 * pending → paid, exactly once. Concurrent confirmations of the same payment serialize on the
 * row lock; only the first sees `status = 'pending'` and gets the order back.
 */
export async function markOrderPaid(db: Db, orderId: string, paidAt: Date, validUntil: Date | null, raw: unknown): Promise<Order | null> {
  const rows = await db<OrderRow[]>`
    UPDATE orders SET status = 'paid', paid_at = ${paidAt}, valid_until = ${validUntil}, raw = ${db.json(raw as never)}
    WHERE id = ${orderId} AND status = 'pending'
    RETURNING ${db(ORDER_COLS)}`;
  return rows[0] ? mapOrder(rows[0]) : null;
}

export async function markOrderFailed(db: Db, orderId: string, status: "failed" | "cancelled", reason: string, raw: unknown): Promise<Order | null> {
  const rows = await db<OrderRow[]>`
    UPDATE orders SET status = ${status}, failure_reason = ${reason.slice(0, 300)}, raw = ${raw === undefined ? null : db.json(raw as never)}
    WHERE id = ${orderId} AND status = 'pending'
    RETURNING ${db(ORDER_COLS)}`;
  return rows[0] ? mapOrder(rows[0]) : null;
}

export async function getOrder(db: Db, orderId: string): Promise<Order | null> {
  const rows = await db<OrderRow[]>`SELECT ${db(ORDER_COLS)} FROM orders WHERE id = ${orderId}`;
  return rows[0] ? mapOrder(rows[0]) : null;
}

export async function listUserOrders(db: Db, userId: string, limit: number): Promise<Order[]> {
  const rows = await db<OrderRow[]>`SELECT ${db(ORDER_COLS)} FROM orders WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT ${limit}`;
  return rows.map(mapOrder);
}

export async function listOrders(db: Db, opts: { limit: number; status?: OrderStatus }): Promise<Order[]> {
  const rows = opts.status
    ? await db<OrderRow[]>`SELECT ${db(ORDER_COLS)} FROM orders WHERE status = ${opts.status} ORDER BY created_at DESC LIMIT ${opts.limit}`
    : await db<OrderRow[]>`SELECT ${db(ORDER_COLS)} FROM orders ORDER BY created_at DESC LIMIT ${opts.limit}`;
  return rows.map(mapOrder);
}

/* ------------------------------------------------------------- entitlements */

export interface Entitlement {
  userId: string;
  plan: PlanId;
  validUntil: Date;
  updatedAt: Date;
}

interface EntitlementRow {
  user_id: string;
  plan: PlanId;
  valid_until: Date;
  updated_at: Date;
}

const mapEntitlement = (r: EntitlementRow): Entitlement => ({ userId: r.user_id, plan: r.plan, validUntil: r.valid_until, updatedAt: r.updated_at });

export async function getEntitlement(db: Db, userId: string, plan: PlanId): Promise<Entitlement | null> {
  const rows = await db<EntitlementRow[]>`SELECT * FROM entitlements WHERE user_id = ${userId} AND plan = ${plan}`;
  return rows[0] ? mapEntitlement(rows[0]) : null;
}

export async function upsertEntitlement(db: Db, userId: string, plan: PlanId, validUntil: Date): Promise<Entitlement> {
  const rows = await db<EntitlementRow[]>`
    INSERT INTO entitlements (user_id, plan, valid_until) VALUES (${userId}, ${plan}, ${validUntil})
    ON CONFLICT (user_id, plan) DO UPDATE SET valid_until = EXCLUDED.valid_until, updated_at = now()
    RETURNING *`;
  return mapEntitlement(rows[0]!);
}

/* ------------------------------------------------------------------ settings */

export async function getSetting<T>(db: Db, key: string): Promise<T | null> {
  const rows = await db<{ value: T }[]>`SELECT value FROM app_settings WHERE key = ${key}`;
  return rows[0]?.value ?? null;
}

export async function putSetting(db: Db, key: string, value: unknown, updatedBy: string | null): Promise<void> {
  await db`
    INSERT INTO app_settings (key, value, updated_by) VALUES (${key}, ${db.json(value as never)}, ${updatedBy})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
}

/* --------------------------------------------------------------- audit log */

export interface AuditEntry {
  id: string;
  actorId: string | null;
  actorEmail: string;
  action: string;
  target: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  createdAt: Date;
}

export async function insertAudit(db: Db, e: { actorId: string; actorEmail: string; action: string; target: string | null; details: Record<string, unknown>; ip: string | null }): Promise<void> {
  await db`
    INSERT INTO admin_audit_log (actor_id, actor_email, action, target, details, ip)
    VALUES (${e.actorId}, ${e.actorEmail}, ${e.action}, ${e.target}, ${db.json(e.details as never)}, ${e.ip})`;
}

export async function listAudit(db: Db, limit: number): Promise<AuditEntry[]> {
  const rows = await db<{ id: string; actor_id: string | null; actor_email: string; action: string; target: string | null; details: Record<string, unknown>; ip: string | null; created_at: Date }[]>`
    SELECT id::text, actor_id, actor_email, action, target, details, ip, created_at FROM admin_audit_log ORDER BY admin_audit_log.id DESC LIMIT ${limit}`;
  return rows.map((r) => ({ id: r.id, actorId: r.actor_id, actorEmail: r.actor_email, action: r.action, target: r.target, details: r.details, ip: r.ip, createdAt: r.created_at }));
}

/* -------------------------------------------------------------- license keys */

export type LicenseKeyStatus = "issued" | "redeemed" | "revoked";

export interface LicenseKey {
  id: string;
  keyHint: string;
  plan: PlanId;
  period: BillingPeriod;
  status: LicenseKeyStatus;
  orderId: string | null;
  issuedBy: string | null;
  redeemedBy: string | null;
  redeemedByEmail: string | null;
  redeemedAt: Date | null;
  validUntil: Date | null;
  revokedAt: Date | null;
  note: string | null;
  createdAt: Date;
}

interface LicenseKeyRow {
  id: string;
  key_hint: string;
  plan: PlanId;
  period: BillingPeriod;
  status: LicenseKeyStatus;
  order_id: string | null;
  issued_by: string | null;
  redeemed_by: string | null;
  redeemed_by_email?: string | null;
  redeemed_at: Date | null;
  valid_until: Date | null;
  revoked_at: Date | null;
  note: string | null;
  created_at: Date;
}

/** Never selects key_hash: it has no business leaving the database layer. */
const LICENSE_COLS = ["id", "key_hint", "plan", "period", "status", "order_id", "issued_by", "redeemed_by", "redeemed_at", "valid_until", "revoked_at", "note", "created_at"];

const mapLicenseKey = (r: LicenseKeyRow): LicenseKey => ({
  id: r.id,
  keyHint: r.key_hint,
  plan: r.plan,
  period: r.period,
  status: r.status,
  orderId: r.order_id,
  issuedBy: r.issued_by,
  redeemedBy: r.redeemed_by,
  redeemedByEmail: r.redeemed_by_email ?? null,
  redeemedAt: r.redeemed_at,
  validUntil: r.valid_until,
  revokedAt: r.revoked_at,
  note: r.note,
  createdAt: r.created_at,
});

export async function insertLicenseKey(
  db: Db,
  k: { keyHash: string; keyHint: string; period: BillingPeriod; orderId?: string | null; issuedBy?: string | null; note?: string | null; redeemedBy?: string | null; redeemedAt?: Date | null; validUntil?: Date | null },
): Promise<LicenseKey> {
  const status: LicenseKeyStatus = k.redeemedAt ? "redeemed" : "issued";
  const rows = await db<LicenseKeyRow[]>`
    INSERT INTO license_keys (key_hash, key_hint, plan, period, status, order_id, issued_by, note, redeemed_by, redeemed_at, valid_until)
    VALUES (${k.keyHash}, ${k.keyHint}, 'business', ${k.period}, ${status}, ${k.orderId ?? null}, ${k.issuedBy ?? null}, ${k.note ?? null}, ${k.redeemedBy ?? null}, ${k.redeemedAt ?? null}, ${k.validUntil ?? null})
    RETURNING ${db(LICENSE_COLS)}`;
  return mapLicenseKey(rows[0]!);
}

/**
 * issued → redeemed, exactly once: concurrent redemptions of the same key serialize on the row
 * and only the first still sees `status = 'issued'`.
 */
export async function claimLicenseKey(db: Db, keyHash: string, userId: string, at: Date): Promise<LicenseKey | null> {
  const rows = await db<LicenseKeyRow[]>`
    UPDATE license_keys SET status = 'redeemed', redeemed_by = ${userId}, redeemed_at = ${at}
    WHERE key_hash = ${keyHash} AND status = 'issued'
    RETURNING ${db(LICENSE_COLS)}`;
  return rows[0] ? mapLicenseKey(rows[0]) : null;
}

export async function setLicenseKeyValidUntil(db: Db, id: string, validUntil: Date): Promise<void> {
  await db`UPDATE license_keys SET valid_until = ${validUntil} WHERE id = ${id}`;
}

export async function findLicenseKeyByHash(db: Db, keyHash: string): Promise<LicenseKey | null> {
  const rows = await db<LicenseKeyRow[]>`SELECT ${db(LICENSE_COLS)} FROM license_keys WHERE key_hash = ${keyHash}`;
  return rows[0] ? mapLicenseKey(rows[0]) : null;
}

export async function listLicenseKeys(db: Db, opts: { limit: number; status?: LicenseKeyStatus }): Promise<LicenseKey[]> {
  const rows = opts.status
    ? await db<LicenseKeyRow[]>`
        SELECT k.id, k.key_hint, k.plan, k.period, k.status, k.order_id, k.issued_by, k.redeemed_by, k.redeemed_at, k.valid_until, k.revoked_at, k.note, k.created_at, u.email AS redeemed_by_email FROM license_keys k LEFT JOIN users u ON u.id = k.redeemed_by
        WHERE k.status = ${opts.status} ORDER BY k.created_at DESC, k.id LIMIT ${opts.limit}`
    : await db<LicenseKeyRow[]>`
        SELECT k.id, k.key_hint, k.plan, k.period, k.status, k.order_id, k.issued_by, k.redeemed_by, k.redeemed_at, k.valid_until, k.revoked_at, k.note, k.created_at, u.email AS redeemed_by_email FROM license_keys k LEFT JOIN users u ON u.id = k.redeemed_by
        ORDER BY k.created_at DESC, k.id LIMIT ${opts.limit}`;
  return rows.map(mapLicenseKey);
}

export async function listUserLicenseKeys(db: Db, userId: string, limit: number): Promise<LicenseKey[]> {
  const rows = await db<LicenseKeyRow[]>`SELECT ${db(LICENSE_COLS)} FROM license_keys WHERE redeemed_by = ${userId} ORDER BY redeemed_at DESC LIMIT ${limit}`;
  return rows.map(mapLicenseKey);
}

/** issued → revoked. Redeemed keys are history; take an entitlement away with the entitlement tool. */
export async function revokeLicenseKey(db: Db, id: string, at: Date): Promise<LicenseKey | null> {
  const rows = await db<LicenseKeyRow[]>`
    UPDATE license_keys SET status = 'revoked', revoked_at = ${at}
    WHERE id = ${id} AND status = 'issued'
    RETURNING ${db(LICENSE_COLS)}`;
  return rows[0] ? mapLicenseKey(rows[0]) : null;
}

export async function getLicenseKey(db: Db, id: string): Promise<LicenseKey | null> {
  const rows = await db<LicenseKeyRow[]>`SELECT ${db(LICENSE_COLS)} FROM license_keys WHERE id = ${id}`;
  return rows[0] ? mapLicenseKey(rows[0]) : null;
}
