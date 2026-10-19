// Keeps the Windows app's CSP connect-src in sync with the shared AI provider catalog.
// Run after changing packages/core/src/ai-providers.ts:  node scripts/sync-desktop-csp.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { AI_PROVIDERS } from "../packages/core/dist/index.js";
const file = new URL("../apps/desktop/src-tauri/tauri.conf.json", import.meta.url);
const conf = JSON.parse(readFileSync(file, "utf8"));
const origins = new Set(["'self'", "ipc:", "http://ipc.localhost", "https://api.autoflowmacro.com"]);
for (const p of AI_PROVIDERS) {
  const u = new URL(p.baseUrl);
  origins.add(u.origin);
  if (u.hostname === "localhost") origins.add(`${u.protocol}//127.0.0.1:${u.port}`);
}
conf.app.security.csp["connect-src"] = [...origins].join(" ");
writeFileSync(file, JSON.stringify(conf, null, 2) + "\n");
console.log(`connect-src: ${origins.size} sources`);
