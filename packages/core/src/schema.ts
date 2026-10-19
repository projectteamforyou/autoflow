/**
 * AutoFlow automation schema (v1).
 *
 * One JSON document describes a Flow on every platform. Easy mode and Pro mode
 * edit the same document; Easy mode only shows the subset it understands and
 * never drops what it cannot show (see easy.ts).
 *
 * The Rust (Windows) and Kotlin (Android) executors parse this exact shape;
 * shared fixtures in /packages/core/fixtures keep them honest.
 */
import { INVALID, ZodIssueCode, addIssueToContext, z } from "zod";

export const SCHEMA_VERSION = "1.0" as const;

export const PLATFORMS = ["windows", "android", "web"] as const;
export type Platform = (typeof PLATFORMS)[number];

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "id must be [A-Za-z0-9_-]");
const varName = z.string().min(1).max(48).regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "invalid variable name");
const expr = z.string().max(2000);
const ms = z.number().int().min(0).max(86_400_000);
/** Pixel or normalized coordinate. Bounded so native executors never see absurd values. */
const coord = z.number().min(-1_000_000).max(1_000_000);
const extent = z.number().positive().max(1_000_000);
const rect = z.object({ x: coord, y: coord, w: coord, h: coord });

/** Structural limits, enforced by parseFlow before and after schema validation. */
export const MAX_STEP_DEPTH = 32;
export const MAX_TOTAL_STEPS = 10_000;
/** Raw JSON limits checked before zod runs (deeply nested input would overflow the stack). */
export const MAX_JSON_DEPTH = 128;
export const MAX_JSON_NODES = 500_000;

/* ------------------------------------------------------------------ targets */

export const PointTarget = z.object({
  kind: z.literal("point"),
  x: coord,
  y: coord,
  /** screen = physical screen px · window = relative to the matched window · normalized = 0..1 of screen */
  space: z.enum(["screen", "window", "normalized"]).default("screen"),
  /** Optional monitor index for multi-monitor setups (Windows). */
  monitor: z.number().int().min(0).max(16).optional(),
});

export const CurrentTarget = z.object({ kind: z.literal("current") });

export const RegionTarget = z.object({
  kind: z.literal("region"),
  x: coord,
  y: coord,
  w: extent,
  h: extent,
  space: z.enum(["screen", "window", "normalized"]).default("screen"),
  /** pick = center | random point inside region (explicitly opted-in, for testing/accessibility). */
  pick: z.enum(["center", "random"]).default("center"),
});

export const ElementTarget = z.object({
  kind: z.literal("element"),
  /** Windows: UI Automation selector. Android: accessibility node selector. */
  selector: z.object({
    app: z.string().max(260).optional(),
    window: z.string().max(260).optional(),
    name: z.string().max(260).optional(),
    role: z.string().max(64).optional(),
    automationId: z.string().max(260).optional(),
    text: z.string().max(260).optional(),
    index: z.number().int().min(0).max(999).optional(),
  }),
});

export const ImageTarget = z.object({
  kind: z.literal("image"),
  /** Reference to a locally stored template image (never inlined in shared templates). */
  ref: z.string().max(200),
  confidence: z.number().min(0.5).max(1).default(0.9),
  region: rect.optional(),
});

export const Target = z.discriminatedUnion("kind", [PointTarget, CurrentTarget, RegionTarget, ElementTarget, ImageTarget]);
export type Target = z.infer<typeof Target>;

/* ------------------------------------------------------------------- errors */

