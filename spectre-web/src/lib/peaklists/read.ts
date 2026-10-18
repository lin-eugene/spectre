// Reads an assigned 3D peak list in any of the supported formats (Sparky, XEASY/CYANA, NMRPipe,
// CcpNmr Analysis) into peaks with their 1H, 15N and 13C positions and what the list assigns to
// each nucleus. Columns are told apart by the atoms assigned in them, else by their names in the
// file, else by their ppm ranges. Isomorphic (plain text in).
import { nucleusLabel } from "../spectra/cube";
import { parseCcpnTable, parseNmrPipeTab, parseSparkyAssigned, parseXeasyPeaks, type AssignedPeak as ListRow, type AtomRef, type ShiftEntry } from "../spectra/formats/assignments";
import { PEAK_LIST_FORMATS, type PeakListFormat } from "./inputs";

export type Nucleus = "H" | "N" | "C";
const NUCLEI: Nucleus[] = ["H", "N", "C"];

export interface ListPeak {
  /** row number in the list, from 1 */
  id: number;
  h: number;
  n: number;
  c: number;
  /** intensity, when the list gives one */
  height?: number;
  /** what the list assigns to each nucleus (null: nothing) */
  atoms: Record<Nucleus, AtomRef | null>;
  /** the assignment as written in the list */
  label: string;
}

export interface ReadPeakList {
  format: PeakListFormat;
  peaks: ListPeak[];
  /** list column (from 0) of each nucleus */
  dims: Record<Nucleus, number>;
  warnings: string[];
}

export interface ReadError {
  error: string;
  /** an XEASY list whose atoms are numbers of a .prot shift list that was not given */
  needsShiftList?: boolean;
}

