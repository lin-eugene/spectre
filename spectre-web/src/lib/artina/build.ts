// Builds a project from a downloaded ARTINA protein: the sequence (the catalogue's sequence file,
// else the deposited structure), the structures, the NMRPipe backbone spectra used in place from
// the download cache (also the project's real spectra for planes and strips) with their deposited
// assigned peak lists, the 15N-HSQC for display, and the dataset's attribution (CC BY 4.0). The
// assignment is built from the deposited peak lists.
import fs from "node:fs";
import path from "node:path";
import { P3TO1 } from "../residues";
import { parsePdb } from "../structure/pdb";
import { EXPERIMENT_TYPES, parseSequenceText } from "../peaklists/inputs";
import { storedPathInCache } from "../peaklists/paths";
import { addStoredSpectrum, attachStoredPeakList, newInputsState, rebuildAssignment } from "../peaklists/project";
import type { ArtinaImportInfo, ArtinaSpectrumReport, ProjectState } from "../project/types";
import { addHistory } from "../project/store";
import { ARTINA_LICENSE, ARTINA_URL, importFiles, localPathFor, type ArtinaProtein } from "./catalog";
import { getCube, realSpectrumMeta } from "./cubes";

const EXTRA_THREE: Record<string, string> = { MSE: "M", HSD: "H", HSE: "H", HSP: "H", HIE: "H", HID: "H", HIP: "H", CYX: "C", CSS: "C" };

const readText = (url: string | undefined) => (url && fs.existsSync(localPathFor(url)) ? fs.readFileSync(localPathFor(url), "utf8") : null);

/** Keep only MODEL 1 (or the whole file when it has no MODEL records). */
export function firstModelText(pdb: string): string {
  if (!/^MODEL /m.test(pdb)) return pdb;
  const out: string[] = [];
  let inModel = false;
  let done = false;
  for (const line of pdb.split(/\r?\n/)) {
    if (line.startsWith("MODEL ")) {
      if (done) break;
      inModel = true;
      continue;
    }
    if (line.startsWith("ENDMDL")) {
      inModel = false;
      done = true;
      continue;
    }
    if (/^(ATOM|HETATM|ANISOU|TER)/.test(line)) {
      if (inModel) out.push(line);
      continue;
    }
    if (!done || /^(END|CONECT|MASTER)/.test(line)) out.push(line);
  }
  return out.join("\n");
}

/** Sequence and numbering from the deposited model (first chain), gaps filled from SEQRES. */
export function sequenceFromPdb(pdb: string): { sequence: string; firstResidue: number; chain: string } {
  const model = parsePdb(firstModelText(pdb));
  const chain = model.residues.find((r) => P3TO1[r.resn] || EXTRA_THREE[r.resn])?.chain ?? "A";
  const byResi = new Map<number, string>();
  for (const r of model.residues) {
    if (r.chain !== chain) continue;
    const one = P3TO1[r.resn] ?? EXTRA_THREE[r.resn];
    if (one) byResi.set(r.resi, one);
  }
  const seqres = pdb
    .split(/\r?\n/)
    .filter((l) => l.startsWith("SEQRES") && (l[11] === chain || l[11] === " "))
    .flatMap((l) => l.slice(19).trim().split(/\s+/))
    .map((r) => P3TO1[r] ?? EXTRA_THREE[r] ?? "X");
  const resis = [...byResi.keys()].sort((a, b) => a - b);
  if (!resis.length) throw new Error("no protein residues in the deposited structure");
  const first = resis[0];
  const last = resis[resis.length - 1];
  // align SEQRES to the ATOM residues to fill gaps
  let offset: number | null = null;
  if (seqres.length) {
    const atomStr = resis.map((r) => byResi.get(r)).join("");
    const contiguous = last - first + 1 === resis.length;
    const k = contiguous ? seqres.join("").indexOf(atomStr) : -1;
    if (k >= 0) offset = first - k;
  }
  let sequence = "";
  for (let r = first; r <= last; r++) {
    const fromAtom = byResi.get(r);
    const fromSeqres = offset !== null ? seqres[r - offset] : undefined;
    sequence += fromAtom ?? (fromSeqres && fromSeqres !== "X" ? fromSeqres : "G");
  }
  return { sequence, firstResidue: first, chain };
}

/**
 * The project's sequence, numbered like the deposited structure and peak lists: the
 * catalogue's sequence file when there is one (numbered from where the structure's sequence starts
 * in it), otherwise the deposited structure's.
 */
export function proteinSequence(p: ArtinaProtein, structure: { sequence: string; firstResidue: number } | null): { sequence: string; firstResidue: number; from: ArtinaImportInfo["sequenceFrom"] } {
  const seqFile = importFiles(p).find((f) => f.kind === "sequence");
  const text = seqFile ? readText(seqFile.url) : null;
  const parsed = text ? parseSequenceText(text) : null;
  if (parsed && !parsed.error) {
    const k = structure ? parsed.sequence.indexOf(structure.sequence.slice(0, 12)) : -1;
    return { sequence: parsed.sequence, firstResidue: structure && k >= 0 ? structure.firstResidue - k : 1, from: "sequence file" };
  }
  if (!structure) throw new Error("neither a sequence file nor the deposited structure is in the cache");
  return { sequence: structure.sequence, firstResidue: structure.firstResidue, from: "deposited structure" };
}

export interface BuildOptions {
  /** project id (default: a new one) */
  id?: string;
  log?: (msg: string) => void;
}

/**
 * The project of a downloaded ARTINA protein with its assignment built from the deposited peak
 * lists (not saved). Throws when the cache lacks the sequence or every backbone spectrum.
 */
