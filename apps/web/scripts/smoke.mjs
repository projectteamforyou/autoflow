// End-to-end smoke test of the built PWA in Chromium.
// Usage: pnpm --filter @autoflow/web build && node scripts/smoke.mjs [--url http://localhost:4191/]
// Verifies: onboarding, creating an Easy flow, running it on the Practice Canvas until completion,
// the run landing in the Ledger, Pro mode editing, Atlas install, the Stage panel running a
// two-monitor practice flow with scene conditions, then the 1.2.0 features (undo / redo, step
// clipboard, step timeout / retry / jump, groups, partial runs, the Ledger step trace, folders and
// bulk actions, hotkey conflicts, secrets, backup / restore, the phone layout, every lazy route),
// language switching without raw i18n keys, and no console errors.
//
// Screenshots (phone layout, failures) go to $SMOKE_SHOTS (default: <tmp>/autoflow-smoke-shots).
// The first block of steps stops at the first failure; each numbered 1.2.0 section reports its own
// ✓ / ✗ and the script carries on, so one broken feature does not hide the others. Exit code 1 if any failed.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argUrl = process.argv.includes("--url") ? process.argv[process.argv.indexOf("--url") + 1] : null;
/** A free local port, so a leftover preview server on a fixed port can't serve a stale build. */
const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port: p } = srv.address();
      srv.close(() => resolve(p));
    });
  });
const port = argUrl ? 0 : await freePort();
let server;
if (!argUrl) {
  server = spawn("npx", ["vite", "preview", "--port", String(port), "--strictPort"], { cwd: new URL("..", import.meta.url).pathname, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 2500));
}
const base = argUrl ?? `http://localhost:${port}/`;
const SHOTS = process.env.SMOKE_SHOTS ?? join(tmpdir(), "autoflow-smoke-shots");
mkdirSync(SHOTS, { recursive: true });
const DESKTOP = { width: 1400, height: 900 };
const PHONE = { width: 390, height: 844 };
const exe = ["/opt/pw-browsers/chromium/chrome-linux/chrome", process.env.CHROME_PATH].find((p) => p && existsSync(p));
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: DESKTOP, deviceScaleFactor: 1, acceptDownloads: true });
page.setDefaultTimeout(10000);
const errors = [];
// Local runs must not touch the production API (and its CORS allowlist rightly rejects localhost).
// Everything but the public stats is refused outright (the app treats that as "offline").
if (!argUrl) {
  await page.route(/^https:\/\/api\.autoflowmacro\.com\//, (r) => r.abort());
  await page.route(/\/v1\/stats(\/|$)/, (r) => r.fulfill(r.request().method() === "GET" ? { status: 200, contentType: "application/json", body: JSON.stringify({ visitsTotal: 1, onlineNow: 1, downloads: { windows: 0, android: 0, total: 0 } }) } : { status: 204 }));
}
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text()) && errors.push(m.text()));
const step = (name) => console.log(`✓ ${name}`);
const skipped = (reason) => console.log(`– skipped: ${reason}`);
const fail = async (msg) => {
  console.error(`✗ ${msg}`);
  await page.screenshot({ path: join(SHOTS, "smoke-failure.png") }).catch(() => undefined);
  await browser.close();
  server?.kill();
  process.exit(1);
};

