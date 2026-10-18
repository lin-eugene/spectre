// Spectrum-level analysis: automatic phasing (ACME), polynomial baseline, noise, peak picking,
// pseudo-Voigt deconvolution (Levenberg–Marquardt). All functions work on plain typed arrays.
import { phaseReal, TOPSPIN, type Conventions } from "./transform";
import type { DeconComponent, Peak1D } from "./types";

// ---------------------------------------------------------------- statistics
function medianOf(a: Float64Array | number[]): number {
  const s = Float64Array.from(a).sort();
  const n = s.length;
  if (!n) return 0;
  return n % 2 ? s[(n - 1) / 2] : 0.5 * (s[n / 2 - 1] + s[n / 2]);
}

/** Robust noise sigma from the median absolute first difference (insensitive to peaks). */
export function diffSigma(y: ArrayLike<number>): number {
  const n = y.length;
  if (n < 3) return 0;
  const step = Math.max(1, Math.floor(n / 65536));
  const d: number[] = [];
  for (let i = step; i < n; i += step) d.push(Math.abs(y[i] - y[i - step]));
  return (1.4826 * medianOf(d)) / Math.SQRT2;
}

/**
 * Noise estimate: standard deviation of the points that sit
 * within +/-2 sigma of zero, iterated until stable (peaks drop out of the window).
 */
export function estimateNoise(y: ArrayLike<number>): number {
  let s = diffSigma(y) || 1e-12;
  for (let it = 0; it < 8; it++) {
    let sum = 0;
    let sum2 = 0;
    let m = 0;
    for (let i = 0; i < y.length; i++) {
      const v = y[i];
      if (Math.abs(v) < 2 * s) {
        sum += v;
        sum2 += v * v;
        m++;
      }
    }
    if (m < 16) break;
    const mean = sum / m;
    const next = Math.sqrt(Math.max(0, sum2 / m - mean * mean)) / 0.8796; // correct for +/-2 sigma truncation
    if (Math.abs(next - s) < 1e-3 * s) {
      s = next;
      break;
    }
    s = next;
  }
  return s;
}

// ---------------------------------------------------------------- baseline
/** Chebyshev-basis least-squares polynomial fit of y over x in [-1, 1]. */
function polyFit(xs: number[], ys: number[], order: number): number[] {
  const m = order + 1;
  const A = Array.from({ length: m }, () => new Float64Array(m));
  const b = new Float64Array(m);
  const T = new Float64Array(m);
  for (let k = 0; k < xs.length; k++) {
    const x = xs[k];
    T[0] = 1;
    if (m > 1) T[1] = x;
    for (let p = 2; p < m; p++) T[p] = 2 * x * T[p - 1] - T[p - 2];
    for (let i = 0; i < m; i++) {
      b[i] += T[i] * ys[k];
      for (let j = 0; j < m; j++) A[i][j] += T[i] * T[j];
    }
  }
  return solve(A.map((r) => Array.from(r)), Array.from(b));
}

function polyEval(c: number[], x: number): number {
  let t0 = 1;
  let t1 = x;
  let s = c[0] ?? 0;
  if (c.length > 1) s += c[1] * t1;
  for (let p = 2; p < c.length; p++) {
    const t2 = 2 * x * t1 - t0;
    s += c[p] * t2;
    t0 = t1;
    t1 = t2;
  }
  return s;
}

/** Gaussian elimination with partial pivoting (small dense systems). */
export function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-300) continue;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = Math.abs(M[r][r]) < 1e-300 ? 0 : s / M[r][r];
  }
  return x;
}

/**
 * Polynomial baseline over signal-free points (TopSpin `abs` analogue). Signal is detected
 * from steep first differences, dilated, and refined with residual thresholds.
 */
export function polyBaseline(y: Float64Array, order = 5, hzPerPoint = 0.1): Float64Array {
  const n = y.length;
  const sigD = diffSigma(y) * Math.SQRT2 || 1e-12;
  const dil = Math.max(4, Math.round(6 / Math.max(hzPerPoint, 1e-6)));
  const mask = new Uint8Array(n); // 1 = signal
  const markSignal = (i: number) => {
    const a = Math.max(0, i - dil);
    const b = Math.min(n - 1, i + dil);
    for (let k = a; k <= b; k++) mask[k] = 1;
  };
  for (let i = 1; i < n; i++) if (Math.abs(y[i] - y[i - 1]) > 5 * sigD) markSignal(i);
  let coef: number[] = [0];
  const stride = Math.max(1, Math.floor(n / 8192));
  for (let it = 0; it < 4; it++) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < n; i += stride) {
      if (mask[i]) continue;
      xs.push((2 * i) / (n - 1) - 1);
      ys.push(y[i]);
    }
    if (xs.length < order + 2) break;
    coef = polyFit(xs, ys, order);
    // residual-based refinement: anything far above the fitted baseline is signal
    const resid: number[] = [];
    for (let i = 0; i < n; i += stride) if (!mask[i]) resid.push(y[i] - polyEval(coef, (2 * i) / (n - 1) - 1));
    const s = (1.4826 * medianOf(resid.map(Math.abs))) || sigD;
    let changed = 0;
    for (let i = 0; i < n; i += stride) {
      if (mask[i]) continue;
      if (Math.abs(y[i] - polyEval(coef, (2 * i) / (n - 1) - 1)) > 4 * s) {
        markSignal(i);
        changed++;
      }
    }
    if (!changed) break;
  }
  const base = new Float64Array(n);
  for (let i = 0; i < n; i++) base[i] = polyEval(coef, (2 * i) / (n - 1) - 1);
  return base;
}

