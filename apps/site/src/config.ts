import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LOCALES, type LocaleCode } from "@autoflow/core";

const strip = (u: string) => u.replace(/\/+$/, "");

/** Public origin of this site (no trailing slash). */
export const SITE_URL = strip(process.env.SITE_URL || "https://autoflow-651.pages.dev");
/** Origin of the AutoFlow API, allowed in the CSP connect-src. */
export const API_ORIGIN = strip(process.env.API_ORIGIN || "https://api-production-1dc3.up.railway.app");
/** Date used for sitemap <lastmod> (YYYY-MM-DD). */
export const LASTMOD = process.env.SITE_LASTMOD || new Date().toISOString().slice(0, 10);
/** Set SKIP_OG=1 to reuse previously rendered Open Graph images (faster local iterations). */
export const SKIP_OG = process.env.SKIP_OG === "1";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DIST = join(ROOT, "dist");
export const PUBLIC = join(ROOT, "public");
export const REPO = join(ROOT, "..", "..");

export const LINKS = {
  windows: "https://github.com/work517/autoflow/releases/latest",
  releases: "https://github.com/work517/autoflow/releases",
  android: "https://play.google.com/store/apps/details?id=com.projectteamforyou.autoflow",
  app: "/app/",
  atlas: (id: string) => `/app/#/atlas/${encodeURIComponent(id)}`,
  email: "projectteamforyou@gmail.com",
};

export const BRAND = { name: "AutoFlow", org: "ProjectTeamForYou", bg: "#0B0B1A", light: "#F7F7FB" };

export const PAGES = ["home", "features", "windows", "android", "keyforge", "atlas", "safety", "download", "pricing", "faq", "privacy", "terms"] as const;
export type PageId = (typeof PAGES)[number];

export const LOCALE_BY_CODE = Object.fromEntries(LOCALES.map((l) => [l.code, l])) as Record<LocaleCode, (typeof LOCALES)[number]>;

export const pagePath = (lang: LocaleCode, page: PageId) => `/${lang}/${page === "home" ? "" : `${page}/`}`;
export const abs = (path: string) => `${SITE_URL}${path}`;
