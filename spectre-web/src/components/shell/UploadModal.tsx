"use client";
// New project from your own data: a protein sequence (FASTA or plain text) and, for each 3D
// spectrum, the NMRPipe file and its assigned peak list (Sparky, XEASY/CYANA, NMRPipe or CcpNmr
// Analysis). The server builds the assignment from the lists and checks it.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  APP_SPECTRUM_TYPE,
  EXPERIMENT_TYPES,
  EXPERIMENTS_LIST,
  guessExperiment,
  parseSequenceText,
  PEAK_LIST_EXTENSIONS,
  PEAK_LIST_FORMATS,
  PIPE_EXTENSIONS,
  SHIFT_LIST_EXTENSIONS,
  type Experiment,
  type PeakListFormat,
} from "@/lib/peaklists/inputs";
import { createUploadProject, uploadPeakList, uploadShiftList, uploadSpectrum } from "@/lib/client/api";
import { useSpectre } from "@/lib/client/store";
import { IconAlert, IconCheck, IconClose, IconPlay, IconTrash } from "@/components/ui/Icons";
import { Button, cx, Spinner } from "@/components/ui/primitives";

/** One spectrum with its assigned peak list. */
interface Row {
  key: string;
  spectrum?: File;
  list?: File;
  type: Experiment | "";
  format: PeakListFormat | "auto";
  progress: number;
  state: "waiting" | "uploading" | "done" | "error";
  /** the spectrum's name in the project once uploaded (a retry then only sends the list) */
  uploaded?: string;
  error?: string;
}

const fmtMB = (bytes: number) => `${(bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 1 : 0)} MB`;
const SEQUENCE_EXT = /\.(fasta|fa|faa|seq|txt)$/i;
const LIST_EXT = PEAK_LIST_EXTENSIONS.filter((e) => e !== ".txt");
const ext = (name: string) => name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
/** a file stem for matching a spectrum with its list: "HNCA.ft3" and "HNCA_assigned.list" both give "hnca" */
const stem = (name: string) =>
  name
    .toLowerCase()
    .replace(/\.[^.]*$/, "")
    .replace(/[_-]?(assigned|peaks?|peaklist|list|tab)$/, "")
    .replace(/[^a-z0-9]/g, "");
const newKey = (f: File) => `${f.name}-${f.size}-${f.lastModified}`;

/** Put a peak list on the row of its spectrum (same file stem, else same experiment), or on a row of its own. */
function placeList(rows: Row[], list: File): Row[] {
  const s = stem(list.name);
  const exp = guessExperiment(list.name);
  const free = rows.filter((r) => !r.list && r.spectrum);
  const target = free.find((r) => stem(r.spectrum!.name) === s) ?? (exp ? free.find((r) => r.type === exp) : undefined);
  if (target) return rows.map((r) => (r === target ? { ...r, list, state: "waiting" } : r));
  return [...rows, { key: newKey(list), list, type: exp ?? "", format: "auto", progress: 0, state: "waiting" }];
}

/** Put a spectrum on the row of its peak list when one is waiting for it, or on a row of its own. */
function placeSpectrum(rows: Row[], spectrum: File): Row[] {
  if (rows.some((r) => r.spectrum && newKey(r.spectrum) === newKey(spectrum))) return rows;
  const s = stem(spectrum.name);
  const exp = guessExperiment(spectrum.name);
  const free = rows.filter((r) => r.list && !r.spectrum);
  const target = free.find((r) => stem(r.list!.name) === s) ?? (exp ? free.find((r) => r.type === exp) : undefined);
  if (target) return rows.map((r) => (r === target ? { ...r, spectrum, type: r.type || (exp ?? "") } : r));
  return [...rows, { key: newKey(spectrum), spectrum, type: exp ?? "", format: "auto", progress: 0, state: "waiting" }];
}

