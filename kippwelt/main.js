// Kippwelt: one-thumb gravity-flipping ball game in the Gestenwelten style.
// logic.js holds the rules; this file renders (Three.js), animates (GSAP),
// drives the DOM layer (Anime.js) and maps thumb gestures to moves.
import * as THREE from 'three';
import { animate, stagger } from 'animejs';
import { LEVELS, Level, act, afterPhase, spikeUp, sameSpot, solve } from './logic.js';

const gsap = window.gsap;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = THREE.MathUtils.clamp;
const R = 0.32; // ball radius
const $ = (id) => document.getElementById(id);
const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);

/* ------------------------------------------------------------------ */
/* Renderer                                                            */
/* ------------------------------------------------------------------ */
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
let dpr = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(dpr);
renderer.setClearColor(0x000000, 1);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.05, 400);
const U = { time: { value: 0 }, px: { value: dpr } };
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const GLSL = /* glsl */`
float hash11(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash31(vec3 p){ p = fract(p * .3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash31(i), hash31(i + vec3(1,0,0)), f.x), mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x), mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ return .6 * vnoise(p) + .3 * vnoise(p * 2.03 + 1.7) + .1 * vnoise(p * 4.1 + 3.1); }
mat2 rot2(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float ease3(float x){ x = clamp(x, 0.0, 1.0); return x * x * (3.0 - 2.0 * x); }
`;
const shader = (uniforms, vs, fs, opts = {}) =>
  new THREE.ShaderMaterial({ uniforms, vertexShader: GLSL + vs, fragmentShader: GLSL + fs, ...opts });
const ADD = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };

/* ------------------------------------------------------------------ */
/* Backgrounds (one per world, taken from Gestenwelten)                */
/* ------------------------------------------------------------------ */
const bgPulse = [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, -100, 0));
let bgPi = 0;
const bgU = { uTime: U.time, uPx: U.px, uPulse: { value: bgPulse }, uWell: { value: new THREE.Vector3() }, uBgReveal: { value: 0 } };
function bgEvent(pos, amp) { bgPulse[bgPi++ % 4].set(pos.x, pos.z, U.time.value, amp); }

function stars() {
  const p = [], s = [];
  for (let i = 0; i < 2600; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(90 + Math.random() * 60);
    p.push(v.x, v.y, v.z); s.push(Math.random());
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(s, 1));
  const pts = new THREE.Points(g, shader(bgU, /* glsl */`
    attribute float aSeed; uniform float uTime, uPx; varying float vA;
    void main(){
      gl_PointSize = (1.0 + aSeed * 2.2) * uPx;
      vA = 0.35 + 0.65 * step(0.6, fract(aSeed * 31.0 + uTime * (0.2 + aSeed * 0.6)));
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`, /* glsl */`
    varying float vA;
    void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(1.0), smoothstep(0.5, 0.1, d) * vA * 0.8); }`, ADD));
  pts.frustumCulled = false;
  return pts;
}
scene.add(stars());

function hexBackground() {
  const pos = [], e = [];
  const P = (k) => [Math.cos((k * Math.PI) / 3), Math.sin((k * Math.PI) / 3)];
  for (let k = 0; k < 6; k++) {
    const [x0, z0] = P(k), [x1, z1] = P(k + 1);
    pos.push(0, 1, 0, x1, 1, z1, x0, 1, z0); e.push(0, 0, 1, 1, 0, 1, 1, 0, 1);
    pos.push(x0, 0, z0, x1, 1, z1, x1, 0, z1); e.push(0, 0, 0, 1, 1, 0, 1, 0, 0);
    pos.push(x0, 0, z0, x0, 1, z0, x1, 1, z1); e.push(0, 0, 0, 0, 1, 0, 1, 1, 0);
  }
  const base = new THREE.BufferGeometry();
  base.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  base.setAttribute('aE', new THREE.Float32BufferAttribute(e, 3));
  const g = new THREE.InstancedBufferGeometry().copy(base);
  const off = [], seed = [];
  const n = 40, sx = 1.5 * 1.04, sz = Math.sqrt(3) * 1.04;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    off.push((i - n / 2) * sx, (j - n / 2) * sz + (i % 2 ? sz / 2 : 0)); seed.push(Math.random());
  }
  g.setAttribute('aOff', new THREE.InstancedBufferAttribute(new Float32Array(off), 2));
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(seed), 1));
  g.instanceCount = n * n;
  const m = shader(bgU, /* glsl */`
    attribute vec3 aE; attribute vec2 aOff; attribute float aSeed;
    uniform float uTime, uBgReveal; uniform vec4 uPulse[4];
    varying vec3 vE; varying float vH, vY, vTop, vSeed, vFog;
    void main(){
      float n = fbm(vec3(aOff * 0.07, uTime * 0.05));
      float h = 0.3 + 7.0 * n * n;
      for (int i = 0; i < 4; i++) {
        vec4 P = uPulse[i]; float age = uTime - P.z;
        if (age < 0.0 || age > 7.0) continue;
        float w = length(aOff - P.xy) - age * 10.0;
        h += P.w * 3.5 * exp(-w * w * 0.2) * exp(-age * 0.6);
      }
      h = mix(-24.0, h, ease3(uBgReveal * 1.6 - length(aOff) / 60.0));
      float bottom = h - 20.0;
      vec3 wp = vec3(aOff.x + position.x * 0.94, mix(bottom, h, position.y) - 17.0, aOff.y + position.z * 0.94);
      vE = aE; vH = h - bottom; vY = mix(bottom, h, position.y); vTop = h; vSeed = aSeed;
      vec4 mv = modelViewMatrix * vec4(wp, 1.0);
      vFog = exp(-(-mv.z) * 0.028) * uBgReveal;
      gl_Position = projectionMatrix * mv;
    }`, /* glsl */`
    uniform float uTime;
    varying vec3 vE; varying float vH, vY, vTop, vSeed, vFog;
    void main(){
      float d = vE.z > 0.5 ? (1.0 - vE.x) * 0.814 : min(min(vE.x, 1.0 - vE.x) * 0.94, (1.0 - vE.y) * vH);
      float line = 1.0 - smoothstep(0.04, 0.04 + fwidth(d) * 1.5, d);
      float vert = vE.z > 0.5 ? 1.0 : mix(0.06, 1.0, smoothstep(vTop - 12.0, vTop, vY));
      float hi = 0.45 + 0.55 * step(0.96, fract(vSeed * 7.13 + floor(uTime * 0.5) * 0.317));
      gl_FragColor = vec4(vec3((line + exp(-d * 10.0) * 0.2) * hi * vert * vFog * 0.75), 1.0);
    }`);
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  return mesh;
}

