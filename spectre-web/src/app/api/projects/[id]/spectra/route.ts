import { publicMeta } from "@/lib/artina/planes";
import { getProject } from "@/lib/project/store";

/** GET /api/projects/[id]/spectra → {spectra: RealSpectrumMeta[]} (real processed spectra of the project) */
export async function GET(_request: Request, ctx: RouteContext<"/api/projects/[id]/spectra">) {
  const { id } = await ctx.params;
  const state = getProject(id);
  if (!state) return Response.json({ error: "project not found" }, { status: 404 });
  const spectra = (state.realSpectra ?? []).map(publicMeta);
  return Response.json({ spectra, attribution: state.attribution }, { headers: { "Cache-Control": "no-store" } });
}