// ---------------------------------------------------------------- automatic phasing (ACME)
function acmeScore(re: Float64Array, im: Float64Array, ph0: number, ph1: number, conv: Conventions, norm: number): number {
  const r = phaseReal(re, im, ph0, ph1, conv);
  const n = r.length;
  let sumD = 0;
  for (let i = 1; i < n; i++) sumD += Math.abs(r[i] - r[i - 1]);
  if (sumD === 0) return Infinity;
  let h = 0;
  for (let i = 1; i < n; i++) {
    const p = Math.abs(r[i] - r[i - 1]) / sumD;
    if (p > 0) h -= p * Math.log(p);
  }
  let pen = 0;
  for (let i = 0; i < n; i++) if (r[i] < 0) pen += (r[i] / norm) ** 2;
  return h + 1000 * pen;
}

function nelderMead(f: (x: number[]) => number, x0: number[], step: number[], iters = 200): number[] {
  const n = x0.length;
  let simplex = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step[j] : v)))];
  let vals = simplex.map(f);
  for (let it = 0; it < iters; it++) {
    const order = vals.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
    simplex = order.map((i) => simplex[i]);
    vals = order.map((i) => vals[i]);
    const centroid = x0.map((_, j) => simplex.slice(0, n).reduce((s, p) => s + p[j], 0) / n);
    const worst = simplex[n];
    const refl = centroid.map((c, j) => c + (c - worst[j]));
    const fr = f(refl);
    if (fr < vals[0]) {
      const exp = centroid.map((c, j) => c + 2 * (c - worst[j]));
      const fe = f(exp);
      if (fe < fr) {
        simplex[n] = exp;
        vals[n] = fe;
      } else {
        simplex[n] = refl;
        vals[n] = fr;
      }
    } else if (fr < vals[n - 1]) {
      simplex[n] = refl;
      vals[n] = fr;
    } else {
      const con = centroid.map((c, j) => c + 0.5 * (worst[j] - c));
      const fc = f(con);
      if (fc < vals[n]) {
        simplex[n] = con;
        vals[n] = fc;
      } else {
        for (let i = 1; i <= n; i++) {
          simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]));
          vals[i] = f(simplex[i]);
        }
      }
    }
    const spread = Math.max(...vals) - Math.min(...vals);
    if (spread < 1e-10) break;
  }
  return simplex[vals.indexOf(Math.min(...vals))];
}

/** ACME (Chen et al. 2002) entropy-minimisation phasing. Returns TopSpin-convention degrees. */
export function autophase(re: Float64Array, im: Float64Array, conv: Conventions = TOPSPIN): { ph0: number; ph1: number } {
  // decimate by peak-preserving max-|z| binning so the search is fast on large spectra
  const n = re.length;
  const target = 8192;
  const bin = Math.max(1, Math.floor(n / target));
  let dr = re;
  let di = im;
  if (bin > 1) {
    const m = Math.floor(n / bin);
    dr = new Float64Array(m);
    di = new Float64Array(m);
    for (let b = 0; b < m; b++) {
      let best = b * bin;
      let bm = -1;
      for (let k = b * bin; k < (b + 1) * bin; k++) {
        const mag = re[k] * re[k] + im[k] * im[k];
        if (mag > bm) {
          bm = mag;
          best = k;
        }
      }
      dr[b] = re[best];
      di[b] = im[best];
    }
  }
  let norm = 0;
  for (let i = 0; i < dr.length; i++) norm = Math.max(norm, Math.hypot(dr[i], di[i]));
  norm = norm || 1;
  const f = (x: number[]) => acmeScore(dr, di, x[0], x[1], conv, norm);
  const starts: { x: number[]; v: number }[] = [];
  for (let p0 = -180; p0 < 180; p0 += 15) {
    for (let p1 = -90; p1 <= 90; p1 += 30) {
      const x = [p0, p1];
      starts.push({ x, v: f(x) });
    }
  }
  starts.sort((a, b) => a.v - b.v);
  let best = { x: starts[0].x, v: starts[0].v };
  for (const s of starts.slice(0, 4)) {
    const x = nelderMead(f, s.x, [8, 15], 150);
    const v = f(x);
    if (v < best.v) best = { x, v };
  }
  // final polish on the full-resolution data
  let fullNorm = 0;
  for (let i = 0; i < n; i++) fullNorm = Math.max(fullNorm, Math.hypot(re[i], im[i]));
  const ff = (x: number[]) => acmeScore(re, im, x[0], x[1], conv, fullNorm || 1);
  const x = nelderMead(ff, best.x, [2, 4], 60);
  const ph0 = ((x[0] % 360) + 540) % 360 - 180;
  return { ph0, ph1: x[1] };
}

