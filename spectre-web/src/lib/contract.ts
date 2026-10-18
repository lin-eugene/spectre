// Shared contract between the assignment results, API routes, agent tools and UI.
// Keep this file types/constants only (safe to import from client and server code).
import type { AssignmentResult } from "./assignment";
import type { RawPeak2D, RawPeak3D } from "./spectra/peaklist";
import type { HistoryEntry } from "./project/types";

/**
 * Classes of the assignment legend (AlphaFold-style colours): the consistency check of each
 * assigned residue (see Consistency in assignment.ts), plus unassigned residues and prolines.
 */
export type Confidence = "veryHigh" | "high" | "low" | "unassigned" | "proline";

/** Tolerances of the consistency check (ppm, and BMRB standard deviations); see peaklists/build.ts. */
export const CONSISTENCY_TOLERANCE = {
  /** a carbon of residue i within this of the (i-1) peak of residue i+1 links the two */
  link: 0.35,
  /** peaks of one atom further apart than this conflict */
  conflict: { H: 0.06, N: 0.6, C: 0.5 },
  /** a shift this many standard deviations from its residue type's average is unusual */
  unusualSd: 3.5,
  /** a carbon shift this many standard deviations away is implausible (a conflict) */
  implausibleSd: 5,
} as const;

export const CONFIDENCE: Record<Confidence, { label: string; color: string; description: string }> = {
  veryHigh: { label: "Confirmed", color: "#0053D6", description: "Consistent peaks, linked to a neighbour by a sequential carbon match" },
  high: { label: "Unconfirmed", color: "#65CBF3", description: "No conflicts, but no sequential link to a neighbour, or a shift unusual for the residue type" },
  low: { label: "Conflict", color: "#FFDB13", description: "Peaks of one atom disagree, or a shift is implausible for the residue type" },
  unassigned: { label: "Unassigned", color: "#FF7D45", description: "No peaks assigned to the amide" },
  proline: { label: "Proline", color: "#B7BDC6", description: "No amide proton: not observable in HN experiments" },
};

export interface SpectrumSummary {
  tp: string;
  label: string;
  file?: string;
  peaks: RawPeak3D[];
}

/** Everything the UI needs to render a project (GET /api/projects/[id]). */
export interface ProjectView {
  id: string;
  updatedAt: string;
  meta: {
    name: string;
    organism?: string;
    uniprot?: string;
    pdbId?: string;
    bmrbId?: string;
    description?: string;
    source: string;
  };
  sequence: string;
  firstResidue: number;
  spectra: SpectrumSummary[];
  hsqc: RawPeak2D[];
  pdb?: { id: string; text: string };
  /** backbone assignment built from the project's assigned peak lists */
  assignment?: AssignmentResult;
  history: HistoryEntry[];
  /** real processed spectra attached to the project (e.g. imported from the ARTINA dataset) */
  realSpectra?: RealSpectrumMeta[];
  /** alternative structures (deposited NMR model, AlphaFold, ARTINA); pdb stays the default */
  models?: { id: string; label: string; text: string }[];
  /** data licence / citation to display (e.g. ARTINA dataset, CC BY 4.0) */
  attribution?: { text: string; url: string; license: string };
  /** spectra and peak lists of a project made from your own data or imported from ARTINA */
  inputs?: InputsView;
}

// ------------------------------------------------------------------ your own data (spectra + peak lists)

export interface InputsView {
  spectra: {
    name: string;
    experiment: string;
    /** experiment label, e.g. HNCA */
    label: string;
    original: string;
    sizeMB: number;
    uploadedAt: string;
    /** a file kept in a shared cache (ARTINA), not removable from the project */
    stored: boolean;
    peakList?: { original: string; format: string; peaks: number; uploadedAt: string; stored: boolean };
  }[];
  /** XEASY .prot shift list for XEASY peak lists that give their atoms as numbers */
  shiftList?: { original: string; entries: number };
  /** upload size limit per file (MB) */
  maxUploadMB: number;
}

// ------------------------------------------------------------------ real spectra (ARTINA etc.)

export interface RealSpectrumAxis {
  nucleus: string; // as in the file header, e.g. "HN", "N", "C"
  label: string; // "1H" | "13C" | "15N"
  size: number;
  sf: number; // MHz
  ppmMax: number;
  ppmMin: number;
}

export interface RealSpectrumMeta {
  /** file stem, unique within the project, e.g. "HNCA", "C13HSQC_@ALI" */
  name: string;
  /** experiment type as given by the source, e.g. "HNCA", "CBCAcoNH", "N15HSQC" */
  experiment: string;
  /** app spectrum type it is used as in the assignment, if any (hnca, hncacb, ...) */
  engineType?: string;
  ndim: number;
  axes: RealSpectrumAxis[]; // file order, last = direct dimension
  noise: number;
  maxAbs: number;
  sizeMB: number;
}

