import { addPeakList, addShiftList, addSpectrum, receiveUpload, removePeakList, removeShiftList, removeSpectrum } from "@/lib/peaklists/project";
import { getProject, saveProject, withProject } from "@/lib/project/store";

/**
 * PUT /api/projects/[id]/uploads with the file as the request body:
 * - ?kind=spectrum&file=<file name>&type=<hnca|hncoca|hncacb|cbcanh|hncocacb|cbcaconh|hnco|hncaco>
 *   (kind may be left out): an NMRPipe 3D spectrum → {spectrum}. A file with the same name
 *   replaces the earlier upload and keeps its peak list.
 * - ?kind=peaklist&spectrum=<spectrum name>&file=<file name>[&format=<sparky|xeasy|nmrpipe|ccpn|auto>]:
 *   the assigned peak list of an uploaded spectrum → {peakList, warnings}.
 * - ?kind=shiftlist&file=<file name>: an XEASY .prot shift list, for XEASY peak lists that give
 *   their atoms as numbers → {entries}.
 * Every change rebuilds the assignment from the peak lists.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const q = new URL(request.url).searchParams;
  const kind = (q.get("kind") ?? "spectrum").trim();
  const file = (q.get("file") ?? "").trim();
  const state = getProject(id);
  if (!state) return Response.json({ error: "project not found" }, { status: 404 });
  if (!state.inputs) return Response.json({ error: "this project was not created from your own data" }, { status: 400 });
  if (!["spectrum", "peaklist", "shiftlist"].includes(kind)) return Response.json({ error: "kind must be spectrum, peaklist or shiftlist" }, { status: 400 });
  if (!file) return Response.json({ error: "missing ?file=<name>" }, { status: 400 });
  if (!request.body) return Response.json({ error: "missing file contents" }, { status: 400 });
  const got = await receiveUpload(id, request.body);
  if ("error" in got) return Response.json({ error: got.error }, { status: got.status });
  const done = await withProject(id, (st) => {
    const res =
      kind === "peaklist"
        ? addPeakList(st, { tmp: got.tmp, original: file, spectrum: (q.get("spectrum") ?? "").trim(), format: (q.get("format") ?? "").trim() || undefined })
        : kind === "shiftlist"
          ? addShiftList(st, { tmp: got.tmp, original: file })
          : addSpectrum(st, { tmp: got.tmp, original: file, experiment: (q.get("type") ?? "").trim().toLowerCase() });
    if (!("error" in res)) saveProject(st);
    return res;
  });
  if (!done) return Response.json({ error: "project not found" }, { status: 404 });
  if ("error" in done.value) return Response.json({ error: done.value.error }, { status: done.value.status });
  return Response.json(kind === "spectrum" ? { spectrum: done.value } : done.value);
}

/**
 * DELETE /api/projects/[id]/uploads?name=<spectrum name> removes a spectrum and its peak list;
 * ?peaklist=<spectrum name> only the spectrum's peak list; ?shiftlist=1 the XEASY shift list → {ok}
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const q = new URL(request.url).searchParams;
  const name = (q.get("name") ?? "").trim();
  const peakList = (q.get("peaklist") ?? "").trim();
  const shiftList = q.get("shiftlist") === "1";
  const done = await withProject(id, (st) => {
    const ok = shiftList ? removeShiftList(st) : peakList ? removePeakList(st, peakList) : removeSpectrum(st, name);
    if (ok) saveProject(st);
    return ok;
  });
  if (!done) return Response.json({ error: "project not found" }, { status: 404 });
  if (!done.value) {
    const what = shiftList ? "no shift list" : peakList ? `no peak list for "${peakList}"` : `no uploaded spectrum "${name}"`;
    return Response.json({ error: what }, { status: 404 });
  }
  return Response.json({ ok: true });
}
