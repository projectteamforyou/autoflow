import { TEMPLATES, analyzeRisk, type Template, type TemplateCategory } from "@autoflow/core";
import type { Content, Section } from "../content/types.js";
import { LINKS, pagePath, type PageId } from "./config.js";
import { brand, icon, mark } from "./icons.js";
import { shareBar, type Ctx } from "./layout.js";
import { crumbsFor } from "./seo.js";
import { esc, html, md, brk } from "./util.js";

export interface PageOut {
  title: string;
  description: string;
  /** Headline used on the Open Graph image. */
  og: { kicker: string; headline: string; sub: string };
  main: string;
}

const IMG: Record<string, [number, number]> = {
  "hero-universe": [1536, 1024],
  keyforge: [1200, 800],
  "practice-canvas": [1200, 800],
  "safety-shield": [1024, 1024],
  "android-automation": [1024, 1024],
};
/** Decorative illustrations: empty alt, explicit size, lazy unless above the fold. */
function img(name: string, eager = false, sizes = "(max-width: 880px) 100vw, 560px") {
  const [w, h] = IMG[name]!;
  return `<img src="/img/${name}.webp" width="${w}" height="${h}" alt="" sizes="${sizes}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
}

const ext = (t: Content, href: string, inner: string, cls: string) =>
  `<a class="${cls}" href="${href}" rel="noopener noreferrer" target="_blank">${inner}<span class="sr-only"> ${esc(t.a11y.newTab)}</span></a>`;

export function ctaRow(ctx: Ctx, withWeb = true) {
  const { t } = ctx;
  return html`<div class="cta-row">
${ext(t, LINKS.windows, `${brand("windows", 18)}<span>${esc(t.cta.windows)}</span>`, "btn btn-primary")}
${ext(t, LINKS.android, `${brand("googleplay", 18)}<span>${esc(t.cta.android)}</span>`, "btn btn-secondary")}
</div>
${withWeb ? `<div class="hero-sub"><a class="text-link" href="${LINKS.app}">${esc(t.cta.webLong)}${icon("arrow", 16)}</a><span>${esc(t.cta.note)}</span></div>` : ""}`;
}

function crumbs(ctx: Ctx, page: PageId) {
  const c = crumbsFor(ctx, page);
  return html`<nav class="crumbs" aria-label="${esc(ctx.t.a11y.breadcrumb)}"><ol>${c.map((x, i) =>
    i === c.length - 1 ? `<li><span aria-current="page">${esc(x.name)}</span></li>` : `<li><a href="${x.path}">${esc(x.name)}</a></li>`,
  )}</ol></nav>`;
}

/** Short-script locales keep section headings on one line on desktop; longer languages wrap. */
const oneLine = (ctx: Ctx) => (["ko", "ja", "zh-CN", "zh-TW", "en"].includes(ctx.lang) ? " nowrap-pc" : "");

function pageHero(ctx: Ctx, page: PageId, h1: string, lead: string, extra = "") {
  return html`<section class="page-hero"><div class="wrap">
${crumbs(ctx, page)}
<h1>${esc(h1)}</h1>
<p class="lead${page === "pricing" || page === "faq" ? oneLine(ctx) : ""}">${md(lead)}</p>
${extra}
</div></section>`;
}

const ticks = (items: string[]) => `<ul class="ticks">${items.map((i) => `<li>${icon("check", 18)}<span>${md(i)}</span></li>`).join("")}</ul>`;
const list = (items: string[], ok = true) => `<ul class="list${ok ? "" : " no"}">${items.map((i) => `<li>${icon(ok ? "check" : "x", 18)}<span>${md(i)}</span></li>`).join("")}</ul>`;
const cards = (items: { icon: string; h3: string; p: string }[]) =>
  `<div class="grid">${items.map((f) => `<article class="card"><span class="tile">${icon(f.icon, 20)}</span><h3>${esc(f.h3)}</h3><p>${md(f.p)}</p></article>`).join("")}</div>`;

function shareSection(ctx: Ctx, title: string) {
  return `<section class="section-tight"><div class="wrap"><div class="share-wrap">${shareBar(ctx, title)}</div></div></section>`;
}

/* ------------------------------------------------------------------ product mock */
export function editorMock(t: Content): string {
  const m = t.mock;
  const pal: [string, string][] = [
    ["cursor", m.click],
    ["text", m.type],
    ["keyboard", m.key],
    ["clock", m.wait],
    ["branch", m.ifElse],
    ["repeat", m.loop],
    ["image", m.findImage],
    ["bell", m.notify],
  ];
  return html`<div class="mock" role="img" aria-label="${esc(t.a11y.mock)}"><div aria-hidden="true">
<div class="mock-bar">
<div class="mock-file">${mark(20, "mk")}<span>${esc(m.file)}</span></div>
<div class="mock-run"><span class="mock-btn run">${icon("play", 14)}<span>${esc(m.run)}</span></span><span class="mock-btn">${icon("pause", 14)}<span>${esc(m.pause)}</span></span><span class="mock-btn halt">${icon("stop", 14)}<span>${esc(m.halt)}</span></span></div>
<div class="mock-status"><span class="chip ok"><span class="dot"></span>${esc(m.pulse)}</span><span class="chip">${icon("shield", 13)}${esc(m.risk)} · 8</span></div>
</div>
<div class="mock-body">
<div class="mock-palette"><div class="mock-h">${esc(m.palette)}</div><ul>${pal.map(([i, l]) => `<li>${icon(i, 16)}${esc(l)}</li>`)}</ul></div>
<div class="mock-canvas">
<div class="node trigger"><span class="tile">${icon("bolt", 16)}</span><div><b>${esc(m.trigger)}</b></div><span class="kbd"><span>Ctrl</span><span>Alt</span><span>S</span></span></div>
<div class="wire"><span class="plus">${icon("plus", 12)}</span></div>
<div class="group"><div class="group-h">${icon("repeat", 16)}${esc(m.loopTitle)}</div>
<div class="node"><span class="tile">${icon("cursor", 16)}</span><div><b>${esc(m.clickTitle)}</b><small>${esc(m.clickDetail)}</small></div></div>
<span class="pill">${icon("clock", 13)}${esc(m.waitPill)}</span>
</div>
<div class="wire"><span class="plus">${icon("plus", 12)}</span></div>
<div class="node"><span class="tile">${icon("bell", 16)}</span><div><b>${esc(m.notifyTitle)}</b><small>${esc(m.notifyDetail)}</small></div></div>
</div>
<div class="mock-side">
<div class="mock-h">${esc(m.canvas)}</div>
<div class="screen"><span class="target"></span><span class="pointer">${icon("cursor", 22)}</span></div>
<p class="side-note">${esc(m.canvasNote)}</p>
<ul class="log"><li><time>00.000</time><span>trigger · hotkey</span></li><li><time>00.004</time><span>loop 1/100</span></li><li><time>00.006</time><span class="ok">click ✓ 960,540</span></li><li><time>00.256</time><span>wait 250ms ✓</span></li><li><time>00.258</time><span>loop 2/100</span></li></ul>
</div>
</div>
</div></div>`;
}

function easyMini(t: Content) {
  const m = t.mock;
  return html`<div class="mini" aria-hidden="true">
<div class="node trigger"><span class="tile">${icon("bolt", 16)}</span><div><b>${esc(m.trigger)}</b></div><span class="kbd"><span>Ctrl</span><span>Alt</span><span>S</span></span></div>
<div class="group"><div class="group-h">${icon("repeat", 16)}${esc(m.loopTitle)}</div>
<div class="node"><span class="tile">${icon("cursor", 16)}</span><div><b>${esc(m.clickTitle)}</b><small>${esc(m.clickDetail)}</small></div></div>
<span class="pill">${icon("clock", 13)}${esc(m.waitPill)}</span></div>
<div class="node"><span class="tile">${icon("bell", 16)}</span><div><b>${esc(m.notifyTitle)}</b><small>${esc(m.notifyDetail)}</small></div></div>
</div>`;
}

function atlasMini(t: Content) {
  const pick = ["auto-clicker", "scroll-reader", "android-swipe-feed", "countdown-timer"].map((id) => TEMPLATES.find((x) => x.id === id)!);
  return html`<div class="mini" aria-hidden="true">${pick.map((tpl) => {
    const tr = t.templates[tpl.id as keyof Content["templates"]];
    const risk = analyzeRisk(tpl.flow).level;
    return `<div class="mini-tpl"><span class="sw ${swClass(tpl.flow.color ?? "#7C5CFF")}">${icon(tplIcon(tpl), 18)}</span><div><b>${esc(tr.n)}</b><small>${esc(t.labels.categories[tpl.category])}</small></div><span class="chip ok">${esc(t.labels.risk[risk])}</span></div>`;
  })}</div>`;
}

function copilotMini(t: Content) {
  const c = t.copilot;
  return html`<div class="mini" aria-hidden="true">
<div class="bubble">${esc(c.prompt)}</div>
<div class="draft"><div class="draft-h">${icon("spark", 16)}${esc(c.title)}<span class="chip ok">${esc(c.badge)}</span></div>
<ol><li>${esc(c.s1)}</li><li>${esc(c.s2)}</li><li>${esc(c.s3)}</li><li>${esc(c.s4)}</li></ol>
<span class="mock-btn run">${icon("check", 14)}${esc(c.action)}</span></div>
</div>`;
}

/** Swatches need the template colour; inline styles are forbidden by our CSP, so map to classes. */
const swClass = (color: string) => `sw-${color.replace("#", "").toLowerCase()}`;
export function swatchCss(): string {
  const colors = new Set(TEMPLATES.map((x) => x.flow.color ?? "#7C5CFF"));
  return [...colors].map((c) => `.${swClass(c)}{background:${c}}`).join("");
}
function tplIcon(tpl: Template): string {
  const map: Record<string, string> = { cursor: "cursor", target: "cursor", keyboard: "keyboard", pen: "text", table: "ledger", eye: "clock", timer: "clock", scroll: "repeat" };
  const byCat: Record<TemplateCategory, string> = { clicking: "cursor", keyboard: "keyboard", office: "text", accessibility: "tap", testing: "retry", mobile: "phone", developer: "code", wellbeing: "clock" };
  return map[tpl.flow.icon ?? ""] ?? byCat[tpl.category];
}

/* ------------------------------------------------------------------ pages */
function home(ctx: Ctx): PageOut {
  const { t, lang } = ctx;
  const h = t.home;
  const visuals: Record<string, string> = {
    modes: `<div class="frame ui">${easyMini(t)}</div>`,
    canvas: `<div class="frame">${img("practice-canvas")}</div>`,
    keyforge: `<div class="frame">${img("keyforge")}</div>`,
    atlas: `<div class="frame ui">${atlasMini(t)}</div>`,
    android: `<div class="frame square">${img("android-automation")}</div>`,
    copilot: `<div class="frame ui">${copilotMini(t)}</div>`,
    safety: `<div class="frame square">${img("safety-shield")}</div>`,
  };
  const more: Record<string, [string, string]> = {
    modes: [pagePath(lang, "features"), t.cta.learnMore],
    canvas: [LINKS.app, t.labels.tryCanvas],
    keyforge: [pagePath(lang, "keyforge"), t.nav.keyforge],
    atlas: [pagePath(lang, "atlas"), t.nav.atlas],
    android: [pagePath(lang, "android"), t.nav.android],
    copilot: [pagePath(lang, "features"), t.cta.learnMore],
    safety: [pagePath(lang, "safety"), t.nav.safety],
  };
  const uniIcon: Record<string, string> = { flow: "flow", pulse: "pulse", halt: "stop", keyforge: "key", atlas: "map", ledger: "ledger", canvas: "canvas", copilot: "spark", fleet: "devices", guardrails: "shield" };
  const main = html`
<section class="hero">
<div class="hero-art">${img("hero-universe", true, "100vw")}</div>
<div class="wrap">
<a class="eyebrow" href="${LINKS.app}"><b>NEW</b><span>${esc(h.eyebrow)}</span>${icon("arrow", 14)}</a>
<h1 class="display"><span class="line">${esc(h.h1a)}</span> <span class="line grad">${esc(h.h1b)}</span></h1>
<p class="lead">${brk(h.lead)}</p>
${ctaRow(ctx)}
<div class="hero-visual">${editorMock(t)}</div>
</div>
</section>
<section class="wrap" aria-label="AutoFlow"><div class="stats">${h.stats.map((s) => `<div class="stat"><b>${esc(s.v)}</b><span>${esc(s.l)}</span></div>`)}</div></section>
<section class="section"><div class="wrap rows">
${h.rows.map(
  (r) => html`<article class="row" id="${r.id}">
<div class="row-copy"><span class="kicker">${esc(r.kicker)}</span><h2 class="h2">${esc(r.h2)}</h2><p>${md(r.p)}</p>${ticks(r.bullets)}<a class="text-link" href="${more[r.id]![0]}">${esc(more[r.id]![1])}${icon("arrow", 16)}</a></div>
<div class="row-visual">${visuals[r.id]}</div>
</article>`,
)}
</div></section>
<section class="section" id="universe"><div class="wrap">
<div class="section-head"><span class="kicker">${esc(h.universe.kicker)}</span><h2 class="h2${oneLine(ctx)}">${brk(h.universe.h2)}</h2><p class="lead${oneLine(ctx)}">${brk(h.universe.lead)}</p></div>
<div class="uni">${Object.entries(h.universe.items).map(
    ([k, v]) => `<div class="uni-card"><span class="tile${k === "halt" ? " halt" : ""}">${icon(uniIcon[k]!, 20)}</span><h3>${esc(v.name)}</h3><p>${esc(v.desc)}</p></div>`,
  )}</div>
</div></section>
<section class="section-tight"><div class="wrap">
<div class="section-head"><span class="kicker">${esc(h.platforms.kicker)}</span><h2 class="h2">${esc(h.platforms.h2)}</h2></div>
<div class="grid-3">
<article class="card"><span class="tile">${brand("windows", 18)}</span><h3>${esc(t.labels.platforms.windows)}</h3><p>${esc(h.platforms.windows)}</p><a class="text-link" href="${pagePath(lang, "windows")}">${esc(t.cta.learnMore)}${icon("arrow", 16)}</a></article>
<article class="card"><span class="tile">${brand("android", 18)}</span><h3>${esc(t.labels.platforms.android)}</h3><p>${esc(h.platforms.android)}</p><a class="text-link" href="${pagePath(lang, "android")}">${esc(t.cta.learnMore)}${icon("arrow", 16)}</a></article>
<article class="card"><span class="tile">${icon("browser", 20)}</span><h3>${esc(t.labels.platforms.web)}</h3><p>${esc(h.platforms.web)}</p><a class="text-link" href="${LINKS.app}">${esc(t.cta.openApp)}${icon("arrow", 16)}</a></article>
</div>
</div></section>
<section class="section"><div class="wrap"><div class="never">
<div><span class="kicker">${esc(h.never.kicker)}</span><h2 class="h2">${esc(h.never.h2)}</h2><a class="text-link" href="${pagePath(lang, "safety")}">${esc(h.never.link)}${icon("arrow", 16)}</a></div>
<ul>${h.never.items.map((i) => `<li>${icon("x", 18)}<span>${esc(i)}</span></li>`)}</ul>
</div></div></section>
<section class="section-tight"><div class="wrap"><div class="final">
<h2 class="h2">${esc(h.final.h2)}</h2><p class="lead">${esc(h.final.lead)}</p>
${ctaRow(ctx)}
</div></div></section>
${shareSection(ctx, h.seo.title)}`;
  return { title: h.seo.title, description: h.seo.description, og: { kicker: "", headline: `${h.h1a} ${h.h1b}`, sub: t.cta.note }, main };
}

function features(ctx: Ctx): PageOut {
  const { t } = ctx;
  const f = t.features;
  const main = html`${pageHero(ctx, "features", f.h1, f.lead, ctaRow(ctx))}
<section class="section-tight"><div class="wrap groups">
${f.groups.map((g) => `<div><h2 class="group-title">${esc(g.h2)}</h2>${cards(g.items)}</div>`)}
</div></section>
${shareSection(ctx, f.seo.title)}`;
  return { title: f.seo.title, description: f.seo.description, og: { kicker: t.nav.features, headline: f.h1, sub: f.lead }, main };
}

function windows(ctx: Ctx): PageOut {
  const { t } = ctx;
  const w = t.windows;
  const main = html`${pageHero(ctx, "windows", w.h1, w.lead, `<div class="cta-row">${ext(t, LINKS.windows, `${brand("windows", 18)}<span>${esc(t.cta.windows)}</span>`, "btn btn-primary")}<a class="btn btn-secondary" href="${LINKS.app}">${icon("browser", 18)}<span>${esc(t.cta.web)}</span></a></div>`)}
<section class="section-tight"><div class="wrap">
<div class="hero-visual">${editorMock(t)}</div>
${cards(w.items)}
<div class="grid-2 mt-l">
<div class="card"><h2 class="h2">${esc(w.req.h2)}</h2>${list(w.req.items)}</div>
<div class="card"><div class="note">${icon("shield", 18)}<span>${md(w.note)}</span></div><a class="text-link" href="${LINKS.releases}" rel="noopener noreferrer" target="_blank">${esc(t.footer.releases)}${icon("external", 16)}<span class="sr-only"> ${esc(t.a11y.newTab)}</span></a></div>
</div>
</div></section>
${shareSection(ctx, w.seo.title)}`;
  return { title: w.seo.title, description: w.seo.description, og: { kicker: t.labels.platforms.windows, headline: w.h1, sub: w.lead }, main };
}

function android(ctx: Ctx): PageOut {
  const { t } = ctx;
  const a = t.android;
  const main = html`${pageHero(ctx, "android", a.h1, a.lead, `<div class="cta-row">${ext(t, LINKS.android, `${brand("googleplay", 18)}<span>${esc(t.cta.android)}</span>`, "btn btn-primary")}<a class="btn btn-secondary" href="${LINKS.app}">${icon("browser", 18)}<span>${esc(t.cta.web)}</span></a></div>`)}
<section class="section-tight"><div class="wrap">
<div class="split"><div>${cards(a.items)}</div><div class="frame square">${img("android-automation")}</div></div>
<div class="card mt-l card-glow" id="accessibility"><span class="tile">${icon("shield", 20)}</span><h2 class="h2">${esc(a.access.h2)}</h2><p>${md(a.access.p)}</p>
<div class="grid-2 mt-l"><div><h3>${esc(a.access.does)}</h3>${list(a.access.doesItems)}</div><div><h3>${esc(a.access.never)}</h3>${list(a.access.neverItems, false)}</div></div></div>
</div></section>
${shareSection(ctx, a.seo.title)}`;
  return { title: a.seo.title, description: a.seo.description, og: { kicker: t.labels.platforms.android, headline: a.h1, sub: a.lead }, main };
}

function keyforge(ctx: Ctx): PageOut {
  const { t } = ctx;
  const k = t.keyforge;
  const main = html`${pageHero(ctx, "keyforge", k.h1, k.lead, ctaRow(ctx, false))}
<section class="section-tight"><div class="wrap">
<div class="frame">${img("keyforge", false, "(max-width: 1260px) 100vw, 1200px")}</div>
<div class="mt-l">${cards(k.items)}</div>
</div></section>
${shareSection(ctx, k.seo.title)}`;
  return { title: k.seo.title, description: k.seo.description, og: { kicker: "Keyforge", headline: k.h1, sub: k.lead }, main };
}

function atlas(ctx: Ctx): PageOut {
  const { t } = ctx;
  const a = t.atlas;
  const cats = [...new Set(TEMPLATES.map((x) => x.category))];
  const card = (tpl: Template) => {
    const tr = t.templates[tpl.id as keyof Content["templates"]];
    const risk = analyzeRisk(tpl.flow).level;
    return html`<article class="card tpl" id="tpl-${tpl.id}">
<div class="tpl-head"><span class="sw ${swClass(tpl.flow.color ?? "#7C5CFF")}">${icon(tplIcon(tpl), 20)}</span><h3>${esc(tr.n)}</h3></div>
<p>${esc(tr.d)}</p>
<div class="badges">${tpl.platforms.map((p) => `<span class="badge">${p === "windows" ? brand("windows", 11) : p === "android" ? brand("android", 12) : icon("browser", 12)}${esc(t.labels.platforms[p])}</span>`)}<span class="badge">${esc(t.labels.difficulty[tpl.difficulty])}</span><span class="badge ${risk}">${icon("shield", 12)}${esc(t.labels.risk[risk])}</span></div>
<a class="text-link" href="${LINKS.atlas(tpl.id)}">${esc(t.labels.openInApp)}${icon("arrow", 16)}</a>
</article>`;
  };
  const nav = `<nav class="cat-nav" aria-label="${esc(t.nav.atlas)}">${cats.map((c) => `<a href="#${c}">${esc(t.labels.categories[c])}<span>${TEMPLATES.filter((x) => x.category === c).length}</span></a>`).join("")}</nav>`;
  const main = html`${pageHero(ctx, "atlas", a.h1, a.lead, `<p class="muted mt-l">${TEMPLATES.length} ${esc(a.count)} · ${esc(a.verified)} 2026-10-19</p>${nav}`)}
<section class="section-tight"><div class="wrap groups">
${cats.map((c) => `<div class="cat" id="${c}"><h2 class="group-title">${esc(t.labels.categories[c])}</h2><div class="grid">${TEMPLATES.filter((x) => x.category === c).map(card).join("")}</div></div>`)}
<div class="note">${icon("shield", 18)}<span>${md(a.community)}</span></div>
</div></section>
${shareSection(ctx, a.seo.title)}`;
  return { title: a.seo.title, description: a.seo.description, og: { kicker: "Atlas", headline: a.h1, sub: a.lead }, main };
}

function safety(ctx: Ctx): PageOut {
  const { t } = ctx;
  const s = t.safety;
  const ic: Record<string, string> = { guardrails: "shield", score: "gauge", halt: "stop", privacy: "cloud" };
  const main = html`${pageHero(ctx, "safety", s.h1, s.lead)}
<section class="section-tight"><div class="wrap">
<div class="grid-2">${s.sections.map(
    (x) => `<article class="card" id="${x.id}"><span class="tile${x.id === "halt" ? " halt" : ""}">${icon(ic[x.id] ?? "shield", 20)}</span><h2 class="h2">${esc(x.h2)}</h2><p>${md(x.p)}</p>${x.items.length ? list(x.items) : ""}</article>`,
  )}</div>
<div class="split mt-l"><div class="frame square">${img("safety-shield")}</div>
<div><h2 class="h2">${esc(s.neverH2)}</h2>${list(s.never, false)}<div class="note mt-l">${icon("alert", 18)}<span>${md(s.responsible)}</span></div></div></div>
</div></section>`;
  return { title: s.seo.title, description: s.seo.description, og: { kicker: t.nav.safety, headline: s.h1, sub: s.lead }, main };
}

function download(ctx: Ctx): PageOut {
  const { t } = ctx;
  const d = t.download;
  const main = html`${pageHero(ctx, "download", d.h1, d.lead)}
<section class="section-tight"><div class="wrap">
<div class="grid-3">
<article class="card feature card-glow"><span class="tile">${brand("windows", 18)}</span><h2 class="h2">${esc(d.windows.h2)}</h2><p>${esc(d.windows.p)}</p><p class="muted">${esc(d.windows.meta)}</p><div class="cta-row">${ext(t, LINKS.windows, `${icon("download", 18)}<span>${esc(t.cta.windows)}</span>`, "btn btn-primary")}</div></article>
<article class="card feature"><span class="tile">${brand("android", 18)}</span><h2 class="h2">${esc(d.android.h2)}</h2><p>${esc(d.android.p)}</p><p class="muted">${esc(d.android.meta)}</p><div class="cta-row">${ext(t, LINKS.android, `${brand("googleplay", 18)}<span>${esc(t.cta.android)}</span>`, "btn btn-secondary")}</div></article>
<article class="card feature"><span class="tile">${icon("browser", 20)}</span><h2 class="h2">${esc(d.web.h2)}</h2><p>${esc(d.web.p)}</p><p class="muted">${esc(d.web.meta)}</p><div class="cta-row"><a class="btn btn-secondary" href="${LINKS.app}">${icon("arrow", 18)}<span>${esc(t.cta.web)}</span></a></div></article>
</div>
<div class="note mt-l">${icon("shield", 18)}<span>${md(d.verify)} <a href="${LINKS.releases}" rel="noopener noreferrer" target="_blank">${esc(d.releases)}<span class="sr-only"> ${esc(t.a11y.newTab)}</span></a></span></div>
</div></section>
${shareSection(ctx, d.seo.title)}`;
  return { title: d.seo.title, description: d.seo.description, og: { kicker: t.nav.download, headline: d.h1, sub: d.lead }, main };
}

function pricing(ctx: Ctx): PageOut {
  const { t } = ctx;
  const p = t.pricing;
  const main = html`${pageHero(ctx, "pricing", p.h1, p.lead)}
<section class="section-tight"><div class="wrap">
<div class="plans">
<article class="card plan card-glow"><h2>${esc(p.free.name)}</h2><div class="price"><b>${esc(p.free.price)}</b><span>${esc(p.free.period)}</span></div><p>${esc(p.free.desc)}</p>${list(p.free.items)}${ctaRow(ctx)}</article>
<article class="card plan"><h2>${esc(p.sync.name)}</h2><div class="price"><b>${esc(p.sync.price)}</b><span>${esc(p.sync.period)}</span></div><p>${esc(p.sync.desc)}</p>${list(p.sync.items)}<div class="note">${icon("alert", 18)}<span>${md(p.sync.note)}</span></div></article>
</div>
<h2 class="h2 mt-l">${esc(p.promises.h2)}</h2>
<div class="grid mt-l">${p.promises.items.map((x) => `<article class="card"><span class="tile">${icon("check", 20)}</span><h3>${esc(x.h3)}</h3><p>${esc(x.p)}</p></article>`)}</div>
</div></section>`;
  return { title: p.seo.title, description: p.seo.description, og: { kicker: t.nav.pricing, headline: p.h1, sub: p.lead }, main };
}

function faq(ctx: Ctx): PageOut {
  const { t } = ctx;
  const f = t.faq;
  const main = html`${pageHero(ctx, "faq", f.h1, f.lead)}
<section class="section-tight"><div class="wrap"><div class="faq">
${f.items.map((x, i) => `<details${i === 0 ? " open" : ""}><summary>${esc(x.q)}${icon("chevron", 18)}</summary><div class="answer"><p>${md(x.a)}</p></div></details>`)}
</div></div></section>`;
  return { title: f.seo.title, description: f.seo.description, og: { kicker: "FAQ", headline: f.h1, sub: f.lead.replace("{email}", LINKS.email) }, main };
}

function block(b: string | string[]) {
  return Array.isArray(b) ? `<ul>${b.map((li) => `<li>${md(li)}</li>`).join("")}</ul>` : `<p>${md(b)}</p>`;
}
function legal(ctx: Ctx, page: "privacy" | "terms"): PageOut {
  const { t, lang } = ctx;
  const doc = t[page];
  const secs = Object.entries(doc.sections) as [string, Section][];
  const other: PageId = page === "privacy" ? "terms" : "privacy";
  const main = html`<section class="page-hero"><div class="wrap">${crumbs(ctx, page)}<h1>${esc(doc.h1)}</h1></div></section>
<div class="wrap legal">
<nav class="toc" aria-labelledby="toc-h"><h2 id="toc-h">${esc(t.legalUi.contents)}</h2><ol>${secs.map(([k, s]) => `<li><a href="#${k}">${esc(s.h)}</a></li>`)}</ol></nav>
<article class="prose">
<p class="meta">${esc(t.legalUi.effective)} · ${esc(t.legalUi.updated)}</p>
<p class="intro">${md(doc.intro)}</p>
${secs.map(([k, s]) => `<section id="${k}" aria-labelledby="${k}-h"><h2 id="${k}-h">${esc(s.h)}</h2>${s.b.map(block).join("")}</section>`)}
<div class="legal-foot"><span class="muted">${esc(t.legalUi.other)}:</span><a href="${pagePath(lang, other)}">${esc(t.nav[other])}</a><a href="mailto:${LINKS.email}">${LINKS.email}</a></div>
</article>
</div>`;
  return { title: doc.seo.title, description: doc.seo.description, og: { kicker: t.footer.legal, headline: doc.h1, sub: t.legalUi.effective }, main };
}

export function notFound(ctx: Ctx): PageOut {
  const { t } = ctx;
  const n = t.notFound;
  const main = html`<section class="hero"><div class="wrap">
<h1 class="display"><span class="grad">404</span></h1>
<h2 class="h2">${esc(n.h1)}</h2><p class="lead">${esc(n.lead)}</p>
<div class="cta-row"><a class="btn btn-primary" href="/">${icon("arrow", 18)}<span>${esc(n.back)}</span></a><a class="btn btn-secondary" href="${LINKS.app}">${icon("browser", 18)}<span>${esc(t.cta.openApp)}</span></a></div>
<div class="hero-visual"></div>
</div></section>`;
  return { title: n.seo.title, description: n.seo.description, og: { kicker: "", headline: n.h1, sub: n.lead }, main };
}

export const RENDER: Record<PageId, (ctx: Ctx) => PageOut> = {
  home,
  features,
  windows,
  android,
  keyforge,
  atlas,
  safety,
  download,
  pricing,
  faq,
  privacy: (c) => legal(c, "privacy"),
  terms: (c) => legal(c, "terms"),
};
