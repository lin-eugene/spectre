// Structure superposition (Kabsch/Horn quaternion method on Cα atoms of common residues)
// and NMR-ensemble statistics (per-residue Cα RMSF).
import type { PdbModel } from "@/lib/structure/pdb";

export type Vec3 = [number, number, number];

export interface Transform {
  R: number[]; // row-major 3x3
  t: Vec3;
}

export interface Superposition extends Transform {
  rmsd: number;
  n: number;
  /** RMSD over the best-fitting core (residues within the 80th-percentile deviation) */
  coreRmsd: number;
  coreN: number;
  /** residue-number offset applied to the mobile model (mobile resi + offset = target resi) */
  offset: number;
}

/** Jacobi eigen-decomposition of a symmetric n×n matrix; returns eigenvalues and column eigenvectors. */
function jacobi(a: number[][]): { values: number[]; vectors: number[][] } {
  const n = a.length;
  const A = a.map((r) => [...r]);
  const V: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => (i === j ? 1 : 0) as number));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] ** 2;
    if (off < 1e-18) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-20) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k][p];
          const akq = A[k][q];
          A[k][p] = c * akp - s * akq;
          A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k];
          const aqk = A[q][k];
          A[p][k] = c * apk - s * aqk;
          A[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p];
          const vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: A.map((r, i) => r[i]), vectors: V };
}

/** Optimal rigid transform taking `mobile` onto `target` (paired points). */
export function kabsch(mobile: Vec3[], target: Vec3[]): Transform & { rmsd: number } {
  const n = Math.min(mobile.length, target.length);
  const cm: Vec3 = [0, 0, 0];
  const ct: Vec3 = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      cm[k] += mobile[i][k] / n;
      ct[k] += target[i][k] / n;
    }
  }
  const S = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < n; i++) {
    const a = [mobile[i][0] - cm[0], mobile[i][1] - cm[1], mobile[i][2] - cm[2]];
    const b = [target[i][0] - ct[0], target[i][1] - ct[1], target[i][2] - ct[2]];
    for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) S[x][y] += a[x] * b[y];
  }
  const [[Sxx, Sxy, Sxz], [Syx, Syy, Syz], [Szx, Szy, Szz]] = S;
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ];
  const { values, vectors } = jacobi(N);
  let best = 0;
  for (let i = 1; i < 4; i++) if (values[i] > values[best]) best = i;
  const [w, x, y, z] = [vectors[0][best], vectors[1][best], vectors[2][best], vectors[3][best]];
  const R = [
    w * w + x * x - y * y - z * z,
    2 * (x * y - w * z),
    2 * (x * z + w * y),
    2 * (x * y + w * z),
    w * w - x * x + y * y - z * z,
    2 * (y * z - w * x),
    2 * (x * z - w * y),
    2 * (y * z + w * x),
    w * w - x * x - y * y + z * z,
  ];
  const t: Vec3 = [
    ct[0] - (R[0] * cm[0] + R[1] * cm[1] + R[2] * cm[2]),
    ct[1] - (R[3] * cm[0] + R[4] * cm[1] + R[5] * cm[2]),
    ct[2] - (R[6] * cm[0] + R[7] * cm[1] + R[8] * cm[2]),
  ];
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const p = apply({ R, t }, mobile[i]);
    ss += (p[0] - target[i][0]) ** 2 + (p[1] - target[i][1]) ** 2 + (p[2] - target[i][2]) ** 2;
  }
  return { R, t, rmsd: Math.sqrt(ss / Math.max(1, n)) };
}

export function apply(T: Transform, p: Vec3 | number[]): Vec3 {
  const { R, t } = T;
  return [R[0] * p[0] + R[1] * p[1] + R[2] * p[2] + t[0], R[3] * p[0] + R[4] * p[1] + R[5] * p[2] + t[1], R[6] * p[0] + R[7] * p[1] + R[8] * p[2] + t[2]];
}

/** Cα coordinates of the model's protein residues on one chain, keyed by residue number. */
export function caMap(model: PdbModel, chain?: string): Map<number, { xyz: Vec3; resn: string }> {
  const out = new Map<number, { xyz: Vec3; resn: string }>();
  const ch = chain ?? model.residues.find((r) => r.ca !== undefined && !model.atoms[r.ca].hetero)?.chain;
  for (const r of model.residues) {
    if (r.ca === undefined || r.chain !== ch) continue;
    const a = model.atoms[r.ca];
    if (a.hetero || out.has(r.resi)) continue;
    out.set(r.resi, { xyz: [a.x, a.y, a.z], resn: r.resn });
  }
  return out;
}

/**
 * Superpose `mobile` onto `target` using Cα atoms of common residue numbers. If numbering
 * differs (e.g. AlphaFold full-length numbering), the residue offset with the most identical
 * residue names is used instead.
 */
