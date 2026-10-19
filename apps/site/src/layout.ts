import { LOCALES, type LocaleCode } from "@autoflow/core";
import type { Content } from "../content/types.js";
import { API_ORIGIN, BRAND, BUSINESS, LINKS, LOCALE_BY_CODE, PAGES, SITE_URL, abs, pagePath, type PageId } from "./config.js";
import { brand, icon, mark } from "./icons.js";
import { esc, html } from "./util.js";

export interface Ctx {
  lang: LocaleCode;
  t: Content;
  page: PageId | "404";
  /** Public path of this document. */
  path: string;
  /** Whether this is the root x-default copy of the English home page. */
  isRoot?: boolean;
}

export interface Assets {
  css: string;
  js: string;
  font: string;
  themeScript: string;
}

export interface HeadMeta {
  title: string;
  description: string;
  ogImage: string;
  ogAlt: string;
  jsonld: unknown[];
  noindex?: boolean;
  alternates: boolean;
}

const NAV: PageId[] = ["features", "windows", "android", "keyforge", "atlas", "safety", "pricing", "faq"];

export function altHref(lang: LocaleCode, page: PageId) {
  return abs(pagePath(lang, page));
}

function head(ctx: Ctx, meta: HeadMeta, a: Assets): string {
  const loc = LOCALE_BY_CODE[ctx.lang];
  const url = abs(ctx.path);
  const alternates =
    meta.alternates && ctx.page !== "404"
      ? [
          ...LOCALES.map((l) => `<link rel="alternate" hreflang="${l.hreflang}" href="${altHref(l.code, ctx.page as PageId)}">`),
          `<link rel="alternate" hreflang="x-default" href="${ctx.page === "home" ? `${SITE_URL}/` : altHref("en", ctx.page as PageId)}">`,
        ].join("")
      : "";
  return html`<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(meta.title)}</title>
<meta name="description" content="${esc(meta.description)}">
${meta.noindex ? '<meta name="robots" content="noindex, follow">' : `<link rel="canonical" href="${url}">`}
${alternates}
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="${BRAND.bg}" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="${BRAND.light}" media="(prefers-color-scheme: light)">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="preload" href="${a.font}" as="font" type="font/woff2" crossorigin>
<meta property="og:type" content="website">
<meta property="og:site_name" content="AutoFlow">
<meta property="og:title" content="${esc(meta.title)}">
<meta property="og:description" content="${esc(meta.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${abs(meta.ogImage)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(meta.ogAlt)}">
<meta property="og:locale" content="${loc.og}">
${LOCALES.filter((l) => l.code !== ctx.lang).map((l) => `<meta property="og:locale:alternate" content="${l.og}">`)}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(meta.title)}">
<meta name="twitter:description" content="${esc(meta.description)}">
<meta name="twitter:image" content="${abs(meta.ogImage)}">
<meta name="twitter:image:alt" content="${esc(meta.ogAlt)}">
<script>${a.themeScript}</script>
<style>${a.css}</style>
<script src="${a.js}" defer></script>
${meta.jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`)}
</head>`;
}

function header(ctx: Ctx): string {
  const { t, lang } = ctx;
  const home = pagePath(lang, "home");
  const cur = (p: PageId) => (ctx.page === p ? ' aria-current="page"' : "");
  return html`<header class="site-header">
<div class="wrap nav">
<a class="brand" href="${home}">${mark(28, "hm")}<span>AutoFlow</span></a>
<nav aria-label="${esc(t.a11y.primaryNav)}"><ul class="nav-links">
${NAV.map((p) => `<li><a href="${pagePath(lang, p)}"${cur(p)}>${esc(t.nav[p])}</a></li>`)}
</ul></nav>
<div class="nav-tools">
${langPicker(ctx)}
<button type="button" class="icon-btn theme-toggle" data-theme-toggle aria-label="${esc(t.a11y.theme)}">${icon("sun", 18, "i sun")}${icon("moon", 18, "i moon")}</button>
<details class="pop menu-btn"><summary class="icon-btn" aria-label="${esc(t.a11y.menu)}">${icon("menu", 18)}</summary>
<div class="pop-panel"><ul class="menu-list">
${NAV.concat(["download"]).map((p) => `<li><a href="${pagePath(lang, p)}"${cur(p)}>${esc(t.nav[p])}</a></li>`)}
</ul></div></details>
<a class="btn btn-primary btn-sm nav-cta" href="${pagePath(lang, "download")}">${icon("download", 16)}${esc(t.nav.download)}</a>
</div>
</div>
</header>`;
}

function langPicker(ctx: Ctx): string {
  const { t, lang } = ctx;
  const target: PageId = ctx.page === "404" ? "home" : ctx.page;
  return html`<details class="pop"><summary class="icon-btn" aria-label="${esc(t.a11y.language)}: ${esc(LOCALE_BY_CODE[lang].name)}">${icon("globe", 18)}<span class="lang-code">${lang.toUpperCase()}</span></summary>
