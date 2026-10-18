"use client";
// 3D structure panel (centre of the entry page). three.js is loaded lazily on the client;
// React renders the chrome (toolbar, menus, legend) and the hover card whose position is
// updated every frame straight from the render loop.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { ColorScheme, ProjectView, Representation } from "@/lib/contract";
import { CONFIDENCE } from "@/lib/contract";
import { countPdbModels, parsePdb, parsePdbModels, type PdbModel } from "@/lib/structure/pdb";
import { S as styles, STRUCTURE_CSS } from "./styles";
import { IconCamera, IconCheck, IconCollapse, IconExpand, IconLayers, IconModels, IconPalette, IconPause, IconReset, IconSpin } from "./icons";
import { atomCard, residueCard, ssName, type AtomCard, type ResidueCard } from "./viewer/atomInfo";
import { PLDDT_BANDS, RESIDUE_CLASSES, SCHEME_LABELS, SS_COLORS, SS_LABELS, divergingRamp, mixHex, primaryChain, residueColors, residueContext } from "./viewer/palette";
import type { HoverTarget, MolViewer } from "./viewer/MolViewer";
import { buildEnsemble, superposeOnto, transformModel, type Superposition } from "./viewer/superpose";
import { withSecondaryStructure } from "./viewer/dssp";

export interface StructurePanelProps {
  project: ProjectView;
  selectedResidue: number | null;
  highlightResidues: number[];
  highlightColor?: string;
  colorScheme: ColorScheme;
  representation: Representation;
  onColorSchemeChange: (scheme: ColorScheme) => void;
  onRepresentationChange: (repr: Representation) => void;
  onSelectResidue: (resi: number | null) => void;
  onHoverResidue?: (resi: number | null) => void;
  /** offered when the project has no structure: predict one from its sequence with ESMFold */
  onFindStructure?: () => void;
}

/** Dispatch on window to point the viewer at an atom programmatically. */
export const STRUCTURE_HOVER_EVENT = "spectre:structure-hover";
export interface StructureHoverDetail {
  resi: number;
  atom: string;
  chain?: string;
}

const REPRESENTATIONS: { id: Representation; label: string; hint: string }[] = [
  { id: "cartoon+atoms", label: "Cartoon + atoms", hint: "ribbon with every heavy atom" },
  { id: "cartoon", label: "Cartoon", hint: "secondary-structure ribbon" },
  { id: "sticks", label: "Sticks", hint: "ball-and-stick, all atoms" },
  { id: "spheres", label: "Spheres", hint: "space-filling van der Waals" },
];

const SCHEMES: ColorScheme[] = ["confidence", "secondary", "residue", "hydrophobicity", "bfactor"];

function schemeSwatches(scheme: ColorScheme): string[] {
  switch (scheme) {
    case "confidence":
      return [CONFIDENCE.veryHigh.color, CONFIDENCE.high.color, CONFIDENCE.low.color, CONFIDENCE.unassigned.color];
    case "secondary":
      return [SS_COLORS.H, SS_COLORS.E, SS_COLORS.C];
    case "residue":
      return RESIDUE_CLASSES.slice(0, 4).map((c) => c.color);
    case "hydrophobicity":
      return [divergingRamp(0), divergingRamp(0.5), divergingRamp(1)];
    case "bfactor":
      return [divergingRamp(0), divergingRamp(0.5), divergingRamp(1)];
  }
}

function resolveBackground(el: HTMLElement): string {
  let node: HTMLElement | null = el;
  while (node) {
    const bg = getComputedStyle(node).backgroundColor;
    if (bg && bg !== "transparent" && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(bg)) return bg;
    node = node.parentElement;
  }
  return "#ffffff";
}

