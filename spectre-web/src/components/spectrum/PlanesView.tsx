"use client";
// "Spectra" tab: browser for the project's real processed spectra (e.g. the ARTINA dataset).
// 2D spectra show directly; 3D spectra show a chosen axis pair either as a projection or as a
// slice stepped through the third dimension (slider, wheel, [ ] keys). Assigned peaks from the
// engine are overlaid where the plane makes sense.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealSpectrumMeta } from "@/lib/contract";
import { overlayForPlane, type PlaneDatum } from "@/lib/viz/data";
import { nucLabel, snrColorbar } from "@/lib/viz/real";
import { stepResidue, type ViewCommonProps } from "./HsqcView";
import { PlaneView, type PlaneWindow } from "./PlaneView";
import { CONFIDENCE } from "@/lib/contract";
import { Caption, Colorbar, ConfidenceLegend, DataTable, Swatch } from "./parts";
import { styles } from "./styles";
import { useRealPlane } from "./useReal";

export interface PlanesViewProps extends ViewCommonProps {
  planeSpectrum?: string | null;
  planeAt?: number | null;
  onPlaneChange?: (name: string | null, at: number | null) => void;
}

interface PairOption {
  id: string;
  x: number;
  y: number;
  label: string;
}

const SIGMAS = [3, 5, 8, 12, 20];

/** "ARTINA NMR spectra dataset — Klukowski P, …" → "ARTINA NMR spectra dataset" */
function shortAttribution(text: string): string {
  const head = text.split(/\s[—–-]\s|:\s|\.\s/)[0].trim();
  return head.length > 48 ? `${head.slice(0, 46)}…` : head;
}

function axisName(meta: RealSpectrumMeta, dim: number): string {
  const lab = meta.axes[dim].label;
  const dup = meta.axes.filter((a) => a.label === lab).length > 1;
  return dup ? `${nucLabel(lab)}${dim === meta.ndim - 1 ? "" : "′"}` : nucLabel(lab);
}

function pairOptions(meta: RealSpectrumMeta): PairOption[] {
  if (meta.ndim === 2) return [{ id: "1-0", x: 1, y: 0, label: `${axisName(meta, 1)} · ${axisName(meta, 0)}` }];
  const direct = meta.ndim - 1;
  const others = Array.from({ length: meta.ndim }, (_, k) => k).filter((k) => k !== direct);
  const out: PairOption[] = others.map((y) => ({ id: `${direct}-${y}`, x: direct, y, label: `${axisName(meta, direct)} · ${axisName(meta, y)}` }));
  // the indirect pair (e.g. 15N · 13C), x = the less-crowded axis by convention (15N)
  if (others.length === 2) {
    const [a, b] = others;
    const nIdx = meta.axes[a].label === "15N" ? a : meta.axes[b].label === "15N" ? b : a;
    const cIdx = nIdx === a ? b : a;
    out.push({ id: `${nIdx}-${cIdx}`, x: nIdx, y: cIdx, label: `${axisName(meta, nIdx)} · ${axisName(meta, cIdx)}` });
  }
  return out;
}

function defaultPair(meta: RealSpectrumMeta, opts: PairOption[]): PairOption {
  const hn = opts.find((o) => {
    const l = new Set([meta.axes[o.x].label, meta.axes[o.y].label]);
    return l.has("1H") && l.has("15N");
  });
  return hn ?? opts[0];
}

function preferredSpectrum(list: RealSpectrumMeta[]): RealSpectrumMeta | undefined {
  return list.find((s) => s.ndim === 3 && s.engineType) ?? list.find((s) => s.ndim === 2) ?? list[0];
}

