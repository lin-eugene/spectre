// Server-only: builds the landing page's 3D story data from the bundled ubiquitin demo (assigned
// peak lists written from the BMRB 6457 shifts; see scripts/build-demo-data.mjs): the 1UBQ Cα
// trace, the per-residue consistency check, the amides and HNCACB strips. Computed once per server
// process.
import type { Confidence } from "../contract";
import { parsePdb } from "../structure/pdb";
import { loadUbiquitinDemo } from "../project/demo";
import type { LandingSceneData, LandingStrip } from "./types";

let cached: LandingSceneData | null = null;

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

const KIND: Record<string, LandingStrip["peaks"][number]["kind"]> = { "CA(i)": "CA_i", "CA(i-1)": "CA_im1", "CB(i)": "CB_i", "CB(i-1)": "CB_im1" };

export function getLandingSceneData(): LandingSceneData {
  if (cached) return cached;
  const state = loadUbiquitinDemo();
  const result = state.results.assignment!;
  const model = parsePdb(state.pdb?.text ?? "", "1UBQ");
  const chain = model.residues.find((r) => r.ca !== undefined)?.chain ?? "A";
  const protRes = model.residues.filter((r) => r.chain === chain && r.ca !== undefined && !model.atoms[r.ca!].hetero);
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const r of protRes) {
    const a = model.atoms[r.ca!];
    cx += a.x;
    cy += a.y;
    cz += a.z;
  }
  const n = Math.max(1, protRes.length);
  const centre: [number, number, number] = [cx / n, cy / n, cz / n];
  const at = (x: number, y: number, z: number): [number, number, number] => [round(x - centre[0]), round(y - centre[1]), round(z - centre[2])];

  const byResi = new Map(result.residues.map((r) => [r.resi, r]));
  const confidenceAt = (resi: number): Confidence => {
    const r = byResi.get(resi);
    if (r?.resn === "P") return "proline";
    return r?.root && r.consistency ? r.consistency : "unassigned";
  };
  const residues = protRes.map((r) => {
    const a = model.atoms[r.ca!];
    const one = state.sequence[r.resi - state.firstResidue] ?? "X";
    return { resi: r.resi, resn: one, ca: at(a.x, a.y, a.z), ss: r.ss, confidence: confidenceAt(r.resi) };
  });

  const resiOf = (residue: string | undefined) => (residue ? parseInt(residue, 10) : undefined);
  const hsqc = result.spinSystems.map((s) => {
    const resi = resiOf(s.residue);
    return { h: round(s.h, 3), n: round(s.n, 2), ...(resi ? { resi } : {}), confidence: resi ? confidenceAt(resi) : ("unassigned" as Confidence) };
  });

  // peak heights relative to a typical CA(i) peak, so strong own peaks come out near 1
  const own = result.spinSystems.flatMap((s) => s.peaks.filter((p) => p.spec === "hncacb" && p.label === "CA(i)").map((p) => Math.abs(p.inty))).sort((a, b) => a - b);
  const scale = own.length ? own[own.length >> 1] || 1 : 1;
  const strips: LandingStrip[] = [];
  for (const ss of result.spinSystems) {
    const resi = resiOf(ss.residue);
    if (!resi) continue;
    const peaks: LandingStrip["peaks"] = [];
    for (const p of ss.peaks) {
      const kind = p.spec === "hncacb" ? KIND[p.label] : undefined;
      if (kind) peaks.push({ c: round(p.c, 2), kind, inty: round(p.inty / scale, 3) });
    }
    if (peaks.length) strips.push({ resi, h: round(ss.h, 3), n: round(ss.n, 2), peaks });
  }
  strips.sort((a, b) => a.resi - b.resi);

  cached = { protein: { name: state.meta.name, pdbId: state.meta.pdbId ?? "1UBQ", residues }, hsqc, strips };
  return cached;
}
