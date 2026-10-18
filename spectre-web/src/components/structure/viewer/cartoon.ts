// Cartoon (ribbon) geometry: a centripetal Catmull-Rom spline through Cα atoms swept with a
// superellipse cross-section whose orientation follows the peptide carbonyls. Helices are
// wide rounded ribbons, strands flat sheets ending in arrowheads, coils thin tubes.
import * as THREE from "three";
import type { PdbModel } from "@/lib/structure/pdb";

export interface CartoonBuild {
  geometry: THREE.BufferGeometry;
  /** ring -> residue index into model.residues */
  ringResidue: Int32Array;
  /** ring centre positions (xyz) used for hover picking */
  ringCenters: Float32Array;
  /** half of the larger cross-section dimension per ring */
  ringHalfWidth: Float32Array;
  /** vertex -> ring, so colours can be updated per residue */
  vertexRing: Int32Array;
  ringCount: number;
}

interface Dims {
  w: number;
  h: number;
  p: number; // superellipse exponent
}

const HELIX: Dims = { w: 2.15, h: 0.38, p: 2.6 };
const STRAND: Dims = { w: 1.9, h: 0.46, p: 4.0 };
const COIL: Dims = { w: 0.52, h: 0.52, p: 2.0 };
const ARROW_W = 3.2;
const ARROW_TIP = 0.32;

function dimsFor(ss: "H" | "E" | "C"): Dims {
  return ss === "H" ? HELIX : ss === "E" ? STRAND : COIL;
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
const mixDims = (a: Dims, b: Dims, t: number): Dims => ({ w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t), p: lerp(a.p, b.p, t) });

/** Split protein residues into continuous chain segments of residue indices. */
export function backboneSegments(model: PdbModel): number[][] {
  const segs: number[][] = [];
  let cur: number[] = [];
  let prev: { chain: string; ca: THREE.Vector3 } | null = null;
  model.residues.forEach((r, i) => {
    if (r.ca === undefined) return;
    const a = model.atoms[r.ca];
    if (a.hetero) return;
    const ca = new THREE.Vector3(a.x, a.y, a.z);
    if (prev && (prev.chain !== r.chain || prev.ca.distanceTo(ca) > 4.3)) {
      if (cur.length) segs.push(cur);
      cur = [];
    }
    cur.push(i);
    prev = { chain: r.chain, ca };
  });
  if (cur.length) segs.push(cur);
  return segs.filter((s) => s.length >= 2);
}

