// The app's assignment results, built from assigned peak lists: the ubiquitin demo (Sparky lists
// written from the BMRB 6457 shifts), the views and exports fed from it, peak-list uploads to a
// project (with the errors they give), and results stored in an older layout.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { RESULT_VERSION } from "@/lib/assignment";
import { exportResults, EXPORT_FORMATS } from "@/lib/export";
import { loadUbiquitinDemo } from "@/lib/project/demo";
import { getProject, saveProject } from "@/lib/project/store";
import { toProjectView } from "@/lib/project/view";
import type { InputSpectrum, ProjectState } from "@/lib/project/types";
import { uploadDir } from "@/lib/peaklists/paths";
import { addPeakList, addShiftList, createUploadProject, removePeakList } from "@/lib/peaklists/project";
import { buildMatrix, buildResidues, buildRootIndex, buildStrips, hsqcData } from "@/lib/viz/data";
import { buildCubeModel, walkArcs } from "@/lib/viz/cube";

beforeAll(() => {
  process.env.SPECTRE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "spectre-assignment-"));
});

const demo = (): ProjectState => ({ ...loadUbiquitinDemo(), id: randomUUID() });

describe("the ubiquitin demo, from its peak lists", () => {
  it("holds every amide of the lists, its shifts and links, and checks them", () => {
    const s = demo();
    const a = s.results.assignment!;
    expect(a.source).toBe("peaklists");
    expect(a.version).toBe(RESULT_VERSION);
    // 76 residues: no amide for M1 and the three prolines, three broadened amides
    expect(a.stats).toMatchObject({ roots: 69, residues: 76, assignable: 72, assigned: 69, low: 0 });
    expect(a.stats.veryHigh).toBeGreaterThan(60);
    expect(a.stats.edges).toBeGreaterThan(60);
    expect(a.inputs.map((i) => [i.experiment, i.used === i.peaks])).toEqual([
      ["hnca", true],
      ["hncacb", true],
      ["hnco", true],
      ["hncaco", true],
    ]);
    expect(a.notes).toEqual([]);
    // residues: shifts are the means over their peaks; a proline gets its carbons from the (i-1) peaks of the next residue
    const i3 = a.residues.find((r) => r.resi === 3)!;
    expect(i3).toMatchObject({ resn: "I", root: "3", consistency: "veryHigh" });
    expect(i3.shifts.CA).toBeCloseTo(59.57, 0);
    expect(i3.shifts.HN).toBeCloseTo(8.32, 1);
    const p19 = a.residues.find((r) => r.resi === 19)!;
    expect(p19.root).toBeUndefined();
    expect(p19.shifts.CA).toBeGreaterThan(60);
    for (const resi of [24, 53, 62]) expect(a.residues.find((r) => r.resi === resi)!.root).toBeUndefined();
    // peaks carry labels relative to their spin system's residue
    const labels = new Set(a.spinSystems.flatMap((x) => x.peaks.map((p) => `${p.spec}:${p.label}`)));
    for (const l of ["hnca:CA(i)", "hnca:CA(i-1)", "hncacb:CB(i)", "hncacb:CB(i-1)", "hnco:CO(i-1)", "hncaco:CO(i)"]) expect(labels.has(l)).toBe(true);
    // links go both ways
    for (const [root, links] of Object.entries(a.links)) {
      for (const [other, , dir] of links) expect(a.links[other].some(([back, , d]) => back === root && d !== dir)).toBe(true);
    }
    expect(s.spectra.map((x) => x.tp)).toEqual(["hnca", "hncacb", "hnco", "hncaco"]);
    expect(s.hsqc).toHaveLength(69);
  });

  it("feeds the spectrum views", () => {
    const view = toProjectView(demo());
    const roots = buildRootIndex(view);
    const residues = buildResidues(view);
    expect(residues.find((r) => r.resi === 19)!.confidence).toBe("proline");
    expect(residues.find((r) => r.resi === 24)!.confidence).toBe("unassigned");
    expect(roots.get("3")).toMatchObject({ resi: 3, resn: "I", confidence: "veryHigh", text: "confirmed" });
    const strips = buildStrips(view, "hnca", residues, roots);
    expect(strips.find((x) => x.resi === 4)!.own.map((p) => p.label)).toContain("CA(i)");
    expect(strips.filter((x) => x.own.map((p) => p.label).sort().join() === "CA(i),CA(i-1)").length).toBeGreaterThan(50);
    expect(hsqcData(view, roots).filter((d) => d.resi !== null)).toHaveLength(69);
    const m = buildMatrix(view, residues, roots);
    expect(m.links.size).toBe(2 * view.assignment!.stats.edges);
    const cube = buildCubeModel(view, roots, "hncacb");
    expect(cube.assigned).toBe(true);
    expect(cube.peaks.some((p) => p.kind === "cb" && p.rel === "im1")).toBe(true);
    expect(walkArcs(cube, view, residues, 4).some((x) => x.linked)).toBe(true);
  });

  it("exports NMR-STAR, Sparky and tables", () => {
    const s = demo();
    const ctx = { result: s.results.assignment!, sequence: s.sequence, firstResidue: 1, name: "Ubiquitin demo" };
    for (const f of EXPORT_FORMATS) expect(exportResults(f, ctx).text.length).toBeGreaterThan(100);
    const star = exportResults("nmrstar", ctx);
    expect(star.filename).toBe("ubiquitin_demo_assigned_shifts.str");
    expect(star.text).toMatch(/^\s+\d+ 1 1\s+3\s+3 ILE CA\s+C 13\s+59\.\d{3} \. 1 1$/m);
    const sparky = exportResults("peaklists", ctx).text;
    expect(sparky).toMatch(/I3CA-N-H\s+59\.\d+\s+\d+\.\d+\s+8\.\d+/);
    expect(sparky).toMatch(/Q2CA-I3N-H/);
    const systems = exportResults("assignment_list", ctx).text.split("\n");
    expect(systems[0]).toBe("root\tH\tN\tresidue\tconsistency\tlinked to\tissues");
    expect(systems.find((l) => l.startsWith("3\t"))).toMatch(/^3\t8\.\d{3}\t\d+\.\d{2}\tI3\tconfirmed\t[\d ]+\t$/);
    expect(exportResults("shifts", ctx).text).toMatch(/^3\tILE\tCA\t59\.\d{3}\tconfirmed$/m);
  });
});

