// ARTINA imports: the catalogue, the files an import downloads, and the project built from the local
// download cache with its deposited peak lists (.data/artina, no network; skipped when the files
// are absent).
// Projects and uploads go to a temporary data directory whose artina/ links to the real cache.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const REAL_CACHE = path.join(process.cwd(), ".data", "artina");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "spectre-artina-"));
if (fs.existsSync(REAL_CACHE)) fs.symlinkSync(REAL_CACHE, path.join(tmp, "artina"), "dir");
process.env.SPECTRE_DATA_DIR = tmp;
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true })); // removes the link, not the cache

const { buildArtinaProject, proteinSequence, sequenceFromPdb } = await import("@/lib/artina/build");
const { BACKBONE_TYPES, catalogSummaries, findProtein, importFiles, isCached, localPathFor } = await import("@/lib/artina/catalog");
const { resolveStored, spectrumPath, uploadDir } = await import("@/lib/peaklists/paths");
const { getJob, startImport, waitForJob } = await import("@/lib/artina/jobs");
const { getProject } = await import("@/lib/project/store");

const p2k50 = findProtein("2K50")!;
const cached = Boolean(p2k50) && isCached(p2k50);

describe("ARTINA catalogue", () => {
  it("lists 100 proteins with their backbone experiments", () => {
    const all = catalogSummaries();
    expect(all.length).toBe(100);
    const s = all.find((x) => x.id === "2K50")!;
    expect(s.backbone).toEqual(["HNCO", "HNcaCO", "HNCA", "HNcoCA", "CBCANH", "CBCAcoNH"]);
    expect(s.hasHsqc).toBe(true);
    expect(s.backboneMB).toBeGreaterThan(150);
    expect(s.backboneMB).toBeLessThan(200);
  });

  it("maps every ARTINA backbone experiment to an experiment type", () => {
    expect(BACKBONE_TYPES).toMatchObject({ HNCO: "hnco", HNcaCO: "hncaco", HNCA: "hnca", HNcoCA: "hncoca", CBCANH: "cbcanh", CBCAcoNH: "cbcaconh" });
  });

  it("downloads the NMRPipe spectra with their deposited assigned peak lists and the structures, nothing else", () => {
    const files = importFiles(p2k50);
    const spectra = files.filter((f) => f.kind === "spectrum");
    expect(spectra.map((f) => f.type)).toEqual(["HNCO", "HNcaCO", "HNCA", "HNcoCA", "CBCANH", "CBCAcoNH", "N15HSQC"]);
    expect(spectra.every((f) => f.url.endsWith(".pipe"))).toBe(true);
    expect(spectra.filter((f) => f.experiment).map((f) => f.experiment)).toEqual(["hnco", "hncaco", "hnca", "hncoca", "cbcanh", "cbcaconh"]);
    const lists = files.filter((f) => f.kind === "peaklist");
    expect(lists.map((f) => path.basename(f.url))).toEqual(["HNCO", "HNcaCO", "HNCA", "HNcoCA", "CBCANH", "CBCAcoNH"].map((t) => `${t}_assigned.list`));
    expect(files.filter((f) => f.kind === "structure").map((f) => path.basename(f.url))).toEqual(["manual_structure.pdb", "AlphaFold.pdb", "ARTINA.pdb"]);
    // no UCSF cubes, expected peak lists, shift lists or NOESY/methyl data
    expect(files.some((f) => /\.ucsf$|_expected|\.prot$|NOESY|C13HSQC/.test(f.url))).toBe(false);
    expect(localPathFor(spectra[0].url)).toBe(path.join(tmp, "artina", "2K50", "spectra", "HNCO.pipe"));
  });

  it("maps whatever backbone set a protein has (2HEQ: no HN(CA)CO)", () => {
    const p = findProtein("2HEQ")!;
    const types = ["HNCO", "HNCA", "HNcoCA", "CBCANH", "CBCAcoNH"];
    expect(importFiles(p).filter((f) => f.kind === "spectrum" && f.experiment).map((f) => f.type)).toEqual(types);
    expect(importFiles(p).filter((f) => f.kind === "peaklist").map((f) => f.type)).toEqual(types);
  });

  it("keeps stored data paths inside their directories", () => {
    expect(resolveStored("2K50/spectra/HNCA.pipe")).toBe(path.join(tmp, "artina", "2K50", "spectra", "HNCA.pipe"));
    expect(resolveStored("uploads/abc/x.pipe")).toBe(path.join(tmp, "uploads", "abc", "x.pipe"));
    expect(resolveStored("../../etc/passwd")).toBeNull();
    expect(resolveStored("uploads/../../x")).toBeNull();
  });
});

