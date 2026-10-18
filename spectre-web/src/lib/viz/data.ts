// View models for the spectrum panel, derived from the ProjectView contract.
import { CONFIDENCE, type Confidence, type ProjectView } from "../contract";
import { EXPERIMENTS } from "../spectra/experiments";
import type { SpinSystem } from "../assignment";

export interface RootInfo {
  root: string;
  resi: number | null;
  resn: string | null;
  label: string; // "L43" or "#12"
  confidence: Confidence;
  /** confidence in words, for tooltips */
  text: string;
  spin?: SpinSystem;
}

export const NOT_ASSIGNED = "not assigned";

export function parseResidue(s: string | undefined | null): { resi: number; resn: string } | null {
  if (!s) return null;
  const m = s.match(/^(-?\d+)([A-Z])$/);
  return m ? { resi: parseInt(m[1], 10), resn: m[2] } : null;
}

export function residueTag(resn: string, resi: number): string {
  return `${resn}${resi}`;
}

export function buildRootIndex(project: ProjectView): Map<string, RootInfo> {
  const out = new Map<string, RootInfo>();
  for (const s of project.assignment?.spinSystems ?? []) {
    const r = parseResidue(s.residue);
    out.set(s.root, {
      root: s.root,
      resi: r?.resi ?? null,
      resn: r?.resn ?? null,
      label: r ? residueTag(r.resn, r.resi) : `#${s.root}`,
      confidence: r ? s.consistency : "unassigned",
      // the consistency check of the assignment
      text: r ? CONFIDENCE[s.consistency].label.toLowerCase() : NOT_ASSIGNED,
      spin: s,
    });
  }
  return out;
}

export interface ResidueInfo {
  resi: number;
  resn: string;
  root?: string;
  confidence: Confidence;
}

export function buildResidues(project: ProjectView): ResidueInfo[] {
  const seq = project.sequence;
  const byResi = new Map((project.assignment?.residues ?? []).map((r) => [r.resi, r]));
  const out: ResidueInfo[] = [];
  for (let k = 0; k < seq.length; k++) {
    const resi = project.firstResidue + k;
    const resn = seq[k];
    const r = byResi.get(resi);
    const confidence: Confidence = resn === "P" ? "proline" : r?.root && r.consistency ? r.consistency : "unassigned";
    out.push({ resi, resn, root: r?.root, confidence });
  }
  return out;
}

// ------------------------------------------------------------------ 2D planes
export interface PlaneDatum {
  id: string;
  kind: "root" | "sidechain";
  root?: string;
  x: number;
  y: number;
  amp: number;
  resi: number | null;
  label: string; // label drawn next to the peak
  title: string; // tooltip heading
  confidence: Confidence | "none";
  confidenceText: string;
  extra?: [string, string][]; // extra tooltip rows
}

/** Backbone carbon shifts of an assigned residue, as tooltip rows. */
export function carbonRows(project: ProjectView, resi: number | null): [string, string][] {
  if (resi == null) return [];
  const sh = project.assignment?.residues.find((r) => r.resi === resi)?.shifts;
  if (!sh) return [];
  const out: [string, string][] = [];
  for (const [k, lab] of [
    ["CA", "Cα"],
    ["CB", "Cβ"],
    ["CO", "C′"],
  ] as const) {
    if (typeof sh[k] === "number") out.push([lab, `${sh[k].toFixed(2)} ppm`]);
  }
  return out;
}

