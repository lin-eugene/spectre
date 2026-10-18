// The backbone assignment the app displays: spin systems (HN roots) with their labelled peaks,
// residues with shifts, sequential links, a consistency check and statistics. Built from the
// project's assigned peak lists by lib/peaklists/build.ts. Types only (safe for client and server
// code).

/** Layout version of AssignmentResult; results stored in another layout are rebuilt or dropped. */
export const RESULT_VERSION = 4;

/** Direction of a sequential link: "f" = the other spin system sits on residue i+1, "b" = on i-1. */
export type LinkDir = "f" | "b";
/** [other spin system, number of carbons (CA, CB, C′) whose shifts agree, direction] */
export type Link = [string, number, LinkDir];

export interface AssignedPeak {
  /** `<spectrum name>:<row number in its peak list>` */
  name: string;
  /** app spectrum type: hnca, hncoca, hncacb, hncocacb, hnco, hncaco */
  spec: string;
  /** amide 1H and 15N, ppm */
  h: number;
  n: number;
  /** carbon shift as in the peak list */
  c: number;
  /** carbon shift used for comparisons (the same as c: peak lists are taken as referenced) */
  cp: number;
  /** peak height (from the list, else read from the spectrum at the peak) */
  inty: number;
  /** carbon atom the list assigns: CA, CB or C ("" when it assigns none of these) */
  atom: string;
  /** relative to the residue of its spin system: CA(i), CB(i-1), CO(i)… ("" when unexplained) */
  label: string;
}

/**
 * Consistency of the assignment of a residue (the keys of the confidence legend):
 * veryHigh = no conflicts and linked to a neighbour by a sequential carbon match;
 * high = no conflicts but no sequential link, or a shift unusual for the residue type;
 * low = a conflict (an atom whose peaks disagree, or a shift implausible for the residue type).
 */
export type Consistency = "veryHigh" | "high" | "low";

/** Something about a spin system worth checking (shown under Problems and in the spin-system list). */
export interface SpinSystemIssue {
  /**
   * conflict: an atom whose peaks disagree, or a shift implausible for the residue type;
   * unusual: a shift far from the residue type's average; missing: an expected peak is absent
   * from a spectrum; unexplained: a peak the assignment does not account for
   */
  kind: "conflict" | "unusual" | "missing" | "unexplained";
  text: string;
}

export interface SpinSystem {
  /** root name: the residue number of its amide, e.g. "12" */
  root: string;
  /** amide position (mean over its peaks) */
  h: number;
  n: number;
  peaks: AssignedPeak[];
  /** residue it is assigned to, as residue number + one-letter code, e.g. "12L" */
  residue: string;
  consistency: Consistency;
  /** links to the spin systems on the neighbouring residues */
  links: Link[];
  /** residue-type probabilities of residue i (from its CA, CB, C′, N, H shifts) and of i−1, most likely first */
  typesI: [string, number][];
  typesIm1: [string, number][];
  issues: SpinSystemIssue[];
}

export interface ResidueAssignment {
  resi: number;
  /** one-letter code */
  resn: string;
  /** spin system of this residue's amide */
  root?: string;
  /** consistency of that spin system */
  consistency?: Consistency;
  /** backbone shifts by atom (HN, N, CA, CB, CO): the mean over the peaks assigned to the atom */
  shifts: Record<string, number>;
}

export interface AssignmentStats {
  /** spin systems (assigned amides) */
  roots: number;
  residues: number;
  /** residues that can hold a spin system: not a proline, not the first residue */
  assignable: number;
  assigned: number;
  /** spin systems by consistency class */
  veryHigh: number;
  high: number;
  low: number;
  /** links between spin systems on consecutive residues */
  edges: number;
}

/** One spectrum's peak list as it went into the assignment. */
export interface PeakListSummary {
  /** spectrum name in the project */
  spectrum: string;
  /** experiment type, e.g. hnca */
  experiment: string;
  /** experiment label, e.g. HNCA */
  label: string;
  /** peak-list format, e.g. sparky */
  format: string;
  /** the list's file name as uploaded */
  file: string;
  /** rows read from the list */
  peaks: number;
  /** peaks placed in a spin system */
  used: number;
  /** peaks left out, by reason */
  skipped: Record<string, number>;
}

export interface AssignmentResult {
  source: "peaklists";
  version: typeof RESULT_VERSION;
  spinSystems: SpinSystem[];
  /** every residue of the sequence */
  residues: ResidueAssignment[];
  /** links of each spin system (both directions) */
  links: Record<string, Link[]>;
  stats: AssignmentStats;
  /** the peak lists the assignment was built from */
  inputs: PeakListSummary[];
  /** what was noticed while reading the lists (skipped peaks, mismatched names) */
  notes: string[];
}
