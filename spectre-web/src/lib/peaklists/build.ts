// Builds the assignment the app displays from a project's assigned peak lists, one per 3D
// spectrum. The lists are the assignment: every peak goes to the spin system of its amide's
// residue, its carbon is labelled relative to that residue (CA(i), CB(i-1), CO(i)…), and each
// residue's shifts are the mean over its peaks. Nothing is placed or guessed; what is computed is a
// consistency check of each residue:
// - conflict: peaks of one atom that disagree (e.g. CA(i) in one strip and CA(i-1) in the next),
//   a carbon shift implausible for the residue type, or an atom the residue type does not have;
// - unusual: a shift far from the BMRB average of the residue type;
// - a sequential link: a CA, CB or C′ of residue i that matches the (i-1) peak of residue i+1.
// Residues without conflicts are "veryHigh" when linked to a neighbour and nothing is unusual,
// "high" otherwise; residues with a conflict are "low".
import { CONSISTENCY_TOLERANCE } from "../contract";
import { RESULT_VERSION, type AssignedPeak, type AssignmentResult, type Consistency, type Link, type PeakListSummary, type ResidueAssignment, type SpinSystem, type SpinSystemIssue } from "../assignment";
import { P1TO3 } from "../residues";
import type { RawPeak2D } from "../spectra/peaklist";
import type { SpectrumRecord } from "../project/types";
import { APP_SPECTRUM_TYPE, EXPERIMENT_TYPES, type Experiment, type PeakListFormat } from "./inputs";
import type { ListPeak } from "./read";
import { hasAtom, shiftZ, typeProbabilities, type TypingAtom } from "./typing";

/** Tolerances of the consistency check. */
export const TOLERANCE = CONSISTENCY_TOLERANCE;

export interface BuildList {
  /** spectrum name (unique in the project) */
  name: string;
  experiment: Experiment;
  format: PeakListFormat;
  /** the list's file name as uploaded */
  file: string;
  peaks: ListPeak[];
  /** intensity at a position, for peaks the list gives no height for (read from the spectrum) */
  heightAt?: (h: number, n: number, c: number) => number;
}

export interface BuildContext {
  sequence: string;
  firstResidue: number;
  lists: BuildList[];
}

export interface Built {
  assignment: AssignmentResult;
  spectra: SpectrumRecord[];
  hsqc: RawPeak2D[];
}

type ShiftAtom = "HN" | "N" | "CA" | "CB" | "CO";
const CARBON: Record<string, "CA" | "CB" | "CO"> = { CA: "CA", CB: "CB", C: "CO", CO: "CO", "C'": "CO" };
/** AssignedPeak.atom of each carbon */
const PEAK_ATOM: Record<"CA" | "CB" | "CO", string> = { CA: "CA", CB: "CB", CO: "C" };
const TYPING_ATOM: Record<ShiftAtom, TypingAtom> = { HN: "H", N: "N", CA: "CA", CB: "CB", CO: "C" };
const ATOM_TEXT: Record<ShiftAtom, string> = { HN: "Hᴺ", N: "N", CA: "Cα", CB: "Cβ", CO: "C′" };
const NUCLEUS_OF: Record<ShiftAtom, "H" | "N" | "C"> = { HN: "H", N: "N", CA: "C", CB: "C", CO: "C" };

/** Peaks each experiment shows for residue i of a spin system (CB only for non-glycines). */
const EXPECTED: Record<Experiment, string[]> = {
  hnca: ["CA(i)", "CA(i-1)"],
  hncoca: ["CA(i-1)"],
  hncacb: ["CA(i)", "CB(i)", "CA(i-1)", "CB(i-1)"],
  cbcanh: ["CA(i)", "CB(i)", "CA(i-1)", "CB(i-1)"],
  hncocacb: ["CA(i-1)", "CB(i-1)"],
  cbcaconh: ["CA(i-1)", "CB(i-1)"],
  hnco: ["CO(i-1)"],
  hncaco: ["CO(i)", "CO(i-1)"],
};
/** experiments that show the CB of residue i, and of residue i-1 */
const CB_I = new Set<Experiment>(["hncacb", "cbcanh"]);
const CB_IM1 = new Set<Experiment>(["hncacb", "cbcanh", "hncocacb", "cbcaconh"]);