export const OnError = z.object({
  strategy: z.enum(["stop", "continue", "retry", "goto"]).default("stop"),
  retries: z.number().int().min(0).max(10).default(0),
  backoffMs: ms.default(500),
  /** For strategy=goto: id of a step in the same flow (top-level) to jump to. */
  gotoStepId: id.optional(),
  /**
   * Retry delay growth for attempt n (1-based): fixed = backoffMs, linear = n × backoffMs (the
   * default, unchanged behaviour), exponential = 2^(n-1) × backoffMs.
   */
  backoff: z.enum(["fixed", "linear", "exponential"]).optional(),
  /** Upper bound for one retry delay (before jitter). */
  maxBackoffMs: ms.optional(),
  /** 0..1: each delay is reduced by a random share of up to `jitter` (spreads retry storms). */
  jitter: z.number().min(0).max(1).optional(),
});
export type OnError = z.infer<typeof OnError>;

/* -------------------------------------------------------------------- steps */

const base = {
  id,
  /** Optional human label; Explain falls back to a generated sentence. */
  label: z.string().max(120).optional(),
  disabled: z.boolean().optional(),
  /** Debugger breakpoint (Pro mode). */
  breakpoint: z.boolean().optional(),
  onError: OnError.optional(),
  /**
   * Fails the step (category "timeout", subject to onError) when one attempt runs longer than this.
   * (Named apart from the step-specific `timeoutMs` of waitFor / findImage.)
   */
  stepTimeoutMs: z.number().int().min(1).max(86_400_000).optional(),
};

export const MouseButton = z.enum(["left", "right", "middle", "x1", "x2"]);
export const Modifier = z.enum(["ctrl", "alt", "shift", "meta"]);

export const ClickStep = z.object({
  ...base,
  type: z.literal("click"),
  target: Target,
  button: MouseButton.default("left"),
  clicks: z.number().int().min(1).max(3).default(1),
  /** > 0 means press-and-hold (long press on Android). */
  holdMs: ms.default(0),
  modifiers: z.array(Modifier).max(4).default([]),
});

export const MoveStep = z.object({ ...base, type: z.literal("move"), target: Target, durationMs: ms.default(0) });

export const DragStep = z.object({
  ...base,
  type: z.literal("drag"),
  from: Target,
  to: Target,
  durationMs: ms.default(300),
  button: MouseButton.default("left"),
});

export const ScrollStep = z.object({
  ...base,
  type: z.literal("scroll"),
  dx: z.number().int().min(-10000).max(10000).default(0),
  dy: z.number().int().min(-10000).max(10000).default(0),
  target: Target.optional(),
});

export const KeyStep = z.object({
  ...base,
  type: z.literal("key"),
  /** W3C KeyboardEvent.key-style name: "a", "Enter", "F5", "ArrowLeft", "MediaPlayPause"… */
  key: z.string().min(1).max(32),
  modifiers: z.array(Modifier).max(4).default([]),
  action: z.enum(["press", "down", "up"]).default("press"),
  repeat: z.number().int().min(1).max(1000).default(1),
});

export const TypeStep = z.object({
  ...base,
  type: z.literal("type"),
  /** Supports {{var}} interpolation. Secrets are referenced as {{secret:name}} and never stored inline. */
  text: z.string().max(10000),
  perCharDelayMs: ms.default(0),
});

export const WaitStep = z.object({
  ...base,
  type: z.literal("wait"),
  ms,
  /** Explicit, visible jitter (testing / accessibility only). */
  jitterMs: ms.default(0),
});

export const Condition = z.object({
  /** Safe expression evaluated by expr.ts — no eval, no I/O. */
  expr,
});

export const WaitForStep = z.object({
  ...base,
  type: z.literal("waitFor"),
  condition: Condition,
  pollMs: z.number().int().min(50).max(60_000).default(250),
  timeoutMs: ms.default(10_000),
});

export const SetVarStep = z.object({ ...base, type: z.literal("setVar"), name: varName, value: expr });

export const LogStep = z.object({
  ...base,
  type: z.literal("log"),
  message: z.string().max(2000),
  level: z.enum(["info", "warn", "error"]).default("info"),
});

export const NotifyStep = z.object({ ...base, type: z.literal("notify"), title: z.string().max(120), body: z.string().max(1000).default("") });

