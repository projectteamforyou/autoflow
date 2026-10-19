/**
 * Open Graph images: one 1200×630 PNG per language per page, rendered by headless Chromium
 * from an HTML template with self-hosted Inter + Noto Sans CJK so every script renders correctly.
 */
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "playwright-core";
import sharp from "sharp";
import type { LocaleCode } from "@autoflow/core";
import { DIST, PUBLIC, SITE_URL } from "./config.js";
import { mark } from "./icons.js";
import { esc } from "./util.js";

const require = createRequire(import.meta.url);
const css = (pkg: string, file: string) => pathToFileURL(join(require.resolve(`${pkg}/package.json`), "..", file)).href;

export interface OgJob {
  lang: LocaleCode;
  page: string;
  kicker: string;
  headline: string;
  sub: string;
}

/** Resolve a Chromium binary: env override → preinstalled sandbox browser → Playwright's own cache. */
function chromiumPath(): string | undefined {
  const env = process.env.CHROMIUM_PATH || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (env && existsSync(env)) return env;
  for (const p of ["/opt/pw-browsers/chromium", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"]) if (existsSync(p)) return p;
  return undefined;
}

const CJK: Partial<Record<LocaleCode, [string, string]>> = {
  ko: ["@fontsource/noto-sans-kr", "Noto Sans KR"],
  ja: ["@fontsource/noto-sans-jp", "Noto Sans JP"],
  "zh-CN": ["@fontsource/noto-sans-sc", "Noto Sans SC"],
  "zh-TW": ["@fontsource/noto-sans-tc", "Noto Sans TC"],
};

function template(lang: LocaleCode): string {
  const cjk = CJK[lang];
  const links = [css("@fontsource-variable/inter", "index.css"), ...(cjk ? [css(cjk[0], "400.css"), css(cjk[0], "700.css"), css(cjk[0], "800.css")] : [])];
  const family = `"Inter Variable", ${cjk ? `"${cjk[1]}", ` : ""}sans-serif`;
  const art = pathToFileURL(join(PUBLIC, "img", "hero-universe.webp")).href;
  const host = new URL(SITE_URL).host;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
${links.map((l) => `<link rel="stylesheet" href="${l}">`).join("")}
<style>
*{box-sizing:border-box;margin:0}
html,body{width:1200px;height:630px;overflow:hidden}
body{font-family:${family};background:#0B0B1A;color:#F4F4FB;-webkit-font-smoothing:antialiased;position:relative}
.art{position:absolute;right:-140px;top:-40px;width:900px;height:700px;background:url(${art}) center/cover;opacity:.55;-webkit-mask-image:radial-gradient(60% 60% at 60% 45%,#000 30%,transparent 75%)}
.glow{position:absolute;inset:0;background:radial-gradient(50% 70% at 0% 0%,rgba(124,92,255,.5),transparent 60%),radial-gradient(40% 60% at 100% 100%,rgba(34,195,166,.35),transparent 60%)}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px);background-size:48px 48px}
.c{position:absolute;inset:64px 72px 56px;display:flex;flex-direction:column}
.brand{display:flex;align-items:center;gap:16px;font-size:34px;font-weight:700;letter-spacing:-.02em}
.brand svg{border-radius:14px;box-shadow:0 8px 30px rgba(124,92,255,.45)}
.kicker{margin-top:36px;align-self:flex-start;padding:7px 16px;border-radius:999px;border:1.5px solid rgba(255,255,255,.18);background:rgba(20,20,43,.6);color:#7EF0D9;font-size:22px;font-weight:700;letter-spacing:.02em}
.kicker:empty{display:none}
h1{margin-top:28px;max-width:900px;font-size:76px;line-height:1.06;font-weight:800;letter-spacing:-.035em;max-height:248px;overflow:hidden}
h1[lang|=ko],h1[lang|=ja],h1[lang|=zh]{letter-spacing:-.01em;line-height:1.18}
h1[lang|=ko],html[lang=ko] p{word-break:keep-all}h1[lang|=ja],h1[lang|=zh]{line-break:strict}
.g{background:linear-gradient(120deg,#A08BFF,#6FA1FF 50%,#4FE3C6);-webkit-background-clip:text;color:transparent}
p{margin-top:18px;max-width:860px;font-size:27px;line-height:1.4;color:#C4C4DC;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.foot{margin-top:auto;display:flex;align-items:center;gap:14px;font-size:22px;color:#A3A3C2;font-weight:600}
.chip{padding:6px 14px;border-radius:10px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);color:#E4E4F4}
.url{margin-left:auto;color:#F4F4FB}
</style></head><body><div class="art"></div><div class="grid"></div><div class="glow"></div>
<div class="c"><div class="brand">${mark(64, "og")}AutoFlow</div><div class="kicker" id="k"></div><h1 id="h" lang="${lang}"></h1><p id="s"></p>
<div class="foot"><span class="chip">Windows</span><span class="chip">Android</span><span class="chip">Web</span><span class="url">${esc(host)}</span></div></div>
</body></html>`;
}

export async function renderOgImages(jobs: OgJob[]) {
  const tmp = join(DIST, ".og-tmp");
  await mkdir(tmp, { recursive: true });
  const browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--font-render-hinting=none", "--allow-file-access-from-files"] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    const byLang = new Map<LocaleCode, OgJob[]>();
    for (const j of jobs) byLang.set(j.lang, [...(byLang.get(j.lang) ?? []), j]);
    const queue = [...byLang];
    // A few tabs in parallel: each takes one language at a time (fonts stay warm per tab).
    const worker = async () => {
      const page = await ctx.newPage();
      for (let next = queue.shift(); next; next = queue.shift()) await renderLang(page, next[0], next[1]);
    };
    await Promise.all(Array.from({ length: 4 }, worker));
  } finally {
    await browser.close();
    await rm(tmp, { recursive: true, force: true });
  }

  async function renderLang(page: Page, lang: LocaleCode, list: OgJob[]) {
    {
      const file = join(tmp, `${lang}.html`);
      await writeFile(file, template(lang));
      await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
      await mkdir(join(DIST, "og", lang), { recursive: true });
      for (const job of list) {
        await page.evaluate(
          async ({ kicker, headline, sub, home }) => {
            const h = document.getElementById("h")!;
            document.getElementById("k")!.textContent = kicker;
            document.getElementById("s")!.textContent = sub;
            h.textContent = "";
            if (home) {
              // Home: last sentence/word group gets the brand gradient.
              const parts = headline.split(/(?<=[.。．!！])\s*/).filter(Boolean);
              const last = parts.pop() ?? headline;
              h.append(document.createTextNode(parts.join(" ") + (parts.length ? " " : "")));
              const g = document.createElement("span");
              g.className = "g";
              g.textContent = last;
              h.append(g);
            } else h.textContent = headline;
            let size = 76;
            h.style.fontSize = `${size}px`;
            await document.fonts.ready;
            while (h.scrollHeight > 205 && size > 44) {
              size -= 2;
              h.style.fontSize = `${size}px`;
            }
            await document.fonts.ready;
          },
          { kicker: job.kicker, headline: job.headline, sub: job.sub, home: job.page === "home" },
        );
        const png = await page.screenshot({ type: "png" });
        const optimised = await sharp(png).png({ compressionLevel: 9, palette: true, quality: 90, effort: 8 }).toBuffer();
        await writeFile(join(DIST, "og", lang, `${job.page}.png`), optimised);
      }
    }
  }
}
