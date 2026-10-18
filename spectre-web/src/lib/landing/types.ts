// Contract between the landing page (sections, copy) and its scroll-driven 3D story canvas.
import type { Confidence } from "../contract";

/**
 * Scroll "acts", in page order. Each landing section carries data-act="<id>"; the canvas maps
 * the scroll position to (act, progress 0..1 within the act) using those elements' positions.
 */
export const LANDING_ACTS = ["hero", "problem", "spectra", "strips", "assign", "cta"] as const;
export type LandingAct = (typeof LANDING_ACTS)[number];

export interface LandingResidue {
  resi: number;
  resn: string; // one-letter
  ca: [number, number, number]; // Å, centred on the protein
  ss: "H" | "E" | "C";
  confidence: Confidence;
}

export interface LandingStrip {
  resi: number;
  h: number; // 1H ppm of the amide
  n: number; // 15N ppm
  peaks: { c: number; kind: "CA_i" | "CA_im1" | "CB_i" | "CB_im1"; inty: number }[];
}

export interface LandingSceneData {
  protein: { name: string; pdbId: string; residues: LandingResidue[] };
  /** 1H-15N HSQC peaks (one per amide), with the residue they were assigned to */
  hsqc: { h: number; n: number; resi?: number; confidence: Confidence }[];
  /** HNCACB-style strips for the 3D cube act */
  strips: LandingStrip[];
}
