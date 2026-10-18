"use client";
// Interactive processing of the bundled raw Bruker 1H FIDs: Fourier transform, phasing
// (TopSpin-stored, automatic, manual), baseline, peak picking and region deconvolution.
// Processing runs client-side with src/lib/bruker (validated against TopSpin output).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deconvolve1D,
  finishSpectrum,
  pickPeaks1D,
  prepareBruker,
  type DeconResult,
  type Peak1D,
  type PreparedSpectrum,
  type Processed1D,
} from "@/lib/bruker";
import { autophase } from "@/lib/bruker/analysis";
import { base64ToBytes, compact, minMaxColumns, niceTicks, tickDecimals } from "@/lib/bruker/plotutils";

export interface Bruker1DViewProps {
  experiment: string | null;
  onExperimentChange: (exp: string) => void;
  height?: number;
  /** optional deep-link state (applied once when the first spectrum is ready) */
  initialRange?: [number, number];
  initialFitRegion?: [number, number];
  initialCompare?: string[];
  initialPhase?: "procs" | "auto" | "manual";
  initialStacked?: boolean;
}

interface ExpInfo {
  id: string;
  title: string;
}
interface RawExp {
  id: string;
  title: string;
  acqus: string;
  procs: string;
  fid: string;
}

type PhaseMode = "procs" | "auto" | "manual";
type DragMode = "zoom" | "fit";
interface ViewBox {
  x0: number; // left ppm (higher)
  x1: number; // right ppm (lower)
  y0: number; // bottom intensity
  y1: number; // top intensity
}

// ------------------------------------------------------------------ module caches
let listPromise: Promise<ExpInfo[]> | null = null;
const rawCache = new Map<string, Promise<RawExp>>();
const prepCache = new Map<string, PreparedSpectrum>();
const autoCache = new Map<string, { ph0: number; ph1: number }>();

function fetchList(): Promise<ExpInfo[]> {
  listPromise ??= fetch("/api/bruker")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`list ${r.status}`))))
    .then((d: { experiments: ExpInfo[] }) => d.experiments)
    .catch((e) => {
      listPromise = null;
      throw e;
    });
  return listPromise;
}

function fetchRaw(id: string): Promise<RawExp> {
  let p = rawCache.get(id);
  if (!p) {
    p = fetch(`/api/bruker/${encodeURIComponent(id)}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${id}: ${r.status}`))));
    p.catch(() => rawCache.delete(id));
    rawCache.set(id, p);
  }
  return p;
}

async function getPrepared(id: string, lb: number): Promise<PreparedSpectrum> {
  const key = `${id}|${lb}`;
  const hit = prepCache.get(key);
  if (hit) return hit;
  const raw = await fetchRaw(id);
  // yield so the "processing" state paints before the FFT runs
  await new Promise((r) => setTimeout(r, 0));
  const prep = prepareBruker({ acqus: raw.acqus, procs: raw.procs, title: raw.title, fid: base64ToBytes(raw.fid) }, { lb });
  if (prepCache.size > 24) prepCache.delete(prepCache.keys().next().value!);
  prepCache.set(key, prep);
  return prep;
}

function autoPhaseFor(id: string, lb: number, prep: PreparedSpectrum) {
  const key = `${id}|${lb}`;
  let hit = autoCache.get(key);
  if (!hit) {
    hit = autophase(prep.re, prep.im);
    autoCache.set(key, hit);
  }
  return hit;
}

