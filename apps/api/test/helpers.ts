/** Shared test harness: per-file cloned database, app factory with overridable limits, HTTP helpers. */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, inject } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { DEFAULT_APP_ORIGINS, DEFAULT_LIMITS, type Config, type Limits, type RateRule } from "../src/config.js";
import type { Sql } from "../src/db/client.js";
import type { AppDeps } from "../src/deps.js";
import { createMemoryLimiters } from "../src/lib/rate-limit.js";
import { createLogger, type Logger } from "../src/logger.js";
import { MemoryMailer } from "../src/mail/mailer.js";

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

const GENEROUS: RateRule = { capacity: 100_000, refillPerMinute: 100_000 };

function merge<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!patch) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    const b = (base as Record<string, unknown>)[k];
    out[k] = v && typeof v === "object" && !Array.isArray(v) && b && typeof b === "object" ? merge(b, v as never) : v;
  }
  return out as T;
}

export interface TestDb {
  sql: Sql;
  url: string;
}

/** Clone the migrated template database for this test file. */
export function useTestDb(): TestDb {
  const db = {} as TestDb;
  const name = `t_${randomBytes(6).toString("hex")}`;
  const adminUrl = inject("adminDatabaseUrl");
  const template = inject("templateDatabase");
  beforeAll(async () => {
    const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
    try {
      for (let i = 0; ; i++) {
        try {
          await admin.unsafe(`CREATE DATABASE ${name} TEMPLATE ${template}`);
          break;
        } catch (err) {
          // Another file cloning the template at the same instant: retry briefly.
          if (i >= 20 || !/being accessed by other users/.test((err as Error).message)) throw err;
          await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));
        }
      }
    } finally {
      await admin.end();
    }
    const u = new URL(adminUrl);
    u.pathname = `/${name}`;
    db.url = u.toString();
    db.sql = postgres(db.url, { max: 5, onnotice: () => {} });
  });
  afterAll(async () => {
    await db.sql?.end({ timeout: 5 });
    const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
    try {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  });
  return db;
}

export interface AppOptions {
  limits?: DeepPartial<Limits>;
  fetch?: typeof fetch;
  now?: () => Date;
  env?: Config["env"];
  appOrigins?: string[];
  logger?: Logger;
  adminEmails?: string[];
  /** null = no key configured (production without SETTINGS_ENCRYPTION_KEY). */
  settingsEncryptionKey?: string | null;
}

export const TEST_SETTINGS_KEY = "test-settings-encryption-key-0123456789abcdef";

export function makeApp(db: TestDb, opts: AppOptions = {}) {
  const rateDefaults = Object.fromEntries(Object.keys(DEFAULT_LIMITS.rate).map((k) => [k, GENEROUS])) as unknown as Limits["rate"];
  const limits = merge<Limits>({ ...DEFAULT_LIMITS, rate: rateDefaults }, opts.limits);
  const config: Config = {
    env: opts.env ?? "test",
    port: 0,
    databaseUrl: db.url,
    appOrigins: opts.appOrigins ?? [...DEFAULT_APP_ORIGINS],
    publicAppUrl: "https://autoflowmacro.com",
    mailFrom: "AutoFlow <test@example.com>",
    trustProxyHops: 1,
    logLevel: "silent",
    version: "test",
    limits,
    adminEmails: opts.adminEmails ?? ["operator@example.com"],
    settingsEncryptionKey: opts.settingsEncryptionKey === null ? undefined : (opts.settingsEncryptionKey ?? TEST_SETTINGS_KEY),
    billingTimeoutMs: 5_000,
  };
  const mailer = new MemoryMailer();
  const deps: AppDeps = {
    config,
    sql: db.sql,
    logger: opts.logger ?? createLogger("silent"),
    mailer,
    limiters: createMemoryLimiters(limits.rate),
    fetch: opts.fetch ?? (async () => new Response("fetch disabled in tests", { status: 599 })),
    now: opts.now ?? (() => new Date()),
  };
  const app = createApp(deps);

  async function call(method: string, path: string, init: { token?: string; body?: unknown; headers?: Record<string, string>; ip?: string; raw?: string } = {}) {
    const headers: Record<string, string> = { "X-Forwarded-For": init.ip ?? "198.51.100.7", ...(init.headers ?? {}) };
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    let body: string | undefined;
    if (init.raw !== undefined) body = init.raw;
    else if (init.body !== undefined) {
      body = JSON.stringify(init.body);
      headers["Content-Type"] ??= "application/json";
    }
    const res = await app.request(path, { method, headers, body });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, headers: res.headers, json, text };
  }

  let seq = 0;
  async function signup(opts2: { email?: string; password?: string; verified?: boolean; displayName?: string } = {}) {
    const email = opts2.email ?? `user${Date.now().toString(36)}${(seq++).toString(36)}${randomBytes(3).toString("hex")}@example.com`;
    const password = opts2.password ?? "correct horse battery staple";
    const r = await call("POST", "/v1/auth/signup", { body: { email, password, displayName: opts2.displayName } });
    if (r.status !== 201) throw new Error(`signup failed: ${r.status} ${r.text}`);
    if (opts2.verified) await verify(email);
    return { email, password, token: r.json.session.token as string, user: r.json.user as { id: string; email: string; emailVerified: boolean } };
  }

  function tokenFromMail(email: string, tag: "verify_email" | "password_reset"): string {
    const m = mailer.last(email, tag);
    if (!m) throw new Error(`no ${tag} mail for ${email}`);
    const match = /#token=([^\s]+)/.exec(m.text);
    if (!match) throw new Error("no token in mail");
    return decodeURIComponent(match[1]!);
  }

  async function verify(email: string) {
    const r = await call("POST", "/v1/auth/verify-email", { body: { token: tokenFromMail(email, "verify_email") } });
    if (r.status !== 200) throw new Error(`verify failed: ${r.status} ${r.text}`);
  }

  return { app, deps, config, mailer, call, signup, verify, tokenFromMail };
}

export type TestApp = ReturnType<typeof makeApp>;

/** A minimal valid flow (passes parseFlow + lint without errors). */
export function sampleFlow(overrides: Record<string, unknown> = {}) {
  const now = "2026-10-01T00:00:00.000Z";
  return {
    schemaVersion: "1.0",
    id: `f_${randomBytes(4).toString("hex")}`,
    name: "Sample clicker",
    description: "Clicks the centre a few times",
    createdAt: now,
    updatedAt: now,
    steps: [
      {
        id: "loop",
        type: "loop",
        mode: "count",
        count: 5,
        body: [
          { id: "c", type: "click", target: { kind: "point", x: 0.5, y: 0.5, space: "normalized" } },
          { id: "w", type: "wait", ms: 200 },
        ],
      },
    ],
    ...overrides,
  };
}

export function b64(bytes: number): string {
  return randomBytes(bytes).toString("base64");
}
