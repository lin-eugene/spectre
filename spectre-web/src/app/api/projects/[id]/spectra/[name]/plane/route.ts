import { planeFor } from "@/lib/artina/planes";
import { getProject } from "@/lib/project/store";

const num = (v: string | null) => (v === null || v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * GET /api/projects/[id]/spectra/[name]/plane?y=&x=&mode=projection|slice&at=&maxPoints=
 * → PlaneResponse. x/y: "1H" | "15N" | "13C" | nucleus | dim index (defaults: x = 1H, y = 15N;
 * 3D spectra default to a max-|value| projection; slice mode takes `at` = ppm of the other dim).
 */
export async function GET(request: Request, ctx: RouteContext<"/api/projects/[id]/spectra/[name]/plane">) {
  const { id, name } = await ctx.params;
  const state = getProject(id);
  if (!state) return Response.json({ error: "project not found" }, { status: 404 });
  const q = new URL(request.url).searchParams;
  const out = planeFor(state, decodeURIComponent(name), { y: q.get("y"), x: q.get("x"), mode: q.get("mode"), at: num(q.get("at")), maxPoints: num(q.get("maxPoints")) });
  if ("error" in out) return Response.json({ error: out.error }, { status: out.status });
  return Response.json(out, { headers: { "Cache-Control": "private, max-age=600" } });
}
