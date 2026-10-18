import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseAtomRef, parseXeasyProt } from "@/lib/spectra/formats";
import { buildAssignment, type BuildList } from "@/lib/peaklists/build";
import { detectFormat, numberingOffset, readPeakList, type ListPeak, type ReadPeakList } from "@/lib/peaklists/read";
import type { Experiment } from "@/lib/peaklists/inputs";

const CACHE = path.join(process.cwd(), ".data/artina/2K50");
const has = (rel: string) => fs.existsSync(path.join(CACHE, rel));
const text = (rel: string) => fs.readFileSync(path.join(CACHE, rel), "utf8");

const ok = (r: ReturnType<typeof readPeakList>): ReadPeakList => {
  if ("error" in r) throw new Error(r.error);
  return r;
};

describe("assignment labels", () => {
  it("reads the common ways of writing an atom", () => {
    expect(parseAtomRef("E4N")).toEqual({ resi: 4, resn: "E", atom: "N" });
    expect(parseAtomRef("P3CA")).toEqual({ resi: 3, resn: "P", atom: "CA" });
    expect(parseAtomRef("GLU4N")).toEqual({ resi: 4, resn: "E", atom: "N" });
    expect(parseAtomRef("Glu4.N")).toEqual({ resi: 4, resn: "E", atom: "N" });
    expect(parseAtomRef("4GluCA")).toEqual({ resi: 4, resn: "E", atom: "CA" });
    expect(parseAtomRef("4 Glu H")).toEqual({ resi: 4, resn: "E", atom: "H" });
    expect(parseAtomRef("A.12.LEU.H")).toEqual({ resi: 12, resn: "L", atom: "H" });
    expect(parseAtomRef("NA:A.12.LEU.CB")).toEqual({ resi: 12, resn: "L", atom: "CB" });
    expect(parseAtomRef("CA.3")).toEqual({ resi: 3, resn: "", atom: "CA" });
    expect(parseAtomRef("G12")).toEqual({ resi: 12, resn: "G", atom: "" });
    for (const none of ["?", "*", "", "None", "@-.@12."]) expect(parseAtomRef(none)).toBeNull();
  });
});

// residues 1-4 of a toy protein (M1 G2 S3 A4) in four formats
const SPARKY = `      Assignment         w1         w2         w3   Data Height

       G2N-M1CA-G2H    109.500     55.200      8.400      5.0e+05
       G2N-G2CA-G2H    109.500     45.300      8.400      9.0e+05
       S3N-G2CA-S3H    116.000     45.300      8.200      4.0e+05
       S3N-S3CA-S3H    116.000     58.400      8.200      8.0e+05
       A4N-S3CA-A4H    123.100     58.400      8.050      4.5e+05
       A4N-A4CA-A4H    123.100     52.600      8.050      8.5e+05
`;
const XEASY = `# Number of dimensions 3
#FORMAT xeasy3D
#INAME 1 HN
#INAME 2 N
#INAME 3 CA
      1  8.400 109.500  55.200 1 U   5.0e+05  0.000e+00 e 0   H.2   N.2  CA.1
      2  8.400 109.500  45.300 1 U   9.0e+05  0.000e+00 e 0   H.2   N.2  CA.2
      3  8.200 116.000  45.300 1 U   4.0e+05  0.000e+00 e 0   H.3   N.3  CA.2
`;
const XEASY_NUMBERED = `# Number of dimensions 3
#INAME 1 HN
#INAME 2 N
#INAME 3 CA
      1  8.400 109.500  55.200 1 U   5.0e+05  0.000e+00 e 0     3     4     1 0
      2  8.400 109.500  45.300 1 U   9.0e+05  0.000e+00 e 0     3     4     2 0
`;
const PROT = `   1  55.200 0.000 CA     1
   2  45.300 0.000 CA     2
   3   8.400 0.000 H      2
   4 109.500 0.000 N      2
`;
const PIPE = `REMARK assigned HNCA
DATA  X_AXIS HN 1 1024 10.5ppm 5.5ppm
DATA  Y_AXIS N 1 128 135ppm 100ppm
DATA  Z_AXIS CA 1 128 70ppm 40ppm
VARS   INDEX X_AXIS Y_AXIS Z_AXIS X_PPM Y_PPM Z_PPM HEIGHT ASS
FORMAT %5d %9.3f %9.3f %9.3f %8.3f %8.3f %8.3f %+e %s
NULLSTRING *
    1 10.0 20.0 30.0 8.400 109.500 55.200 +5.0e+05 G2N-M1CA-G2H
    2 10.0 20.0 30.0 8.400 109.500 45.300 +9.0e+05 G2N-G2CA-G2H
    3 10.0 20.0 30.0 9.100 120.000 50.000 +1.0e+05 *
`;
const CCPN = `"#","Pid","Assign F1","Assign F2","Assign F3","Pos F1","Pos F2","Pos F3","Height"
1,PK:hnca.1.1,"A.2.GLY.H","A.2.GLY.N","A.1.MET.CA",8.400,109.500,55.200,5.0e+05
2,PK:hnca.1.2,"A.2.GLY.H","A.2.GLY.N","A.2.GLY.CA",8.400,109.500,45.300,9.0e+05
`;

