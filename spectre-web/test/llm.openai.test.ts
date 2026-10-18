import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { runChat } from "@/lib/agent/chat";
import { agentConfig, defaultProvider } from "@/lib/agent/config";
import { parseToolArguments } from "@/lib/agent/providers/openai";
import { ACTION_NAMES, type ChatEvent } from "@/lib/contract";
import { UI_TOOLS } from "@/lib/project/actions";
import { createProject, getProject } from "@/lib/project/store";

/** A one-atom structure: enough for import_pdb, a tool that changes the project. */
const TINY_PDB = "ATOM      1  CA  ALA A   1       0.000   0.000   0.000  1.00  0.00           C";

type Reply = { status?: number; json?: unknown; sse?: unknown[]; raw?: string; contentType?: string };

/** Fake OpenAI-compatible server: one scripted reply per request, SSE split into small byte chunks. */
function fakeFetch(replies: Reply[]) {
  const bodies: Record<string, unknown>[] = [];
  const urls: string[] = [];
  const headers: Record<string, string>[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    urls.push(String(url));
    headers.push(Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)));
    bodies.push(JSON.parse(String(init?.body ?? "{}")));
    const r = replies[bodies.length - 1];
    if (!r) throw new Error("unexpected extra request");
    if (r.sse) {
      const text = r.sse.map((c) => `data: ${typeof c === "string" ? c : JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
      const enc = new TextEncoder().encode(text);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let i = 0; i < enc.length; i += 17) controller.enqueue(enc.slice(i, i + 17));
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    const body = r.raw ?? JSON.stringify(r.json ?? {});
    return new Response(body, { status: r.status ?? 200, headers: { "content-type": r.contentType ?? "application/json" } });
  }) as typeof fetch;
  return { impl, bodies, urls, headers };
}

const delta = (d: Record<string, unknown>, finish: string | null = null) => ({ id: "x", object: "chat.completion.chunk", choices: [{ index: 0, delta: d, finish_reason: finish }] });

async function collect(opts: Omit<Parameters<typeof runChat>[0], "emit">): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  await runChat({ ...opts, emit: (e) => events.push(e) });
  return events;
}

const text = (events: ChatEvent[]) =>
  events
    .filter((e): e is Extract<ChatEvent, { type: "text_delta" }> => e.type === "text_delta")
    .map((e) => e.text)
    .join("");

const ENV_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_MODEL", "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL", "OPENAI_EXTRA_HEADERS", "OPENAI_MAX_TOKENS", "OPENAI_TOKENS_PARAM", "OPENAI_TEMPERATURE", "OPENAI_API", "OPENAI_REASONING_EFFORT", "LLM_PROVIDER"];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
function setEnv(vars: Record<string, string>) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, vars);
}

beforeAll(() => {
  process.env.SPECTRE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "spectre-llm-"));
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("OpenAI-compatible provider", () => {
  it("streams text, assembles a tool call split across chunks, runs it and continues", async () => {
    setEnv({ OPENAI_BASE_URL: "http://llm.local/v1", OPENAI_MODEL: "qwen3-32b", OPENAI_API_KEY: "sk-test-secret" });
    const project = createProject();
    const f = fakeFetch([
      {
        sse: [
          delta({ role: "assistant", content: "" }),
          delta({ content: "Checking residue " }),
          delta({ content: "23." }),
          delta({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "get_residue", arguments: "" } }] }),
          delta({ tool_calls: [{ index: 0, function: { arguments: '{"resi' } }] }),
          delta({ tool_calls: [{ index: 0, function: { arguments: 'due": 23}' } }] }),
          delta({}, "tool_calls"),
        ],
      },
      { sse: [delta({ content: "Ile 23 is " }), delta({ content: "confidently assigned." }, "stop")] },
    ]);
    const events = await collect({ projectId: project.id, messages: [{ role: "user", content: "Tell me about residue 23" }], fetchImpl: f.impl });
    const types = events.map((e) => e.type);
    expect(types.at(-1)).toBe("done");
    expect(types).not.toContain("error");
    const start = types.indexOf("tool_start");
    const end = types.indexOf("tool_end");
    expect(events[start]).toMatchObject({ type: "tool_start", id: "call_1", name: "get_residue", input: { residue: 23 } });
    expect(events.slice(start, end).some((e) => e.type === "ui" && e.action.type === "focus_residue" && e.action.residue === 23)).toBe(true);
    expect(events[end]).toMatchObject({ type: "tool_end", id: "call_1", ok: true });
    expect(text(events)).toBe("Checking residue 23.Ile 23 is confidently assigned.");

    // request shape
    expect(f.urls).toEqual(["http://llm.local/v1/chat/completions", "http://llm.local/v1/chat/completions"]);
    expect(f.headers[0].authorization).toBe("Bearer sk-test-secret");
    const first = f.bodies[0] as { model: string; stream: boolean; tool_choice: string; tools: { type: string; function: { name: string; parameters: { type: string } } }[]; messages: { role: string; content: string }[] };
    expect(first.model).toBe("qwen3-32b");
    expect(first.stream).toBe(true);
    expect(first.tool_choice).toBe("auto");
    expect(first.tools).toHaveLength(ACTION_NAMES.length + UI_TOOLS.length);
    expect(first.tools.every((t) => t.type === "function" && t.function.parameters.type === "object")).toBe(true);
    expect(first.messages[0].role).toBe("system");
    expect(first.messages[0].content).toContain("Spectre copilot");
    expect(first.messages[0].content).toContain("Ubiquitin");
    expect(first.messages[1]).toEqual({ role: "user", content: "Tell me about residue 23" });
    expect("temperature" in first).toBe(false);
    expect("max_tokens" in first || "max_completion_tokens" in first).toBe(false);
    const second = f.bodies[1] as { messages: Record<string, unknown>[] };
    expect(second.messages).toHaveLength(4);
    expect(second.messages[2]).toEqual({
      role: "assistant",
      content: "Checking residue 23.",
      tool_calls: [{ id: "call_1", type: "function", function: { name: "get_residue", arguments: '{"residue": 23}' } }],
    });
    expect(second.messages[3]).toMatchObject({ role: "tool", tool_call_id: "call_1" });
    expect(String(second.messages[3].content)).toContain("ILE 23");
  });

  it("falls back to a non-streaming request when the server rejects streaming with tools", async () => {
    setEnv({ OPENAI_BASE_URL: "http://localhost:11434/v1", OPENAI_MODEL: "llama3.1" });
    const project = createProject();
    const f = fakeFetch([
      { status: 400, json: { error: { message: "streaming is not supported with tools" } } },
      {
        json: {
          choices: [
            {
              message: { role: "assistant", content: null, tool_calls: [{ id: "c9", type: "function", function: { name: "import_pdb", arguments: JSON.stringify({ text: TINY_PDB }) } }] },
              finish_reason: "tool_calls",
            },
          ],
        },
      },
      { json: { choices: [{ message: { role: "assistant", content: "Loaded the structure." }, finish_reason: "stop" }] } },
    ]);
    const events = await collect({ projectId: project.id, messages: [{ role: "user", content: "load this structure" }], fetchImpl: f.impl });
    expect(f.bodies.map((b) => b.stream)).toEqual([true, false, false]);
    expect(f.headers[0].authorization).toBeUndefined(); // no key configured: local server
    expect(events.filter((e) => e.type === "state_changed")).toHaveLength(1);
    expect(events.find((e) => e.type === "tool_end")).toMatchObject({ id: "c9", ok: true });
    expect(getProject(project.id)!.pdb?.text).toBe(TINY_PDB);
    expect(text(events)).toBe("Loaded the structure.");
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("reports malformed tool arguments back to the model instead of crashing", async () => {
    setEnv({ OPENAI_BASE_URL: "http://llm.local/v1", OPENAI_MODEL: "m" });
    const project = createProject();
    const f = fakeFetch([
      { sse: [delta({ tool_calls: [{ index: 0, id: "bad", function: { name: "get_residue", arguments: '{"residue": ' } }] }, "tool_calls")] },
      { sse: [delta({ content: "Sorry, retrying differently." }, "stop")] },
    ]);
    const events = await collect({ projectId: project.id, messages: [{ role: "user", content: "residue?" }], fetchImpl: f.impl });
    const end = events.find((e): e is Extract<ChatEvent, { type: "tool_end" }> => e.type === "tool_end")!;
    expect(end.ok).toBe(false);
    expect(end.summary).toMatch(/not valid JSON/);
    const toolMsg = (f.bodies[1] as { messages: { role: string; content: string }[] }).messages.find((m) => m.role === "tool")!;
    expect(toolMsg.content).toContain('"ok":false');
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("handles servers that ignore stream:true, finish_reason stop with tool calls, and missing ids", async () => {
    setEnv({ OPENAI_BASE_URL: "http://llm.local/v1", OPENAI_MODEL: "m" });
    const project = createProject();
    const f = fakeFetch([
      { json: { choices: [{ message: { content: "", tool_calls: [{ type: "function", function: { name: "ui_focus_residue", arguments: { residue: 5 } } }] }, finish_reason: "stop" }] } },
      { json: { choices: [{ message: { content: "Focused residue 5." }, finish_reason: "stop" }] } },
    ]);
    const events = await collect({ projectId: project.id, messages: [{ role: "user", content: "show 5" }], fetchImpl: f.impl });
    const startEv = events.find((e): e is Extract<ChatEvent, { type: "tool_start" }> => e.type === "tool_start")!;
    expect(startEv.name).toBe("ui_focus_residue");
    expect(startEv.id).toMatch(/^call_/);
    expect(events.some((e) => e.type === "ui" && e.action.type === "focus_residue")).toBe(true);
    expect(text(events)).toBe("Focused residue 5.");
    const assistant = (f.bodies[1] as { messages: { role: string; tool_calls?: { id: string; function: { arguments: string } }[] }[] }).messages.find((m) => m.role === "assistant")!;
    expect(assistant.tool_calls![0].function.arguments).toBe('{"residue":5}');
  });

  it("explains HTTP errors (404, missing tool support) clearly", async () => {
    setEnv({ OPENAI_BASE_URL: "http://llm.local/v1", OPENAI_MODEL: "tiny" });
    const project = createProject();
    let f = fakeFetch([{ status: 404, json: { error: { message: "model 'tiny' not found" } } }]);
    let events = await collect({ projectId: project.id, messages: [{ role: "user", content: "hi" }], fetchImpl: f.impl });
    expect(events[0]).toMatchObject({ type: "error" });
    expect((events[0] as { message: string }).message).toMatch(/OPENAI_BASE_URL/);
    f = fakeFetch([
      { status: 400, json: { error: { message: "registry.ollama.ai/library/tiny does not support tools" } } },
      { status: 400, json: { error: { message: "registry.ollama.ai/library/tiny does not support tools" } } },
    ]);
    events = await collect({ projectId: project.id, messages: [{ role: "user", content: "hi" }], fetchImpl: f.impl });
    expect((events[0] as { message: string }).message).toMatch(/does not support tool calling/);
  });

  it("needs a model name and honours a per-request model override", async () => {
    setEnv({ OPENAI_BASE_URL: "http://llm.local/v1" });
    const project = createProject();
    let events = await collect({ projectId: project.id, messages: [{ role: "user", content: "hi" }], provider: "openai" });
    expect((events[0] as { message: string }).message).toMatch(/model name/);
    const f = fakeFetch([{ sse: [delta({ content: "hello" }, "stop")] }]);
    events = await collect({ projectId: project.id, messages: [{ role: "user", content: "hi" }], provider: "openai", model: "gpt-oss-20b", fetchImpl: f.impl });
    expect(f.bodies[0].model).toBe("gpt-oss-20b");
    expect(text(events)).toBe("hello");
  });

  it("sends optional token limit, temperature and extra headers from the environment", async () => {
    setEnv({
      OPENAI_API: "chat",
      OPENAI_API_KEY: "sk-x",
      OPENAI_MODEL: "gpt-x",
      OPENAI_MAX_TOKENS: "4096",
      OPENAI_TEMPERATURE: "0.2",
      OPENAI_EXTRA_HEADERS: '{"HTTP-Referer":"https://spectre.local","X-Title":"Spectre"}',
    });
    const project = createProject();
    const f = fakeFetch([{ sse: [delta({ content: "ok" }, "stop")] }]);
    await collect({ projectId: project.id, messages: [{ role: "user", content: "hi" }], fetchImpl: f.impl });
    expect(f.urls[0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(f.bodies[0].max_completion_tokens).toBe(4096); // OpenAI's own API
    expect(f.bodies[0].temperature).toBe(0.2);
    expect(f.headers[0]["HTTP-Referer"]).toBe("https://spectre.local");
  });
});

const message = (t: string) => ({ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: t, annotations: [] }] });

describe("OpenAI Responses API", () => {
  it("is used for api.openai.com: streams text, runs a tool and passes encrypted reasoning back", async () => {
    setEnv({ OPENAI_API_KEY: "sk-x", OPENAI_MODEL: "gpt-6.1-sol", OPENAI_REASONING_EFFORT: "high", OPENAI_MAX_TOKENS: "8000" });
    const project = createProject();
    const reasoning = { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "gAAAA-opaque" };
    const said = { ...message("Checking residue 23."), id: "msg_1" };
    const call = { type: "function_call", id: "fc_1", call_id: "call_a", name: "get_residue", arguments: '{"residue": 23}', status: "completed" };
    const f = fakeFetch([
      {
        sse: [
          { type: "response.created", response: { status: "in_progress", output: [] } },
          { type: "response.output_item.done", output_index: 0, item: reasoning },
          { type: "response.output_text.delta", output_index: 1, delta: "Checking residue " },
          { type: "response.output_text.delta", output_index: 1, delta: "23." },
          { type: "response.output_item.done", output_index: 1, item: said },
          { type: "response.function_call_arguments.delta", output_index: 2, delta: '{"residue": 23}' },
          { type: "response.output_item.done", output_index: 2, item: call },
          { type: "response.completed", response: { status: "completed", output: [reasoning, said, call] } },
        ],
      },
      {
        sse: [
          { type: "response.output_text.delta", output_index: 0, delta: "Ile 23 is confidently assigned." },
          { type: "response.completed", response: { status: "completed", output: [message("Ile 23 is confidently assigned.")] } },
        ],
      },
    ]);
    const events = await collect({ projectId: project.id, messages: [{ role: "user", content: "Tell me about residue 23" }], fetchImpl: f.impl });
    expect(events.map((e) => e.type)).not.toContain("error");
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(events.find((e) => e.type === "tool_start")).toMatchObject({ id: "call_a", name: "get_residue", input: { residue: 23 } });
    expect(events.find((e) => e.type === "tool_end")).toMatchObject({ id: "call_a", ok: true });
    expect(text(events)).toBe("Checking residue 23.Ile 23 is confidently assigned.");

    expect(f.urls).toEqual(["https://api.openai.com/v1/responses", "https://api.openai.com/v1/responses"]);
    const first = f.bodies[0] as Record<string, unknown> & { tools: Record<string, unknown>[]; instructions: string };
    expect(first).toMatchObject({
      model: "gpt-6.1-sol",
      stream: true,
      store: false,
      tool_choice: "auto",
      include: ["reasoning.encrypted_content"],
      reasoning: { effort: "high" },
      max_output_tokens: 8000,
      input: [{ role: "user", content: "Tell me about residue 23" }],
    });
    expect(first.instructions).toContain("Spectre copilot");
    expect(first.tools).toHaveLength(ACTION_NAMES.length + UI_TOOLS.length);
    expect(first.tools.every((t) => t.type === "function" && typeof t.name === "string" && t.strict === false && (t.parameters as { type: string }).type === "object")).toBe(true);
    expect("messages" in first).toBe(false);
    const input = (f.bodies[1] as { input: Record<string, unknown>[] }).input;
    expect(input.slice(1, 4)).toEqual([reasoning, said, call]);
    expect(input[4]).toMatchObject({ type: "function_call_output", call_id: "call_a" });
    expect(String(input[4].output)).toContain("ILE 23");
  });

  it("takes over when a Chat Completions endpoint says the model needs /v1/responses", async () => {
    setEnv({ OPENAI_BASE_URL: "https://gateway.example/v1", OPENAI_MODEL: "gpt-6.1-sol", OPENAI_API_KEY: "k" });
    const project = createProject();
    const refusal =
      "Function tools with reasoning_effort are not supported for gpt-6.1-sol in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'.";
    const f = fakeFetch([
      { status: 400, json: { error: { message: refusal, type: "invalid_request_error", param: "reasoning_effort" } } },
      { sse: [{ type: "response.output_text.delta", delta: "Hello." }, { type: "response.completed", response: { status: "completed", output: [message("Hello.")] } }] },
    ]);
    const events = await collect({ projectId: project.id, messages: [{ role: "user", content: "hi" }], fetchImpl: f.impl });
    expect(f.urls).toEqual(["https://gateway.example/v1/chat/completions", "https://gateway.example/v1/responses"]);
    expect(events.map((e) => e.type)).not.toContain("error");
    expect(text(events)).toBe("Hello.");
  });

  it("drops request fields the model rejects, and reasoning it cannot pass back", async () => {
    setEnv({ OPENAI_API: "responses", OPENAI_BASE_URL: "http://llm.local/v1", OPENAI_MODEL: "m", OPENAI_REASONING_EFFORT: "low" });
    const project = createProject();
    const f = fakeFetch([
      { status: 400, json: { error: { message: "Unsupported parameter: 'reasoning.effort' is not supported with this model.", param: "reasoning.effort" } } },
      {
        json: {
          status: "completed",
          output: [
            { type: "reasoning", id: "rs_9", summary: [] },
            { type: "function_call", id: "fc_9", call_id: "call_9", name: "ui_focus_residue", arguments: '{"residue":5}' },
          ],
        },
      },
      { json: { status: "completed", output: [message("Focused residue 5.")] } },
    ]);
    const events = await collect({ projectId: project.id, messages: [{ role: "user", content: "show 5" }], fetchImpl: f.impl });
    expect(f.urls.every((u) => u === "http://llm.local/v1/responses")).toBe(true);
    expect(f.bodies[0].reasoning).toEqual({ effort: "low" });
    expect("reasoning" in f.bodies[1]).toBe(false);
    expect("reasoning" in f.bodies[2]).toBe(false);
    expect(events.some((e) => e.type === "ui" && e.action.type === "focus_residue")).toBe(true);
    expect(text(events)).toBe("Focused residue 5.");
    const input = (f.bodies[2] as { input: Record<string, unknown>[] }).input;
    expect(input.some((i) => i.type === "reasoning")).toBe(false);
    expect(input.find((i) => i.type === "function_call")).toEqual({ type: "function_call", call_id: "call_9", name: "ui_focus_residue", arguments: '{"residue":5}' });
    expect(input.at(-1)).toMatchObject({ type: "function_call_output", call_id: "call_9" });
  });
});

describe("provider configuration", () => {
  it("lists providers without secrets and picks the default", () => {
    setEnv({ OPENAI_BASE_URL: "http://localhost:11434/v1/", OPENAI_MODEL: "llama3.1", OPENAI_API_KEY: "sk-super-secret" });
    const cfg = agentConfig();
    expect(cfg.default).toBe("openai");
    expect(cfg.providers.find((p) => p.id === "openai")).toMatchObject({ available: true, model: "llama3.1", baseURL: "http://localhost:11434/v1", host: "localhost:11434" });
    expect(cfg.providers.find((p) => p.id === "anthropic")).toMatchObject({ available: false });
    expect(JSON.stringify(cfg)).not.toContain("sk-super-secret");

    setEnv({ ANTHROPIC_API_KEY: "sk-ant-secret", OPENAI_BASE_URL: "http://localhost:11434/v1", OPENAI_MODEL: "llama3.1" });
    expect(defaultProvider()).toBe("anthropic");
    process.env.LLM_PROVIDER = "openai";
    expect(defaultProvider()).toBe("openai");
    expect(JSON.stringify(agentConfig())).not.toContain("sk-ant-secret");
    setEnv({});
    expect(defaultProvider()).toBeNull();
  });

  it("parses tool arguments defensively", () => {
    expect(parseToolArguments("")).toEqual({ input: {} });
    expect(parseToolArguments('{"a":1}')).toEqual({ input: { a: 1 } });
    expect(parseToolArguments({ a: 1 })).toEqual({ input: { a: 1 } });
    expect(parseToolArguments('{"a":1}{"a":1}').input).toEqual({ a: 1 });
    expect(parseToolArguments("[1,2]").error).toMatch(/JSON object/);
    expect(parseToolArguments("{oops").error).toMatch(/not valid JSON/);
  });
});
