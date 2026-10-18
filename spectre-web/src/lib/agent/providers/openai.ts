// Any OpenAI-compatible Chat Completions endpoint (OpenAI, OpenRouter, Groq, Together, vLLM,
// Ollama, LM Studio, …) over plain fetch. Streams `delta.content` as text and accumulates
// `delta.tool_calls` fragments by index; falls back to a non-streaming request when a server
// rejects streaming (or tools while streaming), and parses tool arguments defensively so a bad
// call becomes a tool error the model can correct instead of a crash. OpenAI's own endpoint, and
// any server whose error asks for it, is handled by the Responses API session instead.
import { OpenAIResponsesSession, type ResponseItem } from "./openai-responses";
import {
  NEEDS_RESPONSES_API,
  OpenAICompatError,
  errorText,
  httpError,
  parseToolArguments,
  postJSON,
  readSSE,
  resolveApi,
  toolParameters,
  type OpenAIApi,
  type OpenAIOptions,
} from "./openai-common";
import type { HistoryMessage, ProviderSession, SystemParts, ToolCall, ToolDef, ToolResult, TurnResult } from "./types";

export { OpenAICompatError, parseToolArguments, type OpenAIOptions };

interface OAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

type OAIMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: OAIToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface Acc {
  id: string;
  name: string;
  args: string;
}

/** Statuses after which a non-streaming retry of the same turn is worth one more request. */
const RETRY_NON_STREAM = new Set([400, 415, 422, 500, 501]);

function toolSchema(t: ToolDef) {
  return { type: "function" as const, function: { name: t.name, description: t.description, parameters: toolParameters(t) } };
}

/** The Chat Completions transcript as Responses API input items. */
function toResponsesInput(messages: OAIMessage[]): ResponseItem[] {
  const items: ResponseItem[] = [];
  for (const m of messages) {
    if (m.role === "tool") items.push({ type: "function_call_output", call_id: m.tool_call_id, output: m.content });
    else if (m.role === "assistant") {
      if (m.content) items.push({ role: "assistant", content: m.content });
      for (const tc of m.tool_calls ?? []) items.push({ type: "function_call", call_id: tc.id, name: tc.function.name, arguments: tc.function.arguments });
    } else if (m.role === "user") items.push({ role: "user", content: m.content });
  }
  return items;
}

export class OpenAISession implements ProviderSession {
  private messages: OAIMessage[];
  private tools: ReturnType<typeof toolSchema>[];
  private streaming = true;
  private callSeq = 0;
  /** set once this session talks the Responses API (from the start, or after the server asked) */
  private responses: OpenAIResponsesSession | null = null;

  constructor(
    private opts: OpenAIOptions,
    private toolDefs: ToolDef[],
    history: HistoryMessage[],
  ) {
    this.tools = toolDefs.map(toolSchema);
    this.messages = history.map((m) => ({ role: m.role, content: m.content }));
    if (resolveApi(opts) === "responses") this.responses = new OpenAIResponsesSession(opts, toolDefs, toResponsesInput(this.messages));
  }

  private body(sys: SystemParts, stream: boolean) {
    const o = this.opts;
    const body: Record<string, unknown> = {
      model: o.model,
      messages: [{ role: "system", content: `${sys.static}\n\n${sys.dynamic}` }, ...this.messages],
      tools: this.tools,
      tool_choice: "auto",
      stream,
    };
    if (o.maxTokens) body[o.tokensParam ?? "max_tokens"] = o.maxTokens;
    if (o.temperature !== undefined) body.temperature = o.temperature;
    if (o.reasoningEffort) body.reasoning_effort = o.reasoningEffort;
    return body;
  }

  private post(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    return postJSON(this.opts, "chat/completions", body, signal);
  }

  async turn(sys: SystemParts, onText: (text: string) => void, signal?: AbortSignal): Promise<TurnResult> {
    if (this.responses) return this.responses.turn(sys, onText, signal);
    try {
      return await this.chatTurn(sys, onText, signal);
    } catch (e) {
      // e.g. OpenAI reasoning models only accept function tools through /v1/responses
      if (this.opts.api !== "chat" && e instanceof OpenAICompatError && e.status === 400 && NEEDS_RESPONSES_API.test(errorText(e.detail ?? ""))) {
        this.responses = new OpenAIResponsesSession(this.opts, this.toolDefs, toResponsesInput(this.messages));
        return this.responses.turn(sys, onText, signal);
      }
      throw e;
    }
  }

