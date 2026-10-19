import { LOCALE_CODES } from "@autoflow/core";
import { describe, expect, it } from "vitest";
import { makeApp, useTestDb } from "./helpers.js";

const db = useTestDb();

describe("CORS", () => {
  it("allows the configured app origins (web, Tauri, Capacitor, dev)", async () => {
    const t = makeApp(db);
    for (const origin of ["https://autoflow-651.pages.dev", "http://localhost:5173", "tauri://localhost", "http://tauri.localhost", "https://localhost"]) {
      const r = await t.call("GET", "/v1/meta", { headers: { Origin: origin } });
      expect(r.headers.get("access-control-allow-origin"), origin).toBe(origin);
      expect(r.headers.get("access-control-allow-credentials")).toBeNull();
      expect(r.headers.get("vary")).toContain("Origin");
    }
  });

  it("answers preflights for allowed origins with the needed headers", async () => {
    const t = makeApp(db);
    const r = await t.call("OPTIONS", "/v1/sync/items/flow/x", {
      headers: { Origin: "https://autoflow-651.pages.dev", "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "authorization,content-type,if-match" },
    });
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-origin")).toBe("https://autoflow-651.pages.dev");
    expect(r.headers.get("access-control-allow-methods")).toContain("PUT");
    const allowed = r.headers.get("access-control-allow-headers")!.toLowerCase();
    for (const h of ["authorization", "content-type", "if-match", "x-provider-key"]) expect(allowed).toContain(h);
    expect(r.headers.get("access-control-max-age")).toBe("600");
  });

  it("does not grant other origins, including look-alikes", async () => {
    const t = makeApp(db);
    for (const origin of ["https://evil.example.com", "https://autoflow-651.pages.dev.evil.com", "http://autoflow-651.pages.dev", "null"]) {
      const r = await t.call("GET", "/v1/meta", { headers: { Origin: origin } });
      expect(r.headers.get("access-control-allow-origin"), origin).toBeNull();
      const pre = await t.call("OPTIONS", "/v1/me", { headers: { Origin: origin, "Access-Control-Request-Method": "GET" } });
      expect(pre.headers.get("access-control-allow-origin"), origin).toBeNull();
    }
  });

  it("keeps CORS headers on error responses so the app can read them", async () => {
    const t = makeApp(db);
    const r = await t.call("GET", "/v1/me", { headers: { Origin: "https://autoflow-651.pages.dev" } });
    expect(r.status).toBe(401);
    expect(r.headers.get("access-control-allow-origin")).toBe("https://autoflow-651.pages.dev");
    expect(r.headers.get("access-control-expose-headers")).toContain("X-Request-Id");
  });

  it("honours a custom APP_ORIGINS allowlist", async () => {
    const t = makeApp(db, { appOrigins: ["https://app.example.org"] });
    expect((await t.call("GET", "/v1/meta", { headers: { Origin: "https://app.example.org" } })).headers.get("access-control-allow-origin")).toBe("https://app.example.org");
    expect((await t.call("GET", "/v1/meta", { headers: { Origin: "https://autoflow-651.pages.dev" } })).headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("secure headers and error format", () => {
  it("sets hardened response headers", async () => {
    const t = makeApp(db);
    const r = await t.call("GET", "/v1/meta");
    expect(r.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(r.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(r.headers.get("strict-transport-security")).toContain("max-age=63072000");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(r.headers.get("x-powered-by")).toBeNull();
  });

  it("marks per-user responses no-store", async () => {
    const t = makeApp(db);
    const u = await t.signup();
    expect((await t.call("GET", "/v1/me", { token: u.token })).headers.get("cache-control")).toBe("no-store");
  });

  it("issues request ids and echoes safe incoming ones", async () => {
    const t = makeApp(db);
    const r = await t.call("GET", "/v1/meta");
    expect(r.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const echoed = await t.call("GET", "/v1/meta", { headers: { "X-Request-Id": "client-abc-123" } });
    expect(echoed.headers.get("x-request-id")).toBe("client-abc-123");
    const unsafe = await t.call("GET", "/v1/meta", { headers: { "X-Request-Id": "bad id with spaces <script>" } });
    expect(unsafe.headers.get("x-request-id")).not.toContain("<script>");
  });

  it("uses one JSON error shape for 404, 413 and validation errors", async () => {
    const t = makeApp(db);
    const nf = await t.call("GET", "/v1/nope");
    expect(nf.status).toBe(404);
    expect(nf.json).toEqual({ error: { code: "not_found", message: "Route not found" } });
    const tooBig = await t.call("POST", "/v1/auth/login", { body: { email: "a@b.co", password: "x".repeat(70 * 1024) } });
    expect(tooBig.status).toBe(413);
    expect(tooBig.json.error.code).toBe("payload_too_large");
  });

  it("hides internal error details in production", async () => {
    const t = makeApp(db, { env: "production" });
    t.deps.sql = new Proxy(t.deps.sql, {
      apply() {
        throw new Error("boom: secret internals");
      },
    });
    const u = await makeApp(db).signup();
    const r = await t.call("GET", "/v1/me", { token: u.token });
    expect(r.status).toBe(500);
    expect(r.json).toEqual({ error: { code: "internal_error", message: "Internal server error" } });
    expect(r.text).not.toContain("boom");
    expect(r.text).not.toContain("at ");
  });
});

describe("health and meta", () => {
  it("reports database health", async () => {
    const t = makeApp(db);
    const r = await t.call("GET", "/health");
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ status: "ok", db: "ok" });
  });

  it("reports 503 when the database is unreachable", async () => {
    const t = makeApp(db);
    t.deps.sql = new Proxy(t.deps.sql, {
      apply() {
        return Promise.reject(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));
      },
    });
    const r = await t.call("GET", "/health");
    expect(r.status).toBe(503);
    expect(r.json.db).toBe("unreachable");
  });

  it("publishes version, locales and limits", async () => {
    const t = makeApp(db);
    const r = await t.call("GET", "/v1/meta");
    expect(r.json).toMatchObject({ name: "AutoFlow API", version: "test", schemaVersion: "1.0", locales: LOCALE_CODES });
    expect(r.json.limits.sync).toMatchObject({ maxItems: 5000, maxBytes: 50 * 1024 * 1024, maxItemBytes: 2 * 1024 * 1024 });
    expect(r.json.relayProviders).toEqual(["openai", "anthropic", "gemini", "openrouter"]);
  });

  it("serves the OpenAPI document", async () => {
    const t = makeApp(db);
    const r = await t.call("GET", "/v1/openapi.yaml");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("yaml");
    expect(r.text).toMatch(/^openapi: 3\.1\.\d/m);
    for (const path of ["/v1/auth/signup", "/v1/sync", "/v1/sync/items/{kind}/{id}", "/v1/atlas/templates", "/v1/shares", "/v1/ai/relay", "/health"]) expect(r.text).toContain(`${path}:`);
  });
});
