// nmrPipe single-file reader (2D/3D/4D real data with a 512-float header). Axis order follows
// FDDIMORDER: the cube is returned with the slowest dimension first and the direct (FDDIMORDER1)
// dimension last.
// ppm follows nmrglue pipe.make_uc: the last point sits at ORIG, spacing SW/size.
import { NdCube, nucleusLabel, type CubeAxis } from "../cube";

const FDDIMCOUNT = 9;
const FDFLTORDER = 2;
const FDDIMORDER1 = 24;
const FDSIZE = 99;
const FDSPECNUM = 219;
const FDF3SIZE = 15;
const FDF4SIZE = 32;
const FDQUADFLAG = 106;
const FDPIPEFLAG = 57;

// per-dimension parameter locations (F1..F4)
const PARAMS: Record<number, { sw: number; obs: number; orig: number; label: number; quad: number; ft: number }> = {
  1: { sw: 229, obs: 218, orig: 249, label: 18, quad: 55, ft: 98 },
  2: { sw: 100, obs: 119, orig: 101, label: 16, quad: 56, ft: 96 },
  3: { sw: 11, obs: 10, orig: 12, label: 20, quad: 51, ft: 200 },
  4: { sw: 29, obs: 28, orig: 30, label: 22, quad: 54, ft: 201 },
};

export function readPipe(bytes: Uint8Array): NdCube {
  if (bytes.length < 2048) throw new Error("not an nmrPipe file (header too short)");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let little = true;
  if (Math.abs(dv.getFloat32(FDFLTORDER * 4, true) - 2.345) > 1e-3) {
    little = false;
    if (Math.abs(dv.getFloat32(FDFLTORDER * 4, false) - 2.345) > 1e-3) throw new Error("not an nmrPipe file (byte-order flag missing)");
  }
  const f = (i: number) => dv.getFloat32(i * 4, little);
  const label = (i: number) => {
    let s = "";
    for (let k = 0; k < 8; k++) {
      const c = bytes[i * 4 + k];
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s.trim();
  };
  const ndim = Math.round(f(FDDIMCOUNT)) || 2;
  if (ndim < 1 || ndim > 4) throw new Error(`unsupported nmrPipe dimension count ${ndim}`);
  if (Math.round(f(FDQUADFLAG)) !== 1 && Math.round(f(FDQUADFLAG)) !== 0) throw new Error("unexpected FDQUADFLAG");
  // FDDIMORDER: which F-dimension is stored in each data axis (x = order[0] = direct)
  const order = [0, 1, 2, 3].map((k) => Math.round(f(FDDIMORDER1 + k))).slice(0, ndim);
  // sizes per data axis: x = FDSIZE (real points), y = FDSPECNUM, z = FDF3SIZE, a = FDF4SIZE
  const sizes = [Math.round(f(FDSIZE)), Math.round(f(FDSPECNUM)), Math.round(f(FDF3SIZE)), Math.round(f(FDF4SIZE))].slice(0, ndim);
  if (ndim >= 3 && Math.round(f(FDPIPEFLAG)) === 0 && sizes[2] > 1) {
    // a single plane of a multi-file series: only that plane is present
    sizes[2] = 1;
  }
  const axisFor = (dataAxis: number): CubeAxis => {
    const fdim = order[dataAxis];
    const p = PARAMS[fdim] ?? PARAMS[2];
    const size = sizes[dataAxis];
    const sw = f(p.sw) || 1;
    const obs = f(p.obs) || 1;
    const orig = f(p.orig);
    const nucleus = label(p.label) || `F${fdim}`;
    const step = -sw / (size * obs);
    // car = orig + sw/2 - sw/size  →  ppm(0) = (orig + sw - sw/size)/obs
    const ppm0 = (orig + sw - sw / size) / obs;
    return { nucleus, label: nucleusLabel(nucleus), size, sf: obs, sw, ppm0, step };
  };
  // cube axes slowest → fastest: data axis ndim-1 ... 0
  const axes: CubeAxis[] = [];
  for (let a = ndim - 1; a >= 0; a--) axes.push(axisFor(a));
  const total = axes.reduce((p, a) => p * a.size, 1);
  if (bytes.length < 2048 + total * 4) throw new Error(`truncated nmrPipe data: need ${total} points`);
  const data = new Float32Array(total);
  for (let i = 0; i < total; i++) data[i] = dv.getFloat32(2048 + i * 4, little);
  return new NdCube(axes, data);
}
