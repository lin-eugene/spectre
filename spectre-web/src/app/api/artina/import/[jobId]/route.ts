import { getJob } from "@/lib/artina/jobs";

/** GET /api/artina/import/[jobId] → ImportJob */
export async function GET(_request: Request, ctx: RouteContext<"/api/artina/import/[jobId]">) {
  const { jobId } = await ctx.params;
  const job = getJob(jobId);
  if (!job) return Response.json({ error: "unknown import job" }, { status: 404 });
  return Response.json(job, { headers: { "Cache-Control": "no-store" } });
}
