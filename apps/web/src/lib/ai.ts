/**
 * Copilot & Studio: bring-your-own AI. AutoFlow ships no AI key and no model of its own.
 * Keys live encrypted on the device; requests go straight to the provider the user picked
 * (or through the allow-listed AutoFlow relay when the user prefers). AI output is only a
 * draft: flows are validated, linted and risk-scored before the user can save them.
 */
import { AI_PROVIDERS, chatPath, findProvider, imagesPath, type AiProviderPreset, FUNCTION_NAMES, SCHEMA_VERSION, lintFlow, newId, parseFlow, analyzeRisk, type Flow, type LintIssue, type RiskReport, type ValidationIssue } from "@autoflow/core";
import { vault } from "./crypto";
import { api } from "./api";
import { useStore, type AiSettings } from "./store";

export const AI_KEY = (provider: string) => `ai:${provider}`;

export const PROVIDER_PRESETS = AI_PROVIDERS;

/** The catalog entry behind the current settings (only when its base URL is unchanged, so the relay path is exact). */
export function currentPreset(ai: AiSettings): AiProviderPreset | undefined {
  const p = findProvider(ai.presetId);
  return p && p.baseUrl === ai.baseUrl.replace(/\/+$/, "") ? p : undefined;
}

/** Vault name of the API key for the selected provider (one key per provider). */
export function keyName(ai: AiSettings): string {
  return AI_KEY(ai.presetId && ai.presetId !== "custom" ? ai.presetId : ai.provider);
}

export function isLocalUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
  } catch {
    return false;
  }
}

export class AiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiError";
  }
}

export interface OutgoingPreview {
  provider: string;
  host: string;
  model: string;
  bytes: number;
  includes: string[];
  viaRelay: boolean;
}

export function previewRequest(ai: AiSettings, prompt: string, includes: string[]): OutgoingPreview {
  let host = "";
  try {
    host = new URL(ai.baseUrl).host;
  } catch {
    host = ai.baseUrl;
  }
  return { provider: currentPreset(ai)?.label ?? ai.provider, host, model: ai.model, bytes: new TextEncoder().encode(prompt).length, includes, viaRelay: ai.useRelay && !isLocalUrl(ai.baseUrl) && !!currentPreset(ai) };
}

async function chat(system: string, user: string, json: boolean): Promise<string> {
  const ai = useStore.getState().settings.ai;
  if (ai.provider === "none") throw new AiError("AI is turned off in Copilot settings");
  if (ai.localOnly && !isLocalUrl(ai.baseUrl)) throw new AiError("Local-only mode is on: only localhost providers are allowed");
  const key = (await vault.get(keyName(ai))) ?? "";
  if (!key && !isLocalUrl(ai.baseUrl)) throw new AiError("Add your API key in Copilot settings first");
  const preset = currentPreset(ai);
  const relay = ai.useRelay && !isLocalUrl(ai.baseUrl) && preset && !preset.local ? preset : undefined;

  if (ai.provider === "anthropic") {
    const body = { model: ai.model, max_tokens: 4096, system, messages: [{ role: "user", content: user }] };
    const data = relay
      ? await viaRelay<{ content: { type: string; text?: string }[] }>(relay.id, chatPath(relay), body, key)
      : await providerFetch<{ content: { type: string; text?: string }[] }>(`${ai.baseUrl.replace(/\/+$/, "")}/messages`, body, { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" });
    return data.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  }

  const body: Record<string, unknown> = { model: ai.model, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0.2 };
  if (json) body.response_format = { type: "json_object" };
  const data =
    relay
      ? await viaRelay<{ choices: { message: { content: string } }[] }>(relay.id, chatPath(relay), body, key)
      : await providerFetch<{ choices: { message: { content: string } }[] }>(`${ai.baseUrl.replace(/\/+$/, "")}/chat/completions`, body, key ? { Authorization: `Bearer ${key}` } : {});
  return data.choices[0]?.message.content ?? "";
}

/** Calls the allow-listed AutoFlow relay; it answers 200 with the provider's status and body. */
async function viaRelay<T>(provider: string, path: string, body: unknown, key: string): Promise<T> {
  const r = await api<{ upstream: { status: number; body: unknown } }>("/v1/ai/relay", { method: "POST", json: { provider, path, body }, headers: { "X-Provider-Key": key } });
  if (r.upstream.status >= 400) {
    const b = r.upstream.body as { error?: { message?: string } } | string;
    throw new AiError(`${r.upstream.status}: ${typeof b === "string" ? b.slice(0, 300) : (b?.error?.message ?? "provider error")}`);
  }
  return r.upstream.body as T;
}

async function providerFetch<T>(url: string, body: unknown, headers: Record<string, string>): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 300);
      try {
        msg = JSON.parse(text)?.error?.message ?? msg;
      } catch {
        /* keep text */
      }
      throw new AiError(`${res.status}: ${msg}`);
    }
    return JSON.parse(text) as T;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new AiError("The AI provider did not answer in time");
    if (e instanceof TypeError) throw new AiError(isLocalUrl(url) ? "Could not reach the local AI server. Is it running, and does it allow this origin (CORS)?" : "The browser could not reach this provider directly (network or CORS). Turn on “Send through the AutoFlow relay” and try again.");
    throw e instanceof AiError ? e : new AiError((e as Error).message);
  } finally {
    clearTimeout(timer);
  }
}

