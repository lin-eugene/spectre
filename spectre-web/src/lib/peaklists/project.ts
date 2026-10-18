// Projects made from your own data: a sequence, NMRPipe 3D spectra and an assigned peak list for
// each spectrum (plus an XEASY .prot shift list when an XEASY list gives its atoms as numbers),
// kept in <data dir>/uploads/<id>/, or used in place from the ARTINA download cache
// (artina/build.ts). The spectra are also the project's real spectra, so the planes and strips
// show them. Every change of the inputs rebuilds the assignment from the peak lists.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { forgetCube, loadCubeFile, realSpectrumMeta } from "../artina/cubes";
import { addHistory, saveProject } from "../project/store";
import type { InputSpectrum, PeakListFile, ProjectState } from "../project/types";
import { parseXeasyProt, type ShiftEntry } from "../spectra/formats/assignments";
import { buildAssignment, type BuildList } from "./build";
import { APP_SPECTRUM_TYPE, EXPERIMENT_TYPES, EXPERIMENTS_LIST, isExperiment, isPeakListFormat, parseSequenceText, PEAK_LIST_FORMATS, PIPE_EXTENSIONS, type Experiment, type PeakListFormat } from "./inputs";
import { spectrumPath, UPLOAD_PREFIX, uploadDir } from "./paths";
import { numberingOffset, readPeakList, type ReadPeakList } from "./read";

export const MAX_UPLOAD_MB = Number(process.env.SPECTRE_MAX_UPLOAD_MB || 2048);
const SHIFT_LIST_FILE = "shifts.prot";

export interface NewUploadProject {
  name: string;
  /** contents of the sequence file, or a pasted sequence */
  sequenceText: string;
  firstResidue: number;
  description?: string;
}

/** A project with a sequence and no spectra yet; spectra and peak lists are added afterwards. */
export function createUploadProject(input: NewUploadProject): ProjectState | { error: string } {
  const parsed = parseSequenceText(input.sequenceText);
  if (parsed.error) return { error: `sequence: ${parsed.error}` };
  if (!Number.isInteger(input.firstResidue)) return { error: "the first residue number must be an integer" };
  const name = input.name.trim() || parsed.header?.split(/\s+/)[0] || "Uploaded protein";
  const state = newInputsState({
    name,
    source: "upload",
    description: input.description?.trim() || `Uploaded NMRPipe spectra with their assigned peak lists (${parsed.sequence.length} residues).`,
    sequence: parsed.sequence,
    firstResidue: input.firstResidue,
  });
  addHistory(state, "user", "create_project", `${parsed.sequence.length} residues${parsed.header ? ` from FASTA "${parsed.header}"` : ""}, first residue ${input.firstResidue}`);
  saveProject(state);
  return state;
}

/** The state of a new project (not saved) with no spectra and no results yet. Shared by uploads and ARTINA imports. */
export function newInputsState(input: { name: string; source: string; description: string; sequence: string; firstResidue: number; id?: string }): ProjectState {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: input.id ?? randomUUID(),
    createdAt: now,
    updatedAt: now,
    meta: { name: input.name, source: input.source, description: input.description },
    sequence: input.sequence,
    firstResidue: input.firstResidue,
    spectra: [],
    hsqc: [],
    results: {},
    history: [],
    realSpectra: [],
    inputs: { spectra: [] },
  };
}

/** A file-name stem safe as a file and a spectrum name. */
export function spectrumName(original: string): string {
  const stem = path.basename(original).replace(/\.[^.]*$/, "");
  return stem.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "spectrum";
}

