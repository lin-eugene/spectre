// Small, framework-free helpers for drawing processed spectra (browser-safe).

/** "Nice" tick values covering [a, b] (any order), roughly `count` ticks. */
export function niceTicks(a: number, b: number, count = 6): number[] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

export function tickDecimals(ticks: number[]): number {
  if (ticks.length < 2) return 2;
  const step = Math.abs(ticks[1] - ticks[0]);
  return Math.max(0, Math.min(4, -Math.floor(Math.log10(step) + 1e-9)));
}

/** Compact intensity label (1.2K, 3.4M). */
export function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(a >= 1e10 ? 0 : 1)}G`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
  if (a === 0) return "0";
  return a >= 1 ? v.toFixed(0) : v.toPrecision(2);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Min/max decimation of y[i0..i1] into `cols` pixel columns; returns per column [min, max, firstIdx].
 * Keeps every peak visible regardless of zoom.
 */
export function minMaxColumns(y: ArrayLike<number>, i0: number, i1: number, cols: number): Float64Array {
  const out = new Float64Array(cols * 2);
  const n = i1 - i0 + 1;
  for (let c = 0; c < cols; c++) {
    const a = i0 + Math.floor((c * n) / cols);
    const b = Math.max(a, i0 + Math.floor(((c + 1) * n) / cols) - 1);
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = a; i <= b; i++) {
      const v = y[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    out[2 * c] = mn;
    out[2 * c + 1] = mx;
  }
  return out;
}
