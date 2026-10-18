import { listBrukerDemo, readBrukerDemo } from "@/lib/project/demo";
import { brukerTitle } from "@/lib/bruker";

/** GET /api/bruker -> { experiments: [{ id, title }] } (raw Bruker 1D experiments in the local Bruker directory) */
export async function GET(request: Request) {
  void request.url; // request-time data: never prerender
  const experiments = listBrukerDemo().map((id) => {
    const d = readBrukerDemo(id);
    return { id, title: d ? brukerTitle(d.title) : id };
  });
  return Response.json({ experiments });
}