<div class="pop-panel"><ul class="lang-list">
${LOCALES.map((l) => `<li><a href="${pagePath(l.code, target)}" hreflang="${l.hreflang}" lang="${l.code}" data-lang="${l.code}"${l.code === lang ? ' aria-current="true"' : ""}>${esc(l.name)}</a></li>`)}
</ul></div></details>`;
}

/** Live public counters, filled in by client.js from GET /v1/stats (hidden until loaded). */
function statsBar(ctx: Ctx): string {
  const s = ctx.t.footer.stats;
  const item = (key: string, label: string) => `<div class="stat"><span class="stat-n" data-stat="${key}">—</span><span class="stat-l">${esc(label)}</span></div>`;
  return `<section class="foot-stats" aria-label="${esc(s.statsTitle)}" data-api="${API_ORIGIN}" hidden><span class="live-dot" aria-hidden="true"></span>${item("visits", s.visits)}${item("online", s.online)}${item("downloads", s.downloads)}</section>`;
}

function businessInfo(ctx: Ctx): string {
  const b = ctx.t.footer.biz;
  const v = ctx.lang === "ko" ? BUSINESS.ko : BUSINESS.intl;
  const phone = ctx.lang === "ko" ? BUSINESS.phone : BUSINESS.phoneIntl;
  const row = (k: string, val: string) => `<div><dt>${esc(k)}</dt><dd>${val}</dd></div>`;
  return `<section class="foot-biz" aria-label="${esc(b.bizTitle)}"><h2>${esc(b.bizTitle)}</h2><dl>${[
    row(b.company, esc(v.company)),
    row(b.ceo, esc(v.ceo)),
    row(b.regNo, esc(BUSINESS.regNo)),
    row(b.mailOrder, esc(BUSINESS.mailOrder)),
    row(b.address, esc(v.address)),
    row(b.phone, `<a href="tel:${BUSINESS.phoneIntl.replace(/-/g, "")}">${esc(phone)}</a>`),
    row(b.email, `<a href="mailto:${BUSINESS.email}">${BUSINESS.email}</a>`),
    row(b.website, `<a href="${BUSINESS.website}" rel="noopener" target="_blank">projectteamforyou.com</a>`),
  ].join("")}</dl></section>`;
}

function footer(ctx: Ctx): string {
  const { t, lang } = ctx;
  const target: PageId = ctx.page === "404" ? "home" : ctx.page;
  const l = (p: PageId) => `<li><a href="${pagePath(lang, p)}">${esc(t.nav[p])}</a></li>`;
  const ext = (href: string, label: string) => `<li><a href="${href}" rel="noopener noreferrer" target="_blank">${esc(label)}<span class="sr-only"> ${esc(t.a11y.newTab)}</span></a></li>`;
  return html`<footer class="site-footer">
