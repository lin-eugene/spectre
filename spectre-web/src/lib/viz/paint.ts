// Canvas painters shared by the 2D plane view and the 3D cube textures: log-scaled heat
// images of real planes, linear heat images of synthesised planes, and contour stroking.
import { ramp, rampAt, rgbToCss } from "./colors";
import { traceContour, type ContourSet, type GridToPixel } from "./contours";
import type { RealPlane } from "./real";
import type { Plane } from "./synth";

/** maps contour grid coordinates (sample index + 0.5) to pixels via the plane's ppm sampling */
export function realMapper(r: RealPlane, toPx: (x: number) => number, toPy: (y: number) => number): GridToPixel {
  const sx = (r.x.to - r.x.from) / Math.max(1, r.plane.nx - 1);
  const sy = (r.y.to - r.y.from) / Math.max(1, r.plane.ny - 1);
  return { x: (gx) => toPx(r.x.from + (gx - 0.5) * sx), y: (gy) => toPy(r.y.from + (gy - 0.5) * sy) };
}

/** Log-scaled heat image of a real plane (positive green, negative violet). */
export function realHeatImage(r: RealPlane, baseSigma: number, dark: boolean): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const { nx, ny, data, max, min } = r.plane;
  const noise = r.noise > 0 ? r.noise : Math.max(max, -min) / 200;
  const g = ramp("green", dark);
  const v = ramp("violet", dark);
  const floor = Math.max(1.5, baseSigma * 0.85) * noise;
  const topPos = Math.max(floor * 1.01, max);
  const topNeg = Math.max(floor * 1.01, -min);
  const lp = Math.log(topPos / floor);
  const ln = Math.log(topNeg / floor);
  const c = document.createElement("canvas");
  c.width = nx;
  c.height = ny;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(nx, ny);
  for (let k = 0; k < data.length; k++) {
    const val = data[k];
    const a = Math.abs(val);
    if (a <= floor) continue;
    const t = Math.min(1, Math.log(a / floor) / (val > 0 ? lp : ln));
    const [R, G, B] = rampAt(val > 0 ? g : v, 0.15 + 0.85 * t);
    img.data[k * 4] = R;
    img.data[k * 4 + 1] = G;
    img.data[k * 4 + 2] = B;
    img.data[k * 4 + 3] = Math.round(255 * Math.min(0.9, 0.18 + 0.75 * t));
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Linear-scaled heat image of a synthesised plane (negative values in violet). */
export function synthHeatImage(pl: Plane, maxAmp: number, dark: boolean): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const g = ramp("green", dark);
  const vi = ramp("violet", dark);
  const c = document.createElement("canvas");
  c.width = pl.nx;
  c.height = pl.ny;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(pl.nx, pl.ny);
  for (let k = 0; k < pl.data.length; k++) {
    const raw = pl.data[k] / maxAmp;
    const v = Math.abs(raw);
    if (v <= 0.004) continue;
    const tt = Math.min(1, Math.pow(v, 0.55));
    const [r, gg, b] = rampAt(raw > 0 ? g : vi, tt);
    img.data[k * 4] = r;
    img.data[k * 4 + 1] = gg;
    img.data[k * 4 + 2] = b;
    img.data[k * 4 + 3] = Math.round(255 * Math.min(dark ? 0.95 : 0.85, tt * 1.25));
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Strokes a contour ladder, darker and heavier towards the top level. */
export function strokeSets(
  ctx: CanvasRenderingContext2D,
  sets: ContourSet[],
  map: GridToPixel,
  name: "green" | "violet",
  dark: boolean,
  alpha: number,
  scale = 1,
) {
  const r = ramp(name, dark);
  sets.forEach((c, k) => {
    const f = sets.length > 1 ? k / (sets.length - 1) : 1;
    ctx.strokeStyle = rgbToCss(rampAt(r, dark ? 0.45 + 0.55 * f : 0.5 + 0.5 * f), alpha);
    ctx.lineWidth = (0.8 + 0.6 * f) * scale;
    ctx.lineJoin = "round";
    traceContour(ctx, c, map);
    ctx.stroke();
  });
}
