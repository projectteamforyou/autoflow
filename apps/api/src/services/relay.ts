/**
 * Copilot relay (plan §3.5) for users whose network blocks browser-direct provider calls.
 *
 * SSRF-safe by construction: the client names a provider from a fixed table and a path that must
 * match that provider's allow-list; the server builds the URL itself (no user-supplied host or base
 * URL), refuses redirects, and only ever talks HTTPS to the four allow-listed hosts.
 * The user's API key arrives per request in `X-Provider-Key`; it is never stored or logged.
 */
import { ApiError } from "../errors.js";
import type { AppDeps } from "../deps.js";

interface ProviderSpec {
  origin: string;
  paths: RegExp[];
  authHeaders(key: string): Record<string, string>;
}

const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });

export const RELAY_PROVIDERS = {
  openai: {
    origin: "https://api.openai.com",
    paths: [/^\/v1\/chat\/completions$/, /^\/v1\/responses$/],
    authHeaders: bearer,
  },
  anthropic: {
    origin: "https://api.anthropic.com",
    paths: [/^\/v1\/messages$/],
    authHeaders: (key: string) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
  },
  gemini: {
    origin: "https://generativelanguage.googleapis.com",
    paths: [/^\/v1(beta)?\/models\/[A-Za-z0-9._-]{1,100}:generateContent$/],
    authHeaders: (key: string) => ({ "x-goog-api-key": key }),
  },
  openrouter: {
    origin: "https://openrouter.ai",
    paths: [/^\/api\/v1\/chat\/completions$/],
    authHeaders: bearer,
  },
} as const satisfies Record<string, ProviderSpec>;

export type RelayProvider = keyof typeof RELAY_PROVIDERS;
export const RELAY_PROVIDER_NAMES = Object.keys(RELAY_PROVIDERS) as RelayProvider[];
export const ALLOWED_RELAY_HOSTS: readonly string[] = Object.freeze(RELAY_PROVIDER_NAMES.map((p) => new URL(RELAY_PROVIDERS[p].origin).host));

export const PROVIDER_KEY_PATTERN = /^[\x21-\x7E]{8,512}$/;

/** Build the upstream URL, or throw if the provider/path is not allow-listed. */
export function resolveUpstream(provider: string, path: string): URL {
  const spec = (RELAY_PROVIDERS as Record<string, ProviderSpec>)[provider];
  if (!spec || !Object.hasOwn(RELAY_PROVIDERS, provider)) throw new ApiError(400, "provider_not_allowed", "Unknown provider");
  if (!spec.paths.some((re) => re.test(path))) throw new ApiError(400, "provider_not_allowed", "This provider path is not allowed");
  const url = new URL(path, spec.origin);
  // Defence in depth: the regexes already exclude anything that could change the origin.
  if (url.origin !== spec.origin || url.pathname !== path || url.search || url.hash || !ALLOWED_RELAY_HOSTS.includes(url.host) || url.protocol !== "https:") {
    throw new ApiError(400, "provider_not_allowed", "This provider path is not allowed");
  }
  return url;
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new ApiError(502, "upstream_error", "Provider response is too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export interface RelayResult {
  status: number;
  body: unknown;
}

export async function relay(deps: AppDeps, input: { provider: string; path: string; body: Record<string, unknown> }, providerKey: string, userId: string): Promise<RelayResult> {
  const url = resolveUpstream(input.provider, input.path);
  if (input.body.stream === true) throw new ApiError(400, "bad_request", "Streaming is not supported by the relay; set stream to false");
  const spec = RELAY_PROVIDERS[input.provider as RelayProvider];
  const started = Date.now();
  let res: Response;
  try {
    res = await deps.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "AutoFlow-Relay/1", ...spec.authHeaders(providerKey) },
      body: JSON.stringify(input.body),
      redirect: "manual",
      signal: AbortSignal.timeout(deps.config.limits.relay.timeoutMs),
    });
  } catch (err) {
    const name = (err as Error)?.name;
    deps.logger.warn("relay.network_error", { provider: input.provider, userId, kind: name });
    if (name === "TimeoutError" || name === "AbortError") throw new ApiError(504, "upstream_timeout", "The provider did not respond in time");
    throw new ApiError(502, "upstream_error", "Could not reach the provider");
  }
  if (res.status >= 300 && res.status < 400) throw new ApiError(502, "upstream_error", "The provider answered with a redirect, which the relay does not follow");
  const text = await readCapped(res, deps.config.limits.relay.maxResponseBytes);
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 2000) };
  }
  deps.logger.info("relay.done", { provider: input.provider, userId, status: res.status, ms: Date.now() - started });
  return { status: res.status, body };
}
