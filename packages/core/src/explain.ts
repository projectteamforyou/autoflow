/**
 * Plain-language explanation of a flow, without AI. Produces i18n descriptors
 * ({ key, params }) that each surface renders in the user's language, plus an
 * English renderer used for logs, exports and as a fallback.
 */
import type { Flow, Step, Target, Trigger } from "./schema.js";
import { hotkeyToString } from "./engine.js";

export interface Phrase {
  key: string;
  params: Record<string, string | number>;
}

export interface ExplainLine {
  depth: number;
  stepId?: string;
  phrase: Phrase;
}

const p = (key: string, params: Record<string, string | number> = {}): Phrase => ({ key, params });

export function describeTarget(t: Target): Phrase {
  switch (t.kind) {
    case "point":
      return t.space === "normalized" ? p("target.normalized", { x: Math.round(t.x * 100), y: Math.round(t.y * 100) }) : p(`target.point.${t.space}`, { x: Math.round(t.x), y: Math.round(t.y) });
    case "current":
      return p("target.current");
    case "region":
      return p("target.region", { x: Math.round(t.x), y: Math.round(t.y), w: Math.round(t.w), h: Math.round(t.h) });
    case "element":
      return p("target.element", { name: t.selector.name ?? t.selector.text ?? t.selector.automationId ?? t.selector.role ?? "?" });
    case "image":
      return p("target.image", { ref: t.ref });
  }
}

export function describeStep(s: Step): Phrase {
  switch (s.type) {
    case "click":
      return p(s.holdMs > 0 ? "explain.hold" : s.clicks === 2 ? "explain.doubleClick" : "explain.click", { button: s.button, target: renderEn(describeTarget(s.target)), ms: s.holdMs });
    case "move":
      return p("explain.move", { target: renderEn(describeTarget(s.target)) });
    case "drag":
      return p("explain.drag", { from: renderEn(describeTarget(s.from)), to: renderEn(describeTarget(s.to)) });
    case "scroll":
      return p("explain.scroll", { dx: s.dx, dy: s.dy });
    case "key":
      return p(`explain.key.${s.action}`, { key: hotkeyToString({ key: s.key, modifiers: s.modifiers }), n: s.repeat });
    case "type":
      return p("explain.type", { text: s.text.length > 40 ? `${s.text.slice(0, 40)}…` : s.text });
    case "wait":
      return p(s.jitterMs ? "explain.waitJitter" : "explain.wait", { s: fmtSec(s.ms), j: fmtSec(s.jitterMs) });
    case "waitFor":
      return p("explain.waitFor", { expr: s.condition.expr, s: fmtSec(s.timeoutMs) });
    case "setVar":
      return p("explain.setVar", { name: s.name, value: s.value });
    case "log":
      return p("explain.log", { message: s.message });
    case "notify":
      return p("explain.notify", { title: s.title });
    case "confirm":
      return p("explain.confirm", { message: s.message });
    case "clipboard":
      return p(s.op === "set" ? "explain.clipboardSet" : "explain.clipboardGet", { var: s.var ?? "" });
    case "launchApp":
      return p("explain.launchApp", { app: s.app });
    case "openUrl":
      return p("explain.openUrl", { url: s.url });
    case "window":
      return p(`explain.window.${s.op}`, { title: s.match.title ?? s.match.app ?? "" });
    case "androidGlobal":
      return p(`explain.android.${s.action}`);
    case "http":
      return p("explain.http", { method: s.method, url: s.url });
    case "file":
      return p(`explain.file.${s.op}`, { path: s.path });
    case "ocr":
      return p("explain.ocr", { var: s.resultVar });
    case "findImage":
      return p("explain.findImage", { ref: s.target.ref });
    case "runFlow":
      return p("explain.runFlow", { id: s.flowId });
    case "switchProfile":
      return p("explain.switchProfile", { id: s.profileId });
    case "stop":
      return p("explain.stop");
    case "break":
      return p("explain.break");
    case "continue":
      return p("explain.continue");
    case "if":
      return p("explain.if", { expr: s.condition.expr });
    case "loop":
      return s.mode === "count" ? p("explain.loopCount", { n: s.count ?? 0 }) : s.mode === "while" ? p("explain.loopWhile", { expr: s.condition?.expr ?? "" }) : p("explain.loopForever");
    case "forEach":
      return p("explain.forEach", { item: s.itemVar, list: s.list });
    case "try":
      return p("explain.try");
    case "group":
      return p("explain.group", { name: s.name });
  }
}

