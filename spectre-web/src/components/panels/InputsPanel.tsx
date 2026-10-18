"use client";
// The inputs of a project made from your own data (or an ARTINA import): its 3D spectra with their
// assigned peak lists, and the XEASY shift list when one is needed. Adding, replacing or removing
// any of them rebuilds the assignment on the server.
import { useRef, useState } from "react";
import type { ProjectView } from "@/lib/contract";
import { EXPERIMENT_TYPES, EXPERIMENTS_LIST, guessExperiment, PEAK_LIST_EXTENSIONS, PEAK_LIST_FORMATS, PIPE_EXTENSIONS, SHIFT_LIST_EXTENSIONS, type Experiment, type PeakListFormat } from "@/lib/peaklists/inputs";
import { deletePeakList, deleteShiftList, deleteUpload, uploadPeakList, uploadShiftList, uploadSpectrum } from "@/lib/client/api";
import { useSpectre } from "@/lib/client/store";
import { IconTrash } from "@/components/ui/Icons";
import { Button, Chip, Spinner } from "@/components/ui/primitives";

interface Adding {
  spectrum: File | null;
  type: Experiment | "";
  list: File | null;
  format: PeakListFormat | "auto";
}

const NO_ADD: Adding = { spectrum: null, type: "", list: null, format: "auto" };

/** A hidden file input opened by a link-style button. */
function FilePick({ label, accept, disabled, onFile }: { label: string; accept?: string; disabled?: boolean; onFile: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <button type="button" className="text-[12px] text-accent hover:underline disabled:opacity-40" disabled={disabled} onClick={() => ref.current?.click()}>
        {label}
      </button>
    </>
  );
}

