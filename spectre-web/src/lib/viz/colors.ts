// Colour roles for the spectrum panel (dataviz method: sequential = one hue light→dark,
// polarity = two opposite hues, chrome = recessive greys). Intensity uses a green ramp
// as a nod to the AlphaFold PAE panel this view replaces; the negative phase of
// HNCACB-type spectra uses violet (green/violet pair validated for CVD in both modes).
// Values were checked with the dataviz validator (monotone lightness, single hue).

export type Rgb = [number, number, number];

/** Sequential intensity ramp, low → high, light surface. */
export const GREEN_LIGHT = ["#eef8ec", "#c7e7c2", "#9fd59a", "#6fbe70", "#3fa253", "#1f8a3e", "#146b30", "#0d4f23"];
/** Same hue stepped for the dark surface: low sits near the surface, high is bright. */
export const GREEN_DARK = ["#18261b", "#1c3a22", "#22552b", "#2c7337", "#3a9447", "#5bb466", "#8fd197", "#c6ecc9"];
/** Negative phase ramp, low → high magnitude. */
export const VIOLET_LIGHT = ["#efedfc", "#d9d4f7", "#b9b0f0", "#978ae7", "#7666dd", "#5a48c9", "#4433a6", "#2f2378"];
export const VIOLET_DARK = ["#1d1b29", "#2a2547", "#3a3168", "#4d408c", "#6455b3", "#8174d8", "#a59bea", "#cdc7f6"];

/** Line colours for the positive / negative phases (validated pair). */
export const PHASE = {
  light: { pos: "#1f8a3e", neg: "#6250d6" },
  dark: { pos: "#3fae5a", neg: "#9085e9" },
};

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  const v =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

export function rgbToCss([r, g, b]: Rgb, a = 1): string {
  return a >= 1 ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${a.toFixed(3)})`;
}

// --- OKLab interpolation keeps the ramp perceptually even between the named steps.
const toLin = (c: number) => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const fromLin = (x: number) => {
  const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(Math.max(0, x), 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
};
function rgbToOklab([r, g, b]: Rgb): Rgb {
  const R = toLin(r);
  const G = toLin(g);
  const B = toLin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function oklabToRgb([L, a, b]: Rgb): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    fromLin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLin(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

export interface Ramp {
  /** 256-entry lookup of RGB triplets */
  lut: Uint8Array;
  stops: string[];
}

export function makeRamp(stops: string[]): Ramp {
  const labs = stops.map((s) => rgbToOklab(hexToRgb(s)));
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * (labs.length - 1);
    const k = Math.min(labs.length - 2, Math.floor(t));
    const f = t - k;
    const a = labs[k];
    const b = labs[k + 1];
    const rgb = oklabToRgb([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
    lut[i * 3] = rgb[0];
    lut[i * 3 + 1] = rgb[1];
    lut[i * 3 + 2] = rgb[2];
  }
  return { lut, stops };
}

export function rampAt(ramp: Ramp, t: number): Rgb {
  const i = Math.max(0, Math.min(255, Math.round(t * 255))) * 3;
  return [ramp.lut[i], ramp.lut[i + 1], ramp.lut[i + 2]];
}

const cache = new Map<string, Ramp>();
export function ramp(name: "green" | "violet", dark: boolean): Ramp {
  const key = `${name}:${dark}`;
  let r = cache.get(key);
  if (!r) {
    r = makeRamp(name === "green" ? (dark ? GREEN_DARK : GREEN_LIGHT) : dark ? VIOLET_DARK : VIOLET_LIGHT);
    cache.set(key, r);
  }
  return r;
}

/** Chart chrome tokens resolved from CSS custom properties on the panel root. */
export interface Tokens {
  dark: boolean;
  surface: string;
  ink: string;
  ink2: string;
  muted: string;
  grid: string;
  axis: string;
  border: string;
  accent: string;
  font: string;
}

export function readTokens(el: Element | null): Tokens {
  const fallback: Tokens = {
    dark: false,
    surface: "#fcfcfb",
    ink: "#0b0b0b",
    ink2: "#52514e",
    muted: "#898781",
    grid: "#e1e0d9",
    axis: "#c3c2b7",
    border: "rgba(11,11,11,0.12)",
    accent: "#0053d6",
    font: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  };
  if (!el || typeof window === "undefined") return fallback;
  const cs = getComputedStyle(el);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  return {
    dark: v("--spx-dark", "0") === "1",
    surface: v("--spx-surface", fallback.surface),
    ink: v("--spx-ink", fallback.ink),
    ink2: v("--spx-ink-2", fallback.ink2),
    muted: v("--spx-muted", fallback.muted),
    grid: v("--spx-grid", fallback.grid),
    axis: v("--spx-axis", fallback.axis),
    border: v("--spx-border", fallback.border),
    accent: v("--spx-accent", fallback.accent),
    font: cs.fontFamily || fallback.font,
  };
}
