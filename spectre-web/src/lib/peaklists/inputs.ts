// What a project made from your own data takes, shared by the upload dialog and the server: the
// triple-resonance experiment types, how they map onto the app's spectrum types, a guess of the
// type from a file name, the assigned peak-list formats, and the sequence-file reader (FASTA,
// plain one-letter, or three-letter codes).

/** Triple-resonance experiment types and the peaks each one shows. */
export const EXPERIMENT_TYPES = {
  hnca: { label: "HNCA", peaks: "CA(i), CA(i-1)" },
  hncoca: { label: "HN(CO)CA", peaks: "CA(i-1)" },
  hncacb: { label: "HNCACB", peaks: "CA/CB(i), CA/CB(i-1)" },
  cbcanh: { label: "CBCANH", peaks: "CA/CB(i), CA/CB(i-1)" },
  hncocacb: { label: "HN(CO)CACB", peaks: "CA/CB(i-1)" },
  cbcaconh: { label: "CBCA(CO)NH", peaks: "CA/CB(i-1)" },
  hnco: { label: "HNCO", peaks: "C′(i-1)" },
  hncaco: { label: "HN(CA)CO", peaks: "C′(i), C′(i-1)" },
} as const;
export type Experiment = keyof typeof EXPERIMENT_TYPES;
export const EXPERIMENTS_LIST = Object.keys(EXPERIMENT_TYPES) as Experiment[];

export function isExperiment(x: unknown): x is Experiment {
  return typeof x === "string" && x in EXPERIMENT_TYPES;
}

/**
 * The app's spectrum type for an experiment (the strips, planes and peak tables key spectra by
 * these). CBCANH carries the same peaks as an HNCACB, and HN(CO)CACB the same as a CBCA(CO)NH.
 */
export const APP_SPECTRUM_TYPE: Record<Experiment, string> = {
  hnca: "hnca",
  hncoca: "hncoca",
  hncacb: "hncacb",
  cbcanh: "hncacb",
  hncocacb: "hncocacb",
  cbcaconh: "hncocacb",
  hnco: "hnco",
  hncaco: "hncaco",
};

/** File extensions of NMRPipe spectra. */
export const PIPE_EXTENSIONS = [".pipe", ".ft3", ".ft", ".dat", ".nmrpipe"];

/** Guess the experiment from a file name, e.g. "HNcoCA.pipe" → hncoca, "cbca(co)nh.ft3" → cbcaconh. */
export function guessExperiment(fileName: string): Experiment | null {
  const stem = fileName
    .replace(/\.[^.]*$/, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  // longest names first so "hncacb" is not read as "hnca"
  const order: [string, Experiment][] = [
    ["cbcaconh", "cbcaconh"],
    ["hncocacb", "hncocacb"],
    ["hncacb", "hncacb"],
    ["cbcanh", "cbcanh"],
    ["hncaco", "hncaco"],
    ["hncoca", "hncoca"],
    ["hnca", "hnca"],
    ["hnco", "hnco"],
  ];
  for (const [key, tp] of order) if (stem.includes(key)) return tp;
  return null;
}

/** Assigned peak-list formats. */
export const PEAK_LIST_FORMATS = {
  sparky: { label: "Sparky", extensions: [".list"], hint: "Assignment w1 w2 w3 [Data Height], labels like E4N-P3CA-E4H" },
  xeasy: { label: "XEASY / CYANA", extensions: [".peaks"], hint: "#INAME headers; atoms as CA.3, or as numbers in a .prot shift list" },
  nmrpipe: { label: "NMRPipe", extensions: [".tab"], hint: "VARS / FORMAT table with X_PPM… and an ASS column" },
  ccpn: { label: "CcpNmr Analysis", extensions: [".csv", ".tsv"], hint: "peak table export with Assign F1… and Pos F1… columns" },
} as const;
export type PeakListFormat = keyof typeof PEAK_LIST_FORMATS;
export const PEAK_LIST_EXTENSIONS = [...new Set(Object.values(PEAK_LIST_FORMATS).flatMap((f) => [...f.extensions])), ".txt"];

export function isPeakListFormat(x: unknown): x is PeakListFormat {
  return typeof x === "string" && x in PEAK_LIST_FORMATS;
}

/** File extensions of XEASY shift lists (needed for .peaks files that give atoms as numbers). */
export const SHIFT_LIST_EXTENSIONS = [".prot"];

const ONE_LETTER: Record<string, string> = {
  ALA: "A", ARG: "R", ASN: "N", ASP: "D", CYS: "C", GLN: "Q", GLU: "E", GLY: "G", HIS: "H", ILE: "I",
  LEU: "L", LYS: "K", MET: "M", PHE: "F", PRO: "P", SER: "S", THR: "T", TRP: "W", TYR: "Y", VAL: "V",
};
const STANDARD = new Set(Object.values(ONE_LETTER));

/** One-letter code of a three-letter residue name (any case), or undefined. */
export function oneLetter(three: string): string | undefined {
  return ONE_LETTER[three.toUpperCase()];
}

export interface ParsedSequence {
  sequence: string;
  /** first FASTA header, without the ">" */
  header?: string;
  error?: string;
}

/**
 * A sequence file: FASTA (header lines skipped), a plain one-letter string, or three-letter codes
 * (one per line, optionally numbered). Only the 20 standard residues.
 */
export function parseSequenceText(text: string): ParsedSequence {
  const all = text.split(/\r?\n/).map((l) => l.trim());
  const header = all.find((l) => l.startsWith(">"))?.slice(1).trim() || undefined;
  const lines = all.filter((l) => l && !l.startsWith(">"));
  const words = lines.join(" ").split(/\s+/).filter(Boolean);
  if (words.length && words.every((w) => w.toUpperCase() in ONE_LETTER || /^\d+$/.test(w))) {
    const sequence = words.filter((w) => !/^\d+$/.test(w)).map((w) => ONE_LETTER[w.toUpperCase()]).join("");
    return sequence ? { sequence, header } : { sequence: "", header, error: "the file holds no residues" };
  }
  const sequence = lines.join("").replace(/ /g, "").toUpperCase();
  if (!sequence) return { sequence: "", header, error: "the file holds no residues" };
  const bad = [...new Set(sequence)].filter((c) => !STANDARD.has(c)).sort();
  if (bad.length) return { sequence: "", header, error: `unknown residue codes ${bad.join("")}` };
  return { sequence, header };
}
