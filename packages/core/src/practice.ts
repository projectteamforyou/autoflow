/**
 * Practice world: a deterministic virtual desktop with 1–4 monitors side by side, one of which
 * (the stage) shows a tiny idle game. It lets browser users try Stage mode, pixel conditions and
 * Scenes without installing anything, and gives tests a screen whose pixels follow the clock.
 *
 * The game has three scenes — lobby → battle → reward → lobby:
 * - lobby: a "Start" button (green) starts a battle,
 * - battle: ends by itself after `battleMs`,
 * - reward: a "Collect" button (gold) adds 10 coins and returns to the lobby.
 * Every pixel is a pure function of (scene, position, battle progress), so hashes are reproducible.
 */
import { dhash, onDisplay, type DisplayInfo, type Rect } from "./displays.js";

export type PracticeScene = "lobby" | "battle" | "reward";
export const PRACTICE_SCENES: PracticeScene[] = ["lobby", "battle", "reward"];

/** Buttons in normalized stage-display coordinates. */
export const PRACTICE_BUTTONS = {
  start: { x: 0.4, y: 0.62, w: 0.2, h: 0.12, color: "#2ecc71" },
  collect: { x: 0.4, y: 0.7, w: 0.2, h: 0.12, color: "#f1c40f" },
} as const;

/** Area the bundled templates remember as their scenes (everything below the title bar). */
export const PRACTICE_SCENE_REGION: Rect = { x: 0, y: 0.1, w: 1, h: 0.9 };

export interface PracticeWorldOptions {
  /** Number of monitors (1–4), laid out left to right; the primary is the leftmost. */
  displays?: number;
  displayWidth?: number;
  displayHeight?: number;
  /** Canonical index of the display that shows the game (default: 1 with two or more monitors). */
  stageIndex?: number;
  /** Duration of one battle. */
  battleMs?: number;
  now?: () => number;
}

/** Monitors of a practice layout: `count` displays of w×h side by side, ids "practice-1"… */
export function practiceDisplays(count: number, w = 1280, h = 720): DisplayInfo[] {
  const n = Math.max(1, Math.min(4, Math.floor(count)));
  return Array.from({ length: n }, (_, i) => {
    const bounds = { x: i * w, y: 0, w, h };
    return { id: `practice-${i + 1}`, name: `Practice monitor ${i + 1}`, primary: i === 0, bounds, workArea: { ...bounds, h: h - 40 }, scale: 1, orientation: w >= h ? "landscape" : "portrait" };
  });
}

const inside = (r: { x: number; y: number; w: number; h: number }, u: number, v: number) => u >= r.x && u < r.x + r.w && v >= r.y && v < r.y + r.h;

/** Pixel of the game in normalized stage coordinates (u, v ∈ [0, 1)). */
export function gamePixel(scene: PracticeScene, u: number, v: number, progress = 0): [number, number, number] {
  if (v < 0.1) return u < 0.3 ? [27, 31, 59] : [37, 42, 78]; // title bar
  switch (scene) {
    case "lobby":
      if (inside(PRACTICE_BUTTONS.start, u, v)) return [46, 204, 113];
      // sky fading to the right over green hills
      return v > 0.8 - 0.1 * Math.sin(u * 6) ? [34, 120 + Math.floor(60 * (1 - u)), 60] : [40, 70 + Math.floor(150 * (1 - u)), 190];
    case "battle":
      if (v > 0.85 && v < 0.9) return u < progress ? [231, 76, 60] : [60, 20, 20];
      // vertical red / dark bands
      return Math.floor(u * 10) % 2 === 0 ? [192, 57, 43] : [44, 18, 30];
    case "reward":
      if (inside(PRACTICE_BUTTONS.collect, u, v)) return [241, 196, 15];
      // purple, brightening to the right, with a gold glow in the middle
      return Math.abs(u - 0.5) < 0.12 && v > 0.25 && v < 0.6 ? [250, 215, 90] : [60 + Math.floor(120 * u), 30, 90 + Math.floor(100 * u)];
  }
}

/** Pixel of a monitor that is not the stage (the "deck": a calm grid). */
export function deckPixel(u: number, v: number): [number, number, number] {
  return Math.floor(u * 16) % 2 === Math.floor(v * 9) % 2 ? [20, 22, 43] : [26, 28, 52];
}

