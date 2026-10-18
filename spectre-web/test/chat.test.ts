import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { BetaMessage, BetaMessageStreamParams, BetaRawMessageStreamEvent } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { runChat, MISSING_KEY_MESSAGE, type ChatClientLike, type ChatStreamLike } from "@/lib/agent/chat";
import { ACTION_NAMES, type ChatEvent } from "@/lib/contract";
import { UI_TOOLS } from "@/lib/project/actions";
import { createProject, getProject } from "@/lib/project/store";

/** A one-atom structure: enough for import_pdb, a tool that changes the project. */
const TINY_PDB = "ATOM      1  CA  ALA A   1       0.000   0.000   0.000  1.00  0.00           C";

type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } | { type: "thinking"; thinking: string; signature: string };

/** Scripted fake of client.beta.messages.stream: one scripted turn per call. */
function fakeClient(turns: { blocks: Block[]; stop: string }[]) {
  const calls: BetaMessageStreamParams[] = [];
  const client: ChatClientLike = {
    beta: {
      messages: {
        stream(body: BetaMessageStreamParams): ChatStreamLike {
          calls.push(structuredClone(body));
          const turn = turns[calls.length - 1];
          if (!turn) throw new Error("unexpected extra model call");
          const events: BetaRawMessageStreamEvent[] = [];
          turn.blocks.forEach((b, index) => {
            if (b.type === "text") {
              events.push({ type: "content_block_start", index, content_block: { type: "text", text: "", citations: null } } as unknown as BetaRawMessageStreamEvent);
              for (const piece of b.text.match(/.{1,7}/g) ?? []) events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: piece } } as unknown as BetaRawMessageStreamEvent);
            } else if (b.type === "thinking") {
              events.push({ type: "content_block_start", index, content_block: { type: "thinking", thinking: "", signature: "" } } as unknown as BetaRawMessageStreamEvent);
              events.push({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: b.thinking } } as unknown as BetaRawMessageStreamEvent);
            } else {
              events.push({ type: "content_block_start", index, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } } as unknown as BetaRawMessageStreamEvent);
            }
            events.push({ type: "content_block_stop", index } as unknown as BetaRawMessageStreamEvent);
          });
          const message = { id: `msg_${calls.length}`, type: "message", role: "assistant", model: body.model, content: turn.blocks, stop_reason: turn.stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } } as unknown as BetaMessage;
          return {
            async *[Symbol.asyncIterator]() {
              for (const e of events) yield e;
            },
            finalMessage: async () => message,
          };
        },
      },
    },
  };
  return { client, calls };
}

async function collect(opts: Omit<Parameters<typeof runChat>[0], "emit">): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  await runChat({ ...opts, emit: (e) => events.push(e) });
  return events;
}

beforeAll(() => {
  process.env.SPECTRE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "spectre-chat-"));
});

