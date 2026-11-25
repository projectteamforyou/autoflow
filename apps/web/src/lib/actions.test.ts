/**
 * Restore / start-up actions with the real store, dialogs and IndexedDB (fake-indexeddb); only the
 * file download and the sandbox runner are stubbed.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createFlow, type Flow, type Step } from "@autoflow/core";

const downloads: { name: string; data: string }[] = [];
vi.mock("../components/ui", () => ({ download: (name: string, data: string) => void downloads.push({ name, data }) }));
const runInCanvas = vi.fn(async () => ({}));
vi.mock("./runner", () => ({ runInCanvas: (...a: unknown[]) => runInCanvas(...(a as [])), runNative: vi.fn() }));

const { db } = await import("./db");
const { DEFAULT_SETTINGS, useStore } = await import("./store");
const { useDialogs } = await import("./dialog");
const { buildBackup } = await import("./backup");
const { downloadBackup, importFileTooLarge, restoreBackupFile, startFlow, toastRestored, warnUnreadableFlows } = await import("./actions");

const wait = (id: string): Step => ({ id, type: "wait", ms: 100, jitterMs: 0 });
const flow = (id: string, name = id): Flow => ({ ...createFlow({ name, id }), steps: [wait(`${id}_s`)] });
/** A File-like object: jsdom's File has no reliable text()/slice().text(). */
const file = (text: string, size = text.length) => ({ size, text: async () => text, slice: (a: number, b: number) => ({ text: async () => text.slice(a, b) }) }) as unknown as File;
const tick = () => new Promise((r) => setTimeout(r, 0));
async function waitForDialog() {
  for (let i = 0; i < 50 && !useDialogs.getState().stack.length; i++) await tick();
  const top = useDialogs.getState().stack.at(-1);
  if (!top) throw new Error("no dialog opened");
  return top;
}

beforeEach(async () => {
  await db.clearAll();
  downloads.length = 0;
  runInCanvas.mockClear();
  useDialogs.setState({ stack: [] });
  useStore.setState({ flows: [], unreadable: [], profiles: [], runs: [], settings: DEFAULT_SETTINGS, toasts: [], active: null, ready: true });
});

describe("restore: paused triggers", () => {
  test("are applied right after the flows are imported — before (and without) the settings confirm", async () => {
    const backup = buildBackup({ flows: [flow("f_a"), flow("f_b")], settings: { ...DEFAULT_SETTINGS, theme: "light", pausedTriggers: ["f_a", "f_zzz"] } });
    const done = restoreBackupFile(file(JSON.stringify(backup)));
    const dialog = await waitForDialog();
    // The "apply settings?" dialog is open: the flow is in the library and already paused.
    expect(useStore.getState().flows.map((f) => f.id).sort()).toEqual(["f_a", "f_b"]);
    expect(useStore.getState().settings.pausedTriggers).toEqual(["f_a"]);
    useDialogs.getState().close(dialog.id, { ok: false }); // skip settings
    const r = await done;
    expect(r).toMatchObject({ flows: 2, settings: false });
    expect(useStore.getState().settings.pausedTriggers).toEqual(["f_a"]);
    expect(useStore.getState().settings.theme).toBe(DEFAULT_SETTINGS.theme);
  });

  test("applying the settings keeps the merged list (local pauses are not overwritten)", async () => {
    await useStore.getState().saveFlow(flow("f_local"));
    await useStore.getState().updateSettings({ pausedTriggers: ["f_local"] });
    const backup = buildBackup({ flows: [flow("f_a")], settings: { ...DEFAULT_SETTINGS, theme: "light", pausedTriggers: ["f_a"] } });
    const done = restoreBackupFile(file(JSON.stringify(backup)));
    const dialog = await waitForDialog();
    useDialogs.getState().close(dialog.id, { ok: true });
    expect((await done)!.settings).toBe(true);
    expect(useStore.getState().settings.theme).toBe("light");
    expect(useStore.getState().settings.pausedTriggers.sort()).toEqual(["f_a", "f_local"]);
  });

  test('"Export selected" carries the pause of the exported flows only; restoring it asks nothing', async () => {
    await useStore.getState().saveFlow(flow("f_a"));
    await useStore.getState().saveFlow(flow("f_b"));
    await useStore.getState().updateSettings({ pausedTriggers: ["f_a", "f_b"] });
    downloadBackup([useStore.getState().flows.find((f) => f.id === "f_a")!]);
    const text = downloads[0]!.data;
    expect(text).not.toContain("\n"); // not pretty-printed
    expect(JSON.parse(text).settings).toEqual({ pausedTriggers: ["f_a"] });
    // Restore on a clean device.
    await db.clearAll();
    useStore.setState({ flows: [], settings: DEFAULT_SETTINGS });
    const r = await restoreBackupFile(file(text));
    expect(useDialogs.getState().stack).toHaveLength(0);
    expect(r).toMatchObject({ flows: 1, settings: false });
    expect(useStore.getState().settings.pausedTriggers).toEqual(["f_a"]);
  });

  test("keep both: the copy of a paused flow is paused under its new id", async () => {
    await useStore.getState().saveFlow(flow("f_a"));
    const done = restoreBackupFile(file(JSON.stringify(buildBackup({ flows: [flow("f_a")], pausedTriggers: ["f_a"] }))));
    const conflict = await waitForDialog();
    useDialogs.getState().close(conflict.id, { ok: false }); // keep both
    await done;
    const copy = useStore.getState().flows.find((f) => f.id !== "f_a")!;
    expect(useStore.getState().settings.pausedTriggers).toEqual([copy.id]);
  });
});

