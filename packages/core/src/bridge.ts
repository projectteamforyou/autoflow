/**
 * Native bridge contract shared by the web app and the native shells.
 *
 * - Windows: Tauri 2 commands (`invoke(name, args)`) + events (`listen(BRIDGE_EVENT)`).
 * - Android: Capacitor plugin "AutoFlowNative" (`Plugins.AutoFlowNative[name](args)`) + listener BRIDGE_EVENT.
 * - Web: no native bridge; the app uses SandboxBackend (Practice Canvas).
 *
 * Every native executor runs flows itself (Rust / Kotlin) so runs survive the UI being hidden;
 * it streams the same RunEvent objects the TypeScript engine emits.
 */
import type { Flow, Hotkey, Platform } from "./schema.js";
import type { RunEvent, RunResult, ScreenInfo } from "./engine.js";
import type { InputProfile } from "./input-profile.js";
import type { RecordedEvent } from "./record.js";
import type { DisplayInfo, Rect } from "./displays.js";

export const BRIDGE_EVENT = "autoflow://event" as const;

export type BridgeEvent =
  | { kind: "run"; runId: string; event: RunEvent }
  | { kind: "runEnded"; runId: string; result: RunResult }
  | { kind: "hotkey"; action: "start" | "pause" | "stop" | "halt"; flowId?: string }
  | { kind: "recording"; event: RecordedEvent }
  | { kind: "permission"; permission: NativePermission; granted: boolean }
  | { kind: "profileActivated"; profileId: string | null }
  | { kind: "pointPicked"; x: number; y: number; screen: ScreenInfo; displayId?: string }
  /** Monitors were added, removed, moved or rescaled (Stage panel, display chips). */
  | { kind: "displays"; displays: DisplayInfo[] };

export type NativePermission = "accessibility" | "overlay" | "notifications" | "location" | "notificationListener" | "batteryOptimization" | "inputMonitoring";

export interface PermissionStatus {
  permission: NativePermission;
  granted: boolean;
  /** Android: OEM battery restrictions etc. */
  detail?: string;
}

export interface DeviceInfo {
  platform: Platform;
  os: string;
  osVersion: string;
  appVersion: string;
  engineVersion: string;
  screens: (ScreenInfo & { x: number; y: number; primary: boolean })[];
  /** Android API level / Windows build number. */
  apiLevel?: number;
  manufacturer?: string;
  inputDevices: { id: string; name: string; kind: "keyboard" | "mouse" | "touch" | "gamepad" | "other"; vendorId?: number; productId?: number }[];
}

/** Command name → [args, result]. Names are identical on Tauri and Capacitor. */
export interface BridgeCommands {
  device_info: [Record<string, never>, DeviceInfo];
  permissions_status: [Record<string, never>, PermissionStatus[]];
  permission_request: [{ permission: NativePermission }, PermissionStatus];
  /** Starts a run in the native executor; events arrive as BridgeEvent{kind:"run"}. */
  run_start: [{ flow: Flow; inputs?: Record<string, unknown>; approvedRisk: boolean; approvedScreenChange: boolean; dryRun?: boolean }, { runId: string }];
  run_pause: [{ runId: string }, void];
  run_resume: [{ runId: string }, void];
  run_stop: [{ runId: string; reason?: string }, void];
  /** Stops every run immediately (Halt). */
  halt_all: [Record<string, never>, void];
  /** Flows with hotkey/schedule/app/device triggers that the native side must watch. */
  triggers_sync: [{ flows: Flow[]; emergencyStop: Hotkey }, { registered: string[]; failed: { flowId: string; reason: string }[] }];
  record_start: [{ maskSensitive: boolean }, void];
  record_stop: [Record<string, never>, { events: RecordedEvent[]; screen: ScreenInfo }];
  /** Shows a full-screen crosshair; resolves with the picked point (also emitted as pointPicked). */
  pick_point: [Record<string, never>, { x: number; y: number; screen: ScreenInfo; displayId?: string }];
  /** Connected monitors in virtual-desktop px (Android: the built-in display only). */
  displays_list: [Record<string, never>, DisplayInfo[]];
  /** Flashes a big number on every monitor (transparent overlay windows) so users can tell them apart. */
  displays_identify: [{ durationMs?: number }, void];
  /** Moves the AutoFlow window (the "deck") onto a monitor, away from the stage. */
  deck_pin: [{ displayId: string }, void];
  /**
   * Captures a normalized region of a monitor as a Scene: its dHash and a small thumbnail
   * (data URL ≤ MAX_SCENE_THUMB_CHARS). Android rejects it (no screen-capture integration).
   */
  scene_capture: [{ displayId: string; region: Rect }, { hash: string; thumb: string; width: number; height: number }];
  profiles_apply: [{ profiles: InputProfile[]; enabled: boolean }, { active: string | null; warnings: string[] }];
  secret_set: [{ name: string; value: string }, void];
  secret_delete: [{ name: string }, void];
  secret_list: [Record<string, never>, string[]];
  /** Opens OS settings pages (accessibility, battery, overlay…). */
  open_settings: [{ page: NativePermission | "app" }, void];
  autostart_set: [{ enabled: boolean }, void];
  /** Opens an https link in the system browser (the app WebView never navigates away). */
  open_external: [{ url: string }, void];
}

export type BridgeCommand = keyof BridgeCommands;
export type BridgeArgs<C extends BridgeCommand> = BridgeCommands[C][0];
export type BridgeResult<C extends BridgeCommand> = BridgeCommands[C][1];