export const SKIP_REASONS = {
  amide: "amide not assigned",
  split: "H and N assigned to different residues",
  outside: "residue outside the sequence",
  name: "residue type differs from the sequence",
} as const;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const AA3 = (c: string | undefined) => (c ? (P1TO3[c] ?? c).charAt(0) + (P1TO3[c] ?? c).slice(1).toLowerCase() : "?");

interface Observation {
  value: number;
  /** spectrum label, e.g. HNCA */
  spectrum: string;
  /** residue number of the strip (spin system) the peak is in */
  strip: number;
}

export function buildAssignment(ctx: BuildContext): Built {
  const { sequence, firstResidue } = ctx;
  const resnAt = (resi: number) => sequence[resi - firstResidue];
  const resLabel = (resi: number) => `${AA3(resnAt(resi))} ${resi}`;
  const notes: string[] = [];
  const inputs: PeakListSummary[] = [];

  // ------------------------------------------------------------------ peaks into spin systems
  const strips = new Map<number, AssignedPeak[]>();
  const obs = new Map<string, Observation[]>(); // `${resi}:${atom}`
  const observe = (resi: number, atom: ShiftAtom, o: Observation) => {
    const key = `${resi}:${atom}`;
    (obs.get(key) ?? obs.set(key, []).get(key)!).push(o);
  };
  const spectra: SpectrumRecord[] = [];
  for (const list of ctx.lists) {
    const label = EXPERIMENT_TYPES[list.experiment].label;
    const spec = APP_SPECTRUM_TYPE[list.experiment];
    const skipped: Record<string, number> = {};
    const skip = (why: string) => (skipped[why] = (skipped[why] ?? 0) + 1);
    const mismatches: string[] = [];
    const record: SpectrumRecord = { tp: spec, file: list.name, peaks: [] };
    for (const p of list.peaks) {
      const { H, N, C } = p.atoms;
      const amide = N ?? H;
      if (!amide) {
        skip(SKIP_REASONS.amide);
        continue;
      }
      if (H && N && H.resi !== N.resi) {
        skip(SKIP_REASONS.split);
        continue;
      }
      const resi = amide.resi;
      if (resnAt(resi) === undefined) {
        skip(SKIP_REASONS.outside);
        continue;
      }
      const named = [H, N, C].filter((a) => a?.resn && resnAt(a.resi) !== undefined && a.resn !== resnAt(a.resi));
      if (named.length) {
        skip(SKIP_REASONS.name);
        if (mismatches.length < 3) mismatches.push(`${named[0]!.resn}${named[0]!.resi} (sequence: ${resnAt(named[0]!.resi)})`);
        continue;
      }
      let atom = "";
      let tag = "";
      let carbonResi: number | undefined;
      const kind = C?.atom ? CARBON[C.atom.toUpperCase()] : undefined;
      if (C && kind && (C.resi === resi || C.resi === resi - 1) && resnAt(C.resi) !== undefined) {
        atom = PEAK_ATOM[kind];
        tag = `${kind}(${C.resi === resi ? "i" : "i-1"})`;
        carbonResi = C.resi;
      }
      const inty = p.height ?? list.heightAt?.(p.h, p.n, p.c) ?? 0;
      const peak: AssignedPeak = { name: `${list.name}:${p.id}`, spec, h: p.h, n: p.n, c: p.c, cp: p.c, inty, atom, label: tag };
      (strips.get(resi) ?? strips.set(resi, []).get(resi)!).push(peak);
      record.peaks.push({ name: `${resi}_${list.name}_${p.id}`, f1: p.h, f2: p.n, f3: p.c, inty });
      observe(resi, "HN", { value: p.h, spectrum: label, strip: resi });
      observe(resi, "N", { value: p.n, spectrum: label, strip: resi });
      if (carbonResi !== undefined && kind) observe(carbonResi, kind, { value: p.c, spectrum: label, strip: resi });
    }
    spectra.push(record);
    const used = record.peaks.length;
    inputs.push({ spectrum: list.name, experiment: list.experiment, label, format: list.format, file: list.file, peaks: list.peaks.length, used, skipped });
    const left = Object.entries(skipped);
    if (left.length) notes.push(`${label}: ${left.map(([why, k]) => `${k} peak${k > 1 ? "s" : ""} left out (${why})`).join(", ")}${mismatches.length ? `, e.g. ${mismatches.join(", ")}` : ""}`);
  }

  // ------------------------------------------------------------------ shifts per residue
  const shiftsOf = new Map<number, Record<string, number>>();
  for (const [key, list] of obs) {
    const [resi, atom] = key.split(":");
    const row = shiftsOf.get(+resi) ?? shiftsOf.set(+resi, {}).get(+resi)!;
    row[atom] = mean(list.map((o) => o.value));
  }

  // ------------------------------------------------------------------ the consistency check
  const issuesOf = new Map<number, SpinSystemIssue[]>();
  const flag = (strip: number, issue: SpinSystemIssue) => {
    const list = issuesOf.get(strip) ?? issuesOf.set(strip, []).get(strip)!;
    if (!list.some((i) => i.text === issue.text)) list.push(issue);
  };
  for (const [key, list] of obs) {
    const [r, a] = key.split(":");
    const resi = +r;
    const atom = a as ShiftAtom;
    const where = [...new Set(list.map((o) => o.strip))];
    // peaks of one atom that disagree
    if (list.length > 1) {
      const lo = list.reduce((x, y) => (y.value < x.value ? y : x));
      const hi = list.reduce((x, y) => (y.value > x.value ? y : x));
      if (hi.value - lo.value > TOLERANCE.conflict[NUCLEUS_OF[atom]]) {
        const at = (o: Observation) => `${o.value.toFixed(atom === "HN" ? 3 : 2)} in the ${o.spectrum}${o.strip !== resi ? ` strip of ${resLabel(o.strip)}` : ""}`;
        const text = `${ATOM_TEXT[atom]} of ${resLabel(resi)}: peaks ${(hi.value - lo.value).toFixed(atom === "HN" ? 3 : 2)} ppm apart (${at(lo)}, ${at(hi)})`;
        for (const s of where) flag(s, { kind: "conflict", text });
      }
    }
    // plausibility for the residue type
    const aa = resnAt(resi);
    const value = shiftsOf.get(resi)![atom];
    if (!hasAtom(aa, TYPING_ATOM[atom])) {
      if (atom === "CB" && aa === "G") for (const s of where) flag(s, { kind: "conflict", text: `${resLabel(resi)} has no Cβ, but a peak is assigned to one` });
      continue;
    }
    const z = shiftZ(aa, TYPING_ATOM[atom], value);
    if (z === undefined) continue;
    const carbon = NUCLEUS_OF[atom] === "C";
    if (carbon && Math.abs(z) > TOLERANCE.implausibleSd) {
      for (const s of where) flag(s, { kind: "conflict", text: `${ATOM_TEXT[atom]} of ${resLabel(resi)} at ${value.toFixed(2)} ppm is implausible for ${AA3(aa)} (${Math.abs(z).toFixed(1)} SD from its average)` });
    } else if (Math.abs(z) > TOLERANCE.unusualSd) {
      for (const s of where) flag(s, { kind: "unusual", text: `${ATOM_TEXT[atom]} of ${resLabel(resi)} at ${value.toFixed(atom === "HN" ? 2 : 1)} ppm is unusual for ${AA3(aa)} (${Math.abs(z).toFixed(1)} SD from its average)` });
    }
  }
  for (const resi of strips.keys()) {
    if (resnAt(resi) === "P") flag(resi, { kind: "conflict", text: `${resLabel(resi)} is a proline, which has no amide proton, but peaks are assigned to its amide` });
  }

  // ------------------------------------------------------------------ sequential links
  const labelValues = (resi: number, tag: string) => (strips.get(resi) ?? []).filter((p) => p.label === tag).map((p) => p.c);
  const links: Record<string, Link[]> = {};
  let edges = 0;
  for (const resi of strips.keys()) {
    if (!strips.has(resi + 1)) continue;
    let matched = 0;
    for (const kind of ["CA", "CB", "CO"]) {
      const mine = labelValues(resi, `${kind}(i)`);
      const theirs = labelValues(resi + 1, `${kind}(i-1)`);
      if (mine.some((x) => theirs.some((y) => Math.abs(x - y) <= TOLERANCE.link))) matched++;
    }
    if (!matched) continue;
    (links[String(resi)] ??= []).push([String(resi + 1), matched, "f"]);
    (links[String(resi + 1)] ??= []).push([String(resi), matched, "b"]);
    edges++;
  }

  // ------------------------------------------------------------------ spin systems
  const experiments = ctx.lists.map((l) => l.experiment);
  const cbI = experiments.some((e) => CB_I.has(e));
  const cbIm1 = experiments.some((e) => CB_IM1.has(e));
  const spinSystems: SpinSystem[] = [...strips.keys()]
    .sort((a, b) => a - b)
    .map((resi) => {
      const peaks = strips.get(resi)!;
      const issues = issuesOf.get(resi) ?? [];
      const resn = resnAt(resi);
      // expected peaks a spectrum lacks
      for (const list of ctx.lists) {
        const have = new Set(peaks.filter((p) => p.name.startsWith(`${list.name}:`)).map((p) => p.label));
        const prev = resnAt(resi - 1);
        const missing = EXPECTED[list.experiment].filter((l) => {
          if (have.has(l)) return false;
          if (l.endsWith("(i-1)") && prev === undefined) return false;
          if (l === "CB(i)" && resn === "G") return false;
          if (l === "CB(i-1)" && prev === "G") return false;
          return true;
        });
        if (missing.length) issues.push({ kind: "missing", text: `No ${missing.join(", ")} peak${missing.length > 1 ? "s" : ""} in the ${EXPERIMENT_TYPES[list.experiment].label}` });
      }
      const unexplained = peaks.filter((p) => !p.label);
      if (unexplained.length) {
        const by = [...new Set(unexplained.map((p) => EXPERIMENT_TYPES[ctx.lists.find((l) => p.name.startsWith(`${l.name}:`))!.experiment].label))].join(", ");
        issues.push({ kind: "unexplained", text: `${unexplained.length} peak${unexplained.length > 1 ? "s" : ""} with no CA, CB or C′ of this residue or the one before (${by})` });
      }
      const own = (tag: string) => {
        const v = labelValues(resi, tag);
        return v.length ? mean(v) : undefined;
      };
      const h = mean(peaks.map((p) => p.h));
      const n = mean(peaks.map((p) => p.n));
      const typesI = typeProbabilities({ CA: own("CA(i)"), CB: own("CB(i)"), C: own("CO(i)"), N: n, H: h }, { cbExpected: cbI }).slice(0, 6);
      const typesIm1 = typeProbabilities({ CA: own("CA(i-1)"), CB: own("CB(i-1)"), C: own("CO(i-1)") }, { cbExpected: cbIm1, withProline: true }).slice(0, 6);
      const linked = links[String(resi)] ?? [];
      const consistency: Consistency = issues.some((i) => i.kind === "conflict") ? "low" : linked.length && !issues.some((i) => i.kind === "unusual") ? "veryHigh" : "high";
      return { root: String(resi), h, n, peaks, residue: `${resi}${resn}`, consistency, links: linked, typesI, typesIm1, issues };
    });

  // ------------------------------------------------------------------ residues, roots, summary
  const byResi = new Map(spinSystems.map((s) => [parseInt(s.root, 10), s]));
  const residues: ResidueAssignment[] = [...sequence].map((resn, k) => {
    const resi = firstResidue + k;
    const s = byResi.get(resi);
    const shifts = shiftsOf.get(resi) ?? {};
    return s ? { resi, resn, root: s.root, consistency: s.consistency, shifts } : { resi, resn, shifts };
  });
  const hsqc: RawPeak2D[] = spinSystems.map((s) => ({ name: s.root, x: s.h, y: s.n, inty: Math.max(0, ...s.peaks.map((p) => Math.abs(p.inty))) }));
  const assignment: AssignmentResult = {
    source: "peaklists",
    version: RESULT_VERSION,
    spinSystems,
    residues,
    links,
    stats: {
      roots: spinSystems.length,
      residues: sequence.length,
      assignable: [...sequence].filter((c, k) => c !== "P" && k > 0).length,
      assigned: spinSystems.length,
      veryHigh: spinSystems.filter((s) => s.consistency === "veryHigh").length,
      high: spinSystems.filter((s) => s.consistency === "high").length,
      low: spinSystems.filter((s) => s.consistency === "low").length,
      edges,
    },
    inputs,
    notes,
  };
  return { assignment, spectra, hsqc };
}
