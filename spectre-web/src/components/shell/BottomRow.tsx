"use client";
// The row under the viewers (AlphaFold: PAE explanation · feedback CTA · audit history).
import { exportUrl } from "@/lib/client/api";
import { fmtDate } from "@/lib/client/derive";
import { useSpectre } from "@/lib/client/store";
import { EXPORT_LABELS, type ExportFormat } from "@/lib/export";
import { IconDownload, IconHelp } from "@/components/ui/Icons";

const EXPORTS = (["nmrstar", "bmrb_tab", "assignment_list", "peaklists"] as ExportFormat[]).map((format) => ({ format, ...EXPORT_LABELS[format] }));

export function BottomRow() {
  const { state, setChatOpen } = useSpectre();
  const p = state.project;
  const created = p?.history[0]?.at;
  const lastAssign = p?.history.filter((h) => /assign/i.test(h.action)).at(-1)?.at;

  return (
    <section className="grid gap-8 border-t border-line pt-7 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)_minmax(0,0.85fr)]">
      <div>
        <h2 className="text-[22px] font-medium text-fg">Multidimensional spectra</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-fg">
          Each backbone amide gives one peak in the ¹H-¹⁵N HSQC. Triple-resonance spectra add a carbon dimension: strips through each amide
          show Cα, Cβ and C′ of residue <em>i</em> and <em>i−1</em>, which is how spin systems are chained along the sequence —{" "}
          <a href="#help" className="font-medium text-accent hover:underline">
            see Help below
          </a>{" "}
          for more information.
        </p>
      </div>

      <div className="flex flex-col items-start gap-4 lg:items-center lg:justify-center">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <span className="text-[19px] text-fg">Questions about this assignment?</span>
          <button type="button" onClick={() => setChatOpen(true)} className="cta-offset rounded-[2px] px-5 py-2.5 text-[19px] font-medium">
            Ask Spectre
          </button>
        </div>
      </div>

      <div id="history" className="scroll-mt-20 lg:text-right">
        <h2 className="text-[15px] font-semibold text-fg">Audit history</h2>
        <dl className="mt-2 space-y-1 text-[14px]">
          <div>
            <dt className="inline font-semibold text-fg">Project created: </dt>
            <dd className="m-0 inline text-fg">{fmtDate(created ?? p?.updatedAt)}</dd>
          </div>
          <div>
            <dt className="inline font-semibold text-fg">Assignment built: </dt>
            <dd className="m-0 inline text-fg">{lastAssign ? fmtDate(lastAssign) : p?.assignment ? fmtDate(p.updatedAt) : "not yet"}</dd>
          </div>
        </dl>
        {p && p.history.length > 0 && (
          <details className="mt-2 text-[12.5px] lg:ml-auto lg:max-w-sm">
            <summary className="cursor-pointer text-accent">All events ({p.history.length})</summary>
            <ol className="scroll-quiet m-0 mt-2 max-h-48 list-none space-y-1 overflow-y-auto p-0 text-left">
              {[...p.history].reverse().map((h, i) => (
                <li key={i} className="rounded bg-surface-2 px-2 py-1">
                  <span className="text-faint">{fmtDate(h.at)}</span> · <span className="font-medium text-fg">{h.action}</span>
                  <span className="text-muted"> ({h.actor})</span>
                  {h.detail && <div className="truncate text-muted" title={h.detail}>{h.detail}</div>}
                </li>
              ))}
            </ol>
          </details>
        )}
        <div className="mt-4 flex flex-wrap gap-2 lg:justify-end">
          {EXPORTS.map((e) => (
            <a
              key={e.format}
              href={p ? exportUrl(p.id, e.format) : undefined}
              download
              title={e.hint}
              aria-disabled={!p?.assignment}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 text-[12.5px] font-medium text-fg no-underline hover:border-accent hover:text-accent aria-disabled:pointer-events-none aria-disabled:opacity-50"
            >
              <IconDownload size={13} /> {e.label}
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "How is the assignment built?",
    a: (
      <>
        Directly from your assigned peak lists: nothing is placed or guessed. Each peak goes to the spin system of its amide&apos;s residue, and
        each residue&apos;s Hᴺ, N, Cα, Cβ and C′ shifts are the means over the peaks assigned to that atom. When you upload or replace a list,
        the assignment is rebuilt at once.
      </>
    ),
  },
  {
    q: "How is each residue checked?",
    a: (
      <>
        <strong>Confirmed</strong>: consistent peaks, linked to a neighbour by a sequential carbon match (a Cα, Cβ or C′ of residue{" "}
        <em>i</em> within 0.35 ppm of the <em>i</em>−1 peak of residue <em>i</em>+1). <strong>Unconfirmed</strong>: no conflicts, but no
        sequential link, or a shift more than 3.5 BMRB standard deviations from the residue type&apos;s mean. <strong>Conflict</strong>: peaks
        of one atom disagree by more than 0.06 ppm (¹H), 0.6 ppm (¹⁵N) or 0.5 ppm (¹³C), or a carbon lies more than 5 standard deviations from
        its residue type&apos;s mean. <strong>Unassigned</strong>: no peaks assigned to the amide. Prolines have no amide proton and are grey.
      </>
    ),
  },
  {
    q: "What do I need to upload?",
    a: (
      <>
        The protein sequence and, for each 3D triple-resonance spectrum (HNCA, HN(CO)CA, HNCACB or CBCANH, CBCA(CO)NH or HN(CO)CACB, HNCO,
        HN(CA)CO), the NMRPipe spectrum together with its assigned peak list. Every peak list needs its spectrum. Accepted lists: Sparky
        (.list), XEASY/CYANA (.peaks, plus the .prot shift list when atoms are given as numbers), NMRPipe (.tab with an ASS column) and
        CcpNmr Analysis peak-table exports (.csv/.tsv).
      </>
    ),
  },
  {
    q: "How do I fix a conflict?",
    a: (
      <>
        Select the residue (or open Problems) to see which peaks disagree and in which spectra, and compare its strips with its
        neighbours&apos;. Then correct the peak list in your assignment software (Sparky, CcpNmr Analysis, CARA, …) and upload it again: the
        assignment is rebuilt and checked from the new list. Spectre does not edit your assignment itself.
      </>
    ),
  },
  {
    q: "What do the spectrum views show?",
    a: (
      <>
        The <strong>HSQC</strong> view shows one peak per amide root (labelled with its residue once assigned). <strong>Strips</strong> show 1D
        carbon traces of HNCA/HNCACB through consecutive amides: equal Cα/Cβ positions in neighbouring strips are the sequential walk. The{" "}
        <strong>link matrix</strong> is a residue × residue map of connectivity evidence (the analogue of AlphaFold&apos;s PAE).{" "}
        <strong>Planes</strong> show the measured spectra; <strong>1D</strong> processes raw Bruker FIDs.
      </>
    ),
  },
  {
    q: "Where does the demo data come from?",
    a: (
      <>
        Ubiquitin chemical shifts from BMRB entry 6457 and the crystal structure PDB 1UBQ. The shifts were written out as assigned Sparky peak
        lists for HNCA, HNCACB, HNCO and HN(CA)CO, with experimental-style jitter, a few missing peaks and three broadened amides; the demo has
        no spectra behind the lists. Real spectra and their deposited peak lists come from the ARTINA dataset (nmrdb.ethz.ch, CC BY 4.0),
        or from your own uploads. The 1D view processes raw Bruker FIDs placed on the server (none are bundled).
      </>
    ),
  },
];

export function HelpSection() {
  return (
    <section id="help" className="scroll-mt-20 border-t border-line pt-7">
      <h2 className="flex items-center gap-2 text-[22px] font-medium text-fg">
        <IconHelp size={20} className="text-accent" /> Help
      </h2>
      <div className="mt-3 grid gap-x-10 md:grid-cols-2">
        {FAQ.map((f) => (
          <details key={f.q} className="group border-b border-line py-3">
            <summary className="cursor-pointer list-none text-[15px] font-medium text-fg marker:hidden group-open:text-accent">{f.q}</summary>
            <p className="mt-2 mb-0 text-[14px] leading-relaxed text-muted">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
