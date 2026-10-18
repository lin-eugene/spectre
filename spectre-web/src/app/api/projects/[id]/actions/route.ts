import type { ActionRequest, ActionResponse } from "@/lib/contract";
import { isActionName, runAction } from "@/lib/project/actions";
import { addHistory, getProject, saveProject, withProject } from "@/lib/project/store";

export const maxDuration = 120;

/** POST /api/projects/[id]/actions {action, args} → ActionResponse */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getProject(id)) return Response.json({ ok: false, error: "project not found" } satisfies ActionResponse, { status: 404 });
  const body = (await request.json().catch(() => null)) as ActionRequest | null;
  if (!body || typeof body.action !== "string") {
    return Response.json({ ok: false, error: "body must be {action, args}" } satisfies ActionResponse, { status: 400 });
  }
  if (!isActionName(body.action)) {
    return Response.json({ ok: false, error: `unknown action "${body.action}"` } satisfies ActionResponse, { status: 400 });
  }
  const args = body.args && typeof body.args === "object" && !Array.isArray(body.args) ? body.args : {};
  const done = await withProject(id, async (state) => {
    const outcome = await runAction(state, body.action, args, { actor: "user" });
    if (outcome.changed) {
      addHistory(state, "user", body.action, outcome.summary);
      saveProject(state);
    }
    return outcome;
  });
  if (!done) return Response.json({ ok: false, error: "project not found" } satisfies ActionResponse, { status: 404 });
  const o = done.value;
  const response: ActionResponse = { ok: o.ok, result: o.result, error: o.error, ui: o.ui, changed: o.changed };
  return Response.json(response, { status: o.ok ? 200 : 422 });
}
