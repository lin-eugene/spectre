import { createUploadProject } from "@/lib/peaklists/project";
import { createProject, listProjects, saveProject } from "@/lib/project/store";
import { attachDefaultStructure } from "@/lib/project/structure";
import { ensureFeaturedProject, FEATURED_ARTINA_ID } from "@/lib/project/defaults";

/**
 * POST /api/projects {demo?: "ubiquitin" | "2K50"} | {upload: {name, sequence, firstResidue}}
 * - "ubiquitin" (or no body): new project from the bundled demo (its assignment built from its
 *   bundled peak lists) → 201 {id}
 * - "2K50": the featured real-data ARTINA project (real spectra, deposited peak lists) → 200 {id}
 *   when it exists, or 202 {jobId} while it is being imported (spectra downloaded once; poll
 *   GET /api/artina/import/[jobId], whose projectId appears when it is done)
 * - upload: an empty project for your own data, from the text of a FASTA (or plain) sequence
 *   file → 201 {id, structure}; its structure is the ESMFold prediction of the sequence, else its
 *   AlphaFold DB model (structure: {id: "ESMFold", ...}, {entryId, ...} or {error}); then PUT its
 *   spectra and their assigned peak lists to /api/projects/[id]/uploads
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { demo?: string; upload?: { name?: unknown; sequence?: unknown; firstResidue?: unknown } };
  if (body.upload) {
    const u = body.upload;
    const first = u.firstResidue === undefined || u.firstResidue === "" ? 1 : Number(u.firstResidue);
    const res = createUploadProject({ name: String(u.name ?? ""), sequenceText: String(u.sequence ?? ""), firstResidue: first });
    if ("error" in res) return Response.json({ error: res.error }, { status: 400 });
    const structure = await attachDefaultStructure(res).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    saveProject(res);
    return Response.json({ id: res.id, structure: structure.ok ? structure : { error: structure.error } }, { status: 201 });
  }
  const demo = body.demo ?? "ubiquitin";
  if (demo !== "ubiquitin" && demo.toUpperCase() !== FEATURED_ARTINA_ID) {
    return Response.json({ error: `unknown demo "${body.demo}" (available: ubiquitin, ${FEATURED_ARTINA_ID})` }, { status: 400 });
  }
  try {
    if (demo === "ubiquitin") return Response.json({ id: createProject().id }, { status: 201 });
    const res = await ensureFeaturedProject();
    if (res.jobId) return Response.json({ jobId: res.jobId }, { status: 202 });
    return Response.json({ id: res.id }, { status: 200 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/** GET /api/projects → {projects: [{id, name, updatedAt, source}]} */
export async function GET(request: Request) {
  void request.url; // request-time data: never prerender
  return Response.json({ projects: listProjects() });
}
