import { beforeEach, describe, expect, it, vi } from "vitest";
import { BILLING_CONTACT_EMAIL, BUSINESS_PRICES, LICENSE_KEY_PATTERN, generateLicenseKey } from "@autoflow/core";
import { SecretBox } from "../src/lib/secrets.js";
import { MAX_PENDING_ORDERS, expirePendingOrders, reconcilePendingOrders } from "../src/services/billing.js";
import { b64, makeApp, useTestDb, type AppOptions, type TestApp } from "./helpers.js";

const db = useTestDb();

// Billing settings are deployment-wide; start every test from "no keys configured".
beforeEach(async () => {
  await db.sql`DELETE FROM app_settings`;
});

const BEFORE_CUTOFF = new Date("2026-10-19T14:59:59Z"); // 2026-10-19 23:59:59 KST, last free second
const AFTER_CUTOFF = new Date("2026-10-19T15:00:00Z"); // 2026-10-20 00:00 KST: Business license required
const PORTONE_SECRET = "portone-api-secret-ABCD1234wxyz";
const PAYPAL_SECRET = "paypal-client-secret-EFGH5678";

const payload = () => ({ ciphertext: b64(48), iv: b64(12), contentHash: "b".repeat(64) });

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

/** Routes mocked provider calls by "METHOD host/path". */
function providerMock(routes: Record<string, Handler>) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = `${init?.method ?? "GET"} ${url.host}${url.pathname}`;
    const h = routes[key] ?? Object.entries(routes).find(([k]) => k.endsWith("*") && key.startsWith(k.slice(0, -1)))?.[1];
    if (!h) return new Response(`unexpected ${key}`, { status: 599 });
    return h(url, init ?? {});
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

function clock(start: Date) {
  const c = { t: start, now: () => c.t };
  return c;
}

async function operator(t: TestApp) {
  return t.signup({ email: t.config.adminEmails[0], verified: true });
}

async function configure(t: TestApp, opToken: string, which: { portone?: boolean; paypal?: boolean } = { portone: true, paypal: true }) {
  const body: Record<string, unknown> = {};
  if (which.portone) body.portone = { enabled: true, storeId: "store-00000000-0000-0000-0000-000000000001", channelKey: "channel-key-00000000-0000-0000-0000-000000000002", apiSecret: PORTONE_SECRET };
  if (which.paypal) body.paypal = { enabled: true, env: "sandbox", clientId: "AeClientId_1234567890", clientSecret: PAYPAL_SECRET };
  const r = await t.call("PUT", "/v1/admin/billing/settings", { token: opToken, body });
  expect(r.status, r.text).toBe(200);
  return r;
}

async function businessUser(t: TestApp) {
  const u = await t.signup();
  const r = await t.call("PATCH", "/v1/me", { token: u.token, body: { usageType: "business" } });
  expect(r.json.user.usageType).toBe("business");
  return u;
}

function portonePaid(paymentId: string, total: number, extra: Record<string, unknown> = {}) {
  return Response.json({ id: paymentId, status: "PAID", storeId: "store-00000000-0000-0000-0000-000000000001", currency: "KRW", amount: { total, paid: total }, ...extra });
}

let apps = 0;
/** Each app gets its own operator address (the database is shared by the whole file). */
function app(opts: AppOptions = {}) {
  return makeApp(db, { adminEmails: [`operator${++apps}@example.com`], ...opts });
}

describe("billing config and usage type", () => {
  it("works with no payment keys: free policy, checkout disabled, nothing secret", async () => {
    const t = app();
    const r = await t.call("GET", "/v1/billing/config");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      checkoutEnabled: false,
      providers: { portone: { enabled: false }, paypal: { enabled: false } },
      policy: { personalUse: "free", businessFreeUntil: "2026-10-19T23:59:59+09:00", syncLaunchPrice: { KRW: 0, USD: 0 } },
      plans: { business: { prices: BUSINESS_PRICES } },
    });

    const u = await t.signup();
    expect((await t.call("GET", "/v1/me", { token: u.token })).json.user).toMatchObject({ usageType: "personal", isAdmin: false });
    const st = await t.call("GET", "/v1/billing/status", { token: u.token });
    expect(st.json).toMatchObject({ usageType: "personal", status: "personal_free", entitlement: null, checkoutEnabled: false });

    const co = await t.call("PATCH", "/v1/me", { token: u.token, body: { usageType: "business" } });
    expect(co.json.user.usageType).toBe("business");
    const checkout = await t.call("POST", "/v1/billing/checkout", { token: u.token, body: { provider: "portone", period: "month" } });
    expect(checkout.status).toBe(503);
    expect(checkout.json.error.code).toBe("billing_disabled");
    expect((await t.call("PATCH", "/v1/me", { token: u.token, body: { usageType: "company" } })).status).toBe(400);
  });
});

