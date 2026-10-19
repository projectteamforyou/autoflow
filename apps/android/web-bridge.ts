/**
 * Typed adapter for the Android native bridge (Capacitor plugin "AutoFlowNative").
 *
 * Capacitor resolves plugin calls with an object only, so every AutoFlowNative command resolves `{ value }`;
 * this adapter unwraps it so callers see exactly `BridgeResult<C>` from packages/core/src/bridge.ts.
 * Rejections carry `code` = an ErrorCategory ("validation", "permission", "unsupported", "internal", …).
 *
 *   import { androidBridge } from "@autoflow/android/web-bridge";
 *   const { runId } = await androidBridge.invoke("run_start", { flow, approvedRisk: true, approvedScreenChange: false });
 *   const off = await androidBridge.listen((e) => console.log(e.kind));
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { BridgeArgs, BridgeCommand, BridgeEvent, BridgeResult } from "@autoflow/core";

const EVENT = "autoflow://event";

type NativePlugin = {
  [K in BridgeCommand]: (args: BridgeArgs<K>) => Promise<{ value: BridgeResult<K> }>;
} & {
  addListener(event: typeof EVENT, cb: (e: BridgeEvent) => void): Promise<PluginListenerHandle>;
};

const AutoFlowNative = registerPlugin<NativePlugin>("AutoFlowNative");

export const androidBridge = {
  /** True inside the Android app (the plugin exists); false in a browser. */
  available: (): boolean => Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("AutoFlowNative"),

  async invoke<C extends BridgeCommand>(command: C, args: BridgeArgs<C>): Promise<BridgeResult<C>> {
    const call = AutoFlowNative[command] as (a: BridgeArgs<C>) => Promise<{ value: BridgeResult<C> }>;
    const res = await call(args ?? ({} as BridgeArgs<C>));
    return res?.value as BridgeResult<C>;
  },

  async listen(cb: (e: BridgeEvent) => void): Promise<() => void> {
    const handle = await AutoFlowNative.addListener(EVENT, cb);
    return () => void handle.remove();
  },
};
