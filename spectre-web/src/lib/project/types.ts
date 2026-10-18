import type { AssignmentResult } from "../assignment";
import type { RawPeak2D, RawPeak3D } from "../spectra/peaklist";
import type { RealSpectrumMeta } from "../contract";
import type { Experiment, PeakListFormat } from "../peaklists/inputs";

/** The assigned peaks of one spectrum (ppm as in its peak list), keyed by app spectrum type. */
export interface SpectrumRecord {
  tp: string;
  file?: string;
  peaks: RawPeak3D[];
}

export interface HistoryEntry {
  at: string;
  actor: "user" | "agent" | "system";
  action: string;
  detail?: string;
}

export interface ProjectState {
  version: 1;
  id: string;
  createdAt: string;
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
  spectra: SpectrumRecord[];
  /** amides of the assignment (name = spin system) */
  hsqc: RawPeak2D[];
  pdb?: { id: string; text: string };
  results: {
    assignment?: AssignmentResult;
  };
  history: HistoryEntry[];
  /** real processed spectra (files in the server-side download cache, path relative to it) */
  realSpectra?: (RealSpectrumMeta & { file: string })[];
  /** alternative structures (deposited NMR ensemble, AlphaFold, ARTINA) */
  models?: { id: string; label: string; text: string }[];
  /** data licence / citation for imported data */
  attribution?: { text: string; url: string; license: string };
  /** provenance of an ARTINA import */
  artina?: ArtinaImportInfo;
  /** spectra and assigned peak lists of a project made from your own data or imported from ARTINA */
  inputs?: ProjectInputs;
}

/** An assigned peak list of one spectrum. */
export interface PeakListFile {
  /** file name inside the project's upload directory (unless `stored` is set) */
  file: string;
  /** a file used in place, as a stored data path (see paths.ts resolveStored), e.g. "2K50/peak_lists/HNCA_assigned.list" */
  stored?: string;
  /** name of the file as uploaded (or downloaded) */
  original: string;
  format: PeakListFormat;
  /** rows read */
  peaks: number;
  uploadedAt: string;
}

/** A 3D spectrum of a project made from your own data (or an ARTINA import), with its assigned peak list. */
export interface InputSpectrum {
  /** unique within the project; the spectrum's name in the views */
  name: string;
  experiment: Experiment;
  /** file name inside the project's upload directory (unless `stored` is set) */
  file: string;
  /**
   * a file used in place rather than copied into the upload directory, as a stored data path
   * (see paths.ts resolveStored), e.g. "2K50/spectra/HNCA.pipe" in the ARTINA cache
   */
  stored?: string;
  /** name of the file as uploaded (or downloaded) */
  original: string;
  sizeMB: number;
  uploadedAt: string;
  /** its assigned peak list; a spectrum without one is shown but not used in the assignment */
  peakList?: PeakListFile;
}

export interface ProjectInputs {
  spectra: InputSpectrum[];
  /** XEASY .prot shift list, for XEASY peak lists that give their atoms as numbers */
  shiftList?: { file: string; original: string; entries: number; uploadedAt: string };
}

/** A spectrum of an ARTINA import. */
export interface ArtinaSpectrumReport {
  /** ARTINA experiment name, e.g. "CBCAcoNH"; also the spectrum's name in the project */
  name: string;
  /** experiment type it is used as (absent for the 15N-HSQC, shown only) */
  experiment?: Experiment;
  /** stored data path of the NMRPipe file */
  file: string;
  sizeMB: number;
  /** stored data path of its deposited assigned peak list */
  peakList?: string;
}

/** Provenance of an ARTINA import (spectra with their deposited assigned peak lists). */
export interface ArtinaImportInfo {
  id: string;
  importedAt: string;
  spectra: ArtinaSpectrumReport[];
  /** where the sequence came from: the catalogue's sequence file or the deposited structure */
  sequenceFrom: "sequence file" | "deposited structure";
  /** milliseconds per stage: download, build */
  timings: Record<string, number>;
  notes: string[];
}
