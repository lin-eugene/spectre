// One- and three-letter amino-acid codes and names.
export const P1TO3: Record<string, string> = {
  A: "ALA", C: "CYS", D: "ASP", E: "GLU", F: "PHE", G: "GLY", H: "HIS", I: "ILE", K: "LYS", L: "LEU",
  M: "MET", N: "ASN", P: "PRO", Q: "GLN", R: "ARG", S: "SER", T: "THR", V: "VAL", W: "TRP", Y: "TYR",
};
export const P3TO1: Record<string, string> = Object.fromEntries(Object.entries(P1TO3).map(([a, b]) => [b, a]));

export const RESIDUE_NAMES: Record<string, string> = {
  A: "Alanine", C: "Cysteine", D: "Aspartate", E: "Glutamate", F: "Phenylalanine", G: "Glycine",
  H: "Histidine", I: "Isoleucine", K: "Lysine", L: "Leucine", M: "Methionine", N: "Asparagine",
  P: "Proline", Q: "Glutamine", R: "Arginine", S: "Serine", T: "Threonine", V: "Valine",
  W: "Tryptophan", Y: "Tyrosine",
};
