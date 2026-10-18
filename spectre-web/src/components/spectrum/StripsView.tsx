"use client";
// Sequential "walk" strip plot: one 1H/13C strip per residue (and per experiment of a pair),
// with connectors joining the i-1 carbons of residue i to the i carbons of residue i-1.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CONFIDENCE } from "@/lib/contract";
import { EXPERIMENTS } from "@/lib/spectra/experiments";
import { PHASE, ramp, rampAt, readTokens, rgbToCss } from "@/lib/viz/colors";
import { computeContours, gridMapper, traceContour, type GridToPixel } from "@/lib/viz/contours";
import { availablePairs, buildStrips, experimentLabel, residueTag, type Strip, type StripPeak } from "@/lib/viz/data";
import { noiseLevels, realSpectrumFor } from "@/lib/viz/real";
import { geometricLevels, pseudoVoigt, synthPlane, type Plane } from "@/lib/viz/synth";
import { stepResidue, type ViewCommonProps } from "./HsqcView";
import { prepareCanvas, useThemeVersion } from "./hooks";
import { Axes, Caption, DataTable, Tooltip, type TooltipState } from "./parts";
import { styles } from "./styles";
import { useRealStrips, type StripRequest } from "./useReal";

const M = { left: 60, right: 10, top: 54, bottom: 14 };
const GROUP_GAP = 12;
const SUB_GAP = 3;
const H_HALF = 0.11; // ppm half-width of a strip in 1H

const SHORT: Record<string, string> = {
  "CA(i)": "Cα",
  "CA(i-1)": "Cα i−1",
  "CB(i)": "Cβ",
  "CB(i-1)": "Cβ i−1",
  "CO(i)": "C′",
  "CO(i-1)": "C′ i−1",
};

interface StripGeom {
  strip: Strip;
  x: number; // left px inside plot
  w: number;
  group: number;
}

