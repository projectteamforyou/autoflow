import { Suspense, lazy, useEffect, type ComponentType } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { calledFlows, hotkeyToString } from "@autoflow/core";
import { useStore } from "../lib/store";
import { applyTheme, DialogHost, PulseBar, Toasts } from "../components/Shell";
import { keyFromEvent } from "../components/ui";
import { haltAll } from "../lib/runner";
import { invoke, hasNativeBridge } from "../platform";
import { armedFlows } from "../lib/triggers";
import { Home } from "../pages/Home";
import { Library } from "../pages/Library";
import { Onboarding } from "../pages/Onboarding";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { loadPageChunk } from "../lib/lazyPage";

// Home and the library open instantly; every other screen is its own chunk, fetched the first time it is
// opened (from disk in the desktop / Android shells, from the precache in the PWA). The start-up bundle was
// one 755 kB file that also carried the operator page, billing and the editors.
// A chunk that fails to load (old hashed file after an update, offline) reloads the page once; if it
// fails again the error reaches <ErrorBoundary> below (lib/lazyPage.ts).
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) => lazy(() => loadPageChunk(name, load).then((m) => ({ default: m[name] })));
const EditorPage = page(() => import("../pages/editor/Editor"), "EditorPage");
const CanvasPage = page(() => import("../pages/Canvas"), "CanvasPage");
const LedgerPage = page(() => import("../pages/Ledger"), "LedgerPage");
const AtlasPage = page(() => import("../pages/Atlas"), "AtlasPage");
const KeyforgePage = page(() => import("../pages/Keyforge"), "KeyforgePage");
const CopilotPage = page(() => import("../pages/Copilot"), "CopilotPage");
const StudioPage = page(() => import("../pages/Studio"), "StudioPage");
const FleetPage = page(() => import("../pages/Fleet"), "FleetPage");
const SettingsPage = page(() => import("../pages/Settings"), "SettingsPage");
const NewFlowPage = page(() => import("../pages/NewFlow"), "NewFlowPage");
const ImportFlowPage = page(() => import("../pages/ImportFlow"), "ImportFlowPage");
const BillingReturnPage = page(() => import("../pages/Billing"), "BillingReturnPage");
const BusinessPage = page(() => import("../pages/Business"), "BusinessPage");
const AdminPage = page(() => import("../pages/Admin"), "AdminPage");
const StagePage = page(() => import("../pages/Stage"), "StagePage");

function Guard({ children }: { children: JSX.Element }) {
  const onboarded = useStore((s) => s.settings.onboarded);
  const loc = useLocation();
  // Deep links that must work on a first visit (shared flows, payment return, operator page) skip onboarding.
  if (!onboarded && !/^\/(import|admin|billing|business)/.test(loc.pathname)) return <Navigate to="/welcome" replace />;
  return children;
}

function Effects() {
  const settings = useStore((s) => s.settings);
  const flows = useStore((s) => s.flows);
  useEffect(() => applyTheme(settings.theme), [settings.theme]);
  useEffect(() => {
    if (settings.reduceMotion) document.documentElement.setAttribute("data-motion", "reduce");
    else document.documentElement.removeAttribute("data-motion");
  }, [settings.reduceMotion]);
  // In-app Halt hotkey (the native shells also register it globally).
  useEffect(() => {
    const combo = hotkeyToString(settings.haltHotkey);
    const onKey = (e: KeyboardEvent) => {
      const h = keyFromEvent(e);
      if (h && hotkeyToString(h) === combo && useStore.getState().active) {
        e.preventDefault();
        haltAll();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [settings.haltHotkey]);
  // Keep native trigger registrations (hotkeys, schedules, device events) in sync with the library.
  // Paused triggers are simply left out, so the native side unregisters them; the flows stay unchanged.
  const paused = settings.pausedTriggers;
  // A file dropped outside a drop zone (Library, editor) must not make the window open it: in the
  // desktop app that replaces the whole UI with the file and there is no way back.
  useEffect(() => {
    const guard = (e: DragEvent) => {
      if (e.defaultPrevented || !e.dataTransfer || !Array.from(e.dataTransfer.types).includes("Files")) return;
      e.preventDefault();
      if (e.type === "dragover") e.dataTransfer.dropEffect = "none";
    };
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    return () => {
      window.removeEventListener("dragover", guard);
      window.removeEventListener("drop", guard);
    };
  }, []);
  const ready = useStore((s) => s.ready);
  useEffect(() => {
    // Not before the library has loaded: an empty list would unregister every trigger for a moment.
    if (!hasNativeBridge || !ready) return;
    const id = setTimeout(() => {
      // Flows the armed ones call ("run flow") go along: a schedule that fires must be able to resolve them.
      const armed = armedFlows(flows, paused);
      const called = calledFlows(armed, (id) => flows.find((f) => f.id === id));
      void invoke("triggers_sync", { flows: armed, emergencyStop: settings.haltHotkey, ...(called.length ? { library: called } : {}) })
        .then((r) => {
          const st = useStore.getState();
          // Toast only what is newly failing (this runs after every library edit); the Library badge shows the reason for as long as it lasts.
          const before = st.triggerFailures;
          for (const f of r.failed) if (before[f.flowId] !== f.reason) st.toast("warning", `${flows.find((x) => x.id === f.flowId)?.name ?? f.flowId}: ${f.reason}`);
          st.setTriggerFailures(r.failed);
        })
        .catch(() => undefined);
    }, 800);
    return () => clearTimeout(id);
  }, [flows, paused, settings.haltHotkey, ready]);
  return null;
}

/** The routes inside the error boundary; the boundary resets when the path changes. */
function Screens() {
  const loc = useLocation();
  return (
    <ErrorBoundary resetKey={loc.pathname}>
      <Suspense fallback={<div className="page-loading" role="status" aria-busy="true" />}>
      <Routes>
        <Route path="/welcome" element={<Onboarding />} />
        <Route path="/import" element={<ImportFlowPage />} />
        <Route path="/" element={<Guard><Home /></Guard>} />
        <Route path="/flows" element={<Guard><Library /></Guard>} />
        <Route path="/flows/:id" element={<Guard><EditorPage /></Guard>} />
        <Route path="/new/:kind" element={<Guard><NewFlowPage /></Guard>} />
        <Route path="/canvas" element={<Guard><CanvasPage /></Guard>} />
        <Route path="/stage" element={<Guard><StagePage /></Guard>} />
        <Route path="/ledger" element={<Guard><LedgerPage /></Guard>} />
        <Route path="/ledger/:id" element={<Guard><LedgerPage /></Guard>} />
        <Route path="/atlas" element={<Guard><AtlasPage /></Guard>} />
        <Route path="/atlas/:id" element={<Guard><AtlasPage /></Guard>} />
        <Route path="/keyforge" element={<Guard><KeyforgePage /></Guard>} />
        <Route path="/keyforge/:id" element={<Guard><KeyforgePage /></Guard>} />
        <Route path="/copilot" element={<Guard><CopilotPage /></Guard>} />
        <Route path="/studio" element={<Guard><StudioPage /></Guard>} />
        <Route path="/fleet" element={<Guard><FleetPage /></Guard>} />
        <Route path="/settings" element={<Guard><SettingsPage /></Guard>} />
        <Route path="/billing/return" element={<BillingReturnPage />} />
        <Route path="/business" element={<Guard><BusinessPage /></Guard>} />
        <Route path="/admin" element={<Guard><AdminPage /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

export function App() {
  return (
    <HashRouter>
      <Effects />
      <Screens />
      <PulseBar />
      <Toasts />
      <DialogHost />
    </HashRouter>
  );
}