// ---------------------------------------------------------------------------------------------
// Helpers for the 1.2.0 sections
// ---------------------------------------------------------------------------------------------
const failures = [];
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
/** Polls `fn` until it returns something truthy (returned); throws `what` (plus the last value) on timeout. */
const until = async (fn, what, timeout = 10000) => {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    last = await fn();
    if (last) return last;
    if (Date.now() > end) throw new Error(`timed out waiting for ${typeof what === "function" ? what() : what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};
/** One numbered section: its own ✓ / ✗, a screenshot on failure, and a loud failure on any console error. */
const section = async (id, fn) => {
  try {
    await fn();
    if (errors.length) throw new Error(`console errors: ${errors.join(" | ")}`);
  } catch (e) {
    const shot = join(SHOTS, `fail-${id.replace(/[^a-z0-9]+/gi, "-")}.png`);
    await page.screenshot({ path: shot }).catch(() => undefined);
    const msg = String(e?.message ?? e).split("\n").slice(0, 80).join("\n    ");
    console.log(`✗ ${id}: ${msg}\n    url: ${page.url()}\n    screenshot: ${shot}`);
    failures.push(id);
    errors.length = 0;
    // Leave no dialog, sheet or phone viewport behind for the next section.
    for (let i = 0; i < 4 && (await page.locator(".backdrop").count().catch(() => 0)); i++) await page.keyboard.press("Escape").catch(() => undefined);
    await page.setViewportSize(DESKTOP).catch(() => undefined);
  }
};

/** Everything in one IndexedDB store of the app (what is really persisted, independent of the UI). */
const idb = (store) =>
  page.evaluate(
    (name) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("autoflow");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const all = db.transaction(name, "readonly").objectStore(name).getAll();
          all.onsuccess = () => {
            db.close();
            resolve(all.result);
          };
          all.onerror = () => reject(all.error);
        };
      }),
    store,
  );
const storedFlow = async (id) => (await idb("flows")).find((f) => f.id === id);
const flowByName = async (name) => (await idb("flows")).find((f) => f.name === name);
/** Waits until the saved flow satisfies `pred` (autosave is debounced) and returns it. */
const savedFlow = (id, pred, what) => until(async () => { const f = await storedFlow(id); return f && pred(f) ? f : null; }, `the saved flow to have ${what}`);
const runsOf = async (flowId) => (await idb("runs")).filter((r) => r.flowId === flowId).sort((a, b) => a.startedAt - b.startedAt);
const walk = (steps, fn) => {
  for (const s of steps) {
    fn(s);
    for (const slot of ["then", "else", "body", "catch"]) if (Array.isArray(s[slot])) walk(s[slot], fn);
  }
};

const go = (hash) => page.goto(`${base}#${hash}`);
const nodes = () => page.locator(".flow-col [data-step-id]:not([data-step-id='__flow'])");
const nodeIds = () => nodes().evaluateAll((els) => els.map((el) => el.dataset.stepId));
const node = (id) => page.locator(`.flow-col [data-step-id="${id}"]`);
const inspector = () => page.locator("aside.inspector");
/** A field of the inspector by its exact visible label (the hint text shares the <label>, so getByLabel is ambiguous). */
const field = (label) => inspector().locator(`label.field:has(> span:text-is("${label}"))`);
const topbar = () => page.locator("header.topbar");
const undoBtn = () => topbar().getByRole("button", { name: "Undo", exact: true });
const redoBtn = () => topbar().getByRole("button", { name: "Redo", exact: true });
const toast = (text) => page.locator(".toasts .toast", { hasText: text });
/** Dismisses what is left of the toasts (those with an action, like Undo, stay until dismissed) so they do not cover the page. */
const clearToasts = async () => {
  await until(async () => {
    const n = await page.locator(".toasts .toast").count();
    if (n) await page.locator(".toasts .toast button[aria-label=Dismiss]").first().click({ timeout: 1000 }).catch(() => undefined);
    return n === 0;
  }, "the toasts to be dismissed");
};
const dialog = (name) => page.getByRole("dialog", { name });
const card = (name) => page.locator(".flow-card").filter({ has: page.getByRole("link", { name, exact: true }) });
const noHScroll = async (where) => {
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert(m.sw <= m.iw, `${where}: the page scrolls horizontally (scrollWidth ${m.sw} > innerWidth ${m.iw})`);
};

/** Opens a flow in the editor and waits until it is rendered. */
const openFlow = async (id) => {
  await go(`/flows/${id}`);
  await page.locator(".flow-col .node.trigger").waitFor();
};
/** Creates an empty Pro flow, names it, and returns its id (saved). */
const newProFlow = async (name) => {
  await go("/new/pro");
  await page.waitForURL(/#\/flows\/f_/);
  const id = /#\/flows\/([^?/]+)/.exec(page.url())[1];
  await page.locator(".flow-col .node.trigger").waitFor();
  await page.getByLabel("Flow name").fill(name);
  await savedFlow(id, (f) => f.name === name, `the name "${name}"`);
  return id;
};
/** Adds a step from the desktop palette (after the selected step, else at the end); returns its id. It ends up selected. */
const addStep = async (title, fields = {}) => {
  const before = await nodeIds();
  await page.locator("aside.palette .palette-item").filter({ has: page.locator("b", { hasText: new RegExp(`^${title}$`) }) }).click();
  const id = await until(async () => (await nodeIds()).find((x) => !before.includes(x)), `a new "${title}" step on the canvas`);
  await page.locator(`.flow-col [data-step-id="${id}"].selected`).waitFor();
  for (const [label, value] of Object.entries(fields)) await field(label).locator("input, textarea").first().fill(value);
  return id;
};
/** Selects a step by clicking its node (focus moves to the node, so the editor shortcuts apply to it). */
const select = async (id) => {
  await node(id).click();
  await page.locator(`.flow-col [data-step-id="${id}"].selected`).waitFor();
};

try {
  await page.goto(`${base}#/welcome`);
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: /Next/ }).click();
  await page.locator("button.choice").first().click(); // Easy → creates an auto clicker
  await page.waitForURL(/#\/flows\/f_/);
  step("onboarding → easy flow created");

  await page.getByRole("button", { name: "Number of times" }).click();
  const times = page.getByLabel("Times");
  await times.fill("5");
  await page.getByRole("button", { name: "Fast" }).click();
  await page.waitForTimeout(900); // autosave
  step("easy settings edited");

  await page.getByRole("button", { name: /^Run$/ }).click();
  await page.waitForURL(/#\/canvas/);
  await page.getByText("Completed", { exact: false }).first().waitFor({ timeout: 20000 });
  const hits = await page.locator(".stage .hud .badge", { hasText: "hits" }).innerText();
  if (!/5 hits/.test(hits)) await fail(`expected 5 hits on canvas, got "${hits}"`);
  step("ran on Practice Canvas: " + hits);

  await page.goto(`${base}#/ledger`);
  await page.locator("table tbody tr").first().waitFor();
  if (!(await page.locator("table tbody tr").first().innerText()).includes("Completed")) await fail("ledger missing completed run");
  step("run recorded in Ledger");

  await page.goto(`${base}#/atlas/form-filler`);
  await page.getByRole("button", { name: "Add to my flows" }).click();
  await page.waitForURL(/#\/flows\/f_/);
  await page.locator(".node", { hasText: "For each" }).first().waitFor();
  step("Atlas template installed and opened in Pro editor");

  await page.getByRole("button", { name: /^Notification Show a/ }).click();
  await page.locator(".node.selected", { hasText: "Notification" }).waitFor();
  step("Pro editor: step added from palette");

  // Stage: the idle-game template plays on simulated monitor 2 and reacts to scenes (lobby / reward).
  await page.goto(`${base}#/atlas/idle-collect`);
  await page.getByRole("button", { name: "Try on Stage" }).click();
  await page.waitForURL(/#\/stage\?flow=f_/);
  await page.getByRole("heading", { name: "Stage — play on another monitor" }).waitFor();
  const monitors = await page.locator(".monitor-map .monitor").count();
  if (monitors !== 2) await fail(`expected 2 simulated monitors on /stage, got ${monitors}`);
  if (!(await page.locator(".monitor-map .monitor.is-stage", { hasText: "2" }).count())) await fail("monitor 2 is not the stage");
  if ((await page.locator(".scene-card").count()) !== 3) await fail("expected the template's 3 scenes on /stage");
  await page.getByRole("button", { name: "Run on stage" }).click();
  await page.getByText("Collected round 3 of 3").first().waitFor({ timeout: 30000 });
  await page.locator("[data-testid=practice-coins]", { hasText: "30" }).waitFor({ timeout: 10000 });
  step("Stage: two-monitor practice run with scene conditions collected 3 rewards");

  await page.getByRole("button", { name: "Which scene is showing?" }).click();
  await page.locator(".scene-card", { hasText: "lobby" }).getByText("100% match").waitFor();
  step("Stage: live scene test recognizes the lobby");

  if (errors.length) await fail(`console errors: ${errors.join(" | ")}`);

  // =============================================================================================
  // 1.2.0 features. The UI is English from here until the Korean switch at the end.
  // =============================================================================================
  const ids = {}; // flows created below, by role
  const LABEL = "zebra-quokka"; // appears only as a step label (Library search)

  // --- 1. Undo / redo ----------------------------------------------------------------------------
  await section("1 undo/redo", async () => {
    const id = (ids.undo = await newProFlow("Undo Lab"));
    // A fresh editor session has no history; reload so the rename above is not on the stack either.
    await page.reload();
    await page.locator(".flow-col .node.trigger").waitFor();
    assert(await undoBtn().isDisabled(), "Undo should be disabled in a fresh editor session");
    assert(await redoBtn().isDisabled(), "Redo should be disabled in a fresh editor session");

    const keep = await addStep("Log", { Message: "kept step", Label: LABEL });
    const gone = await addStep("Set variable");
    assert((await nodes().count()) === 2, "two steps expected after adding two");
    assert(await undoBtn().isEnabled(), "Undo should be enabled after adding steps");
    assert(await redoBtn().isDisabled(), "Redo should stay disabled until something is undone");

    await select(gone);
    await page.keyboard.press("Delete");
    await node(gone).waitFor({ state: "detached" });
    assert((await nodes().count()) === 1, "one step expected after Delete");
    await page.keyboard.press("Control+z");
    await node(gone).waitFor();
    assert((await nodeIds()).join() === [keep, gone].join(), "Ctrl+Z should bring the deleted step back at its old place");
    assert(await redoBtn().isEnabled(), "Redo should be enabled after an undo");
    await page.keyboard.press("Control+Shift+Z");
    await node(gone).waitFor({ state: "detached" });
    assert(await redoBtn().isDisabled(), "Redo should be disabled again once everything is redone");
    assert(await undoBtn().isEnabled(), "Undo should still be enabled after a redo");

    // The top-bar buttons do the same as the shortcuts.
    await undoBtn().click();
    await node(gone).waitFor();
    await redoBtn().click();
    await node(gone).waitFor({ state: "detached" });

    await savedFlow(id, (f) => f.steps.length === 1 && f.steps[0].id === keep && f.steps[0].label === LABEL, "exactly the kept step");
    await page.reload();
    await node(keep).waitFor();
    assert((await nodeIds()).join() === keep, "after a reload the canvas should show exactly the kept step");
    const saved = await storedFlow(id);
    assert(saved.name === "Undo Lab" && saved.steps.length === 1 && saved.steps[0].type === "log" && saved.steps[0].message === "kept step", `saved flow does not match the last state: ${JSON.stringify(saved.steps)}`);
    assert((await undoBtn().isDisabled()) && (await redoBtn().isDisabled()), "history must not survive a reload");
    step("Pro editor: delete → Ctrl+Z restores → Ctrl+Shift+Z removes again; undo/redo buttons follow; reload shows the last state");
  });

  // --- 2. Copy / paste across flows, cut, toggle disabled, shortcuts sheet ---------------------
  await section("2 clipboard", async () => {
    const src = await flowByName("Undo Lab");
    assert(src?.steps.length === 1, "section 1 must have left “Undo Lab” with one step");
    await openFlow(src.id);
    await select(src.steps[0].id);
    await page.keyboard.press("Control+c");
    await toast("Step copied").first().waitFor();

    const id = (ids.paste = await newProFlow("Paste Lab"));
    await page.reload(); // the clipboard is persistent: it survives leaving the flow and a reload
    await page.locator(".flow-col .node.trigger").waitFor();
    assert((await nodes().count()) === 0, "the new flow should start empty");
    await page.keyboard.press("Control+v");
    const pasted = await until(async () => (await nodeIds())[0], "the pasted step");
    assert(pasted !== src.steps[0].id, "a pasted step must get a fresh id");
    await page.locator(`.flow-col [data-step-id="${pasted}"]`, { hasText: LABEL }).waitFor();
    await savedFlow(id, (f) => f.steps.length === 1 && f.steps[0].message === "kept step" && f.steps[0].label === LABEL, "the pasted step");

    await select(pasted);
    await page.keyboard.press("Control+x");
    await node(pasted).waitFor({ state: "detached" });
    await toast("Step cut").first().waitFor();
    await page.keyboard.press("Control+z");
    await node(pasted).waitFor();

    await select(pasted);
    await page.keyboard.press("Control+/");
    await page.locator(`.flow-col .node.disabled[data-step-id="${pasted}"]`).waitFor();
    await savedFlow(id, (f) => f.steps[0]?.disabled === true, "the step disabled");
    await page.keyboard.press("Control+/");
    await page.locator(`.flow-col .node:not(.disabled)[data-step-id="${pasted}"]`).waitFor();
    await savedFlow(id, (f) => f.steps.length === 1 && f.steps[0].disabled === undefined, "the step enabled again (no disabled flag)");

    await page.keyboard.press("?");
    const sheet = dialog("Keyboard shortcuts");
    await sheet.waitFor();
    assert((await sheet.locator(".shortcut-list > div").count()) >= 12, "the shortcuts sheet should list the general and the step shortcuts");
    await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "detached" });
    assert((await page.locator(`.flow-col .node.selected[data-step-id="${pasted}"]`).count()) === 1, "Esc on the shortcuts sheet must not also deselect the step");
    assert((await page.locator("aside.inspector.open").count()) === 1 && (await inspector().getByRole("heading", { name: "Log" }).count()) === 1, "Esc on the shortcuts sheet must not close the inspector");
    assert(/#\/flows\//.test(page.url()), "Esc on the shortcuts sheet must not leave the editor");
    step("Pro editor: Ctrl+C → other flow (after reload) Ctrl+V; Ctrl+X + Ctrl+Z; Ctrl+/ toggles disabled; “?” sheet closes with Esc only");
  });

  // --- 3. Step timeout, retry / backoff, jump to step, groups --------------------------------
  await section("3 step form", async () => {
    const id = (ids.form = await newProFlow("Form Lab"));
    const alpha = await addStep("Log", { Message: "a", Label: "alpha" });
    const beta = await addStep("Log", { Message: "b", Label: "beta" });
    const gamma = await addStep("Log", { Message: "c", Label: "gamma" });
    assert((await nodeIds()).join() === [alpha, beta, gamma].join(), "steps should be added one after the other");

    await select(beta);
    const timeout = inspector().locator('input[aria-label="Step timeout"]');
    const strategy = field("If this step fails").locator("select").first();
    await timeout.fill("2.5");
    await strategy.selectOption("retry");
    await field("Delay growth").locator("select").selectOption("exponential");
    await node(beta).locator(".badge", { hasText: "Retry" }).waitFor();
    await savedFlow(id, (f) => f.steps[1]?.stepTimeoutMs === 2500 && f.steps[1].onError?.strategy === "retry" && f.steps[1].onError.backoff === "exponential" && f.steps[1].onError.retries >= 1, "a 2.5 s timeout and retry with exponential backoff");

    await strategy.selectOption("goto");
    const target = inspector().locator('select[aria-label="Jump to step"]');
    await target.waitFor();
    assert((await target.locator("option:not([disabled])").allInnerTexts()).join("|") === "1. alpha|2. beta|3. gamma", "“Jump to step” should offer the top-level steps");
    await target.selectOption(gamma);
    await savedFlow(id, (f) => f.steps[1].onError?.strategy === "goto" && f.steps[1].onError.gotoStepId === gamma, "jump to “gamma”");

    await page.reload();
    await select(beta);
    assert((await timeout.inputValue()) === "2.5", `step timeout after reload: "${await timeout.inputValue()}"`);
    assert((await strategy.inputValue()) === "goto", `on-error strategy after reload: "${await strategy.inputValue()}"`);
    assert((await target.inputValue()) === gamma, "jump target after reload");
    const b = (await storedFlow(id)).steps[1];
    assert(b.stepTimeoutMs === 2500 && b.onError.strategy === "goto" && b.onError.gotoStepId === gamma, `saved step after reload: ${JSON.stringify(b)}`);

    await select(alpha);
    await page.getByRole("group", { name: "Wrap in" }).getByRole("button", { name: "Group" }).click();
    const group = await until(async () => (await nodeIds()).find((x) => ![alpha, beta, gamma].includes(x)), "the group wrapper");
    await page.locator(`.flow-col .node.selected[data-step-id="${group}"]`).waitFor();
    assert((await nodeIds()).join() === [group, alpha, beta, gamma].join(), "the group should take the step's place and hold it");
    await node(group).getByRole("button", { name: "Collapse" }).click();
    await node(alpha).waitFor({ state: "detached" });
    assert(/^1 steps?$/.test((await node(group).locator(".title .badge").first().innerText()).trim()), "a collapsed group shows an “N steps” badge");
    assert((await nodeIds()).join() === [group, beta, gamma].join(), "collapsing hides only the group's children");
    await savedFlow(id, (f) => f.steps[0].type === "group" && f.steps[0].collapsed === true && f.steps[0].body.length === 1, "the group collapsed");
    await node(group).getByRole("button", { name: "Expand" }).click();
    await node(alpha).waitFor();
    assert((await node(group).locator(".title .badge").count()) === 0, "an expanded group has no “N steps” badge");
    await savedFlow(id, (f) => f.steps[0].type === "group" && !f.steps[0].collapsed && f.steps[1].onError?.gotoStepId === gamma, "the group expanded");
    step("Step form: timeout 2.5 s, retry + exponential backoff, jump to step persist across a reload; group wraps, collapses (“1 steps”) and expands");
  });

  // --- 4. Run only this step / run from here ----------------------------------------------------
  await section("4 partial run", async () => {
    const id = (ids.partial = await newProFlow("Partial Lab"));
    const first = await addStep("Log", { Message: "hello-partial" });
    const wait = await addStep("Wait");
    await addStep("Set variable");
    await addStep("Log", { Message: "bye-partial" });
    const before = await savedFlow(id, (f) => f.steps.length === 4 && f.steps[3].message === "bye-partial", "all four steps");
    assert(before.steps.map((s) => s.type).join() === "log,wait,setVar,log", `unexpected steps: ${before.steps.map((s) => s.type)}`);

    const runAndWait = async (stepId, button) => {
      const had = (await runsOf(id)).length;
      await select(stepId);
      await inspector().getByRole("button", { name: button }).click();
      const runs = await until(async () => { const r = await runsOf(id); return r.length > had ? r : null; }, `a Ledger record after “${button}”`, 20000);
      await page.locator(".pulse").waitFor({ state: "detached" });
      return runs[runs.length - 1];
    };
    const logs = (run) => run.events.filter((e) => e.type === "log").map((e) => e.message);
    const started = (run) => run.events.filter((e) => e.type === "stepStart").map((e) => e.stepType).join();

    const only = await runAndWait(first, "Run only this step");
    assert(only.status === "completed", `“Run only this step” ended as ${only.status}: ${JSON.stringify(only.error)}`);
    assert(logs(only).join() === "hello-partial", `“Run only this step” should log only the first message, got [${logs(only)}]`);
    assert(started(only) === "log", `“Run only this step” should start only the one step, started [${started(only)}]`);
    assert(/#\/flows\//.test(page.url()), "a partial run in the browser stays in the editor");

    const from = await runAndWait(wait, "Run from here");
    assert(from.status === "completed", `“Run from here” ended as ${from.status}: ${JSON.stringify(from.error)}`);
    assert(logs(from).join() === "bye-partial", `“Run from here” should skip the steps before it, got [${logs(from)}]`);
    assert(started(from) === "wait,setVar,log", `“Run from here” should start the step and everything after it, started [${started(from)}]`);

    const after = await storedFlow(id);
    let disabled = 0;
    walk(after.steps, (s) => void (s.disabled && disabled++));
    assert(after.steps.length === 4 && disabled === 0, `the saved flow changed: ${after.steps.length} steps, ${disabled} disabled`);
    assert(JSON.stringify(after) === JSON.stringify(before), "a partial run must not save anything to the flow (steps, revision, updatedAt)");
    assert((await page.locator(".flow-col .node.disabled").count()) === 0 && (await nodes().count()) === 4, "the editor must still show four enabled steps");

    await go("/flows");
    await card("Partial Lab").waitFor();
    await go("/ledger");
    await page.locator("table tbody tr").first().waitFor();
    const rows = page.locator("table tbody tr", { hasText: "Partial Lab" });
    assert((await rows.count()) === 2, `the Ledger should list both partial runs, found ${await rows.count()}`);
    assert((await rows.first().innerText()).includes("Completed"), "the latest partial run should be listed as Completed");
    step("Partial runs: “Run only this step” and “Run from here” complete in the browser sandbox, leave the saved flow untouched, and land in the Ledger");
  });

  // --- 5. Ledger run detail -----------------------------------------------------------------------
  await section("5 ledger", async () => {
    const flow = await flowByName("Partial Lab");
    assert(flow, "section 4 must have created “Partial Lab”");
    const had = await runsOf(flow.id);
    assert(had.length >= 1, "“Partial Lab” has no runs to open");
    const latest = had[had.length - 1];
    await go("/ledger");
    await page.locator("table tbody tr").first().waitFor();
    assert((await page.locator("table tbody tr").first().innerText()).includes("Partial Lab"), "the latest run should be the first Ledger row");
    await page.locator("table tbody tr").first().click();
    await page.waitForURL(new RegExp(`#/ledger/${latest.id}$`));

    const spans = page.locator(".event.span");
    await spans.first().waitFor();
    const spanTexts = (await spans.allInnerTexts()).map((x) => x.replace(/\s+/g, " ").trim());
    assert(spanTexts.length === 3 && /Wait/.test(spanTexts[0]) && /Set variable/.test(spanTexts[1]) && /Log/.test(spanTexts[2]), `the step trace should list Wait, Set variable, Log: ${JSON.stringify(spanTexts)}`);
    const durations = await spans.locator(".mono").allInnerTexts();
    assert(durations.length === 3 && durations.every((d) => /\d/.test(d)), `every step row should show a duration: ${JSON.stringify(durations)}`);
    assert(spanTexts.every((x) => /^\+\d+\.\d\ds/.test(x)), "every step row should show its offset from the run start");

    const tabs = page.getByRole("group", { name: "Timeline" });
    await tabs.getByRole("button", { name: "Log" }).click();
    const search = page.getByLabel("Search the log");
    await search.waitFor();
    assert((await spans.count()) === 0, "the Log tab replaces the step trace");
    const lines = page.locator(".card .event");
    const all = await lines.count();
    assert(all >= 4, `the Log tab should list the run's events, found ${all}`);
    await search.fill("bye-partial");
    await until(async () => (await lines.count()) === 1, "exactly one log line for “bye-partial”");
    assert((await lines.first().innerText()).includes("bye-partial"), "the search hit should be the logged message");
    await search.fill("no-such-text-xyz");
    await page.locator(".card").getByText("Nothing found").waitFor();
    assert((await lines.count()) === 0, "a search without hits lists nothing");
    await search.fill("");
    await until(async () => (await lines.count()) === all, "all log lines back after clearing the search");
    await tabs.getByRole("button", { name: "Steps" }).click();
    await spans.first().waitFor();

    await topbar().getByRole("button", { name: "Run again" }).click();
    await page.waitForURL(/#\/canvas\?flow=/);
    const runs = await until(async () => { const r = await runsOf(flow.id); return r.length > had.length ? r : null; }, "a new run after “Run again”", 20000);
    const again = runs[runs.length - 1];
    assert(again.status === "completed" && again.events.filter((e) => e.type === "log").length === 2, `“Run again” should run the whole flow: ${again.status}`);

    await go(`/ledger/${again.id}`);
    await page.locator(".event.span").nth(3).waitFor();
    await topbar().getByRole("button", { name: "Open in editor" }).click();
    await page.waitForURL(new RegExp(`#/flows/${flow.id}$`));
    await nodes().nth(3).waitFor();
    step("Ledger: step trace with durations, Steps/Log tabs, log search, “Run again” starts a run, “Open in editor” opens the flow");
  });

  // --- 6. Library: folders, selection mode, bulk tag / delete + undo, sort, deep search ----------
  await section("6 library", async () => {
    for (const name of ["Undo Lab", "Paste Lab", "Form Lab", "Partial Lab"]) assert(await flowByName(name), `“${name}” is missing (an earlier section failed)`);
    await go("/flows");
    await card("Form Lab").waitFor();
    const total = (await idb("flows")).length;
    assert((await page.locator(".flow-card").count()) === total, "the library should list every flow");

    // Folder: created by moving a flow into a new one.
    await card("Form Lab").getByRole("button", { name: "More actions" }).click();
    await page.locator(".modal").getByRole("button", { name: "Move to folder…" }).click();
    const picker = dialog("Move to folder…");
    await picker.getByLabel("New folder name").fill("Work");
    await picker.getByRole("button", { name: "Create and move" }).click();
    await toast("Moved 1 flow(s) to “Work”.").first().waitFor();
    assert((await flowByName("Form Lab")).folder === "Work", "the flow should be saved with its folder");
    const chips = page.getByRole("group", { name: "Folders" });
    await chips.getByRole("button", { name: "Work · 1" }).click();
    await until(async () => (await page.locator(".flow-card").count()) === 1, "only the folder's flow");
    await card("Form Lab").waitFor();
    assert(/folder=Work/.test(page.url()), "the folder filter lives in the URL");
    await chips.getByRole("button", { name: `All · ${total}` }).click();
    await until(async () => (await page.locator(".flow-card").count()) === total, "all flows after clearing the folder filter");

    // Selection mode: bulk tag two flows.
    await page.getByRole("button", { name: "Select", exact: true }).click();
    const bar = page.locator(".bulk-bar");
    await bar.waitFor();
    await page.getByLabel("Select Undo Lab", { exact: true }).check();
    await page.getByLabel("Select Paste Lab", { exact: true }).check();
    await bar.getByText("2 selected").waitFor();
    await bar.getByRole("button", { name: "Add tag" }).click();
    const tagDialog = dialog("Add tag");
    await tagDialog.locator("input").fill("smoke");
    await tagDialog.getByRole("button", { name: "Save" }).click();
    await toast("Added #smoke to 2 flow(s).").first().waitFor();
    const tagged = (await idb("flows")).filter((f) => f.tags.includes("smoke")).map((f) => f.name).sort();
    assert(tagged.join() === "Paste Lab,Undo Lab", `tagged flows: ${tagged}`);
    await page.getByRole("button", { name: "#smoke", exact: true }).click();
    await until(async () => (await page.locator(".flow-card").count()) === 2, "the two tagged flows");
    await page.getByRole("button", { name: "All tags" }).click();

    // Bulk delete one, then Undo.
    await page.getByLabel("Select Undo Lab", { exact: true }).uncheck();
    await bar.getByText("1 selected").waitFor();
    const doomed = await flowByName("Paste Lab");
    await bar.getByRole("button", { name: "Delete" }).click();
    await dialog("Delete this flow?").getByRole("button", { name: "Delete" }).click();
    await card("Paste Lab").waitFor({ state: "detached" });
    assert(!(await storedFlow(doomed.id)), "the deleted flow should be gone from the database");
    await toast("Flow deleted.").getByRole("button", { name: "Undo" }).click();
    await card("Paste Lab").waitFor();
    const back = await storedFlow(doomed.id);
    assert(back && back.tags.includes("smoke") && JSON.stringify(back.steps) === JSON.stringify(doomed.steps), "Undo should bring the flow back as it was");
    await bar.getByRole("button", { name: "Done" }).click();
    await bar.waitFor({ state: "detached" });

    // Sort by last run: most recent first, never-run flows last.
    const runs = await idb("runs");
    const lastRun = new Map();
    for (const r of runs) lastRun.set(r.flowId, Math.max(lastRun.get(r.flowId) ?? 0, r.startedAt));
    const flows = await idb("flows");
    const ran = flows.filter((f) => lastRun.has(f.id)).sort((a, b) => lastRun.get(b.id) - lastRun.get(a.id)).map((f) => f.name);
    assert(ran[0] === "Partial Lab" && ran.length >= 2 && ran.length < flows.length, `unexpected run history: ${ran}`);
    const sort = page.getByRole("group", { name: "Sort" });
    await sort.getByRole("button", { name: "Last run" }).click();
    const names = () => page.locator(".flow-card .grow > a").allInnerTexts();
    await until(async () => (await names()).slice(0, ran.length).join("|") === ran.join("|"), () => `the flows ordered by last run (${ran.join(", ")})`);
    await sort.getByRole("button", { name: "Updated" }).click();

    // Search inside steps: the label is in no name, description, tag or folder.
    assert(!flows.some((f) => `${f.name} ${f.description} ${f.folder ?? ""} ${f.tags.join(" ")}`.includes("quokka")), "the search text must only be in step labels");
    const expected = flows.filter((f) => { let hit = false; walk(f.steps, (s) => void (s.label?.includes("quokka") && (hit = true))); return hit; }).map((f) => f.name).sort();
    assert(expected.join() === "Paste Lab,Undo Lab", `flows with the label: ${expected}`);
    const box = page.getByLabel("Search names, tags, folders, step labels or typed text");
    await box.fill("QUOKKA");
    await until(async () => (await names()).sort().join() === expected.join(), "exactly the flows with that step label");
    await box.fill("");
    await until(async () => (await page.locator(".flow-card").count()) === total, "all flows after clearing the search");
    step("Library: new folder + folder chip, selection mode bulk tag, bulk delete + Undo, sort by last run, search by step label");
  });

  // --- 7. Triggers: hotkey conflict, pause switch, modifier lint -------------------------------
  await section("7 triggers", async () => {
    const hotkeyTrigger = async (id) => {
      await page.locator('.flow-col [data-step-id="__flow"]').click();
      await field("Start when").locator("select").selectOption("hotkey");
      const capture = inspector().locator("button.capture").first();
      await capture.click();
      await inspector().locator("button.capture.listening").waitFor();
      await page.keyboard.press("Control+Alt+K");
      await capture.locator("kbd", { hasText: /^Ctrl\+Alt\+K$/i }).waitFor();
      await savedFlow(id, (f) => f.trigger.type === "hotkey" && f.trigger.hotkey.key === "K" && [...f.trigger.hotkey.modifiers].sort().join() === "alt,ctrl", "the Ctrl+Alt+K hotkey trigger");
      assert((await page.getByRole("dialog").count()) === 0, "capturing Ctrl+Alt+K must not open the command palette");
      return capture;
    };
    const one = (ids.trigOne = await newProFlow("Trig One"));
    await hotkeyTrigger(one);
    const two = (ids.trigTwo = await newProFlow("Trig Two"));
    const capture = await hotkeyTrigger(two);

    // A plain letter would swallow that key everywhere: lint error, Run disabled. Undo takes it back.
    await capture.click();
    await inspector().locator("button.capture.listening").waitFor();
    await page.keyboard.press("a");
    const lint = page.locator(".lint-list .lint-item.error", { hasText: "would swallow that key in every app" });
    await lint.waitFor();
    assert((await lint.innerText()).includes("“A”"), `the lint should name the key: ${await lint.innerText()}`);
    assert(await topbar().getByRole("button", { name: "Run", exact: true }).isDisabled(), "Run should be disabled while the flow has a lint error");
    await page.keyboard.press("Control+z");
    await lint.waitFor({ state: "detached" });
    await capture.locator("kbd", { hasText: /^Ctrl\+Alt\+K$/i }).waitFor();
    await savedFlow(two, (f) => f.trigger.hotkey?.key === "K" && f.trigger.hotkey.modifiers.length === 2, "Ctrl+Alt+K again after the undo");

    await go("/flows");
    const conflict = (name) => card(name).getByRole("button", { name: "Hotkey conflict" });
    await conflict("Trig One").waitFor();
    await conflict("Trig Two").waitFor();
    assert((await conflict("Trig One").getAttribute("title")).includes("Trig Two") && (await conflict("Trig Two").getAttribute("title")).includes("Trig One"), "each conflict badge should name the other flow");
    assert((await page.getByRole("button", { name: "Hotkey conflict" }).count()) === 2, "only the two clashing flows should show a conflict");

    const sw = card("Trig One").locator("label.switch");
    assert(await sw.locator("input").isChecked(), "the trigger switch should start on");
    await sw.click();
    await card("Trig One").getByText("Trigger paused").waitFor();
    await until(async () => (await page.getByRole("button", { name: "Hotkey conflict" }).count()) === 0, "the conflict to disappear from both flows once one trigger is off");
    assert((await storedFlow(one)).trigger.type === "hotkey", "pausing a trigger must not edit the flow");
    await sw.click();
    await conflict("Trig One").waitFor();
    await conflict("Trig Two").waitFor();
    step("Triggers: same Ctrl+Alt+K on two flows → conflict badge on both; switching one off clears it; plain “a” shows the modifier lint error");
  });

  // --- 8. Settings → Secrets ----------------------------------------------------------------------
  await section("8 secrets", async () => {
    const NAME = "smoke_token";
    const VALUE = "s3cr3t-VALUE-9f2c71";
    const id = (ids.secret = await newProFlow("Secret User"));
    await addStep("Type text", { Text: `{{secret:${NAME}}}` });
    await savedFlow(id, (f) => f.steps[0]?.text === `{{secret:${NAME}}}`, "the type step");
    const other = (ids.secretMissing = await newProFlow("Secret Missing"));
    await addStep("Type text", { Text: "{{secret:unset_one}}" });
    await savedFlow(other, (f) => f.steps[0]?.text === "{{secret:unset_one}}", "the type step");

    await go("/settings");
    const box = page.locator("section.card").filter({ has: page.getByRole("heading", { name: "Secrets" }) });
    await box.getByText("No secrets saved on this device yet.").waitFor();
    const missing = box.locator(".callout.warn");
    await missing.getByText("Used by your flows but not set on this device").waitFor();
    const missingRow = (n) => missing.locator(".row").filter({ has: page.locator("code", { hasText: new RegExp(`^${n}$`) }) });
    assert((await missingRow(NAME).getByRole("link", { name: "Secret User" }).count()) === 1, "an unset secret should be listed as missing with the flow that uses it");
    assert((await missingRow("unset_one").getByRole("link", { name: "Secret Missing" }).count()) === 1, "the second unset secret should be listed as missing with its flow");

    await box.locator('label.field:has(> span:text-is("Name")) input').fill(NAME);
    await box.locator('input[type="password"]').fill(VALUE);
    await box.getByRole("button", { name: "Add secret" }).click();
    await toast(`Secret “${NAME}” saved.`).first().waitFor();
    const row = box.locator(".secret-row").filter({ has: page.locator("code", { hasText: new RegExp(`^${NAME}$`) }) });
    await row.waitFor();
    assert((await row.innerText()).includes("Used by:") && (await row.getByRole("link", { name: "Secret User" }).count()) === 1, "the saved secret should show “Used by: Secret User”");
    await until(async () => (await missingRow(NAME).count()) === 0, "the saved secret to leave the missing list");
    assert((await missingRow("unset_one").getByRole("link", { name: "Secret Missing" }).count()) === 1, "the still-unset secret should stay under missing");

    // The value is write-only: not in the page, not in any field, and not stored in the clear.
    const leaks = await page.evaluate(async (value) => {
      const out = [];
      if (document.documentElement.outerHTML.includes(value)) out.push("DOM");
      if ([...document.querySelectorAll("input, textarea")].some((el) => el.value.includes(value))) out.push("a form field");
      for (let i = 0; i < localStorage.length; i++) if ((localStorage.getItem(localStorage.key(i)) ?? "").includes(value)) out.push(`localStorage ${localStorage.key(i)}`);
      for (let i = 0; i < sessionStorage.length; i++) if ((sessionStorage.getItem(sessionStorage.key(i)) ?? "").includes(value)) out.push(`sessionStorage ${sessionStorage.key(i)}`);
      const text = (v, depth = 0) => {
        if (typeof v === "string") return v;
        if (v instanceof ArrayBuffer) return new TextDecoder("latin1").decode(v);
        if (ArrayBuffer.isView(v)) return new TextDecoder("latin1").decode(v);
        if (v && typeof v === "object" && depth < 8) return Object.entries(v).map(([k, x]) => `${k} ${text(x, depth + 1)}`).join(" ");
        return String(v);
      };
      const db = await new Promise((resolve, reject) => { const o = indexedDB.open("autoflow"); o.onsuccess = () => resolve(o.result); o.onerror = () => reject(o.error); });
      for (const name of db.objectStoreNames) {
        const all = await new Promise((resolve, reject) => { const q = db.transaction(name).objectStore(name).getAll(); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); });
        if (all.some((v) => text(v).includes(value))) out.push(`IndexedDB ${name}`);
      }
      db.close();
      return out;
    }, VALUE);
    assert(leaks.length === 0, `the secret value is readable in: ${leaks.join(", ")}`);

    await row.getByRole("button", { name: `Delete ${NAME}` }).click();
    const confirm = dialog(`Delete secret “${NAME}”?`);
    await confirm.getByText("Flows that use it will fail until you set it again.").waitFor();
    await confirm.getByRole("button", { name: "Delete" }).click();
    await toast(`Secret “${NAME}” deleted.`).first().waitFor();
    await row.waitFor({ state: "detached" });
    await missingRow(NAME).waitFor();
    step("Secrets: added and listed with “Used by”, value nowhere in the DOM or in clear storage, unset names under “missing”, deleted after confirm");
  });

  // --- 9. Backup → delete → restore ------------------------------------------------------------
  await section("9 backup", async () => {
    const victim = await flowByName("Form Lab");
    assert(victim?.folder === "Work", "section 6 must have put “Form Lab” into the folder “Work”");
    const before = await idb("flows");
    await go("/settings");
    const data = page.locator("section.card").filter({ has: page.getByRole("heading", { name: "Your data" }) });
    const [dl] = await Promise.all([page.waitForEvent("download"), data.getByRole("button", { name: "Export everything" }).click()]);
    assert(/\.json$/.test(dl.suggestedFilename()), `backup file name: ${dl.suggestedFilename()}`);
    const chunks = [];
    for await (const chunk of await dl.createReadStream()) chunks.push(chunk);
    const buffer = Buffer.concat(chunks); // kept in memory: the restore below gets the very bytes that were downloaded
    const backup = JSON.parse(buffer.toString("utf8"));
    assert(Array.isArray(backup.flows) && backup.flows.length === before.length, `the backup should hold all ${before.length} flows, has ${backup.flows?.length}`);
    assert(backup.flows.find((f) => f.id === victim.id)?.folder === "Work", "the backup should keep the flow's folder");

    await go("/flows");
    await card("Form Lab").getByRole("button", { name: "More actions" }).click();
    await page.locator(".modal").getByRole("button", { name: "Delete" }).click();
    await dialog("Delete this flow?").getByRole("button", { name: "Delete" }).click();
    await card("Form Lab").waitFor({ state: "detached" });
    assert(!(await flowByName("Form Lab")), "the flow should be deleted");
    assert((await page.getByRole("group", { name: "Folders" }).count()) === 0, "with its only flow gone the folder chips should disappear");

    await go("/settings");
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), data.getByRole("button", { name: "Restore backup" }).click()]);
    await chooser.setFiles({ name: dl.suggestedFilename(), mimeType: "application/json", buffer });
    await dialog("Already in your library").getByRole("button", { name: "Replace" }).click();
    await dialog("Apply the settings from this backup?").getByRole("button", { name: "Keep mine" }).click();
    await toast(`Restored ${before.length} flows from the backup.`).first().waitFor();
    const after = await idb("flows");
    const restored = after.find((f) => f.name === "Form Lab");
    assert(restored?.folder === "Work", `the restored flow should be back in its folder, got ${JSON.stringify(restored?.folder)}`);
    assert(JSON.stringify(restored.steps) === JSON.stringify(victim.steps), "the restored flow should have the same steps");
    assert(after.length === before.length, `“Replace” should not duplicate flows: ${before.length} before, ${after.length} after`);
    await go("/flows");
    await page.getByRole("group", { name: "Folders" }).getByRole("button", { name: "Work · 1" }).click();
    await card("Form Lab").waitFor();
    assert((await page.locator(".flow-card").count()) === 1, "the folder should hold the restored flow");
    await go("/flows");
    step("Backup: downloaded from Settings, flow deleted, backup restored → the flow is back in its folder (no duplicates)");
  });

  // --- 10. Phone viewport --------------------------------------------------------------------------
  await section("10 phone", async () => {
    const flow = await flowByName("Partial Lab");
    assert(flow?.steps.length === 4, "section 4 must have created “Partial Lab” with four steps");
    const run = (await runsOf(flow.id)).pop();
    await page.setViewportSize(PHONE);
    const shot = async (name) => {
      await clearToasts();
      await page.screenshot({ path: join(SHOTS, `phone-${name}.png`) });
    };

    await go("/");
    await page.locator("nav.mobile-nav").waitFor();
    await page.locator("main h1, main h2").first().waitFor();
    assert(!(await page.locator("aside.sidebar").isVisible()), "the sidebar should be hidden on a phone");
    await noHScroll("Home");
    await shot("home");

    await go("/flows");
    await card("Partial Lab").waitFor();
    await noHScroll("Library");
    await shot("library");
    await card("Partial Lab").getByRole("button", { name: "More actions" }).click();
    const more = page.locator(".modal");
    await more.getByRole("button", { name: "Move to folder…" }).waitFor();
    assert((await more.getByRole("button").allInnerTexts()).filter(Boolean).map((x) => x.trim()).join("|") === "Run|Rename|Duplicate|Move to folder…|Share link|Export file|Delete", "the “more” sheet should offer every flow action");
    await noHScroll("Library with the “more” sheet");
    await shot("library-more");
    await page.keyboard.press("Escape");
    await more.waitFor({ state: "detached" });

    await openFlow(flow.id);
    assert(!(await page.locator("aside.palette").isVisible()), "the step palette should be hidden on a phone");
    await noHScroll("Editor");
    await shot("editor");
    // The + menu is the only way to add a step here: search the full catalogue for a type that is not in the shortlist.
    await page.locator(".flow-col .connector button.add").first().click();
    const quick = page.getByRole("dialog", { name: "Add step" });
    await quick.getByLabel("Search steps").fill("clipboard");
    await quick.getByRole("button", { name: "Clipboard" }).waitFor();
    assert((await quick.locator(".palette-item").count()) === 1, "searching the + menu should narrow the catalogue to the match");
    await noHScroll("Editor with the + menu");
    await shot("editor-add-step");
    await quick.getByRole("button", { name: "Clipboard" }).click();
    const added = await until(async () => (await nodeIds()).find((x) => !flow.steps.some((s) => s.id === x)), "the step added through the + menu");
    const rest = flow.steps.map((s) => s.id);
    assert((await nodeIds()).join() === [added, ...rest].join(), "the first + adds the step at the top");
    await page.locator("aside.inspector.open").waitFor();
    await page.locator(`.flow-col [data-step-id="${added}"].selected`).waitFor();
    const up = inspector().getByRole("button", { name: "Move up" });
    const down = inspector().getByRole("button", { name: "Move down" });
    assert((await up.isDisabled()) && (await down.isEnabled()), "the first step can only move down");
    await down.click();
    await until(async () => (await nodeIds()).join() === [rest[0], added, ...rest.slice(1)].join(), "the step one place further down");
    assert(await up.isEnabled(), "after moving down the step can move up");
    await noHScroll("Editor with the inspector sheet");
    await shot("editor-inspector");
    await up.click();
    await until(async () => (await nodeIds()).join() === [added, ...rest].join(), "the step back at the top");
    await savedFlow(flow.id, (f) => f.steps.length === 5 && f.steps[0].id === added && f.steps[0].type === "clipboard", "the added step first");
    await inspector().getByRole("button", { name: "Close" }).first().click();
    await page.locator("aside.inspector.open").waitFor({ state: "detached" });

    await go("/ledger");
    await page.locator("table tbody tr").first().waitFor();
    await noHScroll("Ledger");
    await shot("ledger");
    if (run) {
      await go(`/ledger/${run.id}`);
      await page.locator(".event.span").first().waitFor();
      await noHScroll("Ledger run detail");
      await shot("ledger-run");
    }

    await go("/settings");
    await page.getByRole("heading", { name: "Secrets" }).waitFor();
    await noHScroll("Settings");
    await shot("settings");
    await page.setViewportSize(DESKTOP);
    step("Phone 390×844: + menu search adds a step, Move down / Move up, library “more” sheet, no horizontal scroll on Home, Library, Editor, Ledger, Settings");
  });

  // --- 11. Every route of src/app/App.tsx ----------------------------------------------------------
  await section("11 routes", async () => {
    const flow = (await flowByName("Partial Lab")) ?? (await idb("flows"))[0];
    const run = (await idb("runs"))[0];
    const routes = [
      ["/", /#\/$/], ["/flows", /#\/flows$/], [`/flows/${flow.id}`, /#\/flows\/f_/], ["/new/record", /#\/new\/record$/], ["/canvas", /#\/canvas$/], ["/stage", /#\/stage$/],
      ["/ledger", /#\/ledger$/], [`/ledger/${run.id}`, /#\/ledger\/./], ["/atlas", /#\/atlas$/], ["/atlas/form-filler", /#\/atlas\/form-filler$/], ["/keyforge", /#\/keyforge$/], ["/keyforge/none", /#\/keyforge/],
      ["/copilot", /#\/copilot$/], ["/studio", /#\/studio$/], ["/fleet", /#\/fleet$/], ["/settings", /#\/settings$/], ["/business", /#\/business$/], ["/admin", /#\/admin$/],
      ["/billing/return", /#\/billing\/return$/], ["/import", /#\/import$/], ["/welcome", /#\/welcome$/], ["/no-such-page", /#\/$/],
    ];
    const bad = [];
    for (const [route, expectUrl] of routes) {
      await go(route);
      try {
        await page.waitForURL(expectUrl, { timeout: 5000 });
        await page.locator(".page-loading").waitFor({ state: "detached", timeout: 8000 });
        // Every page shows a heading (/import without a code: the "can't be imported" dialog), except the editor
        // (its title is the name field) and the Practice Canvas: there the content of <main> counts.
        if (/^\/(flows\/|canvas)/.test(route)) await page.locator("main#main:visible > *").first().waitFor({ timeout: 8000 });
        else await page.locator("h1:visible, h2:visible").first().waitFor({ timeout: 8000 });
        if (route !== "/welcome") await page.locator("main#main").waitFor({ state: "attached", timeout: 5000 });
      } catch (e) {
        const shot = join(SHOTS, `fail-route${route.replace(/[^a-z0-9]+/gi, "-")}.png`);
        await page.screenshot({ path: shot }).catch(() => undefined);
        bad.push(`${route}: ${String(e.message).split("\n")[0]} (url ${page.url().split("#")[1]}, screenshot ${shot})`);
      }
      if (errors.length) bad.push(`${route}: console errors: ${errors.splice(0).join(" | ")}`);
    }
    assert(bad.length === 0, `routes that did not render cleanly:\n    ${bad.join("\n    ")}`);
    step(`Routes: all ${routes.length} routes (incl. /admin, /business, /stage, /keyforge, /copilot, /studio, /fleet, /atlas) render their page (heading / main) without console errors`);
  });

  // --- 13. Top bar layout (not on the 1.2.0 list: added because the route check above found the Practice Canvas
  // title collapsed to zero width at 1400 px, and the phone screenshots showed the editor's Run button cut off).
  // Every control of the top bar must be on screen and clickable, on the desktop and on the phone. ---
  await section("13 top bar", async () => {
    const flow = (await flowByName("Partial Lab")) ?? (await idb("flows")).find((f) => f.mode === "pro");
    const easy = (await idb("flows")).find((f) => f.mode === "easy");
    const run = (await idb("runs"))[0];
    const pages = [["Home", "/"], ["Library", "/flows"], ["Pro editor", `/flows/${flow.id}`], ["Easy editor", `/flows/${easy.id}`], ["Practice Canvas", "/canvas"], ["Stage", "/stage"], ["Ledger", "/ledger"], ["Ledger run", `/ledger/${run.id}`], ["Settings", "/settings"]];
    const bad = [];
    for (const size of [DESKTOP, PHONE]) {
      await page.setViewportSize(size);
      for (const [name, route] of pages) {
        await go(route);
        await page.locator("main#main:visible > *").first().waitFor();
        await clearToasts(); // they float over the bar and are not part of the layout under test
        const covered = await page.evaluate(() => {
          const out = [];
          const label = (el) => (el.getAttribute("aria-label") || el.getAttribute("title") || el.innerText || el.value || el.tagName).trim().replace(/\s+/g, " ").slice(0, 40);
          // A switch is a visually hidden checkbox inside its label: the label is what gets clicked.
          for (const el of document.querySelectorAll("header.topbar :is(h2, input:not(.switch input), label.switch, select, button, a)")) {
            if (el.getClientRects().length === 0) continue; // display: none — hidden on purpose at this size
            const b = el.getBoundingClientRect();
            const tag = `<${el.tagName.toLowerCase()}> “${label(el)}”`;
            if (b.width < 1 || b.height < 1) {
              out.push(`${tag} has no width`);
              continue;
            }
            if (b.left >= window.innerWidth || b.right <= 0) {
              out.push(`${tag} is off screen (x ${Math.round(b.left)}–${Math.round(b.right)} of ${window.innerWidth}) and cannot be scrolled to`);
              continue;
            }
            const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
            if (top && (top === el || el.contains(top) || top.contains(el))) continue;
            const by = top?.closest("button, a, input, select, .badge, .seg") ?? top;
            out.push(`${tag} is ${by ? `covered by <${by.tagName.toLowerCase()}> “${label(by)}”` : `cut off at the edge (x ${Math.round(b.left)}–${Math.round(b.right)} of ${window.innerWidth})`}`);
          }
          return out;
        });
        if (covered.length) {
          const shot = join(SHOTS, `topbar-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${size.width}.png`);
          await page.screenshot({ path: shot, clip: { x: 0, y: 0, width: size.width, height: 200 } });
          bad.push(`${name} at ${size.width}×${size.height} (${shot}):\n      ${covered.join("\n      ")}`);
        }
      }
    }
    await page.setViewportSize(DESKTOP);
    assert(bad.length === 0, `top bar controls overlap or are cut off:\n    ${bad.join("\n    ")}`);
    step(`Top bar at ${DESKTOP.width}×${DESKTOP.height} and ${PHONE.width}×${PHONE.height}: every control is on screen and clickable on Home, Library, both editors, Canvas, Stage, Ledger, Settings`);
  });

  await page.goto(`${base}#/`);
  await page.locator("select[aria-label=Language]").first().selectOption("ko");
  await page.getByText("홈").first().waitFor();
  step("language switched to Korean");

  // --- 12. Korean: no raw i18n keys ---------------------------------------------------------------
  await section("12 korean", async () => {
    const source = readFileSync(new URL("../src/i18n/en.ts", import.meta.url), "utf8");
    const keys = [...source.matchAll(/^\s*"([^"\n]+)"\s*:/gm)].map((m) => m[1]);
    assert(keys.length > 1000 && keys.includes("nav.home") && keys.includes("secrets.title"), `could not read the key set from en.ts (${keys.length} keys)`);
    const namespaces = [...new Set(keys.map((k) => k.split(".")[0]))];
    /** Key-shaped tokens on the page: in text, and in the attributes users see or hear. */
    const scan = async (where) => {
      const found = await page.evaluate(({ keys, namespaces }) => {
        const known = new Set(keys);
        const ns = new Set(namespaces);
        const shape = /\b[a-z]+\.[a-zA-Z]+(\.[a-zA-Z]+)*\b/g;
        const out = [];
        const check = (text, kind) => {
          for (const m of text.matchAll(shape)) {
            if (known.has(m[0])) out.push(`${kind} “${m[0]}”`);
            // Not in en.ts but under one of its namespaces: a key that does not exist at all (t() echoes it).
            else if (ns.has(m[0].split(".")[0]) && !/\.(json|txt|exe|com|png|svg)$/.test(m[0])) out.push(`${kind} “${m[0]}” (not in en.ts)`);
          }
        };
        check(document.body.innerText, "text");
        for (const el of document.querySelectorAll("[aria-label], [title], [placeholder]")) for (const a of ["aria-label", "title", "placeholder"]) if (el.hasAttribute(a)) check(el.getAttribute(a), a);
        for (const o of document.querySelectorAll("option")) check(o.textContent ?? "", "option");
        return [...new Set(out)];
      }, { keys, namespaces });
      return found.map((x) => `${where}: ${x}`);
    };
    const flow = await flowByName("Form Lab");
    assert(flow, "“Form Lab” is missing (an earlier section failed)");
    const run = (await idb("runs")).sort((a, b) => b.startedAt - a.startedAt)[0];
    const hits = [];

    await go("/flows");
    await page.locator(".flow-card").first().waitFor();
    await page.getByRole("heading", { name: "플로우" }).first().waitFor();
    hits.push(...(await scan("Library")));
    await page.locator(".flow-card").first().locator("button[aria-haspopup=dialog]").click();
    await page.locator(".modal").waitFor();
    hits.push(...(await scan("Library “more” sheet")));
    await page.keyboard.press("Escape");
    await page.locator(".modal").waitFor({ state: "detached" });

    await openFlow(flow.id);
    hits.push(...(await scan("Editor")));
    await select(flow.steps[1].id); // the step with a timeout and “jump to step”
    await inspector().locator("select").first().waitFor();
    hits.push(...(await scan("Editor step form")));
    await page.locator('.flow-col [data-step-id="__flow"]').click();
    await inspector().locator("textarea").first().waitFor();
    hits.push(...(await scan("Editor flow settings")));
    await page.keyboard.press("?");
    await page.locator(".modal .shortcut-list").first().waitFor();
    hits.push(...(await scan("Editor shortcuts sheet")));
    await page.keyboard.press("Escape");
    await page.locator(".modal").waitFor({ state: "detached" });

    await go("/ledger");
    await page.locator("table tbody tr").first().waitFor();
    hits.push(...(await scan("Ledger")));
    await go(`/ledger/${run.id}`);
    await page.locator(".event.span").first().waitFor();
    hits.push(...(await scan("Ledger run (steps)")));
    await page.locator(".card .seg button").nth(1).click();
    await page.locator(".card .input-group input").waitFor();
    hits.push(...(await scan("Ledger run (log)")));

    await go("/settings");
    await page.locator("section.card .secret-row, section.card .callout.warn").first().waitFor();
    hits.push(...(await scan("Settings")));

    assert(hits.length === 0, `raw i18n keys visible in Korean:\n    ${hits.join("\n    ")}`);
    step("Korean: Library, Editor (step form, flow settings, shortcuts), Ledger (list, steps, log) and Settings show no raw i18n keys");
  });

  if (errors.length) await fail(`console errors: ${errors.join(" | ")}`);
  if (failures.length) {
    console.error(`SMOKE FAILED: ${failures.length} section(s) failed: ${failures.join(", ")}`);
    await browser.close();
    server?.kill();
    process.exit(1);
  }
  console.log("SMOKE OK");
} catch (e) {
  await fail(String(e));
}
await browser.close();
server?.kill();