/** Problems that block creating the project, and advice that does not. */
export function inputProblems(rows: Pick<Row, "spectrum" | "list" | "type">[], shiftList: File | null): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!rows.length) errors.push("Add at least one NMRPipe 3D spectrum with its assigned peak list.");
  for (const r of rows) {
    if (!r.spectrum && r.list) errors.push(`Add the spectrum that ${r.list.name} was picked in.`);
    if (r.spectrum && !r.list) errors.push(`Add the assigned peak list of ${r.spectrum.name}.`);
  }
  const untyped = rows.filter((r) => !r.type);
  if (untyped.length) errors.push(`Choose the experiment of ${untyped.map((r) => (r.spectrum ?? r.list)!.name).join(", ")}.`);
  const byApp = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.type) continue;
    const k = APP_SPECTRUM_TYPE[r.type];
    byApp.set(k, [...(byApp.get(k) ?? []), `${(r.spectrum ?? r.list)!.name} (${EXPERIMENT_TYPES[r.type].label})`]);
  }
  for (const list of byApp.values()) if (list.length > 1) errors.push(`${list.join(" and ")} show the same peaks: keep one.`);
  const names = rows.filter((r) => r.spectrum).map((r) => r.spectrum!.name.replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9_-]+/g, "_"));
  if (new Set(names).size !== names.length) errors.push("Two spectra have the same file name; rename one.");
  const types = new Set(rows.map((r) => r.type));
  if (rows.length && !types.has("hnca") && !types.has("hncacb") && !types.has("cbcanh"))
    warnings.push("Without an HNCA, HNCACB or CBCANH there are no CA(i) peaks, so the check cannot link residues by Cα.");
  if (!shiftList && rows.some((r) => r.list && ext(r.list.name) === ".peaks")) warnings.push("If the .peaks files give their atoms as numbers, add their .prot shift list too.");
  return { errors, warnings };
}

