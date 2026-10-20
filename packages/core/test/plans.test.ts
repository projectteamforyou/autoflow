import { describe, expect, it } from "vitest";
import {
  BUSINESS_FREE_UNTIL,
  BUSINESS_PLAN_REQUIRED_FROM,
  BUSINESS_PRICES,
  LICENSE_KEY_PATTERN,
  generateLicenseKey,
  licenseCheckSymbol,
  licenseKeyHint,
  maskLicenseKey,
  normalizeLicenseKey,
  addMonths,
  extendEntitlement,
  formatPolicyDate,
  formatPrice,
  fromDecimalAmount,
  isBusinessGraceOver,
  planStatus,
  preferredProvider,
  requiresBusinessPlan,
  toDecimalAmount,
} from "../src/index.js";

const LAST_FREE = new Date("2026-10-19T23:59:59+09:00");
const FIRST_PAID = new Date("2026-10-20T00:00:00+09:00");

describe("plans policy", () => {
  it("requires the Business license from 2026-10-20 00:00 in Seoul", () => {
    expect(BUSINESS_FREE_UNTIL).toBe("2026-10-19T23:59:59+09:00");
    expect(BUSINESS_PLAN_REQUIRED_FROM).toBe("2026-10-20T00:00:00+09:00");
    expect(isBusinessGraceOver(LAST_FREE)).toBe(false);
    expect(isBusinessGraceOver(new Date(LAST_FREE.getTime() + 999))).toBe(false);
    expect(isBusinessGraceOver(FIRST_PAID)).toBe(true);
    // 2026-10-19 15:00 UTC is midnight in Seoul.
    expect(isBusinessGraceOver(new Date("2026-10-19T14:59:59Z"))).toBe(false);
    expect(isBusinessGraceOver(new Date("2026-10-19T15:00:00Z"))).toBe(true);
  });

  it("only blocks business use after the cutoff without a valid entitlement", () => {
    expect(planStatus({ usageType: "personal" }, FIRST_PAID)).toBe("personal_free");
    expect(planStatus({ usageType: "business" }, LAST_FREE)).toBe("business_free");
    expect(planStatus({ usageType: "business" }, FIRST_PAID)).toBe("business_required");
    expect(planStatus({ usageType: "business", validUntil: new Date(FIRST_PAID.getTime() + 1000) }, FIRST_PAID)).toBe("business_active");
    expect(requiresBusinessPlan({ usageType: "business", validUntil: new Date(FIRST_PAID.getTime() - 1) }, FIRST_PAID)).toBe(true);
    expect(requiresBusinessPlan({ usageType: "personal" }, new Date("2030-01-01T00:00:00Z"))).toBe(false);
  });

  it("extends a running entitlement and starts a lapsed one from now", () => {
    const now = new Date("2026-11-10T00:00:00Z");
    expect(extendEntitlement(null, now, "month").toISOString()).toBe("2026-12-10T00:00:00.000Z");
    expect(extendEntitlement(new Date("2026-11-20T00:00:00Z"), now, "month").toISOString()).toBe("2026-12-20T00:00:00.000Z");
    expect(extendEntitlement(new Date("2026-01-01T00:00:00Z"), now, "year").toISOString()).toBe("2027-11-10T00:00:00.000Z");
    expect(addMonths(new Date("2027-01-31T12:00:00Z"), 1).toISOString()).toBe("2027-02-28T12:00:00.000Z");
  });

  it("converts amounts exactly between minor units and decimal strings", () => {
    expect(toDecimalAmount(BUSINESS_PRICES.month.USD, "USD")).toBe("7.99");
    expect(toDecimalAmount(BUSINESS_PRICES.year.KRW, "KRW")).toBe("99000");
    expect(toDecimalAmount(5, "USD")).toBe("0.05");
    expect(fromDecimalAmount("7.99", "USD")).toBe(799);
    expect(fromDecimalAmount("79.9", "USD")).toBe(7990);
    expect(fromDecimalAmount("9900", "KRW")).toBe(9900);
    expect(fromDecimalAmount("9900.5", "KRW")).toBeNull();
    expect(fromDecimalAmount("1.001", "USD")).toBeNull();
    expect(fromDecimalAmount("-1", "USD")).toBeNull();
  });

  it("formats prices and the policy date per locale and picks a provider", () => {
    expect(formatPrice(9900, "KRW", "ko")).toBe("₩9,900");
    expect(formatPrice(799, "USD", "en")).toBe("$7.99");
    expect(formatPolicyDate(BUSINESS_FREE_UNTIL, "en")).toBe("October 19, 2026");
    expect(formatPolicyDate(BUSINESS_FREE_UNTIL, "ko")).toBe("2026년 10월 19일");
    expect(preferredProvider("ko")).toBe("portone");
    expect(preferredProvider("en")).toBe("paypal");
  });
});

describe("license keys", () => {
  it("generates well-formed keys that pass their own checksum", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const k = generateLicenseKey();
      expect(k).toMatch(LICENSE_KEY_PATTERN);
      expect(normalizeLicenseKey(k)).toBe(k);
      seen.add(k);
    }
    expect(seen.size).toBe(500);
  });

  it("uses the injected randomness and computes a Luhn mod 32 check symbol", () => {
    const zeros = generateLicenseKey((n) => new Uint8Array(n));
    expect(zeros).toBe("AFB-00000-00000-00000-00000");
    expect(licenseCheckSymbol("1")).toBe("Y"); // 1×2 = 2 → (32 − 2) = 30 → "Y"
    const k = generateLicenseKey((n) => Uint8Array.from({ length: n }, (_, i) => i * 7 + 3));
    expect(normalizeLicenseKey(k)).toBe(k);
  });

  it("normalises forgiving input", () => {
    const k = generateLicenseKey();
    const body = k.slice(4).replace(/-/g, "");
    expect(normalizeLicenseKey(k.toLowerCase())).toBe(k);
    expect(normalizeLicenseKey(` ${body} `)).toBe(k);
    expect(normalizeLicenseKey(`AFB ${body.match(/.{5}/g)!.join(" ")}`)).toBe(k);
    const withZero = generateLicenseKey((n) => new Uint8Array(n));
    expect(normalizeLicenseKey(withZero.replace(/0/g, "O"))).toBe(withZero);
  });

  it("catches every single-symbol typo and adjacent swap", () => {
    const k = generateLicenseKey();
    const body = k.slice(4).replace(/-/g, "");
    const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    for (let i = 0; i < body.length; i++) {
      for (const ch of alphabet) {
        if (ch === body[i]) continue;
        expect(normalizeLicenseKey(body.slice(0, i) + ch + body.slice(i + 1))).toBeNull();
      }
      if (i < body.length - 1 && body[i] !== body[i + 1]) {
        expect(normalizeLicenseKey(body.slice(0, i) + body[i + 1] + body[i] + body.slice(i + 2))).toBeNull();
      }
    }
  });

  it("rejects garbage and masks keys for lists", () => {
    for (const bad of ["", "AFB", "AFB-00000-00000-00000-0000", "AFB-00000-00000-00000-000000", "AFB-0000U-00000-00000-00000", "XYZ-00000-00000-00000-00000", "x".repeat(200)]) {
      expect(normalizeLicenseKey(bad)).toBeNull();
    }
    const k = generateLicenseKey();
    expect(licenseKeyHint(k)).toBe(k.slice(-4));
    expect(maskLicenseKey(licenseKeyHint(k))).toBe(`AFB-•••••-•••••-•••••-•${k.slice(-4)}`);
  });
});
