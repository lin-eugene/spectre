"use client";
// Top-bar project menu: switch between saved projects, open the featured real-data project (2K50),
// start a new demo, open the library.
import { useEffect, useRef, useState } from "react";
import { fmtDate } from "@/lib/client/derive";
import { useSpectre } from "@/lib/client/store";
import { IconCheck, IconChevronDown, IconDownload, IconRefresh } from "@/components/ui/Icons";
import { cx, Spinner } from "@/components/ui/primitives";

function sourceLabel(source?: string): string | null {
  if (!source) return null;
  if (source.startsWith("demo")) return "demo";
  if (source.startsWith("artina")) return "ARTINA";
  if (source === "upload") return "your data";
  return source;
}

export function ProjectSwitcher() {
  const { state, switchProject, refreshProjects, resetDemo, setLibraryOpen, openFeatured, setUploadOpen } = useSpectre();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const name = state.project?.meta.name ?? (state.status === "loading" ? "Loading…" : "No project");
  const currentSource = sourceLabel(state.project?.meta.source);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) {
      setLoading(true);
      await refreshProjects();
      setLoading(false);
    }
  };

  // current project first, then most recently updated
  const projects = [...state.projects]
    .sort((a, b) => Number(b.id === state.projectId) - Number(a.id === state.projectId) || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 30);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-8 max-w-[15rem] items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-[13px] text-fg hover:border-line-strong"
        title="Switch project"
      >
        <span className="text-faint">Project</span>
        <span className="truncate font-medium">{name}</span>
        {currentSource && <span className="hidden rounded bg-surface-2 px-1 text-[10px] text-muted xl:inline">{currentSource}</span>}
        <IconChevronDown size={14} className={cx("shrink-0 text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div role="menu" className="absolute top-10 left-0 z-50 w-80 overflow-hidden rounded-lg border border-line bg-surface shadow-[var(--shadow-lg)]">
          <div className="flex items-center justify-between border-b border-line px-3 py-2 text-[11px] font-medium tracking-wide text-muted uppercase">
            Projects
            {loading ? (
              <Spinner size={12} />
            ) : (
              <button type="button" aria-label="Refresh project list" className="text-muted hover:text-fg" onClick={() => void refreshProjects()}>
                <IconRefresh size={13} />
              </button>
            )}
          </div>
          <ul className="scroll-quiet m-0 max-h-72 list-none overflow-y-auto p-1">
            {projects.length === 0 && !loading && <li className="px-2 py-3 text-[12px] text-muted">No saved projects yet.</li>}
            {projects.map((p) => {
              const current = p.id === state.projectId;
              const src = sourceLabel(p.source);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={current}
                    onClick={() => {
                      setOpen(false);
                      if (!current) void switchProject(p.id);
                    }}
                    className={cx("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left", current ? "bg-accent-faint" : "hover:bg-surface-2")}
                  >
                    <span className="grid w-4 place-items-center">{current && <IconCheck size={13} className="text-accent" />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-fg">
                        {current && state.project ? state.project.meta.name : p.name}
                        {src && <span className="ml-1.5 rounded bg-surface-2 px-1 text-[10px] font-normal text-muted">{src}</span>}
                      </span>
                      <span className="block truncate text-[11px] text-faint">
                        {fmtDate(p.updatedAt)} · <span className="font-mono">{p.id.slice(0, 8)}</span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="space-y-0.5 border-t border-line p-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setUploadOpen(true);
              }}
              className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-fg hover:bg-surface-2"
            >
              <span className="mt-0.5 grid w-[14px] place-items-center text-accent">↑</span>
              <span className="min-w-0">
                <span className="block font-medium">New project from your spectra…</span>
                <span className="block text-[11px] text-faint">FASTA sequence + NMRPipe 3D spectra with assigned peak lists</span>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void openFeatured();
              }}
              className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-fg hover:bg-surface-2"
            >
              <span className="mt-0.5 grid w-[14px] place-items-center text-accent">★</span>
              <span className="min-w-0">
                <span className="block font-medium">2K50 · real spectra</span>
                <span className="block text-[11px] text-faint">ARTINA dataset, 110 residues, measured 2D/3D spectra</span>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setLibraryOpen(true);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-fg hover:bg-surface-2"
            >
              <IconDownload size={14} className="text-accent" /> Open ARTINA library…
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void resetDemo();
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-fg hover:bg-surface-2"
            >
              <span className="grid w-[14px] place-items-center text-accent">+</span> New demo project (ubiquitin)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
