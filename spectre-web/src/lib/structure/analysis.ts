// Structure- and shift-based analyses used by the agent tools: spatial neighbours from the PDB
// model and a chemical shift index (CSI) secondary-structure estimate from assigned shifts.
import { P1TO3 } from "../residues";
import { atomDistance, parsePdb, type PdbAtom, type PdbModel } from "./pdb";

/** Methyl carbons per residue type (three-letter code). */
export const METHYL_CARBONS: Record<string, string[]> = {
  ALA: ["CB"],
  ILE: ["CD1", "CG2"],
  LEU: ["CD1", "CD2"],
  VAL: ["CG1", "CG2"],
  MET: ["CE"],
  THR: ["CG2"],
};

const modelCache = new Map<string, PdbModel>();

/** Parse (and memoise) a PDB text. */
export function modelFor(pdbText: string, id = ""): PdbModel {
  const key = `${id}:${pdbText.length}:${pdbText.slice(0, 200)}`;
  let m = modelCache.get(key);
  if (!m) {
    m = parsePdb(pdbText, id);
    modelCache.set(key, m);
    if (modelCache.size > 8) modelCache.delete(modelCache.keys().next().value!);
  }
  return m;
}

export interface NeighbourResidue {
  resi: number;
  resn: string;
  chain: string;
  minDistance: number;
  closest: string; // "CD1–CG2"
  ss: "H" | "E" | "C";
}

export interface NeighbourReport {
  residue: number;
  resn: string;
  ss: "H" | "E" | "C";
  probe: string; // atom name or "any atom"
  radius: number;
  neighbours: NeighbourResidue[];
  methylNeighbours: { resi: number; resn: string; atom: string; distance: number }[];
  /** heavy atoms within 10 Å of the residue's CB (CA for Gly): a burial proxy */
  burial: number;
}

/** Residues (and methyl carbons) within `radius` Å of a residue or one of its atoms. */
export function structureNeighbours(model: PdbModel, residue: number, opts: { atom?: string; radius?: number; chain?: string } = {}): NeighbourReport | { error: string } {
  const radius = opts.radius ?? 6;
  const res = model.residues.find((r) => r.resi === residue && (!opts.chain || r.chain === opts.chain));
  if (!res) return { error: `residue ${residue} is not in the structure` };
  let probes: PdbAtom[] = res.atoms.map((i) => model.atoms[i]).filter((a) => a.element !== "H");
  if (opts.atom) {
    const wanted = opts.atom.toUpperCase();
    probes = probes.filter((a) => a.name === wanted);
    if (!probes.length) {
      const names = res.atoms.map((i) => model.atoms[i].name).join(", ");
      return { error: `atom ${wanted} not found in ${res.resn} ${residue} (atoms: ${names})` };
    }
  }
  const best = new Map<string, NeighbourResidue>();
  const methyls: NeighbourReport["methylNeighbours"] = [];
  for (const r of model.residues) {
    if (r === res) continue;
    for (const ai of r.atoms) {
      const a = model.atoms[ai];
      if (a.element === "H") continue;
      for (const p of probes) {
        const d = atomDistance(a, p);
        if (d > radius) continue;
        const prev = best.get(r.key);
        if (!prev || d < prev.minDistance) {
          best.set(r.key, { resi: r.resi, resn: r.resn, chain: r.chain, minDistance: +d.toFixed(2), closest: `${p.name}–${a.name}`, ss: r.ss });
        }
      }
      if (METHYL_CARBONS[r.resn]?.includes(a.name)) {
        let dmin = Infinity;
        for (const p of probes) dmin = Math.min(dmin, atomDistance(a, p));
        if (dmin <= radius) methyls.push({ resi: r.resi, resn: r.resn, atom: a.name, distance: +dmin.toFixed(2) });
      }
    }
  }
  const centre = res.atoms.map((i) => model.atoms[i]).find((a) => a.name === "CB") ?? res.atoms.map((i) => model.atoms[i]).find((a) => a.name === "CA");
  let burial = 0;
  if (centre) {
    for (const a of model.atoms) if (a.element !== "H" && a.index !== centre.index && atomDistance(a, centre) <= 10) burial++;
  }
  return {
    residue,
    resn: res.resn,
    ss: res.ss,
    probe: opts.atom ? opts.atom.toUpperCase() : "any heavy atom",
    radius,
    neighbours: [...best.values()].sort((a, b) => a.minDistance - b.minDistance),
    methylNeighbours: methyls.sort((a, b) => a.distance - b.distance),
    burial,
  };
}

/**
 * Random-coil 13C shifts (ppm, DSS) after Wishart et al., J. Biomol. NMR 5, 67 (1995),
 * the reference set of the chemical shift index.
 */
export const RANDOM_COIL: Record<string, { CA: number; CB?: number; CO: number }> = {
  A: { CA: 52.5, CB: 19.1, CO: 177.8 },
  C: { CA: 58.2, CB: 28.0, CO: 174.6 },
  D: { CA: 54.2, CB: 41.1, CO: 176.3 },
  E: { CA: 56.6, CB: 29.9, CO: 176.6 },
  F: { CA: 57.7, CB: 39.6, CO: 175.8 },
  G: { CA: 45.1, CO: 174.9 },
  H: { CA: 55.0, CB: 29.0, CO: 174.1 },
  I: { CA: 61.1, CB: 38.8, CO: 176.4 },
  K: { CA: 56.2, CB: 33.1, CO: 176.6 },
  L: { CA: 55.1, CB: 42.4, CO: 177.6 },
  M: { CA: 55.4, CB: 32.9, CO: 176.3 },
  N: { CA: 53.1, CB: 38.9, CO: 175.2 },
  P: { CA: 63.3, CB: 32.1, CO: 177.3 },
  Q: { CA: 55.7, CB: 29.4, CO: 176.0 },
  R: { CA: 56.0, CB: 30.9, CO: 176.3 },
  S: { CA: 58.3, CB: 63.8, CO: 174.6 },
  T: { CA: 61.8, CB: 69.8, CO: 174.7 },
  V: { CA: 62.2, CB: 32.9, CO: 176.3 },
  W: { CA: 57.5, CB: 29.6, CO: 176.1 },
  Y: { CA: 57.9, CB: 38.8, CO: 175.9 },
};

