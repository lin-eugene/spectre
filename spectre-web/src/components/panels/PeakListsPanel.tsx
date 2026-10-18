"use client";
// What the assignment was built from: each spectrum's peak list with the peaks read, used and left
// out, the consistency classes, how the check decides, and the notes from reading the lists.
import { CONFIDENCE, CONSISTENCY_TOLERANCE as T } from "@/lib/contract";
import { useSpectre } from "@/lib/client/store";
import { Chip } from "@/components/ui/primitives";

export function PeakListsPanel() {
  const { state } = useSpectre();
  const p = state.project;
  if (!p) return null;
  const a = p.assignment;
  if (!a) {
    return (
      <p className="m-0 text-[12px] text-muted">
        {p.inputs ? "No assignment yet: add the assigned peak list of at least one spectrum (in the panel at the top)." : "This project has no assignment."}
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 text-[11px] font-medium tracking-wide text-muted uppercase">Peak lists</div>
        <div className="scroll-quiet max-h-44 overflow-y-auto rounded border border-line">
          <table className="w-full border-collapse text-[11px]">
            <thead className="sticky top-0 bg-surface-2 text-muted">
              <tr>
                <th className="px-2 py-1 text-left font-medium">Spectrum</th>
                <th className="px-2 py-1 text-left font-medium">List</th>
                <th className="px-2 py-1 text-right font-medium">Peaks</th>
                <th className="px-2 py-1 text-right font-medium" title="peaks placed in a spin system">
                  Used
                </th>
                <th className="px-2 py-1 text-right font-medium" title="peaks the list could not place (unassigned amide, residue outside the sequence or of another type)">
                  Left out
                </th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {a.inputs.map((i) => (
                <tr key={i.spectrum} className="border-t border-line">
                  <td className="px-2 py-0.5 font-sans text-fg">{i.label}</td>
                  <td className="max-w-[9rem] truncate px-2 py-0.5 font-sans text-muted" title={`${i.file} (${i.format})`}>
                    {i.file}
                  </td>
                  <td className="px-2 py-0.5 text-right">{i.peaks}</td>
                  <td className="px-2 py-0.5 text-right">{i.used}</td>
                  <td className="px-2 py-0.5 text-right" title={Object.entries(i.skipped).map(([why, n]) => `${n}: ${why}`).join("\n") || undefined}>
                    {i.peaks - i.used}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="mb-1 text-[11px] font-medium tracking-wide text-muted uppercase">Consistency check</div>
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          <Chip tone="ok">
            {a.stats.veryHigh} {CONFIDENCE.veryHigh.label.toLowerCase()}
          </Chip>
          <Chip>
            {a.stats.high} {CONFIDENCE.high.label.toLowerCase()}
          </Chip>
          <Chip tone={a.stats.low ? "warn" : "neutral"}>
            {a.stats.low} with {a.stats.low === 1 ? "a conflict" : "conflicts"}
          </Chip>
          <Chip>{a.stats.edges} sequential links</Chip>
        </div>
        <p className="m-0 mt-1.5 text-[11.5px] leading-relaxed text-muted">
          Peaks of one atom conflict when they are more than {T.conflict.H} ppm (¹H), {T.conflict.N} ppm (¹⁵N) or {T.conflict.C} ppm (¹³C) apart, across spectra and
          between the strips of residues i and i+1. A carbon more than {T.implausibleSd} BMRB standard deviations from its residue type&apos;s average is implausible;
          any shift more than {T.unusualSd} away is unusual. Residues link when a Cα, Cβ or C′ of residue i is within {T.link} ppm of the (i-1) peak of residue i+1.
        </p>
      </div>

      {a.notes.length > 0 && (
        <details open={a.notes.length <= 3}>
          <summary className="cursor-pointer text-[12px] text-accent">Notes from reading the lists ({a.notes.length})</summary>
          <ul className="m-0 mt-1 list-disc space-y-0.5 pl-4 text-[11.5px] text-muted">
            {a.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
