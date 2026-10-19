// Pure helpers for scripts/play/demo-video.mjs (no adb, no I/O) so they can be unit-tested without an emulator:
// uiautomator XML parsing, the WebView ↔ screen mapping, raw screencap blob search, caption wrapping and the ffmpeg
// filter graphs. Tests: node --test scripts/play/demo-video-lib.test.mjs

/* ------------------------------------------------------------------ uiautomator */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function decodeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

export function parseBounds(b) {
  const m = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(b ?? "");
  return m ? { x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] } : null;
}

/** Every <node> of a `uiautomator dump` as a flat list (document order). */
export function parseUiDump(xml) {
  const nodes = [];
  for (const m of xml.matchAll(/<node\b([^>]*?)\/?>/g)) {
    const a = {};
    for (const am of m[1].matchAll(/([\w:-]+)="([^"]*)"/g)) a[am[1]] = decodeXml(am[2]);
    nodes.push({
      text: a.text ?? "",
      desc: a["content-desc"] ?? "",
      id: a["resource-id"] ?? "",
      cls: a.class ?? "",
      pkg: a.package ?? "",
      checkable: a.checkable === "true",
      checked: a.checked === "true",
      clickable: a.clickable === "true",
      enabled: a.enabled !== "false",
      bounds: parseBounds(a.bounds),
    });
  }
  return nodes;
}

export function center(b) {
  return { x: Math.round((b.x1 + b.x2) / 2), y: Math.round((b.y1 + b.y2) / 2) };
}

const asTest = (p) => (p instanceof RegExp ? (s) => p.test(s) : typeof p === "function" ? p : (s) => s === p);

/** First node whose text or content-desc matches (string = exact, RegExp, or predicate). */
export function findByText(nodes, pattern) {
  const test = asTest(pattern);
  return nodes.find((n) => n.bounds && n.bounds.x2 > n.bounds.x1 && n.bounds.y2 > n.bounds.y1 && (test(n.text) || test(n.desc))) ?? null;
}

/** The on/off switch of an accessibility service page (Settings ▸ Accessibility ▸ <service>). */
export function findServiceSwitch(nodes, label) {
  const sw = nodes.filter((n) => n.bounds && n.checkable && /Switch|CompoundButton|MaterialSwitch/i.test(n.cls));
  // AOSP 13+: a MainSwitchPreference "Use <label>" bar; older: a switch next to the label.
  const use = findByText(nodes, (s) => s.toLowerCase().startsWith("use ") && s.toLowerCase().includes(label.toLowerCase()));
  if (use) {
    const row = sw.find((n) => n.bounds.y1 <= center(use.bounds).y && n.bounds.y2 >= center(use.bounds).y);
    return { node: row ?? use, checked: row ? row.checked : sw[0]?.checked ?? false };
  }
  return sw[0] ? { node: sw[0], checked: sw[0].checked } : null;
}

/** "Physical size: 1080x1920\nOverride size: …" → the size in effect. */
export function parseWmSize(out) {
  const o = /Override size:\s*(\d+)x(\d+)/.exec(out);
  const p = /Physical size:\s*(\d+)x(\d+)/.exec(out);
  const m = o ?? p;
  return m ? { w: +m[1], h: +m[2] } : null;
}

/** The WebView DevTools socket of a pid from /proc/net/unix. */
export function devtoolsSocket(procNetUnix, pid) {
  const names = [...procNetUnix.matchAll(/@(webview_devtools_remote_(\d+)|chrome_devtools_remote\S*)/g)].map((m) => ({ name: m[1], pid: m[2] }));
  return (names.find((n) => n.pid === String(pid)) ?? null)?.name ?? null;
}

/** Package of the focused window from `dumpsys window` (mCurrentFocus, falling back to mFocusedApp). */
export function focusedPackage(dumpsysWindow) {
  const m = /mCurrentFocus=Window\{[^}]*\s([\w.]+)\/[^\s}]+\}/.exec(dumpsysWindow) ?? /mFocusedApp=.*?\s([\w.]+)\/[\w.$]+/.exec(dumpsysWindow);
  return m ? m[1] : null;
}

/* ------------------------------------------------------------------ WebView mapping */

/** CSS pixel (client coordinates) → physical screen pixel, from a calibration { scale, offX, offY }. */
export function toScreen(cal, cx, cy) {
  return { x: Math.round(cal.offX + cx * cal.scale), y: Math.round(cal.offY + cy * cal.scale) };
}

/** Calibration from one real tap at (sx, sy) that the page saw at client (cx, cy), with scale = devicePixelRatio. */
export function calibrate(scale, sx, sy, cx, cy) {
  return { scale, offX: sx - cx * scale, offY: sy - cy * scale };
}

/** Normalized flow point (what AndroidBackend multiplies by the real display size) for a screen pixel. */
export function normalizedPoint(screen, x, y) {
  return { x: +(x / screen.w).toFixed(4), y: +(y / screen.h).toFixed(4) };
}