/** GET /api/projects/[id]/spectra/[name]/plane?y=<label|dim>&x=<label|dim>&mode=projection|slice&at=<ppm>&maxPoints=512 */
export interface PlaneResponse {
  name: string;
  mode: "projection" | "slice";
  /** for slice mode: ppm of the fixed third dimension(s), keyed by dim index */
  at?: Record<string, number>;
  x: { dim: number; label: string; nucleus: string; ppmMax: number; ppmMin: number; n: number };
  y: { dim: number; label: string; nucleus: string; ppmMax: number; ppmMin: number; n: number };
  /** base64 of little-endian Float32 values, row-major (y rows, x columns), row 0 = ppmMax of y, column 0 = ppmMax of x */
  data: string;
  min: number;
  max: number;
  noise: number;
}

/** GET /api/projects/[id]/spectra/[name]/strip?h=<ppm>&n=<ppm>&hw=<ppm half width of 1H window> */
export interface StripResponse {
  name: string;
  h: number;
  n: number;
  /** carbon (or third-dimension) axis = rows, 1H = columns */
  c: { label: string; ppmMax: number; ppmMin: number; n: number };
  hAxis: { ppmMax: number; ppmMin: number; n: number };
  data: string; // base64 little-endian Float32, row-major (c rows, h columns)
  noise: number;
  maxAbs: number;
}

export interface ArtinaSpectrumInfo {
  type: string;
  size: string;
  ppm: string;
  freq: string;
  mb: number | null;
  nAssigned?: string;
  pctAssigned?: string;
}

export interface ArtinaProteinSummary {
  id: string; // e.g. "2K50"
  residues: number;
  pdb: string | null;
  bmrb: string | null;
  year: string | null;
  reference: string | null;
  spectra: ArtinaSpectrumInfo[];
  /** backbone experiments present (HNCO, HNcaCO, HNCA, HNcoCA, CBCANH, CBCAcoNH) */
  backbone: string[];
  hasHsqc: boolean;
  /** download size (MB) of the spectra needed for a backbone import */
  backboneMB: number;
  /** already downloaded to the local cache */
  cached: boolean;
}

/**
 * POST /api/artina/import {id, maxMB?} → {jobId}; GET /api/artina/import/[jobId] → ImportJob.
 * An import downloads the NMRPipe spectra with their deposited assigned peak lists, then creates
 * the project and its assignment: status "downloading" (stage download), then "processing" (stage
 * build), then "done" with projectId set.
 */
export interface ImportJob {
  jobId: string;
  proteinId: string;
  status: "queued" | "downloading" | "processing" | "done" | "error";
  stage?: "download" | "build";
  progress: number; // 0..1
  message: string;
  log: string[];
  projectId?: string;
  error?: string;
}

/** Effects the agent (or a tool) asks the UI to perform. */
export type SpectrumViewId = "hsqc" | "strips" | "strips3d" | "matrix" | "bruker1d" | "planes";
export type ColorScheme = "confidence" | "secondary" | "residue" | "hydrophobicity" | "bfactor";
export type Representation = "cartoon" | "cartoon+atoms" | "sticks" | "spheres";

export type UiAction =
  | { type: "focus_residue"; residue: number }
  | { type: "select_root"; root: string }
  | { type: "show_spectrum"; view: SpectrumViewId; root?: string; experiment?: string; residues?: number[]; at?: number }
  | { type: "highlight_residues"; residues: number[]; color?: string; label?: string }
  | { type: "color_structure"; scheme: ColorScheme }
  | { type: "set_representation"; representation: Representation }
  | { type: "clear_highlights" }
  /** the agent created/opened another project (e.g. an ARTINA import): load it in the UI */
  | { type: "switch_project"; projectId: string };

/** Server-sent events from POST /api/projects/[id]/chat (each line: `data: <json>\n\n`). */
export type ChatEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; id: string; name: string; input: unknown }
  | { type: "tool_end"; id: string; name: string; ok: boolean; summary: string }
  | { type: "ui"; action: UiAction }
  | { type: "state_changed" }
  | { type: "error"; message: string }
  | { type: "done" };

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Actions callable via POST /api/projects/[id]/actions and exposed as agent tools. */
export const ACTION_NAMES = [
  "get_project_summary",
  "import_pdb",
  "predict_esmfold_structure",
  "fetch_alphafold_structure",
  "get_spin_system",
  "get_residue",
  "list_problems",
  "explain_assignment",
  "export_results",
  "list_bruker_experiments",
  "process_bruker_1d",
  "deconvolve_1d",
  "structure_neighbors",
  "secondary_structure_from_shifts",
  "list_artina_proteins",
  "import_artina_protein",
  "get_import_status",
  "list_real_spectra",
] as const;
export type ActionName = (typeof ACTION_NAMES)[number];

export interface ActionRequest {
  action: ActionName;
  args?: Record<string, unknown>;
}

export interface ActionResponse {
  ok: boolean;
  result?: unknown;
  error?: string;
  ui?: UiAction[];
  changed?: boolean;
}