describe("peak-list formats", () => {
  it("detects the format from the contents", () => {
    expect(detectFormat(SPARKY)).toBe("sparky");
    expect(detectFormat(XEASY)).toBe("xeasy");
    expect(detectFormat(PIPE)).toBe("nmrpipe");
    expect(detectFormat(CCPN)).toBe("ccpn");
    expect(detectFormat("E4N-P3CA-E4H 120.9 63.3 8.68\n")).toBe("sparky");
  });

  it("reads each format into H, N and C positions with their atoms", () => {
    for (const [name, src] of [
      ["sparky", SPARKY],
      ["xeasy", XEASY],
      ["nmrpipe", PIPE],
      ["ccpn", CCPN],
    ]) {
      const r = ok(readPeakList(src));
      expect(r.format, name).toBe(name);
      const p = r.peaks[0];
      expect([p.h, p.n, p.c], name).toEqual([8.4, 109.5, 55.2]);
      expect(p.height, name).toBe(5e5);
      expect(p.atoms.N, name).toMatchObject({ resi: 2, atom: "N" });
      expect(p.atoms.H, name).toMatchObject({ resi: 2, atom: "H" });
      expect(p.atoms.C, name).toMatchObject({ resi: 1, atom: "CA" });
    }
  });

  it("leaves unassigned NMRPipe rows unassigned", () => {
    const r = ok(readPeakList(PIPE));
    expect(r.peaks[2].atoms).toEqual({ H: null, N: null, C: null });
  });

  it("resolves numbered XEASY atoms through a .prot shift list, and asks for one without it", () => {
    const without = readPeakList(XEASY_NUMBERED);
    expect(without).toMatchObject({ needsShiftList: true });
    const r = ok(readPeakList(XEASY_NUMBERED, { shifts: parseXeasyProt(PROT) }));
    expect(r.peaks[0].atoms.C).toMatchObject({ resi: 1, atom: "CA" });
    expect(r.peaks[1].atoms.N).toMatchObject({ resi: 2, atom: "N" });
  });

  it("refuses 2D lists and lists with nothing assigned", () => {
    expect(readPeakList("Assignment w1 w2\nG2N-H 109.5 8.4\n")).toMatchObject({ error: expect.stringMatching(/2D peak list/) });
    expect(readPeakList("Assignment w1 w2 w3\n?-?-? 109.5 55.2 8.4\n")).toMatchObject({ error: expect.stringMatching(/none of the 1 peaks/) });
  });

  it("finds a numbering offset from the residue names", () => {
    const r = ok(readPeakList(SPARKY));
    // the list's G2 S3 A4 are residues 12-14 of a sequence numbered from 1
    expect(numberingOffset(r.peaks, "MKKKKKKKKKMGSA", 1)).toMatchObject({ offset: 10, matchedAsIs: 0 });
    expect(numberingOffset(r.peaks, "MGSA", 1)).toMatchObject({ offset: 0, matchedAsIs: r.peaks.length });
  });
});

// ------------------------------------------------------------------ the assignment and its check

const peak = (id: number, amide: number, carbon: [number, string] | null, h: number, n: number, c: number, height = 1): ListPeak => ({
  id,
  h,
  n,
  c,
  height,
  atoms: { H: { resi: amide, resn: "", atom: "H" }, N: { resi: amide, resn: "", atom: "N" }, C: carbon ? { resi: carbon[0], resn: "", atom: carbon[1] } : null },
  label: "",
});

const list = (experiment: Experiment, peaks: ListPeak[]): BuildList => ({ name: experiment, experiment, format: "sparky", file: `${experiment}.list`, peaks });

