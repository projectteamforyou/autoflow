/**
 * Business license keys: `AFB-XXXXX-XXXXX-XXXXX-XXXXX`.
 *
 * - 20 Crockford base32 symbols (0-9, A-Z without I, L, O, U): 19 random (95 bits) + 1 check symbol.
 * - The check symbol is Luhn mod 32 over the 19 payload symbols, so any single mistyped symbol and
 *   almost every swap of two adjacent symbols is caught on the client before a request is made
 *   (the one exception is swapping `0` and `Z` — see licenseCheckSymbol). The server still verifies
 *   the hash, so an undetected typo only costs a round trip.
 * - Input is forgiving: case, spaces, missing dashes/prefix and the Crockford look-alikes
 *   (O → 0, I/L → 1) are normalised away.
 *
 * Keys are generated on the server only; the API stores just the SHA-256 of the canonical form.
 */

export const LICENSE_KEY_PREFIX = "AFB";
export const LICENSE_KEY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BODY_LENGTH = 20;
const GROUP = 5;

/** e.g. AFB-7K3QZ-0M9XA-T4WRB-2NHC8 — use for input hints and validation messages. */
export const LICENSE_KEY_PATTERN = /^AFB-[0-9A-HJKMNP-TV-Z]{5}(?:-[0-9A-HJKMNP-TV-Z]{5}){3}$/;
export const LICENSE_KEY_PLACEHOLDER = "AFB-XXXXX-XXXXX-XXXXX-XXXXX";

const VALUE: Record<string, number> = Object.fromEntries([...LICENSE_KEY_ALPHABET].map((ch, i) => [ch, i]));

/**
 * Luhn mod N (N = 32) check symbol for a payload of alphabet symbols. It catches every single-symbol
 * typo and most adjacent transpositions, but NOT all of them: like base-10 Luhn ("09" ↔ "90"), a swap
 * of the alphabet's first and last symbols ("0Z" ↔ "Z0", i.e. values 0 and 31) keeps the sum and still validates.
 * The algorithm is frozen — changing it would invalidate keys already issued.
 */
export function licenseCheckSymbol(payload: string): string {
  let sum = 0;
  let factor = 2;
  for (let i = payload.length - 1; i >= 0; i--) {
    const v = VALUE[payload[i]!];
    if (v === undefined) throw new RangeError("invalid license symbol");
    let addend = factor * v;
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / 32) + (addend % 32);
    sum += addend;
  }
  return LICENSE_KEY_ALPHABET[(32 - (sum % 32)) % 32]!;
}

const format = (body: string) => `${LICENSE_KEY_PREFIX}-${body.match(new RegExp(`.{${GROUP}}`, "g"))!.join("-")}`;

/**
 * Canonical `AFB-XXXXX-XXXXX-XXXXX-XXXXX`, or null when the input cannot be a license key
 * (wrong length, foreign characters or a failed check symbol).
 */
export function normalizeLicenseKey(input: string): string | null {
  if (typeof input !== "string" || input.length > 80) return null;
  let s = input.toUpperCase().replace(/[\s\-_]/g, "");
  if (s.startsWith(LICENSE_KEY_PREFIX) && s.length === LICENSE_KEY_PREFIX.length + BODY_LENGTH) s = s.slice(LICENSE_KEY_PREFIX.length);
  if (s.length !== BODY_LENGTH) return null;
  s = s.replace(/O/g, "0").replace(/[IL]/g, "1");
  if (![...s].every((ch) => ch in VALUE)) return null;
  const payload = s.slice(0, -1);
  if (licenseCheckSymbol(payload) !== s.slice(-1)) return null;
  return format(s);
}

export function isValidLicenseKey(input: string): boolean {
  return normalizeLicenseKey(input) !== null;
}

/**
 * A fresh random key. `randomBytes` defaults to Web Crypto (Node ≥ 20 and browsers); every byte
 * is masked to 5 bits, which is uniform because 256 is a multiple of 32.
 */
export function generateLicenseKey(randomBytes: (n: number) => Uint8Array = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))): string {
  const bytes = randomBytes(BODY_LENGTH - 1);
  let payload = "";
  for (const b of bytes) payload += LICENSE_KEY_ALPHABET[b & 31];
  return format(payload + licenseCheckSymbol(payload));
}

/** The last four symbols — the only part of a key the server keeps besides its hash. */
export function licenseKeyHint(canonical: string): string {
  return canonical.replace(/-/g, "").slice(-4);
}

/** For lists: AFB-•••••-•••••-•••••-•2NHC (from the stored hint). */
export function maskLicenseKey(hint: string): string {
  return `${LICENSE_KEY_PREFIX}-•••••-•••••-•••••-•${hint.slice(-4)}`;
}
