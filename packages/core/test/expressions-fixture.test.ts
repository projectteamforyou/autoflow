import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evalExpr } from "../src/index.js";

interface Case {
  expr: string;
  expect: { value?: unknown; error?: string };
}
const fixture = JSON.parse(readFileSync(new URL("../fixtures/engine/expressions.json", import.meta.url), "utf8")) as { vars: Record<string, unknown>; cases: Case[] };
const expand = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(expand) : v && typeof v === "object" && "$repeat" in v ? (v as { $repeat: [string, number] }).$repeat[0].repeat((v as { $repeat: [string, number] }).$repeat[1]) : v;

// The fixture is produced by this evaluator (scripts/emit-expressions.mjs), so this test pins the
// committed answers: a semantic change shows up as a fixture diff, which the Rust and Kotlin
// evaluators then have to follow.
describe("expression conformance fixture", () => {
  const env = { vars: Object.fromEntries(Object.entries(fixture.vars).map(([k, v]) => [k, expand(v)])) as never, now: () => Date.UTC(2026, 0, 1), random: () => 0.5 };
  it("has a case for every parity-sensitive area", () => {
    expect(fixture.cases.length).toBeGreaterThan(40);
    expect(fixture.cases.some((c) => /matches\(/.test(c.expr))).toBe(true);
    expect(fixture.cases.some((c) => c.expect.error === "string too large")).toBe(true);
    expect(fixture.cases.some((c) => c.expect.error === "number out of range")).toBe(true);
  });
  for (const c of fixture.cases) {
    it(c.expr, () => {
      if (c.expect.error !== undefined) expect(() => evalExpr(c.expr, env)).toThrow(c.expect.error);
      else expect(evalExpr(c.expr, env)).toEqual(c.expect.value);
    });
  }
});
