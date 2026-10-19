/**
 * Content hashing, export/import and share-link encoding.
 * Shared flows are sanitized (no local folders, favorites, image refs) and re-validated,
 * risk-scored and linted on import so a link can never smuggle unsafe content past the user.
 */
import { parseFlow, walkSteps, type Flow, type ValidationIssue } from "./schema.js";
import { analyzeRisk, type RiskReport } from "./risk.js";
import { lintFlow, type LintIssue } from "./lint.js";

/** JSON with sorted keys — identical content always hashes identically. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await globalThis.crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hash of the behaviour-relevant content (ignores timestamps, revision, favorite, folder). */
export async function flowContentHash(flow: Flow): Promise<string> {
  const { createdAt: _c, updatedAt: _u, revision: _r, favorite: _f, folder: _d, ...rest } = flow;
  return sha256Hex(stableStringify(rest));
}

export function sanitizeForSharing(flow: Flow): Flow {
  const copy: Flow = JSON.parse(JSON.stringify(flow));
  copy.favorite = false;
  delete copy.folder;
  walkSteps(copy.steps, (s) => {
    s.breakpoint = undefined;
    if (s.type === "findImage") s.target.ref = "";
    if ("target" in s && s.target && (s.target as { kind: string }).kind === "image") (s.target as { ref: string }).ref = "";
  });
  return copy;
}

export interface ExportEnvelope {
  format: "autoflow.flow";
  version: 1;
  exportedAt: string;
  hash: string;
  flow: Flow;
}

export async function exportFlow(flow: Flow): Promise<string> {
  const clean = sanitizeForSharing(flow);
  const env: ExportEnvelope = { format: "autoflow.flow", version: 1, exportedAt: new Date().toISOString(), hash: await flowContentHash(clean), flow: clean };
  return JSON.stringify(env, null, 2);
}

export interface ImportResult {
  ok: boolean;
  flow?: Flow;
  issues: ValidationIssue[];
  risk?: RiskReport;
  lint?: LintIssue[];
  hashMatches?: boolean;
}

const MAX_IMPORT_BYTES = 2_000_000;

export async function importFlow(text: string): Promise<ImportResult> {
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, issues: [{ path: "", message: "file too large" }] };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, issues: [{ path: "", message: "not valid JSON" }] };
  }
  const env = data as Partial<ExportEnvelope>;
  const raw = env && env.format === "autoflow.flow" ? env.flow : data;
  const parsed = parseFlow(raw);
  if (!parsed.ok) return { ok: false, issues: parsed.issues };
  const flow = sanitizeForSharing(parsed.flow);
  const hashMatches = env.hash ? (await flowContentHash(flow)) === env.hash : undefined;
  return { ok: true, flow, issues: [], risk: analyzeRisk(flow), lint: lintFlow(flow), hashMatches };
}

/* ----------------------------------------------------- base64url share codes */

function toB64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64Url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** Compact, URL-safe share code (deflate-raw + base64url). */
export async function encodeShareCode(flow: Flow): Promise<string> {
  const json = new TextEncoder().encode(stableStringify(sanitizeForSharing(flow)));
  return toB64Url(await pipe(json, new CompressionStream("deflate-raw")));
}

export async function decodeShareCode(code: string): Promise<ImportResult> {
  if (code.length > 200_000) return { ok: false, issues: [{ path: "", message: "share code too large" }] };
  try {
    const bytes = await pipe(fromB64Url(code), new DecompressionStream("deflate-raw"));
    if (bytes.length > MAX_IMPORT_BYTES) return { ok: false, issues: [{ path: "", message: "share code too large" }] };
    return importFlow(new TextDecoder().decode(bytes));
  } catch {
    return { ok: false, issues: [{ path: "", message: "invalid share code" }] };
  }
}
