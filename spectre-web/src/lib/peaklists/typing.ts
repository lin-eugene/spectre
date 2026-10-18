// Residue types from shifts: BMRB averages with clipped standard deviations, a Student t likelihood
// against a background of all residue types, weighted per atom, and a missing CB as evidence for
// glycine when the spectra would show one. Also how far a shift is from its residue type's average,
// in those standard deviations (the consistency check's plausibility test).
import { BMRB_STATS } from "../structure/bmrb-stats";
import { P1TO3 } from "../residues";

export type TypingAtom = "CA" | "CB" | "N" | "H" | "C";
const ATOMS: TypingAtom[] = ["CA", "CB", "N", "H", "C"];
// clip BMRB standard deviations to these (min, max) ranges, in ppm
const SD_RANGE: Record<TypingAtom, [number, number]> = { CA: [1.0, 2.6], CB: [1.0, 2.6], N: [2.0, 4.5], H: [0.3, 0.7], C: [0.8, 1.8] };
// weight of each atom in residue typing: H and N say little about the type
const WEIGHT: Record<TypingAtom, number> = { CA: 1, CB: 1, N: 0.3, H: 0.1, C: 0.5 };
const T_DOF = 4;
const LOG_MISS_CB = Math.log(0.15);
const LOG_SEE_CB = Math.log(0.85);

function lgamma(x: number): number {
  // Lanczos approximation (enough for the two constants below)
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

const T_NORM = lgamma(0.5 * (T_DOF + 1)) - lgamma(0.5 * T_DOF) - 0.5 * Math.log(T_DOF * Math.PI);
const tLogPdf = (x: number, mean: number, sd: number) => {
  const z = (x - mean) / sd;
  return T_NORM - Math.log(sd) - 0.5 * (T_DOF + 1) * Math.log1p((z * z) / T_DOF);
};

interface Stats {
  mean: Map<string, number>;
  sd: Map<string, number>;
  types: string[];
  grid: Map<TypingAtom, { x0: number; dx: number; logd: Float64Array }>;
}

let cached: Stats | null = null;

function stats(): Stats {
  if (cached) return cached;
  const mean = new Map<string, number>();
  const sd = new Map<string, number>();
  for (const [aa, resn3] of Object.entries(P1TO3)) {
    const row = BMRB_STATS[resn3];
    if (!row) continue;
    for (const atom of ATOMS) {
      const v = row[atom];
      if (!v) continue;
      const [low, high] = SD_RANGE[atom];
      mean.set(`${aa}${atom}`, v[0]);
      sd.set(`${aa}${atom}`, Math.min(Math.max(v[1], low), high));
    }
  }
  const types = [...new Set([...mean.keys()].map((k) => k[0]))].sort();
  // background: equal mixture of the residue types, tabulated on a uniform grid
  const grid = new Map<TypingAtom, { x0: number; dx: number; logd: Float64Array }>();
  for (const atom of ATOMS) {
    const members = types.filter((aa) => mean.has(`${aa}${atom}`));
    const lo = Math.min(...members.map((aa) => mean.get(`${aa}${atom}`)! - 6 * sd.get(`${aa}${atom}`)!));
    const hi = Math.max(...members.map((aa) => mean.get(`${aa}${atom}`)! + 6 * sd.get(`${aa}${atom}`)!));
    const n = 2000;
    const dx = (hi - lo) / (n - 1);
    const logd = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const x = lo + i * dx;
      let dens = 0;
      for (const aa of members) dens += Math.exp(tLogPdf(x, mean.get(`${aa}${atom}`)!, sd.get(`${aa}${atom}`)!));
      logd[i] = Math.log(dens / members.length);
    }
    grid.set(atom, { x0: lo, dx, logd });
  }
  cached = { mean, sd, types, grid };
  return cached;
}

function logBackground(s: Stats, atom: TypingAtom, value: number): number {
  const { x0, dx, logd } = s.grid.get(atom)!;
  const last = logd.length - 1;
  if (value <= x0) return logd[0];
  if (value >= x0 + last * dx) return logd[last];
  const pos = (value - x0) / dx;
  const i = Math.floor(pos);
  const f = pos - i;
  return logd[i] * (1 - f) + logd[i + 1] * f;
}

/** log P(value | aa) - log P(value | background) */
function llr(s: Stats, aa: string, atom: TypingAtom, value: number): number {
  const m = s.mean.get(`${aa}${atom}`);
  if (m === undefined) return -20; // e.g. a CB shift offered to glycine
  return tLogPdf(value, m, s.sd.get(`${aa}${atom}`)!) - logBackground(s, atom, value);
}

function typeScore(s: Stats, aa: string, shifts: Partial<Record<TypingAtom, number>>, cbExpected: boolean): number {
  let score = 0;
  for (const atom of ATOMS) {
    const v = shifts[atom];
    if (v !== undefined) score += WEIGHT[atom] * llr(s, aa, atom, v);
  }
  if (cbExpected && shifts.CA !== undefined) {
    const hasCb = s.mean.has(`${aa}CB`);
    // background chance of a missing CB: one type in twenty lacks one
    if (shifts.CB === undefined) score += (hasCb ? LOG_MISS_CB : 0) - Math.log(1 / 20 + (19 / 20) * 0.15);
    else score += (hasCb ? LOG_SEE_CB : -20) - Math.log((19 / 20) * 0.85);
  }
  return score;
}

/**
 * How many (clipped) standard deviations a shift is from the BMRB average of its residue type
 * (one-letter code); undefined when BMRB has no such atom for the type (e.g. a glycine CB).
 */
export function shiftZ(aa: string, atom: TypingAtom, value: number): number | undefined {
  const s = stats();
  const m = s.mean.get(`${aa}${atom}`);
  return m === undefined ? undefined : (value - m) / s.sd.get(`${aa}${atom}`)!;
}

/** BMRB has this atom for the residue type (one-letter code). */
export function hasAtom(aa: string, atom: TypingAtom): boolean {
  return stats().mean.has(`${aa}${atom}`);
}

/**
 * Posterior over residue types (one-letter codes) given shifts, with a flat prior, most likely
 * first. Proline is left out unless `withProline` (a residue i-1 can be one; a residue with an
 * amide proton cannot).
 */
export function typeProbabilities(shifts: Partial<Record<TypingAtom, number>>, opts: { cbExpected: boolean; withProline?: boolean }): [string, number][] {
  if (!ATOMS.some((a) => shifts[a] !== undefined)) return [];
  const s = stats();
  const types = s.types.filter((aa) => opts.withProline || aa !== "P");
  const scores = types.map((aa) => typeScore(s, aa, shifts, opts.cbExpected));
  const top = Math.max(...scores);
  const p = scores.map((x) => Math.exp(x - top));
  const sum = p.reduce((a, b) => a + b, 0);
  return types.map((aa, i) => [aa, p[i] / sum] as [string, number]).sort((a, b) => b[1] - a[1]);
}
