"use client";
// ARTINA spectra library: browse the 100 proteins of the ARTINA dataset (real 2D–4D NMR
// spectra, nmrdb.ethz.ch, CC BY 4.0), inspect their experiments and import one as a project:
// its NMRPipe backbone spectra are downloaded with their deposited assigned peak lists, and the
// assignment is built from those lists.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ArtinaProteinSummary, ImportJob } from "@/lib/contract";
import { getArtinaCatalog } from "@/lib/client/api";
import { useSpectre } from "@/lib/client/store";
import { IconAlert, IconCheck, IconClose, IconDownload, IconExternal, IconSearch } from "@/components/ui/Icons";
import { Button, Chip, cx, Spinner } from "@/components/ui/primitives";

export const ARTINA_URL = "https://nmrdb.ethz.ch/";
export const CC_BY_URL = "https://creativecommons.org/licenses/by/4.0/";

/** Backbone experiments an import uses, in display order (ARTINA spelling). */
const BACKBONE = ["HNCO", "HNcaCO", "HNCA", "HNcoCA", "CBCANH", "CBCAcoNH"] as const;
const BACKBONE_SHORT: Record<string, string> = { HNCO: "CO", HNcaCO: "caCO", HNCA: "CA", HNcoCA: "coCA", CBCANH: "CBCA", CBCAcoNH: "CBcoCA" };
/** the core pair for the consistency check: CA(i, i-1) from an HNCA, CA/CB(i, i-1) from a CBCANH */
const CORE = ["HNCA", "CBCANH"];
const STAGE: Record<string, string> = { download: "download", build: "project" };

type SortKey = "size" | "residues" | "year" | "id" | "completeness";

let catalogCache: Promise<ArtinaProteinSummary[]> | null = null;
function loadCatalog(force = false): Promise<ArtinaProteinSummary[]> {
  if (force || !catalogCache) {
    catalogCache = getArtinaCatalog().catch((e) => {
      catalogCache = null;
      throw e;
    });
  }
  return catalogCache;
}