export function describeTrigger(t: Trigger): Phrase {
  switch (t.type) {
    case "manual":
      return p("trigger.manual");
    case "hotkey":
      return p("trigger.hotkey", { key: hotkeyToString(t.hotkey) });
    case "schedule":
      return t.cron ? p("trigger.cron", { cron: t.cron }) : p("trigger.every", { s: fmtSec(t.everyMs ?? 0) });
    case "appEvent":
      return p(`trigger.app.${t.event}`, { app: t.app });
    case "deviceEvent":
      return p(`trigger.device.${t.event}`);
    case "location":
      return p(`trigger.location.${t.on}`, { r: t.radiusM });
    case "notification":
      return p("trigger.notification", { app: t.app });
  }
}

export function explainFlow(flow: Flow): ExplainLine[] {
  const out: ExplainLine[] = [{ depth: 0, phrase: describeTrigger(flow.trigger) }];
  const walk = (list: Step[], depth: number) => {
    for (const s of list) {
      if (s.disabled) continue;
      out.push({ depth, stepId: s.id, phrase: s.label ? p("explain.label", { label: s.label }) : describeStep(s) });
      if (s.type === "if") {
        walk(s.then, depth + 1);
        if (s.else.length) {
          out.push({ depth, phrase: p("explain.else") });
          walk(s.else, depth + 1);
        }
      } else if (s.type === "try") {
        walk(s.body, depth + 1);
        out.push({ depth, phrase: p("explain.catch") });
        walk(s.catch, depth + 1);
      } else if (s.type === "loop" || s.type === "forEach" || s.type === "group") walk(s.body, depth + 1);
    }
  };
  walk(flow.steps, 1);
  out.push({ depth: 0, phrase: p("explain.limits", { s: fmtSec(flow.limits.maxDurationMs), stop: hotkeyToString(flow.hotkeys.stop) }) });
  return out;
}

