// Model for the "Strips 3D" cube: one triple-resonance spectrum's peaks placed in a
// ¹H × ¹⁵N × ¹³C box on that spectrum's own (file) ppm scale, the amide columns they rise
// from, peak colours by type, the sequential links around a selected residue, and the peak
// lists used to synthesise slices when no measured spectrum is available.
import type { Confidence, ProjectView } from "../contract";
import { EXPERIMENTS } from "../spectra/experiments";
import { NOT_ASSIGNED, PEAK_SHORT, type ResidueInfo, type RootInfo } from "./data";
import { pseudoVoigt } from "./synth";
import { niceTicks } from "./ticks";

export type PeakKind = "ca" | "cb" | "co" | "other";
export type PeakRel = "i" | "im1" | "none";
export type SliceAxis = "n" | "c";

const LABEL_KIND: Record<string, [PeakKind, PeakRel]> = {
  "CA(i)": ["ca", "i"],
  "CA(i-1)": ["ca", "im1"],
  "CB(i)": ["cb", "i"],
  "CB(i-1)": ["cb", "im1"],
  "CO(i)": ["co", "i"],
  "CO(i-1)": ["co", "im1"],
};

const NUCLEUS: Record<PeakKind, string> = { ca: "Cα", cb: "Cβ", co: "C′", other: "¹³C" };

/** Engine spectrum types the cube can show, in display order (partner experiments side by side). */
const CUBE_TYPES = ["hncacb", "hncocacb", "hnca", "hncoca", "hncaco", "hnco"];

/** Peak colours: one hue per carbon (Cα green, Cβ violet, C′ teal), deep for residue i and
 *  light for i−1 (in dark mode the i peaks are the bright ones). Unclassified peaks are grey,
 *  tinted by phase. */
export const PEAK_COLORS = {
  light: { ca: ["#17803a", "#7cc68b"], cb: ["#5440c8", "#aa9ef0"], co: ["#0b7a72", "#72c4bc"], pos: "#8f9a92", neg: "#a39fbd" },
  dark: { ca: ["#56cc78", "#2f8049"], cb: ["#a194f5", "#5949ad"], co: ["#4ccabe", "#2a7c75"], pos: "#7e8a81", neg: "#8b86a9" },
} as const;

export interface CubePeak {
  index: number;
  id: string;
  name: string;
  root: string;
  amide: number; // index into CubeModel.amides
  resi: number | null;
  tag: string; // "I48" or "#66"
  label: string; // engine label, e.g. "CA(i-1)"
  short: string; // "Cα i−1"
  kind: PeakKind;
  rel: PeakRel;
  h: number;
  n: number;
  c: number;
  inty: number;
  /** |intensity| relative to the spectrum's strong peaks (95th percentile), 0–1 */
  amp: number;
}

export interface CubeAmide {
  index: number;
  root: string;
  resi: number | null;
  resn: string | null;
  tag: string;
  confidence: Confidence | "none";
  confidenceText: string;
  h: number;
  n: number;
  top: number | null;
  bottom: number | null;
  peaks: number[];
}

export interface CubeAxis {
  min: number;
  max: number;
  ticks: number[];
}

export interface CubeModel {
  tp: string;
  label: string;
  h: CubeAxis;
  n: CubeAxis;
  c: CubeAxis;
  peaks: CubePeak[];
  amides: CubeAmide[];
  /** peak types present, in legend order */
  types: { kind: PeakKind; rel: PeakRel; count: number }[];
  /** shift that moves HSQC ppm onto this spectrum's scale (median over shared amides) */
  hsqcShift: { h: number; n: number };
  assigned: boolean;
}

export function cubeExperiments(project: ProjectView): string[] {
  const have = new Set<string>();
  if (project.assignment) for (const s of project.assignment.spinSystems) for (const p of s.peaks) have.add(p.spec);
  else for (const s of project.spectra) if (s.peaks.length) have.add(s.tp);
  return CUBE_TYPES.filter((t) => have.has(t));
}

export function defaultCubeExperiment(list: string[]): string | null {
  return list.includes("hncacb") ? "hncacb" : list.includes("hnca") ? "hnca" : (list[0] ?? null);
}

export function peakColor(kind: PeakKind, rel: PeakRel, inty: number, dark: boolean): string {
  const pal = dark ? PEAK_COLORS.dark : PEAK_COLORS.light;
  if (kind === "other" || rel === "none") return inty >= 0 ? pal.pos : pal.neg;
  return pal[kind][rel === "i" ? 0 : 1];
}

