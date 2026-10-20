/**
 * Fills apps/web/src/i18n/locales/<code>.json with translations of the English dictionary.
 * Only missing (or --force) keys are sent. Placeholders ({name}, {{secret:x}}, {{date()}}) and
 * product names are verified to survive translation; bad entries are retried, then left in English.
 *
 *   OPENAI_API_KEY=… pnpm --filter @autoflow/web i18n:translate [--only ko,ja] [--force]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { EXPLAIN_EN, LOCALES } from "@autoflow/core";
import { en } from "../src/i18n/en";

const KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_TEXT_MODEL ?? "gpt-4.1";
if (!KEY) throw new Error("OPENAI_API_KEY is required");

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1]!.split(",") : null;
const force = args.includes("--force");
const source: Record<string, string> = { ...EXPLAIN_EN, ...en };
const BRAND = ["AutoFlow", "Keyforge", "Atlas", "Ledger", "Pulse", "Halt", "Copilot", "Studio", "Fleet", "Practice Canvas", "Safety Score", "Guardrails"];

const placeholders = (s: string) => [...s.matchAll(/\{\{[^}]+\}\}|\{\w+\}/g)].map((m) => m[0]).sort().join("|");

async function translateChunk(lang: string, entries: [string, string][]): Promise<Record<string, string>> {
  const body = {
    model: MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a senior software localizer. Translate UI strings of "AutoFlow", an automation app (auto clicker, macros, key remapping, routines), from English into ${lang}.
Rules:
- Return a JSON object with exactly the same keys.
- Keep placeholders exactly as written: {name}, {n}, {{secret:name}}, {{date()}}, {{variable}} etc. Never translate inside braces.
- Keep these product names in English: ${BRAND.join(", ")}.
- Keep keyboard names (Ctrl, Alt, Esc, Shift, Tab, Enter, F8…) and units (ms, px, %) as is.
- Natural, concise, native UI tone (as Apple/Google would ship). Use the platform's common terms for click, tap, swipe, clipboard, notification.
- Keys starting with "onboard." are shown on ONE line on desktop: keep them as short as the English (similar character count; CJK about half), no extra clauses.
- Korean: use 합니다/하세요 polite style for sentences; short labels as nouns. Japanese: です/ます. Chinese: concise.`,
      },
      { role: "user", content: JSON.stringify(Object.fromEntries(entries)) },
    ],
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    return JSON.parse(data.choices[0]!.message.content) as Record<string, string>;
  }
  throw new Error("translation failed after retries");
}

async function run(code: string, english: string) {
  const file = new URL(`../src/i18n/locales/${code}.json`, import.meta.url);
  const existing: Record<string, string> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const todo = Object.entries(source).filter(([k, v]) => force || !existing[k] || placeholders(existing[k]!) !== placeholders(v));
  if (!todo.length) return console.log(`${code}: up to date`);
  const out = { ...existing };
  const size = 70;
  const chunks: [string, string][][] = [];
  for (let i = 0; i < todo.length; i += size) chunks.push(todo.slice(i, i + size));
  let bad = 0;
  await Promise.all(
    chunks.map(async (chunk) => {
      let result = await translateChunk(english, chunk);
      const retry = chunk.filter(([k, v]) => typeof result[k] !== "string" || placeholders(result[k]!) !== placeholders(v));
      if (retry.length) result = { ...result, ...(await translateChunk(english, retry)) };
      for (const [k, v] of chunk) {
        const tr = result[k];
        if (typeof tr === "string" && placeholders(tr) === placeholders(v) && tr.trim()) out[k] = tr;
        else bad++;
      }
    }),
  );
  const sorted = Object.fromEntries(Object.keys(source).filter((k) => out[k] !== undefined).map((k) => [k, out[k]!]));
  writeFileSync(file, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`${code}: ${todo.length - bad} translated, ${bad} left in English`);
}

const targets = LOCALES.filter((l) => l.code !== "en" && (!only || only.includes(l.code)));
for (let i = 0; i < targets.length; i += 4) await Promise.all(targets.slice(i, i + 4).map((l) => run(l.code, l.english)));
