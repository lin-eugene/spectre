// Assigned peak lists and shift lists: XEASY .prot shift lists, XEASY / CYANA .peaks lists, Sparky
// lists with assignment labels ("E4N-P3CA-E4H"), NMRPipe .tab peak tables with an ASS column and
// CcpNmr Analysis peak-table exports (CSV or tab-separated). Isomorphic (plain text in).

export interface ShiftEntry {
  id: number;
  shift: number;
  error: number;
  atom: string;
  resi: number;
}

/** XEASY .prot: "id shift error atom residue" (999.000 = unassigned). */
export function parseXeasyProt(text: string): ShiftEntry[] {
  const out: ShiftEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim().split(/\s+/);
    if (t.length < 5 || line.trim().startsWith("#")) continue;
    const shift = parseFloat(t[1]);
    if (!Number.isFinite(shift) || shift >= 999) continue;
    out.push({ id: parseInt(t[0], 10), shift, error: parseFloat(t[2]) || 0, atom: t[3], resi: parseInt(t[4], 10) });
  }
  return out;
}

/** shift table: resi -> atom -> ppm */
export function shiftTable(entries: ShiftEntry[]): Map<number, Map<string, number>> {
  const m = new Map<number, Map<string, number>>();
  for (const e of entries) {
    if (!m.has(e.resi)) m.set(e.resi, new Map());
    m.get(e.resi)!.set(e.atom, e.shift);
  }
  return m;
}

export interface AtomRef {
  resi: number;
  /** one-letter residue code ('' when the label omits it) */
  resn: string;
  /** atom name as written ('' when the label names only the residue) */
  atom: string;
}

export interface AssignedPeak {
  label: string;
  /** per dimension (list order), null when unassigned */
  atoms: (AtomRef | null)[];
  ppm: number[];
  /** intensity when the list carries one (XEASY, Sparky "Data Height", NMRPipe HEIGHT, CcpNmr Height) */
  inty?: number;
}

const THREE: Record<string, string> = {
  ALA: "A", ARG: "R", ASN: "N", ASP: "D", CYS: "C", GLN: "Q", GLU: "E", GLY: "G", HIS: "H", ILE: "I",
  LEU: "L", LYS: "K", MET: "M", PHE: "F", PRO: "P", SER: "S", THR: "T", TRP: "W", TYR: "Y", VAL: "V",
};
const one = (three: string) => THREE[three.toUpperCase()] ?? "";
const ATOM = "[A-Za-z][A-Za-z0-9'\"*#%]*";
const PATTERNS: [RegExp, (m: RegExpMatchArray) => AtomRef][] = [
  // CcpNmr Analysis 3 NmrAtom ids: chain.seq.resType.atom, e.g. "A.12.LEU.H"
  [new RegExp(`^[^.\\s]*\\.(-?\\d+)\\.([A-Za-z]{3})\\.(${ATOM})$`), (m) => ({ resi: +m[1], resn: one(m[2]), atom: m[3] })],
  // XEASY / CYANA: atom.resi, e.g. "CA.3"
  [new RegExp(`^(${ATOM})\\.(-?\\d+)$`), (m) => ({ resi: +m[2], resn: "", atom: m[1] })],
  // Sparky: one-letter residue, number, atom, e.g. "E4N", "P3CA" (also "E4.N", "E4 N")
  [new RegExp(`^([A-Z])(-?\\d+)[.\\s]?(${ATOM})$`), (m) => ({ resi: +m[2], resn: m[1], atom: m[3] })],
  // three-letter residue, number, atom, e.g. "GLU4N", "Glu4.N"
  [new RegExp(`^([A-Za-z]{3})(-?\\d+)[.\\s]?(${ATOM})$`), (m) => ({ resi: +m[2], resn: one(m[1]), atom: m[3] })],
  // CcpNmr Analysis 2: number, three-letter residue, atom, e.g. "4GluN", "4 Glu N"
  [new RegExp(`^(-?\\d+)\\s*([A-Za-z]{3})\\s*(${ATOM})$`), (m) => ({ resi: +m[1], resn: one(m[2]), atom: m[3] })],
  // residue only: "E4", "GLU4", "4Glu"
  [/^([A-Z])(-?\d+)$/, (m) => ({ resi: +m[2], resn: m[1], atom: "" })],
  [/^([A-Za-z]{3})(-?\d+)$/, (m) => ({ resi: +m[2], resn: one(m[1]), atom: "" })],
  [/^(-?\d+)\s*([A-Za-z]{3})$/, (m) => ({ resi: +m[1], resn: one(m[2]), atom: "" })],
];

/**
 * One assignment, written in any of the common styles: "E4N", "E4.N", "GLU4N", "4GluN",
 * "A.4.GLU.N" (CcpNmr 3, also with an "NA:" prefix), "N.4" (XEASY). null when unassigned or not
 * recognised ("?", "*", "None", CcpNmr's "@" placeholders).
 */
