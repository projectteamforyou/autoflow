/**
 * Runtime configuration, parsed once from the environment and validated with zod.
 * Everything tunable lives here so tests can build an app with tight limits.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const DEFAULT_APP_ORIGINS = [
  "https://autoflowmacro.com",
  "http://localhost:5173",
  "tauri://localhost",
  "http://tauri.localhost",
  "https://localhost",
] as const;

export interface RateRule {
  /** Burst size (bucket capacity). */
  capacity: number;
  /** Tokens added per minute. */
  refillPerMinute: number;
}

export interface Limits {
  sync: { maxItems: number; maxBytes: number; maxItemBytes: number; pageSize: number; maxPageSize: number; pageByteBudget: number };
  devices: { maxPerUser: number };
  atlas: { reportHideThreshold: number; maxPerAuthor: number; maxFlowBytes: number; requireVerifiedEmail: boolean };
  shares: { maxFlowBytes: number; maxExpiryDays: number };
  relay: { maxBodyBytes: number; maxResponseBytes: number; timeoutMs: number };
  session: { ttlMs: number; touchIntervalMs: number };
  tokens: { resetTtlMs: number; verifyTtlMs: number };
  rate: {
    global: RateRule;
    authIp: RateRule;
    authAccount: RateRule;
    publish: RateRule;
    shareIp: RateRule;
    relay: RateRule;
    install: RateRule;
    stats: RateRule;
    billing: RateRule;
    admin: RateRule;
  };
}

export interface Config {
  env: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  appOrigins: string[];
  publicAppUrl: string;
  mailFrom: string;
  resendApiKey?: string;
  /** Normalized emails of the operators allowed into /v1/admin/billing (must also be verified). */
  adminEmails: string[];
  /**
   * One-time proof of ownership for an operator account when no mail provider is configured: an account whose email
   * is in adminEmails and that presents this code is marked verified. Unset → only email verification works.
   */
  adminSetupCode?: string;
  /**
   * Secret that the AES-256-GCM key for admin-entered payment secrets is derived from.
   * Unset in production → secrets cannot be stored and checkout stays disabled.
   */
  settingsEncryptionKey?: string;
  /** Timeout for calls to payment providers. */
  billingTimeoutMs: number;
  /** Number of trusted reverse proxies in front of the app (Railway edge = 1). */
  trustProxyHops: number;
  logLevel: "debug" | "info" | "warn" | "error" | "silent";
  version: string;
  limits: Limits;
}

export const DEFAULT_LIMITS: Limits = {
  sync: { maxItems: 5000, maxBytes: 50 * 1024 * 1024, maxItemBytes: 2 * 1024 * 1024, pageSize: 100, maxPageSize: 500, pageByteBudget: 8 * 1024 * 1024 },
  devices: { maxPerUser: 50 },
  atlas: { reportHideThreshold: 3, maxPerAuthor: 100, maxFlowBytes: 512 * 1024, requireVerifiedEmail: true },
  shares: { maxFlowBytes: 256 * 1024, maxExpiryDays: 365 },
  relay: { maxBodyBytes: 256 * 1024, maxResponseBytes: 16 * 1024 * 1024, timeoutMs: 120_000 },
  session: { ttlMs: 30 * 86_400_000, touchIntervalMs: 5 * 60_000 },
  tokens: { resetTtlMs: 60 * 60_000, verifyTtlMs: 7 * 86_400_000 },
  rate: {
    global: { capacity: 600, refillPerMinute: 600 },
    authIp: { capacity: 20, refillPerMinute: 10 },
    authAccount: { capacity: 6, refillPerMinute: 2 },
    publish: { capacity: 10, refillPerMinute: 1 },
    shareIp: { capacity: 30, refillPerMinute: 5 },
    relay: { capacity: 30, refillPerMinute: 30 },
    install: { capacity: 60, refillPerMinute: 30 },
    stats: { capacity: 30, refillPerMinute: 20 },
    billing: { capacity: 20, refillPerMinute: 10 },
    admin: { capacity: 60, refillPerMinute: 30 },
  },
};

export const DEFAULT_ADMIN_EMAILS = ["projectteamforyou@gmail.com"] as const;

/** Development/test only: lets admins try billing settings locally without configuring a key. */
export const DEV_SETTINGS_ENCRYPTION_KEY = "autoflow-dev-only-settings-key-not-for-production";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_ORIGINS: z.string().optional(),
  PUBLIC_APP_URL: z.string().url().default("https://autoflowmacro.com"),
  MAIL_FROM: z.string().min(3).default("AutoFlow <no-reply@autoflow.app>"),
  RESEND_API_KEY: z.string().min(1).optional(),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).optional(),
  ATLAS_REQUIRE_VERIFIED_EMAIL: z.enum(["true", "false"]).optional(),
  ADMIN_EMAILS: z.string().optional(),
  ADMIN_SETUP_CODE: z.string().min(24).optional(),
  SETTINGS_ENCRYPTION_KEY: z.string().min(32, "SETTINGS_ENCRYPTION_KEY must be at least 32 characters (e.g. openssl rand -base64 32)").optional(),
});

export function parseAdminEmails(raw: string | undefined): string[] {
  const list = (raw ?? "")
    .split(",")
    .map((s) => s.normalize("NFKC").trim().toLowerCase())
    .filter(Boolean);
  for (const e of list) if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error(`ADMIN_EMAILS entry is not an email: ${e}`);
  return list.length ? list : [...DEFAULT_ADMIN_EMAILS];
}

/** Origins only a developer machine serves; never allowed by default in production. */
export const DEV_ONLY_ORIGINS: readonly string[] = ["http://localhost:5173"];

export function parseOrigins(raw: string | undefined, env: Config["env"] = "development"): string[] {
  if (!raw || !raw.trim()) return DEFAULT_APP_ORIGINS.filter((o) => env !== "production" || !DEV_ONLY_ORIGINS.includes(o));
  const list = raw
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  for (const o of list) {
    if (o === "*") throw new Error("APP_ORIGINS must list explicit origins; '*' is not allowed");
    if (!/^[a-z][a-z0-9+.-]*:\/\/[^/\s]+$/i.test(o)) throw new Error(`APP_ORIGINS entry is not an origin: ${o}`);
  }
  return list;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${msg}`);
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    appOrigins: parseOrigins(e.APP_ORIGINS, e.NODE_ENV),
    publicAppUrl: e.PUBLIC_APP_URL.replace(/\/+$/, ""),
    mailFrom: e.MAIL_FROM,
    resendApiKey: e.RESEND_API_KEY,
    adminEmails: parseAdminEmails(e.ADMIN_EMAILS),
    adminSetupCode: e.ADMIN_SETUP_CODE,
    settingsEncryptionKey: e.SETTINGS_ENCRYPTION_KEY ?? (e.NODE_ENV === "production" ? undefined : DEV_SETTINGS_ENCRYPTION_KEY),
    billingTimeoutMs: 20_000,
    trustProxyHops: e.TRUST_PROXY_HOPS,
    logLevel: e.LOG_LEVEL ?? (e.NODE_ENV === "test" ? "silent" : e.NODE_ENV === "production" ? "info" : "debug"),
    version: readPackageVersion(),
    limits: {
      ...DEFAULT_LIMITS,
      atlas: { ...DEFAULT_LIMITS.atlas, requireVerifiedEmail: e.ATLAS_REQUIRE_VERIFIED_EMAIL !== "false" },
    },
  };
}