export const ConfirmStep = z.object({
  ...base,
  type: z.literal("confirm"),
  message: z.string().max(500),
  /** Variable that receives true/false. If omitted, "no" stops the run. */
  resultVar: varName.optional(),
});

export const ClipboardStep = z.object({
  ...base,
  type: z.literal("clipboard"),
  op: z.enum(["set", "get"]),
  value: z.string().max(10000).optional(),
  var: varName.optional(),
});

export const LaunchAppStep = z.object({
  ...base,
  type: z.literal("launchApp"),
  /** Windows: exe path or AUMID. Android: package name. */
  app: z.string().min(1).max(260),
  args: z.array(z.string().max(260)).max(16).default([]),
});

export const OpenUrlStep = z.object({ ...base, type: z.literal("openUrl"), url: z.string().url().max(2048) });

export const WindowStep = z.object({
  ...base,
  type: z.literal("window"),
  op: z.enum(["focus", "minimize", "maximize", "restore", "close", "move", "resize"]),
  match: z.object({ title: z.string().max(260).optional(), app: z.string().max(260).optional() }),
  rect: rect.optional(),
});

export const AndroidGlobalStep = z.object({
  ...base,
  type: z.literal("androidGlobal"),
  action: z.enum(["back", "home", "recents", "notifications", "quickSettings", "lockScreen", "screenshot", "powerDialog"]),
});

export const HttpStep = z.object({
  ...base,
  type: z.literal("http"),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  url: z.string().url().max(2048),
  headers: z
    .record(z.string().max(2000))
    .refine((h) => Object.keys(h).length <= 50, { message: "at most 50 headers" })
    .refine((h) => Object.keys(h).every((k) => /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,256}$/.test(k)), { message: "invalid header name" })
    .default({}),
  body: z.string().max(100_000).optional(),
  resultVar: varName.optional(),
});

export const FileStep = z.object({
  ...base,
  type: z.literal("file"),
  op: z.enum(["read", "write", "append", "copy", "move", "delete", "exists"]),
  path: z.string().max(1024),
  dest: z.string().max(1024).optional(),
  content: z.string().max(1_000_000).optional(),
  resultVar: varName.optional(),
});

export const OcrStep = z.object({
  ...base,
  type: z.literal("ocr"),
  region: rect,
  resultVar: varName,
});

export const FindImageStep = z.object({
  ...base,
  type: z.literal("findImage"),
  target: ImageTarget,
  resultVar: varName,
  timeoutMs: ms.default(5000),
});

export const RunFlowStep = z.object({ ...base, type: z.literal("runFlow"), flowId: id });

export const SwitchProfileStep = z.object({ ...base, type: z.literal("switchProfile"), profileId: id });

export const StopStep = z.object({ ...base, type: z.literal("stop"), reason: z.string().max(200).optional() });
export const BreakStep = z.object({ ...base, type: z.literal("break") });
export const ContinueStep = z.object({ ...base, type: z.literal("continue") });

/* ------------------------------------------------------- control-flow steps */

export type Step =
  | z.infer<typeof ClickStep>
  | z.infer<typeof MoveStep>
  | z.infer<typeof DragStep>
  | z.infer<typeof ScrollStep>
  | z.infer<typeof KeyStep>
  | z.infer<typeof TypeStep>
  | z.infer<typeof WaitStep>
  | z.infer<typeof WaitForStep>
  | z.infer<typeof SetVarStep>
  | z.infer<typeof LogStep>
  | z.infer<typeof NotifyStep>
  | z.infer<typeof ConfirmStep>
  | z.infer<typeof ClipboardStep>
  | z.infer<typeof LaunchAppStep>
  | z.infer<typeof OpenUrlStep>
  | z.infer<typeof WindowStep>
  | z.infer<typeof AndroidGlobalStep>
  | z.infer<typeof HttpStep>
  | z.infer<typeof FileStep>
  | z.infer<typeof OcrStep>
  | z.infer<typeof FindImageStep>
  | z.infer<typeof RunFlowStep>
  | z.infer<typeof SwitchProfileStep>
  | z.infer<typeof StopStep>
  | z.infer<typeof BreakStep>
  | z.infer<typeof ContinueStep>
  | IfStep
  | LoopStep
  | ForEachStep
  | TryStep
  | GroupStep;

