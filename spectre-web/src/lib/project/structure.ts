// A structure for projects that came without one: the ESMFold prediction of the project's sequence
// (see structure/esmfold.ts), else its AlphaFold DB model (structure/alphafold.ts). Used when a
// project is made from uploaded spectra, and by the predict_esmfold_structure and
// fetch_alphafold_structure actions.
import { findAlphafoldModel } from "../structure/alphafold";
import { ESMFOLD_ID, predictEsmfold } from "../structure/esmfold";
import { addHistory } from "./store";
import type { ProjectState } from "./types";

export type StructureOutcome =
  | { ok: true; entryId: string; accession: string; meanPlddt?: number; region: [number, number]; url: string }
  | { ok: false; error: string };

export type PredictionOutcome = { ok: true; id: typeof ESMFOLD_ID; meanPlddt?: number } | { ok: false; error: string };

interface AttachOptions {
  fetchImpl?: typeof fetch;
  force?: boolean;
}

/** Attach the ESMFold prediction when the project has no structure (the caller saves the project). */
export async function attachEsmfoldModel(state: ProjectState, opts: AttachOptions = {}): Promise<PredictionOutcome> {
  if (state.pdb && !opts.force) return { ok: false, error: `the project already has a structure (${state.pdb.id})` };
  if (!state.sequence) return { ok: false, error: "the project has no sequence" };
  const found = await predictEsmfold(state.sequence, state.firstResidue, { fetchImpl: opts.fetchImpl });
  if ("error" in found) {
    addHistory(state, "system", "predict_esmfold_structure", `no prediction: ${found.error}`);
    return { ok: false, error: found.error };
  }
  state.pdb = { id: ESMFOLD_ID, text: found.text };
  addHistory(state, "system", "predict_esmfold_structure", `${state.sequence.length} residues${found.meanPlddt !== undefined ? `, mean pLDDT ${found.meanPlddt.toFixed(1)}` : ""}`);
  return { ok: true, id: ESMFOLD_ID, ...(found.meanPlddt !== undefined ? { meanPlddt: found.meanPlddt } : {}) };
}

/** Attach the AlphaFold DB model when the project has no structure (the caller saves the project). */
export async function attachAlphafoldModel(state: ProjectState, opts: AttachOptions = {}): Promise<StructureOutcome> {
  if (state.pdb && !opts.force) return { ok: false, error: `the project already has a structure (${state.pdb.id})` };
  if (!state.sequence) return { ok: false, error: "the project has no sequence" };
  const found = await findAlphafoldModel(state.sequence, state.firstResidue, { uniprot: state.meta.uniprot, fetchImpl: opts.fetchImpl });
  if ("error" in found) {
    addHistory(state, "system", "fetch_alphafold_structure", `no model: ${found.error}`);
    return { ok: false, error: found.error };
  }
  state.pdb = { id: found.entryId, text: found.text };
  state.meta.uniprot ??= found.accession;
  addHistory(
    state,
    "system",
    "fetch_alphafold_structure",
    `${found.entryId} v${found.version} (UniProt ${found.accession}, residues ${found.region[0]}–${found.region[1]}${found.meanPlddt !== undefined ? `, mean pLDDT ${found.meanPlddt.toFixed(1)}` : ""})`,
  );
  return { ok: true, entryId: found.entryId, accession: found.accession, ...(found.meanPlddt !== undefined ? { meanPlddt: found.meanPlddt } : {}), region: found.region, url: found.url };
}

/** The structure of a project made without one: the ESMFold prediction, else the AlphaFold DB model. */
export async function attachDefaultStructure(state: ProjectState, opts: { fetchImpl?: typeof fetch } = {}): Promise<PredictionOutcome | StructureOutcome> {
  const predicted = await attachEsmfoldModel(state, opts);
  if (predicted.ok) return predicted;
  const found = await attachAlphafoldModel(state, opts);
  if (found.ok) return found;
  return { ok: false, error: `ESMFold: ${predicted.error}; AlphaFold DB: ${found.error}` };
}