export function parseAtomRef(token: string): AtomRef | null {
  const t = token.trim().replace(/^["']|["']$/g, "").replace(/^NA:/, "").trim();
  if (!t || /^(\?+|\*|-|none|null|unassigned)$/i.test(t) || t.includes("@")) return null;
  for (const [re, make] of PATTERNS) {
    const m = t.match(re);
    if (m) return make(m);
  }
  return null;
}

/**
 * Atom references of a label's components; a bare atom name takes the residue of the component
 * before it ("E4N-CA-H").
 */
function parseLabelParts(parts: string[]): (AtomRef | null)[] {
  const out: (AtomRef | null)[] = [];
  let prev: { resi: number; resn: string } | null = null;
  for (const raw of parts) {
    const p = raw.trim();
    const ref = parseAtomRef(p);
    if (ref) {
      prev = { resi: ref.resi, resn: ref.resn };
      out.push(ref);
    } else if (prev && new RegExp(`^${ATOM}$`).test(p) && !/^\?+$/.test(p)) {
      out.push({ resi: prev.resi, resn: prev.resn, atom: p }); // residue omitted: same as previous
    } else out.push(null);
  }
  return out;
}

/** Parse a Sparky assignment label into per-dimension atom references. */
export function parseSparkyLabel(label: string, ndim: number): (AtomRef | null)[] {
  const parts = label.split("-");
  const out = parseLabelParts(parts.slice(0, ndim));
  while (out.length < ndim) out.push(null);
  return out;
}

/**
 * Parse a free-text assignment (an NMRPipe ASS value) into its atom references, in the order
 * written; they are matched to dimensions by nucleus, not by position.
 */
export function parseFreeLabel(label: string): AtomRef[] {
  return parseLabelParts(label.split(/[-;,/]+/)).filter((a): a is AtomRef => a !== null);
}

/** Sparky peak list ("Assignment w1 w2 [w3 [w4]] [Data Height]"); 999.000 rows are skipped. */
export function parseSparkyAssigned(text: string): { ndim: number; peaks: AssignedPeak[] } {
  const peaks: AssignedPeak[] = [];
  let ndim = 0;
  let heightCol = -1;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const t = line.split(/\s+/);
    if (/^Assignment$/i.test(t[0])) {
      ndim = t.filter((c) => /^w\d$/i.test(c)).length;
      const hi = t.findIndex((c) => /^Height$/i.test(c));
      heightCol = hi >= 0 ? hi - 1 : -1; // "Data Height" is two header words for one column
      continue;
    }
    if (!ndim) ndim = t.length - 1 >= 2 ? Math.min(4, t.length - 1) : 2;
    if (t.length < ndim + 1) continue;
    const ppm = t.slice(1, ndim + 1).map(Number);
    if (ppm.some((v) => !Number.isFinite(v) || v >= 999)) continue;
    const inty = heightCol > 0 && t[heightCol] !== undefined ? Number(t[heightCol]) : undefined;
    peaks.push({ label: t[0], atoms: parseSparkyLabel(t[0], ndim), ppm, ...(Number.isFinite(inty) ? { inty } : {}) });
  }
  return { ndim, peaks };
}

/**
 * XEASY .peaks: "#INAME k X" headers; rows "id s1 .. sN color type inty err e 0 a1 .. aN". The
 * assignments are atoms written as "CA.3" (CYANA), or atom numbers of a .prot shift list (XEASY);
 * numbers are resolved with `shifts` when given, and counted in `numbered` otherwise. 0 means
 * unassigned.
 */
export function parseXeasyPeaks(text: string, shifts?: ShiftEntry[]): { ndim: number; names: string[]; peaks: AssignedPeak[]; numbered: number } {
  let ndim = 0;
  const names: string[] = [];
  const peaks: AssignedPeak[] = [];
  const byId = shifts ? new Map(shifts.map((s) => [s.id, s])) : null;
  let numbered = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      const m = line.match(/^#\s*Number of dimensions\s+(\d+)/i);
      if (m) ndim = parseInt(m[1], 10);
      const n = line.match(/^#INAME\s+(\d+)\s+(\S+)/i);
      if (n) names[parseInt(n[1], 10) - 1] = n[2];
      continue;
    }
    const t = line.split(/\s+/);
    if (!ndim) continue;
    const ppm = t.slice(1, 1 + ndim).map(Number);
    if (ppm.some((v) => !Number.isFinite(v) || v >= 999)) continue;
    const inty = Number(t[1 + ndim + 2]);
    const assign = t.slice(1 + ndim + 6, 1 + ndim + 6 + ndim);
    const atoms = assign.map((a): AtomRef | null => {
      const m = a.match(/^([^.]+)\.(-?\d+)$/);
      if (m) return { atom: m[1], resi: parseInt(m[2], 10), resn: "" };
      if (/^\d+$/.test(a) && a !== "0") {
        const s = byId?.get(parseInt(a, 10));
        if (s) return { atom: s.atom, resi: s.resi, resn: "" };
        if (!byId) numbered++;
      }
      return null;
    });
    while (atoms.length < ndim) atoms.push(null);
    peaks.push({ label: assign.join("-"), atoms, ppm, ...(Number.isFinite(inty) ? { inty } : {}) });
  }
  return { ndim, names, peaks, numbered };
}

/**
 * NMRPipe peak table (.tab): VARS and FORMAT lines, DATA X_AXIS/Y_AXIS/Z_AXIS lines naming the
 * axes, then one row per peak. Positions from X_PPM, Y_PPM (, Z_PPM, A_PPM), the height from
 * HEIGHT, the assignment from ASS (free text such as "E4N-P3CA-E4H"; NULLSTRING means none).
 */
export function parseNmrPipeTab(text: string): { ndim: number; names: string[]; peaks: AssignedPeak[] } | { error: string } {
  let vars: string[] = [];
  let nullString = "*";
  const axisName: Record<string, string> = {};
  const peaks: AssignedPeak[] = [];
  const AXES = ["X", "Y", "Z", "A"];
  let ppmCols: number[] = [];
  let heightCol = -1;
  let assCol = -1;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const t = line.split(/\s+/);
    const key = t[0].toUpperCase();
    if (key === "VARS") {
      vars = t.slice(1).map((v) => v.toUpperCase());
      ppmCols = AXES.map((a) => vars.indexOf(`${a}_PPM`)).filter((i) => i >= 0);
      heightCol = vars.indexOf("HEIGHT");
      assCol = vars.indexOf("ASS");
      continue;
    }
    if (key === "DATA") {
      const m = line.match(/^DATA\s+([XYZA])_AXIS\s+(\S+)/i);
      if (m) axisName[m[1].toUpperCase()] = m[2];
      continue;
    }
    if (key === "NULLSTRING") {
      nullString = t[1] ?? nullString;
      continue;
    }
    if (key === "FORMAT" || key === "REMARK" || key === "NULLVALUE" || line.startsWith("#")) continue;
    if (!vars.length) continue;
    if (!ppmCols.length) return { error: "the table has no X_PPM column" };
    const ppm = ppmCols.map((i) => Number(t[i]));
    if (ppm.some((v) => !Number.isFinite(v))) continue;
    const inty = heightCol >= 0 ? Number(t[heightCol]) : NaN;
    const ass =assCol >= 0 && t[assCol] !== undefined && t[assCol] !== nullString ? t[assCol] : "";
    const atoms = ass ? parseFreeLabel(ass) : [];
    peaks.push({ label: ass, atoms, ppm, ...(Number.isFinite(inty) ? { inty } : {}) });
  }
  if (!vars.length) return { error: "no VARS line: not an NMRPipe peak table" };
  return { ndim: ppmCols.length, names: AXES.slice(0, ppmCols.length).map((a) => axisName[a] ?? ""), peaks };
}