<div class="wrap">
<nav class="foot" aria-label="${esc(t.a11y.footerNav)}">
<div><a class="brand" href="${pagePath(lang, "home")}">${mark(28, "fm")}<span>AutoFlow</span></a><p>${esc(t.footer.tagline)}</p><p>${esc(t.footer.made)}</p></div>
<div><h2>${esc(t.footer.product)}</h2><ul>${(["features", "keyforge", "atlas", "safety", "pricing", "faq"] as PageId[]).map(l)}</ul></div>
<div><h2>${esc(t.footer.platforms)}</h2><ul>${l("windows")}${l("android")}<li><a href="${LINKS.app}">${esc(t.cta.openApp)}</a></li>${l("download")}${ext(LINKS.releases, t.footer.releases)}</ul></div>
<div><h2>${esc(t.footer.legal)}</h2><ul>${l("privacy")}${l("terms")}<li><a href="mailto:${LINKS.email}">${esc(t.footer.contact)}</a></li></ul></div>
</nav>
<div class="foot-langs">${LOCALES.map((x) => `<a href="${pagePath(x.code, target)}" hreflang="${x.hreflang}" lang="${x.code}" data-lang="${x.code}"${x.code === lang ? ' aria-current="true"' : ""}>${esc(x.name)}</a>`)}</div>
${statsBar(ctx)}
${businessInfo(ctx)}
<div class="foot-bottom"><span>${esc(t.footer.rights)}</span><a href="mailto:${LINKS.email}">${LINKS.email}</a></div>
</div>
</footer>`;
}

export function document(ctx: Ctx, meta: HeadMeta, main: string, a: Assets): string {
  const loc = LOCALE_BY_CODE[ctx.lang];
  const { t } = ctx;
  return `<!doctype html>\n${html`<html lang="${ctx.lang}" dir="${loc.dir}" data-locale="${ctx.lang}">
${head(ctx, meta, a)}
<body>
<a class="skip" href="#main">${esc(t.a11y.skip)}</a>
${header(ctx)}
<main id="main" tabindex="-1">
${main}
</main>
${footer(ctx)}
<div class="toast" id="lang-toast" role="region" aria-label="${esc(t.a11y.language)}" hidden><span data-t></span><a class="btn btn-primary btn-sm" data-go href="${pagePath("en", "home")}">${icon("globe", 16)}<span></span></a><button type="button" class="btn btn-secondary btn-sm" data-stay></button></div>
<div class="status" id="status" role="status" aria-live="polite"></div>
</body>
</html>`}`;
}

/** Share row: plain anchors (no third-party scripts) + Web Share + copy link. */
export function shareBar(ctx: Ctx, title: string): string {
  const { t, lang } = ctx;
  const url = abs(ctx.path);
  const u = encodeURIComponent(url);
  const txt = encodeURIComponent(t.share.text);
  const ttl = encodeURIComponent(title);
  const nets: [string, string, string][] = [
    ["x", "X", `https://x.com/intent/post?text=${txt}&url=${u}`],
    ["facebook", "Facebook", `https://www.facebook.com/sharer/sharer.php?u=${u}`],
    ["linkedin", "LinkedIn", `https://www.linkedin.com/sharing/share-offsite/?url=${u}`],
    ["reddit", "Reddit", `https://www.reddit.com/submit?url=${u}&title=${ttl}`],
    ["line", "LINE", `https://social-plugins.line.me/lineit/share?url=${u}`],
    ["whatsapp", "WhatsApp", `https://wa.me/?text=${encodeURIComponent(`${t.share.text} ${url}`)}`],
    ["telegram", "Telegram", `https://t.me/share/url?url=${u}&text=${txt}`],
  ];
  if (lang === "zh-CN" || lang === "zh-TW") nets.push(["weibo", "Weibo", `https://service.weibo.com/share/share.php?url=${u}&title=${txt}`]);
  // Put the networks people in each market actually use first.
  const first: Partial<Record<LocaleCode, string[]>> = {
    ja: ["line", "x"],
    "zh-TW": ["line", "facebook"],
    "zh-CN": ["weibo"],
    vi: ["facebook"],
    id: ["whatsapp", "facebook"],
    "pt-BR": ["whatsapp"],
    es: ["whatsapp"],
    ru: ["telegram"],
  };
  const order = first[lang] ?? [];
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : 99);
  nets.sort((a, b) => rank(a[0]) - rank(b[0]));
  return html`<div class="share" role="group" aria-label="${esc(t.share.heading)}">
<span class="share-h">${esc(t.share.heading)}</span>
<button type="button" data-share data-url="${url}" data-title="${esc(title)}" data-text="${esc(t.share.text)}">${icon("share", 16)}${esc(t.share.native)}</button>
<button type="button" data-copy="${url}" data-done="${esc(t.share.copied)}">${icon("copy", 16)}${esc(t.share.copy)}</button>
${nets.map(([id, name, href]) => `<a href="${esc(href)}" rel="noopener noreferrer" target="_blank" aria-label="${name} ${esc(t.a11y.newTab)}" title="${name}">${brand(id, 17)}</a>`)}
</div>`;
}

export { PAGES };
