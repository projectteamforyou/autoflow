/**
 * Keyforge — input-device profiles: key/button remapping, layers, text expansion,
 * mouse settings and per-app automatic switching. Stored separately from flows;
 * flows can switch profiles via the `switchProfile` step.
 */
import { z } from "zod";
import type { Hotkey } from "./schema.js";
import { hotkeyToString } from "./engine.js";

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const Mod = z.enum(["ctrl", "alt", "shift", "meta"]);

export const InputSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("key"), key: z.string().min(1).max(32), modifiers: z.array(Mod).max(4).default([]) }),
  z.object({ kind: z.literal("mouse"), button: z.enum(["left", "right", "middle", "x1", "x2"]), gesture: z.enum(["single", "double", "hold"]).default("single") }),
  z.object({ kind: z.literal("wheel"), direction: z.enum(["up", "down", "left", "right"]) }),
]);
export type InputSource = z.infer<typeof InputSource>;

export const InputOutput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("key"), key: z.string().min(1).max(32), modifiers: z.array(Mod).max(4).default([]) }),
  z.object({ kind: z.literal("mouse"), button: z.enum(["left", "right", "middle", "x1", "x2"]) }),
  z.object({ kind: z.literal("text"), text: z.string().max(5000) }),
  z.object({ kind: z.literal("launch"), app: z.string().max(260) }),
  z.object({ kind: z.literal("flow"), flowId: id }),
  z.object({ kind: z.literal("media"), action: z.enum(["playPause", "next", "previous", "volumeUp", "volumeDown", "mute"]) }),
  z.object({ kind: z.literal("layer"), layerId: id, mode: z.enum(["hold", "toggle"]) }),
  z.object({ kind: z.literal("disabled") }),
]);
export type InputOutput = z.infer<typeof InputOutput>;

export const Mapping = z.object({
  id,
  from: InputSource,
  to: InputOutput,
  /** Auto-repeat the output while the source is held, or toggle repeating on/off. */
  repeat: z.enum(["none", "whileHeld", "toggle"]).default("none"),
  repeatMs: z.number().int().min(10).max(60_000).default(100),
  enabled: z.boolean().default(true),
});
export type Mapping = z.infer<typeof Mapping>;

export const Layer = z.object({
  id,
  name: z.string().max(60),
  mappings: z.array(Mapping).max(500).default([]),
});
export type Layer = z.infer<typeof Layer>;

export const TextExpansion = z.object({
  id,
  abbreviation: z.string().min(2).max(40),
  /** Supports {{date()}}, {{time()}} and {{clipboard}}. */
  text: z.string().max(10_000),
  apps: z.array(z.string().max(260)).max(50).default([]),
});
export type TextExpansion = z.infer<typeof TextExpansion>;

export const MouseSettings = z.object({
  swapButtons: z.boolean().optional(),
  doubleClickMs: z.number().int().min(100).max(900).optional(),
  pointerSpeed: z.number().int().min(1).max(20).optional(),
  enhancePrecision: z.boolean().optional(),
  wheelLines: z.number().int().min(1).max(100).optional(),
  invertWheel: z.boolean().optional(),
  /** Vendor features — applied only through an official SDK for verified models. */
  dpiStages: z.array(z.number().int().min(100).max(64_000)).max(8).optional(),
  pollingRateHz: z.number().int().optional(),
});

export const ProfileRule = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("app"), app: z.string().max(260), window: z.string().max(260).optional() }),
  z.object({ kind: z.literal("time"), from: z.string().regex(/^\d{2}:\d{2}$/), to: z.string().regex(/^\d{2}:\d{2}$/), days: z.array(z.number().int().min(0).max(6)).default([0, 1, 2, 3, 4, 5, 6]) }),
  z.object({ kind: z.literal("device"), name: z.string().max(200) }),
]);
export type ProfileRule = z.infer<typeof ProfileRule>;

