// End-to-end smoke test of the built PWA in Chromium.
// Usage: pnpm --filter @autoflow/web build && node scripts/smoke.mjs [--url http://localhost:4191/]
// Verifies: onboarding, creating an Easy flow, running it on the Practice Canvas until completion,
// the run landing in the Ledger, Pro mode editing, Atlas install, language switching, and no console errors.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const argUrl = process.argv.includes("--url") ? process.argv[process.argv.indexOf("--url") + 1] : null;
const port = 4199;
let server;
if (!argUrl) {
  server = spawn("npx", ["vite", "preview", "--port", String(port), "--strictPort"], { cwd: new URL("..", import.meta.url).pathname, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 2500));
}
const base = argUrl ?? `http://localhost:${port}/`;
const exe = ["/opt/pw-browsers/chromium/chrome-linux/chrome", process.env.CHROME_PATH].find((p) => p && existsSync(p));
const browser = await chromium.launch(exe ? { executablePath: exe } : { channel: "chromium" });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text()) && errors.push(m.text()));
const step = (name) => console.log(`✓ ${name}`);
const fail = async (msg) => {
  console.error(`✗ ${msg}`);
  await page.screenshot({ path: "smoke-failure.png" }).catch(() => undefined);
  await browser.close();
  server?.kill();
  process.exit(1);
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

  await page.goto(`${base}#/`);
  await page.locator("select[aria-label=Language]").first().selectOption("ko");
  await page.getByText("홈").first().waitFor();
  step("language switched to Korean");

  if (errors.length) await fail(`console errors: ${errors.join(" | ")}`);
  console.log("SMOKE OK");
} catch (e) {
  await fail(String(e));
}
await browser.close();
server?.kill();