export function hsqcData(project: ProjectView, roots: Map<string, RootInfo>): PlaneDatum[] {
  return project.hsqc.map((p) => {
    const sc = /^sc/i.test(p.name);
    if (sc) {
      return {
        id: p.name,
        kind: "sidechain" as const,
        x: p.x,
        y: p.y,
        amp: p.inty,
        resi: null,
        label: "",
        title: "Side-chain NH₂",
        confidence: "none" as const,
        confidenceText: "Asn/Gln side chain",
      };
    }
    const info = roots.get(p.name);
    if (!project.assignment) {
      return {
        id: p.name,
        kind: "root" as const,
        root: p.name,
        x: p.x,
        y: p.y,
        amp: p.inty,
        resi: null,
        label: `#${p.name}`,
        title: `Spin system ${p.name}`,
        confidence: "none" as const,
        confidenceText: "no assignment yet",
      };
    }
    return {
      id: p.name,
      kind: "root" as const,
      root: p.name,
      x: p.x,
      y: p.y,
      amp: p.inty,
      resi: info?.resi ?? null,
      label: info?.resi != null ? info.label : `#${p.name}`,
      title: info?.resi != null ? `${info.label} · spin system ${p.name}` : `Spin system ${p.name}`,
      confidence: info?.confidence ?? "unassigned",
      confidenceText: info?.text ?? NOT_ASSIGNED,
      extra: carbonRows(project, info?.resi ?? null),
    };
  });
}

// ------------------------------------------------------------------ strips
export interface StripPeak {
  name: string;
  h: number;
  n: number;
  c: number;
  amp: number;
  label: string; // CA(i), CB(i-1)…
}

export interface Strip {
  resi: number;
  resn: string;
  tp: string;
  root?: string;
  confidence: Confidence;
  h?: number;
  n?: number;
  own: StripPeak[]; // classified peaks of this root
  field: StripPeak[]; // every spectrum peak near this H/N, for synthesis
  note?: string;
}

/** Peaks of a spectrum as strip peaks. */
export function spectrumPeaks(project: ProjectView, tp: string): StripPeak[] {
  const spec = project.spectra.find((s) => s.tp === tp);
  if (!spec) return [];
  return spec.peaks.map((p) => ({ name: p.name, h: p.f1, n: p.f2, c: p.f3, amp: p.inty, label: "" }));
}

export const STRIP_PAIRS: { id: string; label: string; specs: string[] }[] = [
  { id: "cacb", label: "HNCACB · CBCA(CO)NH", specs: ["hncacb", "hncocacb"] },
  { id: "ca", label: "HNCA · HN(CO)CA", specs: ["hnca", "hncoca"] },
  { id: "co", label: "HN(CA)CO · HNCO", specs: ["hncaco", "hnco"] },
];

export function availablePairs(project: ProjectView) {
  const have = new Set(project.spectra.map((s) => s.tp));
  return STRIP_PAIRS.map((p) => ({ ...p, specs: p.specs.filter((s) => have.has(s)).slice(0, 2) })).filter((p) => p.specs.length > 0);
}

export function buildStrips(project: ProjectView, tp: string, residues: ResidueInfo[], roots: Map<string, RootInfo>): Strip[] {
  const field = spectrumPeaks(project, tp);
  return residues.map((r) => {
    const info = r.root ? roots.get(r.root) : undefined;
    const spin = info?.spin;
    if (r.resn === "P") return { resi: r.resi, resn: r.resn, tp, confidence: "proline" as Confidence, own: [], field: [], note: "no HN" };
    if (!spin) return { resi: r.resi, resn: r.resn, tp, confidence: "unassigned" as Confidence, own: [], field: [], note: "unassigned" };
    const own = spin.peaks
      .filter((p) => p.spec === tp)
      .map((p) => ({ name: p.name, h: p.h, n: p.n, c: p.cp, amp: p.inty, label: p.label }));
    // centre each strip on this spectrum's own peaks (per-spectrum H/N can differ from the root mean)
    const h = own.length ? own.reduce((a, p) => a + p.h, 0) / own.length : spin.h;
    const n = own.length ? own.reduce((a, p) => a + p.n, 0) / own.length : spin.n;
    const near = field.filter((p) => Math.abs(p.n - n) < 0.9 && Math.abs(p.h - h) < 0.25);
    return { resi: r.resi, resn: r.resn, tp, root: spin.root, confidence: r.confidence, h, n, own, field: near };
  });
}

/** Display name of a spectrum type; uploaded spectra keep the experiment they were uploaded as (e.g. CBCANH). */
export function experimentLabel(tp: string, project?: ProjectView | null): string {
  const uploaded = project?.inputs ? project.realSpectra?.find((r) => r.engineType === tp)?.experiment : undefined;
  return uploaded ?? EXPERIMENTS[tp]?.label ?? tp.toUpperCase();
}

