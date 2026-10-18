// Colour schemes for the structure viewer. Pure data + helpers (no three.js) so the
// React side can reuse them for legends.
import { CONFIDENCE, type ColorScheme, type Confidence, type ProjectView } from "@/lib/contract";
import type { PdbModel } from "@/lib/structure/pdb";

export const ELEMENT_COLORS: Record<string, string> = {
  C: "#909aa6",
  N: "#2f6fd6",
  O: "#e03d3d",
  S: "#e7b416",
  H: "#e9edf1",
  P: "#f08c00",
  SE: "#f08c00",
  FE: "#d9480f",
  ZN: "#7c8a9a",
  MG: "#5fbf6e",
  CA: "#5fbf6e",
  NA: "#8e7cc3",
  CL: "#37b24d",
};

export const SS_COLORS = { H: "#d6336c", E: "#f59f00", C: "#aab3bd" } as const;
export const SS_LABELS = { H: "α-helix", E: "β-strand", C: "Coil / turn" } as const;

/** Residue classes for the "residue" scheme. */
export const RESIDUE_CLASSES: { label: string; color: string; members: string }[] = [
  { label: "Aliphatic", color: "#40a96b", members: "AVLIM" },
  { label: "Aromatic", color: "#8f5bd6", members: "FWY" },
  { label: "Positive", color: "#3b74e0", members: "KRH" },
  { label: "Negative", color: "#e5484d", members: "DE" },
  { label: "Polar", color: "#14a6b8", members: "STNQ" },
  { label: "Gly / Pro / Cys", color: "#c9a227", members: "GPC" },
];

export const KYTE_DOOLITTLE: Record<string, number> = {
  I: 4.5, V: 4.2, L: 3.8, F: 2.8, C: 2.5, M: 1.9, A: 1.8, G: -0.4, T: -0.7, S: -0.8,
  W: -0.9, Y: -1.3, P: -1.6, H: -3.2, E: -3.5, Q: -3.5, D: -3.5, N: -3.5, K: -3.9, R: -4.5,
};

export const NEUTRAL = "#a9b4bf";
export const SELECT_COLOR = "#12b886";

const THREE_TO_ONE: Record<string, string> = {
  ALA: "A", CYS: "C", ASP: "D", GLU: "E", PHE: "F", GLY: "G", HIS: "H", ILE: "I", LYS: "K", LEU: "L",
  MET: "M", ASN: "N", PRO: "P", GLN: "Q", ARG: "R", SER: "S", THR: "T", VAL: "V", TRP: "W", TYR: "Y",
  MSE: "M", HSD: "H", HSE: "H", HIE: "H", HID: "H",
};
export const oneLetter = (resn3: string) => THREE_TO_ONE[resn3.toUpperCase()] ?? "X";

/** Methyl carbons per residue type. */
export const METHYL_CARBONS: Record<string, string[]> = {
  I: ["CD1", "CG2"],
  L: ["CD1", "CD2"],
  V: ["CG1", "CG2"],
  A: ["CB"],
  M: ["CE"],
  T: ["CG2"],
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}
function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
export function mixHex(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/** Diverging ramp blue -> white -> orange used for hydrophobicity / B-factor. */
export function divergingRamp(t: number, low = "#2f6ce5", mid = "#f4f6f8", high = "#e8590c"): string {
  const u = Math.max(0, Math.min(1, t));
  return u < 0.5 ? mixHex(low, mid, u / 0.5) : mixHex(mid, high, (u - 0.5) / 0.5);
}

export interface ResidueContext {
  resi: number;
  resn1: string;
  confidence: Confidence | null;
  shifts: Record<string, number>;
  root?: string;
}

/** Per-residue NMR context keyed by residue number. */
export function residueContext(project: ProjectView): Map<number, ResidueContext> {
  const out = new Map<number, ResidueContext>();
  const res = project.assignment?.residues;
  if (res) {
    for (const r of res) {
      out.set(r.resi, {
        resi: r.resi,
        resn1: r.resn,
        confidence: r.resn === "P" ? "proline" : r.root && r.consistency ? r.consistency : "unassigned",
        shifts: r.shifts ?? {},
        root: r.root,
      });
    }
  } else {
    for (let i = 0; i < project.sequence.length; i++) {
      const resn1 = project.sequence[i];
      out.set(project.firstResidue + i, {
        resi: project.firstResidue + i,
        resn1,
        confidence: resn1 === "P" ? "proline" : null,
        shifts: {},
      });
    }
  }
  return out;
}

/** AlphaFold pLDDT bands (stored in the B-factor column of AlphaFold models). */
export const PLDDT_BANDS: { label: string; color: string; min: number }[] = [
  { label: "Very high (pLDDT > 90)", color: "#0053D6", min: 90 },
  { label: "High (90 > pLDDT > 70)", color: "#65CBF3", min: 70 },
  { label: "Low (70 > pLDDT > 50)", color: "#FFDB13", min: 50 },
  { label: "Very low (pLDDT < 50)", color: "#FF7D45", min: -Infinity },
];
export function plddtColor(v: number): string {
  return (PLDDT_BANDS.find((b) => v > b.min) ?? PLDDT_BANDS[3]).color;
}

/** First chain carrying protein residues: the one NMR residue numbers refer to. */
export function primaryChain(model: PdbModel, preferred?: string): string {
  if (preferred && model.residues.some((r) => r.chain === preferred && r.ca !== undefined)) return preferred;
  return model.residues.find((r) => r.ca !== undefined && !model.atoms[r.ca].hetero)?.chain ?? model.residues[0]?.chain ?? "A";
}

/** Colour (hex) of every PDB residue (index aligned with model.residues) for a scheme. */
export function residueColors(
  model: PdbModel,
  scheme: ColorScheme,
  ctx: Map<number, ResidueContext>,
  opts: { plddt?: boolean } = {},
): string[] {
  let bMin = Infinity;
  let bMax = -Infinity;
  const bAvg = model.residues.map((r) => {
    let s = 0;
    for (const i of r.atoms) s += model.atoms[i].b;
    const v = r.atoms.length ? s / r.atoms.length : 0;
    bMin = Math.min(bMin, v);
    bMax = Math.max(bMax, v);
    return v;
  });
  const primary = primaryChain(model);
  return model.residues.map((r, k) => {
    const one = oneLetter(r.resn);
    // NMR-derived schemes describe the assigned chain only
    if (scheme === "confidence" && r.chain !== primary) return "#c9d0d8";
    switch (scheme) {
      case "confidence": {
        const c = ctx.get(r.resi);
        if (!c || !c.confidence) return NEUTRAL;
        return CONFIDENCE[c.confidence].color;
      }
      case "secondary":
        return SS_COLORS[r.ss];
      case "residue":
        return RESIDUE_CLASSES.find((c) => c.members.includes(one))?.color ?? NEUTRAL;
      case "hydrophobicity": {
        const v = KYTE_DOOLITTLE[one];
        if (v === undefined) return NEUTRAL;
        return divergingRamp((v + 4.5) / 9);
      }
      case "bfactor":
        if (opts.plddt) return plddtColor(bAvg[k]);
        return divergingRamp(bMax > bMin ? (bAvg[k] - bMin) / (bMax - bMin) : 0.5);
    }
    return NEUTRAL;
  });
}

export const SCHEME_LABELS: Record<ColorScheme, string> = {
  confidence: "Assignment confidence",
  secondary: "Secondary structure",
  residue: "Residue type",
  hydrophobicity: "Hydrophobicity",
  bfactor: "B-factor",
};
