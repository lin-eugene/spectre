// Imperative three.js scene for the "Strips 3D" tab: a ¹H × ¹⁵N × ¹³C box whose floor is the
// HSQC, carbon peaks as glossy spheres on stems above each amide, a movable translucent slice
// plane carrying the measured (or synthesised) slice, sequential-walk arcs, DOM labels
// projected every frame, analytic picking and eased camera presets. React owns the controls,
// the tooltip and the textures, and calls into this class.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { formatTick } from "@/lib/viz/ticks";

/** World size of the box: ¹H along x (ppm decreasing to the right), ¹³C up, ¹⁵N in depth. */
export const BOX = { W: 10, H: 8, D: 10 } as const;

export interface CubeTheme {
  dark: boolean;
  /** panel surface: fog colour and the halo under amide rings */
  surface: string;
  frame: string;
  grid: string;
  wall: string;
  stem: string;
  muted: string;
  ink: string;
  rose: string;
  beam: string;
  /** opacity of the soft shadow under the floor */
  shadow: number;
}

export interface CubePoint {
  h: number;
  n: number;
  c: number;
}

export interface CubeAxes {
  h: [number, number];
  n: [number, number];
  c: [number, number];
  ticks: { h: number[]; n: number[]; c: number[] };
  titles: { h: string; n: string; c: string };
}

export interface ScenePeak extends CubePoint {
  /** world radius */
  r: number;
  color: string;
  amide: number;
}

export interface SceneAmide {
  h: number;
  n: number;
  top: number | null;
  color: string;
  faded: boolean;
}

export interface SceneData {
  axes: CubeAxes;
  peaks: ScenePeak[];
  amides: SceneAmide[];
}

export interface SceneHighlight {
  /** 1 = drawn solid, 0 = ghosted; null = everything solid */
  lit: Uint8Array | null;
  /** 1 = glowing (inside the slice) */
  glow: Uint8Array | null;
  selectedAmide: number | null;
}

export interface SceneSlice {
  axis: "n" | "c" | null;
  at: number;
  texture: HTMLCanvasElement | null;
  /** ppm the texture was computed at (it lags the plane while a new slice loads) */
  textureAt: number | null;
  label: string;
}

export interface SceneArc {
  from: CubePoint;
  to: CubePoint;
  color: string;
  dashed: boolean;
  /** the partner peak is not in this spectrum (the arc ends on the residue's consensus shift) */
  openEnd?: boolean;
}

export interface SceneLabel {
  key: string;
  at: CubePoint;
  text: string;
  className: string;
  dx?: number;
  dy?: number;
  align?: "left" | "center" | "right";
}

export type CubeTarget = { kind: "peak"; index: number } | { kind: "amide"; index: number } | null;
export type CubePreset = "home" | "top" | "face";

export interface CubeCallbacks {
  onHover: (t: CubeTarget) => void;
  onSelect: (t: CubeTarget) => void;
  onFrame: () => void;
  onSliceDrag: (ppm: number) => void;
  onSpinChange: (on: boolean) => void;
}

interface Spherical {
  r: number;
  theta: number;
  phi: number;
}