export function PlanesView(p: PlanesViewProps) {
  const {
    project,
    roots,
    residues,
    width,
    dark,
    selectedResidue,
    selectedRoot,
    highlightResidues,
    onSelectResidue,
    onSelectRoot,
    planeSpectrum,
    planeAt,
    onPlaneChange,
  } = p;
  const list = useMemo(() => project.realSpectra ?? [], [project.realSpectra]);

  // ------------------------------------------------------------ controlled-or-local state
  const [name, setName] = useState<string | null>(() => planeSpectrum ?? preferredSpectrum(list)?.name ?? null);
  const [at, setAt] = useState<number | null>(planeAt ?? null);
  const [seenProps, setSeenProps] = useState({ s: planeSpectrum, a: planeAt });
  if (seenProps.s !== planeSpectrum || seenProps.a !== planeAt) {
    setSeenProps({ s: planeSpectrum, a: planeAt });
    if (planeSpectrum !== undefined && planeSpectrum !== null && planeSpectrum !== name) setName(planeSpectrum);
    if (planeAt !== undefined && planeAt !== null) setAt(planeAt);
  }
  const meta = list.find((s) => s.name === name) ?? preferredSpectrum(list);
  const opts = useMemo(() => (meta ? pairOptions(meta) : []), [meta]);
  const [pairId, setPairId] = useState<string | null>(null);
  const pair = (meta && opts.find((o) => o.id === pairId)) || (meta ? defaultPair(meta, opts) : null);
  const [modePref, setModePref] = useState<"projection" | "slice" | null>(null);
  const third = meta && pair && meta.ndim === 3 ? [0, 1, 2].find((k) => k !== pair.x && k !== pair.y)! : null;
  const thirdAxis = meta && third != null ? meta.axes[third] : null;
  const pairIsHN = !!(
    meta &&
    pair &&
    new Set([meta.axes[pair.x].label, meta.axes[pair.y].label]).size === 2 &&
    [meta.axes[pair.x].label, meta.axes[pair.y].label].every((l) => l === "1H" || l === "15N")
  );
  const mode: "projection" | "slice" = meta?.ndim === 3 ? (modePref ?? (pairIsHN ? "projection" : "slice")) : "projection";
  const [sigmaPick, setSigma] = useState<number | null>(null);
  const [heat, setHeat] = useState(true);

  // a max-projection lifts the noise floor (max of many planes), so start contours higher there
  const sigma = sigmaPick ?? (meta?.ndim === 3 && mode === "projection" ? 8 : 5);
  const step = thirdAxis ? Math.abs(thirdAxis.ppmMax - thirdAxis.ppmMin) / Math.max(1, thirdAxis.size - 1) : 0;
  // clamp to the axis and snap to its plane grid so stepping visits every plane exactly once
  const clampAt = useCallback(
    (v: number) => {
      if (!thirdAxis) return v;
      const c = Math.min(thirdAxis.ppmMax, Math.max(thirdAxis.ppmMin, v));
      if (!(step > 0)) return c;
      return thirdAxis.ppmMax - Math.round((thirdAxis.ppmMax - c) / step) * step;
    },
    [thirdAxis, step],
  );

  // slice position follows the selected spin system (its 15N for ¹H·¹³C, its ¹H for ¹⁵N·¹³C)
  const selInfo = selectedRoot
    ? roots.get(selectedRoot)
    : residues.find((r) => r.resi === selectedResidue && r.root)
      ? roots.get(residues.find((r) => r.resi === selectedResidue)!.root!)
      : undefined;
  const followKey = `${selInfo?.root ?? ""}|${thirdAxis?.label ?? ""}|${name ?? ""}`;
  const [prevFollow, setPrevFollow] = useState(followKey);
  if (prevFollow !== followKey) {
    setPrevFollow(followKey);
    if (selInfo?.spin && thirdAxis && meta?.engineType) {
      const v = thirdAxis.label === "15N" ? selInfo.spin.n : thirdAxis.label === "1H" ? selInfo.spin.h : null;
      if (v != null) setAt(Math.min(thirdAxis.ppmMax, Math.max(thirdAxis.ppmMin, v)));
    }
  }
  const atValue = thirdAxis ? clampAt(at ?? (thirdAxis.ppmMax + thirdAxis.ppmMin) / 2) : null;

  // debounce slider moves so dragging doesn't flood the server
  const [atQuery, setAtQuery] = useState<number | null>(atValue);
  useEffect(() => {
    const t = setTimeout(() => setAtQuery(atValue), 90);
    return () => clearTimeout(t);
  }, [atValue]);

  const query = meta && pair ? { x: pair.x, y: pair.y, mode, at: mode === "slice" ? atQuery : null, maxPoints: 512 } : null;
  const { plane, loading, error } = useRealPlane(project.id, meta?.name, query);

  const commit = useCallback(
    (n: string | null, a: number | null) => {
      onPlaneChange?.(n, a);
    },
    [onPlaneChange],
  );

  const changeSpectrum = (n: string) => {
    setName(n);
    setPairId(null);
    setModePref(null);
    commit(n, null);
  };
  const changeAt = (v: number) => {
    const c = clampAt(v);
    setAt(c);
    commit(meta?.name ?? null, c);
  };
  const stepPlane = (dir: number) => {
    if (!thirdAxis || atValue == null) return;
    if (mode !== "slice") setModePref("slice");
    changeAt(atValue + dir * step);
  };

  const sliderRef = useRef<HTMLDivElement>(null);
  const stepRef = useRef(stepPlane);
  useEffect(() => {
    stepRef.current = stepPlane;
  });
  useEffect(() => {
    const el = sliderRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stepRef.current(e.deltaY > 0 ? -1 : 1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [thirdAxis]);

  const data: PlaneDatum[] = useMemo(
    () => (meta && pair ? overlayForPlane(project, roots, meta, pair.x, pair.y, mode, mode === "slice" ? atValue : null) : []),
    [meta, pair, project, roots, mode, atValue],
  );

  // default view: the region holding assigned peaks (keeps the water ridge and empty margins
  // out of the first impression); the whole axis when nothing is overlaid
  const win: PlaneWindow | null = useMemo(() => {
    if (!meta || !pair) return null;
    const ax = meta.axes[pair.x];
    const ay = meta.axes[pair.y];
    const full = { x0: ax.ppmMax, x1: ax.ppmMin, y0: ay.ppmMin, y1: ay.ppmMax };
    const peaks = mode === "projection" || meta.ndim === 2 ? data : overlayForPlane(project, roots, meta, pair.x, pair.y, "projection", null);
    if (peaks.length < 3) return full;
    const pad = (label: string) => (label === "1H" ? 0.45 : label === "15N" ? 3 : 4);
    const xs = peaks.map((d) => d.x);
    const ys = peaks.map((d) => d.y);
    return {
      x0: Math.min(ax.ppmMax, Math.max(...xs) + pad(ax.label)),
      x1: Math.max(ax.ppmMin, Math.min(...xs) - pad(ax.label)),
      y0: Math.max(ay.ppmMin, Math.min(...ys) - pad(ay.label)),
      y1: Math.min(ay.ppmMax, Math.max(...ys) + pad(ay.label)),
    };
  }, [meta, pair, mode, data, project, roots]);

  const onPick = useCallback(
    (d: PlaneDatum) => {
      if (d.root) onSelectRoot(d.root);
      onSelectResidue(d.resi);
    },
    [onSelectRoot, onSelectResidue],
  );
  const onClear = useCallback(() => {
    onSelectRoot(null);
    onSelectResidue(null);
  }, [onSelectRoot, onSelectResidue]);
  const onStep = useCallback(
    (dir: 1 | -1) => {
      const r = stepResidue(residues, selectedResidue, dir);
      if (!r) return;
      onSelectResidue(r.resi);
      onSelectRoot(r.root ?? null);
    },
    [residues, selectedResidue, onSelectResidue, onSelectRoot],
  );

  if (!list.length || !meta || !pair || !win) {
    return (
      <div className={styles.emptyCard}>
        <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true">
          <path d="M6 40h36M10 36c4-18 6-26 8-26s4 22 6 22 3-10 5-10 3 14 5 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <strong>No measured spectra in this project yet</strong>
        <p>
          Upload your own NMRPipe spectra, or import a protein from the ARTINA library (100 proteins with real processed 2D and 3D spectra and
          structures, CC BY 4.0), for example by asking the assistant to <em>“import 2K50 from ARTINA”</em>.
        </p>
        <a href="https://nmrdb.ethz.ch/" target="_blank" rel="noreferrer">
          Browse the ARTINA dataset ↗
        </a>
      </div>
    );
  }

  const xAx = meta.axes[pair.x];
  const yAx = meta.axes[pair.y];
  const xName = axisName(meta, pair.x);
  const yName = axisName(meta, pair.y);
  const cb = plane ? snrColorbar(plane, sigma, dark) : null;
  const plotW = Math.max(220, Math.min(600, width - 74));
  const atPpm = plane?.at && third != null ? (plane.at[String(third)] ?? atValue) : atValue;

  return (
    <div
      className={styles.planes}
      onKeyDown={(e) => {
        if (e.key === "]" || e.key === "PageUp") {
          e.preventDefault();
          stepPlane(1);
        } else if (e.key === "[" || e.key === "PageDown") {
          e.preventDefault();
          stepPlane(-1);
        }
      }}
    >
      <div className={styles.controls}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Spectrum</span>
          <select className={styles.select} value={meta.name} onChange={(e) => changeSpectrum(e.target.value)}>
            {list.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
                {s.experiment && s.experiment !== s.name ? ` · ${s.experiment}` : ""} · {s.ndim}D
              </option>
            ))}
          </select>
        </label>
        {opts.length > 1 && (
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Plane</span>
            <div className={styles.segmented} role="group" aria-label="Axis pair">
              {opts.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={o.id === pair.id}
                  onClick={() => {
                    setPairId(o.id);
                    setModePref(null);
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {meta.ndim === 3 && (
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Mode</span>
            <div className={styles.segmented} role="group" aria-label="Projection or slice">
              <button type="button" aria-pressed={mode === "projection"} onClick={() => setModePref("projection")}>
                Projection
              </button>
              <button type="button" aria-pressed={mode === "slice"} onClick={() => setModePref("slice")}>
                Slice
              </button>
            </div>
          </div>
        )}
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Contours from</span>
          <select className={styles.select} value={sigma} onChange={(e) => setSigma(Number(e.target.value))}>
            {SIGMAS.map((s) => (
              <option key={s} value={s}>
                {s} σ
              </option>
            ))}
          </select>
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={heat} onChange={(e) => setHeat(e.target.checked)} /> Heat map
        </label>
      </div>

      {meta.ndim === 3 && thirdAxis && mode === "slice" && atValue != null && (
        <div ref={sliderRef} className={styles.sliceBar} title="Scroll, drag or press [ and ] to step through planes">
          <button type="button" className={styles.iconButton} onClick={() => stepPlane(-1)} aria-label="Previous plane">
            ‹
          </button>
          <input
            type="range"
            className={styles.range}
            min={thirdAxis.ppmMin}
            max={thirdAxis.ppmMax}
            step={step || 0.01}
            value={atValue}
            onChange={(e) => changeAt(Number(e.target.value))}
            aria-label={`${axisName(meta, third!)} slice position (ppm)`}
          />
          <button type="button" className={styles.iconButton} onClick={() => stepPlane(1)} aria-label="Next plane">
            ›
          </button>
          <span className={styles.slicePpm}>
            {axisName(meta, third!)} <strong>{(atPpm ?? atValue).toFixed(thirdAxis.label === "1H" ? 3 : 2)}</strong> ppm
          </span>
        </div>
      )}

      {p.showTable ? (
        <DataTable
          caption={`Assigned peaks on ${meta.name}`}
          rows={data}
          rowKey={(r) => r.id}
          selected={(r) => r.root === selectedRoot || (selectedResidue != null && r.resi === selectedResidue)}
          onRow={onPick}
          columns={[
            { key: "p", label: "Peak", render: (r) => r.title },
            { key: "x", label: `${xName} (ppm)`, num: true, render: (r) => r.x.toFixed(xAx.label === "1H" ? 3 : 2) },
            { key: "y", label: `${yName} (ppm)`, num: true, render: (r) => r.y.toFixed(yAx.label === "1H" ? 3 : 2) },
            {
              key: "c",
              label: "Confidence",
              render: (r) =>
                r.confidence === "none" ? (
                  "—"
                ) : (
                  <span className={styles.swatchCell}>
                    <Swatch color={CONFIDENCE[r.confidence].color} />
                    {CONFIDENCE[r.confidence].label}
                  </span>
                ),
            },
          ]}
        />
      ) : error && !plane ? (
        <div className={styles.emptyCard}>
          <strong>Could not load {meta.name}</strong>
          <p>{error}</p>
        </div>
      ) : (
        <PlaneView
          data={data}
          defaultWindow={win}
          minSpan={{ x: xAx.label === "1H" ? 0.1 : 0.8, y: yAx.label === "1H" ? 0.1 : 0.8 }}
          linewidth={{ x: 0.03, y: 0.3 }}
          xTitle={`${xName} (ppm)`}
          yTitle={`${yName} (ppm)`}
          xName={xName}
          yName={yName}
          xDecimals={xAx.label === "1H" ? 3 : 2}
          yDecimals={yAx.label === "1H" ? 3 : 2}
          selectedId={selectedRoot}
          selectedResidue={selectedResidue}
          highlightResidues={highlightResidues}
          onPick={onPick}
          onClear={onClear}
          onStep={onStep}
          width={width}
          ariaLabel={`${meta.name} ${mode === "slice" ? "slice" : "projection"}, ${xName} against ${yName}`}
          emptyText={loading ? "Loading spectrum…" : "No data"}
          real={plane}
          baseSigma={sigma}
          heat={heat}
          loading={loading}
          ringMarkers
        >
          <div className={styles.below} style={{ width: plotW + 74 }}>
            {cb && <Colorbar stops={cb.stops} width={Math.min(420, plotW * 0.8)} title="Signal-to-noise (log scale)" ticks={cb.ticks} />}
            <div className={styles.legend}>
              <span className={styles.legendItem}>
                <span className={styles.legendLine} style={{ color: "var(--spx-pos)" }} /> positive contours
              </span>
              <span className={styles.legendItem}>
                <span className={styles.legendLine} style={{ color: "var(--spx-neg)" }} /> negative contours
              </span>
              <span className={styles.legendItem} style={{ color: "var(--spx-muted)" }}>
                {sigma}σ × 1.4ⁿ
              </span>
            </div>
            {data.length > 0 && <ConfidenceLegend title={`${data.length} assigned ${data.length === 1 ? "peak" : "peaks"}:`} extras={undefined} />}
          </div>
          <Caption title={`${meta.experiment || meta.name}${meta.experiment && meta.experiment !== meta.name ? ` · ${meta.name}` : ""}`}>
            {meta.ndim}D spectrum, {meta.axes.map((a) => `${nucLabel(a.label)} ${a.size}`).join(" × ")} points, {meta.sizeMB.toFixed(1)} MB.{" "}
            {meta.ndim === 3
              ? mode === "slice"
                ? `Showing the ${xName}–${yName} plane at ${axisName(meta, third!)} ${(atPpm ?? 0).toFixed(2)} ppm; scroll the slider or press [ ] to step.`
                : `Showing the ${xName}–${yName} projection (maximum through ${axisName(meta, third!)}).`
              : "Processed 2D spectrum."}{" "}
            Contours start at <strong>{sigma}σ</strong> of the noise and grow ×1.4.
            {project.attribution && (
              <>
                {" "}
                Data:{" "}
                <a href={project.attribution.url} target="_blank" rel="noreferrer" title={project.attribution.text}>
                  {shortAttribution(project.attribution.text)}
                </a>{" "}
                ({project.attribution.license}).
              </>
            )}
          </Caption>
        </PlaneView>
      )}
    </div>
  );
}
