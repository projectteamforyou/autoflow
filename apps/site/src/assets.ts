import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import sharp from "sharp";
import { BRAND, DIST, LINKS, PUBLIC, REPO } from "./config.js";
import { hash } from "./util.js";
import { AI_PROVIDERS } from "@autoflow/core";

/** Every provider in the shared Copilot catalog: cloud origins plus local servers on localhost/127.0.0.1. */
function aiConnectSources(): string {
  const out = new Set<string>();
  for (const p of AI_PROVIDERS) {
    const u = new URL(p.baseUrl);
    out.add(u.origin);
    if (u.hostname === "localhost") out.add(`${u.protocol}//127.0.0.1:${u.port}`);
  }
  return [...out].join(" ");
}

const require = createRequire(import.meta.url);
const out = (...p: string[]) => join(DIST, ...p);

/* ------------------------------------------------------------------ icons */
async function markSvg() {
  return (await readFile(join(REPO, "packages", "brand", "mark.svg"), "utf8")).trim();
}

/** Full-bleed square artwork with the glyph scaled into the maskable safe zone. */
function bleed(svg: string, scale: number) {
  const inner = svg
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/<rect width="512" height="512"[^>]*\/>/, "");
  const off = (512 * (1 - scale)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${BRAND.bg}"/><g transform="translate(${off} ${off}) scale(${scale})">${inner}</g></svg>`;
}

/** Minimal ICO writer: PNG-compressed entries (supported since Windows Vista and by all browsers). */
function ico(pngs: { size: number; data: Buffer }[]) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach((p, i) => {
    const o = 6 + i * 16;
    header.writeUInt8(p.size >= 256 ? 0 : p.size, o);
    header.writeUInt8(p.size >= 256 ? 0 : p.size, o + 1);
    header.writeUInt8(0, o + 2);
    header.writeUInt8(0, o + 3);
    header.writeUInt16LE(1, o + 4);
    header.writeUInt16LE(32, o + 6);
    header.writeUInt32LE(p.data.length, o + 8);
    header.writeUInt32LE(offset, o + 12);
    offset += p.data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

export async function buildIcons() {
  await mkdir(out("icons"), { recursive: true });
  const svg = await markSvg();
  const png = (src: string, size: number) => sharp(Buffer.from(src), { density: Math.max(72, Math.ceil((72 * size) / 512) * 2) }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(out("favicon.svg"), svg.replace(/\s*\n\s*/g, ""));
  const small = await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(svg, size) })));
  await writeFile(out("favicon.ico"), ico(small));
  const full = bleed(svg, 0.86);
  const maskable = bleed(svg, 0.72);
  await writeFile(out("icons", "apple-touch-icon.png"), await png(full, 180));
  await writeFile(out("icons", "icon-192.png"), await png(svg, 192));
  await writeFile(out("icons", "icon-512.png"), await png(svg, 512));
  await writeFile(out("icons", "icon-maskable-512.png"), await png(maskable, 512));
  await writeFile(out("icons", "icon-maskable-192.png"), await png(maskable, 192));
  await writeFile(out("icons", "icon.svg"), svg);
}

