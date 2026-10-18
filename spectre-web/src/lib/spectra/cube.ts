// N-dimensional processed spectrum held in memory (real data from UCSF / nmrPipe files).
// Data are row-major with axis 0 slowest, matching the order axes are stored in the file.

export interface CubeAxis {
  /** nucleus label from the file, e.g. "H", "N", "C", "HN", "15N" */
  nucleus: string;
  /** display label, e.g. "1H", "15N", "13C" */
  label: string;
  size: number;
  /** spectrometer frequency (MHz) for this nucleus */
  sf: number;
  /** spectral width (Hz) */
  sw: number;
  /** ppm at index 0 (the high-ppm edge) */
  ppm0: number;
  /** ppm increment per point (negative: ppm decreases with index) */
  step: number;
}

export function axisPpmMax(a: CubeAxis) {
  return Math.max(a.ppm0, a.ppm0 + (a.size - 1) * a.step);
}
export function axisPpmMin(a: CubeAxis) {
  return Math.min(a.ppm0, a.ppm0 + (a.size - 1) * a.step);
}

/** Map a nucleus string from a file header to "1H" | "13C" | "15N" | other. */
export function nucleusLabel(n: string): string {
  const s = n.toUpperCase();
  if (/^(1H|H|HN|HC|HA|H1|H2|HX|HY)/.test(s)) return "1H";
  if (/^(13C|C|CA|CB|CO|C1|C2)/.test(s)) return "13C";
  if (/^(15N|N)/.test(s)) return "15N";
  return n;
}

export class NdCube {
  readonly strides: number[];
  private memo: { noise?: number; maxAbs?: number } = {};

  constructor(
    public axes: CubeAxis[],
    public data: Float32Array,
  ) {
    const n = axes.reduce((p, a) => p * a.size, 1);
    if (n !== data.length) throw new Error(`cube size mismatch: axes ${n} vs data ${data.length}`);
    this.strides = new Array(axes.length);
    let s = 1;
    for (let d = axes.length - 1; d >= 0; d--) {
      this.strides[d] = s;
      s *= axes[d].size;
    }
  }

  get ndim() {
    return this.axes.length;
  }

  /** dimension index whose nucleus label matches (first match), or -1 */
  dimOf(label: "1H" | "13C" | "15N", skip: number[] = []): number {
    return this.axes.findIndex((a, i) => !skip.includes(i) && a.label === label);
  }

  ppm(idx: number, d: number): number {
    const a = this.axes[d];
    return a.ppm0 + idx * a.step;
  }

  /** fractional index of a ppm value (no folding) */
  fracIndex(ppm: number, d: number): number {
    const a = this.axes[d];
    return (ppm - a.ppm0) / a.step;
  }

  /** nearest grid index, folding (aliasing) ppm values outside the window back into it */
  index(ppm: number, d: number, fold = true): number {
    const a = this.axes[d];
    let f = Math.round(this.fracIndex(ppm, d));
    if (fold) {
      f = ((f % a.size) + a.size) % a.size;
    } else f = Math.max(0, Math.min(a.size - 1, f));
    return f;
  }

  offset(idx: number[]): number {
    let o = 0;
    for (let d = 0; d < idx.length; d++) o += idx[d] * this.strides[d];
    return o;
  }

  at(idx: number[]): number {
    return this.data[this.offset(idx)];
  }

  /** multilinear interpolation at ppm coordinates (clamped to the window) */
  valueAtPpm(ppms: number[]): number {
    const nd = this.ndim;
    const lo: number[] = [];
    const w: number[] = [];
    for (let d = 0; d < nd; d++) {
      const a = this.axes[d];
      let f = this.fracIndex(ppms[d], d);
      f = Math.max(0, Math.min(a.size - 1, f));
      const i = Math.min(a.size - 2, Math.floor(f));
      lo.push(Math.max(0, i));
      w.push(a.size > 1 ? f - Math.max(0, i) : 0);
    }
    let v = 0;
    for (let corner = 0; corner < 1 << nd; corner++) {
      let o = 0;
      let wt = 1;
      for (let d = 0; d < nd; d++) {
        const bit = (corner >> d) & 1;
        const i = Math.min(this.axes[d].size - 1, lo[d] + bit);
        o += i * this.strides[d];
        wt *= bit ? w[d] : 1 - w[d];
      }
      if (wt) v += wt * this.data[o];
    }
    return v;
  }