// ------------------------------------------------------------------ link matrix
export interface MatrixModel {
  residues: ResidueInfo[];
  n: number;
  /** symmetric: cell (i, j) = evidence that the spin system on min(i,j) is followed by the one on max(i,j) */
  values: Float32Array;
  deltas: (Record<string, number> | null)[]; // per cell nucleus deltas (sparse, both triangles)
  links: Set<number>; // cells (both triangles) linked in the final connectivity graph
  maxValue: number;
}

// Display widths (ppm) for the match score: a little wider than the engine's carbon tolerance so
// that near-misses show as mid-tones (the ambiguity the assignment has to resolve).
const NUCLEI: { key: string; i: string; im1: string; sigma: number }[] = [
  { key: "Cα", i: "CA(i)", im1: "CA(i-1)", sigma: 0.5 },
  { key: "Cβ", i: "CB(i)", im1: "CB(i-1)", sigma: 0.6 },
  { key: "C′", i: "CO(i)", im1: "CO(i-1)", sigma: 0.25 },
];

function shiftsOf(spin: SpinSystem): { i: Record<string, number>; im1: Record<string, number> } {
  const acc: Record<string, number[]> = {};
  for (const p of spin.peaks) {
    if (!p.label) continue;
    (acc[p.label] ??= []).push(p.cp);
  }
  const avg = (l: string) => (acc[l]?.length ? acc[l].reduce((a, b) => a + b, 0) / acc[l].length : undefined);
  const i: Record<string, number> = {};
  const im1: Record<string, number> = {};
  for (const n of NUCLEI) {
    const a = avg(n.i);
    const b = avg(n.im1);
    if (a !== undefined) i[n.key] = a;
    if (b !== undefined) im1[n.key] = b;
  }
  return { i, im1 };
}

export function buildMatrix(project: ProjectView, residues: ResidueInfo[], roots: Map<string, RootInfo>): MatrixModel {
  const n = residues.length;
  const values = new Float32Array(n * n);
  const deltas: (Record<string, number> | null)[] = new Array(n * n).fill(null);
  const shifts = new Map<number, ReturnType<typeof shiftsOf>>();
  residues.forEach((r, k) => {
    const spin = r.root ? roots.get(r.root)?.spin : undefined;
    if (spin) shifts.set(k, shiftsOf(spin));
  });
  let maxValue = 0;
  for (const [a, sa] of shifts) {
    for (const [b, sb] of shifts) {
      if (b <= a) continue; // earlier residue a followed by later residue b; mirrored below
      let chi = 0;
      let used = 0;
      const d: Record<string, number> = {};
      for (const nuc of NUCLEI) {
        const x = sa.i[nuc.key];
        const y = sb.im1[nuc.key];
        if (x === undefined || y === undefined) continue;
        const delta = y - x;
        d[nuc.key] = delta;
        chi += (delta / nuc.sigma) ** 2;
        used++;
      }
      if (!used) continue;
      // geometric mean of per-nucleus agreement, discounted when few nuclei are available
      const v = Math.exp((-0.5 * chi) / used) * Math.min(1, 0.55 + 0.15 * used);
      if (v < 0.01) continue;
      values[a * n + b] = v;
      values[b * n + a] = v;
      deltas[a * n + b] = d;
      deltas[b * n + a] = d;
      if (v > maxValue) maxValue = v;
    }
  }
  const index = new Map(residues.map((r, k) => [r.resi, k]));
  const links = new Set<number>();
  for (const [root, edges] of Object.entries(project.assignment?.links ?? {})) {
    const ra = roots.get(root)?.resi;
    if (ra == null) continue;
    for (const [other] of edges) {
      const rb = roots.get(other)?.resi;
      if (rb == null) continue;
      const ia = index.get(ra);
      const ib = index.get(rb);
      if (ia === undefined || ib === undefined) continue;
      links.add(ia * n + ib);
      links.add(ib * n + ia);
    }
  }
  return { residues, n, values, deltas, links, maxValue: maxValue || 1 };
}

