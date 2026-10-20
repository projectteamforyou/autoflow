/**
 * Static risk analysis. Produces a 0–100 score, a grade and the reasons, so users see
 * what a flow can do before they run it or install a shared template.
 */
import type { Flow, Step } from "./schema.js";
import { walkSteps } from "./schema.js";

export type RiskLevel = "low" | "medium" | "high";

export interface RiskFinding {
  stepId?: string;
  /** i18n key, e.g. "risk.fileDelete". */
  key: string;
  weight: number;
  /** Requires an explicit confirmation before the run starts. */
  needsConfirm: boolean;
}

export interface RiskReport {
  score: number;
  level: RiskLevel;
  findings: RiskFinding[];
  needsConfirm: boolean;
  /** Permission labels shown on template cards and the pre-run sheet. */
  permissions: string[];
}

const SENSITIVE_URL = /(pay|checkout|bank|transfer|wallet|purchase|billing|order|captcha|login|signin|auth)/i;
/** `{{...}}` interpolation: the real target is only known at run time, so keyword checks can be dodged. */
const DYNAMIC = /\{\{/;

function isLocalIpv4(o: number[]): boolean {
  const [a, b] = o as [number, number];
  return a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/** Expands a WHATWG-serialized IPv6 host (no brackets) into 8 hextets, or null. */
function ipv6Hextets(h: string): number[] | null {
  const halves = h.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":").map((x) => (/^[0-9a-f]{1,4}$/i.test(x) ? parseInt(x, 16) : NaN)));
  const head = parse(halves[0]!);
  const tail = halves.length === 2 ? parse(halves[1]!) : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? fill !== 0 : fill < 0) return null;
  const out = [...head, ...new Array<number>(fill).fill(0), ...tail];
  return out.some((x) => Number.isNaN(x)) ? null : out;
}

/**
 * True when an http URL points at this machine or a private / link-local network
 * (localhost, 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, ::1, fc00::/7, fe80::/10):
 * routers, NAS boxes and local admin APIs a shared flow could poke. Uses the WHATWG URL parser,
 * the same one the Rust `url` crate implements, so `http://2130706433/` counts as 127.0.0.1.
 */
export function isLocalNetworkUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) return isLocalIpv4(v4.slice(1).map(Number));
  if (host.startsWith("[") && host.endsWith("]")) {
    const h = ipv6Hextets(host.slice(1, -1));
    if (!h) return false;
    const [h0, , , , , h5, h6, h7] = h as [number, number, number, number, number, number, number, number];
    if (h.slice(0, 7).every((x) => x === 0) && (h7 === 0 || h7 === 1)) return true; // :: and ::1
    if ((h0 & 0xfe00) === 0xfc00 || (h0 & 0xffc0) === 0xfe80) return true; // unique local, link-local
    if (h.slice(0, 5).every((x) => x === 0) && h5 === 0xffff) return isLocalIpv4([h6 >> 8, h6 & 0xff, h7 >> 8, h7 & 0xff]); // ::ffff:a.b.c.d
  }
  return false;
}

