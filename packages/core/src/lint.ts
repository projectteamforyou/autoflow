/**
 * Flow linter: catches mistakes before a run (Pro editor gutter + template publishing gate).
 */
import type { Condition, DisplayRef, Flow, Step, Target } from "./schema.js";
import { walkSteps, childLists } from "./schema.js";
import { checkExpr, referencedVars, scanPlaceholders } from "./expr.js";

export type LintSeverity = "error" | "warning" | "info";

export interface LintIssue {
  severity: LintSeverity;
  stepId?: string;
  /** i18n key, e.g. "lint.unknownVar". */
  key: string;
  params?: Record<string, string | number>;
}

const RESERVED_VARS = new Set(["__easyStart"]);

export function lintFlow(flow: Flow, opts: { knownFlowIds?: string[] } = {}): LintIssue[] {
  const out: LintIssue[] = [];
  const declared = new Set<string>([...flow.variables.map((v) => v.name), ...RESERVED_VARS]);
  const topIds = new Set(flow.steps.map((s) => s.id));

  // Collect variables assigned anywhere (setVar, loop index, forEach item, resultVars).
  walkSteps(flow.steps, (s) => {
    if (s.type === "setVar") declared.add(s.name);
    if (s.type === "loop" && s.indexVar) declared.add(s.indexVar);
    if (s.type === "forEach") declared.add(s.itemVar);
    if (s.type === "try" && s.errorVar) declared.add(s.errorVar);
    if ("resultVar" in s && s.resultVar) declared.add(s.resultVar);
    if (s.type === "clipboard" && s.var) declared.add(s.var);
    if (s.type === "matchScene" && s.similarityVar) declared.add(s.similarityVar);
  });
  const sceneNames = new Set((flow.scenes ?? []).map((sc) => sc.name));
  const checkScene = (s: Step, name: string) => {
    if (!sceneNames.has(name)) out.push({ severity: "error", stepId: s.id, key: "lint.sceneMissing", params: { name } });
  };
  const checkCondition = (s: Step, c: Condition) => {
    checkExprField(s, c.expr);
    if (c.scene) checkScene(s, c.scene.name);
  };

  if (flow.steps.filter((s) => !s.disabled).length === 0) out.push({ severity: "warning", key: "lint.empty" });

  const checkExprField = (s: Step, src: string) => {
    const err = checkExpr(src);
    if (err) {
      out.push({ severity: "error", stepId: s.id, key: "lint.badExpr", params: { error: err } });
      return;
    }
    for (const v of referencedVars(src)) if (!declared.has(v)) out.push({ severity: "warning", stepId: s.id, key: "lint.unknownVar", params: { name: v } });
  };
  const checkText = (s: Step, text: string) => {
    for (const p of scanPlaceholders(text)) if (!p.inner.startsWith("secret:")) checkExprField(s, p.inner);
  };

  const visit = (list: Step[], inLoop: boolean) => {
    let afterStop = false;
    for (const s of list) {
      if (s.disabled) continue;
      if (afterStop) out.push({ severity: "warning", stepId: s.id, key: "lint.unreachable" });
      switch (s.type) {
        case "if":
          checkCondition(s, s.condition);
          if (!s.then.length && !s.else.length) out.push({ severity: "info", stepId: s.id, key: "lint.emptyBranch" });
          break;
        case "loop":
          if (s.mode === "while" && s.condition) checkCondition(s, s.condition);
          if (!s.body.length) out.push({ severity: "warning", stepId: s.id, key: "lint.emptyLoop" });
          if ((s.mode === "forever" || s.mode === "while") && !s.cooldownMs && !containsWait(s.body)) out.push({ severity: "warning", stepId: s.id, key: "lint.loopNoWait" });
          if (s.mode === "count" && (s.count ?? 0) > flow.limits.maxIterations) out.push({ severity: "warning", stepId: s.id, key: "lint.loopOverLimit", params: { count: s.count ?? 0, limit: flow.limits.maxIterations } });
          break;
        case "forEach":
          checkExprField(s, s.list);
          break;
        case "waitFor":
          checkCondition(s, s.condition);
          break;
        case "waitForPixel":
          if (s.timeoutMs === undefined) out.push({ severity: "warning", stepId: s.id, key: "lint.pixelNoTimeout" });
          break;
        case "matchScene":
          for (const name of s.scenes ?? []) checkScene(s, name);
          if (!s.scenes && sceneNames.size === 0) out.push({ severity: "error", stepId: s.id, key: "lint.noScenes" });
          break;
        case "setVar":
          checkExprField(s, s.value);
          break;
        case "type":
          checkText(s, s.text);
          if (/password|passwd|비밀번호|パスワード|密码|contraseña|mot de passe|passwort|пароль|senha|mật khẩu|kata sandi/i.test(s.label ?? "") && !/\{\{\s*secret:/.test(s.text)) out.push({ severity: "warning", stepId: s.id, key: "lint.plainPassword" });
          break;
        case "log":
        case "notify":
        case "confirm":
          checkText(s, s.type === "log" ? s.message : s.type === "notify" ? `${s.title} ${s.body}` : s.message);
          break;
        case "wait":
          if (s.ms < 10 && inLoop) out.push({ severity: "info", stepId: s.id, key: "lint.tinyWait" });
          break;
        case "break":
        case "continue":
          if (!inLoop) out.push({ severity: "error", stepId: s.id, key: "lint.breakOutsideLoop" });
          break;
        case "runFlow":
          if (s.flowId === flow.id) out.push({ severity: "error", stepId: s.id, key: "lint.selfCall" });
          else if (opts.knownFlowIds && !opts.knownFlowIds.includes(s.flowId)) out.push({ severity: "error", stepId: s.id, key: "lint.unknownFlow", params: { id: s.flowId } });
          break;
        case "stop":
          afterStop = true;
          break;
        default:
          break;
      }
      if (s.onError?.strategy === "goto" && (!s.onError.gotoStepId || !topIds.has(s.onError.gotoStepId))) out.push({ severity: "error", stepId: s.id, key: "lint.badGoto" });
      const loopish = s.type === "loop" || s.type === "forEach";
      for (const child of childLists(s)) visit(child, inLoop || loopish);
    }
  };
  visit(flow.steps, false);

  // Any display other than the primary can be unplugged: make the fallback an explicit choice.
  if (flow.onMissingDisplay === undefined) {
    const other = displayRefs(flow).find((r) => r !== "primary" && !(typeof r === "object" && r.index === 0));
    if (other !== undefined) out.push({ severity: "warning", key: "lint.displayNoFallback", params: { display: typeof other === "object" ? `#${other.index + 1}` : other } });
  }

  if (!flow.hotkeys.stop) out.push({ severity: "error", key: "lint.noStopHotkey" });
  if (flow.trigger.type === "schedule" && !flow.trigger.cron && !flow.trigger.everyMs) out.push({ severity: "error", key: "lint.scheduleEmpty" });
  return out;
}

function containsWait(list: Step[]): boolean {
  let found = false;
  walkSteps(list, (s) => {
    if (!s.disabled && (s.type === "wait" || s.type === "waitFor" || s.type === "waitForPixel" || s.type === "confirm" || (s.type === "loop" && !!s.cooldownMs))) found = true;
  });
  return found;
}

/** Every display reference in a flow (stage, scenes, targets, probes and display-scoped steps). */
export function displayRefs(flow: Pick<Flow, "steps"> & Partial<Pick<Flow, "stage" | "scenes">>): DisplayRef[] {
  const refs: DisplayRef[] = [];
  const add = (r: DisplayRef | undefined) => {
    if (r !== undefined) refs.push(r);
  };
  const target = (t: Target | undefined) => {
    if (t && (t.kind === "point" || t.kind === "region" || t.kind === "image")) add(t.display);
  };
  add(flow.stage?.display);
  for (const sc of flow.scenes ?? []) add(sc.display);
  walkSteps(flow.steps, (s) => {
    if (s.disabled) return;
    if (s.type === "click" || s.type === "move" || s.type === "scroll" || s.type === "findImage") target(s.target);
    if (s.type === "drag") {
      target(s.from);
      target(s.to);
    }
    if (s.type === "ocr") add(s.display);
    if (s.type === "pixelCheck" || s.type === "waitForPixel") add(s.at.display);
    if ((s.type === "if" || s.type === "waitFor" || s.type === "loop") && s.condition?.pixel) add(s.condition.pixel.at.display);
  });
  return refs;
}
