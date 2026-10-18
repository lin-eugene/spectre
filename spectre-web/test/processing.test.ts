import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { brukerDir } from "@/lib/project/demo";
import { deconvolve1D, finishSpectrum, parseBrukerParams, pickPeaks1D, prepareBruker, processBruker1D } from "@/lib/bruker";
import { readProcessed } from "@/lib/bruker/bruker";
import { fitPseudoVoigts, pseudoVoigt } from "@/lib/bruker/analysis";
import { fft } from "@/lib/bruker/fft";

// raw Bruker data is not bundled: these comparisons run when B81434 (with TopSpin's processed 1r
// next to its fid) is in the local Bruker directory, and are skipped otherwise
const DIR = path.join(brukerDir(), "B81434");
const hasData = fs.existsSync(`${DIR}/fid`) && fs.existsSync(`${DIR}/1r`);
const raw = () => ({
  acqus: fs.readFileSync(`${DIR}/acqus`, "utf8"),
  procs: fs.readFileSync(`${DIR}/procs`, "utf8"),
  title: fs.readFileSync(`${DIR}/title`, "utf8"),
  fid: new Uint8Array(fs.readFileSync(`${DIR}/fid`)),
});

function corr(a: ArrayLike<number>, b: ArrayLike<number>) {
  const n = Math.min(a.length, b.length);
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i], y = b[i];
    sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y;
  }
  const cov = sab / n - (sa / n) * (sb / n);
  return cov / Math.sqrt((saa / n - (sa / n) ** 2) * (sbb / n - (sb / n) ** 2));
}

/** indices of the k largest local maxima */
function topMaxima(y: ArrayLike<number>, k: number, minSep = 8): number[] {
  const c: number[] = [];
  for (let i = 1; i < y.length - 1; i++) if (y[i] >= y[i - 1] && y[i] > y[i + 1]) c.push(i);
  c.sort((a, b) => y[b] - y[a]);
  const out: number[] = [];
  for (const i of c) {
    if (out.some((j) => Math.abs(j - i) < minSep)) continue;
    out.push(i);
    if (out.length === k) break;
  }
  return out.sort((a, b) => a - b);
}

describe.skipIf(!hasData)("Bruker 1D processing vs TopSpin 3.7 (B81434: ef LB 0.3, SI 64k, apk, abs ABSG 5)", () => {
  const procs = hasData ? parseBrukerParams(fs.readFileSync(`${DIR}/procs`, "utf8")) : {};
  const ref = hasData ? readProcessed(new Uint8Array(fs.readFileSync(`${DIR}/1r`)), procs) : new Float64Array(0);

  it("reproduces the TopSpin real spectrum with the stored phases", () => {
    const t0 = performance.now();
    const spec = processBruker1D(raw(), { phase: "procs", baseline: "poly" });
    const ms = performance.now() - t0;
    const c = corr(spec.re, ref);
    const ours = topMaxima(spec.re, 25);
    const theirs = topMaxima(ref, 25);
    const offsets = theirs.map((i) => Math.min(...ours.map((j) => Math.abs(j - i))));
    console.log(
      JSON.stringify({ ms: Math.round(ms), si: spec.si, corr: Number(c.toFixed(6)), maxPeakOffsetPts: Math.max(...offsets), ph0: spec.ph0, ph1: spec.ph1, noise: spec.noise, peaks: spec.peaks.length, firstPpm: spec.ppm[0], lastPpm: spec.ppm[spec.ppm.length - 1] }),
    );
    expect(spec.re.length).toBe(ref.length);
    expect(c).toBeGreaterThan(0.99);
    expect(Math.max(...offsets)).toBeLessThanOrEqual(1);
    // axis: TopSpin OFFSET is the first point
    expect(spec.ppm[0]).toBeCloseTo(procs.OFFSET as number, 6);
  });

  it("automatic phasing lands close to TopSpin apk", () => {
    const t0 = performance.now();
    const prepared = prepareBruker(raw());
    const auto = finishSpectrum(prepared, { phase: "auto" });
    const ms = performance.now() - t0;
    const c = corr(auto.re, ref);
    console.log(JSON.stringify({ autophaseMs: Math.round(ms), ph0: Number(auto.ph0.toFixed(2)), ph1: Number(auto.ph1.toFixed(2)), procs: [procs.PHC0, procs.PHC1], corr: Number(c.toFixed(6)) }));
    expect(c).toBeGreaterThan(0.98);
  });

  it("picks peaks and deconvolves a region", () => {
    const spec = processBruker1D(raw(), { phase: "procs" });
    const peaks = pickPeaks1D(spec, { threshold: 20 });
    expect(peaks.length).toBeGreaterThan(3);
    const big = [...peaks].sort((a, b) => b.height - a.height)[0];
    const t0 = performance.now();
    const dec = deconvolve1D(spec, [big.ppm + 0.03, big.ppm - 0.03]);
    const ms = performance.now() - t0;
    const maxY = Math.max(...dec.ppm.map((_, k) => dec.fit[k]));
    console.log(JSON.stringify({ peaks: peaks.length, bigPpm: Number(big.ppm.toFixed(4)), components: dec.components.length, rmsRel: Number((dec.rms / maxY).toFixed(5)), iterations: dec.iterations, ms: Math.round(ms) }));
    expect(dec.components.length).toBeGreaterThan(0);
    expect(dec.rms / maxY).toBeLessThan(0.05);
    for (const c of dec.components) {
      expect(c.amplitude).toBeGreaterThanOrEqual(0);
      expect(c.widthHz).toBeLessThan(30);
    }
    // the CD3CN residual (CHD2CN) is a 1:2:3:2:1 quintet, J(H,D) ~ 2.5 Hz
    const strong = dec.components.filter((c) => c.amplitude > 0.05 * Math.max(...dec.components.map((q) => q.amplitude))).sort((a, b) => b.ppm - a.ppm);
    const spacingsHz = strong.slice(1).map((c, k) => (strong[k].ppm - c.ppm) * spec.sf);
    console.log(JSON.stringify({ quintetLines: strong.length, spacingsHz: spacingsHz.map((v) => Number(v.toFixed(2))) }));
  });
});

