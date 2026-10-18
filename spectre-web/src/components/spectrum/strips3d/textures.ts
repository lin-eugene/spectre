// 2D canvases used as textures in the 3D cube: the ¹H–¹⁵N floor (measured HSQC or a plane
// synthesised from the peak list) and the slice plane (a measured slice of the 3D spectrum
// or a slice through a spectrum synthesised from its peak list).
import { computeContours } from "@/lib/viz/contours";
import { realHeatImage, realMapper, strokeSets, synthHeatImage } from "@/lib/viz/paint";
import { noiseLevels, type RealPlane } from "@/lib/viz/real";
import { geometricLevels, synthPlane } from "@/lib/viz/synth";
import type { SynthPeak2D } from "@/lib/viz/cube";

/** ppm at the canvas edges: x0 left, x1 right, y0 top, y1 bottom */
export interface PpmRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface TextureStyle {
  width: number;
  height: number;
  rect: PpmRect;
  dark: boolean;
  /** background fill; null keeps the canvas transparent */
  base: string | null;
  grid?: { xs: number[]; ys: number[]; color: string } | null;
  heatAlpha: number;
  contourAlpha: number;
  /** canvas px per screen px, so contour strokes stay hairline-thin on screen */
  lineScale: number;
}

export interface RealSource {
  plane: RealPlane;
  sigma: number;
  /** added to the plane's ppm before drawing (re-referencing onto the cube's scale) */
  shift?: { x: number; y: number };
}

export interface SynthSource {
  peaks: SynthPeak2D[];
  fwhm: { x: number; y: number };
  /** amplitude the contour ladder is built on (the spectrum's strong peaks) */
  scale: number;
}

function drawStretched(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, x0: number, y0: number, x1: number, y1: number, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // a negative scale flips the image when the plane's axis runs the other way
  ctx.translate(x0, y0);
  ctx.scale((x1 - x0) / img.width, (y1 - y0) / img.height);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

export function paintTexture(st: TextureStyle, src: { real?: RealSource | null; synth?: SynthSource | null }): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const { width: W, height: H, rect } = st;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const toPx = (x: number) => ((x - rect.x0) / (rect.x1 - rect.x0)) * W;
  const toPy = (y: number) => ((y - rect.y0) / (rect.y1 - rect.y0)) * H;
  if (st.base) {
    ctx.fillStyle = st.base;
    ctx.fillRect(0, 0, W, H);
  }
  if (st.grid) {
    ctx.strokeStyle = st.grid.color;
    ctx.lineWidth = Math.max(1, st.lineScale);
    ctx.beginPath();
    for (const x of st.grid.xs) {
      const X = toPx(x);
      ctx.moveTo(X, 0);
      ctx.lineTo(X, H);
    }
    for (const y of st.grid.ys) {
      const Y = toPy(y);
      ctx.moveTo(0, Y);
      ctx.lineTo(W, Y);
    }
    ctx.stroke();
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.clip();
  if (src.real) {
    const r = src.real.plane;
    const sx = src.real.shift?.x ?? 0;
    const sy = src.real.shift?.y ?? 0;
    const px = (x: number) => toPx(x + sx);
    const py = (y: number) => toPy(y + sy);
    if (st.heatAlpha > 0) {
      const heat = realHeatImage(r, src.real.sigma, st.dark);
      if (heat) {
        const hx = (r.x.to - r.x.from) / Math.max(1, r.plane.nx - 1) / 2;
        const hy = (r.y.to - r.y.from) / Math.max(1, r.plane.ny - 1) / 2;
        drawStretched(ctx, heat, px(r.x.from - hx), py(r.y.from - hy), px(r.x.to + hx), py(r.y.to + hy), st.heatAlpha);
      }
    }
    const map = realMapper(r, px, py);
    const pos = computeContours(r.plane, noiseLevels(r.plane.max, r.noise, src.real.sigma));
    const neg = computeContours(r.plane, noiseLevels(-r.plane.min, r.noise, src.real.sigma), true);
    strokeSets(ctx, neg, map, "violet", st.dark, st.contourAlpha, st.lineScale);
    strokeSets(ctx, pos, map, "green", st.dark, st.contourAlpha, st.lineScale);
  } else if (src.synth && src.synth.peaks.length) {
    const nx = Math.max(160, Math.min(480, Math.round(W / 4)));
    const ny = Math.max(160, Math.min(480, Math.round(H / 4)));
    const { fwhm } = src.synth;
    const plane = synthPlane(
      src.synth.peaks.map((p) => ({ ...p, fwhmX: fwhm.x, fwhmY: fwhm.y })),
      { from: rect.x0, to: rect.x1, n: nx },
      { from: rect.y0, to: rect.y1, n: ny },
    );
    const cellW = W / (nx - 1);
    const cellH = H / (ny - 1);
    if (st.heatAlpha > 0) {
      const heat = synthHeatImage(plane, src.synth.scale, st.dark);
      if (heat) drawStretched(ctx, heat, -cellW / 2, -cellH / 2, W + cellW / 2, H + cellH / 2, st.heatAlpha);
    }
    const levels = geometricLevels(src.synth.scale, 0.07, 1.5, 9);
    const map = { x: (gx: number) => (gx - 0.5) * cellW, y: (gy: number) => (gy - 0.5) * cellH };
    if (plane.min < 0) strokeSets(ctx, computeContours(plane, levels, true), map, "violet", st.dark, st.contourAlpha, st.lineScale);
    strokeSets(ctx, computeContours(plane, levels), map, "green", st.dark, st.contourAlpha, st.lineScale);
  }
  ctx.restore();
  return canvas;
}
