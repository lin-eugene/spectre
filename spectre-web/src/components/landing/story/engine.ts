// Scroll-scrubbed 3D story for the landing page. One renderer, one scene; every element is a
// pure function of the story position s (0 = top of the hero act … 8 = end of the CTA act):
// a spectral wave under the protein → peaks burst into a cloud → settle on the 1H-15N plane as a
// peak landscape → rise into the 3D strips cube (slice plane sweeps) → strips link up and fly
// onto the protein, which lights up in confidence colours → the assembled protein for the CTA.
import * as THREE from "three";
import type { LandingSceneData } from "@/lib/landing/types";
import { SpectralWave } from "./wave";

const CONF: Record<string, string> = {
  veryHigh: "#0053D6",
  high: "#65CBF3",
  low: "#FFDB13",
  unassigned: "#FF7D45",
  proline: "#B7BDC6",
};
const LOGO = ["#1d4ed8", "#2563eb", "#06b6d4", "#22d3ee", "#7c3aed", "#8b5cf6"];
const PEAK = {
  amide: "#1d4ed8",
  CA_i: "#15803d",
  CA_im1: "#4ade80",
  CB_i: "#6d28d9",
  CB_im1: "#a78bfa",
};

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
/** eased 0→1 as s goes from a to b */
const phase = (s: number, a: number, b: number) => smooth((s - a) / (b - a));

function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Key {
  pos: THREE.Vector3;
  target: THREE.Vector3;
}
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
// camera in the middle of each act (s = i + 0.5), when that section's copy is centred on screen
const KEYS: Key[] = [
  { pos: v3(0, 5, 92), target: v3(0, -2, 0) }, // hero
  { pos: v3(6, 10, 116), target: v3(0, 0, 0) }, // problem
  { pos: v3(0, 74, 62), target: v3(0, -12, 0) }, // spectra: looking down on the 1H-15N plane
  { pos: v3(74, 38, 108), target: v3(0, -1, 0) }, // strips: the cube from a corner
  { pos: v3(40, 20, 104), target: v3(0, 0, 0) }, // assign
  { pos: v3(0, 6, 100), target: v3(0, 0, 0) }, // cta
];
/** fraction of the screen width the subject moves away from the copy (wide screens only) */
const SIDE_OFFSET = 0.24;
/** phones: the act cards pin to the bottom of the screen, so the subject moves up this much */
const PHONE_LIFT = 0.17;
const WAVE_Z = -14;
const PEAK_HEIGHT = 8;

function makeLabel(text: string, color = "#334155") {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 96;
  const g = c.getContext("2d")!;
  g.font = "600 52px 'IBM Plex Sans', system-ui, sans-serif";
  g.fillStyle = color;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 128, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(9, 3.4, 1);
  return sp;
}

const POINT_VERT = /* glsl */ `
  attribute float size;
  attribute float alpha;
  attribute vec3 color;
  varying vec3 vColor;
  varying float vAlpha;
  uniform float pixelRatio;
  void main() {
    vColor = color;
    vAlpha = alpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * pixelRatio * (300.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const POINT_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p) * 2.0;
    if (d > 1.0) discard;
    float core = smoothstep(1.0, 0.55, d);
    float rim = smoothstep(0.55, 0.95, d) * (1.0 - smoothstep(0.95, 1.0, d));
    // glossy sphere look on a light page: lit core, darker rim, small specular dot
    vec3 col = mix(vColor * 1.12, vColor * 0.72, smoothstep(0.0, 1.0, d));
    float spec = smoothstep(0.32, 0.0, length(p - vec2(-0.16, 0.16)));
    col += vec3(0.9) * spec * 0.55;
    float a = vAlpha * (core + rim * 0.6);
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`;

export interface StoryOptions {
  mobile: boolean;
  reducedMotion: boolean;
}

