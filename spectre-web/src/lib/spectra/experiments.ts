/** Triple-resonance spectrum types of the app (the uploadable experiment types map onto these), with the correlations they show. */
export const EXPERIMENTS: Record<string, { label: string; carbon: string; description: string; window: [number, number] }> = {
  hnco: { label: "HNCO", carbon: "13C'", description: "CO(i-1)", window: [168, 182] },
  hncaco: { label: "HN(CA)CO", carbon: "13C'", description: "CO(i), CO(i-1)", window: [168, 182] },
  hnca: { label: "HNCA", carbon: "13Cα", description: "CA(i), CA(i-1)", window: [40, 70] },
  hncoca: { label: "HN(CO)CA", carbon: "13Cα", description: "CA(i-1)", window: [40, 70] },
  hncacb: { label: "HNCACB", carbon: "13Cα/β", description: "CA/CB(i) and (i-1), opposite signs", window: [10, 76] },
  hncocacb: { label: "CBCA(CO)NH", carbon: "13Cα/β", description: "CA/CB(i-1)", window: [10, 76] },
};
