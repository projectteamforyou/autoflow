/**
 * Anonymous public counters (same as the website footer): one visit per app session, a heartbeat
 * while visible ("online now"), and totals for the About screen. No account, IP or device data.
 */
import { useEffect, useState } from "react";
import { useStore } from "./store";
import { shell } from "../platform";

export interface PublicStats {
  visitsTotal: number;
  onlineNow: number;
  downloads: { windows: number; android: number; total: number };
}

const surface = shell === "tauri" ? "windows" : shell === "capacitor" ? "android" : "app";
const base = () => useStore.getState().settings.apiUrl.replace(/\/+$/, "");

function sessionId(): { sid: string; isNew: boolean } {
  try {
    const existing = sessionStorage.getItem("af-sid");
    if (existing) return { sid: existing, isNew: false };
  } catch {
    /* private mode */
  }
  const a = crypto.getRandomValues(new Uint8Array(16));
  const sid = `a${[...a].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  try {
    sessionStorage.setItem("af-sid", sid);
  } catch {
    /* ignore */
  }
  return { sid, isNew: true };
}

async function hit(sid: string, newVisit: boolean): Promise<void> {
  await fetch(`${base()}/v1/stats/hit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sid, surface, newVisit }), keepalive: true }).catch(() => undefined);
}

let started = false;
export function startPresence(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  const { sid, isNew } = sessionId();
  void hit(sid, isNew);
  setInterval(() => document.visibilityState === "visible" && void hit(sid, false), 60_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") navigator.sendBeacon?.(`${base()}/v1/stats/leave`, new Blob([JSON.stringify({ sid })], { type: "text/plain" }));
    else void hit(sid, false);
  });
}

export function usePublicStats(): PublicStats | null {
  const [s, setS] = useState<PublicStats | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${base()}/v1/stats`)
        .then((r) => (r.ok ? (r.json() as Promise<PublicStats>) : null))
        .then((v) => alive && v && setS(v))
        .catch(() => undefined);
    void load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return s;
}
