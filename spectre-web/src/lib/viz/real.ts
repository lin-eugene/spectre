// Client access to real processed spectra (ARTINA etc.): plane and strip endpoints, base64
// Float32 decoding, orientation into the panel's screen convention, caching and contour
// levels expressed as multiples of the spectrum noise.
import type { PlaneResponse, ProjectView, RealSpectrumMeta, StripResponse } from "../contract";
import type { Plane } from "./synth";
import { ramp as rampOf, rampAt as rampAtOf, rgbToCss as css } from "./colors";

/** Little-endian base64 Float32 → Float32Array (copy, so it is aligned and owned). */
export function decodeF32(b64: string): Float32Array {
  const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const out = new Float32Array(bytes.length >> 2);
  const dv = new DataView(bytes.buffer);
  for (let i = 0; i < out.length; i++) out[i] = dv.getFloat32(i * 4, true);
  return out;
}

/** A real plane oriented for display: column 0 = left (x ppmMax), row 0 = top (y ppmMin). */
export interface RealPlane {
  plane: Plane;
  /** ppm of the first / last sample along each screen axis */
  x: { from: number; to: number; label: string; nucleus: string; dim: number };
  y: { from: number; to: number; label: string; nucleus: string; dim: number };
  noise: number;
  mode: "projection" | "slice";
  at?: Record<string, number>;
}

function flipRows(data: Float32Array, nx: number, ny: number): Float32Array {
  const out = new Float32Array(data.length);
  for (let r = 0; r < ny; r++) out.set(data.subarray((ny - 1 - r) * nx, (ny - r) * nx), r * nx);
  return out;
}

function stats(data: Float32Array): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min: Math.min(0, min), max: Math.max(0, max) };
}

export function orientPlane(r: PlaneResponse): RealPlane {
  const nx = r.x.n;
  const ny = r.y.n;
  const raw = decodeF32(r.data);
  const data = flipRows(raw, nx, ny); // screen: y increases downward
  const s = stats(data);
  return {
    plane: { nx, ny, data, max: s.max, min: s.min },
    x: { from: r.x.ppmMax, to: r.x.ppmMin, label: r.x.label, nucleus: r.x.nucleus, dim: r.x.dim },
    y: { from: r.y.ppmMin, to: r.y.ppmMax, label: r.y.label, nucleus: r.y.nucleus, dim: r.y.dim },
    noise: r.noise,
    mode: r.mode,
    at: r.at,
  };
}

export interface RealStrip {
  plane: Plane; // rows = carbon (top = ppmMin), columns = 1H (left = ppmMax)
  c: { from: number; to: number };
  h: { from: number; to: number };
  noise: number;
  maxAbs: number;
}

export function orientStrip(r: StripResponse): RealStrip {
  const nx = r.hAxis.n;
  const ny = r.c.n;
  const data = flipRows(decodeF32(r.data), nx, ny);
  const s = stats(data);
  return {
    plane: { nx, ny, data, max: s.max, min: s.min },
    c: { from: r.c.ppmMin, to: r.c.ppmMax },
    h: { from: r.hAxis.ppmMax, to: r.hAxis.ppmMin },
    noise: r.noise,
    maxAbs: r.maxAbs,
  };
}

// ------------------------------------------------------------------ fetch + cache
const planeCache = new Map<string, Promise<RealPlane>>();
const stripCache = new Map<string, Promise<RealStrip>>();
const MAX_CACHE = 96;

function remember<T>(cache: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit) return hit;
  const p = make();
  p.catch(() => cache.delete(key));
  cache.set(key, p);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  return p;
}

export interface PlaneQuery {
  x: string | number;
  y: string | number;
  mode: "projection" | "slice";
  at?: number | null;
  maxPoints?: number;
}

export function planeUrl(projectId: string, name: string, q: PlaneQuery): string {
  const sp = new URLSearchParams({ x: String(q.x), y: String(q.y), mode: q.mode, maxPoints: String(q.maxPoints ?? 512) });
  if (q.mode === "slice" && q.at != null) sp.set("at", q.at.toFixed(4));
  return `/api/projects/${encodeURIComponent(projectId)}/spectra/${encodeURIComponent(name)}/plane?${sp}`;
}

