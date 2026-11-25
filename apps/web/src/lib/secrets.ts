/**
 * Flow secrets: the values behind `{{secret:name}}`.
 *
 * Storage rule: in the Windows / Android app a value goes to the OS keystore through the bridge
 * (what native runs read) AND to the web vault (what Practice Canvas runs read); in the browser
 * only the web vault exists. Values are write-only here: the UI lists names, never values.
 * Names with the `ai:` prefix are AI provider keys; they are never listed or touched.
 */
import type { Flow } from "@autoflow/core";
import { vault } from "./crypto";
import { hasNativeBridge, invoke } from "../platform";

/** Names the manager accepts (the recorder creates `recorded_N`). */
export const SECRET_NAME = /^[A-Za-z0-9_]{1,40}$/;

const REF = /\{\{\s*secret:\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** Secret names referenced by one string. */
export function secretNamesInText(text: string, into: Set<string> = new Set()): Set<string> {
  for (const m of text.matchAll(REF)) into.add(m[1]!);
  return into;
}

/** Secret names referenced anywhere in a flow's steps (every string field, nested steps included), sorted. */
export function secretNamesInFlow(flow: Pick<Flow, "steps">): string[] {
  const names = new Set<string>();
  // Iterative walk over the step tree as plain JSON: new step types and fields are covered without a list of them.
  const stack: unknown[] = [flow.steps];
  while (stack.length) {
    const v = stack.pop();
    if (typeof v === "string") secretNamesInText(v, names);
    else if (Array.isArray(v)) for (const x of v) stack.push(x);
    else if (v && typeof v === "object") for (const x of Object.values(v)) stack.push(x);
  }
  return [...names].sort();
}

/** name → flows that reference it. */
export function secretUsage<F extends Pick<Flow, "steps">>(flows: F[]): Map<string, F[]> {
  const out = new Map<string, F[]>();
  for (const f of flows) {
    for (const n of secretNamesInFlow(f)) {
      const list = out.get(n);
      if (list) list.push(f);
      else out.set(n, [f]);
    }
  }
  return out;
}

const isFlowSecret = (n: string) => !n.startsWith("ai:");

/** Names stored on this device (keystore ∪ web vault), sorted. Never returns values. */
export async function listSecrets(): Promise<string[]> {
  const names = new Set((await vault.list()).filter(isFlowSecret));
  if (hasNativeBridge) for (const n of await invoke("secret_list", {})) if (isFlowSecret(n)) names.add(n);
  return [...names].sort();
}

export async function setSecret(name: string, value: string): Promise<void> {
  if (!SECRET_NAME.test(name)) throw new Error(`invalid secret name: ${name}`);
  // Keystore first: if it refuses, the vault must not claim the secret exists on this device.
  if (hasNativeBridge) await invoke("secret_set", { name, value });
  await vault.set(name, value);
}

export async function deleteSecret(name: string): Promise<void> {
  if (!isFlowSecret(name)) return;
  if (hasNativeBridge) await invoke("secret_delete", { name });
  await vault.delete(name);
}

/**
 * "Delete everything": removes every flow secret from the OS keystore (native apps) and the web
 * vault. AI provider keys in the vault go with the local database; the keystore holds none.
 * Best effort per name, so one refusal does not leave the rest behind.
 */
export async function deleteAllSecrets(): Promise<void> {
  const names = new Set<string>();
  for (const n of await vault.list().catch(() => [])) names.add(n);
  if (hasNativeBridge) for (const n of await invoke("secret_list", {}).catch(() => [] as string[])) names.add(n);
  for (const name of names) {
    if (!isFlowSecret(name)) continue;
    if (hasNativeBridge) await invoke("secret_delete", { name }).catch(() => undefined);
    await vault.delete(name).catch(() => undefined);
  }
}
