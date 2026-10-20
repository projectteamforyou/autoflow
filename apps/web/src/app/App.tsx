import { useEffect } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { hotkeyToString } from "@autoflow/core";
import { useStore } from "../lib/store";
import { applyTheme, DialogHost, PulseBar, Toasts } from "../components/Shell";
import { keyFromEvent } from "../components/ui";
import { haltAll } from "../lib/runner";
import { invoke, hasNativeBridge } from "../platform";
import { Home } from "../pages/Home";
import { Library } from "../pages/Library";
import { EditorPage } from "../pages/editor/Editor";
import { CanvasPage } from "../pages/Canvas";
import { LedgerPage } from "../pages/Ledger";
import { AtlasPage } from "../pages/Atlas";
import { KeyforgePage } from "../pages/Keyforge";
import { CopilotPage } from "../pages/Copilot";
import { StudioPage } from "../pages/Studio";
import { FleetPage } from "../pages/Fleet";
import { SettingsPage } from "../pages/Settings";
import { Onboarding } from "../pages/Onboarding";
import { NewFlowPage } from "../pages/NewFlow";
import { ImportFlowPage } from "../pages/ImportFlow";
import { BillingReturnPage } from "../pages/Billing";
import { AdminPage } from "../pages/Admin";
import { StagePage } from "../pages/Stage";

function Guard({ children }: { children: JSX.Element }) {
  const onboarded = useStore((s) => s.settings.onboarded);
  const loc = useLocation();
  // Deep links that must work on a first visit (shared flows, payment return, operator page) skip onboarding.
  if (!onboarded && !/^\/(import|admin|billing)/.test(loc.pathname)) return <Navigate to="/welcome" replace />;
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
  useEffect(() => {
    if (!hasNativeBridge) return;
    const id = setTimeout(() => {
      const triggered = flows.filter((f) => f.trigger.type !== "manual" || f.hotkeys.start);
      void invoke("triggers_sync", { flows: triggered, emergencyStop: settings.haltHotkey })
        .then((r) => r.failed.forEach((f) => useStore.getState().toast("warning", `${flows.find((x) => x.id === f.flowId)?.name ?? f.flowId}: ${f.reason}`)))
        .catch(() => undefined);
    }, 800);
    return () => clearTimeout(id);
  }, [flows, settings.haltHotkey]);
  return null;
}

export function App() {
  return (
    <HashRouter>
      <Effects />
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
        <Route path="/admin" element={<Guard><AdminPage /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <PulseBar />
      <Toasts />
      <DialogHost />
    </HashRouter>
  );
}
