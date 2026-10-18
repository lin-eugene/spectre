// Server-side tool-use loop for the project chat, shared by every model provider (Claude via the
// Anthropic API, or any OpenAI-compatible Chat Completions endpoint). Streams ChatEvents: text
// deltas, tool_start/tool_end around each tool, UI effects, state_changed after mutations, done.
import type { ChatEvent, ChatMessage } from "../contract";
import { agentToolSpecs, compactForModel, runAction, type ActionOutcome } from "../project/actions";
import { addHistory, getProject, saveProject, withProject } from "../project/store";
import { anthropicAvailable, DEFAULT_ANTHROPIC_MODEL, defaultProvider, NOT_CONFIGURED_MESSAGE, openaiAvailable, openaiBaseURL, type ProviderId } from "./config";
import { AnthropicSession, describeAnthropicError, newAnthropicClient, type ChatClientLike } from "./providers/anthropic";
import { OpenAICompatError, OpenAISession, openaiOptionsFromEnv } from "./providers/openai";
import type { HistoryMessage, ProviderSession, ToolDef, ToolResult } from "./providers/types";
import { projectContext, SYSTEM_PROMPT, type UiContext } from "./system-prompt";

export type { ChatClientLike, ChatStreamLike } from "./providers/anthropic";

export const DEFAULT_MODEL = DEFAULT_ANTHROPIC_MODEL;
const MAX_ITERATIONS = 12;

export interface ChatRunOptions {
  projectId: string;
  messages: ChatMessage[];
  ui?: UiContext;
  emit: (event: ChatEvent) => void;
  /** which provider to use (default: LLM_PROVIDER / whichever is configured) */
  provider?: ProviderId;
  /** model override for this request */
  model?: string;
  /** injected Anthropic client (tests); implies provider "anthropic" */
  client?: ChatClientLike;
  /** injected fetch for the OpenAI-compatible provider (tests) */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  maxIterations?: number;
}

/** Credentials for at least one provider are configured. */
export function hasCredentials(): boolean {
  return anthropicAvailable() || openaiAvailable();
}

export const MISSING_KEY_MESSAGE = NOT_CONFIGURED_MESSAGE;

function toHistory(messages: ChatMessage[]): HistoryMessage[] {
  const out: HistoryMessage[] = [];
  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const text = typeof m.content === "string" ? m.content.trim() : "";
    if (!text) continue;
    if (!out.length && m.role !== "user") continue; // history must start with the user
    out.push({ role: m.role, content: text });
  }
  return out;
}

async function executeTool(projectId: string, name: string, input: unknown): Promise<ActionOutcome> {
  const args = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
  if (!args) return { ok: false, error: "tool input must be a JSON object", summary: "invalid tool input" };
  const done = await withProject(projectId, async (state) => {
    const outcome = await runAction(state, name, args, { actor: "agent" });
    if (outcome.changed) {
      addHistory(state, "agent", name, outcome.summary);
      saveProject(state);
    }
    return outcome;
  });
  return done ? done.value : { ok: false, error: "project not found", summary: "project not found" };
}

function describeError(e: unknown): string {
  if (e instanceof OpenAICompatError) return e.message;
  const anthropic = describeAnthropicError(e, MISSING_KEY_MESSAGE);
  if (anthropic) return anthropic;
  return e instanceof Error ? e.message : String(e);
}

/** Pick the provider for this request, or explain why none can be used. */
function resolveSession(opts: ChatRunOptions, tools: ToolDef[], history: HistoryMessage[]): ProviderSession | string {
  const provider: ProviderId | null = opts.client ? "anthropic" : (opts.provider ?? defaultProvider());
  if (!provider) return MISSING_KEY_MESSAGE;
  if (provider === "anthropic") {
    if (!opts.client && !anthropicAvailable()) return `Claude is not configured on this server. ${MISSING_KEY_MESSAGE}`;
    const model = opts.model || process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
    return new AnthropicSession(opts.client ?? newAnthropicClient(), model, tools, history);
  }
  if (!opts.fetchImpl && !openaiAvailable()) return `No OpenAI-compatible endpoint is configured on this server. ${MISSING_KEY_MESSAGE}`;
  const model = (opts.model || process.env.OPENAI_MODEL || "").trim();
  if (!model) return "The OpenAI-compatible provider needs a model name: set OPENAI_MODEL in spectre-web/.env.local or type a model in the chat header.";
  return new OpenAISession({ ...openaiOptionsFromEnv(model, openaiBaseURL()), fetchImpl: opts.fetchImpl }, tools, history);
}

/** Run one chat turn (possibly many tool rounds). Always ends with a `done` event. */
export async function runChat(opts: ChatRunOptions): Promise<void> {
  const emit = (ev: ChatEvent) => {
    try {
      opts.emit(ev);
    } catch {
      // the client went away; keep going so state stays consistent
    }
  };
  try {
    const state = getProject(opts.projectId);
    if (!state) {
      emit({ type: "error", message: "Project not found." });
      return;
    }
    const history = toHistory(opts.messages);
    if (!history.length || history[history.length - 1].role !== "user") {
      emit({ type: "error", message: "Send a user message to start." });
      return;
    }
    const tools = agentToolSpecs() as ToolDef[];
    const session = resolveSession(opts, tools, history);
    if (typeof session === "string") {
      emit({ type: "error", message: session });
      return;
    }
    const maxIterations = opts.maxIterations ?? MAX_ITERATIONS;
    const onText = (text: string) => {
      if (text) emit({ type: "text_delta", text });
    };

    for (let iteration = 0; ; iteration++) {
      if (opts.signal?.aborted) return;
      if (iteration >= maxIterations) {
        emit({ type: "text_delta", text: `\n\n_(Stopped after ${maxIterations} tool rounds — ask me to continue.)_` });
        return;
      }
      const current = getProject(opts.projectId) ?? state;
      const turn = await session.turn({ static: SYSTEM_PROMPT, dynamic: projectContext(current, opts.ui) }, onText, opts.signal);
      if (turn.stop === "refusal") {
        emit({ type: "text_delta", text: "\n\n_(The model declined to continue this request.)_" });
        return;
      }
      if (turn.stop === "pause") continue;
      if (turn.stop === "max_tokens") {
        emit({ type: "error", message: "The reply hit the output limit before a tool call completed; ask again more narrowly." });
        return;
      }
      if (!turn.toolCalls.length) return;

      const results: ToolResult[] = [];
      for (const call of turn.toolCalls) {
        emit({ type: "tool_start", id: call.id, name: call.name, input: call.input ?? {} });
        const outcome: ActionOutcome = call.parseError
          ? { ok: false, error: call.parseError, summary: "invalid tool arguments" }
          : await executeTool(opts.projectId, call.name, call.input);
        for (const action of outcome.ui ?? []) emit({ type: "ui", action });
        if (outcome.changed) emit({ type: "state_changed" });
        emit({ type: "tool_end", id: call.id, name: call.name, ok: outcome.ok, summary: outcome.ok ? outcome.summary : outcome.error ?? outcome.summary });
        results.push({ id: call.id, name: call.name, content: compactForModel(outcome), isError: !outcome.ok });
      }
      session.addToolResults(results);
    }
  } catch (e) {
    if (!opts.signal?.aborted) emit({ type: "error", message: describeError(e) });
  } finally {
    emit({ type: "done" });
  }
}
