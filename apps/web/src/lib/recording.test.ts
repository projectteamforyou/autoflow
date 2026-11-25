import { describe, expect, it } from "vitest";
import type { Hotkey, RecordedEvent } from "@autoflow/core";
import { trimStopHotkey } from "./recording";

const halt: Hotkey = { key: "Escape", modifiers: ["ctrl", "alt"] };
const key = (kind: "keyDown" | "keyUp", k: string, modifiers: Hotkey["modifiers"] = [], t = 0): RecordedEvent => ({ t, kind, key: k, modifiers });
const click: RecordedEvent = { t: 1, kind: "mouseDown", x: 1, y: 2, button: "left" };

describe("trimStopHotkey", () => {
  it("drops the trailing stop-hotkey press", () => {
    const body = [click, key("keyDown", "a"), key("keyUp", "a")];
    expect(trimStopHotkey([...body, key("keyDown", "Control", ["ctrl"]), key("keyDown", "Alt", ["ctrl", "alt"]), key("keyDown", "Escape", ["ctrl", "alt"])], halt)).toEqual(body);
    expect(trimStopHotkey([...body, key("keyDown", "Control", ["ctrl"]), key("keyDown", "Alt", ["ctrl", "alt"])], halt)).toEqual(body);
  });

  it("keeps everything else, including a plain press of the same key", () => {
    const events = [click, key("keyDown", "Escape"), key("keyUp", "Escape")];
    expect(trimStopHotkey(events, halt)).toBe(events);
    const typed = [key("keyDown", "Control", ["ctrl"]), key("keyDown", "c", ["ctrl"]), key("keyUp", "c", ["ctrl"]), click];
    expect(trimStopHotkey(typed, halt)).toBe(typed);
    expect(trimStopHotkey([], halt)).toEqual([]);
  });
});