// ------------------------------------------------------------------ overlays on real planes
export const PEAK_SHORT: Record<string, string> = {
  "CA(i)": "Cα",
  "CA(i-1)": "Cα i−1",
  "CB(i)": "Cβ",
  "CB(i-1)": "Cβ i−1",
  "CO(i)": "C′",
  "CO(i-1)": "C′ i−1",
};

const SLICE_TOL: Record<string, number> = { "1H": 0.04, "15N": 0.4, "13C": 0.5 };

/**
 * Assigned peaks to draw on a real plane: amide roots on ¹H/¹⁵N planes, the spectrum's own
 * classified peaks (mapped back from the assignment's referencing to the file's ppm scale)
 * on planes that include the third dimension. Slices keep only peaks near the slice ppm.
 */
export function overlayForPlane(
  project: ProjectView,
  roots: Map<string, RootInfo>,
  meta: { ndim: number; engineType?: string; axes: { label: string }[]; experiment: string },
  xDim: number,
  yDim: number,
  mode: "projection" | "slice",
  at: number | null,
): PlaneDatum[] {
  const labels = meta.axes.map((a) => a.label);
  const xl = labels[xDim];
  const yl = labels[yDim];
  const pick2 = (h: number, n: number) => (xl === "1H" ? [h, n] : [n, h]) as [number, number];
  const isHN = new Set([xl, yl]).size === 2 && [xl, yl].every((l) => l === "1H" || l === "15N");
  if (meta.ndim === 2 && isHN) {
    return hsqcData(project, roots).map((d) => {
      const [x, y] = pick2(d.x, d.y);
      return { ...d, x, y };
    });
  }
  const tp = meta.engineType;
  if (!tp || meta.ndim !== 3 || !project.assignment) return [];
  const third = [0, 1, 2].find((k) => k !== xDim && k !== yDim) ?? 0;
  const tl = labels[third];
  if (isHN) {
    const out: PlaneDatum[] = [];
    for (const info of roots.values()) {
      const s = info.spin;
      if (!s || !s.peaks.some((p) => p.spec === tp)) continue;
      const [x, y] = pick2(s.h, s.n);
      out.push({
        id: s.root,
        kind: "root",
        root: s.root,
        x,
        y,
        amp: Math.max(...s.peaks.filter((p) => p.spec === tp).map((p) => Math.abs(p.inty))),
        resi: info.resi,
        label: info.resi != null ? info.label : `#${s.root}`,
        title: info.resi != null ? `${info.label} · spin system ${s.root}` : `Spin system ${s.root}`,
        confidence: info.confidence,
        confidenceText: info.text,
        extra: carbonRows(project, info.resi),
      });
    }
    return out;
  }
  const coord = (label: string, p: { h: number; n: number; cp: number }) =>
    label === "1H" ? p.h : label === "15N" ? p.n : label === "13C" ? p.cp : NaN;
  const out: PlaneDatum[] = [];
  for (const info of roots.values()) {
    const s = info.spin;
    if (!s) continue;
    for (const p of s.peaks) {
      if (p.spec !== tp) continue;
      if (mode === "slice" && at != null && Math.abs(coord(tl, p) - at) > (SLICE_TOL[tl] ?? 0.3)) continue;
      const x = coord(xl, p);
      const y = coord(yl, p);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const short = PEAK_SHORT[p.label] ?? "";
      out.push({
        id: `${s.root}:${p.name}`,
        kind: "root",
        root: s.root,
        x,
        y,
        amp: p.inty,
        resi: info.resi,
        label: info.resi != null ? `${info.label}${short ? ` ${short}` : ""}` : short,
        title: `${info.resi != null ? info.label : `Spin system ${s.root}`}${short ? ` · ${short}` : ""}`,
        confidence: info.confidence,
        confidenceText: info.text,
        extra: [
          ["Peak", p.name],
          ["Phase", p.inty >= 0 ? "positive" : "negative"],
        ],
      });
    }
  }
  return out;
}
