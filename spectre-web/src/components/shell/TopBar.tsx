"use client";
import { useState } from "react";
import { useSpectre } from "@/lib/client/store";
import Image from "next/image";
import { IconLibrary, IconSearch, IconSparkle } from "@/components/ui/Icons";
import { cx, Spinner } from "@/components/ui/primitives";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { ThemeToggle } from "./ThemeToggle";

const THREE: Record<string, string> = {
  ALA: "A", CYS: "C", ASP: "D", GLU: "E", PHE: "F", GLY: "G", HIS: "H", ILE: "I", LYS: "K", LEU: "L",
  MET: "M", ASN: "N", PRO: "P", GLN: "Q", ARG: "R", SER: "S", THR: "T", VAL: "V", TRP: "W", TYR: "Y",
};

export function TopBar() {
  const { state, selectResidue, selectRoot, setChatOpen, notify, setLibraryOpen } = useSpectre();
  const job = state.importJob;
  const isRunning = !!job && (job.status === "queued" || job.status === "downloading" || job.status === "processing");
  const [q, setQ] = useState("");

  const jump = () => {
    const s = q.trim();
    if (!s || !state.project) return;
    const p = state.project;
    const root = s.match(/^(?:#|root\s*|ss\s*|spin(?:\s*system)?\s*)(\w+)$/i);
    if (root) {
      if (p.assignment?.spinSystems.some((x) => x.root === root[1])) {
        selectRoot(root[1]);
        setQ("");
      } else notify(`No spin system “${root[1]}”`, "error");
      return;
    }
    const m = s.match(/^([A-Za-z]{1,3})?\s*(-?\d+)$/);
    if (m) {
      const resi = parseInt(m[2], 10);
      const idx = resi - p.firstResidue;
      if (idx < 0 || idx >= p.sequence.length) {
        notify(`Residue ${resi} is outside the sequence`, "error");
        return;
      }
      const code = m[1] ? (m[1].length === 3 ? THREE[m[1].toUpperCase()] : m[1].toUpperCase()) : undefined;
      if (code && code !== p.sequence[idx]) notify(`Residue ${resi} is ${p.sequence[idx]}, not ${code}`, "info");
      selectResidue(resi);
      setQ("");
      return;
    }
    notify("Try a residue like “L43” or a spin system like “#12”", "info");
  };

  return (
    <header
      className="sticky z-30 border-b border-line bg-surface/90 backdrop-blur supports-[backdrop-filter]:bg-surface/75"
      style={{ top: "env(safe-area-inset-top, 0px)" }}
    >
      <div className="mx-auto flex h-14 max-w-[1680px] items-center gap-3 px-4 sm:px-6">
        <a href="#top" className="flex shrink-0 items-center gap-2.5 text-fg no-underline">
          <Image src="/logo.png" alt="" width={40} height={36} loading="eager" style={{ width: 40, height: 36 }} />
          <span className="flex flex-col leading-tight">
            <span className="text-[15px] font-semibold tracking-tight">Spectre</span>
            <span className="hidden text-[11px] text-muted sm:block">Solving the slowest step in protein NMR</span>
          </span>
        </a>
        <div className="ml-2 hidden md:block">
          <ProjectSwitcher />
        </div>
        <button
          type="button"
          onClick={() => setLibraryOpen(true)}
          className="hidden h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-muted hover:bg-surface-2 hover:text-fg sm:inline-flex"
          title="Browse the ARTINA library of real NMR spectra"
        >
          <IconLibrary size={15} /> Library
        </button>
        {job && isRunning && (
          <button
            type="button"
            onClick={() => setLibraryOpen(true)}
            className="inline-flex h-7 items-center gap-1.5 rounded-full bg-accent-faint px-2.5 text-[12px] text-accent"
            title={job.message}
          >
            <Spinner size={12} /> {job.proteinId} {Math.round(job.progress * 100)}%
          </button>
        )}
        <nav aria-label="Sections" className="ml-2 hidden items-center gap-1 text-[13px] 2xl:flex">
          {[
            ["#entry", "Entry"],
            ["#viewer", "Spectra & structure"],
            ["#peaklists", "Peak lists"],
            ["#history", "History"],
          ].map(([href, label]) => (
            <a key={href} href={href} className="rounded-md px-2.5 py-1.5 text-muted no-underline hover:bg-surface-2 hover:text-fg">
              {label}
            </a>
          ))}
        </nav>
        <div className="flex-1" />
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            jump();
          }}
          className="relative hidden w-64 lg:block"
        >
          <IconSearch size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Jump to residue (L43) or spin system (#12)"
            aria-label="Jump to residue or spin system"
            className="h-8 w-full rounded-md border border-line bg-surface-2 pr-2 pl-8 text-[13px] text-fg placeholder:text-faint focus:border-accent focus:bg-surface"
          />
        </form>
        {state.busy && (
          <span className="hidden items-center gap-1.5 text-xs text-muted sm:flex" aria-live="polite">
            <Spinner size={13} /> {state.busy}…
          </span>
        )}
        <ThemeToggle />
        <button
          type="button"
          onClick={() => setChatOpen(!state.chatOpen)}
          aria-pressed={state.chatOpen}
          className={cx(
            "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors",
            state.chatOpen ? "bg-accent text-accent-fg" : "bg-accent-faint text-accent hover:bg-accent-soft",
          )}
        >
          <IconSparkle size={15} />
          <span className="hidden sm:inline">Ask Spectre</span>
        </button>
      </div>
    </header>
  );
}
