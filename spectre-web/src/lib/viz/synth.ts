// Fast synthesis of 2D spectrum planes from peak lists: each peak is an outer product of
// two 1D pseudo-Voigt lineshapes, accumulated only inside a local window, so a 256²
// plane with ~100 peaks costs well under a millisecond.

export interface PlanePeak {
  x: number; // ppm along the horizontal axis
  y: number; // ppm along the vertical axis
  amp: number; // signed amplitude
  fwhmX: number; // ppm
  fwhmY: number; // ppm
}

/** Sampling of one axis in screen order: sample 0 at `from`, sample n-1 at `to` (ppm). */
export interface AxisSampling {
  from: number;
  to: number;
  n: number;
}

export interface Plane {
  nx: number;
  ny: number;
  data: Float32Array; // row-major, row 0 = top
  max: number; // max positive value
  min: number; // most negative value
}

/** Lorentz fraction of the display lineshape: mostly Gaussian, like apodised data,
 *  which keeps contours round instead of star-shaped. */
const ETA = 0.18;

export function pseudoVoigt(dx: number, fwhm: number, eta = ETA): number {
  const x = dx / (fwhm / 2);
  const x2 = x * x;
  return eta / (1 + x2) + (1 - eta) * Math.exp(-Math.LN2 * x2);
}

function profile(center: number, fwhm: number, ax: AxisSampling, reach = 5): { start: number; vals: Float32Array } | null {
  const step = (ax.to - ax.from) / (ax.n - 1);
  if (step === 0) return null;
  const fIdx = (center - ax.from) / step; // fractional index
  const half = Math.abs((reach * fwhm) / step);
  let start = Math.floor(fIdx - half);
  let end = Math.ceil(fIdx + half);
  if (end < 0 || start > ax.n - 1) return null;
  start = Math.max(0, start);
  end = Math.min(ax.n - 1, end);
  const vals = new Float32Array(end - start + 1);
  for (let i = start; i <= end; i++) vals[i - start] = pseudoVoigt(ax.from + i * step - center, fwhm);
  return { start, vals };
}

export function synthPlane(peaks: PlanePeak[], ax: AxisSampling, ay: AxisSampling): Plane {
  const nx = ax.n;
  const ny = ay.n;
  const data = new Float32Array(nx * ny);
  for (const p of peaks) {
    const px = profile(p.x, p.fwhmX, ax);
    if (!px) continue;
    const py = profile(p.y, p.fwhmY, ay);
    if (!py) continue;
    for (let j = 0; j < py.vals.length; j++) {
      const wy = py.vals[j] * p.amp;
      if (wy === 0) continue;
      const row = (py.start + j) * nx + px.start;
      for (let i = 0; i < px.vals.length; i++) data[row + i] += wy * px.vals[i];
    }
  }
  let max = 0;
  let min = 0;
  for (let k = 0; k < data.length; k++) {
    const v = data[k];
    if (v > max) max = v;
    if (v < min) min = v;
  }
  return { nx, ny, data, max, min };
}

/** Smooth, deterministic low-level noise (adds a faint, realistic floor to heat washes). */
export function addNoise(plane: Plane, rel: number, seed = 7): void {
  let s = seed | 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
  };
  const amp = Math.max(Math.abs(plane.max), Math.abs(plane.min)) * rel;
  for (let k = 0; k < plane.data.length; k++) plane.data[k] += rnd() * amp;
}

/** NMR-style geometric contour levels: base·factor^k up to the maximum. */
export function geometricLevels(max: number, base = 0.06, factor = 1.32, count = 12): number[] {
  const out: number[] = [];
  if (!(max > 0)) return out;
  let lv = max * base;
  for (let k = 0; k < count && lv < max; k++) {
    out.push(lv);
    lv *= factor;
  }
  return out;
}
