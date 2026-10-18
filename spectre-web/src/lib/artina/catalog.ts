// ARTINA 100-protein NMR spectra dataset (https://nmrdb.ethz.ch/, CC BY 4.0): catalog access,
// local cache layout, the files an import downloads (spectra with their deposited assigned peak
// lists) and the ARTINA experiment → experiment type mapping.
import fs from "node:fs";
import path from "node:path";
import type { Experiment } from "../peaklists/inputs";
import type { ArtinaProteinSummary } from "../contract";

export interface ArtinaSpectrumEntry {
  index: number;
  type: string;
  size: string;
  ppm: string;
  freq: string;
  mb: number | null;
  files: Record<string, string>;
  expected: Record<string, string>;
  assigned: Record<string, string>;
  nExpected: string;
  nAssigned: string;
  pctAssigned: string;
}

export interface ArtinaProtein {
  anchor: string;
  id: string;
  residues: number;
  pdb: string | null;
  bmrb: string | null;
  year: string | null;
  reference: string | null;
  others: Record<string, string>;
  spectra: ArtinaSpectrumEntry[];
}

export interface ArtinaCatalog {
  source: string;
  title: string;
  authors: string;
  license: string;
  licenseUrl: string;
  fetched: string;
  proteins: ArtinaProtein[];
}

export const ARTINA_URL = "https://nmrdb.ethz.ch/";
export const ARTINA_LICENSE = "CC BY 4.0";

/** ARTINA experiment → experiment type (the names map one to one). */
export const BACKBONE_TYPES: Record<string, Experiment> = {
  HNCO: "hnco",
  HNcaCO: "hncaco",
  HNCA: "hnca",
  HNcoCA: "hncoca",
  CBCANH: "cbcanh",
  CBCAcoNH: "cbcaconh",
  HNCACB: "hncacb",
  HNcoCACB: "hncocacb",
};
/** backbone experiments in display order (the last two do not occur in the current catalogue) */
export const BACKBONE_ORDER = ["HNCO", "HNcaCO", "HNCA", "HNcoCA", "CBCANH", "CBCAcoNH", "HNCACB", "HNcoCACB"];
/** the 2D spectrum shown next to the backbone set (not part of the assignment) */
export const HSQC_TYPE = "N15HSQC";
/** structures attached to an import, in display order */
export const STRUCTURE_FILES = ["manual_structure.pdb", "AlphaFold.pdb", "ARTINA.pdb"] as const;
/** a sequence file, when the catalogue lists one (otherwise the sequence comes from the structure) */
export const SEQUENCE_FILES = ["sequence.fasta", "sequence.seq", "sequence.txt"];

let cached: ArtinaCatalog | null = null;

export function loadCatalog(): ArtinaCatalog {
  if (cached) return cached;
  const file = path.join(process.cwd(), "data/artina/catalog.json");
  cached = JSON.parse(fs.readFileSync(file, "utf8")) as ArtinaCatalog;
  return cached;
}

export function findProtein(id: string): ArtinaProtein | undefined {
  const key = id.trim().toUpperCase();
  return loadCatalog().proteins.find((p) => p.id.toUpperCase() === key || p.anchor.toUpperCase() === key || p.pdb?.toUpperCase() === key);
}

/** Root of the download cache (SPECTRE_DATA_DIR overrides, like the project store). */
export function cacheRoot(): string {
  return process.env.SPECTRE_DATA_DIR ? path.join(process.env.SPECTRE_DATA_DIR, "artina") : path.join(process.cwd(), ".data", "artina");
}

/** Local path for a dataset URL: <cache>/<ID>/<spectra|peak_lists|others>/<file>. */
export function localPathFor(url: string): string {
  const rel = url.split("ARTINA_NMR_spectra_dataset//")[1] ?? url.replace(/^https?:\/\/[^/]+\//, "");
  const safe = rel
    .split("/")
    .filter((s) => s && s !== "." && s !== "..")
    .join(path.sep);
  return path.join(cacheRoot(), safe);
}

export function spectrumEntry(p: ArtinaProtein, type: string): ArtinaSpectrumEntry | undefined {
  return p.spectra.find((s) => s.type === type);
}

export interface ImportFile {
  url: string;
  /** catalogue size (MB), for the download estimate */
  mb: number;
  /**
   * spectrum: a backbone 3D spectrum (experiment set) or the 15N-HSQC shown alongside; peaklist: the
   * deposited assigned peak list (Sparky) of a backbone spectrum
   */
  kind: "spectrum" | "peaklist" | "structure" | "sequence";
  /** ARTINA experiment name of a spectrum or peak list */
  type?: string;
  /** experiment type of a backbone spectrum or its peak list */
  experiment?: Experiment;
}

/** Files of an import: the NMRPipe backbone spectra with their assigned peak lists, the 15N-HSQC, the structures. */
export function importFiles(p: ArtinaProtein): ImportFile[] {
  const out: ImportFile[] = [];
  const add = (f: ImportFile | null) => {
    if (f && !out.some((o) => o.url === f.url)) out.push(f);
  };
  for (const type of BACKBONE_ORDER) {
    const s = spectrumEntry(p, type);
    if (!s?.files.pipe) continue;
    add({ url: s.files.pipe, mb: s.mb ?? 0, kind: "spectrum", type, experiment: BACKBONE_TYPES[type] });
    if (s.assigned?.sparky) add({ url: s.assigned.sparky, mb: 0.02, kind: "peaklist", type, experiment: BACKBONE_TYPES[type] });
  }
  const hsqc = spectrumEntry(p, HSQC_TYPE);
  if (hsqc?.files.pipe) add({ url: hsqc.files.pipe, mb: hsqc.mb ?? 1, kind: "spectrum", type: HSQC_TYPE });
  for (const f of STRUCTURE_FILES) if (p.others[f]) add({ url: p.others[f], mb: 2.5, kind: "structure" });
  const seq = SEQUENCE_FILES.find((f) => p.others[f]);
  if (seq) add({ url: p.others[seq], mb: 0.01, kind: "sequence" });
  return out;
}

/** Download size (MB) of the backbone spectra. */
export function backboneMB(p: ArtinaProtein): number {
  return +importFiles(p)
    .filter((f) => f.kind === "spectrum" && f.experiment)
    .reduce((s, f) => s + f.mb, 0)
    .toFixed(1);
}

/** Every file of an import is in the local cache. */
export function isCached(p: ArtinaProtein): boolean {
  return importFiles(p).every((f) => fs.existsSync(localPathFor(f.url)));
}

export function summarize(p: ArtinaProtein): ArtinaProteinSummary {
  return {
    id: p.id,
    residues: p.residues,
    pdb: p.pdb,
    bmrb: p.bmrb,
    year: p.year,
    reference: p.reference,
    spectra: p.spectra.map((s) => ({ type: s.type, size: s.size, ppm: s.ppm, freq: s.freq, mb: s.mb, nAssigned: s.nAssigned, pctAssigned: s.pctAssigned })),
    backbone: BACKBONE_ORDER.filter((t) => spectrumEntry(p, t)?.files.pipe),
    hasHsqc: Boolean(spectrumEntry(p, HSQC_TYPE)),
    backboneMB: backboneMB(p),
    cached: isCached(p),
  };
}

export function catalogSummaries(): ArtinaProteinSummary[] {
  return loadCatalog().proteins.map(summarize);
}