const isRunning = (j: ImportJob | null) => !!j && (j.status === "queued" || j.status === "downloading" || j.status === "processing");
const hasCore = (p: ArtinaProteinSummary) => CORE.every((c) => p.backbone.some((b) => b.toLowerCase() === c.toLowerCase()));
const hasBackbone = (p: ArtinaProteinSummary, name: string) => p.backbone.some((b) => b.toLowerCase() === name.toLowerCase());
const fmtMB = (mb: number | null | undefined) => (mb === null || mb === undefined ? "–" : mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`);

export function Attribution({ className }: { className?: string }) {
  return (
    <p className={cx("m-0 text-[12px] text-muted", className)}>
      Data:{" "}
      <a href={ARTINA_URL} target="_blank" rel="noreferrer" className="text-accent hover:underline">
        ARTINA NMR spectra dataset, nmrdb.ethz.ch
      </a>
      ,{" "}
      <a href={CC_BY_URL} target="_blank" rel="noreferrer" className="text-accent hover:underline">
        CC BY 4.0
      </a>{" "}
      — Klukowski et al., ETH Zürich.
    </p>
  );
}

function ImportProgress({ job }: { job: ImportJob }) {
  const logRef = useRef<HTMLPreElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    boxRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [job.log.length]);
  const pct = Math.round(Math.max(0, Math.min(1, job.progress)) * 100);
  const tone = job.status === "error" ? "danger" : job.status === "done" ? "ok" : "accent";
  return (
    <div ref={boxRef} className="rounded-lg border border-line bg-surface-2 p-3" aria-live="polite">
      <div className="flex items-center gap-2 text-[13px]">
        {isRunning(job) ? <Spinner size={14} className="text-accent" /> : job.status === "done" ? <IconCheck size={15} className="text-ok" /> : <IconAlert size={15} className="text-danger" />}
        <span className="font-medium text-fg">
          {job.status === "done" ? "Imported" : job.status === "error" ? "Import failed" : "Importing"} {job.proteinId}
        </span>
        <Chip tone={tone}>{job.status}</Chip>
        {job.stage && job.status !== "done" && job.status !== "error" && <Chip>{STAGE[job.stage] ?? job.stage}</Chip>}
        <span className="flex-1" />
        <span className="font-mono text-[12px] text-muted tabular-nums">{pct}%</span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={`Import progress ${pct}%`}
      >
        <div
          className={cx("h-full rounded-full transition-[width] duration-500", job.status === "error" ? "bg-danger" : job.status === "done" ? "bg-ok" : "bg-accent")}
          style={{ width: `${Math.max(job.status === "queued" ? 3 : 0, pct)}%` }}
        />
      </div>
      <div className="mt-1.5 text-[12px] text-muted">{job.error ?? job.message}</div>
      {job.log.length > 0 && (
        <pre ref={logRef} className="scroll-quiet m-0 mt-2 max-h-36 overflow-y-auto rounded-md bg-surface p-2 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap text-muted">
          {job.log.join("\n")}
        </pre>
      )}
    </div>
  );
}

function Detail({ p }: { p: ArtinaProteinSummary }) {
  const { state, startImport, switchProject, setLibraryOpen } = useSpectre();
  const [maxMB, setMaxMB] = useState("");
  const job = state.importJob && state.importJob.proteinId === p.id ? state.importJob : null;
  const otherRunning = isRunning(state.importJob) && !job;
  const totalMB = p.spectra.reduce((s, x) => s + (x.mb ?? 0), 0);

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="m-0 font-mono text-[26px] font-semibold tracking-tight text-fg">{p.id}</h3>
          <span className="text-[14px] text-muted">
            {p.residues} residues{p.year ? ` · ${p.year}` : ""}
          </span>
          {p.cached && <Chip tone="ok">cached locally</Chip>}
        </div>
        {p.reference && <p className="mt-1.5 mb-0 text-[13px] leading-relaxed text-fg">{p.reference}</p>}
        <div className="mt-2 flex flex-wrap gap-3 text-[13px]">
          {p.pdb && (
            <a href={`https://www.rcsb.org/structure/${p.pdb}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
              PDB {p.pdb} <IconExternal size={12} />
            </a>
          )}
          {p.bmrb && (
            <a href={`https://bmrb.io/data_library/summary/index.php?bmrbId=${p.bmrb}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
              BMRB {p.bmrb} <IconExternal size={12} />
            </a>
          )}
          <a href={ARTINA_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
            ARTINA dataset <IconExternal size={12} />
          </a>
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-baseline gap-2">
          <h4 className="m-0 text-[13px] font-semibold text-fg">Spectra ({p.spectra.length})</h4>
          <span className="text-[12px] text-muted">{fmtMB(totalMB)} in total</span>
        </div>
        <div className="scroll-quiet max-h-64 overflow-auto rounded-md border border-line">
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 bg-surface-2 text-left text-[11px] text-muted">
              <tr>
                <th className="px-2 py-1.5 font-medium">Experiment</th>
                <th className="px-2 py-1.5 font-medium">Points</th>
                <th className="px-2 py-1.5 font-medium">ppm ranges</th>
                <th className="px-2 py-1.5 font-medium">Field</th>
                <th className="px-2 py-1.5 text-right font-medium">Size</th>
                <th className="px-2 py-1.5 text-right font-medium" title="peaks assigned in the reference data">
                  Assigned
                </th>
              </tr>
            </thead>
            <tbody>
              {p.spectra.map((s, i) => {
                const backbone = hasBackbone(p, s.type);
                return (
                  <tr key={`${s.type}-${i}`} className="border-t border-line align-top">
                    <td className="px-2 py-1.5 font-medium whitespace-nowrap text-fg">
                      {s.type}
                      {backbone && <span className="ml-1.5 rounded bg-accent-faint px-1 text-[10px] text-accent">backbone</span>}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-[11px] whitespace-nowrap text-muted">{s.size}</td>
                    <td className="px-2 py-1.5 font-mono text-[11px] whitespace-nowrap text-muted">
                      {s.ppm.split(/\s*\|\s*/).map((r, j) => {
                        const k = r.indexOf(":");
                        return (
                          <div key={j}>
                            {k > 0 ? (
                              <>
                                <span className="text-faint">{r.slice(0, k)}</span>
                                {r.slice(k)}
                              </>
                            ) : (
                              r
                            )}
                          </div>
                        );
                      })}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-[11px] whitespace-nowrap text-muted">{/^\d+(\.\d+)?$/.test(s.freq.trim()) ? `${s.freq} MHz` : s.freq}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-[11px] whitespace-nowrap text-fg">{fmtMB(s.mb)}</td>
                    <td
                      className="px-2 py-1.5 text-right font-mono text-[11px] whitespace-nowrap text-muted"
                      title={s.nAssigned ? `${s.nAssigned.replace(/sparky,?/i, "").trim()} assigned peaks in the reference list` : undefined}
                    >
                      {s.pctAssigned ? (/^[\d.]+$/.test(s.pctAssigned.trim()) ? `${Number(s.pctAssigned).toFixed(0)}%` : s.pctAssigned) : "–"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h4 className="m-0 mb-1.5 text-[13px] font-semibold text-fg">Import as a Spectre project</h4>
        <p className="m-0 text-[12.5px] leading-relaxed text-muted">
          Downloads the NMRPipe backbone spectra with their <span className="font-medium text-fg">deposited assigned peak lists</span>, the
          ¹⁵N-HSQC and the structures, then builds the assignment from those lists and checks every residue for consistency. Nothing is
          picked or placed, so once the files are downloaded (and cached for next time) the project is ready at once.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[12.5px] text-muted">
          <span>
            Backbone spectra: <span className="font-medium text-fg">{p.backbone.length ? p.backbone.join(", ") : "none"}</span>
          </span>
          <span>
            Download: <span className="font-medium text-fg">{fmtMB(p.backboneMB)}</span>
            {p.cached && " (cached)"}
          </span>
          <label className="inline-flex items-center gap-1.5">
            Max MB
            <input
              type="number"
              min={10}
              step={50}
              value={maxMB}
              onChange={(e) => setMaxMB(e.target.value)}
              placeholder="auto"
              className="h-7 w-20 rounded border border-line bg-surface px-2 font-mono text-[12px] text-fg focus:border-accent"
            />
          </label>
        </div>
        {!hasCore(p) && (
          <p className="m-0 mt-2 flex items-center gap-1.5 text-[12px] text-warn">
            <IconAlert size={13} /> No {CORE.filter((c) => !hasBackbone(p, c)).join(" or ")}: fewer Cα and Cβ shifts to cross-check, so expect fewer residues confirmed.
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            disabled={isRunning(job) || otherRunning || p.backbone.length === 0}
            onClick={() => void startImport(p.id, maxMB && Number(maxMB) > 0 ? { maxMB: Number(maxMB) } : {})}
          >
            <IconDownload size={14} /> {isRunning(job) ? "Importing…" : `Import ${p.id}`}
          </Button>
          {job?.projectId && state.projectId !== job.projectId && (
            <Button
              onClick={() => {
                setLibraryOpen(false);
                void switchProject(job.projectId!);
              }}
            >
              Open project
            </Button>
          )}
          {otherRunning && <span className="text-[12px] text-muted">Another import ({state.importJob?.proteinId}) is running.</span>}
          {p.backbone.length === 0 && <span className="text-[12px] text-muted">No backbone experiments to assign from.</span>}
        </div>
      </div>
      {job && <ImportProgress job={job} />}
    </div>
  );
}

export function LibraryModal() {
  const { state, setLibraryOpen, notify } = useSpectre();
  const open = state.libraryOpen;
  const [proteins, setProteins] = useState<ArtinaProteinSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [minRes, setMinRes] = useState("");
  const [maxRes, setMaxRes] = useState("");
  const [complete, setComplete] = useState(false);
  const [cachedOnly, setCachedOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("size");
  const [desc, setDesc] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    loadCatalog(attempt > 0)
      .then((list) => {
        if (!alive) return;
        setProteins(list);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    const t = window.setTimeout(() => searchRef.current?.focus(), 60);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [open, attempt]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLibraryOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, setLibraryOpen]);

  const rows = useMemo(() => {
    if (!proteins) return [];
    const s = q.trim().toLowerCase();
    const lo = minRes ? Number(minRes) : -Infinity;
    const hi = maxRes ? Number(maxRes) : Infinity;
    const out = proteins.filter((p) => {
      if (p.residues < lo || p.residues > hi) return false;
      if (complete && !hasCore(p)) return false;
      if (cachedOnly && !p.cached) return false;
      if (!s) return true;
      return [p.id, p.pdb ?? "", p.bmrb ?? "", p.reference ?? "", p.year ?? ""].some((v) => v.toLowerCase().includes(s));
    });
    const key = (p: ArtinaProteinSummary): number | string => {
      switch (sort) {
        case "size":
          return p.backboneMB;
        case "residues":
          return p.residues;
        case "year":
          return p.year ? Number(p.year) || 0 : 0;
        case "completeness":
          return p.backbone.length;
        default:
          return p.id;
      }
    };
    out.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      const c = typeof ka === "number" && typeof kb === "number" ? ka - kb : String(ka).localeCompare(String(kb));
      return desc ? -c : c;
    });
    return out;
  }, [proteins, q, minRes, maxRes, complete, cachedOnly, sort, desc]);

  const current = rows.find((p) => p.id === selected) ?? proteins?.find((p) => p.id === selected) ?? rows[0] ?? null;
  const job = state.importJob;

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 p-0 backdrop-blur-[2px] sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && setLibraryOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-title"
        className="flex h-full w-full max-w-[1280px] flex-col overflow-hidden bg-surface shadow-[var(--shadow-lg)] sm:rounded-xl sm:border sm:border-line"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id="library-title" className="m-0 text-[20px] font-semibold tracking-tight text-fg">
              ARTINA spectra library
            </h2>
            <p className="m-0 mt-0.5 text-[13px] text-muted">
              {proteins ? `${proteins.length} proteins` : "100 proteins"} with real 2D–4D NMR spectra and deposited assignments. Import one to check
              its backbone assignment.
            </p>
            <Attribution className="mt-1" />
          </div>
          {job && isRunning(job) && (
            <span className="hidden items-center gap-1.5 rounded-full bg-accent-faint px-2.5 py-1 text-[12px] text-accent sm:inline-flex">
              <Spinner size={12} /> {job.proteinId} {Math.round(job.progress * 100)}%
            </span>
          )}
          <button type="button" aria-label="Close library" onClick={() => setLibraryOpen(false)} className="grid h-9 w-9 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg">
            <IconClose size={18} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-rows-1 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          {/* list */}
          <div className={cx("flex min-h-0 flex-col md:border-r md:border-line", mobileDetail && "max-md:hidden")}>
            <div className="space-y-2 border-b border-line px-4 py-3">
              <div className="relative">
                <IconSearch size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" />
                <input
                  ref={searchRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search ID, PDB, BMRB, reference…"
                  aria-label="Search proteins"
                  className="h-8 w-full rounded-md border border-line bg-surface pr-2 pl-8 text-[13px] text-fg placeholder:text-faint focus:border-accent"
                />
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] text-muted">
                <label className="inline-flex items-center gap-1">
                  Residues
                  <input
                    type="number"
                    value={minRes}
                    onChange={(e) => setMinRes(e.target.value)}
                    placeholder="min"
                    aria-label="Minimum residues"
                    className="h-7 w-16 rounded border border-line bg-surface px-1.5 font-mono text-[12px] text-fg focus:border-accent"
                  />
                  –
                  <input
                    type="number"
                    value={maxRes}
                    onChange={(e) => setMaxRes(e.target.value)}
                    placeholder="max"
                    aria-label="Maximum residues"
                    className="h-7 w-16 rounded border border-line bg-surface px-1.5 font-mono text-[12px] text-fg focus:border-accent"
                  />
                </label>
                <label className="inline-flex cursor-pointer items-center gap-1.5" title={`Has ${CORE.join(" and ")}`}>
                  <input type="checkbox" checked={complete} onChange={(e) => setComplete(e.target.checked)} className="accent-[var(--accent)]" />
                  HNCA + CBCANH
                </label>
                <label className="inline-flex cursor-pointer items-center gap-1.5">
                  <input type="checkbox" checked={cachedOnly} onChange={(e) => setCachedOnly(e.target.checked)} className="accent-[var(--accent)]" />
                  Cached
                </label>
                <span className="flex-1" />
                <label className="inline-flex items-center gap-1">
                  Sort
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as SortKey)}
                    aria-label="Sort by"
                    className="h-7 rounded border border-line bg-surface px-1 text-[12px] text-fg focus:border-accent"
                  >
                    <option value="size">Download size</option>
                    <option value="residues">Residues</option>
                    <option value="year">Year</option>
                    <option value="completeness">Backbone set</option>
                    <option value="id">ID</option>
                  </select>
                </label>
                <button type="button" onClick={() => setDesc((d) => !d)} aria-label={desc ? "Sort descending" : "Sort ascending"} className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-fg hover:border-accent">
                  {desc ? "↓" : "↑"}
                </button>
              </div>
            </div>
            <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
              {error && (
                <div className="m-4 rounded-md border border-danger/30 bg-danger-soft p-3 text-[13px] text-danger">
                  <div className="flex items-center gap-2">
                    <IconAlert size={14} /> Could not load the ARTINA catalogue: {error}
                  </div>
                  <Button
                    size="sm"
                    className="mt-2"
                    onClick={() => {
                      setError(null);
                      setAttempt((a) => a + 1);
                      notify("Retrying the ARTINA catalogue…");
                    }}
                  >
                    Retry
                  </Button>
                </div>
              )}
              {!proteins && !error && (
                <div className="space-y-2 p-4">
                  {Array.from({ length: 8 }, (_, i) => (
                    <div key={i} className="skeleton h-12 w-full" />
                  ))}
                </div>
              )}
              {proteins && (
                <ul className="m-0 list-none p-0" role="listbox" aria-label="ARTINA proteins">
                  {rows.map((p) => {
                    const active = current?.id === p.id;
                    const importing = job?.proteinId === p.id && isRunning(job);
                    return (
                      <li key={p.id} role="option" aria-selected={active}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelected(p.id);
                            setMobileDetail(true);
                          }}
                          className={cx(
                            "flex w-full items-center gap-3 border-b border-line px-4 py-2.5 text-left",
                            active ? "bg-accent-faint" : "hover:bg-surface-2",
                          )}
                        >
                          <span className="w-14 font-mono text-[14px] font-semibold text-fg">{p.id}</span>
                          <span className="w-16 text-[12px] text-muted tabular-nums">{p.residues} aa</span>
                          <span className="hidden w-10 text-[12px] text-faint tabular-nums sm:inline">{p.year ?? ""}</span>
                          <span className="flex min-w-0 flex-1 flex-wrap gap-1">
                            {BACKBONE.map((b) => (
                              <span
                                key={b}
                                title={b}
                                className={cx(
                                  "rounded px-1 py-[1px] font-mono text-[10px]",
                                  hasBackbone(p, b) ? "bg-accent-faint text-accent" : "bg-surface-2 text-faint line-through decoration-faint/60",
                                )}
                              >
                                {BACKBONE_SHORT[b]}
                              </span>
                            ))}
                          </span>
                          <span className="w-16 text-right text-[12px] text-fg tabular-nums">{fmtMB(p.backboneMB)}</span>
                          <span className="w-5 text-right">
                            {importing ? <Spinner size={12} className="text-accent" /> : p.cached ? <IconCheck size={13} className="text-ok" aria-label="cached" /> : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                  {rows.length === 0 && <li className="p-6 text-center text-[13px] text-muted">No proteins match the filters.</li>}
                </ul>
              )}
            </div>
            {proteins && (
              <div className="border-t border-line px-4 py-2 text-[11.5px] text-muted">
                {rows.length} of {proteins.length} shown · {proteins.filter((p) => p.cached).length} cached ·{" "}
                {proteins.filter(hasCore).length} with an HNCA and a CBCANH
              </div>
            )}
          </div>

          {/* detail */}
          <div className={cx("scroll-quiet min-h-0 overflow-y-auto px-5 py-4", !mobileDetail && "max-md:hidden")}>
            <button type="button" onClick={() => setMobileDetail(false)} className="mb-3 inline-flex items-center gap-1 text-[13px] text-accent md:hidden">
              ← All proteins
            </button>
            {current ? (
              <Detail key={current.id} p={current} />
            ) : (
              <div className="text-[13px] text-muted">{proteins ? "Select a protein." : error ? "The catalogue is unavailable right now." : "Loading the catalogue…"}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
