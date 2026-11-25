/**
 * Optional native commands. Newer bridge commands (template images, window / app lists) do not exist
 * in app versions installed before they were added, and never in the browser: `tryInvoke` turns a
 * missing bridge, an unknown command and a rejected call into `{ ok: false }` so the caller can fall
 * back to the plain text field instead of showing an error.
 */
import type { BridgeArgs, BridgeCommand, BridgeResult } from "@autoflow/core";
import { hasNativeBridge, invoke } from "../platform";

export type Tried<T> = { ok: true; value: T } | { ok: false; error: string };

export async function tryInvoke<C extends BridgeCommand>(cmd: C, args: BridgeArgs<C>): Promise<Tried<BridgeResult<C>>> {
  if (!hasNativeBridge) return { ok: false, error: "no native bridge" };
  try {
    return { ok: true, value: await invoke(cmd, args) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Open windows (Windows app) for the window / app pickers; `null` when the command is not available. */
export async function listWindows(): Promise<{ title: string; app: string }[] | null> {
  const r = await tryInvoke("windows_list", {});
  return r.ok && Array.isArray(r.value) ? r.value.filter((w) => w && typeof w.title === "string" && typeof w.app === "string") : null;
}

/** Launchable apps (Android app), sorted by label; `null` when the command is not available. */
export async function listApps(): Promise<{ label: string; package: string }[] | null> {
  const r = await tryInvoke("apps_list", {});
  if (!r.ok || !Array.isArray(r.value)) return null;
  return r.value.filter((a) => a && typeof a.label === "string" && typeof a.package === "string").sort((a, b) => a.label.localeCompare(b.label));
}

/** Distinct, non-empty values in first-seen order (datalist options). */
export function distinct(values: (string | undefined)[]): string[] {
  return [...new Set(values.map((v) => v?.trim() ?? "").filter(Boolean))];
}
