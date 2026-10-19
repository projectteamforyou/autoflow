/**
 * Post-build SEO / integrity gate. Parses every generated HTML file in dist/ and fails (exit 1) on:
 * missing/duplicate titles, over-long titles (>60) or descriptions (>155, counted per character so
 * CJK is counted fairly), missing canonical, incomplete or non-reciprocal hreflang sets (12 + x-default),
 * missing Open Graph images (and wrong dimensions), invalid JSON-LD, missing lang attributes, broken
 * internal links or fragments, sitemap/page count mismatches and a robots.txt without a Sitemap line.
 *
 *   pnpm --filter @autoflow/site verify
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { LOCALES } from "@autoflow/core";
import { DIST } from "../src/config.js";
import { charLen } from "../src/util.js";

const errors: string[] = [];
const warn: string[] = [];
const fail = (file: string, msg: string) => errors.push(`${file}: ${msg}`);

if (!existsSync(DIST)) {
  console.error(`dist not found at ${DIST} — run the build first`);
  process.exit(1);
}

/* ---------------------------------------------------------------- collect */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "app" && dir === DIST ? [] : walk(p);
    return p.endsWith(".html") ? [p] : [];
  });
}
const files = walk(DIST);
const urlPath = (file: string) => {
  const rel = "/" + relative(DIST, file).split(sep).join("/");
  return rel.endsWith("/index.html") ? rel.slice(0, -"index.html".length) : rel;
};

