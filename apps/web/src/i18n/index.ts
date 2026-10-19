/**
 * i18n: English is the typed source dictionary; other locales are JSON files with the same keys
 * (missing keys fall back to English). Explain/target/trigger phrases from @autoflow/core are
 * merged in so one dictionary covers the whole app.
 */
import { useSyncExternalStore } from "react";
import { EXPLAIN_EN, LOCALES, matchLocale, format, renderPhrase, type LocaleCode, type Phrase } from "@autoflow/core";
import { en } from "./en";

export type Dict = Record<string, string>;
export type MessageKey = keyof typeof en | (string & {});

const base: Dict = { ...EXPLAIN_EN, ...en };
const loaders = import.meta.glob<{ default: Dict }>("./locales/*.json");

let current: LocaleCode = "en";
let dict: Dict = base;
const subs = new Set<() => void>();

function stored(): LocaleCode | null {
  try {
    const v = localStorage.getItem("af.locale");
    return v && LOCALES.some((l) => l.code === v) ? (v as LocaleCode) : null;
  } catch {
    return null;
  }
}

export function initialLocale(): LocaleCode {
  return stored() ?? matchLocale(typeof navigator !== "undefined" ? navigator.languages ?? [navigator.language] : []);
}

export async function setLocale(code: LocaleCode): Promise<void> {
  let next: Dict = base;
  if (code !== "en") {
    const load = loaders[`./locales/${code}.json`];
    if (load) next = { ...base, ...(await load()).default };
  }
  current = code;
  dict = next;
  try {
    localStorage.setItem("af.locale", code);
  } catch {
    /* private mode */
  }
  if (typeof document !== "undefined") {
    document.documentElement.lang = code;
    document.documentElement.dir = LOCALES.find((l) => l.code === code)?.dir ?? "ltr";
  }
  subs.forEach((s) => s());
}

export function getLocale(): LocaleCode {
  return current;
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = dict[key] ?? base[key] ?? String(key);
  return params ? format(template, params) : template;
}

export function tp(p: Phrase): string {
  return renderPhrase(p, (k) => dict[k] ?? base[k]);
}

function subscribe(cb: () => void) {
  subs.add(cb);
  return () => subs.delete(cb);
}

/** Re-renders the component when the language changes. */
export function useLocale(): LocaleCode {
  return useSyncExternalStore(subscribe, () => current, () => current);
}

export function useT(): typeof t {
  useLocale();
  return t;
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat(current).format(n);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${Math.round(s % 60)} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function formatRelative(ts: number): string {
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(current, { numeric: "auto" });
  if (abs < 60_000) return rtf.format(Math.round(diff / 1000), "second");
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  return rtf.format(Math.round(diff / 86_400_000), "day");
}
