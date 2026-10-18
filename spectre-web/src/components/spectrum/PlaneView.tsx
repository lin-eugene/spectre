"use client";
// Generic 2D spectrum plane: either a real processed plane (contours at multiples of the
// noise, positive green / negative violet, optional soft heat map) or, without data, a plane
// synthesised from the peak list. On top: confidence-coloured peak markers, selective labels,
// crosshair selection, zoom & pan, hover tooltips and a cursor read-out (ppm, S/N).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CONFIDENCE } from "@/lib/contract";
import { readTokens, type Tokens } from "@/lib/viz/colors";
import { computeContours } from "@/lib/viz/contours";
import { realHeatImage, realMapper, strokeSets, synthHeatImage } from "@/lib/viz/paint";
import { noiseLevels, sampleAt, type RealPlane } from "@/lib/viz/real";
import { geometricLevels, synthPlane } from "@/lib/viz/synth";
import type { PlaneDatum } from "@/lib/viz/data";
import { prepareCanvas, useThemeVersion } from "./hooks";
import { Axes, Tooltip, type TooltipState } from "./parts";
import { styles } from "./styles";

export interface PlaneWindow {
  x0: number; // ppm at the left edge
  x1: number; // ppm at the right edge
  y0: number; // ppm at the top edge
  y1: number; // ppm at the bottom edge
}

export interface PlaneViewProps {
  data: PlaneDatum[];
  defaultWindow: PlaneWindow;
  minSpan: { x: number; y: number };
  linewidth: { x: number; y: number };
  xTitle: string;
  yTitle: string;
  xName: string;
  yName: string;
  xDecimals: number;
  yDecimals: number;
  selectedId: string | null;
  selectedResidue: number | null;
  highlightResidues: number[];
  onPick: (d: PlaneDatum) => void;
  onClear: () => void;
  onStep?: (dir: 1 | -1) => void;
  edgesOf?: (id: string) => string[];
  width: number;
  ariaLabel: string;
  emptyText?: string;
  /** real spectrum plane; when present it replaces the synthesised spectrum */
  real?: RealPlane | null;
  /** lowest contour as a multiple of the noise (real data) */
  baseSigma?: number;
  /** soft heat-map underlay */
  heat?: boolean;
  /** a newer plane is being fetched: keep the frame, dimmed */
  loading?: boolean;
  /** draw markers as rings (keeps real peak maxima visible) */
  ringMarkers?: boolean;
  children?: ReactNode;
}

const MARGIN = { left: 60, right: 14, top: 8, bottom: 50 };

function markerColor(d: PlaneDatum, t: Tokens): string {
  if (d.confidence === "none") return t.muted;
  return CONFIDENCE[d.confidence].color;
}

