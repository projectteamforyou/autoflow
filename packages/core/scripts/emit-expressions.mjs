// Writes fixtures/engine/expressions.json: expression-level conformance cases with the value (or the
// exact error message) the TypeScript evaluator produces. The Rust (crates/engine/tests/expr.rs) and
// Kotlin (engine ExprTest) evaluators replay every case: regular-expression dialect (`.`, `\s`, `\w`
// inside classes, Annex B braces, `[]`/`[^]`, `\0`, `$`), number formatting and rounding, string→number
// coercion, date/time out of range, the string / list budgets, equality cost and indexing.
//
// `vars` values may be `{ "$repeat": [text, count] }` so a 350 000-character string is not stored in git.
import { mkdirSync, writeFileSync } from "node:fs";
import { evalExpr } from "../dist/index.js";

const vars = {
  cr: "a\rb",
  nbsp: "a b",
  nel: "a\u0085b",
  nl: "\n",
  nul: "a\u0000b",
  abcnl: "abc\n",
  tab: "a\tb",
  big: { $repeat: ["x", 350_000] },
  l: [{ $repeat: ["x", 350_000] }, { $repeat: ["x", 350_000] }, { $repeat: ["x", 350_000] }],
};
const expand = (v) => (Array.isArray(v) ? v.map(expand) : v && typeof v === "object" && "$repeat" in v ? v.$repeat[0].repeat(v.$repeat[1]) : v);

const exprs = [
  // regular expressions — ECMAScript dialect
  `matches("user.name@ex-ample.com", "^[\\\\w.-]+@[\\\\w-.]+$")`,
  `matches("a-b", "[a-\\\\d]+")`,
  `matches(cr, "^a.b$")`,
  `matches(nbsp, "a\\\\sb")`,
  `matches(nel, "a\\\\sb")`,
  `matches(tab, "a\\\\sb")`,
  `matches("a{", "a{")`,
  `matches("aa", "a{2}")`,
  `matches("a{,2}", "a{,2}")`,
  `matches("x", "[]")`,
  `matches(nl, "[^]")`,
  `matches(nul, "a\\\\0b")`,
  `matches(abcnl, "abc$")`,
  `matches("xB", "\\\\A")`,
  `matches("ABC", "(?i)abc")`,
  `matches("aaa", "a*+a")`,
  `matches("x", "\\\\p{L}")`,
  `matches("order-123", "^order-\\\\d+$")`,
  `matches("naïve", "^\\\\w+$")`,
  // arithmetic guards and JavaScript semantics
  `1e400 / 1e400`,
  `1e308 / 0.1`,
  `7 % -3`,
  `-7 % 3`,
  `"5" * "2"`,
  `round(0.49999999999999994)`,
  `round(-2.5)`,
  `round(2.5)`,
  `round(4503599627370497)`,
  `num("0x-1")`,
  `num("0x10")`,
  `num(" 12 ")`,
  `str(1e21)`,
  `str(0.1+0.2)`,
  `str(-0)`,
  `date(1e300)`,
  `time(8.65e15)`,
  // string / list budgets
  `str(l)`,
  `join(l, "")`,
  `l + ""`,
  `len(l)`,
  `len(big)`,
  // equality cost, indexing, comparison
  `range(50000) == range(50000)`,
  `contains(range(30000), 29999)`,
  `range(9000) == range(9000)`,
  `[1,2,3][-1]`,
  `"héllo"[1]`,
  `substr("hello", -3)`,
  `"a" < "b"`,
  `[1] == [1]`,
  `true == "true"`,
  `null == 0`,
  `[5,6][1.9]`,
];

const env = { vars: Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, expand(v)])), now: () => Date.UTC(2026, 0, 1), random: () => 0.5 };
const cases = exprs.map((expr) => {
  try {
    return { expr, expect: { value: evalExpr(expr, env) } };
  } catch (e) {
    return { expr, expect: { error: e.message } };
  }
});

mkdirSync(new URL("../fixtures/engine/", import.meta.url), { recursive: true });
writeFileSync(new URL("../fixtures/engine/expressions.json", import.meta.url), JSON.stringify({ vars, cases }, null, 2) + "\n");
console.log(`wrote ${cases.length} expression cases`);
