// Peak records shared by the spectrum views: 3D peaks with f1 = 1H, f2 = 15N, f3 = the third
// (carbon) dimension, and 2D peaks.

export interface RawPeak3D {
  name: string;
  f1: number;
  f2: number;
  f3: number;
  inty: number;
}

export interface RawPeak2D {
  name: string;
  x: number; // 1H (or direct)
  y: number; // 15N/13C (indirect)
  inty: number;
}
