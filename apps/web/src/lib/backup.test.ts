import { describe, expect, it } from "vitest";
import { createFlow } from "@autoflow/core";
import { DEFAULT_SETTINGS, type Settings } from "./store";
import { MAX_BACKUP_FILE_BYTES, MAX_FLOW_FILE_BYTES, backupFileName, buildBackup, importSizeLimit, looksLikeBackup, mergePausedTriggers, parseBackup, sanitizeBackupSettings } from "./backup";

const settings: Settings = { ...DEFAULT_SETTINGS, theme: "dark", onboarded: true, pausedTriggers: ["f_a"], sync: { enabled: true, accountId: "acc", email: "a@b.c", keyCheck: "abc", cursor: "9" } };

describe("backup format", () => {
  it("writes one format: flows, profiles and settings without sync or session fields", () => {
    const flow = { ...createFlow({ name: "A", id: "f_a" }), folder: "Work", favorite: true };
    const b = buildBackup({ flows: [flow], profiles: [], settings }, new Date("2026-01-02T03:04:05Z"));
    expect(b).toMatchObject({ format: "autoflow.backup", version: 1, exportedAt: "2026-01-02T03:04:05.000Z", profiles: [] });
    expect(b.settings).toMatchObject({ theme: "dark", pausedTriggers: ["f_a"] });
    expect(b.settings).not.toHaveProperty("sync");
    expect(b.settings).not.toHaveProperty("onboarded");
    expect(JSON.stringify(b)).not.toContain("a@b.c");
    // "Export selected" is the same file without settings.
    expect(buildBackup({ flows: [flow] })).not.toHaveProperty("settings");
    expect(backupFileName(new Date("2026-01-02T03:04:05Z"), "-2-flows")).toBe("autoflow-backup-2026-01-02-2-flows.json");
  });

  it("round-trips flows with folder and favorite, and skips invalid or duplicate entries", () => {
    const flow = { ...createFlow({ name: "A", id: "f_a" }), folder: "Work", favorite: true };
    const text = JSON.stringify({ ...buildBackup({ flows: [flow], settings }), flows: [flow, { nope: true }, flow], profiles: [{ bad: 1 }] });
    const p = parseBackup(text)!;
    expect(p.flows).toHaveLength(1);
    expect(p.flows[0]).toMatchObject({ id: "f_a", folder: "Work", favorite: true });
    expect(p.skipped).toBe(3);
    expect(p.settings.theme).toBe("dark");
  });

  it("returns null for anything that is not a backup", () => {
    expect(parseBackup("not json")).toBeNull();
    expect(parseBackup("null")).toBeNull();
    expect(parseBackup(JSON.stringify({ format: "autoflow.flow", flow: {} }))).toBeNull();
    expect(parseBackup(JSON.stringify({ format: "autoflow.backup" }))).toBeNull();
  });

  it("accepts old backups without settings", () => {
    expect(parseBackup(JSON.stringify({ format: "autoflow.backup", version: 1, flows: [] }))).toEqual({ flows: [], profiles: [], skipped: 0, settings: {} });
  });
});

describe("sanitizeBackupSettings", () => {
  it("keeps valid preferences and clamps numbers", () => {
    expect(sanitizeBackupSettings({ theme: "light", defaultMode: "pro", countdownMs: 999_999, maxDurationMs: 5, reduceMotion: true, canvasSpeed: 2, practiceDisplays: 9, ledgerRetentionDays: 0, haltHotkey: { key: "F12", modifiers: ["ctrl"] }, pausedTriggers: ["f_a", "f_a", 3, ""] })).toEqual({
      theme: "light",
      defaultMode: "pro",
      countdownMs: 60_000,
      maxDurationMs: 60_000,
      reduceMotion: true,
      canvasSpeed: 2,
      practiceDisplays: 4,
      ledgerRetentionDays: 1,
      haltHotkey: { key: "F12", modifiers: ["ctrl"] },
      pausedTriggers: ["f_a"],
    });
  });

  it("never restores account, session or network-endpoint fields, and drops junk", () => {
    const out = sanitizeBackupSettings({ sync: { enabled: true, accountId: "x" }, onboarded: true, apiUrl: "https://evil.test", ai: { baseUrl: "https://evil.test" }, theme: "neon", haltHotkey: { key: "" }, countdownMs: "3", unknown: 1 });
    expect(out).toEqual({});
    expect(sanitizeBackupSettings(null)).toEqual({});
    expect(sanitizeBackupSettings([1])).toEqual({});
  });
});

describe("mergePausedTriggers", () => {
  it("keeps local pauses, follows re-identified copies and ignores flows that do not exist", () => {
    const out = mergePausedTriggers(["f_local"], ["f_a", "f_b", "f_gone"], new Map([["f_a", "f_a2"]]), new Set(["f_local", "f_a", "f_a2", "f_b"]));
    expect(out.sort()).toEqual(["f_a2", "f_b", "f_local"]);
    expect(mergePausedTriggers(["f_x"], undefined, new Map(), new Set())).toEqual(["f_x"]);
  });
});

describe("partial exports and size limits", () => {
  it('"Export selected" writes pausedTriggers of the exported flows only, and no settings when none is paused', () => {
    const a = createFlow({ name: "A", id: "f_a" });
    const b = createFlow({ name: "B", id: "f_b" });
    expect(buildBackup({ flows: [a, b], pausedTriggers: ["f_b", "f_other"] }).settings).toEqual({ pausedTriggers: ["f_b"] });
    expect(buildBackup({ flows: [a], pausedTriggers: ["f_b"] })).not.toHaveProperty("settings");
    // …and the restore side reads exactly that back.
    const p = parseBackup(JSON.stringify(buildBackup({ flows: [a, b], pausedTriggers: ["f_b"] })))!;
    expect(p.settings).toEqual({ pausedTriggers: ["f_b"] });
  });

  it("recognises a backup from its first bytes and picks the size limit", () => {
    const compact = JSON.stringify(buildBackup({ flows: [] })).slice(0, 200);
    const pretty = JSON.stringify(buildBackup({ flows: [] }), null, 2).slice(0, 200);
    expect(looksLikeBackup(compact)).toBe(true);
    expect(looksLikeBackup(pretty)).toBe(true);
    expect(looksLikeBackup('{"format":"autoflow.flow","flow":{}}')).toBe(false);
    expect(looksLikeBackup("")).toBe(false);
    expect(importSizeLimit(compact)).toBe(MAX_BACKUP_FILE_BYTES);
    expect(importSizeLimit('{"name":"x"}')).toBe(MAX_FLOW_FILE_BYTES);
    expect(MAX_BACKUP_FILE_BYTES).toBe(50_000_000);
  });
});
