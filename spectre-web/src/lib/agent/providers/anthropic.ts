// Claude via the Anthropic SDK: prompt caching on the static system prompt, effort, adaptive
// thinking with between-tool progress notes, eager tool-input streaming and the server-side
// refusal fallback where the model supports them.
import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent,
  BetaTextBlockParam,
  BetaTool,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { HistoryMessage, ProviderSession, SystemParts, ToolDef, ToolResult, TurnResult } from "./types";

const DEFAULT_EFFORT = "medium";
const MAX_TOKENS = 32000;

/** The slice of the Anthropic client the loop needs (injectable for tests). */
export interface ChatStreamLike extends AsyncIterable<BetaRawMessageStreamEvent> {
  finalMessage(): Promise<BetaMessage>;
}
export interface ChatClientLike {
  beta: { messages: { stream(body: BetaMessageStreamParams, options?: { signal?: AbortSignal }): ChatStreamLike } };
}

/** Models that accept thinking.display "updates" (between-tool progress notes). */
const UPDATES_MODELS = /^claude-(opus-5-5|fable-5-1|fable-5|mythos-5-1|sonnet-5-5)/;
/** Models that accept the server-side refusal fallback in its "default" form. */
const FALLBACK_MODELS = /^claude-(opus-5-5|opus-5|fable-5-1|sonnet-5-5)(?!-)/;
/** Older models without the effort parameter. */
const NO_EFFORT = /haiku-4-5|sonnet-4-5|opus-4-1|claude-3/;

function toolDefinitions(tools: ToolDef[]): BetaTool[] {
  return tools.map(
    (t) =>
      ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as BetaTool["input_schema"],
        // tools take small inputs, but large inputs (PDB text) benefit from eager streaming
        eager_input_streaming: true,
      }) as BetaTool,
  );
}

function buildParams(model: string, system: BetaTextBlockParam[], tools: BetaTool[], messages: BetaMessageParam[]): BetaMessageStreamParams {
  const params: BetaMessageStreamParams = {
    model,
    max_tokens: MAX_TOKENS,
    system,
    tools,
    messages,
    // explicit breakpoint on the static system prompt (covers tools + system) and automatic
    // caching for the growing tool-loop tail
    cache_control: { type: "ephemeral" },
  };
  const betas: string[] = [];
  if (!NO_EFFORT.test(model)) params.output_config = { effort: (process.env.ANTHROPIC_EFFORT as "low" | "medium" | "high" | "xhigh" | "max") || DEFAULT_EFFORT };
  if (UPDATES_MODELS.test(model)) {
    params.thinking = { type: "adaptive", display: "updates" };
    betas.push("thinking-display-updates-2026-08-18");
  }
  if (FALLBACK_MODELS.test(model) && process.env.SPECTRE_DISABLE_FALLBACK !== "1") {
    params.fallbacks = "default";
    betas.push("server-side-fallback-2026-07-01");
  }
  if (betas.length) params.betas = betas;
  return params;
}

export class AnthropicSession implements ProviderSession {
  private messages: BetaMessageParam[];
  private tools: BetaTool[];

  constructor(
    private client: ChatClientLike,
    private model: string,
    tools: ToolDef[],
    history: HistoryMessage[],
  ) {
    this.tools = toolDefinitions(tools);
    this.messages = history.map((m) => ({ role: m.role, content: m.content }));
  }

  async turn(sys: SystemParts, onText: (text: string) => void, signal?: AbortSignal): Promise<TurnResult> {
    const system: BetaTextBlockParam[] = [
      { type: "text", text: sys.static, cache_control: { type: "ephemeral" } },
      { type: "text", text: sys.dynamic },
    ];
    let message: BetaMessage | undefined;
    for (let attempt = 0; ; attempt++) {
      const stream = this.client.beta.messages.stream(buildParams(this.model, system, this.tools, this.messages), { signal });
      const notes = new Map<number, string>();
      try {
        for await (const ev of stream) {
          if (ev.type === "content_block_delta") {
            if (ev.delta.type === "text_delta") onText(ev.delta.text);
            else if (ev.delta.type === "thinking_delta" && ev.delta.thinking) notes.set(ev.index, (notes.get(ev.index) ?? "") + ev.delta.thinking);
          } else if (ev.type === "content_block_stop") {
            // progress notes between tool calls (thinking.display "updates")
            const note = notes.get(ev.index)?.trim();
            if (note) onText(`_${note.replace(/\s*\n+\s*/g, " ")}_\n\n`);
            notes.delete(ev.index);
          }
        }
        message = await stream.finalMessage();
        break;
      } catch (e) {
        // the SDK raises a plain AnthropicError when an eager-streamed tool input is not
        // parseable JSON: re-issue the turn (capped); typed API errors propagate
        if (e instanceof Anthropic.APIError || !(e instanceof Anthropic.AnthropicError) || signal?.aborted || attempt >= 2) throw e;
      }
    }
    if (!message) return { stop: "end", toolCalls: [] };
    if (message.stop_reason === "refusal") return { stop: "refusal", toolCalls: [] };
    if (message.stop_reason === "pause_turn") {
      this.messages = [...this.messages, { role: "assistant", content: message.content as BetaContentBlockParam[] }];
      return { stop: "pause", toolCalls: [] };
    }
    const toolUses = message.content.filter((b): b is BetaToolUseBlock => b.type === "tool_use");
    if (!toolUses.length) return { stop: "end", toolCalls: [] };
    if (message.stop_reason === "max_tokens") return { stop: "max_tokens", toolCalls: [] };
    this.messages = [...this.messages, { role: "assistant", content: message.content as BetaContentBlockParam[] }];
    return { stop: "tool_calls", toolCalls: toolUses.map((tu) => ({ id: tu.id, name: tu.name, input: tu.input })) };
  }

  addToolResults(results: ToolResult[]): void {
    const blocks: BetaToolResultBlockParam[] = results.map((r) => ({
      type: "tool_result",
      tool_use_id: r.id,
      content: r.content,
      ...(r.isError ? { is_error: true } : {}),
    }));
    this.messages = [...this.messages, { role: "user", content: blocks }];
  }
}

export function newAnthropicClient(): ChatClientLike {
  return new Anthropic() as unknown as ChatClientLike;
}

export function describeAnthropicError(e: unknown, missingConfig: string): string | null {
  if (e instanceof Anthropic.AuthenticationError) return `Anthropic rejected the credentials (401). Check ANTHROPIC_API_KEY in spectre-web/.env.local.`;
  if (e instanceof Anthropic.PermissionDeniedError) return `The API key is not allowed to use this model (403): ${e.message}`;
  if (e instanceof Anthropic.NotFoundError) return `Model or endpoint not found (404) — check ANTHROPIC_MODEL: ${e.message}`;
  if (e instanceof Anthropic.RateLimitError) return "Claude API rate limit reached (429) — try again in a moment.";
  if (e instanceof Anthropic.BadRequestError) return `Claude API rejected the request (400): ${e.message}`;
  if (e instanceof Anthropic.APIError) return `Claude API error${e.status ? ` ${e.status}` : ""}: ${e.message}`;
  if (e instanceof Anthropic.AnthropicError) return `${e.message}. ${missingConfig}`;
  return null;
}
