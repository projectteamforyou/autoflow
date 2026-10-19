/** /v1/ai — optional Copilot relay to allow-listed providers with the user's own key. */
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../deps.js";
import { ApiError } from "../errors.js";
import { enforce, parseJson, requireAuth } from "../lib/http.js";
import { PROVIDER_KEY_PATTERN, RELAY_PROVIDERS, RELAY_PROVIDER_NAMES, relay } from "../services/relay.js";

const RelayBody = z.object({
  provider: z.string().max(32),
  path: z.string().min(1).max(200),
  body: z.record(z.unknown()),
});

export function aiRoutes() {
  const r = new Hono<AppEnv>();

  r.get("/providers", (c) =>
    c.json({
      providers: RELAY_PROVIDER_NAMES.map((name) => ({ name, host: new URL(RELAY_PROVIDERS[name].origin).host, paths: RELAY_PROVIDERS[name].paths.map((p) => p.source) })),
    }),
  );

  r.post("/relay", async (c) => {
    const a = requireAuth(c);
    const deps = c.get("deps");
    await enforce(deps.limiters.relay, `relay:${a.user.id}`);
    const key = c.req.header("x-provider-key");
    if (!key || !PROVIDER_KEY_PATTERN.test(key)) throw new ApiError(400, "bad_request", "X-Provider-Key header with your provider API key is required");
    const body = await parseJson(c, RelayBody);
    const result = await relay(deps, body, key, a.user.id);
    return c.json({ upstream: result });
  });

  return r;
}