/* ------------------------------------------------------------------ raw screencap */

/** `adb exec-out screencap` (no -p): 12 or 16 byte header (w, h, format[, colorspace]) + RGBA_8888 pixels. */
export function parseRawScreencap(buf) {
  if (buf.length < 16) throw new Error("screencap too short");
  const w = buf.readUInt32LE(0);
  const h = buf.readUInt32LE(4);
  const header = buf.length - w * h * 4;
  if (header !== 12 && header !== 16) throw new Error(`unexpected screencap size ${buf.length} for ${w}x${h}`);
  return { w, h, data: buf.subarray(header) };
}

/**
 * Bounding box and centroid of pixels close to [color] inside [region] (screen px), ignoring pixels that already had
 * that colour in [before] (a screenshot without the thing we look for). Null when fewer than [minCount] pixels match.
 */
export function findColorBlob(img, { region, color, tol = 40, before = null, minCount = 200 }) {
  const [cr, cg, cb] = color;
  const x1 = Math.max(0, region.x1 | 0), y1 = Math.max(0, region.y1 | 0);
  const x2 = Math.min(img.w, region.x2 | 0), y2 = Math.min(img.h, region.y2 | 0);
  const near = (d, i) => Math.abs(d[i] - cr) <= tol && Math.abs(d[i + 1] - cg) <= tol && Math.abs(d[i + 2] - cb) <= tol;
  let n = 0, sx = 0, sy = 0, bx1 = Infinity, by1 = Infinity, bx2 = -1, by2 = -1;
  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      const i = (y * img.w + x) * 4;
      if (!near(img.data, i)) continue;
      if (before && before.w === img.w && near(before.data, i)) continue;
      n++; sx += x; sy += y;
      if (x < bx1) bx1 = x; if (x > bx2) bx2 = x; if (y < by1) by1 = y; if (y > by2) by2 = y;
    }
  }
  if (n < minCount) return null;
  return { count: n, cx: Math.round(sx / n), cy: Math.round(sy / n), box: { x1: bx1, y1: by1, x2: bx2 + 1, y2: by2 + 1 } };
}

/** Where Overlays.setHaltVisible() puts the 56dp Halt button (TOP|END, x=12dp, y=35% of the height, layout in screen). */
export function expectedHaltCenter(screen, density) {
  const dp = (v) => Math.trunc(v * density);
  return { x: screen.w - dp(12) - Math.round(dp(56) / 2), y: Math.trunc(screen.h * 0.35) + Math.round(dp(56) / 2) };
}

/* ------------------------------------------------------------------ i18n */