export function UploadModal() {
  const { state, setUploadOpen, switchProject, refreshProjects, notify } = useSpectre();
  const open = state.uploadOpen;
  const [name, setName] = useState("");
  const [sequenceText, setSequenceText] = useState("");
  const [sequenceFile, setSequenceFile] = useState<string | null>(null);
  const [first, setFirst] = useState("1");
  const [rows, setRows] = useState<Row[]>([]);
  const [shiftList, setShiftList] = useState<File | null>(null);
  const [shiftListDone, setShiftListDone] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<"form" | "working" | "failed">("form");
  const [stepText, setStepText] = useState("");
  const [failure, setFailure] = useState<{ message: string; projectId?: string } | null>(null);
  /** project already created by an earlier, interrupted attempt (retries continue it) */
  const [createdId, setCreatedId] = useState<string | null>(null);
  const seqInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pickFor = useRef<{ key: string; what: "spectrum" | "list" } | null>(null);
  const rowInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase !== "working") setUploadOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, phase, setUploadOpen]);

  const parsed = useMemo(() => (sequenceText.trim() ? parseSequenceText(sequenceText) : null), [sequenceText]);
  const problems = useMemo(() => inputProblems(rows, shiftList), [rows, shiftList]);
  const firstNum = Number(first);
  const firstOk = first.trim() !== "" && Number.isInteger(firstNum);
  const canSubmit = phase !== "working" && !!parsed && !parsed.error && firstOk && problems.errors.length === 0;

  const addFiles = (files: FileList | File[]) => {
    let next = rows;
    for (const file of Array.from(files)) {
      const e = ext(file.name);
      if (SEQUENCE_EXT.test(file.name)) {
        void file.text().then((t) => {
          setSequenceText(t);
          setSequenceFile(file.name);
          if (!name) setName(parseSequenceText(t).header?.split(/\s+/)[0] ?? "");
        });
      } else if (SHIFT_LIST_EXTENSIONS.includes(e)) {
        setShiftList(file);
        setShiftListDone(false);
      } else if (LIST_EXT.includes(e)) next = placeList(next, file);
      else next = placeSpectrum(next, file);
    }
    setRows(next);
  };

  const update = (key: string, patch: Partial<Row>) => setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const reset = () => {
    setName("");
    setSequenceText("");
    setSequenceFile(null);
    setFirst("1");
    setRows([]);
    setShiftList(null);
    setShiftListDone(false);
    setPhase("form");
    setFailure(null);
    setStepText("");
    setCreatedId(null);
  };

  const close = () => {
    if (phase === "working") return;
    setUploadOpen(false);
    reset();
  };

  const submit = async () => {
    if (!canSubmit || !parsed) return;
    setPhase("working");
    setFailure(null);
    let projectId: string | undefined = createdId ?? undefined;
    const warnings: string[] = [];
    try {
      if (!projectId) {
        setStepText("Creating the project");
        projectId = await createUploadProject({ name: name.trim() || parsed.header?.split(/\s+/)[0] || "My protein", sequence: sequenceText, firstResidue: firstNum });
        setCreatedId(projectId);
      }
      if (shiftList && !shiftListDone) {
        setStepText(`Uploading ${shiftList.name}`);
        await uploadShiftList(projectId, shiftList);
        setShiftListDone(true);
      }
      for (const r of rows) {
        if (r.state === "done") continue;
        update(r.key, { state: "uploading", error: undefined });
        try {
          let spectrumName = r.uploaded;
          if (!spectrumName) {
            setStepText(`Uploading ${r.spectrum!.name}`);
            spectrumName = await uploadSpectrum(projectId, r.spectrum!, r.type, (f) => update(r.key, { progress: f }));
            update(r.key, { uploaded: spectrumName });
          }
          setStepText(`Reading ${r.list!.name}`);
          const out = await uploadPeakList(projectId, spectrumName, r.list!, r.format);
          warnings.push(...out.warnings.map((w) => `${r.list!.name}: ${w}`));
          update(r.key, { state: "done", progress: 1 });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          update(r.key, { state: "error", error: msg });
          throw new Error(msg);
        }
      }
      await switchProject(projectId);
      void refreshProjects();
      notify(warnings.length ? `Project created. ${warnings.join("; ")}` : "Project created; the assignment was built from your peak lists", warnings.length ? "info" : "ok");
      setUploadOpen(false);
      reset();
    } catch (e) {
      setFailure({ message: e instanceof Error ? e.message : String(e), projectId });
      setPhase("failed");
    }
  };

  const pickRowFile = (key: string, what: "spectrum" | "list") => {
    pickFor.current = { key, what };
    rowInput.current?.click();
  };

  if (!open) return null;
  const working = phase === "working";
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-title"
        className="flex max-h-full w-full max-w-[820px] flex-col overflow-hidden bg-surface shadow-[var(--shadow-lg)] sm:rounded-xl sm:border sm:border-line"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id="upload-title" className="m-0 text-[20px] font-semibold tracking-tight text-fg">
              New project from your spectra
            </h2>
            <p className="m-0 mt-0.5 text-[13px] text-muted">
              Upload the protein sequence and, for each 3D spectrum, the NMRPipe file with its assigned peak list from your assignment software. Spectre builds the
              assignment from the lists and checks every residue for consistency.
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={close} disabled={working} className="grid h-9 w-9 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40">
            <IconClose size={18} />
          </button>
        </div>

        <div className="scroll-quiet flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
            <label className="block">
              <span className="text-[12px] font-medium text-muted">Protein name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={parsed?.header?.split(/\s+/)[0] || "e.g. Pin1 WW domain"}
                disabled={working}
                className="mt-1 block h-9 w-full rounded-md border border-line-strong bg-surface px-2.5 text-sm text-fg outline-none focus:border-accent"
              />
            </label>
            <label className="block">
              <span className="text-[12px] font-medium text-muted">First residue number</span>
              <input
                value={first}
                onChange={(e) => setFirst(e.target.value)}
                inputMode="numeric"
                disabled={working}
                className={cx("mt-1 block h-9 w-full rounded-md border bg-surface px-2.5 text-sm text-fg outline-none focus:border-accent", firstOk ? "border-line-strong" : "border-danger")}
              />
            </label>
          </div>

          <section>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="m-0 text-[14px] font-semibold text-fg">Sequence</h3>
              <span className="text-[12px] text-muted">FASTA, plain one-letter, or three-letter codes; numbered like your peak lists</span>
              <span className="flex-1" />
              <input ref={seqInput} type="file" accept=".fasta,.fa,.faa,.seq,.txt,text/plain" className="hidden" onChange={(e) => e.target.files && addFiles(e.target.files)} />
              <Button size="sm" onClick={() => seqInput.current?.click()} disabled={working}>
                Choose file…
              </Button>
            </div>
            <textarea
              value={sequenceText}
              onChange={(e) => {
                setSequenceText(e.target.value);
                setSequenceFile(null);
              }}
              rows={4}
              spellCheck={false}
              placeholder={">my_protein\nMKPEHRMDTISKLEEGAETPVTGRVMKISSPRTFTTRKG…"}
              disabled={working}
              className="mt-2 block w-full resize-y rounded-md border border-line-strong bg-surface px-2.5 py-2 font-mono text-[12px] text-fg outline-none focus:border-accent"
            />
            <p className={cx("m-0 mt-1 text-[12px]", parsed?.error ? "text-danger" : "text-muted")}>
              {parsed?.error
                ? `Cannot read the sequence: ${parsed.error}`
                : parsed
                  ? `${parsed.sequence.length} residues, ${[...parsed.sequence].filter((c) => c === "P").length} prolines${sequenceFile ? ` · from ${sequenceFile}` : ""}${parsed.header ? ` · “${parsed.header}”` : ""}`
                  : "Paste the sequence or choose a file."}
            </p>
          </section>

          <section>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="m-0 text-[14px] font-semibold text-fg">Spectra and their assigned peak lists</h3>
              <span className="text-[12px] text-muted">NMRPipe 3D files ({PIPE_EXTENSIONS.join(", ")}) with ¹H, ¹⁵N and ¹³C axes</span>
            </div>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (!working) addFiles(e.dataTransfer.files);
              }}
              className={cx("mt-2 rounded-lg border-2 border-dashed px-4 py-4 text-center text-[13px]", dragging ? "border-accent bg-accent-faint" : "border-line")}
            >
              <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => e.target.files && addFiles(e.target.files)} />
              <span className="text-muted">Drop the spectra, their peak lists (and the sequence file) here, or </span>
              <button type="button" className="text-accent hover:underline" onClick={() => fileInput.current?.click()} disabled={working}>
                choose files
              </button>
              <span className="block text-[12px] text-faint">
                Peak lists:{" "}
                {Object.values(PEAK_LIST_FORMATS)
                  .map((f) => `${f.label} (${f.extensions.join(", ")})`)
                  .join(" · ")}
                . Lists are matched to spectra by file name or experiment.
              </span>
            </div>
            <input
              ref={rowInput}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                const target = pickFor.current;
                e.target.value = "";
                if (!f || !target) return;
                if (target.what === "spectrum") update(target.key, { spectrum: f, uploaded: undefined, state: "waiting" });
                else update(target.key, { list: f, state: "waiting" });
              }}
            />
            {rows.length > 0 && (
              <ul className="m-0 mt-3 list-none space-y-1.5 p-0">
                {rows.map((r) => (
                  <li key={r.key} className="flex flex-wrap items-center gap-2 rounded-md border border-line px-2.5 py-1.5">
                    {r.spectrum ? (
                      <span className="min-w-0 flex-[1_1_9rem] truncate font-mono text-[12px] text-fg" title={`${r.spectrum.name} (${fmtMB(r.spectrum.size)})`}>
                        {r.spectrum.name} <span className="font-sans text-muted tabular-nums">{fmtMB(r.spectrum.size)}</span>
                      </span>
                    ) : (
                      <span className="flex-[1_1_9rem]">
                        <button type="button" className="text-[12px] text-danger hover:underline" onClick={() => pickRowFile(r.key, "spectrum")} disabled={working}>
                          Choose its spectrum…
                        </button>
                      </span>
                    )}
                    <select
                      value={r.type}
                      onChange={(e) => update(r.key, { type: e.target.value as Experiment })}
                      disabled={working || !!r.uploaded}
                      aria-label="Experiment"
                      className={cx("h-7 rounded-md border bg-surface px-1.5 text-[12px] text-fg", r.type ? "border-line-strong" : "border-danger")}
                    >
                      <option value="">Experiment…</option>
                      {EXPERIMENTS_LIST.map((t) => (
                        <option key={t} value={t}>
                          {EXPERIMENT_TYPES[t].label} — {EXPERIMENT_TYPES[t].peaks}
                        </option>
                      ))}
                    </select>
                    {r.list ? (
                      <span className="max-w-[11rem] min-w-0 truncate font-mono text-[12px] text-fg" title={r.list.name}>
                        {r.list.name}
                      </span>
                    ) : (
                      <button type="button" className="text-[12px] text-danger hover:underline" onClick={() => pickRowFile(r.key, "list")} disabled={working}>
                        Choose its peak list…
                      </button>
                    )}
                    <select
                      value={r.format}
                      onChange={(e) => update(r.key, { format: e.target.value as Row["format"] })}
                      disabled={working}
                      aria-label="Peak-list format"
                      className="h-7 rounded-md border border-line-strong bg-surface px-1.5 text-[12px] text-fg"
                    >
                      <option value="auto">detect format</option>
                      {Object.entries(PEAK_LIST_FORMATS).map(([k, f]) => (
                        <option key={k} value={k}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                    {r.state === "uploading" && (
                      <span className="flex w-24 items-center gap-1.5 text-[11px] text-muted">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                          <span className="block h-full bg-accent" style={{ width: `${Math.round(r.progress * 100)}%` }} />
                        </span>
                        {Math.round(r.progress * 100)}%
                      </span>
                    )}
                    {r.state === "done" && <IconCheck size={14} className="text-ok" />}
                    {r.state === "error" && (
                      <span className="text-danger" title={r.error}>
                        <IconAlert size={14} />
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label={`Remove ${(r.spectrum ?? r.list)!.name}`}
                      onClick={() => setRows((cur) => cur.filter((c) => c.key !== r.key))}
                      disabled={working || !!r.uploaded}
                      className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-danger disabled:opacity-40"
                    >
                      <IconTrash size={13} />
                    </button>
                    {r.error && (
                      <span className="w-full text-[12px] text-danger">
                        {r.error}
                        {r.list && (
                          <>
                            {" "}
                            <button type="button" className="text-accent hover:underline" onClick={() => pickRowFile(r.key, "list")} disabled={working}>
                              Choose another list
                            </button>
                          </>
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="m-0 mt-2 text-[12px] text-muted">
              {shiftList ? (
                <>
                  XEASY shift list: <span className="font-mono text-fg">{shiftList.name}</span>{" "}
                  <button type="button" className="hover:text-danger hover:underline" onClick={() => setShiftList(null)} disabled={working || shiftListDone}>
                    remove
                  </button>
                </>
              ) : (
                "XEASY .peaks lists that give their atoms as numbers need their .prot shift list: drop it here too."
              )}
            </p>
            {rows.length > 0 && (problems.errors.length > 0 || problems.warnings.length > 0) && (
              <ul className="m-0 mt-2 list-none space-y-1 p-0 text-[12px]">
                {problems.errors.map((e) => (
                  <li key={e} className="text-danger">
                    {e}
                  </li>
                ))}
                {problems.warnings.map((w) => (
                  <li key={w} className="text-warn">
                    {w}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {failure && (
            <Banner tone="danger">
              {failure.message}
              {failure.projectId && (
                <span className="block">
                  The project was created.{" "}
                  <button
                    type="button"
                    className="text-accent hover:underline"
                    onClick={() => {
                      const id = failure.projectId!;
                      setUploadOpen(false);
                      reset();
                      void switchProject(id).then(() => refreshProjects());
                    }}
                  >
                    Open it
                  </button>{" "}
                  to fix the files there, or correct the list above and try again.
                </span>
              )}
            </Banner>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3">
          {working ? (
            <span className="flex items-center gap-2 text-[13px] text-muted">
              <Spinner size={14} /> {stepText}…
            </span>
          ) : (
            <span className="text-[12px] text-muted">Files are kept on this server.</span>
          )}
          <span className="flex-1" />
          <Button onClick={close} disabled={working}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
            <IconPlay size={14} /> {phase === "failed" ? "Try again" : "Create project"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Banner({ tone, children }: { tone: "warn" | "danger"; children: React.ReactNode }) {
  return (
    <div className={cx("rounded-md border px-3 py-2 text-[13px]", tone === "warn" ? "border-warn/40 bg-warn-soft text-fg" : "border-danger/40 bg-danger-soft text-fg")}>
      {children}
    </div>
  );
}