function wellBackground() {
  const pos = [], seed = [];
  const E = 46, gap = 2, step = 0.22;
  for (let li = -E; li <= E; li += gap) for (let t = -E; t <= E; t += step) {
    pos.push(t, 0, li + (Math.random() - 0.5) * 0.08); seed.push(Math.random());
    pos.push(li + (Math.random() - 0.5) * 0.08, 0, t); seed.push(Math.random());
  }
  for (let i = 0; i < 9000; i++) { pos.push((Math.random() - 0.5) * 2 * E, 1, (Math.random() - 0.5) * 2 * E); seed.push(Math.random()); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  const m = shader(bgU, /* glsl */`
    attribute float aSeed; uniform float uTime, uPx, uBgReveal; uniform vec4 uPulse[4]; uniform vec3 uWell;
    varying float vA;
    float well(vec2 p, vec2 c, float H, float r0){ return -H / (1.0 + pow(length(p - c) / r0, 2.4)); }
    void main(){
      vec2 p = position.xz;
      float r = length(p - uWell.xz);
      p = uWell.xz + rot2((0.6 + 0.35 * sin(uTime * 0.25)) * 16.0 / (r + 3.0)) * (p - uWell.xz);
      float y = well(p, uWell.xz, 22.0, 5.0);
      for (int i = 0; i < 4; i++) {
        vec4 P = uPulse[i]; float age = uTime - P.z;
        if (age < 0.0 || age > 7.0) continue;
        float w = length(p - P.xy) - age * 12.0;
        y += P.w * 2.0 * sin(w * 0.9) * exp(-w * w * 0.04) * exp(-age * 0.5);
      }
      float h1 = hash11(aSeed * 113.0), h2 = hash11(aSeed * 57.0 + 1.3);
      if (position.y > 0.5) y += (h1 - 0.5) * 12.0;
      float rv = ease3(uBgReveal * 1.7 - h2 * 0.7);
      vec4 mv = modelViewMatrix * vec4(p.x, y - 15.0 - (1.0 - rv) * 30.0, p.y, 1.0);
      float depth = max(-mv.z, 0.5);
      gl_PointSize = min(3.0 * uPx * (0.5 + h1 * 0.9) * (26.0 / depth), 18.0 * uPx);
      float tw = 0.35 + 0.65 * step(0.45, fract(h2 * 17.0 + uTime * (0.6 + h1)));
      vA = tw * rv * smoothstep(46.0, 34.0, length(position.xz)) * exp(-depth * 0.014) * (position.y > 0.5 ? 0.5 : 0.9);
      gl_Position = projectionMatrix * mv;
    }`, /* glsl */`
    varying float vA;
    void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(1.0), smoothstep(0.5, 0.12, d) * vA); }`, ADD);
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}
const backgrounds = [hexBackground(), wellBackground()];
backgrounds.forEach((b) => { b.visible = false; scene.add(b); });
const bgRoot = new THREE.Group();
scene.add(bgRoot);
backgrounds.forEach((b) => bgRoot.add(b));

/* ------------------------------------------------------------------ */
/* Level objects                                                       */
/* ------------------------------------------------------------------ */
const levelU = { uTime: U.time, uReveal: { value: 0 }, uPhaseMix: { value: 0 } };
const BLOCK_VS = /* glsl */`
  attribute vec3 aPos; attribute float aPhase; attribute float aSeed;
  uniform float uTime, uReveal, uPhaseMix;
  varying vec2 vUv; varying vec3 vN; varying float vSolid, vPhase, vFog, vSeed;
  void main(){
    float solid = aPhase < 0.5 ? 1.0 : (aPhase < 1.5 ? 1.0 - uPhaseMix : uPhaseMix);
    float rv = ease3(uReveal * 1.7 - aSeed * 0.7);
    vec3 p = position * mix(0.84, 1.0, ease3(solid)) * mix(0.1, 1.0, rv);
    if (aPhase > 0.5 && solid < 0.5) p += normal * 0.04 * sin(uTime * 6.0 + aSeed * 20.0);
    vec3 wp = aPos + p + vec3(0.0, (1.0 - rv) * (4.0 + aSeed * 9.0), 0.0);
    vUv = uv; vN = normal; vSolid = solid; vPhase = aPhase; vSeed = aSeed;
    vec4 mv = modelViewMatrix * vec4(wp, 1.0);
    vFog = exp(-(-mv.z) * 0.035) * rv;
    gl_Position = projectionMatrix * mv;
  }`;
const BLOCK_FS = /* glsl */`
  uniform float uTime;
  varying vec2 vUv; varying vec3 vN; varying float vSolid, vPhase, vFog, vSeed;
  float ring(float d, float r){ return 1.0 - smoothstep(0.009, 0.009 + fwidth(d) * 1.3, abs(d - r)); }
  void main(){
    float ex = min(vUv.x, 1.0 - vUv.x), ey = min(vUv.y, 1.0 - vUv.y);
    float e = min(ex, ey);
    float along = ex < ey ? vUv.y : vUv.x;
    float edge = 1.0 - smoothstep(0.03, 0.03 + fwidth(e) * 1.5, e);
    float d = max(abs(vUv.x - 0.5), abs(vUv.y - 0.5));
    float c;
    if (vPhase < 0.5) {
      float pat = abs(vN.y) > 0.5 ? ring(d, 0.3) + ring(d, 0.16) : (abs(vN.x) > 0.5 ? ring(d, 0.34) + ring(d, 0.22) + ring(d, 0.1) : ring(d, 0.2));
      c = max(edge, pat * 0.42) * (abs(vN.y) > 0.5 ? 1.0 : abs(vN.x) > 0.5 ? 0.86 : 0.72) + 0.03;
    } else {
      float pat;
      if (vPhase < 1.5) { vec2 g = fract(vUv * 4.0) - 0.5; pat = 1.0 - smoothstep(0.1, 0.1 + fwidth(g.x) * 2.0, length(g)); }
      else { float h = fract((vUv.x + vUv.y) * 4.0); pat = 1.0 - smoothstep(0.08, 0.08 + fwidth(h) * 1.5, abs(h - 0.5)); }
      float dashed = edge * step(0.5, fract(along * 8.0 + uTime * 0.8));
      if (vSolid < 0.5) {
        if (dashed < 0.2) discard;
        c = dashed * (0.45 + 0.25 * sin(uTime * 5.0 + vSeed * 9.0));
      } else {
        c = max(edge, pat * 0.75) + 0.03;
      }
    }
    gl_FragColor = vec4(vec3(c * vFog), 1.0);
  }`;

const blockGeo = new THREE.BoxGeometry(1, 1, 1);
const lv = { group: new THREE.Group(), keys: [], shards: [], spikes: [], exit: null };
scene.add(lv.group);

const black = new THREE.MeshBasicMaterial({ color: 0x000000 });
const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true });
const UP = new THREE.Vector3(0, 1, 0);
const faceQuat = (u) => new THREE.Quaternion().setFromUnitVectors(UP, V(u));

