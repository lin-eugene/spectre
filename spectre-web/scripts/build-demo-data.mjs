// Builds the ubiquitin demo dataset (data/demo/ubiquitin) from real data:
//   data/raw/1ubq.pdb        (RCSB 1UBQ crystal structure)
//   data/raw/bmr6457_3.str   (BMRB 6457 ubiquitin chemical shifts)
// The BMRB backbone shifts become assigned Sparky peak lists of an HNCA, HNCACB, HNCO and
// HN(CA)CO, with the imperfections of measured lists: jitter of the peak positions, a few missing
// (i-1) peaks and three exchange-broadened amides without any peaks. The demo project and the
// landing page build their assignment from these lists.
// Run: node scripts/build-demo-data.mjs
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const raw = (f) => path.join(root, "data/raw", f);
const outDir = path.join(root, "data/demo/ubiquitin");
fs.mkdirSync(outDir, { recursive: true });

const three2one = {
  ALA: "A", CYS: "C", ASP: "D", GLU: "E", PHE: "F", GLY: "G", HIS: "H", ILE: "I", LYS: "K", LEU: "L",
  MET: "M", ASN: "N", PRO: "P", GLN: "Q", ARG: "R", SER: "S", THR: "T", VAL: "V", TRP: "W", TYR: "Y",
};

// ---------- BMRB shifts ----------
const star = fs.readFileSync(raw("bmr6457_3.str"), "utf8").split("\n");
const shifts = {}; // resi -> {resn, atoms:{atom:ppm}}
{
  let inLoop = false;
  for (const line of star) {
    if (line.includes("_Atom_chem_shift.Assigned_chem_shift_list_ID")) {
      inLoop = true;
      continue;
    }
    if (!inLoop) continue;
    if (line.trim() === "stop_") break;
    const t = line.trim().split(/\s+/);
    if (t.length < 11) continue;
    const resi = parseInt(t[5], 10);
    shifts[resi] ??= { resn: t[6], atoms: {} };
    shifts[resi].atoms[t[7]] = parseFloat(t[10]);
  }
}

// ---------- sequence from PDB SEQRES ----------
const pdbText = fs.readFileSync(raw("1ubq.pdb"), "utf8");
const sequence = pdbText
  .split("\n")
  .filter((l) => l.startsWith("SEQRES"))
  .flatMap((l) => l.slice(19).trim().split(/\s+/))
  .map((r) => three2one[r])
  .join("");

// ---------- assigned peak lists ----------
// seeded random numbers (mulberry32), normal deviates by Box-Muller
let seed = 20261017;
const uniform = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const normal = (sd) => sd * Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform());

const broadened = new Set([24, 53, 62]); // exchange-broadened amides, absent from every list
const shift = (resi, atom) => shifts[resi]?.atoms[atom];
const amides = new Map();
for (let resi = 1; resi <= sequence.length; resi++) {
  if (resi === 1 || sequence[resi - 1] === "P" || broadened.has(resi) || shift(resi, "H") === undefined || shift(resi, "N") === undefined) continue;
  amides.set(resi, [shift(resi, "H") + normal(0.003), shift(resi, "N") + normal(0.03)]);
}

/** Sparky list of one experiment: [atom, residue offset, relative height] per peak of each amide. */
function sparkyList(spec) {
  const rows = [];
  for (const [resi, [h, n]] of amides) {
    const own = `${sequence[resi - 1]}${resi}`;
    for (const [atom, rel, amp] of spec) {
      const c = shift(resi + rel, atom);
      if (c === undefined || (rel === -1 && uniform() < 0.06)) continue;
      const carbon = `${sequence[resi + rel - 1]}${resi + rel}${atom}`;
      const label = `${own}N-${carbon}-${own}H`;
      rows.push(`${label.padStart(20)}${n.toFixed(3).padStart(11)}${(c + normal(0.03)).toFixed(3).padStart(11)}${h.toFixed(3).padStart(11)}${(amp * 1e4 * (0.75 + 0.5 * uniform())).toExponential(3).padStart(14)}`);
    }
  }
  return `${"Assignment".padStart(20)}${"w1".padStart(11)}${"w2".padStart(11)}${"w3".padStart(11)}${"Data Height".padStart(14)}\n\n${rows.join("\n")}\n`;
}

const lists = [
  ["hnca", [["CA", 0, 60], ["CA", -1, 32]]],
  ["hncacb", [["CA", 0, 50], ["CB", 0, -40], ["CA", -1, 24], ["CB", -1, -18]]],
  ["hnco", [["C", -1, 80]]],
  ["hncaco", [["C", 0, 40], ["C", -1, 18]]],
];
const listDir = path.join(outDir, "peaklists");
fs.rmSync(listDir, { recursive: true, force: true });
fs.mkdirSync(listDir, { recursive: true });
for (const [experiment, spec] of lists) fs.writeFileSync(path.join(listDir, `${experiment}.list`), sparkyList(spec));

// ---------- metadata ----------
fs.copyFileSync(raw("1ubq.pdb"), path.join(outDir, "1ubq.pdb"));
const meta = {
  id: "ubiquitin",
  name: "Ubiquitin",
  organism: "Homo sapiens",
  uniprot: "P0CG48",
  pdbId: "1UBQ",
  bmrbId: "6457",
  sequence,
  firstResidue: 1,
  description:
    "Human ubiquitin (76 aa). Assigned HNCA, HNCACB, HNCO and HN(CA)CO peak lists written from the BMRB 6457 shifts, with jitter, missing peaks and three broadened amides.",
  peakLists: lists.map(([experiment]) => ({ file: `peaklists/${experiment}.list`, experiment })),
  pdb: "1ubq.pdb",
};
fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
console.log(`wrote ${lists.length} peak lists for ${amides.size} amides to ${path.relative(root, listDir)}`);