export const InputProfileSchema = z.object({
  schemaVersion: z.literal("1.0").default("1.0"),
  id,
  name: z.string().min(1).max(80),
  icon: z.string().max(32).default("keyboard"),
  enabled: z.boolean().default(true),
  /** Higher wins when several profiles match. The default profile has priority 0 and no rules. */
  priority: z.number().int().min(0).max(1000).default(10),
  rules: z.array(ProfileRule).max(50).default([]),
  layers: z.array(Layer).min(1).max(16),
  textExpansions: z.array(TextExpansion).max(1000).default([]),
  mouse: MouseSettings.default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type InputProfile = z.infer<typeof InputProfileSchema>;

/** OS-reserved shortcuts users cannot (or must not) remap. */
export const RESERVED_SHORTCUTS: { platform: "windows" | "android" | "all"; combo: string; noteKey: string }[] = [
  { platform: "windows", combo: "Ctrl+Alt+Delete", noteKey: "reserved.sas" },
  { platform: "windows", combo: "Meta+L", noteKey: "reserved.lock" },
  { platform: "windows", combo: "Alt+Tab", noteKey: "reserved.switcher" },
  { platform: "windows", combo: "Ctrl+Shift+Escape", noteKey: "reserved.taskManager" },
  { platform: "windows", combo: "Meta+D", noteKey: "reserved.desktop" },
  { platform: "windows", combo: "Meta+Tab", noteKey: "reserved.taskView" },
  { platform: "windows", combo: "Alt+F4", noteKey: "reserved.closeWindow" },
  { platform: "android", combo: "Power", noteKey: "reserved.power" },
];

export interface MappingConflict {
  kind: "duplicate" | "reserved" | "flowHotkey" | "selfLoop";
  layerId?: string;
  mappingIds: string[];
  detail: string;
}

export function sourceKey(s: InputSource): string {
  if (s.kind === "key") return `key:${hotkeyToString({ key: s.key, modifiers: s.modifiers })}`;
  if (s.kind === "mouse") return `mouse:${s.button}:${s.gesture}`;
  return `wheel:${s.direction}`;
}

/** Finds duplicate sources, reserved shortcuts, collisions with flow hotkeys, and key→same-key loops. */
export function findConflicts(profile: InputProfile, flowHotkeys: { flowId: string; hotkey: Hotkey }[] = []): MappingConflict[] {
  const out: MappingConflict[] = [];
  const reserved = new Map(RESERVED_SHORTCUTS.map((r) => [r.combo.toLowerCase(), r]));
  const flowMap = new Map(flowHotkeys.map((f) => [`key:${hotkeyToString(f.hotkey)}`, f.flowId]));
  for (const layer of profile.layers) {
    const seen = new Map<string, string>();
    for (const m of layer.mappings) {
      if (!m.enabled) continue;
      const k = sourceKey(m.from);
      const prev = seen.get(k);
      if (prev) out.push({ kind: "duplicate", layerId: layer.id, mappingIds: [prev, m.id], detail: k });
      else seen.set(k, m.id);
      if (m.from.kind === "key") {
        const combo = hotkeyToString({ key: m.from.key, modifiers: m.from.modifiers }).toLowerCase();
        if (reserved.has(combo)) out.push({ kind: "reserved", layerId: layer.id, mappingIds: [m.id], detail: reserved.get(combo)!.combo });
        const fid = flowMap.get(k);
        if (fid) out.push({ kind: "flowHotkey", layerId: layer.id, mappingIds: [m.id], detail: fid });
        if (m.to.kind === "key" && m.to.key === m.from.key && m.to.modifiers.join() === m.from.modifiers.join()) out.push({ kind: "selfLoop", layerId: layer.id, mappingIds: [m.id], detail: k });
      }
    }
  }
  const abbr = new Map<string, string>();
  for (const t of profile.textExpansions) {
    const prev = abbr.get(t.abbreviation);
    if (prev) out.push({ kind: "duplicate", mappingIds: [prev, t.id], detail: `text:${t.abbreviation}` });
    else abbr.set(t.abbreviation, t.id);
  }
  return out;
}

export interface ProfileContext {
  app?: string;
  window?: string;
  device?: string;
  /** Local time; defaults to now. */
  date?: Date;
}

function ruleMatches(r: ProfileRule, ctx: ProfileContext): boolean {
  if (r.kind === "app") {
    if (!ctx.app || ctx.app.toLowerCase() !== r.app.toLowerCase()) return false;
    return !r.window || (ctx.window ?? "").toLowerCase().includes(r.window.toLowerCase());
  }
  if (r.kind === "device") return !!ctx.device && ctx.device.toLowerCase().includes(r.name.toLowerCase());
  const d = ctx.date ?? new Date();
  if (!r.days.includes(d.getDay())) return false;
  const cur = d.getHours() * 60 + d.getMinutes();
  const [fh, fm] = r.from.split(":").map(Number) as [number, number];
  const [th, tm] = r.to.split(":").map(Number) as [number, number];
  const from = fh * 60 + fm;
  const to = th * 60 + tm;
  return from <= to ? cur >= from && cur < to : cur >= from || cur < to; // overnight windows
}

/** Picks the active profile: enabled, all rules match (no rules = fallback), highest priority wins. */
export function resolveActiveProfile(profiles: InputProfile[], ctx: ProfileContext): InputProfile | undefined {
  return profiles
    .filter((p) => p.enabled && (p.rules.length === 0 || p.rules.every((r) => ruleMatches(r, ctx))))
    .sort((a, b) => b.priority - a.priority || (b.rules.length - a.rules.length))[0];
}

export function createProfile(name: string, idValue: string): InputProfile {
  const now = new Date().toISOString();
  return InputProfileSchema.parse({ id: idValue, name, layers: [{ id: "base", name: "Base", mappings: [] }], createdAt: now, updatedAt: now });
}
