"use client";
// AlphaFold-style sequence box: one-letter sequence, orange numbers every ten residues,
// each residue underlined in its assignment-confidence colour. Click / arrow keys select.
import { useEffect, useMemo, useRef, useState } from "react";
import { CONFIDENCE } from "@/lib/contract";
import { AA3, consistencyLabel, fmtShift, residueInfos, SHIFT_LABELS, type ResidueInfo } from "@/lib/client/derive";
import { useSpectre } from "@/lib/client/store";
import { IconCopy } from "@/components/ui/Icons";

interface Tip {
  info: ResidueInfo;
  x: number;
  y: number;
}

export function SequenceViewer() {
  const { state, selectResidue, hoverResidue, notify } = useSpectre();
  const p = state.project;
  const infos = useMemo(() => residueInfos(p), [p]);
  const boxRef = useRef<HTMLDivElement>(null);
  const spanRefs = useRef(new Map<number, HTMLSpanElement>());
  const [tip, setTip] = useState<Tip | null>(null);
  const selected = state.selection.residue;
  const highlight = useMemo(() => new Set(state.highlights.residues), [state.highlights.residues]);

  // keep the selected residue visible when it changes elsewhere (spectrum, 3D, chat)
  useEffect(() => {
    if (selected === null) return;
    const el = spanRefs.current.get(selected);
    const box = boxRef.current;
    if (!el || !box) return;
    const top = el.offsetTop - box.offsetTop;
    if (top < box.scrollTop + 8 || top > box.scrollTop + box.clientHeight - 24) {
      box.scrollTo({ top: Math.max(0, top - 24), behavior: "smooth" });
    }
  }, [selected]);

  const showTip = (info: ResidueInfo, el: HTMLElement) => {
    const box = boxRef.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (!box) return;
    setTip({ info, x: r.left - box.left + r.width / 2, y: r.bottom - box.top + 6 });
  };

  const move = (delta: number | "up" | "down") => {
    if (!infos.length) return;
    const cur = selected ?? infos[0].resi;
    if (typeof delta === "number") {
      const first = infos[0].resi;
      const last = infos[infos.length - 1].resi;
      selectResidue(Math.min(last, Math.max(first, cur + delta)));
      return;
    }
    const el = spanRefs.current.get(cur);
    if (!el) return;
    const x = el.offsetLeft;
    const y = el.offsetTop;
    let best: number | null = null;
    let bestScore = Infinity;
    for (const [resi, s] of spanRefs.current) {
      const dy = s.offsetTop - y;
      if (delta === "down" ? dy <= 4 : dy >= -4) continue;
      const score = Math.abs(dy) * 1000 + Math.abs(s.offsetLeft - x);
      if (score < bestScore) {
        bestScore = score;
        best = resi;
      }
    }
    if (best !== null) selectResidue(best);
  };

  const copy = async () => {
    if (!p) return;
    const fasta = `>${p.meta.name}${p.meta.uniprot ? ` | ${p.meta.uniprot}` : ""}\n${p.sequence.match(/.{1,60}/g)?.join("\n") ?? p.sequence}\n`;
    try {
      await navigator.clipboard.writeText(fasta);
      notify("Sequence copied as FASTA", "ok");
    } catch {
      notify("Clipboard unavailable — select the sequence text instead", "error");
    }
  };

  return (
    <section aria-label="Sequence" className="relative">
      <div className="mb-1.5 flex justify-end">
        <button type="button" onClick={copy} className="inline-flex items-center gap-1 text-[13px] text-accent hover:underline" disabled={!p}>
          <IconCopy size={13} /> Copy sequence
        </button>
      </div>
      <div className="rounded-sm border border-line bg-surface-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line-strong px-4 pt-3 pb-2">
          <h2 className="text-[15px] font-semibold text-fg">
            A <span className="font-normal text-muted">|</span> 1: {p?.meta.name ?? "…"}
          </h2>
          <span className="text-xs text-muted">
            {p ? `${p.sequence.length} residues · ${p.firstResidue}–${p.firstResidue + p.sequence.length - 1}` : ""}
          </span>
          <div className="flex-1" />
          <div className="hidden items-center gap-3 text-[11px] text-muted sm:flex" aria-hidden="true">
            {(["veryHigh", "high", "low", "unassigned"] as const).map((c) => (
              <span key={c} className="inline-flex items-center gap-1">
                <span className="inline-block h-[3px] w-3.5 rounded" style={{ background: CONFIDENCE[c].color }} />
                {CONFIDENCE[c].label}
              </span>
            ))}
          </div>
        </div>
        <div
          ref={boxRef}
          role="listbox"
          aria-label={`${p?.meta.name ?? "Protein"} sequence; use arrow keys to move between residues`}
          aria-activedescendant={selected !== null ? `res-${selected}` : undefined}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") move(1);
            else if (e.key === "ArrowLeft") move(-1);
            else if (e.key === "ArrowDown") move("down");
            else if (e.key === "ArrowUp") move("up");
            else if (e.key === "Home") {
              if (infos.length) selectResidue(infos[0].resi);
            } else if (e.key === "End") {
              if (infos.length) selectResidue(infos[infos.length - 1].resi);
            }
            else if (e.key === "Escape") selectResidue(null);
            else return;
            e.preventDefault();
          }}
          onMouseLeave={() => {
            setTip(null);
            hoverResidue(null);
          }}
          className="scroll-quiet relative max-h-[7.4rem] overflow-y-auto px-4 pt-5 pb-3 font-mono text-[15px] tracking-[0.06em] break-all text-fg"
        >
          {!p && <div className="skeleton h-5 w-full" />}
          <div className="flex flex-wrap gap-y-[1.15rem]">
            {infos.map((info, i) => (
              <span
                key={info.resi}
                id={`res-${info.resi}`}
                role="option"
                aria-selected={selected === info.resi}
                ref={(el) => {
                  if (el) spanRefs.current.set(info.resi, el);
                  else spanRefs.current.delete(info.resi);
                }}
                aria-label={`${AA3[info.resn] ?? info.resn} ${info.resi}, ${CONFIDENCE[info.confidence].label}${info.root ? `, spin system ${info.root}` : ""}`}
                className="seq-residue"
                data-selected={selected === info.resi}
                data-highlight={highlight.has(info.resi)}
                style={
                  {
                    "--conf": CONFIDENCE[info.confidence].color,
                    "--hl": state.highlights.color ?? "var(--accent)",
                  } as React.CSSProperties
                }
                onMouseEnter={(e) => {
                  showTip(info, e.currentTarget);
                  hoverResidue(info.resi);
                }}
                onClick={() => selectResidue(selected === info.resi ? null : info.resi)}
              >
                {i % 10 === 0 && (
                  <span className="seq-number" aria-hidden="true">
                    {info.resi}
                  </span>
                )}
                {info.resn}
              </span>
            ))}
          </div>
        </div>
      </div>
      {tip && <ResidueTip tip={tip} />}
    </section>
  );
}

