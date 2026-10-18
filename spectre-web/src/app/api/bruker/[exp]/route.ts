import type { NextRequest } from "next/server";
import { readBrukerDemo } from "@/lib/project/demo";
import { brukerTitle } from "@/lib/bruker";

/** GET /api/bruker/[exp] -> { id, title, acqus, procs, fid } with the raw FID base64-encoded */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/bruker/[exp]">) {
  const { exp } = await ctx.params;
  const d = readBrukerDemo(exp);
  if (!d) return Response.json({ error: `unknown experiment ${exp}` }, { status: 404 });
  return Response.json({
    id: exp,
    title: brukerTitle(d.title),
    acqus: d.acqus,
    procs: d.procs,
    fid: Buffer.from(d.fid.buffer, d.fid.byteOffset, d.fid.byteLength).toString("base64"),
  });
}
