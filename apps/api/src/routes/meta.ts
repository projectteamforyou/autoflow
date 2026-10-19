/** /health, /v1/meta and /v1/openapi.yaml. */
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { LOCALE_CODES, SCHEMA_VERSION, TEMPLATE_CATEGORIES } from "@autoflow/core";
import type { AppEnv } from "../deps.js";
import { pingDb } from "../db/client.js";
import { RELAY_PROVIDER_NAMES } from "../services/relay.js";
import { PASSWORD_MAX, PASSWORD_MIN } from "../services/auth.js";

let openapi: string | undefined;
function openapiYaml(): string {
  openapi ??= readFileSync(new URL("../../openapi.yaml", import.meta.url), "utf8");
  return openapi;
}

export function healthRoutes() {
  const r = new Hono<AppEnv>();
  r.get("/health", async (c) => {
    const ok = await pingDb(c.get("deps").sql);
    return c.json({ status: ok ? "ok" : "degraded", db: ok ? "ok" : "unreachable" }, ok ? 200 : 503);
  });
  return r;
}

export function metaRoutes() {
  const r = new Hono<AppEnv>();

  r.get("/meta", (c) => {
    const { config } = c.get("deps");
    const l = config.limits;
    c.header("Cache-Control", "public, max-age=300");
    return c.json({
      name: "AutoFlow API",
      version: config.version,
      schemaVersion: SCHEMA_VERSION,
      locales: LOCALE_CODES,
      templateCategories: TEMPLATE_CATEGORIES,
      relayProviders: RELAY_PROVIDER_NAMES,
      limits: {
        sync: { maxItems: l.sync.maxItems, maxBytes: l.sync.maxBytes, maxItemBytes: l.sync.maxItemBytes, maxPageSize: l.sync.maxPageSize },
        devices: { maxPerUser: l.devices.maxPerUser },
        atlas: { maxFlowBytes: l.atlas.maxFlowBytes, maxPerAuthor: l.atlas.maxPerAuthor },
        shares: { maxFlowBytes: l.shares.maxFlowBytes, maxExpiryDays: l.shares.maxExpiryDays },
        relay: { maxBodyBytes: l.relay.maxBodyBytes, timeoutMs: l.relay.timeoutMs },
        session: { ttlDays: Math.round(l.session.ttlMs / 86_400_000) },
        password: { minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX },
      },
    });
  });

  r.get("/openapi.yaml", (c) => {
    c.header("Content-Type", "application/yaml; charset=utf-8");
    c.header("Cache-Control", "public, max-age=300");
    return c.body(openapiYaml());
  });

  return r;
}
