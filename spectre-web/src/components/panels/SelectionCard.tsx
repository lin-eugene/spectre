"use client";
// Details of the current selection (residue and/or spin system), synchronised across views.
import { CONFIDENCE, type Confidence } from "@/lib/contract";
import { AA3, AA_NAME, consistencyLabel, EXPERIMENT_LABEL, fmtShift, residueConfidence, SHIFT_LABELS } from "@/lib/client/derive";
import { resiFromLabel, useSpectre } from "@/lib/client/store";
import { IconClose, IconSparkle } from "@/components/ui/Icons";
import { Button, Chip } from "@/components/ui/primitives";

/** Residue-type probabilities from the spin system's shifts (BMRB statistics). */
function ProbBars({ title, types }: { title: string; types: [string, number][] }) {
  const top = types.slice(0, 4);
  const max = Math.max(1e-12, ...top.map((t) => t[1]));
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-medium tracking-wide text-muted uppercase">{title}</div>
      {top.length === 0 && <div className="text-xs text-faint">no BMRB match</div>}
      <ul className="m-0 list-none space-y-1 p-0">
        {top.map(([aa, p]) => (
          <li key={aa} className="flex items-center gap-2 text-xs">
            <span className="w-8 font-mono text-fg">{AA3[aa] ?? aa}</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(4, (100 * p) / max)}%` }} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SelectionCard() {
  const { state, selectResidue, selectRoot, setSpectrumView, sendChat } = useSpectre();
  const p = state.project;
  const { residue, root } = state.selection;
  if (!p || (residue === null && root === null)) return null;
  const ss = root ? p.assignment?.spinSystems.find((s) => s.root === root) : undefined;
  const resi = residue ?? resiFromLabel(ss?.residue);
  const rv = resi !== null ? p.assignment?.residues.find((r) => r.resi === resi) : undefined;
  const resn = resi !== null ? p.sequence[resi - p.firstResidue] : undefined;
  const confidence: Confidence = resn ? residueConfidence(resn, rv) : ss ? ss.consistency : "unassigned";
  const conf = CONFIDENCE[confidence];
  const shifts = rv?.shifts ?? {};
  const shownShifts = SHIFT_LABELS.filter(([k]) => shifts[k] !== undefined);
  const resLabel = (r: number) => {
    const n = p.sequence[r - p.firstResidue];
    return n ? `${AA3[n] ?? n} ${r}` : `${r}`;
  };
  const unexplained = ss ? ss.peaks.filter((pk) => !pk.label).length : 0;
  const peaksBySpec = ss
    ? Object.entries(
        ss.peaks.reduce<Record<string, number>>((acc, pk) => {
          acc[pk.spec] = (acc[pk.spec] ?? 0) + 1;
          return acc;
        }, {}),
      )
    : [];

  return (
    <section aria-label="Selection" className="rounded-lg border border-line bg-surface p-4 shadow-[var(--shadow)]">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium tracking-wide text-muted uppercase">Selection</div>
          <div className="mt-0.5 text-[17px] font-semibold text-fg">
            {resi !== null && resn ? `${AA3[resn] ?? resn} ${resi}` : `Spin system #${root}`}
            {resi !== null && root && <span className="ml-2 font-mono text-[13px] font-normal text-muted">#{root}</span>}
          </div>
          {resn && <div className="text-xs text-muted">{AA_NAME[resn]}</div>}
        </div>
        <button
          type="button"
          aria-label="Clear selection"
          onClick={() => {
            selectResidue(null);
            selectRoot(null);
          }}
          className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
        >
          <IconClose size={15} />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[11px] text-fg">
          <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: conf.color }} />
          {conf.label} · {consistencyLabel(confidence)}
        </span>
        {ss && (
          <Chip title="spin systems of the neighbouring residues whose carbons match this one's (i-1) or (i) peaks">
            {ss.links.length ? `linked to ${ss.links.map(([to]) => resLabel(parseInt(to, 10))).join(" and ")}` : "no sequential link"}
          </Chip>
        )}
      </div>

      {shownShifts.length > 0 && (
        <div className="mt-3 grid grid-cols-5 gap-1 rounded-md bg-surface-2 px-2.5 py-2 font-mono text-[12px]">
          {shownShifts.map(([k, label]) => (
            <div key={k} className="flex flex-col">
              <span className="text-faint">{label}</span>
              <span className="text-fg tabular-nums">{fmtShift(k, shifts[k])}</span>
            </div>
          ))}
        </div>
      )}
      {ss && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <ProbBars title="Residue type i" types={ss.typesI} />
            <ProbBars title="Residue type i−1" types={ss.typesIm1} />
          </div>
          <div className="mt-3 text-xs text-muted">
            Peaks: {peaksBySpec.map(([spec, n]) => `${EXPERIMENT_LABEL[spec] ?? spec} ${n}`).join(" · ")}
            {unexplained > 0 && <span className="text-faint"> · {unexplained} unexplained</span>}
          </div>
          {ss.issues.length > 0 && (
            <ul className="mt-2 mb-0 list-none space-y-1 p-0 text-[11px]">
              {ss.issues.slice(0, 6).map((e, i) => (
                <li key={i} className={e.kind === "conflict" ? "rounded bg-warn-soft px-2 py-1 text-warn" : "rounded bg-surface-2 px-2 py-1 text-muted"}>
                  {e.text}
                </li>
              ))}
              {ss.issues.length > 6 && <li className="pl-2 text-faint">+{ss.issues.length - 6} more under Problems</li>}
            </ul>
          )}
        </>
      )}
      {!ss && resi !== null && resn !== "P" && <p className="mt-3 mb-0 text-xs text-muted">No spin system is placed on this residue.</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {(ss || resi !== null) && (
          <Button size="sm" onClick={() => setSpectrumView("strips")}>
            Show strips
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void sendChat(
              ss
                ? `Explain the assignment of spin system #${ss.root}${resi !== null ? ` to ${AA3[resn ?? ""] ?? ""}${resi}` : ""}.`
                : `What do we know about residue ${resi}${resn ? ` (${AA3[resn]})` : ""}?`,
            )
          }
        >
          <IconSparkle size={13} /> Explain
        </Button>
      </div>
    </section>
  );
}
