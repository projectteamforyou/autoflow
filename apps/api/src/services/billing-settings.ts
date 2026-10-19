/**
 * Payment settings entered by an operator in the Admin page and stored in `app_settings`
 * (key 'billing'). Secrets are sealed with SecretBox before they reach the database and are never
 * returned to any client — the admin view shows only whether each one is set and its last 4 chars.
 * Billing starts working as soon as settings are saved; there is nothing to redeploy.
 */
import { BILLING_PERIODS, BUSINESS_PRICES, CURRENCIES, type PriceTable } from "@autoflow/core";
import type { AppDeps } from "../deps.js";
import { getSetting, putSetting } from "../db/billing.js";
import { SecretBox, maskSecret } from "../lib/secrets.js";

export const BILLING_SETTINGS_KEY = "billing";

export type PaypalEnv = "live" | "sandbox";

/** As stored: secret fields hold SecretBox ciphertext. */
export interface StoredBillingSettings {
  portone: { enabled: boolean; storeId: string; channelKey: string; apiSecret: string | null };
  paypal: { enabled: boolean; env: PaypalEnv; clientId: string; clientSecret: string | null };
  prices: PriceTable;
}

/** Decrypted, for server-side use only. */
export interface BillingSettings {
  portone: { enabled: boolean; ready: boolean; storeId: string; channelKey: string; apiSecret: string | null };
  paypal: { enabled: boolean; ready: boolean; env: PaypalEnv; clientId: string; clientSecret: string | null };
  prices: PriceTable;
  /** False in production when SETTINGS_ENCRYPTION_KEY is missing: secrets can be neither stored nor used. */
  encryptionAvailable: boolean;
}

export const EMPTY_BILLING_SETTINGS: StoredBillingSettings = {
  portone: { enabled: false, storeId: "", channelKey: "", apiSecret: null },
  paypal: { enabled: false, env: "sandbox", clientId: "", clientSecret: null },
  prices: BUSINESS_PRICES,
};

function box(deps: AppDeps): SecretBox | null {
  return deps.config.settingsEncryptionKey ? new SecretBox(deps.config.settingsEncryptionKey) : null;
}

function normalizePrices(p: Partial<PriceTable> | undefined): PriceTable {
  const out = structuredClone(BUSINESS_PRICES);
  for (const period of BILLING_PERIODS)
    for (const cur of CURRENCIES) {
      const v = p?.[period]?.[cur];
      if (Number.isSafeInteger(v) && (v as number) > 0) out[period][cur] = v as number;
    }
  return out;
}

export async function loadStoredBillingSettings(deps: AppDeps): Promise<StoredBillingSettings> {
  const raw = await getSetting<Partial<StoredBillingSettings>>(deps.sql, BILLING_SETTINGS_KEY);
  return {
    portone: { ...EMPTY_BILLING_SETTINGS.portone, ...raw?.portone },
    paypal: { ...EMPTY_BILLING_SETTINGS.paypal, ...raw?.paypal },
    prices: normalizePrices(raw?.prices),
  };
}

export async function loadBillingSettings(deps: AppDeps): Promise<BillingSettings> {
  const stored = await loadStoredBillingSettings(deps);
  const b = box(deps);
  const open = (sealed: string | null, field: string) => {
    if (!sealed || !b) return null;
    const plain = b.open(sealed, field);
    if (plain === null) deps.logger.warn("billing.secret_unreadable", { field, hint: "SETTINGS_ENCRYPTION_KEY changed? Re-enter the secret in Admin." });
    return plain;
  };
  const apiSecret = open(stored.portone.apiSecret, "portone.apiSecret");
  const clientSecret = open(stored.paypal.clientSecret, "paypal.clientSecret");
  const p = stored.portone;
  const pp = stored.paypal;
  return {
    portone: { ...p, apiSecret, ready: p.enabled && !!p.storeId && !!p.channelKey && !!apiSecret },
    paypal: { ...pp, clientSecret, ready: pp.enabled && !!pp.clientId && !!clientSecret },
    prices: stored.prices,
    encryptionAvailable: b !== null,
  };
}

/** Admin view: everything except secret values. */
export function adminSettingsView(s: BillingSettings) {
  return {
    encryptionAvailable: s.encryptionAvailable,
    portone: { enabled: s.portone.enabled, ready: s.portone.ready, storeId: s.portone.storeId, channelKey: s.portone.channelKey, apiSecret: maskSecret(s.portone.apiSecret) },
    paypal: { enabled: s.paypal.enabled, ready: s.paypal.ready, env: s.paypal.env, clientId: s.paypal.clientId, clientSecret: maskSecret(s.paypal.clientSecret) },
    prices: s.prices,
  };
}

/** Partial update from the Admin page. A secret left `undefined` is kept; `null` clears it. */
export interface BillingSettingsPatch {
  portone?: { enabled?: boolean; storeId?: string; channelKey?: string; apiSecret?: string | null };
  paypal?: { enabled?: boolean; env?: PaypalEnv; clientId?: string; clientSecret?: string | null };
  prices?: Partial<Record<keyof PriceTable, Partial<PriceTable[keyof PriceTable]>>>;
}

export class EncryptionUnavailableError extends Error {}

/** Applies the patch and returns the list of changed field names (for the audit log — no values). */
export async function saveBillingSettings(deps: AppDeps, patch: BillingSettingsPatch, actorId: string): Promise<string[]> {
  const cur = await loadStoredBillingSettings(deps);
  const next: StoredBillingSettings = structuredClone(cur);
  const changed: string[] = [];
  const b = box(deps);
  const seal = (plain: string, field: string) => {
    if (!b) throw new EncryptionUnavailableError("SETTINGS_ENCRYPTION_KEY is not configured");
    return b.seal(plain, field);
  };

  const set = <S extends "portone" | "paypal">(section: S, key: keyof StoredBillingSettings[S], value: unknown) => {
    if ((next[section] as Record<string, unknown>)[key as string] === value) return;
    (next[section] as Record<string, unknown>)[key as string] = value;
    changed.push(`${section}.${String(key)}`);
  };

  if (patch.portone) {
    const p = patch.portone;
    if (p.enabled !== undefined) set("portone", "enabled", p.enabled);
    if (p.storeId !== undefined) set("portone", "storeId", p.storeId);
    if (p.channelKey !== undefined) set("portone", "channelKey", p.channelKey);
    if (p.apiSecret !== undefined) {
      next.portone.apiSecret = p.apiSecret === null ? null : seal(p.apiSecret, "portone.apiSecret");
      changed.push("portone.apiSecret");
    }
  }
  if (patch.paypal) {
    const p = patch.paypal;
    if (p.enabled !== undefined) set("paypal", "enabled", p.enabled);
    if (p.env !== undefined) set("paypal", "env", p.env);
    if (p.clientId !== undefined) set("paypal", "clientId", p.clientId);
    if (p.clientSecret !== undefined) {
      next.paypal.clientSecret = p.clientSecret === null ? null : seal(p.clientSecret, "paypal.clientSecret");
      changed.push("paypal.clientSecret");
    }
  }
  if (patch.prices) {
    for (const period of BILLING_PERIODS)
      for (const cur of CURRENCIES) {
        const v = patch.prices[period]?.[cur];
        if (v !== undefined && next.prices[period][cur] !== v) {
          next.prices[period][cur] = v;
          changed.push(`prices.${period}.${cur}`);
        }
      }
  }
  if (changed.length) await putSetting(deps.sql, BILLING_SETTINGS_KEY, next, actorId);
  return changed;
}