function exitFunnel() {
  const NU = 36, NV = 26, pos = [], uv = [], idx = [];
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
    pos.push(0, 0, 0); uv.push((i / NU) * Math.PI * 2, j / (NV - 1), Math.random());
    if (j < NV - 1) idx.push(i * NV + j, i * NV + j + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aUV', new THREE.Float32BufferAttribute(uv, 3));
  g.setIndex(idx);
  const u = { uTime: U.time, uActive: { value: 0 }, uReveal: levelU.uReveal };
  const m = shader(u, /* glsl */`
    attribute vec3 aUV; uniform float uTime, uActive, uReveal; varying float vA;
    void main(){
      float v = -2.2 + aUV.y * 2.2;
      float uu = aUV.x + (0.6 + uActive * 1.6) * tanh(v) + uTime * (0.2 + uActive * 1.2);
      float r0 = 0.11;
      vec3 p = vec3(cosh(v) * cos(uu), (v + 2.2) * (1.0 + uActive * 1.2), cosh(v) * sin(uu)) * r0;
      float flow = pow(fract(aUV.y * 3.0 - uTime * (0.4 + uActive) + aUV.z), 10.0);
      vA = (0.25 + uActive * 0.5 + flow * (0.4 + uActive)) * smoothstep(1.0, 0.6, aUV.y * (1.0 - uActive * 0.4)) * uReveal;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`, /* glsl */`
    varying float vA;
    void main(){ gl_FragColor = vec4(vec3(1.0), clamp(vA, 0.0, 1.0)); }`, ADD);
  const lines = new THREE.LineSegments(g, m);
  lines.frustumCulled = false;
  lines.userData.u = u;
  return lines;
}

function squareLoop(size) {
  const h = size / 2;
  const g = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-h, 0.01, -h), new THREE.Vector3(h, 0.01, -h), new THREE.Vector3(h, 0.01, h), new THREE.Vector3(-h, 0.01, h)]);
  return new THREE.LineLoop(g, lineMat);
}

function clearLevelObjects() {
  lv.group.traverse((o) => { if (o.geometry && o.geometry !== blockGeo && !o.geometry.userData.keep) o.geometry.dispose(); });
  lv.group.clear();
  lv.keys = []; lv.shards = []; lv.spikes = []; lv.exit = null;
}

const octa = new THREE.OctahedronGeometry(0.2);
const octaEdges = new THREE.EdgesGeometry(octa);
const shardGeo = new THREE.OctahedronGeometry(0.075);
const spikeGeo = new THREE.ConeGeometry(0.3, 0.55, 4, 1).rotateY(Math.PI / 4).translate(0, 0.275, 0);
const spikeEdges = new THREE.EdgesGeometry(spikeGeo);
[octa, octaEdges, shardGeo, spikeGeo, spikeEdges].forEach((g) => { g.userData.keep = true; });

function buildLevel(L) {
  clearLevelObjects();
  const def = L.def;
  const blocks = [...L.blocks.values()];
  const g = new THREE.InstancedBufferGeometry().copy(blockGeo);
  g.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(blocks.flatMap((b) => b.p)), 3));
  g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array(blocks.map((b) => b.phase)), 1));
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(blocks.map(() => Math.random())), 1));
  g.instanceCount = blocks.length;
  const mesh = new THREE.Mesh(g, shader(levelU, BLOCK_VS, BLOCK_FS));
  mesh.frustumCulled = false;
  lv.group.add(mesh);

  def.keys.forEach((k, i) => {
    const o = new THREE.Group();
    const solid = new THREE.Mesh(octa, black);
    const edges = new THREE.LineSegments(octaEdges, lineMat);
    const core = new THREE.Mesh(shardGeo, white);
    o.add(solid, edges, core);
    o.userData = { base: V(k.b).addScaledVector(V(k.u), 0.5 + 0.42), u: V(k.u), i };
    o.position.copy(o.userData.base);
    lv.group.add(o);
    lv.keys.push(o);
  });
  def.shards.forEach((s) => {
    const o = new THREE.Mesh(shardGeo, white);
    o.userData = { base: V(s.b).addScaledVector(V(s.u), 0.5 + 0.24), u: V(s.u), spot: s };
    o.position.copy(o.userData.base);
    lv.group.add(o);
    lv.shards.push(o);
  });
  def.spikes.forEach((s) => {
    const o = new THREE.Group();
    o.quaternion.copy(faceQuat(s.u));
    o.position.copy(V(s.b).addScaledVector(V(s.u), 0.5));
    const pyramid = new THREE.Group();
    pyramid.add(new THREE.Mesh(spikeGeo, black), new THREE.LineSegments(spikeEdges, lineMat));
    o.add(pyramid, squareLoop(0.78));
    if (s.mode === 'toggle') o.add(squareLoop(0.62));
    o.userData = { spike: s, pyramid };
    lv.group.add(o);
    lv.spikes.push(o);
  });
  const ex = new THREE.Group();
  ex.quaternion.copy(faceQuat(def.exit.u));
  ex.position.copy(V(def.exit.b).addScaledVector(V(def.exit.u), 0.5));
  const funnel = exitFunnel();
  ex.add(funnel, squareLoop(0.86));
  ex.userData.u = funnel.userData.u;
  lv.group.add(ex);
  lv.exit = ex;
}

/* ------------------------------------------------------------------ */
/* Ball, trail, particles                                              */
/* ------------------------------------------------------------------ */
const ball = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 32), shader({ uTime: U.time }, /* glsl */`
  varying vec2 vUv; varying vec3 vNv;
  void main(){ vUv = uv; vNv = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`, /* glsl */`
  varying vec2 vUv; varying vec3 vNv;
  void main(){
    vec2 g = vec2(fract(vUv.x * 12.0), fract(vUv.y * 8.0));
    vec2 w = fwidth(vUv * vec2(12.0, 8.0));
    float lx = 1.0 - smoothstep(0.0, w.x * 1.6, min(g.x, 1.0 - g.x) - 0.04);
    float ly = 1.0 - smoothstep(0.0, w.y * 1.6, min(g.y, 1.0 - g.y) - 0.04);
    float shade = 0.72 + 0.28 * max(vNv.z, 0.0);
    float rim = pow(1.0 - max(vNv.z, 0.0), 3.0);
    float c = mix(shade, 0.04, max(lx, ly)) + rim * 0.4;
    gl_FragColor = vec4(vec3(c), 1.0);
  }`));
scene.add(ball);

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0.55)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.12)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), ...ADD }));
halo.scale.setScalar(2.2);
scene.add(halo);

const TRAIL = 48;
const trailPos = new Float32Array(TRAIL * 3);
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
trailGeo.setAttribute('aI', new THREE.Float32BufferAttribute([...Array(TRAIL).keys()].map((i) => i / TRAIL), 1));
const trail = new THREE.Points(trailGeo, shader({ uPx: U.px }, /* glsl */`
  attribute float aI; uniform float uPx; varying float vA;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vA = (1.0 - aI) * 0.7;
    gl_PointSize = (1.0 + (1.0 - aI) * 3.0) * uPx * (6.0 / max(-mv.z, 1.0));
    gl_Position = projectionMatrix * mv;
  }`, /* glsl */`
  varying float vA;
  void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(1.0), smoothstep(0.5, 0.1, d) * vA); }`, ADD));
trail.frustumCulled = false;
scene.add(trail);
let trailHead = 0, trailTimer = 0;

const PMAX = 900;
const parts = { pos: new Float32Array(PMAX * 3), vel: new Float32Array(PMAX * 3), life: new Float32Array(PMAX), max: new Float32Array(PMAX), size: new Float32Array(PMAX), i: 0 };
const partGeo = new THREE.BufferGeometry();
partGeo.setAttribute('position', new THREE.BufferAttribute(parts.pos, 3));
partGeo.setAttribute('aLife', new THREE.BufferAttribute(parts.life, 1));
partGeo.setAttribute('aSize', new THREE.BufferAttribute(parts.size, 1));
const particles = new THREE.Points(partGeo, shader({ uPx: U.px }, /* glsl */`
  attribute float aLife; attribute float aSize; uniform float uPx; varying float vA;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vA = aLife;
    gl_PointSize = aSize * uPx * (8.0 / max(-mv.z, 0.5)) * step(0.001, aLife);
    gl_Position = projectionMatrix * mv;
  }`, /* glsl */`
  varying float vA;
  void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(1.0), smoothstep(0.5, 0.1, d) * vA); }`, ADD));