// ------------------------------------------------------------------ uploads

const SEQ = "MGSAL";
const LIST = (first: string) => `      Assignment         w1         w2         w3   Data Height

       ${first}2N-M1CA-${first}2H    109.500     55.200      8.400      5.0e+05
       ${first}2N-${first}2CA-${first}2H    109.500     45.300      8.400      9.0e+05
       S3N-${first}2CA-S3H    116.000     45.350      8.200      4.0e+05
       S3N-S3CA-S3H    116.000     58.400      8.200      8.0e+05
`;

/** A project with one HNCA "spectrum" (no file: heights come from the lists) and a list file to upload. */
function uploadProject(): ProjectState {
  const state = createUploadProject({ name: "Toy", sequenceText: `>toy\n${SEQ}\n`, firstResidue: 1 });
  if ("error" in state) throw new Error(state.error);
  const spectrum: InputSpectrum = { name: "HNCA", experiment: "hnca", file: "HNCA.ft3", original: "HNCA.ft3", sizeMB: 1, uploadedAt: "2026-10-18T00:00:00.000Z" };
  state.inputs!.spectra.push(spectrum);
  return state;
}

function tmpFile(state: ProjectState, text: string): string {
  const dir = uploadDir(state.id);
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `.upload-${randomUUID()}`);
  fs.writeFileSync(f, text);
  return f;
}

