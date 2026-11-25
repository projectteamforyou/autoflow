/** Modal stacking: only the top-most open modal reacts to Esc (lib/modalStack.ts). */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Modal } from "./ui";
import { isTopModal, openModalCount, popModal, pushModal } from "../lib/modalStack";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const esc = () => act(() => void document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("modal stack", () => {
  test("push / pop keep the last opened modal on top, in any closing order", () => {
    const a = pushModal();
    const b = pushModal();
    const c = pushModal();
    expect([isTopModal(a), isTopModal(b), isTopModal(c)]).toEqual([false, false, true]);
    popModal(b); // a modal in the middle closes first
    expect(isTopModal(c)).toBe(true);
    popModal(c);
    expect(isTopModal(a)).toBe(true);
    popModal(a);
    popModal(a); // closing twice is harmless
    expect(openModalCount()).toBe(0);
    expect(isTopModal(a)).toBe(false);
  });

  test("Esc closes one stacked modal at a time, top first", () => {
    const closed: string[] = [];
    const open = { lower: true, upper: true };
    const render = () =>
      act(() =>
        root.render(
          <>
            {open.lower && <Modal title="lower" onClose={() => { closed.push("lower"); open.lower = false; render(); }}>a</Modal>}
            {open.upper && <Modal title="upper" onClose={() => { closed.push("upper"); open.upper = false; render(); }}>b</Modal>}
          </>,
        ),
      );
    render();
    expect(openModalCount()).toBe(2);
    esc();
    expect(closed).toEqual(["upper"]);
    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    esc();
    expect(closed).toEqual(["upper", "lower"]);
    expect(openModalCount()).toBe(0);
    esc();
    expect(closed).toHaveLength(2);
  });

  test("a modal opened later is on top even when it is rendered first in the tree", () => {
    const closed: string[] = [];
    const show = (first: boolean) =>
      act(() =>
        root.render(
          <>
            {first && <Modal key="late" title="late" onClose={() => closed.push("late")}>b</Modal>}
            <Modal key="early" title="early" onClose={() => closed.push("early")}>a</Modal>
          </>,
        ),
      );
    show(false);
    show(true);
    esc();
    expect(closed).toEqual(["late"]);
  });
});