/** The format of a peak list, from its contents (and the file name's extension as a hint). */
export function detectFormat(text: string, fileName = ""): PeakListFormat | null {
  if (/^\s*#\s*(Number of dimensions|INAME)/im.test(text)) return "xeasy";
  if (/^\s*VARS\s/m.test(text)) return "nmrpipe";
  const header = text.split(/\r?\n/).find((l) => l.trim());
  if (header && /assign/i.test(header) && /pos/i.test(header) && /[,\t]/.test(header)) return "ccpn";
  if (/^\s*Assignment\s+w1/im.test(text)) return "sparky";
  const ext = fileName.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
  for (const [format, f] of Object.entries(PEAK_LIST_FORMATS)) if ((f.extensions as readonly string[]).includes(ext)) return format as PeakListFormat;
  // rows like "E4N-P3CA-E4H 120.9 63.3 8.68": a Sparky list without its header
  const rows = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
  if (rows.length && rows.slice(0, 20).every((l) => /^\s*\S+(\s+-?\d+(\.\d+)?([eE][-+]?\d+)?){3,}\s*$/.test(l))) return "sparky";
  return null;
}

/** H, N or C from an atom name (HN, H → H; N → N; CA, CB, C, CO → C); null for others. */
export function atomNucleus(atom: string): Nucleus | null {
  const a = atom.trim().toUpperCase();
  if (!a) return null;
  if (a[0] === "H") return "H";
  if (a[0] === "N") return "N";
  if (a[0] === "C") return "C";
  return null;
}

/** Nucleus of a column from its name in the file (e.g. "HN", "15N", "CA"), if recognisable. */
function nucleusOfName(name: string | undefined): Nucleus | null {
  if (!name) return null;
  const l = nucleusLabel(name);
  return l === "1H" ? "H" : l === "15N" ? "N" : l === "13C" ? "C" : null;
}

/** Nucleus of a column from its ppm values: 1H below 14 ppm, 15N 95–140 ppm, 13C otherwise. */
function nucleusOfRange(values: number[]): Nucleus {
  const s = [...values].sort((a, b) => a - b);
  const median = s[s.length >> 1];
  if (median < 14) return "H";
  if (median >= 95 && median <= 140) return "N";
  return "C";
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

/**
 * Read an assigned 3D peak list. `format` defaults to the detected one; `shifts` resolves XEASY
 * lists that give their atoms as numbers of a .prot shift list.
 */
export function readPeakList(text: string, opts: { format?: PeakListFormat; fileName?: string; shifts?: ShiftEntry[] } = {}): ReadPeakList | ReadError {
  const format = opts.format ?? detectFormat(text, opts.fileName);
  if (!format) return { error: `not a recognised peak list (supported: ${Object.values(PEAK_LIST_FORMATS).map((f) => f.label).join(", ")})` };
  const warnings: string[] = [];
  let rows: ListRow[];
  let ndim: number;
  let names: string[] = [];
  /** the atoms of a row are given per column (all formats but NMRPipe's free-text ASS) */
  let positional = true;
  if (format === "sparky") {
    const r = parseSparkyAssigned(text);
    rows = r.peaks;
    ndim = r.ndim;
  } else if (format === "xeasy") {
    const r = parseXeasyPeaks(text, opts.shifts);
    if (r.numbered && !r.peaks.some((p) => p.atoms.some(Boolean))) {
      return { error: "this XEASY list gives its atoms as numbers of a .prot shift list: add the .prot file too", needsShiftList: true };
    }
    if (r.numbered) warnings.push(`${r.numbered} atom numbers are not in the shift list`);
    rows = r.peaks;
    ndim = r.ndim;
    names = r.names;
  } else if (format === "nmrpipe") {
    const r = parseNmrPipeTab(text);
    if ("error" in r) return r;
    rows = r.peaks;
    ndim = r.ndim;
    names = r.names;
    positional = false;
  } else {
    const r = parseCcpnTable(text);
    if ("error" in r) return r;
    rows = r.peaks;
    ndim = r.ndim;
    if (r.ambiguous) warnings.push(`${r.ambiguous} peaks have more than one assignment in a dimension; the first one was used`);
  }
  const label = PEAK_LIST_FORMATS[format].label;
  if (!rows.length) return { error: `no peaks found in this ${label} list` };
  if (ndim !== 3) return { error: `this is a ${ndim}D peak list; Spectre needs the 3D list of a triple-resonance spectrum (1H, 15N and 13C)` };

  // ------------------------------------------------------------------ which column is which nucleus
  const columns: Nucleus[] = [];
  for (let d = 0; d < ndim; d++) {
    const votes: Record<Nucleus, number> = { H: 0, N: 0, C: 0 };
    if (positional) {
      for (const r of rows) {
        const nuc = r.atoms[d]?.atom ? atomNucleus(r.atoms[d]!.atom) : null;
        if (nuc) votes[nuc]++;
      }
    }
    const best = NUCLEI.reduce((a, b) => (votes[b] > votes[a] ? b : a));
    columns.push(votes[best] > 0 ? best : (nucleusOfName(names[d]) ?? nucleusOfRange(rows.map((r) => r.ppm[d]))));
  }
  const dims = Object.fromEntries(NUCLEI.map((n) => [n, columns.indexOf(n)])) as Record<Nucleus, number>;
  if (NUCLEI.some((n) => dims[n] < 0)) {
    return { error: `cannot tell the 1H, 15N and 13C columns apart (they look like ${columns.join(", ")}; medians ${[0, 1, 2].map((d) => median(rows.map((r) => r.ppm[d])).toFixed(1)).join(", ")} ppm)` };
  }

  // ------------------------------------------------------------------ peaks
  const peaks: ListPeak[] = rows.map((r, k) => {
    const atoms: Record<Nucleus, AtomRef | null> = { H: null, N: null, C: null };
    const place = (nuc: Nucleus | null, a: AtomRef) => {
      if (nuc && !atoms[nuc]) atoms[nuc] = a;
    };
    if (positional) {
      r.atoms.forEach((a, d) => {
        if (a) place(a.atom ? (atomNucleus(a.atom) ?? columns[d]) : columns[d], a);
      });
    } else {
      for (const a of r.atoms) {
        if (!a) continue;
        if (a.atom) place(atomNucleus(a.atom), a);
        else {
          // a residue without atoms ("E4") assigns the amide
          place("H", a);
          place("N", a);
        }
      }
    }
    return {
      id: k + 1,
      h: r.ppm[dims.H],
      n: r.ppm[dims.N],
      c: r.ppm[dims.C],
      ...(r.inty !== undefined ? { height: r.inty } : {}),
      atoms,
      label: r.label,
    };
  });
  if (!peaks.some((p) => p.atoms.H || p.atoms.N || p.atoms.C)) return { error: `none of the ${peaks.length} peaks in this ${label} list is assigned` };
  return { format, peaks, dims, warnings };
}

/**
 * The shift of numbering that best matches the residue names of a list's amide assignments to
 * the sequence: 0 when they already match (or the list gives no residue names). `named` counts the
 * amide assignments that name a residue type; `matched` those that match at the best shift, and
 * `matchedAsIs` those that match without one.
 */
export function numberingOffset(peaks: ListPeak[], sequence: string, firstResidue: number): { offset: number; matched: number; matchedAsIs: number; named: number } {
  const named = peaks.map((p) => p.atoms.N ?? p.atoms.H).filter((a): a is AtomRef => !!a && !!a.resn);
  const score = (off: number) => named.filter((a) => sequence[a.resi + off - firstResidue] === a.resn).length;
  const matchedAsIs = score(0);
  let best = { offset: 0, matched: matchedAsIs };
  if (named.length && matchedAsIs < named.length) {
    // every shift that puts at least one named residue inside the sequence
    const resis = named.map((a) => a.resi);
    const lo = firstResidue - Math.max(...resis);
    const hi = firstResidue + sequence.length - 1 - Math.min(...resis);
    for (let off = lo; off <= hi; off++) {
      const s = score(off);
      if (s > best.matched) best = { offset: off, matched: s };
    }
  }
  return { ...best, matchedAsIs, named: named.length };
}
