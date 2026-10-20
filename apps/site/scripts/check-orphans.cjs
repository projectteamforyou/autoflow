// Finds text blocks whose last line holds a single word (or < 3 CJK chars) at several widths.
const { chromium } = require(require("fs").existsSync("/opt/node22/lib/node_modules/playwright") ? "/opt/node22/lib/node_modules/playwright" : "/opt/node-tools/node_modules/playwright");
const base = process.argv[2] || "http://localhost:4310";
const langs = (process.argv[3] || "en,ko,ja,zh-CN,zh-TW,es,fr,de,pt-BR,ru,vi,id").split(",");
const pages = (process.argv[4] || ",features/,windows/,android/,keyforge/,atlas/,safety/,pricing/,faq/,download/,privacy/,terms/").split(",");
const widths = (process.argv[5] || "360,390,768,1024,1280,1440").split(",").map(Number);
(async () => {
  const b = await chromium.launch(); const all = [];
  for (const w of widths) {
    const p = await b.newPage({ viewport: { width: w, height: 900 } });
    for (const l of langs) for (const pg of pages) {
      await p.goto(`${base}/${l}/${pg}`, { waitUntil: "load" });
      const found = await p.evaluate(() => {
        const out = []; const cjk = /[぀-ヿ㐀-鿿]/;
        const sel = "p, li, h1, h2, h3, h4, dd, dt, summary, figcaption, td, th, .lead, blockquote, label, .btn, small";
        for (const el of document.querySelectorAll(sel)) {
          if (el.closest(".site-header, script, style, [hidden], .foot-langs, h1.display") || !el.offsetParent) continue;
          if ([...el.children].some((c) => c.matches(sel))) continue; // leaf blocks only
          const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const tokens = [];
          let n; while ((n = tw.nextNode())) {
            const s = n.textContent; const re = cjk.test(s) && !/\s/.test(s.trim()) ? /./gu : /\S+/gu; let m;
            if (/[぀-ヿ㐀-鿿]/.test(s)) { for (const mm of s.matchAll(/[぀-ヿ㐀-鿿]|[^\s぀-ヿ㐀-鿿]+/gu)) tokens.push([n, mm.index, mm[0]]); }
            else while ((m = re.exec(s))) tokens.push([n, m.index, m[0]]);
          }
          if (tokens.length < 3) continue;
          const tops = tokens.map(([node, i, t]) => { const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + t.length); const rs = r.getClientRects(); return rs.length ? Math.round(rs[rs.length - 1].top) : null; }).filter((x) => x !== null);
          const lines = [...new Set(tops)].sort((a, b) => a - b); if (lines.length < 2) continue;
          // group tops within 4px
          const last = Math.max(...tops); const onLast = tokens.filter((_, i) => Math.abs(tops[i] - last) < 6);
          const text = onLast.map((t) => t[2]).join("");
          const isCjk = cjk.test(text);
          const punct = text.replace(/[.,!?。、，！？…:;)\]」』"'”’]/g, "");
          if ((isCjk && punct.length < 3) || (!isCjk && onLast.length === 1)) out.push({ tag: el.tagName.toLowerCase() + (el.className ? "." + String(el.className).split(" ")[0] : ""), last: text, full: el.textContent.trim().slice(0, 70) });
        }
        return out;
      });
      for (const f of found) all.push({ w, l, pg, ...f });
    }
    await p.close();
  }
  await b.close();
  for (const f of all) console.log(`${f.w}\t${f.l}\t/${f.pg}\t${f.tag}\t«${f.last}»\t${f.full}`);
  console.log(`TOTAL ${all.length}`);
})();