export function buildCartoon(model: PdbModel, opts: { subdiv?: number; radial?: number } = {}): CartoonBuild {
  const nres = model.residues.length;
  const S = opts.subdiv ?? (nres > 3000 ? 4 : nres > 1000 ? 6 : 10);
  const K = opts.radial ?? (nres > 3000 ? 8 : 16);
  const segs = backboneSegments(model);

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const vertexRing: number[] = [];
  const ringResidue: number[] = [];
  const ringCenters: number[] = [];
  const ringHalfWidth: number[] = [];
  const ringBase: number[] = [];

  const tmp = new THREE.Vector3();
  for (const seg of segs) {
    const n = seg.length;
    const P = seg.map((ri) => {
      const a = model.atoms[model.residues[ri].ca!];
      return new THREE.Vector3(a.x, a.y, a.z);
    });
    const ss = seg.map((ri) => model.residues[ri].ss);
    // strands shorter than 2 residues are drawn as coil
    for (let i = 0; i < n; i++) {
      if (ss[i] !== "E") continue;
      const prevE = i > 0 && ss[i - 1] === "E";
      const nextE = i < n - 1 && ss[i + 1] === "E";
      if (!prevE && !nextE) ss[i] = "C";
    }
    // guide normals from carbonyl oxygens
    const guides: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const t = new THREE.Vector3().subVectors(P[Math.min(n - 1, i + 1)], P[Math.max(0, i - 1)]).normalize();
      const r = model.residues[seg[i]];
      const oIdx = r.atoms.find((k) => model.atoms[k].name === "O" || model.atoms[k].name === "OT1");
      let g: THREE.Vector3;
      if (oIdx !== undefined) {
        const o = model.atoms[oIdx];
        g = new THREE.Vector3(o.x, o.y, o.z).sub(P[i]);
      } else g = i > 0 ? guides[i - 1].clone() : new THREE.Vector3(0, 1, 0);
      g.addScaledVector(t, -g.dot(t));
      if (g.lengthSq() < 1e-6) {
        g = Math.abs(t.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
        g.addScaledVector(t, -g.dot(t));
      }
      g.normalize();
      if (i > 0 && g.dot(guides[i - 1]) < 0) g.negate();
      guides.push(g);
    }
    // smooth strand guides so sheets do not wobble
    const smoothed = guides.map((g, i) => {
      if (ss[i] !== "E") return g.clone();
      const v = g.clone().multiplyScalar(2);
      if (i > 0) v.add(guides[i - 1]);
      if (i < n - 1) v.add(guides[i + 1]);
      return v.normalize();
    });

    const curve = new THREE.CatmullRomCurve3(P, false, "centripetal");
    const ringStart = ringResidue.length;
    const total = (n - 1) * S + 1;
    for (let k = 0; k < total; k++) {
      const s = k / S; // residue coordinate
      const i = Math.min(n - 2, Math.floor(s));
      const f = s - i;
      const t = Math.min(1, s / (n - 1));
      const c = curve.getPoint(t);
      const tan = curve.getTangent(Math.min(0.9999, Math.max(0.0001, t))).normalize();
      const nrm = new THREE.Vector3().copy(smoothed[i]).lerp(smoothed[i + 1], f);
      nrm.addScaledVector(tan, -nrm.dot(tan));
      if (nrm.lengthSq() < 1e-8) nrm.copy(smoothed[i]);
      nrm.normalize();
      const bin = new THREE.Vector3().crossVectors(tan, nrm).normalize();

      // cross-section dimensions with transitions and arrowheads
      const a = ss[i];
      const b = ss[i + 1];
      let d: Dims;
      const strandEndAtNext = b === "E" && (i + 1 === n - 1 || ss[i + 2] !== "E");
      if (a === "E" && strandEndAtNext) {
        d = { w: lerp(ARROW_W, ARROW_TIP, f), h: STRAND.h, p: STRAND.p };
      } else if (a === "E" && b !== "E") {
        d = mixDims({ w: ARROW_TIP, h: STRAND.h, p: STRAND.p }, dimsFor(b), smooth(f));
      } else if (a !== b) {
        d = mixDims(dimsFor(a), dimsFor(b), smooth(f));
      } else d = dimsFor(a);
      if (k === total - 1 && a === "E" && b === "E") d = { w: ARROW_TIP, h: STRAND.h, p: STRAND.p };

      const ring = ringResidue.length;
      ringBase.push(positions.length / 3);
      ringResidue.push(seg[Math.min(n - 1, Math.round(s))]);
      ringCenters.push(c.x, c.y, c.z);
      ringHalfWidth.push(Math.max(d.w, d.h) / 2);

      // superellipse profile in (nrm, bin) plane
      const prof: [number, number][] = [];
      const e = 2 / d.p;
      for (let j = 0; j < K; j++) {
        const th = (j / K) * Math.PI * 2;
        const ct = Math.cos(th);
        const st = Math.sin(th);
        prof.push([(d.w / 2) * Math.sign(ct) * Math.abs(ct) ** e, (d.h / 2) * Math.sign(st) * Math.abs(st) ** e]);
      }
      for (let j = 0; j < K; j++) {
        const p0 = prof[(j + K - 1) % K];
        const p1 = prof[(j + 1) % K];
        let nx = p1[1] - p0[1];
        let ny = -(p1[0] - p0[0]);
        const len = Math.hypot(nx, ny) || 1;
        nx /= len;
        ny /= len;
        // ensure outward
        if (nx * prof[j][0] + ny * prof[j][1] < 0) {
          nx = -nx;
          ny = -ny;
        }
        tmp.copy(c).addScaledVector(nrm, prof[j][0]).addScaledVector(bin, prof[j][1]);
        positions.push(tmp.x, tmp.y, tmp.z);
        const vn = new THREE.Vector3().addScaledVector(nrm, nx).addScaledVector(bin, ny).normalize();
        normals.push(vn.x, vn.y, vn.z);
        vertexRing.push(ring);
      }
    }
    // tube faces
    for (let r = 0; r < total - 1; r++) {
      const base0 = ringBase[ringStart + r];
      const base1 = ringBase[ringStart + r + 1];
      for (let j = 0; j < K; j++) {
        const j1 = (j + 1) % K;
        // counter-clockwise seen from outside (outward-facing triangles)
        indices.push(base0 + j, base0 + j1, base1 + j);
        indices.push(base0 + j1, base1 + j1, base1 + j);
      }
    }
    // end caps
    const addCap = (r: number, sign: number) => {
      const ring = ringStart + r;
      const cx = ringCenters[ring * 3];
      const cy = ringCenters[ring * 3 + 1];
      const cz = ringCenters[ring * 3 + 2];
      const t = curve.getTangent(r === 0 ? 0.0001 : 0.9999).normalize().multiplyScalar(sign);
      const centre = positions.length / 3;
      positions.push(cx, cy, cz);
      normals.push(t.x, t.y, t.z);
      vertexRing.push(ring);
      const rim = positions.length / 3;
      for (let j = 0; j < K; j++) {
        const v = ringBase[ring] + j;
        positions.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
        normals.push(t.x, t.y, t.z);
        vertexRing.push(ring);
      }
      for (let j = 0; j < K; j++) {
        const j1 = (j + 1) % K;
        if (sign < 0) indices.push(centre, rim + j1, rim + j);
        else indices.push(centre, rim + j, rim + j1);
      }
    };
    addCap(0, -1);
    addCap(total - 1, 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(positions.length), 3));
  geometry.setIndex(positions.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(indices, 1) : new THREE.Uint16BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return {
    geometry,
    ringResidue: Int32Array.from(ringResidue),
    ringCenters: Float32Array.from(ringCenters),
    ringHalfWidth: Float32Array.from(ringHalfWidth),
    vertexRing: Int32Array.from(vertexRing),
    ringCount: ringResidue.length,
  };
}

/** Write per-residue linear RGB colours (3 floats per residue) into the cartoon. */
export function paintCartoon(build: CartoonBuild, residueRgb: Float32Array) {
  const attr = build.geometry.getAttribute("color") as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  for (let v = 0; v < build.vertexRing.length; v++) {
    const r = build.ringResidue[build.vertexRing[v]];
    arr[v * 3] = residueRgb[r * 3];
    arr[v * 3 + 1] = residueRgb[r * 3 + 1];
    arr[v * 3 + 2] = residueRgb[r * 3 + 2];
  }
  attr.needsUpdate = true;
}
