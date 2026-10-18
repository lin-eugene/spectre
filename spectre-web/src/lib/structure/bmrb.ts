// Expected chemical shifts from the BMRB statistics (bmrb-stats.ts): mean and standard deviation
// for an atom of a residue type, by PDB atom name.
import { BMRB_STATS } from "./bmrb-stats";

/** [mean, sd] (ppm) of a PDB atom of a residue (three-letter code), if the BMRB has statistics for it. */
export function bmrbExpected(resn3: string, atomName: string): [number, number] | undefined {
  const atoms = BMRB_STATS[resn3.toUpperCase()];
  if (!atoms) return undefined;
  const name = atomName === "HN" ? "H" : atomName;
  // methyl protons are reported per group (pseudo-atom): HD11 → MD1, HB1 (Ala) → MB, HE1 (Met) → ME
  return atoms[name] ?? (/^H[A-Z]\d*\d$/.test(name) ? atoms[`M${name.slice(1, -1)}`] : undefined);
}
