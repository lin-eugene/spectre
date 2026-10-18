// ARTINA import jobs: download the NMRPipe backbone spectra with their deposited assigned peak
// lists and the structures (with progress) → build the project, its assignment made from the
// deposited peak lists, and save it → done. Jobs live on globalThis (survive dev reloads) and are
// polled through GET /api/artina/import/[jobId].
import { randomUUID } from "node:crypto";
import type { ImportJob } from "../contract";
import { saveProject } from "../project/store";
import { buildArtinaProject } from "./build";
import { findProtein, importFiles } from "./catalog";
import { downloadAll } from "./download";

interface JobGlobals {
  __spectreImportJobs?: Map<string, ImportJob>;
}
const g = globalThis as unknown as JobGlobals;
const jobs = (g.__spectreImportJobs ??= new Map<string, ImportJob>());

export interface ImportOptions {
  id: string;
  /** ignored: imports have no modes any more (accepted so older callers keep working) */
  mode?: string;
  /** download size limit (MB, default 400) */
  maxMB?: number;
  fetchImpl?: typeof fetch;
}

/** progress share of the download (the build takes the rest) */
const P_DOWNLOAD = 0.9;

export function getJob(jobId: string): ImportJob | undefined {
  return jobs.get(jobId);
}

export function listJobs(): ImportJob[] {
  return [...jobs.values()];
}

export const isActive = (j: ImportJob) => j.status === "queued" || j.status === "downloading" || j.status === "processing";

function push(job: ImportJob, msg: string) {
  job.message = msg;
  job.log.push(`${new Date().toISOString().slice(11, 19)} ${msg}`);
  if (job.log.length > 300) job.log.splice(0, job.log.length - 300);
}

/** Start an import in the background (or return the one already running for this protein). */
export function startImport(opts: ImportOptions): ImportJob {
  const p = findProtein(opts.id);
  const running = p && listJobs().find((j) => j.proteinId === p.id && isActive(j));
  if (running) return running;
  const job: ImportJob = {
    jobId: randomUUID(),
    proteinId: p?.id ?? opts.id,
    status: "queued",
    stage: "download",
    progress: 0,
    message: "queued",
    log: [],
  };
  jobs.set(job.jobId, job);
  if (!p) {
    job.status = "error";
    job.error = `unknown ARTINA protein "${opts.id}"`;
    push(job, job.error);
    return job;
  }
  void runImport(job, opts).catch((e) => {
    job.status = "error";
    job.error = e instanceof Error ? e.message : String(e);
    push(job, `failed: ${job.error}`);
  });
  return job;
}

/** Wait (polling) until the job finishes or the timeout passes. */
export async function waitForJob(jobId: string, timeoutMs: number): Promise<ImportJob | undefined> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const job = jobs.get(jobId);
    if (!job || job.status === "done" || job.status === "error" || Date.now() >= end) return job;
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function runImport(job: ImportJob, opts: ImportOptions): Promise<void> {
  const p = findProtein(opts.id)!;
  const t0 = Date.now();
  // ------------------------------------------------------------------ download
  const files = importFiles(p);
  if (!files.some((f) => f.kind === "spectrum" && f.experiment)) throw new Error(`${p.id} has no backbone triple-resonance spectra in NMRPipe format`);
  job.status = "downloading";
  job.stage = "download";
  push(job, `downloading ${p.id}: ${files.length} files (~${files.reduce((s, f) => s + f.mb, 0).toFixed(0)} MB before cache)`);
  const dl = await downloadAll(files, {
    maxMB: opts.maxMB,
    fetchImpl: opts.fetchImpl,
    onProgress: (pr) => {
      job.progress = Math.min(P_DOWNLOAD, P_DOWNLOAD * (pr.bytes / Math.max(1, pr.total)));
      job.message = `downloading ${pr.file} (${pr.index + 1}/${pr.count}): ${(pr.bytes / 1048576).toFixed(1)} of ~${(pr.total / 1048576).toFixed(0)} MB`;
    },
  });
  const tDownload = Date.now() - t0;
  push(job, `downloaded ${dl.downloaded.length} files (${(dl.bytes / 1048576).toFixed(1)} MB) in ${(tDownload / 1000).toFixed(0)} s, reused ${dl.reused.length} cached`);

  // ------------------------------------------------------------------ project
  job.status = "processing";
  job.stage = "build";
  job.progress = P_DOWNLOAD;
  push(job, "creating the project from the spectra and their deposited peak lists");
  const state = buildArtinaProject(p, { log: (m) => push(job, m) });
  state.artina!.timings.download = tDownload;
  saveProject(state);
  job.projectId = state.id;
  job.status = "done";
  job.progress = 1;
  const s = state.results.assignment?.stats;
  push(job, `project ${state.id} created${s ? `: ${s.assigned} residues assigned (${s.veryHigh} confirmed, ${s.high} unconfirmed, ${s.low} with conflicts)` : ", without an assignment"} (${((Date.now() - t0) / 1000).toFixed(0)} s in all)`);
}
