// Imperative three.js molecular viewer: cartoon + instanced atoms/bonds, soft studio
// lighting with ground-truth ambient occlusion, analytic picking, camera animation and an
// orientation gizmo. React owns the overlay (hover card, labels) and calls into this class.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import type { Representation } from "@/lib/contract";
import type { PdbModel } from "@/lib/structure/pdb";
import { BACKBONE } from "./atomInfo";
import { buildCartoon, paintCartoon, type CartoonBuild } from "./cartoon";
import { ELEMENT_COLORS, SELECT_COLOR, mixHex } from "./palette";

export type HoverTarget = { kind: "atom"; atom: number; residue: number } | { kind: "residue"; residue: number } | null;

export interface ViewerStyle {
  representation: Representation;
  /** hex colour per model.residues index */
  residueColors: string[];
  /** residue indices to tint with highlightColor */
  highlight: Set<number>;
  highlightColor: string;
}

export interface ViewerCallbacks {
  onHover: (target: HoverTarget) => void;
  onSelect: (residueIndex: number | null) => void;
  onFrame: () => void;
  onSpinChange?: (spinning: boolean) => void;
}

const VDW: Record<string, number> = { H: 1.1, C: 1.7, N: 1.55, O: 1.52, S: 1.8, P: 1.8, SE: 1.9 };
const BALL: Record<string, number> = { H: 0.14, C: 0.25, N: 0.24, O: 0.23, S: 0.32, P: 0.3 };
const UP = new THREE.Vector3(0, 1, 0);

interface AtomLayer {
  mesh: THREE.InstancedMesh;
  atoms: Int32Array; // instance -> atom index
  radii: Float32Array; // display radius per instance
  instanceOf: Int32Array; // atom index -> instance (-1 = hidden)
}

/** Eigen-decomposition of a symmetric 3x3 matrix (Jacobi). Returns eigenvectors sorted by eigenvalue desc. */
function principalAxes(points: THREE.Vector3[]): THREE.Vector3[] {
  const c = new THREE.Vector3();
  for (const p of points) c.add(p);
  c.multiplyScalar(1 / Math.max(1, points.length));
  const a = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const p of points) {
    const d = [p.x - c.x, p.y - c.y, p.z - c.z];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) a[i][j] += d[i] * d[j];
  }
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) off += a[i][j] ** 2;
    if (off < 1e-12) break;
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-15) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const cs = 1 / Math.sqrt(t * t + 1);
        const sn = t * cs;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = cs * akp - sn * akq;
          a[k][q] = sn * akp + cs * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = cs * apk - sn * aqk;
          a[q][k] = sn * apk + cs * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = cs * vkp - sn * vkq;
          v[k][q] = sn * vkp + cs * vkq;
        }
      }
    }
  }
  const vals = [0, 1, 2].map((i) => ({ val: a[i][i], vec: new THREE.Vector3(v[0][i], v[1][i], v[2][i]).normalize() }));
  vals.sort((x, y) => y.val - x.val);
  return vals.map((x) => x.vec);
}

