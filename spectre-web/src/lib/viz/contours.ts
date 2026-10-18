// Contour extraction (d3-contour marching squares) and canvas drawing helpers.
import { contours as d3contours } from "d3-contour";
import type { Plane } from "./synth";

export interface ContourSet {
  value: number;
  /** MultiPolygon in grid coordinates: sample k sits at k + 0.5 */
  coordinates: number[][][][];
}

export function computeContours(plane: Plane, levels: number[], negative = false): ContourSet[] {
  if (!levels.length) return [];
  const values = negative ? Array.from(plane.data, (v) => -v) : (plane.data as unknown as number[]);
  const gen = d3contours().size([plane.nx, plane.ny]).thresholds(levels).smooth(true);
  return gen(values as number[]).map((g) => ({ value: g.value, coordinates: g.coordinates as number[][][][] }));
}

/** Maps a grid coordinate (sample index + 0.5) to canvas pixels for a plane drawn into `rect`. */
export interface GridToPixel {
  x: (gx: number) => number;
  y: (gy: number) => number;
}

export function gridMapper(plane: Plane, left: number, top: number, width: number, height: number): GridToPixel {
  const sx = width / Math.max(1, plane.nx - 1);
  const sy = height / Math.max(1, plane.ny - 1);
  return { x: (gx) => left + (gx - 0.5) * sx, y: (gy) => top + (gy - 0.5) * sy };
}

export function traceContour(ctx: CanvasRenderingContext2D, set: ContourSet, map: GridToPixel): void {
  ctx.beginPath();
  for (const polygon of set.coordinates) {
    for (const ring of polygon) {
      for (let i = 0; i < ring.length; i++) {
        const [gx, gy] = ring[i];
        const px = map.x(gx);
        const py = map.y(gy);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    }
  }
}
