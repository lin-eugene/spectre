// ARTINA agent tools (catalogue, import errors), planes and strips of an imported project's real
// NMRPipe spectra (from the local cache; skipped when absent), and the downloader.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const REAL_CACHE = path.join(process.cwd(), ".data", "artina");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "spectre-artina-actions-"));
if (fs.existsSync(REAL_CACHE)) fs.symlinkSync(REAL_CACHE, path.join(tmp, "artina"), "dir");
process.env.SPECTRE_DATA_DIR = tmp;
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true })); // removes the link, not the cache

const { buildArtinaProject } = await import("@/lib/artina/build");
const { findProtein, isCached, localPathFor } = await import("@/lib/artina/catalog");
const { downloadAll } = await import("@/lib/artina/download");
const { planeFor, stripFor } = await import("@/lib/artina/planes");
const { runAction } = await import("@/lib/project/actions");

const p = findProtein("2K50")!;
const cached = Boolean(p) && isCached(p);

describe("ARTINA actions", () => {
  it("lists and filters the catalogue", async () => {
    const o = await runAction({} as never, "list_artina_proteins", { needs: ["HNcaCO", "CBCANH"], maxResidues: 120, limit: 5 });
    expect(o.ok).toBe(true);
    const r = o.result as { matches: number; proteins: { id: string; backbone: string[]; residues: number }[] };
    expect(r.matches).toBeGreaterThan(3);
    for (const x of r.proteins) {
      expect(x.backbone).toContain("HNcaCO");
      expect(x.residues).toBeLessThanOrEqual(120);
    }
  });

  it("rejects unknown proteins and jobs", async () => {
    const a = await runAction({} as never, "import_artina_protein", { id: "XXXX" });
    expect(a.ok).toBe(false);
    const b = await runAction({} as never, "get_import_status", { jobId: "nope" });
    expect(b.ok).toBe(false);
  });
});

describe.skipIf(!cached)("real NMRPipe spectra of an imported project", () => {
  it("serves planes, projections, slices and strips", () => {
    const state = buildArtinaProject(p);
    // plane orientation: row 0 = 15N ppmMax, column 0 = 1H ppmMax, values match the cube
    const pl = planeFor(state, "N15HSQC", {});
    if ("error" in pl) throw new Error(pl.error);
    expect(pl.y.label).toBe("15N");
    expect(pl.x.label).toBe("1H");
    expect(pl.y.ppmMax).toBeGreaterThan(pl.y.ppmMin);
    const vals = new Float32Array(Buffer.from(pl.data, "base64").buffer.slice(0));
    expect(vals.length).toBe(pl.x.n * pl.y.n);
    let mx = -Infinity;
    for (const v of vals) mx = Math.max(mx, v);
    expect(mx).toBeCloseTo(pl.max, 0);
    const proj = planeFor(state, "HNCA", { mode: "projection" });
    if ("error" in proj) throw new Error(proj.error);
    expect(proj.mode).toBe("projection");
    const slice = planeFor(state, "HNCA", { mode: "slice", x: "1H", y: "13C", at: 120 });
    if ("error" in slice) throw new Error(slice.error);
    expect(slice.y.label).toBe("13C");
    expect(Number(Object.values(slice.at ?? {})[0])).toBeCloseTo(120, 0);
    // the strip through a residue's amide shows its CA/CB peaks far above the noise
    const strip = stripFor(state, "CBCANH", 8.679, 120.944, 0.1);
    if ("error" in strip) throw new Error(strip.error);
    expect(strip.c.label).toBe("13C");
    expect(strip.maxAbs).toBeGreaterThan(20 * strip.noise);
    // the same spectrum by its autoAssign label
    expect("error" in planeFor(state, "CBCA(CO)NH", { mode: "projection" })).toBe(false);
  });
});

describe("downloader", () => {
  it("streams to .part, renames, reuses the cache and enforces the size limit", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spectre-dl-"));
    const prev = process.env.SPECTRE_DATA_DIR;
    process.env.SPECTRE_DATA_DIR = dir;
    try {
      const url = "https://nmrdb.ethz.ch/ARTINA_NMR_spectra_dataset//TEST/others/x.txt";
      const body = new TextEncoder().encode("hello artina");
      const fake = (async () => new Response(body, { headers: { "content-length": String(body.length) } })) as unknown as typeof fetch;
      const r1 = await downloadAll([{ url, mb: 0.001 }], { fetchImpl: fake });
      expect(r1.downloaded).toEqual([url]);
      expect(fs.readFileSync(localPathFor(url), "utf8")).toBe("hello artina");
      expect(fs.existsSync(`${localPathFor(url)}.part`)).toBe(false);
      const r2 = await downloadAll([{ url, mb: 0.001 }], { fetchImpl: fake });
      expect(r2.reused).toEqual([url]);
      await expect(downloadAll([{ url: url.replace("x.txt", "big.pipe"), mb: 900 }], { fetchImpl: fake, maxMB: 400 })).rejects.toThrow(/limit/);
    } finally {
      if (prev === undefined) delete process.env.SPECTRE_DATA_DIR;
      else process.env.SPECTRE_DATA_DIR = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