/** Stream an upload body to a temporary file in the project's upload directory. */
export async function receiveUpload(projectId: string, body: ReadableStream<Uint8Array>): Promise<{ tmp: string; bytes: number } | { error: string; status: number }> {
  const dir = uploadDir(projectId);
  fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
  const tmp = path.join(dir, `.upload-${randomUUID()}`);
  const limit = MAX_UPLOAD_MB * 1048576;
  let bytes = 0;
  const src = Readable.fromWeb(body as unknown as WebReadableStream<Uint8Array>);
  src.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > limit) src.destroy(new Error(`file larger than ${MAX_UPLOAD_MB} MB (SPECTRE_MAX_UPLOAD_MB)`));
  });
  try {
    await pipeline(src, fs.createWriteStream(/*turbopackIgnore: true*/ tmp));
  } catch (e) {
    fs.rmSync(/*turbopackIgnore: true*/ tmp, { force: true });
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg, status: /larger than/.test(msg) ? 413 : 400 };
  }
  if (!bytes) {
    fs.rmSync(/*turbopackIgnore: true*/ tmp, { force: true });
    return { error: "the upload was empty", status: 400 };
  }
  return { tmp, bytes };
}

// ------------------------------------------------------------------ spectra

/**
 * Add (or replace, by name) an uploaded spectrum: check it is an NMRPipe 3D spectrum with 1H, 15N
 * and 13C axes, file it, and register it as one of the project's real spectra. A replaced spectrum
 * keeps its peak list.
 */
export function addSpectrum(state: ProjectState, upload: { tmp: string; original: string; experiment: string }): InputSpectrum | { error: string; status: number } {
  const discard = () => fs.rmSync(/*turbopackIgnore: true*/ upload.tmp, { force: true });
  if (!state.inputs) {
    discard();
    return { error: "this project was not created from your own data", status: 400 };
  }
  if (!isExperiment(upload.experiment)) {
    discard();
    return { error: `unknown experiment type "${upload.experiment}" (one of ${EXPERIMENTS_LIST.join(", ")})`, status: 400 };
  }
  const experiment = upload.experiment;
  const name = spectrumName(upload.original);
  const clash = state.inputs.spectra.find((s) => s.name !== name && APP_SPECTRUM_TYPE[s.experiment] === APP_SPECTRUM_TYPE[experiment]);
  if (clash) {
    discard();
    return {
      error: `${EXPERIMENT_TYPES[experiment].label} shows the same peaks as ${clash.original} (${EXPERIMENT_TYPES[clash.experiment].label}); upload one of the two`,
      status: 409,
    };
  }
  const ext = path.extname(upload.original).toLowerCase();
  const file = `${name}${PIPE_EXTENSIONS.includes(ext) ? ext : ".pipe"}`;
  const abs = path.join(/*turbopackIgnore: true*/ uploadDir(state.id), file);
  forgetCube(abs);
  fs.renameSync(/*turbopackIgnore: true*/ upload.tmp, abs);
  const meta = spectrumMeta(abs, name, experiment, `${UPLOAD_PREFIX}${state.id}/${file}`);
  if ("error" in meta) {
    forgetCube(abs);
    fs.rmSync(/*turbopackIgnore: true*/ abs, { force: true });
    return { error: `${upload.original} is not a readable NMRPipe 3D spectrum: ${meta.error}`, status: 400 };
  }
  const previous = state.inputs.spectra.find((s) => s.name === name);
  const entry: InputSpectrum = {
    name,
    experiment,
    file,
    original: path.basename(upload.original),
    sizeMB: meta.sizeMB,
    uploadedAt: new Date().toISOString(),
    ...(previous?.peakList ? { peakList: previous.peakList } : {}),
  };
  state.inputs.spectra = [...state.inputs.spectra.filter((s) => s.name !== name), entry];
  state.realSpectra = [...(state.realSpectra ?? []).filter((r) => r.name !== name), meta];
  addHistory(state, "user", "upload_spectrum", `${entry.original} as ${EXPERIMENT_TYPES[experiment].label} (${meta.axes.map((a) => `${a.label} ${a.size}`).join(" × ")})`);
  rebuildAssignment(state);
  return entry;
}

