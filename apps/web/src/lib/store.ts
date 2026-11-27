/**
 * App state (zustand) backed by IndexedDB. Local-first: everything works offline.
 */
import { create } from "zustand";
import {
  InputProfileSchema,
  TEMPLATES,
  instantiateTemplate,
  newId,
  parseFlow,
  type Flow,
  type Hotkey,
  type InputProfile,
  type RunEvent,
  type RunResult,
  type Platform,
  type Step,
} from "@autoflow/core";
import { db, kv } from "./db";
import { deleteAllSecrets } from "./secrets";
import { clearCopiedStep } from "./stepClipboard";

export type Theme = "system" | "dark" | "light";

export interface AiSettings {
  /** none = AI off · openai = OpenAI-compatible (OpenAI, OpenRouter, LM Studio, Ollama…) · anthropic */
  provider: "none" | "openai" | "anthropic";
  /** Catalog id from @autoflow/core AI_PROVIDERS ("custom" for a hand-entered base URL). */
  presetId?: string;
  baseUrl: string;
  model: string;
  imageModel: string;
  /** Refuse any request that would leave the device (only localhost providers allowed). */
  localOnly: boolean;
  /** Route through the AutoFlow relay instead of calling the provider from the browser. */
  useRelay: boolean;
}

export interface Settings {
  theme: Theme;
  defaultMode: "easy" | "pro";
  countdownMs: number;
  maxDurationMs: number;
  haltHotkey: Hotkey;
  onboarded: boolean;
  apiUrl: string;
  reduceMotion: boolean;
  canvasSpeed: number;
  /** Simulated monitors in the browser Practice Canvas (1–4; Stage shows at least 2). */
  practiceDisplays: number;
  sync: { enabled: boolean; accountId?: string; email?: string; keyCheck?: string; cursor?: string; lastSyncAt?: number };
  ai: AiSettings;
  ledgerRetentionDays: number;
  /** Flow ids whose trigger / start hotkey is switched off: the flow is unchanged, it is just not registered natively. */
  pausedTriggers: string[];
}

export const DEFAULT_API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "https://api.autoflowmacro.com";

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  defaultMode: "easy",
  countdownMs: 3000,
  maxDurationMs: 10 * 60_000,
  haltHotkey: { key: "Escape", modifiers: ["ctrl", "alt"] },
  onboarded: false,
  apiUrl: DEFAULT_API_URL,
  reduceMotion: false,
  canvasSpeed: 1,
  practiceDisplays: 1,
  sync: { enabled: false },
  ai: { provider: "none", presetId: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", imageModel: "gpt-image-1", localOnly: false, useRelay: false },
  ledgerRetentionDays: 30,
  pausedTriggers: [],
};

export interface RunRecord {
  id: string;
  flowId: string;
  flowName: string;
  platform: Platform;
  where: "canvas" | "native";
  status: RunResult["status"] | "running";
  reason?: string;
  error?: RunResult["error"];
  actions: number;
  iterations: number;
  /** Executed steps (attempts included); absent on runs recorded before it was stored. */
  steps?: number;
  durationMs: number;
  startedAt: number;
  endedAt?: number;
  events: RunEvent[];
  /** Oldest events that were cut because the log is capped (live buffer and storage). */
  dropped?: number;
  /** "Run from here" / "Run only this step": a test run of part of the flow (badge in the Ledger). */
  partial?: boolean;
}

export interface ActiveRun {
  runId: string;
  flowId: string;
  flowName: string;
  where: "canvas" | "native";
  state: string;
  stepId?: string;
  /** Type of the step that is running (Pulse bar label when the step has no name). */
  stepType?: string;
  countdownMs?: number;
  startedAt: number;
  actions: number;
}

export interface Toast {
  id: number;
  kind: "info" | "success" | "error" | "warning";
  text: string;
  action?: { label: string; run: () => void };
  /** Called when the toast is closed by the user (its action or ✕) or times out — not when newer toasts push it out. */
  onDismiss?: () => void;
}

export interface Version {
  key: string;
  flowId: string;
  at: number;
  revision: number;
  flow: Flow;
  note?: string;
}

/** A stored flow that `init` could not load. It stays in IndexedDB untouched; `raw` is what "Export" downloads. */
export interface UnreadableFlow {
  /** Stored id when it is readable, else "". */
  id: string;
  /** Stored name when it is readable. */
  name?: string;
  /** First validation issue ("steps: duplicate step id …"). */
  issue: string;
  raw: unknown;
}