// ------------------------------------------------------------------ colours (dataviz reference palette)
const STYLE = `
.b1d-root {
  color-scheme: light;
  --b1d-surface: #fcfcfb;
  --b1d-plane: #f9f9f7;
  --b1d-ink: #0b0b0b;
  --b1d-ink-2: #52514e;
  --b1d-muted: #898781;
  --b1d-grid: #e1e0d9;
  --b1d-axis: #c3c2b7;
  --b1d-border: rgba(11,11,11,0.10);
  --b1d-s1: #2a78d6;
  --b1d-s2: #eb6834;
  --b1d-s3: #1baf7a;
  --b1d-wash: rgba(235,104,52,0.10);
  --b1d-sel: rgba(42,120,214,0.10);
  --b1d-chip: #f0efec;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) .b1d-root {
    color-scheme: dark;
    --b1d-surface: #1a1a19; --b1d-plane: #0d0d0d; --b1d-ink: #f0efec; --b1d-ink-2: #c3c2b7; --b1d-muted: #898781;
    --b1d-grid: #2c2c2a; --b1d-axis: #383835; --b1d-border: rgba(255,255,255,0.10);
    --b1d-s1: #3987e5; --b1d-s2: #d95926; --b1d-s3: #199e70; --b1d-wash: rgba(217,89,38,0.14); --b1d-sel: rgba(57,135,229,0.16); --b1d-chip: #262624;
  }
}
:root[data-theme="dark"] .b1d-root {
  color-scheme: dark;
  --b1d-surface: #1a1a19; --b1d-plane: #0d0d0d; --b1d-ink: #f0efec; --b1d-ink-2: #c3c2b7; --b1d-muted: #898781;
  --b1d-grid: #2c2c2a; --b1d-axis: #383835; --b1d-border: rgba(255,255,255,0.10);
  --b1d-s1: #3987e5; --b1d-s2: #d95926; --b1d-s3: #199e70; --b1d-wash: rgba(217,89,38,0.14); --b1d-sel: rgba(57,135,229,0.16); --b1d-chip: #262624;
}
.b1d-root { font: 12px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--b1d-ink); background: var(--b1d-surface);
  display: flex; flex-direction: column; gap: 6px; min-width: 0; box-sizing: border-box; }
.b1d-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; min-width: 0; }
.b1d-label { color: var(--b1d-muted); font-size: 11px; }
.b1d-select, .b1d-num { font: inherit; color: var(--b1d-ink); background: var(--b1d-surface); border: 1px solid var(--b1d-border);
  border-radius: 6px; padding: 3px 6px; min-width: 0; }
.b1d-select { max-width: 100%; }
.b1d-num { width: 4.2em; font-variant-numeric: tabular-nums; }
.b1d-seg { display: inline-flex; border: 1px solid var(--b1d-border); border-radius: 7px; overflow: hidden; }
.b1d-seg button { font: inherit; border: 0; background: transparent; color: var(--b1d-ink-2); padding: 3px 8px; cursor: pointer; }
.b1d-seg button[aria-pressed="true"] { background: var(--b1d-chip); color: var(--b1d-ink); font-weight: 600; }
.b1d-btn { font: inherit; border: 1px solid var(--b1d-border); background: transparent; color: var(--b1d-ink-2); border-radius: 6px;
  padding: 3px 8px; cursor: pointer; }
.b1d-btn:hover, .b1d-seg button:hover { color: var(--b1d-ink); }
.b1d-chip { display: inline-flex; align-items: center; gap: 5px; background: var(--b1d-chip); border-radius: 999px; padding: 2px 4px 2px 8px; }
.b1d-chip button { border: 0; background: transparent; color: var(--b1d-muted); cursor: pointer; font: inherit; padding: 0 4px; }
.b1d-key { display: inline-block; width: 14px; height: 2px; border-radius: 1px; vertical-align: middle; }
.b1d-plot { position: relative; flex: 1 1 auto; min-height: 120px; border-radius: 8px; background: var(--b1d-surface); }
.b1d-plot canvas { position: absolute; inset: 0; width: 100%; height: 100%; outline: none; cursor: crosshair; touch-action: none; }
.b1d-plot canvas:focus-visible { box-shadow: 0 0 0 2px var(--b1d-sel); border-radius: 8px; }
.b1d-tip { position: absolute; pointer-events: none; background: var(--b1d-surface); border: 1px solid var(--b1d-border); border-radius: 8px;
  padding: 6px 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.12); white-space: nowrap; font-variant-numeric: tabular-nums; z-index: 2; }
.b1d-tip b { font-weight: 650; }
.b1d-busy { position: absolute; top: 8px; right: 10px; color: var(--b1d-muted); font-size: 11px; }
.b1d-foot { display: flex; flex-wrap: wrap; gap: 4px 12px; color: var(--b1d-ink-2); font-variant-numeric: tabular-nums; font-size: 11px; align-items: center; }
.b1d-foot .b1d-sp { flex: 1; }
.b1d-foot .b1d-btn { padding: 2px 7px; }
.b1d-table { max-height: 132px; overflow: auto; border: 1px solid var(--b1d-border); border-radius: 8px; }
.b1d-table table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
.b1d-table th, .b1d-table td { text-align: right; padding: 3px 8px; border-bottom: 1px solid var(--b1d-grid); }
.b1d-table th { position: sticky; top: 0; background: var(--b1d-surface); color: var(--b1d-muted); font-weight: 600; }
.b1d-range { width: 92px; accent-color: var(--b1d-s1); }
.b1d-err { color: #d03b3b; }
`;

