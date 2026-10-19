/** /v1/me — profile, GDPR export and account deletion. */
import { Hono } from "hono";
import { z } from "zod";
import { USAGE_TYPES } from "@autoflow/core";
import type { AppEnv } from "../deps.js";
import { enforce, parseJson, requireAuth } from "../lib/http.js";
import { errors } from "../errors.js";
import { safeEqual, sha256Hex } from "../lib/crypto.js";
import * as users from "../db/users.js";
import { toPublicUser } from "../services/auth.js";
import * as account from "../services/account.js";
import { LocaleSchema } from "./auth.js";

const PatchBody = z
  .object({ displayName: z.string().trim().min(1).max(60).nullable().optional(), locale: LocaleSchema.optional(), usageType: z.enum(USAGE_TYPES).optional() })
  .refine((v) => v.displayName !== undefined || v.locale !== undefined || v.usageType !== undefined, { message: "Nothing to update" });
const DeleteBody = z.object({ password: z.string().min(1).max(1024) });
const ClaimBody = z.object({ code: z.string().min(1).max(256) });

export function meRoutes() {
  const r = new Hono<AppEnv>();

  r.get("/", (c) => c.json({ user: toPublicUser(requireAuth(c).user, c.get("deps").config.adminEmails) }));

  r.patch("/", async (c) => {
    const a = requireAuth(c);
    const body = await parseJson(c, PatchBody);
    const deps = c.get("deps");
    const user = await account.updateMe(deps, a, body);
    return c.json({ user: toPublicUser(user, deps.config.adminEmails) });
  });

  /** Operator bootstrap without email: an ADMIN_EMAILS account proves ownership with ADMIN_SETUP_CODE. */
  r.post("/admin-claim", async (c) => {
    const a = requireAuth(c);
    const deps = c.get("deps");
    await enforce(deps.limiters.authAccount, `admin-claim:${a.user.id}`);
    const { code } = await parseJson(c, ClaimBody);
    const expected = deps.config.adminSetupCode;
    if (!expected || !deps.config.adminEmails.includes(a.user.emailNormalized) || !safeEqual(sha256Hex(code.trim()), sha256Hex(expected))) {
      throw errors.forbidden("Invalid setup code");
    }
    await users.markEmailVerified(deps.sql, a.user.id);
    const fresh = (await users.findUserById(deps.sql, a.user.id)) ?? a.user;
    return c.json({ user: toPublicUser(fresh, deps.config.adminEmails) });
  });

  r.get("/export", async (c) => {
    const a = requireAuth(c);
    const deps = c.get("deps");
    await enforce(deps.limiters.authAccount, `export:${a.user.id}`);
    const data = await account.exportData(deps, a);
    c.header("Content-Disposition", `attachment; filename="autoflow-export-${deps.now().toISOString().slice(0, 10)}.json"`);
    return c.json(data);
  });

  r.delete("/", async (c) => {
    const a = requireAuth(c);
    const deps = c.get("deps");
    await enforce(deps.limiters.authAccount, `delete:${a.user.id}`);
    const { password } = await parseJson(c, DeleteBody);
    await account.deleteAccount(deps, a, password);
    return c.body(null, 204);
  });

  return r;
}