describe("synthetic checks", () => {
  it("axis convention: a synthetic FID lands at the expected ppm", () => {
    // 2 lines at +1000 Hz and -1500 Hz from the carrier; no digital filter
    const n = 8192;
    const sw = 8000;
    const sf = 400;
    const o1 = 2000; // Hz above BF1 -> carrier at 5 ppm
    const fidBytes = new Uint8Array(n * 2 * 4);
    const view = new DataView(fidBytes.buffer);
    for (let k = 0; k < n; k++) {
      const t = k / sw;
      let re = 0;
      let im = 0;
      for (const [f, a] of [[1000, 1], [-1500, 0.5]] as const) {
        re += a * Math.cos(2 * Math.PI * f * t) * Math.exp(-t * 5);
        im += a * Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 5);
      }
      view.setInt32(8 * k, Math.round(re * 1e6), true);
      view.setInt32(8 * k + 4, Math.round(im * 1e6), true);
    }
    const acqus = `##$TD= ${2 * n}\n##$SW_h= ${sw}\n##$BF1= ${sf}\n##$SFO1= ${sf + o1 * 1e-6}\n##$O1= ${o1}\n##$DTYPA= 0\n##$BYTORDA= 0\n##$NC= 0\n##$GRPDLY= 0\n##$DIGMOD= 0\n##$NUC1= <1H>\n`;
    const spec = processBruker1D({ acqus, fid: fidBytes }, { phase: { ph0: 0, ph1: 0 }, baseline: "none", lb: 1, si: 16384 });
    const peaks = [...spec.peaks].sort((a, b) => b.height - a.height).slice(0, 2).map((p) => p.ppm).sort((a, b) => b - a);
    console.log(JSON.stringify({ expected: [(o1 + 1000) / sf, (o1 - 1500) / sf], got: peaks }));
    expect(peaks[0]).toBeCloseTo((o1 + 1000) / sf, 2);
    expect(peaks[1]).toBeCloseTo((o1 - 1500) / sf, 2);
  });

  it("fft round trip", () => {
    const re = Float64Array.from({ length: 1024 }, (_, i) => Math.sin(i / 7) + (i % 5));
    const im = Float64Array.from({ length: 1024 }, (_, i) => Math.cos(i / 3));
    const r2 = Float64Array.from(re);
    const i2 = Float64Array.from(im);
    fft(r2, i2);
    fft(r2, i2, true);
    let err = 0;
    for (let i = 0; i < 1024; i++) err = Math.max(err, Math.abs(r2[i] - re[i]), Math.abs(i2[i] - im[i]));
    expect(err).toBeLessThan(1e-9);
  });

  it("deconvolution recovers two overlapping pseudo-Voigt lines", () => {
    const n = 600;
    const x = Float64Array.from({ length: n }, (_, i) => i * 0.1);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
    const y = Float64Array.from(x, (v) => pseudoVoigt(v, 28, 100, 3, 0.8) + pseudoVoigt(v, 31.5, 60, 2.5, 0.6) + rnd() * 0.5);
    const fit = fitPseudoVoigts(x, y, [[27, 90, 4, 0.5], [32, 50, 2, 0.5]], [0, 59.9]);
    const [a, b] = fit.comps.sort((p, q) => p[0] - q[0]);
    expect(a[0]).toBeCloseTo(28, 1);
    expect(b[0]).toBeCloseTo(31.5, 1);
    expect(a[1]).toBeCloseTo(100, -1);
    expect(a[2]).toBeCloseTo(3, 0);
  });
});