describe.skipIf(!cached)("ARTINA 2K50 project from the cached spectra", () => {
  it("derives the sequence from the deposited structure", () => {
    const pdb = fs.readFileSync(localPathFor(p2k50.others["manual_structure.pdb"]), "utf8");
    const { sequence, firstResidue } = sequenceFromPdb(pdb);
    expect(firstResidue).toBe(1);
    expect(sequence.length).toBe(110);
    expect(sequence.startsWith("MKPEHRM")).toBe(true);
    expect(proteinSequence(p2k50, { sequence, firstResidue })).toEqual({ sequence, firstResidue: 1, from: "deposited structure" });
  });

  it("builds a project from the cached spectra and deposited peak lists, used in place", () => {
    const state = buildArtinaProject(p2k50);
    const info = state.inputs!;
    expect(state.meta.source).toBe("artina:2K50");
    expect(info.spectra.map((s) => [s.name, s.experiment])).toEqual([
      ["HNCO", "hnco"],
      ["HNcaCO", "hncaco"],
      ["HNCA", "hnca"],
      ["HNcoCA", "hncoca"],
      ["CBCANH", "cbcanh"],
      ["CBCAcoNH", "cbcaconh"],
    ]);
    for (const s of info.spectra) {
      expect(s.stored).toBe(`2K50/spectra/${s.name}.pipe`);
      expect(spectrumPath(state.id, s)).toBe(path.join(tmp, "artina", "2K50", "spectra", `${s.name}.pipe`));
      expect(s.peakList).toMatchObject({ stored: `2K50/peak_lists/${s.name}_assigned.list`, format: "sparky" });
    }
    // nothing copied into the project's upload directory
    expect(fs.existsSync(uploadDir(state.id))).toBe(false);
    // real spectra: the 15N-HSQC (shown only) and the six backbone spectra
    const real = state.realSpectra!;
    expect(real.map((r) => r.name)).toEqual(["N15HSQC", "HNCO", "HNcaCO", "HNCA", "HNcoCA", "CBCANH", "CBCAcoNH"]);
    expect(real[0]).toMatchObject({ ndim: 2, file: "2K50/spectra/N15HSQC.pipe" });
    expect(real.find((r) => r.name === "CBCANH")).toMatchObject({ ndim: 3, engineType: "hncacb", experiment: "CBCANH", file: "2K50/spectra/CBCANH.pipe" });
    expect(real.find((r) => r.name === "CBCAcoNH")).toMatchObject({ engineType: "hncocacb", experiment: "CBCA(CO)NH" });
    for (const r of real.slice(1)) expect(r.axes.map((a) => a.label).sort()).toEqual(["13C", "15N", "1H"]);
    expect(state.models?.map((m) => m.id)).toEqual(["deposited", "alphafold", "artina"]);
    expect(state.pdb?.text).toMatch(/^ATOM/m);
    expect(state.attribution).toMatchObject({ license: "CC BY 4.0", url: "https://nmrdb.ethz.ch/" });
    expect(state.artina).toMatchObject({ id: "2K50", sequenceFrom: "deposited structure" });
    expect(state.artina!.spectra.filter((s) => s.peakList)).toHaveLength(6);
    // the assignment: every deposited peak placed, nearly every residue confirmed
    const a = state.results.assignment!;
    expect(a.inputs.map((i) => [i.spectrum, i.used === i.peaks])).toEqual(info.spectra.map((s) => [s.name, true]));
    expect(a.stats.assigned).toBeGreaterThan(90);
    expect(a.stats.veryHigh).toBeGreaterThan(0.8 * a.stats.assigned);
    // the lists carry no heights: they are read from the spectra (CBCANH: CA and CB of opposite sign)
    const peaks = a.spinSystems.flatMap((s) => s.peaks.filter((p) => p.spec === "hncacb" && (p.label === "CA(i)" || p.label === "CB(i)")));
    expect(peaks.every((p) => p.inty !== 0)).toBe(true);
    const sign = (label: string) => Math.sign(peaks.filter((p) => p.label === label).reduce((x, p) => x + p.inty, 0));
    expect(sign("CA(i)")).toBe(-sign("CB(i)"));
    expect(state.spectra.map((s) => s.tp)).toEqual(["hnco", "hncaco", "hnca", "hncoca", "hncacb", "hncocacb"]);
    expect(state.hsqc.length).toBe(a.stats.roots);
  });

  it("imports through a job: download (all cached) → project with its assignment", async () => {
    const job = startImport({ id: "2K50" });
    expect(job.proteinId).toBe("2K50");
    const done = await waitForJob(job.jobId, 60_000);
    expect(done?.error).toBeUndefined();
    expect(done?.status).toBe("done");
    expect(done?.log.some((l) => /downloaded 0 files .* reused 16 cached/.test(l))).toBe(true);
    const state = getProject(done!.projectId!)!;
    expect(state.inputs?.spectra.length).toBe(6);
    expect(state.results.assignment?.stats.assigned).toBeGreaterThan(90);
    expect(state.history.some((h) => h.action === "import_artina")).toBe(true);
    expect(getJob(job.jobId)?.progress).toBe(1);
  });
});