describe("peak-list uploads", () => {
  it("attach a list to its spectrum and rebuild the assignment", () => {
    const state = uploadProject();
    expect(state.results.assignment).toBeUndefined();
    const out = addPeakList(state, { tmp: tmpFile(state, LIST("G")), original: "hnca_assigned.list", spectrum: "HNCA" });
    expect(out).toMatchObject({ peakList: { format: "sparky", peaks: 4, original: "hnca_assigned.list" }, warnings: [] });
    expect(fs.existsSync(path.join(uploadDir(state.id), "HNCA.peaklist.list"))).toBe(true);
    const a = state.results.assignment!;
    expect(a.stats).toMatchObject({ roots: 2, assigned: 2, edges: 1 });
    expect(a.spinSystems.map((s) => [s.root, s.consistency])).toEqual([
      ["2", "veryHigh"],
      ["3", "veryHigh"],
    ]);
    expect(state.history.at(-1)).toMatchObject({ action: "upload_peak_list" });
    // the view tells the client what the project holds
    expect(toProjectView(state).inputs?.spectra[0]).toMatchObject({ name: "HNCA", label: "HNCA", stored: false, peakList: { format: "sparky", peaks: 4 } });
    // removing the list clears the assignment
    expect(removePeakList(state, "HNCA")).toBe(true);
    expect(state.results.assignment).toBeUndefined();
    expect(state.spectra).toEqual([]);
  });

  it("explain what is wrong with a list", () => {
    const state = uploadProject();
    const err = (text: string, spectrum = "HNCA", format?: string, original = "x.list") => {
      const r = addPeakList(state, { tmp: tmpFile(state, text), original, spectrum, format });
      return "error" in r ? r.error : "";
    };
    expect(err(LIST("G"), "HNCO")).toMatch(/no spectrum "HNCO"/);
    expect(err(LIST("G"), "HNCA", "mzml")).toMatch(/unknown peak-list format/);
    expect(err("hello\n", "HNCA", undefined, "x.dat")).toMatch(/not a recognised peak list/);
    expect(err("hello\n")).toMatch(/no peaks found in this Sparky list/);
    expect(err("Assignment w1 w2 w3\n?-?-? 109.5 55.2 8.4\n")).toMatch(/none of the 1 peaks/);
    // residue names that fit the sequence only when it is numbered from 11
    expect(err(LIST("G").replace(/(\D)([23])([NHC])/g, (_, a, n, b) => `${a}${Number(n) + 10}${b}`).replace("M1CA", "M11CA"))).toMatch(/numbered 11 \(it is 1\)/);
    // another protein altogether
    expect(err(LIST("W").replace(/S3/g, "T3"))).toMatch(/do not match the sequence \(0 of 4 amides do\)/);
    // nothing was attached
    expect(state.inputs!.spectra[0].peakList).toBeUndefined();
  });

  it("resolve XEASY lists with numbered atoms through the project's .prot", () => {
    const state = uploadProject();
    const peaks = `# Number of dimensions 3
#INAME 1 HN
#INAME 2 N
#INAME 3 CA
      1  8.400 109.500  55.200 1 U   5.0e+05  0.000e+00 e 0     3     4     1 0
      2  8.400 109.500  45.300 1 U   9.0e+05  0.000e+00 e 0     3     4     2 0
`;
    const before = addPeakList(state, { tmp: tmpFile(state, peaks), original: "hnca.peaks", spectrum: "HNCA" });
    expect("error" in before && before.error).toMatch(/\.prot shift list/);
    const prot = "   1  55.200 0.000 CA     1\n   2  45.300 0.000 CA     2\n   3   8.400 0.000 H      2\n   4 109.500 0.000 N      2\n";
    expect(addShiftList(state, { tmp: tmpFile(state, prot), original: "toy.prot" })).toEqual({ entries: 4 });
    const after = addPeakList(state, { tmp: tmpFile(state, peaks), original: "hnca.peaks", spectrum: "HNCA" });
    expect(after).toMatchObject({ peakList: { format: "xeasy", peaks: 2 } });
    expect(state.results.assignment?.spinSystems.map((s) => s.peaks.map((p) => p.label))).toEqual([["CA(i-1)", "CA(i)"]]);
  });
});

describe("results stored in an older layout", () => {
  it("are rebuilt from the project's peak lists", () => {
    const state = uploadProject();
    addPeakList(state, { tmp: tmpFile(state, LIST("G")), original: "hnca.list", spectrum: "HNCA" });
    // the layout of a former result type
    (state.results as Record<string, unknown>).assignment = { engine: "autoassign", version: 3, spinSystems: [], residues: [], stats: { assigned: 0 } };
    saveProject(state);
    const projects = path.join(process.env.SPECTRE_DATA_DIR!, "projects");
    (globalThis as unknown as { __spectreProjects: Map<string, ProjectState> }).__spectreProjects.delete(state.id);
    expect(fs.existsSync(path.join(projects, `${state.id}.json`))).toBe(true);
    const loaded = getProject(state.id)!;
    expect(loaded.results.assignment?.version).toBe(RESULT_VERSION);
    expect(loaded.results.assignment?.stats.assigned).toBe(2);
  });
});
