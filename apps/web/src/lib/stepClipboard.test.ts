import { afterEach, describe, expect, test, vi } from "vitest";
import type { Step } from "@autoflow/core";
import { clearCopiedStep, copyStep, readCopiedStep } from "./stepClipboard";

const wait = (id: string): Step => ({ id, type: "wait", ms: 100, jitterMs: 0 });

afterEach(() => {
  vi.restoreAllMocks();
  clearCopiedStep();
});

describe("step clipboard", () => {
  test("a write that fails (quota) removes the older stored step, so paste returns the new one", () => {
    copyStep(wait("old"));
    expect(readCopiedStep()!.id).toBe("old");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    copyStep(wait("new"));
    expect(localStorage.getItem("af.editor.clip")).toBeNull();
    expect(readCopiedStep()!.id).toBe("new");
  });

  test("when the stale value cannot be removed either, the in-memory copy still wins", () => {
    copyStep(wait("old"));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    copyStep(wait("new"));
    expect(readCopiedStep()!.id).toBe("new");
  });

  test("clearCopiedStep empties both places", () => {
    copyStep(wait("a"));
    clearCopiedStep();
    expect(readCopiedStep()).toBeNull();
  });
});
