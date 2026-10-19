// Live account + E2E sync check through the UI: sign up, unlock sync, sync a flow, delete the account.
// Usage: node scripts/smoke-sync.mjs https://autoflow-651.pages.dev/app/
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
const base = process.argv[2];
const exe = ["/opt/pw-browsers/chromium/chrome-linux/chrome", process.env.CHROME_PATH].find((p) => p && existsSync(p));
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const email = `smoke+${Date.now()}@example.com`;
const pw = "Correct-Horse-9-Battery";
try {
  await page.goto(`${base}#/welcome`);
  await page.getByRole("button", { name: "Skip intro" }).click();
  await page.goto(`${base}#/atlas/auto-clicker`);
  await page.getByRole("button", { name: "Add to my flows" }).click();
  await page.waitForURL(/#\/flows\//);
  await page.goto(`${base}#/settings`);
  await page.getByRole("button", { name: "Create account" }).first().click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(pw);
  await page.locator("form .btn.primary").click();
  await page.getByText(`Signed in as ${email}`).waitFor({ timeout: 15000 });
  console.log("✓ signed up");
  await page.getByRole("button", { name: "Turn on sync" }).click();
  await page.locator(".modal input[type=password]").fill("my long sync passphrase");
  await page.getByRole("button", { name: "Unlock sync" }).last().click();
  await page.getByRole("button", { name: "Sync now" }).click();
  await page.getByText(/Synced: 1 up/).waitFor({ timeout: 20000 });
  console.log("✓ encrypted sync uploaded 1 flow");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete account" }).click();
  await page.locator(".modal input[type=password]").fill(pw);
  await page.locator(".modal-foot .btn.danger").click();
  await page.getByText("Account deleted.").waitFor({ timeout: 15000 });
  console.log("✓ account deleted");
  if (errors.length) throw new Error(errors.join(" | "));
  console.log("SYNC SMOKE OK");
} catch (e) {
  console.error("✗", e.message);
  await page.screenshot({ path: "smoke-sync-failure.png" });
  process.exitCode = 1;
}
await browser.close();