function cssVar(el: Element, name: string, fallback: string) {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

// ------------------------------------------------------------------ component
export default function Bruker1DView({
  experiment,
  onExperimentChange,
  height = 520,
  initialRange,
  initialFitRegion,
  initialCompare,
  initialPhase,
  initialStacked,
}: Bruker1DViewProps) {
  const [list, setList] = useState<ExpInfo[]>([]);
  const [listLoaded, setListLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lb, setLb] = useState(0.3);
  const [lbInput, setLbInput] = useState("0.3");
  const [phaseMode, setPhaseMode] = useState<PhaseMode>(initialPhase ?? "procs");
  const [manual, setManual] = useState({ ph0: 0, ph1: 0 });
  const [baseline, setBaseline] = useState(true);
  const [snr, setSnr] = useState(25);
  const [compare, setCompare] = useState<string[]>((initialCompare ?? []).slice(0, 2));
  const [stacked, setStacked] = useState(!!initialStacked);
  const [dragMode, setDragMode] = useState<DragMode>("zoom");
  const [view, setView] = useState<ViewBox | null>(null);
  const [table, setTable] = useState<"peaks" | "fit" | null>(initialFitRegion ? "fit" : null);
  const [main, setMain] = useState<{ key: string; id: string; prep: PreparedSpectrum; spec: Processed1D; ms: number } | null>(null);
  const [others, setOthers] = useState<{ id: string; spec: Processed1D }[]>([]);
  const [fit, setFit] = useState<{ exp: string; result: DeconResult } | null>(null);
  const [fitTouched, setFitTouched] = useState(false);
  const [viewTouched, setViewTouched] = useState(false);
  const exp = experiment ?? list[0]?.id ?? null;
  const procKey = JSON.stringify([exp, lb, phaseMode, phaseMode === "manual" ? manual : null, baseline]);
  const busy = !!exp && !error && main?.key !== procKey;

  useEffect(() => {
    fetchList()
      .then((l) => {
        setList(l);
        setListLoaded(true);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  // process the selected experiment
  useEffect(() => {
    if (!exp) return;
    let alive = true;
    const t0 = performance.now();
    getPrepared(exp, lb)
      .then((prep) => {
        if (!alive) return;
        const phase = phaseMode === "manual" ? manual : phaseMode === "auto" ? autoPhaseFor(exp, lb, prep) : (prep.procsPhase ?? autoPhaseFor(exp, lb, prep));
        const spec = finishSpectrum(prep, { phase, baseline: baseline ? "poly" : "none", skipPeaks: true });
        setMain({ key: procKey, id: exp, prep, spec, ms: performance.now() - t0 });
        setError(null);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [exp, lb, phaseMode, manual, baseline, procKey]);

  // overlays: processed with their stored phases
  useEffect(() => {
    let alive = true;
    Promise.all(
      compare.map(async (id) => {
        const prep = await getPrepared(id, lb);
        const phase = prep.procsPhase ?? autoPhaseFor(id, lb, prep);
        return { id, spec: finishSpectrum(prep, { phase, baseline: baseline ? "poly" : "none", skipPeaks: true }) };
      }),
    )
      .then((o) => alive && setOthers(o))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [compare, lb, baseline]);

  const peaks: Peak1D[] = useMemo(() => (main ? pickPeaks1D(main.spec, { threshold: snr }) : []), [main, snr]);

  // deep-link state is derived (until the user takes over), never pushed from an effect
  const initialSpec = main && main.id === (experiment ?? main.id) ? main.spec : null;
  const initView = useMemo<ViewBox | null>(() => {
    if (!initialRange || !initialSpec) return null;
    const hi = Math.max(...initialRange);
    const lo = Math.min(...initialRange);
    const [y0, y1] = yRange(initialSpec, hi, lo, [], false);
    return { x0: hi, x1: lo, y0, y1 };
  }, [initialRange, initialSpec]);
  const initFit = useMemo<DeconResult | null>(() => {
    if (!initialFitRegion || !initialSpec) return null;
    try {
      return deconvolve1D(initialSpec, initialFitRegion, { maxComponents: 12, threshold: 8 });
    } catch {
      return null;
    }
  }, [initialFitRegion, initialSpec]);
  const decon: DeconResult | null = fit && fit.exp === exp ? fit.result : !fitTouched ? initFit : null;
  const setDecon = useCallback(
    (d: DeconResult | null) => {
      setFitTouched(true);
      setFit(d && exp ? { exp, result: d } : null);
    },
    [exp],
  );

  const shownOthers = useMemo(() => (decon ? [] : others.filter((o) => compare.includes(o.id))), [decon, others, compare]);

  // default view: signal region with margins
  const autoView = useMemo<ViewBox | null>(() => {
    if (!main) return null;
    const s = main.spec;
    const sig = peaks.length ? peaks : pickPeaks1D(s, { threshold: 50 });
    const hi = Math.min(s.ppm[0], (sig.length ? Math.max(...sig.map((p) => p.ppm)) : 12) + 0.6);
    const lo = Math.max(s.ppm[s.ppm.length - 1], (sig.length ? Math.min(...sig.map((p) => p.ppm)) : -0.5) - 0.6);
    const [y0, y1] = yRange(s, hi, lo, shownOthers, stacked);
    return { x0: hi, x1: lo, y0, y1 };
  }, [main, peaks, shownOthers, stacked]);
  const vb = view ?? (!viewTouched ? initView : null) ?? autoView;
  const resetView = () => {
    setView(null);
    setViewTouched(true);
  };

  // ------------------------------------------------------------------ drawing
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 560, h: 300 });
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const [drag, setDrag] = useState<{ x0: number; x1: number; y0: number; y1: number } | null>(null);
  const [themeTick, setThemeTick] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const bump = () => setThemeTick((t) => t + 1);
    mq.addEventListener("change", bump);
    const mo = new MutationObserver(bump);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", bump);
      mo.disconnect();
    };
  }, []);

  const M = { l: 50, r: 12, t: 30, b: 34 };
  const plotW = Math.max(10, size.w - M.l - M.r);
  const plotH = Math.max(10, size.h - M.t - M.b);
  const xOf = useCallback((ppm: number) => (vb ? M.l + ((vb.x0 - ppm) / (vb.x0 - vb.x1)) * plotW : 0), [vb, plotW, M.l]);
  const yOf = useCallback((v: number) => (vb ? M.t + (1 - (v - vb.y0) / (vb.y1 - vb.y0)) * plotH : 0), [vb, plotH, M.t]);
  const ppmAt = useCallback((x: number) => (vb ? vb.x0 - ((x - M.l) / plotW) * (vb.x0 - vb.x1) : 0), [vb, plotW, M.l]);
  const valAt = useCallback((y: number) => (vb ? vb.y0 + (1 - (y - M.t) / plotH) * (vb.y1 - vb.y0) : 0), [vb, plotH, M.t]);

  const stackOffset = useCallback((k: number) => (stacked && vb ? k * 0.22 * (vb.y1 - vb.y0) : 0), [stacked, vb]);

  useEffect(() => {
    const cv = canvasRef.current;
    const root = rootRef.current;
    if (!cv || !root || !main || !vb) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(size.w * dpr);
    cv.height = Math.round(size.h * dpr);
    const g = cv.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const col = {
      surface: cssVar(root, "--b1d-surface", "#fcfcfb"),
      ink2: cssVar(root, "--b1d-ink-2", "#52514e"),
      muted: cssVar(root, "--b1d-muted", "#898781"),
      grid: cssVar(root, "--b1d-grid", "#e1e0d9"),
      axis: cssVar(root, "--b1d-axis", "#c3c2b7"),
      s: [cssVar(root, "--b1d-s1", "#2a78d6"), cssVar(root, "--b1d-s2", "#eb6834"), cssVar(root, "--b1d-s3", "#1baf7a")],
      wash: cssVar(root, "--b1d-wash", "rgba(235,104,52,0.1)"),
      sel: cssVar(root, "--b1d-sel", "rgba(42,120,214,0.1)"),
    };
    g.clearRect(0, 0, size.w, size.h);
    g.fillStyle = col.surface;
    g.fillRect(0, 0, size.w, size.h);
    const font = "11px system-ui, -apple-system, 'Segoe UI', sans-serif";
    g.font = font;

    // grid + axes
    const xt = niceTicks(vb.x0, vb.x1, Math.max(3, Math.floor(plotW / 70)));
    const xd = tickDecimals(xt);
    const yt = niceTicks(vb.y0, vb.y1, Math.max(2, Math.floor(plotH / 55)));
    g.lineWidth = 1;
    g.strokeStyle = col.grid;
    g.beginPath();
    for (const t of yt) {
      const y = Math.round(yOf(t)) + 0.5;
      g.moveTo(M.l, y);
      g.lineTo(M.l + plotW, y);
    }
    g.stroke();
    g.fillStyle = col.muted;
    g.textAlign = "right";
    g.textBaseline = "middle";
    for (const t of yt) g.fillText(compact(t), M.l - 6, yOf(t));
    g.strokeStyle = col.axis;
    g.beginPath();
    g.moveTo(M.l, M.t + plotH + 0.5);
    g.lineTo(M.l + plotW, M.t + plotH + 0.5);
    g.stroke();
    g.textAlign = "center";
    g.textBaseline = "top";
    g.beginPath();
    for (const t of xt) {
      const x = Math.round(xOf(t)) + 0.5;
      g.moveTo(x, M.t + plotH);
      g.lineTo(x, M.t + plotH + 4);
      g.fillText(fmtPpm(t, xd), x, M.t + plotH + 6);
    }
    g.stroke();
    g.fillStyle = col.ink2;
    g.textAlign = "right";
    g.fillText(`δ ${main.spec.nucleus.replace(/^(\d+)/, (d) => superscript(d))} (ppm)`, M.l + plotW, M.t + plotH + 20);

    g.save();
    g.beginPath();
    g.rect(M.l, M.t - 2, plotW, plotH + 2);
    g.clip();

    const drawTrace = (s: Processed1D, color: string, offset = 0, width = 1.5) => {
      const step = s.ppm[1] - s.ppm[0];
      const i0 = Math.max(0, Math.floor((vb.x0 - s.ppm[0]) / step) - 1);
      const i1 = Math.min(s.ppm.length - 1, Math.ceil((vb.x1 - s.ppm[0]) / step) + 1);
      if (i1 <= i0) return;
      const n = i1 - i0 + 1;
      g.strokeStyle = color;
      g.lineWidth = width;
      g.lineJoin = "round";
      g.lineCap = "round";
      g.beginPath();
      if (n <= plotW * 2) {
        for (let i = i0; i <= i1; i++) {
          const x = xOf(s.ppm[i]);
          const y = yOf(s.re[i] + offset);
          if (i === i0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
      } else {
        const xa = xOf(s.ppm[i0]);
        const xb = xOf(s.ppm[i1]);
        const cols = Math.max(1, Math.round(xb - xa));
        const mm = minMaxColumns(s.re, i0, i1, cols);
        for (let c = 0; c < cols; c++) {
          const x = xa + c + 0.5;
          const ya = yOf(mm[2 * c] + offset);
          const yb = yOf(mm[2 * c + 1] + offset);
          if (c === 0) g.moveTo(x, ya);
          else g.lineTo(x, ya);
          g.lineTo(x, yb);
        }
      }
      g.stroke();
    };

    // overlays first (behind), then the main trace
    shownOthers.forEach((o, k) => drawTrace(o.spec, col.s[(k + 1) % 3], stackOffset(k + 1), 1.25));
    drawTrace(main.spec, col.s[0]);

    // deconvolution
    if (decon) {
      const xs = decon.ppm.map(xOf);
      // components: orange wash + line
      for (const c of decon.components) {
        g.beginPath();
        const base = yOf(0);
        decon.ppm.forEach((p, k) => {
          const hzFromCentre = ((p - c.ppm) * main.spec.sf) / (c.widthHz / 2);
          const v = c.amplitude * (c.eta / (1 + hzFromCentre ** 2) + (1 - c.eta) * Math.exp(-Math.LN2 * hzFromCentre ** 2));
          const x = xs[k];
          const y = yOf(v);
          if (k === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        });
        g.lineTo(xs[xs.length - 1], base);
        g.lineTo(xs[0], base);
        g.closePath();
        g.fillStyle = col.wash;
        g.fill();
        g.beginPath();
        decon.ppm.forEach((p, k) => {
          const u = ((p - c.ppm) * main.spec.sf) / (c.widthHz / 2);
          const v = c.amplitude * (c.eta / (1 + u * u) + (1 - c.eta) * Math.exp(-Math.LN2 * u * u));
          if (k === 0) g.moveTo(xs[k], yOf(v));
          else g.lineTo(xs[k], yOf(v));
        });
        g.strokeStyle = col.s[1];
        g.lineWidth = 1;
        g.stroke();
      }
      // total fit
      g.beginPath();
      decon.fit.forEach((v, k) => (k === 0 ? g.moveTo(xs[k], yOf(v)) : g.lineTo(xs[k], yOf(v))));
      g.strokeStyle = col.s[2];
      g.lineWidth = 1.5;
      g.stroke();
      // residual, drawn just under the baseline
      const rOff = vb.y0 + 0.06 * (vb.y1 - vb.y0);
      g.beginPath();
      decon.residual.forEach((v, k) => (k === 0 ? g.moveTo(xs[k], yOf(rOff + v)) : g.lineTo(xs[k], yOf(rOff + v))));
      g.strokeStyle = col.muted;
      g.lineWidth = 1;
      g.stroke();
    }

    // peak ticks (all in view) and selective labels (tallest that fit)
    const inView = peaks.filter((p) => p.ppm <= vb.x0 && p.ppm >= vb.x1);
    g.strokeStyle = col.muted;
    g.lineWidth = 1;
    g.beginPath();
    for (const p of inView) {
      const x = Math.round(xOf(p.ppm)) + 0.5;
      const y = yOf(p.height);
      const top = Math.max(M.t + 2, y - 10);
      g.moveTo(x, top);
      g.lineTo(x, Math.max(M.t + 2, y - 4));
    }
    g.stroke();
    g.restore();

    const placed: [number, number][] = [];
    g.fillStyle = col.ink2;
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    const labelDec = vb.x0 - vb.x1 < 0.5 ? 4 : vb.x0 - vb.x1 < 3 ? 3 : 2;
    for (const p of [...inView].sort((a, b) => b.height - a.height)) {
      if (placed.length >= 10) break;
      const text = fmtPpm(p.ppm, labelDec);
      const w = g.measureText(text).width + 6;
      const x = xOf(p.ppm);
      if (x - w / 2 < M.l || x + w / 2 > M.l + plotW) continue;
      if (placed.some(([a, b]) => x + w / 2 > a && x - w / 2 < b)) continue;
      placed.push([x - w / 2, x + w / 2]);
      const y = Math.max(M.t - 4, yOf(p.height) - 13);
      g.fillText(text, x, Math.min(y, M.t + plotH - 4));
    }

    // drag selection
    if (drag) {
      g.fillStyle = col.sel;
      if (dragMode === "fit") g.fillRect(Math.min(drag.x0, drag.x1), M.t, Math.abs(drag.x1 - drag.x0), plotH);
      else g.fillRect(Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1), Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
    }

    // crosshair
    if (hover && !drag && hover.x >= M.l && hover.x <= M.l + plotW) {
      const ppm = ppmAt(hover.x);
      const i = indexOf(main.spec, ppm);
      const x = Math.round(xOf(main.spec.ppm[i])) + 0.5;
      g.strokeStyle = col.axis;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, M.t);
      g.lineTo(x, M.t + plotH);
      g.stroke();
      const y = yOf(main.spec.re[i]);
      if (y >= M.t && y <= M.t + plotH) {
        g.beginPath();
        g.arc(x, y, 4, 0, Math.PI * 2);
        g.fillStyle = col.s[0];
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = col.surface;
        g.stroke();
      }
    }
  }, [main, vb, size, peaks, shownOthers, decon, drag, dragMode, hover, xOf, yOf, ppmAt, plotW, plotH, stackOffset, themeTick, M.l, M.t]);

  // ------------------------------------------------------------------ interaction
  const runFit = useCallback(
    (a: number, b: number) => {
      if (!main) return;
      try {
        setDecon(deconvolve1D(main.spec, [a, b], { maxComponents: 12, threshold: Math.max(3, snr / 3) }));
        setTable("fit");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [main, snr, setDecon],
  );

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const onWheel = (e: WheelEvent) => {
      if (!vb || !main) return;
      e.preventDefault();
      const rect = cv.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const f = Math.exp(Math.sign(e.deltaY) * 0.18);
      if (e.shiftKey || e.altKey) {
        const v = valAt(y);
        const base = Math.max(vb.y0, Math.min(vb.y1, 0));
        void v;
        setView({ ...vb, y0: base + (vb.y0 - base) * f, y1: base + (vb.y1 - base) * f });
      } else {
        const p = ppmAt(x);
        const lo = main.spec.ppm[main.spec.ppm.length - 1];
        const hi = main.spec.ppm[0];
        const x0 = Math.min(hi, p + (vb.x0 - p) * f);
        const x1 = Math.max(lo, p + (vb.x1 - p) * f);
        if (x0 - x1 > 0.002) setView({ ...vb, x0, x1 });
      }
    };
    cv.addEventListener("wheel", onWheel, { passive: false });
    return () => cv.removeEventListener("wheel", onWheel);
  }, [vb, main, ppmAt, valAt]);

  const local = (e: React.PointerEvent) => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = local(e);
    if (p.x < M.l || p.x > M.l + plotW) return;
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    dragRef.current = { x: p.x, y: p.y, cx: p.x, cy: p.y };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = local(e);
    setHover(p);
    const d = dragRef.current;
    if (d) {
      d.cx = Math.max(M.l, Math.min(M.l + plotW, p.x));
      d.cy = Math.max(M.t, Math.min(M.t + plotH, p.y));
      if (Math.abs(d.cx - d.x) > 3) setDrag({ x0: d.x, x1: d.cx, y0: d.y, y1: d.cy });
    }
  };
  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d || !vb || Math.abs(d.cx - d.x) < 5) return;
    const a = ppmAt(d.x);
    const b = ppmAt(d.cx);
    if (dragMode === "fit") {
      runFit(a, b);
      return;
    }
    const ya = valAt(d.y);
    const yb = valAt(d.cy);
    const tall = Math.abs(d.cy - d.y) > 8;
    setView({ x0: Math.max(a, b), x1: Math.min(a, b), y0: tall ? Math.min(ya, yb) : vb.y0, y1: tall ? Math.max(ya, yb) : vb.y1 });
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!vb) return;
    const span = vb.x0 - vb.x1;
    if (e.key === "Escape" || e.key === "0") resetView();
    else if (e.key === "ArrowLeft") setView({ ...vb, x0: vb.x0 + span * 0.1, x1: vb.x1 + span * 0.1 });
    else if (e.key === "ArrowRight") setView({ ...vb, x0: vb.x0 - span * 0.1, x1: vb.x1 - span * 0.1 });
    else if (e.key === "+" || e.key === "=") setView({ ...vb, x0: vb.x0 - span * 0.15, x1: vb.x1 + span * 0.15 });
    else if (e.key === "-") setView({ ...vb, x0: vb.x0 + span * 0.15, x1: vb.x1 - span * 0.15 });
    else if (e.key === "ArrowUp") setView({ ...vb, y1: vb.y0 + (vb.y1 - vb.y0) / 1.5 });
    else if (e.key === "ArrowDown") setView({ ...vb, y1: vb.y0 + (vb.y1 - vb.y0) * 1.5 });
    else return;
    e.preventDefault();
  };

  // tooltip content
  let tip: React.ReactNode = null;
  let tipPos = { left: 0, top: 0 };
  if (hover && main && vb && !drag && hover.x >= M.l && hover.x <= M.l + plotW && hover.y >= M.t && hover.y <= M.t + plotH) {
    const ppm = ppmAt(hover.x);
    const i = indexOf(main.spec, ppm);
    const near = peaks.find((p) => Math.abs(xOf(p.ppm) - hover.x) < 6);
    tip = (
      <>
        <div>
          <b>{compact(main.spec.re[i])}</b> <span style={{ color: "var(--b1d-muted)" }}>at</span> <b>{main.spec.ppm[i].toFixed(4)}</b> ppm
        </div>
        {shownOthers.map((o, k) => {
          const j = indexOf(o.spec, ppm);
          return (
            <div key={o.id}>
              <span className="b1d-key" style={{ background: `var(--b1d-s${((k + 1) % 3) + 1})` }} /> <b>{compact(o.spec.re[j])}</b>{" "}
              <span style={{ color: "var(--b1d-muted)" }}>{shortTitle(list, o.id)}</span>
            </div>
          );
        })}
        {near && (
          <div style={{ color: "var(--b1d-ink-2)" }}>
            peak {near.ppm.toFixed(4)} ppm · {near.widthHz?.toFixed(2)} Hz · S/N {(near.height / main.spec.noise).toFixed(0)}
          </div>
        )}
      </>
    );
    tipPos = { left: Math.min(hover.x + 12, size.w - 190), top: Math.max(4, hover.y - 54) };
  }

  const maxSN = main && peaks.length ? Math.max(...peaks.map((p) => p.height)) / main.spec.noise : 0;
  const currentPhase = main ? { ph0: main.spec.ph0, ph1: main.spec.ph1 } : { ph0: 0, ph1: 0 };
  const info = main?.prep;

  if (listLoaded && !list.length) {
    return (
      <div className="b1d-root" ref={rootRef} style={{ height }}>
        <style>{STYLE}</style>
        <p style={{ margin: 0, padding: 16, color: "var(--b1d-ink-2)" }}>
          No raw Bruker 1D experiments on this server. None are bundled with Spectre: put experiment folders (each with fid, acqus and procs) in
          .data/bruker1h/, or point SPECTRE_BRUKER_DIR at them, and reload.
        </p>
      </div>
    );
  }

  return (
    <div className="b1d-root" ref={rootRef} style={{ height }}>
      <style>{STYLE}</style>
      <div className="b1d-row">
        <select
          className="b1d-select"
          aria-label="Experiment"
          value={exp ?? ""}
          onChange={(e) => {
            resetView();
            setDecon(null);
            onExperimentChange(e.target.value);
          }}
          style={{ flex: "1 1 180px" }}
        >
          {list.map((x) => (
            <option key={x.id} value={x.id}>
              {x.title} · {x.id}
            </option>
          ))}
        </select>
        {info && (
          <span className="b1d-label">
            {info.pulseProgram} · {info.solvent} · {info.sf.toFixed(1)} MHz · NS {info.ns}
          </span>
        )}
      </div>
      <div className="b1d-row">
        <span className="b1d-seg" role="group" aria-label="Phase">
          {(["procs", "auto", "manual"] as const).map((m) => (
            <button
              key={m}
              aria-pressed={phaseMode === m}
              onClick={() => {
                if (m === "manual") setManual({ ph0: round1(currentPhase.ph0), ph1: round1(currentPhase.ph1) });
                setPhaseMode(m);
              }}
              title={
                m === "procs" ? "Phases stored by TopSpin (apk)" : m === "auto" ? "Automatic phasing (ACME entropy minimisation)" : "Manual phase correction"
              }
            >
              {m === "procs" ? "TopSpin" : m === "auto" ? "Auto" : "Manual"}
            </button>
          ))}
        </span>
        <label className="b1d-label">
          LB{" "}
          <input
            className="b1d-num"
            type="number"
            step={0.1}
            min={0}
            max={20}
            value={lbInput}
            onChange={(e) => setLbInput(e.target.value)}
            onBlur={() => commitLb(lbInput, setLb, setLbInput)}
            onKeyDown={(e) => e.key === "Enter" && commitLb(lbInput, setLb, setLbInput)}
            aria-label="Line broadening (Hz)"
          />{" "}
          Hz
        </label>
        <label className="b1d-label" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
          <input type="checkbox" checked={baseline} onChange={(e) => setBaseline(e.target.checked)} /> baseline
        </label>
        <label className="b1d-label" style={{ display: "inline-flex", gap: 4, alignItems: "center" }} title="Peak picking threshold (signal-to-noise)">
          S/N ≥
          <input
            className="b1d-range"
            type="range"
            min={0}
            max={100}
            value={Math.round((Math.log(snr / 3) / Math.log(100)) * 100)}
            onChange={(e) => setSnr(Math.round(3 * Math.pow(100, Number(e.target.value) / 100)))}
            aria-label="Peak picking signal-to-noise threshold"
          />
          <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--b1d-ink-2)", minWidth: 24 }}>{snr}</span>
        </label>
      </div>
      {phaseMode === "manual" && (
        <div className="b1d-row">
          <PhaseSlider label="ph0" min={-180} max={180} value={manual.ph0} onChange={(v) => setManual((m) => ({ ...m, ph0: v }))} />
          <PhaseSlider label="ph1" min={-180} max={180} value={manual.ph1} onChange={(v) => setManual((m) => ({ ...m, ph1: v }))} />
        </div>
      )}
      <div className="b1d-row">
        <span className="b1d-seg" role="group" aria-label="Drag action">
          <button aria-pressed={dragMode === "zoom"} onClick={() => setDragMode("zoom")} title="Drag to zoom (double-click resets)">
            Zoom
          </button>
          <button aria-pressed={dragMode === "fit"} onClick={() => setDragMode("fit")} title="Drag across a multiplet to deconvolve it">
            Fit region
          </button>
        </span>
        <select
          className="b1d-select"
          aria-label="Compare with"
          value=""
          disabled={compare.length >= 2 || !!decon}
          onChange={(e) => e.target.value && setCompare((c) => [...c, e.target.value].slice(0, 2))}
          style={{ maxWidth: 170 }}
        >
          <option value="">{decon ? "Compare (clear fit first)" : compare.length >= 2 ? "Compare: max 2" : "Compare with…"}</option>
          {list
            .filter((x) => x.id !== exp && !compare.includes(x.id))
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.title} · {x.id}
              </option>
            ))}
        </select>
        {compare.map((id, k) => (
          <span className="b1d-chip" key={id}>
            <span className="b1d-key" style={{ background: `var(--b1d-s${k + 2})` }} />
            {shortTitle(list, id)}
            <button aria-label={`Remove ${id}`} onClick={() => setCompare((c) => c.filter((x) => x !== id))}>
              ×
            </button>
          </span>
        ))}
        {compare.length > 0 && (
          <label className="b1d-label" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
            <input type="checkbox" checked={stacked} onChange={(e) => setStacked(e.target.checked)} /> stack
          </label>
        )}
        {(compare.length > 0 || decon) && (
          <span className="b1d-label" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <span>
              <span className="b1d-key" style={{ background: "var(--b1d-s1)" }} /> {exp ? shortTitle(list, exp) : "spectrum"}
            </span>
            {decon && (
              <>
                <span>
                  <span className="b1d-key" style={{ background: "var(--b1d-s2)" }} /> components
                </span>
                <span>
                  <span className="b1d-key" style={{ background: "var(--b1d-s3)" }} /> fit
                </span>
                <span>
                  <span className="b1d-key" style={{ background: "var(--b1d-muted)" }} /> residual
                </span>
              </>
            )}
          </span>
        )}
        {decon && (
          <span style={{ display: "inline-flex", gap: 6, marginLeft: "auto" }}>
            <button className="b1d-btn" onClick={() => setTable((t) => (t === "fit" ? null : "fit"))} aria-pressed={table === "fit"}>
              Fit table
            </button>
            <button
              className="b1d-btn"
              onClick={() => {
                setDecon(null);
                if (table === "fit") setTable(null);
              }}
            >
              Clear fit
            </button>
          </span>
        )}
      </div>
      <div className="b1d-plot" ref={wrapRef} style={{ opacity: busy && main ? 0.7 : 1 }}>
        <canvas
          ref={canvasRef}
          tabIndex={0}
          role="img"
          aria-label={
            main
              ? `1D ${main.spec.nucleus} spectrum ${main.spec.title}; ${peaks.length} peaks picked. Use arrow keys to pan, +/- to zoom, Escape to reset.`
              : "Spectrum loading"
          }
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => setHover(null)}
          onDoubleClick={resetView}
          onKeyDown={onKey}
        />
        {tip && (
          <div className="b1d-tip" style={tipPos}>
            {tip}
          </div>
        )}
        {(busy || (!main && !error)) && <div className="b1d-busy">processing…</div>}
        {error && <div className="b1d-busy b1d-err">{error}</div>}
      </div>
      {table === "peaks" && main && (
        <div className="b1d-table">
          <table>
            <caption style={{ position: "absolute", left: -9999 }}>Picked peaks</caption>
            <thead>
              <tr>
                <th>δ (ppm)</th>
                <th>height</th>
                <th>S/N</th>
                <th>FWHM (Hz)</th>
                <th>integral</th>
              </tr>
            </thead>
            <tbody>
              {peaks.map((p) => (
                <tr key={p.index} onMouseEnter={() => setHover({ x: xOf(p.ppm), y: yOf(p.height) })}>
                  <td>{p.ppm.toFixed(4)}</td>
                  <td>{compact(p.height)}</td>
                  <td>{(p.height / main.spec.noise).toFixed(0)}</td>
                  <td>{p.widthHz?.toFixed(2)}</td>
                  <td>{compact(p.integral ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {table === "fit" && decon && main && (
        <div className="b1d-table">
          <table>
            <caption style={{ position: "absolute", left: -9999 }}>Deconvolution components</caption>
            <thead>
              <tr>
                <th>δ (ppm)</th>
                <th>height</th>
                <th>FWHM (Hz)</th>
                <th>η (Lorentz)</th>
                <th>area %</th>
              </tr>
            </thead>
            <tbody>
              {decon.components.map((c, k) => {
                const tot = decon.components.reduce((s, q) => s + q.area, 0) || 1;
                return (
                  <tr key={k}>
                    <td>{c.ppm.toFixed(4)}</td>
                    <td>{compact(c.amplitude)}</td>
                    <td>{c.widthHz.toFixed(2)}</td>
                    <td>{c.eta.toFixed(2)}</td>
                    <td>{((100 * c.area) / tot).toFixed(1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="b1d-foot">
        {main ? (
          <>
            <span title="zero / first order phase (TopSpin convention)">
              ph {main.spec.ph0.toFixed(1)}° / {main.spec.ph1.toFixed(1)}°
            </span>
            <span title="noise standard deviation">σ {compact(main.spec.noise)}</span>
            <span>
              {peaks.length} peaks{maxSN && !decon ? ` · S/N ${compact(maxSN)}` : ""}
            </span>
            {decon && (
              <span>
                {decon.components.length} lines · rms {((100 * decon.rms) / Math.max(1e-12, ...decon.fit)).toFixed(1)}%
              </span>
            )}
            <span title="processing time">{Math.round(main.ms)} ms</span>
          </>
        ) : (
          <span>Loading raw FID…</span>
        )}
        <span className="b1d-sp" />
        <button className="b1d-btn" onClick={() => setTable((t) => (t === "peaks" ? null : "peaks"))} aria-pressed={table === "peaks"}>
          Peaks
        </button>
        <button className="b1d-btn" onClick={resetView} disabled={!view && (viewTouched || !initView)}>
          Reset
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ helpers
function PhaseSlider({ label, min, max, value, onChange }: { label: string; min: number; max: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="b1d-label" style={{ display: "inline-flex", gap: 6, alignItems: "center", flex: "1 1 160px" }}>
      {label}
      <input
        type="range"
        min={min}
        max={max}
        step={0.5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: "var(--b1d-s1)" }}
        aria-label={`${label} (degrees)`}
      />
      <span style={{ fontVariantNumeric: "tabular-nums", minWidth: 42, textAlign: "right", color: "var(--b1d-ink)" }}>{value.toFixed(1)}°</span>
    </label>
  );
}

function commitLb(text: string, set: (v: number) => void, setText: (s: string) => void) {
  const v = Math.max(0, Math.min(20, Number(text)));
  if (Number.isFinite(v)) {
    set(Math.round(v * 100) / 100);
    setText(String(Math.round(v * 100) / 100));
  }
}

function fmtPpm(v: number, d: number) {
  return (Math.abs(v) < 0.5 * Math.pow(10, -d) ? 0 : v).toFixed(d);
}

function round1(v: number) {
  return Math.round(v * 2) / 2;
}

function indexOf(s: Processed1D, ppm: number): number {
  const step = s.ppm[1] - s.ppm[0];
  return Math.max(0, Math.min(s.ppm.length - 1, Math.round((ppm - s.ppm[0]) / step)));
}

function yRange(s: Processed1D, hi: number, lo: number, others: { spec: Processed1D }[], stacked: boolean): [number, number] {
  const scan = (sp: Processed1D) => {
    const i0 = indexOf(sp, hi);
    const i1 = indexOf(sp, lo);
    let mx = -Infinity;
    let mn = Infinity;
    for (let i = Math.min(i0, i1); i <= Math.max(i0, i1); i++) {
      if (sp.re[i] > mx) mx = sp.re[i];
      if (sp.re[i] < mn) mn = sp.re[i];
    }
    return [mn, mx];
  };
  let [mn, mx] = scan(s);
  for (const o of others) {
    const [a, b] = scan(o.spec);
    mn = Math.min(mn, a);
    mx = Math.max(mx, b);
  }
  if (stacked && others.length) mx = mx * (1 + 0.3 * others.length);
  const top = mx * 1.12;
  const bottom = Math.min(mn, -0.04 * mx);
  return [Math.max(bottom, -0.15 * mx), top];
}

function shortTitle(list: ExpInfo[], id: string): string {
  const t = list.find((x) => x.id === id)?.title ?? id;
  const m = t.match(/(\d+)$/);
  return m ? `#${m[1]} (${id})` : t;
}

function superscript(d: string) {
  const map: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
  return d
    .split("")
    .map((c) => map[c] ?? c)
    .join("");
}