const FLOW_SYSTEM = `You convert a user's description into an AutoFlow automation JSON document.
Return ONLY one JSON object: {"name": string, "description": string, "targets": ["windows"|"android"|"web"...], "mode": "easy"|"pro", "trigger": {...}, "variables": [...], "steps": [...], "limits": {...}}.
Rules:
- Step ids: short unique strings like "s1", "s2". Every step needs "id" and "type".
- Step types: click{target,button,clicks,holdMs,modifiers}, move{target,durationMs}, drag{from,to,durationMs}, scroll{dx,dy}, key{key,modifiers,action:"press"|"down"|"up",repeat}, type{text}, wait{ms}, waitFor{condition:{expr},timeoutMs}, setVar{name,value(expr)}, log{message}, notify{title,body}, confirm{message,resultVar?}, clipboard{op:"set"|"get",value?,var?}, launchApp{app}, openUrl{url}, window{op,match:{title?,app?}}, androidGlobal{action:"back"|"home"|"recents"|"notifications"}, http{method,url,headers:{}}, if{condition:{expr},then:[],else:[]}, loop{mode:"count"|"while"|"forever",count?,condition?,body:[]}, forEach{list(expr),itemVar,body:[]}, try{body:[],catch:[],errorVar?}, stop{}.
- Targets: {"kind":"point","x":0..1,"y":0..1,"space":"normalized"} (preferred) or {"kind":"current"}.
- Keys use KeyboardEvent.key names ("Enter","Tab","a","F5","ArrowDown"); modifiers from ["ctrl","alt","shift","meta"].
- Expressions are NOT JavaScript: operators + - * / % == != < <= > >= && || ! ?: and functions ${FUNCTION_NAMES.join(", ")}. Text fields may use {{expr}}. Never put passwords in text: use {{secret:name}}.
- Triggers: {"type":"manual"} | {"type":"hotkey","hotkey":{"key","modifiers"}} | {"type":"schedule","everyMs"} | {"type":"appEvent","event":"launched","app"} | {"type":"deviceEvent","event":"charging"}.
- Always add waits inside loops. Prefer bounded loops. Set limits.maxDurationMs sensibly.
- Never create automations that bypass CAPTCHAs, anti-cheat, security prompts, payments, or send spam. If asked, return {"refused": "<short reason>"}.`;

export interface DraftResult {
  flow?: Flow;
  issues: ValidationIssue[];
  lint: LintIssue[];
  risk?: RiskReport;
  refused?: string;
  raw: string;
}

/** Natural language → validated draft flow (never saved automatically). */
export async function draftFlow(description: string, language: string): Promise<DraftResult> {
  const raw = await chat(FLOW_SYSTEM, `Language of names/messages: ${language}.\nRequest:\n${description}`, true);
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return { issues: [{ path: "", message: "The AI answer was not valid JSON" }], lint: [], raw };
  }
  if (typeof data.refused === "string") return { refused: data.refused, issues: [], lint: [], raw };
  const now = new Date().toISOString();
  const candidate = { ...data, schemaVersion: SCHEMA_VERSION, id: newId("f"), createdAt: now, updatedAt: now, revision: 0, tags: ["copilot"] };
  const parsed = parseFlow(candidate);
  if (!parsed.ok) return { issues: parsed.issues, lint: [], raw };
  return { flow: parsed.flow, issues: [], lint: lintFlow(parsed.flow), risk: analyzeRisk(parsed.flow), raw };
}

/** Free-form helper used by Studio (site/app planning) and "suggest improvements". */
export async function askText(system: string, prompt: string): Promise<string> {
  return chat(system, prompt, false);
}

export interface ImageRequest {
  prompt: string;
  size: "1024x1024" | "1536x1024" | "1024x1536";
  background: "auto" | "transparent" | "opaque";
  format: "png" | "webp" | "jpeg";
  quality: "low" | "medium" | "high";
}

/** Image generation through the user's OpenAI-compatible key. Returns a Blob the user can save. */
export async function generateImage(req: ImageRequest): Promise<Blob> {
  const ai = useStore.getState().settings.ai;
  const preset = currentPreset(ai);
  if (ai.provider !== "openai" || (preset && !preset.images && !preset.local)) throw new AiError("Image generation needs a provider with image support (e.g. OpenAI)");
  if (ai.localOnly && !isLocalUrl(ai.baseUrl)) throw new AiError("Local-only mode is on");
  const key = (await vault.get(keyName(ai))) ?? "";
  const body = { model: ai.imageModel, prompt: req.prompt, size: req.size, background: req.background, output_format: req.format, quality: req.quality, n: 1 };
  const data =
    ai.useRelay && !isLocalUrl(ai.baseUrl) && preset
      ? await viaRelay<{ data: { b64_json: string }[] }>(preset!.id, imagesPath(preset!), body, key)
      : await providerFetch<{ data: { b64_json: string }[] }>(`${ai.baseUrl.replace(/\/+$/, "")}/images/generations`, body, { Authorization: `Bearer ${key}` });
  const b64 = data.data[0]?.b64_json;
  if (!b64) throw new AiError("No image returned");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: `image/${req.format}` });
}

export async function testConnection(): Promise<string> {
  const out = await chat("Reply with the single word: ready", "ping", false);
  return out.trim().slice(0, 80);
}