/** "path: message" of the first validation issue — one line for toasts and the editor bar. */
function firstIssue(issues: { path: string; message: string }[]): string {
  const i = issues[0];
  return i ? `${i.path ? `${i.path}: ` : ""}${i.message}` : "invalid flow";
}

interface State {
  ready: boolean;
  flows: Flow[];
  /** Stored flows that failed validation at start-up: kept in IndexedDB, never loaded, reported once (actions.warnUnreadableFlows). */
  unreadable: UnreadableFlow[];
  profiles: InputProfile[];
  runs: RunRecord[];
  settings: Settings;
  active: ActiveRun | null;
  toasts: Toast[];
  /** flow id → reason from the last `triggers_sync` (native apps): why that trigger could not be registered. */
  triggerFailures: Record<string, string>;
  init(): Promise<void>;
  saveFlow(flow: Flow, opts?: { snapshot?: boolean; note?: string }): Promise<Flow>;
  /** `remote: false` skips the server tombstone (used when applying a deletion that came from the server). */
  deleteFlow(id: string, opts?: { remote?: boolean }): Promise<void>;
  duplicateFlow(id: string): Promise<Flow | undefined>;
  installTemplate(templateId: string): Promise<Flow | undefined>;
  versions(flowId: string): Promise<Version[]>;
  saveProfile(p: InputProfile): Promise<void>;
  deleteProfile(id: string, opts?: { remote?: boolean }): Promise<void>;
  recordRun(r: RunRecord): Promise<void>;
  deleteRun(id: string): Promise<void>;
  clearRuns(): Promise<void>;
  setActive(a: ActiveRun | null | ((prev: ActiveRun | null) => ActiveRun | null)): void;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  toast(kind: Toast["kind"], text: string, action?: Toast["action"], onDismiss?: () => void): void;
  dismissToast(id: number): void;
  setTriggerFailures(failed: { flowId: string; reason: string }[]): void;
  /** Switches a flow's trigger off (paused) or back on without editing the flow. */
  setTriggerPaused(flowIds: string[], paused: boolean): Promise<void>;
  /**
   * Saves validated flows. A flow whose id already exists is saved as a copy with a new id ("copy",
   * the default) or replaces the local one ("replace", the old steps stay in the version history).
   * `idMap` holds old → new id for the copies.
   */
  importFlows(flows: Flow[], onConflict?: "copy" | "replace"): Promise<{ count: number; idMap: Map<string, string>; failed: { name: string; issue: string }[] }>;
  wipeLocalData(): Promise<void>;
}

const MAX_VERSIONS = 30;
const MAX_RUNS = 300;
const MAX_RUN_EVENTS = 2000;
let toastSeq = 0;

