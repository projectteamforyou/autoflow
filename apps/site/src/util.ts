import { createHash } from "node:crypto";
import { LINKS } from "./config.js";

const ENT: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ENT[c]!);

/** Tagged template that joins arrays and drops null/false — tiny JSX-free HTML builder. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = strings[0]!;
  values.forEach((v, i) => {
    out += render(v) + strings[i + 1]!;
  });
  return out;
}
function render(v: unknown): string {
  if (v === null || v === undefined || v === false || v === true) return "";
  if (Array.isArray(v)) return v.map(render).join("");
  return String(v);
}

/** Inline copy formatting: **bold**, [label](href) and {email}. Everything else is escaped. */
/** Escapes text; "\n" becomes a line break shown on wide screens only (mobile wraps naturally). */
export const brk = (s: string) => esc(s).replace(/\n/g, '<br class="br-pc">');

export function md(s: string): string {
  let out = brk(s);
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) => {
    const ext = /^https?:/.test(href);
    return `<a href="${href}"${ext ? ' rel="noopener noreferrer" target="_blank"' : ""}>${label}</a>`;
  });
  out = out.replace(/\{email\}/g, `<a href="mailto:${LINKS.email}">${LINKS.email}</a>`);
  return out;
}

/** Plain text version of the inline syntax (for meta/JSON-LD). */
export const plain = (s: string) =>
  s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\{email\}/g, LINKS.email);

export const hash = (data: string | Buffer, len = 10) => createHash("sha256").update(data).digest("hex").slice(0, len);
export const cspHash = (data: string) => `'sha256-${createHash("sha256").update(data, "utf8").digest("base64")}'`;

/** Conservative CSS minifier: strips comments and collapses whitespace around punctuation. */
export function minifyCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}:;,>~])\s*/g, "$1")
    .replace(/;}/g, "}")
    .replace(/\s*!important/g, "!important")
    .trim();
}

/** Remove insignificant whitespace between tags (keeps text nodes intact). */
/**
 * Orphan control for every text block (p, li, headings, dd/dt, summary, cells, captions, labels):
 * - spaced scripts (Latin, Cyrillic, Korean eojeol…): the space before the last word becomes a no-break space, even
 *   when that space sits between inline tags (<a>, <span>, <strong>);
 * - CJK (ja/zh): the last 2–4 glyphs are glued with WORD JOINERs (short labels entirely), so a line never ends with one
 *   or two glyphs;
 * Pairs are only joined while short enough (headings 16, text 24 chars) to fit a 320px screen; CSS text-wrap: pretty
 * does the rest.
 */
