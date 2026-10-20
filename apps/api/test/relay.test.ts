import { describe, expect, it, vi } from "vitest";
import { AI_PROVIDERS } from "@autoflow/core";
import { ALLOWED_RELAY_HOSTS, resolveUpstream } from "../src/services/relay.js";
import { createLogger } from "../src/logger.js";
import { makeApp, useTestDb } from "./helpers.js";

const db = useTestDb();
const KEY = "sk-test-0123456789abcdef";

function mockFetch(respond: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => respond(new URL(String(input)), init ?? {})) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("Copilot relay", () => {
  it("forwards to the allow-listed host with the per-request key and returns the upstream JSON", async () => {
    const fetchMock = mockFetch(() => new Response(JSON.stringify({ id: "msg_1", content: [{ type: "text", text: "hi" }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const t = makeApp(db, { fetch: fetchMock });
    const u = await t.signup();
    const r = await t.call("POST", "/v1/ai/relay", {
      token: u.token,
      headers: { "X-Provider-Key": KEY },
      body: { provider: "anthropic", path: "/v1/messages", body: { model: "claude-x", max_tokens: 10, messages: [{ role: "user", content: "hi" }] } },
    });
    expect(r.status).toBe(200);
    expect(r.json.upstream).toEqual({ status: 200, body: { id: "msg_1", content: [{ type: "text", text: "hi" }] } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
    const h = init.headers as Record<string, string>;
    expect(h["x-api-key"]).toBe(KEY);
    expect(h["anthropic-version"]).toBeDefined();
    expect(h.Authorization).toBeUndefined();
    expect(init.redirect).toBe("manual");
    expect(JSON.stringify(r.json)).not.toContain(KEY);
  });

  it("uses each provider's own auth header", async () => {
    const seen: Record<string, Record<string, string>> = {};
    const fetchMock = mockFetch((url, init) => {
      seen[url.host] = init.headers as Record<string, string>;
      return Response.json({ ok: true });
    });
    const t = makeApp(db, { fetch: fetchMock });
    const u = await t.signup();
    const calls = [
      { provider: "openai", path: "/v1/chat/completions" },
      { provider: "openrouter", path: "/api/v1/chat/completions" },
      { provider: "gemini", path: "/v1beta/models/gemini-2.0-flash:generateContent" },
    ];
    for (const c of calls) expect((await t.call("POST", "/v1/ai/relay", { token: u.token, headers: { "X-Provider-Key": KEY }, body: { ...c, body: {} } })).status).toBe(200);
    expect(seen["api.openai.com"]!.Authorization).toBe(`Bearer ${KEY}`);
    expect(seen["openrouter.ai"]!.Authorization).toBe(`Bearer ${KEY}`);
    expect(seen["generativelanguage.googleapis.com"]!["x-goog-api-key"]).toBe(KEY);
  });

  it("blocks unknown providers, non-allow-listed paths and SSRF tricks without calling out", async () => {
    const fetchMock = mockFetch(() => Response.json({}));
    const t = makeApp(db, { fetch: fetchMock });
    const u = await t.signup();
    const bad = [
      { provider: "evil", path: "/v1/messages" },
      { provider: "__proto__", path: "/v1/messages" },
      { provider: "constructor", path: "/v1/messages" },
      { provider: "openai", path: "/v1/files" },
      { provider: "openai", path: "//evil.example.com/v1/chat/completions" },
      { provider: "openai", path: "https://evil.example.com/v1/chat/completions" },
      { provider: "openai", path: "/v1/chat/completions/../../admin" },
      { provider: "openai", path: "/v1/chat/completions?x=1" },
      { provider: "openai", path: "/v1/chat/completions#frag" },
      { provider: "openai", path: "/v1/chat/%2e%2e/completions" },
      { provider: "openai", path: "@169.254.169.254/latest/meta-data" },
      { provider: "gemini", path: "/v1beta/models/../../x:generateContent" },
      { provider: "anthropic", path: "\\\\evil.example.com/v1/messages" },
    ];
    for (const b of bad) {
      const r = await t.call("POST", "/v1/ai/relay", { token: u.token, headers: { "X-Provider-Key": KEY }, body: { ...b, body: {} } });
      expect(r.status, JSON.stringify(b)).toBe(400);
      expect(r.json.error.code).toBe("provider_not_allowed");
    }
    // A base URL / host field is simply not part of the contract.
    const withHost = await t.call("POST", "/v1/ai/relay", { token: u.token, headers: { "X-Provider-Key": KEY }, body: { provider: "openai", path: "/v1/chat/completions", baseUrl: "http://127.0.0.1", body: {} } });
    expect(withHost.status).toBe(200);
    expect(String((fetchMock.mock.calls[0] as [URL])[0])).toBe("https://api.openai.com/v1/chat/completions");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("only ever resolves to cloud hosts from the shared provider catalog", () => {
    const expected = [...new Set(AI_PROVIDERS.filter((p) => !p.local).map((p) => new URL(p.baseUrl).host))].sort();
    expect([...ALLOWED_RELAY_HOSTS].sort()).toEqual(expected);
    expect(ALLOWED_RELAY_HOSTS).toEqual(expect.arrayContaining(["api.openai.com", "api.anthropic.com", "api.upstage.ai", "clovastudio.stream.ntruss.com"]));
    expect(ALLOWED_RELAY_HOSTS.some((h) => h.startsWith("localhost"))).toBe(false);
    expect(resolveUpstream("upstage", "/v1/chat/completions").href).toBe("https://api.upstage.ai/v1/chat/completions");
    expect(resolveUpstream("perplexity", "/chat/completions").href).toBe("https://api.perplexity.ai/chat/completions");
    expect(() => resolveUpstream("upstage", "/v1/images/generations")).toThrow();
    expect(() => resolveUpstream("ollama", "/v1/chat/completions")).toThrow();
    expect(resolveUpstream("openai", "/v1/responses").host).toBe("api.openai.com");
    expect(() => resolveUpstream("hasOwnProperty", "/v1/messages")).toThrow();
  });

  it("requires auth and a well-formed key header, rejects streaming and oversize bodies", async () => {
    const fetchMock = mockFetch(() => Response.json({}));
    const t = makeApp(db, { fetch: fetchMock, limits: { relay: { maxBodyBytes: 1024 } } });
    const u = await t.signup();
    const body = { provider: "openai", path: "/v1/chat/completions", body: {} };
    expect((await t.call("POST", "/v1/ai/relay", { headers: { "X-Provider-Key": KEY }, body })).status).toBe(401);
    expect((await t.call("POST", "/v1/ai/relay", { token: u.token, body })).status).toBe(400);
    expect((await t.call("POST", "/v1/ai/relay", { token: u.token, headers: { "X-Provider-Key": "has space key 123" }, body })).status).toBe(400);
    expect((await t.call("POST", "/v1/ai/relay", { token: u.token, headers: { "X-Provider-Key": KEY }, body: { ...body, body: { stream: true } } })).status).toBe(400);
    const big = await t.call("POST", "/v1/ai/relay", { token: u.token, headers: { "X-Provider-Key": KEY }, body: { ...body, body: { text: "x".repeat(4096) } } });
    expect(big.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps upstream errors, redirects and timeouts", async () => {
    let mode: "error" | "redirect" | "timeout" | "network" = "error";
    const fetchMock = mockFetch(async (_url, init) => {
      if (mode === "error") return Response.json({ error: { message: "invalid key" } }, { status: 401 });
      if (mode === "redirect") return new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/" } });
      if (mode === "network") throw new TypeError("fetch failed");
      return new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
    });
    const t = makeApp(db, { fetch: fetchMock, limits: { relay: { timeoutMs: 50 } } });
    const u = await t.signup();
    const send = () => t.call("POST", "/v1/ai/relay", { token: u.token, headers: { "X-Provider-Key": KEY }, body: { provider: "openai", path: "/v1/chat/completions", body: {} } });

    const err = await send();
    expect(err.status).toBe(200);
    expect(err.json.upstream).toEqual({ status: 401, body: { error: { message: "invalid key" } } });
    mode = "redirect";
    expect((await send()).status).toBe(502);
    mode = "network";
    expect((await send()).json.error.code).toBe("upstream_error");
    mode = "timeout";
    const to = await send();
    expect(to.status).toBe(504);
    expect(to.json.error.code).toBe("upstream_timeout");
  });

  it("rate-limits relay calls per account", async () => {
    const t = makeApp(db, { fetch: mockFetch(() => Response.json({})), limits: { rate: { relay: { capacity: 1, refillPerMinute: 1 } } } });
    const u = await t.signup();
    const send = () => t.call("POST", "/v1/ai/relay", { token: u.token, headers: { "X-Provider-Key": KEY }, body: { provider: "openai", path: "/v1/chat/completions", body: {} } });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
  });

  it("never logs the provider key", async () => {
    const lines: string[] = [];
    const t = makeApp(db, { fetch: mockFetch(() => Response.json({ ok: 1 })), logger: createLogger("debug", {}, (l) => lines.push(l)) });
    const u = await t.signup();
    await t.call("POST", "/v1/ai/relay", { token: u.token, headers: { "X-Provider-Key": KEY }, body: { provider: "openai", path: "/v1/chat/completions", body: {} } });
    expect(lines.some((l) => l.includes("relay.done"))).toBe(true);
    expect(lines.some((l) => l.includes("http.request") && l.includes("/v1/ai/relay"))).toBe(true);
    expect(lines.join("\n")).not.toContain(KEY);
    expect(lines.join("\n")).not.toContain(u.token);
  });
});
