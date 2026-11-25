/**
 * The one "autoflow.backup" file format (pure helpers; the file dialogs live in actions.ts).
 *
 * { format, version, exportedAt, flows, profiles, settings? } — written by the Library ("Backup",
 * "Export selected") and by Settings ("Export everything"), read by every restore entry point.
 * Flows are stored as they are (folder, favorite and image references included): a backup is the
 * owner's own data, unlike a shared flow, which is sanitized.
 */
import { Hotkey, InputProfileSchema, parseFlow, type Flow, type InputProfile } from "@autoflow/core";
import type { Settings } from "./store";

export const BACKUP_FORMAT = "autoflow.backup";

/** Settings as they travel in a backup: no account/sync state and no per-device session flags. */
export type BackupSettings = Omit<Settings, "sync" | "onboarded">;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: 1;
  exportedAt: string;
  flows: Flow[];
  profiles: InputProfile[];
  /** The whole settings ("Backup", "Export everything") or just `pausedTriggers` of the exported flows ("Export selected"). */
  settings?: Partial<BackupSettings>;
}

/** Drops what must stay on the device: the sync account/cursor/key fingerprint and the onboarding flag. */
export function settingsForBackup(s: Settings): BackupSettings {
  const { sync: _sync, onboarded: _onboarded, ...rest } = s;
  return rest;
}

/**
 * `settings`: the whole settings travel with the file. `pausedTriggers` alone (a partial export): only
 * the ids of the exported flows are written, so their triggers do not come back armed after a restore.
 */
export function buildBackup(input: { flows: Flow[]; profiles?: InputProfile[]; settings?: Settings; pausedTriggers?: readonly string[] }, now = new Date()): BackupFile {
  const ids = new Set(input.flows.map((f) => f.id));
  const paused = (input.pausedTriggers ?? []).filter((id) => ids.has(id));
  const settings: Partial<BackupSettings> | undefined = input.settings ? settingsForBackup(input.settings) : paused.length ? { pausedTriggers: paused } : undefined;
  return { format: BACKUP_FORMAT, version: 1, exportedAt: now.toISOString(), flows: input.flows, profiles: input.profiles ?? [], ...(settings ? { settings } : {}) };
}

/** Largest file accepted as a single flow / share import, and as a backup (a library with images and many flows). */
export const MAX_FLOW_FILE_BYTES = 2_000_000;
export const MAX_BACKUP_FILE_BYTES = 50_000_000;

/**
 * Cheap format sniff on the first bytes of a file, before anything is parsed: backups are written
 * with `format` as the first key, so `"format":"autoflow.backup"` (any whitespace) shows up at once.
 */
export function looksLikeBackup(head: string): boolean {
  return /"format"\s*:\s*"autoflow\.backup"/.test(head);
}

/** Size limit for an import file: 50 MB when it is a backup, 2 MB for everything else. `head` = its first few kB of text. */
export function importSizeLimit(head: string): number {
  return looksLikeBackup(head) ? MAX_BACKUP_FILE_BYTES : MAX_FLOW_FILE_BYTES;
}

export function backupFileName(now = new Date(), suffix = ""): string {
  return `autoflow-backup-${now.toISOString().slice(0, 10)}${suffix}.json`;
}

const num = (v: unknown, min: number, max: number): number | undefined => (typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : undefined);

/**
 * Settings a restore may apply, validated field by field (a backup is an untrusted file).
 * Deliberately not restored: `sync` and `onboarded` (device state), and `apiUrl` / `ai` — a crafted
 * file must not be able to point the app, or a stored AI key, at someone else's server.
 */
export function sanitizeBackupSettings(raw: unknown): Partial<Settings> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<Settings> = {};
  if (r.theme === "system" || r.theme === "dark" || r.theme === "light") out.theme = r.theme;
  if (r.defaultMode === "easy" || r.defaultMode === "pro") out.defaultMode = r.defaultMode;
  const countdown = num(r.countdownMs, 0, 60_000);
  if (countdown !== undefined) out.countdownMs = Math.round(countdown);
  const maxDuration = num(r.maxDurationMs, 60_000, 10_080 * 60_000);
  if (maxDuration !== undefined) out.maxDurationMs = Math.round(maxDuration);
  const halt = Hotkey.safeParse(r.haltHotkey);
  if (halt.success) out.haltHotkey = halt.data;
  if (typeof r.reduceMotion === "boolean") out.reduceMotion = r.reduceMotion;
  const speed = num(r.canvasSpeed, 0.25, 8);
  if (speed !== undefined) out.canvasSpeed = speed;
  const displays = num(r.practiceDisplays, 1, 4);
  if (displays !== undefined) out.practiceDisplays = Math.round(displays);
  const retention = num(r.ledgerRetentionDays, 1, 365);
  if (retention !== undefined) out.ledgerRetentionDays = Math.round(retention);
  if (Array.isArray(r.pausedTriggers)) out.pausedTriggers = [...new Set(r.pausedTriggers.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64))].slice(0, 2000);
  return out;
}

export interface ParsedBackup {
  flows: Flow[];
  profiles: InputProfile[];
  /** Flows / profiles in the file that failed validation and were left out. */
  skipped: number;
  settings: Partial<Settings>;
}

/** Parses backup text. Null when it is not a backup (callers then try a single-flow import). */
export function parseBackup(text: string): ParsedBackup | null {
  let data: { format?: unknown; flows?: unknown; profiles?: unknown; settings?: unknown } | null;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || data.format !== BACKUP_FORMAT || !Array.isArray(data.flows)) return null;
  const flows: Flow[] = [];
  const profiles: InputProfile[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const f of data.flows) {
    const p = parseFlow(f);
    // The same id twice in one file would make the second copy overwrite the first.
    if (p.ok && !seen.has(p.flow.id)) {
      seen.add(p.flow.id);
      flows.push(p.flow);
    } else skipped++;
  }
  for (const p of Array.isArray(data.profiles) ? data.profiles : []) {
    const r = InputProfileSchema.safeParse(p);
    if (r.success) profiles.push(r.data);
    else skipped++;
  }
  return { flows, profiles, skipped, settings: sanitizeBackupSettings(data.settings) };
}

/**
 * pausedTriggers after a restore: what was paused here stays paused; ids from the backup follow
 * their flow (`idMap` holds the new id of flows imported as a copy) and only count if that flow exists.
 */
export function mergePausedTriggers(current: readonly string[], fromBackup: readonly string[] | undefined, idMap: ReadonlyMap<string, string>, existingIds: ReadonlySet<string>): string[] {
  const out = new Set(current);
  for (const id of fromBackup ?? []) {
    const mapped = idMap.get(id) ?? id;
    if (existingIds.has(mapped)) out.add(mapped);
  }
  return [...out];
}