const BLOCK = /^(p|li|h[1-6]|dd|dt|summary|figcaption|td|th|blockquote|label|caption)$/;
const RAW = /^(script|style|pre|code|textarea|svg)$/;
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]/;
const CJK_TAIL = /((?:[0-9\u00a0\u3040-\u30ff\u3400-\u9fff][\u3001\u3002\uff01\uff0c\uff1f\uff09\u300d\u300f\u201d.,!?)]*){2,4})([\u3001\u3002\uff01\uff0c\uff1f\uff09\u300d\u300f\u201d.,!?)]*)$/;
const visible = (t: string) => t.replace(/&[a-z]+;|&#\d+;/g, "x").length;

export function noOrphans(h: string): string {
  const parts = h.split(/(<[^>]+>)/);
  const stack: { tag: string; texts: number[] }[] = [];
  let raw = 0;
  for (let i = 0; i < parts.length; i++) {
    const tok = parts[i]!;
    if (!tok.startsWith("<")) {
      if (!raw && tok && stack.length) stack[stack.length - 1]!.texts.push(i);
      continue;
    }
    const m = /^<(\/?)([a-zA-Z0-9]+)/.exec(tok);
    if (!m) continue;
    const closing = m[1] === "/";
    const tag = m[2]!.toLowerCase();
    if (RAW.test(tag)) { if (!tok.endsWith("/>")) raw += closing ? -1 : 1; if (raw < 0) raw = 0; continue; }
    if (raw) continue;
    if (BLOCK.test(tag)) {
      if (!closing) stack.push({ tag, texts: [] });
      else {
        const blk = stack.pop();
        if (blk && blk.texts.length) fixBlock(parts, blk.texts, /^h[1-3]$/.test(blk.tag) ? 20 : blk.tag === "summary" ? 22 : 30);
        // text of a nested block also counts as content of the parent (but is fixed independently)
      }
    } else if (stack.length && !closing) {
      // inline tag: nothing to do, text tokens inside keep accumulating on the current block
    }
  }
  return parts.join("");
}

/** `max`: longest joined pair in characters — large headings get less room than body text at 320px. */
function fixBlock(parts: string[], texts: number[], max: number): void {
  const lastIdx = texts[texts.length - 1]!;
  const last = parts[lastIdx]!;
  let tail = last.replace(/\s+$/, "");
  const trailing = last.slice(tail.length);
  if (CJK.test(tail.slice(-3))) {
    // "最長 1 年", "長按 1 秒。": spaces near the end become no-break spaces before the glyphs are glued
    const cut = Math.max(0, tail.length - 10);
    tail = tail.slice(0, cut) + tail.slice(cut).replace(/ /g, "\u00a0");
    // U+2060 WORD JOINER between the last glyphs: no extra element, so flex containers (summary) are unaffected.
    const glue = (x: string) => [...x].join("\u2060");
    const short = [...tail.replace(/&[a-z]+;/g, "")].length <= 8 && !/\s/.test(tail) && texts.length === 1;
    if (short) { parts[lastIdx] = glue(tail) + trailing; return; }
    const m = CJK_TAIL.exec(tail);
    if (m && m.index > 0) {
      // "… 1秒。": a space right before the glued tail is a break point too
      const head = tail.slice(0, m.index).replace(/ $/, "&nbsp;");
      parts[lastIdx] = head + glue(m[0]) + trailing;
      return;
    }
    // A short Latin/parenthetical tail after the last ideographs, e.g. "州（CCPA／CPRA）": glue it to two glyphs before.
    const lat = /([0-9\u00a0\u3040-\u30ff\u3400-\u9fff]{2})([^\u3040-\u30ff\u3400-\u9fff]{1,24})$/.exec(tail);
    if (lat && lat.index > 0) parts[lastIdx] = tail.slice(0, lat.index) + glue(lat[1]!) + "\u2060" + glue(lat[2]!) + trailing;
    return;
  }
  // Walk backwards over the block's text: [trailing space] last word, gap, previous word.
  let phase = 0; // 0 trailing space, 1 last word, 2 gap, 3 previous word
  let lastLen = 0, prevLen = 0;
  let gap: { k: number; from: number; to: number } | null = null;
  let more = false; // a word exists before the pair; a two-word block must stay breakable or it overflows narrow columns
  outer: for (let k = texts.length - 1; k >= 0; k--) {
    const t = parts[texts[k]!]!;
    for (let c = t.length - 1; c >= 0; c--) {
      const space = /\s/.test(t[c]!);
      if (phase === 0) { if (!space) { phase = 1; lastLen++; } }
      else if (phase === 1) { if (space) { phase = 2; gap = { k, from: c, to: c + 1 }; } else lastLen++; }
      else if (phase === 2) { if (space) { if (gap!.k === k) gap!.from = c; } else { phase = 3; prevLen++; } }
      else { if (space) { more = true; break outer; } prevLen++; }
    }
    // a gap that spans several tokens: only the last whitespace run is replaced, earlier ones stay
  }
  if (phase < 3 || !gap || !more || lastLen + prevLen + 1 > max) return;
  const idx = texts[gap.k]!;
  const t = parts[idx]!;
  parts[idx] = t.slice(0, gap.from) + "&nbsp;" + t.slice(gap.to);
  // "end-to-end", "20-20-20": a hyphen inside the last word is still a break point, so make it non-breaking (U+2011).
  if (gap.k === texts.length - 1 || idx !== lastIdx) {
    const lt = parts[lastIdx]!;
    const w = /([^\s;]+)(\s*)$/.exec(lt);
    if (w && /[\p{L}\p{N}]-[\p{L}\p{N}]/u.test(w[1]!) && !/[<>&]/.test(w[1]!) && w[1]!.length <= max - 8 && lastLen + prevLen + 1 <= 20) parts[lastIdx] = lt.slice(0, w.index) + w[1]!.replace(/(?<=[\p{L}\p{N}])-(?=[\p{L}\p{N}])/gu, "\u2011") + w[2];
  }
}

export const tidy = (h: string) => noOrphans(h.replace(/>\s*\n\s*</g, "><").replace(/\n\s*/g, " ").trim());

/** Character count as a human would count it (one per code point, so CJK counts per character). */
export const charLen = (s: string) => [...s].length;
