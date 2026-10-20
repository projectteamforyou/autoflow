#!/usr/bin/env node
/**
 * IndexNow: tell Bing, Naver, Yandex, Seznam and others that pages changed.
 * Reads every <loc> from the live sitemap and submits them in batches of 10,000.
 *
 *   node scripts/seo/indexnow.mjs              # all sitemap URLs
 *   node scripts/seo/indexnow.mjs /ko/ /en/    # only these paths
 *
 * The key file lives at apps/site/public/<key>.txt and is published at the site root.
 */
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = (process.env.SITE_URL || "https://autoflowmacro.com").replace(/\/+$/, "");
const HOST = new URL(SITE).host;
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "apps", "site", "public");
const keyFile = readdirSync(PUBLIC).find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (!keyFile) throw new Error(`No IndexNow key file (32 hex chars + .txt) in ${PUBLIC}`);
const key = keyFile.slice(0, -4);

const args = process.argv.slice(2);
let urls;
if (args.length) urls = args.map((p) => (p.startsWith("http") ? p : `${SITE}${p}`));
else {
  const xml = await (await fetch(`${SITE}/sitemap.xml`)).text();
  urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}
if (!urls.length) throw new Error("No URLs to submit");

// The engine checks this file before accepting the submission.
const check = await fetch(`${SITE}/${key}.txt`);
if (!check.ok || (await check.text()).trim() !== key) throw new Error(`Key file not live at ${SITE}/${key}.txt — deploy first`);

for (const endpoint of ["https://api.indexnow.org/indexnow", "https://searchadvisor.naver.com/indexnow"]) {
  for (let i = 0; i < urls.length; i += 10_000) {
    const urlList = urls.slice(i, i + 10_000);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host: HOST, key, keyLocation: `${SITE}/${key}.txt`, urlList }),
    });
    console.log(`${endpoint}: ${res.status} ${res.statusText} (${urlList.length} URLs)`);
  }
}
