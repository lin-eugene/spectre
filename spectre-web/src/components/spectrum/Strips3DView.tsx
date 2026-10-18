"use client";
// "Strips 3D" tab: one triple-resonance spectrum as a rotatable ¹H × ¹⁵N × ¹³C cube. The floor
// is the ¹H–¹⁵N HSQC; every amide carries its carbon peaks on a stem (a strip is the column
// above one amide); a translucent plane steps through ¹⁵N (the classic strip plane) or ¹³C and
// carries the measured slice; arcs trace the sequential walk around the selected residue.
// The three.js scene is loaded lazily and driven imperatively (strips3d/CubeScene).
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { CONFIDENCE, type SpectrumViewId } from "@/lib/contract";
import {
  buildCubeModel,
  cubeExperiments,
  defaultCubeExperiment,
  peakColor,
  peakTypeLabel,
  spectrumScale,
  synthFloorPeaks,
  synthSlicePeaks,
  walkArcs,
  type CubeModel,
  type CubePeak,
  type SliceAxis,
} from "@/lib/viz/cube";
import { experimentLabel } from "@/lib/viz/data";
import { findRealHsqc, nucLabel, realSpectrumFor, sampleAt, type RealPlane } from "@/lib/viz/real";
import { stepResidue, type ViewCommonProps } from "./HsqcView";
import { Caption, ConfidenceLegend, DataTable, Swatch, Tooltip, type TooltipState } from "./parts";
import { styles } from "./styles";
import { useRealPlane } from "./useReal";
import { paintTexture, type TextureStyle } from "./strips3d/textures";
import type { CubePreset, CubeScene, CubeTarget, CubeTheme, SceneData, SceneLabel } from "./strips3d/CubeScene";

export interface Strips3DViewProps extends ViewCommonProps {
  /** spectrum type requested from outside (assistant, deep link), e.g. "hnca" */
  experiment?: string | null;
  /** switch the panel to another view (fallback when there is nothing to show in 3D) */
  onShowView?: (view: SpectrumViewId) => void;
}

/** Box proportions (must match strips3d/CubeScene BOX: W 10, H 8, D 10). */
const TEX = 2048;
const N_SLICE_H = Math.round(TEX * 0.8);
const TOL: Record<SliceAxis, number> = { n: 0.4, c: 0.5 };

const SCENE_THEME: Record<"light" | "dark", CubeTheme> = {
  light: {
    dark: false,
    surface: "#ffffff",
    frame: "#bfbeb5",
    grid: "#e6e5df",
    wall: "#f2f3f5",
    stem: "#a9a8a1",
    muted: "#9a9993",
    ink: "#0b0b0b",
    rose: "#d6336c",
    beam: "#2c63b4",
    shadow: 0.13,
  },
  dark: {
    dark: true,
    surface: "#222224",
    frame: "#4e4d48",
    grid: "#303030",
    wall: "#29292c",
    stem: "#73726c",
    muted: "#8a8984",
    ink: "#f0efec",
    rose: "#f06595",
    beam: "#6fa4f1",
    shadow: 0.5,
  },
};

const FLOOR = { light: { base: "#ffffff", grid: "#ebeae4" }, dark: { base: "#1f1f21", grid: "#2f2f2e" } };

const PRESETS: { id: CubePreset; label: string; title: string }[] = [
  { id: "home", label: "3D", title: "Oblique view of the whole cube" },
  { id: "top", label: "HSQC", title: "Top-down: the ¹H–¹⁵N HSQC floor" },
  { id: "face", label: "Strip", title: "Face-on: the ¹H–¹³C strip plane" },
];

