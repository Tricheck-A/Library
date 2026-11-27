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
const bgU = { uTime: U.time, uPx: U.px, uPulse: { value: bgPulse }, uWell: { value: new THREE.Vector3() }, uBgReveal: { value: 0 }, uFollow: { value: new THREE.Vector2() }, uBeat: { value: 0 } };
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
const starField = stars();
scene.add(starField);

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
    uniform float uTime, uBgReveal; uniform vec4 uPulse[4]; uniform vec2 uFollow;
    varying vec3 vE; varying float vH, vY, vTop, vSeed, vFog;
    void main(){
      vec2 wq = aOff + uFollow;
      float n = fbm(vec3(wq * 0.07, uTime * 0.05));
      float h = 0.3 + 7.0 * n * n;
      for (int i = 0; i < 4; i++) {
        vec4 P = uPulse[i]; float age = uTime - P.z;
        if (age < 0.0 || age > 7.0) continue;
        float w = length(wq - P.xy) - age * 10.0;
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
    attribute float aSeed; uniform float uTime, uPx, uBgReveal; uniform vec4 uPulse[4]; uniform vec3 uWell; uniform vec2 uFollow;
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
        float w = length(p + uFollow - P.xy) - age * 12.0;
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
function shaftBackground() {
  // wireframe shaft (from "schacht") wrapped around the runner track
  const W = 7, LEN = 120, pos = [], wrap = [];
  const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let z = 0; z < LEN; z += 3) for (let k = 0; k < 4; k++) {
    const a = c[k], b = c[(k + 1) % 4];
    pos.push(a[0] * W, a[1] * W, -z, b[0] * W, b[1] * W, -z); wrap.push(1, 1);
  }
  for (let w = 0; w < 4; w++) for (let i = 0; i <= 6; i++) {
    const t = -1 + i / 3;
    const xy = [[t, -1], [1, t], [t, 1], [-1, t]][w];
    pos.push(xy[0] * W, xy[1] * W, 12, xy[0] * W, xy[1] * W, -LEN); wrap.push(0, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aWrap', new THREE.Float32BufferAttribute(wrap, 1));
  const u = { uTravel: { value: 0 }, uBgReveal: bgU.uBgReveal, uBeat: bgU.uBeat };
  const m = shader(u, /* glsl */`
    attribute float aWrap; uniform float uTravel, uBgReveal, uBeat; varying float vA;
    void main(){
      vec3 p = position;
      if (aWrap > 0.5) p.z = mod(p.z + uTravel, ${'120.0'}) - 108.0;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vA = exp(-(-mv.z) * 0.03) * smoothstep(-108.0, -80.0, p.z) * uBgReveal * (aWrap > 0.5 ? 0.6 + uBeat * 0.4 : 0.35);
      gl_Position = projectionMatrix * mv;
    }`, /* glsl */`
    varying float vA;
    void main(){ gl_FragColor = vec4(vec3(1.0), vA); }`, ADD);
  const lines = new THREE.LineSegments(g, m);
  lines.frustumCulled = false;
  lines.userData.u = u;
  return lines;
}
const backgrounds = [hexBackground(), wellBackground(), shaftBackground()];
backgrounds.forEach((b) => { b.visible = false; scene.add(b); });
const bgRoot = new THREE.Group();
scene.add(bgRoot);
backgrounds.slice(0, 2).forEach((b) => bgRoot.add(b)); // the shaft is placed in world space by the runner

/* ------------------------------------------------------------------ */
/* Level objects                                                       */
/* ------------------------------------------------------------------ */
const levelU = { uTime: U.time, uReveal: { value: 0 }, uPhaseMix: { value: 0 }, uFog: { value: 0.035 }, uBeat: bgU.uBeat };
const BLOCK_VS = /* glsl */`
  attribute vec3 aPos; attribute float aPhase; attribute float aSeed;
  uniform float uTime, uReveal, uPhaseMix, uFog;
  varying vec2 vUv; varying vec3 vN; varying float vSolid, vPhase, vFog, vSeed;
  void main(){
    float solid = (aPhase < 0.5 || aPhase > 2.5) ? 1.0 : (aPhase < 1.5 ? 1.0 - uPhaseMix : uPhaseMix);
    float rv = ease3(uReveal * 1.7 - aSeed * 0.7);
    vec3 p = position * mix(0.84, 1.0, ease3(solid)) * mix(0.1, 1.0, rv);
    if (aPhase > 0.5 && solid < 0.5) p += normal * 0.04 * sin(uTime * 6.0 + aSeed * 20.0);
    vec3 wp = aPos + p + vec3(0.0, (1.0 - rv) * (4.0 + aSeed * 9.0), 0.0);
    vUv = uv; vN = normal; vSolid = solid; vPhase = aPhase; vSeed = aSeed;
    vec4 mv = modelViewMatrix * vec4(wp, 1.0);
    vFog = exp(-(-mv.z) * uFog) * rv;
    gl_Position = projectionMatrix * mv;
  }`;
const BLOCK_FS = /* glsl */`
  uniform float uTime, uBeat;
  varying vec2 vUv; varying vec3 vN; varying float vSolid, vPhase, vFog, vSeed;
  float ring(float d, float r){ return 1.0 - smoothstep(0.009, 0.009 + fwidth(d) * 1.3, abs(d - r)); }
  void main(){
    float ex = min(vUv.x, 1.0 - vUv.x), ey = min(vUv.y, 1.0 - vUv.y);
    float e = min(ex, ey);
    float along = ex < ey ? vUv.y : vUv.x;
    float edge = 1.0 - smoothstep(0.03, 0.03 + fwidth(e) * 1.5, e);
    float d = max(abs(vUv.x - 0.5), abs(vUv.y - 0.5));
    float c;
    if (vPhase > 2.5) {
      float pat = ring(d, 0.3) + ring(d, 0.18) + ring(d, 0.06);
      c = max(edge, pat * 0.7) * (abs(vN.y) > 0.5 ? 1.0 : 0.85) + 0.14 + edge * uBeat * 0.6;
    } else if (vPhase < 0.5) {
      float pat = abs(vN.y) > 0.5 ? ring(d, 0.3) + ring(d, 0.16) : (abs(vN.x) > 0.5 ? ring(d, 0.34) + ring(d, 0.22) + ring(d, 0.1) : ring(d, 0.2));
      c = max(edge, pat * 0.42) * (abs(vN.y) > 0.5 ? 1.0 : abs(vN.x) > 0.5 ? 0.86 : 0.72) + 0.03 + edge * uBeat * 0.35;
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
function noise(dur, vol = 0.2, delay = 0, hp = 0) {
  if (!audio.on || !audio.ctx) return;
  const c = audio.ctx, n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
  const s = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter();
  f.type = hp ? 'highpass' : 'lowpass'; f.frequency.value = hp || 1200;
  g.gain.value = vol;
  s.buffer = buf; s.connect(f); f.connect(g); g.connect(audio.master); s.start(c.currentTime + delay);
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
  lv.group.visible = true;
  runGroup.visible = false;
  levelU.uFog.value = 0.035;
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
  musicStop();
  $('runHud').hidden = true;
  $('turnArrow').hidden = true;
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
  ['title', 'pause', 'result', 'runOver'].forEach((k) => { $(k).hidden = k !== id; });
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
  musicStop();
  $('runHud').hidden = true;
  $('turnArrow').hidden = true;
  $('runBest').textContent = `Rekord ${RUN.best} m`;
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
$('resumeBtn').addEventListener('click', () => {
  showOverlay(null);
  if (G.mode === 'runpause') { G.mode = 'run'; musicStart(); } else G.mode = 'play';
});
$('restartBtn').addEventListener('click', () => (G.mode === 'runpause' ? startRun() : startPlay(G.li)));
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
  if (G.mode === 'run') { runDown(e); return; }
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
  if (rthumb && e.pointerId === rthumb.id) { runMove(e); return; }
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
  if (rthumb && e.pointerId === rthumb.id) { runUp(e); return; }
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
const RUNKEYS = { ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right', ArrowUp: 'up', w: 'up', ArrowDown: 'down', s: 'down', ' ': 'tap' };
window.addEventListener('keydown', (e) => {
  if (G.mode === 'run') {
    if (e.key === 'Escape') { $('runPauseBtn').click(); return; }
    if (e.key === 'Shift') { if (RUN.focus > 0.1) setSlowmo(true); return; }
    const a = RUNKEYS[e.key];
    if (!a || e.repeat) return;
    e.preventDefault();
    audioInit();
    runInput(a);
    return;
  }
  if (e.key === 'Escape' && G.mode === 'play') { $('pauseBtn').click(); return; }
  if (e.key === 'Shift' && G.mode === 'play') { setOverview(true); return; }
  const a = KEYMAP[e.key];
  if (!a || G.mode !== 'play') return;
  e.preventDefault();
  audioInit();
  if (!e.repeat || a === 'fwd') doAction(a);
});
window.addEventListener('keyup', (e) => {
  if (e.key !== 'Shift') return;
  if (RUN.slow) setSlowmo(false);
  if (G.overview > 0) setOverview(false);
});

/* ------------------------------------------------------------------ */
/* LAUF: endless runner on a 3×3 beam                                  */
/* Lanes like a subway runner, corners like a temple runner, pads,     */
/* air rings and gravity portals like a rhythm platformer, plus the    */
/* Kippwelt twist: past the outer lane you tip over onto the next side. */
/* ------------------------------------------------------------------ */
const Y = new THREE.Vector3(0, 1, 0);
const BIOMES = [{ name: 'wabe', bg: 0, root: 0 }, { name: 'senke', bg: 1, root: 3 }, { name: 'schacht', bg: 2, root: -2 }];
const BIOME_LEN = 420;
const GRAV = 40, JUMP_V = 12, PAD_V = 17;
const runGroup = new THREE.Group();
runGroup.visible = false;
scene.add(runGroup);
const RUNMAP = new Map(); // world cell → 0 shell, 1 / 2 phase block, 3 obstacle
const RUN = {
  segs: [], si: 0, s: 0, fi: 0, lane: 0, uT: 0, uV: 0, y: 0, vy: 0, prevY: 0, grounded: true,
  speed: 8, dist: 0, genDist: 0, shards: 0, phase: 1, turnQueued: false, sog: 0, focus: 1,
  timeScale: 1, slow: false, biome: 0, offset: new THREE.Vector3(), jumpBuf: 0, best: 0, nextId: 0,
};
try { RUN.best = +localStorage.getItem('kippwelt-best') || 0; } catch (_) {}
const saveBest = () => { try { localStorage.setItem('kippwelt-best', String(RUN.best)); } catch (_) {} };

const kv = (v) => Math.round(v.x) + ',' + Math.round(v.y) + ',' + Math.round(v.z);
function faceN(d, i) {
  i = ((i % 4) + 4) % 4;
  const r = new THREE.Vector3().crossVectors(d, Y);
  return [Y.clone(), r.clone(), Y.clone().negate(), r.clone().negate()][i];
}
const speedAt = (dist) => Math.min(19, 8 + dist * 0.0042 + Math.floor(dist / BIOME_LEN) * 0.6);
const faceCell = (seg, k, fi, lane, h = 0) =>
  seg.o.clone().addScaledVector(seg.d, k).addScaledVector(faceN(seg.d, fi), 1 + h).addScaledVector(faceN(seg.d, fi + 1), lane);
function occ(p) {
  const t = RUNMAP.get(kv(p));
  if (t === undefined) return false;
  return t === 0 || t === 3 || t === RUN.phase;
}
const RUNREF = new Map();
function setCell(seg, p, type) {
  const k = kv(p);
  RUNMAP.set(k, type);
  RUNREF.set(k, (RUNREF.get(k) || 0) + 1);
  seg.cells.push(k);
}

// Position on the beam's rounded perimeter. u counts lanes around the beam:
// face i holds lanes at u = 3i-1, 3i, 3i+1; between faces the ball wraps the edge.
function perim(d, u, outP, outN) {
  const k = ((u % 12) + 12) % 12;
  const i = Math.floor((k + 1) / 3) % 4;
  let t = k - 3 * i;
  if (t > 6) t -= 12;
  const n = faceN(d, i), a = faceN(d, i + 1), H = 1.5 + R;
  if (t <= 1) { outP.copy(n).multiplyScalar(H).addScaledVector(a, t); outN.copy(n); return; }
  const c = t - 1;
  if (c < 1 / 3) { outP.copy(n).multiplyScalar(H).addScaledVector(a, 1 + 1.5 * c); outN.copy(n); }
  else if (c < 2 / 3) {
    const th = (c * 3 - 1) * Math.PI / 2;
    outN.copy(n).multiplyScalar(Math.cos(th)).addScaledVector(a, Math.sin(th));
    outP.copy(n).multiplyScalar(1.5).addScaledVector(a, 1.5).addScaledVector(outN, R);
  } else { outP.copy(a).multiplyScalar(H).addScaledVector(n, 1.5 - 1.5 * (c * 3 - 2)); outN.copy(a); }
}

/* ---------- item meshes ---------- */
const orbGeo = new THREE.TorusGeometry(0.45, 0.035, 8, 40);
const portalGeo = new THREE.TorusGeometry(3.3, 0.06, 8, 96);
const sogGeo = new THREE.IcosahedronGeometry(0.28);
const sogEdges = new THREE.EdgesGeometry(sogGeo);
[orbGeo, portalGeo, sogGeo, sogEdges].forEach((g) => { g.userData.keep = true; });
const _bm = new THREE.Matrix4();
function frameQuat(d, n) {
  const a = new THREE.Vector3().crossVectors(d, n);
  return new THREE.Quaternion().setFromRotationMatrix(_bm.makeBasis(a, n, d.clone().negate()));
}
function padLines() {
  const pts = [];
  const sq = [[-0.4, -0.4], [0.4, -0.4], [0.4, 0.4], [-0.4, 0.4]];
  for (let i = 0; i < 4; i++) { const a = sq[i], b = sq[(i + 1) % 4]; pts.push(a[0], 0.02, a[1], b[0], 0.02, b[1]); }
  for (const z of [0.15, -0.1]) pts.push(-0.25, 0.02, z + 0.1, 0, 0.02, z - 0.15, 0, 0.02, z - 0.15, 0.25, 0.02, z + 0.1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}
const padGeo = padLines();
padGeo.userData.keep = true;

/* ---------- track generation ---------- */
function addObstacle(seg, k, fi, lane, h) { for (let t = 1; t <= h; t++) setCell(seg, faceCell(seg, k, fi, lane, t), 3); }
function addSpike(seg, k, fi, lane) {
  const n = faceN(seg.d, fi);
  const o = new THREE.Group();
  o.add(new THREE.Mesh(spikeGeo, black), new THREE.LineSegments(spikeEdges, lineMat));
  o.quaternion.copy(frameQuat(seg.d, n));
  o.position.copy(faceCell(seg, k, fi, lane)).addScaledVector(n, 0.5);
  seg.group.add(o);
  seg.spikes.push({ k, fi, lane });
}
function addGap(seg, k, fi, len) {
  for (let q = k; q < k + len; q++) for (let l = -1; l <= 1; l++) RUNMAP.delete(kv(faceCell(seg, q, fi, l)));
}
function addShard(seg, k, fi, lane, h) {
  const n = faceN(seg.d, fi);
  seg.shards.push({ pos: faceCell(seg, k, fi, lane).addScaledVector(n, 0.5 + R + h), alive: true });
}
function shardLine(seg, k, fi, lane, len, h = 0) { for (let q = 0; q < len; q++) addShard(seg, k + q, fi, lane, h); }
function shardArc(seg, k, fi, lane, len) {
  for (let q = 0; q <= len; q++) addShard(seg, k + q, fi, lane, 0.2 + 1.5 * Math.sin((q / len) * Math.PI));
}
function addPad(seg, k, fi) {
  const n = faceN(seg.d, fi);
  for (let l = -1; l <= 1; l++) {
    const m = new THREE.LineSegments(padGeo, lineMat);
    m.quaternion.copy(frameQuat(seg.d, n));
    m.position.copy(faceCell(seg, k, fi, l)).addScaledVector(n, 0.5);
    seg.group.add(m);
  }
  seg.pads.push({ k, fi });
}
function addOrb(seg, k, fi, lane, h) {
  const n = faceN(seg.d, fi);
  const m = new THREE.Mesh(orbGeo, white);
  m.quaternion.copy(frameQuat(seg.d, n));
  m.position.copy(faceCell(seg, k, fi, lane)).addScaledVector(n, 0.5 + R + h);
  seg.group.add(m);
  seg.orbs.push({ k, fi, lane, h, used: false, mesh: m });
}
function addPortal(seg, k) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(portalGeo, white));
  for (let i = 0; i < 8; i++) {
    const o = new THREE.Mesh(shardGeo, white);
    const a = (i / 8) * Math.PI * 2;
    o.position.set(Math.cos(a) * 3.3, Math.sin(a) * 3.3, 0);
    o.scale.setScalar(2.2);
    g.add(o);
  }
  g.quaternion.copy(frameQuat(seg.d, Y));
  g.position.copy(seg.o).addScaledVector(seg.d, k);
  seg.group.add(g);
  seg.portals.push({ k, passed: false, mesh: g });
}
function addSog(seg, k, fi, lane) {
  const n = faceN(seg.d, fi);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(sogGeo, black), new THREE.LineSegments(sogEdges, lineMat));
  g.position.copy(faceCell(seg, k, fi, lane)).addScaledVector(n, 0.5 + R + 0.25);
  seg.group.add(g);
  seg.items.push({ type: 'sog', pos: g.position.clone(), mesh: g, alive: true });
}

const pickLane = () => [-1, 0, 1][(Math.random() * 3) | 0];
function weighted(list) {
  const total = list.reduce((s, [w]) => s + Math.max(0, w), 0);
  let r = Math.random() * total;
  for (const [w, fn] of list) { r -= Math.max(0, w); if (r <= 0) return fn; }
  return list[0][1];
}
// Every face pattern is beatable on its own face, so staying on one side is always possible.
function facePattern(seg, k, fi, D) {
  const fn = weighted([
    [3 - 2 * D, () => { shardLine(seg, k, fi, pickLane(), 4); return 0; }],
    [2, () => { const l = pickLane(); addObstacle(seg, k, fi, l, 1); shardLine(seg, k - 1, fi, l === 0 ? 1 : 0, 3); return 0; }],
    [0.8 + 2 * D, () => { const free = pickLane(); [-1, 0, 1].forEach((l) => l !== free && addObstacle(seg, k, fi, l, 1)); shardLine(seg, k - 1, fi, free, 3); return 0; }],
    [1.6, () => { [-1, 0, 1].forEach((l) => addObstacle(seg, k, fi, l, 1 + (D > 0.5 && Math.random() < 0.3 ? 0 : 0))); shardLine(seg, k, fi, pickLane(), 2, 1); return 1; }],
    [1.6, () => { addSpike(seg, k, fi, pickLane()); return 0; }],
    [1.2 + D, () => { [-1, 0, 1].forEach((l) => addSpike(seg, k, fi, l)); shardArc(seg, k - 2, fi, pickLane(), 4); return 0; }],
    [1 + D, () => { const free = pickLane(); [-1, 0, 1].forEach((l) => l !== free && addObstacle(seg, k, fi, l, 2)); return 0; }],
    [1.4 + D, () => { const len = D > 0.45 ? 3 : 2; addGap(seg, k, fi, len); shardArc(seg, k - 1, fi, pickLane(), len + 1); return len; }],
    [D * 1.4, () => { [-1, 0, 1].forEach((l) => { addObstacle(seg, k, fi, l, 1); addObstacle(seg, k + 3, fi, l, 2); }); shardLine(seg, k + 3, fi, pickLane(), 1, 2); return 4; }],
    [0.6 + D * 0.8, () => { addPad(seg, k, fi); [-1, 0, 1].forEach((l) => { addObstacle(seg, k + 3, fi, l, 2); addObstacle(seg, k + 4, fi, l, 2); }); shardArc(seg, k, fi, 0, 6); return 8; }],
    [D > 0.3 ? 1 : 0, () => { addGap(seg, k, fi, 5); [-1, 0, 1].forEach((l) => addOrb(seg, k + 1, fi, l, 1.45)); return 5; }],
  ]);
  return fn();
}

function makeSeg(prev) {
  let o, d;
  if (!prev) { o = new THREE.Vector3(); d = new THREE.Vector3(0, 0, -1); }
  else {
    o = prev.o.clone().addScaledVector(prev.d, prev.L);
    const r = new THREE.Vector3().crossVectors(prev.d, Y);
    d = (prev.turn === 'right' ? r : r.negate()).round();
  }
  const D = Math.min(1, RUN.genDist / 1800);
  const L = Math.round(THREE.MathUtils.lerp(64, 42, D) + Math.random() * 12);
  let turn = Math.random() < 0.5 ? 'left' : 'right';
  if (prev && prev.turn === turn && prev.prevTurn === turn) turn = turn === 'left' ? 'right' : 'left';
  const seg = {
    id: RUN.nextId++, o, d, r: new THREE.Vector3().crossVectors(d, Y), L, turn, prevTurn: prev ? prev.turn : null,
    cells: [], spikes: [], pads: [], orbs: [], portals: [], shards: [], items: [], group: new THREE.Group(), start: RUN.genDist,
  };
  for (let k = prev ? 1 : -8; k <= L; k++) for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    if (i || j) setCell(seg, o.clone().addScaledVector(d, k).addScaledVector(Y, i).addScaledVector(seg.r, j), 0);
  }
  let k = prev ? 9 : 44; // first segment: long run-in while the hints show
  while (k < L - 12) {
    const dd = Math.min(1, (seg.start + k) / 1800);
    let extra = 0;
    const g = Math.random();
    if (g < 0.09 + dd * 0.05) { addPortal(seg, k); extra = 3; }
    else if (g < 0.18 + dd * 0.1) {
      const p = Math.random() < 0.5 ? 1 : 2;
      for (let fi = 0; fi < 4; fi++) for (let l = -1; l <= 1; l++) for (let h = 1; h <= 2; h++) setCell(seg, faceCell(seg, k, fi, l, h), p);
      extra = 2;
    } else {
      for (let fi = 0; fi < 4; fi++) extra = Math.max(extra, facePattern(seg, k, fi, dd));
      if (Math.random() < 0.06) addSog(seg, k + 3, (Math.random() * 4) | 0, pickLane());
    }
    k += Math.round(Math.max(7, speedAt(seg.start + k) * 0.62 + 3) + extra);
  }
  if (seg.shards.length) {
    const im = new THREE.InstancedMesh(shardGeo, white, seg.shards.length);
    const q = new THREE.Quaternion(), sc = new THREE.Vector3(1.5, 1.5, 1.5);
    seg.shards.forEach((sh, i) => { q.setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, 0)); im.setMatrixAt(i, _bm.compose(sh.pos, q, sc)); });
    im.frustumCulled = false;
    seg.shardMesh = im;
    seg.group.add(im);
  }
  RUN.genDist += L;
  runGroup.add(seg.group);
  return seg;
}

let runMesh = null;
function rebuildBlocks() {
  const n = RUNMAP.size;
  const pos = new Float32Array(n * 3), ph = new Float32Array(n), sd = new Float32Array(n);
  let i = 0;
  for (const [k, t] of RUNMAP) {
    const c = k.split(',');
    pos[i * 3] = +c[0]; pos[i * 3 + 1] = +c[1]; pos[i * 3 + 2] = +c[2];
    ph[i] = t; sd[i] = (Math.sin(+c[0] * 12.9 + +c[1] * 78.2 + +c[2] * 37.7) * 43758.5) % 1;
    i++;
  }
  const g = new THREE.InstancedBufferGeometry().copy(blockGeo);
  g.setAttribute('aPos', new THREE.InstancedBufferAttribute(pos, 3));
  g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(sd.map(Math.abs), 1));
  g.instanceCount = n;
  if (runMesh) { runMesh.geometry.dispose(); runMesh.geometry = g; }
  else { runMesh = new THREE.Mesh(g, shader(levelU, BLOCK_VS, BLOCK_FS)); runMesh.frustumCulled = false; runGroup.add(runMesh); }
}
function dropSeg(seg) {
  seg.cells.forEach((k) => {
    const n = (RUNREF.get(k) || 1) - 1;
    if (n <= 0) { RUNREF.delete(k); RUNMAP.delete(k); } else RUNREF.set(k, n);
  });
  seg.group.traverse((o) => { if (o.geometry && !o.geometry.userData.keep && o.geometry !== blockGeo) o.geometry.dispose(); });
  runGroup.remove(seg.group);
}
function manageSegs() {
  let changed = false;
  while (RUN.segs.length - RUN.si < 3) { RUN.segs.push(makeSeg(RUN.segs[RUN.segs.length - 1])); changed = true; }
  while (RUN.si > 1) { dropSeg(RUN.segs.shift()); RUN.si--; changed = true; }
  if (changed) rebuildBlocks();
}

/* ---------- music (kick, hat, bass arpeggio) ---------- */
const music = { on: false, timer: null, next: 0, step: 0, t0: 0, bpm: 124, root: 0 };
const BASS = [0, 0, 12, 0, 7, 0, 10, 3];
function musicStart() {
  musicStop();
  if (!audio.ctx || !audio.on) return;
  music.on = true; music.step = 0;
  music.next = audio.ctx.currentTime + 0.12; music.t0 = music.next;
  music.timer = setInterval(musicTick, 25);
}
function musicStop() { clearInterval(music.timer); music.on = false; }
function musicTick() {
  const c = audio.ctx;
  if (!c || !audio.on) return;
  const e = 60 / music.bpm / 2;
  while (music.next < c.currentTime + 0.15) {
    const st = music.step, d = Math.max(0, music.next - c.currentTime);
    if (st % 2 === 0) tone(150, 42, 0.22, 'sine', 0.22, d);
    else noise(0.04, 0.05, d, 7000);
    if (st % 8 === 4) noise(0.12, 0.07, d, 1500);
    const f = 55 * Math.pow(2, (music.root + BASS[st % 8]) / 12);
    tone(f, f * 0.99, 0.16, 'triangle', 0.09, d);
    if (st % 16 === 0) [0, 7, 12].forEach((n, i) => { const g = 220 * Math.pow(2, (music.root + n) / 12); tone(g, g, 0.3, 'sine', 0.025, d + i * e * 0.5); });
    music.next += e; music.step++;
  }
}
function beatValue() {
  if (music.on && audio.ctx) return Math.exp(-(((audio.ctx.currentTime - music.t0) * music.bpm / 60) % 1) * 5);
  return Math.exp(-((U.time.value * music.bpm / 60) % 1) * 5);
}

/* ---------- run flow ---------- */
function clearRun() {
  RUN.segs.forEach(dropSeg);
  RUN.segs = [];
  RUNMAP.clear();
  RUNREF.clear();
}
function setBiome(b, announce) {
  RUN.biome = b;
  const bio = BIOMES[b % BIOMES.length];
  backgrounds.forEach((m, k) => { m.visible = k === bio.bg; });
  music.root = bio.root;
  $('runBiome').textContent = bio.name;
  if (announce) {
    wipe(1);
    toast(bio.name);
    bgU.uBgReveal.value = 0;
    gsap.to(bgU.uBgReveal, { value: 1, duration: 2.4, ease: 'expo.out' });
  }
}
function startRun() {
  audioInit();
  clearRun();
  Object.assign(RUN, {
    si: 0, s: 0, fi: 0, lane: 0, uT: 0, uV: 0, y: 0, vy: 0, prevY: 0, grounded: true, speed: 8, dist: 0, genDist: 0,
    shards: 0, phase: 1, turnQueued: false, sog: 0, focus: 1, timeScale: 1, slow: false, jumpBuf: 0,
  });
  RUN.offset.set(0, 0, 0);
  manageSegs();
  lv.group.visible = false;
  runGroup.visible = true;
  gsap.killTweensOf(levelU.uPhaseMix);
  levelU.uPhaseMix.value = 0;
  levelU.uFog.value = 0.02;
  levelU.uReveal.value = 0;
  gsap.to(levelU.uReveal, { value: 1, duration: REDUCED ? 0.3 : 1.4, ease: 'expo.out' });
  setBiome(0, false);
  bgU.uBgReveal.value = 0;
  gsap.to(bgU.uBgReveal, { value: 1, duration: 2.4, ease: 'expo.out' });
  vis.scale = 1;
  ball.quaternion.identity();
  runVisual(0);
  vis.prev.copy(vis.pos);
  for (let k = 0; k < TRAIL; k++) trailPos.set([vis.pos.x, vis.pos.y, vis.pos.z], k * 3);
  camState.ready = false;
  hintTimers.forEach(clearTimeout);
  $('hudTop').hidden = true; $('hudBottom').hidden = true;
  $('runHud').hidden = false;
  showOverlay(null);
  G.mode = 'run';
  musicStart();
  wipe(1);
  toast('los');
  runModeHints();
}
function runModeHints() {
  const el = $('hint');
  $('hudBottom').hidden = false;
  const hints = ['Wisch links / rechts: Spur. Außen kippst du über die Kante', 'Tippen: springen', 'Pfeil erscheint: in Pfeilrichtung wischen', 'Wisch runter: Phase. Halten: Zeitlupe'];
  hints.forEach((h, k) => hintTimers.push(setTimeout(() => {
    if (G.mode !== 'run') return;
    el.textContent = h;
    animate(el, { opacity: [0, 1], translateY: [8, 0], duration: 500, ease: 'outExpo' });
  }, 600 + k * 3800)));
  hintTimers.push(setTimeout(() => { $('hudBottom').hidden = true; }, 600 + hints.length * 3800));
}
function runDie(reason) {
  if (G.mode !== 'run') return;
  if (RUN.god) { RUN.godHits = (RUN.godHits || 0) + 1; RUN.lastHit = reason; if (RUN.y < -2) { RUN.y = 0; RUN.vy = 0; } return; }
  G.mode = 'rundying';
  setSlowmo(false);
  musicStop();
  sfx.die(); vibrate([30, 40, 80]);
  burst(vis.pos, 160, 7, 1.4, 4);
  bgEvent(vis.pos, 3);
  gsap.to(vis, { scale: 0, duration: 0.2 });
  gsap.fromTo(fx, { shake: 1.4 }, { shake: 0, duration: 1, ease: 'power2.out' });
  toast(reason);
  const d = Math.floor(RUN.dist);
  const rec = d > RUN.best;
  if (rec) { RUN.best = d; saveBest(); }
  setTimeout(() => {
    if (G.mode !== 'rundying') return;
    G.mode = 'runover';
    $('overReason').textContent = rec ? 'neuer rekord' : reason;
    $('overDist').textContent = d + ' m';
    $('overShards').textContent = String(RUN.shards);
    $('overBest').textContent = RUN.best + ' m';
    $('turnArrow').hidden = true;
    showOverlay('runOver');
  }, 1200);
}

/* ---------- run actions ---------- */
function turnRequired() {
  const seg = RUN.segs[RUN.si];
  const win = 6 + RUN.speed * 0.35;
  if (seg.L - RUN.s > win || RUN.s > seg.L + 0.6 || RUN.turnQueued) return null;
  const nd = new THREE.Vector3().crossVectors(seg.d, Y);
  if (seg.turn === 'left') nd.negate();
  const n = faceN(seg.d, RUN.fi), a = faceN(seg.d, RUN.fi + 1);
  const da = nd.dot(a), dn = nd.dot(n);
  return da > 0.5 ? 'right' : da < -0.5 ? 'left' : dn > 0.5 ? 'up' : 'down';
}
function laneShift(dl) {
  RUN.lane += dl; RUN.uT += dl;
  if (RUN.lane > 1) { RUN.fi += 1; RUN.lane = -1; sfx.wrap(); vibrate(8); bgEvent(vis.pos, 0.8); }
  else if (RUN.lane < -1) { RUN.fi -= 1; RUN.lane = 1; sfx.wrap(); vibrate(8); bgEvent(vis.pos, 0.8); }
  else sfx.turn();
}
function runJump() {
  if (RUN.grounded) {
    RUN.vy = JUMP_V; RUN.grounded = false;
    sfx.jump(); vibrate(6);
    return;
  }
  const seg = RUN.segs[RUN.si];
  const orb = seg.orbs.find((o) => !o.used && o.fi === RUN.fi && o.lane === RUN.lane && Math.abs(RUN.s - o.k) < 1.4 && Math.abs(RUN.y - o.h) < 1.3);
  if (orb) {
    orb.used = true;
    RUN.vy = JUMP_V;
    sfx.key(); vibrate([6, 20, 6]);
    burst(orb.mesh.position, 40, 4, 0.8, 3);
    gsap.to(orb.mesh.scale, { x: 2.4, y: 2.4, z: 2.4, duration: 0.3, ease: 'expo.out' });
    gsap.to(orb.mesh.scale, { x: 0, y: 0, z: 0, duration: 0.3, delay: 0.2 });
    return;
  }
  RUN.jumpBuf = 0.14; // pressed just before landing: jump on touchdown
}
function runPhase() {
  RUN.phase = RUN.phase === 1 ? 2 : 1;
  sfx.phase(); vibrate([10, 30, 10]);
  gsap.to(levelU.uPhaseMix, { value: RUN.phase === 2 ? 1 : 0, duration: 0.3, ease: 'power3.inOut' });
  gsap.fromTo(fx, { fovKick: -8 }, { fovKick: 0, duration: 0.6, ease: 'expo.out' });
  bgEvent(vis.pos, 1.4);
  $('runPhase').textContent = RUN.phase === 1 ? 'phase a' : 'phase b';
  animate('#runPhase', { scale: [1.5, 1], duration: 500, ease: 'outElastic(1, .5)' });
  const seg = RUN.segs[RUN.si];
  if (occ(faceCell(seg, Math.round(RUN.s), RUN.fi, RUN.lane, Math.floor(RUN.y + 0.3) + 1))) runDie('zerdrückt');
}
function runInput(dir) {
  if (G.mode !== 'run') return;
  if (dir === 'tap') return runJump();
  const req = turnRequired();
  if (req && dir === req) {
    RUN.turnQueued = true;
    sfx.turn(); vibrate(10);
    $('turnArrow').hidden = true;
    arrowAt(window.innerWidth / 2, window.innerHeight * 0.52, dir);
    burst(vis.pos, 24, 3, 0.6, 2);
    return;
  }
  if (dir === 'left' || dir === 'right') laneShift(dir === 'right' ? 1 : -1);
  else if (dir === 'up') runJump();
  else runPhase();
}
function setSlowmo(on) {
  if (RUN.slow === on) return;
  RUN.slow = on;
  gsap.to(RUN, { timeScale: on ? 0.45 : 1, duration: on ? 0.25 : 0.4, ease: 'power2.out', overwrite: 'auto' });
  if (on) { toast('fokus'); vibrate(8); }
}

/* ---------- run simulation ---------- */
function stackAt(seg, k) {
  if (!occ(faceCell(seg, k, RUN.fi, RUN.lane))) return -Infinity;
  let h = 0;
  while (h < 4 && occ(faceCell(seg, k, RUN.fi, RUN.lane, h + 1))) h++;
  return h;
}
function transfer() {
  const seg = RUN.segs[RUN.si];
  const before = vis.pos.clone();
  RUN.s -= seg.L;
  RUN.si++;
  RUN.turnQueued = false;
  runVisual(0);
  RUN.offset.add(before.sub(vis.pos));
  sfx.wrap();
  bgEvent(vis.pos, 1.2);
  manageSegs();
}
function runStep(dt) {
  const ts = dt * RUN.timeScale;
  let seg = RUN.segs[RUN.si];
  RUN.speed = speedAt(RUN.dist);
  const adv = RUN.speed * ts;
  RUN.s += adv; RUN.dist += adv;
  if (RUN.turnQueued && RUN.s >= seg.L) { transfer(); seg = RUN.segs[RUN.si]; }

  // vertical motion along the current face normal
  RUN.prevY = RUN.y;
  RUN.vy -= GRAV * ts;
  RUN.y += RUN.vy * ts;
  const k = Math.round(RUN.s);
  const floor = stackAt(seg, k);
  if (RUN.vy <= 0 && RUN.prevY >= floor - 0.05 && RUN.y <= floor) {
    if (!RUN.grounded) { sfx.land(); burst(vis.pos, 10, 2, 0.4, 2); }
    RUN.y = floor; RUN.vy = 0; RUN.grounded = true;
    if (RUN.jumpBuf > 0) { RUN.jumpBuf = 0; runJump(); }
  } else if (RUN.y > floor + 0.02) RUN.grounded = false;
  RUN.jumpBuf = Math.max(0, RUN.jumpBuf - ts);

  // front collision: anything taller than the ball's height ahead
  if (stackAt(seg, Math.round(RUN.s + 0.32)) > RUN.y + 0.32) return runDie('aufgeprallt');
  if (RUN.y < -2.4) return runDie(RUN.s > seg.L + 0.5 ? 'kurve verpasst' : 'abgestürzt');

  for (const sp of seg.spikes) if (sp.fi === RUN.fi && sp.lane === RUN.lane && Math.abs(RUN.s - sp.k) < 0.42 && RUN.y < 0.45) return runDie('stacheln');
  if (RUN.grounded && RUN.y < 0.05) for (const p of seg.pads) if (p.fi === RUN.fi && Math.abs(RUN.s - p.k) < 0.5) {
    RUN.vy = PAD_V; RUN.grounded = false;
    sfx.open(); vibrate(14);
    burst(vis.pos, 30, 4, 0.7, 3);
    gsap.fromTo(fx, { fovKick: 10 }, { fovKick: 0, duration: 0.8, ease: 'expo.out' });
  }
  for (const p of seg.portals) if (!p.passed && RUN.s >= p.k) {
    p.passed = true;
    RUN.fi += 2; RUN.uT += 6;
    RUN.vy = Math.max(RUN.vy, 3);
    sfx.wrap(); sfx.open(); vibrate([10, 30, 10]);
    bgEvent(vis.pos, 2.4);
    burst(p.mesh.position, 80, 5, 1, 3);
    gsap.fromTo(fx, { fovKick: 16 }, { fovKick: 0, duration: 0.9, ease: 'expo.out' });
    gsap.to(p.mesh.scale, { x: 1.6, y: 1.6, z: 1.6, duration: 0.5, ease: 'expo.out' });
  }

  // pickups in the current and next segment
  const reach = RUN.sog > 0 ? 3.6 : 0.8;
  for (let si = RUN.si; si < Math.min(RUN.segs.length, RUN.si + 2); si++) {
    const sg = RUN.segs[si];
    sg.shards.forEach((sh, i) => {
      if (!sh.alive || sh.pos.distanceToSquared(vis.pos) > reach * reach) return;
      sh.alive = false;
      RUN.shards++;
      sfx.shard();
      burst(sh.pos, 8, 2, 0.4, 2);
      sg.shardMesh.setMatrixAt(i, _bm.makeScale(0, 0, 0));
      sg.shardMesh.instanceMatrix.needsUpdate = true;
    });
    sg.items.forEach((it) => {
      if (!it.alive || it.pos.distanceToSquared(vis.pos) > 1) return;
      it.alive = false;
      it.mesh.visible = false;
      RUN.sog = 8;
      sfx.key(); toast('sog'); vibrate([10, 30, 10]);
      burst(it.pos, 60, 4, 1, 3);
      $('sogMeter').hidden = false;
    });
  }
  RUN.sog = Math.max(0, RUN.sog - dt);
  if (RUN.sog === 0) $('sogMeter').hidden = true;

  // focus meter: drains in slow motion, refills otherwise
  if (RUN.slow) { RUN.focus -= dt / 2.5; if (RUN.focus <= 0) { RUN.focus = 0; setSlowmo(false); } }
  else RUN.focus = Math.min(1, RUN.focus + dt / 14);

  const b = Math.floor(RUN.dist / BIOME_LEN);
  if (b !== RUN.biome) setBiome(b, true);
  if (RUN.s > seg.L * 0.5) manageSegs();
}

const _pp = new THREE.Vector3(), _pn = new THREE.Vector3(), _pa = new THREE.Vector3(), _pd = new THREE.Vector3(), _rm = new THREE.Matrix4();
function runVisual(dt) {
  const seg = RUN.segs[RUN.si];
  RUN.uV += (RUN.uT - RUN.uV) * (dt ? 1 - Math.exp(-dt * 16) : 1);
  perim(seg.d, RUN.uV, _pp, _pn);
  vis.pos.copy(seg.o).addScaledVector(seg.d, RUN.s).add(_pp).addScaledVector(_pn, RUN.y).add(RUN.offset);
  if (dt) RUN.offset.multiplyScalar(Math.exp(-dt * 9));
  _pa.crossVectors(seg.d, _pn);
  vis.frame.setFromRotationMatrix(_rm.makeBasis(_pa, _pn, _pd.copy(seg.d).negate()));
}

const _rc = new THREE.Vector3(), _rl = new THREE.Vector3(), _ru = new THREE.Vector3(), _rq = new THREE.Quaternion();
function runCamera(dt) {
  const seg = RUN.segs[RUN.si];
  _ru.set(0, 1, 0).applyQuaternion(vis.frame);
  // lateral offset of the ball from the face centre, so the camera stays calmer than the ball
  _rl.copy(vis.pos).sub(seg.o).addScaledVector(seg.d, -RUN.s).sub(RUN.offset).addScaledVector(_ru, -(1.5 + R + RUN.y));
  _rl.addScaledVector(_ru, -_rl.dot(_ru));
  _rc.copy(vis.pos).addScaledVector(_ru, 2.7 - RUN.y * 0.45).addScaledVector(seg.d, -5.8).addScaledVector(_rl, -0.4);
  _b.copy(vis.pos).addScaledVector(seg.d, 8).addScaledVector(_rl, -0.35).addScaledVector(_ru, -RUN.y * 0.3);
  _m.lookAt(_rc, _b, _ru);
  _rq.setFromRotationMatrix(_m);
  if (!camState.ready) { camState.pos.copy(_rc); camState.quat.copy(_rq); camState.ready = true; }
  const s = 1 - Math.exp(-dt * 9);
  camState.pos.lerp(_rc, s);
  camState.quat.slerp(_rq, 1 - Math.exp(-dt * 7));
  camera.position.copy(camState.pos);
  camera.quaternion.copy(camState.quat);
}

let hudTick = 0;
function runFrame(dt) {
  if (G.mode === 'run') runStep(dt);
  else if (G.mode === 'rundying') { RUN.vy -= GRAV * dt * 0.5; RUN.y += RUN.vy * dt * 0.5; }
  if (G.mode === 'run' || G.mode === 'rundying') runVisual(dt);
  runCamera(dt);

  // backgrounds travel with the ball, snapped to their lattice so they stay put
  const bio = BIOMES[RUN.biome % BIOMES.length];
  if (bio.bg === 0) bgRoot.position.set(Math.round(vis.pos.x / 3.12) * 3.12, 0, Math.round(vis.pos.z / 1.8013) * 1.8013);
  else bgRoot.position.set(Math.round(vis.pos.x / 2) * 2, 0, Math.round(vis.pos.z / 2) * 2);
  const shaft = backgrounds[2];
  const seg = RUN.segs[RUN.si];
  shaft.position.copy(seg.o).addScaledVector(seg.d, RUN.s);
  shaft.quaternion.copy(frameQuat(seg.d, Y));
  shaft.userData.u.uTravel.value = RUN.dist;

  // turn arrow
  const req = G.mode === 'run' ? turnRequired() : null;
  if (req && RUN.god) runInput(req); // test autopilot
  const arrow = $('turnArrow');
  if (req) {
    if (arrow.hidden) {
      arrow.hidden = false;
      animate('#turnArrow svg', { scale: [0.6, 1], opacity: [0, 1], duration: 300, ease: 'outBack(2)' });
      sfx.turn();
    }
    arrow.style.transform = `rotate(${{ right: 0, down: 90, left: 180, up: -90 }[req]}deg) translateX(${Math.sin(U.time.value * 12) * 6}px)`;
  } else arrow.hidden = true;

  // items spin
  const t = U.time.value;
  RUN.segs.forEach((sg) => {
    sg.items.forEach((it) => { it.mesh.rotation.set(t * 1.3, t * 2, 0); });
    sg.portals.forEach((p) => { p.mesh.rotateZ(dt * 0.8); });
  });

  hudTick += dt;
  if (hudTick > 0.1) {
    hudTick = 0;
    $('runDist').textContent = Math.floor(RUN.dist) + ' m';
    $('runShards').textContent = String(RUN.shards);
    $('focusBar').style.transform = `scaleX(${RUN.focus})`;
    $('sogBar').style.transform = `scaleX(${RUN.sog / 8})`;
  }
}

/* ---------- run thumb input ---------- */
let rthumb = null;
function runDown(e) {
  if (rthumb) return;
  audioInit();
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  rthumb = { id: e.pointerId, rx: e.clientX, ry: e.clientY, t0: performance.now(), consumed: false, lastDir: null, ring: ringAt(e.clientX, e.clientY) };
  rthumb.hold = setTimeout(() => {
    if (rthumb && !rthumb.consumed && RUN.focus > 0.1) { rthumb.slow = true; rthumb.consumed = true; setSlowmo(true); }
  }, 300);
}
function runMove(e) {
  rthumb.ring.el.style.left = e.clientX + 'px';
  rthumb.ring.el.style.top = e.clientY + 'px';
  const dx = e.clientX - rthumb.rx, dy = e.clientY - rthumb.ry;
  if (Math.hypot(dx, dy) < SWIPE) return;
  clearTimeout(rthumb.hold);
  rthumb.ring.prog.pause();
  const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy < 0 ? 'up' : 'down');
  rthumb.rx = e.clientX; rthumb.ry = e.clientY;
  if (dir === rthumb.lastDir) return;
  rthumb.lastDir = dir;
  rthumb.consumed = true;
  arrowAt(e.clientX, e.clientY, dir);
  runInput(dir);
}
function runUp(e) {
  clearTimeout(rthumb.hold);
  rthumb.ring.prog.pause();
  const r = rthumb.ring.el;
  animate(r, { scale: 1.6, opacity: 0, duration: 420, ease: 'outExpo', onComplete: () => r.remove() });
  if (rthumb.slow) setSlowmo(false);
  else if (!rthumb.consumed && e.type === 'pointerup' && performance.now() - rthumb.t0 < 300) runInput('tap');
  rthumb = null;
}

$('runBtn').addEventListener('click', startRun);
$('runPauseBtn').addEventListener('click', () => { if (G.mode === 'run') { G.mode = 'runpause'; setSlowmo(false); musicStop(); showOverlay('pause'); } });
$('runAgainBtn').addEventListener('click', startRun);
$('runMenuBtn').addEventListener('click', () => showTitle());

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

  const inRun = G.mode === 'run' || G.mode === 'rundying' || G.mode === 'runover' || G.mode === 'runpause';
  levelU.uBeat.value = inRun ? beatValue() : 0;

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
  if (inRun) {
    runFrame(G.mode === 'runpause' ? 0 : dt);
    camera.fov = 66 + (RUN.speed - 8) * 0.9 - (1 - RUN.timeScale) * 10 + fx.fovKick + levelU.uBeat.value * 1.2;
  } else {
    cameraTarget(dt);
    camera.fov = 62 + fx.fovKick + G.overview * 4;
  }
  bgU.uFollow.value.set(bgRoot.position.x, bgRoot.position.z);
  starField.position.copy(camera.position);
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
window.kippwelt = { G, LEVELS, doAction, startPlay, loadLevel, solve, RUN, startRun, runInput };
