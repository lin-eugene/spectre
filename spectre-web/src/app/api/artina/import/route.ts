import { startImport } from "@/lib/artina/jobs";

export const maxDuration = 60;

/**
 * POST /api/artina/import {id, maxMB?} → 202 {jobId} (poll GET /api/artina/import/[jobId]).
 * Downloads the protein's NMRPipe backbone spectra with their deposited assigned peak lists and
 * the structures, and creates a project whose assignment is built from those lists. A running
 * import of the same protein is returned instead of starting another.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { id?: unknown; maxMB?: unknown } | null;
  if (!body || typeof body.id !== "string" || !body.id.trim()) return Response.json({ error: "body must be {id, maxMB?}" }, { status: 400 });
  const maxMB = typeof body.maxMB === "number" && Number.isFinite(body.maxMB) ? body.maxMB : undefined;
  const job = startImport({ id: body.id, maxMB });
  if (job.status === "error") return Response.json(job, { status: 404 });
  return Response.json({ jobId: job.jobId }, { status: 202 });
}