export function buildArtinaProject(p: ArtinaProtein, opts: BuildOptions = {}): ProjectState {
  const log = opts.log ?? (() => undefined);
  const t0 = Date.now();
  const notes: string[] = [];
  const files = importFiles(p);

  // ---------------------------------------------------------------- structures + sequence
  const depositedText = readText(p.others["manual_structure.pdb"]);
  const structure = depositedText ? sequenceFromPdb(depositedText) : null;
  const { sequence, firstResidue, from } = proteinSequence(p, structure);
  const models: { id: string; label: string; text: string }[] = [];
  if (depositedText) models.push({ id: "deposited", label: `Deposited NMR ensemble (PDB ${p.pdb ?? p.id})`, text: depositedText });
  const af = readText(p.others["AlphaFold.pdb"]);
  if (af) models.push({ id: "alphafold", label: "AlphaFold model", text: af });
  const ar = readText(p.others["ARTINA.pdb"]);
  if (ar) models.push({ id: "artina", label: "ARTINA structure (from the spectra)", text: ar });
  log(`sequence: ${sequence.length} residues from ${firstResidue} (${from})`);

  const ref = p.reference ? p.reference.replace(/\s+/g, " ") : "";
  const backboneTypes = files.filter((f) => f.kind === "spectrum" && f.experiment).map((f) => f.type!);
  const state = newInputsState({
    id: opts.id,
    name: p.id,
    source: `artina:${p.id}`,
    description: `ARTINA dataset protein ${p.id} (${sequence.length} residues): real ${backboneTypes.join(", ")} spectra with their deposited assigned peak lists.${ref ? ` Reference: ${ref}` : ""}`,
    sequence,
    firstResidue,
  });
  if (p.pdb) state.meta.pdbId = p.pdb;
  if (p.bmrb) state.meta.bmrbId = p.bmrb;
  if (depositedText) state.pdb = { id: p.pdb ?? p.id, text: firstModelText(depositedText) };
  if (models.length) state.models = models;
  state.attribution = {
    text: `ARTINA NMR spectra dataset — Klukowski P, Damberger FF, Allain FH-T, Iwai H, Kadavath H, Ramelot TA, Montelione GT, Riek R, Güntert P (ETH Zürich). Protein ${p.id}${ref ? `: ${ref}` : ""}`,
    url: ARTINA_URL,
    license: ARTINA_LICENSE,
  };

  // ---------------------------------------------------------------- spectra, used in place
  const reports: ArtinaSpectrumReport[] = [];
  let hsqcMeta: ReturnType<typeof realSpectrumMeta> | null = null;
  for (const f of files) {
    if (f.kind !== "spectrum") continue;
    const abs = localPathFor(f.url);
    if (!fs.existsSync(abs)) {
      notes.push(`${f.type}: spectrum not downloaded`);
      continue;
    }
    const stored = storedPathInCache(abs);
    if (!f.experiment) {
      // the 15N-HSQC: shown, not assigned from
      try {
        const cube = getCube(stored);
        if (cube) {
          hsqcMeta = realSpectrumMeta(f.type!, f.type!, undefined, cube, stored);
          reports.push({ name: f.type!, file: stored, sizeMB: hsqcMeta.sizeMB });
        }
      } catch (e) {
        notes.push(`${f.type}: not readable (${e instanceof Error ? e.message : String(e)})`);
      }
      continue;
    }
    const added = addStoredSpectrum(state, { name: f.type!, experiment: f.experiment, stored, abs, original: path.basename(abs) });
    if ("error" in added) {
      notes.push(`${f.type}: ${added.error}`);
      log(`${f.type}: skipped (${added.error})`);
      continue;
    }
    const report: ArtinaSpectrumReport = { name: f.type!, experiment: f.experiment, file: stored, sizeMB: added.sizeMB };
    // its deposited assigned peak list
    const list = files.find((g) => g.kind === "peaklist" && g.type === f.type);
    const listAbs = list ? localPathFor(list.url) : null;
    if (!listAbs || !fs.existsSync(listAbs)) notes.push(`${f.type}: no deposited peak list`);
    else {
      const attached = attachStoredPeakList(state, f.type!, { stored: storedPathInCache(listAbs), abs: listAbs, original: path.basename(listAbs) });
      if ("error" in attached) notes.push(`${f.type}: peak list not used (${attached.error})`);
      else report.peakList = attached.stored;
    }
    reports.push(report);
    log(`${f.type} → ${EXPERIMENT_TYPES[f.experiment].label} (${f.experiment}), ${added.sizeMB.toFixed(0)} MB${report.peakList ? ", with its deposited peak list" : ", no peak list"}`);
  }
  if (!state.inputs!.spectra.length) throw new Error(`no readable backbone triple-resonance spectra for ${p.id}${notes.length ? ` (${notes.join("; ")})` : ""}`);
  if (hsqcMeta) state.realSpectra = [hsqcMeta, ...(state.realSpectra ?? [])];

  // ---------------------------------------------------------------- the assignment
  rebuildAssignment(state);
  const stats = state.results.assignment?.stats;
  if (stats) log(`assignment from the deposited peak lists: ${stats.assigned} residues, ${stats.veryHigh} confirmed, ${stats.high} unconfirmed, ${stats.low} with conflicts`);
  else notes.push("no deposited peak lists: the project has no assignment");

  const info: ArtinaImportInfo = {
    id: p.id,
    importedAt: new Date().toISOString(),
    spectra: reports,
    sequenceFrom: from,
    timings: { build: Date.now() - t0 },
    notes,
  };
  state.artina = info;
  addHistory(
    state,
    "system",
    "import_artina",
    `${p.id}: ${sequence.length} residues (${from}), spectra ${reports.map((r) => `${r.name}${r.peakList ? " with its peak list" : ""}`).join(", ")}`,
  );
  return state;
}