particles.frustumCulled = false;
scene.add(particles);

function burst(at, n, speed, life = 1, size = 3, dirBias = null) {
  for (let k = 0; k < n; k++) {
    const i = parts.i++ % PMAX;
    const d = new THREE.Vector3().randomDirection().multiplyScalar(speed * (0.3 + Math.random() * 0.7));
    if (dirBias) d.addScaledVector(dirBias, speed * 0.6);
    parts.pos.set([at.x, at.y, at.z], i * 3);
    parts.vel.set([d.x, d.y, d.z], i * 3);
    parts.max[i] = life * (0.5 + Math.random() * 0.5);
    parts.life[i] = 1;
    parts.size[i] = size * (0.5 + Math.random());
  }
}
function updateParticles(dt) {
  for (let i = 0; i < PMAX; i++) {
    if (parts.life[i] <= 0) continue;
    parts.life[i] = Math.max(0, parts.life[i] - dt / parts.max[i]);
    const damp = Math.exp(-dt * 1.6);
    for (let a = 0; a < 3; a++) { parts.vel[i * 3 + a] *= damp; parts.pos[i * 3 + a] += parts.vel[i * 3 + a] * dt; }
  }
  partGeo.attributes.position.needsUpdate = true;
  partGeo.attributes.aLife.needsUpdate = true;
  partGeo.attributes.aSize.needsUpdate = true;
}

/* ------------------------------------------------------------------ */
/* Sound: tiny synth, starts on first tap                              */
/* ------------------------------------------------------------------ */
const audio = { ctx: null, master: null, on: true };
try { audio.on = localStorage.getItem('kippwelt-sound') !== 'off'; } catch (_) {}
function audioInit() {
  if (audio.ctx) { audio.ctx.resume && audio.ctx.resume(); return; }
  try {
    audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
    audio.master = audio.ctx.createGain();
    audio.master.gain.value = 0.5;
    audio.master.connect(audio.ctx.destination);
  } catch (_) { audio.ctx = null; }
}
function tone(f0, f1, dur, type = 'sine', vol = 0.12, delay = 0) {
  if (!audio.on || !audio.ctx) return;
  const c = audio.ctx, t = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(audio.master);
  o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol = 0.2) {
  if (!audio.on || !audio.ctx) return;
  const c = audio.ctx, n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
  const s = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 1200;
  g.gain.value = vol;
  s.buffer = buf; s.connect(f); f.connect(g); g.connect(audio.master); s.start();
}
const sfx = {
  roll: () => tone(190, 150, 0.07, 'triangle', 0.07),
  turn: () => tone(620, 540, 0.05, 'square', 0.03),
  wrap: () => { tone(160, 420, 0.25, 'sine', 0.1); tone(320, 840, 0.25, 'triangle', 0.03); },
  jump: () => tone(260, 760, 0.2, 'sine', 0.12),
  land: () => tone(140, 70, 0.1, 'sine', 0.14),
  bump: () => tone(90, 60, 0.08, 'square', 0.06),
  key: () => [660, 880, 1320].forEach((f, i) => tone(f, f, 0.18, 'triangle', 0.1, i * 0.07)),
  shard: () => tone(1500 + Math.random() * 300, 1900, 0.06, 'sine', 0.05),
  phase: () => { tone(220, 55, 0.45, 'sawtooth', 0.05); tone(110, 440, 0.45, 'sine', 0.06); },
  open: () => [440, 554, 659, 880].forEach((f, i) => tone(f, f, 0.4, 'sine', 0.07, i * 0.09)),
  die: () => { noise(0.5, 0.25); tone(300, 40, 0.6, 'sawtooth', 0.06); },
  win: () => [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, f * 1.01, 0.6, 'triangle', 0.08, i * 0.08)),
};
const vibrate = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (_) {} };

/* ------------------------------------------------------------------ */
/* Game state                                                          */
/* ------------------------------------------------------------------ */
const G = {
  mode: 'title', li: 0, L: null, s: null, phase: 1,
  keys: new Set(), shards: new Set(), time: 0, timeLeft: 0, deaths: 0, levelDeaths: 0,
  busy: false, queue: null, overview: 0, exitOpen: false, token: 0,
};
const vis = {
  pos: new THREE.Vector3(), frame: new THREE.Quaternion(), up: new THREE.Vector3(0, 1, 0), prev: new THREE.Vector3(),
  scale: 1,
};
let progress = { unlocked: 1, medals: {} };
try { progress = { ...progress, ...JSON.parse(localStorage.getItem('kippwelt-progress') || '{}') }; } catch (_) {}
const saveProgress = () => { try { localStorage.setItem('kippwelt-progress', JSON.stringify(progress)); } catch (_) {} };

const centerOf = (s) => V(s.b).addScaledVector(V(s.u), 0.5 + R);
function frameOf(s) {
  const u = V(s.u), f = V(s.f);
  const r = f.clone().cross(u);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, u, f.clone().negate()));
}

/* ---------- motion ---------- */
// Every move becomes a GSAP tween of t ∈ [0,1] that drives a path function.
function runMotion(dur, path, ease, done) {
  G.busy = true;
  const m = { t: 0 };
  gsap.to(m, {
    t: 1, duration: dur, ease,
    onUpdate: () => path(m.t),
    onComplete: () => { path(1); G.busy = false; done && done(); },
  });
}

