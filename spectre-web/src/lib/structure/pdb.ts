// Minimal PDB reader shared by the structure viewer and the structure-based analyses.
// Reads ATOM/HETATM, HELIX/SHEET records and derives covalent bonds by distance.

export interface PdbAtom {
  index: number; // 0-based index in atoms[]
  serial: number;
  name: string; // e.g. "CA", "HD11"
  altLoc: string;
  resn: string; // three-letter
  chain: string;
  resi: number;
  x: number;
  y: number;
  z: number;
  b: number;
  element: string; // "C", "N", "O", "S", "H"
  hetero: boolean;
}

export interface PdbResidue {
  key: string; // chain:resi
  chain: string;
  resi: number;
  resn: string;
  atoms: number[]; // indices into atoms
  ca?: number;
  ss: "H" | "E" | "C";
}

export interface PdbModel {
  id: string;
  title: string;
  atoms: PdbAtom[];
  residues: PdbResidue[];
  bonds: [number, number][];
  helices: { chain: string; start: number; end: number }[];
  sheets: { chain: string; start: number; end: number }[];
  center: [number, number, number];
  radius: number;
}

const COVALENT: Record<string, number> = { H: 0.31, C: 0.76, N: 0.71, O: 0.66, S: 1.05, P: 1.07, SE: 1.2 };

function elementOf(line: string, name: string): string {
  const e = line.length >= 78 ? line.slice(76, 78).trim() : "";
  if (e) return e.toUpperCase();
  const n = name.replace(/[^A-Za-z]/g, "");
  if (/^(CL|BR|FE|ZN|MG|NA|SE)/i.test(n) && name.length === 4 && name[0] !== " ") return n.slice(0, 2).toUpperCase();
  return n.slice(0, 1).toUpperCase();
}

export function parsePdb(text: string, id = ""): PdbModel {
  const atoms: PdbAtom[] = [];
  const helices: PdbModel["helices"] = [];
  const sheets: PdbModel["sheets"] = [];
  let title = "";
  let modelSeen = false;
  for (const line of text.split(/\r?\n/)) {
    const rec = line.slice(0, 6);
    if (rec === "MODEL ") {
      if (modelSeen) break; // first model only
      modelSeen = true;
      continue;
    }
    if (rec === "ENDMDL") break;
    if (rec === "TITLE ") title += line.slice(10).trim() + " ";
    if (rec === "HELIX ") {
      helices.push({ chain: line[19], start: parseInt(line.slice(21, 25), 10), end: parseInt(line.slice(33, 37), 10) });
    } else if (rec === "SHEET ") {
      sheets.push({ chain: line[21], start: parseInt(line.slice(22, 26), 10), end: parseInt(line.slice(33, 37), 10) });
    } else if (rec === "ATOM  " || rec === "HETATM") {
      const name = line.slice(12, 16).trim();
      const altLoc = line[16]?.trim() ?? "";
      if (altLoc && altLoc !== "A") continue;
      const resn = line.slice(17, 20).trim();
      if (rec === "HETATM" && resn === "HOH") continue;
      atoms.push({
        index: atoms.length,
        serial: parseInt(line.slice(6, 11), 10),
        name,
        altLoc,
        resn,
        chain: line[21]?.trim() || "A",
        resi: parseInt(line.slice(22, 26), 10),
        x: parseFloat(line.slice(30, 38)),
        y: parseFloat(line.slice(38, 46)),
        z: parseFloat(line.slice(46, 54)),
        b: parseFloat(line.slice(60, 66)) || 0,
        element: elementOf(line, line.slice(12, 16)),
        hetero: rec === "HETATM",
      });
    }
  }
  const residues: PdbResidue[] = [];
  const byKey = new Map<string, PdbResidue>();
  for (const a of atoms) {
    const key = `${a.chain}:${a.resi}`;
    let r = byKey.get(key);
    if (!r) {
      r = { key, chain: a.chain, resi: a.resi, resn: a.resn, atoms: [], ss: "C" };
      byKey.set(key, r);
      residues.push(r);
    }
    r.atoms.push(a.index);
    if (a.name === "CA" && !a.hetero) r.ca = a.index;
  }
  for (const r of residues) {
    if (helices.some((h) => h.chain === r.chain && r.resi >= h.start && r.resi <= h.end)) r.ss = "H";
    else if (sheets.some((s) => s.chain === r.chain && r.resi >= s.start && r.resi <= s.end)) r.ss = "E";
  }
  // bonds: covalent radii within residue, plus peptide C(i)-N(i+1)
  const bonds: [number, number][] = [];
  for (const r of residues) {
    const idx = r.atoms;
    for (let i = 0; i < idx.length; i++) {
      for (let j = i + 1; j < idx.length; j++) {
        const a = atoms[idx[i]];
        const b = atoms[idx[j]];
        const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
        const lim = (COVALENT[a.element] ?? 0.8) + (COVALENT[b.element] ?? 0.8) + 0.45;
        if (d > 0.4 && d < lim) bonds.push([a.index, b.index]);
      }
    }
  }
  for (let k = 1; k < residues.length; k++) {
    const p = residues[k - 1];
    const r = residues[k];
    if (p.chain !== r.chain) continue;
    const c = p.atoms.find((i) => atoms[i].name === "C");
    const n = r.atoms.find((i) => atoms[i].name === "N");
    if (c === undefined || n === undefined) continue;
    const a = atoms[c];
    const b = atoms[n];
    if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1.8) bonds.push([c, n]);
  }
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const a of atoms) {
    cx += a.x;
    cy += a.y;
    cz += a.z;
  }
  const n = Math.max(1, atoms.length);
  const center: [number, number, number] = [cx / n, cy / n, cz / n];
  let radius = 0;
  for (const a of atoms) radius = Math.max(radius, Math.hypot(a.x - center[0], a.y - center[1], a.z - center[2]));
  return { id, title: title.trim(), atoms, residues, bonds, helices, sheets, center, radius };
}

/** Distance between two atoms. */
export function atomDistance(a: PdbAtom, b: PdbAtom): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Number of MODEL records (1 for single-model files). */
export function countPdbModels(text: string): number {
  const m = text.match(/^MODEL /gm);
  return m ? m.length : 1;
}

/**
 * Parse every MODEL of a multi-model PDB file (NMR ensembles). Header records before the
 * first MODEL (TITLE, HELIX, SHEET) are shared by all models. Single-model files give one entry.
 */
export function parsePdbModels(text: string, id = ""): PdbModel[] {
  const header: string[] = [];
  const blocks: string[][] = [];
  let cur: string[] | null = null;
  for (const line of text.split(/\r?\n/)) {
    const rec = line.slice(0, 6);
    if (rec === "MODEL ") {
      cur = [];
      blocks.push(cur);
      continue;
    }
    if (rec === "ENDMDL") {
      cur = null;
      continue;
    }
    if (cur) cur.push(line);
    else if (!blocks.length && /^(HEADER|TITLE |HELIX |SHEET )/.test(line)) header.push(line);
  }
  if (!blocks.length) return [parsePdb(text, id)];
  const head = header.join("\n");
  return blocks.map((b, k) => parsePdb(`${head}\n${b.join("\n")}`, id ? `${id}:${k + 1}` : String(k + 1)));
}
