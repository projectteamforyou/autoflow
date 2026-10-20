/**
 * Bring-your-own-AI provider catalog — shared by the apps (Copilot/Studio presets) and the API
 * (relay allow-list). AutoFlow ships no key and no model; users pick a provider and paste their key,
 * or point at a local server. Every cloud entry speaks the OpenAI chat-completions dialect except
 * Anthropic (Messages API).
 */

export type ProviderRegion = "global" | "korea" | "local";

export interface AiProviderPreset {
  id: string;
  label: string;
  /** Company / product family, shown as a subtitle. */
  vendor: string;
  region: ProviderRegion;
  /** Wire protocol. */
  api: "openai" | "anthropic";
  baseUrl: string;
  /** Suggested model ids (first = default). Users may type any other id. */
  models: string[];
  /** Where to create an API key (cloud providers). */
  keyUrl?: string;
  /** Supports OpenAI-style /images/generations with b64 output. */
  images?: boolean;
  /** Runs on the user's own machine; no key, never leaves the device. */
  local?: boolean;
}

export const AI_PROVIDERS: AiProviderPreset[] = [
  // ---- Global cloud
  { id: "openai", label: "OpenAI", vendor: "GPT", region: "global", api: "openai", baseUrl: "https://api.openai.com/v1", models: ["gpt-4.1-mini", "gpt-4.1", "gpt-5", "gpt-5-mini", "o4-mini"], keyUrl: "https://platform.openai.com/api-keys", images: true },
  { id: "anthropic", label: "Anthropic", vendor: "Claude", region: "global", api: "anthropic", baseUrl: "https://api.anthropic.com/v1", models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"], keyUrl: "https://console.anthropic.com/settings/keys" },
  { id: "gemini", label: "Google Gemini", vendor: "Gemini", region: "global", api: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"], keyUrl: "https://aistudio.google.com/apikey" },
  { id: "xai", label: "xAI", vendor: "Grok", region: "global", api: "openai", baseUrl: "https://api.x.ai/v1", models: ["grok-4", "grok-3-mini"], keyUrl: "https://console.x.ai" },
  { id: "mistral", label: "Mistral AI", vendor: "Mistral · Codestral", region: "global", api: "openai", baseUrl: "https://api.mistral.ai/v1", models: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest", "codestral-latest"], keyUrl: "https://console.mistral.ai/api-keys" },
  { id: "deepseek", label: "DeepSeek", vendor: "DeepSeek-V3 · R1", region: "global", api: "openai", baseUrl: "https://api.deepseek.com/v1", models: ["deepseek-chat", "deepseek-reasoner"], keyUrl: "https://platform.deepseek.com/api_keys" },
  { id: "qwen", label: "Alibaba Cloud", vendor: "Qwen", region: "global", api: "openai", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", models: ["qwen-plus", "qwen-max", "qwen-turbo"], keyUrl: "https://bailian.console.alibabacloud.com/?apiKey=1" },
  { id: "moonshot", label: "Moonshot AI", vendor: "Kimi", region: "global", api: "openai", baseUrl: "https://api.moonshot.ai/v1", models: ["kimi-k2-0905-preview", "moonshot-v1-32k"], keyUrl: "https://platform.moonshot.ai/console/api-keys" },
  { id: "zai", label: "Z.ai", vendor: "GLM", region: "global", api: "openai", baseUrl: "https://api.z.ai/api/paas/v4", models: ["glm-4.6", "glm-4.5-air"], keyUrl: "https://z.ai/manage-apikey/apikey-list" },
  { id: "cohere", label: "Cohere", vendor: "Command", region: "global", api: "openai", baseUrl: "https://api.cohere.ai/compatibility/v1", models: ["command-a-03-2025", "command-r-plus-08-2024"], keyUrl: "https://dashboard.cohere.com/api-keys" },
  { id: "perplexity", label: "Perplexity", vendor: "Sonar", region: "global", api: "openai", baseUrl: "https://api.perplexity.ai", models: ["sonar", "sonar-pro"], keyUrl: "https://www.perplexity.ai/settings/api" },
  { id: "groq", label: "Groq", vendor: "Llama · GPT-OSS (fast)", region: "global", api: "openai", baseUrl: "https://api.groq.com/openai/v1", models: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "qwen/qwen3-32b"], keyUrl: "https://console.groq.com/keys" },
  { id: "cerebras", label: "Cerebras", vendor: "Llama · Qwen (fast)", region: "global", api: "openai", baseUrl: "https://api.cerebras.ai/v1", models: ["llama-3.3-70b", "qwen-3-32b"], keyUrl: "https://cloud.cerebras.ai" },
  { id: "together", label: "Together AI", vendor: "Open models", region: "global", api: "openai", baseUrl: "https://api.together.xyz/v1", models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-72B-Instruct-Turbo"], keyUrl: "https://api.together.ai/settings/api-keys" },
  { id: "fireworks", label: "Fireworks AI", vendor: "Open models", region: "global", api: "openai", baseUrl: "https://api.fireworks.ai/inference/v1", models: ["accounts/fireworks/models/llama-v3p3-70b-instruct", "accounts/fireworks/models/deepseek-v3"], keyUrl: "https://fireworks.ai/account/api-keys" },
  { id: "sambanova", label: "SambaNova", vendor: "Open models", region: "global", api: "openai", baseUrl: "https://api.sambanova.ai/v1", models: ["Meta-Llama-3.3-70B-Instruct", "DeepSeek-V3-0324"], keyUrl: "https://cloud.sambanova.ai/apis" },
  { id: "nvidia", label: "NVIDIA NIM", vendor: "Open models", region: "global", api: "openai", baseUrl: "https://integrate.api.nvidia.com/v1", models: ["meta/llama-3.3-70b-instruct", "deepseek-ai/deepseek-r1"], keyUrl: "https://build.nvidia.com" },
  { id: "huggingface", label: "Hugging Face", vendor: "Inference Providers", region: "global", api: "openai", baseUrl: "https://router.huggingface.co/v1", models: ["openai/gpt-oss-120b", "meta-llama/Llama-3.3-70B-Instruct", "Qwen/Qwen3-235B-A22B"], keyUrl: "https://huggingface.co/settings/tokens" },
  { id: "openrouter", label: "OpenRouter", vendor: "300+ models, one key", region: "global", api: "openai", baseUrl: "https://openrouter.ai/api/v1", models: ["openai/gpt-4.1-mini", "anthropic/claude-sonnet-4.5", "google/gemini-2.5-flash"], keyUrl: "https://openrouter.ai/keys" },

  // ---- Korea (국내)
  { id: "upstage", label: "Upstage", vendor: "Solar (업스테이지)", region: "korea", api: "openai", baseUrl: "https://api.upstage.ai/v1", models: ["solar-pro2", "solar-mini"], keyUrl: "https://console.upstage.ai/api-keys" },
  { id: "clova", label: "NAVER Cloud", vendor: "HyperCLOVA X (네이버)", region: "korea", api: "openai", baseUrl: "https://clovastudio.stream.ntruss.com/v1/openai", models: ["HCX-007", "HCX-005", "HCX-DASH-002"], keyUrl: "https://clovastudio.ncloud.com" },
  { id: "exaone-friendli", label: "LG AI Research", vendor: "EXAONE (LG) · via FriendliAI", region: "korea", api: "openai", baseUrl: "https://api.friendli.ai/serverless/v1", models: ["LGAI-EXAONE/EXAONE-4.0.1-32B"], keyUrl: "https://friendli.ai/suite" },
  { id: "exaone-ollama", label: "EXAONE (local)", vendor: "LG EXAONE 3.5 · Ollama", region: "korea", api: "openai", baseUrl: "http://localhost:11434/v1", models: ["exaone3.5", "exaone3.5:32b", "exaone-deep"], local: true },
  { id: "kanana-local", label: "Kanana (local)", vendor: "Kakao Kanana · vLLM / LM Studio", region: "korea", api: "openai", baseUrl: "http://localhost:8000/v1", models: ["kakaocorp/kanana-1.5-8b-instruct-2505"], local: true },
  { id: "ax-local", label: "A.X (local)", vendor: "SK Telecom A.X 4.0 · vLLM", region: "korea", api: "openai", baseUrl: "http://localhost:8000/v1", models: ["skt/A.X-4.0-Light"], local: true },
  { id: "midm-local", label: "Mi:dm (local)", vendor: "KT Mi:dm 2.0 · vLLM", region: "korea", api: "openai", baseUrl: "http://localhost:8000/v1", models: ["K-intelligence/Midm-2.0-Base-Instruct"], local: true },

  // ---- Local (on this machine)
  { id: "ollama", label: "Ollama", vendor: "Local models", region: "local", api: "openai", baseUrl: "http://localhost:11434/v1", models: ["llama3.1", "qwen2.5", "gemma3", "gpt-oss:20b"], local: true },
  { id: "lmstudio", label: "LM Studio", vendor: "Local models", region: "local", api: "openai", baseUrl: "http://localhost:1234/v1", models: ["local-model"], local: true },
  { id: "vllm", label: "vLLM", vendor: "Self-hosted server", region: "local", api: "openai", baseUrl: "http://localhost:8000/v1", models: ["served-model"], local: true },
  { id: "llamacpp", label: "llama.cpp", vendor: "llama-server", region: "local", api: "openai", baseUrl: "http://localhost:8080/v1", models: ["local"], local: true },
  { id: "jan", label: "Jan", vendor: "Local models", region: "local", api: "openai", baseUrl: "http://localhost:1337/v1", models: ["local-model"], local: true },
];

export function findProvider(id: string | undefined): AiProviderPreset | undefined {
  return AI_PROVIDERS.find((p) => p.id === id);
}

/** Relay path for a chat request to this provider (OpenAI dialect → <basePath>/chat/completions). */
export function chatPath(p: AiProviderPreset): string {
  return p.api === "anthropic" ? "/v1/messages" : `${new URL(p.baseUrl).pathname.replace(/\/+$/, "")}/chat/completions`;
}

export function imagesPath(p: AiProviderPreset): string {
  return `${new URL(p.baseUrl).pathname.replace(/\/+$/, "")}/images/generations`;
}