function motionRoll(s0, s1, onDone) {
  const c0 = centerOf(s0), c1 = centerOf(s1);
  sfx.roll();
  runMotion(0.19, (t) => { vis.pos.lerpVectors(c0, c1, t); }, 'none', onDone);
}
function motionWrap(s0, s1, onDone) {
  const b = V(s0.b), u = V(s0.u), f = V(s0.f);
  const pivot = b.clone().addScaledVector(f, 0.5).addScaledVector(u, 0.5);
  const q0 = frameOf(s0), q1 = frameOf(s1);
  sfx.wrap();
  runMotion(0.42, (t) => {
    if (t < 1 / 3) {
      const k = t * 3;
      vis.pos.copy(b).addScaledVector(u, 0.5 + R).addScaledVector(f, 0.5 * k);
      vis.frame.copy(q0);
    } else if (t < 2 / 3) {
      const th = (t * 3 - 1) * Math.PI / 2;
      vis.pos.copy(pivot).addScaledVector(u, R * Math.cos(th)).addScaledVector(f, R * Math.sin(th));
      vis.frame.slerpQuaternions(q0, q1, t * 3 - 1);
    } else {
      const k = t * 3 - 2;
      vis.pos.copy(pivot).addScaledVector(f, R).addScaledVector(u, -0.5 * k);
      vis.frame.copy(q1);
    }
  }, 'none', onDone);
}
function motionTurn(s0, s1, onDone) {
  const q0 = frameOf(s0), q1 = frameOf(s1);
  sfx.turn();
  runMotion(0.2, (t) => vis.frame.slerpQuaternions(q0, q1, t), 'power2.out', onDone);
}
function motionJump(s0, s1, sub, onDone) {
  const c0 = centerOf(s0), c1 = centerOf(s1), u = V(s0.u);
  const h = sub === 'climb' ? 1.7 : sub === 'hop' ? 0.9 : sub === 'drop' ? 0.9 : 1.25;
  sfx.jump(); vibrate(6);
  gsap.fromTo(fx, { fovKick: 0 }, { fovKick: 6, duration: 0.2, yoyo: true, repeat: 1 });
  runMotion(sub === 'drop' ? 0.62 : 0.46, (t) => {
    vis.pos.lerpVectors(c0, c1, t).addScaledVector(u, h * 4 * t * (1 - t));
  }, 'none', () => {
    sfx.land();
    burst(V(s1.b).addScaledVector(V(s1.u), 0.5), 14, 2.2, 0.5, 2, V(s1.u));
    onDone && onDone();
  });
}
function motionBump(s0) {
  const c0 = centerOf(s0), f = V(s0.f);
  sfx.bump(); vibrate(15);
  runMotion(0.2, (t) => vis.pos.copy(c0).addScaledVector(f, 0.14 * Math.sin(Math.PI * t)), 'none', drainQueue);
}
function motionDrop(s0, s1, onDone) {
  const c0 = centerOf(s0), c1 = centerOf(s1);
  runMotion(0.18 + 0.08 * c0.distanceTo(c1), (t) => vis.pos.lerpVectors(c0, c1, t), 'power2.in', () => { sfx.land(); onDone && onDone(); });
}
function motionFall(s0, column, reason) {
  const c0 = centerOf(s0), u = V(s0.u);
  const top = V(column).addScaledVector(u, 0.5 + R);
  G.mode = 'dying';
  sfx.jump();
  runMotion(1.4, (t) => {
    const a = Math.min(1, t / 0.35);
    vis.pos.lerpVectors(c0, top, a).addScaledVector(u, 1.25 * 4 * a * (1 - a));
    if (t > 0.35) { const k = (t - 0.35) / 0.65; vis.pos.addScaledVector(u, -14 * k * k); vis.scale = 1 - k; }
  }, 'none', () => die(reason, false));
}

function drainQueue() {
  if (G.mode !== 'play') return;
  if (G.queue) { const a = G.queue; G.queue = null; doAction(a); return; }
  continueRoll();
}

// Joystick feel: while the thumb stays down after pushing up, the ball keeps rolling.
// The short grace period keeps a quick flick (finger already lifting) to one field.
const ROLL_HOLD_MS = 260;
function continueRoll() {
  if (!thumb || thumb.mode !== 'roll' || G.busy || G.mode !== 'play') return;
  const wait = thumb.rollSince + ROLL_HOLD_MS - performance.now();
  if (wait <= 0) { doAction('fwd'); return; }
  clearTimeout(thumb.rollTimer);
  thumb.rollTimer = setTimeout(continueRoll, wait + 10);
}

/* ---------- actions ---------- */
function doAction(a) {
  if (G.mode !== 'play') return;
  if (G.busy) { G.queue = a; return; }
  const s0 = G.s;
  if (a === 'phase') return doPhase();
  const r = act(G.L, s0, a, G.phase);
  const finish = (s1) => () => { G.s = s1; arrive(); drainQueue(); };
  switch (r.kind) {
    case 'turn': motionTurn(s0, r.to, finish(r.to)); break;
    case 'roll': motionRoll(s0, r.to, finish(r.to)); break;
    case 'wrap': motionWrap(s0, r.to, finish(r.to)); vibrate(8); break;
    case 'jump': motionJump(s0, r.to, r.sub, finish(r.to)); break;
    case 'blocked': if (thumb) thumb.mode = null; motionBump(s0); break;
    case 'fall': motionFall(s0, r.at, 'ins Leere gesprungen'); break;
  }
}

function doPhase() {
  if (!G.L.hasPhases) { doAction('back'); return; }
  G.phase = G.phase === 1 ? 2 : 1;
  sfx.phase(); vibrate([10, 30, 10]);
  gsap.to(levelU.uPhaseMix, { value: G.phase === 2 ? 1 : 0, duration: 0.5, ease: 'power3.inOut' });
  gsap.fromTo(fx, { fovKick: -8 }, { fovKick: 0, duration: 0.7, ease: 'expo.out' });
  bgEvent(vis.pos, 1.4);
  toast(G.phase === 1 ? 'phase a' : 'phase b');
  const r = afterPhase(G.L, G.s, G.phase);
  if (r.kind === 'crush') return die('zerdrückt');
  if (r.kind === 'fall') { motionFall(G.s, G.s.b, 'boden verschwunden'); return; }
  if (r.kind === 'drop') { const s1 = r.to; motionDrop(G.s, s1, () => { G.s = s1; arrive(); drainQueue(); }); }
}

function arrive() {
  const s = G.s, def = G.L.def;
  const sp = G.L.spikeAt(s);
  if (sp && spikeUp(sp, G.time) > 0.45) return die('stacheln');
  def.keys.forEach((k, i) => {
    if (G.keys.has(i) || !sameSpot(k, s)) return;
    G.keys.add(i);
    const o = lv.keys[i];
    sfx.key(); vibrate([12, 40, 12]);
    burst(o.position, 60, 4, 1.1, 4);
    bgEvent(o.position, 2);
    gsap.to(o.scale, { x: 0, y: 0, z: 0, duration: 0.45, ease: 'back.in(2)' });
    gsap.to(o.position, { x: vis.pos.x, y: vis.pos.y, z: vis.pos.z, duration: 0.45, ease: 'power2.in' });
    const left = def.keys.length - G.keys.size;
    toast(left ? `schlüssel · noch ${left}` : 'ausgang offen');
    updateKeysHud(i);
    if (!left) openExit();
  });
  def.shards.forEach((sh, i) => {
    if (G.shards.has(i) || !sameSpot(sh, s)) return;
    G.shards.add(i);
    const o = lv.shards[i];
    sfx.shard();
    burst(o.position, 18, 2.5, 0.6, 2);
    gsap.to(o.scale, { x: 0, y: 0, z: 0, duration: 0.25 });
    updateShardHud();
  });
  if (sameSpot(def.exit, s)) {
    if (G.exitOpen) win();
    else toast(`noch ${def.keys.length - G.keys.size} schlüssel`);
  }
}

function openExit() {
  G.exitOpen = true;
  sfx.open();
  gsap.to(lv.exit.userData.u.uActive, { value: 1, duration: 1.6, ease: 'expo.out' });
  burst(lv.exit.position, 80, 3, 1.4, 3);
}

