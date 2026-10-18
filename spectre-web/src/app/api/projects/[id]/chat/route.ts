import { runChat } from "@/lib/agent/chat";
import { isProviderId } from "@/lib/agent/config";
import type { UiContext } from "@/lib/agent/system-prompt";
import type { ChatEvent, ChatMessage } from "@/lib/contract";
import { getProject } from "@/lib/project/store";

export const maxDuration = 300;

/**
 * POST /api/projects/[id]/chat {messages: ChatMessage[], ui?: {selectedResidue, selectedRoot, spectrumView},
 *   provider?: "anthropic" | "openai", model?: string}
 * → text/event-stream of ChatEvent lines (`data: <json>\n\n`), always ending with {type:"done"}.
 * provider/model override the server default (see GET /api/agent/config).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getProject(id)) return Response.json({ error: "project not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { messages?: ChatMessage[]; ui?: UiContext; provider?: unknown; model?: unknown } | null;
  if (!body || !Array.isArray(body.messages)) return Response.json({ error: "body must be {messages: [{role, content}]}" }, { status: 400 });
  if (body.provider !== undefined && body.provider !== null && !isProviderId(body.provider))
    return Response.json({ error: 'provider must be "anthropic" or "openai"' }, { status: 400 });
  const provider = isProviderId(body.provider) ? body.provider : undefined;
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim().slice(0, 200) : undefined;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (event: ChatEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          open = false;
        }
      };
      await runChat({ projectId: id, messages: body.messages!, ui: body.ui, provider, model, emit, signal: request.signal });
      open = false;
      try {
        controller.close();
      } catch {
        // already closed by a disconnect
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
