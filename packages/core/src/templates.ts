/**
 * Atlas — the official template library. Each template is a complete, validated flow with
 * category, platforms, required permissions (derived from risk analysis) and a verified date.
 * Names/descriptions are i18n keys (`tpl.<id>.name` / `tpl.<id>.desc`) with English defaults.
 */
import { FlowSchema, SCHEMA_VERSION, type Flow, type FlowInput, type Platform } from "./schema.js";
import { analyzeRisk } from "./risk.js";
import { PRACTICE_BUTTONS, PRACTICE_SCENE_REGION, practiceSceneHash } from "./practice.js";

export type TemplateCategory = "clicking" | "keyboard" | "office" | "accessibility" | "testing" | "mobile" | "developer" | "wellbeing" | "gaming";

export interface Template {
  id: string;
  category: TemplateCategory;
  platforms: Platform[];
  name: string;
  description: string;
  verifiedAt: string;
  author: "AutoFlow";
  difficulty: "easy" | "pro";
  flow: Flow;
}

const VERIFIED = "2026-10-19T00:00:00.000Z";

function t(id: string, category: TemplateCategory, difficulty: "easy" | "pro", name: string, description: string, f: Omit<FlowInput, "schemaVersion" | "id" | "name" | "createdAt" | "updatedAt">): Template {
  const flow = FlowSchema.parse({ schemaVersion: SCHEMA_VERSION, id: `tpl_${id}`, name, description, createdAt: VERIFIED, updatedAt: VERIFIED, ...f });
  return { id, category, platforms: flow.targets, name, description, verifiedAt: VERIFIED, author: "AutoFlow", difficulty, flow };
}

const center = { kind: "point", x: 0.5, y: 0.5, space: "normalized" } as const;

/** Centre of a practice-game button (normalized on the stage display). */
const buttonCenter = (b: { x: number; y: number; w: number; h: number }) => ({ kind: "point", x: +(b.x + b.w / 2).toFixed(4), y: +(b.y + b.h / 2).toFixed(4), space: "normalized" }) as const;
/** Scenes of the Practice Canvas idle game, remembered over the area below its title bar. */
const practiceScenes = (["lobby", "battle", "reward"] as const).map((name) => ({ name, region: PRACTICE_SCENE_REGION, hash: practiceSceneHash(name) }));

