import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { axisPpmMax, axisPpmMin } from "@/lib/spectra/cube";
import { parseSparkyAssigned, parseSparkyLabel, parseXeasyPeaks, parseXeasyProt, readPipe, readUcsf, readUcsfHeader } from "@/lib/spectra/formats";

const CACHE = path.join(process.cwd(), ".data/artina/2K50");
const has = (rel: string) => fs.existsSync(path.join(CACHE, rel));
const read = (rel: string) => new Uint8Array(fs.readFileSync(path.join(CACHE, rel)));
const text = (rel: string) => fs.readFileSync(path.join(CACHE, rel), "utf8");

describe("UCSF reader", () => {
  it.skipIf(!has("spectra/N15HSQC.ucsf"))("reads the 2K50 15N HSQC header and data", () => {
    const bytes = read("spectra/N15HSQC.ucsf");
    const h = readUcsfHeader(bytes);
    expect(h.ndim).toBe(2);
    expect(h.axes.map((a) => a.nucleus)).toEqual(["N", "H"]);
    expect(h.axes.map((a) => a.size)).toEqual([256, 1024]);
    expect(h.axes[0].center).toBeCloseTo(118.13, 2);
    expect(h.axes[1].center).toBeCloseTo(9.81, 2);
    const cube = readUcsf(bytes);
    expect(cube.axes.map((a) => a.label)).toEqual(["15N", "1H"]);
    // the window reaches down to residual water (~4.8 ppm); amide peaks must stand far above noise
    let best = 0;
    for (let i = 0; i < cube.data.length; i++) {
      const hh = cube.ppm(i % 1024, 1);
      if (hh < 6 || hh > 11) continue;
      if (Math.abs(cube.data[i]) > Math.abs(cube.data[best])) best = i;
    }
    const n = cube.ppm(Math.floor(best / 1024), 0);
    expect(n).toBeGreaterThan(100);
    expect(n).toBeLessThan(135);
    expect(Math.abs(cube.data[best])).toBeGreaterThan(50 * cube.noise());
  });

  it.skipIf(!has("spectra/HNCA.ucsf"))("reads a 3D cube whose assigned peaks sit on signals", () => {
    const cube = readUcsf(read("spectra/HNCA.ucsf"));
    expect(cube.ndim).toBe(3);
    const labels = cube.axes.map((a) => a.label);
    expect(labels).toContain("13C");
    expect(labels).toContain("15N");
    expect(labels).toContain("1H");
    const list = parseSparkyAssigned(text("peak_lists/HNCA_assigned.list"));
    expect(list.ndim).toBe(3);
    // assigned positions must be inside the windows and well above the noise after a local climb
    const noise = cube.noise();
    let strong = 0;
    for (const p of list.peaks.slice(0, 40)) {
      const idx = p.ppm.map((v, d) => cube.index(v, d));
      const { idx: top } = cube.climbToMax(idx);
      if (Math.abs(cube.at(top)) > 5 * noise) strong++;
      for (let d = 0; d < 3; d++) {
        expect(p.ppm[d]).toBeGreaterThan(axisPpmMin(cube.axes[d]) - 40);
        expect(p.ppm[d]).toBeLessThan(axisPpmMax(cube.axes[d]) + 40);
      }
    }
    expect(strong).toBeGreaterThan(30);
  });
});

describe("NMRPipe reader", () => {
  it.skipIf(!has("spectra/N15HSQC.pipe"))("reads the 2K50 15N HSQC as the UCSF export does", () => {
    const cube = readPipe(read("spectra/N15HSQC.pipe"));
    expect(cube.ndim).toBe(2);
    expect(cube.axes.map((a) => a.label)).toEqual(["15N", "1H"]);
    let best = 0;
    for (let i = 0; i < cube.data.length; i++) if (Math.abs(cube.data[i]) > Math.abs(cube.data[best])) best = i;
    const nx = cube.axes[1].size;
    const at = [cube.ppm(Math.floor(best / nx), 0), cube.ppm(best % nx, 1)];
    expect(at[0]).toBeGreaterThan(100);
    expect(at[0]).toBeLessThan(135);
    expect(Math.abs(cube.data[best])).toBeGreaterThan(50 * cube.noise());
    if (!has("spectra/N15HSQC.ucsf")) return;
    // same spectrum in both formats: same grid and ppm windows, strongest peak at the same place
    const u = readUcsf(read("spectra/N15HSQC.ucsf"));
    expect(u.axes.map((a) => a.size)).toEqual(cube.axes.map((a) => a.size));
    for (let d = 0; d < 2; d++) {
      expect(Math.abs(axisPpmMax(u.axes[d]) - axisPpmMax(cube.axes[d]))).toBeLessThan(Math.abs(cube.axes[d].step) * 1.01);
      expect(Math.abs(axisPpmMin(u.axes[d]) - axisPpmMin(cube.axes[d]))).toBeLessThan(Math.abs(cube.axes[d].step) * 1.01);
    }
    let ub = 0;
    for (let i = 0; i < u.data.length; i++) if (Math.abs(u.data[i]) > Math.abs(u.data[ub])) ub = i;
    expect(Math.abs(u.ppm(Math.floor(ub / nx), 0) - at[0])).toBeLessThan(2 * Math.abs(cube.axes[0].step));
    expect(Math.abs(u.ppm(ub % nx, 1) - at[1])).toBeLessThan(2 * Math.abs(cube.axes[1].step));
  });
});

describe("assignment lists", () => {
  it("parses Sparky labels with and without residue prefixes", () => {
    expect(parseSparkyLabel("E4N-P3CA-E4H", 3)).toEqual([
      { resi: 4, resn: "E", atom: "N" },
      { resi: 3, resn: "P", atom: "CA" },
      { resi: 4, resn: "E", atom: "H" },
    ]);
    expect(parseSparkyLabel("G2N-H", 2)).toEqual([
      { resi: 2, resn: "G", atom: "N" },
      { resi: 2, resn: "G", atom: "H" },
    ]);
    expect(parseSparkyLabel("?-?", 2)).toEqual([null, null]);
  });

  it.skipIf(!has("others/manual_shift_list.prot"))("parses the deposited shift list", () => {
    const prot = parseXeasyProt(text("others/manual_shift_list.prot"));
    expect(prot.length).toBeGreaterThan(500);
    expect(prot[0]).toMatchObject({ atom: "CB", resi: 1 });
  });

  it.skipIf(!has("peak_lists/HNCA_assigned.peaks"))("parses XEASY peaks", () => {
    const xe = parseXeasyPeaks(text("peak_lists/HNCA_assigned.peaks"));
    expect(xe.ndim).toBe(3);
    expect(xe.names).toEqual(["N", "C", "HN"]);
    expect(xe.peaks[0].atoms[1]).toEqual({ atom: "CA", resi: 3, resn: "" });
    expect(xe.peaks[0].inty).toBeGreaterThan(0);
  });
});
