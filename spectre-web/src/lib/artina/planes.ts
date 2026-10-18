// 2D planes / projections and strips of a project's real spectra for the UI, encoded as
// base64 little-endian Float32 (row 0 = ppmMax of y, column 0 = ppmMax of x). Results are
// cached (LRU on globalThis) because the same planes are requested repeatedly.
import os from "node:os";
import type { PlaneResponse, RealSpectrumMeta, StripResponse } from "../contract";
import { axisPpmMax, axisPpmMin, poolPlane, type CubeAxis, type NdCube } from "../spectra/cube";
import type { ProjectState } from "../project/types";
import { getCube } from "./cubes";

const MAX_ENTRIES = 96;
interface PlaneGlobals {
  __spectrePlanes?: Map<string, PlaneResponse | StripResponse>;
}
const g = globalThis as unknown as PlaneGlobals;
const cache = (g.__spectrePlanes ??= new Map<string, PlaneResponse | StripResponse>());

function remember<T extends PlaneResponse | StripResponse>(key: string, make: () => T): T {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit as T;
  }
  const v = make();
  cache.set(key, v);
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return v;
}

export function encodeFloat32(arr: Float32Array): string {
  let a = arr;
  if (os.endianness() !== "LE") {
    a = new Float32Array(arr.length);
    const dv = new DataView(a.buffer);
    for (let i = 0; i < arr.length; i++) dv.setFloat32(i * 4, arr[i], true);
  }
  return Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString("base64");
}

/** RealSpectrumMeta without the server-side cache path. */
export function publicMeta(r: RealSpectrumMeta & { file?: string }): RealSpectrumMeta {
  const out: RealSpectrumMeta & { file?: string } = { ...r };
  delete out.file;
  return out;
}

export function findRealSpectrum(state: ProjectState, name: string): (RealSpectrumMeta & { file: string }) | undefined {
  const key = name.trim().toLowerCase();
  return (state.realSpectra ?? []).find((r) => r.name.toLowerCase() === key || r.experiment.toLowerCase() === key);
}

/** Resolve a dimension given as index ("0"), label ("1H"/"15N"/"13C") or nucleus ("H","N","C","HN"). */
function resolveDim(cube: NdCube, spec: string | null | undefined, skip: number[] = []): number {
  if (spec === null || spec === undefined || spec === "") return -1;
  if (/^\d$/.test(spec)) {
    const d = Number(spec);
    return d < cube.ndim && !skip.includes(d) ? d : -1;
  }
  const s = spec.toUpperCase();
  const label = s === "1H" || s === "H" || s === "HN" || s === "HC" ? "1H" : s === "15N" || s === "N" ? "15N" : s === "13C" || s === "C" ? "13C" : null;
  const byNucleus = cube.axes.findIndex((a, d) => !skip.includes(d) && a.nucleus.toUpperCase() === s);
  if (byNucleus >= 0) return byNucleus;
  return label ? cube.axes.findIndex((a, d) => !skip.includes(d) && a.label === label) : -1;
}

/** Flip a row-major plane so that row 0 / column 0 hold the highest ppm. */
function orient(data: Float32Array, ny: number, nx: number, yAxis: CubeAxis, xAxis: CubeAxis): Float32Array {
  const flipY = yAxis.step > 0;
  const flipX = xAxis.step > 0;
  if (!flipY && !flipX) return data;
  const out = new Float32Array(data.length);
  for (let y = 0; y < ny; y++) {
    const sy = flipY ? ny - 1 - y : y;
    for (let x = 0; x < nx; x++) out[y * nx + x] = data[sy * nx + (flipX ? nx - 1 - x : x)];
  }
  return out;
}

const axisDesc = (dim: number, a: CubeAxis, n: number) => ({
  dim,
  label: a.label,
  nucleus: a.nucleus,
  ppmMax: +axisPpmMax(a).toFixed(4),
  ppmMin: +axisPpmMin(a).toFixed(4),
  n,
});

export interface PlaneQuery {
  y?: string | null;
  x?: string | null;
  mode?: string | null;
  at?: number | null;
  maxPoints?: number | null;
}

