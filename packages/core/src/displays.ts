/**
 * Multi-monitor model and screen "memory" math shared by every executor.
 *
 * - Displays: every backend reports its monitors as DisplayInfo in virtual-desktop pixels. Flows
 *   reference them with a DisplayRef ("primary", "secondary", a stable id or `{ index }` into the
 *   canonical order: primary first, then left to right, top to bottom).
 * - Placement: display-relative targets are converted to absolute virtual-desktop pixels by the
 *   engine (never by a backend), with one rounding rule — floor(v + 0.5) — so the TypeScript, Rust
 *   and Kotlin engines land on the same pixel even left of the primary display (negative x).
 * - Scenes: a 64-bit difference hash (dHash) of a display region. Grayscale, 9×8 box downscale and
 *   the bit order are integer-exact, so the three engines produce bit-identical hashes
 *   (fixtures/engine/conformance.json carries pixel fixtures for that).
 */
import type { DisplayRef } from "./schema.js";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DisplayInfo {
  /** Stable id from the OS (Windows: the device name such as \\.\DISPLAY2; Android: the display id). */
  id: string;
  name: string;
  primary: boolean;
  /** Virtual-desktop pixels. */
  bounds: Rect;
  /** Bounds minus taskbars / system bars. */
  workArea: Rect;
  /** DPI scale (1 = 96 DPI). */
  scale: number;
  orientation: "landscape" | "portrait";
}

/** Canonical order: primary first, then by left edge, then by top edge (stable). */
export function sortDisplays(list: readonly DisplayInfo[]): DisplayInfo[] {
  return list
    .map((d, i) => ({ d, i }))
    .sort((a, b) => Number(b.d.primary) - Number(a.d.primary) || a.d.bounds.x - b.d.bounds.x || a.d.bounds.y - b.d.bounds.y || a.i - b.i)
    .map((e) => e.d);
}

/** Finds a referenced display in an already sorted list. */
export function findDisplay(sorted: readonly DisplayInfo[], ref: DisplayRef): DisplayInfo | undefined {
  if (typeof ref === "object") return sorted[ref.index];
  if (ref === "primary") return sorted[0];
  if (ref === "secondary") return sorted[1];
  return sorted.find((d) => d.id === ref);
}

/** Human/log label of a reference: `"secondary"`, `index 2`. */
export function displayRefLabel(ref: DisplayRef): string {
  return typeof ref === "object" ? `index ${ref.index}` : `"${ref}"`;
}

/** Map key of a reference (warnings and "ask" answers are remembered per reference and run). */
export function displayRefKey(ref: DisplayRef): string {
  return typeof ref === "object" ? `#${ref.index}` : ref;
}

/** The one rounding rule for pixels: half up, also for negative coordinates. */
export function roundPx(v: number): number {
  return Math.floor(v + 0.5);
}

/** True when the pixel (x, y) lies on display bounds `b`. */
export function onDisplay(b: Rect, x: number, y: number): boolean {
  return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
}

/** A point in `space` relative to display bounds `b`, as absolute pixels. */
export function placePoint(b: Rect, x: number, y: number, space: string): { x: number; y: number } {
  if (space === "normalized") return { x: roundPx(b.x + x * b.w), y: roundPx(b.y + y * b.h) };
  if (space === "display") return { x: roundPx(b.x + x), y: roundPx(b.y + y) };
  return { x: roundPx(x), y: roundPx(y) };
}

/** A rectangle in `space` relative to display bounds `b`, as absolute pixels (at least 1×1). */
export function placeRect(b: Rect, r: Rect, space: string): Rect {
  const sx = space === "normalized" ? b.w : 1;
  const sy = space === "normalized" ? b.h : 1;
  const ox = space === "screen" ? 0 : b.x;
  const oy = space === "screen" ? 0 : b.y;
  return { x: roundPx(ox + r.x * sx), y: roundPx(oy + r.y * sy), w: Math.max(1, roundPx(r.w * sx)), h: Math.max(1, roundPx(r.h * sy)) };
}

/** True when rectangle `r` lies completely on display bounds `b`. */
export function rectOnDisplay(b: Rect, r: Rect): boolean {
  return r.x >= b.x && r.y >= b.y && r.x + r.w <= b.x + b.w && r.y + r.h <= b.y + b.h;
}

/* -------------------------------------------------------------------- colors */

