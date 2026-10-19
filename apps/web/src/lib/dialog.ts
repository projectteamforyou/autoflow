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

export async function confirmDialog(spec: DialogSpec): Promise<boolean> {
  return (await useDialogs.getState().open(spec)).ok;
}

export async function promptDialog(spec: DialogSpec & { input: NonNullable<DialogSpec["input"]> }): Promise<string | null> {
  const r = await useDialogs.getState().open(spec);
  return r.ok ? (r.value ?? "") : null;
}
