/**
 * CI gate for translations: every locale must contain every English key with identical placeholders,
 * and every key referenced statically in the source must exist in English.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { EXPLAIN_EN, LOCALES } from "@autoflow/core";
import { en } from "../src/i18n/en";

const source: Record<string, string> = { ...EXPLAIN_EN, ...en };
const ph = (s: string) => [...s.matchAll(/\{\{[^}]+\}\}|\{\w+\}/g)].map((m) => m[0]).sort().join("|");
let problems = 0;

for (const l of LOCALES.filter((x) => x.code !== "en")) {
  const dict = JSON.parse(readFileSync(new URL(`../src/i18n/locales/${l.code}.json`, import.meta.url), "utf8")) as Record<string, string>;
  const missing = Object.keys(source).filter((k) => !dict[k]);
  const broken = Object.keys(dict).filter((k) => source[k] !== undefined && ph(dict[k]!) !== ph(source[k]!));
  const extra = Object.keys(dict).filter((k) => source[k] === undefined);
  if (missing.length || broken.length) {
    problems += missing.length + broken.length;
    console.error(`${l.code}: ${missing.length} missing, ${broken.length} placeholder mismatches${missing.length ? ` (e.g. ${missing.slice(0, 5).join(", ")})` : ""}${broken.length ? ` [${broken.slice(0, 5).join(", ")}]` : ""}`);
  } else console.log(`${l.code}: ok (${Object.keys(dict).length} keys${extra.length ? `, ${extra.length} unused` : ""})`);
}

const files: string[] = [];
const walk = (d: string) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(f)) files.push(p);
  }
};
walk(new URL("../src", import.meta.url).pathname);
const used = new Set<string>();
for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/\bt\("([^"]+)"/g)) used.add(m[1]!);
const unknown = [...used].filter((k) => source[k] === undefined);
if (unknown.length) {
  problems += unknown.length;
  console.error(`source references unknown keys: ${unknown.join(", ")}`);
}
if (problems) process.exit(1);
console.log("i18n OK");
