#!/usr/bin/env node
// Google Play store images for AutoFlow, rendered with Playwright (Chromium) from local HTML templates — no app build
// and no network needed. Adapted from the Play kit's screens.mjs (same output layout, so publish.mjs picks them up):
//   store/screens/<play-locale>/0N-<scene>.png            phone screenshots 1080×1920 (6 scenes × 12 languages)
//   store/screens/<play-locale>/tablet7/0N-<scene>.png    7-inch tablet screenshots 1200×1920
//   store/screens/<play-locale>/tablet10/0N-<scene>.png   10-inch tablet screenshots 1600×2560
//   store/screens/<play-locale>/feature.png               feature graphic 1024×500
// Scene order is conversion order: 01 shows the core promise (auto clicker in seconds), 02 the macro editor.
// Templates: scripts/store/templates/{screen,feature}.html · copy: scripts/store/captions.json · tokens: packages/brand.
//
// Usage: node scripts/store/screens.mjs [--locales=en,ko] [--scenes=easy,run] [--forms=phone,tablet7,tablet10]
//                                       [--jobs=3] [--no-feature]
// Chromium: $PW_CHROMIUM, else /opt/pw-browsers/chromium when present, else Playwright's own download.
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'store/screens');
const TPL = join(ROOT, 'scripts/store/templates');
const CAPTIONS = JSON.parse(readFileSync(join(ROOT, 'scripts/store/captions.json'), 'utf8'));
const TOKENS = readFileSync(join(ROOT, 'packages/brand/tokens.css'), 'utf8');
const MARK = `data:image/svg+xml;base64,${readFileSync(join(ROOT, 'packages/brand/mark.svg')).toString('base64')}`;

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
/** captions.json language → Play locale (the 12 Play listings, scripts/play/publish.mjs LOCALES). */
export const PLAY = { en: 'en-US', ko: 'ko-KR', ja: 'ja-JP', 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', 'pt-BR': 'pt-BR', ru: 'ru-RU', vi: 'vi', id: 'id' };
const ALL = Object.keys(PLAY);
const pick = (v, all) => (v === undefined || v === true || v === 'all' ? all : v === 'none' ? [] : String(v).split(',').filter((x) => all.includes(x)));
const LOCALES = pick(args.locales, ALL);
const ORDER = ['easy', 'flow', 'run', 'atlas', 'safety', 'privacy'];
const SCENES = pick(args.scenes, ORDER);
const FEATURE = !args['no-feature'];
const JOBS = Math.max(1, Number(args.jobs ?? 3));

// Sizes Play accepts: 320–3840 px a side, long side ≤ 2× short side. fw = CSS width the app mock renders at.
const FORMS = {
  phone: { W: 1080, H: 1920, fw: 412, dir: '' },
  tablet7: { W: 1200, H: 1920, fw: 600, dir: 'tablet7' },
  tablet10: { W: 1600, H: 2560, fw: 768, dir: 'tablet10' },
};
const FORM_LIST = pick(args.forms, Object.keys(FORMS));

// Per-script font stacks: Inter for Latin/Cyrillic/Vietnamese, the right Noto CJK face per language (CI installs
// fonts-noto-cjk), with WenQuanYi / IPA as local fallbacks.
const CJK = { ko: "'Noto Sans CJK KR','Noto Sans KR'", ja: "'Noto Sans CJK JP','IPAGothic'", 'zh-CN': "'Noto Sans CJK SC'", 'zh-TW': "'Noto Sans CJK TC'" };
const fontStack = (lang) => [`'Inter'`, CJK[lang], `'Noto Sans'`, `'WenQuanYi Zen Hei'`, `'Noto Color Emoji'`].filter(Boolean).join(',');

async function loadChromium() {
  const candidates = ['playwright'];
  try {
    candidates.push(join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright/index.js'));
  } catch {
    /* no global npm */
  }
  candidates.push('/opt/node22/lib/node_modules/playwright/index.js');
  for (const p of candidates) {
    try {
      const m = await import(p.startsWith('/') ? pathToFileURL(p).href : p);
      return m.chromium ?? m.default.chromium;
    } catch {
      /* try next */
    }
  }
  throw new Error('Playwright not found — npm i -g playwright (or npx playwright install chromium)');
}

function page(file, data) {
  return readFileSync(join(TPL, file), 'utf8')
    .replace('/*__TOKENS__*/', TOKENS)
    .replace('<script>', `<script>window.__DATA=${JSON.stringify(data).replace(/</g, '\\u003c')};</script>\n<script>`);
}

async function render(browser, html, width, height, path) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.setContent(html, { waitUntil: 'load' });
  if (errors.length) {
    await ctx.close();
    throw new Error(`template error in ${path.replace(ROOT + '/', '')}: ${errors.join(' | ')}`);
  }
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 15_000 });
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path, type: 'png' });
  await ctx.close();
}

async function shots(browser, lang) {
  const C = CAPTIONS[lang];
  let n = 0;
  for (const form of FORM_LIST) {
    const f = FORMS[form];
    const dir = join(OUT, PLAY[lang], f.dir);
    mkdirSync(dir, { recursive: true });
    // a full re-render drops numbered shots from an older scene order so they are never uploaded
    if (SCENES.length === ORDER.length) for (const old of readdirSync(dir)) if (/^\d+-.*\.png$/.test(old)) rmSync(join(dir, old));
    for (const scene of SCENES) {
      const html = page('screen.html', { lang, scene, form: f, caption: C[scene], ui: C.ui, mark: MARK, fontStack: fontStack(lang) });
      const file = join(dir, `0${ORDER.indexOf(scene) + 1}-${scene}.png`);
      // one retry: a busy CI runner occasionally misses the ready flag
      await render(browser, html, f.W, f.H, file).catch((err) => (console.warn(`${PLAY[lang]} ${form} ${scene}: retry after ${String(err.message).split('\n')[0]}`), render(browser, html, f.W, f.H, file)));
      n++;
    }
  }
  if (FEATURE) {
    const html = page('feature.html', { lang, caption: C.feature, chips: [C.ui.noRoot, C.ui.noAds, `${C.ui.easy} · ${C.ui.pro}`], mark: MARK, fontStack: fontStack(lang) });
    mkdirSync(join(OUT, PLAY[lang]), { recursive: true });
    await render(browser, html, 1024, 500, join(OUT, PLAY[lang], 'feature.png'));
    n++;
  }
  return n;
}

const chromium = await loadChromium();
const exe = process.env.PW_CHROMIUM || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const t0 = Date.now();
let images = 0;
try {
  const queue = [...LOCALES];
  const worker = async () => {
    for (let lang; (lang = queue.shift()); ) {
      const n = await shots(browser, lang);
      images += n;
      console.log(`${PLAY[lang]}: ${n} images (${FORM_LIST.join(', ')}${FEATURE ? ', feature' : ''})`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(JOBS, LOCALES.length) }, worker));
} finally {
  await browser.close();
}
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'README.txt'), `Generated by scripts/store/screens.mjs — ${new Date().toISOString()}\nLocales: ${LOCALES.join(', ')}\nImages: ${images}\nOnly en-US and ko-KR phone shots + feature graphics are committed; CI renders the rest before upload.\n`);
console.log(`done: ${images} images in ${((Date.now() - t0) / 1000).toFixed(0)}s → store/screens`);
