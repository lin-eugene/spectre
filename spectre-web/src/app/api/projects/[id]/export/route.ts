import { EXPORT_FORMATS, exportResults, isExportFormat } from "@/lib/export";
import { getProject } from "@/lib/project/store";

/** GET /api/projects/[id]/export?format=nmrstar|bmrb_tab|assignment_list|peaklists|shifts → file download */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = getProject(id);
  if (!state) return Response.json({ error: "project not found" }, { status: 404 });
  const format = new URL(request.url).searchParams.get("format") ?? "nmrstar";
  if (!isExportFormat(format)) return Response.json({ error: `format must be one of ${EXPORT_FORMATS.join(", ")}` }, { status: 400 });
  const result = state.results.assignment;
  if (!result) return Response.json({ error: "no assignment yet: add the spectra's assigned peak lists first" }, { status: 409 });
  try {
    const out = exportResults(format, { result, sequence: state.sequence, firstResidue: state.firstResidue, name: state.meta.name });
    const safe = out.filename.replace(/[^\w.+-]/g, "_");
    return new Response(out.text, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safe}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return Response.json({ error: `export failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 501 });
  }
}
