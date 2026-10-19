/**
 * Platform detection and the native bridge (see packages/core/src/bridge.ts).
 * - Windows shell: Tauri 2 (`window.__TAURI_INTERNALS__`)
 * - Android shell: Capacitor plugin `AutoFlowNative`
 * - Browser: no bridge; flows run in the Practice Canvas sandbox.
 */
import { BRIDGE_EVENT, type BridgeArgs, type BridgeCommand, type BridgeEvent, type BridgeResult, type Platform } from "@autoflow/core";

type TauriInternals = { invoke: (cmd: string, args?: unknown) => Promise<unknown>; transformCallback?: (cb: (e: unknown) => void, once?: boolean) => number };
type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, Record<string, (args?: unknown) => Promise<unknown>> & { addListener?: (ev: string, cb: (data: unknown) => void) => Promise<{ remove: () => void }> }>;
};

declare global {
  interface Window {
    __TAURI_INTERNALS__?: TauriInternals;
    Capacitor?: CapacitorGlobal;
  }
}

export type Shell = "tauri" | "capacitor" | "browser";

export function detectShell(): Shell {
  if (typeof window === "undefined") return "browser";
  if (window.__TAURI_INTERNALS__) return "tauri";
  if (window.Capacitor?.isNativePlatform?.() && window.Capacitor.getPlatform?.() === "android") return "capacitor";
  return "browser";
}

export const shell: Shell = detectShell();

export const platform: Platform = shell === "tauri" ? "windows" : shell === "capacitor" ? "android" : "web";

export const hasNativeBridge = shell !== "browser";

export class BridgeUnavailableError extends Error {
  constructor(cmd: string) {
    super(`"${cmd}" needs the AutoFlow app for Windows or Android`);
    this.name = "BridgeUnavailableError";
  }
}

export async function invoke<C extends BridgeCommand>(cmd: C, args: BridgeArgs<C>): Promise<BridgeResult<C>> {
  if (shell === "tauri") return (await window.__TAURI_INTERNALS__!.invoke(cmd, args)) as BridgeResult<C>;
  if (shell === "capacitor") {
    const plugin = window.Capacitor?.Plugins?.AutoFlowNative;
    const fn = plugin?.[cmd];
    if (!fn) throw new BridgeUnavailableError(cmd);
    const r = (await fn(args)) as { value?: unknown } | undefined;
    // Capacitor plugins resolve objects; array/primitive results are wrapped in { value }.
    return (r && typeof r === "object" && "value" in r && Object.keys(r).length === 1 ? r.value : r) as BridgeResult<C>;
  }
  throw new BridgeUnavailableError(cmd);
}

type Listener = (e: BridgeEvent) => void;
const listeners = new Set<Listener>();
let attached = false;

async function attach(): Promise<void> {
  if (attached) return;
  attached = true;
  const dispatch = (payload: unknown) => {
    const e = (payload && typeof payload === "object" && "payload" in (payload as Record<string, unknown>) ? (payload as { payload: unknown }).payload : payload) as BridgeEvent;
    for (const l of listeners) l(e);
  };
  if (shell === "tauri") {
    const internals = window.__TAURI_INTERNALS__!;
    const handler = internals.transformCallback ? internals.transformCallback(dispatch) : 0;
    await internals.invoke("plugin:event|listen", { event: BRIDGE_EVENT, target: { kind: "Any" }, handler });
  } else if (shell === "capacitor") {
    await window.Capacitor?.Plugins?.AutoFlowNative?.addListener?.(BRIDGE_EVENT, dispatch);
  }
}

export function onBridgeEvent(l: Listener): () => void {
  listeners.add(l);
  if (hasNativeBridge) void attach();
  return () => listeners.delete(l);
}

/** For tests and the sandbox: inject an event as if it came from native. */
export function emitLocalBridgeEvent(e: BridgeEvent): void {
  for (const l of listeners) l(e);
}
