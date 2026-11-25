import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.restoreAllMocks());

function Boom({ fail }: { fail: boolean }) {
  if (fail) throw new Error("render exploded");
  return <p>fine</p>;
}

test("a screen that throws shows the reload card, logs the error and recovers on another route", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<ErrorBoundary resetKey="/a"><Boom fail /></ErrorBoundary>));
  expect(host.querySelector('[role="alert"]')!.textContent).toContain("Couldn't load this screen");
  expect([...host.querySelectorAll("button")].some((b) => b.textContent?.includes("Reload"))).toBe(true);
  expect(log.mock.calls.some((c) => String(c[0]).includes("AutoFlow: a screen failed"))).toBe(true);
  // Navigating elsewhere clears the error.
  act(() => root.render(<ErrorBoundary resetKey="/b"><Boom fail={false} /></ErrorBoundary>));
  expect(host.textContent).toBe("fine");
  act(() => root.unmount());
  host.remove();
});