function fmtSec(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${Number.isInteger(s) ? s : s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  if (m < 60) return r ? `${m}m ${r}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

/** English templates — the canonical copy; UI dictionaries translate the same keys. */
export const EXPLAIN_EN: Record<string, string> = {
  "target.normalized": "{x}% across, {y}% down the screen",
  "target.point.screen": "screen point ({x}, {y})",
  "target.point.window": "window point ({x}, {y})",
  "target.current": "the current pointer position",
  "target.region": "area ({x}, {y}) {w}×{h}",
  "target.element": "the “{name}” control",
  "target.image": "the image “{ref}”",
  "explain.click": "Click {button} at {target}",
  "explain.doubleClick": "Double-click {button} at {target}",
  "explain.hold": "Press and hold {button} at {target} for {ms} ms",
  "explain.move": "Move the pointer to {target}",
  "explain.drag": "Drag from {from} to {to}",
  "explain.scroll": "Scroll by ({dx}, {dy})",
  "explain.key.press": "Press {key} ×{n}",
  "explain.key.down": "Hold down {key}",
  "explain.key.up": "Release {key}",
  "explain.type": "Type “{text}”",
  "explain.wait": "Wait {s}",
  "explain.waitJitter": "Wait {s} (+ up to {j} variation)",
  "explain.waitFor": "Wait until {expr} (up to {s})",
  "explain.setVar": "Set {name} = {value}",
  "explain.log": "Write to the run log: {message}",
  "explain.notify": "Show notification “{title}”",
  "explain.confirm": "Ask: “{message}”",
  "explain.clipboardSet": "Copy text to the clipboard",
  "explain.clipboardGet": "Read the clipboard into {var}",
  "explain.launchApp": "Open app {app}",
  "explain.openUrl": "Open {url}",
  "explain.window.focus": "Focus window {title}",
  "explain.window.minimize": "Minimize window {title}",
  "explain.window.maximize": "Maximize window {title}",
  "explain.window.restore": "Restore window {title}",
  "explain.window.close": "Close window {title}",
  "explain.window.move": "Move window {title}",
  "explain.window.resize": "Resize window {title}",
  "explain.android.back": "Press Back",
  "explain.android.home": "Go Home",
  "explain.android.recents": "Open Recents",
  "explain.android.notifications": "Open notifications",
  "explain.android.quickSettings": "Open quick settings",
  "explain.android.lockScreen": "Lock the screen",
  "explain.android.screenshot": "Take a screenshot",
  "explain.android.powerDialog": "Open the power menu",
  "explain.http": "Send {method} request to {url}",
  "explain.file.read": "Read file {path}",
  "explain.file.write": "Write file {path}",
  "explain.file.append": "Append to file {path}",
  "explain.file.copy": "Copy file {path}",
  "explain.file.move": "Move file {path}",
  "explain.file.delete": "Delete file {path}",
  "explain.file.exists": "Check whether {path} exists",
  "explain.ocr": "Read text on screen into {var}",
  "explain.findImage": "Find image “{ref}” on screen",
  "explain.runFlow": "Run flow {id}",
  "explain.switchProfile": "Switch input profile to {id}",
  "explain.stop": "Stop",
  "explain.break": "Leave the loop",
  "explain.continue": "Skip to the next loop round",
  "explain.if": "If {expr}:",
  "explain.else": "Otherwise:",
  "explain.loopCount": "Repeat {n} times:",
  "explain.loopWhile": "Repeat while {expr}:",
  "explain.loopForever": "Repeat until stopped:",
  "explain.forEach": "For each {item} in {list}:",
  "explain.try": "Try:",
  "explain.catch": "If something fails:",
  "explain.group": "{name}",
  "explain.label": "{label}",
  "explain.limits": "Stops automatically after {s} · emergency stop {stop}",
  "trigger.manual": "When you press Run",
  "trigger.hotkey": "When you press {key}",
  "trigger.cron": "On schedule ({cron})",
  "trigger.every": "Every {s}",
  "trigger.app.launched": "When {app} opens",
  "trigger.app.closed": "When {app} closes",
  "trigger.app.focused": "When {app} comes to the front",
  "trigger.device.charging": "When charging starts",
  "trigger.device.batteryLow": "When the battery is low",
  "trigger.device.wifiConnected": "When Wi-Fi connects",
  "trigger.device.wifiDisconnected": "When Wi-Fi disconnects",
  "trigger.device.bluetoothConnected": "When a Bluetooth device connects",
  "trigger.device.headsetPlugged": "When a headset is plugged in",
  "trigger.device.bootCompleted": "When the device starts",
  "trigger.device.deviceConnected": "When an input device connects",
  "trigger.device.deviceDisconnected": "When an input device disconnects",
  "trigger.location.enter": "When you arrive (within {r} m)",
  "trigger.location.exit": "When you leave (beyond {r} m)",
  "trigger.notification": "When {app} posts a notification",
};

export function renderEn(ph: Phrase): string {
  return format(EXPLAIN_EN[ph.key] ?? ph.key, ph.params);
}

export function format(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (params[k] !== undefined ? String(params[k]) : `{${k}}`));
}

export function explainFlowEn(flow: Flow): string {
  return explainFlow(flow)
    .map((l) => `${"  ".repeat(l.depth)}${renderEn(l.phrase)}`)
    .join("\n");
}
