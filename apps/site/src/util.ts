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
 * Orphan control: the last two words of every text block are joined with a no-break space, so a block never ends
 * with one lonely word (or Korean eojeol) on its own line. Only short pairs are joined, so narrow screens never
 * overflow; CSS text-wrap: pretty/balance does the rest where the browser supports it.
 */
export const noOrphans = (h: string) =>
  h.replace(/(^|[\s>])([^\s<>]{1,14}) ([^\s<>]{1,12})(<\/(?:p|li|h[1-6]|dd|dt|summary|figcaption|td|th|blockquote|label)>)/g, "$1$2&nbsp;$3$4");

export const tidy = (h: string) => noOrphans(h.replace(/>\s*\n\s*</g, "><").replace(/\n\s*/g, " ").trim());

/** Character count as a human would count it (one per code point, so CJK counts per character). */
export const charLen = (s: string) => [...s].length;
