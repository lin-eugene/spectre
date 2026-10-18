"use client";
// PAE-style residue × residue matrix of sequential-connectivity evidence: cell (i, j) shows how
// well the i-1 carbons of the spin system on residue j match the i carbons of residue i
// (exp(-χ²/2) over Cα, Cβ, C′). True neighbours form the band just above the diagonal; any
// other bright cell is an ambiguity the assignment had to resolve. Dots mark the sequential links
// of the assignment; the diagonal carries each residue's confidence colour.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CONFIDENCE } from "@/lib/contract";
import { GREEN_DARK, GREEN_LIGHT, ramp, rampAt, readTokens } from "@/lib/viz/colors";
import { buildMatrix, residueTag } from "@/lib/viz/data";
import { stepResidue, type ViewCommonProps } from "./HsqcView";
import { prepareCanvas, useThemeVersion } from "./hooks";
import { Axes, Caption, Colorbar, DataTable, Swatch, Tooltip, type TooltipState } from "./parts";
import { styles } from "./styles";

const M = { left: 62, right: 14, top: 8, bottom: 52 };

export function MatrixView(p: ViewCommonProps) {
  const { project, roots, residues, width, dark, showTable, selectedResidue, highlightResidues, onSelectResidue, onSelectRoot } = p;
  const model = useMemo(() => buildMatrix(project, residues, roots), [project, residues, roots]);
  const size = Math.max(220, Math.min(600, width - M.left - M.right));
  const totalW = size + M.left + M.right;
  const totalH = size + M.top + M.bottom;
  const n = model.n;
  const cell = size / Math.max(1, n);
  const themeV = useThemeVersion();
  const rootRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const [tip, setTip] = useState<TooltipState | null>(null);
  const index = useMemo(() => new Map(residues.map((r, k) => [r.resi, k])), [residues]);

  useEffect(() => {
    const ctx = prepareCanvas(baseRef.current, size, size);
    if (!ctx) return;
    const t = readTokens(rootRef.current);
    const g = ramp("green", t.dark);
    ctx.fillStyle = t.surface;
    ctx.fillRect(0, 0, size, size);
    // heat cells
    const img = document.createElement("canvas");
    img.width = n;
    img.height = n;
    const ictx = img.getContext("2d")!;
    const data = ictx.createImageData(n, n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = model.values[i * n + j] / model.maxValue;
        if (v <= 0) continue;
        const [r, gg, b] = rampAt(g, Math.min(1, 0.12 + 0.88 * Math.pow(v, 0.7)));
        const k = (i * n + j) * 4;
        data.data[k] = r;
        data.data[k + 1] = gg;
        data.data[k + 2] = b;
        data.data[k + 3] = 255;
      }
    }
    ictx.putImageData(data, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, size, size);
    // rows/columns with no spin system: faint wash so gaps read as "no data", not "no match"
    ctx.fillStyle = t.dark ? "rgba(255,255,255,0.035)" : "rgba(11,11,11,0.035)";
    residues.forEach((r, k) => {
      if (r.root) return;
      ctx.fillRect(k * cell, 0, cell, size);
      ctx.fillRect(0, k * cell, size, cell);
    });
    // diagonal: residue confidence
    residues.forEach((r, k) => {
      ctx.fillStyle = CONFIDENCE[r.confidence].color;
      ctx.fillRect(k * cell, k * cell, Math.max(1, cell), Math.max(1, cell));
    });
    // sequential links of the assignment
    const dot = Math.max(1.2, Math.min(2.6, cell * 0.24));
    for (const idx of model.links) {
      const i = Math.floor(idx / n);
      const j = idx % n;
      ctx.beginPath();
      ctx.arc((j + 0.5) * cell, (i + 0.5) * cell, dot, 0, Math.PI * 2);
      ctx.fillStyle = t.surface;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = t.ink;
      ctx.stroke();
    }
    // selection / highlight crosshair bands
    const mark = (k: number, alpha: number) => {
      ctx.fillStyle = t.ink;
      ctx.globalAlpha = alpha;
      ctx.fillRect(k * cell, 0, cell, size);
      ctx.fillRect(0, k * cell, size, cell);
      ctx.globalAlpha = 1;
    };
    for (const h of highlightResidues) {
      const k = index.get(h);
      if (k !== undefined) mark(k, 0.06);
    }
    if (selectedResidue != null) {
      const k = index.get(selectedResidue);
      if (k !== undefined) {
        mark(k, 0.09);
        ctx.strokeStyle = t.ink;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(k * cell + 0.75, k * cell + 0.75, Math.max(2, cell - 1.5), Math.max(2, cell - 1.5));
      }
    }
  }, [model, size, n, cell, residues, selectedResidue, highlightResidues, index, themeV]);

  useEffect(() => {
    const ctx = prepareCanvas(overRef.current, size, size);
    if (!ctx || !hover) return;
    const t = readTokens(rootRef.current);
    const [i, j] = hover;
    ctx.strokeStyle = t.ink;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(j * cell - 1, i * cell - 1, cell + 2, cell + 2);
  }, [hover, size, cell, themeV]);

  const cellAt = useCallback(
    (e: React.PointerEvent) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const j = Math.floor((e.clientX - r.left) / cell);
      const i = Math.floor((e.clientY - r.top) / cell);
      if (i < 0 || j < 0 || i >= n || j >= n) return null;
      return [i, j] as [number, number];
    },
    [cell, n],
  );

  const onMove = (e: React.PointerEvent) => {
    const c = cellAt(e);
    setHover(c);
    if (!c) {
      setTip(null);
      return;
    }
    const [i, j] = c;
    const a = residues[Math.min(i, j)];
    const b = residues[Math.max(i, j)];
    const v = model.values[i * n + j];
    const d = model.deltas[i * n + j];
    const linked = model.links.has(i * n + j);
    const rows: [string, string][] = [];
    if (i === j) {
      rows.push(["Confidence", CONFIDENCE[residues[i].confidence].label]);
      rows.push(["Spin system", residues[i].root ?? "—"]);
    } else {
      rows.push(["Match", a.root && b.root ? v.toFixed(2) : "no data"]);
      if (d) for (const [k, dv] of Object.entries(d)) rows.push([`Δ${k}`, `${dv >= 0 ? "+" : "−"}${Math.abs(dv).toFixed(2)} ppm`]);
      rows.push(["Graph link", linked ? "yes" : "no"]);
    }
    setTip({
      x: M.left + (j + 0.5) * cell,
      y: M.top + (i + 0.5) * cell,
      flip: M.left + j * cell > totalW - 240,
      color: i === j ? CONFIDENCE[residues[i].confidence].color : undefined,
      title: i === j ? `${residueTag(residues[i].resn, residues[i].resi)}` : `${residueTag(a.resn, a.resi)} → ${residueTag(b.resn, b.resi)}`,
      rows,
      foot: i === j ? undefined : Math.abs(i - j) === 1 ? "Sequential neighbours" : "Shifts would also allow these two to be neighbours",
    });
  };

  const select = (resi: number) => {
    const r = residues.find((x) => x.resi === resi);
    onSelectResidue(resi);
    onSelectRoot(r?.root ?? null);
  };

  const ticks = useMemo(() => {
    if (!residues.length) return [];
    const first = residues[0].resi;
    const last = residues[residues.length - 1].resi;
    const step = residues.length > 160 ? 50 : residues.length > 60 ? 10 : 5;
    const vals: number[] = [first];
    for (let v = Math.ceil(first / step) * step; v < last; v += step) if (v - first >= step / 2 && last - v >= step / 2) vals.push(v);
    vals.push(last);
    return vals.map((v) => ({ value: (index.get(v) ?? 0) + 0.5, label: String(v) }));
  }, [residues, index]);

  if (showTable) {
    const rows: { i: number; j: number; v: number }[] = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (model.values[i * n + j] > 0.2) rows.push({ i, j, v: model.values[i * n + j] });
    rows.sort((a, b) => b.v - a.v);
    return (
      <DataTable
        caption="Sequential match evidence"
        rows={rows.slice(0, 400)}
        rowKey={(r) => `${r.i}-${r.j}`}
        selected={(r) => residues[r.i].resi === selectedResidue}
        onRow={(r) => select(residues[r.i].resi)}
        columns={[
          { key: "a", label: "Residue i", render: (r) => residueTag(residues[r.i].resn, residues[r.i].resi) },
          { key: "b", label: "Followed by", render: (r) => residueTag(residues[r.j].resn, residues[r.j].resi) },
          { key: "v", label: "Match", num: true, render: (r) => r.v.toFixed(2) },
          { key: "l", label: "Graph link", render: (r) => (model.links.has(r.i * n + r.j) ? "yes" : "—") },
          {
            key: "c",
            label: "Confidence (i)",
            render: (r) => (
              <span className={styles.swatchCell}>
                <Swatch color={CONFIDENCE[residues[r.i].confidence].color} />
                {CONFIDENCE[residues[r.i].confidence].label}
              </span>
            ),
          },
        ]}
      />
    );
  }

  const strong = (() => {
    let c = 0;
    for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) if (model.values[i * n + j] > 0.5) c++;
    return c;
  })();

  return (
    <figure className={styles.figure}>
      <div ref={rootRef} className={styles.plotWrap} style={{ width: totalW, height: totalH }}>
        <div
          className={styles.plotFocus}
          style={{ left: M.left, top: M.top, width: size, height: size, cursor: hover ? "pointer" : "default" }}
          tabIndex={0}
          role="img"
          aria-label={`Sequential connectivity matrix for ${n} residues. Arrow keys move the selection.`}
          onPointerMove={onMove}
          onPointerLeave={() => {
            setHover(null);
            setTip(null);
          }}
          onClick={(e) => {
            const c = cellAt(e as unknown as React.PointerEvent);
            if (c) select(residues[c[0]].resi);
          }}
          onKeyDown={(e) => {
            if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)) {
              e.preventDefault();
              const r = stepResidue(residues, selectedResidue, e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1);
              if (r) select(r.resi);
            } else if (e.key === "Escape") {
              onSelectResidue(null);
              onSelectRoot(null);
            }
          }}
        >
          <canvas ref={baseRef} className={styles.canvas} />
          <canvas ref={overRef} className={styles.canvas} />
          {!project.assignment && <div className={styles.empty}>No assignment yet: add the assigned peak list of a spectrum to see connectivity evidence</div>}
        </div>
        <Axes
          total={{ width: totalW, height: totalH }}
          plot={{ left: M.left, top: M.top, width: size, height: size }}
          x={{ from: 0, to: n, title: "Residue", ticks }}
          y={{ from: 0, to: n, title: "Residue", ticks }}
        />
        <Tooltip t={tip} />
      </div>
      <div className={styles.below} style={{ width: totalW }}>
        <Colorbar
          stops={dark ? GREEN_DARK : GREEN_LIGHT}
          width={Math.min(420, size * 0.8)}
          title="Sequential shift agreement (Cα, Cβ, C′)"
          ticks={[0, 0.25, 0.5, 0.75, 1].map((v) => ({ at: v, label: v.toFixed(v === 0 || v === 1 ? 0 : 2) }))}
        />
        <div className={styles.legend}>
          <span className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: "var(--spx-surface)", width: 7, height: 7, boxShadow: "0 0 0 1px var(--spx-ink)" }} /> sequential
            link of the assignment
          </span>
          <span className={styles.legendItem}>
            <span style={{ display: "inline-flex", gap: 2 }}>
              {(["veryHigh", "high", "low", "unassigned"] as const).map((c) => (
                <span key={c} style={{ width: 8, height: 8, background: CONFIDENCE[c].color, display: "inline-block" }} />
              ))}
            </span>
            diagonal = residue check
          </span>
        </div>
      </div>
      <Caption title="Sequential connectivity">
        The NMR counterpart of a predicted-aligned-error map: each cell scores how well the Cα, Cβ and C′ shifts of two spin systems agree with them being
        sequential neighbours. The band beside the diagonal is the backbone walk; off-band pairs (<strong>{strong}</strong> above 0.5) are look-alike neighbours
        that a carbon match alone cannot tell apart. Dots mark the sequential links of the assignment.
      </Caption>
    </figure>
  );
}
