/** Security hardening: log redaction, production CORS defaults, Atlas report visibility, relay body timeouts, hostile flows. */
import { describe, expect, it } from "vitest";
import { redactPath } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { makeApp, sampleFlow, useTestDb } from "./helpers.js";

const db = useTestDb();
const KEY = "sk-test-0123456789abcdef";

describe("access-log redaction", () => {
  it("never writes share ids or client item ids to the access log", async () => {
    expect(redactPath("/v1/shares/AbCdEfGhIj")).toBe("/v1/shares/:id");
    expect(redactPath("/v1/shares/mine")).toBe("/v1/shares/mine");
    expect(redactPath("/v1/sync/items/flow/my-secret-flow-name")).toBe("/v1/sync/items/flow/:id");
    expect(redactPath("/v1/atlas/templates")).toBe("/v1/atlas/templates");

    const lines: string[] = [];
    const t = makeApp(db, { logger: createLogger("info", {}, (l) => lines.push(l)) });
    const created = await t.call("POST", "/v1/shares", { body: { flow: sampleFlow() } });
    expect(created.status).toBe(201);
    const id = created.json.share.id as string;
    expect((await t.call("GET", `/v1/shares/${id}`)).status).toBe(200);
    expect(lines.join("\n")).not.toContain(id);
    expect(lines.some((l) => l.includes('"/v1/shares/:id"'))).toBe(true);
  });
});

describe("production CORS defaults", () => {
  it("drops the Vite dev origin in production unless APP_ORIGINS lists it", () => {
    const prod = loadConfig({ DATABASE_URL: "postgres://x/y", NODE_ENV: "production" });
    expect(prod.appOrigins).not.toContain("http://localhost:5173");
    expect(prod.appOrigins).toEqual(expect.arrayContaining(["https://autoflowmacro.com", "tauri://localhost", "http://tauri.localhost", "https://localhost"]));
    expect(loadConfig({ DATABASE_URL: "postgres://x/y" }).appOrigins).toContain("http://localhost:5173");
    expect(loadConfig({ DATABASE_URL: "postgres://x/y", NODE_ENV: "production", APP_ORIGINS: "http://localhost:5173" }).appOrigins).toEqual(["http://localhost:5173"]);
  });
});

describe("Atlas report visibility", () => {
  it("answers 404 for templates the reporter cannot see (no probing of pending or hidden templates)", async () => {
    const t = makeApp(db);
    const author = await t.signup({ verified: true });
    const high = await t.call("POST", "/v1/atlas/templates", {
      token: author.token,
      body: { flow: sampleFlow({ name: "Order poster", steps: [{ id: "h", type: "http", method: "POST", url: "https://shop.example.com/checkout", body: "{}" }] }), category: "developer" },
    });
    expect(high.json.template.status).toBe("pending_review");
    const other = await t.signup();
    const r = await t.call("POST", `/v1/atlas/templates/${high.json.template.id}/reports`, { token: other.token, body: { reason: "spam" } });
    expect(r.status).toBe(404);
    const unknown = await t.call("POST", "/v1/atlas/templates/ZZZZZZZZZZ/reports", { token: other.token, body: { reason: "spam" } });
    expect(unknown.status).toBe(404);
    expect(r.json).toEqual(unknown.json);
  });
});

describe("relay body timeouts", () => {
  it("maps a provider that stalls after the headers to 504, never 500", async () => {
    const stalling: typeof fetch = async (_u, init) =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"partial":'));
            init?.signal?.addEventListener("abort", () => controller.error(init.signal!.reason));
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    const t = makeApp(db, { fetch: stalling, limits: { relay: { timeoutMs: 50 } } });
    const u = await t.signup();
    const r = await t.call("POST", "/v1/ai/relay", { token: u.token, headers: { "X-Provider-Key": KEY }, body: { provider: "openai", path: "/v1/chat/completions", body: {} } });
    expect(r.status).toBe(504);
    expect(r.json.error.code).toBe("upstream_timeout");
  });
});

describe("hostile flows", () => {
  it("rejects deeply nested flows quickly instead of pinning the CPU", async () => {
    const t = makeApp(db);
    let nested: Record<string, unknown> = { id: "w", type: "wait", ms: 1 };
    for (let i = 0; i < 30; i++) nested = { id: `g${i}`, type: i % 2 ? "try" : "group", name: "g", body: [nested], catch: [] };
    const t0 = Date.now();
    const ok = await t.call("POST", "/v1/shares", { body: { flow: sampleFlow({ steps: [nested] }) } });
    expect(ok.status).toBe(201);
    for (let i = 0; i < 10; i++) nested = { id: `h${i}`, type: "group", name: "g", body: [nested] };
    const deep = await t.call("POST", "/v1/shares", { body: { flow: sampleFlow({ steps: [nested] }) } });
    expect(deep.status).toBe(422);
    expect(JSON.stringify(deep.json)).toMatch(/nested/);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it("strips literal credentials from shared http headers", async () => {
    const t = makeApp(db);
    const flow = sampleFlow({ steps: [{ id: "h", type: "http", url: "https://api.example.com/x", headers: { Authorization: "Bearer live-token-123", Accept: "application/json" } }] });
    const r = await t.call("POST", "/v1/shares", { body: { flow } });
    expect(r.status).toBe(201);
    expect(JSON.stringify(r.json)).not.toContain("live-token-123");
    expect(r.json.share.flow.steps[0].headers).toEqual({ Authorization: "Bearer {{secret:http_authorization}}", Accept: "application/json" });
  });
});