/** Check a file is an NMRPipe 3D spectrum with 1H, 15N and 13C axes; its real-spectrum entry. */
function spectrumMeta(abs: string, name: string, experiment: Experiment, stored: string): ReturnType<typeof realSpectrumMeta> | { error: string } {
  try {
    const cube = loadCubeFile(abs);
    if (cube.ndim !== 3) throw new Error(`expected a 3D spectrum, found ${cube.ndim}D`);
    const labels = cube.axes.map((a) => a.label).sort().join(",");
    if (labels !== "13C,15N,1H") throw new Error(`cannot identify the 1H, 15N and 13C axes (found ${cube.axes.map((a) => a.label || "?").join(", ")})`);
    return realSpectrumMeta(name, EXPERIMENT_TYPES[experiment].label, APP_SPECTRUM_TYPE[experiment], cube, stored);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Register a spectrum used in place (not copied into the upload directory), e.g. a file in the
 * ARTINA download cache given by its stored data path. It is checked like an upload.
 */
export function addStoredSpectrum(state: ProjectState, input: { name: string; experiment: Experiment; stored: string; abs: string; original: string }): InputSpectrum | { error: string } {
  if (!state.inputs) return { error: "this project has no inputs" };
  const meta = spectrumMeta(input.abs, input.name, input.experiment, input.stored);
  if ("error" in meta) return { error: `${input.original} is not a readable NMRPipe 3D spectrum: ${meta.error}` };
  const entry: InputSpectrum = {
    name: input.name,
    experiment: input.experiment,
    file: path.basename(input.abs),
    stored: input.stored,
    original: input.original,
    sizeMB: meta.sizeMB,
    uploadedAt: new Date().toISOString(),
  };
  state.inputs.spectra = [...state.inputs.spectra.filter((s) => s.name !== input.name), entry];
  state.realSpectra = [...(state.realSpectra ?? []).filter((r) => r.name !== input.name), meta];
  return entry;
}

/** Remove a spectrum and its peak list. */
export function removeSpectrum(state: ProjectState, name: string): boolean {
  const s = state.inputs?.spectra.find((x) => x.name === name);
  if (!s || !state.inputs) return false;
  // a file used in place (e.g. in the ARTINA cache) is not the project's to delete
  if (!s.stored) {
    const abs = spectrumPath(state.id, s)!;
    forgetCube(abs);
    fs.rmSync(/*turbopackIgnore: true*/ abs, { force: true });
  }
  if (s.peakList && !s.peakList.stored) fs.rmSync(/*turbopackIgnore: true*/ path.join(uploadDir(state.id), s.peakList.file), { force: true });
  state.inputs.spectra = state.inputs.spectra.filter((x) => x.name !== name);
  state.realSpectra = (state.realSpectra ?? []).filter((r) => r.name !== name);
  addHistory(state, "user", "remove_spectrum", s.original);
  rebuildAssignment(state);
  return true;
}

// ------------------------------------------------------------------ peak lists

const readText = (abs: string) => fs.readFileSync(/*turbopackIgnore: true*/ abs, "utf8");

function shiftEntries(state: ProjectState): ShiftEntry[] | undefined {
  const sl = state.inputs?.shiftList;
  if (!sl) return undefined;
  try {
    return parseXeasyProt(readText(path.join(uploadDir(state.id), sl.file)));
  } catch {
    return undefined;
  }
}

/**
 * Read a peak list for a spectrum and check it fits the project: assigned amides, residue names
 * that match the sequence. The error says how to fix the list when they do not.
 */
export function checkPeakList(state: ProjectState, text: string, opts: { format?: PeakListFormat; fileName?: string }): ReadPeakList | { error: string } {
  const read = readPeakList(text, { ...opts, shifts: shiftEntries(state) });
  if ("error" in read) return read;
  const amides = read.peaks.filter((p) => p.atoms.N || p.atoms.H);
  if (!amides.length) return { error: `none of the ${read.peaks.length} peaks has an assigned amide (H and N)` };
  const last = state.firstResidue + state.sequence.length - 1;
  const inside = amides.filter((p) => {
    const r = (p.atoms.N ?? p.atoms.H)!.resi;
    return r >= state.firstResidue && r <= last;
  });
  // residue names that mostly disagree with the sequence: a numbering offset, or another protein
  const fit = numberingOffset(read.peaks, state.sequence, state.firstResidue);
  if (fit.named && fit.matchedAsIs < fit.named / 2) {
    if (fit.offset !== 0 && fit.matched >= (2 * fit.named) / 3) {
      const start = state.firstResidue - fit.offset;
      return {
        error: `the residue names in the list match the sequence only when its first residue is numbered ${start} (it is ${state.firstResidue}): renumber the list, or create the project with first residue ${start}`,
      };
    }
    return { error: `the residue names in the list do not match the sequence (${fit.matchedAsIs} of ${fit.named} amides do)` };
  }
  if (!inside.length) return { error: `the list's amides are on residues outside the sequence (${state.firstResidue}–${last})` };
  return read;
}

/** Attach (or replace) the assigned peak list of an uploaded spectrum. */
export function addPeakList(state: ProjectState, upload: { tmp: string; original: string; spectrum: string; format?: string }): { peakList: PeakListFile; warnings: string[] } | { error: string; status: number } {
  const discard = () => fs.rmSync(/*turbopackIgnore: true*/ upload.tmp, { force: true });
  const s = state.inputs?.spectra.find((x) => x.name === upload.spectrum);
  if (!s) {
    discard();
    return { error: `no spectrum "${upload.spectrum}" in this project: upload the spectrum before its peak list`, status: 404 };
  }
  if (upload.format && upload.format !== "auto" && !isPeakListFormat(upload.format)) {
    discard();
    return { error: `unknown peak-list format "${upload.format}" (one of ${Object.keys(PEAK_LIST_FORMATS).join(", ")}, or auto)`, status: 400 };
  }
  const text = readText(upload.tmp);
  const read = checkPeakList(state, text, { format: isPeakListFormat(upload.format) ? upload.format : undefined, fileName: upload.original });
  if ("error" in read) {
    discard();
    return { error: `${path.basename(upload.original)}: ${read.error}`, status: 400 };
  }
  const ext = path.extname(upload.original).toLowerCase() || ".txt";
  const file = `${s.name}.peaklist${ext}`;
  if (s.peakList && !s.peakList.stored && s.peakList.file !== file) fs.rmSync(/*turbopackIgnore: true*/ path.join(uploadDir(state.id), s.peakList.file), { force: true });
  fs.renameSync(/*turbopackIgnore: true*/ upload.tmp, path.join(uploadDir(state.id), file));
  const peakList: PeakListFile = { file, original: path.basename(upload.original), format: read.format, peaks: read.peaks.length, uploadedAt: new Date().toISOString() };
  s.peakList = peakList;
  addHistory(state, "user", "upload_peak_list", `${peakList.original} (${PEAK_LIST_FORMATS[read.format].label}, ${read.peaks.length} peaks) for ${s.original}`);
  rebuildAssignment(state);
  return { peakList, warnings: read.warnings };
}

/** Attach a peak list used in place (e.g. a deposited list in the ARTINA cache); no rebuild. */
export function attachStoredPeakList(state: ProjectState, spectrum: string, input: { stored: string; abs: string; original: string }): PeakListFile | { error: string } {
  const s = state.inputs?.spectra.find((x) => x.name === spectrum);
  if (!s) return { error: `no spectrum "${spectrum}"` };
  const read = checkPeakList(state, readText(input.abs), { fileName: input.original });
  if ("error" in read) return read;
  s.peakList = { file: path.basename(input.abs), stored: input.stored, original: input.original, format: read.format, peaks: read.peaks.length, uploadedAt: new Date().toISOString() };
  return s.peakList;
}

export function removePeakList(state: ProjectState, spectrum: string): boolean {
  const s = state.inputs?.spectra.find((x) => x.name === spectrum);
  if (!s?.peakList) return false;
  if (!s.peakList.stored) fs.rmSync(/*turbopackIgnore: true*/ path.join(uploadDir(state.id), s.peakList.file), { force: true });
  addHistory(state, "user", "remove_peak_list", `${s.peakList.original} of ${s.original}`);
  delete s.peakList;
  rebuildAssignment(state);
  return true;
}

/** Attach (or replace) the XEASY .prot shift list that resolves XEASY peak lists with numbered atoms. */
export function addShiftList(state: ProjectState, upload: { tmp: string; original: string }): { entries: number } | { error: string; status: number } {
  if (!state.inputs) {
    fs.rmSync(/*turbopackIgnore: true*/ upload.tmp, { force: true });
    return { error: "this project was not created from your own data", status: 400 };
  }
  const entries = parseXeasyProt(readText(upload.tmp));
  if (!entries.length) {
    fs.rmSync(/*turbopackIgnore: true*/ upload.tmp, { force: true });
    return { error: `${path.basename(upload.original)} holds no XEASY shift entries ("id shift error atom residue")`, status: 400 };
  }
  fs.renameSync(/*turbopackIgnore: true*/ upload.tmp, path.join(uploadDir(state.id), SHIFT_LIST_FILE));
  state.inputs.shiftList = { file: SHIFT_LIST_FILE, original: path.basename(upload.original), entries: entries.length, uploadedAt: new Date().toISOString() };
  addHistory(state, "user", "upload_shift_list", `${state.inputs.shiftList.original} (${entries.length} shifts)`);
  rebuildAssignment(state);
  return { entries: entries.length };
}

export function removeShiftList(state: ProjectState): boolean {
  if (!state.inputs?.shiftList) return false;
  fs.rmSync(/*turbopackIgnore: true*/ path.join(uploadDir(state.id), state.inputs.shiftList.file), { force: true });
  delete state.inputs.shiftList;
  addHistory(state, "user", "remove_shift_list");
  rebuildAssignment(state);
  return true;
}

// ------------------------------------------------------------------ the assignment

/** Intensity lookup in a spectrum (nearest point, aliased positions folded back into the window). */
function heightReader(abs: string | null): BuildList["heightAt"] {
  if (!abs) return undefined;
  let lookup: ((h: number, n: number, c: number) => number) | null | undefined;
  return (h, n, c) => {
    if (lookup === undefined) {
      try {
        const cube = loadCubeFile(abs);
        const dims = [cube.dimOf("1H"), cube.dimOf("15N"), cube.dimOf("13C")];
        lookup = dims.some((d) => d < 0)
          ? null
          : (hh, nn, cc) => {
              const idx: number[] = [];
              [hh, nn, cc].forEach((v, k) => (idx[dims[k]] = cube.index(v, dims[k])));
              return cube.at(idx);
            };
      } catch {
        lookup = null;
      }
    }
    return lookup ? lookup(h, n, c) : 0;
  };
}

/**
 * Rebuild the assignment from the project's peak lists (spectra without a list are left out).
 * Clears it when no spectrum has a list.
 */
export function rebuildAssignment(state: ProjectState): void {
  const shifts = shiftEntries(state);
  const lists: BuildList[] = [];
  const notes: string[] = [];
  for (const s of state.inputs?.spectra ?? []) {
    if (!s.peakList) continue;
    const abs = s.peakList.stored ? spectrumPath(state.id, { file: s.peakList.file, stored: s.peakList.stored }) : path.join(uploadDir(state.id), s.peakList.file);
    try {
      const read = readPeakList(readText(abs!), { format: s.peakList.format, fileName: s.peakList.original, shifts });
      if ("error" in read) {
        notes.push(`${s.peakList.original}: ${read.error}`);
        continue;
      }
      notes.push(...read.warnings.map((w) => `${s.peakList!.original}: ${w}`));
      lists.push({ name: s.name, experiment: s.experiment, format: read.format, file: s.peakList.original, peaks: read.peaks, heightAt: heightReader(spectrumPath(state.id, s)) });
    } catch (e) {
      notes.push(`${s.peakList.original}: cannot be read (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  if (!lists.length) {
    state.results.assignment = undefined;
    state.spectra = [];
    state.hsqc = [];
    return;
  }
  const built = buildAssignment({ sequence: state.sequence, firstResidue: state.firstResidue, lists });
  built.assignment.notes.unshift(...notes);
  state.results.assignment = built.assignment;
  state.spectra = built.spectra;
  state.hsqc = built.hsqc;
}
