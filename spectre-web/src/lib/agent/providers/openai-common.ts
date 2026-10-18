// Shared pieces of the OpenAI-compatible providers: options, errors, tool schemas, HTTP and
// server-sent-event plumbing. Used by both wire APIs (Chat Completions and Responses).
import { hostOf } from "../config";
import type { ToolDef } from "./types";

export type OpenAIApi = "chat" | "responses" | "auto";

export interface OpenAIOptions {
  baseURL: string;
  apiKey?: string;
  model: string;
  headers?: Record<string, string>;
  maxTokens?: number;
  tokensParam?: "max_tokens" | "max_completion_tokens";
  temperature?: number;
  /** wire API; "auto" (default) uses Responses for api.openai.com and Chat Completions elsewhere */
  api?: OpenAIApi;
  /** reasoning effort for reasoning models (none, minimal, low, medium, high, …) */
  reasoningEffort?: string;
  fetchImpl?: typeof fetch;
}

export class OpenAICompatError extends Error {
  constructor(
    message: string,
    public status?: number,
    public detail?: string,
  ) {
    super(message);
    this.name = "OpenAICompatError";
  }
}

export function errorText(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string; detail?: string };
    if (typeof j.error === "string") return j.error;
    return j.error?.message ?? j.message ?? j.detail ?? body;
  } catch {
    return body;
  }
}

/** Parse tool-call arguments; tolerate empty strings, objects and duplicated JSON payloads. */
export function parseToolArguments(raw: unknown): { input: unknown; error?: string } {
  if (raw && typeof raw === "object") return { input: raw };
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { input: {} };
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };
  let v = tryParse(text);
  if (v === undefined) {
    // some servers resend the complete arguments in the last chunk: "{...}{...}"
    const cut = text.lastIndexOf("}{");
    if (cut > 0) v = tryParse(text.slice(cut + 1)) ?? tryParse(text.slice(0, cut + 1));
  }
  if (v === undefined) return { input: null, error: `tool arguments are not valid JSON: ${text.slice(0, 200)}` };
  if (!v || typeof v !== "object" || Array.isArray(v)) return { input: null, error: "tool arguments must be a JSON object" };
  return { input: v };
}

/** A tool's JSON-schema parameters, completed to the object form OpenAI expects. */
export function toolParameters(t: ToolDef): Record<string, unknown> {
  const params = { ...t.input_schema } as Record<string, unknown>;
  if (params.type === undefined) params.type = "object";
  if (params.properties === undefined) params.properties = {};
  return params;
}

/** The wire API to start with: Responses for OpenAI's own endpoint unless told otherwise. */
export function resolveApi(opts: OpenAIOptions): "chat" | "responses" {
  if (opts.api === "chat" || opts.api === "responses") return opts.api;
  return hostOf(opts.baseURL) === "api.openai.com" ? "responses" : "chat";
}

/** POST a JSON body to `${baseURL}/${path}`; network failures become a readable error. */
export async function postJSON(opts: OpenAIOptions, path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json", accept: body.stream ? "text/event-stream" : "application/json", ...opts.headers };
  if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;
  try {
    return await (opts.fetchImpl ?? fetch)(`${opts.baseURL}/${path}`, { method: "POST", headers, body: JSON.stringify(body), signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    throw new OpenAICompatError(`Could not reach ${opts.baseURL} (${cause?.code ?? cause?.message ?? (e instanceof Error ? e.message : String(e))}). Is the server running and OPENAI_BASE_URL correct?`);
  }
}

/** Hand each `data:` payload of a server-sent-event stream to `onData` (skips comments, event names, [DONE]). */
export async function readSSE(res: Response, onData: (data: string) => void): Promise<void> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const line = (raw: string) => {
    const l = raw.replace(/\r$/, "");
    if (!l.startsWith("data:")) return;
    const data = l.slice(5).trim();
    if (data && data !== "[DONE]") onData(data);
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        line(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    }
    buf += decoder.decode();
    if (buf.trim()) line(buf);
  } catch (e) {
    await reader.cancel().catch(() => undefined);
    throw e;
  }
}

/** The model needs OpenAI's Responses API for this request (e.g. reasoning models with tools). */
export const NEEDS_RESPONSES_API = /\/responses\b|responses api/i;

/** A readable error for an HTTP failure from an OpenAI-compatible server. */
export function httpError(opts: OpenAIOptions, status: number, detail: string): OpenAICompatError {
  const msg = errorText(detail).slice(0, 500);
  const where = hostOf(opts.baseURL);
  if (status === 401 || status === 403) return new OpenAICompatError(`${where} rejected the credentials (${status}) — check OPENAI_API_KEY. ${msg}`.trim(), status, detail);
  if (status === 404) return new OpenAICompatError(`Model or endpoint not found (404) at ${where} — check OPENAI_BASE_URL (usually ends in /v1) and the model name "${opts.model}". ${msg}`.trim(), status, detail);
  if (status === 429) return new OpenAICompatError(`Rate limit reached at ${where} (429) — try again in a moment.`, status, detail);
  if (/does not support tools|tool(s)? (are|is) not supported|tool_choice|function calling/i.test(msg))
    return new OpenAICompatError(`The model "${opts.model}" at ${where} does not support tool calling, which the Spectre agent needs. Pick a tool-capable model. (${msg})`, status, detail);
  return new OpenAICompatError(`OpenAI-compatible API error ${status} at ${where}: ${msg}`, status, detail);
}
