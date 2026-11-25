import { describe, expect, test, vi } from "vitest";
import { loadPageChunk, type LazyPageEnv } from "./lazyPage";

function env(): LazyPageEnv & { data: Map<string, string>; reload: ReturnType<typeof vi.fn> } {
  const data = new Map<string, string>();
  return {
    data,
    reload: vi.fn(),
    storage: { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) },
  };
}
const settled = async (p: Promise<unknown>) => Promise.race([p.then(() => "resolved", () => "rejected"), new Promise((r) => setTimeout(() => r("pending"), 20))]);

describe("lazy page loader", () => {
  test("the first failure reloads once and stays pending; the second one is rethrown", async () => {
    const e = env();
    const fail = () => Promise.reject(new Error("Failed to fetch dynamically imported module"));
    expect(await settled(loadPageChunk("EditorPage", fail, e))).toBe("pending");
    expect(e.reload).toHaveBeenCalledTimes(1);
    // …after the reload the same screen fails again: no loop, the error boundary gets the error.
    await expect(loadPageChunk("EditorPage", fail, e)).rejects.toThrow(/dynamically imported/);
    expect(e.reload).toHaveBeenCalledTimes(1);
  });

  test("a successful load clears the flag, so a later failure may reload again", async () => {
    const e = env();
    e.data.set("af.chunkReload", "LedgerPage");
    await expect(loadPageChunk("LedgerPage", () => Promise.resolve({ ok: 1 }), e)).resolves.toEqual({ ok: 1 });
    expect(e.data.size).toBe(0);
    expect(await settled(loadPageChunk("LedgerPage", () => Promise.reject(new Error("404")), e))).toBe("pending");
    expect(e.reload).toHaveBeenCalledTimes(1);
  });

  test("without working sessionStorage there is no automatic reload", async () => {
    const reload = vi.fn();
    const broken: LazyPageEnv = { reload, storage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } } };
    await expect(loadPageChunk("X", () => Promise.reject(new Error("404")), broken)).rejects.toThrow("404");
    await expect(loadPageChunk("X", () => Promise.reject(new Error("404")), { reload, storage: undefined })).rejects.toThrow("404");
    expect(reload).not.toHaveBeenCalled();
    await expect(loadPageChunk("X", () => Promise.resolve(1), broken)).resolves.toBe(1);
  });
});
