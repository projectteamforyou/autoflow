/**
 * Sandbox backend: runs any flow against a virtual screen. Powers the in-browser
 * "Practice Canvas", template previews, tests and dry runs on every platform —
 * nothing touches the real mouse or keyboard.
 */
import type { Backend, InputAction, ScreenInfo } from "./engine.js";
import type { Platform, Target } from "./schema.js";
import type { Value } from "./expr.js";

export interface SandboxEffect {
  at: number;
  action: InputAction;
  /** Resolved pixel position(s) on the virtual screen, when the action has a target. */
  points?: { x: number; y: number }[];
}

export interface SandboxOptions {
  screen?: ScreenInfo;
  platform?: Platform;
  /** Called for every action (UI animation hook). */
  onEffect?: (e: SandboxEffect) => void;
  /** Answer for confirm steps (default: yes). */
  confirm?: (message: string) => Promise<boolean> | boolean;
  /** Notification sink. */
  notify?: (title: string, body: string) => void;
  /** Optional real HTTP for GET requests (browser fetch). Non-GET is always simulated. */
  fetchGet?: (url: string) => Promise<string>;
  now?: () => number;
  /** Simulated cost of each action, so effects can be animated. */
  actionDelayMs?: number;
  /** Initial pointer position. */
  pointer?: { x: number; y: number };
}

export class SandboxBackend implements Backend {
  readonly platform: Platform;
  readonly effects: SandboxEffect[] = [];
  clipboard = "";
  pointer: { x: number; y: number };
  readonly typed: string[] = [];
  readonly files = new Map<string, string>();

  constructor(private readonly opts: SandboxOptions = {}) {
    this.platform = opts.platform ?? "web";
    const s = this.screenInfo();
    this.pointer = opts.pointer ?? { x: Math.round(s.width / 2), y: Math.round(s.height / 2) };
  }

  private screenInfo(): ScreenInfo {
    return this.opts.screen ?? { width: 1280, height: 800, scale: 1 };
  }

  async screen(): Promise<ScreenInfo> {
    return this.screenInfo();
  }

  resolve(t: Target, pick: () => number = Math.random): { x: number; y: number } {
    const s = this.screenInfo();
    switch (t.kind) {
      case "point":
        return t.space === "normalized" ? { x: Math.round(t.x * s.width), y: Math.round(t.y * s.height) } : { x: Math.round(t.x), y: Math.round(t.y) };
      case "region": {
        const scale = t.space === "normalized" ? { w: s.width, h: s.height } : { w: 1, h: 1 };
        const x = t.x * scale.w;
        const y = t.y * scale.h;
        const w = t.w * scale.w;
        const h = t.h * scale.h;
        return t.pick === "random" ? { x: Math.round(x + pick() * w), y: Math.round(y + pick() * h) } : { x: Math.round(x + w / 2), y: Math.round(y + h / 2) };
      }
      case "current":
        return { ...this.pointer };
      case "element":
      case "image":
        return { x: Math.round(s.width / 2), y: Math.round(s.height / 2) };
    }
  }

  async perform(action: InputAction, signal: AbortSignal): Promise<Value | void> {
    if (signal.aborted) throw signal.reason;
    const points: { x: number; y: number }[] = [];
    let result: Value | void = undefined;
    switch (action.type) {
      case "click":
      case "move":
        points.push(this.resolve(action.target));
        this.pointer = points[0]!;
        break;
      case "drag":
        points.push(this.resolve(action.from), this.resolve(action.to));
        this.pointer = points[1]!;
        break;
      case "scroll":
        if (action.target) points.push(this.resolve(action.target));
        break;
      case "type":
        this.typed.push(action.text);
        break;
      case "clipboardSet":
        this.clipboard = action.value;
        break;
      case "clipboardGet":
        result = this.clipboard;
        break;
      case "notify":
        this.opts.notify?.(action.title, action.body);
        break;
      case "http":
        result = action.method === "GET" && this.opts.fetchGet ? await this.opts.fetchGet(action.url) : `simulated ${action.method} ${action.url}`;
        break;
      case "file":
        if (action.op === "write") this.files.set(action.path, action.content ?? "");
        else if (action.op === "append") this.files.set(action.path, (this.files.get(action.path) ?? "") + (action.content ?? ""));
        else if (action.op === "read") result = this.files.get(action.path) ?? "";
        else if (action.op === "exists") result = this.files.has(action.path);
        else if (action.op === "delete") this.files.delete(action.path);
        break;
      case "ocr":
        result = "";
        break;
      case "findImage":
        result = null;
        break;
      default:
        break;
    }
    const effect: SandboxEffect = { at: (this.opts.now ?? Date.now)(), action, points: points.length ? points : undefined };
    this.effects.push(effect);
    if (this.effects.length > 5000) this.effects.splice(0, this.effects.length - 5000);
    this.opts.onEffect?.(effect);
    if (this.opts.actionDelayMs) await new Promise((r) => setTimeout(r, this.opts.actionDelayMs));
    return result;
  }

  async confirm(message: string): Promise<boolean> {
    return this.opts.confirm ? await this.opts.confirm(message) : true;
  }
}