/* ------------------------------------------------------------------ */
/* Level flow                                                          */
/* ------------------------------------------------------------------ */
function loadLevel(i, { keepDeaths = false } = {}) {
  G.li = i;
  const def = LEVELS[i];
  G.L = new Level(def);
  G.s = def.start;
  G.phase = 1;
  G.keys = new Set(); G.shards = new Set();
  lastSec = -1;
  G.timeLeft = def.time; G.busy = false; G.queue = null; G.exitOpen = false;
  if (!keepDeaths) G.levelDeaths = 0;
  gsap.killTweensOf(levelU.uPhaseMix);
  levelU.uPhaseMix.value = 0;
  buildLevel(G.L);
  backgrounds.forEach((b, k) => { b.visible = k === def.world; });
  const c = G.L.bounds().center;
  bgRoot.position.set(c[0], c[1], c[2]);
  bgU.uWell.value.set(0, 0, 0);
  vis.pos.copy(centerOf(G.s));
  vis.prev.copy(vis.pos);
  vis.frame.copy(frameOf(G.s));
  vis.scale = 1;
  ball.quaternion.identity();
  trailPos.fill(0);
  for (let k = 0; k < TRAIL; k++) trailPos.set([vis.pos.x, vis.pos.y, vis.pos.z], k * 3);
  levelU.uReveal.value = 0;
  gsap.to(levelU.uReveal, { value: 1, duration: REDUCED ? 0.3 : 1.6, ease: 'expo.out' });
  gsap.to(bgU.uBgReveal, { value: 1, duration: 2.4, ease: 'expo.out' });
  // snap camera close to its target
  camState.ready = false;
  updateLevelHud();
}

function startPlay(i) {
  audioInit();
  loadLevel(i);
  G.mode = 'play';
  showOverlay(null);
  $('hudTop').hidden = false;
  $('hudBottom').hidden = false;
  runHints(LEVELS[i].hints);
  wipe(1);
  animate('#lvlName span', { opacity: [0, 1], translateY: ['0.6em', 0], rotateX: [80, 0], delay: stagger(40), duration: 700, ease: 'outExpo' });
}

function die(reason, animateBall = true) {
  if (G.mode !== 'play' && G.mode !== 'dying') return;
  G.mode = 'dead';
  G.deaths++; G.levelDeaths++;
  if (thumb) thumb.mode = null;
  sfx.die(); vibrate([30, 40, 60]);
  burst(vis.pos, 140, 6, 1.4, 4);
  bgEvent(vis.pos, 3);
  if (animateBall) gsap.to(vis, { scale: 0, duration: 0.25, ease: 'power2.in' });
  gsap.fromTo(fx, { shake: 1.2 }, { shake: 0, duration: 1, ease: 'power2.out' });
  toast(reason);
  const token = ++G.token;
  setTimeout(() => {
    if (token !== G.token || G.mode !== 'dead') return;
    wipe(-1);
    setTimeout(() => {
      if (token !== G.token || G.mode !== 'dead') return;
      loadLevel(G.li, { keepDeaths: true });
      G.mode = 'play';
    }, 420);
  }, 900);
}

function win() {
  G.mode = 'won';
  if (thumb) thumb.mode = null;
  sfx.win(); vibrate([20, 50, 20, 50, 40]);
  const exitPos = lv.exit.position.clone().addScaledVector(V(G.s.u), 0.5);
  gsap.to(vis.pos, { x: exitPos.x, y: exitPos.y, z: exitPos.z, duration: 0.8, ease: 'power2.in' });
  gsap.to(vis, { scale: 0, duration: 0.8, ease: 'power3.in' });
  burst(exitPos, 160, 5, 1.6, 4, V(G.s.u));
  bgEvent(exitPos, 3);
  gsap.to(levelU.uReveal, { value: 0, duration: 1.2, delay: 0.6, ease: 'power3.in' });
  const def = LEVELS[G.li];
  const allShards = G.shards.size === def.shards.length;
  const medals = [true, allShards, G.levelDeaths === 0];
  const prev = progress.medals[def.id] || [false, false, false];
  progress.medals[def.id] = prev.map((m, k) => m || medals[k]);
  progress.unlocked = Math.max(progress.unlocked, Math.min(LEVELS.length, G.li + 2));
  saveProgress();
  setTimeout(() => showResult(medals), 1300);
}

/* ------------------------------------------------------------------ */
/* HUD + overlays                                                      */
/* ------------------------------------------------------------------ */
const WORLD_NAMES = ['wabe', 'senke'];
function splitLetters(el, text) {
  el.innerHTML = [...text].map((ch) => `<span>${ch === ' ' ? '&nbsp;' : ch}</span>`).join('');
  return el.querySelectorAll('span');
}
function updateLevelHud() {
  const def = LEVELS[G.li];
  $('lvlId').textContent = def.id;
  $('worldName').textContent = WORLD_NAMES[def.world];
  splitLetters($('lvlName'), def.name);
  $('keys').innerHTML = def.keys.map(() => '<i></i>').join('');
  updateShardHud();
}
function updateKeysHud(i) {
  const el = $('keys').children[i];
  el.classList.add('on');
  animate(el, { scale: [2.4, 1], rotate: ['225deg', '45deg'], duration: 700, ease: 'outElastic(1, .5)' });
}
function updateShardHud() { $('shards').textContent = `${G.shards.size}/${LEVELS[G.li].shards.length}`; }
let lastSec = -1;
function updateTimerHud() {
  const t = Math.max(0, G.timeLeft);
  const sec = Math.ceil(t);
  if (sec !== lastSec) {
    lastSec = sec;
    $('timeText').textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    $('timer').classList.toggle('low', sec <= 10);
  }
  $('timeBar').style.transform = `scaleX(${t / LEVELS[G.li].time})`;
}

let toastTimer = null;
function toast(text) {
  const el = $('toast');
  const letters = splitLetters(el, text);
  clearTimeout(toastTimer);
  animate(letters, { opacity: [0, 1], translateY: [14, 0], scale: [1.4, 1], delay: stagger(18), duration: 460, ease: 'outExpo' });
  toastTimer = setTimeout(() => animate(el.querySelectorAll('span'), { opacity: 0, translateY: -10, delay: stagger(10), duration: 300, ease: 'inQuad' }), 1200);
}

let hintTimers = [];
function runHints(hints) {
  hintTimers.forEach(clearTimeout);
  hintTimers = [];
  const el = $('hint');
  el.textContent = '';
  hints.forEach((h, k) => {
    hintTimers.push(setTimeout(() => {
      el.textContent = h;
      animate(el, { opacity: [0, 1], translateY: [8, 0], duration: 500, ease: 'outExpo' });
    }, 900 + k * 4600));
  });
  hintTimers.push(setTimeout(() => animate(el, { opacity: 0, duration: 600 }), 900 + hints.length * 4600));
}

function wipe(dir) {
  if (REDUCED) return;
  const from = dir > 0 ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)';
  const to = dir > 0 ? 'inset(0 100% 0 0)' : 'inset(0 0 0 100%)';
  gsap.timeline().set('#wipe', { clipPath: from })
    .to('#wipe', { clipPath: 'inset(0 0% 0 0%)', duration: 0.35, ease: 'power3.in' })
    .to('#wipe', { clipPath: to, duration: 0.5, ease: 'power3.out' });
}

function showOverlay(id) {
  ['title', 'pause', 'result'].forEach((k) => { $(k).hidden = k !== id; });
  if (!id) return;
  const el = $(id);
  if (!REDUCED) animate(el.querySelectorAll('.panel > *'), { opacity: [0, 1], translateY: [22, 0], delay: stagger(60), duration: 800, ease: 'outExpo' });
}

