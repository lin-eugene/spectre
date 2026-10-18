import { getProject } from "@/lib/project/store";
import { toProjectView } from "@/lib/project/view";

/** GET /api/projects/[id] → ProjectView */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = getProject(id);
  if (!state) return Response.json({ error: "project not found" }, { status: 404 });
  return Response.json(toProjectView(state), { headers: { "Cache-Control": "no-store" } });
}
