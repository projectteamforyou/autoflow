/** Pure unit tests (no database): crypto, rate limiter, config, logger redaction. */
import { describe, expect, it } from "vitest";
import { base62Id, hashPassword, needsRehash, newOpaqueToken, safeEqual, sha256Hex, verifyPassword } from "../src/lib/crypto.js";
import { MemoryTokenBucket } from "../src/lib/rate-limit.js";
import { DEFAULT_APP_ORIGINS, loadConfig, parseOrigins } from "../src/config.js";
import { createLogger, redact } from "../src/logger.js";
import { base64Bytes } from "../src/services/sync.js";
import { normalizeEmail } from "../src/services/auth.js";

describe("password hashing", () => {
  it("hashes with scrypt N=2^15 r=8 p=1 and a per-user salt", async () => {
    const a = await hashPassword("correct horse battery staple");
    const b = await hashPassword("correct horse battery staple");
    expect(a).toMatch(/^scrypt\$15\$8\$1\$/);
    expect(a).not.toBe(b);
    expect(a.split("$")[4]).not.toBe(b.split("$")[4]);
    expect(Buffer.from(a.split("$")[4]!, "base64")).toHaveLength(16);
    expect(Buffer.from(a.split("$")[5]!, "base64")).toHaveLength(64);
    expect(await verifyPassword("correct horse battery staple", a)).toBe(true);
    expect(await verifyPassword("correct horse battery stapler", a)).toBe(false);
    expect(needsRehash(a)).toBe(false);
    expect(needsRehash("scrypt$14$8$1$abc$def")).toBe(true);
  });

  it("normalizes Unicode before hashing and rejects malformed hashes", async () => {
    const h = await hashPassword("café passphrase");
    expect(await verifyPassword("café passphrase", h)).toBe(true);
    expect(await verifyPassword("x", "plain")).toBe(false);
    expect(await verifyPassword("x", "scrypt$99$8$1$AAAA$AAAA")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$15$8$1$AAAA$AAAAAAAAAAAAAAAAAAAAAA==")).toBe(false);
  });
});

describe("tokens and ids", () => {
  it("creates 32-byte opaque tokens and base62 ids", () => {
    const tok = newOpaqueToken("afs");
    expect(tok).toMatch(/^afs_[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(tok.slice(4), "base64url")).toHaveLength(32);
    const ids = new Set(Array.from({ length: 2000 }, () => base62Id()));
    expect(ids.size).toBe(2000);
    for (const id of ids) expect(id).toMatch(/^[0-9A-Za-z]{10}$/);
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });

  it("normalizes emails", () => {
    expect(normalizeEmail("  Foo.Bar@Example.COM ")).toBe("foo.bar@example.com");
  });

  it("computes decoded base64 sizes", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 100, 1001]) expect(base64Bytes(Buffer.alloc(n).toString("base64"))).toBe(n);
  });
});

describe("token bucket", () => {
  it("allows a burst, then refills over time", () => {
    let now = 0;
    const b = new MemoryTokenBucket({ capacity: 3, refillPerMinute: 60 }, () => now);
    expect([1, 2, 3].map(() => b.consume("k").allowed)).toEqual([true, true, true]);
    const denied = b.consume("k");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBe(1000);
    expect(b.consume("other").allowed).toBe(true);
    now = 1000;
    expect(b.consume("k").allowed).toBe(true);
    expect(b.consume("k").allowed).toBe(false);
    now = 60_000;
    expect(b.consume("k", 3).allowed).toBe(true);
  });

  it("bounds memory by evicting idle keys", () => {
    let now = 0;
    const b = new MemoryTokenBucket({ capacity: 1, refillPerMinute: 60 }, () => now, 100);
    for (let i = 0; i < 500; i++) b.consume(`ip${i}`);
    expect(b.size).toBeLessThanOrEqual(101);
    now = 10_000;
    for (let i = 0; i < 50; i++) b.consume(`new${i}`);
    expect(b.size).toBeLessThanOrEqual(101);
  });
});

describe("config", () => {
  it("defaults CORS origins to the web, Tauri and Capacitor apps", () => {
    const c = loadConfig({ DATABASE_URL: "postgres://x/y" });
    expect(c.appOrigins).toEqual([...DEFAULT_APP_ORIGINS]);
    expect(c.publicAppUrl).toBe("https://autoflowmacro.com");
    expect(c.port).toBe(8080);
    expect(c.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("parses APP_ORIGINS strictly", () => {
    expect(parseOrigins("https://a.example, http://localhost:3000/")).toEqual(["https://a.example", "http://localhost:3000"]);
    expect(() => parseOrigins("*")).toThrow();
    expect(() => parseOrigins("https://a.example/path")).toThrow();
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(loadConfig({ DATABASE_URL: "postgres://x/y", NODE_ENV: "production" }).logLevel).toBe("info");
  });
});

describe("logger", () => {
  it("redacts secrets recursively and emits one JSON object per line", () => {
    const lines: string[] = [];
    const log = createLogger("info", { service: "t" }, (l) => lines.push(l));
    log.debug("hidden");
    log.info("evt", { token: "afs_abc", nested: { password: "p", providerKey: "k", ciphertext: "c", ok: 1 }, headers: { authorization: "Bearer x" } });
    expect(lines).toHaveLength(1);
    const e = JSON.parse(lines[0]!);
    expect(e).toMatchObject({ level: "info", msg: "evt", service: "t", token: "[redacted]", nested: { password: "[redacted]", providerKey: "[redacted]", ciphertext: "[redacted]", ok: 1 } });
    expect(e.headers.authorization).toBe("[redacted]");
    expect(redact({ list: [{ secret: 1 }] })).toEqual({ list: [{ secret: "[redacted]" }] });
  });
});