  private async chatTurn(sys: SystemParts, onText: (text: string) => void, signal?: AbortSignal): Promise<TurnResult> {
    let text = "";
    let finish = null as string | null; // assigned from callbacks below
    const accs: Acc[] = [];
    const emitText = (t: string) => {
      if (!t) return;
      text += t;
      onText(t);
    };
    const addFragment = (tc: { index?: number; id?: string; function?: { name?: string; arguments?: unknown } }, position: number, streaming: boolean) => {
      let i: number;
      if (typeof tc.index === "number") i = tc.index;
      else if (tc.id) {
        const found = accs.findIndex((a) => a?.id === tc.id);
        i = found >= 0 ? found : accs.length;
      } else i = streaming ? Math.max(0, accs.length - 1) : position; // no index/id: continue the last call
      accs[i] ??= { id: "", name: "", args: "" };
      const a = accs[i];
      if (tc.id && !a.id) a.id = tc.id;
      const name = tc.function?.name;
      if (name) a.name = !a.name || name === a.name ? name : a.name + name;
      const args = tc.function?.arguments;
      if (typeof args === "string") a.args += args;
      else if (args && typeof args === "object") a.args = JSON.stringify(args);
    };
    const absorbMessage = (data: unknown) => {
      const d = data as { error?: unknown; choices?: { message?: { content?: unknown; tool_calls?: unknown[] }; finish_reason?: string }[] };
      if (d.error) throw new OpenAICompatError(errorText(JSON.stringify(d)));
      const c = d.choices?.[0];
      if (!c) throw new OpenAICompatError("The server returned no choices.");
      if (typeof c.message?.content === "string") emitText(c.message.content);
      (c.message?.tool_calls ?? []).forEach((tc, k) => addFragment(tc as Parameters<typeof addFragment>[0], k, false));
      finish = c.finish_reason ?? finish;
    };

    let res: Response | null = null;
    if (this.streaming) {
      res = await this.post(this.body(sys, true), signal);
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        if (!RETRY_NON_STREAM.has(res.status) || NEEDS_RESPONSES_API.test(errorText(detail))) throw httpError(this.opts, res.status, detail);
        this.streaming = false; // retry this and later turns without streaming
        res = null;
      }
    }
    if (res) {
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("application/json") || !res.body) {
        absorbMessage(await res.json()); // server ignored stream:true
      } else {
        await readSSE(res, (data) => {
          let chunk: { error?: unknown; choices?: { delta?: { content?: unknown; tool_calls?: unknown[] }; message?: { content?: unknown; tool_calls?: unknown[] }; finish_reason?: string | null }[] };
          try {
            chunk = JSON.parse(data);
          } catch {
            return;
          }
          if (chunk.error) throw new OpenAICompatError(errorText(JSON.stringify(chunk)));
          const choice = chunk.choices?.[0];
          if (!choice) return;
          const delta = choice.delta ?? choice.message ?? {};
          if (typeof delta.content === "string") emitText(delta.content);
          (delta.tool_calls ?? []).forEach((tc, k) => addFragment(tc as Parameters<typeof addFragment>[0], k, true));
          if (choice.finish_reason) finish = choice.finish_reason;
        });
      }
    } else {
      const r = await this.post(this.body(sys, false), signal);
      if (!r.ok) throw httpError(this.opts, r.status, await r.text().catch(() => ""));
      absorbMessage(await r.json());
    }

    const calls = accs.filter((a) => a && (a.name || a.args));
    const toolCalls: ToolCall[] = calls.map((a) => {
      const id = a.id || `call_${++this.callSeq}`;
      a.id = id;
      const parsed = parseToolArguments(a.args);
      return { id, name: a.name, input: parsed.input, ...(parsed.error ? { parseError: parsed.error } : {}) };
    });
    if (finish === "content_filter" && !toolCalls.length) return { stop: "refusal", toolCalls: [] };
    if (!toolCalls.length) return { stop: finish === "length" ? "max_tokens" : "end", toolCalls: [] };
    if (finish === "length") return { stop: "max_tokens", toolCalls: [] };
    this.messages.push({
      role: "assistant",
      content: text,
      tool_calls: calls.map((a) => ({ id: a.id, type: "function", function: { name: a.name, arguments: a.args || "{}" } })),
    });
    return { stop: "tool_calls", toolCalls };
  }

  addToolResults(results: ToolResult[]): void {
    if (this.responses) return this.responses.addToolResults(results);
    for (const r of results) this.messages.push({ role: "tool", tool_call_id: r.id, content: r.content });
  }
}

/** Options from the environment (model may be overridden per request). */
export function openaiOptionsFromEnv(model: string, baseURL: string): OpenAIOptions {
  let headers: Record<string, string> | undefined;
  const extra = (process.env.OPENAI_EXTRA_HEADERS ?? "").trim();
  if (extra) {
    try {
      const h = JSON.parse(extra) as Record<string, unknown>;
      headers = Object.fromEntries(Object.entries(h).filter(([, v]) => typeof v === "string")) as Record<string, string>;
    } catch {
      headers = undefined;
    }
  }
  const maxTokens = Number(process.env.OPENAI_MAX_TOKENS ?? "");
  const tokensParam = (process.env.OPENAI_TOKENS_PARAM ?? "").trim();
  const temperature = (process.env.OPENAI_TEMPERATURE ?? "").trim();
  const api = (process.env.OPENAI_API ?? "").trim().toLowerCase();
  const effort = (process.env.OPENAI_REASONING_EFFORT ?? "").trim().toLowerCase();
  return {
    baseURL,
    apiKey: (process.env.OPENAI_API_KEY ?? "").trim() || undefined,
    model,
    headers,
    maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : undefined,
    // OpenAI's own API wants max_completion_tokens (reasoning models reject max_tokens);
    // most other compatible servers accept max_tokens
    tokensParam:
      tokensParam === "max_tokens" || tokensParam === "max_completion_tokens"
        ? tokensParam
        : /api\.openai\.com/.test(baseURL)
          ? "max_completion_tokens"
          : "max_tokens",
    temperature: temperature !== "" && Number.isFinite(Number(temperature)) ? Number(temperature) : undefined,
    api: api === "chat" || api === "responses" ? (api as OpenAIApi) : "auto",
    reasoningEffort: effort || undefined,
  };
}