const HOME = { theta: 0.46, phi: 1.14 };
const HOME_BASE = new THREE.Vector3(0, BOX.H * 0.45, 0);
/** lens of the oblique view and of the flat (top-down / face-on) views */
const FOV = { home: 30, flat: 9 };
/** thickness of the floor plate */
const SLAB = 0.16;
const RING_R = 0.13;
const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Absolutely positioned DOM labels, reused frame to frame. */
class LabelPool {
  private els: HTMLSpanElement[] = [];
  private n = 0;
  constructor(private host: HTMLElement) {}
  begin() {
    this.n = 0;
  }
  put(text: string, cls: string, x: number, y: number, align: "left" | "center" | "right" = "center", extra = "") {
    let el = this.els[this.n];
    if (!el) {
      el = document.createElement("span");
      this.host.appendChild(el);
      this.els.push(el);
    }
    this.n++;
    if (el.className !== cls) el.className = cls;
    if (el.textContent !== text) el.textContent = text;
    const tx = align === "left" ? "0" : align === "right" ? "-100%" : "-50%";
    el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(${tx},-50%)${extra}`;
    if (el.style.visibility) el.style.visibility = "";
  }
  end() {
    for (let k = this.n; k < this.els.length; k++) if (this.els[k].style.visibility !== "hidden") this.els[k].style.visibility = "hidden";
  }
  dispose() {
    for (const el of this.els) el.remove();
    this.els = [];
  }
}

function canvasTexture(draw: (g: CanvasRenderingContext2D, s: number) => void, size = 128): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  draw(cv.getContext("2d")!, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Ring with a faint fill (white, tinted per instance). */
function ringTexture() {
  return canvasTexture((g, s) => {
    const c = s / 2;
    g.fillStyle = "rgba(255,255,255,0.26)";
    g.beginPath();
    g.arc(c, c, s * 0.36, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = s * 0.12;
    g.strokeStyle = "#ffffff";
    g.beginPath();
    g.arc(c, c, s * 0.36, 0, Math.PI * 2);
    g.stroke();
  });
}

/** Soft annulus that lifts rings off the contours (tinted with the surface colour); the
 *  centre stays clear so the peak maximum under the ring remains visible. */
function haloTexture() {
  return canvasTexture((g, s) => {
    const c = s / 2;
    const grd = g.createRadialGradient(c, c, 0, c, c, s / 2);
    grd.addColorStop(0.4, "rgba(255,255,255,0)");
    grd.addColorStop(0.52, "rgba(255,255,255,0.85)");
    grd.addColorStop(0.66, "rgba(255,255,255,0.85)");
    grd.addColorStop(0.84, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
  });
}

/** Thin bright ring for the hovered peak. */
function hoverTexture() {
  return canvasTexture((g, s) => {
    const c = s / 2;
    g.lineWidth = s * 0.07;
    g.strokeStyle = "#ffffff";
    g.beginPath();
    g.arc(c, c, s * 0.4, 0, Math.PI * 2);
    g.stroke();
  });
}

/** Blurred rounded rectangle (white on black) used as the alpha of the floor shadow. */
function shadowTexture() {
  return canvasTexture((g, s) => {
    g.fillStyle = "#000";
    g.fillRect(0, 0, s, s);
    g.shadowColor = "#fff";
    g.shadowBlur = s * 0.09;
    g.shadowOffsetX = s * 4;
    g.fillStyle = "#fff";
    g.fillRect(s * 0.17 - s * 4, s * 0.17, s * 0.66, s * 0.66);
  }, 256);
}

/** Vertical gradient for the back walls (slightly darker towards the floor). */
function wallTexture(dark: boolean) {
  return canvasTexture((g, s) => {
    const grd = g.createLinearGradient(0, 0, 0, s);
    grd.addColorStop(0, "#ffffff");
    grd.addColorStop(0.75, dark ? "#d9d9d9" : "#f4f5f7");
    grd.addColorStop(1, dark ? "#a8a8a8" : "#dfe2e7");
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
  }, 64);
}

const GLOW_VERT = /* glsl */ `
attribute float glowSize;
attribute vec3 glowColor;
uniform float uScale;
varying vec3 vColor;
void main() {
  vColor = glowColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = glowSize * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const GLOW_FRAG = /* glsl */ `
uniform float uAlpha;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
  if (d > 1.0) discard;
  float a = pow(1.0 - d, 1.7) * uAlpha;
  gl_FragColor = vec4(vColor, a);
  #include <colorspace_fragment>
}`;

const BEAM_VERT = /* glsl */ `
uniform float uHeight;
varying vec3 vN;
varying vec3 vV;
varying float vY;
void main() {
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = normalize(-mv.xyz);
  vY = position.y / uHeight + 0.5;
  gl_Position = projectionMatrix * mv;
}`;

const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying vec3 vN;
varying vec3 vV;
varying float vY;
void main() {
  float f = abs(dot(normalize(vN), normalize(vV)));
  float core = pow(f, 2.4);
  float fade = smoothstep(1.0, 0.8, vY) * (0.4 + 0.6 * (1.0 - vY));
  gl_FragColor = vec4(uColor, uAlpha * core * fade);
  #include <colorspace_fragment>
}`;

export class CubeScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 900);
  private controls: OrbitControls;
  private gizmoScene = new THREE.Scene();
  private gizmoCamera = new THREE.OrthographicCamera(-1.75, 1.75, 1.75, -1.75, 0.1, 10);
  private gizmo = new THREE.Group();
  private gizmoMat = new THREE.MeshBasicMaterial({ color: "#898781" });
  private env: THREE.Texture | null = null;
  private fog = new THREE.Fog(0xffffff, 20, 80);
  private pool: LabelPool;
  private theme: CubeTheme = {
    dark: false,
    surface: "#ffffff",
    frame: "#c3c2b7",
    grid: "#ebeae5",
    wall: "#f3f4f6",
    stem: "#a3a29b",
    muted: "#898781",
    ink: "#0b0b0b",
    rose: "#d6336c",
    beam: "#2c63b4",
    shadow: 0.12,
  };

  // furniture
  private floor: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private floorTex: THREE.CanvasTexture | null = null;
  private shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private slab: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  private wallMat: THREE.MeshBasicMaterial;
  private wallTex: THREE.CanvasTexture;
  private walls: { mesh: THREE.Mesh; grid: LineSegments2; side: "x-" | "x+" | "z-" | "z+" }[] = [];
  private gridMat = new LineMaterial({ color: "#ebeae5", linewidth: 1, transparent: true, opacity: 1, depthWrite: false, fog: true });
  private frameMat = new LineMaterial({ color: "#c3c2b7", linewidth: 1, transparent: true, opacity: 0.95, fog: true });
  private frame: LineSegments2 | null = null;
  private furniture = new THREE.Group();

  // data
  private data: SceneData | null = null;
  private axes: CubeAxes = { h: [6, 10], n: [100, 135], c: [40, 70], ticks: { h: [], n: [], c: [] }, titles: { h: "", n: "", c: "" } };
  private peakPos = new Float32Array(0);
  private hl: SceneHighlight = { lit: null, glow: null, selectedAmide: null };
  private sphereGeo = new THREE.IcosahedronGeometry(1, 3);
  private litMat = new THREE.MeshPhysicalMaterial({ roughness: 0.32, metalness: 0, clearcoat: 0.65, clearcoatRoughness: 0.22 });
  private ghostMat = new THREE.MeshPhysicalMaterial({ roughness: 0.4, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false });
  private litMesh: THREE.InstancedMesh | null = null;
  private ghostMesh: THREE.InstancedMesh | null = null;
  private stemMat = new LineMaterial({ vertexColors: true, linewidth: 1.15, transparent: true, opacity: 0.95, fog: true });
  private stemGhostMat = new LineMaterial({ vertexColors: true, linewidth: 1, transparent: true, opacity: 0.26, depthWrite: false, fog: true });
  private stems: LineSegments2[] = [];
  private discGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private ringTex = ringTexture();
  private haloTex = haloTexture();
  private ringMat: THREE.MeshBasicMaterial;
  private haloMat: THREE.MeshBasicMaterial;
  private rings: THREE.InstancedMesh | null = null;
  private halos: THREE.InstancedMesh | null = null;
  private glow: THREE.Points | null = null;
  private glowMat: THREE.ShaderMaterial;
  private hoverTex = hoverTexture();
  private hoverRing: THREE.Sprite;
  private beam: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
  private beamCoreMat = new LineMaterial({ color: "#2c63b4", linewidth: 1.4, transparent: true, opacity: 0.6, depthWrite: false });
  private beamCore: LineSegments2;
  private arrowGeo = new THREE.ConeGeometry(0.055, 0.17, 18);
  private arrowMat = new THREE.MeshBasicMaterial({ color: "#2c63b4", transparent: true, opacity: 0.9, depthWrite: false });
  private arrows: THREE.InstancedMesh | null = null;
  private arcs = new THREE.Group();
  private labels: SceneLabel[] = [];

  // slice
  private sliceState: SceneSlice = { axis: null, at: 0, texture: null, textureAt: null, label: "" };
  private sliceGroup = new THREE.Group();
  private sliceTint: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private sliceTexMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private sliceTex: THREE.CanvasTexture | null = null;
  private sliceBorderMat = new LineMaterial({ color: "#d6336c", linewidth: 1.3, transparent: true, opacity: 0.78 });
  private sliceBorder: LineSegments2;
  private handle: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  private stalk: LineSegments2;

  // interaction
  private hover: CubeTarget = null;
  private pinned = false;
  private pointer = { x: 0, y: 0, inside: false, pending: false, type: "mouse", downX: 0, downY: 0, downT: 0 };
  private dragging = false;
  private overHandle = false;
  private raycaster = new THREE.Raycaster();
  private anim: { t0: number; dur: number; fromT: THREE.Vector3; toT: THREE.Vector3; from: Spherical; to: Spherical; fromFov: number; toFov: number } | null = null;
  private spin = false;
  private sway = { t0: 0, theta: 0 };
  private homeTarget = new THREE.Vector3(0, BOX.H * 0.42, 0);
  private homeR = 30;
  private needsHome = true;
  private width = 1;
  private height = 1;
  private visible = true;
  private dirty = true;
  private raf = 0;
  private disposed = false;
  private ro: ResizeObserver;
  private io: IntersectionObserver | null = null;
  private tmp = new THREE.Vector3();

  constructor(
    private host: HTMLElement,
    private overlay: HTMLElement,
    private cb: CubeCallbacks,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x000000, 0);
    // palette colours (legend) must render true
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const el = this.renderer.domElement;
    el.style.display = "block";
    el.style.width = "100%";
    el.style.height = "100%";
    el.style.touchAction = "none";
    host.appendChild(el);
    this.pool = new LabelPool(overlay);

    this.scene.fog = this.fog;
    this.scene.add(this.camera);
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(-0.7, 1.1, 0.9);
    this.camera.add(key);
    const fill = new THREE.DirectionalLight(0xf3f6ff, 0.45);
    fill.position.set(1.2, -0.2, 0.6);
    this.camera.add(fill);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xa4a9b3, 1.0));
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.env;
    this.scene.environmentIntensity = 0.55;

    this.controls = new OrbitControls(this.camera, el);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.085;
    this.controls.rotateSpeed = 0.7;
    this.controls.zoomSpeed = 0.85;
    this.controls.screenSpacePanning = true;
    this.controls.minPolarAngle = 0;
    this.controls.maxPolarAngle = Math.PI / 2;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 420;
    this.controls.target.copy(this.homeTarget);
    this.controls.addEventListener("start", () => {
      this.anim = null;
      if (this.spin) {
        this.spin = false;
        this.cb.onSpinChange(false);
      }
    });

    // floor, its shadow and the walls
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(BOX.W, BOX.D).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.floor.renderOrder = -2;
    const shadowAlpha = shadowTexture();
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(BOX.W * 1.62, BOX.D * 1.62).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: shadowAlpha, transparent: true, opacity: 0.12, depthWrite: false, fog: false }),
    );
    this.shadow.position.set(0.25, -SLAB - 0.03, -0.15);
    // the floor is a thin plate: lit sides give the HSQC some body
    this.slab = new THREE.Mesh(new THREE.BoxGeometry(BOX.W, SLAB, BOX.D), new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.85, metalness: 0 }));
    this.slab.position.set(0, -SLAB / 2 - 0.003, 0);
    this.shadow.renderOrder = -3;
    this.wallTex = wallTexture(false);
    this.wallMat = new THREE.MeshBasicMaterial({ color: "#f3f4f6", map: this.wallTex, transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide });
    this.furniture.add(this.shadow, this.slab, this.floor);
    this.scene.add(this.furniture);

    // amide rings
    this.haloMat = new THREE.MeshBasicMaterial({ map: this.haloTex, color: "#ffffff", transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.ringMat = new THREE.MeshBasicMaterial({ map: this.ringTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

    // glow, hover ring, beam
    this.glowMat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uAlpha: { value: 0.5 } },
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.hoverRing = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.hoverTex, color: "#0b0b0b", transparent: true, depthTest: false, depthWrite: false }));
    this.hoverRing.visible = false;
    this.hoverRing.renderOrder = 20;
    this.scene.add(this.hoverRing);
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 1, 40, 1, true),
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color("#2c63b4") }, uAlpha: { value: 0.35 }, uHeight: { value: 1 } },
        vertexShader: BEAM_VERT,
        fragmentShader: BEAM_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.beam.visible = false;
    this.beam.renderOrder = 2;
    this.scene.add(this.beam);
    this.beamCore = new LineSegments2(new LineSegmentsGeometry(), this.beamCoreMat);
    this.beamCore.visible = false;
    this.beamCore.renderOrder = 2;
    this.scene.add(this.beamCore);
    this.arcs.renderOrder = 7;
    this.scene.add(this.arcs);

    // slice plane
    this.sliceTint = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: "#d6336c", transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.sliceTint.renderOrder = 3;
    this.sliceTexMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    this.sliceTexMesh.renderOrder = 4;
    this.sliceBorder = new LineSegments2(new LineSegmentsGeometry(), this.sliceBorderMat);
    this.sliceBorder.renderOrder = 5;
    this.stalk = new LineSegments2(new LineSegmentsGeometry(), this.sliceBorderMat);
    this.handle = new THREE.Mesh(new THREE.SphereGeometry(0.19, 32, 20), new THREE.MeshStandardMaterial({ color: "#d6336c", roughness: 0.3, metalness: 0, emissive: "#d6336c", emissiveIntensity: 0.25 }));
    this.sliceGroup.add(this.sliceTint, this.sliceTexMesh, this.sliceBorder, this.stalk, this.handle);
    this.sliceGroup.visible = false;
    this.scene.add(this.sliceGroup);

    this.buildGizmo();

    el.addEventListener("pointerdown", this.onPointerDown, { capture: true });
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointercancel", this.onPointerUp);
    el.addEventListener("pointerleave", this.onPointerLeave);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    if (typeof IntersectionObserver !== "undefined") {
      this.io = new IntersectionObserver((entries) => {
        this.visible = entries.some((e) => e.isIntersecting);
        if (this.visible) this.dirty = true;
      });
      this.io.observe(host);
    }
    this.resize();
    this.raf = requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------ coordinates
  private X(h: number) {
    const [lo, hi] = this.axes.h;
    return -BOX.W / 2 + ((hi - h) / (hi - lo || 1)) * BOX.W;
  }
  private Y(c: number) {
    const [lo, hi] = this.axes.c;
    return ((c - lo) / (hi - lo || 1)) * BOX.H;
  }
  private Z(n: number) {
    const [lo, hi] = this.axes.n;
    return -BOX.D / 2 + ((n - lo) / (hi - lo || 1)) * BOX.D;
  }
  private world(p: CubePoint, out = new THREE.Vector3()) {
    return out.set(this.X(p.h), this.Y(p.c), this.Z(p.n));
  }

  // ------------------------------------------------------------------ theme
  setTheme(t: CubeTheme) {
    this.theme = t;
    this.fog.color.set(t.surface);
    this.gridMat.color.set(t.grid);
    this.frameMat.color.set(t.frame);
    this.wallMat.color.set(t.wall);
    this.wallMat.opacity = t.dark ? 0.6 : 0.8;
    this.slab.material.color.set(t.dark ? "#2c2c2f" : "#f4f5f7");
    this.wallTex.dispose();
    this.wallTex = wallTexture(t.dark);
    this.wallMat.map = this.wallTex;
    this.wallMat.needsUpdate = true;
    this.shadow.material.opacity = t.shadow;
    this.haloMat.color.set(t.surface);
    this.gizmoMat.color.set(t.muted);
    (this.hoverRing.material as THREE.SpriteMaterial).color.set(t.ink);
    this.glowMat.blending = t.dark ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.glowMat.uniforms.uAlpha.value = t.dark ? 0.62 : 0.5;
    this.glowMat.needsUpdate = true;
    const bm = this.beam.material;
    bm.uniforms.uColor.value.set(t.beam);
    bm.uniforms.uAlpha.value = t.dark ? 0.42 : 0.24;
    bm.blending = t.dark ? THREE.AdditiveBlending : THREE.NormalBlending;
    bm.needsUpdate = true;
    this.beamCoreMat.color.set(t.beam);
    this.arrowMat.color.set(t.beam);
    this.sliceTint.material.color.set(t.rose);
    this.sliceTint.material.opacity = t.dark ? 0.1 : 0.075;
    this.sliceBorderMat.color.set(t.rose);
    this.handle.material.color.set(t.rose);
    this.handle.material.emissive.set(t.rose);
    if (this.data) {
      this.buildStems();
      this.buildRings();
      this.buildGlow();
    }
    this.dirty = true;
  }

  // ------------------------------------------------------------------ data
  setData(data: SceneData) {
    const axesChanged = JSON.stringify(data.axes) !== JSON.stringify(this.axes);
    this.data = data;
    this.axes = data.axes;
    this.peakPos = new Float32Array(data.peaks.length * 3);
    data.peaks.forEach((p, k) => {
      this.peakPos[k * 3] = this.X(p.h);
      this.peakPos[k * 3 + 1] = this.Y(p.c);
      this.peakPos[k * 3 + 2] = this.Z(p.n);
    });
    if (axesChanged) this.buildBox();
    if (this.hl.lit && this.hl.lit.length !== data.peaks.length) this.hl = { lit: null, glow: null, selectedAmide: null };
    this.buildPeaks();
    this.buildStems();
    this.buildRings();
    this.buildGlow();
    this.placeBeam();
    this.placeSlice();
    this.setHover(null);
    if (this.needsHome && this.width > 1) this.applyHome();
    this.dirty = true;
  }

  setFloor(canvas: HTMLCanvasElement | null) {
    this.floorTex?.dispose();
    this.floorTex = null;
    if (canvas) {
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      this.floorTex = tex;
    }
    this.floor.material.map = this.floorTex;
    this.floor.material.color.set(this.floorTex ? "#ffffff" : this.theme.surface);
    this.floor.material.needsUpdate = true;
    this.dirty = true;
  }

  setHighlight(h: SceneHighlight) {
    this.hl = h;
    if (!this.data) return;
    this.buildPeaks();
    this.buildStems();
    this.buildRings();
    this.buildGlow();
    this.placeBeam();
    this.dirty = true;
  }

  setSlice(s: SceneSlice) {
    const texChanged = s.texture !== this.sliceState.texture;
    this.sliceState = s;
    if (texChanged) {
      this.sliceTex?.dispose();
      this.sliceTex = null;
      if (s.texture) {
        const tex = new THREE.CanvasTexture(s.texture);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        this.sliceTex = tex;
      }
      this.sliceTexMesh.material.map = this.sliceTex;
      this.sliceTexMesh.material.needsUpdate = true;
    }
    this.placeSlice();
    this.dirty = true;
  }

  setArcs(arcs: SceneArc[]) {
    for (const child of [...this.arcs.children]) {
      this.arcs.remove(child);
      const l = child as Line2 | THREE.Sprite;
      if (!(l instanceof THREE.Sprite)) l.geometry.dispose();
      l.material.dispose();
    }
    for (const a of arcs) {
      const p0 = this.world(a.from);
      const p1 = this.world(a.to);
      const lift = 0.45 + 0.14 * p0.distanceTo(p1);
      const c0 = p0.clone().add(new THREE.Vector3(0, lift, 0));
      const c1 = p1.clone().add(new THREE.Vector3(0, lift, 0));
      const curve = new THREE.CubicBezierCurve3(p0, c0, c1, p1);
      const pts: number[] = [];
      for (const v of curve.getPoints(48)) pts.push(v.x, v.y, v.z);
      const under = new Line2(
        new LineGeometry().setPositions(pts),
        new LineMaterial({ color: a.color, linewidth: 6, transparent: true, opacity: this.theme.dark ? 0.24 : 0.13, depthWrite: false, fog: true }),
      );
      under.renderOrder = 7;
      const core = new Line2(
        new LineGeometry().setPositions(pts),
        new LineMaterial({ color: a.color, linewidth: 1.9, transparent: true, opacity: 0.95, dashed: a.dashed, dashSize: 0.2, gapSize: 0.14, fog: true }),
      );
      if (a.dashed) core.computeLineDistances();
      core.renderOrder = 8;
      this.arcs.add(under, core);
      if (a.openEnd) {
        // hollow marker where the partner peak would be (measured in another spectrum)
        const ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.hoverTex, color: a.color, transparent: true, depthWrite: false }));
        ring.position.copy(p1);
        ring.scale.setScalar(0.34);
        ring.renderOrder = 8;
        this.arcs.add(ring);
      }
    }
    this.dirty = true;
  }

  setLabels(labels: SceneLabel[]) {
    this.labels = labels;
    this.dirty = true;
  }

  setSpin(on: boolean) {
    if (on && reducedMotion()) on = false;
    if (on === this.spin) return;
    this.spin = on;
    if (on) this.rebaseSway();
    this.dirty = true;
  }

  // ------------------------------------------------------------------ building
  private buildBox() {
    for (const w of this.walls) {
      this.furniture.remove(w.mesh, w.grid);
      w.mesh.geometry.dispose();
      w.grid.geometry.dispose();
    }
    this.walls = [];
    if (this.frame) {
      this.furniture.remove(this.frame);
      this.frame.geometry.dispose();
    }
    const { W, H, D } = BOX;
    const t = this.axes.ticks;
    const sides: ("x-" | "x+" | "z-" | "z+")[] = ["x-", "x+", "z-", "z+"];
    for (const side of sides) {
      const isX = side[0] === "x";
      const sgn = side[1] === "+" ? 1 : -1;
      const geo = new THREE.PlaneGeometry(isX ? D : W, H);
      if (isX) geo.rotateY(Math.PI / 2);
      const mesh = new THREE.Mesh(geo, this.wallMat);
      mesh.position.set(isX ? (sgn * W) / 2 : 0, H / 2, isX ? 0 : (sgn * D) / 2);
      mesh.renderOrder = -1;
      const pos: number[] = [];
      if (isX) {
        const x = (sgn * W) / 2;
        for (const n of t.n) pos.push(x, 0, this.Z(n), x, H, this.Z(n));
        for (const c of t.c) pos.push(x, this.Y(c), -D / 2, x, this.Y(c), D / 2);
      } else {
        const z = (sgn * D) / 2;
        for (const h of t.h) pos.push(this.X(h), 0, z, this.X(h), H, z);
        for (const c of t.c) pos.push(-W / 2, this.Y(c), z, W / 2, this.Y(c), z);
      }
      const grid = new LineSegments2(new LineSegmentsGeometry().setPositions(pos.length ? pos : [0, 0, 0, 0, 0, 0]), this.gridMat);
      grid.renderOrder = 0;
      this.furniture.add(mesh, grid);
      this.walls.push({ mesh, grid, side });
    }
    const e: number[] = [];
    const corners = [
      [-W / 2, -D / 2],
      [W / 2, -D / 2],
      [W / 2, D / 2],
      [-W / 2, D / 2],
    ];
    for (let k = 0; k < 4; k++) {
      const [x0, z0] = corners[k];
      const [x1, z1] = corners[(k + 1) % 4];
      e.push(x0, 0, z0, x1, 0, z1, x0, H, z0, x1, H, z1, x0, 0, z0, x0, H, z0);
    }
    this.frame = new LineSegments2(new LineSegmentsGeometry().setPositions(e), this.frameMat);
    this.frame.renderOrder = 1;
    this.furniture.add(this.frame);
  }

  private buildPeaks() {
    for (const m of [this.litMesh, this.ghostMesh]) {
      if (!m) continue;
      this.scene.remove(m);
      m.dispose();
    }
    this.litMesh = this.ghostMesh = null;
    const d = this.data;
    if (!d) return;
    const lit: number[] = [];
    const ghost: number[] = [];
    d.peaks.forEach((_, k) => ((this.hl.lit == null || this.hl.lit[k]) ? lit : ghost).push(k));
    const make = (idx: number[], mat: THREE.Material, order: number) => {
      const mesh = new THREE.InstancedMesh(this.sphereGeo, mat, Math.max(1, idx.length));
      mesh.count = idx.length;
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      const col = new THREE.Color();
      idx.forEach((k, j) => {
        const p = d.peaks[k];
        this.tmp.set(this.peakPos[k * 3], this.peakPos[k * 3 + 1], this.peakPos[k * 3 + 2]);
        s.setScalar(p.r);
        m.compose(this.tmp, q, s);
        mesh.setMatrixAt(j, m);
        mesh.setColorAt(j, col.set(p.color));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      this.scene.add(mesh);
      return mesh;
    };
    this.litMesh = make(lit, this.litMat, 2);
    this.ghostMesh = make(ghost, this.ghostMat, 1);
  }

  private buildStems() {
    for (const s of this.stems) {
      this.scene.remove(s);
      s.geometry.dispose();
    }
    this.stems = [];
    const d = this.data;
    if (!d) return;
    const litAmide = new Uint8Array(d.amides.length);
    d.peaks.forEach((p, k) => {
      if (this.hl.lit == null || this.hl.lit[k]) litAmide[p.amide] = 1;
    });
    const stem = new THREE.Color(this.theme.stem);
    const base = new THREE.Color(this.theme.surface).lerp(stem, 0.12);
    for (const solid of [true, false]) {
      const pos: number[] = [];
      const col: number[] = [];
      d.amides.forEach((a, k) => {
        if (a.top == null || !!litAmide[k] !== solid) return;
        const x = this.X(a.h);
        const z = this.Z(a.n);
        pos.push(x, 0.01, z, x, this.Y(a.top), z);
        col.push(base.r, base.g, base.b, stem.r, stem.g, stem.b);
      });
      if (!pos.length) continue;
      const g = new LineSegmentsGeometry().setPositions(pos);
      g.setColors(col);
      const line = new LineSegments2(g, solid ? this.stemMat : this.stemGhostMat);
      line.renderOrder = solid ? 2 : 1;
      this.scene.add(line);
      this.stems.push(line);
    }
  }

  private buildRings() {
    for (const m of [this.rings, this.halos]) {
      if (!m) continue;
      this.scene.remove(m);
      m.dispose();
    }
    this.rings = this.halos = null;
    const d = this.data;
    if (!d || !d.amides.length) return;
    const n = d.amides.length;
    const rings = new THREE.InstancedMesh(this.discGeo, this.ringMat, n);
    const halos = new THREE.InstancedMesh(this.discGeo, this.haloMat, n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const col = new THREE.Color();
    const surface = new THREE.Color(this.theme.surface);
    d.amides.forEach((a, k) => {
      const sel = this.hl.selectedAmide === k;
      const r = RING_R * (sel ? 1.55 : a.faded ? 0.8 : 1);
      this.tmp.set(this.X(a.h), 0.006, this.Z(a.n));
      m.compose(this.tmp, q, s.set(r * 2.6, 1, r * 2.6));
      rings.setMatrixAt(k, m);
      col.set(a.color);
      if (a.faded) col.lerp(surface, 0.55);
      rings.setColorAt(k, col);
      m.compose(this.tmp.setY(0.004), q, s.set(r * 3.4, 1, r * 3.4));
      halos.setMatrixAt(k, m);
    });
    for (const mesh of [halos, rings]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
    }
    if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
    halos.renderOrder = -1;
    rings.renderOrder = 0;
    this.rings = rings;
    this.halos = halos;
  }

  private buildGlow() {
    if (this.glow) {
      this.scene.remove(this.glow);
      this.glow.geometry.dispose();
      this.glow = null;
    }
    const d = this.data;
    const g = this.hl.glow;
    if (!d || !g) return;
    const pos: number[] = [];
    const col: number[] = [];
    const size: number[] = [];
    const c = new THREE.Color();
    d.peaks.forEach((p, k) => {
      if (!g[k]) return;
      pos.push(this.peakPos[k * 3], this.peakPos[k * 3 + 1], this.peakPos[k * 3 + 2]);
      c.set(p.color);
      col.push(c.r, c.g, c.b);
      size.push(p.r * 5.2 + 0.25);
    });
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("glowColor", new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute("glowSize", new THREE.Float32BufferAttribute(size, 1));
    this.glow = new THREE.Points(geo, this.glowMat);
    this.glow.renderOrder = 5;
    this.glow.frustumCulled = false;
    this.scene.add(this.glow);
  }

  private placeBeam() {
    if (this.arrows) {
      this.scene.remove(this.arrows);
      this.arrows.dispose();
      this.arrows = null;
    }
    const k = this.hl.selectedAmide;
    const a = k != null ? this.data?.amides[k] : undefined;
    if (!a) {
      this.beam.visible = this.beamCore.visible = false;
      return;
    }
    const x = this.X(a.h);
    const z = this.Z(a.n);
    this.beam.position.set(x, BOX.H / 2, z);
    this.beam.scale.set(1, BOX.H, 1);
    this.beam.material.uniforms.uHeight.value = 1;
    this.beam.visible = true;
    const top = a.top != null ? Math.min(BOX.H, this.Y(a.top) + 0.6) : BOX.H * 0.6;
    this.beamCore.geometry.setPositions([x, 0.01, z, x, top, z]);
    this.beamCore.visible = true;
    // slender arrows (as in the classic cube figure) pointing up at each peak of the strip
    const own = this.data!.peaks.map((p, i) => ({ p, i })).filter(({ p }) => p.amide === k);
    if (own.length) {
      const mesh = new THREE.InstancedMesh(this.arrowGeo, this.arrowMat, own.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const one = new THREE.Vector3(1, 1, 1);
      own.forEach(({ p, i }, j) => {
        this.tmp.set(this.peakPos[i * 3], this.peakPos[i * 3 + 1] - p.r - 0.1, this.peakPos[i * 3 + 2]);
        m.compose(this.tmp, q, one);
        mesh.setMatrixAt(j, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      this.arrows = mesh;
      this.scene.add(mesh);
    }
  }

  private placeSlice() {
    const s = this.sliceState;
    if (!s.axis || !this.data) {
      this.sliceGroup.visible = false;
      return;
    }
    const { W, H, D } = BOX;
    this.sliceGroup.visible = true;
    const tint = this.sliceTint;
    const texMesh = this.sliceTexMesh;
    texMesh.visible = !!this.sliceTex && s.textureAt != null;
    if (s.axis === "n") {
      const z = this.Z(s.at);
      tint.rotation.set(0, 0, 0);
      tint.position.set(0, H / 2, z);
      tint.scale.set(W, H, 1);
      if (s.textureAt != null) {
        texMesh.rotation.set(0, 0, 0);
        texMesh.position.set(0, H / 2, this.Z(s.textureAt) + 0.003);
        texMesh.scale.set(W, H, 1);
      }
      this.sliceBorder.geometry.setPositions([-W / 2, 0, z, W / 2, 0, z, W / 2, 0, z, W / 2, H, z, W / 2, H, z, -W / 2, H, z, -W / 2, H, z, -W / 2, 0, z]);
    } else {
      const y = this.Y(s.at);
      tint.rotation.set(-Math.PI / 2, 0, 0);
      tint.position.set(0, y, 0);
      tint.scale.set(W, D, 1);
      if (s.textureAt != null) {
        texMesh.rotation.set(-Math.PI / 2, 0, 0);
        texMesh.position.set(0, this.Y(s.textureAt) + 0.003, 0);
        texMesh.scale.set(W, D, 1);
      }
      this.sliceBorder.geometry.setPositions([-W / 2, y, -D / 2, W / 2, y, -D / 2, W / 2, y, -D / 2, W / 2, y, D / 2, W / 2, y, D / 2, -W / 2, y, D / 2, -W / 2, y, D / 2, -W / 2, y, -D / 2]);
    }
    this.placeHandle();
  }

  /** The drag handle sits on the top edge of a ¹⁵N plane, or at the ¹³C plane's corner nearest the camera. */
  private handleAnchor(): { at: THREE.Vector3; base: THREE.Vector3; axis: THREE.Vector3 } | null {
    const s = this.sliceState;
    if (!s.axis) return null;
    const { W, H, D } = BOX;
    if (s.axis === "n") {
      const z = this.Z(s.at);
      return { at: new THREE.Vector3(0, H + 0.55, z), base: new THREE.Vector3(0, H, z), axis: new THREE.Vector3(0, 0, 1) };
    }
    const y = this.Y(s.at);
    const sx = this.camera.position.x >= 0 ? 1 : -1;
    const sz = this.camera.position.z >= 0 ? 1 : -1;
    const base = new THREE.Vector3((sx * W) / 2, y, (sz * D) / 2);
    return { at: base.clone().add(new THREE.Vector3(sx * 0.42, 0, sz * 0.42)), base, axis: new THREE.Vector3(0, 1, 0) };
  }

  private placeHandle() {
    const h = this.handleAnchor();
    if (!h) return;
    this.handle.position.copy(h.at);
    const dir = h.at.clone().sub(h.base).normalize();
    const tip = h.at.clone().addScaledVector(dir, -0.19);
    this.stalk.geometry.setPositions([h.base.x, h.base.y, h.base.z, tip.x, tip.y, tip.z]);
    this.handle.scale.setScalar(this.overHandle || this.dragging ? 1.25 : 1);
  }

  private buildGizmo() {
    const up = new THREE.Vector3(0, 1, 0);
    for (const dir of [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]) {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 10), this.gizmoMat);
      shaft.quaternion.setFromUnitVectors(up, dir);
      shaft.position.copy(dir).multiplyScalar(0.5);
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.3, 16), this.gizmoMat);
      head.quaternion.setFromUnitVectors(up, dir);
      head.position.copy(dir).multiplyScalar(1.1);
      this.gizmo.add(shaft, head);
    }
    this.gizmo.add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), this.gizmoMat));
    this.gizmoScene.add(this.gizmo);
    this.gizmoCamera.position.set(0, 0, 5);
    this.gizmoCamera.lookAt(0, 0, 0);
  }

  // ------------------------------------------------------------------ camera
  private spherical(): Spherical {
    const o = this.camera.position.clone().sub(this.controls.target);
    const r = o.length() || 1;
    return { r, theta: Math.atan2(o.x, o.z), phi: Math.acos(THREE.MathUtils.clamp(o.y / r, -1, 1)) };
  }

  private placeCamera(target: THREE.Vector3, s: Spherical) {
    const sp = Math.sin(s.phi);
    this.camera.position.set(target.x + s.r * sp * Math.sin(s.theta), target.y + s.r * Math.cos(s.phi), target.z + s.r * sp * Math.cos(s.theta));
    this.camera.lookAt(target);
  }

  /** Camera pose that centres the box (with room for its labels) and fills ~90% of the view. */
  private fitPose(base: THREE.Vector3, theta: number, phi: number, fov = FOV.home, fill = 0.9, below = 0.1): { target: THREE.Vector3; r: number } {
    const saveFov = this.camera.fov;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    const { W, H, D } = BOX;
    const pts: THREE.Vector3[] = [];
    for (const x of [-W / 2 - 0.5, W / 2 + 0.5]) for (const y of [-below, H + 0.8]) for (const z of [-D / 2 - 0.5, D / 2 + 0.5]) pts.push(new THREE.Vector3(x, y, z));
    const save = { pos: this.camera.position.clone(), quat: this.camera.quaternion.clone() };
    const target = base.clone();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    let r = 32;
    for (let it = 0; it < 6; it++) {
      this.placeCamera(target, { r, theta, phi });
      this.camera.updateMatrixWorld(true);
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      let behind = false;
      for (const p of pts) {
        const v = p.clone().project(this.camera);
        if (v.z > 1) {
          behind = true;
          break;
        }
        x0 = Math.min(x0, v.x);
        x1 = Math.max(x1, v.x);
        y0 = Math.min(y0, v.y);
        y1 = Math.max(y1, v.y);
      }
      if (behind) {
        r *= 1.6;
        continue;
      }
      // re-centre by sliding the target in the camera plane, then scale the distance
      right.setFromMatrixColumn(this.camera.matrixWorld, 0);
      up.setFromMatrixColumn(this.camera.matrixWorld, 1);
      target.addScaledVector(right, ((x0 + x1) / 2) * r * tanHalf * this.camera.aspect).addScaledVector(up, ((y0 + y1) / 2) * r * tanHalf);
      r *= Math.max(0.6, Math.min(1.8, Math.max(x1 - x0, y1 - y0) / 2 / fill));
    }
    this.camera.position.copy(save.pos);
    this.camera.quaternion.copy(save.quat);
    this.camera.updateMatrixWorld(true);
    this.camera.fov = saveFov;
    this.camera.updateProjectionMatrix();
    return { target, r };
  }

  private fitHome() {
    const pose = this.fitPose(HOME_BASE, HOME.theta, HOME.phi);
    this.homeTarget.copy(pose.target);
    this.homeR = pose.r;
  }

  private presetPose(preset: CubePreset): { target: THREE.Vector3; s: Spherical; fov: number } {
    // the flat views use a long lens so they read like the 2D spectra (no parallax)
    if (preset === "top") {
      const pose = this.fitPose(new THREE.Vector3(0, 0, 0), 0, 0.0001, FOV.flat, 0.84);
      return { target: pose.target, s: { r: pose.r, theta: 0, phi: 0.0001 }, fov: FOV.flat };
    }
    if (preset === "face") {
      const pose = this.fitPose(new THREE.Vector3(0, BOX.H / 2, 0), 0, Math.PI / 2, FOV.flat, 0.86, 1.2);
      return { target: pose.target, s: { r: pose.r, theta: 0, phi: Math.PI / 2 }, fov: FOV.flat };
    }
    this.fitHome();
    return { target: this.homeTarget.clone(), s: { r: this.homeR, theta: HOME.theta, phi: HOME.phi }, fov: FOV.home };
  }

  private applyHome() {
    this.needsHome = false;
    this.fitHome();
    this.controls.target.copy(this.homeTarget);
    this.setFov(FOV.home);
    this.placeCamera(this.homeTarget, { r: this.homeR, theta: HOME.theta, phi: HOME.phi });
    this.controls.update();
    this.rebaseSway();
    this.dirty = true;
  }

  private setFov(fov: number) {
    if (this.camera.fov === fov) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.glowMat.uniforms.uScale.value = (this.height * this.renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)));
  }

  view(preset: CubePreset, animate = true) {
    const { target, s, fov } = this.presetPose(preset);
    this.animateTo(target, s, animate ? 1000 : 0, fov);
  }

  /** Ease towards a strip (keeps the viewing angle, pulls in a little). */
  focus(p: CubePoint | null) {
    if (!p || !this.data) return;
    const strip = this.world(p);
    const target = this.homeTarget.clone().lerp(strip, 0.5);
    const s = this.spherical();
    // same apparent pull-in whatever lens is on
    const lens = Math.tan(THREE.MathUtils.degToRad(FOV.home / 2)) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.animateTo(target, { ...s, r: Math.min(s.r, this.homeR * 0.9 * lens) }, 850);
  }

  private animateTo(target: THREE.Vector3, to: Spherical, dur: number, fov = this.camera.fov) {
    if (reducedMotion()) dur = 0;
    const from = this.spherical();
    // rotate the short way round
    let dt = to.theta - from.theta;
    while (dt > Math.PI) dt -= 2 * Math.PI;
    while (dt < -Math.PI) dt += 2 * Math.PI;
    to = { ...to, theta: from.theta + dt };
    if (dur <= 0) {
      this.controls.target.copy(target);
      this.setFov(fov);
      this.placeCamera(target, to);
      this.controls.update();
      this.anim = null;
      this.rebaseSway();
      this.dirty = true;
      return;
    }
    this.anim = { t0: performance.now(), dur, fromT: this.controls.target.clone(), toT: target.clone(), from, to, fromFov: this.camera.fov, toFov: fov };
  }

  private rebaseSway() {
    this.sway = { t0: performance.now(), theta: this.spherical().theta };
  }

  // ------------------------------------------------------------------ picking
  private ray(px: number, py: number) {
    this.raycaster.setFromCamera(new THREE.Vector2((px / this.width) * 2 - 1, -(py / this.height) * 2 + 1), this.camera);
    return this.raycaster.ray;
  }

  private hitHandle(px: number, py: number): boolean {
    if (!this.sliceGroup.visible) return false;
    const ray = this.ray(px, py);
    const c = this.handle.position;
    const R = 0.19 * 1.9;
    return ray.distanceSqToPoint(c) < R * R;
  }

  pick(px: number, py: number): CubeTarget {
    const d = this.data;
    if (!d) return null;
    const ray = this.ray(px, py);
    const o = ray.origin;
    const dir = ray.direction;
    let best = -1;
    let bestT = Infinity;
    let bestLit = false;
    for (let k = 0; k < d.peaks.length; k++) {
      const lit = this.hl.lit == null || !!this.hl.lit[k];
      const R = Math.max(d.peaks[k].r * 1.25, 0.12);
      const ox = o.x - this.peakPos[k * 3];
      const oy = o.y - this.peakPos[k * 3 + 1];
      const oz = o.z - this.peakPos[k * 3 + 2];
      const b = ox * dir.x + oy * dir.y + oz * dir.z;
      const disc = b * b - (ox * ox + oy * oy + oz * oz - R * R);
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t <= 0) continue;
      // solid peaks win over ghosts sitting in front of them
      if ((lit && !bestLit) || (lit === bestLit && t < bestT)) {
        best = k;
        bestT = t;
        bestLit = lit;
      }
    }
    // amide rings on the floor
    let ring = -1;
    if (dir.y < -1e-6) {
      const t = -o.y / dir.y;
      const fx = o.x + dir.x * t;
      const fz = o.z + dir.z * t;
      let bd = (RING_R * 1.6) ** 2;
      d.amides.forEach((a, k) => {
        const dx = this.X(a.h) - fx;
        const dz = this.Z(a.n) - fz;
        const dd = dx * dx + dz * dz;
        if (dd < bd) {
          bd = dd;
          ring = k;
        }
      });
      if (ring >= 0 && best >= 0 && bestT < t) ring = -1;
    }
    if (ring >= 0) return { kind: "amide", index: ring };
    if (best >= 0) return { kind: "peak", index: best };
    return null;
  }

  private setHover(t: CubeTarget, pinned = false) {
    this.pinned = pinned && !!t;
    const same = t?.kind === this.hover?.kind && t?.index === this.hover?.index;
    if (same) return;
    this.hover = t;
    this.updateHoverRing();
    this.cb.onHover(t);
    this.dirty = true;
  }

  private updateHoverRing() {
    const t = this.hover;
    const d = this.data;
    if (!t || !d) {
      this.hoverRing.visible = false;
      return;
    }
    if (t.kind === "peak") {
      const k = t.index;
      this.hoverRing.position.set(this.peakPos[k * 3], this.peakPos[k * 3 + 1], this.peakPos[k * 3 + 2]);
      this.hoverRing.scale.setScalar(d.peaks[k].r * 3.4 + 0.12);
    } else {
      const a = d.amides[t.index];
      this.hoverRing.position.set(this.X(a.h), 0.02, this.Z(a.n));
      this.hoverRing.scale.setScalar(RING_R * 4);
    }
    this.hoverRing.visible = true;
  }

  /** Screen position (CSS px) of the hovered target. */
  anchorOf(t: CubeTarget): { x: number; y: number; visible: boolean; w: number; h: number } | null {
    const d = this.data;
    if (!t || !d) return null;
    if (t.kind === "peak") this.tmp.set(this.peakPos[t.index * 3], this.peakPos[t.index * 3 + 1], this.peakPos[t.index * 3 + 2]);
    else {
      const a = d.amides[t.index];
      if (!a) return null;
      this.tmp.set(this.X(a.h), 0, this.Z(a.n));
    }
    const s = this.toScreen(this.tmp);
    return { x: s.x, y: s.y, visible: s.ok, w: this.width, h: this.height };
  }

  clearHover() {
    this.setHover(null);
  }

  private local(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onPointerDown = (e: PointerEvent) => {
    const { x, y } = this.local(e);
    this.pointer.downX = x;
    this.pointer.downY = y;
    this.pointer.downT = performance.now();
    this.pointer.type = e.pointerType;
    if (this.hitHandle(x, y)) {
      // keep OrbitControls out of it: the handle drags the slice plane
      e.stopImmediatePropagation();
      e.preventDefault();
      this.dragging = true;
      this.anim = null;
      if (this.spin) {
        this.spin = false;
        this.cb.onSpinChange(false);
      }
      this.renderer.domElement.setPointerCapture(e.pointerId);
      this.renderer.domElement.style.cursor = "grabbing";
      this.placeHandle();
      this.dirty = true;
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    const { x, y } = this.local(e);
    if (this.dragging) {
      this.dragTo(x, y);
      return;
    }
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.inside = true;
    this.pointer.pending = true;
    this.pointer.type = e.pointerType;
  };

  private onPointerUp = (e: PointerEvent) => {
    const { x, y } = this.local(e);
    if (this.dragging) {
      this.dragging = false;
      if (this.renderer.domElement.hasPointerCapture(e.pointerId)) this.renderer.domElement.releasePointerCapture(e.pointerId);
      this.renderer.domElement.style.cursor = "";
      this.placeHandle();
      this.dirty = true;
      return;
    }
    if (e.type === "pointercancel") return;
    const moved = Math.hypot(x - this.pointer.downX, y - this.pointer.downY);
    if (moved > 6 || performance.now() - this.pointer.downT > 650) return;
    const hit = this.pick(x, y);
    // touch: a tap both shows the card and selects
    this.setHover(hit, e.pointerType !== "mouse");
    this.cb.onSelect(hit);
  };

  private onPointerLeave = () => {
    this.pointer.inside = false;
    if (!this.pinned && !this.dragging) this.setHover(null);
    if (this.overHandle) {
      this.overHandle = false;
      this.placeHandle();
      this.dirty = true;
    }
  };

  private dragTo(px: number, py: number) {
    const h = this.handleAnchor();
    if (!h) return;
    const ray = this.ray(px, py);
    // closest point between the pointer ray and the handle's line of travel
    const w0 = h.at.clone().sub(ray.origin);
    const b = h.axis.dot(ray.direction);
    const d = h.axis.dot(w0);
    const e = ray.direction.dot(w0);
    const den = 1 - b * b;
    if (den < 1e-4) return;
    const t = (b * e - d) / den;
    const s = this.sliceState;
    if (s.axis === "n") {
      const z = THREE.MathUtils.clamp(h.at.z + t, -BOX.D / 2, BOX.D / 2);
      const [lo, hi] = this.axes.n;
      this.cb.onSliceDrag(lo + ((z + BOX.D / 2) / BOX.D) * (hi - lo));
    } else {
      const yy = THREE.MathUtils.clamp(h.at.y + t, 0, BOX.H);
      const [lo, hi] = this.axes.c;
      this.cb.onSliceDrag(lo + (yy / BOX.H) * (hi - lo));
    }
  }

  // ------------------------------------------------------------------ frame
  private resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    if (w < 2 || h < 2) return;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const dpr = this.renderer.getPixelRatio();
    this.glowMat.uniforms.uScale.value = (h * dpr) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    if (this.data && this.needsHome) this.applyHome();
    else if (!this.anim) this.fitHome();
    this.dirty = true;
  }

  private toScreen(v: THREE.Vector3) {
    const p = v.clone().project(this.camera);
    return { x: ((p.x + 1) / 2) * this.width, y: ((1 - p.y) / 2) * this.height, ok: p.z > -1 && p.z < 1 };
  }

  private updateWalls() {
    const sx = this.camera.position.x >= 0 ? 1 : -1;
    const sz = this.camera.position.z >= 0 ? 1 : -1;
    for (const w of this.walls) {
      const far = w.side === (sx > 0 ? "x-" : "x+") || w.side === (sz > 0 ? "z-" : "z+");
      w.mesh.visible = w.grid.visible = far;
    }
    const s = this.spherical();
    this.fog.near = Math.max(0.1, s.r - 4);
    this.fog.far = s.r + 70;
    if (this.sliceState.axis === "c") this.placeHandle();
  }

  /** World coordinate halfway between the two ticks nearest the middle of an axis (keeps titles clear of tick labels). */
  private between(ticks: number[], axis: "h" | "n"): number {
    const f = axis === "h" ? (v: number) => this.X(v) : (v: number) => this.Z(v);
    if (ticks.length < 2) return 0;
    const pos = ticks.map(f).sort((a, b) => a - b);
    let best = Infinity;
    for (let k = 0; k < pos.length - 1; k++) {
      const m = (pos[k] + pos[k + 1]) / 2;
      if (Math.abs(m) < Math.abs(best)) best = m;
    }
    return Number.isFinite(best) ? best : 0;
  }

  private layoutOverlay() {
    const P = this.pool;
    P.begin();
    const d = this.data;
    if (d) {
      const { W, H, D } = BOX;
      const cam = this.camera.position;
      const sz = cam.z >= 0 ? 1 : -1;
      const sx = cam.x > 0.25 ? 1 : -1;
      const v = new THREE.Vector3();
      const w = new THREE.Vector3();
      const step = (ts: number[]) => (ts.length > 1 ? Math.abs(ts[1] - ts[0]) : 1);
      /** screen position of p, the unit screen direction of `dir` from it, and the screen angle of `along` */
      const frame = (p: THREE.Vector3, dir: THREE.Vector3, along: THREE.Vector3) => {
        const s0 = this.toScreen(p);
        const s1 = this.toScreen(w.copy(p).add(dir));
        const s2 = this.toScreen(w.copy(p).add(along));
        const L = Math.hypot(s1.x - s0.x, s1.y - s0.y) || 1;
        let ang = (Math.atan2(s2.y - s0.y, s2.x - s0.x) * 180) / Math.PI;
        if (ang >= 90) ang -= 180;
        if (ang < -90) ang += 180;
        return { x: s0.x, y: s0.y, ux: (s1.x - s0.x) / L, uy: (s1.y - s0.y) / L, ang, ok: s0.ok };
      };
      const edgePx = (a: THREE.Vector3, b: THREE.Vector3) => {
        const sa = this.toScreen(a);
        const sb = this.toScreen(b);
        return Math.hypot(sa.x - sb.x, sa.y - sb.y);
      };
      // ¹H along the floor edge nearest the camera, ¹⁵N along the nearest side edge
      const zE = (sz * D) / 2;
      const xE = (sx * W) / 2;
      const floorAxes = [
        { key: "h" as const, ok: edgePx(v.set(-W / 2, 0, zE), new THREE.Vector3(W / 2, 0, zE)) > 80, at: (t: number) => v.set(this.X(t), 0, zE), out: new THREE.Vector3(0, 0, sz), along: new THREE.Vector3(1, 0, 0) },
        { key: "n" as const, ok: edgePx(v.set(xE, 0, -D / 2), new THREE.Vector3(xE, 0, D / 2)) > 80, at: (t: number) => v.set(xE, 0, this.Z(t)), out: new THREE.Vector3(sx, 0, 0), along: new THREE.Vector3(0, 0, 1) },
      ];
      for (const ax of floorAxes) {
        if (!ax.ok) continue;
        const ticks = this.axes.ticks[ax.key];
        const st = step(ticks);
        let last: { x: number; y: number } | null = null;
        for (const t of ticks) {
          const o = frame(ax.at(t), ax.out, ax.along);
          const x = o.x + o.ux * 14;
          const y = o.y + o.uy * 14;
          // thin out labels that would touch on a foreshortened edge
          if (!o.ok || (last && Math.hypot(x - last.x, y - last.y) < 26)) continue;
          P.put(formatTick(t, st), "spx-cubeTick", x, y);
          last = { x, y };
        }
        const mid = this.between(ticks, ax.key);
        const o = frame(ax.key === "h" ? v.set(mid, 0, zE) : v.set(xE, 0, mid), ax.out, ax.along);
        if (o.ok) P.put(this.axes.titles[ax.key], "spx-cubeTitle", o.x + o.ux * 42, o.y + o.uy * 42, "center", ` rotate(${o.ang.toFixed(1)}deg)`);
      }
      // ¹³C on the vertical edge at the left of the silhouette
      let bestX = Infinity;
      let corner: [number, number] = [-W / 2, D / 2];
      for (const [x, z] of [
        [-W / 2, -D / 2],
        [W / 2, -D / 2],
        [W / 2, D / 2],
        [-W / 2, D / 2],
      ] as [number, number][]) {
        const s = this.toScreen(v.set(x, H / 2, z));
        if (s.x < bestX) {
          bestX = s.x;
          corner = [x, z];
        }
      }
      if (edgePx(v.set(corner[0], 0, corner[1]), new THREE.Vector3(corner[0], H, corner[1])) > 80) {
        const st = step(this.axes.ticks.c);
        let lastY = -Infinity;
        for (const t of [...this.axes.ticks.c].reverse()) {
          const s = this.toScreen(v.set(corner[0], this.Y(t), corner[1]));
          if (!s.ok || s.y - lastY < 15) continue;
          P.put(formatTick(t, st), "spx-cubeTick", s.x - 9, s.y, "right");
          lastY = s.y;
        }
        const s = this.toScreen(v.set(corner[0], H / 2, corner[1]));
        if (s.ok) P.put(this.axes.titles.c, "spx-cubeTitle", Math.max(12, s.x - 40), s.y, "center", " rotate(-90deg)");
      }
      // slice handle read-out
      const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
      if (this.sliceGroup.visible && this.sliceState.label) {
        const s = this.toScreen(this.handle.position);
        if (s.ok) {
          P.put(this.sliceState.label, "spx-cubeHandle", s.x + 16, s.y, "left");
          placed.push({ x0: s.x + 14, x1: s.x + 26 + this.sliceState.label.length * 7, y0: s.y - 10, y1: s.y + 10 });
        }
      }
      // labels supplied by the view: peak labels stay on their peaks (tried right, left, above,
      // below); residue tags give way and are dropped when there is no room
      const rank = (l: SceneLabel) => (l.className.includes("spx-cubeMain") ? 0 : l.className.includes("spx-cubePeakLabel") ? 1 : 2);
      const items = this.labels
        .map((l) => {
          const s = this.toScreen(this.world(l.at, v));
          return { l, x: s.x, y: s.y, ok: s.ok };
        })
        .filter((i) => i.ok)
        .sort((a, b) => rank(a.l) - rank(b.l) || a.y - b.y);
      for (const it of items) {
        const peak = rank(it.l) < 2;
        const wpx = it.l.text.length * (peak ? 7 : 6.4) + (peak ? 14 : 4);
        const hpx = peak ? 19 : 15;
        const dx = it.l.dx ?? 0;
        const dy = it.l.dy ?? 0;
        const cands: [number, number, "left" | "right" | "center"][] = peak
          ? [
              [dx, 0, "left"],
              [-dx, 0, "right"],
              [dx, -hpx, "left"],
              [dx, hpx, "left"],
              [-dx, -hpx, "right"],
              [-dx, hpx, "right"],
            ]
          : [
              [0, dy, "center"],
              [0, dy - hpx, "center"],
              [dx || 12, dy, "left"],
            ];
        let spot: { x: number; y: number; align: "left" | "right" | "center"; box: { x0: number; x1: number; y0: number; y1: number } } | null = null;
        for (const [cx, cy, align] of cands) {
          const x = it.x + cx;
          const y = it.y + cy;
          const x0 = align === "left" ? x : align === "right" ? x - wpx : x - wpx / 2;
          const box = { x0, x1: x0 + wpx, y0: y - hpx / 2, y1: y + hpx / 2 };
          if (placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) continue;
          spot = { x, y, align, box };
          break;
        }
        if (!spot) {
          if (!peak) continue;
          const [cx, cy, align] = cands[0];
          const x0 = align === "left" ? it.x + cx : it.x + cx - wpx;
          spot = { x: it.x + cx, y: it.y + cy, align, box: { x0, x1: x0 + wpx, y0: it.y - hpx / 2, y1: it.y + hpx / 2 } };
        }
        placed.push(spot.box);
        P.put(it.l.text, it.l.className, spot.x, spot.y, spot.align);
      }
    }
    // orientation gizmo labels on a ring around the gizmo (the gizmo is drawn in its corner
    // viewport; small stages skip it, the axis labels already orient the cube)
    if (!this.showGizmo()) {
      P.end();
      return;
    }
    const inv = this.camera.quaternion.clone().invert();
    const cx = 10 + 38;
    const cy = this.height - 10 - 38;
    const names = [
      ["¹H", new THREE.Vector3(-1, 0, 0)],
      ["¹³C", new THREE.Vector3(0, 1, 0)],
      ["¹⁵N", new THREE.Vector3(0, 0, 1)],
    ] as const;
    for (const [name, dir] of names) {
      const g = dir.clone().applyQuaternion(inv);
      const L = Math.hypot(g.x, g.y);
      if (L < 0.3) continue;
      P.put(name, "spx-cubeGizmo", cx + (g.x / L) * 33, cy - (g.y / L) * 33);
    }
    P.end();
  }

  private showGizmo() {
    return this.width >= 480 && this.height >= 300;
  }

  private render() {
    const r = this.renderer;
    r.render(this.scene, this.camera);
    if (!this.showGizmo()) return;
    // orientation gizmo, bottom-left
    const size = 76;
    this.gizmo.quaternion.copy(this.camera.quaternion).invert();
    r.autoClear = false;
    r.setScissorTest(true);
    r.setScissor(10, 10, size, size);
    r.setViewport(10, 10, size, size);
    r.clearDepth();
    r.render(this.gizmoScene, this.gizmoCamera);
    r.setScissorTest(false);
    r.setViewport(0, 0, this.width, this.height);
    r.autoClear = true;
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (!this.visible) return;
    let changed = false;
    const now = performance.now();
    if (this.anim) {
      const a = this.anim;
      const t = Math.min(1, (now - a.t0) / a.dur);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const target = a.fromT.clone().lerp(a.toT, e);
      this.controls.target.copy(target);
      // ease the apparent size, not the distance, so a lens change does not "breathe"
      const tan = (f: number) => Math.tan(THREE.MathUtils.degToRad(f / 2));
      const fov = a.fromFov + (a.toFov - a.fromFov) * e;
      const size = a.from.r * tan(a.fromFov) + (a.to.r * tan(a.toFov) - a.from.r * tan(a.fromFov)) * e;
      this.setFov(fov);
      this.placeCamera(target, {
        r: size / tan(fov),
        theta: a.from.theta + (a.to.theta - a.from.theta) * e,
        phi: a.from.phi + (a.to.phi - a.from.phi) * e,
      });
      if (t >= 1) {
        this.anim = null;
        this.rebaseSway();
      }
      changed = true;
    } else if (this.spin && !this.dragging) {
      const s = this.spherical();
      const t = (now - this.sway.t0) / 1000;
      this.placeCamera(this.controls.target, { ...s, theta: this.sway.theta + 0.5 * Math.sin((2 * Math.PI * t) / 28) });
      changed = true;
    }
    if (this.controls.update()) changed = true;
    if (this.pointer.pending && this.pointer.inside && this.pointer.type === "mouse" && !this.dragging) {
      this.pointer.pending = false;
      const over = this.hitHandle(this.pointer.x, this.pointer.y);
      if (over !== this.overHandle) {
        this.overHandle = over;
        this.placeHandle();
        changed = true;
      }
      const hit = over ? null : this.pick(this.pointer.x, this.pointer.y);
      if (!this.pinned) this.setHover(hit);
      this.renderer.domElement.style.cursor = over ? "grab" : hit ? "pointer" : "";
    }
    if (changed || this.dirty) {
      this.dirty = false;
      this.updateWalls();
      this.render();
      this.layoutOverlay();
      this.cb.onFrame();
    }
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.io?.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.onPointerDown, { capture: true });
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("pointercancel", this.onPointerUp);
    el.removeEventListener("pointerleave", this.onPointerLeave);
    this.controls.dispose();
    this.setArcs([]);
    const seen = new Set<object>();
    const free = (o: THREE.Object3D) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry && !seen.has(mesh.geometry)) {
        seen.add(mesh.geometry);
        mesh.geometry.dispose();
      }
      const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const m of mats) {
        if (seen.has(m)) continue;
        seen.add(m);
        m.dispose();
      }
      (o as THREE.InstancedMesh).dispose?.();
    };
    this.scene.traverse(free);
    this.gizmoScene.traverse(free);
    // shared resources that may not be in the scene right now
    for (const g of [this.sphereGeo, this.discGeo, this.arrowGeo]) g.dispose();
    for (const m of [
      this.litMat,
      this.ghostMat,
      this.stemMat,
      this.stemGhostMat,
      this.ringMat,
      this.haloMat,
      this.glowMat,
      this.gridMat,
      this.frameMat,
      this.wallMat,
      this.beamCoreMat,
      this.sliceBorderMat,
      this.arrowMat,
      this.gizmoMat,
    ])
      m.dispose();
    for (const t of [this.floorTex, this.sliceTex, this.ringTex, this.haloTex, this.hoverTex, this.wallTex, this.shadow.material.alphaMap, this.env]) t?.dispose();
    this.renderer.dispose();
    el.remove();
    this.pool.dispose();
  }
}
