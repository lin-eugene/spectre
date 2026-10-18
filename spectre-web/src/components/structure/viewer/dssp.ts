// Simplified DSSP (Kabsch & Sander 1983) for models without HELIX/SHEET records (AlphaFold,
// CYANA/ARTINA output): electrostatic backbone H-bonds -> α/3₁₀ helices and β-ladders.
import type { PdbModel, PdbResidue } from "@/lib/structure/pdb";

type V = [number, number, number];

interface BB {
  ri: number; // index into model.residues
  N: V;
  CA: V;
  C: V;
  O: V;
  H: V | null;
}

const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dist = (a: V, b: V) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function atom(model: PdbModel, r: PdbResidue, name: string): V | null {
  for (const i of r.atoms) {
    const a = model.atoms[i];
    if (a.name === name) return [a.x, a.y, a.z];
  }
  return null;
}

/** H-bond energy (kcal/mol) for C=O of `acc` and N-H of `don`. */
function hbondEnergy(acc: BB, don: BB): number {
  if (!don.H) return 0;
  const rON = dist(acc.O, don.N);
  const rCH = dist(acc.C, don.H);
  const rOH = dist(acc.O, don.H);
  const rCN = dist(acc.C, don.N);
  if (rON < 0.5 || rCH < 0.5 || rOH < 0.5 || rCN < 0.5) return -9.9;
  return 0.084 * 332 * (1 / rON + 1 / rCH - 1 / rOH - 1 / rCN);
}

/** Secondary structure per residue index ('H', 'E' or 'C'). */
export function computeSecondaryStructure(model: PdbModel): ("H" | "E" | "C")[] {
  const out: ("H" | "E" | "C")[] = model.residues.map(() => "C");
  // continuous backbone segments
  const bb: BB[] = [];
  const chainBreak: boolean[] = [];
  let prev: BB | null = null;
  let prevChain = "";
  model.residues.forEach((r, ri) => {
    if (r.ca === undefined || model.atoms[r.ca].hetero) return;
    const N = atom(model, r, "N");
    const CA = atom(model, r, "CA");
    const C = atom(model, r, "C");
    const O = atom(model, r, "O") ?? atom(model, r, "OT1");
    if (!N || !CA || !C || !O) return;
    const broken = !prev || prevChain !== r.chain || dist(prev.C, N) > 2.0;
    let H: V | null = null;
    if (!broken && prev && r.resn !== "PRO") {
      const d = sub(prev.C, prev.O);
      const l = Math.hypot(d[0], d[1], d[2]) || 1;
      H = [N[0] + d[0] / l, N[1] + d[1] / l, N[2] + d[2] / l];
    }
    const e: BB = { ri, N, CA, C, O, H };
    bb.push(e);
    chainBreak.push(broken);
    prev = e;
    prevChain = r.chain;
  });
  const n = bb.length;
  if (n < 4) return out;
  // neighbour search on a coarse grid (CA within 9 Å)
  const cell = 9;
  const grid = new Map<string, number[]>();
  const key = (p: V) => `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)},${Math.floor(p[2] / cell)}`;
  bb.forEach((b, i) => {
    const k = key(b.CA);
    const list = grid.get(k) ?? [];
    list.push(i);
    grid.set(k, list);
  });
  // hb[acc] = set of donors j with C=O(acc)···H-N(j)
  const hb: Set<number>[] = bb.map(() => new Set<number>());
  for (let i = 0; i < n; i++) {
    const [gx, gy, gz] = [Math.floor(bb[i].CA[0] / cell), Math.floor(bb[i].CA[1] / cell), Math.floor(bb[i].CA[2] / cell)];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          for (const j of grid.get(`${gx + dx},${gy + dy},${gz + dz}`) ?? []) {
            if (Math.abs(i - j) < 2 && !(Math.abs(i - j) === 1 && chainBreak[Math.max(i, j)])) continue;
            if (i === j) continue;
            if (dist(bb[i].CA, bb[j].CA) > 9) continue;
            if (hbondEnergy(bb[i], bb[j]) < -0.5) hb[i].add(j);
          }
        }
  }
  const H = (acc: number, don: number) => acc >= 0 && don >= 0 && acc < n && don < n && hb[acc].has(don);
  const contiguous = (a: number, b: number) => {
    for (let k = Math.min(a, b) + 1; k <= Math.max(a, b); k++) if (chainBreak[k]) return false;
    return true;
  };
  const ss: ("H" | "E" | "C")[] = bb.map(() => "C");
  // helices: two consecutive n-turns (n = 4 alpha, n = 3 for 3-10)
  for (const turn of [4, 3]) {
    for (let i = 1; i + turn < n; i++) {
      if (H(i - 1, i - 1 + turn) && H(i, i + turn) && contiguous(i - 1, i + turn)) {
        for (let k = i; k < i + turn; k++) if (ss[k] === "C") ss[k] = "H";
      }
    }
  }
  // beta bridges
  const bridge = new Array<boolean>(n).fill(false);
  for (let i = 1; i < n - 1; i++) {
    for (let j = 1; j < n - 1; j++) {
      if (Math.abs(i - j) < 3) continue;
      const parallel = (H(i - 1, j) && H(j, i + 1)) || (H(j - 1, i) && H(i, j + 1));
      const anti = (H(i, j) && H(j, i)) || (H(i - 1, j + 1) && H(j - 1, i + 1));
      if (parallel || anti) {
        bridge[i] = true;
        bridge[j] = true;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    if (!bridge[i] || ss[i] === "H") continue;
    const nb = (i > 0 && bridge[i - 1] && !chainBreak[i]) || (i < n - 1 && bridge[i + 1] && !chainBreak[i + 1]);
    if (nb) ss[i] = "E";
  }
  // fill single-residue gaps inside ladders (β-bulges)
  for (let i = 1; i < n - 1; i++) if (ss[i] === "C" && ss[i - 1] === "E" && ss[i + 1] === "E" && !chainBreak[i] && !chainBreak[i + 1]) ss[i] = "E";
  bb.forEach((b, k) => (out[b.ri] = ss[k]));
  return out;
}

/** Return the model with residues[].ss filled from DSSP when the file had no HELIX/SHEET records. */
export function withSecondaryStructure(model: PdbModel): PdbModel {
  if (model.helices.length || model.sheets.length) return model;
  const ss = computeSecondaryStructure(model);
  return { ...model, residues: model.residues.map((r, i) => ({ ...r, ss: ss[i] })) };
}
