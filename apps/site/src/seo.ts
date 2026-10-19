import { LOCALES } from "@autoflow/core";
import { BRAND, LINKS, LOCALE_BY_CODE, SITE_URL, abs, pagePath, type PageId } from "./config.js";
import type { Ctx } from "./layout.js";
import { plain } from "./util.js";

const ORG_ID = `${SITE_URL}/#organization`;
const SITE_ID = `${SITE_URL}/#website`;
const APP_ID = `${SITE_URL}/#app`;

export function baseGraph(ctx: Ctx, title: string, description: string, crumbs: { name: string; path: string }[], extra: object[] = []): object {
  const { t, lang } = ctx;
  const hl = LOCALE_BY_CODE[lang].hreflang;
  const url = abs(ctx.path);
  const graph: object[] = [
    {
      "@type": "Organization",
      "@id": ORG_ID,
      name: BRAND.org,
      url: `${SITE_URL}/`,
      email: LINKS.email,
      logo: { "@type": "ImageObject", url: abs("/icons/icon-512.png"), width: 512, height: 512 },
      brand: { "@type": "Brand", name: "AutoFlow" },
      contactPoint: { "@type": "ContactPoint", email: LINKS.email, contactType: "customer support", availableLanguage: LOCALES.map((l) => l.english) },
    },
    {
      "@type": "WebSite",
      "@id": SITE_ID,
      url: `${SITE_URL}/`,
      name: "AutoFlow",
      description: t.footer.tagline,
      publisher: { "@id": ORG_ID },
      inLanguage: LOCALES.map((l) => l.hreflang),
    },
    {
      "@type": "SoftwareApplication",
      "@id": APP_ID,
      name: "AutoFlow",
      description: plain(t.home.seo.description),
      url: abs(pagePath(lang, "home")),
      image: abs(`/og/${lang}/home.png`),
      operatingSystem: "Windows, Android, Web",
      applicationCategory: "UtilitiesApplication",
      applicationSubCategory: "Automation",
      downloadUrl: [LINKS.windows, LINKS.android],
      installUrl: abs(LINKS.app),
      inLanguage: LOCALES.map((l) => l.hreflang),
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD", availability: "https://schema.org/InStock" },
      publisher: { "@id": ORG_ID },
      featureList: t.features.groups.flatMap((g) => g.items.map((i) => i.h3)),
    },
    {
      "@type": ctx.page === "faq" ? ["WebPage", "FAQPage"] : "WebPage",
      "@id": `${url}#webpage`,
      url,
      name: title,
      description,
      inLanguage: hl,
      isPartOf: { "@id": SITE_ID },
      about: { "@id": APP_ID },
      primaryImageOfPage: { "@type": "ImageObject", url: abs(`/og/${lang}/${ctx.page === "404" ? "home" : ctx.page}.png`), width: 1200, height: 630 },
      ...(crumbs.length > 1 ? { breadcrumb: { "@id": `${url}#breadcrumb` } } : {}),
      ...(ctx.page === "faq"
        ? {
            mainEntity: t.faq.items.map((f) => ({
              "@type": "Question",
              name: f.q,
              acceptedAnswer: { "@type": "Answer", text: plain(f.a) },
            })),
          }
        : {}),
    },
    ...extra,
  ];
  if (crumbs.length > 1) {
    graph.push({
      "@type": "BreadcrumbList",
      "@id": `${url}#breadcrumb`,
      itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: abs(c.path) })),
    });
  }
  return { "@context": "https://schema.org", "@graph": graph };
}

export function crumbsFor(ctx: Ctx, page: PageId) {
  const home = { name: ctx.t.nav.home, path: pagePath(ctx.lang, "home") };
  return page === "home" ? [home] : [home, { name: ctx.t.nav[page], path: pagePath(ctx.lang, page) }];
}
