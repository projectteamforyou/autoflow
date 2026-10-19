import { describe, expect, it } from "vitest";
import { compileSafeRegex, evalExpr } from "../src/index.js";

describe("safe regex (matches)", () => {
  it("agrees with RegExp on the supported subset", () => {
    const pats = [
      "abc", "^abc$", "a.c", "a*", "^a*$", "(a|b)+c", "^(a|ab)*c$", "[a-z]+\\d{2,3}", "\\bfoo\\b", "\\Bfoo", "x?y", "^$", "colou?r", "[^0-9]+$",
      "^\\s*\\w+@\\w+\\.com\\s*$", "(?:ab){2}", "a{2,}", "a{,2}", "a{2", "[]", "[^]", "[a\\-z]", "\\x41", "\\u00e9", "[\\d.]+", "^.{3}$", "(a*)*b",
      "a|", "|b", "^(\\d+)(\\.\\d+)?$", "[\\w-]+", "x{0}", "a+?b", "a.*?b", "^[A-Z][a-z]+ [A-Z]", "\\d{3}-\\d{4}", "(foo|bar|baz)$", "a\\.b", "\\\\",
    ];
    const subjects = [
      "", "abc", "xabcx", "ac", "aaa", "ababc", "abbc", "hello12", "hello1234", "a foo b", "afoo", "y", "xy", "color", "colour", "123", "abc!",
      "  bob@ex.com ", "abab", "aa", "a", "a{2", "x", "-", "A", "é", "1.5", "abcd", "aaab", "3.14", "x-y_z", "a{,2}", "aab", "a\nb", "John Smith",
      "555-1234", "foobaz", "a.b", "a\\b",
    ];
    for (const p of pats) {
      const native = new RegExp(p);
      const safe = compileSafeRegex(p);
      for (const s of subjects) expect([p, s, safe.test(s)]).toEqual([p, s, native.test(s)]);
    }
  });

  it("stays linear on patterns that make backtracking engines explode", () => {
    const t0 = Date.now();
    const evil = "a".repeat(10_000) + "b";
    expect(compileSafeRegex("^(a|a)*$").test(evil)).toBe(false);
    expect(compileSafeRegex("^(a+)+$").test(evil)).toBe(false);
    expect(compileSafeRegex("^(a|aa)+$").test(evil)).toBe(false);
    expect(compileSafeRegex("(.*a){20}").test("a".repeat(5000))).toBe(true);
    // Through the expression language (the subject is capped at 10 000 code units).
    expect(evalExpr('matches(s, "^(a|a)*$")', { vars: { s: "a".repeat(5000) + "b" } })).toBe(false);
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it("rejects unsupported or oversized syntax instead of changing its meaning", () => {
    for (const bad of ["(?=a)", "(?!a)", "(?<=a)b", "(?<n>a)", "(a)\\1", "\\p{L}", "a**", "*a", "(a", "a)", "[a", "(a{100}){100}", "a{200}", "x".repeat(201)]) {
      expect(() => compileSafeRegex(bad), bad).toThrow();
    }
    expect(() => evalExpr('matches("a", "(?=a)")', { vars: {} })).toThrow(/not supported/);
  });
});
