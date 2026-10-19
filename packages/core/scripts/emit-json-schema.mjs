// Emits dist/flow.schema.json so the Rust and Kotlin executors (and external tools) can validate flows.
import { writeFileSync } from "node:fs";
import { zodToJsonSchema } from "zod-to-json-schema";
import { FlowSchema } from "../dist/index.js";
const schema = zodToJsonSchema(FlowSchema, { name: "Flow", $refStrategy: "root" });
writeFileSync(new URL("../dist/flow.schema.json", import.meta.url), JSON.stringify(schema, null, 2));
console.log("wrote dist/flow.schema.json");
