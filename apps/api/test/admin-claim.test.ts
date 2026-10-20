import { describe, expect, it } from "vitest";
import { makeApp, useTestDb } from "./helpers.js";

const db = useTestDb();
const CODE = "setup-code-0123456789abcdefghij";
let n = 0;
const app = (code?: string) => makeApp(db, { adminEmails: [`claim${++n}@example.com`], adminSetupCode: code });

describe("POST /v1/me/admin-claim", () => {
  it("verifies an operator account that presents the setup code", async () => {
    const t = app(CODE);
    const op = await t.signup({ email: t.config.adminEmails[0] });
    expect((await t.call("GET", "/v1/admin/billing/settings", { token: op.token })).status).toBe(403);
    const r = await t.call("POST", "/v1/me/admin-claim", { token: op.token, body: { code: CODE } });
    expect(r.status, r.text).toBe(200);
    expect(r.json.user.isAdmin).toBe(true);
    expect((await t.call("GET", "/v1/admin/billing/settings", { token: op.token })).status).toBe(200);
  });

  it("refuses a wrong code, a non-operator email, or a deployment without a code", async () => {
    const t = app(CODE);
    const op = await t.signup({ email: t.config.adminEmails[0] });
    expect((await t.call("POST", "/v1/me/admin-claim", { token: op.token, body: { code: CODE + "x" } })).status).toBe(403);
    const other = await t.signup();
    expect((await t.call("POST", "/v1/me/admin-claim", { token: other.token, body: { code: CODE } })).status).toBe(403);
    const t2 = app(undefined);
    const op2 = await t2.signup({ email: t2.config.adminEmails[0] });
    expect((await t2.call("POST", "/v1/me/admin-claim", { token: op2.token, body: { code: CODE } })).status).toBe(403);
  });
});