/** `"key": "value",` lines of apps/web/src/i18n/en.ts → { key: value }. */
export function parseEnTs(src) {
  const out = {};
  for (const m of src.matchAll(/^\s*"([^"]+)":\s*"((?:[^"\\]|\\.)*)",?\s*$/gm)) out[m[1]] = JSON.parse(`"${m[2]}"`);
  return out;
}

export function fmt(s, vars = {}) {
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** A RegExp for a "{n} actions"-style template that captures the number. */
export function templateRegex(s, key = "n") {
  const esc = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(esc.replace(`\\{${key}\\}`, "(\\d+)").replace(/\\\{\w+\\\}/g, ".*?"));
}

/* ------------------------------------------------------------------ captions */

const isWide = (ch) => /[ᄀ-ᇿ⺀-꓏가-힯豈-﫿＀-￯]/.test(ch);
const width = (s) => [...s].reduce((a, ch) => a + (isWide(ch) ? 1.8 : 1), 0);

/** Greedy word wrap by visual width (CJK counts ~1.8); over-long words are split. */
export function wrapText(text, max) {
  const lines = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const cand = line ? `${line} ${word}` : word;
      if (width(cand) <= max) { line = cand; continue; }
      if (line) lines.push(line);
      line = "";
      let w = word;
      while (width(w) > max) {
        let cut = 0, acc = 0;
        for (const ch of w) { if (acc + (isWide(ch) ? 1.8 : 1) > max) break; acc += isWide(ch) ? 1.8 : 1; cut += ch.length; }
        lines.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      line = w;
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** Captions for one part with absolute times: each one ends where the next begins (the last at the part's end). */
export function closeCaptions(marks, partEnd) {
  const sorted = [...marks].sort((a, b) => a.at - b.at);
  return sorted.map((m, i) => ({ text: m.text, from: Math.max(0, m.at), to: Math.max(Math.max(0, m.at) + 0.1, i + 1 < sorted.length ? sorted[i + 1].at : partEnd) }));
}

export const LAYOUT = { W: 1080, H: 1920, band: 260, fontSize: 40, lineH: 54, maxChars: 44, maxCharsCjk: 24 };

/**
 * The -vf for one recorded part: constant 30 fps, the phone screen scaled into the top of a 1080×1920 frame, and a
 * caption band underneath (so captions never cover the app). [lineFiles] = one text file per caption line, in the
 * order of captions[i].lines.
 */
export function partFilter({ captions, font, layout = LAYOUT }) {
  const { W, H, band, fontSize, lineH } = layout;
  const contentH = H - band;
  const f = [
    "fps=30",
    `scale=-2:${contentH}:flags=lanczos`,
    `pad=${W}:${H}:(ow-iw)/2:0:color=0x0B0B1A`,
    `drawbox=x=0:y=${contentH}:w=${W}:h=4:color=0x7C5CFF@0.9:t=fill`,
  ];
  for (const c of captions) {
    const top = contentH + Math.round((band - c.files.length * lineH) / 2) + 4;
    c.files.forEach((file, i) => {
      f.push(`drawtext=fontfile=${font}:textfile=${file}:expansion=none:fontsize=${fontSize}:fontcolor=white:x=(w-text_w)/2:y=${top + i * lineH}:enable='between(t,${c.from.toFixed(2)},${c.to.toFixed(2)})'`);
    });
  }
  f.push("format=yuv420p");
  return f.join(",");
}

/** The -vf for the intro card (a solid frame with a title and sub lines). */
export function introFilter({ font, titleFiles, subFiles, layout = LAYOUT }) {
  const { H } = layout;
  const f = [];
  const total = titleFiles.length * 84 + 40 + subFiles.length * 58;
  let y = Math.round((H - total) / 2);
  for (const file of titleFiles) { f.push(`drawtext=fontfile=${font}:textfile=${file}:expansion=none:fontsize=64:fontcolor=white:x=(w-text_w)/2:y=${y}`); y += 84; }
  y += 40;
  for (const file of subFiles) { f.push(`drawtext=fontfile=${font}:textfile=${file}:expansion=none:fontsize=40:fontcolor=0xC8C8E0:x=(w-text_w)/2:y=${y}`); y += 58; }
  f.push("format=yuv420p");
  return f.join(",");
}

/* ------------------------------------------------------------------ caption texts */

/** Everything the video says, per language. Each line describes only what is on screen at that moment. */
export const CAPTIONS = {
  en: {
    introTitle: "AutoFlow\nAccessibility API use",
    introSub: "Screen recording of the AutoFlow app (debug build) on an Android 15 (API 35) emulator",
    open: "The user opens AutoFlow ▸ Settings ▸ Permissions",
    disclosure: "1. AutoFlow explains how it uses the Accessibility service before it opens Android Settings",
    enableUi: "2. The user turns on AutoFlow in Android Settings ▸ Accessibility",
    enableAdb: "2. AutoFlow is turned on in Android Settings ▸ Accessibility (switched over adb for this recording)",
    granted: "Back in AutoFlow, the Accessibility service shows as granted",
    create: "3. The user creates an Easy auto-clicker flow (slow, until stopped, one tap point)",
    run: "4. The user starts the flow: AutoFlow taps the screen through the Accessibility service (tap traces: Android pointer location)",
    halt: "5. The user taps the floating Halt button (■): the flow stops immediately",
    haltInApp: "5. The user taps Halt in AutoFlow: the flow stops immediately",
    ledger: "The stopped run is listed in AutoFlow's Ledger",
  },
  ko: {
    introTitle: "AutoFlow\n접근성 API 사용",
    introSub: "Android 15 (API 35) 에뮬레이터에서 AutoFlow 앱(디버그 빌드)을 녹화한 화면",
    open: "사용자가 AutoFlow → 설정 → 권한을 엽니다",
    disclosure: "1. Android 설정을 열기 전에 AutoFlow가 접근성 서비스 사용 방식을 안내합니다",
    enableUi: "2. 사용자가 Android 설정 → 접근성에서 AutoFlow를 켭니다",
    enableAdb: "2. Android 설정 → 접근성에서 AutoFlow가 켜집니다 (이 녹화에서는 adb로 전환)",
    granted: "AutoFlow로 돌아오면 접근성 서비스가 허용됨으로 표시됩니다",
    create: "3. 사용자가 Easy 자동 클릭 플로우를 만듭니다 (느리게, 멈출 때까지, 탭 위치 1곳)",
    run: "4. 플로우를 실행하면 AutoFlow가 접근성 서비스로 화면을 탭합니다 (탭 궤적: Android 포인터 위치 표시)",
    halt: "5. 사용자가 떠 있는 Halt 버튼(■)을 누르면 플로우가 즉시 멈춥니다",
    haltInApp: "5. 사용자가 AutoFlow의 Halt를 누르면 플로우가 즉시 멈춥니다",
    ledger: "멈춘 실행이 AutoFlow Ledger에 기록됩니다",
  },
};
