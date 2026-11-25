import { describe, expect, test, vi } from "vitest";
import { blockImeSubmit, isImeKey } from "./ime";

describe("IME composition keys", () => {
  test("composition is recognised on React and DOM events, and by the Safari keyCode", () => {
    expect(isImeKey({ key: "Enter", nativeEvent: { isComposing: true } })).toBe(true);
    expect(isImeKey({ key: "Enter", isComposing: true })).toBe(true);
    expect(isImeKey({ key: "Enter", keyCode: 229, nativeEvent: { isComposing: false } })).toBe(true);
    expect(isImeKey({ key: "Enter", keyCode: 13, nativeEvent: { isComposing: false } })).toBe(false);
    expect(isImeKey(new KeyboardEvent("keydown", { key: "Enter", isComposing: true }))).toBe(true);
    expect(isImeKey(new KeyboardEvent("keydown", { key: "Enter" }))).toBe(false);
  });

  test("only the composing Enter is kept from submitting a form", () => {
    const composing = { key: "Enter", keyCode: 229, preventDefault: vi.fn() };
    blockImeSubmit(composing);
    expect(composing.preventDefault).toHaveBeenCalledOnce();
    const plain = { key: "Enter", keyCode: 13, preventDefault: vi.fn() };
    blockImeSubmit(plain);
    expect(plain.preventDefault).not.toHaveBeenCalled();
    const letter = { key: "Process", keyCode: 229, preventDefault: vi.fn() };
    blockImeSubmit(letter);
    expect(letter.preventDefault).not.toHaveBeenCalled();
  });
});
