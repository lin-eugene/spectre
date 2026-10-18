// Bruker raw data access: FID decoding and digital-filter group delay.
import { num } from "./jcamp";

/** Group delays for older DSP firmware (DSPFVS 10-13), indexed by DECIM (as in nmrglue). */
const DSP_TABLE: Record<number, Record<number, number>> = {
  10: {
    2: 44.75, 3: 33.5, 4: 66.625, 6: 59.083333333333333, 8: 68.5625, 12: 60.375, 16: 69.53125, 24: 61.020833333333333,
    32: 70.015625, 48: 61.34375, 64: 70.2578125, 96: 61.505208333333333, 128: 70.37890625, 192: 61.5859375,
    256: 70.439453125, 384: 61.626302083333333, 512: 70.4697265625, 768: 61.646484375, 1024: 70.48486328125,
    1536: 61.656575520833333, 2048: 70.492431640625,
  },
  11: {
    2: 46.0, 3: 36.5, 4: 48.0, 6: 50.166666666666667, 8: 53.25, 12: 69.5, 16: 72.25, 24: 70.166666666666667, 32: 72.75,
    48: 70.5, 64: 73.0, 96: 70.666666666666667, 128: 72.5, 192: 71.333333333333333, 256: 72.25, 384: 71.666666666666667,
    512: 72.125, 768: 71.833333333333333, 1024: 72.0625, 1536: 71.916666666666667, 2048: 72.03125,
  },
  12: {
    2: 46.0, 3: 36.5, 4: 48.0, 6: 50.166666666666667, 8: 53.25, 12: 69.5, 16: 71.625, 24: 70.166666666666667, 32: 72.125,
    48: 70.5, 64: 72.375, 96: 70.666666666666667, 128: 72.5, 192: 71.333333333333333, 256: 72.25, 384: 71.666666666666667,
    512: 72.125, 768: 71.833333333333333, 1024: 72.0625, 1536: 71.916666666666667, 2048: 72.03125,
  },
  13: {
    2: 2.75, 3: 2.8333333333333333, 4: 2.875, 6: 2.9166666666666667, 8: 2.9375, 12: 2.9583333333333333, 16: 2.96875,
    24: 2.9791666666666667, 32: 2.984375, 48: 2.9895833333333333, 64: 2.9921875, 96: 2.9947916666666667,
  },
};

/** Digital filter group delay in complex points (GRPDLY, or the DECIM/DSPFVS table). */
export function groupDelay(acqus: Record<string, unknown>): number {
  const g = num(acqus, "GRPDLY", -1);
  if (g > 0) return g;
  if (num(acqus, "DIGMOD", 1) === 0) return 0;
  const dspfvs = num(acqus, "DSPFVS", 0);
  const decim = num(acqus, "DECIM", 0);
  return DSP_TABLE[dspfvs]?.[decim] ?? 0;
}

/** Decode a 1D FID into complex points (real, imag). */
export function readFid(fid: Uint8Array, acqus: Record<string, unknown>): { re: Float64Array; im: Float64Array } {
  const dtypa = num(acqus, "DTYPA", 0); // 0 int32, 1 float32, 2 float64
  const little = num(acqus, "BYTORDA", 0) === 0;
  const td = num(acqus, "TD", 0);
  const bytes = dtypa === 2 ? 8 : 4;
  const view = new DataView(fid.buffer, fid.byteOffset, fid.byteLength);
  const total = Math.floor(fid.byteLength / bytes);
  const nvals = td > 0 ? Math.min(td, total) : total;
  const n = Math.floor(nvals / 2);
  const scale = dtypa === 0 ? Math.pow(2, num(acqus, "NC", 0)) : 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const o = 2 * k * bytes;
    if (dtypa === 2) {
      re[k] = view.getFloat64(o, little);
      im[k] = view.getFloat64(o + bytes, little);
    } else if (dtypa === 1) {
      re[k] = view.getFloat32(o, little);
      im[k] = view.getFloat32(o + bytes, little);
    } else {
      re[k] = view.getInt32(o, little) * scale;
      im[k] = view.getInt32(o + bytes, little) * scale;
    }
  }
  return { re, im };
}

/** Decode a processed real spectrum (1r) for comparison. */
export function readProcessed(data: Uint8Array, procs: Record<string, unknown>): Float64Array {
  const dtypp = num(procs, "DTYPP", 0);
  const little = num(procs, "BYTORDP", 0) === 0;
  const bytes = dtypp === 2 ? 8 : 4;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const n = Math.floor(data.byteLength / bytes);
  const scale = dtypp === 0 ? Math.pow(2, num(procs, "NC_proc", 0)) : 1;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = dtypp === 2 ? view.getFloat64(i * bytes, little) : view.getInt32(i * bytes, little) * scale;
  return out;
}
