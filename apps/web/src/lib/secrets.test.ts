import { describe, expect, it } from "vitest";
import type { Flow } from "@autoflow/core";
import { SECRET_NAME, deleteSecret, listSecrets, secretNamesInFlow, secretNamesInText, secretUsage, setSecret } from "./secrets";
import { vault } from "./crypto";

const steps = (list: unknown[]) => ({ steps: list as Flow["steps"] });

describe("secret scanning", () => {
  it("finds references with optional spaces and ignores look-alikes", () => {
    expect([...secretNamesInText("{{secret:a}} {{ secret: b_2 }} {{secret:a}}")]).toEqual(["a", "b_2"]);
    expect([...secretNamesInText("{{var}} {{secret}} {{secret:}} {{secrets:x}} {secret:y} {{secret:bad-name}}")]).toEqual([]);
  });

  it("walks every string field of every step, nested steps included", () => {
    const flow = steps([
      { id: "s1", type: "type", text: "user {{secret:login}}" },
      { id: "s2", type: "http", url: "https://x.test/{{secret:path}}", headers: { Authorization: "Bearer {{secret:http_authorization}}" }, body: "{}" },
      {
        id: "s3",
        type: "if",
        condition: { expr: "'{{secret:in_condition}}' != ''" },
        then: [{ id: "s4", type: "loop", body: [{ id: "s5", type: "type", text: "{{secret:recorded_1}}{{secret:login}}" }] }],
        else: [{ id: "s6", type: "try", body: [], catch: [{ id: "s7", type: "clipboard", action: "write", value: "{{ secret:deep }}" }] }],
      },
    ]);
    expect(secretNamesInFlow(flow)).toEqual(["deep", "http_authorization", "in_condition", "login", "path", "recorded_1"]);
    expect(secretNamesInFlow(steps([]))).toEqual([]);
  });

  it("maps names to the flows that use them", () => {
    const a = { id: "f_a", ...steps([{ id: "s", type: "type", text: "{{secret:x}}{{secret:y}}" }]) };
    const b = { id: "f_b", ...steps([{ id: "s", type: "type", text: "{{secret:x}}" }]) };
    const u = secretUsage([a, b]);
    expect(u.get("x")!.map((f) => f.id)).toEqual(["f_a", "f_b"]);
    expect(u.get("y")!.map((f) => f.id)).toEqual(["f_a"]);
  });

  it("accepts only [A-Za-z0-9_]{1,40} as a name", () => {
    expect(SECRET_NAME.test("recorded_12")).toBe(true);
    expect(SECRET_NAME.test("a".repeat(40))).toBe(true);
    expect(SECRET_NAME.test("a".repeat(41))).toBe(false);
    expect(SECRET_NAME.test("ai:openai")).toBe(false);
    expect(SECRET_NAME.test("")).toBe(false);
  });
});

describe("secret storage in the browser (web vault only)", () => {
  it("lists names without AI keys, and never deletes or overwrites them", async () => {
    await vault.set("ai:openai", "sk-test");
    await setSecret("login", "hunter2");
    expect(await listSecrets()).toEqual(["login"]);
    expect(await vault.get("login")).toBe("hunter2");
    await expect(setSecret("ai:openai", "x")).rejects.toThrow();
    await deleteSecret("ai:openai");
    expect(await vault.get("ai:openai")).toBe("sk-test");
    await deleteSecret("login");
    expect(await listSecrets()).toEqual([]);
  });
});
