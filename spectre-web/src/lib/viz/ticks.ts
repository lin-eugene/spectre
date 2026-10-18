// "Nice" tick generation (d3-array style) for ppm and residue axes.

export function tickStep(lo: number, hi: number, count: number): number {
  const span = Math.abs(hi - lo);
  if (!(span > 0)) return 1;
  const raw = span / Math.max(1, count);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const err = raw / pow;
  const mult = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
  return mult * pow;
}

export function niceTicks(a: number, b: number, count = 6): number[] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const step = tickStep(lo, hi, count);
  const start = Math.ceil(lo / step - 1e-9) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

export function decimalsFor(step: number): number {
  if (step >= 1) return 0;
  return Math.min(4, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));
}

export function formatTick(v: number, step: number): string {
  return v.toFixed(decimalsFor(step));
}