/** Parses "#rrggbb" (any case) into [r, g, b]; undefined when malformed. */
export function parseColor(hex: unknown): [number, number, number] | undefined {
  if (typeof hex !== "string" || !/^#[0-9a-fA-F]{6}$/.test(hex)) return undefined;
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHexColor(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("")}`;
}

/** Largest per-channel difference (0..255). */
export function colorDistance(a: readonly number[], b: readonly number[]): number {
  return Math.max(Math.abs(a[0]! - b[0]!), Math.abs(a[1]! - b[1]!), Math.abs(a[2]! - b[2]!));
}

/* --------------------------------------------------------------------- dHash */

/** Integer luma (ITU-R BT.601 weights, rounded): the exact formula every engine uses. */
export function luma(r: number, g: number, b: number): number {
  return Math.floor((r * 299 + g * 587 + b * 114 + 500) / 1000);
}

/**
 * 64-bit difference hash of a w×h image given as an RGB(A) byte array (`channels` 3 or 4, rows top
 * to bottom). Steps: integer luma → 9×8 box average (cell x covers columns floor(x·w/9) up to
 * max(start+1, floor((x+1)·w/9)), clamped to w; likewise rows with 8) → bit (y·8+x) is 1 when cell
 * (x, y) is brighter than cell (x+1, y) → 16 lowercase hex digits, bit 0 first (most significant).
 */
export function dhash(pixels: ArrayLike<number>, w: number, h: number, channels = 4): string {
  if (w < 1 || h < 1 || pixels.length < w * h * channels) throw new Error("dhash: image is empty or too small");
  const span = (i: number, n: number, size: number): [number, number] => {
    const a = Math.floor((i * size) / n);
    const b = Math.min(size, Math.max(a + 1, Math.floor(((i + 1) * size) / n)));
    return [Math.min(a, size - 1), b];
  };
  const cells: number[] = [];
  for (let cy = 0; cy < 8; cy++) {
    const [y0, y1] = span(cy, 8, h);
    for (let cx = 0; cx < 9; cx++) {
      const [x0, x1] = span(cx, 9, w);
      let sum = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const o = (y * w + x) * channels;
          sum += luma(pixels[o]!, pixels[o + 1]!, pixels[o + 2]!);
        }
      }
      cells.push(Math.floor(sum / ((y1 - y0) * (x1 - x0))));
    }
  }
  let hex = "";
  for (let nib = 0; nib < 16; nib++) {
    let v = 0;
    for (let k = 0; k < 4; k++) {
      const bit = nib * 4 + k;
      const y = Math.floor(bit / 8);
      const x = bit % 8;
      v = (v << 1) | (cells[y * 9 + x]! > cells[y * 9 + x + 1]! ? 1 : 0);
    }
    hex += v.toString(16);
  }
  return hex;
}

const POP = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

/** Number of differing bits between two 16-digit hashes (64 when either is malformed). */
export function hammingDistance(a: string, b: string): number {
  if (!/^[0-9a-f]{16}$/i.test(a) || !/^[0-9a-f]{16}$/i.test(b)) return 64;
  let d = 0;
  for (let i = 0; i < 16; i++) d += POP[parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16)]!;
  return d;
}

/** Share of equal bits, (64 − distance) / 64 — exact in binary floating point. */
export function hashSimilarity(a: string, b: string): number {
  return (64 - hammingDistance(a, b)) / 64;
}

/**
 * Where a point target would land, for previews (Stage minimap, Practice Canvas overlays): the same
 * placement as the engine, without the missing-display policy. Undefined when it cannot be placed
 * (non-point targets, window space, unknown display). Normalized targets without a display and
 * without a stage land on the primary display, like the sandbox resolves them.
 */
export function previewPoint(
  t: { kind: string; x?: number; y?: number; space?: string; display?: DisplayRef },
  displays: readonly DisplayInfo[],
  stage?: DisplayRef,
): { x: number; y: number; display: DisplayInfo } | undefined {
  if (t.kind !== "point" || t.x === undefined || t.y === undefined || t.space === "window") return undefined;
  const sorted = sortDisplays(displays);
  const space = t.space ?? "screen";
  const ref = t.display ?? (space === "screen" ? undefined : (stage ?? "primary"));
  if (ref === undefined) {
    const x = roundPx(t.x);
    const y = roundPx(t.y);
    const d = sorted.find((m) => onDisplay(m.bounds, x, y));
    return d ? { x, y, display: d } : undefined;
  }
  const d = findDisplay(sorted, ref);
  if (!d) return undefined;
  return { ...placePoint(d.bounds, t.x, t.y, space), display: d };
}
