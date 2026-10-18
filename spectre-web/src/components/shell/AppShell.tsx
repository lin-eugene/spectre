"use client";
// The Spectre entry page: top bar, entry header, sequence, the three-column viewer row
// (spectra | 3D structure | confidence legend + accordions), audit row, help and chat.
import dynamic from "next/dynamic";
import { useEffect, useMemo } from "react";
import { CONFIDENCE, type Confidence } from "@/lib/contract";
import { residueInfos } from "@/lib/client/derive";
import { SpectreProvider, useSpectre } from "@/lib/client/store";
import { ChatDrawer } from "@/components/chat/ChatDrawer";
import { LegendCard } from "@/components/panels/LegendCard";
import { PeakListsPanel } from "@/components/panels/PeakListsPanel";
import { ProblemsPanel, useProblems } from "@/components/panels/ProblemsPanel";
import { SelectionCard } from "@/components/panels/SelectionCard";
import { SpectraList } from "@/components/panels/SpectraList";
import { SpinSystemsList } from "@/components/panels/SpinSystemsList";
import { SequenceViewer } from "@/components/sequence/SequenceViewer";
import { IconAlert, IconCheck, IconRefresh } from "@/components/ui/Icons";
import { Accordion, Button, cx } from "@/components/ui/primitives";
import { BottomRow, HelpSection } from "./BottomRow";
import { EntryHeader } from "./EntryHeader";
import { ARTINA_URL, LibraryModal } from "./LibraryModal";
import { UploadModal } from "./UploadModal";
import { TopBar } from "./TopBar";

const SpectrumPanel = dynamic(() => import("@/components/spectrum/SpectrumPanel"), {
  ssr: false,
  loading: () => <div className="skeleton h-full min-h-[520px] w-full" />,
});
const StructurePanel = dynamic(() => import("@/components/structure/StructurePanel"), {
  ssr: false,
  loading: () => <div className="skeleton h-full w-full" />,
});

function ViewerRow() {
  const h = useSpectre();
  const { state } = h;
  const p = state.project;
  const problems = useProblems();
  const counts = useMemo(() => {
    const c: Partial<Record<Confidence, number>> = {};
    if (!p?.assignment) return undefined;
    for (const r of residueInfos(p)) c[r.confidence] = (c[r.confidence] ?? 0) + 1;
    return c;
  }, [p]);

  return (
    <section id="viewer" aria-label="Spectra and structure" className="@container scroll-mt-20">
      <div className="grid gap-6 @min-[760px]:grid-cols-2 @min-[1240px]:grid-cols-[minmax(0,1.02fr)_minmax(0,1.08fr)_minmax(300px,0.6fr)]">
        <div className="viewer-sticky min-w-0">
          {p ? (
            <SpectrumPanel
              project={p}
              view={state.spectrumView}
              onViewChange={h.setSpectrumView}
              selectedResidue={state.selection.residue}
              selectedRoot={state.selection.root}
              highlightResidues={state.highlights.residues}
              onSelectResidue={h.selectResidue}
              onSelectRoot={h.selectRoot}
              brukerExperiment={state.brukerExperiment}
              onBrukerExperimentChange={h.setBrukerExperiment}
              planeSpectrum={state.planeSpectrum}
              planeAt={state.planeAt}
              onPlaneChange={h.setPlane}
            />
          ) : (
            <div className="skeleton min-h-[520px] w-full" />
          )}
        </div>
        <div className="viewer-sticky relative h-[clamp(440px,66vh,660px)] min-w-0">
          {p ? (
            <StructurePanel
              project={p}
              selectedResidue={state.selection.residue}
              highlightResidues={state.highlights.residues}
              highlightColor={state.highlights.color}
              colorScheme={state.colorScheme}
              representation={state.representation}
              onColorSchemeChange={h.setColorScheme}
              onRepresentationChange={h.setRepresentation}
              onSelectResidue={h.selectResidue}
              onHoverResidue={h.hoverResidue}
              onFindStructure={() => void h.runAction("predict_esmfold_structure", {}, "Predicting the structure with ESMFold")}
            />
          ) : (
            <div className="skeleton h-full w-full" />
          )}
        </div>
        <div className="min-w-0 space-y-4 @min-[760px]:col-span-2 @min-[1240px]:col-span-1">
          <div className="grid gap-4 @min-[760px]:grid-cols-2 @min-[1240px]:grid-cols-1">
            <LegendCard counts={counts} onLearnMore={() => document.getElementById("help")?.scrollIntoView({ behavior: "smooth" })} />
            <SelectionCard />
          </div>
          <div className="border-t border-line">
            <Accordion title="Spin systems" count={p?.assignment?.spinSystems.length ?? p?.hsqc.length ?? 0} defaultOpen>
              <SpinSystemsList />
            </Accordion>
            <Accordion title="Spectra" count={p?.spectra.length ?? 0}>
              <SpectraList />
            </Accordion>
            <Accordion
              title="Problems"
              count={problems.actionable}
              right={problems.conflicts.length ? <IconAlert size={15} className="text-warn" /> : undefined}
            >
              <ProblemsPanel />
            </Accordion>
            <Accordion title="Peak lists" anchor="peaklists">
              <PeakListsPanel />
            </Accordion>
          </div>
        </div>
      </div>
    </section>
  );
}

