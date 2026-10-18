// The featured real-data project: the ARTINA protein 2K50 with its real spectra and deposited
// assigned peak lists. Reuses the newest 2K50 project whose files are on this machine, otherwise
// starts the import (the download once, ~185 MB, then the build), so the client can show progress
// and open the project when it exists.
import fs from "node:fs";
import { spectrumPath } from "../peaklists/paths";
import { isActive, listJobs, startImport } from "../artina/jobs";
import { findProtein } from "../artina/catalog";
import { getProject, listProjects } from "./store";
import type { ProjectState } from "./types";

export const FEATURED_ARTINA_ID = "2K50";

/** id: the project to open; jobId: the import to follow (its projectId appears when it is done). */
export interface FeaturedProject {
  id?: string;
  jobId?: string;
  /** a new import was started by this call */
  created: boolean;
}

const usable = (state: ProjectState) =>
  !!state.inputs?.spectra.length &&
  state.inputs.spectra.every((s) => {
    const f = spectrumPath(state.id, s);
    return !!f && fs.existsSync(/*turbopackIgnore: true*/ f);
  });

/** Newest 2K50 project whose spectra are on this machine, if any. */
export function findFeaturedProject(): ProjectState | null {
  for (const entry of listProjects()) {
    if (entry.source !== `artina:${FEATURED_ARTINA_ID}`) continue;
    const state = getProject(entry.id);
    if (state && usable(state)) return state;
  }
  return null;
}

export async function ensureFeaturedProject(): Promise<FeaturedProject> {
  const running = listJobs().find((j) => j.proteinId === FEATURED_ARTINA_ID && isActive(j));
  if (running) return { jobId: running.jobId, created: false };
  const existing = findFeaturedProject();
  if (existing) return { id: existing.id, created: false };
  if (!findProtein(FEATURED_ARTINA_ID)) throw new Error(`ARTINA protein ${FEATURED_ARTINA_ID} is missing from the catalogue`);
  const job = startImport({ id: FEATURED_ARTINA_ID });
  if (job.status === "error") throw new Error(job.error ?? `the ${FEATURED_ARTINA_ID} import failed`);
  return { jobId: job.jobId, created: true };
}