export function superposeOnto(mobile: PdbModel, target: PdbModel, targetChain?: string): Superposition | null {
  const tm = caMap(target, targetChain);
  const mm = caMap(mobile);
  if (tm.size < 3 || mm.size < 3) return null;
  const pairs = (offset: number) => {
    const a: Vec3[] = [];
    const b: Vec3[] = [];
    let same = 0;
    for (const [resi, m] of mm) {
      const t = tm.get(resi + offset);
      if (!t) continue;
      a.push(m.xyz);
      b.push(t.xyz);
      if (t.resn === m.resn) same++;
    }
    return { a, b, same };
  };
  let offset = 0;
  let best = pairs(0);
  const minCommon = Math.min(tm.size, mm.size);
  if (best.same < minCommon * 0.8) {
    const tKeys = [...tm.keys()];
    const mKeys = [...mm.keys()];
    const lo = Math.min(...tKeys) - Math.max(...mKeys);
    const hi = Math.max(...tKeys) - Math.min(...mKeys);
    for (let off = lo; off <= hi; off++) {
      const p = pairs(off);
      if (p.same > best.same || (p.same === best.same && off === 0)) {
        best = p;
        offset = off;
      }
    }
  }
  if (best.a.length < 3) return null;
  // two passes: fit everything, then refit on the well-superposed core (ignores floppy tails)
  let T = kabsch(best.a, best.b);
  const dev = best.a.map((p, i) => {
    const q = apply(T, p);
    return Math.hypot(q[0] - best.b[i][0], q[1] - best.b[i][1], q[2] - best.b[i][2]);
  });
  const sorted = [...dev].sort((x, y) => x - y);
  const cut = Math.max(2.0, sorted[Math.floor(sorted.length * 0.8)] ?? 2.0);
  const coreA = best.a.filter((_, i) => dev[i] <= cut);
  const coreB = best.b.filter((_, i) => dev[i] <= cut);
  let coreRmsd = T.rmsd;
  let coreN = best.a.length;
  if (coreA.length >= 3 && coreA.length < best.a.length) {
    const T2 = kabsch(coreA, coreB);
    // report RMSD over all common residues in the core frame
    let ss = 0;
    best.a.forEach((p, i) => {
      const q = apply(T2, p);
      ss += (q[0] - best.b[i][0]) ** 2 + (q[1] - best.b[i][1]) ** 2 + (q[2] - best.b[i][2]) ** 2;
    });
    T = { ...T2, rmsd: Math.sqrt(ss / best.a.length) };
    coreRmsd = T2.rmsd;
    coreN = coreA.length;
  }
  return { R: T.R, t: T.t, rmsd: T.rmsd, n: best.a.length, coreRmsd, coreN, offset };
}

/** New PdbModel with transformed coordinates (shares residue/bond topology). */
export function transformModel(model: PdbModel, T: Transform, offset = 0): PdbModel {
  const atoms = model.atoms.map((a) => {
    const [x, y, z] = apply(T, [a.x, a.y, a.z]);
    return { ...a, x, y, z, resi: a.resi + offset };
  });
  const residues = offset ? model.residues.map((r) => ({ ...r, resi: r.resi + offset, key: `${r.chain}:${r.resi + offset}` })) : model.residues;
  const center = apply(T, model.center);
  return { ...model, atoms, residues, center };
}

export interface EnsembleData {
  /** per model: Cα traces split at chain breaks, in the reference frame */
  traces: { resi: number[]; xyz: Vec3[] }[][];
  /** residue number -> Cα RMSF (Å) over the ensemble */
  rmsf: Map<number, number>;
  models: number;
  meanRmsf: number;
  maxRmsf: number;
}

/** Superpose every ensemble model onto `reference` and compute per-residue Cα RMSF. */
export function buildEnsemble(models: PdbModel[], reference: PdbModel, referenceChain?: string): EnsembleData | null {
  const traces: EnsembleData["traces"] = [];
  const perResidue = new Map<number, Vec3[]>();
  let used = 0;
  for (const m of models) {
    const sp = superposeOnto(m, reference, referenceChain);
    if (!sp) continue;
    used++;
    const ca = caMap(m);
    const segs: { resi: number[]; xyz: Vec3[] }[] = [];
    let cur: { resi: number[]; xyz: Vec3[] } | null = null;
    let prev: Vec3 | null = null;
    for (const [resi, { xyz }] of [...ca.entries()].sort((a, b) => a[0] - b[0])) {
      const p = apply(sp, xyz);
      if (!cur || !prev || Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]) > 4.3) {
        cur = { resi: [], xyz: [] };
        segs.push(cur);
      }
      cur.resi.push(resi + sp.offset);
      cur.xyz.push(p);
      prev = p;
      const list = perResidue.get(resi + sp.offset) ?? [];
      list.push(p);
      perResidue.set(resi + sp.offset, list);
    }
    traces.push(segs.filter((s) => s.xyz.length >= 2));
  }
  if (used < 2) return null;
  const rmsf = new Map<number, number>();
  let sum = 0;
  let max = 0;
  for (const [resi, pts] of perResidue) {
    if (pts.length < 2) continue;
    const m: Vec3 = [0, 0, 0];
    for (const p of pts) for (let k = 0; k < 3; k++) m[k] += p[k] / pts.length;
    let ss = 0;
    for (const p of pts) ss += (p[0] - m[0]) ** 2 + (p[1] - m[1]) ** 2 + (p[2] - m[2]) ** 2;
    const v = Math.sqrt(ss / pts.length);
    rmsf.set(resi, v);
    sum += v;
    max = Math.max(max, v);
  }
  return { traces, rmsf, models: used, meanRmsf: rmsf.size ? sum / rmsf.size : 0, maxRmsf: max };
}