function makeHaloTexture(): THREE.CanvasTexture {
  const size = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const g = cv.getContext("2d")!;
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0.0, "rgba(255,255,255,0.0)");
  grd.addColorStop(0.42, "rgba(255,255,255,0.0)");
  grd.addColorStop(0.5, "rgba(255,255,255,0.95)");
  grd.addColorStop(0.62, "rgba(255,255,255,0.45)");
  grd.addColorStop(1.0, "rgba(255,255,255,0.0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class MolViewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private scene = new THREE.Scene();
  private overlay = new THREE.Scene();
  private gizmoScene = new THREE.Scene();
  private gizmoCamera = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 10);
  private gizmo = new THREE.Group();
  private composer: EffectComposer | null = null;
  private gtao: GTAOPass | null = null;
  private aoEnabled = true;
  private envTexture: THREE.Texture | null = null;
  private root = new THREE.Group();
  private model: PdbModel | null = null;
  private cartoon: CartoonBuild | null = null;
  private cartoonMesh: THREE.Mesh | null = null;
  private atomLayer: AtomLayer | null = null;
  private bondMesh: THREE.InstancedMesh | null = null;
  private selectionGroup = new THREE.Group();
  private previewGroup = new THREE.Group();
  private ensembleGroup = new THREE.Group();
  private ensembleMat = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.4, depthWrite: false, roughness: 0.6 });
  private previewResidue = -1;
  private previewAtoms: { atom: number; r: number }[] = [];
  private selectionAtoms: { atom: number; r: number }[] = [];
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private halo: THREE.Sprite;
  private haloTexture: THREE.CanvasTexture;
  private sphereGeo: THREE.BufferGeometry;
  private sphereGeoLow: THREE.BufferGeometry;
  private cylGeo: THREE.BufferGeometry;
  private cartoonMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.0, clearcoat: 0.12, clearcoatRoughness: 0.5 });
  private atomMat = new THREE.MeshPhysicalMaterial({ roughness: 0.3, metalness: 0.0, clearcoat: 0.35, clearcoatRoughness: 0.3 });
  private bondMat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.0 });
  private style: ViewerStyle | null = null;
  private selected: number | null = null;
  private hover: HoverTarget = null;
  private pinnedHover = false;
  private raf = 0;
  private dirty = true;
  private ro: ResizeObserver;
  private pointer = { x: 0, y: 0, inside: false, pending: false, downX: 0, downY: 0, downT: 0, type: "mouse" };
  private anim: { from: THREE.Vector3; to: THREE.Vector3; fromT: THREE.Vector3; toT: THREE.Vector3; t0: number; dur: number } | null = null;
  private homeView: { pos: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3 } | null = null;
  private raycaster = new THREE.Raycaster();
  private disposed = false;
  private bg = new THREE.Color("#ffffff");

  constructor(
    private host: HTMLElement,
    private cb: ViewerCallbacks,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    // no tone mapping: palette colours (legend) must render true, and white must stay white
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.touchAction = "none";
    host.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 2000);
    this.scene.add(this.camera);
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(-0.8, 1.2, 1.6);
    this.camera.add(key);
    const fill = new THREE.DirectionalLight(0xf1f5ff, 0.9);
    fill.position.set(1.4, -0.3, 0.8);
    this.camera.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.6);
    rim.position.set(0.3, 0.8, -1.6);
    this.camera.add(rim);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xc3ccd6, 1.2));
    this.scene.add(this.root);
    this.root.add(this.selectionGroup);
    this.root.add(this.previewGroup);
    this.root.add(this.ensembleGroup);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envTexture;
    this.scene.environmentIntensity = 0.45;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.rotateSpeed = 0.75;
    this.controls.zoomSpeed = 0.9;
    this.controls.autoRotateSpeed = 1.1;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 600;
    this.controls.addEventListener("start", () => {
      this.anim = null;
    });

    const detail = 2;
    this.sphereGeo = new THREE.IcosahedronGeometry(1, detail);
    this.sphereGeoLow = new THREE.IcosahedronGeometry(1, 1);
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
    this.cylGeo = cyl;

    this.haloTexture = makeHaloTexture();
    this.halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.haloTexture, color: new THREE.Color(SELECT_COLOR), transparent: true, depthTest: false, depthWrite: false }),
    );
    this.halo.visible = false;
    this.overlay.add(this.halo);

    this.buildGizmo();
    this.setupComposer();

    const el = this.renderer.domElement;
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointerleave", this.onPointerLeave);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.raf = requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------ setup
  private setupComposer() {
    try {
      const rt = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType, samples: 4 });
      const composer = new EffectComposer(this.renderer, rt);
      composer.addPass(new RenderPass(this.scene, this.camera));
      const gtao = new GTAOPass(this.scene, this.camera, 512, 512);
      gtao.output = GTAOPass.OUTPUT.Default;
      gtao.blendIntensity = 0.9;
      // world units are Å: an 8 Å probe darkens packed side chains and the ribbon underside
      gtao.updateGtaoMaterial({
        radius: 8.0,
        distanceExponent: 2.0,
        thickness: 8.0,
        scale: 1.6,
        samples: 16,
        distanceFallOff: 1.0,
        screenSpaceRadius: false,
      });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 16 });
      composer.addPass(gtao);
      composer.addPass(new OutputPass());
      this.composer = composer;
      this.gtao = gtao;
    } catch {
      this.composer = null;
      this.gtao = null;
    }
  }

  private buildGizmo() {
    const axes: [THREE.Vector3, string][] = [
      [new THREE.Vector3(1, 0, 0), "#e5484d"],
      [new THREE.Vector3(0, 1, 0), "#30a46c"],
      [new THREE.Vector3(0, 0, 1), "#3e63dd"],
    ];
    for (const [dir, col] of axes) {
      const mat = new THREE.MeshBasicMaterial({ color: col });
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 10), mat);
      shaft.quaternion.setFromUnitVectors(UP, dir);
      shaft.position.copy(dir).multiplyScalar(0.5);
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.36, 14), mat);
      head.quaternion.setFromUnitVectors(UP, dir);
      head.position.copy(dir).multiplyScalar(1.15);
      this.gizmo.add(shaft, head);
    }
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), new THREE.MeshBasicMaterial({ color: "#8b949e" }));
    this.gizmo.add(hub);
    this.gizmoScene.add(this.gizmo);
    this.gizmoCamera.position.set(0, 0, 5);
    this.gizmoCamera.lookAt(0, 0, 0);
  }

  setBackground(css: string) {
    try {
      this.bg.setStyle(css);
    } catch {
      this.bg.set("#ffffff");
    }
    this.scene.background = this.bg;
    this.dirty = true;
  }

  setAO(on: boolean) {
    this.aoEnabled = on;
    this.dirty = true;
  }
  getAO() {
    return this.aoEnabled && !!this.composer;
  }

  /** Development aid: inspect / tune the GTAO pass. */
  debugAO(opts: { output?: "Default" | "AO" | "Denoise" | "Depth" | "Normal" | "Off"; blend?: number; ao?: Record<string, number | boolean> }) {
    if (!this.gtao) return "no gtao";
    if (opts.output) this.gtao.output = GTAOPass.OUTPUT[opts.output];
    if (opts.blend !== undefined) this.gtao.blendIntensity = opts.blend;
    if (opts.ao) this.gtao.updateGtaoMaterial(opts.ao);
    this.dirty = true;
    return "ok";
  }

  // ------------------------------------------------------------------ model & style
  setModel(model: PdbModel, opts: { keepView?: boolean } = {}) {
    this.model = model;
    this.clearModel();
    this.residueIndexOfAtom = new Int32Array(0);
    this.selected = null;
    this.cartoon = buildCartoon(model);
    this.cartoonMesh = new THREE.Mesh(this.cartoon.geometry, this.cartoonMat);
    this.root.add(this.cartoonMesh);
    if (!opts.keepView || !this.homeView) this.frame(false);
    this.dirty = true;
    if (this.style) this.applyStyle();
  }

  /** Thin semi-transparent Cα tubes for the other models of an NMR ensemble (already superposed). */
  setEnsemble(traces: { xyz: number[][]; colors: string[] }[] | null) {
    MolViewer.clearGroup(this.ensembleGroup, true);
    if (traces) {
      const col = new THREE.Color();
      for (const tr of traces) {
        if (tr.xyz.length < 2) continue;
        const pts = tr.xyz.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
        const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
        const tubular = Math.max(4, (pts.length - 1) * 4);
        const radial = 6;
        const geo = new THREE.TubeGeometry(curve, tubular, 0.13, radial, false);
        const colors = new Float32Array(geo.getAttribute("position").count * 3);
        for (let i = 0; i <= tubular; i++) {
          const k = Math.min(pts.length - 1, Math.round((i / tubular) * (pts.length - 1)));
          col.set(tr.colors[k] ?? "#93a4b8");
          for (let j = 0; j <= radial; j++) {
            const v = i * (radial + 1) + j;
            colors[v * 3] = col.r;
            colors[v * 3 + 1] = col.g;
            colors[v * 3 + 2] = col.b;
          }
        }
        geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        const mesh = new THREE.Mesh(geo, this.ensembleMat);
        mesh.renderOrder = -1;
        this.ensembleGroup.add(mesh);
      }
    }
    this.dirty = true;
  }

  setEnsembleVisible(v: boolean) {
    this.ensembleGroup.visible = v;
    this.dirty = true;
  }

  private clearModel() {
    if (this.cartoonMesh) {
      this.root.remove(this.cartoonMesh);
      this.cartoonMesh.geometry.dispose();
      this.cartoonMesh = null;
    }
    this.cartoon = null;
    this.clearAtoms();
    this.clearSelection();
    this.hover = null;
    this.halo.visible = false;
  }

  setStyle(style: ViewerStyle) {
    const repChanged = !this.style || this.style.representation !== style.representation;
    this.style = style;
    this.applyStyle(repChanged);
  }

  private applyStyle(rebuild = true) {
    if (!this.model || !this.style) return;
    const st = this.style;
    const showCartoon = st.representation === "cartoon" || st.representation === "cartoon+atoms";
    if (this.cartoonMesh) this.cartoonMesh.visible = showCartoon;
    if (this.cartoon) {
      const rgb = new Float32Array(this.model.residues.length * 3);
      const c = new THREE.Color();
      this.model.residues.forEach((_, i) => {
        const hex = st.highlight.has(i) ? st.highlightColor : st.residueColors[i] ?? "#a9b4bf";
        c.set(i === this.selected ? mixHex(hex, "#ffffff", 0.25) : hex);
        rgb[i * 3] = c.r;
        rgb[i * 3 + 1] = c.g;
        rgb[i * 3 + 2] = c.b;
      });
      paintCartoon(this.cartoon, rgb);
    }
    if (rebuild || !this.atomLayer) this.buildAtoms();
    else this.recolorAtoms();
    const keep = this.previewResidue;
    this.previewResidue = -2;
    this.setPreview(keep);
    this.buildSelection();
    this.dirty = true;
  }

  private atomColor(atomIndex: number, residueIndex: number): string {
    const st = this.style!;
    const a = this.model!.atoms[atomIndex];
    const resHex = st.highlight.has(residueIndex) ? st.highlightColor : st.residueColors[residueIndex] ?? "#a9b4bf";
    if (a.element === "C" && residueIndex === this.selected) return SELECT_COLOR;
    if (a.element === "C") return mixHex(resHex, "#ffffff", st.representation === "spheres" ? 0.08 : 0.18);
    return ELEMENT_COLORS[a.element] ?? "#b197fc";
  }

  private residueIndexOfAtom: Int32Array = new Int32Array(0);

  private clearAtoms() {
    if (this.atomLayer) {
      this.root.remove(this.atomLayer.mesh);
      this.atomLayer.mesh.dispose();
      this.atomLayer = null;
    }
    if (this.bondMesh) {
      this.root.remove(this.bondMesh);
      this.bondMesh.dispose();
      this.bondMesh = null;
    }
  }

  private buildAtoms() {
    const m = this.model!;
    const st = this.style!;
    this.clearAtoms();
    if (this.residueIndexOfAtom.length !== m.atoms.length) {
      this.residueIndexOfAtom = new Int32Array(m.atoms.length).fill(-1);
      m.residues.forEach((r, ri) => r.atoms.forEach((ai) => (this.residueIndexOfAtom[ai] = ri)));
    }
    const rep = st.representation;
    const shown: number[] = [];
    const radii: number[] = [];
    for (const a of m.atoms) {
      if (a.element === "Q") continue; // CYANA pseudo-atoms
      const isH = a.element === "H";
      const bb = BACKBONE.has(a.name) && !a.hetero;
      let r = 0;
      switch (rep) {
        case "cartoon":
          if (a.hetero) r = BALL[a.element] ?? 0.3;
          break;
        case "cartoon+atoms":
          if (isH) break;
          if (a.hetero) r = BALL[a.element] ?? 0.3;
          else if (bb) r = a.name === "CA" ? 0.22 : 0; // N/C/O pop out on hover / selection
          else r = BALL[a.element] ?? 0.25;
          break;
        case "sticks":
          r = BALL[a.element] ?? 0.26;
          break;
        case "spheres":
          r = (VDW[a.element] ?? 1.7) * 0.92;
          break;
      }
      if (r > 0) {
        shown.push(a.index);
        radii.push(r);
      }
    }
    const instanceOf = new Int32Array(m.atoms.length).fill(-1);
    shown.forEach((ai, k) => (instanceOf[ai] = k));
    const geo = m.atoms.length > 4000 ? this.sphereGeoLow : this.sphereGeo;
    const mesh = new THREE.InstancedMesh(geo, this.atomMat, Math.max(1, shown.length));
    mesh.count = shown.length;
    const mat = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const col = new THREE.Color();
    shown.forEach((ai, k) => {
      const a = m.atoms[ai];
      pos.set(a.x, a.y, a.z);
      scl.setScalar(radii[k]);
      mat.compose(pos, q, scl);
      mesh.setMatrixAt(k, mat);
      col.set(this.atomColor(ai, this.residueIndexOfAtom[ai]));
      mesh.setColorAt(k, col);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    this.root.add(mesh);
    this.atomLayer = { mesh, atoms: Int32Array.from(shown), radii: Float32Array.from(radii), instanceOf };

    // bonds between displayed atoms
    if (rep !== "spheres") {
      const bondR = rep === "sticks" ? 0.13 : 0.1;
      const halves: [number, number][] = [];
      for (const [i, j] of m.bonds) {
        if (instanceOf[i] < 0 || instanceOf[j] < 0) continue;
        const ai = m.atoms[i];
        const aj = m.atoms[j];
        if (rep === "cartoon+atoms" && BACKBONE.has(ai.name) && BACKBONE.has(aj.name) && !ai.hetero && !aj.hetero) continue;
        halves.push([i, j], [j, i]);
      }
      if (halves.length) {
        const bm = new THREE.InstancedMesh(this.cylGeo, this.bondMat, halves.length);
        const a = new THREE.Vector3();
        const b = new THREE.Vector3();
        const mid = new THREE.Vector3();
        const dir = new THREE.Vector3();
        halves.forEach(([i, j], k) => {
          const ai = m.atoms[i];
          const aj = m.atoms[j];
          a.set(ai.x, ai.y, ai.z);
          b.set(aj.x, aj.y, aj.z);
          mid.addVectors(a, b).multiplyScalar(0.5);
          dir.subVectors(mid, a);
          const len = dir.length();
          q.setFromUnitVectors(UP, dir.normalize());
          pos.addVectors(a, mid).multiplyScalar(0.5);
          scl.set(bondR, len, bondR);
          mat.compose(pos, q, scl);
          bm.setMatrixAt(k, mat);
          col.set(this.atomColor(i, this.residueIndexOfAtom[i]));
          bm.setColorAt(k, col);
        });
        bm.instanceMatrix.needsUpdate = true;
        if (bm.instanceColor) bm.instanceColor.needsUpdate = true;
        bm.frustumCulled = false;
        this.root.add(bm);
        this.bondMesh = bm;
        this.bondPairs = halves;
      } else this.bondPairs = [];
    } else this.bondPairs = [];
    this.restoreHoverScale();
  }

  private bondPairs: [number, number][] = [];

  private recolorAtoms() {
    if (!this.atomLayer) return;
    const col = new THREE.Color();
    const { mesh, atoms } = this.atomLayer;
    atoms.forEach((ai, k) => {
      col.set(this.atomColor(ai, this.residueIndexOfAtom[ai]));
      mesh.setColorAt(k, col);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (this.bondMesh) {
      this.bondPairs.forEach(([i], k) => {
        col.set(this.atomColor(i, this.residueIndexOfAtom[i]));
        this.bondMesh!.setColorAt(k, col);
      });
      if (this.bondMesh.instanceColor) this.bondMesh.instanceColor.needsUpdate = true;
    }
  }

  // ------------------------------------------------------------------ selection
  setSelected(residueIndex: number | null, focus = true) {
    const changed = this.selected !== residueIndex;
    this.selected = residueIndex;
    if (changed) this.applyStyle(false);
    if (residueIndex !== null && focus && changed) this.focusResidue(residueIndex);
    this.dirty = true;
  }

  private static clearGroup(g: THREE.Group, disposeGeometry = false) {
    for (const child of [...g.children]) {
      g.remove(child);
      const mesh = child as THREE.Mesh;
      if (disposeGeometry) mesh.geometry?.dispose();
      (child as THREE.InstancedMesh).dispose?.();
    }
  }

  private clearSelection() {
    MolViewer.clearGroup(this.selectionGroup);
    this.selectionAtoms = [];
  }

  /** Atoms of residue `ri` that the current representation does not already draw. */
  private extraAtomsFor(ri: number): { atoms: number[]; anchors: number[] } {
    const m = this.model!;
    const rep = this.style!.representation;
    const r = m.residues[ri];
    if (!r || rep === "sticks" || rep === "spheres") return { atoms: [], anchors: [] };
    const heavy = r.atoms.filter((i) => m.atoms[i].element !== "H" && m.atoms[i].element !== "Q");
    if (rep === "cartoon+atoms") {
      const bbOnly = heavy.filter((i) => ["N", "C", "O", "OXT"].includes(m.atoms[i].name));
      const ca = heavy.filter((i) => m.atoms[i].name === "CA");
      return { atoms: bbOnly, anchors: ca };
    }
    const shown = this.atomLayer ? heavy.filter((i) => this.atomLayer!.instanceOf[i] < 0) : heavy;
    return { atoms: shown, anchors: heavy.filter((i) => !shown.includes(i)) };
  }

  /** Ball-and-stick geometry for a set of atoms (bonds also to `anchors`). */
  private ballStick(group: THREE.Group, atoms: number[], anchors: number[], carbonHex: string): { atom: number; r: number }[] {
    const m = this.model!;
    if (!atoms.length) return [];
    const mesh = new THREE.InstancedMesh(this.sphereGeo, this.atomMat, atoms.length);
    const mat = new THREE.Matrix4();
    const col = new THREE.Color();
    const out: { atom: number; r: number }[] = [];
    atoms.forEach((ai, k) => {
      const a = m.atoms[ai];
      const r = a.element === "C" ? 0.25 : a.element === "O" ? 0.24 : 0.25;
      mat.compose(new THREE.Vector3(a.x, a.y, a.z), new THREE.Quaternion(), new THREE.Vector3().setScalar(r));
      mesh.setMatrixAt(k, mat);
      col.set(a.element === "C" ? carbonHex : ELEMENT_COLORS[a.element] ?? "#b197fc");
      mesh.setColorAt(k, col);
      out.push({ atom: ai, r });
    });
    mesh.frustumCulled = false;
    group.add(mesh);
    const set = new Set([...atoms, ...anchors]);
    const own = new Set(atoms);
    const pairs = m.bonds.filter(([i, j]) => set.has(i) && set.has(j) && (own.has(i) || own.has(j)));
    if (pairs.length) {
      const bm = new THREE.InstancedMesh(this.cylGeo, this.bondMat, pairs.length * 2);
      let k = 0;
      for (const [i, j] of pairs) {
        for (const [p, q2] of [
          [i, j],
          [j, i],
        ]) {
          const a = m.atoms[p];
          const b = m.atoms[q2];
          const va = new THREE.Vector3(a.x, a.y, a.z);
          const mid = new THREE.Vector3(b.x, b.y, b.z).add(va).multiplyScalar(0.5);
          const dir = new THREE.Vector3().subVectors(mid, va);
          const len = dir.length();
          mat.compose(
            new THREE.Vector3().addVectors(va, mid).multiplyScalar(0.5),
            new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()),
            new THREE.Vector3(0.11, len, 0.11),
          );
          bm.setMatrixAt(k, mat);
          col.set(a.element === "C" ? carbonHex : ELEMENT_COLORS[a.element] ?? "#b197fc");
          bm.setColorAt(k, col);
          k++;
        }
      }
      bm.frustumCulled = false;
      group.add(bm);
    }
    return out;
  }

  private buildSelection() {
    this.clearSelection();
    if (this.selected === null || !this.model || !this.style) return;
    const { atoms, anchors } = this.extraAtomsFor(this.selected);
    this.selectionAtoms = this.ballStick(this.selectionGroup, atoms, anchors, SELECT_COLOR);
    if (this.previewResidue === this.selected) this.setPreview(-1);
  }

  /** Transient ball-and-stick of the residue under the pointer (so hidden atoms can be pointed at). */
  private setPreview(ri: number) {
    if (this.previewTimer) {
      clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
    if (ri === this.previewResidue) return;
    MolViewer.clearGroup(this.previewGroup);
    this.previewAtoms = [];
    this.previewResidue = ri;
    if (ri < 0 || !this.model || !this.style || ri === this.selected) {
      this.dirty = true;
      return;
    }
    const { atoms, anchors } = this.extraAtomsFor(ri);
    const hex = this.style.highlight.has(ri) ? this.style.highlightColor : this.style.residueColors[ri] ?? "#a9b4bf";
    this.previewAtoms = this.ballStick(this.previewGroup, atoms, anchors, mixHex(hex, "#ffffff", 0.18));
    this.dirty = true;
  }

  /** Atoms (indices) of the selected residue, for labels. */
  selectedAtoms(): number[] {
    if (this.selected === null || !this.model) return [];
    return this.model.residues[this.selected].atoms.filter((i) => this.model!.atoms[i].element !== "H" && this.model!.atoms[i].element !== "Q");
  }

  residueCentroid(ri: number): THREE.Vector3 {
    const r = this.model!.residues[ri];
    const c = new THREE.Vector3();
    for (const i of r.atoms) c.add(new THREE.Vector3(this.model!.atoms[i].x, this.model!.atoms[i].y, this.model!.atoms[i].z));
    return c.multiplyScalar(1 / Math.max(1, r.atoms.length));
  }

  focusResidue(ri: number) {
    if (!this.model) return;
    const residue = this.residueCentroid(ri);
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).normalize();
    const current = this.camera.position.distanceTo(this.controls.target);
    // pan most of the way towards the residue but keep the current zoom, so the selection is
    // centred while the rest of the fold stays in view (AlphaFold-style context)
    const centre = new THREE.Vector3(...this.model.center);
    const target = centre.lerp(residue, 0.7);
    const dist = Math.max(40, current);
    this.animateTo(target.clone().addScaledVector(dir, dist), target);
  }

  private animateTo(pos: THREE.Vector3, target: THREE.Vector3, dur = 750) {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) dur = 1;
    this.anim = { from: this.camera.position.clone(), to: pos, fromT: this.controls.target.clone(), toT: target, t0: performance.now(), dur };
  }

  /** Fit the molecule, viewing down its smallest principal axis. */
  frame(animate = true) {
    if (!this.model || !this.model.atoms.length) return;
    const pts = this.model.residues.filter((r) => r.ca !== undefined).map((r) => {
      const a = this.model!.atoms[r.ca!];
      return new THREE.Vector3(a.x, a.y, a.z);
    });
    const all = pts.length >= 3 ? pts : this.model.atoms.map((a) => new THREE.Vector3(a.x, a.y, a.z));
    const [e1, e2, e3] = principalAxes(all);
    const c = new THREE.Vector3(...this.model.center);
    let ext1 = 0;
    let ext2 = 0;
    let ext3 = 0;
    for (const a of this.model.atoms) {
      const d = new THREE.Vector3(a.x, a.y, a.z).sub(c);
      ext1 = Math.max(ext1, Math.abs(d.dot(e1)));
      ext2 = Math.max(ext2, Math.abs(d.dot(e2)));
      ext3 = Math.max(ext3, Math.abs(d.dot(e3)));
    }
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const dist = Math.max(ext1 / Math.tan(hfov / 2), ext2 / Math.tan(vfov / 2)) * 1.04 + ext3 * 0.55;
    // a little tilt so the view is not perfectly axial
    const viewDir = e3.clone().multiplyScalar(-1).applyAxisAngle(e1, 0.18).applyAxisAngle(e2, -0.12).normalize();
    const pos = c.clone().addScaledVector(viewDir, dist);
    this.homeView = { pos, target: c.clone(), up: e2.clone() };
    this.camera.up.copy(e2);
    if (animate) this.animateTo(pos, c);
    else {
      this.camera.position.copy(pos);
      this.controls.target.copy(c);
      this.camera.lookAt(c);
      this.controls.update();
    }
    this.camera.near = Math.max(0.5, dist / 200);
    this.camera.far = dist * 6 + 200;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  resetView() {
    if (!this.homeView) return this.frame(true);
    this.camera.up.copy(this.homeView.up);
    this.animateTo(this.homeView.pos.clone(), this.homeView.target.clone());
  }

  setSpin(on: boolean) {
    this.controls.autoRotate = on;
    this.cb.onSpinChange?.(on);
    this.dirty = true;
  }
  getSpin() {
    return this.controls.autoRotate;
  }

  // ------------------------------------------------------------------ hover / picking
  private onPointerMove = (e: PointerEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = e.clientX - rect.left;
    this.pointer.y = e.clientY - rect.top;
    this.pointer.inside = true;
    this.pointer.pending = true;
    this.pointer.type = e.pointerType;
  };
  private onPointerDown = (e: PointerEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.downX = e.clientX - rect.left;
    this.pointer.downY = e.clientY - rect.top;
    this.pointer.downT = performance.now();
    this.pointer.type = e.pointerType;
  };
  private onPointerUp = (e: PointerEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const moved = Math.hypot(x - this.pointer.downX, y - this.pointer.downY);
    if (moved > 6 || performance.now() - this.pointer.downT > 600) return;
    const hit = this.pick(x, y);
    this.pinnedHover = false;
    this.setHover(hit);
    if (!hit) this.cb.onSelect(null);
    else this.cb.onSelect(hit.residue);
  };
  private onPointerLeave = () => {
    this.pointer.inside = false;
    if (this.pointer.type !== "touch" && !this.pinnedHover) this.setHover(null);
  };

  /** Pick an atom (analytic ray–sphere) or a cartoon residue (ray–spline proximity). */
  pick(px: number, py: number): HoverTarget {
    if (!this.model) return null;
    const w = this.renderer.domElement.clientWidth || 1;
    const h = this.renderer.domElement.clientHeight || 1;
    this.raycaster.setFromCamera(new THREE.Vector2((px / w) * 2 - 1, -(py / h) * 2 + 1), this.camera);
    const o = this.raycaster.ray.origin;
    const d = this.raycaster.ray.direction;
    let bestAtom = -1;
    let bestT = Infinity;
    if (this.atomLayer) {
      const { atoms, radii } = this.atomLayer;
      for (let k = 0; k < atoms.length; k++) {
        const a = this.model.atoms[atoms[k]];
        const R = Math.max(radii[k] * 1.15, 0.45);
        const ox = o.x - a.x;
        const oy = o.y - a.y;
        const oz = o.z - a.z;
        const b = ox * d.x + oy * d.y + oz * d.z;
        const cc = ox * ox + oy * oy + oz * oz - R * R;
        const disc = b * b - cc;
        if (disc < 0) continue;
        const t = -b - Math.sqrt(disc);
        if (t > 0 && t < bestT) {
          bestT = t;
          bestAtom = atoms[k];
        }
      }
    }
    for (const { atom, r } of [...this.selectionAtoms, ...this.previewAtoms]) {
      const a = this.model.atoms[atom];
      const R = Math.max(r * 1.15, 0.45);
      const ox = o.x - a.x;
      const oy = o.y - a.y;
      const oz = o.z - a.z;
      const b = ox * d.x + oy * d.y + oz * d.z;
      const disc = b * b - (ox * ox + oy * oy + oz * oz - R * R);
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t > 0 && t < bestT) {
        bestT = t;
        bestAtom = atom;
      }
    }
    let bestRing = -1;
    let ringT = Infinity;
    if (this.cartoon && this.cartoonMesh?.visible) {
      const { ringCenters, ringHalfWidth, ringCount } = this.cartoon;
      for (let r = 0; r < ringCount; r++) {
        const vx = ringCenters[r * 3] - o.x;
        const vy = ringCenters[r * 3 + 1] - o.y;
        const vz = ringCenters[r * 3 + 2] - o.z;
        const t = vx * d.x + vy * d.y + vz * d.z;
        if (t <= 0) continue;
        const dist2 = vx * vx + vy * vy + vz * vz - t * t;
        const lim = ringHalfWidth[r] + 0.25;
        if (dist2 < lim * lim && t < ringT) {
          ringT = t;
          bestRing = r;
        }
      }
    }
    if (bestAtom >= 0 && bestT <= ringT + 0.8) return { kind: "atom", atom: bestAtom, residue: this.residueIndexOfAtom[bestAtom] };
    if (bestRing >= 0) return { kind: "residue", residue: this.cartoon!.ringResidue[bestRing] };
    if (bestAtom >= 0) return { kind: "atom", atom: bestAtom, residue: this.residueIndexOfAtom[bestAtom] };
    return null;
  }

  private sameTarget(a: HoverTarget, b: HoverTarget) {
    if (a === null || b === null) return a === b;
    if (a.kind !== b.kind) return false;
    return a.kind === "atom" ? a.atom === (b as { atom: number }).atom : a.residue === b.residue;
  }

  private hoverScaled = -1;
  private restoreHoverScale() {
    this.hoverScaled = -1;
    if (this.hover?.kind === "atom") this.scaleHover(this.hover.atom);
  }
  private scaleHover(atom: number | -1) {
    const layer = this.atomLayer;
    if (!layer || !this.model) return;
    const mat = new THREE.Matrix4();
    const setScale = (ai: number, f: number) => {
      const k = layer.instanceOf[ai];
      if (k < 0) return;
      const a = this.model!.atoms[ai];
      mat.compose(new THREE.Vector3(a.x, a.y, a.z), new THREE.Quaternion(), new THREE.Vector3().setScalar(layer.radii[k] * f));
      layer.mesh.setMatrixAt(k, mat);
      layer.mesh.instanceMatrix.needsUpdate = true;
    };
    if (this.hoverScaled >= 0) setScale(this.hoverScaled, 1);
    this.hoverScaled = atom;
    if (atom >= 0) setScale(atom, 1.32);
  }

  setHover(target: HoverTarget, pinned = false) {
    if (pinned) this.pinnedHover = true;
    if (this.sameTarget(target, this.hover)) return;
    this.hover = target;
    this.scaleHover(target?.kind === "atom" ? target.atom : -1);
    const ri = target ? target.residue : -1;
    if (ri >= 0) this.setPreview(ri);
    else if (this.previewResidue >= 0 && !this.previewTimer) {
      this.previewTimer = setTimeout(() => {
        this.previewTimer = null;
        if (!this.hover) this.setPreview(-1);
      }, 650);
    }
    if (target?.kind === "atom" && this.model) {
      const a = this.model.atoms[target.atom];
      const k = this.atomLayer?.instanceOf[target.atom] ?? -1;
      const extra = [...this.selectionAtoms, ...this.previewAtoms].find((e) => e.atom === target.atom);
      const r = k >= 0 ? this.atomLayer!.radii[k] : extra ? extra.r : 0.3;
      this.halo.position.set(a.x, a.y, a.z);
      this.halo.scale.setScalar(Math.max(1.3, r * 1.32 * 2.9));
      this.halo.visible = true;
    } else this.halo.visible = false;
    this.dirty = true;
    this.cb.onHover(target);
  }

  hoverAtomByName(resi: number, name: string, chain?: string) {
    if (!this.model) return;
    const a = this.model.atoms.find((x) => x.resi === resi && x.name === name && (!chain || x.chain === chain));
    if (!a) return;
    this.setHover({ kind: "atom", atom: a.index, residue: this.residueIndexOfAtom[a.index] }, true);
  }

  getHover() {
    return this.hover;
  }

  /** Screen position (CSS px within the canvas) of a world point. */
  project(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, visible: v.z > -1 && v.z < 1 };
  }

  hoverAnchor(): { x: number; y: number; visible: boolean } | null {
    if (!this.hover || !this.model) return null;
    if (this.hover.kind === "atom") {
      const a = this.model.atoms[this.hover.atom];
      return this.project(a.x, a.y, a.z);
    }
    const r = this.model.residues[this.hover.residue];
    if (r.ca === undefined) {
      const c = this.residueCentroid(this.hover.residue);
      return this.project(c.x, c.y, c.z);
    }
    const a = this.model.atoms[r.ca];
    return this.project(a.x, a.y, a.z);
  }

  // ------------------------------------------------------------------ rendering
  private resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
    this.dirty = true;
  }

  private renderFrame() {
    const r = this.renderer;
    if (this.composer && this.aoEnabled) this.composer.render();
    else r.render(this.scene, this.camera);
    r.autoClear = false;
    if (this.halo.visible) {
      r.clearDepth();
      r.render(this.overlay, this.camera);
    }
    // orientation gizmo, bottom-left
    const size = 64;
    const w = r.domElement.clientWidth;
    void w;
    this.gizmo.quaternion.copy(this.camera.quaternion).invert();
    r.setScissorTest(true);
    r.setScissor(10, 10, size, size);
    r.setViewport(10, 10, size, size);
    r.clearDepth();
    r.render(this.gizmoScene, this.gizmoCamera);
    r.setScissorTest(false);
    r.setViewport(0, 0, r.domElement.clientWidth, r.domElement.clientHeight);
    r.autoClear = true;
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    let changed = false;
    if (this.anim) {
      const t = Math.min(1, (performance.now() - this.anim.t0) / this.anim.dur);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.camera.position.lerpVectors(this.anim.from, this.anim.to, e);
      this.controls.target.lerpVectors(this.anim.fromT, this.anim.toT, e);
      if (t >= 1) this.anim = null;
      changed = true;
    }
    if (this.controls.update()) changed = true;
    if (this.pointer.pending && this.pointer.inside && this.pointer.type !== "touch") {
      this.pointer.pending = false;
      if (!this.pinnedHover) this.setHover(this.pick(this.pointer.x, this.pointer.y));
    }
    if (changed || this.dirty) {
      this.dirty = false;
      this.renderFrame();
      this.cb.onFrame();
    }
  };

  screenshot(): string {
    this.renderFrame();
    return this.renderer.domElement.toDataURL("image/png");
  }

  dispose() {
    this.disposed = true;
    if (this.previewTimer) clearTimeout(this.previewTimer);
    MolViewer.clearGroup(this.previewGroup);
    MolViewer.clearGroup(this.ensembleGroup, true);
    this.ensembleMat.dispose();
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("pointerleave", this.onPointerLeave);
    this.controls.dispose();
    this.clearModel();
    this.sphereGeo.dispose();
    this.sphereGeoLow.dispose();
    this.cylGeo.dispose();
    this.cartoonMat.dispose();
    this.atomMat.dispose();
    this.bondMat.dispose();
    this.haloTexture.dispose();
    (this.halo.material as THREE.SpriteMaterial).dispose();
    this.gizmo.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const m = mesh.material as THREE.Material | undefined;
      m?.dispose?.();
    });
    this.envTexture?.dispose();
    this.gtao?.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    el.remove();
  }
}
