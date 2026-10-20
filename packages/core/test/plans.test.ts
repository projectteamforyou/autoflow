import { describe, expect, it } from "vitest";
import {
  BUSINESS_PRICES,
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

const LAST_FREE = new Date("2026-10-25T23:59:59+09:00");
const FIRST_PAID = new Date("2026-10-26T00:00:00+09:00");

describe("plans policy", () => {
  it("keeps business use free through 2026-10-25 end of day in Seoul", () => {
    expect(isBusinessGraceOver(LAST_FREE)).toBe(false);
    expect(isBusinessGraceOver(new Date(LAST_FREE.getTime() + 999))).toBe(false);
    expect(isBusinessGraceOver(FIRST_PAID)).toBe(true);
    // 2026-10-25 15:00 UTC is midnight in Seoul.
    expect(isBusinessGraceOver(new Date("2026-10-25T15:00:00Z"))).toBe(true);
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
    expect(formatPolicyDate("2026-10-25T23:59:59+09:00", "en")).toBe("October 25, 2026");
    expect(formatPolicyDate("2026-10-25T23:59:59+09:00", "ko")).toBe("2026년 10월 25일");
    expect(preferredProvider("ko")).toBe("portone");
    expect(preferredProvider("en")).toBe("paypal");
  });
});
