// Server-side loaders for the demo data: the bundled ubiquitin demo (data/demo/ubiquitin: assigned
// Sparky peak lists written from the BMRB 6457 shifts; see scripts/build-demo-data.mjs), and raw
// Bruker 1D experiments, which are not bundled but read from a local directory (brukerDir).
import fs from "node:fs";
import path from "node:path";
import { buildAssignment } from "../peaklists/build";
import type { Experiment } from "../peaklists/inputs";
import { readPeakList } from "../peaklists/read";
import type { ProjectState } from "./types";

export const DATA_ROOT = path.join(process.cwd(), "data");
export const DEMO_SOURCE = "demo:ubiquitin";

export const isDemoProject = (state: Pick<ProjectState, "meta">) => state.meta.source === DEMO_SOURCE;

interface DemoMeta {
  id: string;
  name: string;
  organism: string;
  uniprot: string;
  pdbId: string;
  bmrbId: string;
  sequence: string;
  firstResidue: number;
  description: string;
  /** the assigned peak lists (Sparky), relative to the demo directory */
  peakLists: { file: string; experiment: Experiment }[];
  pdb: string;
}

/** The ubiquitin demo as a project (no id yet), its assignment built from its peak lists. */
export function loadUbiquitinDemo(): ProjectState {
  const dir = path.join(DATA_ROOT, "demo/ubiquitin");
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")) as DemoMeta;
  const lists = meta.peakLists.map(({ file, experiment }) => {
    const read = readPeakList(fs.readFileSync(path.join(dir, file), "utf8"), { fileName: file });
    if ("error" in read) throw new Error(`demo peak list ${file}: ${read.error}`);
    return { name: experiment, experiment, format: read.format, file: path.basename(file), peaks: read.peaks };
  });
  const built = buildAssignment({ sequence: meta.sequence, firstResidue: meta.firstResidue, lists });
  const now = new Date().toISOString();
  return {
    version: 1,
    id: "",
    createdAt: now,
    updatedAt: now,
    meta: {
      name: meta.name,
      organism: meta.organism,
      uniprot: meta.uniprot,
      pdbId: meta.pdbId,
      bmrbId: meta.bmrbId,
      description: meta.description,
      source: DEMO_SOURCE,
    },
    sequence: meta.sequence,
    firstResidue: meta.firstResidue,
    spectra: built.spectra,
    hsqc: built.hsqc,
    pdb: { id: meta.pdbId, text: fs.readFileSync(path.join(dir, meta.pdb), "utf8") },
    results: { assignment: built.assignment },
    history: [],
  };
}

/**
 * Where raw Bruker 1D experiments are read from (<dir>/<experiment>/fid, acqus, procs, title):
 * SPECTRE_BRUKER_DIR, else .data/bruker1h. None are bundled; the directory is git-ignored.
 */
export function brukerDir(): string {
  return process.env.SPECTRE_BRUKER_DIR || path.join(process.cwd(), ".data", "bruker1h");
}

export function listBrukerDemo(): string[] {
  const dir = brukerDir();
  if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) return [];
  return fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, "fid"))).sort();
}

export function readBrukerDemo(exp: string): { acqus: string; procs: string; title: string; fid: Uint8Array } | null {
  if (!/^[A-Za-z0-9_-]+$/.test(exp)) return null;
  const dir = path.join(brukerDir(), exp);
  if (!fs.existsSync(path.join(dir, "fid"))) return null;
  return {
    acqus: fs.readFileSync(path.join(dir, "acqus"), "utf8"),
    procs: fs.existsSync(path.join(dir, "procs")) ? fs.readFileSync(path.join(dir, "procs"), "utf8") : "",
    title: fs.existsSync(path.join(dir, "title")) ? fs.readFileSync(path.join(dir, "title"), "utf8").trim() : exp,
    fid: new Uint8Array(fs.readFileSync(path.join(dir, "fid"))),
  };
}