const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`, "i").exec(tag);
  return m ? decode(m[1]!) : undefined;
};
const metas = (html: string, key: "name" | "property", value: string) =>
  [...html.matchAll(/<meta\s[^>]*>/gi)].map((m) => m[0]).filter((t) => attr(t, key) === value).map((t) => attr(t, "content") ?? "");

/** Resolve a site path (with or without origin) to a file in dist, or null when it should exist but doesn't. */
function resolveFile(p: string): string | null {
  const clean = p.split("#")[0]!.split("?")[0]!;
  let f = join(DIST, decodeURIComponent(clean));
  if (clean.endsWith("/")) f = join(f, "index.html");
  if (existsSync(f) && statSync(f).isFile()) return f;
  if (existsSync(join(f, "index.html"))) return join(f, "index.html");
  return null;
}

/* ---------------------------------------------------------------- site origin */
const rootHtml = readFileSync(join(DIST, "index.html"), "utf8");
const rootCanonical = /<link rel="canonical" href="([^"]+)"/.exec(rootHtml)?.[1];
if (!rootCanonical) {
  console.error("dist/index.html has no canonical");
  process.exit(1);
}
const ORIGIN = new URL(rootCanonical).origin;
const toPath = (u: string) => (u.startsWith(ORIGIN) ? u.slice(ORIGIN.length) || "/" : null);

/* ---------------------------------------------------------------- per page */
interface Page {
  file: string;
  path: string;
  title: string;
  noindex: boolean;
  alternates: Map<string, string>;
}
const pages: Page[] = [];
const titles = new Map<string, string>();
const EXPECTED_HREFLANG = new Set([...LOCALES.map((l) => l.hreflang), "x-default"]);
const LANGS = new Set<string>(LOCALES.map((l) => l.code));

function pngSize(file: string) {
  const b = readFileSync(file);
  if (b.toString("ascii", 1, 4) !== "PNG") return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

for (const file of files) {
  const rel = relative(DIST, file);
  const html = readFileSync(file, "utf8");
  const path = urlPath(file);

  const lang = /<html\s[^>]*lang="([^"]+)"/i.exec(html)?.[1];
  if (!lang) fail(rel, "missing <html lang>");
  else if (!LANGS.has(lang)) fail(rel, `unexpected lang "${lang}"`);

  const titleMatches = [...html.matchAll(/<title>([^<]*)<\/title>/g)];
  const title = decode(titleMatches[0]?.[1] ?? "").trim();
  if (titleMatches.length !== 1) fail(rel, `expected exactly one <title>, found ${titleMatches.length}`);
  if (!title) fail(rel, "empty title");
  if (charLen(title) > 60) fail(rel, `title is ${charLen(title)} chars (>60): "${title}"`);
  if (titles.has(title)) fail(rel, `duplicate title (also ${titles.get(title)}): "${title}"`);
  titles.set(title, rel);

  const desc = metas(html, "name", "description");
  if (desc.length !== 1 || !desc[0]) fail(rel, "missing meta description");
  else if (charLen(desc[0]) > 155) fail(rel, `description is ${charLen(desc[0])} chars (>155)`);
  else if (charLen(desc[0]) < 50) warn.push(`${rel}: short description (${charLen(desc[0])} chars)`);

  const noindex = metas(html, "name", "robots").some((c) => c.includes("noindex"));
  const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
  const alternates = new Map<string, string>();
  for (const m of html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)) {
    if (alternates.has(m[1]!)) fail(rel, `duplicate hreflang ${m[1]}`);
    alternates.set(m[1]!, m[2]!);
  }
  if (!noindex) {
    if (!canonical) fail(rel, "missing canonical");
    else if (canonical !== ORIGIN + path) fail(rel, `canonical ${canonical} does not match ${ORIGIN + path}`);
    const missing = [...EXPECTED_HREFLANG].filter((h) => !alternates.has(h));
    const extra = [...alternates.keys()].filter((h) => !EXPECTED_HREFLANG.has(h));
    if (missing.length) fail(rel, `hreflang missing: ${missing.join(", ")}`);
    if (extra.length) fail(rel, `unexpected hreflang: ${extra.join(", ")}`);
    const self = [...alternates.values()].includes(ORIGIN + path);
    if (!self) fail(rel, "hreflang set does not include the page itself");
  }

  // Open Graph + Twitter
  for (const p of ["og:title", "og:description", "og:url", "og:image", "og:site_name", "og:locale", "og:type"]) {
    if (!metas(html, "property", p)[0]) fail(rel, `missing ${p}`);
  }
  if (metas(html, "property", "og:locale:alternate").length !== LOCALES.length - 1) fail(rel, "og:locale:alternate should list the other 11 locales");
  if (metas(html, "name", "twitter:card")[0] !== "summary_large_image") fail(rel, "twitter:card must be summary_large_image");
  const ogImage = metas(html, "property", "og:image")[0];
  if (ogImage) {
    const p = toPath(ogImage);
    const f = p ? resolveFile(p) : null;
    if (!f) fail(rel, `og:image not found in dist: ${ogImage}`);
    else {
      const size = pngSize(f);
      if (!size || size.w !== 1200 || size.h !== 630) fail(rel, `og:image must be a 1200×630 PNG (${ogImage})`);
    }
  }
  if (!/<meta name="theme-color"/.test(html)) fail(rel, "missing theme-color");
  if (!/<link rel="manifest" href="\/site\.webmanifest">/.test(html)) fail(rel, "missing manifest link");
  if (!/<meta name="viewport"/.test(html)) fail(rel, "missing viewport");

  // JSON-LD
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
  if (!blocks.length) fail(rel, "no JSON-LD");
  const types = new Set<string>();
  for (const b of blocks) {
    try {
      const j = JSON.parse(b) as { "@context"?: string; "@graph"?: { "@type": string | string[] }[] };
      if (j["@context"] !== "https://schema.org") fail(rel, "JSON-LD @context must be https://schema.org");
      for (const node of j["@graph"] ?? []) [node["@type"]].flat().forEach((t) => types.add(t));
      const app = (j["@graph"] ?? []).find((n) => n["@type"] === "SoftwareApplication") as { operatingSystem?: string; offers?: { price?: string } } | undefined;
      if (app && (app.operatingSystem !== "Windows, Android, Web" || app.offers?.price !== "0")) fail(rel, "SoftwareApplication must have operatingSystem 'Windows, Android, Web' and price 0");
    } catch (e) {
      fail(rel, `invalid JSON-LD: ${(e as Error).message}`);
    }
  }
  for (const t of ["Organization", "WebSite", "SoftwareApplication"]) if (!types.has(t)) fail(rel, `JSON-LD missing ${t}`);
  const isHome = /^\/([a-zA-Z-]+\/)?$/.test(path);
  if (/\/faq\/$/.test(path) && !types.has("FAQPage")) fail(rel, "FAQ page needs FAQPage JSON-LD");
  if (!noindex && !isHome && !types.has("BreadcrumbList")) fail(rel, "subpage needs BreadcrumbList JSON-LD");

  // Internal links, assets and fragments
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
  for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const raw = decode(m[1]!);
    if (/^(https?:|mailto:|tel:|data:|\/\/)/.test(raw)) {
      const p = toPath(raw);
      if (p && !p.startsWith("/app/") && !resolveFile(p)) fail(rel, `broken absolute link ${raw}`);
      continue;
    }
    if (raw.startsWith("#")) {
      if (raw.length > 1 && !ids.has(raw.slice(1))) fail(rel, `broken fragment ${raw}`);
      continue;
    }
    if (raw.startsWith("/app/")) continue; // the SPA is merged in at deploy time
    if (!raw.startsWith("/")) {
      fail(rel, `relative link ${raw} (use root-relative URLs)`);
      continue;
    }
    const target = resolveFile(raw);
    if (!target) fail(rel, `broken internal link ${raw}`);
    else if (raw.includes("#") && target.endsWith(".html")) {
      const frag = raw.split("#")[1]!;
      if (frag && !new RegExp(`\\sid="${frag}"`).test(readFileSync(target, "utf8"))) fail(rel, `broken fragment ${raw}`);
    }
  }
  pages.push({ file: rel, path, title, noindex, alternates });
}

/* ---------------------------------------------------------------- hreflang reciprocity */
const byUrl = new Map(pages.map((p) => [ORIGIN + p.path, p]));
for (const p of pages.filter((x) => !x.noindex)) {
  for (const [hl, href] of p.alternates) {
    const target = byUrl.get(href);
    if (!target) {
      fail(p.file, `hreflang ${hl} points to a page that does not exist: ${href}`);
      continue;
    }
    const back = [...target.alternates.entries()].sort().join("|");
    const mine = [...p.alternates.entries()].sort().join("|");
    if (back !== mine) fail(p.file, `hreflang set is not reciprocal with ${target.file}`);
  }
}

/* ---------------------------------------------------------------- sitemap & robots */
const indexable = pages.filter((p) => !p.noindex);
const sitemapFile = join(DIST, "sitemap.xml");
if (!existsSync(sitemapFile)) fail("sitemap.xml", "missing");
else {
  const xml = readFileSync(sitemapFile, "utf8");
  const urls = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]!);
  if (urls.length !== indexable.length) fail("sitemap.xml", `has ${urls.length} URLs but ${indexable.length} indexable pages were built`);
  const locs = new Set<string>();
  for (const u of urls) {
    const loc = /<loc>([^<]+)<\/loc>/.exec(u)?.[1] ?? "";
    if (locs.has(loc)) fail("sitemap.xml", `duplicate <loc> ${loc}`);
    locs.add(loc);
    if (!byUrl.has(loc)) fail("sitemap.xml", `<loc> ${loc} has no page`);
    if (!/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(u)) fail("sitemap.xml", `${loc} missing lastmod`);
    const alts = [...u.matchAll(/<xhtml:link rel="alternate" hreflang="([^"]+)" href="([^"]+)"\/>/g)];
    if (alts.length !== EXPECTED_HREFLANG.size) fail("sitemap.xml", `${loc} has ${alts.length} xhtml:link alternates (expected ${EXPECTED_HREFLANG.size})`);
    for (const a of alts) if (!byUrl.has(a[2]!)) fail("sitemap.xml", `${loc} alternate ${a[2]} has no page`);
  }
  for (const p of indexable) if (!locs.has(ORIGIN + p.path)) fail("sitemap.xml", `missing ${p.path}`);
}
const robotsFile = join(DIST, "robots.txt");
if (!existsSync(robotsFile)) fail("robots.txt", "missing");
else if (!readFileSync(robotsFile, "utf8").includes(`Sitemap: ${ORIGIN}/sitemap.xml`)) fail("robots.txt", "missing Sitemap line");

/* ---------------------------------------------------------------- PWA + hosting files */
try {
  const manifest = JSON.parse(readFileSync(join(DIST, "site.webmanifest"), "utf8")) as { icons: { src: string; purpose?: string }[]; start_url: string };
  if (manifest.start_url !== "/app/") fail("site.webmanifest", "start_url must be /app/");
  if (!manifest.icons.some((i) => i.purpose === "maskable")) fail("site.webmanifest", "needs a maskable icon");
  for (const i of manifest.icons) if (!resolveFile(i.src)) fail("site.webmanifest", `icon missing: ${i.src}`);
} catch (e) {
  fail("site.webmanifest", `invalid: ${(e as Error).message}`);
}
for (const f of ["favicon.ico", "favicon.svg", "icons/apple-touch-icon.png", "_headers", "_redirects", "404.html"]) if (!existsSync(join(DIST, f))) fail(f, "missing");
if (existsSync(join(DIST, "_redirects")) && !readFileSync(join(DIST, "_redirects"), "utf8").includes("/app/* /app/ 200")) fail("_redirects", "missing SPA fallback for /app/*");
if (existsSync(join(DIST, "_headers")) && !/Content-Security-Policy:.*frame-ancestors 'none'/.test(readFileSync(join(DIST, "_headers"), "utf8"))) fail("_headers", "missing strict CSP");

/* ---------------------------------------------------------------- report */
for (const w of warn) console.warn(`warn  ${w}`);
if (errors.length) {
  for (const e of errors.slice(0, 200)) console.error(`error ${e}`);
  if (errors.length > 200) console.error(`… and ${errors.length - 200} more`);
  console.error(`\nverify-seo: ${errors.length} problem(s) in ${files.length} HTML files`);
  process.exit(1);
}
console.log(`verify-seo: OK — ${files.length} HTML files (${indexable.length} indexable, ${LOCALES.length} locales), ${titles.size} unique titles, sitemap and hreflang consistent`);
