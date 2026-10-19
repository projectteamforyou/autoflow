// Writes every Atlas template as a JSON fixture shared by the Rust and Kotlin executors' tests.
import { mkdirSync, writeFileSync } from "node:fs";
import { TEMPLATES, explainFlowEn } from "../dist/index.js";
const dir = new URL("../fixtures/", import.meta.url);
mkdirSync(dir, { recursive: true });
for (const t of TEMPLATES) {
  writeFileSync(new URL(`${t.id}.json`, dir), JSON.stringify(t.flow, null, 2) + "\n");
}
writeFileSync(new URL("index.json", dir), JSON.stringify(TEMPLATES.map((t) => ({ id: t.id, category: t.category, platforms: t.platforms, explain: explainFlowEn(t.flow) })), null, 2) + "\n");
console.log(`wrote ${TEMPLATES.length} fixtures`);