describe.skipIf(!cached)("projects route (POST /api/projects)", () => {
  it("makes a ubiquitin demo by default; 2K50 follows a running import, then opens the 2K50 project", async () => {
    const { GET, POST } = await import("@/app/api/projects/route");
    const { listJobs } = await import("@/lib/artina/jobs");
    const post = (body?: unknown) => POST(new Request("http://x/api/projects", { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) }));
    // while an import of 2K50 is under way, its job is returned (not a second import)
    const jobs = (globalThis as unknown as { __spectreImportJobs: Map<string, import("@/lib/contract").ImportJob> }).__spectreImportJobs;
    jobs.set("fake", { jobId: "fake", proteinId: "2K50", status: "downloading", progress: 0.1, message: "", log: [] });
    const r1 = await post({ demo: "2K50" });
    expect(r1.status).toBe(202);
    expect(await r1.json()).toEqual({ jobId: "fake" });
    expect(startImport({ id: "2K50" }).jobId).toBe("fake");
    jobs.delete("fake");
    // otherwise the newest 2K50 project
    const job = startImport({ id: "2K50" });
    const done = await waitForJob(job.jobId, 60_000);
    expect(listJobs().some((j) => j.proteinId === "2K50" && j.status !== "done" && j.status !== "error")).toBe(false);
    const r2 = await post({ demo: "2K50" });
    expect(r2.status).toBe(200);
    expect(((await r2.json()) as { id: string }).id).toBe(done!.projectId);
    for (const r of [await post(), await post({ demo: "ubiquitin" })]) {
      expect(r.status).toBe(201);
      const demo = getProject(((await r.json()) as { id: string }).id)!;
      expect(demo.meta.source).toBe("demo:ubiquitin");
      expect(demo.results.assignment?.stats.assigned).toBeGreaterThan(60);
      expect(demo.results.assignment?.inputs.map((i) => i.experiment)).toEqual(["hnca", "hncacb", "hnco", "hncaco"]);
    }
    expect((await post({ demo: "6SVC" })).status).toBe(400);
    const list = (await (await GET(new Request("http://x/api/projects"))).json()) as { projects: { id: string; source?: string }[] };
    expect(list.projects.find((x) => x.id === done!.projectId)?.source).toBe("artina:2K50");
  });
});

describe("ARTINA import errors", () => {
  it("rejects unknown proteins", () => {
    const job = startImport({ id: "XXXX" });
    expect(job.status).toBe("error");
    expect(job.error).toMatch(/unknown ARTINA protein/);
  });
});