function subscribeReduced(cb: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const reducedSnapshot = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

function fmtInty(v: number): string {
  const a = Math.abs(v);
  const s = a >= 1e5 ? v.toExponential(2) : a >= 100 ? v.toFixed(0) : v.toPrecision(3);
  return s.replace("-", "−");
}

function sphereBg(c: string): string {
  return `radial-gradient(circle at 34% 30%, color-mix(in srgb, ${c} 40%, white) 0%, ${c} 52%, color-mix(in srgb, ${c} 72%, black) 100%)`;
}

/** The plane belongs to this spectrum and orientation (a stale plane can be from another). */
function planeFits(r: RealPlane | null, meta: { axes: { label: string; ppmMin: number; ppmMax: number }[] } | undefined, yLabel: string): r is RealPlane {
  if (!r || !meta || r.y.label !== yLabel) return false;
  const ay = meta.axes.find((a) => a.label === yLabel);
  const ax = meta.axes.find((a) => a.label === "1H");
  return !!ay && !!ax && Math.abs(r.y.from - ay.ppmMin) < 0.02 && Math.abs(r.x.from - ax.ppmMax) < 0.02;
}

export function Strips3DView(p: Strips3DViewProps) {
  const { project, roots, residues, dark, showTable, selectedResidue, selectedRoot, onSelectResidue, onSelectRoot, experiment, onShowView } = p;

  // ------------------------------------------------------------ experiment
  const exps = useMemo(() => cubeExperiments(project), [project]);
  const asked = experiment?.toLowerCase() ?? null;
  const [tpPick, setTpPick] = useState<string | null>(() => (asked && exps.includes(asked) ? asked : null));
  const [seenAsked, setSeenAsked] = useState(asked);
  if (seenAsked !== asked) {
    setSeenAsked(asked);
    if (asked && exps.includes(asked)) setTpPick(asked);
  }
  const tp = tpPick && exps.includes(tpPick) ? tpPick : defaultCubeExperiment(exps);
  const model: CubeModel | null = useMemo(() => (tp ? buildCubeModel(project, roots, tp) : null), [project, roots, tp]);

  // ------------------------------------------------------------ selection
  const selAmide = useMemo(() => {
    if (!model) return null;
    const byRoot = selectedRoot ? model.amides.find((a) => a.root === selectedRoot) : undefined;
    return byRoot ?? (selectedResidue != null ? (model.amides.find((a) => a.resi === selectedResidue) ?? null) : null);
  }, [model, selectedRoot, selectedResidue]);
  const selResi = selAmide?.resi ?? selectedResidue;
  const mainPeak: CubePeak | null = useMemo(() => {
    if (!model || !selAmide) return null;
    const own = selAmide.peaks.map((k) => model.peaks[k]);
    return own.find((q) => q.rel === "i" && q.kind === "ca") ?? own.find((q) => q.rel === "i") ?? own[0] ?? null;
  }, [model, selAmide]);

  // ------------------------------------------------------------ slice plane
  // the plane follows the selection: off for the overview, the strip plane once a strip is picked
  const [slicePref, setSlice] = useState<SliceAxis | "off" | null>(null);
  const slice: SliceAxis | "off" = slicePref ?? (selAmide ? "n" : "off");
  const [atPick, setAtPick] = useState<{ n: number | null; c: number | null }>({ n: null, c: null });
  const followKey = `${selAmide?.root ?? ""}|${tp ?? ""}`;
  const [prevFollow, setPrevFollow] = useState(followKey);
  if (prevFollow !== followKey) {
    // a new selection (or spectrum) moves the plane onto the selected strip
    setPrevFollow(followKey);
    setAtPick({ n: null, c: null });
  }
  const realMeta = tp ? realSpectrumFor(project, tp) : undefined;
  const sliceLabel = slice === "c" ? "13C" : "15N";
  const realAxis = slice !== "off" ? realMeta?.axes.find((a) => a.label === sliceLabel) : undefined;
  const range: [number, number] = model ? (slice === "c" ? [model.c.min, model.c.max] : [model.n.min, model.n.max]) : [0, 1];
  const lo = realAxis ? Math.max(range[0], realAxis.ppmMin) : range[0];
  const hi = realAxis ? Math.min(range[1], realAxis.ppmMax) : range[1];
  const step = realAxis ? Math.abs(realAxis.ppmMax - realAxis.ppmMin) / Math.max(1, realAxis.size - 1) : slice === "c" ? 0.25 : 0.2;
  const snap = useCallback(
    (v: number) => {
      const c = Math.min(hi, Math.max(lo, v));
      const s = realAxis ? realAxis.ppmMax - Math.round((realAxis.ppmMax - c) / step) * step : Math.round(c / step) * step;
      return Math.min(hi, Math.max(lo, s));
    },
    [lo, hi, step, realAxis],
  );
  const defaultAt = (axis: SliceAxis): number | null => {
    if (!model) return null;
    if (axis === "n") return selAmide?.n ?? median(model.amides.map((a) => a.n));
    return mainPeak?.c ?? median(model.peaks.map((q) => q.c));
  };
  const rawAt = slice === "off" ? null : (atPick[slice] ?? defaultAt(slice));
  const at = rawAt == null ? null : snap(rawAt);
  const tol = slice === "off" ? 0 : Math.max(TOL[slice], step * 1.5);

  // debounce slider moves so dragging doesn't flood the server; a value only counts for the
  // spectrum and orientation it was set for
  const queryKey = `${tp ?? ""}|${slice}`;
  const [query, setQuery] = useState<{ key: string; at: number | null }>({ key: queryKey, at });
  useEffect(() => {
    const t = setTimeout(() => setQuery({ key: queryKey, at }), 90);
    return () => clearTimeout(t);
  }, [queryKey, at]);
  const atQuery = query.key === queryKey ? query.at : null;

  const sliceQuery = useMemo(
    () => (realMeta && slice !== "off" && atQuery != null ? { x: "1H", y: slice === "n" ? "13C" : "15N", mode: "slice" as const, at: atQuery, maxPoints: 512 } : null),
    [realMeta, slice, atQuery],
  );
  const { plane: rawSlicePlane, loading: sliceLoading } = useRealPlane(project.id, realMeta?.name, sliceQuery);
  const slicePlane = slice !== "off" && planeFits(rawSlicePlane, realMeta, slice === "n" ? "13C" : "15N") ? rawSlicePlane : null;

  const hsqcMeta = findRealHsqc(project);
  const hsqcQuery = useMemo(() => (hsqcMeta ? { x: "1H", y: "15N", mode: "projection" as const, maxPoints: 512 } : null), [hsqcMeta]);
  const { plane: hsqcPlane, loading: hsqcLoading } = useRealPlane(project.id, hsqcMeta?.name, hsqcQuery);

  // ------------------------------------------------------------ textures
  // textures are painted once the 3D engine is up, so first paint stays light
  const [ready, setReady] = useState(false);
  const floorCanvas = useMemo(() => {
    if (!model || !ready) return null;
    const f = dark ? FLOOR.dark : FLOOR.light;
    const st: TextureStyle = {
      width: TEX,
      height: TEX,
      rect: { x0: model.h.max, x1: model.h.min, y0: model.n.min, y1: model.n.max },
      dark,
      base: f.base,
      grid: { xs: model.h.ticks, ys: model.n.ticks, color: f.grid },
      heatAlpha: 0.5,
      contourAlpha: dark ? 0.8 : 0.72,
      lineScale: 3,
    };
    if (hsqcMeta) return paintTexture(st, hsqcPlane ? { real: { plane: hsqcPlane, sigma: 5, shift: { x: model.hsqcShift.h, y: model.hsqcShift.n } } } : {});
    const peaks = synthFloorPeaks(project, model);
    const mags = peaks.map((q) => Math.abs(q.amp)).sort((a, b) => a - b);
    const scale = mags.length ? mags[Math.floor(mags.length * 0.9)] || 1 : 1;
    return paintTexture(st, {
      synth: { peaks, fwhm: { x: Math.max(0.04, (model.h.max - model.h.min) * 0.013), y: Math.max(0.35, (model.n.max - model.n.min) * 0.015) }, scale },
    });
  }, [model, ready, dark, hsqcMeta, hsqcPlane, project]);

  const sliceTexture = useMemo(() => {
    if (!model || !ready || !tp || slice === "off" || atQuery == null) return null;
    const st: TextureStyle = {
      width: TEX,
      height: slice === "n" ? N_SLICE_H : TEX,
      rect: slice === "n" ? { x0: model.h.max, x1: model.h.min, y0: model.c.max, y1: model.c.min } : { x0: model.h.max, x1: model.h.min, y0: model.n.min, y1: model.n.max },
      dark,
      base: null,
      grid: null,
      heatAlpha: 0.8,
      contourAlpha: 0.95,
      lineScale: 4.2,
    };
    if (realMeta) {
      if (!slicePlane) return null;
      const dim = realMeta.axes.findIndex((a) => a.label === sliceLabel);
      const planeAt = slicePlane.at?.[String(dim)] ?? atQuery;
      return { canvas: paintTexture(st, { real: { plane: slicePlane, sigma: 4.5 } }), at: planeAt };
    }
    // display linewidths a little wider than the spheres, so the synthesised slice reads as a halo of contours around them
    const fwhm =
      slice === "n"
        ? { x: (model.h.max - model.h.min) * 0.026, y: (model.c.max - model.c.min) * 0.03 }
        : { x: (model.h.max - model.h.min) * 0.026, y: (model.n.max - model.n.min) * 0.026 };
    return { canvas: paintTexture(st, { synth: { peaks: synthSlicePeaks(project, tp, slice, atQuery), fwhm, scale: spectrumScale(project, tp) } }), at: atQuery };
  }, [model, ready, tp, slice, atQuery, dark, realMeta, slicePlane, sliceLabel, project]);

  // ------------------------------------------------------------ scene inputs
  const theme = dark ? SCENE_THEME.dark : SCENE_THEME.light;
  const sceneData: SceneData | null = useMemo(
    () =>
      model && {
        axes: {
          h: [model.h.min, model.h.max],
          n: [model.n.min, model.n.max],
          c: [model.c.min, model.c.max],
          ticks: { h: model.h.ticks, n: model.n.ticks, c: model.c.ticks },
          titles: { h: "¹H (ppm)", n: "¹⁵N (ppm)", c: "¹³C (ppm)" },
        },
        peaks: model.peaks.map((q) => ({ h: q.h, n: q.n, c: q.c, r: 0.075 + 0.12 * Math.sqrt(q.amp), color: peakColor(q.kind, q.rel, q.inty, dark), amide: q.amide })),
        amides: model.amides.map((a) => ({
          h: a.h,
          n: a.n,
          top: a.top,
          color: a.confidence === "none" ? theme.muted : CONFIDENCE[a.confidence].color,
          faded: !a.peaks.length,
        })),
      },
    [model, dark, theme.muted],
  );

  const arcs = useMemo(() => (model ? walkArcs(model, project, residues, selResi ?? null) : []), [model, project, residues, selResi]);

  const highlight = useMemo(() => {
    if (!model) return null;
    const selectedAmide = selAmide?.index ?? null;
    if (slice === "off" || at == null) return { lit: null, glow: null, selectedAmide };
    const keep = new Set<number>();
    for (const a of arcs) {
      keep.add(a.fromPeak);
      if (a.toPeak != null) keep.add(a.toPeak);
    }
    const lit = new Uint8Array(model.peaks.length);
    const glow = new Uint8Array(model.peaks.length);
    for (const q of model.peaks) {
      const inside = Math.abs((slice === "n" ? q.n : q.c) - at) <= tol;
      glow[q.index] = inside ? 1 : 0;
      lit[q.index] = inside || q.amide === selectedAmide || keep.has(q.index) ? 1 : 0;
    }
    return { lit, glow, selectedAmide };
  }, [model, slice, at, tol, selAmide, arcs]);

  const labels: SceneLabel[] = useMemo(() => {
    if (!model) return [];
    const out: SceneLabel[] = [];
    if (selAmide) {
      for (const k of selAmide.peaks) {
        const q = model.peaks[k];
        const main = q === mainPeak;
        out.push({ key: q.id, at: q, text: main ? `${selAmide.tag} ${q.short}` : q.short, className: main ? "spx-cubePeakLabel spx-cubeMain" : "spx-cubePeakLabel", dx: 13 });
      }
      if (!selAmide.peaks.length) out.push({ key: "sel", at: { h: selAmide.h, n: selAmide.n, c: model.c.min }, text: selAmide.tag, className: "spx-cubePeakLabel spx-cubeMain", dx: 13 });
    }
    if (selResi != null) {
      for (const a of model.amides) {
        if (a === selAmide || a.resi == null || a.top == null || Math.abs(a.resi - selResi) > 3) continue;
        out.push({ key: `tag${a.root}`, at: { h: a.h, n: a.n, c: a.top }, text: a.tag, className: "spx-cubeTag", dy: -15, align: "center" });
      }
    }
    return out;
  }, [model, selAmide, selResi, mainPeak]);

  // ------------------------------------------------------------ scene lifecycle
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CubeScene | null>(null);
  const hoverRef = useRef<CubeTarget>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [hover, setHover] = useState<{ t: NonNullable<CubeTarget>; flip: boolean } | null>(null);
  const reduced = useSyncExternalStore(subscribeReduced, reducedSnapshot, () => true);
  const [spinPref, setSpinPref] = useState<boolean | null>(null);
  const spin = spinPref ?? !reduced;

  const positionTip = useCallback(() => {
    const el = tipRef.current;
    const s = sceneRef.current;
    const t = hoverRef.current;
    if (!el || !s) return;
    const a = t ? s.anchorOf(t) : null;
    if (!a || !a.visible) {
      el.style.visibility = "hidden";
      return;
    }
    el.style.visibility = "";
    el.style.transform = `translate3d(${a.x.toFixed(1)}px, ${Math.min(a.h - 70, Math.max(70, a.y)).toFixed(1)}px, 0)`;
  }, []);

  const select = (t: CubeTarget) => {
    if (!model) return;
    if (!t) {
      onSelectRoot(null);
      onSelectResidue(null);
      return;
    }
    const am = t.kind === "amide" ? model.amides[t.index] : model.amides[model.peaks[t.index]?.amide ?? -1];
    if (!am) return;
    onSelectRoot(am.root);
    onSelectResidue(am.resi);
  };
  const dragTo = (v: number) => {
    if (slice !== "off") setAtPick((prev) => ({ ...prev, [slice]: v }));
  };
  const cbRef = useRef({ select, dragTo });
  useEffect(() => {
    cbRef.current = { select, dragTo };
  });

  useEffect(() => {
    let disposed = false;
    let scene: CubeScene | null = null;
    import("./strips3d/CubeScene")
      .then(({ CubeScene }) => {
        if (disposed || !hostRef.current || !overlayRef.current) return;
        try {
          scene = new CubeScene(hostRef.current, overlayRef.current, {
            onHover: (t) => {
              hoverRef.current = t;
              const a = t ? scene?.anchorOf(t) : null;
              setHover(t ? { t, flip: !!a && a.x > a.w * 0.58 } : null);
            },
            onSelect: (t) => cbRef.current.select(t),
            onFrame: positionTip,
            onSliceDrag: (v) => cbRef.current.dragTo(v),
            onSpinChange: (on) => setSpinPref(on),
          });
          sceneRef.current = scene;
          if (process.env.NODE_ENV !== "production") (window as unknown as { __cube?: CubeScene }).__cube = scene;
          setReady(true);
        } catch (e) {
          setFailed(e instanceof Error ? e.message : "WebGL is not available");
        }
      })
      .catch(() => setFailed("Could not load the 3D engine"));
    return () => {
      disposed = true;
      scene?.dispose();
      sceneRef.current = null;
    };
  }, [positionTip]);

  useEffect(() => {
    if (ready) sceneRef.current?.setTheme(theme);
  }, [ready, theme]);
  useEffect(() => {
    if (ready && sceneData) sceneRef.current?.setData(sceneData);
  }, [ready, sceneData]);
  useEffect(() => {
    if (ready) sceneRef.current?.setFloor(floorCanvas);
  }, [ready, floorCanvas]);
  useEffect(() => {
    if (ready && highlight) sceneRef.current?.setHighlight(highlight);
  }, [ready, highlight, sceneData]);
  useEffect(() => {
    if (!ready) return;
    sceneRef.current?.setSlice({
      axis: slice === "off" || at == null ? null : slice,
      at: at ?? 0,
      texture: sliceTexture?.canvas ?? null,
      textureAt: sliceTexture?.at ?? null,
      label: at == null ? "" : `${nucLabel(sliceLabel)} ${at.toFixed(slice === "c" ? 1 : 2)}`,
    });
  }, [ready, slice, at, sliceTexture, sliceLabel, sceneData]);
  useEffect(() => {
    if (!ready) return;
    sceneRef.current?.setArcs(
      arcs.map((a) => ({
        from: { h: a.from[0], n: a.from[1], c: a.from[2] },
        to: { h: a.to[0], n: a.to[1], c: a.to[2] },
        color: peakColor(a.kind, "i", 1, dark),
        dashed: !a.linked,
        openEnd: a.toPeak == null,
      })),
    );
  }, [ready, arcs, dark, sceneData]);
  useEffect(() => {
    if (ready) sceneRef.current?.setLabels(labels);
  }, [ready, labels]);
  useEffect(() => {
    if (ready) sceneRef.current?.setSpin(spin && !showTable);
  }, [ready, spin, showTable]);

  // ease the camera onto a newly selected strip (the first view stays the overview)
  const focusKey = selAmide?.root ?? "";
  const lastFocus = useRef<string | null>(null);
  useEffect(() => {
    const s = sceneRef.current;
    if (!ready || !s || !model) return;
    if (lastFocus.current === null) {
      lastFocus.current = focusKey;
      return;
    }
    if (lastFocus.current === focusKey) return;
    lastFocus.current = focusKey;
    if (selAmide) {
      const mid = selAmide.top != null && selAmide.bottom != null ? (selAmide.top + selAmide.bottom) / 2 : (model.c.min + model.c.max) / 2;
      s.focus({ h: selAmide.h, n: selAmide.n, c: mid });
    }
  }, [ready, focusKey, selAmide, model]);

  // ------------------------------------------------------------ interaction helpers
  const stepSlice = (dir: number) => {
    if (!model) return;
    if (slice === "off") {
      setSlice("n");
      return;
    }
    if (at == null) return;
    setAtPick((prev) => ({ ...prev, [slice]: snap(at + dir * step) }));
  };
  const stepRef = useRef(stepSlice);
  useEffect(() => {
    stepRef.current = stepSlice;
  });
  useEffect(() => {
    const el = sliderRef.current;
    if (!el || slice === "off") return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stepRef.current(e.deltaY > 0 ? -1 : 1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [slice, model]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "]" || e.key === "PageUp") {
      e.preventDefault();
      stepSlice(1);
    } else if (e.key === "[" || e.key === "PageDown") {
      e.preventDefault();
      stepSlice(-1);
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const r = stepResidue(residues, selectedResidue, e.key === "ArrowRight" ? 1 : -1);
      if (r) {
        onSelectResidue(r.resi);
        onSelectRoot(r.root ?? null);
      }
    } else if (e.key === "Escape") {
      sceneRef.current?.clearHover();
    } else if (e.key === "Home") {
      e.preventDefault();
      sceneRef.current?.view("home");
    }
  };

  // ------------------------------------------------------------ tooltip content
  const tip: TooltipState | null = useMemo(() => {
    if (!hover || !model) return null;
    if (hover.t.kind === "peak") {
      const q = model.peaks[hover.t.index];
      if (!q) return null;
      const am = model.amides[q.amide];
      const rows: [string, string][] = [
        ["Peak", peakTypeLabel(q.kind, q.rel)],
        ["Phase", q.inty < 0 ? "negative" : "positive"],
        ["¹H", `${q.h.toFixed(3)} ppm`],
        ["¹⁵N", `${q.n.toFixed(2)} ppm`],
        ["¹³C", `${q.c.toFixed(2)} ppm`],
        ["Intensity", fmtInty(q.inty)],
      ];
      if (slicePlane && slice !== "off" && at != null && Math.abs((slice === "n" ? q.n : q.c) - at) <= tol) {
        const v = sampleAt(slicePlane, q.h, slice === "n" ? q.c : q.n);
        if (v != null && slicePlane.noise > 0) rows.push(["S/N in slice", (v / slicePlane.noise).toFixed(0).replace("-", "−")]);
      }
      rows.push(["Spin system", am.root]);
      return {
        x: 0,
        y: 0,
        flip: hover.flip,
        color: peakColor(q.kind, q.rel, q.inty, dark),
        title: am.resi != null ? `${am.tag} · ${q.short}` : `${q.short} · spin system ${am.root}`,
        rows,
        foot: am.resi != null ? `${model.label} · click to select ${am.tag}` : `${model.label} · ${am.confidenceText}`,
      };
    }
    const am = model.amides[hover.t.index];
    if (!am) return null;
    return {
      x: 0,
      y: 0,
      flip: hover.flip,
      color: am.confidence === "none" ? theme.muted : CONFIDENCE[am.confidence].color,
      title: am.resi != null ? `${am.tag} · spin system ${am.root}` : `Spin system ${am.root}`,
      rows: [
        ["¹H", `${am.h.toFixed(3)} ppm`],
        ["¹⁵N", `${am.n.toFixed(2)} ppm`],
        [`${model.label} peaks`, String(am.peaks.length)],
        ["Assignment", am.confidence === "none" ? am.confidenceText : `${CONFIDENCE[am.confidence].label} · ${am.confidenceText}`],
      ],
      foot: "Amide on the ¹H–¹⁵N floor",
    };
  }, [hover, model, dark, slicePlane, slice, at, tol, theme.muted]);

  // ------------------------------------------------------------ render
  if (!exps.length || !model) {
    return (
      <div className={styles.emptyCard}>
        <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true">
          <path d="M10 18l14-8 14 8v16l-14 8-14-8z M10 18l14 8 14-8 M24 26v16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
        <strong>No triple-resonance peaks to place in 3D</strong>
        <p>
          The cube needs the assigned peak list of an HNCA, HNCACB, CBCA(CO)NH, HNCO or HN(CA)CO. Add one under Spectra and peak lists, or import a protein
          from the ARTINA library, to see its strips in 3D.
        </p>
        {onShowView && project.hsqc.length > 0 && (
          <button type="button" className={styles.iconButton} onClick={() => onShowView("hsqc")}>
            Show the ¹H–¹⁵N HSQC
          </button>
        )}
      </div>
    );
  }

  const tableRows = (() => {
    const rows = model.peaks.filter((q) => slice === "off" || at == null || Math.abs((slice === "n" ? q.n : q.c) - at) <= tol);
    return rows.sort((a, b) => (a.resi ?? 1e9) - (b.resi ?? 1e9) || Number(a.root) - Number(b.root) || b.c - a.c);
  })();
  const sliceName = slice === "n" ? "¹H–¹³C plane at ¹⁵N" : "¹H–¹⁵N plane at ¹³C";
  const loading = (realMeta && slice !== "off" && (sliceLoading || !slicePlane)) || (hsqcMeta && hsqcLoading && !hsqcPlane);
  const selTag = selAmide?.tag ?? (selResi != null ? `residue ${selResi}` : null);

  return (
    <div className={styles.cube}>
      <div className={styles.chips} role="group" aria-label="Experiment">
        {exps.map((t) => (
          <button key={t} type="button" className={styles.chip} aria-pressed={t === tp} onClick={() => setTpPick(t)} title={`Show ${experimentLabel(t, project)} peaks`}>
            {experimentLabel(t, project)}
          </button>
        ))}
      </div>
      <div className={styles.cubeBar}>
        <div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Slice plane</span>
            <div className={styles.segmented} role="group" aria-label="Slice plane">
              <button type="button" aria-pressed={slice === "n"} onClick={() => setSlice("n")} title="¹H–¹³C strip plane, stepped through ¹⁵N">
                ¹H–¹³C @ ¹⁵N
              </button>
              <button type="button" aria-pressed={slice === "c"} onClick={() => setSlice("c")} title="¹H–¹⁵N plane, stepped through ¹³C">
                ¹H–¹⁵N @ ¹³C
              </button>
              <button type="button" aria-pressed={slice === "off"} onClick={() => setSlice("off")} title="Hide the slice plane">
                Off
              </button>
            </div>
          </div>
        </div>
        <div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>View</span>
            <div className={styles.segmented} role="group" aria-label="Camera">
              {PRESETS.map((v) => (
                <button key={v.id} type="button" title={v.title} onClick={() => sceneRef.current?.view(v.id)}>
                  {v.label}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            className={`${styles.iconButton} ${styles.square}`}
            onClick={() => {
              sceneRef.current?.view("home");
              setAtPick({ n: null, c: null });
            }}
            title="Reset the view and put the slice plane back on the selected strip"
            aria-label="Reset view"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
              <path d="M2.6 8a5.4 5.4 0 1 0 1.6-3.85" strokeLinecap="round" />
              <path d="M3.4 1.9v2.6H6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-pressed={spin}
            onClick={() => setSpinPref(!spin)}
            title={spin ? "Stop the gentle rotation" : "Gently sway the cube"}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
              <ellipse cx="8" cy="8.6" rx="6.2" ry="2.7" />
              <path d="M11.4 4.2l2.1 1.6-2.5.9" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="8" cy="8.6" r="1.3" fill="currentColor" stroke="none" />
            </svg>
            Rotate
          </button>
        </div>
      </div>

      {/* always present (same height) so picking a strip never shifts the cube */}
      <div ref={sliderRef} className={styles.sliceBar} title="Scroll, drag, press [ and ] or drag the rose handle in the cube">
        {slice !== "off" && at != null ? (
          <>
            <button type="button" className={styles.iconButton} onClick={() => stepSlice(-1)} aria-label="Previous plane">
              ‹
            </button>
            <input
              type="range"
              className={styles.range}
              min={lo}
              max={hi}
              step={step}
              value={at}
              onChange={(e) => setAtPick((prev) => ({ ...prev, [slice]: snap(Number(e.target.value)) }))}
              aria-label={`${nucLabel(sliceLabel)} position of the slice plane (ppm)`}
              style={{ accentColor: "var(--spx-rose)" }}
            />
            <button type="button" className={styles.iconButton} onClick={() => stepSlice(1)} aria-label="Next plane">
              ›
            </button>
            <span className={styles.slicePpm}>
              {nucLabel(sliceLabel)} <strong>{at.toFixed(slice === "c" ? 1 : 2)}</strong> ppm
            </span>
          </>
        ) : (
          <span className={styles.cubeIdle}>
            {model.assigned ? "Click a peak or a residue to follow its strip — the slice plane moves with it." : "Pick a slice plane to step through the spectrum."}
          </span>
        )}
      </div>

      {!model.assigned && (
        <div className={styles.cubeNotice} role="status">
          <span>
            No assignment yet, so the peaks are shown unlabelled (grey, by phase). Add the assigned peak list of a spectrum to colour the strips by peak type
            and trace the sequential walk.
          </span>
          {onShowView && (
            <button type="button" className={styles.iconButton} onClick={() => onShowView("hsqc")}>
              Show HSQC
            </button>
          )}
        </div>
      )}

      {showTable && (
        <DataTable
          caption={`${model.label} peaks${slice !== "off" ? " in the slice" : ""}`}
          rows={tableRows}
          rowKey={(r) => r.id}
          selected={(r) => !!selAmide && r.amide === selAmide.index}
          onRow={(r) => select({ kind: "peak", index: r.index })}
          columns={[
            { key: "res", label: "Residue", render: (r) => (r.resi != null ? r.tag : "—") },
            { key: "root", label: "Spin system", num: true, render: (r) => r.root },
            {
              key: "peak",
              label: "Peak",
              render: (r) => (
                <span className={styles.swatchCell}>
                  <Swatch color={peakColor(r.kind, r.rel, r.inty, dark)} />
                  {peakTypeLabel(r.kind, r.rel)}
                </span>
              ),
            },
            { key: "h", label: "¹H (ppm)", num: true, render: (r) => r.h.toFixed(3) },
            { key: "n", label: "¹⁵N (ppm)", num: true, render: (r) => r.n.toFixed(2) },
            { key: "c", label: "¹³C (ppm)", num: true, render: (r) => r.c.toFixed(2) },
            { key: "i", label: "Intensity", num: true, render: (r) => fmtInty(r.inty) },
          ]}
        />
      )}

      <div
        className={styles.cubeStage}
        style={{ display: showTable ? "none" : undefined }}
        tabIndex={0}
        role="application"
        aria-label={`${model.label} as a rotatable 3D cube: ${model.peaks.length} peaks above ${model.amides.length} amides${selTag ? `, ${selTag} selected` : ""}. Arrow keys step residues, [ and ] move the slice plane.`}
        onKeyDown={onKeyDown}
      >
        {!ready && !failed && (
          <div className={styles.cubeSkeleton} aria-hidden="true">
            <svg viewBox="0 0 120 112" width="132" height="124">
              <path d="M22 34 L74 18 L104 34 L104 84 L52 100 L22 84 Z" fill="none" />
              <path d="M22 34 L52 50 L104 34 M52 50 L52 100" fill="none" />
              <path d="M22 84 L52 100 L104 84" fill="none" className="spx-skFloor" />
              <path d="M40 60 v-18 M58 66 v-30 M76 58 v-22 M88 52 v-12" fill="none" className="spx-skStem" />
            </svg>
            <span>Preparing the 3D view…</span>
          </div>
        )}
        <div ref={hostRef} className={styles.cubeCanvas} style={{ opacity: ready ? 1 : 0 }} />
        <div ref={overlayRef} className={styles.cubeOverlay} aria-hidden="true" />
        {ready && !selAmide && model.assigned && <span className={styles.hint}>Drag to rotate · click a peak</span>}
        <div ref={tipRef} className={styles.cubeTip} style={{ visibility: "hidden" }}>
          <Tooltip t={tip} />
        </div>
        {loading && <span className={styles.cubeStatus}>Loading spectrum…</span>}
        {failed && (
          <div className={styles.cubeFallback}>
            <p>
              <strong>3D view unavailable</strong>
              <br />
              {failed}. The Strips tab shows the same data in 2D.
            </p>
          </div>
        )}
      </div>

      <div className={styles.below}>
        <div className={styles.legend} role="list" aria-label="Peak types">
          {model.types
            .flatMap((t) =>
              t.kind === "other"
                ? [1, -1].filter((sign) => model.peaks.some((q) => q.kind === "other" && Math.sign(q.inty || 1) === sign)).map((sign) => ({ ...t, sign }))
                : [{ ...t, sign: 1 }],
            )
            .map((t) => (
              <span key={`${t.kind}${t.rel}${t.sign}`} className={styles.legendItem} role="listitem">
                <span className={styles.sphere} style={{ background: sphereBg(peakColor(t.kind, t.rel, t.sign, dark)) }} />
                {t.kind === "other" ? `unclassified, ${t.sign > 0 ? "positive" : "negative"}` : peakTypeLabel(t.kind, t.rel)}
              </span>
            ))}
          {arcs.length > 0 && (
            <>
              <span className={styles.legendItem}>
                <span className={styles.legendLine} style={{ color: "var(--spx-ink)", opacity: 0.7, borderTopWidth: 2.5 }} /> linked walk
              </span>
              <span className={styles.legendItem}>
                <span className={styles.legendLine} style={{ color: "var(--spx-muted)", borderTopStyle: "dashed", borderTopWidth: 2.5 }} /> not linked
              </span>
            </>
          )}
          {slice !== "off" && (
            <span className={styles.legendItem}>
              <span
                className={styles.legendDot}
                style={{ borderRadius: 3, background: "color-mix(in srgb, var(--spx-rose) 22%, transparent)", boxShadow: "inset 0 0 0 1.5px var(--spx-rose)" }}
              />
              slice ±{tol.toFixed(slice === "c" ? 1 : 2)} ppm
            </span>
          )}
        </div>
        {model.assigned && <ConfidenceLegend title="Amide rings:" />}
      </div>
      <Caption title={`${model.label} · strips in 3D`}>
        Each amide of the ¹H–¹⁵N HSQC on the floor carries its {model.label} peaks on a stem, so every column is one strip.{" "}
        {model.assigned ? (
          <>
            Cα is green, Cβ violet and C′ teal: deep tones are residue <em>i</em>, light tones <em>i</em>−1.{" "}
          </>
        ) : (
          "Until an assigned peak list labels them, peaks are grey (positive) or lilac (negative phase). "
        )}
        {slice !== "off" && at != null && (
          <>
            The rose plane is the {sliceName} <strong>{at.toFixed(slice === "c" ? 1 : 2)} ppm</strong>; peaks within ±{tol.toFixed(slice === "c" ? 1 : 2)} ppm
            glow.{" "}
          </>
        )}
        {arcs.length > 0 && selTag && (
          <>
            Arcs follow the sequential walk around <strong>{selTag}</strong>: each strip’s <em>i</em>−1 peak should meet the <em>i</em> peak of the previous
            residue’s strip (solid where the assignment links them).{" "}
          </>
        )}
        {realMeta || hsqcMeta ? (
          <>
            Contours are the measured {[hsqcMeta?.name, realMeta?.name].filter(Boolean).join(" and ")} spectra
            {project.attribution && (
              <>
                {" "}
                (
                <a href={project.attribution.url} target="_blank" rel="noreferrer" title={project.attribution.text}>
                  {project.attribution.license}
                </a>
                )
              </>
            )}
            .{" "}
          </>
        ) : (
          "Contours are synthesised from the listed peaks. "
        )}
        Drag to rotate, scroll to zoom; drag the rose handle or press [ ] to move the plane.
      </Caption>
    </div>
  );
}
