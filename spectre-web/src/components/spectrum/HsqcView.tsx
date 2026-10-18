"use client";
import { useCallback, useMemo } from "react";
import { CONFIDENCE, type ProjectView } from "@/lib/contract";
import { GREEN_DARK, GREEN_LIGHT } from "@/lib/viz/colors";
import { hsqcData, type PlaneDatum, type ResidueInfo, type RootInfo } from "@/lib/viz/data";
import { findRealHsqc, snrColorbar } from "@/lib/viz/real";
import { PlaneView, type PlaneWindow } from "./PlaneView";
import { Caption, Colorbar, ConfidenceLegend, DataTable, Swatch } from "./parts";
import { styles } from "./styles";
import { useRealPlane } from "./useReal";

export interface ViewCommonProps {
  project: ProjectView;
  roots: Map<string, RootInfo>;
  residues: ResidueInfo[];
  width: number;
  dark: boolean;
  showTable: boolean;
  selectedResidue: number | null;
  selectedRoot: string | null;
  highlightResidues: number[];
  onSelectResidue: (resi: number | null) => void;
  onSelectRoot: (root: string | null) => void;
}

export function stepResidue(residues: ResidueInfo[], current: number | null, dir: 1 | -1): ResidueInfo | null {
  const assigned = residues.filter((r) => r.root);
  if (!assigned.length) return null;
  if (current == null) return dir > 0 ? assigned[0] : assigned[assigned.length - 1];
  if (dir > 0) return assigned.find((r) => r.resi > current) ?? assigned[0];
  for (let k = assigned.length - 1; k >= 0; k--) if (assigned[k].resi < current) return assigned[k];
  return assigned[assigned.length - 1];
}

function windowFor(data: PlaneDatum[], padX: number, padY: number, fallback: PlaneWindow): PlaneWindow {
  if (!data.length) return fallback;
  const xs = data.map((d) => d.x);
  const ys = data.map((d) => d.y);
  const xHi = Math.ceil((Math.max(...xs) + padX) * 4) / 4;
  const xLo = Math.floor((Math.min(...xs) - padX) * 4) / 4;
  const yLo = Math.floor(Math.min(...ys) - padY);
  const yHi = Math.ceil(Math.max(...ys) + padY);
  return { x0: xHi, x1: xLo, y0: yLo, y1: yHi };
}

export function HsqcView(p: ViewCommonProps) {
  const { project, roots, residues, width, dark, showTable, selectedResidue, selectedRoot, highlightResidues, onSelectResidue, onSelectRoot } = p;
  const data = useMemo(() => hsqcData(project, roots), [project, roots]);
  const realMeta = findRealHsqc(project);
  const realQuery = useMemo(() => (realMeta ? { x: "1H", y: "15N", mode: "projection" as const, maxPoints: 512 } : null), [realMeta]);
  const { plane: real, loading } = useRealPlane(project.id, realMeta?.name, realQuery);
  const win = useMemo(() => windowFor(data, 0.3, 2.5, { x0: 10.5, x1: 6, y0: 100, y1: 134 }), [data]);
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

  const rootsOnly = data.filter((d) => d.kind === "root");
  const assigned = rootsOnly.filter((d) => d.resi != null).length;
  const veryHigh = rootsOnly.filter((d) => d.confidence === "veryHigh").length;

  if (showTable) {
    const rows = [...rootsOnly].sort((a, b) => (a.resi ?? 1e9) - (b.resi ?? 1e9) || Number(a.root) - Number(b.root));
    return (
      <DataTable
        caption="HSQC peaks"
        rows={rows}
        rowKey={(r) => r.id}
        selected={(r) => r.root === selectedRoot || (selectedResidue != null && r.resi === selectedResidue)}
        onRow={onPick}
        columns={[
          { key: "res", label: "Residue", render: (r) => (r.resi != null ? r.label : "—") },
          { key: "root", label: "Spin system", num: true, render: (r) => r.root },
          { key: "h", label: "¹H (ppm)", num: true, render: (r) => r.x.toFixed(3) },
          { key: "n", label: "¹⁵N (ppm)", num: true, render: (r) => r.y.toFixed(2) },
          {
            key: "conf",
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
    );
  }

  const plotW = Math.max(220, Math.min(600, width - 74));
  return (
    <PlaneView
      data={data}
      defaultWindow={win}
      minSpan={{ x: 0.12, y: 1.2 }}
      linewidth={{ x: 0.03, y: 0.3 }}
      xTitle="¹H (ppm)"
      yTitle="¹⁵N (ppm)"
      xName="¹H"
      yName="¹⁵N"
      xDecimals={3}
      yDecimals={2}
      selectedId={selectedRoot}
      selectedResidue={selectedResidue}
      highlightResidues={highlightResidues}
      onPick={onPick}
      onClear={onClear}
      onStep={onStep}
      width={width}
      ariaLabel={`1H-15N HSQC with ${rootsOnly.length} amide peaks, ${assigned} assigned`}
      emptyText="No HSQC peaks in this project"
      real={real}
      loading={loading && !!real}
      ringMarkers={!!real}
    >
      <div className={styles.below} style={{ width: plotW + 74 }}>
        {real ? (
          <Colorbar
            stops={snrColorbar(real, 5, dark).stops}
            width={Math.min(420, plotW * 0.8)}
            title="Signal-to-noise (log scale)"
            ticks={snrColorbar(real, 5, dark).ticks}
          />
        ) : (
          <Colorbar
            stops={dark ? GREEN_DARK : GREEN_LIGHT}
            width={Math.min(420, plotW * 0.8)}
            title="Peak intensity (% of strongest)"
            ticks={[0, 25, 50, 75, 100].map((v) => ({ at: Math.pow(v / 100, 0.55), label: String(v) }))}
          />
        )}
        {project.assignment ? (
          <ConfidenceLegend
            title="Peaks:"
            extras={
              <span className={styles.legendItem}>
                <span className={styles.legendDot} style={{ background: "transparent", boxShadow: "inset 0 0 0 1.5px var(--spx-muted)" }} />
                Side-chain NH₂
              </span>
            }
          />
        ) : (
          <span className={styles.colorbarTitle}>No assignment yet: add a spectrum&apos;s assigned peak list to colour the peaks</span>
        )}
      </div>
      <Caption title="¹H–¹⁵N HSQC fingerprint">
        {project.assignment ? (
          <>
            Each amide gives one peak, coloured by the consistency check of its residue: <strong>{veryHigh}</strong> confirmed and{" "}
            <strong>{assigned}</strong> assigned of <strong>{rootsOnly.length}</strong> peaks.{" "}
            {real ? (
              <>
                Contours are the measured spectrum <strong>{realMeta?.name}</strong> from 5σ of the noise.
              </>
            ) : (
              "The contours are synthesised from the peak lists."
            )}
          </>
        ) : (
          <>
            Each amide gives one peak — <strong>{rootsOnly.length}</strong> here. No assignment yet: add the assigned peak list of a spectrum (Spectra and
            peak lists, at the top) to label the peaks with their residues and colour them by the consistency check.
          </>
        )}
      </Caption>
    </PlaneView>
  );
}
