/**
 * Programmatic SEO pages: task guides and "alternative to X" pages, plus a hub for each.
 * Every slug exists in every locale so hreflang alternates always resolve.
 */
import type { LocaleCode } from "@autoflow/core";
import { SEO } from "../content/seo/index.js";
import { ALTS, TASKS, type AltSlug, type Qa, type TaskSlug } from "../content/seo/types.js";
import { pagePath } from "./config.js";
import { icon } from "./icons.js";
import type { Ctx } from "./layout.js";
import { ctaRow, type PageOut } from "./pages.js";
import { esc, html, md } from "./util.js";

export type SeoKind = "guides" | "alternatives";

export const seoPath = (lang: LocaleCode, kind: SeoKind, slug?: string) => `/${lang}/${kind}/${slug ? `${slug}/` : ""}`;

export interface SeoOut extends PageOut {
  crumbs: { name: string; path: string }[];
  faq: Qa[];
}

const ALT_BY_SLUG = Object.fromEntries(ALTS.map((a) => [a.slug, a])) as Record<AltSlug, (typeof ALTS)[number]>;
const fill = (s: string, name: string) => s.replaceAll("{name}", name);

/** Deterministic neighbours so each page links to a stable, varied set of siblings. */
function neighbours<T>(all: readonly T[], i: number, n: number): T[] {
  const out: T[] = [];
  for (let k = 1; out.length < n && k < all.length; k++) out.push(all[(i + k * 5) % all.length]!);
  return [...new Set(out)];
}

function crumbNav(ctx: Ctx, crumbs: { name: string; path: string }[]) {
  return html`<nav class="crumbs" aria-label="${esc(ctx.t.a11y.breadcrumb)}"><ol>${crumbs.map((x, i) =>
    i === crumbs.length - 1 ? `<li><span aria-current="page">${esc(x.name)}</span></li>` : `<li><a href="${x.path}">${esc(x.name)}</a></li>`,
  )}</ol></nav>`;
}

function hero(ctx: Ctx, crumbs: { name: string; path: string }[], h1: string, lead: string, extra = "") {
  return html`<section class="page-hero"><div class="wrap">
${crumbNav(ctx, crumbs)}
<h1>${esc(h1)}</h1>
<p class="lead">${md(lead)}</p>
${extra}
</div></section>`;
}

const faqBlock = (h: string, items: Qa[]) =>
  html`<section class="section-tight"><div class="wrap"><h2 class="h2">${esc(h)}</h2><div class="faq mt-m">
${items.map((x, i) => `<details${i === 0 ? " open" : ""}><summary>${esc(x.q)}${icon("chevron", 18)}</summary><div class="answer"><p>${md(x.a)}</p></div></details>`)}
</div></div></section>`;

const steps = (items: string[]) => `<ol class="seo-steps">${items.map((s) => `<li><span>${md(s)}</span></li>`).join("")}</ol>`;
const ticks = (items: string[]) => `<ul class="ticks">${items.map((i) => `<li>${icon("check", 18)}<span>${md(i)}</span></li>`).join("")}</ul>`;

function linkCards(items: { href: string; h3: string; p: string; more: string }[]) {
  return `<div class="grid seo-links">${items
    .map((x) => `<a class="card seo-card" href="${x.href}"><h3>${esc(x.h3)}</h3><p>${esc(x.p)}</p><span class="text-link">${esc(x.more)}${icon("arrow", 16)}</span></a>`)
    .join("")}</div>`;
}

function cta(ctx: Ctx) {
  const ui = SEO[ctx.lang].ui;
  return html`<section class="section-tight"><div class="wrap"><div class="final">
<h2 class="h2">${esc(ui.ctaH)}</h2><p class="lead">${esc(ui.ctaP)}</p>
${ctaRow(ctx)}
</div></div></section>`;
}

const homeCrumb = (ctx: Ctx) => ({ name: ctx.t.nav.home, path: pagePath(ctx.lang, "home") });

function taskCards(ctx: Ctx, slugs: readonly TaskSlug[]) {
  const s = SEO[ctx.lang];
  return linkCards(slugs.map((slug) => ({ href: seoPath(ctx.lang, "guides", slug), h3: s.tasks[slug].kw, p: s.tasks[slug].description, more: s.ui.readGuide })));
}
function altCards(ctx: Ctx, slugs: readonly AltSlug[]) {
  const s = SEO[ctx.lang];
  return linkCards(slugs.map((slug) => ({ href: seoPath(ctx.lang, "alternatives", slug), h3: ALT_BY_SLUG[slug].name, p: s.alts[slug].description, more: s.ui.seeAlternative })));
}