export class StoryEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 0.5, 800);
  private world = new THREE.Group();
  private disposables: { dispose: () => void }[] = [];
  private w = 1;
  private h = 1;
  private tmpPos = new THREE.Vector3();
  private tmpTarget = new THREE.Vector3();
  private tmpV2 = new THREE.Vector2();
  private tmpV3 = new THREE.Vector3();

  // hero
  private wave: SpectralWave;

  // protein
  private proteinGroup = new THREE.Group();
  private tube!: THREE.Mesh<THREE.TubeGeometry, THREE.MeshStandardMaterial>;
  private tubeResidue!: Float32Array; // residue index (fractional) per vertex
  private gradColors!: Float32Array;
  private confColors!: THREE.Color[];
  private lastReveal = -1;

  // ¹H/¹⁵N/¹³C → scene coordinates, and the amide peaks of the HSQC landscape
  private readonly cube = { w: 38, h: 32, d: 38 };
  private floorY = -16;
  private mapping!: { X: (h: number) => number; Y: (c: number) => number; Z: (n: number) => number };
  private amidePeaks: { x: number; z: number; amp: number }[] = [];

  // particles
  private points!: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private nP = 0;
  private layouts!: { P0: Float32Array; P1: Float32Array; P2: Float32Array; P3: Float32Array };
  private pColorCloud!: Float32Array;
  private pColorSpec!: Float32Array;
  private pColorConf!: Float32Array;
  private pKind!: Uint8Array; // 0 filler, 1 amide, 2 carbon
  private pDelay!: Float32Array;
  private pBaseSize!: Float32Array;

  // spectrum furniture
  private specGroup = new THREE.Group();
  private surface!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private stems!: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private cubeEdges!: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  private floorGrid!: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private slice!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private sliceEdge!: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  private labels: { sprite: THREE.Sprite; act: "plane" | "cube" }[] = [];
  private arcs!: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private arcSegments = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private data: LandingSceneData,
    private opts: StoryOptions,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.fog = new THREE.Fog(0xf6f8fc, 150, 320);
    this.scene.add(this.world);
    this.world.add(this.proteinGroup, this.specGroup);

    const hemi = new THREE.HemisphereLight(0xffffff, 0xdbe7ff, 1.6);
    const key = new THREE.DirectionalLight(0xffffff, 1.9);
    key.position.set(40, 60, 50);
    const rim = new THREE.DirectionalLight(0xbfd7ff, 1.1);
    rim.position.set(-50, -10, -40);
    this.scene.add(hemi, key, rim);

    this.wave = new SpectralWave({ lines: opts.mobile ? 18 : 30, segments: opts.mobile ? 160 : 260 });
    this.wave.mesh.position.z = WAVE_Z;
    this.world.add(this.wave.mesh);
    this.disposables.push(this.wave);

    this.buildMapping();
    this.buildProtein();
    this.buildParticles();
    this.buildSpectrum();
  }

  // ---------------------------------------------------------------- construction
  private buildMapping() {
    const hs = this.data.hsqc.map((p) => p.h);
    const ns = this.data.hsqc.map((p) => p.n);
    const hMin = Math.min(...hs) - 0.25;
    const hMax = Math.max(...hs) + 0.25;
    const nMin = Math.min(...ns) - 1.5;
    const nMax = Math.max(...ns) + 1.5;
    const cMin = 10;
    const cMax = 72;
    const { w, h, d } = this.cube;
    // ¹H runs right-to-left, as on every NMR plot
    const X = (v: number) => ((hMax - v) / (hMax - hMin) - 0.5) * w;
    const Z = (v: number) => ((v - nMin) / (nMax - nMin) - 0.5) * d;
    const Y = (v: number) => ((v - cMin) / (cMax - cMin) - 0.5) * h;
    this.mapping = { X, Y, Z };
    const rand = rng(5);
    this.amidePeaks = this.data.hsqc.map((p) => ({ x: X(p.h), z: Z(p.n), amp: 0.62 + rand() * 0.38 }));
  }

  /** height of the HSQC landscape (0..~1.3) at a floor position: one Gaussian per amide peak */
  private heightAt(x: number, z: number) {
    let hgt = 0;
    for (const p of this.amidePeaks) {
      const dx = (x - p.x) / 0.62;
      const dz = (z - p.z) / 0.78;
      const q = dx * dx + dz * dz;
      if (q < 18) hgt += p.amp * Math.exp(-0.5 * q);
    }
    return Math.min(1.3, hgt);
  }

  private buildProtein() {
    const res = this.data.protein.residues;
    if (res.length < 4) return;
    const pts = res.map((r) => new THREE.Vector3(...r.ca));
    const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal", 0.5);
    const tubular = res.length * 10;
    const radial = 14;
    const geo = new THREE.TubeGeometry(curve, tubular, 0.95, radial, false);
    const count = geo.attributes.position.count;
    this.tubeResidue = new Float32Array(count);
    this.gradColors = new Float32Array(count * 3);
    const stops = [new THREE.Color("#1d4ed8"), new THREE.Color("#06b6d4"), new THREE.Color("#7c3aed")];
    const tmp = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const ring = Math.floor(i / (radial + 1));
      const u = ring / tubular;
      this.tubeResidue[i] = u * (res.length - 1);
      // logo gradient along the chain: deep blue → cyan → violet
      const x = u * 2;
      const k = Math.min(1, Math.floor(x));
      tmp.copy(stops[k]).lerp(stops[k + 1], x - k);
      this.gradColors.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(this.gradColors.slice(), 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.08, transparent: true, opacity: 1 });
    this.tube = new THREE.Mesh(geo, mat);
    this.proteinGroup.add(this.tube);
    this.disposables.push(geo, mat);
    this.confColors = res.map((r) => new THREE.Color(CONF[r.confidence] ?? CONF.unassigned));
  }

  private buildParticles() {
    const d = this.data;
    const res = d.protein.residues;
    const caOf = new Map(res.map((r) => [r.resi, r.ca]));
    const confOf = new Map(res.map((r) => [r.resi, r.confidence]));
    const { X, Y, Z } = this.mapping;
    const rand = rng(11);
    const filler = this.opts.mobile ? 90 : 220;
    type P = { kind: 0 | 1 | 2; home: [number, number, number]; floor: [number, number, number]; cube: [number, number, number]; spec: string; conf: string; size: number };
    const parts: P[] = [];
    const jitter = (p: [number, number, number], a: number): [number, number, number] => [p[0] + (rand() - 0.5) * a, p[1] + (rand() - 0.5) * a, p[2] + (rand() - 0.5) * a];
    const randomCa = () => res[Math.floor(rand() * res.length)]?.ca ?? [0, 0, 0];
    // amides from the HSQC: they sit on top of their peak in the landscape, then on the cube floor
    for (const p of d.hsqc) {
      const x = X(p.h);
      const z = Z(p.n);
      const top: [number, number, number] = [x, this.floorY + this.heightAt(x, z) * PEAK_HEIGHT + 0.6, z];
      const home = jitter((p.resi && caOf.get(p.resi)) || randomCa(), 1.2);
      parts.push({ kind: 1, home, floor: top, cube: [x, this.floorY, z], spec: PEAK.amide, conf: CONF[p.confidence] ?? CONF.unassigned, size: 2.5 });
    }
    // carbon peaks of each strip
    for (const s of d.strips) {
      const floor: [number, number, number] = [X(s.h), this.floorY, Z(s.n)];
      const conf = confOf.get(s.resi) ?? "unassigned";
      for (const pk of s.peaks) {
        const ownResi = pk.kind.endsWith("im1") ? s.resi - 1 : s.resi;
        const home = jitter(caOf.get(ownResi) ?? caOf.get(s.resi) ?? randomCa(), 2.2);
        parts.push({
          kind: 2,
          home,
          floor,
          cube: [X(s.h), Y(pk.c), Z(s.n)],
          spec: PEAK[pk.kind],
          conf: CONF[conf],
          size: 1.7 + Math.min(1.2, Math.sqrt(Math.abs(pk.inty)) * 0.9),
        });
      }
    }
    // filler noise for the "hundreds of unlabelled peaks" moment
    for (let i = 0; i < filler; i++) {
      const home = jitter(randomCa(), 3);
      const floor: [number, number, number] = [(rand() - 0.5) * this.cube.w * 0.9, this.floorY, (rand() - 0.5) * this.cube.d * 0.9];
      parts.push({ kind: 0, home, floor, cube: floor, spec: "#94a3b8", conf: "#94a3b8", size: 1.2 + rand() * 0.8 });
    }

    const n = parts.length;
    this.nP = n;
    const P0 = new Float32Array(n * 3);
    const P1 = new Float32Array(n * 3);
    const P2 = new Float32Array(n * 3);
    const P3 = new Float32Array(n * 3);
    this.pColorCloud = new Float32Array(n * 3);
    this.pColorSpec = new Float32Array(n * 3);
    this.pColorConf = new Float32Array(n * 3);
    this.pKind = new Uint8Array(n);
    this.pDelay = new Float32Array(n);
    this.pBaseSize = new Float32Array(n);
    const c = new THREE.Color();
    parts.forEach((p, i) => {
      P0.set(p.home, i * 3);
      // cloud: a wide, slightly flattened shell around the protein
      const th = rand() * Math.PI * 2;
      const ph = Math.acos(2 * rand() - 1);
      const r = 26 + rand() * 30;
      P1.set([r * Math.sin(ph) * Math.cos(th) * 1.25, r * Math.cos(ph) * 0.75, r * Math.sin(ph) * Math.sin(th)], i * 3);
      P2.set(p.floor, i * 3);
      P3.set(p.cube, i * 3);
      c.set(LOGO[Math.floor(rand() * LOGO.length)]);
      this.pColorCloud.set([c.r, c.g, c.b], i * 3);
      c.set(p.spec);
      this.pColorSpec.set([c.r, c.g, c.b], i * 3);
      c.set(p.conf);
      this.pColorConf.set([c.r, c.g, c.b], i * 3);
      this.pKind[i] = p.kind;
      this.pDelay[i] = rand();
      this.pBaseSize[i] = p.size;
    });
    this.layouts = { P0, P1, P2, P3 };

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(P0), 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(this.pColorCloud), 3));
    geo.setAttribute("size", new THREE.BufferAttribute(new Float32Array(n), 1));
    geo.setAttribute("alpha", new THREE.BufferAttribute(new Float32Array(n), 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: { pixelRatio: { value: 1 } },
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.world.add(this.points);
    this.disposables.push(geo, mat);
  }

  private buildSpectrum() {
    const { w, h, d } = this.cube;
    // cube frame
    const box = new THREE.BoxGeometry(w, h, d);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    const edgeMat = new THREE.LineBasicMaterial({ color: "#64748b", transparent: true, opacity: 0 });
    this.cubeEdges = new THREE.LineSegments(edges, edgeMat);
    this.specGroup.add(this.cubeEdges);
    this.disposables.push(edges, edgeMat);

    // the 1H-15N spectrum as a landscape: one sharp peak per amide; flattens into the cube floor
    const seg = this.opts.mobile ? 84 : 132;
    const surfGeo = new THREE.PlaneGeometry(w, d, seg, seg);
    surfGeo.rotateX(-Math.PI / 2);
    const sp = surfGeo.attributes.position as THREE.BufferAttribute;
    const cols = new Float32Array(sp.count * 3);
    const low = new THREE.Color("#eef2ff");
    const mid = new THREE.Color("#818cf8");
    const high = new THREE.Color("#3730a3");
    const col = new THREE.Color();
    for (let i = 0; i < sp.count; i++) {
      const hgt = this.heightAt(sp.getX(i), sp.getZ(i));
      sp.setY(i, hgt * PEAK_HEIGHT);
      const r = Math.min(1, hgt);
      if (r < 0.35) col.copy(low).lerp(mid, r / 0.35);
      else col.copy(mid).lerp(high, (r - 0.35) / 0.65);
      cols.set([col.r, col.g, col.b], i * 3);
    }
    surfGeo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    surfGeo.computeVertexNormals();
    const surfMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.05, transparent: true, opacity: 0, side: THREE.DoubleSide });
    this.surface = new THREE.Mesh(surfGeo, surfMat);
    this.surface.position.y = this.floorY - 0.04;
    this.specGroup.add(this.surface);
    this.disposables.push(surfGeo, surfMat);

    const gridPts: number[] = [];
    const steps = 8;
    const gy = this.floorY + 0.05;
    for (let i = 0; i <= steps; i++) {
      const x = -w / 2 + (w * i) / steps;
      const z = -d / 2 + (d * i) / steps;
      gridPts.push(x, gy, -d / 2, x, gy, d / 2, -w / 2, gy, z, w / 2, gy, z);
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute("position", new THREE.Float32BufferAttribute(gridPts, 3));
    const gridMat = new THREE.LineBasicMaterial({ color: "#a5b4fc", transparent: true, opacity: 0 });
    this.floorGrid = new THREE.LineSegments(gridGeo, gridMat);
    this.specGroup.add(this.floorGrid);
    this.disposables.push(gridGeo, gridMat);

    // stems from each amide on the floor to its carbon peaks
    const stemCount = this.pKind.reduce((n, k) => n + (k === 2 ? 1 : 0), 0);
    const stemGeo = new THREE.BufferGeometry();
    stemGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(stemCount * 6), 3));
    const stemMat = new THREE.LineBasicMaterial({ color: "#94a3b8", transparent: true, opacity: 0 });
    this.stems = new THREE.LineSegments(stemGeo, stemMat);
    this.stems.frustumCulled = false;
    this.specGroup.add(this.stems);
    this.disposables.push(stemGeo, stemMat);

    // rose slice plane (¹H–¹³C plane at a ¹⁵N value)
    const sliceGeo = new THREE.PlaneGeometry(w, h);
    const sliceMat = new THREE.MeshBasicMaterial({ color: "#f472b6", transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
    this.slice = new THREE.Mesh(sliceGeo, sliceMat);
    this.specGroup.add(this.slice);
    const sliceEdges = new THREE.EdgesGeometry(sliceGeo);
    const sliceEdgeMat = new THREE.LineBasicMaterial({ color: "#db2777", transparent: true, opacity: 0 });
    this.sliceEdge = new THREE.LineSegments(sliceEdges, sliceEdgeMat);
    this.slice.add(this.sliceEdge);
    this.disposables.push(sliceGeo, sliceMat, sliceEdges, sliceEdgeMat);

    // axis labels
    const lab = (text: string, act: "plane" | "cube", pos: [number, number, number]) => {
      const s = makeLabel(text);
      s.position.set(...pos);
      this.specGroup.add(s);
      this.labels.push({ sprite: s, act });
      this.disposables.push(s.material, (s.material as THREE.SpriteMaterial).map!);
    };
    lab("¹H (ppm)", "plane", [0, this.floorY - 1, d / 2 + 5]);
    lab("¹⁵N (ppm)", "plane", [w / 2 + 4, this.floorY - 1, 0]);
    lab("¹³C (ppm)", "cube", [-w / 2 + 5, h / 2 + 3, d / 2]);

    // sequential-walk arcs: CA(i-1) of strip r → CA(i) of strip r-1 (and CB)
    const { X, Y, Z } = this.mapping;
    const byResi = new Map(this.data.strips.map((s) => [s.resi, s]));
    const arcPts: number[] = [];
    const arcCols: number[] = [];
    const ca = new THREE.Color(PEAK.CA_i);
    const cb = new THREE.Color(PEAK.CB_i);
    const SEG = 14;
    for (const s of this.data.strips) {
      const prev = byResi.get(s.resi - 1);
      if (!prev) continue;
      for (const [from, to, c] of [
        ["CA_im1", "CA_i", ca],
        ["CB_im1", "CB_i", cb],
      ] as const) {
        const a = s.peaks.find((p) => p.kind === from);
        const b = prev.peaks.find((p) => p.kind === to);
        if (!a || !b) continue;
        const A = new THREE.Vector3(X(s.h), Y(a.c), Z(s.n));
        const B = new THREE.Vector3(X(prev.h), Y(b.c), Z(prev.n));
        const mid = A.clone().add(B).multiplyScalar(0.5);
        mid.y += 3 + A.distanceTo(B) * 0.18;
        const pts = new THREE.QuadraticBezierCurve3(A, mid, B).getPoints(SEG);
        for (let k = 0; k < SEG; k++) {
          arcPts.push(pts[k].x, pts[k].y, pts[k].z, pts[k + 1].x, pts[k + 1].y, pts[k + 1].z);
          arcCols.push(c.r, c.g, c.b, c.r, c.g, c.b);
        }
      }
    }
    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute("position", new THREE.Float32BufferAttribute(arcPts, 3));
    arcGeo.setAttribute("color", new THREE.Float32BufferAttribute(arcCols, 3));
    this.arcSegments = arcPts.length / 6;
    const arcMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0 });
    this.arcs = new THREE.LineSegments(arcGeo, arcMat);
    this.arcs.frustumCulled = false;
    this.specGroup.add(this.arcs);
    this.disposables.push(arcGeo, arcMat);
  }

  // ---------------------------------------------------------------- runtime
  resize(w: number, h: number, dpr: number) {
    this.w = w;
    this.h = h;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.getDrawingBufferSize(this.tmpV2);
    this.wave.setResolution(this.tmpV2.x, this.tmpV2.y, dpr);
    // phones see the scene from further back, so their peaks are drawn a little larger
    const phone = w < 900 ? 1.35 : 1;
    (this.points.material.uniforms.pixelRatio as { value: number }).value = dpr * phone * Math.min(1.4, Math.max(0.75, h / 900));
  }

  /**
   * @param s story position (act index + progress)
   * @param shift horizontal subject offset in [-1, 1] (+ = move subject right)
   * @param t seconds, for idle motion
   */
  render(s: number, shift: number, t: number) {
    const idle = this.opts.reducedMotion ? 0 : 1;
    // camera along the act keys
    const k = Math.min(KEYS.length - 1, Math.max(0, s - 0.5));
    const i = Math.min(KEYS.length - 2, Math.floor(k));
    const f = smooth(k - i);
    const pos = this.tmpPos.copy(KEYS[i].pos).lerp(KEYS[i + 1].pos, f);
    const target = this.tmpTarget.copy(KEYS[i].target).lerp(KEYS[i + 1].target, f);
    // portrait screens: back off so the subject still fits the narrow frame
    const aspect = this.w / this.h;
    if (aspect < 1.25) pos.sub(target).multiplyScalar(Math.pow(1.25 / aspect, 0.55)).add(target);
    pos.x += Math.sin(t * 0.21) * 1.6 * idle;
    pos.y += Math.sin(t * 0.17) * 1.1 * idle;
    this.camera.position.copy(pos);
    this.camera.lookAt(target);
    const wide = this.w >= 900;
    const offX = wide ? shift * SIDE_OFFSET : 0;
    const offY = wide ? 0 : PHONE_LIFT;
    if (Math.abs(offX) > 0.0005 || offY) this.camera.setViewOffset(this.w, this.h, -offX * this.w, offY * this.h, this.w, this.h);
    else this.camera.clearViewOffset();
    this.camera.updateMatrixWorld();

    // world spin: protein-centric acts rotate with scroll; the spectrum acts stay square on
    const specness = phase(s, 1.7, 2.3) * (1 - phase(s, 4.4, 4.9));
    const spin = (s * 0.9 + t * 0.06 * idle) * (1 - specness);
    this.proteinGroup.rotation.y = spin;
    this.points.rotation.y = spin;
    // stems and walk arcs hang off the peaks, so they turn with them
    this.stems.rotation.y = spin;
    this.arcs.rotation.y = spin;

    this.updateWave(s, t * idle, wide);
    this.updateProtein(s);
    this.updateParticles(s, t);
    this.updateSpectrum(s);

    this.renderer.render(this.scene, this.camera);
  }

  private updateWave(s: number, t: number, wide: boolean) {
    const alpha = 1 - phase(s, 0.7, 1.25);
    if (alpha <= 0.004) {
      this.wave.update(t, 0, 1, 1);
      return;
    }
    // pin the band to a fixed spot on screen, whatever the view offset does to the subject: just
    // below the middle on wide screens, along the bottom edge under the buttons on phones
    const cam = this.camera.position;
    const dir = this.tmpV3.set(0, wide ? -0.16 : -0.86, 0.5).unproject(this.camera).sub(cam).normalize();
    const k = (WAVE_Z - cam.z) / dir.z;
    const m = this.wave.mesh;
    m.position.set(cam.x + dir.x * k, cam.y + dir.y * k, WAVE_Z);
    const visW = 2 * Math.abs(k) * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect;
    this.wave.update(t, alpha, 1 + 0.6 * phase(s, 0.45, 1.2), Math.max(visW * 0.56, 46));
  }

  private updateProtein(s: number) {
    if (!this.tube) return;
    // visible in hero, ghost in problem, hidden over the spectrum, back for assign onwards
    let vis = 1 - phase(s, 0.9, 1.55) + phase(s, 0.9, 1.55) * (1 - phase(s, 1.6, 2.0)) * 0.14 + phase(s, 4.45, 4.95);
    // phones: the hero copy fills the screen, so the protein only arrives once scrolling starts
    if (this.w < 900) vis *= phase(s, 0.3, 0.8);
    const op = Math.min(1, vis);
    const mat = this.tube.material;
    mat.opacity = op;
    mat.depthWrite = op > 0.95;
    this.tube.visible = op > 0.01;

    // assign act: residues light up in confidence colours along the sequence
    const reveal = phase(s, 4.55, 5.0) * (this.data.protein.residues.length + 3);
    const r = Math.round(reveal * 4) / 4;
    if (r !== this.lastReveal) {
      this.lastReveal = r;
      const colAttr = this.tube.geometry.attributes.color as THREE.BufferAttribute;
      const arr = colAttr.array as Float32Array;
      const tmp = new THREE.Color();
      const g = new THREE.Color();
      for (let k = 0; k < this.tubeResidue.length; k++) {
        const ri = this.tubeResidue[k];
        const w = clamp01(reveal - ri);
        const conf = this.confColors[Math.min(this.confColors.length - 1, Math.round(ri))];
        g.setRGB(this.gradColors[k * 3], this.gradColors[k * 3 + 1], this.gradColors[k * 3 + 2]);
        tmp.copy(g).lerp(conf, w);
        arr[k * 3] = tmp.r;
        arr[k * 3 + 1] = tmp.g;
        arr[k * 3 + 2] = tmp.b;
      }
      colAttr.needsUpdate = true;
    }
  }

  private updateParticles(s: number, t: number) {
    const { P0, P1, P2, P3 } = this.layouts;
    const geo = this.points.geometry;
    const pos = geo.attributes.position.array as Float32Array;
    const col = geo.attributes.color.array as Float32Array;
    const size = geo.attributes.size.array as Float32Array;
    const alpha = geo.attributes.alpha.array as Float32Array;
    const idle = this.opts.reducedMotion ? 0 : 1;

    const fadeOutAll = phase(s, 5.0, 5.35);
    this.points.visible = s > 0.72 && fadeOutAll < 1;
    if (!this.points.visible) return;

    const tBurst = (s - 0.85) / (1.6 - 0.85);
    const tPlane = (s - 1.7) / (2.45 - 1.7);
    const tFlat = phase(s, 2.75, 3.1); // amides come down as the landscape flattens into the cube floor
    const tRise = (s - 3.0) / (3.55 - 3.0);
    const tHome = (s - 4.45) / (5.0 - 4.45);
    const sliceZ = this.sliceZ(s);
    const sliceOn = phase(s, 3.45, 3.6) * (1 - phase(s, 4.15, 4.35));
    const colToSpec = phase(s, 1.9, 2.4);
    const colToConf = phase(s, 4.5, 4.95);

    for (let i = 0; i < this.nP; i++) {
      const k = this.pKind[i];
      const dly = this.pDelay[i] * 0.35;
      const st = (x: number) => smooth((x - dly) / 0.65);
      const a1 = st(tBurst);
      const a2 = st(tPlane);
      const a3 = k === 2 ? st(tRise) : k === 1 ? tFlat : 0;
      const a4 = st(tHome);
      for (let c = 0; c < 3; c++) {
        const o = i * 3 + c;
        let p = P0[o];
        p += (P1[o] - p) * a1;
        p += (P2[o] - p) * a2;
        p += (P3[o] - p) * a3;
        p += (P0[o] - p) * a4;
        pos[o] = p;
        const cc = this.pColorCloud[o] + (this.pColorSpec[o] - this.pColorCloud[o]) * colToSpec;
        col[o] = cc + (this.pColorConf[o] - cc) * colToConf;
      }
      // cloud shimmer
      if (a1 > 0 && a2 < 1 && idle) pos[i * 3 + 1] += Math.sin(t * 0.9 + i) * 0.6 * a1 * (1 - a2);
      // visibility per kind
      let al = phase(s, 0.75, 1.15); // appear as they burst out
      if (k === 0) al *= 1 - phase(s, 2.2, 2.7) * 0.92; // noise fades once the spectrum is clean
      if (k === 2) al *= 1 - phase(s, 1.95, 2.35) * (1 - phase(s, 2.95, 3.2)); // carbons hide while stacked on the floor
      al *= 1 - fadeOutAll * 0.97;
      let sz = this.pBaseSize[i] * (k === 0 ? 0.9 : 1);
      // slice-plane glow
      if (sliceOn > 0 && k !== 0) {
        if (Math.abs(pos[i * 3 + 2] - sliceZ) < 2) sz *= 1 + 0.65 * sliceOn;
        else al *= 1 - 0.55 * sliceOn;
      }
      // smaller once they sit on the protein
      sz *= 1 - 0.35 * colToConf;
      size[i] = sz;
      alpha[i] = Math.min(1, al);
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.attributes.size.needsUpdate = true;
    geo.attributes.alpha.needsUpdate = true;
  }

  private sliceZ(s: number) {
    const sweep = phase(s, 3.55, 4.2);
    return (-0.42 + 0.84 * sweep) * this.cube.d;
  }

  private updateSpectrum(s: number) {
    const out = 1 - phase(s, 4.35, 4.6);
    const plane = phase(s, 1.9, 2.4) * out;
    const cubeOn = phase(s, 2.7, 3.2) * out;
    this.specGroup.visible = plane > 0.005 || cubeOn > 0.005;
    if (!this.specGroup.visible) return;

    // landscape: peaks grow as the cloud lands, then flatten into the cube floor
    const grow = phase(s, 2.0, 2.45) * (1 - phase(s, 2.75, 3.1));
    this.surface.material.opacity = Math.max(plane, cubeOn) * 0.92;
    this.surface.scale.y = Math.max(0.002, grow);
    this.floorGrid.material.opacity = plane * 0.55;
    this.cubeEdges.material.opacity = cubeOn * 0.55;
    for (const l of this.labels) (l.sprite.material as THREE.SpriteMaterial).opacity = l.act === "plane" ? plane : cubeOn;

    // stems follow the rising carbon peaks
    const stemOp = phase(s, 3.0, 3.25) * (1 - phase(s, 4.3, 4.5));
    this.stems.material.opacity = stemOp * 0.6;
    this.stems.visible = stemOp > 0.005;
    if (this.stems.visible) {
      const pts = this.points.geometry.attributes.position.array as Float32Array;
      const arr = this.stems.geometry.attributes.position.array as Float32Array;
      let j = 0;
      for (let i = 0; i < this.nP; i++) {
        if (this.pKind[i] !== 2) continue;
        const x = pts[i * 3];
        const y = pts[i * 3 + 1];
        const z = pts[i * 3 + 2];
        arr.set([x, this.floorY, z, x, y, z], j * 6);
        j++;
      }
      this.stems.geometry.attributes.position.needsUpdate = true;
    }

    // slice plane sweeps through ¹⁵N
    const sliceOn = phase(s, 3.45, 3.6) * (1 - phase(s, 4.15, 4.35));
    this.slice.material.opacity = sliceOn * 0.14;
    this.sliceEdge.material.opacity = sliceOn * 0.85;
    this.slice.position.set(0, 0, this.sliceZ(s));
    this.slice.visible = sliceOn > 0.005;

    // walk arcs draw on progressively
    const arcOn = phase(s, 3.95, 4.3);
    const arcFade = 1 - phase(s, 4.4, 4.6);
    const drawn = Math.floor(this.arcSegments * arcOn);
    this.arcs.geometry.setDrawRange(0, drawn * 2);
    this.arcs.material.opacity = 0.9 * arcFade;
    this.arcs.visible = drawn > 0 && arcFade > 0.01;
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
  }
}
