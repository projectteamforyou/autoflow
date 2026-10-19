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
    SELECT id::text, actor_id, actor_email, action, target, details, ip, created_at FROM admin_audit_log ORDER BY id DESC LIMIT ${limit}`;
  return rows.map((r) => ({ id: r.id, actorId: r.actor_id, actorEmail: r.actor_email, action: r.action, target: r.target, details: r.details, ip: r.ip, createdAt: r.created_at }));
}