export const useStore = create<State>((set, get) => ({
  ready: false,
  flows: [],
  unreadable: [],
  profiles: [],
  runs: [],
  settings: DEFAULT_SETTINGS,
  active: null,
  toasts: [],
  triggerFailures: {},

  async init() {
    const [rawFlows, rawProfiles, runs, storedSettings] = await Promise.all([db.all<unknown>("flows"), db.all<unknown>("profiles"), db.all<RunRecord>("runs"), kv.get<Partial<Settings>>("settings")]);
    const flows: Flow[] = [];
    // A stored flow that no longer validates is never dropped silently: it stays in IndexedDB and is
    // reported (toast with "Export" at start-up), so the user can get the raw JSON out.
    const unreadable: UnreadableFlow[] = [];
    for (const f of rawFlows) {
      const p = parseFlow(f);
      if (p.ok) flows.push(p.flow);
      else {
        const o = f && typeof f === "object" ? (f as { id?: unknown; name?: unknown }) : {};
        unreadable.push({ id: typeof o.id === "string" ? o.id : "", name: typeof o.name === "string" ? o.name.slice(0, 120) : undefined, issue: firstIssue(p.issues), raw: f });
      }
    }
    const profiles: InputProfile[] = [];
    for (const p of rawProfiles) {
      const r = InputProfileSchema.safeParse(p);
      if (r.success) profiles.push(r.data);
    }
    // Move devices that saved the launch-era API address to the custom domain.
    if (storedSettings?.apiUrl === "https://api-production-1dc3.up.railway.app") storedSettings.apiUrl = DEFAULT_API_URL;
    const settings: Settings = { ...DEFAULT_SETTINGS, ...storedSettings, sync: { ...DEFAULT_SETTINGS.sync, ...storedSettings?.sync }, ai: { ...DEFAULT_SETTINGS.ai, ...storedSettings?.ai } };
    // Paused ids of flows that no longer exist (deleted, wiped) are dropped here rather than on delete, so "Undo" keeps the switch off.
    // Flows that could not be loaded still exist: their "paused" switch must survive until they are repaired.
    const known = new Set([...flows.map((f) => f.id), ...unreadable.map((u) => u.id)]);
    settings.pausedTriggers = (Array.isArray(settings.pausedTriggers) ? settings.pausedTriggers : []).filter((id) => known.has(id));
    const cutoff = Date.now() - settings.ledgerRetentionDays * 86_400_000;
    const kept = runs.filter((r) => r.startedAt >= cutoff).sort((a, b) => b.startedAt - a.startedAt);
    for (const r of runs) if (r.startedAt < cutoff) void db.delete("runs", r.id);
    set({ flows: sortFlows(flows), unreadable, profiles, runs: kept.slice(0, MAX_RUNS), settings, ready: true });
  },

  async saveFlow(flow, opts = {}) {
    const prev = get().flows.find((f) => f.id === flow.id);
    // The same check `init` runs when loading (schema + duplicate step ids, nesting depth, step count,
    // scene names): anything saved here must load again on the next start, so it is refused up front.
    const parsed = parseFlow({ ...flow, updatedAt: new Date().toISOString(), revision: (prev?.revision ?? flow.revision) + (prev ? 1 : 0) });
    if (!parsed.ok) throw new Error(firstIssue(parsed.issues));
    const next: Flow = parsed.flow;
    await db.put("flows", next);
    if (opts.snapshot !== false && prev && JSON.stringify(prev.steps) !== JSON.stringify(next.steps)) {
      const v: Version = { key: `${prev.id}:${prev.revision}:${Date.now()}`, flowId: prev.id, at: Date.now(), revision: prev.revision, flow: prev, note: opts.note };
      await db.put("versions", v);
      const all = (await db.byIndex<Version>("versions", "flowId", prev.id)).sort((a, b) => b.at - a.at);
      for (const old of all.slice(MAX_VERSIONS)) await db.delete("versions", old.key);
    }
    set({ flows: sortFlows([...get().flows.filter((f) => f.id !== next.id), next]) });
    return next;
  },

  async deleteFlow(id, opts) {
    await db.delete("flows", id);
    for (const v of await db.byIndex<Version>("versions", "flowId", id)) await db.delete("versions", v.key);
    set({ flows: get().flows.filter((f) => f.id !== id) });
    if (opts?.remote !== false) void import("./sync").then((m) => m.deleteRemote("flow", id));
  },

  async duplicateFlow(id) {
    const src = get().flows.find((f) => f.id === id);
    if (!src) return undefined;
    const now = new Date().toISOString();
    const copy: Flow = { ...structuredClone(src), id: newId("f"), name: `${src.name} (copy)`.slice(0, 120), createdAt: now, updatedAt: now, revision: 0, favorite: false };
    const saved = await get().saveFlow(copy, { snapshot: false });
    // A copy of a flow whose trigger is switched off starts switched off too (it would fire on the same schedule / hotkey).
    const paused = get().settings.pausedTriggers;
    if (paused.includes(id)) await get().updateSettings({ pausedTriggers: [...paused, saved.id] });
    return saved;
  },

  async installTemplate(templateId) {
    const tpl = TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return undefined;
    const flow = instantiateTemplate(tpl, newId("f"));
    // Use the localized template name/description for the user's copy.
    const { t } = await import("../i18n");
    const name = t(`tpl.${tpl.id}.name`);
    const desc = t(`tpl.${tpl.id}.desc`);
    return get().saveFlow({ ...flow, name: name.startsWith("tpl.") ? flow.name : name, description: desc.startsWith("tpl.") ? flow.description : desc }, { snapshot: false });
  },

  async versions(flowId) {
    return (await db.byIndex<Version>("versions", "flowId", flowId)).sort((a, b) => b.at - a.at);
  },

  async saveProfile(p) {
    const next = InputProfileSchema.parse({ ...p, updatedAt: new Date().toISOString() });
    await db.put("profiles", next);
    set({ profiles: [...get().profiles.filter((x) => x.id !== p.id), next].sort((a, b) => b.priority - a.priority) });
  },

  async deleteProfile(id, opts) {
    await db.delete("profiles", id);
    set({ profiles: get().profiles.filter((p) => p.id !== id) });
    if (opts?.remote !== false) void import("./sync").then((m) => m.deleteRemote("profile", id));
  },

  async recordRun(r) {
    const cut = Math.max(0, r.events.length - MAX_RUN_EVENTS);
    const trimmed: RunRecord = cut ? { ...r, events: r.events.slice(-MAX_RUN_EVENTS), dropped: (r.dropped ?? 0) + cut } : r;
    await db.put("runs", trimmed);
    const runs = [trimmed, ...get().runs.filter((x) => x.id !== r.id)].slice(0, MAX_RUNS);
    set({ runs });
  },

  async deleteRun(id) {
    await db.delete("runs", id);
    set({ runs: get().runs.filter((r) => r.id !== id) });
  },

  async clearRuns() {
    await db.clear("runs");
    set({ runs: [] });
  },

  setActive(a) {
    set({ active: typeof a === "function" ? a(get().active) : a });
  },

  async updateSettings(patch) {
    // State first: two calls that overlap (a toggle while a sync finishes) must both see each other's change.
    const settings = { ...get().settings, ...patch };
    set({ settings });
    await kv.set("settings", settings);
  },

  toast(kind, text, action, onDismiss) {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts, { id, kind, text, action, onDismiss }].slice(-4) });
    // Toasts with an action (e.g. "update ready → Reload") stay until used or dismissed.
    if (!action) setTimeout(() => get().dismissToast(id), kind === "error" ? 7000 : 4000);
  },

  dismissToast(id) {
    const gone = get().toasts.find((t) => t.id === id);
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
    gone?.onDismiss?.();
  },

  setTriggerFailures(failed) {
    set({ triggerFailures: Object.fromEntries(failed.map((f) => [f.flowId, f.reason])) });
  },

  async setTriggerPaused(flowIds, paused) {
    const cur = new Set(get().settings.pausedTriggers);
    for (const id of flowIds) {
      if (paused) cur.add(id);
      else cur.delete(id);
    }
    await get().updateSettings({ pausedTriggers: [...cur] });
  },

  async importFlows(flows, onConflict = "copy") {
    let count = 0;
    const idMap = new Map<string, string>();
    const failed: { name: string; issue: string }[] = [];
    // Pass 1: decide the ids, so that "runFlow" references between the copies can follow them.
    const local = new Set(get().flows.map((x) => x.id));
    const plan = flows.map((f) => {
      const exists = local.has(f.id);
      if (exists && onConflict === "copy") idMap.set(f.id, newId("f"));
      return { f, exists };
    });
    for (const { f, exists } of plan) {
      // One flow that cannot be saved (validation, storage quota) must not abort the rest of a restore.
      try {
        const id = idMap.get(f.id);
        // Keep both: a restored copy calls the restored copies of its sub-flows, not the local originals.
        const mapped = idMap.size ? { ...f, steps: remapRunFlow(f.steps, idMap) } : f;
        if (id) await get().saveFlow({ ...mapped, id }, { snapshot: false });
        else await get().saveFlow(mapped, exists ? { note: "import" } : { snapshot: false });
        count++;
      } catch (e) {
        idMap.delete(f.id);
        failed.push({ name: f.name, issue: e instanceof Error ? e.message : String(e) });
      }
    }
    return { count, idMap, failed };
  },

  async wipeLocalData() {
    // Native keystore secrets live outside IndexedDB: remove them first, while the names are still known.
    await deleteAllSecrets().catch(() => undefined);
    await db.clearAll();
    // The copied step lives in localStorage, outside IndexedDB.
    clearCopiedStep();
    set({ flows: [], unreadable: [], profiles: [], runs: [], settings: DEFAULT_SETTINGS, triggerFailures: {} });
  },
}));

function sortFlows(flows: Flow[]): Flow[] {
  return flows.sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt.localeCompare(a.updatedAt));
}

/** Rewrites `runFlow` references (schema field `flowId`) through an old → new id map; untouched lists keep their identity. */
export function remapRunFlow(steps: Step[], idMap: ReadonlyMap<string, string>): Step[] {
  let changed = false;
  const out = steps.map((s): Step => {
    let n: Step = s;
    if (s.type === "runFlow") {
      const to = idMap.get(s.flowId);
      if (to) n = { ...s, flowId: to };
    } else if (s.type === "if") {
      const then = remapRunFlow(s.then, idMap);
      const els = remapRunFlow(s.else, idMap);
      if (then !== s.then || els !== s.else) n = { ...s, then, else: els };
    } else if (s.type === "try") {
      const body = remapRunFlow(s.body, idMap);
      const c = remapRunFlow(s.catch, idMap);
      if (body !== s.body || c !== s.catch) n = { ...s, body, catch: c };
    } else if (s.type === "loop" || s.type === "forEach" || s.type === "group") {
      const body = remapRunFlow(s.body, idMap);
      if (body !== s.body) n = { ...s, body };
    }
    if (n !== s) changed = true;
    return n;
  });
  return changed ? out : steps;
}
