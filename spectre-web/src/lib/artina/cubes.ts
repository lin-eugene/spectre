// Server-side cache of real spectra (NdCube, read from NMRPipe files) loaded from the ARTINA
// download cache or from uploaded files. Cubes are large binary data and never go into the JSON
// project state; projects only record which spectra exist (realSpectra) and where the files are.
// LRU by bytes on globalThis.
import fs from "node:fs";
import type { RealSpectrumMeta } from "../contract";
import { axisPpmMax, axisPpmMin, type NdCube } from "../spectra/cube";
import { readPipe } from "../spectra/formats";
import { resolveStored } from "../peaklists/paths";

const LIMIT_BYTES = Number(process.env.SPECTRE_CUBE_CACHE_MB || 1536) * 1024 * 1024;

interface Entry {
  cube: NdCube;
  bytes: number;
  used: number;
}
interface CubeGlobals {
  __spectreCubes?: Map<string, Entry>;
}
const g = globalThis as unknown as CubeGlobals;
const cache = (g.__spectreCubes ??= new Map<string, Entry>());

/**
 * Resolve a stored spectrum path safely: "uploads/<project>/<file>" inside the uploads directory,
 * anything else (e.g. "2K50/spectra/HNCA.pipe") inside the ARTINA cache.
 */
export const resolveCacheFile = resolveStored;

/** What the UI needs to know about a real spectrum (axes, noise, size) and where it is stored. */
export function realSpectrumMeta(name: string, experiment: string, engineType: string | undefined, cube: NdCube, file: string): RealSpectrumMeta & { file: string } {
  return {
    name,
    experiment,
    ...(engineType ? { engineType } : {}),
    ndim: cube.ndim,
    axes: cube.axes.map((a) => ({ nucleus: a.nucleus, label: a.label, size: a.size, sf: +a.sf.toFixed(4), ppmMax: +axisPpmMax(a).toFixed(4), ppmMin: +axisPpmMin(a).toFixed(4) })),
    noise: +cube.noise().toPrecision(4),
    maxAbs: +cube.maxAbs().toPrecision(4),
    sizeMB: +(cube.data.byteLength / 1048576).toFixed(2),
    file,
  };
}

/** Drop a file's cube from the cache (e.g. a replaced or deleted upload). */
export function forgetCube(abs: string): void {
  cache.delete(abs);
}

export function loadCubeFile(abs: string): NdCube {
  const hit = cache.get(abs);
  if (hit) {
    hit.used = Date.now();
    return hit.cube;
  }
  // runtime data directory (.data/artina), not part of the deployed server bundle
  const bytes = new Uint8Array(fs.readFileSync(/*turbopackIgnore: true*/ abs));
  const cube = readPipe(bytes);
  const size = cube.data.byteLength;
  let total = size;
  for (const e of cache.values()) total += e.bytes;
  if (total > LIMIT_BYTES) {
    const byAge = [...cache.entries()].sort((a, b) => a[1].used - b[1].used);
    for (const [k, e] of byAge) {
      if (total <= LIMIT_BYTES) break;
      cache.delete(k);
      total -= e.bytes;
    }
  }
  cache.set(abs, { cube, bytes: size, used: Date.now() });
  return cube;
}

/** Load a cube by cache-relative path; null when the file is missing. */
export function getCube(rel: string): NdCube | null {
  const abs = resolveCacheFile(rel);
  if (!abs || !fs.existsSync(/*turbopackIgnore: true*/ abs)) return null;
  return loadCubeFile(abs);
}
