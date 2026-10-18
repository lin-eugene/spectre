// Pure helpers that turn a ProjectView into what the shell components display.
import { CONFIDENCE, type Confidence, type ProjectView } from "@/lib/contract";
import type { Consistency } from "@/lib/assignment";

export const AA3: Record<string, string> = {
  A: "Ala", C: "Cys", D: "Asp", E: "Glu", F: "Phe", G: "Gly", H: "His", I: "Ile", K: "Lys", L: "Leu",
  M: "Met", N: "Asn", P: "Pro", Q: "Gln", R: "Arg", S: "Ser", T: "Thr", V: "Val", W: "Trp", Y: "Tyr",
};

export const AA_NAME: Record<string, string> = {
  A: "Alanine", C: "Cysteine", D: "Aspartate", E: "Glutamate", F: "Phenylalanine", G: "Glycine", H: "Histidine",
  I: "Isoleucine", K: "Lysine", L: "Leucine", M: "Methionine", N: "Asparagine", P: "Proline", Q: "Glutamine",
  R: "Arginine", S: "Serine", T: "Threonine", V: "Valine", W: "Tryptophan", Y: "Tyrosine",
};

export const EXPERIMENT_LABEL: Record<string, string> = {
  hnco: "HNCO",
  hncaco: "HN(CA)CO",
  hnca: "HNCA",
  hncoca: "HN(CO)CA",
  hncacb: "HNCACB",
  hncocacb: "CBCA(CO)NH",
};

/** Display order + nice labels for backbone shifts. */
export const SHIFT_LABELS: [string, string][] = [
  ["HN", "Hᴺ"],
  ["N", "N"],
  ["CA", "Cα"],
  ["CB", "Cβ"],
  ["CO", "C′"],
];

export interface ResidueInfo {
  resi: number;
  resn: string;
  root?: string;
  confidence: Confidence;
  shifts: Record<string, number>;
}

/** Legend class of a residue: proline, else the consistency check of its assignment (unassigned without one). */
export function residueConfidence(resn: string, r: { root?: string; consistency?: Consistency } | undefined): Confidence {
  if (resn === "P") return "proline";
  return r?.root && r.consistency ? r.consistency : "unassigned";
}

export function residueInfos(project: ProjectView | null): ResidueInfo[] {
  if (!project) return [];
  const byResi = new Map((project.assignment?.residues ?? []).map((r) => [r.resi, r]));
  return [...project.sequence].map((resn, i) => {
    const resi = project.firstResidue + i;
    const r = byResi.get(resi);
    return { resi, resn, root: r?.root, confidence: residueConfidence(resn, r), shifts: r?.shifts ?? {} };
  });
}

export interface EntryStats {
  assignable: number;
  assigned: number;
  veryHigh: number;
  high: number;
  low: number;
  roots: number;
  /** sequential links between assigned residues */
  edges: number;
}

export function entryStats(project: ProjectView | null): EntryStats {
  const a = project?.assignment;
  const s = a?.stats;
  const nonPro = project ? [...project.sequence].filter((c) => c !== "P").length - 1 : 0;
  return {
    assignable: s?.assignable ?? Math.max(0, nonPro),
    assigned: s?.assigned ?? 0,
    veryHigh: s?.veryHigh ?? 0,
    high: s?.high ?? 0,
    low: s?.low ?? 0,
    roots: s?.roots ?? project?.hsqc.length ?? 0,
    edges: s?.edges ?? 0,
  };
}

export function pct(n: number, d: number): string {
  if (!d) return "–";
  return `${Math.round((100 * n) / d)}%`;
}

export function confidenceColor(c: Confidence): string {
  return CONFIDENCE[c].color;
}

/** What a residue's legend class means, in a few words, for tooltips and cards. */
export function consistencyLabel(confidence: Confidence): string {
  if (confidence === "proline") return "no amide proton";
  if (confidence === "unassigned") return "no peaks assigned";
  return CONFIDENCE[confidence].description.charAt(0).toLowerCase() + CONFIDENCE[confidence].description.slice(1);
}

export function fmtShift(atom: string, v: number | undefined): string {
  if (v === undefined || Number.isNaN(v)) return "–";
  return atom === "HN" || atom.startsWith("H") ? v.toFixed(3) : v.toFixed(2);
}

export function humanizeTool(name: string): string {
  const s = name.replace(/^ui_/, "").replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function fmtDate(iso: string | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
