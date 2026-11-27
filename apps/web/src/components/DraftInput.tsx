/**
 * Text inputs whose stored value is parsed from what is typed (a list, a map, a number).
 * Rendering the parsed value straight back into the field eats keystrokes: "work," becomes "work",
 * "Accept" (no colon yet) becomes "", "-" becomes 0. These keep the typed text as a local draft, hand
 * the parsed value up on every change, and only replace the draft when the value changes from outside.
 */
import { useEffect, useRef, useState } from "react";

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** `parse` returns `undefined` for text that is not a value yet (the stored value is left alone). */
export function useDraft<T>(value: T, show: (v: T) => string, parse: (text: string) => T | undefined): { draft: string; type: (text: string) => T | undefined; settle: () => void } {
  const [draft, setDraft] = useState(() => show(value));
  const fns = useRef({ show, parse });
  fns.current = { show, parse };
  const key = JSON.stringify(value);
  useEffect(() => {
    setDraft((d) => (sameJson(fns.current.parse(d), value) ? d : fns.current.show(value)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return {
    draft,
    type: (text) => {
      setDraft(text);
      return fns.current.parse(text);
    },
    settle: () => setDraft(fns.current.show(value)),
  };
}

export function DraftInput<T>({ value, show, parse, onChange, ...rest }: { value: T; show: (v: T) => string; parse: (text: string) => T | undefined; onChange: (v: T) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const d = useDraft(value, show, parse);
  return (
    <input
      {...rest}
      value={d.draft}
      onChange={(e) => {
        const v = d.type(e.target.value);
        if (v !== undefined) onChange(v);
      }}
      onBlur={(e) => {
        d.settle();
        rest.onBlur?.(e);
      }}
    />
  );
}

export function DraftTextarea<T>({ value, show, parse, onChange, ...rest }: { value: T; show: (v: T) => string; parse: (text: string) => T | undefined; onChange: (v: T) => void } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
  const d = useDraft(value, show, parse);
  return (
    <textarea
      {...rest}
      value={d.draft}
      onChange={(e) => {
        const v = d.type(e.target.value);
        if (v !== undefined) onChange(v);
      }}
      onBlur={(e) => {
        d.settle();
        rest.onBlur?.(e);
      }}
    />
  );
}

/** A number that may be mid-typing ("-", "1.", ""): `undefined` until it is a finite number, then clamped (and rounded for whole-number fields). */
export function parseNumberDraft(text: string, min: number, max: number, whole: boolean): number | undefined {
  const n = Number(text);
  if (text.trim() === "" || !Number.isFinite(n)) return undefined;
  const c = Math.max(min, Math.min(max, n));
  return whole ? Math.round(c) : c;
}

/** "Name: value" lines → header map. Lines without a colon are still being typed and are skipped. */
export function parseHeaderLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf(":");
    const name = i > 0 ? line.slice(0, i).trim() : "";
    if (name) out[name] = line.slice(i + 1).trim();
  }
  return out;
}