/** Split one CSV line (double quotes, "" escapes) or a tab-separated line. */
function splitRow(line: string, delim: string): string[] {
  if (delim === "\t") return line.split("\t");
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * CcpNmr Analysis peak table (version 2 or 3, CSV or tab-separated): "Assign F1…" and "Pos F1…"
 * (or "Position F1…") columns per dimension, and "Height". An assignment cell may list several
 * atoms ("A.4.GLU.H, A.5.HIS.H"); the first is used and the peak counted in `ambiguous`.
 */
export function parseCcpnTable(text: string): { ndim: number; peaks: AssignedPeak[]; ambiguous: number } | { error: string } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const headerAt = lines.findIndex((l) => /assign/i.test(l) && /pos/i.test(l));
  if (headerAt < 0) return { error: "no header with Assign F1… and Pos F1… columns" };
  const delim = lines[headerAt].includes("\t") ? "\t" : ",";
  const header = splitRow(lines[headerAt], delim).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const posCol: number[] = [];
  const assCol: number[] = [];
  for (let d = 1; d <= 4; d++) {
    const p = header.findIndex((h) => new RegExp(`^(pos|position)f${d}(ppm)?$`).test(h));
    if (p < 0) break;
    posCol.push(p);
    assCol.push(header.findIndex((h) => new RegExp(`^assign(ment)?f${d}$`).test(h)));
  }
  if (!posCol.length) return { error: "no Pos F1 / Position F1 column" };
  const heightCol = header.findIndex((h) => h === "height");
  const peaks: AssignedPeak[] = [];
  let ambiguous = 0;
  for (const line of lines.slice(headerAt + 1)) {
    const t = splitRow(line, delim);
    const ppm = posCol.map((i) => Number(t[i]));
    if (ppm.some((v) => !Number.isFinite(v))) continue;
    let multi = false;
    const atoms = assCol.map((i) => {
      const cell = i >= 0 ? (t[i] ?? "").trim() : "";
      const first = cell.split(/[,;|]\s*/)[0] ?? "";
      if (first !== cell) multi = true;
      return parseAtomRef(first);
    });
    if (multi) ambiguous++;
    const inty = heightCol >= 0 ? Number(t[heightCol]) : NaN;
    const label = assCol.map((i) => (i >= 0 ? (t[i] ?? "").trim() : "")).join(" | ");
    peaks.push({ label, atoms, ppm, ...(Number.isFinite(inty) ? { inty } : {}) });
  }
  return { ndim: posCol.length, peaks, ambiguous };
}