export function StripsView(p: ViewCommonProps) {
  const { project, roots, residues, width, showTable, selectedResidue, highlightResidues, onSelectResidue, onSelectRoot } = p;
  const pairs = useMemo(() => availablePairs(project), [project]);
  const [pairId, setPairId] = useState<string>(() => pairs[0]?.id ?? "ca");
  const pair = pairs.find((x) => x.id === pairId) ?? pairs[0];
  const specs = useMemo(() => pair?.specs ?? [], [pair]);
  const themeV = useThemeVersion();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  const [tip, setTip] = useState<TooltipState | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  const plotW = Math.max(240, Math.min(620, width - M.left - M.right));
  const plotH = Math.max(320, Math.min(560, Math.round(plotW * 0.92)));
  const totalW = plotW + M.left + M.right;
  const totalH = plotH + M.top + M.bottom;

  // residue window
  const nRes = width < 520 ? 5 : 7;
  const centre = useMemo(() => {
    if (selectedResidue != null) return selectedResidue;
    const firstGood = residues.find((r) => r.root && r.confidence === "veryHigh");
    return firstGood?.resi ?? residues[0]?.resi ?? project.firstResidue;
  }, [selectedResidue, residues, project.firstResidue]);
  const windowRes = useMemo(() => {
    const idx = Math.max(
      0,
      residues.findIndex((r) => r.resi === centre),
    );
    let start = Math.max(0, idx - Math.floor(nRes / 2));
    start = Math.min(start, Math.max(0, residues.length - nRes));
    return residues.slice(start, start + nRes);
  }, [residues, centre, nRes]);

  const stripsBySpec = useMemo(() => specs.map((tp) => buildStrips(project, tp, windowRes, roots)), [specs, project, windowRes, roots]);

  // carbon range across the shown strips
  const cRange = useMemo(() => {
    const cs: number[] = [];
    for (const list of stripsBySpec) for (const s of list) for (const pk of s.own) cs.push(pk.c);
    const win = EXPERIMENTS[specs[0] ?? "hnca"]?.window ?? [40, 70];
    if (!cs.length) return { top: win[0], bottom: win[1] };
    const lo = Math.max(win[0] - 2, Math.floor(Math.min(...cs) - 3));
    const hi = Math.min(win[1] + 2, Math.ceil(Math.max(...cs) + 3));
    return { top: lo, bottom: hi };
  }, [stripsBySpec, specs]);

  const geoms = useMemo(() => {
    const nSub = Math.max(1, specs.length);
    const groupW = (plotW - GROUP_GAP * (windowRes.length - 1)) / Math.max(1, windowRes.length);
    const w = (groupW - SUB_GAP * (nSub - 1)) / nSub;
    const out: StripGeom[] = [];
    windowRes.forEach((_, g) => {
      for (let k = 0; k < nSub; k++) {
        const strip = stripsBySpec[k]?.[g];
        if (!strip) continue;
        out.push({ strip, x: g * (groupW + GROUP_GAP) + k * (w + SUB_GAP), w, group: g });
      }
    });
    return { list: out, groupW };
  }, [specs.length, plotW, windowRes, stripsBySpec]);

  const yOf = useCallback((c: number) => ((c - cRange.top) / (cRange.bottom - cRange.top)) * plotH, [cRange, plotH]);

  // measured strips (ARTINA etc.) when the project carries the real spectrum of this experiment
  const realMeta = useMemo(() => Object.fromEntries(specs.map((tp) => [tp, realSpectrumFor(project, tp)])), [specs, project]);
  const stripReqs = useMemo(() => {
    const out: (StripRequest & { tp: string; root: string })[] = [];
    for (const gm of geoms.list) {
      const s = gm.strip;
      const meta = realMeta[s.tp];
      if (!meta || !s.root || s.h === undefined || s.n === undefined) continue;
      out.push({ key: `${meta.name}:${s.root}`, name: meta.name, h: s.h, n: s.n, hw: H_HALF, tp: s.tp, root: s.root });
    }
    return out;
  }, [geoms, realMeta]);
  const { strips: realStrips } = useRealStrips(project.id, stripReqs);
  const measured = specs.filter((tp) => realMeta[tp]);

  const linked = useCallback(
    (a?: string, b?: string) => {
      if (!a || !b) return false;
      const links = project.assignment?.links ?? {};
      return (links[a] ?? []).some((e) => e[0] === b && e[2] === "f") || (links[b] ?? []).some((e) => e[0] === a && e[2] === "b");
    },
    [project.assignment],
  );

  // ------------------------------------------------------------------ draw
  useEffect(() => {
    const ctx = prepareCanvas(canvasRef.current, plotW, plotH);
    if (!ctx) return;
    const t = readTokens(rootRef.current);
    const pos = ramp("green", t.dark);
    const neg = ramp("violet", t.dark);
    const phase = t.dark ? PHASE.dark : PHASE.light;
    ctx.fillStyle = t.surface;
    ctx.fillRect(0, 0, plotW, plotH);
    // selected residue band
    windowRes.forEach((r, g) => {
      if (r.resi !== selectedResidue && !highlightResidues.includes(r.resi)) return;
      ctx.fillStyle = t.ink;
      ctx.globalAlpha = r.resi === selectedResidue ? 0.05 : 0.03;
      ctx.fillRect(g * (geoms.groupW + GROUP_GAP) - 4, 0, geoms.groupW + 8, plotH);
      ctx.globalAlpha = 1;
    });
    // global max for consistent levels
    let maxAmp = 0;
    for (const gm of geoms.list) for (const pk of gm.strip.field) maxAmp = Math.max(maxAmp, Math.abs(pk.amp));
    maxAmp = maxAmp || 1;
    const levels = geometricLevels(maxAmp, 0.08, 1.85, 5);
    const ny = Math.max(120, Math.min(360, Math.round(plotH / 2)));
    for (const gm of geoms.list) {
      const s = gm.strip;
      // strip background
      ctx.fillStyle = t.dark ? "rgba(255,255,255,0.025)" : "rgba(11,11,11,0.022)";
      ctx.fillRect(gm.x, 0, gm.w, plotH);
      if (s.h === undefined || s.n === undefined || !s.field.length) {
        ctx.fillStyle = t.muted;
        ctx.font = `500 11px ${t.font}`;
        ctx.textAlign = "center";
        ctx.save();
        ctx.translate(gm.x + gm.w / 2, plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(s.note ?? "no peaks", 0, 4);
        ctx.restore();
        ctx.textAlign = "left";
        continue;
      }
      const realS = s.root && realMeta[s.tp] ? realStrips.get(`${realMeta[s.tp]!.name}:${s.root}`) : undefined;
      let plane: Plane;
      let map: GridToPixel;
      let posLevels = levels;
      let negLevels = levels;
      if (realS) {
        // measured strip: map its ppm grid onto the display scale
        plane = realS.plane;
        const sx = (realS.h.to - realS.h.from) / Math.max(1, plane.nx - 1);
        const sy = (realS.c.to - realS.c.from) / Math.max(1, plane.ny - 1);
        const left = s.h + H_HALF;
        map = {
          x: (gx) => gm.x + ((left - (realS.h.from + (gx - 0.5) * sx)) / (2 * H_HALF)) * gm.w,
          y: (gy) => yOf(realS.c.from + (gy - 0.5) * sy),
        };
        posLevels = noiseLevels(plane.max, realS.noise, 5, 1.6, 8);
        negLevels = noiseLevels(-plane.min, realS.noise, 5, 1.6, 8);
      } else {
        const nx = Math.max(12, Math.min(40, Math.round(gm.w / 2)));
        const cell = (cRange.bottom - cRange.top) / (ny - 1);
        const pxPerPpm = plotH / (cRange.bottom - cRange.top);
        const peaks = s.field.map((pk) => ({
          x: pk.h,
          y: pk.c,
          amp: pk.amp * pseudoVoigt(pk.n - s.n!, 0.32),
          fwhmX: Math.max(0.03, 0.42 * 2 * H_HALF),
          fwhmY: Math.max(0.32, 2.4 * cell, 15 / pxPerPpm),
        }));
        plane = synthPlane(peaks, { from: s.h + H_HALF, to: s.h - H_HALF, n: nx }, { from: cRange.top, to: cRange.bottom, n: ny });
        map = gridMapper(plane, gm.x, 0, gm.w, plotH);
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(gm.x, 0, gm.w, plotH);
      ctx.clip();
      const posSets = computeContours(plane, posLevels);
      posSets.forEach((c, k) => {
        const f = posSets.length > 1 ? k / (posSets.length - 1) : 1;
        ctx.strokeStyle = rgbToCss(rampAt(pos, t.dark ? 0.45 + 0.55 * f : 0.45 + 0.55 * f));
        ctx.lineWidth = 0.8 + 0.5 * f;
        traceContour(ctx, c, map);
        ctx.stroke();
      });
      if (negLevels.length && plane.min < -negLevels[0]) {
        const negSets = computeContours(plane, negLevels, true);
        negSets.forEach((c, k) => {
          const f = negSets.length > 1 ? k / (negSets.length - 1) : 1;
          ctx.strokeStyle = rgbToCss(rampAt(neg, 0.45 + 0.55 * f));
          ctx.lineWidth = 0.8 + 0.5 * f;
          traceContour(ctx, c, map);
          ctx.stroke();
        });
      }
      ctx.restore();
      // own peak markers + short labels
      for (const pk of s.own) {
        const Y = yOf(pk.c);
        if (Y < 0 || Y > plotH) continue;
        const X = gm.x + gm.w / 2;
        ctx.beginPath();
        ctx.arc(X, Y, 3, 0, Math.PI * 2);
        ctx.fillStyle = pk.amp >= 0 ? phase.pos : phase.neg;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = t.surface;
        ctx.stroke();
      }
    }
    // connectors between consecutive residues
    const main = geoms.list.filter((gm) => gm.strip.tp === specs[0]);
    const partner = specs[1] ? geoms.list.filter((gm) => gm.strip.tp === specs[1]) : [];
    const nuclei = pairId === "co" ? ["CO"] : pairId === "ca" ? ["CA"] : ["CA", "CB"];
    for (let g = 1; g < windowRes.length; g++) {
      const left = main.find((x) => x.group === g - 1);
      const right = main.find((x) => x.group === g);
      const rightPartner = partner.find((x) => x.group === g);
      if (!left || !right || !left.strip.root || !right.strip.root) continue;
      const ok = linked(left.strip.root, right.strip.root);
      for (const nuc of nuclei) {
        // best-matching pair among the classified (i) peaks of residue i-1 and (i-1) peaks of residue i
        const froms = left.strip.own.filter((pk) => pk.label === `${nuc}(i)`);
        const tos = [...right.strip.own, ...(rightPartner?.strip.own ?? [])].filter((pk) => pk.label === `${nuc}(i-1)`);
        let from: StripPeak | undefined;
        let to: StripPeak | undefined;
        let best = Infinity;
        for (const f of froms)
          for (const g of tos) {
            const d = Math.abs(f.c - g.c);
            if (d < best) {
              best = d;
              from = f;
              to = g;
            }
          }
        if (!from || !to) continue;
        const agree = best < 0.6;
        const x1 = left.x + left.w / 2;
        const x2 = (rightPartner ?? right).x + (rightPartner ?? right).w / 2;
        const y1 = yOf(from.c);
        const y2 = yOf(to.c);
        const strong = ok && agree;
        ctx.save();
        ctx.strokeStyle = strong ? t.ink : t.muted;
        ctx.globalAlpha = strong ? 0.55 : 0.55;
        ctx.lineWidth = strong ? 1.5 : 1;
        if (!strong) ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x1 + 4, y1);
        ctx.lineTo(x2 - 4, y2);
        ctx.stroke();
        ctx.restore();
      }
    }
    // short labels for the selected group (and all groups when strips are wide)
    ctx.font = `600 10px ${t.font}`;
    ctx.textBaseline = "middle";
    for (const gm of geoms.list) {
      if (gm.w < 30) continue;
      for (const pk of gm.strip.own) {
        const lab = SHORT[pk.label];
        if (!lab) continue;
        const Y = yOf(pk.c);
        if (Y < 8 || Y > plotH - 8) continue;
        const X = gm.x + gm.w / 2 + 6;
        const w = ctx.measureText(lab).width;
        if (X + w > gm.x + gm.w + GROUP_GAP - 2) continue;
        ctx.lineWidth = 3;
        ctx.strokeStyle = t.surface;
        ctx.strokeText(lab, X, Y - 8);
        ctx.fillStyle = t.ink2;
        ctx.fillText(lab, X, Y - 8);
      }
    }
  }, [
    geoms,
    plotW,
    plotH,
    cRange,
    yOf,
    specs,
    pairId,
    windowRes,
    selectedResidue,
    highlightResidues,
    linked,
    realMeta,
    realStrips,
    themeV,
  ]);

  // hover overlay
  const ownPeaks = useMemo(() => {
    const out: { key: string; gm: StripGeom; pk: StripPeak }[] = [];
    for (const gm of geoms.list) for (const pk of gm.strip.own) out.push({ key: `${gm.strip.tp}:${pk.name}`, gm, pk });
    return out;
  }, [geoms]);

  useEffect(() => {
    const ctx = prepareCanvas(overRef.current, plotW, plotH);
    if (!ctx || !hoverKey) return;
    const t = readTokens(rootRef.current);
    const h = ownPeaks.find((o) => o.key === hoverKey);
    if (!h) return;
    const X = h.gm.x + h.gm.w / 2;
    const Y = yOf(h.pk.c);
    ctx.strokeStyle = t.ink;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(Y) + 0.5);
    ctx.lineTo(plotW, Math.round(Y) + 0.5);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(X, Y, 6.5, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [hoverKey, ownPeaks, plotW, plotH, yOf, themeV]);

  const onMove = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    let best: (typeof ownPeaks)[number] | null = null;
    let bd = 12 * 12;
    for (const o of ownPeaks) {
      const dx = o.gm.x + o.gm.w / 2 - mx;
      const dy = yOf(o.pk.c) - my;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    setHoverKey(best?.key ?? null);
    if (!best) {
      setTip(null);
      return;
    }
    const s = best.gm.strip;
    const t = readTokens(rootRef.current);
    const phase = t.dark ? PHASE.dark : PHASE.light;
    setTip({
      x: M.left + best.gm.x + best.gm.w / 2,
      y: M.top + yOf(best.pk.c),
      flip: M.left + best.gm.x > totalW - 240,
      color: best.pk.amp >= 0 ? phase.pos : phase.neg,
      title: `${SHORT[best.pk.label] ?? (best.pk.label || "Unclassified")} · ${residueTag(s.resn, s.resi)}`,
      rows: [
        ["¹³C", `${best.pk.c.toFixed(2)} ppm`],
        ["¹H", `${best.pk.h.toFixed(3)} ppm`],
        ["¹⁵N", `${best.pk.n.toFixed(2)} ppm`],
        ["Phase", best.pk.amp >= 0 ? "positive" : "negative"],
        ["Spectrum", experimentLabel(s.tp, project)],
      ],
      foot: `Spin system ${s.root} · peak ${best.pk.name}`,
    });
  };

  const select = (resi: number) => {
    const r = residues.find((x) => x.resi === resi);
    onSelectResidue(resi);
    onSelectRoot(r?.root ?? null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const r = stepResidue(residues, centre, e.key === "ArrowRight" ? 1 : -1);
      if (r) select(r.resi);
    } else if (e.key === "Escape") {
      onSelectResidue(null);
      onSelectRoot(null);
    }
  };

  if (!pair || !project.assignment) {
    return (
      <div className={styles.empty} style={{ position: "relative", minHeight: 220 }}>
        {pair ? "No assignment yet: add the assigned peak list of a spectrum" : "No triple-resonance spectra in this project"}
      </div>
    );
  }

  const chips = (
    <div className={styles.chips} role="group" aria-label="Experiment pair">
      {pairs.map((x) => (
        <button key={x.id} type="button" className={styles.chip} aria-pressed={x.id === pair.id} onClick={() => setPairId(x.id)}>
          {x.specs.map((t) => experimentLabel(t, project)).join(" · ")}
        </button>
      ))}
    </div>
  );

  if (showTable) {
    const rows = geoms.list.flatMap((gm) => gm.strip.own.map((pk) => ({ gm, pk })));
    return (
      <>
        {chips}
        <DataTable
          caption="Strip peaks"
          rows={rows}
          rowKey={(r) => `${r.gm.strip.tp}:${r.pk.name}`}
          selected={(r) => r.gm.strip.resi === selectedResidue}
          onRow={(r) => select(r.gm.strip.resi)}
          columns={[
            { key: "res", label: "Residue", render: (r) => residueTag(r.gm.strip.resn, r.gm.strip.resi) },
            { key: "sp", label: "Spectrum", render: (r) => experimentLabel(r.gm.strip.tp, project) },
            { key: "lab", label: "Peak", render: (r) => SHORT[r.pk.label] ?? (r.pk.label || "—") },
            { key: "c", label: "¹³C (ppm)", num: true, render: (r) => r.pk.c.toFixed(2) },
            { key: "i", label: "Phase", render: (r) => (r.pk.amp >= 0 ? "+" : "−") },
          ]}
        />
      </>
    );
  }

  return (
    <figure className={styles.figure}>
      {chips}
      <div ref={rootRef} className={styles.plotWrap} style={{ width: totalW, height: totalH }}>
        <div className={styles.stripHeads} style={{ left: M.left, width: plotW, height: M.top }}>
          {windowRes.map((r, g) => {
            const gx = g * (geoms.groupW + GROUP_GAP);
            return (
              <button
                key={r.resi}
                type="button"
                className={styles.stripHead}
                data-selected={r.resi === selectedResidue ? "true" : "false"}
                style={{ left: gx, width: geoms.groupW, top: 2, border: 0, background: undefined, font: "inherit" }}
                onClick={() => select(r.resi)}
                aria-label={`Select ${residueTag(r.resn, r.resi)}`}
              >
                <span className={styles.stripRes}>{residueTag(r.resn, r.resi)}</span>
                <span className={styles.stripRoot}>
                  {r.resn === "P" ? "proline" : r.root ? (geoms.groupW < 84 ? `#${r.root}` : `spin system ${r.root}`) : geoms.groupW < 84 ? "—" : "unassigned"}
                </span>
                <span className={styles.stripBar} style={{ background: CONFIDENCE[r.confidence].color }} />
              </button>
            );
          })}
        </div>
        <div
          className={styles.plotFocus}
          style={{ left: M.left, top: M.top, width: plotW, height: plotH }}
          tabIndex={0}
          role="img"
          aria-label={`Strip plot of ${specs.map((t) => experimentLabel(t, project)).join(" and ")} for residues ${windowRes.map((r) => residueTag(r.resn, r.resi)).join(", ")}. Arrow keys move along the sequence.`}
          onPointerMove={onMove}
          onPointerLeave={() => {
            setHoverKey(null);
            setTip(null);
          }}
          onKeyDown={onKeyDown}
        >
          <canvas ref={canvasRef} className={styles.canvas} />
          <canvas ref={overRef} className={styles.canvas} />
        </div>
        <Axes
          total={{ width: totalW, height: totalH }}
          plot={{ left: M.left, top: M.top, width: plotW, height: plotH }}
          x={{ from: 0, to: 1, title: "", ticks: [] }}
          y={{ from: cRange.top, to: cRange.bottom, title: "¹³C (ppm)" }}
        />
        <Tooltip t={tip} />
      </div>
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.legendLine} style={{ color: "var(--spx-pos)" }} /> positive phase{pairId === "cacb" ? " (Cα)" : ""}
        </span>
        {pairId === "cacb" && (
          <span className={styles.legendItem}>
            <span className={styles.legendLine} style={{ color: "var(--spx-neg)" }} /> negative phase (Cβ)
          </span>
        )}
        <span className={styles.legendItem}>
          <span className={styles.legendLine} style={{ color: "var(--spx-ink)", opacity: 0.6 }} /> linked in the assignment
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendLine} style={{ color: "var(--spx-muted)", borderTopStyle: "dashed" }} /> not linked or shifts disagree
        </span>
      </div>
      <Caption title="Sequential walk">
        Strips of{" "}
        {specs.map((sp, k) => (
          <span key={sp}>
            {k > 0 && " and "}
            <strong>{experimentLabel(sp, project)}</strong>
          </span>
        ))}{" "}
        at each amide, ordered along the sequence{measured.length ? " (measured spectra)" : ""}. Lines join the{" "}
        {pairId === "co" ? "carbonyl" : pairId === "ca" ? "Cα" : "Cα and Cβ"} shifts of residue <em>i</em> with the <em>i−1</em> peaks of the next strip — the
        connectivity the assignment is built from. Click a header or use ←/→ to walk.
      </Caption>
    </figure>
  );
}