export const TEMPLATES: Template[] = [
  t("auto-clicker", "clicking", "easy", "Classic auto clicker", "Left-click the centre of the screen 100 times, 4 times a second. Ctrl+Alt+Esc stops it.", {
    icon: "cursor",
    color: "#7C5CFF",
    mode: "easy",
    steps: [{ id: "loop", type: "loop", mode: "count", count: 100, body: [{ id: "c", type: "click", target: center, button: "left", clicks: 1, holdMs: 0, modifiers: [] }, { id: "w", type: "wait", ms: 250, jitterMs: 0 }] }],
  }),
  t("multi-point", "clicking", "easy", "Three-point click cycle", "Click three positions in order, then repeat until you stop it.", {
    icon: "target",
    color: "#22C3A6",
    mode: "easy",
    steps: [
      {
        id: "loop",
        type: "loop",
        mode: "forever",
        body: [
          { id: "c1", type: "click", target: { kind: "point", x: 0.3, y: 0.4, space: "normalized" }, button: "left", clicks: 1, holdMs: 0, modifiers: [] },
          { id: "w1", type: "wait", ms: 500, jitterMs: 0 },
          { id: "c2", type: "click", target: { kind: "point", x: 0.5, y: 0.4, space: "normalized" }, button: "left", clicks: 1, holdMs: 0, modifiers: [] },
          { id: "w2", type: "wait", ms: 500, jitterMs: 0 },
          { id: "c3", type: "click", target: { kind: "point", x: 0.7, y: 0.4, space: "normalized" }, button: "left", clicks: 1, holdMs: 0, modifiers: [] },
          { id: "w3", type: "wait", ms: 500, jitterMs: 0 },
        ],
      },
    ],
  }),
  t("hold-to-repeat", "keyboard", "easy", "Key repeater", "Press Space every 200 ms for 5 minutes — handy for testing or long presses you would otherwise hold.", {
    icon: "keyboard",
    color: "#F59E0B",
    mode: "easy",
    steps: [
      { id: "start", type: "setVar", name: "__easyStart", value: "now()" },
      { id: "loop", type: "loop", mode: "while", condition: { expr: "now() - __easyStart < 300000" }, body: [{ id: "k", type: "key", key: "Space", modifiers: [], action: "press", repeat: 1 }, { id: "w", type: "wait", ms: 200, jitterMs: 0 }] },
    ],
    limits: { maxDurationMs: 360_000 },
  }),
  t("signature", "office", "easy", "Email signature", "Types your signature with today's date. Bind it to a hotkey for one-press replies.", {
    icon: "pen",
    color: "#3B82F6",
    mode: "pro",
    trigger: { type: "hotkey", hotkey: { key: "S", modifiers: ["ctrl", "alt"] }, scope: "global" },
    variables: [{ name: "name", type: "string", initial: "Your Name" }],
    steps: [{ id: "t", type: "type", text: "Best regards,\n{{name}}\n{{date()}}", perCharDelayMs: 0 }],
    limits: { countdownMs: 0 },
  }),
  t("form-filler", "office", "pro", "CSV row form filler", "Fills a form once per row of a list: types each value, presses Tab between fields and Enter at the end, with a confirmation before each submit.", {
    icon: "table",
    color: "#10B981",
    mode: "pro",
    variables: [{ name: "rows", type: "string", initial: "Alice;alice@example.com|Bob;bob@example.com", prompt: "Rows (fields separated by ; and rows by |)" }],
    steps: [
      {
        id: "each",
        type: "forEach",
        list: "split(rows, \"|\")",
        itemVar: "row",
        body: [
          { id: "f", type: "setVar", name: "fields", value: "split(row, \";\")" },
          { id: "n", type: "type", text: "{{fields[0]}}", perCharDelayMs: 10 },
          { id: "tab", type: "key", key: "Tab", modifiers: [], action: "press", repeat: 1 },
          { id: "e", type: "type", text: "{{fields[1]}}", perCharDelayMs: 10 },
          { id: "ok", type: "confirm", message: "Submit {{fields[0]}}?", resultVar: "submit" },
          { id: "if", type: "if", condition: { expr: "submit" }, then: [{ id: "enter", type: "key", key: "Enter", modifiers: [], action: "press", repeat: 1 }], else: [] },
          { id: "w", type: "wait", ms: 1500, jitterMs: 0 },
        ],
      },
    ],
  }),
  t("break-reminder", "wellbeing", "easy", "20-20-20 eye break", "Every 20 minutes, reminds you to look 20 feet away for 20 seconds.", {
    icon: "eye",
    color: "#EC4899",
    mode: "pro",
    trigger: { type: "schedule", everyMs: 1_200_000 },
    steps: [{ id: "n", type: "notify", title: "Eye break", body: "Look at something 20 feet (6 m) away for 20 seconds." }],
    limits: { countdownMs: 0 },
  }),
  t("anti-idle-test", "testing", "pro", "Session keep-alive check", "Moves the pointer slightly once a minute while a long upload or render finishes, then stops after 2 hours. Visible in the run bar at all times.", {
    icon: "pulse",
    color: "#6366F1",
    targets: ["windows", "web"],
    mode: "pro",
    steps: [
      {
        id: "loop",
        type: "loop",
        mode: "forever",
        body: [
          { id: "m1", type: "move", target: { kind: "point", x: 0.5, y: 0.5, space: "normalized" }, durationMs: 200 },
          { id: "m2", type: "move", target: { kind: "point", x: 0.51, y: 0.5, space: "normalized" }, durationMs: 200 },
          { id: "w", type: "wait", ms: 60_000, jitterMs: 0 },
        ],
      },
    ],
    limits: { maxDurationMs: 7_200_000 },
  }),
  t("ui-smoke", "testing", "pro", "UI smoke test with retries", "Clicks through a sequence, retries failed steps three times and logs each stage — a starting point for repeatable manual-test passes.", {
    icon: "flask",
    color: "#14B8A6",
    mode: "pro",
    steps: [
      { id: "l1", type: "log", message: "Smoke test started at {{time()}}", level: "info" },
      {
        id: "try",
        type: "try",
        errorVar: "err",
        body: [
          { id: "c1", type: "click", target: { kind: "point", x: 0.2, y: 0.1, space: "normalized" }, button: "left", clicks: 1, holdMs: 0, modifiers: [], onError: { strategy: "retry", retries: 3, backoffMs: 500 } },
          { id: "w1", type: "wait", ms: 800, jitterMs: 0 },
          { id: "c2", type: "click", target: { kind: "point", x: 0.5, y: 0.6, space: "normalized" }, button: "left", clicks: 1, holdMs: 0, modifiers: [], onError: { strategy: "retry", retries: 3, backoffMs: 500 } },
        ],
        catch: [{ id: "l2", type: "log", message: "Failed: {{err}}", level: "error" }, { id: "n", type: "notify", title: "Smoke test failed", body: "{{err}}" }],
      },
      { id: "l3", type: "log", message: "Smoke test finished", level: "info" },
    ],
  }),
  t("scroll-reader", "accessibility", "easy", "Hands-free reader", "Scrolls down a little every 4 seconds so you can read long pages without touching the mouse.", {
    icon: "book",
    color: "#8B5CF6",
    mode: "pro",
    steps: [{ id: "loop", type: "loop", mode: "forever", body: [{ id: "s", type: "scroll", dx: 0, dy: 120 }, { id: "w", type: "wait", ms: 4000, jitterMs: 0 }] }],
    limits: { maxDurationMs: 3_600_000 },
  }),
  t("dwell-click", "accessibility", "pro", "Long-press helper", "Turns one hotkey press into a 1-second press-and-hold at the pointer — useful when holding a button is tiring.", {
    icon: "hand",
    color: "#F97316",
    targets: ["windows", "web"],
    mode: "pro",
    trigger: { type: "hotkey", hotkey: { key: "F8", modifiers: [] }, scope: "global" },
    steps: [{ id: "h", type: "click", target: { kind: "current" }, button: "left", clicks: 1, holdMs: 1000, modifiers: [] }],
    limits: { countdownMs: 0 },
  }),
  t("android-swipe-feed", "mobile", "easy", "Swipe-up reader (Android)", "Swipes up every 6 seconds to advance a feed or e-book page; stops after 30 minutes.", {
    icon: "phone",
    color: "#22C55E",
    targets: ["android", "web"],
    mode: "pro",
    steps: [
      {
        id: "loop",
        type: "loop",
        mode: "forever",
        body: [
          { id: "d", type: "drag", from: { kind: "point", x: 0.5, y: 0.75, space: "normalized" }, to: { kind: "point", x: 0.5, y: 0.3, space: "normalized" }, durationMs: 350, button: "left" },
          { id: "w", type: "wait", ms: 6000, jitterMs: 0 },
        ],
      },
    ],
    limits: { maxDurationMs: 1_800_000 },
  }),
  t("android-night-routine", "mobile", "pro", "Charging night routine (Android)", "When charging starts after 22:00, shows a wind-down notification and opens your sleep app.", {
    icon: "moon",
    color: "#0EA5E9",
    targets: ["android"],
    mode: "pro",
    trigger: { type: "deviceEvent", event: "charging" },
    variables: [{ name: "sleepApp", type: "string", initial: "com.google.android.deskclock" }],
    steps: [
      {
        id: "if",
        type: "if",
        condition: { expr: "hour() >= 22 || hour() < 5" },
        then: [
          { id: "n", type: "notify", title: "Wind down", body: "Phone is charging — time to rest." },
          { id: "l", type: "launchApp", app: "com.google.android.deskclock", args: [] },
        ],
        else: [],
      },
    ],
    limits: { countdownMs: 0 },
  }),
  t("window-layout", "developer", "pro", "Morning workspace", "Opens your browser, editor and terminal and arranges the windows side by side.", {
    icon: "layout",
    color: "#64748B",
    targets: ["windows"],
    mode: "pro",
    steps: [
      { id: "a", type: "launchApp", app: "msedge.exe", args: [] },
      { id: "w1", type: "wait", ms: 1500, jitterMs: 0 },
      { id: "m1", type: "window", op: "move", match: { app: "msedge.exe" }, rect: { x: 0, y: 0, w: 960, h: 1040 } },
      { id: "b", type: "launchApp", app: "code", args: [] },
      { id: "w2", type: "wait", ms: 2000, jitterMs: 0 },
      { id: "m2", type: "window", op: "move", match: { app: "Code.exe" }, rect: { x: 960, y: 0, w: 960, h: 1040 } },
      { id: "c", type: "launchApp", app: "wt.exe", args: [] },
    ],
  }),
  t("status-check", "developer", "pro", "Website status check", "Every 10 minutes, checks a URL and notifies you if it does not answer.", {
    icon: "globe",
    color: "#EF4444",
    mode: "pro",
    trigger: { type: "schedule", everyMs: 600_000 },
    variables: [{ name: "url", type: "string", initial: "https://example.com" }],
    steps: [
      {
        id: "try",
        type: "try",
        errorVar: "err",
        body: [{ id: "h", type: "http", method: "GET", url: "https://example.com", headers: {}, resultVar: "res" }],
        catch: [{ id: "n", type: "notify", title: "Site check failed", body: "{{err}}" }],
      },
    ],
    limits: { countdownMs: 0 },
  }),
  t("copy-cleaner", "office", "pro", "Clean clipboard text", "Reads the clipboard, removes line breaks and double spaces, and puts the clean text back.", {
    icon: "clipboard",
    color: "#A855F7",
    mode: "pro",
    trigger: { type: "hotkey", hotkey: { key: "V", modifiers: ["ctrl", "alt"] }, scope: "global" },
    steps: [
      { id: "g", type: "clipboard", op: "get", var: "clip" },
      { id: "s", type: "setVar", name: "clip", value: "replace(replace(clip, \"\\n\", \" \"), \"  \", \" \")" },
      { id: "p", type: "clipboard", op: "set", value: "{{clip}}" },
      { id: "n", type: "notify", title: "Clipboard cleaned", body: "{{len(clip)}} characters" },
    ],
    limits: { countdownMs: 0 },
  }),
  t("countdown-timer", "wellbeing", "easy", "Focus timer", "A 25-minute focus session that ends with a notification — Pomodoro without another app.", {
    icon: "timer",
    color: "#F43F5E",
    mode: "pro",
    steps: [
      { id: "a", type: "notify", title: "Focus started", body: "25 minutes. You've got this." },
      { id: "w", type: "wait", ms: 1_500_000, jitterMs: 0 },
      { id: "b", type: "notify", title: "Time for a break", body: "Stand up and stretch for 5 minutes." },
    ],
    limits: { maxDurationMs: 1_600_000, countdownMs: 0 },
  }),
];