  /** 1D trace along `dim` with the other dimensions fixed at the given ppm values (nearest point). */
  trace(dim: number, fixedPpm: (number | null)[]): { ppm: number[]; values: Float32Array } {
    const idx = fixedPpm.map((p, d) => (d === dim || p === null ? 0 : this.index(p, d)));
    const n = this.axes[dim].size;
    const values = new Float32Array(n);
    const ppm: number[] = [];
    let o = this.offset(idx);
    o -= idx[dim] * this.strides[dim];
    for (let i = 0; i < n; i++) {
      values[i] = this.data[o + i * this.strides[dim]];
      ppm.push(this.ppm(i, dim));
    }
    return { ppm, values };
  }

  /**
   * 2D plane over dims [ydim, xdim]. Other dims are either fixed at ppm values (slice) or
   * reduced by max-|value| projection (sign of the extreme kept). Optional block pooling keeps
   * peaks when downsampling to at most maxPoints per axis.
   */
  plane(
    ydim: number,
    xdim: number,
    other: { mode: "slice"; at: Record<number, number> } | { mode: "projection"; range?: Record<number, [number, number]> },
    maxPoints = 512,
  ): { nx: number; ny: number; data: Float32Array; xAxis: CubeAxis; yAxis: CubeAxis } {
    const nd = this.ndim;
    const ys = this.axes[ydim].size;
    const xs = this.axes[xdim].size;
    const full = new Float32Array(ys * xs);
    const otherDims = [...Array(nd).keys()].filter((d) => d !== ydim && d !== xdim);
    if (other.mode === "slice") {
      const fixed = new Array(nd).fill(0);
      for (const d of otherDims) fixed[d] = this.index(other.at[d] ?? this.ppm((this.axes[d].size / 2) | 0, d), d);
      for (let y = 0; y < ys; y++) {
        fixed[ydim] = y;
        for (let x = 0; x < xs; x++) {
          fixed[xdim] = x;
          full[y * xs + x] = this.data[this.offset(fixed)];
        }
      }
    } else {
      // iterate all points once and keep the extreme value per (y, x)
      const ranges = otherDims.map((d) => {
        const r = other.range?.[d];
        if (!r) return [0, this.axes[d].size - 1];
        const a = Math.round(this.fracIndex(r[0], d));
        const b = Math.round(this.fracIndex(r[1], d));
        return [Math.max(0, Math.min(a, b)), Math.min(this.axes[d].size - 1, Math.max(a, b))];
      });
      const idx = new Array(nd).fill(0);
      const rec = (k: number) => {
        if (k === otherDims.length) {
          for (let y = 0; y < ys; y++) {
            idx[ydim] = y;
            for (let x = 0; x < xs; x++) {
              idx[xdim] = x;
              const v = this.data[this.offset(idx)];
              const j = y * xs + x;
              if (Math.abs(v) > Math.abs(full[j])) full[j] = v;
            }
          }
          return;
        }
        const d = otherDims[k];
        for (let i = ranges[k][0]; i <= ranges[k][1]; i++) {
          idx[d] = i;
          rec(k + 1);
        }
      };
      rec(0);
    }
    return poolPlane(full, ys, xs, maxPoints, this.axes[ydim], this.axes[xdim]);
  }

  /** robust noise estimate: 1.4826 * MAD of a deterministic sample of points (memoised) */
  noise(sample = 200000): number {
    if (sample === 200000 && this.memo.noise !== undefined) return this.memo.noise;
    const v = this.computeNoise(sample);
    if (sample === 200000) this.memo.noise = v;
    return v;
  }

  private computeNoise(sample: number): number {
    const n = this.data.length;
    const stride = Math.max(1, Math.floor(n / sample));
    const vals: number[] = [];
    for (let i = 0; i < n; i += stride) vals.push(this.data[i]);
    vals.sort((a, b) => a - b);
    const med = vals[vals.length >> 1];
    const dev = vals.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
    return 1.4826 * dev[dev.length >> 1] || 1e-12;
  }