export interface IfStep {
  id: string;
  label?: string;
  disabled?: boolean;
  breakpoint?: boolean;
  onError?: OnError;
  stepTimeoutMs?: number;
  type: "if";
  condition: { expr: string };
  then: Step[];
  else: Step[];
}
export interface LoopStep {
  id: string;
  label?: string;
  disabled?: boolean;
  breakpoint?: boolean;
  onError?: OnError;
  stepTimeoutMs?: number;
  type: "loop";
  /** count = N times · while = until expr false · forever = until stopped or flow limits hit */
  mode: "count" | "while" | "forever";
  count?: number;
  condition?: { expr: string };
  /** Exposes the 0-based iteration index under this variable name. */
  indexVar?: string;
  body: Step[];
}
export interface ForEachStep {
  id: string;
  label?: string;
  disabled?: boolean;
  breakpoint?: boolean;
  onError?: OnError;
  stepTimeoutMs?: number;
  type: "forEach";
  /** Expression producing an array (e.g. split(csv, ",")). */
  list: string;
  itemVar: string;
  body: Step[];
}
export interface TryStep {
  id: string;
  label?: string;
  disabled?: boolean;
  breakpoint?: boolean;
  onError?: OnError;
  stepTimeoutMs?: number;
  type: "try";
  body: Step[];
  catch: Step[];
  /** Variable that receives the error message inside catch. */
  errorVar?: string;
}
export interface GroupStep {
  id: string;
  label?: string;
  disabled?: boolean;
  breakpoint?: boolean;
  onError?: OnError;
  stepTimeoutMs?: number;
  type: "group";
  name: string;
  collapsed?: boolean;
  body: Step[];
}

/**
 * Step union that dispatches on `type` instead of trying every member.
 *
 * A plain z.union parses each non-matching container schema too — including its nested `body`
 * — so validation cost grew roughly 4^depth: a few hundred bytes of nested groups could pin a
 * CPU (the API validates every published or shared flow). This subclass validates exactly one
 * member per step, so parsing is linear, while JSON-schema generation still sees the same union.
 */
class StepUnion extends z.ZodUnion<[z.ZodTypeAny, ...z.ZodTypeAny[]]> {
  private byType?: Map<string, z.ZodTypeAny>;

  constructor(options: [z.ZodTypeAny, ...z.ZodTypeAny[]], private readonly table: () => Record<string, z.ZodTypeAny>) {
    super({ options, typeName: z.ZodFirstPartyTypeKind.ZodUnion });
  }

  override _parse(input: z.ParseInput): z.ParseReturnType<unknown> {
    const ctx = this._getOrReturnCtx(input);
    const data = ctx.data as unknown;
    const type = data !== null && typeof data === "object" && !Array.isArray(data) ? (data as { type?: unknown }).type : undefined;
    this.byType ??= new Map(Object.entries(this.table()));
    const option = typeof type === "string" ? this.byType.get(type) : undefined;
    if (!option) {
      addIssueToContext(ctx, { code: ZodIssueCode.invalid_union_discriminator, options: [...this.byType.keys()], path: ["type"] });
      return INVALID;
    }
    const childInput = { data: ctx.data, path: ctx.path, parent: ctx };
    return ctx.common.async ? option._parseAsync(childInput) : option._parseSync(childInput);
  }
}

