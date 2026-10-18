"use client";
// The spectrum card that takes the place of AlphaFold's PAE plot: a 1H-15N HSQC fingerprint,
// a strip-plot sequential walk, a 3D strips cube, a PAE-style connectivity matrix and the raw 1D
// processing view, plus a browser for real measured spectra (uploads, ARTINA), all sharing one
// selection with the rest of the page.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectView, SpectrumViewId } from "@/lib/contract";
import { readTokens } from "@/lib/viz/colors";
import { buildResidues, buildRootIndex } from "@/lib/viz/data";
import { HsqcView } from "./HsqcView";
import { MatrixView } from "./MatrixView";
import { PlanesView } from "./PlanesView";
import { Strips3DView } from "./Strips3DView";
import { StripsView } from "./StripsView";
import { useElementWidth, useThemeVersion } from "./hooks";
import { SPX_CSS, styles } from "./styles";

export interface SpectrumPanelProps {
  project: ProjectView;
  view: SpectrumViewId;
  onViewChange: (view: SpectrumViewId) => void;
  selectedResidue: number | null;
  selectedRoot: string | null;
  highlightResidues: number[];
  onSelectResidue: (resi: number | null) => void;
  onSelectRoot: (root: string | null) => void;
  /** spectrum type of the 'strips3d' view (e.g. hnca) */
  cubeExperiment: string | null;
  /** Spectra tab deep link: real spectrum name and slice ppm (both optional) */
  planeSpectrum?: string | null;
  planeAt?: number | null;
  onPlaneChange?: (name: string | null, at: number | null) => void;
}

const TABS: { id: SpectrumViewId; label: string; title: string }[] = [
  { id: "strips3d", label: "Strips 3D", title: "Strips in 3D (rotatable cube)" },
  { id: "hsqc", label: "HSQC", title: "¹H–¹⁵N HSQC fingerprint" },
  { id: "planes", label: "Spectra", title: "Measured spectra" },
  { id: "strips", label: "Strips", title: "Sequential walk (strip plot)" },
  { id: "matrix", label: "Connectivity", title: "Residue × residue connectivity" },
];

function IconTable() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <path d="M2 6.2h12M2 9.8h12M6.5 2.5v11" />
    </svg>
  );
}

function IconChart() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <circle cx="5" cy="10" r="1.6" />
      <circle cx="10.5" cy="5.5" r="1.6" />
      <circle cx="11.5" cy="11" r="1.2" />
      <path d="M2 14h12" />
    </svg>
  );
}

export default function SpectrumPanel(props: SpectrumPanelProps) {
  const {
    project,
    view,
    onViewChange,
    selectedResidue,
    selectedRoot,
    highlightResidues,
    onSelectResidue,
    onSelectRoot,
    cubeExperiment,
    planeSpectrum,
    planeAt,
    onPlaneChange,
  } = props;
  const rootRef = useRef<HTMLElement>(null);
  const width = useElementWidth(rootRef);
  const themeV = useThemeVersion();
  const [showTable, setShowTable] = useState(false);
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(readTokens(rootRef.current).dark), [themeV]);

  const roots = useMemo(() => buildRootIndex(project), [project]);
  const residues = useMemo(() => buildResidues(project), [project]);

  const common = {
    project,
    roots,
    residues,
    width,
    dark,
    showTable,
    selectedResidue,
    selectedRoot,
    highlightResidues,
    onSelectResidue,
    onSelectRoot,
  };

  const stats = project.assignment?.stats;
  const subtitle = (() => {
    switch (view) {
      case "hsqc":
        return stats ? `${stats.roots} spin systems · ${stats.veryHigh} very high · ${stats.high} high` : `${project.hsqc.length} peaks`;
      case "strips":
        return selectedResidue != null ? `centred on residue ${selectedResidue}` : "select a residue to centre the walk";
      case "strips3d":
        if (!project.assignment) return "assignment not run yet";
        return selectedResidue != null ? `walk around residue ${selectedResidue}` : `${stats ? stats.roots : project.hsqc.length} strips · drag to rotate`;
      case "matrix":
        return `${project.sequence.length} × ${project.sequence.length} residues`;
      case "planes": {
        const n = project.realSpectra?.length ?? 0;
        return n ? `${n} measured ${n === 1 ? "spectrum" : "spectra"}${project.attribution ? ` · ${project.attribution.license}` : ""}` : "none imported";
      }
    }
  })();

  const tab = TABS.find((t) => t.id === view) ?? TABS[0];
  const tableable = !(view === "planes" && !project.realSpectra?.length);

  return (
    <section ref={rootRef} className={styles.root} aria-label="Spectrum viewer">
      <style href="spectre-spectrum-panel" precedence="medium">
        {SPX_CSS}
      </style>
      <div className={styles.topbar}>
        <div className={styles.tabs} role="tablist" aria-label="Spectrum views">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" className={styles.tab} aria-selected={t.id === view} title={t.title} onClick={() => onViewChange(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className={styles.tools}>
          {tableable && (
            <button
              type="button"
              className={styles.iconButton}
              aria-pressed={showTable}
              onClick={() => setShowTable((v) => !v)}
              title={showTable ? "Show the plot" : "Show the data as a table"}
            >
              {showTable ? <IconChart /> : <IconTable />}
              {showTable ? "Plot" : "Table"}
            </button>
          )}
        </div>
      </div>
      <div className={styles.subbar}>
        <span>
          <strong>{tab.title}</strong>
        </span>
        <span className={styles.stats}>{subtitle}</span>
      </div>
      <div role="tabpanel" aria-label={tab.title}>
        {view === "hsqc" && <HsqcView {...common} />}
        {view === "planes" && <PlanesView {...common} planeSpectrum={planeSpectrum} planeAt={planeAt} onPlaneChange={onPlaneChange} />}
        {view === "strips" && <StripsView {...common} />}
        {view === "strips3d" && <Strips3DView {...common} experiment={cubeExperiment} onShowView={onViewChange} />}
        {view === "matrix" && <MatrixView {...common} />}
      </div>
    </section>
  );
}
