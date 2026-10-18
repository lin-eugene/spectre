// End-to-end over real sockets: a tiny OpenAI-compatible server (node:http) streams a tool call
// and a final answer; the chat route handler runs the agent loop against it and streams
// ChatEvents back as SSE.
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/projects/[id]/chat/route";
import type { ChatEvent } from "@/lib/contract";
import { createProject } from "@/lib/project/store";

const requests: { model: string; stream: boolean; messages: { role: string }[] }[] = [];
let server: http.Server;
let base = "";
const saved = { url: process.env.OPENAI_BASE_URL, model: process.env.OPENAI_MODEL, key: process.env.OPENAI_API_KEY, prov: process.env.LLM_PROVIDER };

const chunk = (d: Record<string, unknown>, finish: string | null = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: d, finish_reason: finish }] })}\n\n`;

beforeAll(async () => {
  process.env.SPECTRE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "spectre-llm-int-"));
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
        res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "not found" } }));
        return;
      }
      const parsed = JSON.parse(body);
      requests.push(parsed);
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.write(": keep-alive\n\n");
      if (requests.length === 1) {
        res.write(chunk({ content: "Looking at spin system 1. " }));
        res.write(chunk({ tool_calls: [{ index: 0, id: "call_a", type: "function", function: { name: "get_residue", arguments: '{"resid' } }] }));
        res.write(chunk({ tool_calls: [{ index: 0, function: { arguments: 'ue":43}' } }] }));
        res.write(chunk({}, "tool_calls"));
      } else {
        res.write(chunk({ content: "Leu 43 is assigned with very high confidence." }, "stop"));
      }
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  process.env.OPENAI_BASE_URL = base;
  process.env.OPENAI_MODEL = "mock-tools-model";
  delete process.env.OPENAI_API_KEY;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  for (const [k, v] of [
    ["OPENAI_BASE_URL", saved.url],
    ["OPENAI_MODEL", saved.model],
    ["OPENAI_API_KEY", saved.key],
    ["LLM_PROVIDER", saved.prov],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function readEvents(res: Response): Promise<ChatEvent[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .map((b) => b.replace(/^data: /, "").trim())
    .filter(Boolean)
    .map((j) => JSON.parse(j) as ChatEvent);
}

describe("chat route with an OpenAI-compatible server", () => {
  it("streams the agent loop end-to-end over HTTP", async () => {
    const project = createProject();
    const req = new Request(`http://localhost/api/projects/${project.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "How is residue 43?" }], provider: "openai" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: project.id }) });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = await readEvents(res);
    const types = events.map((e) => e.type);
    expect(types).toContain("tool_start");
    expect(types).not.toContain("error");
    expect(events.find((e) => e.type === "tool_start")).toMatchObject({ name: "get_residue", input: { residue: 43 } });
    expect(events.find((e) => e.type === "tool_end")).toMatchObject({ ok: true });
    expect(events.some((e) => e.type === "ui" && e.action.type === "focus_residue" && e.action.residue === 43)).toBe(true);
    expect(types.at(-1)).toBe("done");
    expect(requests).toHaveLength(2);
    expect(requests[0].model).toBe("mock-tools-model");
    expect(requests[1].messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
  });

  it("rejects an unknown provider and accepts a model override", async () => {
    const project = createProject();
    const bad = await POST(
      new Request(`http://localhost/api/projects/${project.id}/chat`, { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "x" }], provider: "gemini" }) }),
      { params: Promise.resolve({ id: project.id }) },
    );
    expect(bad.status).toBe(400);
    requests.length = 0;
    const ok = await POST(
      new Request(`http://localhost/api/projects/${project.id}/chat`, {
        method: "POST",
        body: JSON.stringify({ messages: [{ role: "user", content: "x" }], provider: "openai", model: "other-model" }),
      }),
      { params: Promise.resolve({ id: project.id }) },
    );
    await readEvents(ok);
    expect(requests[0].model).toBe("other-model");
  });
});