describe("import size limits", () => {
  const backupHead = '{"format":"autoflow.backup","version":1,"flows":[';
  test("2 MB for single flows, 50 MB for backups, decided from the first bytes", async () => {
    expect(await importFileTooLarge(file("{}", 1_999_999))).toBe(false);
    expect(await importFileTooLarge(file('{"format":"autoflow.flow"}', 2_000_001))).toBe(true);
    expect(await importFileTooLarge(file(backupHead, 30_000_000))).toBe(false);
    expect(await importFileTooLarge(file('{\n  "format": "autoflow.backup",', 30_000_000))).toBe(false); // older pretty-printed files
    expect(await importFileTooLarge(file(backupHead, 50_000_001))).toBe(true);
  });

  test("restoreBackupFile refuses an oversized non-backup before reading it", async () => {
    const big = { size: 3_000_000, slice: () => ({ text: async () => '{"name":"x"' }), text: vi.fn(async () => "{}") } as unknown as File;
    await expect(restoreBackupFile(big)).rejects.toThrow(/too large/);
    expect(big.text).not.toHaveBeenCalled();
  });
});

describe("start-up warning for unreadable flows", () => {
  test("one sticky toast whose action downloads the raw JSON", () => {
    warnUnreadableFlows();
    expect(useStore.getState().toasts).toHaveLength(0);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const raw = { id: "f_bad", name: "Broken", steps: [{ id: "x" }, { id: "x" }] };
    useStore.setState({ unreadable: [{ id: "f_bad", name: "Broken", issue: 'steps: duplicate step id "x"', raw }, { id: "", issue: "name: Required", raw: { nope: 1 } }] });
    warnUnreadableFlows();
    log.mockRestore();
    const toasts = useStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ kind: "warning", text: "2 flows could not be loaded. They are still stored on this device — export them so nothing is lost." });
    toasts[0]!.action!.run();
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.name).toMatch(/^autoflow-unreadable-flows-\d{4}-\d\d-\d\d\.json$/);
    const body = JSON.parse(downloads[0]!.data);
    expect(body.flows).toHaveLength(2);
    expect(body.flows[0]).toEqual({ id: "f_bad", name: "Broken", issue: 'steps: duplicate step id "x"', raw });
  });

  test("a restore reports flows that could not be saved", () => {
    toastRestored({ flows: 2, profiles: 0, failed: 1, failedIssue: 'Bad: steps: duplicate step id "d"' });
    const kinds = useStore.getState().toasts.map((x) => x.kind);
    expect(kinds).toEqual(["success", "error"]);
    expect(useStore.getState().toasts[1]!.text).toContain("Bad: steps: duplicate");
  });
});

describe("partial runs in the browser", () => {
  const navigate = vi.fn();
  test("do not start while another run is active", async () => {
    useStore.setState({ active: { runId: "r1", flowId: "f_x", flowName: "X", where: "canvas", state: "running", startedAt: 0, actions: 0 } });
    await startFlow(flow("f_a"), navigate, { transient: true });
    expect(runInCanvas).not.toHaveBeenCalled();
    expect(useStore.getState().toasts.at(-1)).toMatchObject({ kind: "warning", text: "Another run is still active. Stop it or wait until it has finished." });
  });

  test("otherwise run in the sandbox and are marked as partial", async () => {
    await startFlow(flow("f_a"), navigate, { transient: true });
    expect(runInCanvas).toHaveBeenCalledTimes(1);
    expect((runInCanvas.mock.calls[0] as unknown[])[1]).toMatchObject({ partial: true });
  });
});
