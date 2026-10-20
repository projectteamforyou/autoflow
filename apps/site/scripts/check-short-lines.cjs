// Finds text blocks of 2+ lines whose last line is much shorter than the longest line ("widow-ish" ragged endings).
// usage: node check-short-lines.cjs BASE [langs] [paths] [widths] [ratio]
const { chromium } = require(require("fs").existsSync("/opt/node22/lib/node_modules/playwright") ? "/opt/node22/lib/node_modules/playwright" : "/opt/node-tools/node_modules/playwright");
const base = process.argv[2] || "http://localhost:4310";
const langs = (process.argv[3] || "en,ko,ja,zh-CN,zh-TW,es,fr,de,pt-BR,ru,vi,id").split(",");
const pages = (process.argv[4] || ",features/,windows/,android/,keyforge/,atlas/,safety/,pricing/,faq/,download/").split(",");
const widths = (process.argv[5] || "360,390,768,1024,1280,1440").split(",").map(Number);
const ratio = Number(process.argv[6] || 0.34);
(async () => {
  const b = await chromium.launch({ executablePath: require("fs").existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined }).catch(() => chromium.launch());
  const all = [];
  for (const w of widths) {
    const p = await b.newPage({ viewport: { width: w, height: 900 } });
    for (const l of langs) for (const pg of pages) {
      await p.goto(`${base}/${l}/${pg}`, { waitUntil: "load" });
      const found = await p.evaluate((ratio) => {
        const out = [];
        const sel = "p, li, h1, h2, h3, h4, dd, dt, summary, figcaption, td, th, blockquote, label, small, .btn";
        for (const el of document.querySelectorAll(sel)) {
          if (el.closest(".site-header, [hidden], .foot-langs, .prose, .legal") || !el.offsetParent) continue;
          if ([...el.children].some((c) => c.matches(sel))) continue;
          const r = document.createRange(); r.selectNodeContents(el);
          const rects = [...r.getClientRects()].filter((x) => x.width > 0.5);
          if (!rects.length) continue;
          const rows = [];
          for (const x of rects) { const row = rows.find((y) => Math.abs(y.top - x.top) < 6); if (row) { row.l = Math.min(row.l, x.left); row.r = Math.max(row.r, x.right); } else rows.push({ top: x.top, l: x.left, r: x.right }); }
          if (rows.length < 2 || rows.length > 6) continue;
          rows.sort((a, b) => a.top - b.top);
          const wd = rows.map((x) => x.r - x.l); const max = Math.max(...wd); const last = wd[wd.length - 1];
          if (last / max < ratio) out.push({ tag: el.tagName.toLowerCase() + (el.className ? "." + String(el.className).split(" ")[0] : ""), rows: rows.length, pct: Math.round((last / max) * 100), full: el.textContent.trim().slice(0, 80) });
        }
        return out;
      }, ratio);
      for (const f of found) all.push({ w, l, pg, ...f });
    }
    await p.close();
  }
  await b.close();
  for (const f of all) console.log(`${f.w}\t${f.l}\t/${f.pg}\t${f.tag}\t${f.rows}L ${f.pct}%\t${f.full}`);
  console.log(`TOTAL ${all.length}`);
})();
