"use client";
// What is worth checking in the assignment: residues whose peaks conflict, shifts unusual for the
// residue type, spin systems with missing or unexplained peaks, residues without peaks, and notes
// from reading the peak lists (peaks left out and why).
import { useMemo, type ReactNode } from "react";
import type { SpinSystemIssue } from "@/lib/assignment";
import type { ProjectView } from "@/lib/contract";
import { AA3 } from "@/lib/client/derive";
import { resiFromLabel, useSpectre } from "@/lib/client/store";
import { IconAlert, IconWrench } from "@/components/ui/Icons";
import { Chip } from "@/components/ui/primitives";

export interface RootIssue {
  root: string;
  residue?: string;
  issues: SpinSystemIssue[];
}

export interface ProblemModel {
  /** peaks of one atom that disagree, or shifts implausible for the residue type */
  conflicts: RootIssue[];
  /** shifts far from the residue type's average */
  unusual: RootIssue[];
  /** expected peaks missing, or peaks the assignment does not explain */
  peaks: RootIssue[];
  /** residues that could hold a spin system but have none */
  unassigned: { resi: number; resn: string }[];
  /** notes from reading the peak lists */
  info: string[];
  /** spin systems with conflicts, unusual shifts or peak warnings */
  actionable: number;
}

const byResidue = (x: RootIssue, y: RootIssue) => (resiFromLabel(x.residue) ?? 1e9) - (resiFromLabel(y.residue) ?? 1e9);

export function problemModel(project: ProjectView | null): ProblemModel {
  const a = project?.assignment;
  if (!project || !a) return { conflicts: [], unusual: [], peaks: [], unassigned: [], info: [], actionable: 0 };
  const conflicts: RootIssue[] = [];
  const unusual: RootIssue[] = [];
  const peaks: RootIssue[] = [];
  for (const ss of a.spinSystems) {
    const of = (...kinds: SpinSystemIssue["kind"][]) => ss.issues.filter((i) => kinds.includes(i.kind));
    if (of("conflict").length) conflicts.push({ root: ss.root, residue: ss.residue, issues: of("conflict") });
    if (of("unusual").length) unusual.push({ root: ss.root, residue: ss.residue, issues: of("unusual") });
    if (of("missing", "unexplained").length) peaks.push({ root: ss.root, residue: ss.residue, issues: of("missing", "unexplained") });
  }
  for (const list of [conflicts, unusual, peaks]) list.sort(byResidue);
  const unassigned = a.residues.filter((r, k) => !r.root && r.resn !== "P" && k > 0).map((r) => ({ resi: r.resi, resn: r.resn }));
  return { conflicts, unusual, peaks, unassigned, info: a.notes, actionable: conflicts.length + unusual.length + peaks.length };
}

export function useProblems(): ProblemModel {
  const { state } = useSpectre();
  return useMemo(() => problemModel(state.project), [state.project]);
}

function Group({ title, count, tone, children, defaultOpen = true }: { title: string; count: number; tone: "danger" | "warn" | "accent" | "ok" | "neutral"; children: ReactNode; defaultOpen?: boolean }) {
  if (!count) return null;
  return (
    <details open={defaultOpen} className="group rounded-md border border-line">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-2 text-[13px] font-medium text-fg marker:hidden">
        <Chip tone={tone}>{count}</Chip>
        <span className="flex-1">{title}</span>
        <span className="text-[11px] text-faint group-open:hidden">show</span>
      </summary>
      <div className="scroll-quiet max-h-72 space-y-1.5 overflow-y-auto border-t border-line p-2">{children}</div>
    </details>
  );
}

function RootRow({ r, icon }: { r: RootIssue; icon: "warn" | "note" }) {
  const { selectRoot } = useSpectre();
  const resi = resiFromLabel(r.residue);
  const resn = r.residue?.slice(-1);
  return (
    <div className="rounded bg-surface-2 px-2 py-1.5 text-[11.5px]">
      <div className="flex items-center gap-2">
        {icon === "warn" ? <IconAlert size={12} className="shrink-0 text-warn" /> : <IconWrench size={12} className="shrink-0 text-faint" />}
        <button type="button" className="font-mono font-medium text-accent hover:underline" onClick={() => selectRoot(r.root)}>
          #{r.root}
        </button>
        <span className="text-muted">{resi !== null && resn ? `${AA3[resn] ?? resn} ${resi}` : ""}</span>
      </div>
      <ul className="m-0 mt-1 list-none space-y-0.5 p-0">
        {r.issues.map((w, i) => (
          <li key={i} className="text-fg">
            {w.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProblemsPanel() {
  const { state, selectResidue } = useSpectre();
  const m = useProblems();
  const p = state.project;
  if (!p?.assignment) return <p className="m-0 text-sm text-muted">Add the assigned peak lists to check the assignment.</p>;
  const total = m.conflicts.length + m.unusual.length + m.peaks.length + m.unassigned.length + m.info.length;
  if (!total) return <p className="m-0 text-sm text-muted">No problems detected in the assignment.</p>;

  return (
    <div className="space-y-2">
      <Group title="Residues with conflicting peaks or shifts" count={m.conflicts.length} tone="warn">
        {m.conflicts.map((r) => (
          <RootRow key={r.root} r={r} icon="warn" />
        ))}
      </Group>

      <Group title="Shifts unusual for the residue type" count={m.unusual.length} tone="accent" defaultOpen={!m.conflicts.length}>
        {m.unusual.map((r) => (
          <RootRow key={r.root} r={r} icon="note" />
        ))}
      </Group>

      <Group title="Spin systems with missing or unexplained peaks" count={m.peaks.length} tone="neutral" defaultOpen={false}>
        {m.peaks.map((r) => (
          <RootRow key={r.root} r={r} icon="note" />
        ))}
      </Group>

      <Group title="Residues without assigned peaks" count={m.unassigned.length} tone="neutral" defaultOpen={false}>
        <div className="flex flex-wrap gap-1.5">
          {m.unassigned.map((r) => (
            <button
              key={r.resi}
              type="button"
              onClick={() => selectResidue(r.resi)}
              className="rounded-full border border-line px-2 py-0.5 font-mono text-[11px] text-fg hover:border-accent hover:text-accent"
            >
              {AA3[r.resn] ?? r.resn} {r.resi}
            </button>
          ))}
        </div>
      </Group>

      <Group title="Notes from reading the peak lists" count={m.info.length} tone="neutral" defaultOpen={false}>
        {m.info.map((n, i) => (
          <div key={i} className="flex items-start gap-2 rounded px-1.5 py-1 text-[11.5px] text-muted">
            <IconWrench size={12} className="mt-0.5 shrink-0 text-faint" />
            <span className="min-w-0 flex-1">{n}</span>
          </div>
        ))}
      </Group>

      {p.inputs && <p className="m-0 pt-1 text-[12px] text-muted">To fix a conflict, correct the peak list in your assignment software and upload it again; the check runs again on every upload.</p>}
    </div>
  );
}
