// Common shape of a model provider for the chat loop: run one assistant turn (streaming text
// out through `onText`) and report the tool calls it made; then accept the tool results.
// Each provider keeps the conversation in its own wire format.

export interface ToolCall {
  id: string;
  name: string;
  /** parsed JSON arguments, or null when they could not be parsed (see parseError) */
  input: unknown;
  parseError?: string;
}

export type TurnStop = "end" | "tool_calls" | "max_tokens" | "refusal" | "pause";

export interface TurnResult {
  toolCalls: ToolCall[];
  stop: TurnStop;
}

export interface ToolResult {
  id: string;
  name: string;
  content: string;
  isError: boolean;
}

export interface SystemParts {
  /** static instructions (cacheable) */
  static: string;
  /** per-request project context */
  dynamic: string;
}

export interface ProviderSession {
  turn(system: SystemParts, onText: (text: string) => void, signal?: AbortSignal): Promise<TurnResult>;
  addToolResults(results: ToolResult[]): void;
}

/** A tool as offered to the model (shared JSON-schema description of an action). */
export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** Plain text history entry handed to a provider (already filtered, starts with the user). */
export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}
