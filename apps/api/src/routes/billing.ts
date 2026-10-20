/** /v1/billing — plans, status, checkout and server-side payment confirmation; /v1/admin/billing — operator tools. */
import { Hono, type Context } from "hono";
import { z } from "zod";
import { BILLING_PERIODS, CURRENCIES, PAYMENT_PROVIDERS } from "@autoflow/core";
import type { AppEnv, AuthContext } from "../deps.js";
import { ApiError } from "../errors.js";
import { enforce, parseJson, parseQuery, requireAuth, requireOperator } from "../lib/http.js";
import * as billing from "../services/billing.js";
import { EncryptionUnavailableError, adminSettingsView, loadBillingSettings, saveBillingSettings } from "../services/billing-settings.js";
import { insertAudit, listAudit, listOrders } from "../db/billing.js";

const Provider = z.enum(PAYMENT_PROVIDERS);
const CheckoutBody = z.object({ provider: Provider, period: z.enum(BILLING_PERIODS), returnUrl: z.string().max(500).optional() });
const ConfirmBody = z.object({ provider: Provider, paymentId: z.string().regex(/^[A-Za-z0-9_-]{5,64}$/, "invalid payment id") });

/** Ids and keys copied from the PortOne / PayPal consoles: printable, no whitespace. */
const Token = (max: number) => z.string().trim().regex(/^[A-Za-z0-9_.:+/=-]*$/, "unexpected characters").max(max);
const Secret = z.string().trim().min(8).max(500).regex(/^\S+$/, "must not contain whitespace");
const Amount = z.number().int().positive().max(100_000_000);
const PricePatch = z.object(Object.fromEntries(CURRENCIES.map((c) => [c, Amount.optional()])) as Record<(typeof CURRENCIES)[number], z.ZodOptional<typeof Amount>>);

const SettingsBody = z.object({
  portone: z.object({ enabled: z.boolean().optional(), storeId: Token(100).optional(), channelKey: Token(100).optional(), apiSecret: Secret.nullable().optional() }).strict().optional(),
  paypal: z.object({ enabled: z.boolean().optional(), env: z.enum(["live", "sandbox"]).optional(), clientId: Token(200).optional(), clientSecret: Secret.nullable().optional() }).strict().optional(),
  prices: z.object({ month: PricePatch.optional(), year: PricePatch.optional() }).strict().optional(),
}).strict();

const EntitlementBody = z
  .object({
    email: z.string().trim().email().max(254),
    action: z.enum(["grant", "revoke"]),
    months: z.number().int().min(1).max(120).optional(),
    until: z.string().datetime({ offset: true }).optional(),
    note: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.action === "revoke" || v.months !== undefined || v.until !== undefined, { message: "grant needs months or until" });

export function billingRoutes() {
  const r = new Hono<AppEnv>();

  r.get("/config", async (c) => {
    const deps = c.get("deps");
    await enforce(deps.limiters.billing, `billing:ip:${c.get("clientIp")}`);
    c.header("Cache-Control", "public, max-age=60");
    return c.json(await billing.publicConfig(deps));
  });

  r.get("/status", async (c) => {
    const a = requireAuth(c);
    const deps = c.get("deps");
    await enforce(deps.limiters.billing, `billing:u:${a.user.id}`);
    return c.json(await billing.status(deps, a));
  });

  r.post("/checkout", async (c) => {
    const a = requireAuth(c);
    const deps = c.get("deps");
    await enforce(deps.limiters.billing, `billing:u:${a.user.id}`, 2);
    const body = await parseJson(c, CheckoutBody);
    return c.json(await billing.checkout(deps, a, body), 201);
  });

  r.post("/confirm", async (c) => {
    const a = requireAuth(c);
    const deps = c.get("deps");
    await enforce(deps.limiters.billing, `billing:u:${a.user.id}`);
    const body = await parseJson(c, ConfirmBody);
    return c.json(await billing.confirm(deps, a, body));
  });

  return r;
}

async function audit(c: Context<AppEnv>, a: AuthContext, action: string, target: string | null, details: Record<string, unknown>) {
  await insertAudit(c.get("deps").sql, { actorId: a.user.id, actorEmail: a.user.email, action, target, details, ip: c.get("clientIp") });
}

/** Operators (ADMIN_EMAILS, verified) only; every change lands in admin_audit_log. */
export function adminBillingRoutes() {
  const r = new Hono<AppEnv>();

  r.use(async (c, next) => {
    const a = requireOperator(c);
    await enforce(c.get("deps").limiters.admin, `admin:${a.user.id}`);
    await next();
  });

  r.get("/settings", async (c) => c.json({ settings: adminSettingsView(await loadBillingSettings(c.get("deps"))) }));

  r.put("/settings", async (c) => {
    const a = requireOperator(c);
    const deps = c.get("deps");
    const body = await parseJson(c, SettingsBody);
    let changed: string[];
    try {
      changed = await saveBillingSettings(deps, body, a.user.id);
    } catch (err) {
      if (err instanceof EncryptionUnavailableError) throw new ApiError(503, "service_unavailable", "Set SETTINGS_ENCRYPTION_KEY on the server before storing payment secrets");
      throw err;
    }
    // Field names only — secret values never reach the log.
    if (changed.length) await audit(c, a, "billing.settings.update", "billing", { changed });
    deps.logger.info("admin.billing_settings", { userId: a.user.id, changed });
    return c.json({ settings: adminSettingsView(await loadBillingSettings(deps)), changed });
  });

  r.get("/orders", async (c) => {
    const q = parseQuery(c, z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), status: z.enum(["pending", "paid", "failed", "cancelled"]).optional() }));
    const orders = await listOrders(c.get("deps").sql, q);
    return c.json({ orders: orders.map(billing.adminOrderDto) });
  });

  r.get("/users", async (c) => {
    const { email } = parseQuery(c, z.object({ email: z.string().trim().email().max(254) }));
    return c.json(await billing.adminLookup(c.get("deps"), email));
  });

  r.post("/entitlements", async (c) => {
    const a = requireOperator(c);
    const body = await parseJson(c, EntitlementBody);
    const result = await billing.adminSetEntitlement(c.get("deps"), body);
    await audit(c, a, `billing.entitlement.${body.action}`, result.email, { userId: result.userId, previous: result.previous, validUntil: result.validUntil, months: body.months ?? null, until: body.until ?? null, note: body.note ?? null });
    return c.json({ entitlement: result });
  });

  r.get("/audit", async (c) => {
    const { limit } = parseQuery(c, z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }));
    const entries = await listAudit(c.get("deps").sql, limit);
    return c.json({ entries: entries.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })) });
  });

  return r;
}