function stepFindings(s: Step): RiskFinding[] {
  const f: RiskFinding[] = [];
  switch (s.type) {
    case "file":
      if (s.op === "delete") f.push({ stepId: s.id, key: "risk.fileDelete", weight: 35, needsConfirm: true });
      else if (s.op === "write" || s.op === "move") f.push({ stepId: s.id, key: "risk.fileWrite", weight: 20, needsConfirm: true });
      // append grows/creates files and copy can overwrite its destination: both change files.
      else if (s.op === "append" || s.op === "copy") f.push({ stepId: s.id, key: "risk.fileWrite", weight: 12, needsConfirm: true });
      else f.push({ stepId: s.id, key: "risk.fileRead", weight: 6, needsConfirm: false });
      break;
    case "http":
      if (s.method === "GET") f.push({ stepId: s.id, key: "risk.networkRead", weight: 8, needsConfirm: false });
      else f.push({ stepId: s.id, key: "risk.networkSend", weight: 25, needsConfirm: true });
      if (SENSITIVE_URL.test(s.url)) f.push({ stepId: s.id, key: "risk.sensitiveUrl", weight: 20, needsConfirm: true });
      if (DYNAMIC.test(s.url)) f.push({ stepId: s.id, key: "risk.dynamicUrl", weight: 10, needsConfirm: true });
      // Even a GET leaks whatever variables or secrets are interpolated into its headers.
      if (Object.values(s.headers ?? {}).some((v) => DYNAMIC.test(v))) f.push({ stepId: s.id, key: "risk.requestVars", weight: 10, needsConfirm: true });
      if (isLocalNetworkUrl(s.url)) f.push({ stepId: s.id, key: "risk.localNetwork", weight: 15, needsConfirm: true });
      break;
    case "launchApp":
      f.push({ stepId: s.id, key: "risk.launchApp", weight: 10, needsConfirm: false });
      break;
    case "openUrl":
      if (SENSITIVE_URL.test(s.url)) f.push({ stepId: s.id, key: "risk.sensitiveUrl", weight: 15, needsConfirm: true });
      if (DYNAMIC.test(s.url)) f.push({ stepId: s.id, key: "risk.dynamicUrl", weight: 10, needsConfirm: true });
      break;
    case "type":
      if (/\{\{\s*secret:/.test(s.text)) f.push({ stepId: s.id, key: "risk.secretInput", weight: 10, needsConfirm: false });
      break;
    case "window":
      if (s.op === "close") f.push({ stepId: s.id, key: "risk.windowClose", weight: 12, needsConfirm: false });
      break;
    case "androidGlobal":
      if (s.action === "lockScreen" || s.action === "powerDialog") f.push({ stepId: s.id, key: "risk.systemAction", weight: 10, needsConfirm: false });
      break;
    case "clipboard":
      if (s.op === "get") f.push({ stepId: s.id, key: "risk.clipboardRead", weight: 8, needsConfirm: false });
      break;
    case "ocr":
    case "findImage":
    case "pixelCheck":
    case "waitForPixel":
    case "matchScene":
      f.push({ stepId: s.id, key: "risk.screenRead", weight: 8, needsConfirm: false });
      break;
    case "loop":
      if (s.mode === "forever") f.push({ stepId: s.id, key: "risk.foreverLoop", weight: 5, needsConfirm: false });
      break;
    default:
      break;
  }
  if ((s.type === "if" || s.type === "waitFor" || s.type === "loop") && (s.condition?.scene || s.condition?.pixel)) {
    f.push({ stepId: s.id, key: "risk.screenRead", weight: 8, needsConfirm: false });
  }
  return f;
}

const PERMISSION_OF: Partial<Record<Step["type"], string>> = {
  click: "perm.input",
  move: "perm.input",
  drag: "perm.input",
  scroll: "perm.input",
  key: "perm.input",
  type: "perm.input",
  clipboard: "perm.clipboard",
  launchApp: "perm.apps",
  openUrl: "perm.browser",
  window: "perm.windows",
  http: "perm.network",
  file: "perm.files",
  ocr: "perm.screen",
  findImage: "perm.screen",
  pixelCheck: "perm.screen",
  waitForPixel: "perm.screen",
  matchScene: "perm.screen",
  notify: "perm.notifications",
  androidGlobal: "perm.accessibility",
};

export function analyzeRisk(flow: Pick<Flow, "steps" | "trigger" | "limits"> & Partial<Pick<Flow, "stage">>): RiskReport {
  const findings: RiskFinding[] = [];
  const perms = new Set<string>();
  walkSteps(flow.steps, (s) => {
    if (s.disabled) return;
    findings.push(...stepFindings(s));
    const p = PERMISSION_OF[s.type];
    if (p) perms.add(p);
    if ((s.type === "if" || s.type === "waitFor" || s.type === "loop") && (s.condition?.scene || s.condition?.pixel)) perms.add("perm.screen");
  });
  // Stage mode without the takeover pause keeps clicking even while the user grabs the mouse.
  if (flow.stage && flow.stage.pauseOnTakeover === false) findings.push({ key: "risk.stageNoTakeover", weight: 12, needsConfirm: false });
  if (flow.trigger.type === "location") {
    findings.push({ key: "risk.location", weight: 10, needsConfirm: false });
    perms.add("perm.location");
  }
  if (flow.trigger.type === "notification") {
    findings.push({ key: "risk.notificationRead", weight: 10, needsConfirm: false });
    perms.add("perm.notificationAccess");
  }
  if (flow.trigger.type !== "manual" && flow.trigger.type !== "hotkey") findings.push({ key: "risk.unattended", weight: 8, needsConfirm: false });
  if (flow.limits.maxDurationMs > 3_600_000) findings.push({ key: "risk.longRun", weight: 5, needsConfirm: false });

  const score = Math.min(100, findings.reduce((a, f) => a + f.weight, 0));
  const level: RiskLevel = score >= 40 ? "high" : score >= 15 ? "medium" : "low";
  return { score, level, findings, needsConfirm: findings.some((f) => f.needsConfirm), permissions: [...perms].sort() };
}
