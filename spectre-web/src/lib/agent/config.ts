// Which language-model providers the chat can use, from environment variables.
// - Claude (Anthropic API): ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN), ANTHROPIC_MODEL.
// - Any OpenAI-compatible Chat Completions endpoint (OpenAI, OpenRouter, Groq, Together, vLLM,
//   Ollama, LM Studio, …): OPENAI_BASE_URL, OPENAI_API_KEY (optional for local servers),
//   OPENAI_MODEL, OPENAI_EXTRA_HEADERS (JSON), OPENAI_MAX_TOKENS, OPENAI_TOKENS_PARAM,
//   OPENAI_TEMPERATURE, OPENAI_REASONING_EFFORT, OPENAI_API=chat|responses (default: the
//   Responses API for api.openai.com, Chat Completions elsewhere).
// LLM_PROVIDER=anthropic|openai picks the default when both are configured.
// Nothing here returns secrets.

export type ProviderId = "anthropic" | "openai";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** configured default model ("" when the provider needs one per request) */
  model: string;
  /** OpenAI-compatible base URL (no credentials) */
  baseURL?: string;
  /** host of the base URL, for display */
  host?: string;
  available: boolean;
}

export interface AgentConfig {
  providers: ProviderInfo[];
  default: ProviderId | null;
}

const env = (k: string) => (process.env[k] ?? "").trim();

export function anthropicAvailable(): boolean {
  return Boolean(env("ANTHROPIC_API_KEY") || env("ANTHROPIC_AUTH_TOKEN"));
}

/** An OpenAI-compatible provider counts as configured once a key or a base URL is set. */
export function openaiAvailable(): boolean {
  return Boolean(env("OPENAI_API_KEY") || env("OPENAI_BASE_URL"));
}

export function openaiBaseURL(): string {
  return (env("OPENAI_BASE_URL") || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, "");
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function providerInfos(): ProviderInfo[] {
  const base = openaiBaseURL();
  return [
    { id: "anthropic", label: "Claude", model: env("ANTHROPIC_MODEL") || DEFAULT_ANTHROPIC_MODEL, available: anthropicAvailable() },
    { id: "openai", label: "OpenAI-compatible", model: env("OPENAI_MODEL"), baseURL: base, host: hostOf(base), available: openaiAvailable() },
  ];
}

export function isProviderId(x: unknown): x is ProviderId {
  return x === "anthropic" || x === "openai";
}

/** LLM_PROVIDER when it names an available provider, else Claude, else OpenAI-compatible. */
export function defaultProvider(): ProviderId | null {
  const wanted = env("LLM_PROVIDER").toLowerCase();
  const avail = { anthropic: anthropicAvailable(), openai: openaiAvailable() };
  if (isProviderId(wanted) && avail[wanted]) return wanted;
  if (avail.anthropic) return "anthropic";
  if (avail.openai) return "openai";
  return null;
}

export function agentConfig(): AgentConfig {
  return { providers: providerInfos(), default: defaultProvider() };
}

export const NOT_CONFIGURED_MESSAGE =
  "The chat needs a language model. Either use Claude: put ANTHROPIC_API_KEY=sk-ant-… in spectre-web/.env.local (optionally ANTHROPIC_MODEL, default claude-opus-5-5), " +
  "or any OpenAI-compatible endpoint: OPENAI_BASE_URL, OPENAI_MODEL and, if the server needs one, OPENAI_API_KEY " +
  "(e.g. local Ollama: OPENAI_BASE_URL=http://localhost:11434/v1 OPENAI_MODEL=llama3.1). Then restart `npm run dev`. Everything else in the app works without it.";