export function fetchPlane(projectId: string, name: string, q: PlaneQuery, signal?: AbortSignal): Promise<RealPlane> {
  const url = planeUrl(projectId, name, q);
  return remember(planeCache, url, async () => {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`${name}: ${res.status} ${await res.text().catch(() => "")}`.trim());
    return orientPlane((await res.json()) as PlaneResponse);
  });
}

export function fetchStrip(projectId: string, name: string, h: number, n: number, hw = 0.12): Promise<RealStrip> {
  const sp = new URLSearchParams({ h: h.toFixed(4), n: n.toFixed(3), hw: hw.toFixed(3) });
  const url = `/api/projects/${encodeURIComponent(projectId)}/spectra/${encodeURIComponent(name)}/strip?${sp}`;
  return remember(stripCache, url, async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${name} strip: ${res.status}`);
    return orientStrip((await res.json()) as StripResponse);
  });
}

// ------------------------------------------------------------------ helpers
/** Contour levels for real data: base·noise·factor^k up to the extreme of the plane. */
export function noiseLevels(extreme: number, noise: number, baseSigma = 5, factor = 1.4, maxCount = 14): number[] {
  const out: number[] = [];
  const n = noise > 0 ? noise : Math.abs(extreme) / 200;
  let lv = n * baseSigma;
  for (let k = 0; k < maxCount && lv < Math.abs(extreme); k++) {
    out.push(lv);
    lv *= factor;
  }
  return out;
}

export function isHsqc15N(s: RealSpectrumMeta): boolean {
  if (s.ndim !== 2) return false;
  const labels = s.axes.map((a) => a.label);
  return labels.includes("1H") && labels.includes("15N");
}

export function findRealHsqc(project: ProjectView): RealSpectrumMeta | undefined {
  const list = project.realSpectra ?? [];
  return list.find((s) => isHsqc15N(s) && /N15|15N/i.test(s.experiment)) ?? list.find(isHsqc15N);
}

export function realSpectrumFor(project: ProjectView, tp: string): RealSpectrumMeta | undefined {
  return (project.realSpectra ?? []).find((s) => s.engineType === tp);
}

/** Pretty nucleus label with superscripts, e.g. "1H" → "¹H". */
export function nucLabel(label: string): string {
  const sup: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
  const m = label.match(/^(\d+)([A-Za-z]+)$/);
  return m ? m[1].replace(/\d/g, (d) => sup[d]) + m[2] : label;
}

/** Value of the plane at a ppm position (nearest sample). */
export function sampleAt(r: { plane: Plane; x: { from: number; to: number }; y: { from: number; to: number } }, xppm: number, yppm: number): number | null {
  const { nx, ny, data } = r.plane;
  const i = Math.round(((xppm - r.x.from) / (r.x.to - r.x.from)) * (nx - 1));
  const j = Math.round(((yppm - r.y.from) / (r.y.to - r.y.from)) * (ny - 1));
  if (i < 0 || j < 0 || i >= nx || j >= ny) return null;
  return data[j * nx + i];
}

// ------------------------------------------------------------------ colour bar for real data

/** Stops and S/N ticks matching realHeatImage's log mapping (positive phase). */
export function snrColorbar(r: RealPlane | RealStrip, baseSigma: number, dark: boolean): { stops: string[]; ticks: { at: number; label: string }[] } {
  const noise = r.noise > 0 ? r.noise : Math.max(r.plane.max, -r.plane.min) / 200;
  const floorS = Math.round(Math.max(1.5, baseSigma * 0.85) * 10) / 10;
  const topS = Math.max(floorS * 1.01, r.plane.max / noise);
  const g = rampOf("green", dark);
  const stops = Array.from({ length: 8 }, (_, k) => css(rampAtOf(g, 0.15 + (0.85 * k) / 7)));
  const at = (s: number) => Math.log(s / floorS) / Math.log(topS / floorS);
  const candidates = [floorS, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
  const ticks: { at: number; label: string }[] = [];
  let last = -1;
  for (const s of candidates) {
    if (s < floorS || s > topS) continue;
    const p = at(s);
    if (p - last < 0.12) continue;
    ticks.push({ at: p, label: s === floorS ? `${floorS.toFixed(floorS < 10 ? 1 : 0)}` : String(s) });
    last = p;
  }
  if (1 - last > 0.12) ticks.push({ at: 1, label: topS >= 100 ? topS.toFixed(0) : topS.toFixed(1) });
  return { stops, ticks };
}
