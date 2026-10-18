// Time-domain conditioning + Fourier transform with Bruker/TopSpin conventions.
import { fft, nextPow2 } from "./fft";

export type WindowFn = "em" | "gm" | "sine" | "none";

export interface Conventions {
  /** sign of the linear phase that removes the digital-filter group delay */
  dspSign: 1 | -1;
  /** how the FFT output is mapped to TopSpin order (point 0 = high ppm) */
  orientation: "reverse" | "conj";
  /** sign applied to PHC0/PHC1 */
  phSign: 1 | -1;
  /** where PHC1 is zero */
  phPivot: "left" | "right";
}

/** Conventions verified against TopSpin 3.7 processed data (see test/processing.test.ts). */
export const TOPSPIN: Conventions = { dspSign: 1, orientation: "reverse", phSign: -1, phPivot: "left" };

export interface TransformOptions {
  swHz: number;
  si: number;
  lb: number;
  gb?: number;
  window: WindowFn;
  grpdly: number;
  fcor?: number;
  conv?: Conventions;
}

/** Apodise, zero-fill, Fourier transform and remove the DSP group delay. Returns complex spectrum in TopSpin order. */
export function transformFid(fidRe: Float64Array, fidIm: Float64Array, o: TransformOptions): { re: Float64Array; im: Float64Array } {
  const conv = o.conv ?? TOPSPIN;
  const n = fidRe.length;
  const N = nextPow2(Math.max(o.si, 2));
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const g = o.grpdly;
  const dt = 1 / o.swHz;
  const m = Math.min(n, N);
  for (let k = 0; k < m; k++) {
    // time measured from the true start of the FID (after the filter delay)
    const t = Math.max(0, k - g) * dt;
    let w = 1;
    if (o.window === "em") w = Math.exp(-Math.PI * o.lb * t);
    else if (o.window === "gm") {
      const lb = o.lb;
      const gb = o.gb ?? 0.1;
      const aq = (n - g) * dt;
      const a = Math.PI * lb;
      const b = lb !== 0 ? -a / (2 * gb * aq) : 0;
      w = Math.exp(a * t - b * t * t);
    } else if (o.window === "sine") {
      // pi/2-shifted sine bell (TopSpin QSINE/SINE with SSB = 2)
      const frac = Math.max(0, k - g) / Math.max(1, n - g);
      w = Math.cos((Math.PI / 2) * frac);
    }
    re[k] = fidRe[k] * w;
    im[k] = fidIm[k] * w;
  }
  if (o.fcor !== undefined && o.fcor !== 1) {
    const k0 = Math.min(N - 1, Math.round(g));
    re[k0] *= o.fcor;
    im[k0] *= o.fcor;
  }
  if (conv.orientation === "conj") for (let k = 0; k < N; k++) im[k] = -im[k];
  fft(re, im);
  // remove the group delay (a time shift) as a linear phase. TopSpin pivots this phase at the
  // first displayed point (+SW/2), i.e. exp(i*2*pi*g*(f - N/2)/N) with f the signed frequency
  // index; verified against TopSpin 3.7 output (PHC0/PHC1 then reproduce the stored phasing).
  if (g !== 0) {
    for (let k = 0; k < N; k++) {
      const f = (k < N / 2 ? k : k - N) - (conv.orientation === "conj" ? -N / 2 : N / 2);
      const ang = conv.dspSign * 2 * Math.PI * g * f / N * (conv.orientation === "conj" ? -1 : 1);
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const r = re[k] * c - im[k] * s;
      im[k] = re[k] * s + im[k] * c;
      re[k] = r;
    }
  }
  // fftshift and map to TopSpin order: point 0 = +SW/2 (left, high ppm)
  const outRe = new Float64Array(N);
  const outIm = new Float64Array(N);
  if (conv.orientation === "reverse") {
    // TopSpin point j has frequency +SW/2 - j*SW/N  ->  unshifted bin (N/2 - j) mod N
    for (let j = 0; j < N; j++) {
      const k = (((N >> 1) - j) % N + N) % N;
      outRe[j] = re[k];
      outIm[j] = im[k];
    }
  } else {
    // conjugated FID: frequencies are negated, so point j maps to bin (j - N/2) mod N
    for (let j = 0; j < N; j++) {
      const k = ((j - (N >> 1)) % N + N) % N;
      outRe[j] = re[k];
      outIm[j] = im[k];
    }
  }
  return { re: outRe, im: outIm };
}

/** Zero/first order phase correction in TopSpin convention (degrees). Returns new arrays. */
export function phaseSpectrum(
  re: Float64Array,
  im: Float64Array,
  ph0: number,
  ph1: number,
  conv: Conventions = TOPSPIN,
): { re: Float64Array; im: Float64Array } {
  const N = re.length;
  const outRe = new Float64Array(N);
  const outIm = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    const x = conv.phPivot === "left" ? j / N : (j - N) / N;
    const phi = ((conv.phSign * (ph0 + ph1 * x)) * Math.PI) / 180;
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    outRe[j] = re[j] * c - im[j] * s;
    outIm[j] = re[j] * s + im[j] * c;
  }
  return { re: outRe, im: outIm };
}

/** Real part only (faster path for interactive phasing). */
export function phaseReal(re: Float64Array, im: Float64Array, ph0: number, ph1: number, conv: Conventions = TOPSPIN): Float64Array {
  const N = re.length;
  const out = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    const x = conv.phPivot === "left" ? j / N : (j - N) / N;
    const phi = ((conv.phSign * (ph0 + ph1 * x)) * Math.PI) / 180;
    out[j] = re[j] * Math.cos(phi) - im[j] * Math.sin(phi);
  }
  return out;
}
