// Raw 1D NMR processing of Bruker FIDs and lineshape deconvolution.
// Isomorphic: no node APIs, so it runs in the browser (interactive phasing) and on the server
// (agent tools). Conventions verified against TopSpin 3.7 output: test/processing.test.ts.
import { groupDelay, readFid } from "./bruker";
import { nextPow2 } from "./fft";
import { num, parseBrukerParams as parseParams, str } from "./jcamp";
import {
  autophase,
  componentFrom,
  estimateNoise,
  fitPseudoVoigts,
  pickPeaks,
  polyBaseline,
} from "./analysis";
import { phaseReal, TOPSPIN, transformFid, type WindowFn } from "./transform";
import type { BrukerRaw, DeconResult, Peak1D, Processed1D, ProcessOptions } from "./types";

export type * from "./types";
export { autophase, estimateNoise } from "./analysis";

/** Parse a Bruker JCAMP-style parameter file (acqus/procs) into ##$KEY -> value(s). */
export function parseBrukerParams(text: string): Record<string, string | number | number[]> {
  return parseParams(text);
}

/** TopSpin titles often carry operator/automation lines; keep the descriptive one. */
export function brukerTitle(t: string): string {
  return pickTitle(t);
}

function pickTitle(t: string): string {
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.find((l) => !/^person\b/i.test(l) && !l.startsWith("@")) ?? lines[0] ?? "";
}

const WDW: Record<number, WindowFn> = { 0: "none", 1: "em", 2: "gm", 3: "sine", 4: "sine" };

/** Fourier-transformed but not yet phased data, cached by interactive views. */
export interface PreparedSpectrum {
  title: string;
  nucleus: string;
  solvent: string;
  pulseProgram: string;
  re: Float64Array;
  im: Float64Array;
  sf: number;
  swHz: number;
  offsetPpm: number;
  si: number;
  lb: number;
  window: WindowFn;
  procsPhase?: { ph0: number; ph1: number };
  baselineOrder: number;
  grpdly: number;
  ns: number;
}

/** Steps up to (and including) the Fourier transform. */
export function prepareBruker(raw: BrukerRaw, opts: ProcessOptions = {}): PreparedSpectrum {
  const acq = parseParams(raw.acqus);
  const proc = raw.procs ? parseParams(raw.procs) : {};
  const fid = readFid(raw.fid, acq);
  const g = groupDelay(acq);
  const window = opts.window ?? WDW[num(proc, "WDW", 1)] ?? "em";
  const lb = opts.lb ?? num(proc, "LB", 0.3);
  const si = nextPow2(opts.si ?? num(proc, "SI", nextPow2(2 * fid.re.length)));
  const swHz = num(proc, "SW_p", num(acq, "SW_h", 1));
  const bf1 = num(acq, "BF1", 400);
  const sf = num(proc, "SF", bf1);
  const sfo1 = num(acq, "SFO1", bf1 + num(acq, "O1", 0) * 1e-6);
  const offsetPpm = num(proc, "OFFSET", ((sfo1 - sf) * 1e6 + swHz / 2) / sf);
  const spec = transformFid(fid.re, fid.im, {
    swHz: num(acq, "SW_h", swHz),
    si,
    lb,
    gb: num(proc, "GB", 0.1),
    window,
    grpdly: g,
    fcor: proc.FCOR !== undefined ? num(proc, "FCOR", 1) : undefined,
  });
  const hasPhase = typeof proc.PHC0 === "number";
  return {
    title: pickTitle(raw.title ?? str(acq, "TITLE", "")),
    nucleus: str(acq, "NUC1", "1H"),
    solvent: str(acq, "SOLVENT", ""),
    pulseProgram: str(acq, "PULPROG", ""),
    re: spec.re,
    im: spec.im,
    sf,
    swHz,
    offsetPpm,
    si,
    lb,
    window,
    procsPhase: hasPhase ? { ph0: num(proc, "PHC0", 0), ph1: num(proc, "PHC1", 0) } : undefined,
    baselineOrder: num(proc, "ABSG", 5),
    grpdly: g,
    ns: num(acq, "NS", 1),
  };
}

export function ppmAxis(p: Pick<PreparedSpectrum, "offsetPpm" | "swHz" | "sf" | "si">): number[] {
  const step = p.swHz / p.sf / p.si;
  return Array.from({ length: p.si }, (_, j) => p.offsetPpm - j * step);
}

/** Phase + baseline + noise + peaks on a prepared spectrum. */
export function finishSpectrum(
  p: PreparedSpectrum,
  opts: { phase?: ProcessOptions["phase"]; baseline?: "none" | "poly"; baselineOrder?: number; threshold?: number; skipPeaks?: boolean } = {},
): Processed1D {
  const mode = opts.phase ?? (p.procsPhase ? "procs" : "auto");
  let ph0 = 0;
  let ph1 = 0;
  let phaseLabel = "manual";
  if (mode === "procs" && p.procsPhase) {
    ({ ph0, ph1 } = p.procsPhase);
    phaseLabel = "procs";
  } else if (mode === "auto" || (mode === "procs" && !p.procsPhase)) {
    ({ ph0, ph1 } = autophase(p.re, p.im));
    phaseLabel = "auto";
  } else if (typeof mode === "object") {
    ({ ph0, ph1 } = mode);
  }
  let re = phaseReal(p.re, p.im, ph0, ph1, TOPSPIN);
  const hzPerPoint = p.swHz / p.si;
  const baseline = opts.baseline ?? "poly";
  if (baseline === "poly") {
    const base = polyBaseline(re, opts.baselineOrder ?? p.baselineOrder, hzPerPoint);
    re = re.map((v, i) => v - base[i]);
  }
  const noise = estimateNoise(re);
  const ppm = ppmAxis(p);
  const out: Processed1D = {
    title: p.title,
    nucleus: p.nucleus,
    solvent: p.solvent,
    pulseProgram: p.pulseProgram,
    sf: p.sf,
    swHz: p.swHz,
    si: p.si,
    ph0,
    ph1,
    noise,
    ppm,
    re: Array.from(re),
    peaks: [],
    options: { lb: p.lb, window: p.window, si: p.si, baseline, phase: phaseLabel },
  };
  if (!opts.skipPeaks) out.peaks = pickPeaks1D(out, { threshold: opts.threshold });
  return out;
}

