/**
 * Editor page session behaviour (real store, dialogs and IndexedDB via fake-indexeddb; the app
 * shell is reduced to its slots): one editor instance per flow, undoable version restore, version
 * snapshots, and the "Not saved" state when leaving.
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createFlow, type Flow, type Step } from "@autoflow/core";

vi.mock("../../i18n", async (orig) => {
  const mod = await orig<typeof import("../../i18n")>();
  const t = (key: string, params?: Record<string, string | number>) => (params ? `${key} ${JSON.stringify(params)}` : key);
  return { ...mod, t, useT: () => t };
});
vi.mock("../../components/Shell", async (orig) => {
  const mod = await orig<typeof import("../../components/Shell")>();
  return { ...mod, Shell: ({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) => <div><header>{title}{actions}</header>{children}</div> };
});

const { db } = await import("../../lib/db");
const { DEFAULT_SETTINGS, useStore } = await import("../../lib/store");
const { useDialogs } = await import("../../lib/dialog");
const { popModal, pushModal } = await import("../../lib/modalStack");
const { DialogHost } = await import("../../components/Shell");
const { EditorPage } = await import("./Editor");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const realSave = useStore.getState().saveFlow;
const click = (id: string): Step => ({ id, type: "click", target: { kind: "current" }, button: "left", clicks: 1, holdMs: 0, modifiers: [] }) as Step;
const flow = (id: string, name: string, steps: Step[]): Flow => ({ ...createFlow({ name, id }), mode: "pro", steps });

let host: HTMLDivElement;
let root: Root;
let navigate: NavigateFunction;
function Nav() {
  navigate = useNavigate();
  return null;
}

const settle = (ms = 40) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) => act(() => void target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })));
const nameInput = () => host.querySelector<HTMLInputElement>("input.name")!;
const typeName = (value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(nameInput(), value);
  nameInput().dispatchEvent(new Event("input", { bubbles: true }));
});
const btn = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.getAttribute("aria-label") === label || b.title.startsWith(label) || b.textContent?.includes(label))!;
const stepIds = () => [...host.querySelectorAll<HTMLElement>("[data-step-id]")].map((n) => n.dataset.stepId).filter((x) => x !== "__flow");
const stored = (id: string) => useStore.getState().flows.find((f) => f.id === id)!;

async function open(path: string) {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/home", path]} initialIndex={1}>
        <Nav />
        <Routes>
          <Route path="/flows/:id" element={<EditorPage />} />
          <Route path="*" element={<div id="elsewhere" />} />
        </Routes>
        <DialogHost />
      </MemoryRouter>,
    );
  });
}

beforeEach(async () => {
  await db.clearAll();
  useDialogs.setState({ stack: [] });
  useStore.setState({ flows: [], unreadable: [], profiles: [], runs: [], settings: DEFAULT_SETTINGS, toasts: [], active: null, ready: true, saveFlow: realSave });
  await realSave(flow("f_a", "Alpha", [click("a1"), click("a2")]), { snapshot: false });
  await realSave(flow("f_b", "Beta", [click("b1")]), { snapshot: false });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  await settle();
  vi.restoreAllMocks();
});

describe("editor page", () => {
  test("/flows/A → /flows/B remounts: A's pending save is flushed and nothing of A's session reaches B", async () => {
    await open("/flows/f_a");
    typeName("Alpha 2");
    act(() => host.querySelector<HTMLElement>('[data-step-id="a1"]')!.click());
    expect(btn("common.undo").disabled).toBe(false);
    // Inside the 700 ms debounce window: nothing saved yet.
    expect(stored("f_a").name).toBe("Alpha");
    await act(async () => void navigate("/flows/f_b"));
    await settle();
    expect(stored("f_a").name).toBe("Alpha 2");
    expect(stored("f_b").name).toBe("Beta");
    expect(nameInput().value).toBe("Beta");
    expect(stepIds()).toEqual(["b1"]);
    expect(btn("common.undo").disabled).toBe(true);
    expect(host.querySelector('.node[aria-selected="true"]')).toBeNull();
  });

  test("restoring a version is one undoable edit", async () => {
    // A stored version with one step; the current flow has two.
    await realSave({ ...stored("f_a"), steps: [click("a1"), click("a2"), click("a3")] });
    await open("/flows/f_a");
    expect(stepIds()).toEqual(["a1", "a2", "a3"]);
    act(() => btn("editor.versions").click());
    await settle();
    act(() => btn("editor.restore").click());
    expect(stepIds()).toEqual(["a1", "a2"]);
    expect(btn("common.undo").disabled).toBe(false);
    press("z", { ctrlKey: true });
    expect(stepIds()).toEqual(["a1", "a2", "a3"]);
    press("y", { ctrlKey: true });
    expect(stepIds()).toEqual(["a1", "a2"]);
  });

  test("a save that changes no steps (rename) does not use up the session's version snapshot", async () => {
    await open("/flows/f_a");
    typeName("Renamed");
    press("s", { ctrlKey: true });
    await settle();
    expect(stored("f_a").name).toBe("Renamed");
    expect(await useStore.getState().versions("f_a")).toHaveLength(0);
    // The first step edit of the session still gets its snapshot of the state before it…
    act(() => host.querySelector<HTMLElement>('[data-step-id="a2"]')!.click());
    press("Delete");
    press("s", { ctrlKey: true });
    await settle();
    const versions = await useStore.getState().versions("f_a");
    expect(versions).toHaveLength(1);
    expect(versions[0]!.flow.steps.map((s) => s.id)).toEqual(["a1", "a2"]);
    // …and later edits of the same session do not add more.
    act(() => host.querySelector<HTMLElement>('[data-step-id="a1"]')!.click());
    press("Delete");
    press("s", { ctrlKey: true });
    await settle();
    expect(await useStore.getState().versions("f_a")).toHaveLength(1);
  });

  test('"?" and Ctrl+Z do nothing while a dialog is open', async () => {
    await open("/flows/f_a");
    act(() => host.querySelector<HTMLElement>('[data-step-id="a2"]')!.click());
    press("Delete");
    expect(stepIds()).toEqual(["a1"]);
    const modal = pushModal();
    press("z", { ctrlKey: true });
    press("?");
    expect(stepIds()).toEqual(["a1"]);
    expect(host.querySelector(".modal")).toBeNull();
    popModal(modal);
    press("z", { ctrlKey: true });
    expect(stepIds()).toEqual(["a1", "a2"]);
  });

  test("Not saved: Back asks first; leaving anyway warns with the flow's name", async () => {
    useStore.setState({ saveFlow: async () => { throw new Error('steps: duplicate step id "x"'); } });
    await open("/flows/f_a");
    typeName("Alpha edited");
    press("s", { ctrlKey: true });
    await settle();
    expect(host.querySelector(".save-error")!.textContent).toContain("editor.notSaved");
    useStore.setState({ toasts: [] });

    act(() => btn("common.back").click());
    await settle();
    const dialog = useDialogs.getState().stack.at(-1)!;
    expect(dialog.title).toBe("editor.leaveUnsaved.title");
    await act(async () => useDialogs.getState().close(dialog.id, { ok: false })); // stay
    await settle();
    expect(nameInput().value).toBe("Alpha edited");

    // Leaving some other way (command palette, nav link): the unmount retries and says what was lost.
    useStore.setState({ toasts: [] });
    await act(async () => void navigate("/home"));
    await settle();
    expect(host.querySelector("#elsewhere")).not.toBeNull();
    const toast = useStore.getState().toasts.find((x) => x.text.startsWith("editor.leftUnsaved"))!;
    expect(toast.kind).toBe("warning");
    expect(toast.text).toContain("Alpha edited");
    expect(toast.action).toBeDefined(); // sticky
  });

  test("Not saved: confirming Back leaves without a second warning; a clean editor leaves at once", async () => {
    useStore.setState({ saveFlow: async () => { throw new Error("nope"); } });
    await open("/flows/f_a");
    typeName("Alpha edited");
    press("s", { ctrlKey: true });
    await settle();
    useStore.setState({ toasts: [] });
    act(() => btn("common.back").click());
    await settle();
    const dialog = useDialogs.getState().stack.at(-1)!;
    await act(async () => useDialogs.getState().close(dialog.id, { ok: true }));
    await settle();
    expect(host.querySelector("#elsewhere")).not.toBeNull();
    expect(useStore.getState().toasts.filter((x) => x.text.startsWith("editor.leftUnsaved"))).toHaveLength(0);

    useStore.setState({ saveFlow: realSave });
    await act(async () => void navigate("/flows/f_b"));
    await settle();
    act(() => btn("common.back").click());
    await settle();
    expect(useDialogs.getState().stack).toHaveLength(0);
    expect(host.querySelector("#elsewhere")).not.toBeNull();
  });
});
