/**
 * Regressions from the 2026-11-27 audit that are not about sync: hotkey capture, wrapping a jump
 * target, and editor fields that used to eat keystrokes.
 */
import { afterEach, describe, expect, test } from "vitest";
import { act, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Step } from "@autoflow/core";
import { keyFromEvent } from "../components/ui";
import { DraftInput, DraftTextarea, parseHeaderLines, parseNumberDraft } from "../components/DraftInput";
import { retargetGoto, wrapStep } from "./steps";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
});
/** Renders into the document and returns a lookup by aria-label. */
function render(ui: ReactElement): { getByLabelText: (label: string) => HTMLElement } {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(ui));
  return { getByLabelText: (label) => host!.querySelector(`[aria-label="${label}"]`) as HTMLElement };
}
const fireEvent = {
  change(el: HTMLInputElement | HTMLTextAreaElement, init: { target: { value: string } }): void {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, init.target.value);
    act(() => void el.dispatchEvent(new Event("input", { bubbles: true })));
  },
  blur(el: HTMLElement): void {
    act(() => void el.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  },
};

const press = (init: KeyboardEventInit) => keyFromEvent(new KeyboardEvent("keydown", init));

describe("hotkey capture", () => {
  test("Shift is kept for letters and digits", () => {
    expect(press({ key: "K", code: "KeyK", ctrlKey: true, shiftKey: true })).toEqual({ key: "K", modifiers: ["ctrl", "shift"] });
    expect(press({ key: "!", code: "Digit1", ctrlKey: true, shiftKey: true })).toEqual({ key: "1", modifiers: ["ctrl", "shift"] });
    expect(press({ key: "k", code: "KeyK", ctrlKey: true })).toEqual({ key: "K", modifiers: ["ctrl"] });
  });
  test("a bare shifted symbol stays the symbol; named keys keep Shift", () => {
    expect(press({ key: "?", code: "Slash", shiftKey: true })).toEqual({ key: "?", modifiers: [] });
    expect(press({ key: "F5", code: "F5", shiftKey: true })).toEqual({ key: "F5", modifiers: ["shift"] });
  });
});

describe("wrap in group", () => {
  const wait = (id: string, extra: Record<string, unknown> = {}): Step => ({ id, type: "wait", ms: 10, jitterMs: 0, ...extra }) as Step;
  test("a jump that pointed at the wrapped top-level step points at the wrapper", () => {
    const steps = [wait("a", { onError: { strategy: "goto", retries: 0, backoffMs: 0, gotoStepId: "b" } }), wait("b")];
    const { steps: next, wrapperId } = wrapStep(steps, "b", "group");
    expect(next[1]!.id).toBe(wrapperId);
    expect(next[0]!.onError?.gotoStepId).toBe(wrapperId);
    expect(steps[0]!.onError?.gotoStepId).toBe("b"); // the input is not modified
  });
  test("nothing is copied when no jump points there", () => {
    const steps = [wait("a"), wait("b")];
    expect(retargetGoto(steps, "b", "x")).toBe(steps);
  });
});

describe("fields keep what is typed", () => {
  test("numbers in the middle of being typed are not values yet", () => {
    expect(parseNumberDraft("-", -10, 10, true)).toBeUndefined();
    expect(parseNumberDraft("", 0, 10, true)).toBeUndefined();
    expect(parseNumberDraft("-5", -10, 10, true)).toBe(-5);
    expect(parseNumberDraft("0.5", 0, 10, true)).toBe(1);
    expect(parseNumberDraft("1.5", -10, 10, false)).toBe(1.5);
    expect(parseNumberDraft("99", 0, 10, true)).toBe(10);
  });
  test("header lines without a colon are skipped, values may contain colons", () => {
    expect(parseHeaderLines("Accept")).toEqual({});
    expect(parseHeaderLines("Accept: text/plain\nX-Url: http://a:1\nX-")).toEqual({ Accept: "text/plain", "X-Url": "http://a:1" });
  });

  const type = (el: HTMLInputElement | HTMLTextAreaElement, text: string): void => {
    let cur = "";
    for (const ch of text) {
      cur += ch;
      fireEvent.change(el, { target: { value: cur } });
    }
  };

  test("tags: a comma can be typed", () => {
    let stored: string[] = [];
    function Host() {
      const [tags, setTags] = useState<string[]>([]);
      stored = tags;
      return <DraftInput aria-label="tags" value={tags} show={(v) => v.join(", ")} parse={(s) => s.split(",").map((x) => x.trim()).filter(Boolean)} onChange={setTags} />;
    }
    const { getByLabelText } = render(<Host />);
    const el = getByLabelText("tags") as HTMLInputElement;
    type(el, "work, home");
    expect(stored).toEqual(["work", "home"]);
    expect(el.value).toBe("work, home");
    fireEvent.blur(el);
    expect(el.value).toBe("work, home");
  });

  test("headers: typed line by line", () => {
    let stored: Record<string, string> = {};
    function Host() {
      const [h, setH] = useState<Record<string, string>>({});
      stored = h;
      return <DraftTextarea aria-label="headers" value={h} show={(v) => Object.entries(v).map(([k, x]) => `${k}: ${x}`).join("\n")} parse={parseHeaderLines} onChange={setH} />;
    }
    const { getByLabelText } = render(<Host />);
    const el = getByLabelText("headers") as HTMLTextAreaElement;
    type(el, "Accept: text/plain\nX-A: 1");
    expect(stored).toEqual({ Accept: "text/plain", "X-A": "1" });
  });

  test("a value changed from outside replaces the draft", () => {
    let set: (n: number) => void = () => undefined;
    function Host() {
      const [n, setN] = useState(3);
      set = setN;
      return <DraftInput aria-label="n" value={n} show={String} parse={(s) => parseNumberDraft(s, -100, 100, true)} onChange={setN} />;
    }
    const { getByLabelText } = render(<Host />);
    const el = getByLabelText("n") as HTMLInputElement;
    type(el, "-");
    expect(el.value).toBe("-");
    fireEvent.change(el, { target: { value: "-7" } });
    expect(el.value).toBe("-7");
    fireEvent.blur(el);
    expect(el.value).toBe("-7");
    fireEvent.change(el, { target: { value: "" } });
    fireEvent.blur(el);
    expect(el.value).toBe("-7"); // an emptied field goes back to the stored value
    void set;
  });
});