function renderLevelList() {
  const list = $('worldsList');
  list.innerHTML = '';
  [0, 1].forEach((w) => {
    const row = document.createElement('div');
    row.className = 'world-row';
    row.innerHTML = `<span>Welt ${w ? 'II' : 'I'}<b>${WORLD_NAMES[w]}</b></span><div class="lvls"></div>`;
    LEVELS.forEach((def, i) => {
      if (def.world !== w) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lvl';
      b.disabled = i >= progress.unlocked;
      const m = progress.medals[def.id] || [];
      b.innerHTML = `<small>${def.id}</small><em>${def.name}</em><span class="stars">${[0, 1, 2].map((k) => (m[k] ? '◆' : '◇')).join('')}</span>`;
      b.setAttribute('aria-label', `Level ${def.id} ${def.name}${b.disabled ? ', gesperrt' : ''}`);
      if (i === Math.min(progress.unlocked, LEVELS.length) - 1) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', () => startPlay(i));
      row.querySelector('.lvls').append(b);
    });
    list.append(row);
  });
}

function showTitle() {
  G.mode = 'title';
  $('hudTop').hidden = true;
  $('hudBottom').hidden = true;
  hintTimers.forEach(clearTimeout);
  renderLevelList();
  loadLevel(Math.min(progress.unlocked, LEVELS.length) - 1);
  showOverlay('title');
}

function showResult(medals) {
  const def = LEVELS[G.li];
  $('resId').textContent = def.id;
  const used = Math.round(def.time - G.timeLeft);
  $('resTime').textContent = `${Math.floor(used / 60)}:${String(used % 60).padStart(2, '0')}`;
  $('resShards').textContent = `${G.shards.size}/${def.shards.length}`;
  $('resDeaths').textContent = String(G.levelDeaths);
  $('nextBtn').hidden = G.li >= LEVELS.length - 1;
  showOverlay('result');
  const letters = splitLetters($('resTitle'), def.name);
  animate(letters, { opacity: [0, 1], translateY: ['0.6em', 0], delay: stagger(40), duration: 700, ease: 'outExpo' });
  const ms = [...$('medals').children];
  ms.forEach((m, k) => {
    m.classList.toggle('on', medals[k]);
    animate(m, { scale: [0, 1], rotate: ['0deg', '45deg'], delay: 400 + k * 160, duration: 800, ease: 'outElastic(1, .5)' });
  });
}

function setSound(on) {
  audio.on = on;
  try { localStorage.setItem('kippwelt-sound', on ? 'on' : 'off'); } catch (_) {}
  ['soundBtn', 'soundBtn2'].forEach((id) => { $(id).textContent = on ? 'Ton an' : 'Ton aus'; $(id).setAttribute('aria-pressed', String(on)); });
  if (on) audioInit();
}
setSound(audio.on);
$('soundBtn').addEventListener('click', () => setSound(!audio.on));
$('soundBtn2').addEventListener('click', () => setSound(!audio.on));
$('playBtn').addEventListener('click', () => startPlay(Math.min(progress.unlocked, LEVELS.length) - 1));
$('pauseBtn').addEventListener('click', () => { if (G.mode === 'play') { G.mode = 'paused'; showOverlay('pause'); } });
$('resumeBtn').addEventListener('click', () => { showOverlay(null); G.mode = 'play'; });
$('restartBtn').addEventListener('click', () => startPlay(G.li));
$('menuBtn').addEventListener('click', showTitle);
$('menuBtn2').addEventListener('click', showTitle);
$('againBtn').addEventListener('click', () => startPlay(G.li));
$('nextBtn').addEventListener('click', () => startPlay(Math.min(G.li + 1, LEVELS.length - 1)));

/* ------------------------------------------------------------------ */
/* Thumb input                                                         */
/* ------------------------------------------------------------------ */
// One pointer only. Slide up = roll (keeps rolling while the thumb stays down),
// slide sideways = turn once and stop, slide up again = roll on, slide down = phase, tap = jump, hold still = overview.
const fxLayer = $('fx');
let thumb = null;
const SWIPE = 26, HOLD_MS = 340;
const RING = '<svg viewBox="0 0 80 80"><circle class="base" cx="40" cy="40" r="24"/><circle class="prog" cx="40" cy="40" r="36"/></svg>';
const ARROWS = { up: 'M28 48 L40 34 L52 48', down: 'M28 34 L40 48 L52 34', left: 'M48 28 L34 40 L48 52', right: 'M32 28 L46 40 L32 52' };

function ringAt(x, y) {
  const el = document.createElement('div');
  el.className = 'touch'; el.innerHTML = RING;
  el.style.left = x + 'px'; el.style.top = y + 'px';
  fxLayer.append(el);
  animate(el, { scale: [0.3, 1], opacity: [0, 1], duration: 300, ease: 'outExpo' });
  const prog = animate(el.querySelector('.prog'), { strokeDashoffset: [226.2, 0], duration: HOLD_MS, delay: 60, ease: 'linear' });
  return { el, prog };
}
function arrowAt(x, y, dir) {
  const el = document.createElement('div');
  el.className = 'arrow';
  el.innerHTML = `<svg viewBox="0 0 80 80"><path d="${ARROWS[dir]}"/></svg>`;
  el.style.left = x + 'px'; el.style.top = y + 'px';
  fxLayer.append(el);
  const d = { up: [0, -30], down: [0, 30], left: [-30, 0], right: [30, 0] }[dir];
  animate(el, { translateX: [0, d[0]], translateY: [0, d[1]], opacity: [1, 0], scale: [0.8, 1.3], duration: 480, ease: 'outExpo', onComplete: () => el.remove() });
}
function setOverview(on) {
  gsap.to(G, { overview: on ? 1 : 0, duration: on ? 0.7 : 0.5, ease: 'power3.inOut' });
  if (on) { toast('übersicht'); vibrate(8); }
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (G.mode !== 'play' || thumb) return;
  audioInit();
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  const ring = ringAt(e.clientX, e.clientY);
  thumb = { id: e.pointerId, x0: e.clientX, y0: e.clientY, rx: e.clientX, ry: e.clientY, t0: performance.now(), consumed: false, mode: null, ring };
  thumb.hold = setTimeout(() => {
    if (thumb && !thumb.consumed) { thumb.mode = 'overview'; thumb.consumed = true; setOverview(true); }
  }, HOLD_MS);
});
canvas.addEventListener('pointermove', (e) => {
  if (!thumb || e.pointerId !== thumb.id) return;
  thumb.ring.el.style.left = e.clientX + 'px';
  thumb.ring.el.style.top = e.clientY + 'px';
  if (thumb.mode === 'overview') return;
  const dx = e.clientX - thumb.rx, dy = e.clientY - thumb.ry;
  if (Math.hypot(dx, dy) < SWIPE) return;
  clearTimeout(thumb.hold);
  thumb.ring.prog.pause();
  const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy < 0 ? 'up' : 'down');
  thumb.rx = e.clientX; thumb.ry = e.clientY;
  // One swipe = one action: further movement in the same direction is absorbed.
  if (dir === thumb.lastDir) return;
  thumb.lastDir = dir;
  thumb.consumed = true;
  arrowAt(e.clientX, e.clientY, dir);
  if (dir === 'up') { thumb.mode = 'roll'; thumb.rollSince = performance.now(); doAction('fwd'); }
  else if (dir === 'down') { thumb.mode = null; doAction('phase'); }
  else { thumb.mode = null; doAction(dir); } // turn once, then wait for the next push up
});
function thumbUp(e) {
  if (!thumb || e.pointerId !== thumb.id) return;
  clearTimeout(thumb.hold);
  clearTimeout(thumb.rollTimer);
  thumb.ring.prog.pause();
  const r = thumb.ring.el;
  animate(r, { scale: 1.6, opacity: 0, duration: 420, ease: 'outExpo', onComplete: () => r.remove() });
  if (thumb.mode === 'overview') setOverview(false);
  else if (!thumb.consumed && e.type === 'pointerup' && performance.now() - thumb.t0 < 320) doAction('jump');
  thumb = null;
}
canvas.addEventListener('pointerup', thumbUp);
canvas.addEventListener('pointercancel', thumbUp);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const KEYMAP = { ArrowUp: 'fwd', w: 'fwd', ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right', ArrowDown: 'phase', s: 'phase', ' ': 'jump' };
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && G.mode === 'play') { $('pauseBtn').click(); return; }
  if (e.key === 'Shift' && G.mode === 'play') { setOverview(true); return; }
  const a = KEYMAP[e.key];
  if (!a || G.mode !== 'play') return;
  e.preventDefault();
  audioInit();
  if (!e.repeat || a === 'fwd') doAction(a);
});
window.addEventListener('keyup', (e) => { if (e.key === 'Shift' && G.overview > 0) setOverview(false); });