// ---------------------------------------------------------------- peak picking
export function pickPeaks(
  y: ArrayLike<number>,
  ppmAt: (i: number) => number,
  hzPerPoint: number,
  noise: number,
  opts: { threshold?: number; minSeparationHz?: number; maxPeaks?: number } = {},
): Peak1D[] {
  const thr = (opts.threshold ?? 10) * (noise || 1e-12);
  const minSep = Math.max(1, Math.round((opts.minSeparationHz ?? 0.8) / Math.max(hzPerPoint, 1e-9)));
  const n = y.length;
  const cand: number[] = [];
  for (let i = 1; i < n - 1; i++) if (y[i] > thr && y[i] >= y[i - 1] && y[i] > y[i + 1]) cand.push(i);
  cand.sort((a, b) => y[b] - y[a]);
  const taken: number[] = [];
  for (const i of cand) {
    if (taken.some((j) => Math.abs(j - i) < minSep)) continue;
    taken.push(i);
    if (taken.length >= (opts.maxPeaks ?? 400)) break;
  }
  const peaks: Peak1D[] = taken.map((i) => {
    // parabolic interpolation of the apex
    const a = y[i - 1];
    const b = y[i];
    const c = y[i + 1];
    const den = a - 2 * b + c;
    const d = den !== 0 ? (0.5 * (a - c)) / den : 0;
    const pos = i + Math.max(-0.5, Math.min(0.5, d));
    const height = b - 0.25 * (a - c) * d;
    // FWHM by linear interpolation of half-height crossings
    const half = height / 2;
    let l = i;
    while (l > 0 && y[l] > half) l--;
    let r = i;
    while (r < n - 1 && y[r] > half) r++;
    const lx = l + (y[l] === y[l + 1] ? 0 : (half - y[l]) / (y[l + 1] - y[l]));
    const rx = r - 1 + (y[r - 1] === y[r] ? 0 : (y[r - 1] - half) / (y[r - 1] - y[r]));
    const widthPts = Math.max(0, rx - lx);
    const w = Math.max(2, Math.round(widthPts * 2));
    let integral = 0;
    for (let k = Math.max(0, i - w); k <= Math.min(n - 1, i + w); k++) integral += y[k];
    // ppm of fractional index (linear axis)
    const p0 = ppmAt(Math.floor(pos));
    const p1 = ppmAt(Math.floor(pos) + 1);
    const ppm = p0 + (p1 - p0) * (pos - Math.floor(pos));
    return { ppm, height, index: i, widthHz: widthPts * hzPerPoint, integral: integral * hzPerPoint };
  });
  return peaks.sort((p, q) => q.ppm - p.ppm);
}

// ---------------------------------------------------------------- deconvolution
const LN2 = Math.LN2;

export function pseudoVoigt(x: number, c: number, amp: number, w: number, eta: number): number {
  const u = (x - c) / (w / 2);
  return amp * (eta / (1 + u * u) + (1 - eta) * Math.exp(-LN2 * u * u));
}

export function pvArea(amp: number, wHz: number, eta: number): number {
  return amp * wHz * (eta * (Math.PI / 2) + (1 - eta) * Math.sqrt(Math.PI / (4 * LN2)));
}

export interface LMResult {
  params: number[];
  iterations: number;
  chi2: number;
}

/**
 * Levenberg–Marquardt fit of a sum of pseudo-Voigt lines plus a linear baseline.
 * x in Hz, parameters per component: [centreHz, amplitude, fwhmHz, eta].
 */
