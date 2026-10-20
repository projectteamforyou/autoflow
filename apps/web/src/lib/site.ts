import { hasNativeBridge, invoke } from "../platform";
/** Public website (marketing, legal, downloads). Absolute so links also work inside the native shells. */
export const SITE_URL = ((import.meta.env.VITE_SITE_URL as string | undefined) ?? "https://autoflowmacro.com").replace(/\/+$/, "");

/**
 * In the Windows/Android shells, links that would open a new tab are handed to the system browser
 * instead (a WebView popup would trap the user). Installed once from main.tsx.
 */
export function installExternalLinks(): void {
  if (!hasNativeBridge) return;
  document.addEventListener("click", (e) => {
    const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a || a.target !== "_blank" || !a.href.startsWith("https://")) return;
    e.preventDefault();
    invoke("open_external", { url: a.href }).catch(() => window.open(a.href, "_blank", "noopener"));
  });
}