describe("building the assignment from peak lists", () => {
  // M1 G2 S3 A4 L5: an HNCA where G2-S3-A4 link, S3's CA disagrees between strips 3 and 4 by 1 ppm
  const hnca = list("hnca", [
    peak(1, 2, [1, "CA"], 8.4, 109.5, 55.2),
    peak(2, 2, [2, "CA"], 8.4, 109.5, 45.3),
    peak(3, 3, [2, "CA"], 8.2, 116.0, 45.35),
    peak(4, 3, [3, "CA"], 8.2, 116.0, 58.4),
    peak(5, 4, [3, "CA"], 8.05, 123.1, 59.4),
    peak(6, 4, [4, "CA"], 8.05, 123.1, 52.6),
    peak(7, 5, [4, "CA"], 7.9, 121.0, 52.62),
    peak(8, 5, [5, "CA"], 7.9, 121.0, 55.6),
    peak(9, 5, null, 7.9, 121.0, 40.0),
  ]);
  const built = buildAssignment({ sequence: "MGSAL", firstResidue: 1, lists: [hnca] });
  const a = built.assignment;
  const spin = (root: string) => a.spinSystems.find((s) => s.root === root)!;

  it("groups peaks by the residue of their amide and labels the carbons", () => {
    expect(a.spinSystems.map((s) => s.root)).toEqual(["2", "3", "4", "5"]);
    expect(spin("3").residue).toBe("3S");
    expect(spin("3").peaks.map((p) => p.label)).toEqual(["CA(i-1)", "CA(i)"]);
    expect(spin("5").peaks.find((p) => p.c === 40)!.label).toBe("");
    expect(a.residues.find((r) => r.resi === 2)!.shifts.CA).toBeCloseTo(45.325, 3);
    expect(built.hsqc.map((p) => p.name)).toEqual(["2", "3", "4", "5"]);
    expect(built.spectra[0].peaks).toHaveLength(9);
  });

  it("links consecutive residues whose carbons match", () => {
    expect(spin("2").links).toEqual([["3", 1, "f"]]);
    expect(spin("4").links).toEqual([["5", 1, "f"]]);
    expect(spin("3").links.some(([to]) => to === "4")).toBe(false);
    expect(a.stats.edges).toBe(2);
  });

  it("flags peaks of one atom that disagree, in both strips", () => {
    for (const root of ["3", "4"]) {
      expect(spin(root).consistency).toBe("low");
      expect(spin(root).issues.some((i) => i.kind === "conflict" && /Cα of Ser 3/.test(i.text))).toBe(true);
    }
    expect(spin("2").consistency).toBe("veryHigh");
    expect(spin("5").consistency).toBe("veryHigh");
    expect(a.stats).toMatchObject({ roots: 4, assigned: 4, veryHigh: 2, high: 0, low: 2 });
  });

  it("reports unexplained peaks and implausible shifts", () => {
    expect(spin("5").issues.some((i) => i.kind === "unexplained")).toBe(true);
    // a glycine CA at 58 ppm, and a CB on a glycine
    const bad = buildAssignment({
      sequence: "MGSAL",
      firstResidue: 1,
      lists: [list("hncacb", [peak(1, 2, [2, "CA"], 8.4, 109.5, 58.0), peak(2, 2, [2, "CB"], 8.4, 109.5, 30.0, -1)])],
    }).assignment;
    const texts = bad.spinSystems[0].issues.filter((i) => i.kind === "conflict").map((i) => i.text);
    expect(texts.some((t) => /implausible for Gly/.test(t))).toBe(true);
    expect(texts.some((t) => /has no Cβ/.test(t))).toBe(true);
  });

  it("leaves out peaks it cannot place, and says why", () => {
    const r = buildAssignment({
      sequence: "MGSAL",
      firstResidue: 1,
      lists: [
        list("hnca", [
          peak(1, 2, [2, "CA"], 8.4, 109.5, 45.3),
          { ...peak(2, 9, [9, "CA"], 8.0, 120, 55), label: "" },
          { ...peak(3, 3, [3, "CA"], 8.2, 116, 58.4), atoms: { H: null, N: null, C: { resi: 3, resn: "", atom: "CA" } } },
        ]),
      ],
    }).assignment;
    expect(r.inputs[0]).toMatchObject({ peaks: 3, used: 1, skipped: { "residue outside the sequence": 1, "amide not assigned": 1 } });
    expect(r.notes[0]).toMatch(/HNCA: 1 peak left out/);
  });
});

describe.skipIf(!has("peak_lists/HNCA_assigned.list"))("ARTINA 2K50 deposited peak lists", () => {
  it("builds a consistent assignment from the six backbone lists", () => {
    const files: [string, Experiment][] = [
      ["HNCO", "hnco"],
      ["HNcaCO", "hncaco"],
      ["HNCA", "hnca"],
      ["HNcoCA", "hncoca"],
      ["CBCANH", "cbcanh"],
      ["CBCAcoNH", "cbcaconh"],
    ];
    const lists = files.map(([f, experiment]) => {
      const r = ok(readPeakList(text(`peak_lists/${f}_assigned.list`)));
      expect(r.dims).toEqual({ N: 0, C: 1, H: 2 });
      return { name: f, experiment, format: r.format, file: `${f}_assigned.list`, peaks: r.peaks };
    });
    // the sequence as the labels give it (residues without labels as glycines)
    const seq = new Map<number, string>();
    for (const l of lists) for (const p of l.peaks) for (const a of [p.atoms.H, p.atoms.N, p.atoms.C]) if (a?.resn) seq.set(a.resi, a.resn);
    const first = Math.min(...seq.keys());
    const last = Math.max(...seq.keys());
    const sequence = Array.from({ length: last - first + 1 }, (_, k) => seq.get(first + k) ?? "G").join("");
    const a = buildAssignment({ sequence, firstResidue: first, lists }).assignment;
    expect(a.stats.roots).toBeGreaterThan(80);
    expect(a.stats.veryHigh).toBeGreaterThan(0.8 * a.stats.roots);
    expect(a.inputs.every((i) => i.used === i.peaks)).toBe(true);
  });
});
