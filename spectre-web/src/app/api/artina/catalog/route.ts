import { catalogSummaries, loadCatalog } from "@/lib/artina/catalog";

/** GET /api/artina/catalog → {source, license, proteins: ArtinaProteinSummary[]} */
export async function GET(request: Request) {
  void request.url; // request-time data (cache flags change after imports)
  const c = loadCatalog();
  return Response.json(
    { source: c.source, title: c.title, authors: c.authors, license: c.license, licenseUrl: c.licenseUrl, proteins: catalogSummaries() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
