// Hero "spectral wave": a band of glowing lines. Its packets have Lorentzian envelopes (the shape
// of an NMR line) carrying oscillations, and every line is phase-shifted from its neighbours so
// the band twists like a ribbon. All motion happens on the GPU. Each line is drawn as a
// screen-space strip with a thin core and a soft glow, so it stays the same pixel width at any depth.
import * as THREE from "three";

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uAmp;
  uniform float uAlpha;
  uniform float uLen;
  uniform float uHeight;
  uniform float uDepth;
  uniform float uHalfWidth;
  uniform vec2 uResolution;
  uniform vec3 uBlue;
  uniform vec3 uCyan;
  uniform vec3 uViolet;
  uniform vec3 uPink;
  attribute float aU;
  attribute float aLine;
  attribute float aSide;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSide;
  varying float vCore;

  float lorentz(float x, float x0, float g) {
    float d = (x - x0) / g;
    return 1.0 / (1.0 + d * d);
  }

  // y of line k (0..1) at x (-1..1), in units of the band height
  float waveY(float x, float k) {
    float t = uTime;
    float ph = k * 2.7;
    float y = 0.0;
    y += 1.00 * lorentz(x, 0.40 + 0.03 * sin(t * 0.21), 0.085) * sin(x * 42.0 - t * 1.6 + ph);
    y += 0.80 * lorentz(x, 0.04 + 0.04 * sin(t * 0.17 + 1.0), 0.10) * sin(x * 31.0 + t * 1.15 + ph * 0.8);
    y += 0.55 * lorentz(x, -0.38 + 0.03 * sin(t * 0.23 + 2.0), 0.09) * sin(x * 36.0 - t * 1.35 + ph * 1.25);
    y += 0.42 * lorentz(x, 0.70, 0.07) * sin(x * 50.0 + t * 1.9 + ph * 1.5);
    y += 0.30 * lorentz(x, -0.72, 0.10) * sin(x * 28.0 + t * 1.2 + ph);
    y += 0.16 * sin(x * 7.0 + t * 0.55 + ph * 0.6);
    // the band is quieter on the left, where the hero copy sits
    float bias = 0.3 + 0.7 * smoothstep(-0.7, 0.1, x);
    float spread = 0.5 + 0.5 * sin(k * 3.14159);
    return y * bias * spread + (k - 0.5) * 0.07;
  }

  vec3 wavePoint(float u, float k) {
    float x = u * 2.0 - 1.0;
    float taper = exp(-pow(abs(x) * 1.12, 6.0));
    float z = (k - 0.5) * uDepth * (0.3 + 0.7 * taper);
    return vec3(x * uLen, waveY(x, k) * taper * uHeight * uAmp, z);
  }

  void main() {
    vec3 p = wavePoint(aU, aLine);
    vec3 q = wavePoint(aU + 0.0025, aLine);
    vec4 cp = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    vec4 cq = projectionMatrix * modelViewMatrix * vec4(q, 1.0);
    vec2 sp = cp.xy / cp.w * uResolution * 0.5;
    vec2 sq = cq.xy / cq.w * uResolution * 0.5;
    vec2 dir = normalize(sq - sp + vec2(1e-5, 0.0));
    vec2 nrm = vec2(-dir.y, dir.x);
    // a few lines are drawn bolder, like the bright strands of the reference look
    float bold = step(0.8, fract(aLine * 7.31 + 0.13));
    float hw = uHalfWidth * (1.0 + 0.35 * bold);
    cp.xy += nrm * aSide * hw / (uResolution * 0.5) * cp.w;
    gl_Position = cp;

    float x = aU * 2.0 - 1.0;
    vec3 c = mix(uCyan, uBlue, smoothstep(-0.95, -0.25, x + 0.3 * (aLine - 0.5)));
    c = mix(c, uViolet, smoothstep(-0.1, 0.45, x) * (0.55 + 0.45 * aLine));
    c = mix(c, uPink, smoothstep(0.35, 0.95, x) * aLine * 0.85);
    c = mix(c, uPink, 0.3 * smoothstep(0.55, 1.0, aLine) * smoothstep(-0.5, 0.0, x));
    vColor = c;
    float ends = smoothstep(0.0, 0.07, aU) * smoothstep(1.0, 0.93, aU);
    float energy = abs(p.y) / max(1e-3, uHeight);
    float quiet = 0.25 + 0.75 * smoothstep(-0.6, -0.05, x);
    vAlpha = uAlpha * ends * quiet * (0.38 + 0.62 * min(1.0, energy * 1.6 + bold * 0.35));
    vSide = aSide;
    vCore = (0.16 + 0.06 * bold);
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSide;
  varying float vCore;
  void main() {
    float d = abs(vSide);
    float core = 1.0 - smoothstep(vCore * 0.45, vCore * 1.25, d);
    float glow = exp(-d * d * 7.0) * 0.16;
    float a = vAlpha * max(core, glow);
    if (a < 0.004) discard;
    // lit core, softer halo
    vec3 col = mix(vColor * 0.9, vColor * 1.08, core);
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`;

export interface SpectralWaveOptions {
  lines: number;
  segments: number;
}

export class SpectralWave {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;

  constructor({ lines, segments }: SpectralWaveOptions) {
    const verts = lines * (segments + 1) * 2;
    const aU = new Float32Array(verts);
    const aLine = new Float32Array(verts);
    const aSide = new Float32Array(verts);
    const index: number[] = [];
    let v = 0;
    for (let l = 0; l < lines; l++) {
      const k = lines === 1 ? 0.5 : l / (lines - 1);
      const base = v;
      for (let j = 0; j <= segments; j++) {
        for (const side of [-1, 1]) {
          aU[v] = j / segments;
          aLine[v] = k;
          aSide[v] = side;
          v++;
        }
      }
      for (let j = 0; j < segments; j++) {
        const a = base + j * 2;
        index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    // positions are computed in the vertex shader; the attribute only sizes the draw
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
    geo.setAttribute("aU", new THREE.BufferAttribute(aU, 1));
    geo.setAttribute("aLine", new THREE.BufferAttribute(aLine, 1));
    geo.setAttribute("aSide", new THREE.BufferAttribute(aSide, 1));
    geo.setIndex(index);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uAmp: { value: 1 },
        uAlpha: { value: 1 },
        uLen: { value: 80 },
        uHeight: { value: 11 },
        uDepth: { value: 14 },
        uHalfWidth: { value: 6 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uBlue: { value: new THREE.Color("#2563eb") },
        uCyan: { value: new THREE.Color("#0ea5e9") },
        uViolet: { value: new THREE.Color("#7c3aed") },
        uPink: { value: new THREE.Color("#db2777") },
      },
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  /** drawing-buffer size in device pixels, and the device pixel ratio for the line width */
  setResolution(width: number, height: number, dpr: number) {
    const u = this.mesh.material.uniforms;
    (u.uResolution.value as THREE.Vector2).set(width, height);
    u.uHalfWidth.value = 6 * dpr;
  }

  update(time: number, alpha: number, amp: number, length: number) {
    const u = this.mesh.material.uniforms;
    u.uTime.value = time;
    u.uAlpha.value = alpha;
    u.uAmp.value = amp;
    u.uLen.value = length;
    this.mesh.visible = alpha > 0.004;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