export const StepSchema: z.ZodType<Step, z.ZodTypeDef, unknown> = z.lazy(
  () =>
    new StepUnion(
      [
        z.discriminatedUnion("type", [
          ClickStep, MoveStep, DragStep, ScrollStep, KeyStep, TypeStep, WaitStep, WaitForStep, SetVarStep, LogStep,
          NotifyStep, ConfirmStep, ClipboardStep, LaunchAppStep, OpenUrlStep, WindowStep, AndroidGlobalStep, HttpStep,
          FileStep, OcrStep, FindImageStep, RunFlowStep, SwitchProfileStep, StopStep, BreakStep, ContinueStep,
        ]),
        IfStepSchema,
        LoopStepSchema,
        ForEachStepSchema,
        TryStepSchema,
        GroupStepSchema,
      ],
      () => ({
        click: ClickStep, move: MoveStep, drag: DragStep, scroll: ScrollStep, key: KeyStep, type: TypeStep, wait: WaitStep, waitFor: WaitForStep,
        setVar: SetVarStep, log: LogStep, notify: NotifyStep, confirm: ConfirmStep, clipboard: ClipboardStep, launchApp: LaunchAppStep,
        openUrl: OpenUrlStep, window: WindowStep, androidGlobal: AndroidGlobalStep, http: HttpStep, file: FileStep, ocr: OcrStep,
        findImage: FindImageStep, runFlow: RunFlowStep, switchProfile: SwitchProfileStep, stop: StopStep, break: BreakStep,
        continue: ContinueStep, if: IfStepSchema, loop: LoopStepSchema, forEach: ForEachStepSchema, try: TryStepSchema, group: GroupStepSchema,
      }),
    ),
) as z.ZodType<Step, z.ZodTypeDef, unknown>;

const steps = z.array(z.lazy(() => StepSchema)).max(2000);

const IfStepSchema = z.object({ ...base, type: z.literal("if"), condition: Condition, then: steps.default([]), else: steps.default([]) });
const LoopStepSchema = z
  .object({
    ...base,
    type: z.literal("loop"),
    mode: z.enum(["count", "while", "forever"]),
    count: z.number().int().min(1).max(10_000_000).optional(),
    condition: Condition.optional(),
    indexVar: varName.optional(),
    body: steps.default([]),
  })
  .refine((s) => s.mode !== "count" || typeof s.count === "number", { message: "loop.count required for mode=count" })
  .refine((s) => s.mode !== "while" || !!s.condition, { message: "loop.condition required for mode=while" });
const ForEachStepSchema = z.object({ ...base, type: z.literal("forEach"), list: expr, itemVar: varName, body: steps.default([]) });
const TryStepSchema = z.object({ ...base, type: z.literal("try"), body: steps.default([]), catch: steps.default([]), errorVar: varName.optional() });
const GroupStepSchema = z.object({ ...base, type: z.literal("group"), name: z.string().max(120), collapsed: z.boolean().optional(), body: steps.default([]) });

export type StepType = Step["type"];
export const CONTAINER_TYPES = ["if", "loop", "forEach", "try", "group"] as const;

/* ----------------------------------------------------------------- triggers */

export const Hotkey = z.object({
  key: z.string().min(1).max(32),
  modifiers: z.array(Modifier).max(4).default([]),
});
export type Hotkey = z.infer<typeof Hotkey>;

export const Trigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("manual") }),
  z.object({ type: z.literal("hotkey"), hotkey: Hotkey, scope: z.enum(["global", "app"]).default("global"), app: z.string().max(260).optional() }),
  z.object({
    type: z.literal("schedule"),
    /** 5-field cron in the device's local time zone. */
    cron: z.string().max(120).optional(),
    /** Alternative: fixed interval. */
    everyMs: z.number().int().min(60_000).optional(),
    startAt: z.string().datetime().optional(),
    endAt: z.string().datetime().optional(),
  }),
  z.object({ type: z.literal("appEvent"), event: z.enum(["launched", "closed", "focused"]), app: z.string().max(260) }),
  z.object({ type: z.literal("deviceEvent"), event: z.enum(["charging", "batteryLow", "wifiConnected", "wifiDisconnected", "bluetoothConnected", "headsetPlugged", "bootCompleted", "deviceConnected", "deviceDisconnected"]) }),
  z.object({ type: z.literal("location"), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), radiusM: z.number().min(50).max(50_000), on: z.enum(["enter", "exit"]) }),
  z.object({ type: z.literal("notification"), app: z.string().max(260), contains: z.string().max(200).optional() }),
]);
export type Trigger = z.infer<typeof Trigger>;