describe("chat loop", () => {
  it("streams text, runs tools, forwards UI effects and finishes", async () => {
    const project = createProject();
    const { client, calls } = fakeClient([
      {
        blocks: [
          { type: "text", text: "Let me look at residue 23." },
          { type: "tool_use", id: "tu_1", name: "get_residue", input: { residue: 23 } },
        ],
        stop: "tool_use",
      },
      { blocks: [{ type: "text", text: "Ile 23 starts the helix and is confidently assigned." }], stop: "end_turn" },
    ]);
    const events = await collect({ projectId: project.id, messages: [{ role: "user", content: "Tell me about residue 23" }], client });
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("text_delta");
    expect(types.at(-1)).toBe("done");
    expect(types.filter((t) => t === "done")).toHaveLength(1);
    const start = types.indexOf("tool_start");
    const end = types.indexOf("tool_end");
    expect(start).toBeGreaterThan(0);
    expect(events[start]).toMatchObject({ type: "tool_start", id: "tu_1", name: "get_residue", input: { residue: 23 } });
    expect(events.slice(start, end).some((e) => e.type === "ui" && e.action.type === "focus_residue" && e.action.residue === 23)).toBe(true);
    expect(events[end]).toMatchObject({ type: "tool_end", id: "tu_1", ok: true });
    expect(types).not.toContain("state_changed"); // read-only tool
    const text = events.filter((e): e is Extract<ChatEvent, { type: "text_delta" }> => e.type === "text_delta").map((e) => e.text).join("");
    expect(text).toContain("Let me look at residue 23.");
    expect(text).toContain("confidently assigned");

    // request shape: model, cached static system prompt + dynamic context, all tools, tool results
    expect(calls).toHaveLength(2);
    const first = calls[0];
    expect(first.model).toBe(process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5");
    const system = first.system as { text: string; cache_control?: unknown }[];
    expect(system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(system[1].text).toContain("Ubiquitin");
    expect(first.cache_control).toEqual({ type: "ephemeral" });
    expect(first.tools).toHaveLength(ACTION_NAMES.length + UI_TOOLS.length);
    expect((first.tools as { eager_input_streaming?: boolean }[]).every((t) => t.eager_input_streaming === true)).toBe(true);
    expect(JSON.stringify(calls[0].tools)).toBe(JSON.stringify(calls[1].tools)); // stable bytes for caching
    const second = calls[1].messages;
    expect(second).toHaveLength(3);
    const toolResult = (second[2].content as { type: string; tool_use_id: string; content: string }[])[0];
    expect(toolResult.type).toBe("tool_result");
    expect(toolResult.tool_use_id).toBe("tu_1");
    expect(toolResult.content).toContain("ILE 23");
  });

  it("emits state_changed after mutating tools, reports tool errors, shows progress notes", async () => {
    const project = createProject();
    const { client, calls } = fakeClient([
      {
        blocks: [
          { type: "thinking", thinking: "Loading the structure, then re-checking.", signature: "sig" },
          { type: "tool_use", id: "tu_a", name: "import_pdb", input: { text: TINY_PDB } },
          { type: "tool_use", id: "tu_b", name: "get_spin_system", input: { root: "no-such-root" } },
        ],
        stop: "tool_use",
      },
      { blocks: [{ type: "text", text: "Done." }], stop: "end_turn" },
    ]);
    const events = await collect({ projectId: project.id, messages: [{ role: "user", content: "load this structure" }], client });
    expect(events.some((e) => e.type === "text_delta" && e.text.includes("Loading the structure"))).toBe(true);
    expect(events.filter((e) => e.type === "state_changed")).toHaveLength(1);
    const ends = events.filter((e): e is Extract<ChatEvent, { type: "tool_end" }> => e.type === "tool_end");
    expect(ends.map((e) => [e.id, e.ok])).toEqual([
      ["tu_a", true],
      ["tu_b", false],
    ]);
    expect(getProject(project.id)!.pdb?.text).toBe(TINY_PDB);
    expect(getProject(project.id)!.history.at(-1)).toMatchObject({ actor: "agent", action: "import_pdb" });
    const results = calls[1].messages[2].content as { tool_use_id: string; is_error?: boolean }[];
    expect(results.map((r) => [r.tool_use_id, r.is_error ?? false])).toEqual([
      ["tu_a", false],
      ["tu_b", true],
    ]);
    // the assistant turn (with its thinking block) is passed back unchanged
    expect((calls[1].messages[1].content as { type: string }[]).map((b) => b.type)).toEqual(["thinking", "tool_use", "tool_use"]);
  });

  it("stops after the iteration cap", async () => {
    const project = createProject();
    const loop = { blocks: [{ type: "tool_use", id: "tu_x", name: "ui_focus_residue", input: { residue: 5 } }] as Block[], stop: "tool_use" };
    const { client } = fakeClient([loop, loop, loop]);
    const events = await collect({ projectId: project.id, messages: [{ role: "user", content: "loop" }], client, maxIterations: 2 });
    expect(events.filter((e) => e.type === "tool_start")).toHaveLength(2);
    expect(events.some((e) => e.type === "text_delta" && e.text.includes("Stopped after 2"))).toBe(true);
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("explains how to configure a model when none is set", async () => {
    const project = createProject();
    const keys = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL", "LLM_PROVIDER"];
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const k of keys) delete process.env[k];
    try {
      const events = await collect({ projectId: project.id, messages: [{ role: "user", content: "hi" }] });
      expect(events).toEqual([{ type: "error", message: MISSING_KEY_MESSAGE }, { type: "done" }]);
      expect(MISSING_KEY_MESSAGE).toContain("ANTHROPIC_API_KEY");
      expect(MISSING_KEY_MESSAGE).toContain("OPENAI_BASE_URL");
    } finally {
      for (const k of keys) if (saved[k] !== undefined) process.env[k] = saved[k];
    }
  });

  it("rejects unknown projects and empty conversations", async () => {
    expect(await collect({ projectId: "00000000-0000-0000-0000-000000000000", messages: [{ role: "user", content: "x" }] })).toEqual([
      { type: "error", message: "Project not found." },
      { type: "done" },
    ]);
    const project = createProject();
    const ev = await collect({ projectId: project.id, messages: [{ role: "assistant", content: "hello" }], client: fakeClient([]).client });
    expect(ev[0]).toMatchObject({ type: "error" });
  });
});