// Stage-mode game templates. They follow the Practice Canvas idle game out of the box; for a real
// game, re-capture the scenes in Stage. They automate only what the user could click themselves and
// never touch game memory or anti-cheat — follow each game's terms of service.
TEMPLATES.push(
  t("idle-collect", "gaming", "pro", "Idle game: collect & return to lobby", "On your second monitor, recognizes the lobby and reward screens (Scenes), starts a round, collects the reward and returns to the lobby — three times. Pauses as soon as you touch the mouse.", {
    icon: "gamepad",
    color: "#22C3A6",
    targets: ["windows", "web"],
    mode: "pro",
    stage: { display: "secondary", pauseOnTakeover: true },
    onMissingDisplay: "ask",
    scenes: practiceScenes,
    variables: [{ name: "rounds", type: "number", initial: 3 }],
    steps: [
      { id: "zero", type: "setVar", name: "collected", value: "0" },
      {
        id: "play",
        type: "loop",
        mode: "while",
        condition: { expr: "collected < rounds" },
        cooldownMs: 400,
        body: [
          { id: "lobby", type: "if", label: "In the lobby: start a round", condition: { scene: { name: "lobby", minSimilarity: 0.85 } }, then: [{ id: "start", type: "click", target: buttonCenter(PRACTICE_BUTTONS.start), button: "left", clicks: 1, holdMs: 0, modifiers: [] }], else: [] },
          {
            id: "reward",
            type: "if",
            label: "Reward screen: collect it",
            condition: { scene: { name: "reward", minSimilarity: 0.85 } },
            then: [
              { id: "collect", type: "click", target: buttonCenter(PRACTICE_BUTTONS.collect), button: "left", clicks: 1, holdMs: 0, modifiers: [] },
              { id: "count", type: "setVar", name: "collected", value: "collected + 1" },
              { id: "log", type: "log", message: "Collected round {{collected}} of {{rounds}}", level: "info" },
            ],
            else: [],
          },
        ],
      },
      { id: "done", type: "notify", title: "Idle run finished", body: "{{collected}} rewards collected." },
    ],
    humanize: { offsetPx: 3, delayMs: 120 },
    limits: { maxDurationMs: 1_800_000 },
  }),
  t("stage-ready-clicker", "gaming", "easy", "Two-monitor stage: click when ready", "Watches one spot on your second monitor and clicks it whenever it turns green (a ready button), at most twice a second. AutoFlow stays on your main monitor and pauses if you take over the mouse.", {
    icon: "target",
    color: "#2ECC71",
    targets: ["windows", "web"],
    mode: "pro",
    stage: { display: "secondary", pauseOnTakeover: true },
    onMissingDisplay: "ask",
    steps: [
      {
        id: "watch",
        type: "loop",
        mode: "forever",
        cooldownMs: 500,
        body: [
          {
            id: "ready",
            type: "if",
            condition: { pixel: { at: buttonCenter(PRACTICE_BUTTONS.start), color: PRACTICE_BUTTONS.start.color, tolerance: 24 } },
            then: [
              { id: "press", type: "click", target: buttonCenter(PRACTICE_BUTTONS.start), button: "left", clicks: 1, holdMs: 0, modifiers: [] },
              { id: "log", type: "log", message: "Ready button clicked at {{time()}}", level: "info" },
            ],
            else: [],
          },
        ],
      },
    ],
    limits: { maxDurationMs: 3_600_000 },
  }),
  t("daily-check-in", "gaming", "easy", "Daily check-in loop", "Clicks a daily check-in button once, then waits out a 24-hour cooldown before the next round and tells you each time. Runs for up to a week.", {
    icon: "timer",
    color: "#F59E0B",
    mode: "pro",
    steps: [
      {
        id: "daily",
        type: "loop",
        mode: "forever",
        cooldownMs: 86_400_000,
        body: [
          { id: "check", type: "click", target: buttonCenter(PRACTICE_BUTTONS.collect), button: "left", clicks: 1, holdMs: 0, modifiers: [] },
          { id: "n", type: "notify", title: "Daily check-in done", body: "Next one in 24 hours." },
          { id: "log", type: "log", message: "Checked in on {{date()}}", level: "info" },
        ],
      },
    ],
    limits: { maxDurationMs: 604_800_000 },
  }),
);

export function templatePermissions(tpl: Template): string[] {
  return analyzeRisk(tpl.flow).permissions;
}

/** Copy a template into a new user-owned flow (fresh id and timestamps). */
export function instantiateTemplate(tpl: Template, newFlowId: string): Flow {
  const now = new Date().toISOString();
  const flow: Flow = JSON.parse(JSON.stringify(tpl.flow));
  return { ...flow, id: newFlowId, createdAt: now, updatedAt: now, revision: 0, favorite: false };
}

export const TEMPLATE_CATEGORIES: TemplateCategory[] = ["clicking", "keyboard", "office", "accessibility", "testing", "mobile", "developer", "wellbeing", "gaming"];