/* ------------------------------------------------------------------ */
/* Camera + loop                                                       */
/* ------------------------------------------------------------------ */
const fx = { fovKick: 0, shake: 0 };
const camState = { ready: false, pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
const _m = new THREE.Matrix4(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion(), _p2 = new THREE.Vector3();

function cameraTarget(dt) {
  const up = _c.set(0, 1, 0).applyQuaternion(vis.frame);
  // follow cam: behind and above the ball, in the ball's gravity frame
  _a.set(0, 3.1, 4.7).applyQuaternion(vis.frame).add(vis.pos);
  _b.set(0, -0.2, -3.2).applyQuaternion(vis.frame).add(vis.pos);
  _m.lookAt(_a, _b, up);
  _q.setFromRotationMatrix(_m);
  if (G.overview > 0.001 || G.mode === 'title') {
    const bd = G.L.bounds();
    const ctr = V(bd.center);
    const k = bd.size * 1.15 + 5;
    if (G.mode === 'title') {
      const t = U.time.value * 0.12;
      _p2.set(Math.sin(t) * k, k * 0.55, Math.cos(t) * k).add(ctr);
      _m.lookAt(_p2, ctr, UP);
    } else {
      _p2.set(0, k * 0.85, k * 0.9).applyQuaternion(vis.frame).add(ctr);
      _m.lookAt(_p2, ctr, up);
    }
    _q2.setFromRotationMatrix(_m);
    const w = G.mode === 'title' ? 1 : G.overview;
    _a.lerp(_p2, w);
    _q.slerp(_q2, w);
  }
  if (!camState.ready) { camState.pos.copy(_a); camState.quat.copy(_q); camState.ready = true; }
  const s = 1 - Math.exp(-dt * (G.mode === 'title' ? 3 : 7));
  camState.pos.lerp(_a, s);
  camState.quat.slerp(_q, s);
  camera.position.copy(camState.pos);
  camera.quaternion.copy(camState.quat);
}

const clock = new THREE.Clock();
let frames = 0, slow = 0;
const _spin = new THREE.Vector3(), _axis = new THREE.Vector3(), _sq = new THREE.Quaternion();

function loop() {
  requestAnimationFrame(loop);
  if (document.hidden) { clock.getDelta(); return; }
  const dt = Math.min(clock.getDelta(), 1 / 20);
  U.time.value += dt;
  if (G.mode === 'play' || G.mode === 'dying') G.time += dt;

  if (G.mode === 'play') {
    G.timeLeft -= dt;
    updateTimerHud();
    if (G.timeLeft <= 0) die('zeit abgelaufen');
    else if (!G.busy) {
      const sp = G.L.spikeAt(G.s);
      if (sp && spikeUp(sp, G.time) > 0.6) die('stacheln');
    }
  }

  // ball: position, rolling spin from displacement, glow
  _spin.subVectors(vis.pos, vis.prev);
  const up = _c.set(0, 1, 0).applyQuaternion(vis.frame);
  _spin.addScaledVector(up, -_spin.dot(up));
  const dist = _spin.length();
  if (dist > 1e-5) {
    _axis.crossVectors(up, _spin).normalize();
    _sq.setFromAxisAngle(_axis, dist / R);
    ball.quaternion.premultiply(_sq);
  }
  vis.prev.copy(vis.pos);
  ball.position.copy(vis.pos);
  ball.scale.setScalar(Math.max(0.0001, vis.scale) * (G.mode === 'title' ? 0.0001 : 1));
  halo.position.copy(vis.pos);
  halo.material.opacity = vis.scale * (G.mode === 'title' ? 0 : 1);
  bgU.uWell.value.lerp(_a.copy(vis.pos).sub(bgRoot.position), 1 - Math.exp(-dt * 0.8));

  trailTimer += dt;
  if (trailTimer > 0.016) {
    trailTimer = 0;
    trailPos.copyWithin(3, 0, (TRAIL - 1) * 3);
    trailPos.set([vis.pos.x, vis.pos.y, vis.pos.z], 0);
    trailGeo.attributes.position.needsUpdate = true;
  }
  trail.visible = G.mode !== 'title';

  // items
  const t = U.time.value;
  lv.keys.forEach((o, i) => {
    if (G.keys.has(i)) return;
    o.rotation.set(t * 0.7 + i, t * 1.3, 0);
    o.position.copy(o.userData.base).addScaledVector(o.userData.u, Math.sin(t * 2 + i) * 0.08);
  });
  lv.shards.forEach((o, i) => {
    if (G.shards.has(i)) return;
    o.rotation.set(t * 2 + i, t * 3, 0);
    o.position.copy(o.userData.base).addScaledVector(o.userData.u, Math.sin(t * 3 + i * 1.7) * 0.05);
  });
  lv.spikes.forEach((o) => { o.userData.pyramid.scale.set(1, Math.max(0.02, spikeUp(o.userData.spike, G.time)), 1); });

  updateParticles(dt);
  cameraTarget(dt);
  camera.fov = 62 + fx.fovKick + G.overview * 4;
  if (fx.shake > 0.001) {
    const s = U.time.value * 50;
    camera.rotateZ(Math.sin(s) * 0.025 * fx.shake);
    camera.rotateX(Math.cos(s * 1.3) * 0.02 * fx.shake);
  }
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);

  frames++;
  if (frames > 30 && frames < 150 && dt > 1 / 40) slow++;
  if (frames === 150 && slow > 50 && dpr > 1) {
    dpr = Math.max(1, dpr * 0.66);
    renderer.setPixelRatio(dpr);
    U.px.value = dpr;
    resize();
  }
}

showTitle();
loop();

// debug / test hook
window.kippwelt = { G, LEVELS, doAction, startPlay, loadLevel, solve };
