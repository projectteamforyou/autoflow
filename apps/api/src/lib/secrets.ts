/**
 * At-rest encryption for secrets administrators enter in the app (payment API secrets).
 *
 * AES-256-GCM with a key derived (HKDF-SHA256) from SETTINGS_ENCRYPTION_KEY. Each value gets a
 * fresh 96-bit IV and is bound to its field name as additional authenticated data, so a
 * ciphertext copied into another field fails to decrypt. Format: `v1.<iv>.<ciphertext>.<tag>`
 * (base64url parts).
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

export class SecretBox {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.from("autoflow.settings", "utf8"), Buffer.from("aes-256-gcm/v1", "utf8"), 32));
  }

  seal(plaintext: string, field: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(field, "utf8"));
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64url"), ct.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
  }

  /** Returns null when the value is malformed, tampered with or sealed under another key. */
  open(sealed: string, field: string): string | null {
    const parts = sealed.split(".");
    if (parts.length !== 4 || parts[0] !== "v1") return null;
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(parts[1]!, "base64url"));
      decipher.setAAD(Buffer.from(field, "utf8"));
      decipher.setAuthTag(Buffer.from(parts[3]!, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(parts[2]!, "base64url")), decipher.final()]).toString("utf8");
    } catch {
      return null;
    }
  }
}

/** What the admin UI may see of a secret: whether it is set and its last four characters. */
export function maskSecret(plain: string | null): { set: boolean; last4: string | null } {
  if (!plain) return { set: false, last4: null };
  return { set: true, last4: plain.length >= 12 ? plain.slice(-4) : null };
}