export interface CsiResidue {
  resi: number;
  resn: string;
  dCA?: number;
  dCB?: number;
  dCO?: number;
  /** smoothed (ΔCA − ΔCB) secondary shift; positive = helix, negative = strand */
  score?: number;
  csi: "H" | "E" | "C" | "?";
  pdb?: "H" | "E" | "C";
}

export interface CsiReport {
  residues: CsiResidue[];
  predicted: { helix: [number, number][]; strand: [number, number][] };
  pdb?: { helix: [number, number][]; strand: [number, number][] };
  agreement?: { compared: number; agree: number; percent: number };
  method: string;
}

function segments(rows: CsiResidue[], key: "csi" | "pdb", value: "H" | "E"): [number, number][] {
  const out: [number, number][] = [];
  let start: number | null = null;
  let prev: number | null = null;
  for (const r of rows) {
    if (r[key] === value) {
      if (start !== null && prev !== null && r.resi === prev + 1) {
        prev = r.resi;
        continue;
      }
      if (start !== null && prev !== null) out.push([start, prev]);
      start = r.resi;
      prev = r.resi;
    } else if (start !== null && prev !== null) {
      out.push([start, prev]);
      start = null;
      prev = null;
    }
  }
  if (start !== null && prev !== null) out.push([start, prev]);
  return out;
}

/**
 * Chemical shift index from assigned CA/CB/CO shifts: per-residue secondary shifts are
 * smoothed over a 3-residue window and classified (≥ +1.4 ppm helix, ≤ −1.4 ppm strand,
 * helices need 4 and strands 3 consecutive residues), then compared to the PDB HELIX/SHEET records.
 */
export function chemicalShiftIndex(
  sequence: string,
  firstResidue: number,
  shifts: Record<string, Record<string, number>>,
  model?: PdbModel,
): CsiReport {
  const rows: CsiResidue[] = [];
  for (let i = 0; i < sequence.length; i++) {
    const resi = firstResidue + i;
    const resn = sequence[i];
    const rc = RANDOM_COIL[resn];
    const s = shifts[String(resi)] ?? {};
    const row: CsiResidue = { resi, resn, csi: "?" };
    if (rc) {
      if (s.CA !== undefined) row.dCA = +(s.CA - rc.CA).toFixed(2);
      if (s.CB !== undefined && rc.CB !== undefined) row.dCB = +(s.CB - rc.CB).toFixed(2);
      if (s.CO !== undefined) row.dCO = +(s.CO - rc.CO).toFixed(2);
    }
    rows.push(row);
  }
  const raw = rows.map((r) => {
    if (r.dCA === undefined && r.dCO === undefined) return undefined;
    // ΔCA − ΔCB when both exist (Gly: ΔCA only); add half of ΔCO which shares the sign of ΔCA
    let v = (r.dCA ?? 0) - (r.dCB ?? 0);
    if (r.dCO !== undefined) v += 0.5 * r.dCO;
    return v;
  });
  rows.forEach((r, i) => {
    const win = [raw[i - 1], raw[i], raw[i + 1]].filter((x): x is number => x !== undefined);
    if (raw[i] === undefined || !win.length) return;
    r.score = +(win.reduce((a, b) => a + b, 0) / win.length).toFixed(2);
    r.csi = r.score >= 1.4 ? "H" : r.score <= -1.4 ? "E" : "C";
  });
  // minimum segment lengths: helix 4, strand 3
  const enforce = (value: "H" | "E", min: number) => {
    let i = 0;
    while (i < rows.length) {
      if (rows[i].csi !== value) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < rows.length && rows[j + 1].csi === value) j++;
      if (j - i + 1 < min) for (let k = i; k <= j; k++) rows[k].csi = "C";
      i = j + 1;
    }
  };
  enforce("H", 4);
  enforce("E", 3);
  let agreement: CsiReport["agreement"];
  if (model) {
    const ssBy = new Map(model.residues.map((r) => [r.resi, r.ss]));
    let compared = 0;
    let agree = 0;
    for (const r of rows) {
      r.pdb = ssBy.get(r.resi);
      if (r.pdb && r.csi !== "?") {
        compared++;
        if (r.pdb === r.csi) agree++;
      }
    }
    agreement = { compared, agree, percent: compared ? +((100 * agree) / compared).toFixed(1) : 0 };
  }
  return {
    residues: rows,
    predicted: { helix: segments(rows, "csi", "H"), strand: segments(rows, "csi", "E") },
    pdb: model ? { helix: segments(rows, "pdb", "H"), strand: segments(rows, "pdb", "E") } : undefined,
    agreement,
    method: "CSI-style secondary shifts (Wishart 1995 random coil): 3-residue average of ΔCA − ΔCB + ½ΔCO; ≥ +1.4 helix, ≤ −1.4 strand",
  };
}

/** Three-letter label helper. */
export function resLabel(resn1: string, resi: number): string {
  return `${P1TO3[resn1] ?? resn1}${resi}`;
}
