// Human-readable atom descriptions for the hover card: Greek atom names, nucleus, assigned
// chemical shift and the BMRB statistics for the atom.
import { CONFIDENCE } from "@/lib/contract";
import { bmrbExpected } from "@/lib/structure/bmrb";
import type { PdbAtom, PdbModel } from "@/lib/structure/pdb";
import { ELEMENT_COLORS, METHYL_CARBONS, oneLetter, type ResidueContext } from "./palette";

const GREEK: Record<string, string> = { A: "α", B: "β", G: "γ", D: "δ", E: "ε", Z: "ζ", H: "η" };
const ELEMENT_NAMES: Record<string, string> = {
  C: "carbon", N: "nitrogen", O: "oxygen", S: "sulfur", H: "hydrogen", P: "phosphorus", SE: "selenium",
  FE: "iron", ZN: "zinc", MG: "magnesium", CA: "calcium", NA: "sodium", CL: "chlorine",
};
const ISOTOPE: Record<string, string> = { C: "¹³C", N: "¹⁵N", H: "¹H" };

export const BACKBONE = new Set(["N", "CA", "C", "O", "OXT", "H", "HA", "HA2", "HA3", "H1", "H2", "H3"]);

export function greekName(atom: PdbAtom): string {
  const n = atom.name;
  if (n === "N") return "N";
  if (n === "C") return "C′";
  if (n === "O") return "O";
  if (n === "OXT") return "O (C-term)";
  if (n === "H" || n === "HN") return "Hᴺ";
  const el = atom.element.length === 1 ? atom.element : atom.element[0] + atom.element.slice(1).toLowerCase();
  const rest = n.slice(atom.element.length);
  if (!rest) return el;
  const g = GREEK[rest[0]];
  return g ? `${el}${g}${rest.slice(1)}` : n;
}

export function atomRole(atom: PdbAtom): string {
  switch (atom.name) {
    case "N":
      return "backbone amide";
    case "CA":
      return "backbone α-carbon";
    case "C":
      return "backbone carbonyl";
    case "O":
    case "OXT":
      return "backbone carbonyl oxygen";
    case "H":
    case "HN":
      return "amide proton";
  }
  if (atom.hetero) return "ligand";
  const one = oneLetter(atom.resn);
  if (METHYL_CARBONS[one]?.includes(atom.name)) return "methyl group";
  return "side chain";
}

/** Key of a PDB atom name in the residue shift table (HN and CO for the amide proton and carbonyl). */
export function shiftKey(atomName: string): string {
  if (atomName === "H") return "HN";
  if (atomName === "C") return "CO";
  return atomName;
}

export interface AtomCard {
  atomIndex: number;
  title: string;
  atomName: string;
  role: string;
  element: string;
  elementName: string;
  elementColor: string;
  residueLabel: string;
  resn: string;
  resi: number;
  chain: string;
  bfactor: number;
  shift?: { nucleus: string; value: number };
  expected?: { nucleus: string; mean: number; sd: number };
  confidence?: { label: string; color: string; description: string };
  root?: string;
}

export interface ResidueCard {
  resi: number;
  resn: string;
  chain: string;
  ss: "H" | "E" | "C";
  confidence?: { label: string; color: string; description: string };
  root?: string;
  shifts: [string, number][];
}

const SS_NAME = { H: "α-helix", E: "β-strand", C: "loop" } as const;

export function residueCard(model: PdbModel, residueIndex: number, ctx: Map<number, ResidueContext>, primary?: string): ResidueCard {
  const r = model.residues[residueIndex];
  const c = !primary || r.chain === primary ? ctx.get(r.resi) : undefined;
  const order = ["HN", "N", "CA", "CB", "CO"];
  const shifts = Object.entries(c?.shifts ?? {}).sort((a, b) => {
    const ia = order.indexOf(a[0]);
    const ib = order.indexOf(b[0]);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a[0].localeCompare(b[0]);
  });
  return {
    resi: r.resi,
    resn: r.resn,
    chain: r.chain,
    ss: r.ss,
    confidence: c?.confidence ? CONFIDENCE[c.confidence] : undefined,
    root: c?.root,
    shifts,
  };
}

export function ssName(ss: "H" | "E" | "C") {
  return SS_NAME[ss];
}

export function atomCard(model: PdbModel, atomIndex: number, ctx: Map<number, ResidueContext>, primary?: string): AtomCard {
  const a = model.atoms[atomIndex];
  const onPrimary = !primary || a.chain === primary;
  const c = onPrimary ? ctx.get(a.resi) : undefined;
  const card: AtomCard = {
    atomIndex,
    title: greekName(a),
    atomName: a.name,
    role: atomRole(a),
    element: a.element,
    elementName: ELEMENT_NAMES[a.element] ?? a.element.toLowerCase(),
    elementColor: ELEMENT_COLORS[a.element] ?? "#b197fc",
    residueLabel: `${a.resn} ${a.resi}`,
    resn: a.resn,
    resi: a.resi,
    chain: a.chain,
    bfactor: a.b,
    confidence: c?.confidence ? CONFIDENCE[c.confidence] : undefined,
    root: c?.root,
  };
  const nucleus = ISOTOPE[a.element];
  if (nucleus && !a.hetero) {
    const v = c?.shifts?.[shiftKey(a.name)];
    if (v !== undefined) card.shift = { nucleus, value: v };
    const exp = bmrbExpected(a.resn, a.name);
    if (exp) card.expected = { nucleus, mean: exp[0], sd: exp[1] };
  }
  return card;
}
