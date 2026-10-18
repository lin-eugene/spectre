import { stripFor } from "@/lib/artina/planes";
import { getProject } from "@/lib/project/store";

/**
 * GET /api/projects/[id]/spectra/[name]/strip?h=<1H ppm>&n=<15N ppm>&hw=<1H half-width ppm, default 0.15>
 * → StripResponse: third-dimension (carbon) rows × 1H columns on the 15N plane nearest n.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/projects/[id]/spectra/[name]/strip">) {
  const { id, name } = await ctx.params;
  const state = getProject(id);
  if (!state) return Response.json({ error: "project not found" }, { status: 404 });
  const q = new URL(request.url).searchParams;
  const h = Number(q.get("h"));
  const n = Number(q.get("n"));
  if (!Number.isFinite(h) || !Number.isFinite(n)) return Response.json({ error: "h and n (ppm) are required" }, { status: 400 });
  const hw = q.get("hw") !== null && Number.isFinite(Number(q.get("hw"))) ? Number(q.get("hw")) : undefined;
  const out = stripFor(state, decodeURIComponent(name), h, n, hw);
  if ("error" in out) return Response.json({ error: out.error }, { status: out.status });
  return Response.json(out, { headers: { "Cache-Control": "private, max-age=600" } });
}