export function processBruker1D(raw: BrukerRaw, opts?: ProcessOptions): Processed1D {
  const prepared = prepareBruker(raw, opts);
  return finishSpectrum(prepared, { phase: opts?.phase, baseline: opts?.baseline, baselineOrder: opts?.baselineOrder });
}

/** threshold: minimum peak height in multiples of the noise (S/N), default 10. */
export function pickPeaks1D(spec: Processed1D, opts?: { threshold?: number; minSeparationHz?: number }): Peak1D[] {
  const hzPerPoint = spec.swHz / spec.si;
  const step = spec.ppm.length > 1 ? spec.ppm[1] - spec.ppm[0] : -hzPerPoint / spec.sf;
  const ppm0 = spec.ppm[0];
  return pickPeaks(spec.re, (i) => ppm0 + i * step, hzPerPoint, spec.noise, { threshold: opts?.threshold ?? 10, minSeparationHz: opts?.minSeparationHz ?? 0.8 });
}

/** Fit the region [ppmA, ppmB] with pseudo-Voigt components. */
export function deconvolve1D(spec: Processed1D, region: [number, number], opts?: { maxComponents?: number; threshold?: number }): DeconResult {
  const hi = Math.max(region[0], region[1]);
  const lo = Math.min(region[0], region[1]);
  const step = spec.ppm[1] - spec.ppm[0]; // negative
  const ppm0 = spec.ppm[0];
  const idxOf = (ppm: number) => Math.round((ppm - ppm0) / step);
  const i0 = Math.max(0, Math.min(spec.ppm.length - 1, idxOf(hi)));
  const i1 = Math.max(0, Math.min(spec.ppm.length - 1, idxOf(lo)));
  const n = i1 - i0 + 1;
  if (n < 5) throw new Error("deconvolution region too small");
  const hzPerPoint = spec.swHz / spec.si;
  // x in Hz relative to region start, increasing with index (i.e. decreasing ppm)
  const x = Float64Array.from({ length: n }, (_, k) => k * hzPerPoint);
  const y = Float64Array.from({ length: n }, (_, k) => spec.re[i0 + k]);
  const ppmAxisRegion = Array.from({ length: n }, (_, k) => spec.ppm[i0 + k]);
  // initial guesses from local maxima
  const maxK = opts?.maxComponents ?? 12;
  let regionMax = 0;
  for (let k = 0; k < n; k++) regionMax = Math.max(regionMax, y[k]);
  const thr = Math.max((opts?.threshold ?? 5) * spec.noise, 0.01 * regionMax);
  const cand: number[] = [];
  for (let k = 1; k < n - 1; k++) if (y[k] > thr && y[k] >= y[k - 1] && y[k] > y[k + 1]) cand.push(k);
  cand.sort((a, b) => y[b] - y[a]);
  const picks = cand.slice(0, maxK);
  if (!picks.length) {
    let best = 0;
    for (let k = 1; k < n; k++) if (y[k] > y[best]) best = k;
    picks.push(best);
  }
  const init = picks.map((k) => {
    const half = y[k] / 2;
    let l = k;
    while (l > 0 && y[l] > half) l--;
    let r = k;
    while (r < n - 1 && y[r] > half) r++;
    const w = Math.min(4, Math.max(0.3, (r - l) * hzPerPoint * 0.8));
    return [x[k], y[k], w, 0.7];
  });
  const res = fitPseudoVoigts(x, y, init, [x[0], x[n - 1]]);
  const ppmOfHz = (hz: number) => spec.ppm[i0] + (hz / hzPerPoint) * step;
  const maxAmp = Math.max(1e-300, ...res.comps.map((c) => Math.abs(c[1])));
  // lines that collapsed to (near) zero contribute nothing: report only the real ones
  const kept = res.comps.filter((c) => Math.abs(c[1]) > Math.max(1e-3 * maxAmp, 0.5 * spec.noise));
  const components = kept.map((c) => componentFrom(c, ppmOfHz)).sort((a, b) => b.ppm - a.ppm);
  // model over the region (components + linear baseline)
  const x0 = (x[0] + x[n - 1]) / 2;
  const xs = Math.max(1e-9, Math.abs(x[n - 1] - x[0]) / 2);
  const fit: number[] = [];
  const residual: number[] = [];
  let ss = 0;
  for (let k = 0; k < n; k++) {
    let v = res.base[0] + res.base[1] * ((x[k] - x0) / xs);
    for (const c of res.comps) {
      const u = (x[k] - c[0]) / (c[2] / 2);
      v += c[1] * (c[3] / (1 + u * u) + (1 - c[3]) * Math.exp(-Math.LN2 * u * u));
    }
    fit.push(v);
    residual.push(y[k] - v);
    ss += (y[k] - v) ** 2;
  }
  return { region: [hi, lo], components, fit, residual, ppm: ppmAxisRegion, rms: Math.sqrt(ss / n), iterations: res.iterations };
}