export function peakTypeLabel(kind: PeakKind, rel: PeakRel): string {
  if (kind === "other" || rel === "none") return "unclassified";
  return `${NUCLEUS[kind]} (${rel === "i" ? "i" : "i−1"})`;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function axis(lo: number, hi: number, snap: number, count: number): CubeAxis {
  const min = Math.floor(lo / snap) * snap;
  const max = Math.ceil(hi / snap) * snap;
  const margin = (max - min) * 0.04;
  return { min, max, ticks: niceTicks(min, max, count).filter((t) => t > min + margin && t < max - margin) };
}

export function buildCubeModel(project: ProjectView, roots: Map<string, RootInfo>, tp: string): CubeModel {
  const a = project.assignment;
  const peaks: CubePeak[] = [];
  const amides: CubeAmide[] = [];
  const addPeak = (am: CubeAmide, name: string, label: string, h: number, n: number, c: number, inty: number) => {
    const [kind, rel] = LABEL_KIND[label] ?? ["other", "none"];
    const index = peaks.length;
    peaks.push({ index, id: `${am.root}:${name}:${index}`, name, root: am.root, amide: am.index, resi: am.resi, tag: am.tag, label, short: PEAK_SHORT[label] ?? "peak", kind, rel, h, n, c, inty, amp: 0 });
    am.peaks.push(index);
  };

  if (a) {
    for (const spin of a.spinSystems) {
      const info = roots.get(spin.root);
      const own = spin.peaks.filter((p) => p.spec === tp);
      const am: CubeAmide = {
        index: amides.length,
        root: spin.root,
        resi: info?.resi ?? null,
        resn: info?.resn ?? null,
        tag: info?.label ?? `#${spin.root}`,
        confidence: info?.confidence ?? "unassigned",
        confidenceText: info?.text ?? NOT_ASSIGNED,
        h: own.length ? mean(own.map((p) => p.h)) : spin.h,
        n: own.length ? mean(own.map((p) => p.n)) : spin.n,
        top: null,
        bottom: null,
        peaks: [],
      };
      amides.push(am);
      for (const p of own) addPeak(am, p.name, p.label, p.h, p.n, p.cp, p.inty);
    }
  } else {
    // no assignment yet: the raw peak list, grouped into amides by the root part of the name
    const groups = new Map<string, ProjectView["spectra"][number]["peaks"]>();
    for (const p of project.spectra.find((s) => s.tp === tp)?.peaks ?? []) {
      const key = p.name.split("_")[0] || p.name;
      const g = groups.get(key);
      if (g) g.push(p);
      else groups.set(key, [p]);
    }
    for (const [root, list] of groups) {
      const am: CubeAmide = {
        index: amides.length,
        root,
        resi: null,
        resn: null,
        tag: `#${root}`,
        confidence: "none",
        confidenceText: "assignment not run yet",
        h: mean(list.map((p) => p.f1)),
        n: mean(list.map((p) => p.f2)),
        top: null,
        bottom: null,
        peaks: [],
      };
      amides.push(am);
      for (const p of list) addPeak(am, p.name, "", p.f1, p.f2, p.f3, p.inty);
    }
  }

  for (const am of amides) {
    if (!am.peaks.length) continue;
    const cs = am.peaks.map((k) => peaks[k].c);
    am.top = Math.max(...cs);
    am.bottom = Math.min(...cs);
  }
  const mags = peaks.map((p) => Math.abs(p.inty)).sort((x, y) => x - y);
  const scale = mags.length ? mags[Math.min(mags.length - 1, Math.floor(mags.length * 0.95))] || mags[mags.length - 1] || 1 : 1;
  for (const p of peaks) p.amp = Math.min(1, Math.abs(p.inty) / scale);

  const order: [PeakKind, PeakRel][] = [
    ["ca", "i"],
    ["ca", "im1"],
    ["cb", "i"],
    ["cb", "im1"],
    ["co", "i"],
    ["co", "im1"],
    ["other", "none"],
  ];
  const types = order
    .map(([kind, rel]) => ({ kind, rel, count: peaks.filter((p) => p.kind === kind && p.rel === rel).length }))
    .filter((t) => t.count > 0);

  const hs = amides.map((x) => x.h);
  const ns = amides.map((x) => x.n);
  const cs = peaks.map((x) => x.c);
  const win = EXPERIMENTS[tp]?.window ?? [40, 70];
  const h = hs.length ? axis(Math.min(...hs) - 0.3, Math.max(...hs) + 0.3, 0.5, 6) : axis(6, 10.5, 0.5, 6);
  const n = ns.length ? axis(Math.min(...ns) - 2, Math.max(...ns) + 2, 1, 6) : axis(102, 134, 1, 6);
  const cLo = cs.length ? Math.min(...cs) - 2.5 : win[0];
  const cHi = cs.length ? Math.max(...cs) + 2.5 : win[1];
  const c = axis(cLo, cHi, cHi - cLo > 30 ? 5 : 2, 6);

  const byName = new Map(project.hsqc.map((p) => [p.name, p]));
  const dH: number[] = [];
  const dN: number[] = [];
  for (const am of amides) {
    const q = am.peaks.length ? byName.get(am.root) : undefined;
    if (!q) continue;
    dH.push(am.h - q.x);
    dN.push(am.n - q.y);
  }

  return {
    tp,
    label: EXPERIMENTS[tp]?.label ?? tp.toUpperCase(),
    h,
    n,
    c,
    peaks,
    amides,
    types,
    hsqcShift: { h: median(dH), n: median(dN) },
    assigned: !!a,
  };
}

// ------------------------------------------------------------------ sequential walk
export interface CubeArc {
  key: string;
  kind: PeakKind;
  /** the (i−1) peak in the strip of residue `resi` */
  from: [number, number, number];
  /** its partner: the (i) peak in the strip of residue resi − 1 (or that residue's consensus shift) */
  to: [number, number, number];
  fromPeak: number;
  toPeak: number | null;
  linked: boolean;
  resi: number;
  delta: number;
}

/** Links Cα/Cβ/C′(i−1) of each strip to the (i) peak of the previous residue's strip, for
 *  the residues within `span` of the selection. */
export function walkArcs(model: CubeModel, project: ProjectView, residues: ResidueInfo[], selected: number | null, span = 3): CubeArc[] {
  if (selected == null || !model.assigned) return [];
  const amideOf = new Map(model.amides.map((am) => [am.root, am]));
  const rootOf = new Map(residues.filter((r) => r.root).map((r) => [r.resi, r.root!]));
  const graph = project.assignment?.links ?? {};
  const linked = (x: string, y: string) => (graph[x] ?? []).some(([o]) => o === y) || (graph[y] ?? []).some(([o]) => o === x);
  const best = (am: CubeAmide, kind: PeakKind, rel: PeakRel) => {
    let out: CubePeak | null = null;
    for (const k of am.peaks) {
      const p = model.peaks[k];
      if (p.kind === kind && p.rel === rel && (!out || Math.abs(p.inty) > Math.abs(out.inty))) out = p;
    }
    return out;
  };
  const consensus = (resi: number, kind: PeakKind): number | null => {
    const key = kind === "ca" ? "CA" : kind === "cb" ? "CB" : kind === "co" ? "CO" : null;
    const v = key ? project.assignment?.residues.find((r) => r.resi === resi)?.shifts?.[key] : undefined;
    return typeof v === "number" ? v : null;
  };
  const out: CubeArc[] = [];
  for (let r = selected - span + 1; r <= selected + span; r++) {
    const ra = rootOf.get(r);
    const rb = rootOf.get(r - 1);
    const A = ra ? amideOf.get(ra) : undefined;
    const B = rb ? amideOf.get(rb) : undefined;
    if (!A || !B) continue;
    for (const kind of ["ca", "cb", "co"] as PeakKind[]) {
      const pf = best(A, kind, "im1");
      if (!pf) continue;
      const pt = best(B, kind, "i");
      let to: [number, number, number] | null = pt ? [pt.h, pt.n, pt.c] : null;
      if (!to) {
        const cc = consensus(r - 1, kind);
        if (cc != null) to = [B.h, B.n, cc];
      }
      if (!to) continue;
      out.push({ key: `${r}:${kind}`, kind, from: [pf.h, pf.n, pf.c], to, fromPeak: pf.index, toPeak: pt?.index ?? null, linked: linked(A.root, B.root), resi: r, delta: to[2] - pf.c });
    }
  }
  return out;
}

// ------------------------------------------------------------------ synthetic planes
export interface SynthPeak2D {
  x: number;
  y: number;
  amp: number;
}

/** Linewidths (FWHM, ppm) of the synthesised spectrum along the sliced axis. */
const SLICE_FWHM: Record<SliceAxis, number> = { n: 0.45, c: 0.55 };

/** The spectrum's peaks (file ppm) weighted by their distance from a
 *  slice: ¹H × ¹³C at a ¹⁵N value ("n") or ¹H × ¹⁵N at a ¹³C value ("c"). */
export function synthSlicePeaks(project: ProjectView, tp: string, slice: SliceAxis, at: number): SynthPeak2D[] {
  const out: SynthPeak2D[] = [];
  for (const p of project.spectra.find((s) => s.tp === tp)?.peaks ?? []) {
    const w = pseudoVoigt((slice === "n" ? p.f2 : p.f3) - at, SLICE_FWHM[slice]);
    if (w < 0.03) continue;
    out.push({ x: p.f1, y: slice === "n" ? p.f3 : p.f2, amp: p.inty * w });
  }
  return out;
}

/** HSQC peaks moved onto the cube spectrum's scale (for a synthesised floor). */
export function synthFloorPeaks(project: ProjectView, model: CubeModel): SynthPeak2D[] {
  return project.hsqc.map((p) => ({ x: p.x + model.hsqcShift.h, y: p.y + model.hsqcShift.n, amp: p.inty }));
}

/** Strongest |intensity| of a spectrum's peak list (95th percentile), for contour levels. */
export function spectrumScale(project: ProjectView, tp: string): number {
  const mags = (project.spectra.find((s) => s.tp === tp)?.peaks ?? []).map((p) => Math.abs(p.inty)).sort((a, b) => a - b);
  return mags.length ? mags[Math.min(mags.length - 1, Math.floor(mags.length * 0.95))] || 1 : 1;
}
