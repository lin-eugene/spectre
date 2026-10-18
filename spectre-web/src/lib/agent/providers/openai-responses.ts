// OpenAI's Responses API (/v1/responses). OpenAI's newer reasoning models only take function
// tools here, so it is the default for api.openai.com and the fallback when a Chat Completions
// server asks for it. Requests are stateless (store: false): the session resends the
// conversation each round. Reasoning items come back encrypted and are passed back between tool
// rounds, so the model keeps its chain of thought. Request fields the model rejects are dropped
// and the request is retried.
import {
  OpenAICompatError,
  errorText,
  httpError,
  parseToolArguments,
  postJSON,
  readSSE,
  toolParameters,
  type OpenAIOptions,
} from "./openai-common";
import type { ProviderSession, SystemParts, ToolCall, ToolDef, ToolResult, TurnResult } from "./types";

/** One input/output item of the Responses API (message, function_call, function_call_output, reasoning). */
export type ResponseItem = Record<string, unknown>;

interface ResponseObject {
  status?: string;
  output?: ResponseItem[];
  incomplete_details?: { reason?: string } | null;
  error?: { message?: string } | null;
}

/** Optional request fields, in the order they are given up when a model rejects them. */
type Optional = "include" | "reasoning" | "temperature" | "max_output_tokens";
const OPTIONAL: Optional[] = ["include", "reasoning", "temperature", "max_output_tokens"];

/** Which optional field a 400 response complains about, if any. */
function rejectedField(detail: string): Optional | null {
  let param = "";
  try {
    param = String((JSON.parse(detail) as { error?: { param?: unknown } }).error?.param ?? "");
  } catch {
    param = "";
  }
  const msg = errorText(detail);
  for (const f of OPTIONAL) {
    if (param === f || param.startsWith(`${f}.`) || param.startsWith(`${f}[`)) return f;
  }
  if (/encrypted_content/i.test(msg)) return "include";
  const named = /parameter:? '([\w.[\]]+)'|'([\w.[\]]+)' is not supported/i.exec(msg);
  const name = named?.[1] ?? named?.[2] ?? "";
  return OPTIONAL.find((f) => name === f || name.startsWith(`${f}.`)) ?? null;
}

/**
 * Output items to send back next round. Reasoning items are only usable with their encrypted
 * content (nothing is stored server-side); without it they are dropped, together with the item
 * ids that would point the API at them.
 */
function replayItems(output: ResponseItem[]): ResponseItem[] {
  const kept = output.filter((i) => i.type === "message" || i.type === "function_call" || i.type === "reasoning");
  if (kept.every((i) => i.type !== "reasoning" || typeof i.encrypted_content === "string")) return kept;
  return kept
    .filter((i) => i.type !== "reasoning")
    .map((i) => {
      const copy = { ...i };
      delete copy.id;
      return copy;
    });
}

function outputText(item: ResponseItem): string {
  if (item.type !== "message" || !Array.isArray(item.content)) return "";
  return (item.content as { type?: string; text?: string; refusal?: string }[])
    .map((p) => (p.type === "output_text" ? (p.text ?? "") : p.type === "refusal" ? (p.refusal ?? "") : ""))
    .join("");
}

export class OpenAIResponsesSession implements ProviderSession {
  private tools: { type: "function"; name: string; description: string; parameters: Record<string, unknown>; strict: false }[];
  private streaming = true;
  /** optional request fields this model rejected; left out from then on */
  private omit = new Set<Optional>();
  private callSeq = 0;

