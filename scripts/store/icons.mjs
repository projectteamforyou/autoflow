#!/usr/bin/env node
// Renders the Google Play listing icon (store/icon-512.png, 512×512, 32-bit PNG) from packages/brand/mark.svg.
// Play applies its own rounded mask, so the icon is drawn full-bleed (square background, no transparent corners).
// The in-app launcher icon is a vector adaptive icon (apps/android/android/app/src/main/res/drawable/ic_launcher_*.xml)
// built from the same paths, so it needs no PNGs.
//   node scripts/store/icons.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { inflateSync, deflateSync, crc32 } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const svg = readFileSync(join(ROOT, 'packages/brand/mark.svg'), 'utf8')
  // full-bleed: drop the rounded corners of the background square
  .replace(/<rect([^>]*?)rx="\d+"/, '<rect$1');

/** Re-encodes an 8-bit RGB PNG as RGBA (opaque alpha): Play asks for a 32-bit PNG icon; Chromium writes RGB. */
function toRgba(png) {
  const chunks = [];
  for (let o = 8; o < png.length; ) {
    const len = png.readUInt32BE(o);
    chunks.push({ type: png.toString('ascii', o + 4, o + 8), data: png.subarray(o + 8, o + 8 + len) });
    o += 12 + len;
  }
  const ihdr = chunks.find((c) => c.type === 'IHDR').data;
  const w = ihdr.readUInt32BE(0);
  const h = ihdr.readUInt32BE(4);
  if (ihdr[8] !== 8 || ihdr[12] !== 0) throw new Error('expected an 8-bit, non-interlaced PNG');
  if (ihdr[9] === 6) return png;
  if (ihdr[9] !== 2) throw new Error(`unsupported PNG colour type ${ihdr[9]}`);
  const raw = inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const out = Buffer.alloc(h * (1 + w * 4));
  const prev = Buffer.alloc(w * 3);
  const cur = Buffer.alloc(w * 3);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (1 + w * 3)];
    const line = raw.subarray(y * (1 + w * 3) + 1, (y + 1) * (1 + w * 3));
    for (let i = 0; i < w * 3; i++) {
      const a = i >= 3 ? cur[i - 3] : 0;
      const b = prev[i];
      const c = i >= 3 ? prev[i - 3] : 0;
      const p = a + b - c;
      const pr = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      cur[i] = (line[i] + [0, a, b, (a + b) >> 1, pr][f]) & 255;
    }
    out[y * (1 + w * 4)] = 0;
    for (let x = 0; x < w; x++) {
      cur.copy(out, y * (1 + w * 4) + 1 + x * 4, x * 3, x * 3 + 3);
      out[y * (1 + w * 4) + 4 + x * 4] = 255;
    }
    cur.copy(prev);
  }
  const chunk = (type, data) => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0);
    b.write(type, 4, 'ascii');
    data.copy(b, 8);
    b.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])) >>> 0, 8 + data.length);
    return b;
  };
  const hdr = Buffer.from(ihdr);
  hdr[9] = 6;
  return Buffer.concat([png.subarray(0, 8), chunk('IHDR', hdr), chunk('IDAT', deflateSync(out, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

async function chromium() {
  const c = ['playwright'];
  try {
    c.push(join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright/index.js'));
  } catch {
    /* none */
  }
  for (const p of c) {
    try {
      const m = await import(p.startsWith('/') ? pathToFileURL(p).href : p);
      return m.chromium ?? m.default.chromium;
    } catch {
      /* next */
    }
  }
  throw new Error('Playwright not found');
}

const exe = process.env.PW_CHROMIUM || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await (await chromium()).launch(exe ? { executablePath: exe } : {});
try {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#0B0B1A">${svg.replace('<svg', '<svg width="512" height="512"')}</body></html>`);
  mkdirSync(join(ROOT, 'store'), { recursive: true });
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: 512, height: 512 } });
  writeFileSync(join(ROOT, 'store/icon-512.png'), toRgba(png));
  console.log('wrote store/icon-512.png (512×512)');
} finally {
  await browser.close();
}
