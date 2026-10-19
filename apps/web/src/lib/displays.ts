/**
 * Monitors for the UI: the real displays from the native shell (`displays_list` + `displays` bridge
 * events), or the simulated Practice layout in the browser (2–4 virtual monitors side by side with
 * the practice idle game on monitor 2). The Practice world is shared by the Practice Canvas and the
 * Stage panel, so what the minimap shows is what a sandbox run sees.
 */
import { useEffect, useState } from "react";
import { PracticeWorld, sortDisplays, type DisplayInfo, type DisplayRef } from "@autoflow/core";
import { hasNativeBridge, invoke, onBridgeEvent } from "../platform";
import { useStore } from "./store";

let world: PracticeWorld | null = null;

/** The shared practice world with `count` monitors (recreated when the count changes). */
export function practiceWorld(count: number): PracticeWorld {
  const n = Math.max(1, Math.min(4, count));
  if (!world || world.displays.length !== n) world = new PracticeWorld({ displays: n, now: () => Date.now() });
  return world;
}

/** Number of simulated monitors (Practice Canvas: 1–4; Stage needs at least 2). */
export function usePracticeCount(min = 1): number {
  const n = useStore((s) => s.settings.practiceDisplays ?? 1);
  return Math.max(min, Math.min(4, n));
}

/** Connected monitors in canonical order (native), or the practice layout (browser). */
export function useDisplays(practiceMin = 2): { displays: DisplayInfo[]; practice: boolean; error?: string } {
  const count = usePracticeCount(practiceMin);
  const [native, setNative] = useState<DisplayInfo[] | null>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!hasNativeBridge) return;
    let alive = true;
    invoke("displays_list", {})
      .then((d) => alive && setNative(sortDisplays(d)))
      .catch((e: unknown) => alive && setError(String((e as Error)?.message ?? e)));
    const off = onBridgeEvent((e) => {
      if (e.kind === "displays") setNative(sortDisplays(e.displays));
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  if (hasNativeBridge) return { displays: native ?? [], practice: false, error };
  return { displays: practiceWorld(count).displays, practice: true };
}

/** The reference saved in flows: "primary" / "secondary" for the first two, otherwise the stable id. */
export function refFor(sorted: DisplayInfo[], d: DisplayInfo): DisplayRef {
  const i = sorted.indexOf(d);
  if (i === 0) return "primary";
  if (i === 1) return "secondary";
  return d.id;
}

/** Same reference? ("secondary" and the id of the second display are the same monitor today.) */
export function sameDisplay(sorted: DisplayInfo[], ref: DisplayRef | undefined, d: DisplayInfo): boolean {
  if (ref === undefined) return false;
  const i = sorted.indexOf(d);
  if (typeof ref === "object") return ref.index === i;
  return (ref === "primary" && i === 0) || (ref === "secondary" && i === 1) || ref === d.id;
}

/** RGBA pixels of a practice display at a small size, for canvases (minimap, Practice Canvas). */
export function renderPractice(w: PracticeWorld, d: DisplayInfo, width: number, height: number): ImageData {
  return new ImageData(new Uint8ClampedArray(w.sample(d.bounds, width, height)), width, height);
}