/* ------------------------------------------------------------------- limits */

export const Limits = z.object({
  /** Hard wall-clock limit for one run. Every flow has one. */
  maxDurationMs: z.number().int().min(1000).max(7 * 86_400_000).default(10 * 60_000),
  /** Upper bound on input actions (click, key, type…) per run. */
  maxActions: z.number().int().min(1).max(100_000_000).default(100_000),
  /** Upper bound on loop iterations across the whole run. */
  maxIterations: z.number().int().min(1).max(100_000_000).default(1_000_000),
  /** Visible countdown before the first input action. */
  countdownMs: z.number().int().min(0).max(60_000).default(3000),
  /** Skip a new trigger while this flow is already running. */
  preventOverlap: z.boolean().default(true),
  /** Minimum time between two trigger-initiated runs. */
  cooldownMs: ms.default(0),
  /** Deterministic watchdog: upper bound on executed steps (any type, retries included). */
  maxSteps: z.number().int().min(1).max(1_000_000_000).optional(),
});
export type Limits = z.infer<typeof Limits>;

export const VariableDef = z.object({
  name: varName,
  type: z.enum(["string", "number", "boolean", "list"]).default("string"),
  initial: z.union([z.string().max(10_000), z.number(), z.boolean(), z.array(z.union([z.string().max(10_000), z.number()])).max(10_000)]).optional(),
  /** Ask the user for the value before the run (input form). */
  prompt: z.string().max(200).optional(),
});
export type VariableDef = z.infer<typeof VariableDef>;

/**
 * Opt-in, visible humanization of input actions: a bounded random offset on pixel targets and a
 * bounded random delay before each input action. With a seed the variation is reproducible.
 */
export const Humanize = z.object({
  /** Max offset in px added to point targets in screen/window space (each axis, ±). */
  offsetPx: z.number().int().min(0).max(50).default(0),
  /** Max extra delay before each input action. */
  delayMs: z.number().int().min(0).max(5000).default(0),
  /** Seed for the dedicated random stream (mulberry32); omit to use the run's random source. */
  seed: z.number().int().min(0).max(4_294_967_295).optional(),
});
export type Humanize = z.infer<typeof Humanize>;

export const FlowSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id,
  name: z.string().min(1).max(120),
  description: z.string().max(4000).default(""),
  tags: z.array(z.string().max(32)).max(20).default([]),
  icon: z.string().max(32).default("bolt"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#7C5CFF"),
  targets: z.array(z.enum(PLATFORMS)).min(1).default(["windows", "android", "web"]),
  mode: z.enum(["easy", "pro"]).default("easy"),
  trigger: Trigger.default({ type: "manual" }),
  hotkeys: z
    .object({ start: Hotkey.optional(), pause: Hotkey.optional(), stop: Hotkey.default({ key: "Escape", modifiers: ["ctrl", "alt"] }) })
    .default({}),
  limits: Limits.default({}),
  variables: z.array(VariableDef).max(200).default([]),
  steps,
  humanize: Humanize.optional(),
  /** Reference coordinate space at recording time; executors pause if the live screen differs. */
  screen: z.object({ width: z.number().int().positive(), height: z.number().int().positive(), scale: z.number().positive().default(1) }).optional(),
  favorite: z.boolean().default(false),
  folder: z.string().max(120).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  /** Monotonic edit counter; used for sync conflict detection. */
  revision: z.number().int().min(0).default(0),
});
export type Flow = z.infer<typeof FlowSchema>;
export type FlowInput = z.input<typeof FlowSchema>;

export interface ValidationIssue {
  path: string;
  message: string;
}

