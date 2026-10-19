import { TEMPLATES } from "@autoflow/core";
import { describe, expect, it } from "vitest";
import { makeApp, sampleFlow, useTestDb, type TestApp } from "./helpers.js";

const db = useTestDb();

async function publish(t: TestApp, token: string, flow: Record<string, unknown>, category = "clicking") {
  return t.call("POST", "/v1/atlas/templates", { token, body: { flow, category } });
}

const highRiskFlow = () =>
  sampleFlow({
    name: "Order poster",
    steps: [{ id: "h", type: "http", method: "POST", url: "https://shop.example.com/checkout", body: "{}" }],
  });

describe("Atlas publishing", () => {
  it("re-validates, sanitizes and labels a published template", async () => {
    const t = makeApp(db);
    const u = await t.signup({ verified: true, displayName: "Maker" });
    const flow = sampleFlow({ name: "Atlas sample one", favorite: true, folder: "private/stuff", revision: 42 });
    (flow.steps as any[])[0].body[0].breakpoint = true;
    const r = await publish(t, u.token, flow);
    expect(r.status).toBe(201);
    const tpl = r.json.template;
    expect(tpl.id).toMatch(/^[0-9A-Za-z]{10}$/);
    expect(tpl).toMatchObject({ name: "Atlas sample one", category: "clicking", status: "published", author: { name: "Maker" }, installs: 0, rating: { average: null, count: 0 } });
    expect(tpl.risk).toEqual({ level: "low", score: 0, permissions: ["perm.input"] });
    expect(tpl.platforms).toEqual(["windows", "android", "web"]);
    // sanitizeForSharing removed private bits.
    expect(tpl.flow.favorite).toBe(false);
    expect(tpl.flow.folder).toBeUndefined();
    expect(tpl.flow.revision).toBe(0);
    expect(tpl.flow.steps[0].body[0].breakpoint).toBeUndefined();
    expect(tpl.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const dup = await publish(t, u.token, flow);
    expect(dup.status).toBe(409);
    expect(dup.json.error.code).toBe("duplicate");
  });

  it("rejects schema-invalid flows with issues", async () => {
    const t = makeApp(db);
    const u = await t.signup({ verified: true });
    const r = await publish(t, u.token, { schemaVersion: "1.0", name: "broken", steps: [{ id: "x", type: "teleport" }] });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("invalid_flow");
    expect(r.json.error.details.issues.length).toBeGreaterThan(0);

    const dupIds = await publish(t, u.token, sampleFlow({ steps: [{ id: "a", type: "wait", ms: 10 }, { id: "a", type: "wait", ms: 10 }] }));
    expect(dupIds.status).toBe(422);
    expect(JSON.stringify(dupIds.json.error.details)).toContain("duplicate step id");
  });

  it("rejects flows with lint errors", async () => {
    const t = makeApp(db);
    const u = await t.signup({ verified: true });
    const breakOutside = await publish(t, u.token, sampleFlow({ steps: [{ id: "b", type: "break" }] }));
    expect(breakOutside.status).toBe(422);
    expect(breakOutside.json.error.code).toBe("lint_failed");
    expect(breakOutside.json.error.details.issues[0].key).toBe("lint.breakOutsideLoop");

    const runsOther = await publish(t, u.token, sampleFlow({ steps: [{ id: "r", type: "runFlow", flowId: "my_private_flow" }] }));
    expect(runsOther.status).toBe(422);
    expect(runsOther.json.error.details.issues[0].key).toBe("lint.unknownFlow");

    // Warnings alone are fine and are reported back.
    const warn = await publish(t, u.token, sampleFlow({ name: "Warns", steps: [{ id: "l", type: "log", message: "{{ undefinedVar }}" }] }), "developer");
    expect(warn.status).toBe(201);
    expect(warn.json.warnings.map((w: { key: string }) => w.key)).toContain("lint.unknownVar");
  });

  it("holds high-risk templates for review and lists medium risk with permissions", async () => {
    const t = makeApp(db);
    const u = await t.signup({ verified: true });
    const high = await publish(t, u.token, highRiskFlow(), "developer");
    expect(high.status).toBe(201);
    expect(high.json.template.status).toBe("pending_review");
    expect(high.json.template.risk.level).toBe("high");
    expect(high.json.template.risk.permissions).toContain("perm.network");
    expect(high.json.template.needsConfirm).toBe(true);
    expect(high.json.template.riskFindings.map((f: { key: string }) => f.key)).toEqual(expect.arrayContaining(["risk.networkSend", "risk.sensitiveUrl"]));

    // Not visible to others, visible to the author.
    const other = await t.signup();
    expect((await t.call("GET", `/v1/atlas/templates/${high.json.template.id}`, { token: other.token })).status).toBe(404);
    expect((await t.call("GET", `/v1/atlas/templates/${high.json.template.id}`)).status).toBe(404);
    expect((await t.call("GET", `/v1/atlas/templates/${high.json.template.id}`, { token: u.token })).status).toBe(200);
    const mine = await t.call("GET", "/v1/atlas/templates/mine", { token: u.token });
    expect(mine.json.templates.map((x: { id: string }) => x.id)).toContain(high.json.template.id);

    const medium = await publish(t, u.token, sampleFlow({ name: "Cleanup", steps: [{ id: "f", type: "file", op: "delete", path: "C:/tmp/x.txt" }] }), "office");
    expect(medium.json.template.status).toBe("published");
    expect(medium.json.template.risk).toMatchObject({ level: "medium", permissions: ["perm.files"] });
  });

  it("requires a verified email and authentication to publish", async () => {
    const t = makeApp(db);
    expect((await publish(t, "", sampleFlow())).status).toBe(401);
    const u = await t.signup();
    const r = await publish(t, u.token, sampleFlow());
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe("email_not_verified");
    expect((await t.call("POST", "/v1/atlas/templates", { token: u.token, body: { flow: sampleFlow(), category: "not-a-category" } })).status).toBe(400);
  });

  it("caps templates per author and rate-limits publishing", async () => {
    const t = makeApp(db, { limits: { atlas: { maxPerAuthor: 1 } } });
    const u = await t.signup({ verified: true });
    expect((await publish(t, u.token, sampleFlow({ name: "Cap 1" }))).status).toBe(201);
    expect((await publish(t, u.token, sampleFlow({ name: "Cap 2" }))).status).toBe(403);

    const t2 = makeApp(db, { limits: { rate: { publish: { capacity: 1, refillPerMinute: 1 } } } });
    const v = await t2.signup({ verified: true });
    expect((await publish(t2, v.token, sampleFlow({ name: "RL 1" }))).status).toBe(201);
    expect((await publish(t2, v.token, sampleFlow({ name: "RL 2" }))).status).toBe(429);
  });

  it("lets the author unpublish", async () => {
    const t = makeApp(db);
    const u = await t.signup({ verified: true });
    const other = await t.signup();
    const r = await publish(t, u.token, sampleFlow({ name: "Unpublish me" }));
    const id = r.json.template.id;
    expect((await t.call("DELETE", `/v1/atlas/templates/${id}`, { token: other.token })).status).toBe(404);
    expect((await t.call("DELETE", `/v1/atlas/templates/${id}`, { token: u.token })).status).toBe(204);
    expect((await t.call("GET", `/v1/atlas/templates/${id}`)).status).toBe(404);
  });
});

describe("Atlas browsing", () => {
  it("lists, searches, filters, sorts and paginates published templates", async () => {
    const t = makeApp(db);
    const a = await t.signup({ verified: true });
    const tag = `zx${Date.now().toString(36)}`;
    const ids: Record<string, string> = {};
    for (const [name, category, targets] of [
      [`${tag} alpha clicker`, "clicking", ["windows"]],
      [`${tag} beta typer`, "keyboard", ["android", "web"]],
      [`${tag} gamma helper`, "clicking", ["android"]],
    ] as const) {
      const r = await publish(t, a.token, sampleFlow({ name, targets }), category);
      expect(r.status).toBe(201);
      ids[name.split(" ")[1]!] = r.json.template.id;
    }

    const byQ = await t.call("GET", `/v1/atlas/templates?q=${tag}`);
    expect(byQ.status).toBe(200);
    expect(byQ.json.total).toBe(3);
    expect(byQ.json.templates[0].flow).toBeUndefined();

    const partial = await t.call("GET", `/v1/atlas/templates?q=${encodeURIComponent(`${tag} gam`)}`);
    expect(partial.json.templates.map((x: { id: string }) => x.id)).toEqual([ids.gamma]);

    const cat = await t.call("GET", `/v1/atlas/templates?q=${tag}&category=clicking`);
    expect(cat.json.total).toBe(2);
    const plat = await t.call("GET", `/v1/atlas/templates?q=${tag}&platform=android`);
    expect(plat.json.templates.map((x: { id: string }) => x.id).sort()).toEqual([ids.beta, ids.gamma].sort());

    const newest = await t.call("GET", `/v1/atlas/templates?q=${tag}&sort=new`);
    expect(newest.json.templates[0].id).toBe(ids.gamma);

    // Installs drive "popular".
    for (let i = 0; i < 3; i++) await t.call("POST", `/v1/atlas/templates/${ids.beta}/install`, { ip: `198.18.0.${i}` });
    const popular = await t.call("GET", `/v1/atlas/templates?q=${tag}&sort=popular`);
    expect(popular.json.templates[0].id).toBe(ids.beta);
    expect(popular.json.templates[0].installs).toBe(3);

    const p1 = await t.call("GET", `/v1/atlas/templates?q=${tag}&sort=new&pageSize=2&page=1`);
    const p2 = await t.call("GET", `/v1/atlas/templates?q=${tag}&sort=new&pageSize=2&page=2`);
    expect(p1.json.templates).toHaveLength(2);
    expect(p2.json.templates).toHaveLength(1);
    expect(p2.json.total).toBe(3);

    // LIKE wildcards in q are literal.
    expect((await t.call("GET", "/v1/atlas/templates?q=%25%25%25")).json.total).toBe(0);
    expect((await t.call("GET", "/v1/atlas/templates?sort=random")).status).toBe(400);
    expect((await t.call("GET", "/v1/atlas/templates?pageSize=500")).status).toBe(400);

    const detail = await t.call("GET", `/v1/atlas/templates/${ids.alpha}`);
    expect(detail.json.template.flow.name).toBe(`${tag} alpha clicker`);
    expect((await t.call("GET", "/v1/atlas/templates/doesnotexi")).status).toBe(404);
    expect((await t.call("GET", "/v1/atlas/templates/bad")).status).toBe(404);
  });

  it("counts installs once per signed-in user", async () => {
    const t = makeApp(db);
    const a = await t.signup({ verified: true });
    const b = await t.signup();
    const id = (await publish(t, a.token, sampleFlow({ name: "Install counter" }))).json.template.id;
    const first = await t.call("POST", `/v1/atlas/templates/${id}/install`, { token: b.token });
    expect(first.json.installs).toBe(1);
    expect(first.json.flow.name).toBe("Install counter");
    expect((await t.call("POST", `/v1/atlas/templates/${id}/install`, { token: b.token })).json.installs).toBe(1);
    expect((await t.call("POST", `/v1/atlas/templates/${id}/install`)).json.installs).toBe(2);
  });

  it("serves official templates from @autoflow/core read-only", async () => {
    const t = makeApp(db);
    const r = await t.call("GET", "/v1/atlas/official");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toContain("public");
    expect(r.json.templates).toHaveLength(TEMPLATES.length);
    expect(r.json.templates[0]).toMatchObject({ id: TEMPLATES[0]!.id, author: "AutoFlow", nameKey: `tpl.${TEMPLATES[0]!.id}.name` });
    expect(r.json.templates[0].risk.permissions).toContain("perm.input");
    const one = await t.call("GET", `/v1/atlas/official/${TEMPLATES[0]!.id}`);
    expect(one.json.template.flow.id).toBe(TEMPLATES[0]!.flow.id);
    expect((await t.call("GET", "/v1/atlas/official/nope")).status).toBe(404);
    expect((await t.call("POST", "/v1/atlas/official")).status).toBe(404);
    expect((await t.call("GET", "/v1/atlas/categories")).json.categories).toContain("wellbeing");
  });
});

describe("Atlas ratings, reports and moderation", () => {
  it("rates 1–5, one rating per user, updatable, not on own templates", async () => {
    const t = makeApp(db);
    const author = await t.signup({ verified: true });
    const r1 = await t.signup();
    const r2 = await t.signup();
    const id = (await publish(t, author.token, sampleFlow({ name: "Rate me" }))).json.template.id;

    expect((await t.call("PUT", `/v1/atlas/templates/${id}/rating`, { token: r1.token, body: { stars: 6 } })).status).toBe(400);
    expect((await t.call("PUT", `/v1/atlas/templates/${id}/rating`, { token: r1.token, body: { stars: 0 } })).status).toBe(400);
    expect((await t.call("PUT", `/v1/atlas/templates/${id}/rating`, { token: author.token, body: { stars: 5 } })).status).toBe(403);
    expect((await t.call("PUT", `/v1/atlas/templates/${id}/rating`, { body: { stars: 5 } })).status).toBe(401);

    expect((await t.call("PUT", `/v1/atlas/templates/${id}/rating`, { token: r1.token, body: { stars: 5 } })).json).toEqual({ stars: 5, average: 5, count: 1 });
    expect((await t.call("PUT", `/v1/atlas/templates/${id}/rating`, { token: r2.token, body: { stars: 2 } })).json).toEqual({ stars: 2, average: 3.5, count: 2 });
    expect((await t.call("PUT", `/v1/atlas/templates/${id}/rating`, { token: r1.token, body: { stars: 3 } })).json).toEqual({ stars: 3, average: 2.5, count: 2 });
    expect((await t.call("GET", `/v1/atlas/templates/${id}/rating`, { token: r2.token })).json.stars).toBe(2);
    expect((await t.call("GET", `/v1/atlas/templates/${id}`)).json.template.rating).toEqual({ average: 2.5, count: 2 });
  });

  it("auto-hides after N distinct reports and lets an admin restore or remove", async () => {
    const t = makeApp(db, { limits: { atlas: { reportHideThreshold: 2 } } });
    const author = await t.signup({ verified: true });
    const id = (await publish(t, author.token, sampleFlow({ name: "Report me" }))).json.template.id;
    const [a, b] = [await t.signup(), await t.signup()];

    expect((await t.call("POST", `/v1/atlas/templates/${id}/reports`, { token: a.token, body: { reason: "bogus" } })).status).toBe(400);
    expect((await t.call("POST", `/v1/atlas/templates/${id}/reports`, { token: author.token, body: { reason: "spam" } })).status).toBe(403);
    expect((await t.call("POST", `/v1/atlas/templates/${id}/reports`, { token: a.token, body: { reason: "malicious", details: "clicks buy buttons" } })).status).toBe(202);
    expect((await t.call("POST", `/v1/atlas/templates/${id}/reports`, { token: a.token, body: { reason: "spam" } })).status).toBe(409);
    expect((await t.call("GET", `/v1/atlas/templates/${id}`)).status).toBe(200);
    expect((await t.call("POST", `/v1/atlas/templates/${id}/reports`, { token: b.token, body: { reason: "cheating" } })).status).toBe(202);

    // Hidden: gone from public views, still visible to the author.
    expect((await t.call("GET", `/v1/atlas/templates/${id}`)).status).toBe(404);
    expect((await t.call("GET", "/v1/atlas/templates?q=Report%20me")).json.total).toBe(0);
    expect((await t.call("POST", `/v1/atlas/templates/${id}/install`)).status).toBe(404);
    expect((await t.call("GET", `/v1/atlas/templates/${id}`, { token: author.token })).json.template.status).toBe("hidden");

    // Moderation is admin-only.
    expect((await t.call("GET", "/v1/admin/atlas/queue", { token: a.token })).status).toBe(403);
    const admin = await t.signup();
    await db.sql`UPDATE users SET role = 'admin' WHERE id = ${admin.user.id}`;
    const queue = await t.call("GET", "/v1/admin/atlas/queue", { token: admin.token });
    const entry = queue.json.queue.find((e: { template: { id: string } }) => e.template.id === id);
    expect(entry).toMatchObject({ pendingReports: 2, reasons: { malicious: 1, cheating: 1 } });
    expect((await t.call("GET", `/v1/atlas/templates/${id}`, { token: admin.token })).status).toBe(200);

    expect((await t.call("POST", `/v1/admin/atlas/templates/${id}/moderate`, { token: admin.token, body: { action: "approve" } })).status).toBe(200);
    expect((await t.call("GET", `/v1/atlas/templates/${id}`)).status).toBe(200);
    const after = await t.call("GET", "/v1/admin/atlas/queue", { token: admin.token });
    expect(after.json.queue.find((e: { template: { id: string } }) => e.template.id === id)).toBeUndefined();

    // Approving pending_review high-risk templates publishes them; remove takes them down.
    const high = (await publish(t, author.token, highRiskFlow(), "developer")).json.template.id;
    expect((await t.call("POST", `/v1/admin/atlas/templates/${high}/moderate`, { token: admin.token, body: { action: "approve" } })).status).toBe(200);
    expect((await t.call("GET", `/v1/atlas/templates/${high}`)).json.template.status).toBe("published");
    expect((await t.call("POST", `/v1/admin/atlas/templates/${high}/moderate`, { token: admin.token, body: { action: "remove" } })).status).toBe(200);
    expect((await t.call("GET", `/v1/atlas/templates/${high}`)).status).toBe(404);
  });
});
