import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { initialLocale, setLocale } from "./i18n";
import { useStore } from "./lib/store";
import { shell } from "./platform";
import { installExternalLinks } from "./lib/site";
import { IdentifyOverlay, identifyParams } from "./pages/IdentifyOverlay";
import "./styles/app.css";

/**
 * Payment providers return to /billing/return?… (PortOne mobile redirect: paymentId, code, message;
 * PayPal: provider, token, PayerID, cancelled). Move the query onto the hash route before the
 * router mounts; that page asks the server to verify — nothing here is trusted.
 */
function routeBillingReturn() {
  if (!/\/billing\/return\/?$/.test(location.pathname)) return;
  const from = new URLSearchParams(location.search);
  const q = new URLSearchParams();
  for (const k of ["provider", "paymentId", "code", "message", "token", "cancelled"]) {
    const v = from.get(k);
    if (v) q.set(k, v.slice(0, 300));
  }
  history.replaceState(null, "", `${location.pathname.replace(/billing\/return\/?$/, "")}#/billing/return?${q.toString()}`);
}

async function boot() {
  // Monitor-number overlay windows (desktop Stage panel): render only the number, nothing else.
  const identify = identifyParams(location.hash);
  if (identify) {
    document.documentElement.classList.add("identify");
    createRoot(document.getElementById("root")!).render(<IdentifyOverlay {...identify} />);
    return;
  }
  routeBillingReturn();
  await Promise.all([setLocale(initialLocale()), useStore.getState().init()]);
  // Email links (verify / reset) and server share links arrive on real paths.
  if (!/\/(index\.html)?$/.test(location.pathname)) void import("./lib/links").then((m) => m.handleIncomingLink());
  void import("./lib/stats").then((m) => m.startPresence());
  installExternalLinks();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  // Offline support for the browser build only (the native shells load from disk).
  if (shell === "browser" && "serviceWorker" in navigator && import.meta.env.PROD) {
    const { registerSW } = await import("virtual:pwa-register");
    const update = registerSW({
      onNeedRefresh() {
        useStore.getState().toast("info", "AutoFlow update ready", { label: "Reload", run: () => void update(true) });
      },
    });
  }
}

void boot().catch((e) => {
  console.error(e);
  document.getElementById("root")!.innerHTML = `<div style="padding:24px;font-family:system-ui;color:#fff">AutoFlow could not start: ${String((e as Error).message).replace(/</g, "&lt;")}</div>`;
});