/**
 * Iterative size/depth check of untrusted JSON. Runs before zod so hostile input (very deep
 * nesting, millions of nodes) fails fast with an issue instead of a stack overflow.
 */
export function checkJsonBounds(data: unknown, maxDepth = MAX_JSON_DEPTH, maxNodes = MAX_JSON_NODES): string | null {
  const stack: [unknown, number][] = [[data, 1]];
  let nodes = 0;
  while (stack.length) {
    const [v, depth] = stack.pop()!;
    if (++nodes > maxNodes) return "document is too large";
    if (v === null || typeof v !== "object") continue;
    if (depth > maxDepth) return "document is nested too deeply";
    const children = Array.isArray(v) ? v : Object.values(v as Record<string, unknown>);
    for (const c of children) if (c !== null && typeof c === "object") stack.push([c, depth + 1]);
    nodes += children.length;
  }
  return null;
}

/** Structural limits of a parsed flow: nesting depth and total number of steps. */
export function checkStepStructure(list: Step[]): string | null {
  let total = 0;
  let deepest = 0;
  const stack: [Step[], number][] = [[list, 1]];
  while (stack.length) {
    const [l, depth] = stack.pop()!;
    deepest = Math.max(deepest, depth);
    if (deepest > MAX_STEP_DEPTH) return `steps are nested more than ${MAX_STEP_DEPTH} levels deep`;
    total += l.length;
    if (total > MAX_TOTAL_STEPS) return `a flow can have at most ${MAX_TOTAL_STEPS} steps`;
    for (const s of l) for (const c of childLists(s)) stack.push([c, depth + 1]);
  }
  return null;
}

export function parseFlow(data: unknown): { ok: true; flow: Flow } | { ok: false; issues: ValidationIssue[] } {
  const bounds = checkJsonBounds(data);
  if (bounds) return { ok: false, issues: [{ path: "", message: bounds }] };
  const r = FlowSchema.safeParse(data);
  if (r.success) {
    const structure = checkStepStructure(r.data.steps);
    if (structure) return { ok: false, issues: [{ path: "steps", message: structure }] };
    const dup = findDuplicateIds(r.data.steps);
    if (dup.length) return { ok: false, issues: dup.map((d) => ({ path: "steps", message: `duplicate step id "${d}"` })) };
    return { ok: true, flow: r.data };
  }
  return { ok: false, issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
}

export function childLists(step: Step): Step[][] {
  switch (step.type) {
    case "if":
      return [step.then, step.else];
    case "loop":
    case "forEach":
    case "group":
      return [step.body];
    case "try":
      return [step.body, step.catch];
    default:
      return [];
  }
}

/** Depth-first walk over every step, including nested ones. */
export function walkSteps(list: Step[], visit: (s: Step, depth: number, parent: Step | null) => void, depth = 0, parent: Step | null = null): void {
  for (const s of list) {
    visit(s, depth, parent);
    for (const child of childLists(s)) walkSteps(child, visit, depth + 1, s);
  }
}

export function countSteps(list: Step[]): number {
  let n = 0;
  walkSteps(list, () => n++);
  return n;
}

export function findDuplicateIds(list: Step[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  walkSteps(list, (s) => {
    if (seen.has(s.id)) dup.add(s.id);
    seen.add(s.id);
  });
  return [...dup];
}

export function findStep(list: Step[], stepId: string): Step | undefined {
  let found: Step | undefined;
  walkSteps(list, (s) => {
    if (!found && s.id === stepId) found = s;
  });
  return found;
}

let counter = 0;
/** Short, collision-resistant id usable in step and flow ids. */
export function newId(prefix = "s"): string {
  counter = (counter + 1) % 1_000_000;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

export function createFlow(partial: Partial<FlowInput> & { name: string }): Flow {
  const now = new Date().toISOString();
  const r = FlowSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    id: partial.id ?? newId("f"),
    steps: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  });
  return r;
}
