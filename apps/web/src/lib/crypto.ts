/**
 * Device-side cryptography.
 *
 * 1. Local secrets (AI keys, flow secrets on the web build) are encrypted with a non-extractable
 *    AES-GCM key kept in IndexedDB — the raw key never exists in JavaScript memory.
 * 2. Sync items are end-to-end encrypted with a key derived from the user's sync passphrase
 *    (PBKDF2-SHA256, 310k iterations, per-account salt). The server only ever sees ciphertext.
 */
import { kv } from "./db";

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function deviceKey(): Promise<CryptoKey> {
  const existing = await kv.get<CryptoKey>("deviceKey");
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await kv.set("deviceKey", key);
  return key;
}

export interface Sealed {
  iv: string;
  data: string;
}

export async function seal(plaintext: string, key?: CryptoKey): Promise<Sealed> {
  const k = key ?? (await deviceKey());
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, enc.encode(plaintext)));
  return { iv: toB64(iv), data: toB64(ct) };
}

export async function open(sealed: Sealed, key?: CryptoKey): Promise<string> {
  const k = key ?? (await deviceKey());
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(sealed.iv) as Uint8Array<ArrayBuffer> }, k, fromB64(sealed.data) as Uint8Array<ArrayBuffer>);
  return dec.decode(pt);
}

/** Device-local secret vault (web build). Native shells use the OS keystore via the bridge instead. */
export const vault = {
  async set(name: string, value: string): Promise<void> {
    const all = (await kv.get<Record<string, Sealed>>("vault")) ?? {};
    all[name] = await seal(value);
    await kv.set("vault", all);
  },
  async get(name: string): Promise<string | undefined> {
    const all = (await kv.get<Record<string, Sealed>>("vault")) ?? {};
    const s = all[name];
    return s ? open(s) : undefined;
  },
  async delete(name: string): Promise<void> {
    const all = (await kv.get<Record<string, Sealed>>("vault")) ?? {};
    delete all[name];
    await kv.set("vault", all);
  },
  async list(): Promise<string[]> {
    return Object.keys((await kv.get<Record<string, Sealed>>("vault")) ?? {});
  },
  /** Decrypts every secret once so the synchronous engine resolver can use them during a run. */
  async snapshot(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const n of await this.list()) {
      if (n.startsWith("ai:")) continue; // AI keys are never exposed to flows
      const v = await this.get(n);
      if (v !== undefined) out[n] = v;
    }
    return out;
  },
};

export async function deriveSyncKey(passphrase: string, accountId: string): Promise<CryptoKey> {
  const salt = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`autoflow-sync-v1:${accountId}`)));
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 310_000 }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** Short fingerprint shown in settings so users can confirm two devices use the same passphrase. */
export async function keyCheck(key: CryptoKey): Promise<string> {
  const iv = new Uint8Array(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode("autoflow-key-check")));
  return toB64(ct.subarray(0, 6)).replace(/[^A-Za-z0-9]/g, "").slice(0, 8);
}