function StatusBanner() {
  const { state, resetDemo } = useSpectre();
  if (state.status === "error" && !state.project) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
        <IconAlert size={16} />
        <span className="flex-1">{state.error ?? "Could not load the project."}</span>
        <Button size="sm" onClick={() => void resetDemo()}>
          <IconRefresh size={13} /> Retry
        </Button>
      </div>
    );
  }
  if (state.error && state.project) {
    return (
      <div role="status" className="rounded-lg border border-warn/30 bg-warn-soft px-4 py-2 text-[13px] text-warn">
        {state.error}
      </div>
    );
  }
  return null;
}

function Toast() {
  const { state } = useSpectre();
  const t = state.toast;
  if (!t) return null;
  return (
    <div
      role="status"
      className={cx(
        "fixed z-50 flex max-w-sm items-start gap-2 rounded-lg border px-3.5 py-2.5 text-[13px] shadow-[var(--shadow-lg)]",
        t.kind === "error" ? "border-danger/30 bg-danger-soft text-danger" : t.kind === "ok" ? "border-ok/30 bg-ok-soft text-ok" : "border-line bg-surface text-fg",
      )}
      style={{ left: "calc(1.25rem + env(safe-area-inset-left, 0px))", bottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))" }}
    >
      {t.kind === "error" ? <IconAlert size={15} className="mt-0.5 shrink-0" /> : <IconCheck size={15} className="mt-0.5 shrink-0" />}
      <span>{t.text}</span>
    </div>
  );
}

function Page() {
  const { state } = useSpectre();
  const name = state.project?.meta.name;
  useEffect(() => {
    if (name) document.title = `Spectre · ${name}`;
  }, [name]);
  return (
    <div id="top">
      <TopBar />
      <div className={cx("transition-[padding] duration-300", state.chatOpen && "sm:pr-[var(--drawer-w)]")}>
        <main className="mx-auto max-w-[1680px] space-y-7 px-4 pt-6 pb-16 sm:px-6">
          <StatusBanner />
          <EntryHeader />
          <SequenceViewer />
          <ViewerRow />
          <BottomRow />
          <HelpSection />
        </main>
        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-5 text-[12px] text-muted sm:px-6">
            <span>Spectre — consistency checks of protein NMR backbone assignments.</span>
            {state.project?.attribution ? (
              <span>
                Data:{" "}
                <a href={state.project.attribution.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  {state.project.attribution.text}
                </a>{" "}
                ({state.project.attribution.license})
              </span>
            ) : (
              <span>
                Real spectra library:{" "}
                <a href={ARTINA_URL} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  ARTINA, nmrdb.ethz.ch
                </a>{" "}
                (CC BY 4.0)
              </span>
            )}
            <span className="flex items-center gap-3">
              {(["veryHigh", "high", "low", "unassigned"] as Confidence[]).map((c) => (
                <span key={c} className="inline-flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: CONFIDENCE[c].color }} />
                  {CONFIDENCE[c].label}
                </span>
              ))}
            </span>
          </div>
        </footer>
      </div>
      <ChatDrawer />
      <LibraryModal />
      <UploadModal />
      <Toast />
    </div>
  );
}

export default function AppShell() {
  return (
    <SpectreProvider>
      <Page />
    </SpectreProvider>
  );
}
