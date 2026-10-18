import { connection } from "next/server";
import { agentConfig } from "@/lib/agent/config";

/**
 * GET /api/agent/config → {providers: [{id, label, model, baseURL?, host?, available}], default}
 * Which model providers the chat can use (no secrets). Read per request so .env changes apply.
 */
export async function GET() {
  await connection();
  return Response.json(agentConfig(), { headers: { "Cache-Control": "no-store" } });
}