export function guidePage(ctx: Ctx, slug: TaskSlug): SeoOut {
  const s = SEO[ctx.lang];
  const c = s.tasks[slug];
  const crumbs = [homeCrumb(ctx), { name: s.ui.guides.nav, path: seoPath(ctx.lang, "guides") }, { name: c.kw, path: seoPath(ctx.lang, "guides", slug) }];
  const i = TASKS.indexOf(slug);
  const faq = [...c.faq, { q: s.ui.freeQ, a: s.ui.freeA }];
  const main = html`${hero(ctx, crumbs, c.h1, c.intro, ctaRow(ctx))}
<section class="section-tight"><div class="wrap"><div class="grid-2">
<div class="card"><h2 class="h2">${esc(s.ui.howTo)}</h2>${steps(c.steps)}</div>
<div class="card"><h2 class="h2">${esc(s.ui.tips)}</h2>${ticks(c.tips)}</div>
</div></div></section>
${faqBlock(s.ui.faq, faq)}
<section class="section-tight"><div class="wrap"><h2 class="h2">${esc(s.ui.related)}</h2>${taskCards(ctx, neighbours(TASKS, i, 6))}</div></section>
<section class="section-tight"><div class="wrap"><h2 class="h2">${esc(s.ui.relatedAlts)}</h2>${altCards(ctx, neighbours(ALTS.map((a) => a.slug), i % ALTS.length, 3))}</div></section>
${cta(ctx)}`;
  return { title: c.title, description: c.description, og: { kicker: s.ui.guides.nav, headline: c.h1, sub: c.description }, main, crumbs, faq };
}

export function altPage(ctx: Ctx, slug: AltSlug): SeoOut {
  const s = SEO[ctx.lang];
  const c = s.alts[slug];
  const meta = ALT_BY_SLUG[slug];
  const crumbs = [homeCrumb(ctx), { name: s.ui.alternatives.nav, path: seoPath(ctx.lang, "alternatives") }, { name: meta.name, path: seoPath(ctx.lang, "alternatives", slug) }];
  const i = ALTS.findIndex((a) => a.slug === slug);
  const faq = [...c.faq, { q: fill(s.ui.affiliatedQ, meta.name), a: fill(s.ui.affiliatedA, meta.name) }];
  const platforms = `<p class="seo-meta"><span>${esc(s.ui.platformsLabel)}:</span> ${meta.platforms.map((p) => `<span class="chip">${esc(s.ui.platformNames[p])}</span>`).join(" ")}</p>`;
  const main = html`${hero(ctx, crumbs, c.h1, c.intro, platforms + ctaRow(ctx))}
<section class="section-tight"><div class="wrap"><div class="grid-2">
<div class="card"><h2 class="h2">${esc(s.ui.whyAutoflow)}</h2>${ticks(c.points)}</div>
<div class="card"><h2 class="h2">${esc(s.ui.glanceH)}</h2><dl class="seo-glance">${s.ui.glance.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl></div>
</div>
<div class="card mt-l"><h2 class="h2">${esc(s.ui.switchH)}</h2>${steps(s.ui.switchSteps)}</div>
</div></section>
${faqBlock(s.ui.faq, faq)}
<section class="section-tight"><div class="wrap"><p class="small muted seo-disclaimer">${esc(fill(s.ui.disclaimer, meta.name))}</p></div></section>
<section class="section-tight"><div class="wrap"><h2 class="h2">${esc(s.ui.relatedAlts)}</h2>${altCards(ctx, neighbours(ALTS.map((a) => a.slug), i, 6))}</div></section>
<section class="section-tight"><div class="wrap"><h2 class="h2">${esc(s.ui.related)}</h2>${taskCards(ctx, neighbours(TASKS, i, 3))}</div></section>
${cta(ctx)}`;
  return { title: c.title, description: c.description, og: { kicker: s.ui.alternatives.nav, headline: c.h1, sub: c.description }, main, crumbs, faq };
}

export function hubPage(ctx: Ctx, kind: SeoKind): SeoOut {
  const s = SEO[ctx.lang];
  const h = s.ui[kind];
  const crumbs = [homeCrumb(ctx), { name: h.nav, path: seoPath(ctx.lang, kind) }];
  const other: SeoKind = kind === "guides" ? "alternatives" : "guides";
  const main = html`${hero(ctx, crumbs, h.h1, h.lead)}
<section class="section-tight"><div class="wrap">${kind === "guides" ? taskCards(ctx, TASKS) : altCards(ctx, ALTS.map((a) => a.slug))}</div></section>
<section class="section-tight"><div class="wrap"><a class="text-link" href="${seoPath(ctx.lang, other)}">${esc(s.ui[other].h1)}${icon("arrow", 16)}</a></div></section>
${cta(ctx)}`;
  return { title: h.title, description: h.description, og: { kicker: "AutoFlow", headline: h.h1, sub: h.lead }, main, crumbs, faq: [] };
}

/** Every SEO page for one locale: [kind, slug | undefined]. */
export const SEO_ROUTES: [SeoKind, string | undefined][] = [
  ["guides", undefined],
  ...TASKS.map((t): [SeoKind, string] => ["guides", t]),
  ["alternatives", undefined],
  ...ALTS.map((a): [SeoKind, string] => ["alternatives", a.slug]),
];

export function renderSeo(ctx: Ctx, kind: SeoKind, slug: string | undefined): SeoOut {
  if (!slug) return hubPage(ctx, kind);
  return kind === "guides" ? guidePage(ctx, slug as TaskSlug) : altPage(ctx, slug as AltSlug);
}