function ResidueTip({ tip }: { tip: Tip }) {
  const { info } = tip;
  const conf = CONFIDENCE[info.confidence];
  const shifts = SHIFT_LABELS.filter(([k]) => info.shifts[k] !== undefined);
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 w-60 -translate-x-1/2 rounded-lg border border-line bg-surface px-3 py-2.5 text-[12px] shadow-[var(--shadow-lg)]"
      style={{ left: `clamp(7.5rem, ${tip.x}px, calc(100% - 7.5rem))`, top: tip.y + 30 }}
    >
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-fg">
          {AA3[info.resn] ?? info.resn} {info.resi}
        </span>
        {info.root && <span className="font-mono text-muted">spin system #{info.root}</span>}
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-muted">
        <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: conf.color }} />
        {conf.label} · {consistencyLabel(info.confidence)}
      </div>
      {shifts.length > 0 ? (
        <div className="mt-1.5 grid grid-cols-5 gap-1 font-mono text-[11px]">
          {shifts.map(([k, label]) => (
            <div key={k} className="flex flex-col">
              <span className="text-faint">{label}</span>
              <span className="text-fg tabular-nums">{fmtShift(k, info.shifts[k])}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-1 text-faint">{info.resn === "P" ? "No amide proton." : "No chemical shifts assigned."}</div>
      )}
    </div>
  );
}
