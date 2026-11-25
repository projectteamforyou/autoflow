/**
 * Desktop update prompt: the Windows app compares its own version with the latest published one
 * (`windowsVersion` of the public stats endpoint) once per session and offers the download page.
 */
import { tryInvoke } from "./native";
import { openExternal, SITE_URL } from "./site";
import { useStore } from "./store";
import { t } from "../i18n";
import { shell } from "../platform";

/** "1.2.3" (optionally "v1.2.3", "1.2", "1.2.3-beta.1+build") → [1, 2, 3]; null when it is not a version. */
export function parseVersion(v: unknown): [number, number, number] | null {
  if (typeof v !== "string") return null;
  const m = /^v?(\d{1,9})(?:\.(\d{1,9}))?(?:\.(\d{1,9}))?(?:[-+][0-9A-Za-z.+-]*)?$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
}

/** Numeric compare of major.minor.patch: <0 when a is older than b, 0 when equal (or either is not a version), >0 when newer. */
export function compareVersions(a: unknown, b: unknown): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! < pb[i]! ? -1 : 1;
  return 0;
}

export function isNewerVersion(latest: unknown, current: unknown): boolean {
  return compareVersions(latest, current) > 0;
}

const DISMISSED_KEY = "af.update.dismissed";

function dismissedVersion(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

function rememberDismissed(version: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, version);
  } catch {
    /* private mode */
  }
}

let checked = false;

/**
 * Windows shell only (the stats endpoint publishes no Android version; Play updates that app).
 * Shows one sticky toast "AutoFlow X is available" with a Download action. Closing the toast
 * with ✕ remembers that version so it is not offered again.
 */
export async function checkDesktopUpdate(): Promise<void> {
  if (checked || shell !== "tauri") return;
  checked = true;
  // The installed shell's version; the web bundle's own __APP_VERSION__ is not the installer's version.
  const info = await tryInvoke("device_info", {});
  const current = info.ok ? info.value?.appVersion : undefined;
  if (!parseVersion(current)) return;
  let latest: unknown;
  try {
    const base = useStore.getState().settings.apiUrl.replace(/\/+$/, "");
    const r = await fetch(`${base}/v1/stats`);
    if (!r.ok) return;
    latest = ((await r.json()) as { windowsVersion?: unknown }).windowsVersion;
  } catch {
    return; // offline: ask again next session
  }
  if (typeof latest !== "string" || !isNewerVersion(latest, current) || dismissedVersion() === latest) return;
  const version = latest;
  let downloading = false;
  useStore.getState().toast(
    "info",
    t("app.updateAvailable", { version }),
    { label: t("app.download"), run: () => { downloading = true; openExternal(`${SITE_URL}/download/`); } },
    // Dismissed with ✕: not offered again for this version. After "Download" it may come back next session until the update is installed.
    () => { if (!downloading) rememberDismissed(version); },
  );
}