export function InputsPanel({ project }: { project: ProjectView }) {
  const { refetch, notify } = useSpectre();
  const info = project.inputs!;
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState<Adding | null>(null);
  const used = new Map((project.assignment?.inputs ?? []).map((i) => [i.spectrum, i]));
  const listAccept = PEAK_LIST_EXTENSIONS.join(",");

  const act = async (label: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(label);
    try {
      const out = await fn();
      await refetch();
      const warnings = (out as { warnings?: string[] } | undefined)?.warnings ?? [];
      if (warnings.length) notify(warnings.join("; "), "info");
      else if (done) notify(done, "ok");
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const add = (a: Adding) =>
    act(
      `Uploading ${a.spectrum!.name}`,
      async () => {
        const name = await uploadSpectrum(project.id, a.spectrum!, a.type);
        const out = a.list ? await uploadPeakList(project.id, name, a.list, a.format) : undefined;
        setAdding(null);
        return out;
      },
      a.list ? `${a.spectrum!.name} and its peak list added` : `${a.spectrum!.name} added; add its peak list to use it`,
    );

  return (
    <section aria-labelledby="inputs-title" className="rounded-lg border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="inputs-title" className="m-0 text-[15px] font-semibold text-fg">
          Spectra and peak lists
        </h2>
        <span className="text-[12px] text-muted">the assignment is built from the lists</span>
        <span className="flex-1" />
        {busy && (
          <span className="flex items-center gap-1.5 text-[12px] text-muted">
            <Spinner size={12} /> {busy}…
          </span>
        )}
      </div>

      <ul className="m-0 mt-2.5 list-none space-y-1.5 p-0">
        {info.spectra.map((s) => {
          const u = used.get(s.name);
          return (
            <li key={s.name} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-line px-2.5 py-1.5 text-[12px]">
              <span className="w-[5.5rem] shrink-0 font-medium text-fg">{s.label}</span>
              <span className="max-w-[11rem] min-w-0 truncate text-muted" title={`${s.original} (${s.sizeMB.toFixed(0)} MB)`}>
                {s.original}
              </span>
              <span aria-hidden="true" className="text-faint">
                ·
              </span>
              {s.peakList ? (
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="min-w-0 truncate text-fg" title={`${s.peakList.original} (${PEAK_LIST_FORMATS[s.peakList.format as PeakListFormat]?.label ?? s.peakList.format})`}>
                    {s.peakList.original}
                  </span>
                  <span className="shrink-0 text-faint tabular-nums">
                    {u ? `${u.used}/${u.peaks} peaks used` : `${s.peakList.peaks} peaks`}
                  </span>
                </span>
              ) : (
                <span className="flex-1">
                  <Chip tone="warn" title="A spectrum without its assigned peak list is shown in the planes but not used in the assignment">
                    no peak list
                  </Chip>
                </span>
              )}
              <FilePick
                label={s.peakList ? "Replace list" : "Add peak list"}
                accept={listAccept}
                disabled={!!busy}
                onFile={(f) => void act(`Reading ${f.name}`, () => uploadPeakList(project.id, s.name, f), `${f.name} read; the assignment was rebuilt`)}
              />
              {s.peakList && (
                <button
                  type="button"
                  className="text-[12px] text-muted hover:text-danger hover:underline disabled:opacity-40"
                  disabled={!!busy}
                  onClick={() => void act(`Removing the peak list of ${s.label}`, () => deletePeakList(project.id, s.name))}
                >
                  Remove list
                </button>
              )}
              <button
                type="button"
                aria-label={`Remove ${s.original} and its peak list`}
                title="Remove the spectrum and its peak list"
                disabled={!!busy}
                onClick={() => void act(`Removing ${s.original}`, () => deleteUpload(project.id, s.name))}
                className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-surface-2 hover:text-danger disabled:opacity-40"
              >
                <IconTrash size={12} />
              </button>
            </li>
          );
        })}
        {!info.spectra.length && <li className="text-[12px] text-muted">No spectra yet.</li>}
      </ul>

      {adding ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-2.5 py-2 text-[12px]">
          {adding.spectrum ? (
            <span className="max-w-[10rem] truncate font-mono text-fg" title={adding.spectrum.name}>
              {adding.spectrum.name}
            </span>
          ) : (
            <FilePick label="Choose spectrum…" accept={PIPE_EXTENSIONS.join(",")} onFile={(f) => setAdding({ ...adding, spectrum: f, type: adding.type || (guessExperiment(f.name) ?? "") })} />
          )}
          <select
            value={adding.type}
            onChange={(e) => setAdding({ ...adding, type: e.target.value as Experiment })}
            className="h-7 rounded-md border border-line-strong bg-surface px-1.5 text-[12px] text-fg"
            aria-label="Experiment"
          >
            <option value="">Experiment…</option>
            {EXPERIMENTS_LIST.map((t) => (
              <option key={t} value={t}>
                {EXPERIMENT_TYPES[t].label}
              </option>
            ))}
          </select>
          {adding.list ? (
            <span className="max-w-[10rem] truncate font-mono text-fg" title={adding.list.name}>
              {adding.list.name}
            </span>
          ) : (
            <FilePick label="Choose peak list…" accept={listAccept} onFile={(f) => setAdding({ ...adding, list: f })} />
          )}
          <select
            value={adding.format}
            onChange={(e) => setAdding({ ...adding, format: e.target.value as Adding["format"] })}
            className="h-7 rounded-md border border-line-strong bg-surface px-1.5 text-[12px] text-fg"
            aria-label="Peak-list format"
          >
            <option value="auto">Format: detect</option>
            {Object.entries(PEAK_LIST_FORMATS).map(([k, f]) => (
              <option key={k} value={k}>
                {f.label}
              </option>
            ))}
          </select>
          <Button size="sm" variant="primary" disabled={!adding.spectrum || !adding.type || !!busy} onClick={() => void add(adding)}>
            Upload
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAdding(null)} disabled={!!busy}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <button type="button" className="text-[12px] text-accent hover:underline disabled:opacity-40" disabled={!!busy} onClick={() => setAdding(NO_ADD)}>
            + Add a spectrum with its peak list
          </button>
          {info.shiftList ? (
            <span className="flex items-center gap-1.5 text-[12px] text-muted">
              XEASY shift list {info.shiftList.original} ({info.shiftList.entries} shifts)
              <button type="button" className="hover:text-danger hover:underline disabled:opacity-40" disabled={!!busy} onClick={() => void act("Removing the shift list", () => deleteShiftList(project.id))}>
                Remove
              </button>
            </span>
          ) : (
            <FilePick
              label="+ XEASY shift list (.prot)"
              accept={SHIFT_LIST_EXTENSIONS.join(",")}
              disabled={!!busy}
              onFile={(f) => void act(`Reading ${f.name}`, () => uploadShiftList(project.id, f), `${f.name} added`)}
            />
          )}
        </div>
      )}
      <p className="m-0 mt-2 text-[11.5px] text-faint">
        Peak lists: {Object.values(PEAK_LIST_FORMATS)
          .map((f) => `${f.label} (${f.extensions.join(", ")})`)
          .join(" · ")}
        . An XEASY list that gives its atoms as numbers needs its .prot shift list.
      </p>
    </section>
  );
}
