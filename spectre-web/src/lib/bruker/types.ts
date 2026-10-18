// Contract for raw-data processing (Bruker parameter parsing, nmrPipe-style processing, noise
// estimation, peak picking and lineshape deconvolution).
// Implementation lives in ./index.ts and must be isomorphic (no node:fs) so it runs in the
// browser for interactive phasing and on the server for agent tools.

export interface BrukerRaw {
  acqus: string;
  procs?: string;
  title?: string;
  fid: Uint8Array;
}

export interface ProcessOptions {
  /** exponential line broadening (Hz); default from procs LB or 0.3 */
  lb?: number;
  /** window function */
  window?: "em" | "gm" | "sine" | "none";
  /** number of points after zero filling (power of two); default procs SI or 2*TD */
  si?: number;
  /** 'procs' uses PHC0/PHC1 stored by TopSpin; 'auto' runs automatic phasing */
  phase?: "procs" | "auto" | { ph0: number; ph1: number };
  /** baseline correction */
  baseline?: "none" | "poly";
  /** polynomial order for baseline correction */
  baselineOrder?: number;
}

export interface Peak1D {
  ppm: number;
  height: number;
  index: number;
  widthHz?: number;
  integral?: number;
}

export interface Processed1D {
  title: string;
  nucleus: string; // e.g. "1H"
  solvent: string;
  pulseProgram: string;
  sf: number; // spectrometer frequency (MHz) of the reference axis
  swHz: number;
  si: number;
  ph0: number;
  ph1: number;
  noise: number;
  /** ppm axis, descending (left to right) */
  ppm: number[];
  /** real spectrum after phasing/baseline */
  re: number[];
  peaks: Peak1D[];
  options: Required<Pick<ProcessOptions, "lb" | "window" | "si" | "baseline">> & { phase: string };
}

export interface DeconComponent {
  ppm: number;
  amplitude: number;
  widthHz: number; // FWHM
  eta: number; // Lorentz/Gauss mixing (1 = Lorentzian)
  area: number;
}

export interface DeconResult {
  region: [number, number];
  components: DeconComponent[];
  fit: number[]; // model over region
  residual: number[];
  ppm: number[]; // axis of region
  rms: number;
  iterations: number;
}