export function fitPseudoVoigts(x: Float64Array, y: Float64Array, init: number[][], bounds: [number, number]): LMResult & { comps: number[][]; base: [number, number] } {
  const K = init.length;
  const P = 4 * K + 2;
  const n = x.length;
  const x0 = (x[0] + x[n - 1]) / 2;
  const xs = Math.max(1e-9, Math.abs(x[n - 1] - x[0]) / 2);
  let p = new Float64Array(P);
  init.forEach((c, k) => p.set(c, 4 * k));
  // baseline from the region edges
  p[4 * K] = 0.5 * (y[0] + y[n - 1]);
  p[4 * K + 1] = 0;
  const lo = Math.min(...bounds);
  const hi = Math.max(...bounds);
  const maxW = Math.max(0.5, (hi - lo) * 0.5);
  const sign = init.map((c) => (c[1] < 0 ? -1 : 1));
  const clamp = (q: Float64Array) => {
    for (let k = 0; k < K; k++) {
      q[4 * k] = Math.min(hi, Math.max(lo, q[4 * k]));
      // keep each line's sign (no cancelling positive/negative pairs)
      q[4 * k + 1] = sign[k] > 0 ? Math.max(0, q[4 * k + 1]) : Math.min(0, q[4 * k + 1]);
      q[4 * k + 2] = Math.min(maxW, Math.max(0.05, Math.abs(q[4 * k + 2])));
      q[4 * k + 3] = Math.min(1, Math.max(0, q[4 * k + 3]));
    }
  };
  clamp(p);
  const model = (q: Float64Array, out: Float64Array) => {
    for (let i = 0; i < n; i++) {
      let v = q[4 * K] + q[4 * K + 1] * ((x[i] - x0) / xs);
      for (let k = 0; k < K; k++) v += pseudoVoigt(x[i], q[4 * k], q[4 * k + 1], q[4 * k + 2], q[4 * k + 3]);
      out[i] = v;
    }
  };
  const fit = new Float64Array(n);
  const chi2Of = (q: Float64Array) => {
    model(q, fit);
    let s = 0;
    for (let i = 0; i < n; i++) s += (y[i] - fit[i]) ** 2;
    return s;
  };
  let chi2 = chi2Of(p);
  let lambda = 1e-3;
  let iterations = 0;
  const J = Array.from({ length: P }, () => new Float64Array(n));
  let rel = 1;
  let stall = 0;
  for (; iterations < 200; iterations++) {
    model(p, fit);
    // analytic Jacobian
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < K; k++) {
        const c = p[4 * k];
        const a = p[4 * k + 1];
        const w = p[4 * k + 2];
        const eta = p[4 * k + 3];
        const h = w / 2;
        const u = (x[i] - c) / h;
        const L = 1 / (1 + u * u);
        const G = Math.exp(-LN2 * u * u);
        const dLdu = -2 * u * L * L;
        const dGdu = -2 * LN2 * u * G;
        const dShape = eta * dLdu + (1 - eta) * dGdu;
        J[4 * k][i] = a * dShape * (-1 / h);
        J[4 * k + 1][i] = eta * L + (1 - eta) * G;
        J[4 * k + 2][i] = a * dShape * (-u / w);
        J[4 * k + 3][i] = a * (L - G);
      }
      J[4 * K][i] = 1;
      J[4 * K + 1][i] = (x[i] - x0) / xs;
    }
    const A = Array.from({ length: P }, () => new Array(P).fill(0));
    const g = new Array(P).fill(0);
    for (let a = 0; a < P; a++) {
      const Ja = J[a];
      let s = 0;
      for (let i = 0; i < n; i++) s += Ja[i] * (y[i] - fit[i]);
      g[a] = s;
      for (let b = a; b < P; b++) {
        const Jb = J[b];
        let t = 0;
        for (let i = 0; i < n; i++) t += Ja[i] * Jb[i];
        A[a][b] = t;
        A[b][a] = t;
      }
    }
    let improved = false;
    for (let tries = 0; tries < 12; tries++) {
      const M = A.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lambda) + 1e-12 : v)));
      const d = solve(M, g);
      const q = Float64Array.from(p, (v, a) => v + d[a]);
      clamp(q);
      const c2 = chi2Of(q);
      if (c2 < chi2) {
        rel = (chi2 - c2) / Math.max(chi2, 1e-300);
        p = q;
        chi2 = c2;
        lambda = Math.max(1e-9, lambda / 5);
        improved = true;
        break;
      }
      lambda *= 8;
    }
    if (!improved) break;
    stall = rel < 1e-7 ? stall + 1 : 0;
    if (stall >= 3) break;
  }
  model(p, fit);
  const comps: number[][] = [];
  for (let k = 0; k < K; k++) comps.push([p[4 * k], p[4 * k + 1], p[4 * k + 2], p[4 * k + 3]]);
  return { params: Array.from(p), iterations, chi2, comps, base: [p[4 * K], p[4 * K + 1]] };
}

export function componentFrom(c: number[], ppmOfHz: (hz: number) => number): DeconComponent {
  const [hz, amp, w, eta] = c;
  return { ppm: ppmOfHz(hz), amplitude: amp, widthHz: w, eta, area: pvArea(amp, w, eta) };
}

export { medianOf };
