/**
 * Promise-based dialogs (confirm / prompt) rendered by <DialogHost/>.
 */
import { create } from "zustand";
import type { ReactNode } from "react";

export interface DialogSpec {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger" | "warning";
  /** When set the dialog shows a text field and resolves with its value. */
  input?: { label: string; value?: string; placeholder?: string; type?: "text" | "password" | "textarea" };
}

interface Pending extends DialogSpec {
  id: number;
  resolve: (v: { ok: boolean; value?: string }) => void;
}

interface DialogState {
  stack: Pending[];
  open(spec: DialogSpec): Promise<{ ok: boolean; value?: string }>;
  close(id: number, result: { ok: boolean; value?: string }): void;
}

let seq = 0;

export const useDialogs = create<DialogState>((set, get) => ({
  stack: [],
  open(spec) {
    return new Promise((resolve) => {
      const id = ++seq;
      set({ stack: [...get().stack, { ...spec, id, resolve }] });
    });
  },
  close(id, result) {
    const d = get().stack.find((x) => x.id === id);
    set({ stack: get().stack.filter((x) => x.id !== id) });
    d?.resolve(result);
  },
}));

/** `signal`: closes the dialog as "No" when it aborts (a run that is halted while its question is open). */
export async function confirmDialog(spec: DialogSpec, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return false;
  const before = seq;
  const pending = useDialogs.getState().open(spec);
  const id = seq;
  const onAbort = (): void => {
    if (id !== before) useDialogs.getState().close(id, { ok: false });
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return (await pending).ok;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function promptDialog(spec: DialogSpec & { input: NonNullable<DialogSpec["input"]> }): Promise<string | null> {
  const r = await useDialogs.getState().open(spec);
  return r.ok ? (r.value ?? "") : null;
}