export default function StructurePanel(props: StructurePanelProps) {
  const { project, selectedResidue, highlightResidues, highlightColor, colorScheme, representation } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<MolViewer | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<SVGLineElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  const labelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const resLabelRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });

  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverTarget>(null);
  const [spinning, setSpinning] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [menu, setMenu] = useState<null | "repr" | "color" | "model">(null);
  const [modelId, setModelId] = useState("default");
  const [showEnsemble, setShowEnsemble] = useState(true);
  const [ao, setAo] = useState(true);
  const [interacted, setInteracted] = useState(false);
  const [selAtoms, setSelAtoms] = useState<number[]>([]);

  const pdbText = project.pdb?.text ?? "";
  const pdbId = project.pdb?.id ?? project.meta.pdbId ?? "";
  /** "PDB 1UBQ", "AlphaFold DB AF-P0CG48-F1" for a model fetched from AlphaFold DB, or "ESMFold prediction" */
  const sourceLabel = pdbId.startsWith("AF-") ? `AlphaFold DB ${pdbId}` : pdbId === "ESMFold" ? "ESMFold prediction" : `PDB ${pdbId}`;
  const altModels = useMemo(() => project.models ?? [], [project.models]);

  /** Reference frame: the deposited model (project.pdb), else the first alternative structure. */
  const refModel: PdbModel | null = useMemo(() => {
    const text = pdbText || altModels[0]?.text || "";
    if (!text) return null;
    try {
      const m = parsePdb(text, pdbId || altModels[0]?.id || "");
      return m.atoms.length ? withSecondaryStructure(m) : null;
    } catch {
      return null;
    }
  }, [pdbText, pdbId, altModels]);

  /** Structures the user can switch between (deposited model 1, AlphaFold, ARTINA, ...). */
  const modelOptions = useMemo(() => {
    const opts: { id: string; label: string; hint: string }[] = [
      {
        id: "default",
        label: pdbText ? "Deposited structure" : altModels[0]?.label ?? "Structure",
        hint: pdbText ? `${pdbId ? `${sourceLabel} · ` : ""}model 1 · reference frame` : "reference frame",
      },
    ];
    altModels.forEach((m, i) => {
      if (pdbText && /deposit/i.test(`${m.id} ${m.label}`)) return; // same as the default
      if (!pdbText && i === 0) return;
      const n = countPdbModels(m.text);
      opts.push({ id: m.id, label: m.label, hint: n > 1 ? `${n} models · superposed on Cα` : "superposed on Cα" });
    });
    return opts;
  }, [altModels, pdbText, pdbId]);

  const activeId = modelOptions.some((o) => o.id === modelId) ? modelId : "default";
  const shown: { model: PdbModel | null; sp: Superposition | null; label: string; bLabel: string } = useMemo(() => {
    const isAF = (t: string) => /alpha\s*fold|^af-|^esmfold/i.test(t);
    const def = { model: refModel, sp: null, label: modelOptions[0].label, bLabel: isAF(`${pdbId} ${modelOptions[0].label}`) ? "pLDDT" : "B-factor" };
    if (!refModel || activeId === "default") return def;
    const entry = altModels.find((m) => m.id === activeId);
    if (!entry) return def;
    try {
      const parsed = withSecondaryStructure(parsePdb(entry.text, entry.id));
      if (!parsed.atoms.length) return def;
      const sp = superposeOnto(parsed, refModel, primaryChain(refModel));
      return {
        model: sp ? transformModel(parsed, sp, sp.offset) : parsed,
        sp,
        label: entry.label,
        bLabel: isAF(`${entry.id} ${entry.label}`) ? "pLDDT" : "B-factor",
      };
    } catch {
      return def;
    }
  }, [refModel, activeId, altModels, modelOptions, pdbId]);
  const model = shown.model;

  /** NMR ensemble behind the shown structure: its own models, or the deposited ensemble. */
  const ensembleText = useMemo(() => {
    if (activeId !== "default") {
      const e = altModels.find((m) => m.id === activeId);
      return e && countPdbModels(e.text) > 1 ? e.text : null;
    }
    if (pdbText && countPdbModels(pdbText) > 1) return pdbText;
    const multi = altModels.filter((m) => countPdbModels(m.text) > 1);
    return (multi.find((m) => /deposit|nmr|ensemble/i.test(`${m.id} ${m.label}`)) ?? (pdbText ? undefined : multi[0]))?.text ?? null;
  }, [activeId, altModels, pdbText]);
  const ensembleLabel = useMemo(() => {
    if (activeId === "default") return "NMR ensemble";
    const e = altModels.find((m) => m.id === activeId);
    if (!e) return "Ensemble";
    if (/alpha\s*fold/i.test(`${e.id} ${e.label}`)) return "AlphaFold models";
    if (/artina/i.test(`${e.id} ${e.label}`)) return "ARTINA ensemble";
    return `${e.label.replace(/\s*\(.*\)$/, "")} ensemble`;
  }, [activeId, altModels]);
  const ensemble = useMemo(() => {
    if (!ensembleText || !model) return null;
    try {
      const models = parsePdbModels(ensembleText).slice(0, 40);
      return buildEnsemble(models, model, primaryChain(model));
    } catch {
      return null;
    }
  }, [ensembleText, model]);

  const ctx = useMemo(() => residueContext(project), [project]);
  const isPlddt = shown.bLabel === "pLDDT";
  const colors = useMemo(() => (model ? residueColors(model, colorScheme, ctx, { plddt: isPlddt }) : []), [model, colorScheme, ctx, isPlddt]);

  /** residue number -> index into model.residues (the chain the NMR data describe) */
  const residueIndex = useMemo(() => {
    const m = new Map<number, number>();
    if (!model) return m;
    const chain = primaryChain(model);
    model.residues.forEach((r, i) => {
      if (r.ca !== undefined && r.chain === chain && !m.has(r.resi)) m.set(r.resi, i);
    });
    return m;
  }, [model]);

  const viewerModelRef = useRef<PdbModel | null>(null);
  const residueIndexRef = useRef(residueIndex);
  useEffect(() => {
    residueIndexRef.current = residueIndex;
  }, [residueIndex]);

  // ---------------------------------------------------------------- overlay positioning (per frame)
  const positionOverlay = useCallback(() => {
    const v = viewerRef.current;
    const root = rootRef.current;
    if (!v || !root) return;
    const W = root.clientWidth;
    const H = root.clientHeight;
    const card = cardRef.current;
    const line = lineRef.current;
    const dot = dotRef.current;
    const anchor = v.hoverAnchor();
    if (card && line && dot) {
      if (!anchor || !anchor.visible) {
        card.style.opacity = "0";
        line.style.opacity = "0";
        dot.style.opacity = "0";
      } else {
        const cw = card.offsetWidth;
        const ch = card.offsetHeight;
        const right = W - 58;
        let x = anchor.x + 44;
        let y = anchor.y - ch - 30;
        if (x + cw > right) x = anchor.x - 44 - cw;
        if (y < 10) y = anchor.y + 30;
        x = Math.max(10, Math.min(right - cw, x));
        y = Math.max(10, Math.min(H - ch - 10, y));
        card.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        card.style.opacity = "1";
        const ex = Math.max(x, Math.min(x + cw, anchor.x));
        const ey = Math.max(y, Math.min(y + ch, anchor.y));
        line.setAttribute("x1", String(anchor.x));
        line.setAttribute("y1", String(anchor.y));
        line.setAttribute("x2", String(ex));
        line.setAttribute("y2", String(ey));
        line.style.opacity = "1";
        dot.setAttribute("cx", String(anchor.x));
        dot.setAttribute("cy", String(anchor.y));
        dot.style.opacity = "1";
      }
    }
    // labels of the selected residue
    const atoms = v.selectedAtoms();
    const model = viewerModelRef.current;
    if (model) {
      atoms.forEach((ai, k) => {
        const el = labelRefs.current[k];
        if (!el) return;
        const a = model.atoms[ai];
        const p = v.project(a.x, a.y, a.z);
        el.style.opacity = p.visible ? "1" : "0";
        el.style.transform = `translate3d(${p.x + 7}px, ${p.y - 18}px, 0)`;
      });
      const rl = resLabelRef.current;
      const sel = propsRef.current.selectedResidue;
      const ri = sel !== null ? residueIndexRef.current.get(sel) : undefined;
      if (rl && ri !== undefined) {
        const c = v.residueCentroid(ri);
        const p = v.project(c.x, c.y, c.z);
        rl.style.opacity = p.visible ? "1" : "0";
        rl.style.transform = `translate3d(${p.x - rl.offsetWidth / 2}px, ${p.y - 54}px, 0)`;
      }
    }
  }, []);

  // ---------------------------------------------------------------- viewer lifecycle
  useEffect(() => {
    let disposed = false;
    let viewer: MolViewer | null = null;
    import("./viewer/MolViewer")
      .then(({ MolViewer }) => {
        if (disposed || !hostRef.current) return;
        try {
          viewer = new MolViewer(hostRef.current, {
            onHover: (t) => {
              setHover(t);
              const m = viewerModelRef.current;
              const resi = t && m ? m.residues[t.residue]?.resi ?? null : null;
              propsRef.current.onHoverResidue?.(resi);
            },
            onSelect: (ri) => {
              const m = viewerModelRef.current;
              setInteracted(true);
              propsRef.current.onSelectResidue(ri === null || !m ? null : m.residues[ri]?.resi ?? null);
            },
            onFrame: () => positionOverlay(),
            onSpinChange: (s) => setSpinning(s),
          });
          if (rootRef.current) viewer.setBackground(resolveBackground(rootRef.current));
          viewerRef.current = viewer;
          if (process.env.NODE_ENV !== "production") (window as unknown as { __structureViewer?: MolViewer }).__structureViewer = viewer;
          setReady(true);
        } catch (e) {
          setFailed(e instanceof Error ? e.message : "WebGL is not available");
        }
      })
      .catch(() => setFailed("Could not load the 3D engine"));
    return () => {
      disposed = true;
      viewer?.dispose();
      viewerRef.current = null;
    };
  }, [positionOverlay]);

  // background follows the page theme
  useEffect(() => {
    if (!ready) return;
    const update = () => {
      if (rootRef.current && viewerRef.current) viewerRef.current.setBackground(resolveBackground(rootRef.current));
    };
    update();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", update);
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    return () => {
      mq.removeEventListener("change", update);
      mo.disconnect();
    };
  }, [ready]);

  const lastRefRef = useRef<PdbModel | null>(null);
  useEffect(() => {
    if (!ready || !viewerRef.current) return;
    viewerModelRef.current = model;
    if (!model) return;
    const keepView = lastRefRef.current === refModel;
    lastRefRef.current = refModel;
    viewerRef.current.setModel(model, { keepView });
  }, [ready, model, refModel]);

  // NMR ensemble tubes, tinted by per-residue Cα RMSF
  useEffect(() => {
    const v = viewerRef.current;
    if (!ready || !v) return;
    if (!ensemble) {
      v.setEnsemble(null);
      return;
    }
    const hi = Math.max(1.5, ensemble.maxRmsf);
    const tint = (r: number | undefined) => mixHex("#8fa1b7", "#ff7d45", Math.min(1, (r ?? 0) / hi));
    const traces = ensemble.traces.flatMap((segs) => segs.map((sg) => ({ xyz: sg.xyz, colors: sg.resi.map((ri) => tint(ensemble.rmsf.get(ri))) })));
    v.setEnsemble(traces);
  }, [ready, ensemble, model]);

  useEffect(() => {
    if (ready) viewerRef.current?.setEnsembleVisible(showEnsemble);
  }, [ready, showEnsemble, ensemble]);

  useEffect(() => {
    if (!ready || !viewerRef.current || !model) return;
    const hl = new Set<number>();
    for (const r of highlightResidues) {
      const i = residueIndex.get(r);
      if (i !== undefined) hl.add(i);
    }
    viewerRef.current.setStyle({
      representation,
      residueColors: colors,
      highlight: hl,
      highlightColor: highlightColor ?? "#e64980",
    });
  }, [ready, model, representation, colors, highlightResidues, highlightColor, residueIndex]);

  useEffect(() => {
    if (!ready || !viewerRef.current || !model) return;
    const ri = selectedResidue !== null ? residueIndex.get(selectedResidue) ?? null : null;
    viewerRef.current.setSelected(ri, true);
    setSelAtoms(viewerRef.current.selectedAtoms());
  }, [ready, model, selectedResidue, residueIndex]);

  useEffect(() => {
    if (ready) viewerRef.current?.setAO(ao);
  }, [ready, ao]);

  // programmatic hover ("point at this atom")
  useEffect(() => {
    if (!ready) return;
    const onEvt = (e: Event) => {
      const d = (e as CustomEvent<StructureHoverDetail>).detail;
      if (d && viewerRef.current) viewerRef.current.hoverAtomByName(d.resi, d.atom, d.chain);
    };
    window.addEventListener(STRUCTURE_HOVER_EVENT, onEvt);
    return () => window.removeEventListener(STRUCTURE_HOVER_EVENT, onEvt);
  }, [ready]);

  // fullscreen
  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // close menus on outside click / Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menu) setMenu(null);
      else if (propsRef.current.selectedResidue !== null && rootRef.current?.contains(document.activeElement)) propsRef.current.onSelectResidue(null);
    };
    const onDown = (e: PointerEvent) => {
      if (!menu) return;
      const t = e.target as HTMLElement;
      if (!t.closest?.("[data-sv-menu]")) setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [menu]);

  // ---------------------------------------------------------------- toolbar actions
  const toggleSpin = () => {
    const v = viewerRef.current;
    if (!v) return;
    v.setSpin(!v.getSpin());
  };
  const toggleFullscreen = () => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };
  const takeScreenshot = () => {
    const v = viewerRef.current;
    if (!v) return;
    const url = v.screenshot();
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(pdbId || "structure").toLowerCase()}-${representation.replace("+", "-")}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // ---------------------------------------------------------------- hover card data
  const card: { atom?: AtomCard; residue?: ResidueCard } | null = useMemo(() => {
    if (!hover || !model) return null;
    const primary = primaryChain(model);
    if (hover.kind === "atom") return { atom: atomCard(model, hover.atom, ctx, primary), residue: residueCard(model, hover.residue, ctx, primary) };
    return { residue: residueCard(model, hover.residue, ctx, primary) };
  }, [hover, model, ctx]);

  useEffect(() => {
    // re-position once the card content (size) changed
    positionOverlay();
  }, [card, selAtoms, positionOverlay]);

  const selectedModelResidue = selectedResidue !== null ? residueIndex.get(selectedResidue) : undefined;
  const selectedLabel = selectedModelResidue !== undefined && model ? `${model.residues[selectedModelResidue].resn} ${model.residues[selectedModelResidue].resi}` : null;

  const nAtoms = model?.atoms.length ?? 0;
  const nRes = model?.residues.filter((r) => r.ca !== undefined).length ?? 0;

  return (
    <div
      ref={rootRef}
      className={styles.root}
      data-structure-panel=""
      tabIndex={-1}
      onPointerDown={() => setInteracted(true)}
      aria-label={`3D structure ${pdbId}`}
    >
      <style href="spectre-structure-panel" precedence="medium">
        {STRUCTURE_CSS}
      </style>
      <div ref={hostRef} className={`${styles.canvasHost} ${hover ? styles.hovering : ""}`} />

      {!model && (
        <div className={styles.empty}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>No structure loaded</div>
            <div>Import a PDB file or ask the assistant to fetch one.</div>
            {props.onFindStructure && (
              <button
                type="button"
                onClick={props.onFindStructure}
                style={{ marginTop: 10, pointerEvents: "auto", cursor: "pointer", border: "1px solid var(--line-strong)", borderRadius: 6, padding: "5px 10px", background: "var(--surface)", color: "var(--accent)", font: "inherit", fontWeight: 500 }}
              >
                Predict with ESMFold
              </button>
            )}
          </div>
        </div>
      )}
      {model && !ready && !failed && (
        <div className={styles.loading}>
          <div>
            <div className={styles.loadingDots}>
              <span />
              <span />
              <span />
            </div>
            <div>Preparing 3D view…</div>
          </div>
        </div>
      )}
      {failed && (
        <div className={styles.empty}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>3D view unavailable</div>
            <div>{failed}</div>
          </div>
        </div>
      )}

      {/* hover card + leader line + selection labels */}
      <div className={styles.overlay}>
        <svg className={styles.leader}>
          <line ref={lineRef} stroke="#12b886" strokeWidth={1.6} strokeLinecap="round" style={{ opacity: 0 }} />
          <circle ref={dotRef} r={4.5} fill="none" stroke="#12b886" strokeWidth={2} style={{ opacity: 0 }} />
        </svg>
        {selAtoms.map((ai, k) => (
          <div
            key={ai}
            ref={(el) => {
              labelRefs.current[k] = el;
            }}
            className={styles.atomLabel}
            style={{ opacity: 0 }}
          >
            {model?.atoms[ai].name}
          </div>
        ))}
        {selectedLabel && (
          <div ref={resLabelRef} className={styles.resLabel} style={{ opacity: 0 }}>
            {selectedLabel}
          </div>
        )}
        <div ref={cardRef} className={styles.card} style={{ opacity: 0, visibility: card ? "visible" : "hidden" }} role="tooltip">
          {card?.atom ? (
            <AtomCardView a={card.atom} rmsf={ensemble?.rmsf.get(card.atom.resi)} models={ensemble?.models} bLabel={shown.bLabel} />
          ) : card?.residue ? (
            <ResidueCardView r={card.residue} rmsf={ensemble?.rmsf.get(card.residue.resi)} models={ensemble?.models} />
          ) : null}
        </div>
      </div>

      {/* legend for non-confidence schemes */}
      {model && colorScheme !== "confidence" && <SchemeLegend scheme={colorScheme} plddt={isPlddt ? (pdbId === "ESMFold" && activeId === "default" ? "ESMFold" : "AlphaFold") : undefined} />}

      {/* toolbar */}
      <div className={styles.toolbar} data-sv-menu="">
        <button type="button" className={styles.btn} data-tip="Reset view" aria-label="Reset view" onClick={() => viewerRef.current?.resetView()}>
          <IconReset />
        </button>
        <button
          type="button"
          className={`${styles.btn} ${spinning ? styles.btnActive : ""}`}
          data-tip={spinning ? "Stop spinning" : "Spin"}
          aria-label="Toggle spin"
          aria-pressed={spinning}
          onClick={toggleSpin}
        >
          {spinning ? <IconPause /> : <IconSpin />}
        </button>
        <button type="button" className={styles.btn} data-tip={fullscreen ? "Exit full screen" : "Full screen"} aria-label="Toggle full screen" onClick={toggleFullscreen}>
          {fullscreen ? <IconCollapse /> : <IconExpand />}
        </button>
        <button
          type="button"
          className={`${styles.btn} ${menu === "repr" ? styles.btnActive : ""}`}
          data-tip="Representation"
          data-open={menu === "repr"}
          aria-label="Representation"
          aria-expanded={menu === "repr"}
          onClick={() => setMenu(menu === "repr" ? null : "repr")}
        >
          <IconLayers />
        </button>
        <button
          type="button"
          className={`${styles.btn} ${menu === "color" ? styles.btnActive : ""}`}
          data-tip="Colour by"
          data-open={menu === "color"}
          aria-label="Colour scheme"
          aria-expanded={menu === "color"}
          onClick={() => setMenu(menu === "color" ? null : "color")}
        >
          <IconPalette />
        </button>
        {modelOptions.length > 1 && (
          <button
            type="button"
            className={`${styles.btn} ${menu === "model" ? styles.btnActive : ""}`}
            data-tip="Structure model"
            data-open={menu === "model"}
            aria-label="Structure model"
            aria-expanded={menu === "model"}
            onClick={() => setMenu(menu === "model" ? null : "model")}
          >
            <IconModels />
          </button>
        )}
        <button type="button" className={styles.btn} data-tip="Save image" aria-label="Save image" onClick={takeScreenshot}>
          <IconCamera />
        </button>

        {menu === "repr" && (
          <div className={styles.menu} style={{ top: 120 }} role="menu">
            <div className={styles.menuTitle}>Representation</div>
            {REPRESENTATIONS.map((r) => (
              <button
                key={r.id}
                type="button"
                role="menuitemradio"
                aria-checked={representation === r.id}
                className={`${styles.menuItem} ${representation === r.id ? styles.menuItemActive : ""}`}
                onClick={() => {
                  props.onRepresentationChange(r.id);
                  setMenu(null);
                }}
              >
                <span style={{ display: "flex", flexDirection: "column" }}>
                  <span>{r.label}</span>
                  <span className={styles.muted} style={{ fontSize: 11, fontWeight: 400 }}>
                    {r.hint}
                  </span>
                </span>
                {representation === r.id && (
                  <span className={styles.menuCheck}>
                    <IconCheck />
                  </span>
                )}
              </button>
            ))}
            <div className={styles.menuDivider} />
            <button type="button" role="menuitemcheckbox" aria-checked={ao} className={styles.menuItem} onClick={() => setAo(!ao)}>
              <span>Ambient occlusion</span>
              {ao && (
                <span className={styles.menuCheck}>
                  <IconCheck />
                </span>
              )}
            </button>
            {ensemble && (
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={showEnsemble}
                className={styles.menuItem}
                onClick={() => setShowEnsemble(!showEnsemble)}
              >
                <span style={{ display: "flex", flexDirection: "column" }}>
                  <span>NMR ensemble</span>
                  <span className={styles.muted} style={{ fontSize: 11, fontWeight: 400 }}>
                    {ensemble.models} models as Cα tubes, tinted by RMSF
                  </span>
                </span>
                {showEnsemble && (
                  <span className={styles.menuCheck}>
                    <IconCheck />
                  </span>
                )}
              </button>
            )}
          </div>
        )}
        {menu === "model" && (
          <div className={styles.menu} style={{ top: 200 }} role="menu">
            <div className={styles.menuTitle}>Structure model</div>
            {modelOptions.map((o) => (
              <button
                key={o.id}
                type="button"
                role="menuitemradio"
                aria-checked={activeId === o.id}
                className={`${styles.menuItem} ${activeId === o.id ? styles.menuItemActive : ""}`}
                onClick={() => {
                  setModelId(o.id);
                  setMenu(null);
                }}
              >
                <span style={{ display: "flex", flexDirection: "column" }}>
                  <span>{o.label}</span>
                  <span className={styles.muted} style={{ fontSize: 11, fontWeight: 400 }}>
                    {o.hint}
                  </span>
                </span>
                {activeId === o.id && (
                  <span className={styles.menuCheck}>
                    <IconCheck />
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        {menu === "color" && (
          <div className={styles.menu} style={{ top: 160 }} role="menu">
            <div className={styles.menuTitle}>Colour by</div>
            {SCHEMES.map((s) => (
              <button
                key={s}
                type="button"
                role="menuitemradio"
                aria-checked={colorScheme === s}
                className={`${styles.menuItem} ${colorScheme === s ? styles.menuItemActive : ""}`}
                onClick={() => {
                  props.onColorSchemeChange(s);
                  setMenu(null);
                }}
              >
                <span className={styles.swatches}>
                  {schemeSwatches(s).map((c, i) => (
                    <span key={i} className={styles.swatch} style={{ background: c }} />
                  ))}
                </span>
                <span>{SCHEME_LABELS[s]}</span>
                {colorScheme === s && (
                  <span className={styles.menuCheck}>
                    <IconCheck />
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {model && (
        <div className={styles.hint} style={{ opacity: interacted || hover ? 0 : 1 }}>
          Drag to rotate · scroll to zoom · hover an atom
        </div>
      )}
      {model && (
        <div className={styles.footer}>
          {activeId !== "default" ? (
            <div>
              <span style={{ color: "var(--sv-fg)", fontWeight: 600 }}>{shown.label}</span>
              {shown.sp ? (
                <>
                  {" "}
                  · Cα RMSD vs deposited <span className={styles.mono}>{shown.sp.rmsd.toFixed(2)} Å</span> ({shown.sp.n} res)
                  {shown.sp.coreN < shown.sp.n ? (
                    <>
                      {" "}
                      · core <span className={styles.mono}>{shown.sp.coreRmsd.toFixed(2)} Å</span> ({shown.sp.coreN})
                    </>
                  ) : null}
                </>
              ) : (
                " · not superposed"
              )}
            </div>
          ) : null}
          {ensemble && showEnsemble ? (
            <div>
              {ensembleLabel} · {ensemble.models} models · mean Cα RMSF <span className={styles.mono}>{ensemble.meanRmsf.toFixed(2)} Å</span>
            </div>
          ) : null}
          <div>
            {activeId === "default" && pdbId ? `${sourceLabel} · ` : ""}
            {nRes} residues · {nAtoms.toLocaleString()} atoms
          </div>
        </div>
      )}
    </div>
  );
}

function ConfidenceChip({ c }: { c?: { label: string; color: string } }) {
  if (!c) return <span className={styles.muted}>not assigned yet</span>;
  return (
    <span className={styles.chip}>
      <span className={styles.square} style={{ background: c.color }} />
      {c.label}
    </span>
  );
}

function AtomCardView({ a, rmsf, models, bLabel = "B-factor" }: { a: AtomCard; rmsf?: number; models?: number; bLabel?: string }) {
  return (
    <>
      <div className={styles.cardHead}>
        <span className={styles.elementDot} style={{ background: a.elementColor }} />
        <span className={styles.atomTitle}>{a.title}</span>
        <span className={styles.code}>{a.atomName}</span>
        <span className={styles.role}>{a.role}</span>
      </div>
      <div className={styles.resLine}>
        {a.residueLabel}
        <span className={styles.muted}>
          · chain {a.chain} · {a.elementName}
        </span>
      </div>
      {(a.shift || a.expected) && (
        <>
          <div className={styles.divider} />
          <div className={styles.shiftRow}>
            <span className={styles.shiftNucleus}>{(a.shift ?? a.expected)!.nucleus} chemical shift</span>
            {a.shift ? (
              <span className={`${styles.tag} ${styles.tagAssigned}`}>assigned</span>
            ) : (
              <span className={`${styles.tag} ${styles.tagNone}`}>unassigned</span>
            )}
          </div>
          {a.shift ? (
            <div className={styles.shiftValue}>
              {a.shift.value.toFixed(a.element === "H" ? 3 : 2)}
              <span className={styles.unit}>ppm</span>
            </div>
          ) : null}
          {a.expected && (
            <div className={styles.expected}>
              BMRB average <span className={styles.mono}>{a.expected.mean.toFixed(2)}</span> ± {a.expected.sd.toFixed(2)} ppm
              {a.shift ? (
                <>
                  {" "}
                  · Δ <span className={styles.mono}>{(a.shift.value - a.expected.mean >= 0 ? "+" : "") + (a.shift.value - a.expected.mean).toFixed(2)}</span>
                </>
              ) : null}
            </div>
          )}
        </>
      )}
      <div className={styles.metaGrid}>
        <span className={styles.metaKey}>Confidence</span>
        <ConfidenceChip c={a.confidence} />
        {a.root && (
          <>
            <span className={styles.metaKey}>Spin system</span>
            <span className={styles.mono}>#{a.root}</span>
          </>
        )}
        {rmsf !== undefined && (
          <>
            <span className={styles.metaKey}>Ensemble</span>
            <span>
              RMSF <span className={styles.mono}>{rmsf.toFixed(2)} Å</span>
              <span className={styles.muted}> · {models} models</span>
            </span>
          </>
        )}
        <span className={styles.metaKey}>{bLabel}</span>
        <span className={styles.mono}>
          {a.bfactor.toFixed(1)}
          {bLabel === "B-factor" ? " Å²" : ""}
        </span>
      </div>
    </>
  );
}

function ResidueCardView({ r, rmsf, models }: { r: ResidueCard; rmsf?: number; models?: number }) {
  const label: Record<string, string> = { HN: "¹Hᴺ", N: "¹⁵N", CA: "¹³Cα", CB: "¹³Cβ", CO: "¹³C′" };
  return (
    <>
      <div className={styles.cardHead}>
        <span className={styles.atomTitle}>
          {r.resn} {r.resi}
        </span>
        <span className={styles.code}>chain {r.chain}</span>
        <span className={styles.role}>{ssName(r.ss)}</span>
      </div>
      <div className={styles.metaGrid}>
        <span className={styles.metaKey}>Confidence</span>
        <ConfidenceChip c={r.confidence} />
        {r.root && (
          <>
            <span className={styles.metaKey}>Spin system</span>
            <span className={styles.mono}>#{r.root}</span>
          </>
        )}
        {rmsf !== undefined && (
          <>
            <span className={styles.metaKey}>Ensemble</span>
            <span>
              RMSF <span className={styles.mono}>{rmsf.toFixed(2)} Å</span>
              <span className={styles.muted}> · {models} models</span>
            </span>
          </>
        )}
      </div>
      {r.shifts.length > 0 && (
        <>
          <div className={styles.divider} />
          <div className={styles.metaGrid} style={{ marginTop: 0 }}>
            {r.shifts.slice(0, 6).map(([k, v]) => (
              <span key={k} style={{ display: "contents" }}>
                <span className={styles.metaKey}>{label[k] ?? k}</span>
                <span className={styles.mono}>{v.toFixed(k === "HN" ? 3 : 2)} ppm</span>
              </span>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/** plddt: the predictor whose pLDDT the B-factors hold */
function SchemeLegend({ scheme, plddt }: { scheme: ColorScheme; plddt?: string }) {
  const rows = (items: { label: string; color: string }[]) =>
    items.map((it) => (
      <div key={it.label} className={styles.legendRow}>
        <span className={styles.square} style={{ background: it.color }} />
        {it.label}
      </div>
    ));
  let body: ReactNode = null;
  const ramp = (lo: string, hi: string) => (
    <>
      <div className={styles.ramp} style={{ background: `linear-gradient(90deg, ${divergingRamp(0)}, ${divergingRamp(0.5)}, ${divergingRamp(1)})` } as CSSProperties} />
      <div className={styles.rampLabels}>
        <span>{lo}</span>
        <span>{hi}</span>
      </div>
    </>
  );
  switch (scheme) {
    case "secondary":
      body = rows([
        { label: SS_LABELS.H, color: SS_COLORS.H },
        { label: SS_LABELS.E, color: SS_COLORS.E },
        { label: SS_LABELS.C, color: SS_COLORS.C },
      ]);
      break;
    case "residue":
      body = rows(RESIDUE_CLASSES);
      break;
    case "hydrophobicity":
      body = ramp("hydrophilic", "hydrophobic");
      break;
    case "bfactor":
      body = plddt ? rows(PLDDT_BANDS) : ramp("rigid (low B)", "mobile (high B)");
      break;
  }
  return (
    <div className={styles.legend}>
      <div className={styles.legendTitle}>{scheme === "bfactor" && plddt ? `${plddt} pLDDT` : SCHEME_LABELS[scheme]}</div>
      {body}
    </div>
  );
}
