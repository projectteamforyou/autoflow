/**
 * Smoke test of the Pro editor wiring (real components in jsdom, no mocks): collapse, lint-click
 * reveal, keyboard shortcuts, cross-flow clipboard, wrap and the phone add-step menu.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createFlow, findStep, type Flow, type LintIssue, type Step } from "@autoflow/core";
import { ProEditor, canReinsert } from "./ProEditor";
import { clearCopiedStep, readCopiedStep } from "../../lib/stepClipboard";
import { useStore } from "../../lib/store";
import { popModal, pushModal } from "../../lib/modalStack";

// Keys instead of texts: the assertions must not depend on the wording (or on which keys are translated yet).
vi.mock("../../i18n", async (orig) => {
  const mod = await orig<typeof import("../../i18n")>();
  const t = (key: string) => key;
  return { ...mod, t, useT: () => t };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const click = (id: string, extra: Partial<Step> = {}): Step => ({ id, type: "click", target: { kind: "current" }, button: "left", clicks: 1, holdMs: 0, modifiers: [], ...extra }) as Step;
const base = (): Flow => ({
  ...createFlow({ name: "t" }),
  steps: [click("a"), { id: "G", type: "group", name: "G", collapsed: true, body: [click("b"), { id: "L", type: "loop", mode: "count", count: 2, body: [click("c")] }] }, click("z")],
});

let host: HTMLDivElement;
let root: Root;
let flow: Flow;
const runs: string[] = [];
let changes = 0;
let revealStep: string | null = null;
const lint: LintIssue[] = [{ severity: "warning", key: "lint.empty", stepId: "c" }];

function render() {
  act(() => {
    root.render(
      <MemoryRouter>
        <ProEditor flow={flow} lint={lint} revealStep={revealStep} onChange={(f) => { changes++; flow = f; render(); }} onRunPartial={(id, mode) => runs.push(`${mode}:${id}`)} onShortcuts={() => runs.push("shortcuts")} />
      </MemoryRouter>,
    );
  });
}
const node = (id: string) => host.querySelector<HTMLElement>(`[data-step-id="${id}"]`);
const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) => act(() => void target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })));
const selectedId = () => host.querySelector<HTMLElement>('.node[aria-selected="true"]')?.dataset.stepId;
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>(".inspector button")].find((b) => b.textContent?.includes(text))!;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  flow = base();
  revealStep = null;
  runs.length = 0;
  changes = 0;
  useStore.setState({ toasts: [] });
  clearCopiedStep();
  render();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("ProEditor", () => {
  test("deep link (?step=): selects the step and opens its collapsed ancestors, once", () => {
    revealStep = "nope"; // unknown ids are ignored
    render();
    expect(selectedId()).toBeUndefined();
    revealStep = "c";
    render();
    expect((flow.steps[1] as Extract<Step, { type: "group" }>).collapsed).toBeUndefined();
    expect(node("c")).not.toBeNull();
    expect(selectedId()).toBe("c");
    // Selecting something else afterwards is not undone by the link.
    act(() => node("a")!.click());
    render();
    expect(selectedId()).toBe("a");
  });

  test("collapsed group hides its children and a lint click expands the path", () => {
    expect(node("b")).toBeNull();
    expect(node("G")!.textContent).toContain("editor.nSteps");
    act(() => host.querySelector<HTMLElement>("button.lint-item")!.click());
    expect((flow.steps[1] as Extract<Step, { type: "group" }>).collapsed).toBeUndefined();
    expect(node("c")).not.toBeNull();
    expect(selectedId()).toBe("c");
    // loop: local state only — nothing is written to the flow
    const before = JSON.stringify(flow);
    act(() => node("L")!.querySelector<HTMLElement>("button.fold")!.click());
    expect(node("c")).toBeNull();
    expect(JSON.stringify(flow)).toBe(before);
  });

  test("nodes are labelled buttons; arrows walk the visible steps", () => {
    const a = node("a")!;
    expect(a.getAttribute("role")).toBe("button");
    expect(a.getAttribute("aria-label")).toMatch(/^step\.click: /);
    act(() => a.click());
    expect(selectedId()).toBe("a");
    press("ArrowDown");
    expect(selectedId()).toBe("G");
    press("ArrowDown"); // G is collapsed: its children are skipped
    expect(selectedId()).toBe("z");
    press("ArrowUp");
    press("ArrowUp");
    press("ArrowUp");
    expect(selectedId()).toBe("__flow");
  });

  test("toggle skip / breakpoint, move, duplicate, delete", () => {
    act(() => node("a")!.click());
    press("/", { ctrlKey: true });
    expect(findStep(flow.steps, "a")!.disabled).toBe(true);
    press("/", { ctrlKey: true });
    expect(findStep(flow.steps, "a")!.disabled).toBeUndefined();
    press("F9");
    expect(findStep(flow.steps, "a")!.breakpoint).toBe(true);
    press("ArrowDown", { altKey: true });
    expect(flow.steps.map((s) => s.id)).toEqual(["G", "a", "z"]);
    press("d", { ctrlKey: true });
    expect(flow.steps).toHaveLength(4);
    press("Delete");
    expect(flow.steps.map((s) => s.id)).not.toContain("a");
  });

  test("shortcuts stay out of text fields", () => {
    act(() => node("a")!.click());
    const input = host.querySelector<HTMLInputElement>(".inspector input.input")!;
    press("Delete", {}, input);
    press("x", { ctrlKey: true }, input);
    expect(flow.steps.map((s) => s.id)).toEqual(["a", "G", "z"]);
  });

  test("cut and paste go through localStorage, so they work across flows", () => {
    act(() => node("z")!.click());
    press("x", { ctrlKey: true });
    expect(flow.steps.map((s) => s.id)).toEqual(["a", "G"]);
    expect(readCopiedStep()!.id).toBe("z");
    // "another flow": a fresh editor instance with other steps and nothing selected
    act(() => root.unmount());
    root = createRoot(host);
    flow = { ...createFlow({ name: "other" }), steps: [click("q")] };
    render();
    press("v", { ctrlKey: true });
    expect(flow.steps).toHaveLength(2);
    expect(flow.steps[1]!.type).toBe("click");
    expect(flow.steps[1]!.id).not.toBe("z"); // fresh id
    localStorage.setItem("af.editor.clip", '{"type":"bogus"}');
    press("v", { ctrlKey: true });
    expect(flow.steps).toHaveLength(2);
  });

  test("inspector: move, wrap, partial run, shortcuts link", () => {
    act(() => node("a")!.click());
    expect(button("editor.moveUp").disabled).toBe(true);
    act(() => button("editor.moveDown").click());
    expect(flow.steps.map((s) => s.id)).toEqual(["G", "a", "z"]);
    act(() => button("editor.runFromHere").click());
    act(() => button("editor.runOnlyThis").click());
    act(() => button("shortcuts.title").click());
    expect(runs).toEqual(["from:a", "only:a", "shortcuts"]);
    act(() => button("step.try").click());
    const w = flow.steps[1] as Extract<Step, { type: "try" }>;
    expect(w.type).toBe("try");
    expect(w.body.map((s) => s.id)).toEqual(["a"]);
    expect(selectedId()).toBe(w.id);
  });

  test("error handling: goto preselects another top-level step; retry exposes the backoff fields", () => {
    act(() => node("a")!.click());
    const strategy = [...host.querySelectorAll<HTMLSelectElement>(".inspector select")].find((s) => [...s.options].some((o) => o.value === "goto"))!;
    const choose = (el: HTMLSelectElement, value: string) => act(() => {
      el.value = value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    choose(strategy, "goto");
    expect(findStep(flow.steps, "a")!.onError).toMatchObject({ strategy: "goto", gotoStepId: "G" });
    choose(strategy, "retry");
    const curve = [...host.querySelectorAll<HTMLSelectElement>(".inspector select")].find((s) => [...s.options].some((o) => o.value === "exponential"))!;
    choose(curve, "exponential");
    expect(findStep(flow.steps, "a")!.onError).toMatchObject({ strategy: "retry", retries: 1, backoff: "exponential" });
  });

  test("add-step menu: search over the whole catalogue", () => {
    act(() => host.querySelector<HTMLElement>(".connector .add")!.click());
    const menu = host.querySelector<HTMLElement>(".quick-add")!;
    expect(menu.querySelectorAll("button.palette-item").length).toBeGreaterThan(40); // 12 quick + all 34 types
    const search = menu.querySelector<HTMLInputElement>("input")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "matchScene");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(menu.querySelectorAll("button.palette-item")).toHaveLength(1);
    press("Enter", {}, search);
    expect(flow.steps[0]!.type).toBe("matchScene");
    expect(host.querySelector(".quick-add")).toBeNull();
  });

  const undoToast = () => useStore.getState().toasts.find((x) => x.text === "editor.stepDeleted")!;

  test("delete → Undo toast re-inserts the step at its old place", () => {
    act(() => node("a")!.click());
    press("Delete");
    expect(flow.steps.map((s) => s.id)).toEqual(["G", "z"]);
    act(() => undoToast().action!.run());
    expect(flow.steps.map((s) => s.id)).toEqual(["a", "G", "z"]);
    expect(selectedId()).toBe("a");
  });

  test("delete → Ctrl+Z → the toast's Undo does not insert the step a second time", () => {
    const before = flow;
    act(() => node("a")!.click());
    press("Delete");
    // Ctrl+Z in the editor page: the previous flow (with the step) is shown again.
    flow = before;
    render();
    changes = 0;
    act(() => undoToast().action!.run());
    expect(changes).toBe(0);
    expect(flow.steps.map((s) => s.id)).toEqual(["a", "G", "z"]);
    // Also for a container whose child is already back somewhere else.
    expect(canReinsert(flow.steps, { id: "new", type: "group", name: "N", body: [click("c")] } as Step)).toBe(false);
    expect(canReinsert(flow.steps, { id: "new", type: "group", name: "N", body: [click("new2")] } as Step)).toBe(true);
  });

  test("the Undo toast does nothing once the editor shows another flow or is closed", () => {
    act(() => node("a")!.click());
    press("Delete");
    const toast = undoToast();
    // Same component instance, other flow (defensive: the page remounts per flow).
    flow = { ...createFlow({ name: "other" }), steps: [click("q")] };
    render();
    changes = 0;
    act(() => toast.action!.run());
    expect(changes).toBe(0);
    act(() => root.unmount());
    root = createRoot(host);
    toast.action!.run();
    expect(changes).toBe(0);
    expect(flow.steps.map((s) => s.id)).toEqual(["q"]);
  });

  test("Delete with a selection that no longer exists changes nothing (no empty undo entry)", () => {
    act(() => node("a")!.click());
    flow = { ...flow, steps: flow.steps.filter((s) => s.id !== "a") };
    render();
    changes = 0;
    press("Delete");
    press("Backspace");
    expect(changes).toBe(0);
    expect(useStore.getState().toasts).toHaveLength(0);
  });

  test("Ctrl+C copies the step, but not while text is selected on the page", () => {
    act(() => node("a")!.click());
    const sel = vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "some text" } as Selection);
    press("c", { ctrlKey: true });
    expect(readCopiedStep()).toBeNull();
    expect(useStore.getState().toasts).toHaveLength(0);
    sel.mockReturnValue({ toString: () => "" } as Selection);
    press("c", { ctrlKey: true });
    expect(readCopiedStep()!.id).toBe("a");
    expect(useStore.getState().toasts.map((x) => x.text)).toEqual(["editor.stepCopied"]);
  });

  test("step shortcuts do nothing behind an open dialog", () => {
    act(() => node("a")!.click());
    const modal = pushModal();
    press("Delete");
    press("d", { ctrlKey: true });
    popModal(modal);
    expect(changes).toBe(0);
    press("Delete");
    expect(flow.steps.map((s) => s.id)).toEqual(["G", "z"]);
  });

  test("add-step menu: Enter that confirms an IME composition does not pick a step", () => {
    act(() => host.querySelector<HTMLElement>(".connector .add")!.click());
    const search = host.querySelector<HTMLInputElement>(".quick-add input")!;
    press("Enter", { isComposing: true }, search);
    press("Enter", { keyCode: 229 }, search); // Safari: the keydown after compositionend
    expect(changes).toBe(0);
    expect(host.querySelector(".quick-add")).not.toBeNull();
    press("Enter", {}, search);
    expect(changes).toBe(1);
    expect(host.querySelector(".quick-add")).toBeNull();
  });
});
