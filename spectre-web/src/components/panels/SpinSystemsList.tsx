"use client";
import { useMemo, useState } from "react";
import { CONFIDENCE } from "@/lib/contract";
import { AA3 } from "@/lib/client/derive";
import { resiFromLabel, useSpectre } from "@/lib/client/store";
import { IconAlert, IconSearch } from "@/components/ui/Icons";
import { cx } from "@/components/ui/primitives";

type Filter = "all" | "veryHigh" | "high" | "low" | "problems";

export function SpinSystemsList() {
  const { state, selectRoot } = useSpectre();
  const systems = useMemo(() => state.project?.assignment?.spinSystems ?? [], [state.project]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return systems
      .filter((ss) => {
        if (filter === "problems" && ss.issues.length === 0) return false;
        if (filter !== "all" && filter !== "problems" && ss.consistency !== filter) return false;
        if (!s) return true;
        const resi = resiFromLabel(ss.residue);
        const resn = ss.residue?.slice(-1) ?? "";
        return (
          ss.root.toLowerCase() === s.replace(/^#/, "") ||
          (ss.residue ?? "").toLowerCase().includes(s) ||
          `${(AA3[resn] ?? "").toLowerCase()}${resi ?? ""}`.includes(s) ||
          `${resn.toLowerCase()}${resi ?? ""}` === s
        );
      })
      .sort((a, b) => (resiFromLabel(a.residue) ?? 1e9) - (resiFromLabel(b.residue) ?? 1e9) || Number(a.root) - Number(b.root));
  }, [systems, q, filter]);

  if (!systems.length) return <p className="m-0 text-sm text-muted">Add the assigned peak lists to build the spin systems.</p>;

  return (
    <div>
      <div className="relative">
        <IconSearch size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter: #12, L43, Leu…"
          aria-label="Filter spin systems"
          className="h-8 w-full rounded-md border border-line bg-surface pr-2 pl-8 text-[13px] text-fg placeholder:text-faint focus:border-accent"
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Filter by consistency">
        {(
          [
            ["all", "All"],
            ["veryHigh", CONFIDENCE.veryHigh.label],
            ["high", CONFIDENCE.high.label],
            ["low", CONFIDENCE.low.label],
            ["problems", "Any issue"],
          ] as [Filter, string][]
        ).map(([f, label]) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={cx(
              "rounded-full border px-2 py-0.5 text-[11px]",
              filter === f ? "border-accent bg-accent-faint text-accent" : "border-line text-muted hover:text-fg",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <ul className="scroll-quiet m-0 mt-2 max-h-72 list-none overflow-y-auto p-0">
        {rows.map((ss) => {
          const conf = ss.consistency;
          const resi = resiFromLabel(ss.residue);
          const resn = ss.residue?.slice(-1);
          const active = state.selection.root === ss.root;
          return (
            <li key={ss.root}>
              <button
                type="button"
                onClick={() => selectRoot(active ? null : ss.root)}
                aria-current={active ? "true" : undefined}
                className={cx(
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px]",
                  active ? "bg-accent-faint" : "hover:bg-surface-2",
                )}
              >
                <span className="inline-block h-3 w-3 shrink-0 rounded-[3px]" style={{ background: CONFIDENCE[conf].color }} aria-hidden="true" />
                <span className="w-10 font-mono text-muted">#{ss.root}</span>
                <span className="flex-1 font-medium text-fg">{resi !== null && resn ? `${AA3[resn] ?? resn} ${resi}` : ss.residue}</span>
                {ss.issues.length > 0 && (
                  <span title={ss.issues.map((i) => i.text).join("\n")} className="text-warn">
                    <IconAlert size={13} />
                  </span>
                )}
                <span className="w-14 text-right text-[11px] text-faint tabular-nums" title="sequential links to the neighbouring residues">
                  {ss.links.length} link{ss.links.length === 1 ? "" : "s"}
                </span>
              </button>
            </li>
          );
        })}
        {rows.length === 0 && <li className="px-2 py-3 text-sm text-muted">No spin systems match.</li>}
      </ul>
    </div>
  );
}