export class PracticeWorld {
  readonly displays: DisplayInfo[];
  readonly stageIndex: number;
  scene: PracticeScene = "lobby";
  coins = 0;
  rounds = 0;
  private battleStartedAt = 0;
  private readonly battleMs: number;
  private readonly now: () => number;

  constructor(opts: PracticeWorldOptions = {}) {
    this.displays = practiceDisplays(opts.displays ?? 2, opts.displayWidth ?? 1280, opts.displayHeight ?? 720);
    this.stageIndex = Math.min(this.displays.length - 1, Math.max(0, opts.stageIndex ?? (this.displays.length > 1 ? 1 : 0)));
    this.battleMs = opts.battleMs ?? 1500;
    this.now = opts.now ?? Date.now;
  }

  get stage(): DisplayInfo {
    return this.displays[this.stageIndex]!;
  }

  /** Battle progress 0..1. */
  get progress(): number {
    return this.scene === "battle" ? Math.min(1, (this.now() - this.battleStartedAt) / this.battleMs) : 0;
  }

  /** Advances the game clock (a finished battle shows the reward). */
  update(): void {
    if (this.scene === "battle" && this.now() - this.battleStartedAt >= this.battleMs) this.scene = "reward";
  }

  /** A click at virtual-desktop pixel (x, y). Returns true when it hit a game button. */
  click(x: number, y: number): boolean {
    this.update();
    const b = this.stage.bounds;
    if (!onDisplay(b, x, y)) return false;
    const u = (x - b.x) / b.w;
    const v = (y - b.y) / b.h;
    if (this.scene === "lobby" && inside(PRACTICE_BUTTONS.start, u, v)) {
      this.scene = "battle";
      this.battleStartedAt = this.now();
      return true;
    }
    if (this.scene === "reward" && inside(PRACTICE_BUTTONS.collect, u, v)) {
      this.scene = "lobby";
      this.coins += 10;
      this.rounds++;
      return true;
    }
    return false;
  }

  /** RGB at virtual-desktop pixel (x, y); black outside every monitor. */
  pixel(x: number, y: number): [number, number, number] {
    this.update();
    const d = this.displays.find((m) => onDisplay(m.bounds, x, y));
    if (!d) return [0, 0, 0];
    const u = (x - d.bounds.x + 0.5) / d.bounds.w;
    const v = (y - d.bounds.y + 0.5) / d.bounds.h;
    return d === this.stage ? gamePixel(this.scene, u, v, this.progress) : deckPixel(u, v);
  }

  /** RGBA pixels of a virtual-desktop rectangle sampled on a w×h grid (cell centres). */
  sample(r: Rect, w: number, h: number): Uint8ClampedArray {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const [cr, cg, cb] = this.pixel(Math.floor(r.x + ((i + 0.5) * r.w) / w), Math.floor(r.y + ((j + 0.5) * r.h) / h));
        const o = (j * w + i) * 4;
        out[o] = cr;
        out[o + 1] = cg;
        out[o + 2] = cb;
        out[o + 3] = 255;
      }
    }
    return out;
  }

  /** dHash of a virtual-desktop rectangle (sampled at most 288×256 so big regions stay cheap). */
  sceneHash(r: Rect): string {
    const w = Math.max(1, Math.min(288, Math.round(r.w)));
    const h = Math.max(1, Math.min(256, Math.round(r.h)));
    return dhash(this.sample(r, w, h), w, h, 4);
  }
}

/** Hash of a practice scene over a normalized stage region (how the bundled templates remember it). */
export function practiceSceneHash(scene: PracticeScene, region: Rect = PRACTICE_SCENE_REGION): string {
  const world = new PracticeWorld({ displays: 1, now: () => 0 });
  world.scene = scene;
  const b = world.stage.bounds;
  return world.sceneHash({ x: Math.floor(b.x + region.x * b.w + 0.5), y: Math.floor(b.y + region.y * b.h + 0.5), w: Math.floor(region.w * b.w + 0.5), h: Math.floor(region.h * b.h + 0.5) });
}
