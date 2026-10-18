"use client";
import { CONFIDENCE } from "@/lib/contract";
import { entryStats, fmtDate, pct } from "@/lib/client/derive";
import { useSpectre } from "@/lib/client/store";
import { exportUrl } from "@/lib/client/api";
import { IconDownload, IconExternal, IconLibrary, IconSparkle } from "@/components/ui/Icons";
import { Button, Chip, StatTile } from "@/components/ui/primitives";
import { InputsPanel } from "@/components/panels/InputsPanel";

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9.5rem_1fr] gap-3 py-1 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="m-0 min-w-0 text-fg">{children}</dd>
    </div>
  );
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
      {children}
      <IconExternal size={12} />
    </a>
  );
}

export function EntryHeader() {
  const { state, setChatOpen, setLibraryOpen } = useSpectre();
  const p = state.project;
  const st = entryStats(p);
  /** when the inputs last changed (every change rebuilds the assignment) */
  const lastChange = p?.history.filter((h) => /upload|remove|import|create/i.test(h.action)).at(-1)?.at ?? p?.updatedAt;
  const real = p?.realSpectra ?? [];
  const realMB = real.reduce((sum, r) => sum + (r.sizeMB || 0), 0);
  const spectraLabel = p
    ? real.length
      ? real.map((r) => `${r.experiment} (${r.ndim}D)`).join(" · ")
      : p.spectra.map((s) => s.label).join(" · ")
    : "";
  const isArtina = !!p?.meta.source.startsWith("artina");
  /** a project made from your own spectra and peak lists */
  const isUpload = p?.meta.source === "upload";

  return (
    <section id="entry" aria-labelledby="entry-title" className="scroll-mt-20">
      <div className="flex flex-wrap items-start gap-x-10 gap-y-6">
        <div className="min-w-0 flex-[1_1_520px]">
          <div className="flex flex-wrap items-center gap-2 text-[12px] font-medium tracking-wide text-muted uppercase">
            <span>Spectre entry</span>
            <span aria-hidden="true">·</span>
            <span>Solution NMR resonance assignment</span>
            {p?.meta.source.startsWith("demo") && <Chip tone="accent">Demo dataset</Chip>}
            {isArtina && <Chip tone="accent">ARTINA dataset</Chip>}
            {isUpload && <Chip tone="accent">Your spectra and peak lists</Chip>}
            {real.length > 0 && (
              <Chip tone="ok" title={`${real.length} processed spectra attached (${realMB.toFixed(0)} MB)`}>
                Real spectra: {real.length}
              </Chip>
            )}
          </div>
          <h1 id="entry-title" className="mt-1.5 text-[34px] leading-tight font-semibold tracking-tight text-fg">
            {p ? p.meta.name : <span className="skeleton inline-block h-9 w-56 align-middle" />}
          </h1>
          <dl className="mt-3 max-w-2xl">
            <MetaRow label="Source organism">{p?.meta.organism ?? "–"}</MetaRow>
            <MetaRow label="Structure">
              {p?.meta.pdbId ? (
                <Ext href={`https://www.rcsb.org/structure/${p.meta.pdbId}`}>PDB {p.meta.pdbId}</Ext>
              ) : p?.pdb?.id.startsWith("AF-") ? (
                <Ext href={`https://alphafold.ebi.ac.uk/entry/${p.pdb.id.split("-")[1]}`}>AlphaFold DB {p.pdb.id}</Ext>
              ) : p?.pdb?.id === "ESMFold" ? (
                "ESMFold prediction"
              ) : p?.pdb ? (
                p.pdb.id
              ) : (
                "–"
              )}
            </MetaRow>
            <MetaRow label="Reference shifts">
              {p?.meta.bmrbId ? <Ext href={`https://bmrb.io/data_library/summary/index.php?bmrbId=${p.meta.bmrbId}`}>BMRB {p.meta.bmrbId}</Ext> : "–"}
            </MetaRow>
            <MetaRow label="UniProt">
              {p?.meta.uniprot ? <Ext href={`https://www.uniprot.org/uniprotkb/${p.meta.uniprot}`}>{p.meta.uniprot}</Ext> : "–"}
            </MetaRow>
            <MetaRow label="Experiments">
              <span className="text-[13px]">{spectraLabel || "–"}</span>
            </MetaRow>
            <MetaRow label="Assignment updated">{p?.assignment ? fmtDate(lastChange) : "No assignment yet"}</MetaRow>
          </dl>
          {p?.meta.description && <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-muted">{p.meta.description}</p>}
          {p?.attribution && (
            <div className="mt-3 flex max-w-2xl flex-wrap items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-2 text-[12.5px]">
              <a
                href={p.attribution.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-[3px] border border-fg/70 px-1.5 py-[1px] font-mono text-[11px] font-semibold text-fg no-underline hover:border-accent hover:text-accent"
                title="Data licence"
              >
                {p.attribution.license}
              </a>
              <span className="min-w-0 flex-1 text-muted">
                {p.attribution.text}{" "}
                <a href={p.attribution.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  source
                </a>
              </span>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-3">
          <div className="grid grid-cols-2 gap-2.5">
            <StatTile
              label="Residues assigned"
              value={p?.assignment ? `${st.assigned}/${st.assignable}` : "–"}
              sub={p?.assignment ? `${pct(st.assigned, st.assignable)} of non-proline residues` : p?.inputs ? "Add the assigned peak lists" : "—"}
            />
            <StatTile
              label={CONFIDENCE.veryHigh.label}
              accent={CONFIDENCE.veryHigh.color}
              value={p?.assignment ? pct(st.veryHigh, st.assigned) : "–"}
              sub={p?.assignment ? `${st.veryHigh} of the assigned residues · ${st.high} ${CONFIDENCE.high.label.toLowerCase()}` : "—"}
            />
            {real.length > 0 ? (
              <StatTile
                label="Real spectra"
                value={real.length}
                sub={`${[...new Set(real.map((r) => `${r.ndim}D`))].sort().join(" / ")} · ${realMB >= 1000 ? `${(realMB / 1000).toFixed(1)} GB` : `${Math.round(realMB)} MB`}`}
              />
            ) : (
              <StatTile
                label="Sequential links"
                value={p?.assignment ? st.edges : "–"}
                sub={p?.assignment ? "consecutive residues whose carbons match" : "—"}
              />
            )}
            <StatTile
              label="Conflicts"
              accent={st.low ? CONFIDENCE.low.color : undefined}
              value={p?.assignment ? st.low : "–"}
              sub={p?.assignment ? (st.low ? "residues whose peaks disagree (see Problems)" : "every assigned residue is consistent") : "—"}
            />
          </div>
          {p?.inputs && <InputsPanel project={p} />}
          <div className="flex flex-wrap gap-2">
            {p?.assignment && (
              <a
                href={exportUrl(p.id, "nmrstar")}
                download
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3.5 text-sm font-medium text-fg no-underline hover:border-accent hover:text-accent"
              >
                <IconDownload size={14} /> NMR-STAR
              </a>
            )}
            <Button onClick={() => setLibraryOpen(true)} title="Open a protein from the ARTINA library of real spectra">
              <IconLibrary size={14} /> Open dataset
            </Button>
            <Button variant="ghost" onClick={() => setChatOpen(true)}>
              <IconSparkle size={14} /> Ask about this entry
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