export function PlaneView(props: PlaneViewProps) {
  const {
    data,
    defaultWindow,
    minSpan,
    linewidth,
    xTitle,
    yTitle,
    xName,
    yName,
    xDecimals,
    yDecimals,
    selectedId,
    selectedResidue,
    highlightResidues,
    onPick,
    onClear,
    onStep,
    edgesOf,
    width,
    ariaLabel,
    emptyText,
    real,
    baseSigma = 5,
    heat = true,
    loading = false,
    ringMarkers = false,
    children,
  } = props;
  const size = Math.max(220, Math.min(600, width - MARGIN.left - MARGIN.right));
  const totalW = size + MARGIN.left + MARGIN.right;
  const totalH = size + MARGIN.top + MARGIN.bottom;

  const [win, setWin] = useState<PlaneWindow>(defaultWindow);
  const defaultKey = `${defaultWindow.x0}|${defaultWindow.x1}|${defaultWindow.y0}|${defaultWindow.y1}`;
  const [prevDefaultKey, setPrevDefaultKey] = useState(defaultKey);
  const rangeChanged = prevDefaultKey !== defaultKey;
  if (rangeChanged) {
    // new data range: reset the zoom (state adjusted during render, React's recommended pattern)
    setPrevDefaultKey(defaultKey);
    setWin(defaultWindow);
  }

  const baseRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  const focusRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const themeV = useThemeVersion();
  const [hover, setHover] = useState<PlaneDatum | null>(null);
  const [tip, setTip] = useState<TooltipState | null>(null);
  const [readout, setReadout] = useState<string | null>(null);
  const [interacted, setInteracted] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(readTokens(rootRef.current).dark), [themeV]);

  const toPx = useCallback((x: number) => ((x - win.x0) / (win.x1 - win.x0)) * size, [win, size]);
  const toPy = useCallback((y: number) => ((y - win.y0) / (win.y1 - win.y0)) * size, [win, size]);

  const maxAmp = useMemo(() => data.reduce((m, d) => Math.max(m, Math.abs(d.amp)), 0) || 1, [data]);

  // synthesised plane for the current window (only without real data)
  const synth = useMemo(() => {
    if (real) return null;
    const n = Math.max(120, Math.min(300, Math.round(size / 2)));
    const cellX = Math.abs(win.x1 - win.x0) / (n - 1);
    const cellY = Math.abs(win.y1 - win.y0) / (n - 1);
    // display linewidth: never narrower than a few px so peaks read as blobs at full view
    const pxX = Math.abs(win.x1 - win.x0) / size;
    const pxY = Math.abs(win.y1 - win.y0) / size;
    const minPx = Math.max(6, Math.min(12, size / 50));
    const fx = Math.max(linewidth.x, 2.4 * cellX, minPx * pxX);
    const fy = Math.max(linewidth.y, 2.4 * cellY, minPx * pxY);
    const peaks = data.map((d) => ({ x: d.x, y: d.y, amp: d.amp, fwhmX: fx, fwhmY: fy }));
    const plane = synthPlane(peaks, { from: win.x0, to: win.x1, n }, { from: win.y0, to: win.y1, n });
    return { plane, fwhmPx: Math.min(fx / pxX, fy / pxY) };
  }, [real, data, win, size, linewidth.x, linewidth.y]);

  const synthContours = useMemo(() => {
    if (!synth) return [];
    // fewer, wider-spaced levels while peaks are small on screen; the full ladder once zoomed
    const levels = synth.fwhmPx < 20 ? geometricLevels(maxAmp, 0.08, 1.8, 6) : geometricLevels(maxAmp, 0.05, 1.42, 10);
    return computeContours(synth.plane, levels);
  }, [synth, maxAmp]);

  // real data: contours depend only on the plane and the threshold, not on the zoom window
  const realContours = useMemo(() => {
    if (!real) return null;
    const pos = noiseLevels(real.plane.max, real.noise, baseSigma);
    const neg = noiseLevels(-real.plane.min, real.noise, baseSigma);
    return { pos: computeContours(real.plane, pos), neg: computeContours(real.plane, neg, true) };
  }, [real, baseSigma]);

  const heatImage = useMemo(() => {
    if (!heat) return null;
    if (real) return realHeatImage(real, baseSigma, dark);
    return synth ? synthHeatImage(synth.plane, maxAmp, dark) : null;
  }, [heat, real, synth, baseSigma, dark, maxAmp]);

  const selectedSet = useMemo(() => {
    const s = new Set<string>();
    for (const d of data) {
      if ((selectedId && (d.id === selectedId || d.root === selectedId)) || (selectedResidue != null && d.resi === selectedResidue)) s.add(d.id);
    }
    return s;
  }, [data, selectedId, selectedResidue]);
  const highlightSet = useMemo(() => new Set(highlightResidues), [highlightResidues]);

  // keep a newly selected peak in view (adjusted during render when the selection changes)
  const selKey = [...selectedSet].sort().join(",");
  const [prevSelKey, setPrevSelKey] = useState(selKey);
  if (prevSelKey !== selKey) {
    setPrevSelKey(selKey);
    const d = rangeChanged ? undefined : data.find((p) => selectedSet.has(p.id));
    if (d) {
      const inX = (d.x - win.x0) * (d.x - win.x1) <= 0;
      const inY = (d.y - win.y0) * (d.y - win.y1) <= 0;
      if (!inX || !inY) {
        const hx = (win.x1 - win.x0) / 2;
        const hy = (win.y1 - win.y0) / 2;
        setWin({ x0: d.x - hx, x1: d.x + hx, y0: d.y - hy, y1: d.y + hy });
      }
    }
  }

  // ---------------------------------------------------------------- base layer
  useEffect(() => {
    const ctx = prepareCanvas(baseRef.current, size, size);
    if (!ctx) return;
    const t = readTokens(rootRef.current);
    ctx.fillStyle = t.surface;
    ctx.fillRect(0, 0, size, size);
    if (real && realContours) {
      const sx = (real.x.to - real.x.from) / Math.max(1, real.plane.nx - 1);
      const sy = (real.y.to - real.y.from) / Math.max(1, real.plane.ny - 1);
      if (heatImage) {
        const x0 = toPx(real.x.from - sx / 2);
        const x1 = toPx(real.x.to + sx / 2);
        const y0 = toPy(real.y.from - sy / 2);
        const y1 = toPy(real.y.to + sy / 2);
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(heatImage, Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
        ctx.restore();
      }
      const map = realMapper(real, toPx, toPy);
      strokeSets(ctx, realContours.neg, map, "violet", t.dark, 0.9);
      strokeSets(ctx, realContours.pos, map, "green", t.dark, 0.92);
    } else if (synth) {
      const pl = synth.plane;
      if (heatImage) {
        const cellW = size / (pl.nx - 1);
        const cellH = size / (pl.ny - 1);
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(heatImage, -cellW / 2, -cellH / 2, size + cellW, size + cellH);
        ctx.restore();
      }
      const sx = size / Math.max(1, pl.nx - 1);
      const sy = size / Math.max(1, pl.ny - 1);
      strokeSets(ctx, synthContours, { x: (gx) => (gx - 0.5) * sx, y: (gy) => (gy - 0.5) * sy }, "green", t.dark, t.dark ? 0.9 : 0.85);
    }
    // selection crosshair under the markers
    for (const d of data) {
      if (!selectedSet.has(d.id)) continue;
      const X = toPx(d.x);
      const Y = toPy(d.y);
      ctx.save();
      ctx.strokeStyle = t.ink;
      ctx.globalAlpha = 0.32;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(X) + 0.5, 0);
      ctx.lineTo(Math.round(X) + 0.5, size);
      ctx.moveTo(0, Math.round(Y) + 0.5);
      ctx.lineTo(size, Math.round(Y) + 0.5);
      ctx.stroke();
      ctx.restore();
    }
    // markers (side chains first, then by confidence so 'very high' sits on top)
    const order = [...data].sort((a, b) => rank(a) - rank(b));
    const scale = size < 360 ? 0.8 : 1;
    for (const d of order) {
      const X = toPx(d.x);
      const Y = toPy(d.y);
      if (X < -10 || X > size + 10 || Y < -10 || Y > size + 10) continue;
      const sel = selectedSet.has(d.id);
      if (d.kind === "sidechain") {
        ctx.beginPath();
        ctx.arc(X, Y, 3.2, 0, Math.PI * 2);
        if (!ringMarkers) {
          ctx.fillStyle = t.surface;
          ctx.fill();
        }
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = t.muted;
        ctx.stroke();
        continue;
      }
      if (ringMarkers) {
        const r = (sel ? 7 : 5.5) * scale;
        ctx.beginPath();
        ctx.arc(X, Y, r, 0, Math.PI * 2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = t.surface;
        ctx.globalAlpha = 0.7;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.lineWidth = sel ? 2.6 : 2;
        ctx.strokeStyle = markerColor(d, t);
        ctx.stroke();
      } else {
        const r = (sel ? 5 : 3.5) * scale;
        ctx.beginPath();
        ctx.arc(X, Y, r + 2, 0, Math.PI * 2);
        ctx.fillStyle = t.surface;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = t.border;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(X, Y, r, 0, Math.PI * 2);
        ctx.fillStyle = markerColor(d, t);
        ctx.fill();
      }
      if (sel || (d.resi != null && highlightSet.has(d.resi))) {
        ctx.beginPath();
        ctx.arc(X, Y, (ringMarkers ? 10.5 : 8.5) * scale, 0, Math.PI * 2);
        ctx.lineWidth = sel ? 2 : 1.5;
        ctx.strokeStyle = t.ink;
        ctx.globalAlpha = sel ? 1 : 0.6;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    // labels: always for selection/highlights; for everything else once zoomed in
    const zoom = Math.abs(defaultWindow.x1 - defaultWindow.x0) / Math.abs(win.x1 - win.x0);
    const placed: [number, number, number, number][] = [];
    const markers = data.map((d) => [toPx(d.x), toPy(d.y)] as const);
    const fontPx = 11;
    ctx.font = `500 ${fontPx}px ${t.font}`;
    ctx.textBaseline = "middle";
    const prio = (d: PlaneDatum) => (selectedSet.has(d.id) ? 1e9 : 0) + (d.resi != null && highlightSet.has(d.resi) ? 1e8 : 0) + Math.abs(d.amp);
    const wants = [...data]
      .filter((d) => d.label && (selectedSet.has(d.id) || (d.resi != null && highlightSet.has(d.resi)) || zoom >= 1.7))
      .sort((a, b) => prio(b) - prio(a));
    const off = ringMarkers ? 10 : 8;
    for (const d of wants) {
      const X = toPx(d.x);
      const Y = toPy(d.y);
      if (X < 0 || X > size || Y < 0 || Y > size) continue;
      const sel = selectedSet.has(d.id);
      ctx.font = `${sel ? 650 : 500} ${fontPx}px ${t.font}`;
      const w = ctx.measureText(d.label).width;
      const h = fontPx + 2;
      const cands: [number, number][] = [
        [X + off, Y - off],
        [X + off, Y + off],
        [X - off - w, Y - off],
        [X - off - w, Y + off],
        [X - w / 2, Y - off - 6],
        [X - w / 2, Y + off + 6],
      ];
      let spot: [number, number] | null = null;
      for (const [lx, ly] of cands) {
        const box: [number, number, number, number] = [lx - 2, ly - h / 2, lx + w + 2, ly + h / 2];
        if (box[0] < 2 || box[2] > size - 2 || box[1] < 2 || box[3] > size - 2) continue;
        if (placed.some((b) => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) continue;
        if (!sel && markers.some(([mx, my]) => mx > box[0] - 4 && mx < box[2] + 4 && my > box[1] - 4 && my < box[3] + 4)) continue;
        spot = [lx, ly];
        placed.push(box);
        break;
      }
      if (!spot) continue;
      ctx.lineWidth = 3;
      ctx.strokeStyle = t.surface;
      ctx.lineJoin = "round";
      ctx.strokeText(d.label, spot[0], spot[1]);
      ctx.fillStyle = sel ? t.ink : t.ink2;
      ctx.fillText(d.label, spot[0], spot[1]);
    }
  }, [real, realContours, synth, synthContours, heatImage, data, size, selectedSet, highlightSet, toPx, toPy, win, defaultWindow, ringMarkers, themeV]);

  // ---------------------------------------------------------------- overlay (hover)
  useEffect(() => {
    const ctx = prepareCanvas(overRef.current, size, size);
    if (!ctx || !hover) return;
    const t = readTokens(rootRef.current);
    const X = toPx(hover.x);
    const Y = toPy(hover.y);
    if (edgesOf) {
      const partners = new Set(edgesOf(hover.id));
      ctx.lineWidth = 1.5;
      for (const d of data) {
        if (!partners.has(d.id)) continue;
        ctx.strokeStyle = t.ink2;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.moveTo(X, Y);
        ctx.lineTo(toPx(d.x), toPy(d.y));
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(toPx(d.x), toPy(d.y), 7, 0, Math.PI * 2);
        ctx.strokeStyle = t.ink2;
        ctx.stroke();
      }
    }
    ctx.beginPath();
    ctx.arc(X, Y, ringMarkers ? 11 : 8.5, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = t.ink;
    ctx.stroke();
  }, [hover, size, toPx, toPy, data, edgesOf, ringMarkers, themeV]);

  // ---------------------------------------------------------------- interaction
  const drag = useRef<{ x: number; y: number; win: PlaneWindow; moved: boolean } | null>(null);

  const nearest = useCallback(
    (mx: number, my: number): PlaneDatum | null => {
      let best: PlaneDatum | null = null;
      let bd = 15 * 15;
      for (const d of data) {
        const dx = toPx(d.x) - mx;
        const dy = toPy(d.y) - my;
        const dd = dx * dx + dy * dy;
        if (dd < bd) {
          bd = dd;
          best = d;
        }
      }
      return best;
    },
    [data, toPx, toPy],
  );

  const snr = useCallback(
    (x: number, y: number): number | null => {
      if (!real || !(real.noise > 0)) return null;
      const v = sampleAt(real, x, y);
      return v == null ? null : v / real.noise;
    },
    [real],
  );

  const showTip = useCallback(
    (d: PlaneDatum | null) => {
      if (!d) {
        setTip(null);
        return;
      }
      const t = readTokens(rootRef.current);
      const rows: [string, string][] = [
        [xName, `${d.x.toFixed(xDecimals)} ppm`],
        [yName, `${d.y.toFixed(yDecimals)} ppm`],
      ];
      const s = snr(d.x, d.y);
      if (s != null) rows.push(["S/N", s.toFixed(1)]);
      else if (!real) rows.push(["Intensity", `${Math.round((Math.abs(d.amp) / maxAmp) * 100)}% of max`]);
      if (d.kind !== "sidechain") rows.push(["Status", d.confidenceText]);
      for (const e of d.extra ?? []) rows.push(e);
      const px = MARGIN.left + toPx(d.x);
      const py = MARGIN.top + toPy(d.y);
      setTip({
        x: px,
        y: py,
        flip: px > totalW - 220,
        color: d.kind === "sidechain" ? undefined : markerColor(d, t),
        title: d.title,
        rows,
        foot: d.kind === "sidechain" ? undefined : "Click to select",
      });
    },
    [xName, yName, xDecimals, yDecimals, maxAmp, toPx, toPy, totalW, snr, real],
  );

  const clampWin = useCallback(
    (w: PlaneWindow): PlaneWindow => {
      const dX = defaultWindow.x1 - defaultWindow.x0;
      const dY = defaultWindow.y1 - defaultWindow.y0;
      let sx = w.x1 - w.x0;
      let sy = w.y1 - w.y0;
      const cx = (w.x0 + w.x1) / 2;
      const cy = (w.y0 + w.y1) / 2;
      const maxX = Math.abs(dX) * 1.6;
      const maxY = Math.abs(dY) * 1.6;
      if (Math.abs(sx) < minSpan.x) sx = Math.sign(dX) * minSpan.x;
      if (Math.abs(sy) < minSpan.y) sy = Math.sign(dY) * minSpan.y;
      if (Math.abs(sx) > maxX) sx = Math.sign(dX) * maxX;
      if (Math.abs(sy) > maxY) sy = Math.sign(dY) * maxY;
      return { x0: cx - sx / 2, x1: cx + sx / 2, y0: cy - sy / 2, y1: cy + sy / 2 };
    },
    [defaultWindow, minSpan.x, minSpan.y],
  );

  const zoomAt = useCallback(
    (factor: number, mx: number, my: number) => {
      setWin((w) => {
        const ax = w.x0 + (mx / size) * (w.x1 - w.x0);
        const ay = w.y0 + (my / size) * (w.y1 - w.y0);
        return clampWin({ x0: ax + (w.x0 - ax) * factor, x1: ax + (w.x1 - ax) * factor, y0: ay + (w.y0 - ay) * factor, y1: ay + (w.y1 - ay) * factor });
      });
      setInteracted(true);
    },
    [size, clampWin],
  );

  useEffect(() => {
    const el = focusRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const factor = Math.exp(Math.max(-0.5, Math.min(0.5, e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018))));
      zoomAt(factor, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const local = (e: React.PointerEvent | React.MouseEvent) => {
    const r = focusRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const [mx, my] = local(e);
    drag.current = { x: mx, y: my, win, moved: false };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const [mx, my] = local(e);
    const d = drag.current;
    if (d) {
      const dx = mx - d.x;
      const dy = my - d.y;
      if (!d.moved && Math.hypot(dx, dy) > 3) {
        d.moved = true;
        setDragging(true);
      }
      if (d.moved) {
        const w = d.win;
        const ox = (dx / size) * (w.x1 - w.x0);
        const oy = (dy / size) * (w.y1 - w.y0);
        setWin({ x0: w.x0 - ox, x1: w.x1 - ox, y0: w.y0 - oy, y1: w.y1 - oy });
        setHover(null);
        setTip(null);
        setInteracted(true);
        return;
      }
    }
    const n = nearest(mx, my);
    setHover(n);
    showTip(n);
    if (!n && real) {
      const x = win.x0 + (mx / size) * (win.x1 - win.x0);
      const y = win.y0 + (my / size) * (win.y1 - win.y0);
      const s = snr(x, y);
      setReadout(`${xName} ${x.toFixed(xDecimals)} · ${yName} ${y.toFixed(yDecimals)}${s != null ? ` · S/N ${s.toFixed(1)}` : ""}`);
    } else setReadout(null);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (d && !d.moved) {
      const [mx, my] = local(e);
      const n = nearest(mx, my);
      if (n && n.kind !== "sidechain") onPick(n);
    }
  };
  const onLeave = () => {
    if (!drag.current) {
      setHover(null);
      setTip(null);
      setReadout(null);
    }
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      onStep?.(1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      onStep?.(-1);
    } else if (e.key === "+" || e.key === "=") zoomAt(0.75, size / 2, size / 2);
    else if (e.key === "-" || e.key === "_") zoomAt(1 / 0.75, size / 2, size / 2);
    else if (e.key === "0") setWin(defaultWindow);
    else if (e.key === "Escape") onClear();
  };

  const zoomed = Math.abs(win.x1 - win.x0) < Math.abs(defaultWindow.x1 - defaultWindow.x0) * 0.98;
  const hasContent = data.length > 0 || !!real;
  const hintText = loading ? "Loading plane…" : (readout ?? (zoomed ? "Double-click to reset zoom" : "Scroll to zoom · drag to pan"));
  const hintVisible = loading || !!readout || (hover && !interacted) || zoomed;

  return (
    <figure className={styles.figure}>
      <div ref={rootRef} className={styles.plotWrap} style={{ width: totalW, height: totalH }}>
        <div
          ref={focusRef}
          className={styles.plotFocus}
          style={{ left: MARGIN.left, top: MARGIN.top, width: size, height: size, cursor: dragging ? "grabbing" : hover ? "pointer" : "crosshair" }}
          tabIndex={0}
          role="img"
          aria-label={`${ariaLabel}. Use arrow keys to step through residues, plus and minus to zoom, 0 to reset, Escape to clear the selection.`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onLeave}
          onDoubleClick={() => setWin(defaultWindow)}
          onKeyDown={onKeyDown}
        >
          <canvas ref={baseRef} className={styles.canvas} style={{ opacity: loading ? 0.45 : 1, transition: "opacity 160ms ease" }} />
          <canvas ref={overRef} className={styles.canvas} />
          {!hasContent && <div className={styles.empty}>{emptyText ?? "No peaks"}</div>}
          {hasContent && (
            <div className={styles.hint} style={{ opacity: hintVisible ? 1 : 0, fontVariantNumeric: "tabular-nums" }}>
              {hintText}
            </div>
          )}
        </div>
        <Axes
          total={{ width: totalW, height: totalH }}
          plot={{ left: MARGIN.left, top: MARGIN.top, width: size, height: size }}
          x={{ from: win.x0, to: win.x1, title: xTitle }}
          y={{ from: win.y0, to: win.y1, title: yTitle }}
        />
        <Tooltip t={tip} />
      </div>
      {children}
    </figure>
  );
}

function rank(d: PlaneDatum): number {
  if (d.kind === "sidechain") return 0;
  switch (d.confidence) {
    case "unassigned":
      return 1;
    case "none":
      return 1;
    case "low":
      return 2;
    case "high":
      return 3;
    case "veryHigh":
      return 4;
    default:
      return 1;
  }
}
