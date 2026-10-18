// Sparky UCSF reader: 180-byte file header, one 128-byte header per axis, then big-endian
// float32 data stored in tiles (tile grid row-major, last axis fastest; points row-major
// within a tile). Edge tiles are padded to full size. The ppm axis follows nmrglue's
// sparky.make_uc: ppm(i) = centre + sw/(2·sf) − i·sw/(sf·n).
import { NdCube, nucleusLabel, type CubeAxis } from "../cube";

export interface UcsfHeader {
  ndim: number;
  components: number;
  version: number;
  axes: { nucleus: string; size: number; tile: number; sf: number; sw: number; center: number }[];
  dataOffset: number;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function cstr(bytes: Uint8Array, start: number, len: number): string {
  let s = "";
  for (let i = start; i < start + len && bytes[i] !== 0; i++) s += String.fromCharCode(bytes[i]);
  return s.trim();
}

export function readUcsfHeader(bytes: Uint8Array): UcsfHeader {
  if (bytes.length < 180 || cstr(bytes, 0, 8) !== "UCSF NMR") throw new Error("not a UCSF (Sparky) file");
  const dv = view(bytes);
  const ndim = bytes[10];
  const components = bytes[11];
  const version = bytes[13];
  if (ndim < 1 || ndim > 4) throw new Error(`unsupported UCSF dimension count ${ndim}`);
  if (components !== 1) throw new Error("complex UCSF data are not supported");
  const axes: UcsfHeader["axes"] = [];
  for (let d = 0; d < ndim; d++) {
    const o = 180 + 128 * d;
    axes.push({
      nucleus: cstr(bytes, o, 8),
      size: dv.getInt32(o + 8, false),
      tile: dv.getInt32(o + 16, false),
      sf: dv.getFloat32(o + 20, false),
      sw: dv.getFloat32(o + 24, false),
      center: dv.getFloat32(o + 28, false),
    });
  }
  return { ndim, components, version, axes, dataOffset: 180 + 128 * ndim };
}

export function ucsfAxes(h: UcsfHeader): CubeAxis[] {
  return h.axes.map((a) => {
    const swPpm = a.sw / a.sf;
    return {
      nucleus: a.nucleus,
      label: nucleusLabel(a.nucleus),
      size: a.size,
      sf: a.sf,
      sw: a.sw,
      ppm0: a.center + swPpm / 2,
      step: -swPpm / a.size,
    };
  });
}

/** Read a UCSF file into an NdCube (axes in file order, last axis = direct dimension). */
export function readUcsf(bytes: Uint8Array): NdCube {
  const h = readUcsfHeader(bytes);
  const n = h.axes.map((a) => a.size);
  const t = h.axes.map((a) => Math.max(1, a.tile));
  const nd = h.ndim;
  const ntile = n.map((s, d) => Math.ceil(s / t[d]));
  const tileVol = t.reduce((p, x) => p * x, 1);
  const total = n.reduce((p, x) => p * x, 1);
  const expected = h.dataOffset + ntile.reduce((p, x) => p * x, 1) * tileVol * 4;
  if (bytes.length < expected) throw new Error(`truncated UCSF data: ${bytes.length} < ${expected} bytes`);
  const data = new Float32Array(total);
  const dv = view(bytes);
  // strides of the full array
  const stride = new Array<number>(nd);
  let s = 1;
  for (let d = nd - 1; d >= 0; d--) {
    stride[d] = s;
    s *= n[d];
  }
  const tileCount = ntile.reduce((p, x) => p * x, 1);
  const T = new Array<number>(nd).fill(0);
  const L = new Array<number>(nd).fill(0);
  const last = nd - 1;
  const rowLen = t[last];
  let fileOff = h.dataOffset;
  for (let ti = 0; ti < tileCount; ti++) {
    // tile coordinates (row-major, last axis fastest)
    let r = ti;
    for (let d = last; d >= 0; d--) {
      T[d] = r % ntile[d];
      r = Math.floor(r / ntile[d]);
    }
    // iterate rows of the tile (all dims but the last), each row has rowLen contiguous points
    const rows = tileVol / rowLen;
    for (let row = 0; row < rows; row++) {
      let rr = row;
      let inside = true;
      let base = 0;
      for (let d = last - 1; d >= 0; d--) {
        L[d] = rr % t[d];
        rr = Math.floor(rr / t[d]);
        const g = T[d] * t[d] + L[d];
        if (g >= n[d]) inside = false;
        base += g * stride[d];
      }
      if (inside) {
        const g0 = T[last] * t[last];
        const count = Math.min(rowLen, n[last] - g0);
        let o = fileOff;
        for (let k = 0; k < count; k++, o += 4) data[base + g0 + k] = dv.getFloat32(o, false);
      }
      fileOff += rowLen * 4;
    }
  }
  return new NdCube(ucsfAxes(h), data);
}
