"use client";
// "Model Confidence" equivalent: the consistency check of the assignment with the AlphaFold palette.
import { useState } from "react";
import { CONFIDENCE, type Confidence } from "@/lib/contract";
import { IconChevronDown } from "@/components/ui/Icons";
import { cx } from "@/components/ui/primitives";

/** the consistency check of each residue's assignment (see CONFIDENCE in contract.ts) */
const ROWS: { key: Confidence; text: string }[] = [
  { key: "veryHigh", text: `${CONFIDENCE.veryHigh.label} (linked to a neighbour)` },
  { key: "high", text: `${CONFIDENCE.high.label} (no link, or an unusual shift)` },
  { key: "low", text: `${CONFIDENCE.low.label} (peaks or shifts disagree)` },
  { key: "unassigned", text: CONFIDENCE.unassigned.label },
];

export function LegendCard({ counts, onLearnMore }: { counts?: Partial<Record<Confidence, number>>; onLearnMore: () => void }) {
  const [open, setOpen] = useState(true);
  const rows = ROWS;
  return (
    <section aria-labelledby="legend-title" className="overflow-hidden rounded-sm">
      <h2 className="m-0">
        <button
          id="legend-title"
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center bg-accent-soft px-4 py-2.5 text-left text-[19px] font-medium text-fg"
        >
          <span className="flex-1">Assignment check</span>
          <IconChevronDown size={18} className={cx("transition-transform", open && "rotate-180")} />
        </button>
      </h2>
      {open && (
        <div className="px-4 pt-3 pb-4">
          <ul className="m-0 list-none space-y-2.5 p-0">
            {rows.map((r) => (
              <li key={r.key} className="flex items-center gap-3 text-[15px] text-fg">
                <span className="inline-block h-5 w-5 shrink-0 rounded-[2px]" style={{ background: CONFIDENCE[r.key].color }} aria-hidden="true" />
                <span className="flex-1">{r.text}</span>
                {counts?.[r.key] !== undefined && <span className="text-sm text-muted tabular-nums">{counts[r.key]}</span>}
              </li>
            ))}
            <li className="flex items-center gap-3 text-[13px] text-muted">
              <span className="inline-block h-5 w-5 shrink-0 rounded-[2px]" style={{ background: CONFIDENCE.proline.color }} aria-hidden="true" />
              <span className="flex-1">Proline (no amide H — not observed)</span>
              {counts?.proline !== undefined && <span className="tabular-nums">{counts.proline}</span>}
            </li>
          </ul>
          <p className="mt-4 mb-0 text-[14px] leading-relaxed text-fg">
            Each residue is checked against its own peaks: do the peaks of each atom agree across spectra and strips, does a Cα, Cβ or C′ link it to
            the residue before or after, and are its shifts plausible for the residue type?{" "}
            <button type="button" onClick={onLearnMore} className="text-accent hover:underline">
              Learn more…
            </button>
          </p>
        </div>
      )}
    </section>
  );
}
