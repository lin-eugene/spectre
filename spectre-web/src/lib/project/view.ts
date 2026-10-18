// Builds the client-facing ProjectView from server state.
import { EXPERIMENTS } from "../spectra/experiments";
import type { ProjectView } from "../contract";
import type { ProjectState } from "./types";
import { publicMeta } from "../artina/planes";
import { EXPERIMENT_TYPES } from "../peaklists/inputs";
import { MAX_UPLOAD_MB } from "../peaklists/project";

export function toProjectView(state: ProjectState): ProjectView {
  return {
    id: state.id,
    updatedAt: state.updatedAt,
    meta: state.meta,
    sequence: state.sequence,
    firstResidue: state.firstResidue,
    spectra: state.spectra.map((s) => ({
      tp: s.tp,
      label: EXPERIMENTS[s.tp]?.label ?? s.tp.toUpperCase(),
      file: s.file,
      peaks: s.peaks,
    })),
    hsqc: state.hsqc,
    pdb: state.pdb,
    assignment: state.results.assignment,
    history: state.history,
    ...(state.realSpectra?.length ? { realSpectra: state.realSpectra.map(publicMeta) } : {}),
    ...(state.models?.length ? { models: state.models } : {}),
    ...(state.attribution ? { attribution: state.attribution } : {}),
    ...(state.inputs
      ? {
          inputs: {
            spectra: state.inputs.spectra.map((s) => ({
              name: s.name,
              experiment: s.experiment,
              label: EXPERIMENT_TYPES[s.experiment].label,
              original: s.original,
              sizeMB: s.sizeMB,
              uploadedAt: s.uploadedAt,
              stored: !!s.stored,
              ...(s.peakList
                ? { peakList: { original: s.peakList.original, format: s.peakList.format, peaks: s.peakList.peaks, uploadedAt: s.peakList.uploadedAt, stored: !!s.peakList.stored } }
                : {}),
            })),
            ...(state.inputs.shiftList ? { shiftList: { original: state.inputs.shiftList.original, entries: state.inputs.shiftList.entries } } : {}),
            maxUploadMB: MAX_UPLOAD_MB,
          },
        }
      : {}),
  };
}