  constructor(
    private opts: OpenAIOptions,
    tools: ToolDef[],
    private input: ResponseItem[],
  ) {
    // strict schemas would demand every property be required; the action schemas have optional ones
    this.tools = tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: toolParameters(t), strict: false }));
  }

  private body(sys: SystemParts): Record<string, unknown> {
    const o = this.opts;
    const body: Record<string, unknown> = {
      model: o.model,
      instructions: `${sys.static}\n\n${sys.dynamic}`,
      input: this.input,
      tools: this.tools,
      tool_choice: "auto",
      stream: this.streaming,
      store: false,
    };
    if (!this.omit.has("include")) body.include = ["reasoning.encrypted_content"];
    if (o.reasoningEffort && !this.omit.has("reasoning")) body.reasoning = { effort: o.reasoningEffort };
    if (o.temperature !== undefined && !this.omit.has("temperature")) body.temperature = o.temperature;
    if (o.maxTokens && !this.omit.has("max_output_tokens")) body.max_output_tokens = o.maxTokens;
    return body;
  }

  async turn(sys: SystemParts, onText: (text: string) => void, signal?: AbortSignal): Promise<TurnResult> {
    for (let attempt = 0; ; attempt++) {
      const res = await postJSON(this.opts, "responses", this.body(sys), signal);
      if (res.ok) return this.read(res, onText);
      const detail = await res.text().catch(() => "");
      if (attempt < 5 && res.status === 400) {
        const field = rejectedField(detail);
        if (field && !this.omit.has(field)) {
          this.omit.add(field);
          continue;
        }
      }
      // proxies that cannot stream this endpoint
      if (attempt < 5 && this.streaming && (res.status === 415 || res.status === 501 || (res.status === 400 && /stream/i.test(errorText(detail))))) {
        this.streaming = false;
        continue;
      }
      throw httpError(this.opts, res.status, detail);
    }
  }

  private async read(res: Response, onText: (text: string) => void): Promise<TurnResult> {
    let response: ResponseObject | null = null;
    const done: ResponseItem[] = [];
    let streamed = false;
    let refused = false;
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json") || !res.body) {
      response = (await res.json()) as ResponseObject; // not streamed (or the server ignored stream:true)
    } else {
      await readSSE(res, (data) => {
        let ev: { type?: string; delta?: unknown; item?: ResponseItem; output_index?: number; response?: ResponseObject; message?: string; error?: { message?: string } };
        try {
          ev = JSON.parse(data);
        } catch {
          return;
        }
        switch (ev.type) {
          case "response.output_text.delta":
          case "response.refusal.delta":
            if (typeof ev.delta === "string" && ev.delta) {
              streamed = true;
              if (ev.type === "response.refusal.delta") refused = true;
              onText(ev.delta);
            }
            break;
          case "response.output_item.done":
            if (ev.item) done[ev.output_index ?? done.length] = ev.item;
            break;
          case "response.completed":
          case "response.incomplete":
            response = ev.response ?? response;
            break;
          case "response.failed":
            throw new OpenAICompatError(`The model run failed: ${ev.response?.error?.message ?? "unknown error"}`);
          case "error":
            throw new OpenAICompatError(`OpenAI Responses API error: ${ev.message ?? ev.error?.message ?? data.slice(0, 300)}`);
        }
      });
    }
    const final = response as ResponseObject | null;
    if (final?.error?.message) throw new OpenAICompatError(`The model run failed: ${final.error.message}`);
    const output = final?.output?.length ? final.output : done.filter(Boolean);
    if (!streamed) {
      const text = output.map(outputText).join("");
      if (text) onText(text);
      refused = output.some((i) => Array.isArray(i.content) && (i.content as { type?: string }[]).some((p) => p.type === "refusal"));
    }

    const calls = output.filter((i) => i.type === "function_call");
    const toolCalls: ToolCall[] = calls.map((c) => {
      if (typeof c.call_id !== "string" || !c.call_id) c.call_id = `call_${++this.callSeq}`;
      const parsed = parseToolArguments(c.arguments);
      return { id: c.call_id as string, name: String(c.name ?? ""), input: parsed.input, ...(parsed.error ? { parseError: parsed.error } : {}) };
    });
    this.input.push(...replayItems(output));
    const reason = final?.incomplete_details?.reason;
    if (!toolCalls.length) {
      if (refused || reason === "content_filter") return { stop: "refusal", toolCalls: [] };
      return { stop: reason === "max_output_tokens" ? "max_tokens" : "end", toolCalls: [] };
    }
    if (reason === "max_output_tokens") return { stop: "max_tokens", toolCalls: [] };
    return { stop: "tool_calls", toolCalls };
  }

  addToolResults(results: ToolResult[]): void {
    for (const r of results) this.input.push({ type: "function_call_output", call_id: r.id, output: r.content });
  }
}
