#!/usr/bin/env node
// Validates the Google Play store listing text and "What's new" notes (adapted from the Play kit).
//   node scripts/tools/check-listing.mjs
// Limits: title 30, short description 80, full description 4000, release notes 500 (characters).
// Characters are counted as Unicode code points; the stricter UTF-16 length is used for the pass/fail check so that
// emoji never push a field over the limit on Play Console.
// AutoFlow extras: every full description links its own-language privacy policy
// (https://autoflowmacro.com/<lang>/privacy/) and the support e-mail, and mentions the Accessibility Service use.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const listingDir = join(root, 'store/listing');
const whatsnewDir = join(root, 'store/whatsnew');

/** The 12 Play locales — keep in sync with scripts/play/publish.mjs LOCALES. Value = site language for the privacy URL. */
const LOCALES = {
  'en-US': 'en', 'ko-KR': 'ko', 'ja-JP': 'ja', 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW', 'es-ES': 'es',
  'fr-FR': 'fr', 'de-DE': 'de', 'pt-BR': 'pt-BR', 'ru-RU': 'ru', vi: 'vi', id: 'id',
};
const SITE = 'https://autoflowmacro.com';
const EMAIL = 'projectteamforyou@gmail.com';
const LIMITS = { title: 30, shortDescription: 80, fullDescription: 4000, whatsNew: 500 };

const len = (s) => Math.max([...s].length, s.length);
const cell = (n, max) => `${n}/${max}${n > max ? ' !!' : ''}`;
let failures = 0;
const rows = [];
const problems = [];

for (const [loc, lang] of Object.entries(LOCALES)) {
  const file = join(listingDir, `${loc}.json`);
  const row = { locale: loc };
  if (!existsSync(file)) {
    row.error = 'missing listing file';
    failures++;
    rows.push(row);
    continue;
  }
  let data;
  try {
    // tolerate a UTF-8 BOM (files edited on Windows)
    data = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    row.error = `invalid JSON: ${e.message}`;
    failures++;
    rows.push(row);
    continue;
  }
  for (const key of ['title', 'shortDescription', 'fullDescription']) {
    const v = data[key];
    if (typeof v !== 'string' || !v.trim()) {
      row[key] = 'EMPTY !!';
      failures++;
      continue;
    }
    const n = len(v.trim());
    row[key] = cell(n, LIMITS[key]);
    if (n > LIMITS[key]) failures++;
  }
  const full = String(data.fullDescription ?? '');
  const privacy = `${SITE}/${lang}/privacy/`;
  if (!full.includes(privacy)) problems.push(`${loc}: fullDescription must link ${privacy}`);
  if (!full.includes(EMAIL)) problems.push(`${loc}: fullDescription must include ${EMAIL}`);
  if (!/accessibility|접근성|ユーザー補助|无障碍|無障礙|accesibilidad|accessibilité|Bedienungshilfen|acessibilidade|специальных возможностей|hỗ trợ tiếp cận|aksesibilitas/i.test(full)) {
    problems.push(`${loc}: fullDescription must explain the Accessibility Service use`);
  }
  if (data.video !== undefined && data.video !== null && data.video !== '' && !/^https:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]{11}/.test(data.video)) {
    problems.push(`${loc}: video must be a single YouTube video URL`);
  }
  const wn = join(whatsnewDir, `whatsnew-${loc}`);
  if (existsSync(wn)) {
    const n = len(readFileSync(wn, 'utf8').replace(/^﻿/, '').trim());
    row.whatsNew = cell(n, LIMITS.whatsNew);
    if (n > LIMITS.whatsNew || n === 0) failures++;
  } else {
    row.whatsNew = 'missing !!';
    failures++;
  }
  rows.push(row);
}

// Stray files that Play would reject or that we would silently ignore
const known = new Set(Object.keys(LOCALES).map((l) => `${l}.json`));
for (const f of existsSync(listingDir) ? readdirSync(listingDir) : []) {
  if (!known.has(f)) console.warn(`warning: unexpected listing file ${f}`);
}
const knownWn = new Set(Object.keys(LOCALES).map((l) => `whatsnew-${l}`));
for (const f of existsSync(whatsnewDir) ? readdirSync(whatsnewDir) : []) {
  if (!knownWn.has(f)) console.warn(`warning: unexpected whatsnew file ${f}`);
}

console.table(rows);
for (const p of problems) console.error(`problem: ${p}`);
failures += problems.length;
if (failures) {
  console.error(`FAIL: ${failures} problem(s)`);
  process.exit(1);
}
console.log(`OK: ${Object.keys(LOCALES).length} locales within Play limits`);
