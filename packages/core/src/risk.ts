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

function stepFindings(s: Step): RiskFinding[] {
  const f: RiskFinding[] = [];
  switch (s.type) {
    case "file":
      if (s.op === "delete") f.push({ stepId: s.id, key: "risk.fileDelete", weight: 35, needsConfirm: true });
      else if (s.op === "write" || s.op === "move") f.push({ stepId: s.id, key: "risk.fileWrite", weight: 20, needsConfirm: true });
      else if (s.op === "append" || s.op === "copy") f.push({ stepId: s.id, key: "risk.fileWrite", weight: 12, needsConfirm: false });
      else f.push({ stepId: s.id, key: "risk.fileRead", weight: 6, needsConfirm: false });
      break;
    case "http":
      if (s.method === "GET") f.push({ stepId: s.id, key: "risk.networkRead", weight: 8, needsConfirm: false });
      else f.push({ stepId: s.id, key: "risk.networkSend", weight: 25, needsConfirm: true });
      if (SENSITIVE_URL.test(s.url)) f.push({ stepId: s.id, key: "risk.sensitiveUrl", weight: 20, needsConfirm: true });
      break;
    case "launchApp":
      f.push({ stepId: s.id, key: "risk.launchApp", weight: 10, needsConfirm: false });
      break;
    case "openUrl":
      if (SENSITIVE_URL.test(s.url)) f.push({ stepId: s.id, key: "risk.sensitiveUrl", weight: 15, needsConfirm: true });
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
