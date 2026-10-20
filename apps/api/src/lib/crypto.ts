/**
 * Password hashing (scrypt), opaque tokens and short ids. All comparisons are constant-time.
 *
 * Password hash format: `scrypt$<log2N>$<r>$<p>$<salt b64>$<hash b64>` — parameters travel with
 * the hash so they can be raised later and old hashes still verify (and get rehashed on login).
 */
import { createHash, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

export const SCRYPT_PARAMS = { log2N: 15, r: 8, p: 1, keyLen: 64, saltLen: 16 } as const;

function scrypt(password: string, salt: Buffer, keyLen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize("NFKC"), salt, keyLen, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function scryptOptions(log2N: number, r: number, p: number): ScryptOptions {
  const N = 2 ** log2N;
  // 128 * N * r bytes are needed; leave head-room so Node does not reject the call.
  return { N, r, p, maxmem: 256 * N * r + 1024 * 1024 };
}

export async function hashPassword(password: string): Promise<string> {
  const { log2N, r, p, keyLen, saltLen } = SCRYPT_PARAMS;
  const salt = randomBytes(saltLen);
  const key = await scrypt(password, salt, keyLen, scryptOptions(log2N, r, p));
  return `scrypt$${log2N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const log2N = Number(n);
  const rr = Number(r);
  const pp = Number(p);
  if (![log2N, rr, pp].every((x) => Number.isInteger(x) && x > 0) || log2N > 20 || rr > 32 || pp > 16) return false;
  const expected = Buffer.from(hashB64, "base64");
  if (expected.length < 16) return false;
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, scryptOptions(log2N, rr, pp));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function needsRehash(stored: string): boolean {
  const [alg, n, r, p] = stored.split("$");
  return alg !== "scrypt" || Number(n) !== SCRYPT_PARAMS.log2N || Number(r) !== SCRYPT_PARAMS.r || Number(p) !== SCRYPT_PARAMS.p;
}

/** A precomputed hash used to spend equal time when the account does not exist. */
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  return dummyHash;
}

/** Opaque bearer token: prefix + 32 random bytes (base64url). Only its SHA-256 is stored. */
export function newOpaqueToken(prefix: "afs" | "afr" | "afv"): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

export function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Uniform random base62 id (crypto.randomInt avoids modulo bias). 10 chars ≈ 59.5 bits. */
export function base62Id(length = 10): string {
  let out = "";
  for (let i = 0; i < length; i++) out += BASE62[randomInt(62)];
  return out;
}

export const BASE62_ID = /^[0-9A-Za-z]{10}$/;