export function planeFor(state: ProjectState, name: string, q: PlaneQuery): PlaneResponse | { error: string; status: number } {
  const real = findRealSpectrum(state, name);
  if (!real) return { error: `no real spectrum "${name}" in this project`, status: 404 };
  const cube = getCube(real.file);
  if (!cube) return { error: `spectrum file for ${real.name} is not in the local cache`, status: 410 };
  let xd = resolveDim(cube, q.x);
  if (xd < 0) xd = cube.dimOf("1H") >= 0 ? cube.dimOf("1H") : cube.ndim - 1;
  let yd = resolveDim(cube, q.y, [xd]);
  if (yd < 0) {
    const n = cube.dimOf("15N", [xd]);
    yd = n >= 0 ? n : [...Array(cube.ndim).keys()].find((d) => d !== xd)!;
  }
  if (xd === yd) return { error: "x and y must be different dimensions", status: 400 };
  const maxPoints = Math.max(32, Math.min(1024, Math.round(q.maxPoints ?? 512)));
  const others = [...Array(cube.ndim).keys()].filter((d) => d !== xd && d !== yd);
  const mode: "projection" | "slice" = cube.ndim === 2 ? "slice" : q.mode === "slice" ? "slice" : "projection";
  const at: Record<number, number> = {};
  if (mode === "slice") {
    for (const d of others) {
      const a = cube.axes[d];
      const centre = (axisPpmMax(a) + axisPpmMin(a)) / 2;
      const want = q.at ?? centre;
      at[d] = cube.ppm(cube.index(want, d, false), d); // snap to the nearest plane inside the window
    }
  }
  const key = `${real.file}|${yd}|${xd}|${mode}|${others.map((d) => at[d]?.toFixed(4) ?? "").join(",")}|${maxPoints}`;
  return remember(key, () => {
    const pl = cube.plane(yd, xd, mode === "slice" ? { mode: "slice", at } : { mode: "projection" }, maxPoints);
    const data = orient(pl.data, pl.ny, pl.nx, pl.yAxis, pl.xAxis);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < data.length; i++) {
      if (data[i] < min) min = data[i];
      if (data[i] > max) max = data[i];
    }
    return {
      name: real.name,
      mode,
      ...(mode === "slice" && others.length ? { at: Object.fromEntries(others.map((d) => [String(d), +at[d].toFixed(4)])) } : {}),
      x: axisDesc(xd, pl.xAxis, pl.nx),
      y: axisDesc(yd, pl.yAxis, pl.ny),
      data: encodeFloat32(data),
      min,
      max,
      noise: +cube.noise().toPrecision(5),
    } satisfies PlaneResponse;
  });
}

export function stripFor(state: ProjectState, name: string, h: number, n: number, hw = 0.15): StripResponse | { error: string; status: number } {
  const real = findRealSpectrum(state, name);
  if (!real) return { error: `no real spectrum "${name}" in this project`, status: 404 };
  if (real.ndim !== 3) return { error: `${real.name} is not a 3D spectrum`, status: 400 };
  const cube = getCube(real.file);
  if (!cube) return { error: `spectrum file for ${real.name} is not in the local cache`, status: 410 };
  const hd = cube.dimOf("1H");
  const nd = cube.dimOf("15N", [hd]);
  if (hd < 0 || nd < 0) return { error: `${real.name} has no 1H/15N dimensions`, status: 400 };
  const cd = [0, 1, 2].find((d) => d !== hd && d !== nd)!;
  const width = Math.max(0.02, Math.min(1.5, hw));
  const key = `strip|${real.file}|${h.toFixed(4)}|${n.toFixed(3)}|${width.toFixed(3)}`;
  return remember(key, () => {
    const ni = cube.index(n, nd);
    const hA = cube.axes[hd];
    // H columns from h+width (high ppm) down to h-width
    let i0 = Math.round(cube.fracIndex(h + width, hd));
    let i1 = Math.round(cube.fracIndex(h - width, hd));
    if (i0 > i1) [i0, i1] = [i1, i0];
    i0 = Math.max(0, i0);
    i1 = Math.min(hA.size - 1, i1);
    const nh = i1 - i0 + 1;
    const cA = cube.axes[cd];
    const nc = cA.size;
    const full = new Float32Array(nc * nh);
    const idx = [0, 0, 0];
    idx[nd] = ni;
    for (let ci = 0; ci < nc; ci++) {
      idx[cd] = ci;
      for (let k = 0; k < nh; k++) {
        idx[hd] = i0 + k;
        full[ci * nh + k] = cube.at(idx);
      }
    }
    const hAxisSub: CubeAxis = { ...hA, size: nh, ppm0: cube.ppm(i0, hd) };
    const pooled = poolPlane(full, nc, nh, 512, cA, hAxisSub);
    const data = orient(pooled.data, pooled.ny, pooled.nx, pooled.yAxis, pooled.xAxis);
    let maxAbs = 0;
    for (let i = 0; i < data.length; i++) maxAbs = Math.max(maxAbs, Math.abs(data[i]));
    return {
      name: real.name,
      h: +cube.ppm(cube.index(h, hd), hd).toFixed(4),
      n: +cube.ppm(ni, nd).toFixed(3),
      c: { label: cA.label, ppmMax: +axisPpmMax(pooled.yAxis).toFixed(4), ppmMin: +axisPpmMin(pooled.yAxis).toFixed(4), n: pooled.ny },
      hAxis: { ppmMax: +axisPpmMax(pooled.xAxis).toFixed(4), ppmMin: +axisPpmMin(pooled.xAxis).toFixed(4), n: pooled.nx },
      data: encodeFloat32(data),
      noise: +cube.noise().toPrecision(5),
      maxAbs,
    } satisfies StripResponse;
  });
}