  maxAbs(): number {
    if (this.memo.maxAbs !== undefined) return this.memo.maxAbs;
    let m = 0;
    for (let i = 0; i < this.data.length; i++) {
      const v = Math.abs(this.data[i]);
      if (v > m) m = v;
    }
    this.memo.maxAbs = m;
    return m;
  }

  /**
   * Strongest |value| inside a box of ±radius[d] points around `start` (indices wrap around the
   * axis). Returns the box maximum and whether it lies on the box edge (a shoulder).
   */
  boxMax(start: number[], radius: number[]): { idx: number[]; value: number; onEdge: boolean } {
    const nd = this.ndim;
    let best = -1;
    let bestIdx = start;
    let bestOff: number[] = new Array(nd).fill(0);
    const span = radius.map((r) => 2 * r + 1);
    const total = span.reduce((p, x) => p * x, 1);
    for (let k = 0; k < total; k++) {
      let r = k;
      const cand: number[] = new Array(nd);
      const off: number[] = new Array(nd);
      for (let d = nd - 1; d >= 0; d--) {
        off[d] = (r % span[d]) - radius[d];
        r = Math.floor(r / span[d]);
        const s = this.axes[d].size;
        cand[d] = (((start[d] + off[d]) % s) + s) % s;
      }
      const v = Math.abs(this.data[this.offset(cand)]);
      if (v > best) {
        best = v;
        bestIdx = cand;
        bestOff = off;
      }
    }
    return { idx: bestIdx, value: this.at(bestIdx), onEdge: bestOff.some((o, d) => radius[d] > 0 && Math.abs(o) === radius[d]) };
  }

  /** Sub-point position of a maximum: parabolic interpolation of |value| along each dimension. */
  refine(idx: number[]): number[] {
    return idx.map((i, d) => {
      const s = this.axes[d].size;
      if (s < 3) return i;
      const at = (j: number) => {
        const q = [...idx];
        q[d] = ((j % s) + s) % s;
        return Math.abs(this.data[this.offset(q)]);
      };
      const a = at(i - 1);
      const b = at(i);
      const c = at(i + 1);
      const den = a - 2 * b + c;
      if (den >= 0) return i;
      const delta = (0.5 * (a - c)) / den;
      return i + Math.max(-0.5, Math.min(0.5, delta));
    });
  }

  /** Follow the steepest |value| ascent from `start` (3^n neighbourhood, see boxMax) to a local maximum. */
  climbToMax(start: number[], maxSteps = 1000): { idx: number[]; steps: number } {
    let cur = [...start];
    const one = cur.map(() => 1);
    let steps = 1;
    for (; steps <= maxSteps; steps++) {
      const next = this.boxMax(cur, one).idx;
      if (Math.abs(this.at(next)) <= Math.abs(this.at(cur))) break;
      cur = next;
    }
    return { idx: cur, steps };
  }
}

/** Max-|value| block pooling of a row-major plane down to at most maxPoints per axis. */
export function poolPlane(full: Float32Array, ys: number, xs: number, maxPoints: number, yAxis: CubeAxis, xAxis: CubeAxis) {
  const fy = Math.max(1, Math.ceil(ys / maxPoints));
  const fx = Math.max(1, Math.ceil(xs / maxPoints));
  if (fy === 1 && fx === 1) return { nx: xs, ny: ys, data: full, xAxis, yAxis };
  const ny = Math.ceil(ys / fy);
  const nx = Math.ceil(xs / fx);
  const out = new Float32Array(ny * nx);
  for (let y = 0; y < ys; y++) {
    const oy = Math.floor(y / fy);
    for (let x = 0; x < xs; x++) {
      const j = oy * nx + Math.floor(x / fx);
      const v = full[y * xs + x];
      if (Math.abs(v) > Math.abs(out[j])) out[j] = v;
    }
  }
  const scale = (a: CubeAxis, f: number, n: number): CubeAxis => ({ ...a, size: n, step: a.step * f, ppm0: a.ppm0 + (a.step * (f - 1)) / 2 });
  return { nx, ny, data: out, xAxis: scale(xAxis, fx, nx), yAxis: scale(yAxis, fy, ny) };
}