describe("admin billing settings", () => {
  it("is only for verified operator emails and never returns or stores plaintext secrets", async () => {
    const t = app();
    const someone = await t.signup({ verified: true });
    expect((await t.call("GET", "/v1/admin/billing/settings", { token: someone.token })).status).toBe(403);
    expect((await t.call("GET", "/v1/admin/billing/settings")).status).toBe(401);

    const opEmail = t.config.adminEmails[0]!;
    const op = await t.signup({ email: opEmail });
    expect((await t.call("GET", "/v1/me", { token: op.token })).json.user.isAdmin).toBe(false);
    expect((await t.call("GET", "/v1/admin/billing/settings", { token: op.token })).status).toBe(403);
    await t.verify(opEmail);
    expect((await t.call("GET", "/v1/me", { token: op.token })).json.user.isAdmin).toBe(true);

    const saved = await configure(t, op.token);
    expect(saved.json.settings.portone).toMatchObject({ enabled: true, ready: true, apiSecret: { set: true, last4: "wxyz" } });
    expect(saved.json.settings.paypal).toMatchObject({ enabled: true, ready: true, env: "sandbox", clientSecret: { set: true, last4: "5678" } });
    expect(saved.text).not.toContain(PORTONE_SECRET);
    expect(saved.text).not.toContain(PAYPAL_SECRET);

    const [row] = await db.sql<{ value: unknown }[]>`SELECT value FROM app_settings WHERE key = 'billing'`;
    const stored = JSON.stringify(row!.value);
    expect(stored).not.toContain(PORTONE_SECRET);
    expect(stored).not.toContain(PAYPAL_SECRET);
    expect(stored).toMatch(/"apiSecret":"v1\./);

    const pub = await t.call("GET", "/v1/billing/config");
    expect(pub.json).toMatchObject({
      checkoutEnabled: true,
      providers: {
        portone: { enabled: true, storeId: "store-00000000-0000-0000-0000-000000000001", channelKey: "channel-key-00000000-0000-0000-0000-000000000002", currency: "KRW" },
        paypal: { enabled: true, clientId: "AeClientId_1234567890", env: "sandbox", currency: "USD" },
      },
    });
    expect(pub.text).not.toMatch(/secret/i);

    // Keeping a secret (field omitted) vs. clearing it (null); price override.
    const upd = await t.call("PUT", "/v1/admin/billing/settings", { token: op.token, body: { paypal: { clientSecret: null }, prices: { month: { KRW: 11_000 } } } });
    expect(upd.json.changed.sort()).toEqual(["paypal.clientSecret", "prices.month.KRW"]);
    expect(upd.json.settings.portone.apiSecret.set).toBe(true);
    expect(upd.json.settings.paypal).toMatchObject({ ready: false, clientSecret: { set: false } });
    expect((await t.call("GET", "/v1/billing/config")).json.plans.business.prices.month.KRW).toBe(11_000);

    const audit = await t.call("GET", "/v1/admin/billing/audit", { token: op.token });
    expect(audit.json.entries.map((e: { action: string }) => e.action)).toEqual(["billing.settings.update", "billing.settings.update"]);
    expect(audit.text).not.toContain(PORTONE_SECRET);
    expect(audit.json.entries[1].details.changed).toContain("portone.apiSecret");

    // Unknown fields and whitespace in secrets are rejected.
    expect((await t.call("PUT", "/v1/admin/billing/settings", { token: op.token, body: { portone: { apiSecret: "has a space here" } } })).status).toBe(400);
    expect((await t.call("PUT", "/v1/admin/billing/settings", { token: op.token, body: { stripe: {} } })).status).toBe(400);
  });

  it("refuses to store secrets without an encryption key and seals values under the configured key", async () => {
    const noKey = app({ settingsEncryptionKey: null });
    const op = await operator(noKey);
    const r = await noKey.call("PUT", "/v1/admin/billing/settings", { token: op.token, body: { portone: { apiSecret: PORTONE_SECRET } } });
    expect(r.status).toBe(503);

    const box = new SecretBox("k".repeat(40));
    const sealed = box.seal("hello", "portone.apiSecret");
    expect(box.open(sealed, "portone.apiSecret")).toBe("hello");
    expect(box.open(sealed, "paypal.clientSecret")).toBeNull();
    expect(new SecretBox("z".repeat(40)).open(sealed, "portone.apiSecret")).toBeNull();
    expect(box.open(sealed.replace(/\.(.)/, ".A"), "portone.apiSecret")).toBeNull();
  });
});

describe("entitlement gate", () => {
  it("blocks only business sync writes from 2026-10-20 KST without a plan, and never reads, deletes or export", async () => {
    const c = clock(BEFORE_CUTOFF);
    const t = app({ now: c.now });
    const op = await operator(t);
    const personal = await t.signup();
    const biz = await businessUser(t);
    await configure(t, op.token, { portone: true });

    // Before the cutoff: everyone writes.
    expect((await t.call("PUT", "/v1/sync/items/flow/a", { token: biz.token, body: payload(), headers: { "If-Match": "0" } })).status).toBe(201);
    expect((await t.call("GET", "/v1/billing/status", { token: biz.token })).json.status).toBe("business_free");

    c.t = AFTER_CUTOFF;
    expect((await t.call("PUT", "/v1/sync/items/flow/p", { token: personal.token, body: payload(), headers: { "If-Match": "0" } })).status).toBe(201);
    const blocked = await t.call("PUT", "/v1/sync/items/flow/b", { token: biz.token, body: payload(), headers: { "If-Match": "0" } });
    expect(blocked.status).toBe(402);
    expect(blocked.json.error.code).toBe("business_plan_required");
    expect((await t.call("GET", "/v1/billing/status", { token: biz.token })).json.status).toBe("business_required");

    // Never held hostage: reads, tombstones, export and account deletion keep working.
    expect((await t.call("GET", "/v1/sync", { token: biz.token })).json.items).toHaveLength(1);
    expect((await t.call("GET", "/v1/sync/items/flow/a", { token: biz.token })).status).toBe(200);
    expect((await t.call("DELETE", "/v1/sync/items/flow/a", { token: biz.token, headers: { "If-Match": "1" } })).status).toBe(200);
    expect((await t.call("GET", "/v1/me/export", { token: biz.token })).status).toBe(200);

    // Switching back to personal use is the user's call and unblocks writes.
    await t.call("PATCH", "/v1/me", { token: biz.token, body: { usageType: "personal" } });
    expect((await t.call("PUT", "/v1/sync/items/flow/c", { token: biz.token, body: payload(), headers: { "If-Match": "0" } })).status).toBe(201);
    await t.call("PATCH", "/v1/me", { token: biz.token, body: { usageType: "business" } });

    // An operator grant (audited) unblocks; a revoke blocks again. A grant that ends in the past is a mistake.
    const past = await t.call("POST", "/v1/admin/billing/entitlements", { token: op.token, body: { email: biz.email, action: "grant", until: "2020-01-01T00:00:00Z" } });
    expect(past.status).toBe(400);
    expect(past.json.error.details).toEqual([{ path: "until", message: "until must be in the future" }]);
    const grant = await t.call("POST", "/v1/admin/billing/entitlements", { token: op.token, body: { email: biz.email, action: "grant", months: 1, note: "invoice #12" } });
    expect(grant.status).toBe(200);
    expect(grant.json.entitlement.validUntil).toBe("2026-11-19T15:00:00.000Z");
    expect((await t.call("PUT", "/v1/sync/items/flow/d", { token: biz.token, body: payload(), headers: { "If-Match": "0" } })).status).toBe(201);
    expect((await t.call("GET", "/v1/billing/status", { token: biz.token })).json.status).toBe("business_active");
    await t.call("POST", "/v1/admin/billing/entitlements", { token: op.token, body: { email: biz.email, action: "revoke" } });
    expect((await t.call("PUT", "/v1/sync/items/flow/e", { token: biz.token, body: payload(), headers: { "If-Match": "0" } })).status).toBe(402);
    const audit = await t.call("GET", "/v1/admin/billing/audit", { token: op.token });
    expect(audit.json.entries.slice(0, 2).map((e: { action: string }) => e.action)).toEqual(["billing.entitlement.revoke", "billing.entitlement.grant"]);
    expect(audit.json.entries[1].details.note).toBe("invoice #12");

    // Account deletion is never blocked.
    expect((await t.call("DELETE", "/v1/me", { token: biz.token, body: { password: biz.password } })).status).toBe(204);
  });

  it("does not block business users while no payment provider is configured", async () => {
    const t = app({ now: () => AFTER_CUTOFF });
    const biz = await businessUser(t);
    expect((await t.call("PUT", "/v1/sync/items/flow/a", { token: biz.token, body: payload(), headers: { "If-Match": "0" } })).status).toBe(201);
  });
});

describe("PortOne checkout and verification", () => {
  it("verifies the payment with PortOne, extends the entitlement once and stays idempotent under races", async () => {
    let paidTotal = BUSINESS_PRICES.month.KRW;
    const fetchMock = providerMock({
      "GET api.portone.io/payments/*": (url, init) => {
        expect((init.headers as Record<string, string>).Authorization).toBe(`PortOne ${PORTONE_SECRET}`);
        return portonePaid(decodeURIComponent(url.pathname.split("/").pop()!), paidTotal);
      },
    });
    const c = clock(AFTER_CUTOFF);
    const t = app({ fetch: fetchMock, now: c.now });
    const op = await operator(t);
    await configure(t, op.token, { portone: true });
    const biz = await businessUser(t);

    const co = await t.call("POST", "/v1/billing/checkout", { token: biz.token, body: { provider: "portone", period: "month" } });
    expect(co.status).toBe(201);
    expect(co.json.portone).toMatchObject({ storeId: "store-00000000-0000-0000-0000-000000000001", totalAmount: 9_900, currency: "CURRENCY_KRW", payMethod: "CARD" });
    expect(co.text).not.toContain(PORTONE_SECRET);
    const paymentId = co.json.portone.paymentId as string;
    expect(paymentId).toMatch(/^af-[0-9A-Za-z]{24}$/);

    // Two confirmations racing (e.g. a double-click on the return page).
    const [a, b] = await Promise.all([
      t.call("POST", "/v1/billing/confirm", { token: biz.token, body: { provider: "portone", paymentId } }),
      t.call("POST", "/v1/billing/confirm", { token: biz.token, body: { provider: "portone", paymentId } }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.json.order.status).toBe("paid");
    // Exactly one of the racing confirmations settled the order, and only it carries the key.
    const keys = [a.json.licenseKey, b.json.licenseKey].filter(Boolean);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(LICENSE_KEY_PATTERN);
    expect(a.json.billing).toMatchObject({ status: "business_active", entitlement: { validUntil: "2026-11-19T15:00:00.000Z" } });
    const again = await t.call("POST", "/v1/billing/confirm", { token: biz.token, body: { provider: "portone", paymentId } });
    expect(again.json.billing.entitlement.validUntil).toBe("2026-11-19T15:00:00.000Z");
    expect(again.json.licenseKey).toBeNull();
    expect(again.json.billing.licenseKeys).toHaveLength(1);
    expect(again.json.billing.licenseKeys[0]).toMatchObject({ source: "purchase", period: "month", key: `AFB-•••••-•••••-•••••-•${keys[0].slice(-4)}` });
    // Only the hash is stored; the order's key is already applied, so it cannot be redeemed again.
    const [stored] = await db.sql<{ key_hash: string; status: string }[]>`SELECT key_hash, status FROM license_keys WHERE redeemed_by = (SELECT id FROM users WHERE email = ${biz.email})`;
    expect(stored!.status).toBe("redeemed");
    expect(JSON.stringify(stored)).not.toContain(keys[0].slice(4, 9));
    const reuse = await t.call("POST", "/v1/billing/redeem", { token: biz.token, body: { key: keys[0] } });
    expect(reuse.status).toBe(409);
    expect(reuse.json.error.code).toBe("license_key_used");
    const [count] = await db.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM orders WHERE provider_payment_id = ${paymentId}`;
    expect(count!.n).toBe(1);

    // A yearly purchase extends the running entitlement instead of restarting it.
    c.t = new Date("2026-11-01T00:00:00Z");
    paidTotal = BUSINESS_PRICES.year.KRW;
    const year = await t.call("POST", "/v1/billing/checkout", { token: biz.token, body: { provider: "portone", period: "year" } });
    const ok = await t.call("POST", "/v1/billing/confirm", { token: biz.token, body: { provider: "portone", paymentId: year.json.portone.paymentId } });
    expect(ok.json.billing.entitlement.validUntil).toBe("2027-11-19T15:00:00.000Z");

    // Writes are allowed again; the admin order list shows both.
    expect((await t.call("PUT", "/v1/sync/items/flow/x", { token: biz.token, body: payload(), headers: { "If-Match": "0" } })).status).toBe(201);
    const orders = await t.call("GET", "/v1/admin/billing/orders?status=paid", { token: op.token });
    const mine = orders.json.orders.filter((o: { buyerEmail: string }) => o.buyerEmail === biz.email);
    expect(mine).toHaveLength(2);
    expect(mine[0]).toMatchObject({ buyerEmail: biz.email, status: "paid", currency: "KRW" });
  });

  it("rejects and refunds a payment whose amount does not match the order", async () => {
    const cancel = vi.fn(() => Response.json({ cancellation: { status: "SUCCEEDED" } }));
    const fetchMock = providerMock({
      "GET api.portone.io/payments/*": (url) => portonePaid(decodeURIComponent(url.pathname.split("/").pop()!), 100),
      "POST api.portone.io/payments/*": cancel,
    });
    const t = app({ fetch: fetchMock, now: () => AFTER_CUTOFF });
    const op = await operator(t);
    await configure(t, op.token, { portone: true });
    const biz = await businessUser(t);
    const co = await t.call("POST", "/v1/billing/checkout", { token: biz.token, body: { provider: "portone", period: "month" } });
    const r = await t.call("POST", "/v1/billing/confirm", { token: biz.token, body: { provider: "portone", paymentId: co.json.portone.paymentId } });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("payment_mismatch");
    // Money may have moved: the client can show whom to write to.
    expect(r.json.error.details).toMatchObject({ reason: "amount_mismatch_refunded", contact: BILLING_CONTACT_EMAIL });
    expect(cancel).toHaveBeenCalledTimes(1);
    const st = await t.call("GET", "/v1/billing/status", { token: biz.token });
    expect(st.json).toMatchObject({ status: "business_required", entitlement: null });
    expect(st.json.orders[0].status).toBe("failed");
    // Retrying does not flip a failed order to paid.
    expect((await t.call("POST", "/v1/billing/confirm", { token: biz.token, body: { provider: "portone", paymentId: co.json.portone.paymentId } })).json.error.code).toBe("payment_failed");
  });

  it("rejects wrong currency or store, keeps unpaid orders pending and hides other users' orders", async () => {
    let respond: (id: string) => Response = (id) => Response.json({ id, status: "READY", currency: "KRW", amount: { total: 9_900 } });
    const fetchMock = providerMock({
      "GET api.portone.io/payments/*": (url) => respond(decodeURIComponent(url.pathname.split("/").pop()!)),
      "POST api.portone.io/payments/*": () => Response.json({}),
    });
    const t = app({ fetch: fetchMock, now: () => AFTER_CUTOFF });
    const op = await operator(t);
    await configure(t, op.token, { portone: true });
    const biz = await businessUser(t);
    const other = await businessUser(t);

    const co = await t.call("POST", "/v1/billing/checkout", { token: biz.token, body: { provider: "portone", period: "month" } });
    const paymentId = co.json.portone.paymentId as string;
    const pending = await t.call("POST", "/v1/billing/confirm", { token: biz.token, body: { provider: "portone", paymentId } });
    expect(pending.status).toBe(409);
    expect(pending.json.error).toMatchObject({ code: "payment_not_completed", details: { providerStatus: "READY" } });

    expect((await t.call("POST", "/v1/billing/confirm", { token: other.token, body: { provider: "portone", paymentId } })).status).toBe(404);
    expect((await t.call("POST", "/v1/billing/confirm", { token: biz.token, body: { provider: "portone", paymentId: "af-notacreatedorder000000000" } })).status).toBe(404);

    respond = (id) => portonePaid(id, 9_900, { currency: "USD" });
    expect((await t.call("POST", "/v1/billing/confirm", { token: biz.token, body: { provider: "portone", paymentId } })).json.error.code).toBe("payment_mismatch");

    const co2 = await t.call("POST", "/v1/billing/checkout", { token: biz.token, body: { provider: "portone", period: "month" } });
    respond = (id) => portonePaid(id, 9_900, { storeId: "store-someone-else" });
    expect((await t.call("POST", "/v1/billing/confirm", { token: biz.token, body: { provider: "portone", paymentId: co2.json.portone.paymentId } })).json.error.code).toBe("payment_mismatch");

    // A payment made through another (e.g. test) channel of the same store is not a purchase.
    const co3 = await t.call("POST", "/v1/billing/checkout", { token: biz.token, body: { provider: "portone", period: "month" } });
    respond = (id) => portonePaid(id, 9_900, { channel: { key: "channel-key-test-00000000", type: "TEST" } });
    expect((await t.call("POST", "/v1/billing/confirm", { token: biz.token, body: { provider: "portone", paymentId: co3.json.portone.paymentId } })).json.error.code).toBe("payment_mismatch");

    // Personal users are not sold a plan they do not need.
    const personal = await t.signup();
    expect((await t.call("POST", "/v1/billing/checkout", { token: personal.token, body: { provider: "portone", period: "month" } })).status).toBe(409);
  });
});

describe("PayPal checkout and capture", () => {
  type PaypalState = { status: string; value: string; captured: number; customId?: string; id?: string };
  let paypalOrders = 0;
  function paypalMock(state: PaypalState) {
    const id = `5O190127TN3647${String(++paypalOrders).padStart(2, "0")}T`;
    state.id = id;
    return providerMock({
      "POST api-m.sandbox.paypal.com/v1/oauth2/token": (_u, init) => {
        expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from(`AeClientId_1234567890:${PAYPAL_SECRET}`).toString("base64")}`);
        return Response.json({ access_token: "A21.token", expires_in: 3600 });
      },
      "POST api-m.sandbox.paypal.com/v2/checkout/orders": async (_u, init) => {
        const body = JSON.parse(String(init.body));
        state.customId = body.purchase_units[0].custom_id;
        expect(body.purchase_units[0].amount).toEqual({ currency_code: "USD", value: "7.99" });
        expect(body.payment_source.paypal.experience_context.return_url).toMatch(/^(https:\/\/autoflowmacro\.com\/app|http:\/\/localhost:5173)\/billing\/return\?provider=paypal$/);
        expect(body.payment_source.paypal.experience_context.cancel_url).toMatch(/\/billing\/return\?provider=paypal&cancelled=1$/);
        expect((init.headers as Record<string, string>)["PayPal-Request-Id"]).toBe(`create-${state.customId}`);
        return Response.json({ id: id, status: "PAYER_ACTION_REQUIRED", links: [{ rel: "payer-action", href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }] }, { status: 200 });
      },
      [`GET api-m.sandbox.paypal.com/v2/checkout/orders/${id}`]: () =>
        Response.json({ id: id, status: state.status, purchase_units: [{ custom_id: state.customId, amount: { currency_code: "USD", value: state.value } }] }),
      [`POST api-m.sandbox.paypal.com/v2/checkout/orders/${id}/capture`]: () => {
        state.captured++;
        state.status = "COMPLETED";
        return Response.json({
          id: id,
          status: "COMPLETED",
          purchase_units: [{ custom_id: state.customId, amount: { currency_code: "USD", value: "7.99" }, payments: { captures: [{ id: "CAP1", status: "COMPLETED", amount: { currency_code: "USD", value: "7.99" } }] } }],
        }, { status: 201 });
      },
    });
  }

  it("creates the order server-side, captures only after checking the approved amount, and settles once", async () => {
    const state: PaypalState = { status: "APPROVED", value: "7.99", captured: 0 };
    const t = app({ fetch: paypalMock(state), now: () => AFTER_CUTOFF });
    const op = await operator(t);
    await configure(t, op.token, { paypal: true });
    const biz = await businessUser(t);

    const bad = await t.call("POST", "/v1/billing/checkout", { token: biz.token, body: { provider: "paypal", period: "month", returnUrl: "https://evil.example.com/billing/return" } });
    expect(bad.status).toBe(400);
    expect((await t.call("POST", "/v1/billing/checkout", { token: biz.token, body: { provider: "paypal", period: "month" } })).status).toBe(400);

    const co = await t.call("POST", "/v1/billing/checkout", { token: biz.token, body: { provider: "paypal", period: "month", returnUrl: "https://autoflowmacro.com/app/billing/return" } });
    expect(co.status, co.text).toBe(201);
    expect(co.json.paypal).toEqual({ orderId: state.id, approveUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${state.id}` });
    expect(state.customId).toBe(co.json.order.id);

    const r = await t.call("POST", "/v1/billing/confirm", { token: biz.token, body: { provider: "paypal", paymentId: state.id } });
    expect(r.status, r.text).toBe(200);
    expect(r.json.order).toMatchObject({ status: "paid", amount: 799, currency: "USD" });
    expect(r.json.billing.entitlement.validUntil).toBe("2026-11-19T15:00:00.000Z");
    const again = await t.call("POST", "/v1/billing/confirm", { token: biz.token, body: { provider: "paypal", paymentId: state.id } });
    expect(again.json.billing.entitlement.validUntil).toBe("2026-11-19T15:00:00.000Z");
    expect(state.captured).toBe(1);
  });

  it("never captures when the approved amount differs from the order", async () => {
    const state: PaypalState = { status: "APPROVED", value: "0.01", captured: 0 };
    const t = app({ fetch: paypalMock(state), now: () => AFTER_CUTOFF });
    const op = await operator(t);
    await configure(t, op.token, { paypal: true });
    const biz = await businessUser(t);
    await t.call("POST", "/v1/billing/checkout", { token: biz.token, body: { provider: "paypal", period: "month", returnUrl: "https://autoflowmacro.com/app/billing/return" } });
    const r = await t.call("POST", "/v1/billing/confirm", { token: biz.token, body: { provider: "paypal", paymentId: state.id } });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("payment_mismatch");
    expect(state.captured).toBe(0);
    expect((await t.call("GET", "/v1/billing/status", { token: biz.token })).json.entitlement).toBeNull();
  });

  it("reports an order the buyer has not approved yet as not completed", async () => {
    const state: PaypalState = { status: "PAYER_ACTION_REQUIRED", value: "7.99", captured: 0 };
    const t = app({ fetch: paypalMock(state), now: () => AFTER_CUTOFF });
    const op = await operator(t);
    await configure(t, op.token, { paypal: true });
    const biz = await businessUser(t);
    await t.call("POST", "/v1/billing/checkout", { token: biz.token, body: { provider: "paypal", period: "month", returnUrl: "http://localhost:5173/billing/return" } });
    const r = await t.call("POST", "/v1/billing/confirm", { token: biz.token, body: { provider: "paypal", paymentId: state.id } });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("payment_not_completed");
    expect(state.captured).toBe(0);
  });
});

describe("license keys", () => {
  it("lets operators issue keys once in plaintext, list them masked and revoke unused ones (audited)", async () => {
    const t = app({ now: () => AFTER_CUTOFF });
    const op = await operator(t);
    const someone = await t.signup({ verified: true });
    expect((await t.call("POST", "/v1/admin/billing/license-keys", { token: someone.token, body: { period: "month", count: 1 } })).status).toBe(403);
    expect((await t.call("POST", "/v1/admin/billing/license-keys", { token: op.token, body: { period: "month", count: 51 } })).status).toBe(400);
    expect((await t.call("POST", "/v1/admin/billing/license-keys", { token: op.token, body: { period: "week", count: 1 } })).status).toBe(400);

    const issued = await t.call("POST", "/v1/admin/billing/license-keys", { token: op.token, body: { period: "year", count: 3, note: "ACME Corp, PO 77" } });
    expect(issued.status, issued.text).toBe(201);
    expect(issued.headers.get("cache-control")).toBe("no-store");
    const keys = issued.json.keys as { key: string; license: { id: string; key: string; status: string; note: string } }[];
    expect(keys).toHaveLength(3);
    expect(new Set(keys.map((k) => k.key)).size).toBe(3);
    for (const k of keys) {
      expect(k.key).toMatch(LICENSE_KEY_PATTERN);
      expect(k.license).toMatchObject({ status: "issued", period: "year", note: "ACME Corp, PO 77", key: `AFB-•••••-•••••-•••••-•${k.key.slice(-4)}` });
    }

    const list = await t.call("GET", "/v1/admin/billing/license-keys?status=issued", { token: op.token });
    expect(list.status).toBe(200);
    for (const k of keys) expect(list.text).not.toContain(k.key);
    expect(list.text).not.toContain("key_hash");
    expect(list.json.keys.filter((k: { note: string }) => k.note === "ACME Corp, PO 77")).toHaveLength(3);

    const rev = await t.call("POST", `/v1/admin/billing/license-keys/${keys[2]!.license.id}/revoke`, { token: op.token });
    expect(rev.status).toBe(200);
    expect(rev.json.key.status).toBe("revoked");
    expect((await t.call("POST", `/v1/admin/billing/license-keys/${keys[2]!.license.id}/revoke`, { token: op.token })).status).toBe(409);
    expect((await t.call("POST", "/v1/admin/billing/license-keys/00000000-0000-0000-0000-000000000000/revoke", { token: op.token })).status).toBe(404);

    const audit = await t.call("GET", "/v1/admin/billing/audit", { token: op.token });
    expect(audit.json.entries.slice(0, 2).map((e: { action: string }) => e.action)).toEqual(["billing.license.revoke", "billing.license.issue"]);
    for (const k of keys) expect(audit.text).not.toContain(k.key);
    expect(audit.json.entries[1].details).toMatchObject({ count: 3, period: "year", note: "ACME Corp, PO 77" });
  });

  it("redeems a key exactly once — also under races — and rejects wrong, unknown and revoked keys", async () => {
    const t = app({ now: () => AFTER_CUTOFF });
    const op = await operator(t);
    await configure(t, op.token, { portone: true });
    const issued = await t.call("POST", "/v1/admin/billing/license-keys", { token: op.token, body: { period: "month", count: 2 } });
    const [k1, k2] = issued.json.keys as { key: string; license: { id: string } }[];

    // A personal user redeeming becomes a licensed business account.
    const user = await t.signup();
    expect((await t.call("POST", "/v1/billing/redeem", { body: { key: k1!.key } })).status).toBe(401);
    const typo = k1!.key.slice(0, -1) + (k1!.key.endsWith("0") ? "1" : "0");
    const bad = await t.call("POST", "/v1/billing/redeem", { token: user.token, body: { key: typo } });
    // A typo and a key that was never issued get the same answer.
    expect(bad.status).toBe(404);
    expect(bad.json.error.code).toBe("invalid_license_key");
    const unknown = await t.call("POST", "/v1/billing/redeem", { token: user.token, body: { key: generateLicenseKey() } });
    expect(unknown.status).toBe(404);
    expect(unknown.json.error.code).toBe("invalid_license_key");

    // Forgiving input: lower case, no dashes.
    const ok = await t.call("POST", "/v1/billing/redeem", { token: user.token, body: { key: k1!.key.toLowerCase().replace(/-/g, " ") } });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.json.redeemed).toMatchObject({ period: "month", validUntil: "2026-11-19T15:00:00.000Z" });
    expect(ok.json.billing).toMatchObject({ usageType: "business", status: "business_active", entitlement: { validUntil: "2026-11-19T15:00:00.000Z" } });
    expect(ok.json.billing.licenseKeys[0]).toMatchObject({ source: "key", period: "month" });
    expect((await t.call("GET", "/v1/me", { token: user.token })).json.user.usageType).toBe("business");
    expect((await t.call("PUT", "/v1/sync/items/flow/a", { token: user.token, body: payload(), headers: { "If-Match": "0" } })).status).toBe(201);

    const twice = await t.call("POST", "/v1/billing/redeem", { token: user.token, body: { key: k1!.key } });
    expect(twice.status).toBe(409);
    expect(twice.json.error.code).toBe("license_key_used");

    // Two accounts racing for the same key: exactly one wins.
    const a = await t.signup();
    const b = await t.signup();
    const results = await Promise.all([
      t.call("POST", "/v1/billing/redeem", { token: a.token, body: { key: k2!.key } }),
      t.call("POST", "/v1/billing/redeem", { token: b.token, body: { key: k2!.key } }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = results[0]!.status === 200 ? b : a;
    expect((await t.call("GET", "/v1/billing/status", { token: loser.token })).json.entitlement).toBeNull();
    const [row] = await db.sql<{ status: string; n: number }[]>`SELECT status, count(*)::int AS n FROM license_keys WHERE id = ${k2!.license.id} GROUP BY status`;
    expect(row).toMatchObject({ status: "redeemed", n: 1 });

    // A redeemed key cannot be revoked; an unused revoked key cannot be redeemed.
    expect((await t.call("POST", `/v1/admin/billing/license-keys/${k2!.license.id}/revoke`, { token: op.token })).status).toBe(409);
    const more = await t.call("POST", "/v1/admin/billing/license-keys", { token: op.token, body: { period: "month", count: 1 } });
    const k3 = more.json.keys[0] as { key: string; license: { id: string } };
    await t.call("POST", `/v1/admin/billing/license-keys/${k3.license.id}/revoke`, { token: op.token });
    const revoked = await t.call("POST", "/v1/billing/redeem", { token: a.token, body: { key: k3.key } });
    expect(revoked.status).toBe(410);
    expect(revoked.json.error.code).toBe("license_key_revoked");

    // The admin list shows who redeemed what.
    const list = await t.call("GET", "/v1/admin/billing/license-keys?status=redeemed", { token: op.token });
    expect(list.json.keys.map((k: { redeemedByEmail: string }) => k.redeemedByEmail)).toContain(user.email);
  });

  it("extends a running entitlement instead of restarting it", async () => {
    const t = app({ now: () => AFTER_CUTOFF });
    const op = await operator(t);
    const user = await businessUser(t);
    await t.call("POST", "/v1/admin/billing/entitlements", { token: op.token, body: { email: user.email, action: "grant", months: 1 } });
    const issued = await t.call("POST", "/v1/admin/billing/license-keys", { token: op.token, body: { period: "year", count: 1 } });
    const r = await t.call("POST", "/v1/billing/redeem", { token: user.token, body: { key: issued.json.keys[0].key } });
    expect(r.json.billing.entitlement.validUntil).toBe("2027-11-19T15:00:00.000Z");
  });
});

describe("pending orders", () => {
  const hours = (n: number) => n * 3_600_000;

  it("lets the buyer cancel a pending order (owner only, once) and caps open checkouts", async () => {
    const fetchMock = providerMock({ "GET api.portone.io/payments/*": (url) => portonePaid(decodeURIComponent(url.pathname.split("/").pop()!), 9_900) });
    const t = app({ fetch: fetchMock, now: () => AFTER_CUTOFF });
    const op = await operator(t);
    await configure(t, op.token, { portone: true });
    const biz = await businessUser(t);
    const other = await businessUser(t);

    const co = await t.call("POST", "/v1/billing/checkout", { token: biz.token, body: { provider: "portone", period: "month" } });
    const orderId = co.json.order.id as string;
    // Someone else's order looks exactly like a missing one.
    expect((await t.call("POST", `/v1/billing/orders/${orderId}/cancel`, { token: other.token })).status).toBe(404);
    expect((await t.call("POST", "/v1/billing/orders/00000000-0000-0000-0000-000000000000/cancel", { token: biz.token })).status).toBe(404);
    expect((await t.call("POST", `/v1/billing/orders/${orderId}/cancel`)).status).toBe(401);
    const cancelled = await t.call("POST", `/v1/billing/orders/${orderId}/cancel`, { token: biz.token });
    expect(cancelled.status, cancelled.text).toBe(200);
    expect(cancelled.json.order).toMatchObject({ id: orderId, status: "cancelled", paymentId: null });
    const again = await t.call("POST", `/v1/billing/orders/${orderId}/cancel`, { token: biz.token });
    expect(again.status).toBe(409);
    expect(again.json.error.details).toEqual({ status: "cancelled" });
    // A cancelled order cannot be confirmed into a paid one, even if the provider says PAID.
    expect((await t.call("POST", "/v1/billing/confirm", { token: biz.token, body: { provider: "portone", paymentId: co.json.portone.paymentId } })).json.error.code).toBe("payment_failed");
    expect((await t.call("GET", "/v1/billing/status", { token: biz.token })).json.orders[0].status).toBe("cancelled");

    // A paid order is not cancellable here (refunds are an operator matter).
    const paid = await t.call("POST", "/v1/billing/checkout", { token: biz.token, body: { provider: "portone", period: "month" } });
    await t.call("POST", "/v1/billing/confirm", { token: biz.token, body: { provider: "portone", paymentId: paid.json.portone.paymentId } });
    expect((await t.call("POST", `/v1/billing/orders/${paid.json.order.id}/cancel`, { token: biz.token })).status).toBe(409);

    // At most MAX_PENDING_ORDERS open checkouts per account; cancelling one frees a slot.
    const ids: string[] = [];
    for (let i = 0; i < MAX_PENDING_ORDERS; i++) {
      const r = await t.call("POST", "/v1/billing/checkout", { token: biz.token, body: { provider: "portone", period: "month" } });
      expect(r.status, r.text).toBe(201);
      ids.push(r.json.order.id);
    }
    const capped = await t.call("POST", "/v1/billing/checkout", { token: biz.token, body: { provider: "portone", period: "month" } });
    expect(capped.status).toBe(409);
    expect(capped.json.error).toMatchObject({ code: "too_many_pending_orders", details: { max: MAX_PENDING_ORDERS } });
    expect((await t.call("POST", "/v1/billing/checkout", { token: other.token, body: { provider: "portone", period: "month" } })).status).toBe(201);
    await t.call("POST", `/v1/billing/orders/${ids[0]}/cancel`, { token: biz.token });
    expect((await t.call("POST", "/v1/billing/checkout", { token: biz.token, body: { provider: "portone", period: "month" } })).status).toBe(201);
  });

  it("reconciles pending orders the provider settled without a confirm call, idempotently and one failure at a time", async () => {
    const paidIds = new Set<string>();
    const brokenIds = new Set<string>();
    const fetchMock = providerMock({
      "GET api.portone.io/payments/*": (url) => {
        const id = decodeURIComponent(url.pathname.split("/").pop()!);
        if (brokenIds.has(id)) throw new Error("socket hang up");
        return paidIds.has(id) ? portonePaid(id, BUSINESS_PRICES.month.KRW) : Response.json({ id, status: "READY", currency: "KRW", amount: { total: 9_900 } });
      },
    });
    const c = clock(AFTER_CUTOFF);
    const t = app({ fetch: fetchMock, now: c.now });
    const op = await operator(t);
    await configure(t, op.token, { portone: true });
    const biz = await businessUser(t);

    // The sweep is deployment-wide; close what earlier tests in this file left open.
    await db.sql`UPDATE orders SET status = 'cancelled' WHERE status = 'pending'`;
    // Nothing pending: nothing to do (and no provider calls).
    expect(await reconcilePendingOrders(t.deps)).toEqual({ checked: 0, settled: 0, rejected: 0, failed: 0 });

    const checkout = async () => (await t.call("POST", "/v1/billing/checkout", { token: biz.token, body: { provider: "portone", period: "month" } })).json.portone.paymentId as string;
    const stuck = await checkout(); // paid, but the browser never confirmed
    const unpaid = await checkout(); // buyer still on the payment page
    const broken = await checkout(); // provider unreachable for this one
    const old = await checkout(); // paid, but outside the 48 h window: reconciliation leaves it alone
    paidIds.add(stuck).add(old);
    brokenIds.add(broken);
    await db.sql`UPDATE orders SET created_at = ${new Date(c.t.getTime() - hours(50))} WHERE provider_payment_id = ${old}`;
    for (const id of [stuck, unpaid, broken]) await db.sql`UPDATE orders SET created_at = ${new Date(c.t.getTime() - hours(1))} WHERE provider_payment_id = ${id}`;

    const first = await reconcilePendingOrders(t.deps);
    expect(first).toEqual({ checked: 3, settled: 1, rejected: 0, failed: 1 });
    const st = await t.call("GET", "/v1/billing/status", { token: biz.token });
    expect(st.json).toMatchObject({ status: "business_active", entitlement: { validUntil: "2026-11-19T15:00:00.000Z" } });
    const byPayment = (id: string) => (st.json.orders as { paymentId: string | null; status: string }[]).find((o) => o.paymentId === id)?.status ?? "paid";
    expect(byPayment(stuck)).toBe("paid");
    expect(byPayment(unpaid)).toBe("pending");
    expect(byPayment(broken)).toBe("pending");
    expect(byPayment(old)).toBe("pending");
    // The settled order got its license key like any purchase; the plaintext was never shown.
    expect(st.json.licenseKeys).toHaveLength(1);
    expect(st.json.licenseKeys[0]).toMatchObject({ source: "purchase", period: "month" });

    // Running again settles nothing twice; the browser confirming later finds the order paid and gets no key.
    expect(await reconcilePendingOrders(t.deps)).toEqual({ checked: 2, settled: 0, rejected: 0, failed: 1 });
    const confirm = await t.call("POST", "/v1/billing/confirm", { token: biz.token, body: { provider: "portone", paymentId: stuck } });
    expect(confirm.status).toBe(200);
    expect(confirm.json).toMatchObject({ licenseKey: null, order: { status: "paid" }, billing: { entitlement: { validUntil: "2026-11-19T15:00:00.000Z" } } });

    // A payment that turns out not to match is rejected (and counted) without stopping the sweep.
    brokenIds.delete(broken);
    paidIds.add(broken);
    await db.sql`UPDATE orders SET amount = 1 WHERE provider_payment_id = ${broken}`;
    expect(await reconcilePendingOrders(t.deps)).toEqual({ checked: 2, settled: 0, rejected: 1, failed: 0 });
    const [rejected] = await db.sql<{ status: string; failure_reason: string }[]>`SELECT status, failure_reason FROM orders WHERE provider_payment_id = ${broken}`;
    expect(rejected).toEqual({ status: "failed", failure_reason: "amount_mismatch" });
  });

  it("expires pending orders older than 72 hours and leaves newer ones alone", async () => {
    const t = app({ fetch: providerMock({}), now: () => AFTER_CUTOFF });
    const op = await operator(t);
    await configure(t, op.token, { portone: true });
    const biz = await businessUser(t);
    await db.sql`UPDATE orders SET status = 'cancelled' WHERE status = 'pending'`;
    const fresh = (await t.call("POST", "/v1/billing/checkout", { token: biz.token, body: { provider: "portone", period: "month" } })).json.order.id as string;
    const stale = (await t.call("POST", "/v1/billing/checkout", { token: biz.token, body: { provider: "portone", period: "month" } })).json.order.id as string;
    const noPayment = (await t.call("POST", "/v1/billing/checkout", { token: biz.token, body: { provider: "portone", period: "month" } })).json.order.id as string;
    await db.sql`UPDATE orders SET created_at = ${new Date(AFTER_CUTOFF.getTime() - hours(71))} WHERE id = ${fresh}`;
    await db.sql`UPDATE orders SET created_at = ${new Date(AFTER_CUTOFF.getTime() - hours(73))} WHERE id = ${stale}`;
    await db.sql`UPDATE orders SET created_at = ${new Date(AFTER_CUTOFF.getTime() - hours(73))}, provider_payment_id = NULL WHERE id = ${noPayment}`;

    expect(await expirePendingOrders(t.deps)).toBe(2);
    expect(await expirePendingOrders(t.deps)).toBe(0);
    const rows = await db.sql<{ id: string; status: string; failure_reason: string | null }[]>`SELECT id, status, failure_reason FROM orders WHERE id IN ${db.sql([fresh, stale, noPayment])}`;
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by[fresh]).toMatchObject({ status: "pending", failure_reason: null });
    expect(by[stale]).toMatchObject({ status: "cancelled", failure_reason: "expired" });
    expect(by[noPayment]).toMatchObject({ status: "cancelled", failure_reason: "expired" });
    // Expired orders no longer count against the pending cap.
    expect((await t.call("GET", "/v1/billing/status", { token: biz.token })).json.orders.filter((o: { status: string }) => o.status === "pending")).toHaveLength(1);
  });
});