export async function buildManifest() {
  const manifest = {
    id: "/app/",
    name: "AutoFlow",
    short_name: "AutoFlow",
    description: "Automate anything you repeat — safely. Auto clicker, macros, hotkeys, key remapping and routines for Windows, Android and the web.",
    lang: "en",
    dir: "ltr",
    start_url: "/app/",
    scope: "/app/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone"],
    orientation: "any",
    theme_color: BRAND.bg,
    background_color: BRAND.bg,
    categories: ["productivity", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    shortcuts: [
      { name: "Atlas templates", short_name: "Atlas", url: "/app/#/atlas", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Practice Canvas", short_name: "Canvas", url: "/app/#/canvas", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
  await writeFile(out("site.webmanifest"), JSON.stringify(manifest, null, 2));
}

/* ------------------------------------------------------------------ fonts & images */
const INTER_SUBSETS: [string, string][] = [
  ["latin", "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"],
  ["latin-ext", "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF"],
  ["vietnamese", "U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB"],
  ["cyrillic-ext", "U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F"],
  ["cyrillic", "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116"],
];

/** Copies Inter Variable (self-hosted, content-hashed) and returns its @font-face CSS + preload URL. */
export async function buildFonts(): Promise<{ css: string; preload: string }> {
  await mkdir(out("assets"), { recursive: true });
  const dir = join(require.resolve("@fontsource-variable/inter/package.json"), "..", "files");
  let css = "";
  let preload = "";
  for (const [subset, range] of INTER_SUBSETS) {
    const data = await readFile(join(dir, `inter-${subset}-wght-normal.woff2`));
    const name = `inter-${subset}.${hash(data)}.woff2`;
    await writeFile(out("assets", name), data);
    if (subset === "latin") preload = `/assets/${name}`;
    css += `@font-face{font-family:"InterVariable";font-style:normal;font-display:swap;font-weight:100 900;src:url(/assets/${name}) format("woff2");unicode-range:${range}}`;
  }
  return { css, preload };
}

export async function copyPublic() {
  await mkdir(out("img"), { recursive: true });
  for (const f of await readdir(join(PUBLIC, "img"))) {
    if (f.endsWith(".webp")) await copyFile(join(PUBLIC, "img", f), out("img", f));
  }
}

/* ------------------------------------------------------------------ Cloudflare Pages + crawlers */
export async function buildCloudflare(opts: { scriptHashes: string[]; styleHashes: string[]; apiOrigin: string }) {
  const csp = [
    "default-src 'self'",
    `script-src 'self' ${opts.scriptHashes.join(" ")} https://static.cloudflareinsights.com`,
    `style-src 'self' ${opts.styleHashes.join(" ")}`,
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${opts.apiOrigin} https://cloudflareinsights.com`,
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
  // The SPA under /app/ needs a different policy (its own bundles, BYO-AI provider calls, workers).
  const appCsp = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval' https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${opts.apiOrigin} https://cloudflareinsights.com ${aiConnectSources()}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  const headers = `# Generated by apps/site/src/assets.ts — do not edit by hand.
/*
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()
  Cross-Origin-Opener-Policy: same-origin
  Content-Security-Policy: ${csp}
  Cache-Control: public, max-age=0, must-revalidate

/app/*
  ! Content-Security-Policy
  Content-Security-Policy: ${appCsp}

/assets/*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable

/app/assets/*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable

/img/*
  ! Cache-Control
  Cache-Control: public, max-age=604800, stale-while-revalidate=86400

/og/*
  ! Cache-Control
  Cache-Control: public, max-age=86400, stale-while-revalidate=604800

/icons/*
  ! Cache-Control
  Cache-Control: public, max-age=604800, stale-while-revalidate=86400

/site.webmanifest
  Content-Type: application/manifest+json
  ! Cache-Control
  Cache-Control: public, max-age=3600
`;
  await writeFile(out("_headers"), headers);

  const shortcuts = ["features", "windows", "android", "keyforge", "atlas", "safety", "download", "pricing", "faq", "privacy", "terms"];
  const redirects = [
    "# Generated by apps/site/src/assets.ts — language-less shortcuts go to English; the SPA owns /app/*.",
    ...shortcuts.flatMap((p) => [`/${p} /en/${p}/ 301`, `/${p}/ /en/${p}/ 301`]),
    "/privacy-policy /en/privacy/ 301",
    "/tos /en/terms/ 301",
    "/terms-of-service /en/terms/ 301",
    // SPA routes use the URL hash; only links that arrive on real paths (emails, share links) need a rewrite.
    // A catch-all /app/* rewrite would shadow /app/assets/* on Cloudflare Pages.
    "/app/verify-email /app/ 200",
    "/app/reset-password /app/ 200",
    "/app/s/* /app/ 200",
  ].join("\n");
  await writeFile(out("_redirects"), `${redirects}\n`);
}

export async function buildRobots(siteUrl: string) {
  await writeFile(out("robots.txt"), `# AutoFlow\nUser-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${siteUrl}/sitemap.xml\n`);
}

export async function buildSitemap(entries: { loc: string; alternates: { hreflang: string; href: string }[] }[], lastmod: string) {
  const body = entries
    .map(
      (e) =>
        `  <url>\n    <loc>${e.loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n${e.alternates.map((a) => `    <xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${a.href}"/>`).join("\n")}\n  </url>`,
    )
    .join("\n");
  await writeFile(out("sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${body}\n</urlset>\n`);
}

export { LINKS };
