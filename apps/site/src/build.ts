/**
 * AutoFlow static site generator. No framework: typed content → HTML strings → dist/.
 *
 *   SITE_URL=https://autoflowmacro.com API_ORIGIN=https://… pnpm --filter @autoflow/site build
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LOCALES, matchLocale, type LocaleCode } from "@autoflow/core";
import { CONTENT } from "../content/index.js";
import { buildCloudflare, buildFonts, buildIcons, buildManifest, buildRobots, buildSitemap, copyPublic } from "./assets.js";
import { API_ORIGIN, DIST, LASTMOD, PAGES, REPO, ROOT, SITE_URL, SKIP_OG, abs, pagePath, type PageId } from "./config.js";
import { altHref, document, type Assets, type Ctx } from "./layout.js";
import { renderOgImages, type OgJob } from "./og.js";
import { RENDER, notFound, swatchCss } from "./pages.js";
import { SEO_ROUTES, renderSeo, seoPath } from "./seo-pages.js";
import { baseGraph, crumbsFor } from "./seo.js";
import { cspHash, hash, minifyCss, tidy } from "./util.js";

const started = Date.now();
const ROOT_TITLE = "AutoFlow — Automate anything you repeat, safely";

// Keep previously rendered OG images when SKIP_OG=1.
const ogBackup = SKIP_OG && existsSync(join(DIST, "og")) ? join(ROOT, ".og-cache") : null;
if (ogBackup) {
  await rm(ogBackup, { recursive: true, force: true });
  const { rename } = await import("node:fs/promises");
  await rename(join(DIST, "og"), ogBackup);
}
await rm(DIST, { recursive: true, force: true });
await mkdir(join(DIST, "assets"), { recursive: true });

/* ---------------------------------------------------------------- assets */
const fonts = await buildFonts();
const tokens = await readFile(join(REPO, "packages", "brand", "tokens.css"), "utf8");
const pageCss = await readFile(join(ROOT, "src", "styles.css"), "utf8");
const css = minifyCss(fonts.css + tokens + pageCss + swatchCss());

const themeScript = `(function(){try{var t=localStorage.getItem("af-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})();`;

const suggest = Object.fromEntries(LOCALES.map((l) => [l.code, { h: l.hreflang, t: CONTENT[l.code].suggest.text, g: CONTENT[l.code].suggest.go, s: CONTENT[l.code].suggest.stay }]));
const clientSrc = (await readFile(join(ROOT, "src", "client.js"), "utf8"))
  .replace("__LOCALES__", JSON.stringify(LOCALES.map((l) => ({ code: l.code }))))
  .replace("__SUGGEST__", JSON.stringify(suggest))
  .replace("__MATCH__", matchLocale.toString());
const jsName = `/assets/site.${hash(clientSrc)}.js`;
await writeFile(join(DIST, jsName), clientSrc);

const assets: Assets = { css, js: jsName, font: fonts.preload, themeScript };

/* ---------------------------------------------------------------- pages */
const ogJobs: OgJob[] = [];
const sitemap: { loc: string; alternates: { hreflang: string; href: string }[] }[] = [];
let count = 0;

async function emit(path: string, htmlText: string) {
  const file = path.endsWith("/") ? join(DIST, path, "index.html") : join(DIST, path);
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, htmlText);
  count++;
}

function alternatesFor(page: PageId) {
  return [
    ...LOCALES.map((l) => ({ hreflang: l.hreflang, href: altHref(l.code, page) })),
    { hreflang: "x-default", href: page === "home" ? `${SITE_URL}/` : altHref("en", page) },
  ];
}

for (const loc of LOCALES) {
  const lang = loc.code as LocaleCode;
  const t = CONTENT[lang];
  for (const page of PAGES) {
    const ctx: Ctx = { lang, t, page, path: pagePath(lang, page) };
    const out = RENDER[page](ctx);
    const graph = baseGraph(ctx, out.title, out.description, crumbsFor(ctx, page));
    const meta = { title: out.title, description: out.description, ogImage: `/og/${lang}/${page}.png`, ogAlt: out.og.headline, jsonld: [graph], alternates: true };
    await emit(ctx.path, tidy(document(ctx, meta, out.main, assets)));
    sitemap.push({ loc: abs(ctx.path), alternates: alternatesFor(page) });
    ogJobs.push({ lang, page, ...out.og });

    // The site root is the English home page, served as the x-default entry point.
    if (lang === "en" && page === "home") {
      const rootCtx: Ctx = { ...ctx, path: "/", isRoot: true };
      const rootGraph = baseGraph(rootCtx, ROOT_TITLE, out.description, crumbsFor(rootCtx, page));
      await emit("/", tidy(document(rootCtx, { ...meta, title: ROOT_TITLE, jsonld: [rootGraph] }, out.main, assets)));
      sitemap.push({ loc: `${SITE_URL}/`, alternates: alternatesFor("home") });
    }
  }
}

/* ---------------------------------------------------------------- guides & alternatives */
for (const loc of LOCALES) {
  const lang = loc.code as LocaleCode;
  for (const [kind, slug] of SEO_ROUTES) {
    const alt = (l: LocaleCode) => seoPath(l, kind, slug);
    const ctx: Ctx = { lang, t: CONTENT[lang], page: "features", path: alt(lang), alt };
    const out = renderSeo(ctx, kind, slug);
    const graph = baseGraph(ctx, out.title, out.description, out.crumbs, [], out.faq);
    const meta = { title: out.title, description: out.description, ogImage: `/og/${lang}/features.png`, ogAlt: out.og.headline, jsonld: [graph], alternates: true };
    await emit(ctx.path, tidy(document(ctx, meta, out.main, assets)));
    sitemap.push({
      loc: abs(ctx.path),
      alternates: [...LOCALES.map((l) => ({ hreflang: l.hreflang, href: abs(alt(l.code)) })), { hreflang: "x-default", href: abs(alt("en")) }],
    });
  }
}

{
  const t = CONTENT.en;
  const ctx: Ctx = { lang: "en", t, page: "404", path: "/404.html" };
  const out = notFound(ctx);
  const graph = baseGraph(ctx, out.title, out.description, []);
  await emit("/404.html", tidy(document(ctx, { title: out.title, description: out.description, ogImage: "/og/en/home.png", ogAlt: t.home.h1a, jsonld: [graph], noindex: true, alternates: false }, out.main, assets)));
}

/* ---------------------------------------------------------------- static files */
await Promise.all([buildIcons(), buildManifest(), copyPublic(), buildRobots(SITE_URL), buildSitemap(sitemap, LASTMOD)]);
await buildCloudflare({ scriptHashes: [cspHash(themeScript)], styleHashes: [cspHash(css)], apiOrigin: API_ORIGIN });

if (ogBackup) {
  const { rename } = await import("node:fs/promises");
  await rename(ogBackup, join(DIST, "og"));
  console.log("og: reused cached images (SKIP_OG=1)");
} else {
  const t0 = Date.now();
  await renderOgImages(ogJobs);
  console.log(`og: rendered ${ogJobs.length} images in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

console.log(`site: ${count} HTML pages for ${LOCALES.length} locales → ${DIST} (${((Date.now() - started) / 1000).toFixed(1)}s, SITE_URL=${SITE_URL})`);
