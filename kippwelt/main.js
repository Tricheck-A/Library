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
// Post FX: the scene renders into a texture, then one composite pass adds chromatic
// aberration, radial motion blur, vignette, grain and (in bullet time) afterimages.
// Farbrausch: cosine palettes (a + b·cos(2π(c·t + d))) give a whole harmonious spectrum at once;
// c stretches / folds the spectrum, d phase-shifts the three channels.
const PALETTES = {
  regenbogen: { c: [1, 1, 1], d: [0.0, 0.33, 0.67] },   // full rainbow
  synth:      { c: [1, 1, 1], d: [0.8, 0.9, 0.3] },      // magenta, violet, cyan, gold
  koralle:    { c: [1, 0.7, 0.4], d: [0.0, 0.15, 0.2] }, // coral, peach, teal, petrol
  aqua:       { c: [1, 1, 0.5], d: [0.8, 0.9, 0.3] },    // pink, mint, blue, lime
  sunset:     { c: [2, 1, 0], d: [0.5, 0.2, 0.25] },     // red, amber, turquoise, plum
  saeure:     { c: [1, 1, 1], d: [0.3, 0.2, 0.2] },      // lime, magenta, cyan, orange
  uv:         { c: [1, 1, 1], d: [0.5, 0.2, 0.25] },     // violet, pink, yellow, green
};
const ZONE_PALETTE = { wogen: 'koralle', senke: 'saeure', fluss: 'aqua', sand: 'sunset', spirale: 'regenbogen', schlange: 'uv', negativ: 'saeure' };
const BIOME_PALETTE = ['synth', 'uv', 'aqua'];
const post = {
  scene: new THREE.WebGLRenderTarget(1, 1, { samples: 4 }),
  a: new THREE.WebGLRenderTarget(1, 1),
  b: new THREE.WebGLRenderTarget(1, 1),
  cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
  quad: new THREE.Scene(),
};
const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
post.mat = new THREE.ShaderMaterial({
  uniforms: {
    tScene: { value: null }, tPrev: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 },
    uCA: { value: 0 }, uBlur: { value: 0 }, uAfter: { value: 0 }, uFlash: { value: 0 }, uVig: { value: 0.55 }, uInvert: { value: 0 },
    uColor: { value: 0 }, uHue: { value: 0 }, uTrip: { value: 1 }, uPalMix: { value: 1 },
    uPCA: { value: V3(PALETTES.synth.c) }, uPDA: { value: V3(PALETTES.synth.d) }, uPCB: { value: V3(PALETTES.synth.c) }, uPDB: { value: V3(PALETTES.synth.d) },
    uCenter: { value: new THREE.Vector2(0.5, 0.52) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tScene, tPrev; uniform vec2 uRes, uCenter; uniform float uTime, uCA, uBlur, uAfter, uFlash, uVig, uInvert;
    uniform float uColor, uHue, uTrip, uPalMix; uniform vec3 uPCA, uPDA, uPCB, uPDB;
    varying vec2 vUv;
    vec3 ca(vec2 uv, vec2 d){
      return vec3(texture2D(tScene, uv + d * uCA).r, texture2D(tScene, uv).g, texture2D(tScene, uv - d * uCA).b);
    }
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    vec3 spectrum(float t){
      vec3 c = mix(uPCA, uPCB, uPalMix), dd = mix(uPDA, uPDB, uPalMix);
      return 0.5 + 0.5 * cos(6.2831853 * (c * t + dd));
    }
    // rotate a colour around the grey axis (hue shift)
    vec3 hueRot(vec3 c, float a){
      const vec3 k = vec3(0.57735);
      float cs = cos(a);
      return c * cs + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cs);
    }
    void main(){
      vec2 d = vUv - uCenter;
      // melting: the whole picture wobbles gently in colour mode
      vec2 uv = vUv + uColor * uTrip * 0.0045 * vec2(sin(vUv.y * 11.0 + uTime * 1.3) + sin(vUv.y * 23.0 - uTime * 0.7) * 0.4,
                                                     cos(vUv.x * 9.0 + uTime * 1.1) + cos(vUv.x * 19.0 + uTime * 0.9) * 0.4);
      vec3 col;
      if (uBlur > 0.01) {
        col = vec3(0.0);
        for (int i = 0; i < 6; i++) col += ca(uv - d * uBlur * float(i) * 0.022, d);
        col /= 6.0;
      } else col = ca(uv, d);
      col = mix(col, 1.0 - col, uInvert);
      if (uColor > 0.001) {
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        vec2 q = d * vec2(uRes.x / uRes.y, 1.0);
        float r = length(q), ang = atan(q.y, q.x);
        // one colour field over the whole screen: rings, spiral petals, a slow domain warp, and luminance,
        // so neighbouring shapes always sit in different hues and everything keeps flowing
        float warp = sin(q.x * 5.0 + uTime * 0.6 + sin(q.y * 4.0 - uTime * 0.5)) * cos(q.y * 6.0 - uTime * 0.8);
        float field = uHue + r * 1.6 - uTime * 0.11 + 0.22 * sin(3.0 * ang + r * 5.0 - uTime * 0.9) * uTrip + warp * 0.18 * uTrip + lum * 1.5;
        vec3 glow = spectrum(field);
        vec3 dc = spectrum(field + 0.5);
        vec3 deep = dc * dc * dc * 0.24;                                // shadows: the complementary hue, deep and saturated
        float bands = abs(fract(lum * 5.0 - uTime * 0.35 + r * 0.6) - 0.5) * 2.0; // luminance contours, wandering
        vec3 contour = spectrum(field * 1.7 + 0.25) * smoothstep(0.82, 1.0, 1.0 - bands) * smoothstep(0.06, 0.35, lum);
        vec3 cc = mix(deep, glow * (0.3 + 1.15 * lum), smoothstep(0.02, 0.45, lum));
        cc += contour * 0.55 * uTrip;
        cc += spectrum(field + 0.33) * smoothstep(0.75, 1.0, lum) * 0.4;   // hot cores shimmer in a third hue
        cc += (col - lum) * 1.8;                                         // keep the RGB split fringes
        col = mix(col, cc, uColor);
      }
      float vig = smoothstep(1.15, 0.3, length(d * vec2(uRes.x / uRes.y, 1.0)));
      col *= mix(1.0, vig, uVig * (1.0 - uInvert * 0.7) * (1.0 - uColor * 0.5));
      col += (hash(vUv * uRes + fract(uTime) * 91.0) - 0.5) * 0.04 * (1.0 - uColor * 0.7);
      if (uAfter > 0.01) {
        // colour mode: the echo is zoomed a touch and hue-shifted every frame → rainbow tunnel trails
        vec2 fuv = uCenter + (vUv - uCenter) * mix(1.0, 0.986, uColor);
        vec3 prev = hueRot(texture2D(tPrev, fuv).rgb, uColor * 0.09);
        col = max(col, prev * uAfter - 0.03);
      }
      gl_FragColor = vec4(col + uFlash, 1.0);
    }`,
  depthTest: false, depthWrite: false,
});
post.copy = new THREE.MeshBasicMaterial({ map: null, depthTest: false, depthWrite: false });
post.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post.mat);
post.mesh.frustumCulled = false;
post.quad.add(post.mesh);

let palName = 'synth';
function setPalette(name, dur = 2) {
  if (!PALETTES[name] || name === palName) return;
  palName = name;
  const u = post.mat.uniforms;
  // freeze the current blend into A, then fade towards the new palette in B
  u.uPCA.value.lerp(u.uPCB.value, u.uPalMix.value);
  u.uPDA.value.lerp(u.uPDB.value, u.uPalMix.value);
  u.uPCB.value.copy(V3(PALETTES[name].c));
  u.uPDB.value.copy(V3(PALETTES[name].d));
  gsap.killTweensOf(u.uPalMix);
  u.uPalMix.value = 0;
  gsap.to(u.uPalMix, { value: 1, duration: dur, ease: 'sine.inOut' });
}
post.mat.uniforms.uTrip.value = REDUCED ? 0.3 : 1;
let colorOn = false;
try { colorOn = localStorage.getItem('kippwelt-color') === 'on'; } catch (_) {}
post.mat.uniforms.uColor.value = colorOn ? 1 : 0;
function setColor(on) {
  colorOn = on;
  try { localStorage.setItem('kippwelt-color', on ? 'on' : 'off'); } catch (_) {}
  gsap.to(post.mat.uniforms.uColor, { value: on ? 1 : 0, duration: 0.9, ease: 'power2.inOut' });
  document.querySelectorAll('.color-toggle').forEach((b) => { b.textContent = on ? 'Farbrausch an' : 'Farbrausch aus'; b.setAttribute('aria-pressed', String(on)); });
  document.body.classList.toggle('farbe', on);
}
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  const v = renderer.getDrawingBufferSize(new THREE.Vector2());
  [post.scene, post.a, post.b].forEach((t) => t.setSize(v.x, v.y));
  post.mat.uniforms.uRes.value.copy(v);
}
function renderFrame(ca, blur, after, flash) {
  renderer.setRenderTarget(post.scene);
  renderer.render(scene, camera);
  const u = post.mat.uniforms;
  u.tScene.value = post.scene.texture;
  u.tPrev.value = post.a.texture;
  u.uCA.value = ca; u.uBlur.value = blur; u.uAfter.value = after; u.uFlash.value = flash; u.uTime.value += 0.0167;
  post.mesh.material = post.mat;
  if (after > 0.01) {
    // feedback: composite into b, show b, keep b as next frame's "previous"
    renderer.setRenderTarget(post.b);
    renderer.render(post.quad, post.cam);
    post.copy.map = post.b.texture;
    post.mesh.material = post.copy;
    renderer.setRenderTarget(null);
    renderer.render(post.quad, post.cam);
    [post.a, post.b] = [post.b, post.a];
  } else {
    renderer.setRenderTarget(null);
    renderer.render(post.quad, post.cam);
  }
}
window.addEventListener('resize', resize);
resize();

// World warp for the runner's transformation zones (spiral, funnel, wave, snake).
// Everything ahead of the ball bends; around the ball the world stays flat and playable.
const WARP = {
  uAxisO: { value: new THREE.Vector3() }, uDir: { value: new THREE.Vector3() }, uUp: { value: new THREE.Vector3(0, 1, 0) },
  uTwist: { value: 0 }, uCurve: { value: 0 }, uWave: { value: 0 }, uSnake: { value: 0 }, uWTime: U.time,
};
const WARP_DECL = 'uniform vec3 uAxisO, uDir, uUp; uniform float uTwist, uCurve, uWave, uSnake, uWTime;\n';
const WARP_FN = /* glsl */`
vec3 warpRun(vec3 w){
  vec3 rel = w - uAxisO;
  float a = dot(rel, uDir);
  float t = max(a, 0.0);
  float f = smoothstep(3.0, 18.0, t);
  if (abs(uTwist) > 0.0001) {
    vec3 along = uDir * a, rad = rel - along;
    float ang = uTwist * t * f;
    rel = along + rad * cos(ang) + cross(uDir, rad) * sin(ang);
  }
  rel -= uUp * uCurve * t * t * f;
  rel += uUp * uWave * 1.8 * sin(t * 0.32 - uWTime * 2.2) * f;
  rel += cross(uDir, uUp) * uSnake * 3.0 * sin(t * 0.16 - uWTime * 1.3) * f;
  return uAxisO + rel;
}
`;
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
` + WARP_DECL + WARP_FN;
const shader = (uniforms, vs, fs, opts = {}) =>
  new THREE.ShaderMaterial({ uniforms, vertexShader: GLSL + vs, fragmentShader: GLSL + fs, ...opts });
const ADD = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };

/* ------------------------------------------------------------------ */
/* Backgrounds (one per world, taken from Gestenwelten)                */
/* ------------------------------------------------------------------ */
const bgPulse = [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, -100, 0));
let bgPi = 0;
const bgU = { uTime: U.time, uPx: U.px, uPulse: { value: bgPulse }, uWell: { value: new THREE.Vector3() }, uBgReveal: { value: 0 }, uFollow: { value: new THREE.Vector2() }, uBeat: { value: 0 }, ...WARP };
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
      vec4 wq4 = modelMatrix * vec4(wp, 1.0); wq4.xyz = warpRun(wq4.xyz);
      vec4 mv = viewMatrix * wq4;
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
      vec4 wq4 = modelMatrix * vec4(p.x, y - 15.0 - (1.0 - rv) * 30.0, p.y, 1.0); wq4.xyz = warpRun(wq4.xyz);
      vec4 mv = viewMatrix * wq4;
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
  // wireframe shaft (from "schacht") with dotted cubes growing out of its walls
  const W = 7, LEN = 120, pos = [], wrap = [];
  const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let z = 0; z < LEN; z += 3) for (let k = 0; k < 4; k++) {
    const a = c[k], b = c[(k + 1) % 4];
    pos.push(a[0] * W, a[1] * W, -z, b[0] * W, b[1] * W, -z); wrap.push(1, 1);
  }
  for (let w = 0; w < 4; w++) for (let i = 0; i <= 6; i++) {
    const t = -1 + i / 3;
    const xy = [[t, -1], [1, t], [t, 1], [-1, t]][w];
    for (let z = 12; z > -LEN; z -= 6) { pos.push(xy[0] * W, xy[1] * W, z, xy[0] * W, xy[1] * W, z - 6); wrap.push(0, 0); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aWrap', new THREE.Float32BufferAttribute(wrap, 1));
  const u = { ...WARP, uTravel: { value: 0 }, uBgReveal: bgU.uBgReveal, uBeat: bgU.uBeat, uShow: { value: 0 } };
  const m = shader(u, /* glsl */`
    attribute float aWrap; uniform float uTravel, uBgReveal, uShow; varying float vA;
    void main(){
      vec3 p = position;
      if (aWrap > 0.5) p.z = mod(p.z + uTravel, 120.0) - 108.0;
      vec4 wq4 = modelMatrix * vec4(p, 1.0); wq4.xyz = warpRun(wq4.xyz);
      vec4 mv = viewMatrix * wq4;
      vA = exp(-(-mv.z) * 0.03) * smoothstep(-108.0, -80.0, p.z) * uBgReveal * uShow * (aWrap > 0.5 ? 0.6 : 0.35);
      gl_Position = projectionMatrix * mv;
    }`, /* glsl */`
    varying float vA;
    void main(){ gl_FragColor = vec4(vec3(1.0), vA); }`, ADD);
  const lines = new THREE.LineSegments(g, m);
  lines.frustumCulled = false;

  const N = 110, cd = [];
  for (let i = 0; i < N; i++) cd.push((Math.random() * 4) | 0, Math.round((Math.random() * 2 - 1) * 5) / 6, Math.random() * LEN, 0.8 + Math.random() * Math.random() * 4.5);
  const cg = new THREE.InstancedBufferGeometry().copy(new THREE.BoxGeometry(1, 1, 1));
  cg.setAttribute('aC', new THREE.InstancedBufferAttribute(new Float32Array(cd), 4));
  cg.instanceCount = N;
  const cm = shader(u, /* glsl */`
    attribute vec4 aC; uniform float uTravel, uBgReveal, uShow;
    varying vec2 vUv; varying float vA;
    void main(){
      float z = mod(aC.z + uTravel, 120.0) - 108.0;
      float W = 7.0, cs = 1.1, len = aC.w;
      vec3 base, tang, nrm;
      if (aC.x < 0.5)      { base = vec3(aC.y * W, -W, z); tang = vec3(1,0,0); nrm = vec3(0,1,0); }
      else if (aC.x < 1.5) { base = vec3(W, aC.y * W, z);  tang = vec3(0,1,0); nrm = vec3(-1,0,0); }
      else if (aC.x < 2.5) { base = vec3(aC.y * W, W, z);  tang = vec3(1,0,0); nrm = vec3(0,-1,0); }
      else                 { base = vec3(-W, aC.y * W, z); tang = vec3(0,1,0); nrm = vec3(1,0,0); }
      vec3 p = base + tang * position.x * cs + nrm * (position.y + 0.5) * len + vec3(0.0, 0.0, 1.0) * position.z * cs;
      vec4 wq4 = modelMatrix * vec4(p, 1.0); wq4.xyz = warpRun(wq4.xyz);
      vec4 mv = viewMatrix * wq4;
      vA = exp(-(-mv.z) * 0.028) * smoothstep(-108.0, -80.0, z) * uBgReveal * uShow;
      vUv = uv;
      gl_Position = projectionMatrix * mv;
    }`, /* glsl */`
    varying vec2 vUv; varying float vA;
    void main(){
      float e = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
      float edge = 1.0 - smoothstep(0.035, 0.035 + fwidth(e) * 1.5, e);
      vec2 g = fract(vUv * 5.0) - 0.5;
      float dots = 1.0 - smoothstep(0.12, 0.12 + fwidth(g.x) * 2.0, length(g));
      gl_FragColor = vec4(vec3(max(edge, dots * 0.7) * vA), 1.0);
    }`);
  const cubes = new THREE.Mesh(cg, cm);
  cubes.frustumCulled = false;
  const grp = new THREE.Group();
  grp.add(lines, cubes);
  grp.userData.u = u;
  return grp;
}
const backgrounds = [hexBackground(), wellBackground(), shaftBackground()];
backgrounds.forEach((b) => { b.visible = false; scene.add(b); });
const bgRoot = new THREE.Group();
scene.add(bgRoot);
backgrounds.slice(0, 2).forEach((b) => bgRoot.add(b)); // the shaft is placed in world space by the runner

/* ------------------------------------------------------------------ */
/* Level objects                                                       */
/* ------------------------------------------------------------------ */
const levelU = { ...WARP, uZones: { value: [new THREE.Vector4(), new THREE.Vector4()] }, uWells: { value: [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector4()) }, uTime: U.time, uReveal: { value: 0 }, uPhaseMix: { value: 0 }, uFog: { value: 0.035 }, uBeat: bgU.uBeat, uStyle: { value: 0 }, uDist: { value: 0 }, uRise: { value: 14 } };
const BLOCK_VS = /* glsl */`
  attribute vec3 aPos; attribute float aPhase; attribute float aSeed;
  uniform float uTime, uReveal, uPhaseMix, uFog;
  varying vec2 vUv; varying vec3 vN; varying float vSolid, vPhase, vFog, vSeed, vTr; varying vec2 vZ;
  void main(){
    vZ = vec2(0.0); vTr = 0.0;
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
const RUN_BLOCK_VS = /* glsl */`
  attribute vec3 aPos; attribute float aPhase; attribute float aSeed; attribute float aTrack; attribute vec3 aOut;
  uniform float uTime, uReveal, uPhaseMix, uFog, uDist, uRise, uBeat;
  uniform vec4 uZones[2]; uniform vec4 uWells[6];
  varying vec2 vUv; varying vec3 vN; varying float vSolid, vPhase, vFog, vSeed, vTr; varying vec2 vZ;
  void main(){
    vec3 off0 = vec3(0.0);
    // which track mode is this cell in (wogen 1, senke 2, fluss 3, sand 4), and how far into it
    float zm = 0.0, zf = 0.0;
    for (int i = 0; i < 2; i++) {
      vec4 Z = uZones[i];
      if (Z.z < 0.5) continue;
      float f = smoothstep(Z.x - 4.0, Z.x + 10.0, aTrack) * (1.0 - smoothstep(Z.y - 10.0, Z.y + 4.0, aTrack));
      if (f > zf) { zf = f; zm = Z.z; }
    }
    vZ = vec2(zm, zf); vTr = aTrack;
    vec3 outSq = aOut / max(max(abs(aOut.x), abs(aOut.y)), max(abs(aOut.z), 0.001)); // corners move on both faces
    if (zm > 0.5 && zm < 1.5) off0 += outSq * 1.1 * (0.5 + 0.5 * sin(aTrack * 0.35 + uTime * 3.0)) * zf; // wogen
    for (int i = 0; i < 6; i++) {
      vec4 W = uWells[i];
      if (W.w < 0.5) continue;
      vec3 dw = aPos - W.xyz;
      off0 -= outSq * 0.8 * exp(-dot(dw, dw) / 3.0); // senke: cells sink into the gravity well
    }
    float solid = (aPhase < 0.5 || aPhase > 2.5) ? 1.0 : (aPhase < 1.5 ? 1.0 - uPhaseMix : uPhaseMix);
    if (aPhase > 3.5 && aPhase < 4.5) { float sh = 0.03 * sin(uTime * 40.0 + aSeed * 30.0); off0 = aOut * sh; }
    if (aPhase > 4.5 && aPhase < 5.5) off0 -= aOut * 0.22;
    float ahead = aTrack - uDist;
    vec3 p = position * mix(0.84, 1.0, ease3(solid));
    vec3 off = off0;
    float sc = 1.0;
    if (aPhase > 0.5 && aPhase < 3.5) {
      // obstacles rise out of the beam shortly before you reach them, with overshoot
      float r = 1.0 - smoothstep(uRise, uRise + 12.0, ahead);
      float rr = r + sin(r * 3.14159) * 0.25;
      off -= aOut * (1.0 - rr) * 1.05;
      sc *= mix(0.35, 1.0, r);
    } else {
      // the beam assembles from flying blocks far ahead and breathes with the beat
      float a = 1.0 - smoothstep(32.0, 52.0, ahead);
      off += aOut * (1.0 - a) * (4.0 + aSeed * 6.0);
      p.xy = rot2((1.0 - a) * 4.0 * (aSeed - 0.5)) * p.xy;
      sc *= mix(0.15, 1.0, a);
      off += aOut * uBeat * 0.08 * (0.5 + 0.5 * sin(aTrack * 0.6 - uTime * 5.0));
    }
    // behind the ball the track sinks inward and shrinks away; gone before it reaches the camera
    float behind = uDist - aTrack - 1.5;
    if (behind > 0.0) {
      off -= aOut * behind * 0.45;
      p.xz = rot2(behind * 1.6 * (aSeed - 0.5)) * p.xz;
      p.yz = rot2(behind * 0.9 * aSeed) * p.yz;
      sc *= max(0.0, 1.0 - behind * 0.3);
    }
    float rv = ease3(uReveal * 1.7 - aSeed * 0.7);
    vec3 wp = aPos + p * sc * mix(0.1, 1.0, rv) + off + vec3(0.0, (1.0 - rv) * (4.0 + aSeed * 9.0), 0.0);
    vUv = uv; vN = normal; vSolid = solid; vPhase = aPhase; vSeed = aSeed;
    vec4 mv = viewMatrix * vec4(warpRun(wp), 1.0);
    vFog = exp(-(-mv.z) * uFog) * rv;
    gl_Position = projectionMatrix * mv;
  }`;
const BLOCK_FS = /* glsl */`
  uniform float uTime, uBeat, uStyle;
  varying vec2 vUv; varying vec3 vN; varying float vSolid, vPhase, vFog, vSeed, vTr; varying vec2 vZ;

  float ring(float d, float r){ return 1.0 - smoothstep(0.009, 0.009 + fwidth(d) * 1.3, abs(d - r)); }
  // biome surface styles: 0 concentric squares (wabe), 1 dot grid (senke), 2 fine grid (schacht)
  float stylePat(float st, float d, vec2 uv){
    if (st < 0.5) return ring(d, 0.3) + ring(d, 0.16);
    if (st < 1.5) { vec2 g = fract(uv * 5.0) - 0.5; return 1.0 - smoothstep(0.09, 0.09 + fwidth(g.x) * 2.0, length(g)); }
    vec2 g = abs(fract(uv * 4.0) - 0.5);
    float w = fwidth(uv.x) * 4.0;
    return 1.0 - smoothstep(0.03, 0.03 + w * 1.5, 0.5 - max(g.x, g.y));
  }
  float styled(float d, vec2 uv){
    float a = floor(uStyle), f = fract(uStyle);
    return mix(stylePat(a, d, uv), stylePat(a + 1.0, d, uv), f);
  }
  float hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  // the look of each track mode
  float modeLook(float m, float d, float edge, vec2 uv){
    if (m < 1.5) { // wogen: hex-column feel, brightness rides the wave
      float wave = 0.5 + 0.5 * sin(vTr * 0.35 + uTime * 3.0);
      return max(edge, ring(d, 0.3) * 0.6) * (0.45 + 0.75 * wave) + 0.03;
    }
    if (m < 2.5) { // senke: point grid
      vec2 g = fract(uv * 5.0) - 0.5;
      float dots = 1.0 - smoothstep(0.07, 0.07 + fwidth(g.x) * 2.0, length(g));
      return dots * (0.55 + 0.45 * step(0.5, fract(hsh(floor(uv * 5.0) + vSeed) * 7.0 + uTime * 0.8))) + edge * 0.2;
    }
    if (m < 3.5) { // fluss: field lines with flowing beads
      vec2 l = abs(fract(uv * 6.0) - 0.5);
      float line = 1.0 - smoothstep(0.03, 0.03 + fwidth(uv.x) * 6.0, 0.5 - max(l.x, l.y));
      float bead = pow(fract(vTr * 0.2 - uTime * 1.6 + vSeed), 8.0);
      return line * (0.35 + bead * 1.2) + edge * 0.25;
    }
    // sand: streaming grains
    vec2 cell = floor(uv * 26.0 + vec2(0.0, uTime * 9.0 + vTr * 6.0));
    float gr = step(0.58, hsh(cell)) * (0.4 + 0.6 * hsh(cell + 3.1));
    return gr * 0.85 + edge * 0.12;
  }
  void main(){
    float ex = min(vUv.x, 1.0 - vUv.x), ey = min(vUv.y, 1.0 - vUv.y);
    float e = min(ex, ey);
    float along = ex < ey ? vUv.y : vUv.x;
    float edge = 1.0 - smoothstep(0.03, 0.03 + fwidth(e) * 1.5, e);
    float d = max(abs(vUv.x - 0.5), abs(vUv.y - 0.5));
    float c;
    if (vPhase > 5.5) {
      // quicksand: dark, slowly swirling grains
      vec2 cell = floor(vUv * 18.0 + vec2(sin(uTime + vSeed * 6.0) * 2.0, uTime * 2.0));
      c = step(0.72, hsh(cell)) * 0.5 + edge * 0.35 + 0.02;
    } else if (vPhase > 4.5) {
      // middle rail between the two lanes: dark groove
      c = edge * 0.3 + 0.015;
    } else if (vPhase > 3.5) {
      // crumbling floor: cracks that flicker
      float cr = abs(fract((vUv.x * 1.7 + vUv.y * 0.6) * 3.0 + vSeed) - 0.5);
      float crack = 1.0 - smoothstep(0.03, 0.03 + fwidth(cr) * 1.5, cr);
      c = max(edge, crack * (0.55 + 0.45 * step(0.5, fract(uTime * 6.0 + vSeed)))) * 0.95 + 0.05;
    } else if (vPhase > 2.5) {
      float pat = max(ring(d, 0.06), styled(d, vUv));
      c = max(edge, pat * 0.7) * (abs(vN.y) > 0.5 ? 1.0 : 0.85) + 0.14 + edge * uBeat * 0.6;
    } else if (vPhase < 0.5) {
      float pat = uStyle > 0.01 ? styled(d, vUv) : (abs(vN.y) > 0.5 ? ring(d, 0.3) + ring(d, 0.16) : (abs(vN.x) > 0.5 ? ring(d, 0.34) + ring(d, 0.22) + ring(d, 0.1) : ring(d, 0.2)));
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
    if (vZ.y > 0.01 && vPhase < 5.5) c = mix(c, vPhase > 2.5 && vPhase < 3.5 ? max(c, modeLook(vZ.x, d, edge, vUv)) : modeLook(vZ.x, d, edge, vUv), vZ.y);
    gl_FragColor = vec4(vec3(c * vFog), 1.0);
  }`;

const blockGeo = new THREE.BoxGeometry(1, 1, 1);
const lv = { group: new THREE.Group(), keys: [], shards: [], spikes: [], exit: null };
scene.add(lv.group);

const black = new THREE.MeshBasicMaterial({ color: 0x000000 });
const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true });
function warpMaterial(m) {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, WARP);
    sh.vertexShader = WARP_DECL + WARP_FN + sh.vertexShader.replace('#include <project_vertex>', `
      vec4 mvPosition = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      vec4 wPosW = modelMatrix * mvPosition;
      wPosW.xyz = warpRun(wPosW.xyz);
      mvPosition = viewMatrix * wPosW;
      gl_Position = projectionMatrix * mvPosition;`);
  };
  m.customProgramCacheKey = () => 'warp';
  return m;
}
[black, white, lineMat].forEach(warpMaterial);
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
// Ball: a lit pearl with one fine seam that shows the roll, plus an orbiting dot ring.
const ball = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 48), shader({ uTime: U.time }, /* glsl */`
  varying vec3 vP; varying vec3 vNv;
  void main(){ vP = normalize(position); vNv = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`, /* glsl */`
  varying vec3 vP; varying vec3 vNv;
  void main(){
    vec3 n = normalize(vNv);
    float lat = asin(clamp(vP.y, -1.0, 1.0));
    float lon = atan(vP.z, vP.x);
    float seam = abs(lat - 0.55 * sin(2.0 * lon));
    float line = 1.0 - smoothstep(0.012, 0.012 + fwidth(seam) * 1.5, seam);
    vec3 L = normalize(vec3(-0.35, 0.65, 0.7));
    float diff = max(dot(n, L), 0.0);
    float spec = pow(max(dot(reflect(vec3(0.0, 0.0, -1.0), n), L), 0.0), 36.0);
    float rim = pow(1.0 - max(n.z, 0.0), 2.6);
    float c = 0.22 + diff * 0.72 + spec * 0.6;
    c = mix(c, 0.08, line * 0.9);
    c += rim * 0.45;
    gl_FragColor = vec4(vec3(c), 1.0);
  }`));
const orbitDots = (() => {
  const n = 42, pos = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pos.push(Math.cos(a) * R * 1.75, 0, Math.sin(a) * R * 1.75); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aI', new THREE.Float32BufferAttribute([...Array(n).keys()].map((i) => i / n), 1));
  const pts = new THREE.Points(g, shader({ uPx: U.px, uTime: U.time }, /* glsl */`
    attribute float aI; uniform float uPx, uTime; varying float vA;
    void main(){
      vA = 0.35 + 0.65 * pow(fract(aI - uTime * 0.6), 6.0);
      gl_PointSize = (1.4 + vA * 1.6) * uPx;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`, /* glsl */`
    varying float vA;
    void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(1.0), smoothstep(0.5, 0.1, d) * vA); }`, ADD));
  pts.rotation.z = 0.32;
  return pts;
})();
const ballRig = new THREE.Group(); // oriented to the gravity frame; carries squash & stretch
ballRig.add(ball);
const orbitPivot = new THREE.Group();
orbitPivot.add(orbitDots);
ballRig.add(orbitPivot);
scene.add(ballRig);
const ballQ = new THREE.Quaternion(); // accumulated rolling spin in world space
const squash = { x: 1, y: 1, z: 1 };
// cartoon impulses: y = along gravity normal, x = sideways, z = along travel
function squashLand(p = 1) {
  if (REDUCED) return;
  gsap.killTweensOf(squash);
  gsap.fromTo(squash, { y: 1 - 0.42 * p, x: 1 + 0.32 * p, z: 1 + 0.32 * p }, { y: 1, x: 1, z: 1, duration: 0.55, ease: 'elastic.out(1.2, 0.35)' });
}
function stretchJump(p = 1) {
  if (REDUCED) return;
  gsap.killTweensOf(squash);
  gsap.fromTo(squash, { y: 1 + 0.45 * p, x: 1 - 0.22 * p, z: 1 - 0.22 * p }, { y: 1, x: 1, z: 1, duration: 0.45, ease: 'elastic.out(1, 0.4)' });
}
function stretchDash() {
  if (REDUCED) return;
  gsap.killTweensOf(squash);
  gsap.fromTo(squash, { z: 2.1, x: 0.7, y: 0.7 }, { z: 1, x: 1, y: 1, duration: 0.6, ease: 'elastic.out(1, 0.45)', delay: 0.18 });
}

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
    audio.master.gain.value = audio.on ? 0.9 : 0;
    audio.master.connect(audio.ctx.destination);
    audio.sfxBus = audio.ctx.createGain();
    audio.sfxBus.gain.value = 0.85;
    audio.sfxBus.connect(audio.master);
    audio.musicFilter = audio.ctx.createBiquadFilter();
    audio.musicFilter.type = 'lowpass';
    audio.musicFilter.frequency.value = 18000;
    audio.musicBus = audio.ctx.createGain();
    audio.musicBus.gain.value = 0.55;
    audio.musicBus.connect(audio.musicFilter);
    audio.musicFilter.connect(audio.master);
    // small files first, music on demand
    new Set(Object.values(SAMPLES).map(([f]) => f)).forEach(loadBuffer);
    loadBuffer(TRACKS.wabe).then(() => [TRACKS.senke, TRACKS.schacht].forEach(loadBuffer));
    if (music.want) musicPlay(music.want);
  } catch (_) { audio.ctx = null; }
}
// browsers only allow audio after a user gesture: unlock on the first touch anywhere
document.addEventListener('pointerdown', () => audioInit(), { once: true, capture: true });
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
  o.connect(g); g.connect(audio.sfxBus || audio.master);
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
  s.buffer = buf; s.connect(f); f.connect(g); g.connect(audio.sfxBus || audio.master); s.start(c.currentTime + delay);
}
// Synth fallbacks, used until (or if) the sample files below are loaded.
const synth = {
  roll: () => tone(190, 150, 0.07, 'triangle', 0.07),
  turn: () => tone(620, 540, 0.05, 'square', 0.03),
  lane: () => tone(620, 540, 0.05, 'square', 0.03),
  wrap: () => { tone(160, 420, 0.25, 'sine', 0.1); tone(320, 840, 0.25, 'triangle', 0.03); },
  jump: () => tone(260, 760, 0.2, 'sine', 0.12),
  land: () => tone(140, 70, 0.1, 'sine', 0.14),
  bump: () => tone(90, 60, 0.08, 'square', 0.06),
  key: () => [660, 880, 1320].forEach((f, i) => tone(f, f, 0.18, 'triangle', 0.1, i * 0.07)),
  orb: () => [660, 880, 1320].forEach((f, i) => tone(f, f, 0.18, 'triangle', 0.1, i * 0.07)),
  shard: () => tone(1500 + Math.random() * 300, 1900, 0.06, 'sine', 0.05),
  phase: () => { tone(220, 55, 0.45, 'sawtooth', 0.05); tone(110, 440, 0.45, 'sine', 0.06); },
  open: () => [440, 554, 659, 880].forEach((f, i) => tone(f, f, 0.4, 'sine', 0.07, i * 0.09)),
  pad: () => tone(300, 900, 0.3, 'sine', 0.12),
  portal: () => tone(900, 200, 0.4, 'sawtooth', 0.06),
  sog: () => tone(400, 1200, 0.4, 'triangle', 0.08),
  die: () => { noise(0.5, 0.25); tone(300, 40, 0.6, 'sawtooth', 0.06); },
  smash: () => noise(0.35, 0.25),
  dash: () => { noise(0.28, 0.16, 0, 900); tone(1100, 180, 0.28, 'sawtooth', 0.04); },
  slam: () => { tone(130, 28, 0.45, 'sine', 0.32); noise(0.3, 0.22); },
  win: () => [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, f * 1.01, 0.6, 'triangle', 0.08, i * 0.08)),
};

/* ---------- samples: Kenney "Digital Audio" (CC0) and Beatscribe jingles (CC0) ---------- */
const SAMPLES = {
  jump: ['sfx-jump', 0.7], wrap: ['sfx-wrap', 0.6], dash: ['sfx-dash', 0.75], slam: ['sfx-slam', 0.9], orb: ['sfx-orb', 0.75],
  pad: ['sfx-pad', 0.8], portal: ['sfx-portal', 0.75], shard: ['sfx-shard', 0.45], sog: ['sfx-sog', 0.75], phase: ['sfx-phase', 0.55],
  die: ['sfx-die', 1], smash: ['sfx-smash', 0.8], turn: ['sfx-turn', 0.5], lane: ['sfx-lane', 0.28], key: ['sfx-key', 0.75],
  open: ['jingle-treasure', 0.8], bump: ['sfx-bump', 0.5], win: ['jingle-victory', 0.8],
  victory: ['jingle-victory', 0.8], start: ['jingle-start', 0.7], gameover: ['jingle-gameover', 0.8],
};
const buffers = {};
const loading = {};
function loadBuffer(name) {
  if (buffers[name] || loading[name] || !audio.ctx) return loading[name];
  loading[name] = fetch(`audio/${name}.mp3`)
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
    .then((ab) => new Promise((res, rej) => audio.ctx.decodeAudioData(ab, res, rej)))
    .then((b) => { buffers[name] = b; return b; })
    .catch(() => { loading[name] = null; return null; });
  return loading[name];
}
function playSample(key, rate = 1) {
  const [file, vol] = SAMPLES[key];
  const b = buffers[file];
  if (!b) return false;
  const src = audio.ctx.createBufferSource(), g = audio.ctx.createGain();
  src.buffer = b; src.playbackRate.value = rate;
  g.gain.value = vol;
  src.connect(g); g.connect(audio.sfxBus);
  src.start();
  return true;
}
const sfx = new Proxy({}, {
  get: (_, key) => () => {
    if (!audio.on || !audio.ctx) return;
    const rate = key === 'shard' ? 0.94 + Math.random() * 0.22 : key === 'lane' ? 0.95 + Math.random() * 0.1 : 1;
    if (!(SAMPLES[key] && playSample(key, rate)) && synth[key]) synth[key]();
  },
});

/* ---------- music tracks (CC0): one per world, like level songs ---------- */
const TRACKS = { menu: 'music-menu', wabe: 'music-wabe', senke: 'music-senke', schacht: 'music-schacht' };
const music = { name: null, src: null, gain: null, startAt: 0, offset: 0, want: null };
function musicPlay(name, { restart = false, fade = 0.8 } = {}) {
  music.want = name;
  if (!audio.ctx) return;
  if (!restart && music.name === name && music.src) return;
  const file = TRACKS[name];
  const go = (b) => {
    if (!b || music.want !== name) return;
    musicStop(fade);
    const src = audio.ctx.createBufferSource(), g = audio.ctx.createGain();
    src.buffer = b; src.loop = true;
    src.playbackRate.value = music.rate || 1;
    g.gain.setValueAtTime(0, audio.ctx.currentTime);
    g.gain.linearRampToValueAtTime(1, audio.ctx.currentTime + Math.max(0.02, fade * 0.6));
    src.connect(g); g.connect(audio.musicBus);
    src.start(0, restart ? 0 : 0);
    Object.assign(music, { name, src, gain: g, startAt: audio.ctx.currentTime });
  };
  if (buffers[file]) go(buffers[file]);
  else { if (music.name !== name) musicStop(0.15); loadBuffer(file).then(go); }
}
function musicStop(fade = 0) {
  if (!music.src || !audio.ctx) { music.name = null; return; }
  const { src, gain } = music;
  const t = audio.ctx.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(gain.gain.value, t);
  gain.gain.linearRampToValueAtTime(0, t + Math.max(0.01, fade));
  src.stop(t + Math.max(0.02, fade) + 0.05);
  music.src = null; music.name = null;
}
// Bullet time: music drops in pitch and gets muffled.
function musicSlow(k) {
  if (!audio.ctx) return;
  const t = audio.ctx.currentTime;
  music.rate = 1 - 0.28 * k;
  if (music.src) music.src.playbackRate.setTargetAtTime(music.rate, t, 0.08);
  audio.musicFilter.frequency.setTargetAtTime(k > 0.01 ? 18000 - 17300 * k : 18000, t, 0.08);
}
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
  stretchJump(sub === 'climb' ? 1.2 : 1);
  gsap.fromTo(fx, { fovKick: 0 }, { fovKick: 6, duration: 0.2, yoyo: true, repeat: 1 });
  runMotion(sub === 'drop' ? 0.62 : 0.46, (t) => {
    vis.pos.lerpVectors(c0, c1, t).addScaledVector(u, h * 4 * t * (1 - t));
  }, 'none', () => {
    sfx.land();
    squashLand(sub === 'drop' ? 1.3 : 1);
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
    case 'wrap': motionWrap(s0, r.to, finish(r.to)); vibrate(8); kick(0.012, 0, 0); break;
    case 'jump': motionJump(s0, r.to, r.sub, finish(r.to)); break;
    case 'blocked': if (thumb) thumb.mode = null; motionBump(s0); break;
    case 'fall': motionFall(s0, r.at, 'ins Leere gesprungen'); break;
  }
}

function doPhase() {
  if (!G.L.hasPhases) { doAction('back'); return; }
  G.phase = G.phase === 1 ? 2 : 1;
  sfx.phase(); vibrate([10, 30, 10]);
  kick(0.03, 0.4, 0);
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
    kick(0.02, 0, 0.12);
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
  deco.visible = false;
  wormhole.visible = false; strudel.visible = false;
  wormhole.userData.u.uA.value = 0; strudel.userData.u.uA.value = 0;
  resetWarp();
  levelU.uStyle.value = 0;
  levelU.uFog.value = 0.035;
  const c = G.L.bounds().center;
  bgRoot.position.set(c[0], c[1], c[2]);
  bgU.uWell.value.set(0, 0, 0);
  vis.pos.copy(centerOf(G.s));
  vis.prev.copy(vis.pos);
  vis.frame.copy(frameOf(G.s));
  vis.scale = 1;
  ballQ.identity();
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
  setPalette(['synth', 'uv'][LEVELS[i].world], 1.2);
  musicSlow(0);
  musicPlay(['wabe', 'senke'][LEVELS[i].world]);
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
  kick(0.05, 1.2, 0.25);
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
  musicStop(0.4);
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
  setPalette('synth', 1.2);
  musicSlow(0);
  musicPlay('menu');
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
  if (audio.master) audio.master.gain.setTargetAtTime(on ? 0.9 : 0, audio.ctx.currentTime, 0.05);
  try { localStorage.setItem('kippwelt-sound', on ? 'on' : 'off'); } catch (_) {}
  ['soundBtn', 'soundBtn2'].forEach((id) => { $(id).textContent = on ? 'Ton an' : 'Ton aus'; $(id).setAttribute('aria-pressed', String(on)); });
  if (on) audioInit();
}
setSound(audio.on);
setColor(colorOn);
document.querySelectorAll('.color-toggle').forEach((b) => b.addEventListener('click', () => setColor(!colorOn)));
$('soundBtn').addEventListener('click', () => setSound(!audio.on));
$('soundBtn2').addEventListener('click', () => setSound(!audio.on));
$('playBtn').addEventListener('click', () => startPlay(Math.min(progress.unlocked, LEVELS.length) - 1));
$('pauseBtn').addEventListener('click', () => { if (G.mode === 'play') { G.mode = 'paused'; showOverlay('pause'); } });
$('resumeBtn').addEventListener('click', () => {
  showOverlay(null);
  if (G.mode === 'runpause') { G.mode = 'run'; if (audio.ctx) audio.ctx.resume(); } else G.mode = 'play';
});
$('restartBtn').addEventListener('click', () => { if (audio.ctx) audio.ctx.resume(); return G.mode === 'runpause' ? startRun() : startPlay(G.li); });
$('menuBtn').addEventListener('click', () => { if (audio.ctx) audio.ctx.resume(); showTitle(); });
$('menuBtn2').addEventListener('click', showTitle);
$('nextBtn').addEventListener('click', () => startPlay(Math.min(G.li + 1, LEVELS.length - 1)));
$('againBtn').addEventListener('click', () => { startPlay(G.li); musicPlay(['wabe', 'senke'][LEVELS[G.li].world], { restart: true }); });

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
  segs: [], si: 0, s: 0, fi: 0, lane: -1, uT: -1, uV: -1, y: 0, vy: 0, prevY: 0, grounded: true,
  speed: 8, dist: 0, genDist: 0, shards: 0, phase: 1, turnQueued: false, sog: 0, focus: 1,
  timeScale: 1, slow: false, biome: 0, offset: new THREE.Vector3(), jumpBuf: 0, best: 0, nextId: 0,
  moment: 1, dash: 1, dashT: 0, slam: false,
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
  return t === 0 || t === 3 || t === 4 || t === 5 || t === 6 || t === RUN.phase;
}
const RUNREF = new Map();
const RUNMETA = new Map(); // cell → [track distance, outward x, y, z] for the shader
function setCell(seg, p, type, track = 0, out = Y) {
  const k = kv(p);
  RUNMAP.set(k, type);
  RUNMETA.set(k, [track, out.x, out.y, out.z]);
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
  } else { outP.copy(a).multiplyScalar(H).addScaledVector(n, 1.5 - 0.5 * (c * 3 - 2)); outN.copy(a); } // edge (1.5) → lane (1.0)
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
function addObstacle(seg, k, fi, lane, h) { const n = faceN(seg.d, fi); for (let t = 1; t <= h; t++) setCell(seg, faceCell(seg, k, fi, lane, t), 3, seg.start + k, n); }
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
const shieldGeo = new THREE.OctahedronGeometry(0.26);
const shieldEdges = new THREE.EdgesGeometry(shieldGeo);
const shieldRing = new THREE.TorusGeometry(0.42, 0.02, 6, 32);
const flugGeo = new THREE.ConeGeometry(0.24, 0.55, 4);
const flugEdges = new THREE.EdgesGeometry(flugGeo);
[shieldGeo, shieldEdges, shieldRing, flugGeo, flugEdges].forEach((g) => { g.userData.keep = true; });
// Power-ups: sog (magnet), schild (absorbs one hit), flug (6 s flight above everything).
function addPower(seg, k, fi, lane, type) {
  const n = faceN(seg.d, fi);
  const g = new THREE.Group();
  if (type === 'sog') g.add(new THREE.Mesh(sogGeo, black), new THREE.LineSegments(sogEdges, lineMat));
  else if (type === 'schild') g.add(new THREE.Mesh(shieldGeo, black), new THREE.LineSegments(shieldEdges, lineMat), new THREE.Mesh(shieldRing, white));
  else g.add(new THREE.Mesh(flugGeo, black), new THREE.LineSegments(flugEdges, lineMat), new THREE.Mesh(shieldRing, white));
  g.position.copy(faceCell(seg, k, fi, lane)).addScaledVector(n, 0.5 + R + 0.3);
  seg.group.add(g);
  seg.items.push({ type, pos: g.position.clone(), mesh: g, alive: true, k });
  mark(seg, k, type);
}

const boxGeo = new THREE.BoxGeometry(0.92, 0.92, 0.92);
const boxEdges = new THREE.EdgesGeometry(boxGeo);
const laserGeo = new THREE.BoxGeometry(3.3, 0.05, 0.05);
const laserGlow = new THREE.BoxGeometry(3.3, 0.22, 0.22);
[boxGeo, boxEdges, laserGeo, laserGlow].forEach((g) => { g.userData.keep = true; });
const glowMat = warpMaterial(new THREE.MeshBasicMaterial({ color: 0xffffff, ...ADD, opacity: 0.18 }));
// Sweeper: a block sliding back and forth across the three lanes.
function addSweeper(seg, k, fi) {
  const g = new THREE.Group();
  const inner = new THREE.Mesh(boxGeo, white);
  inner.scale.setScalar(0.45);
  g.add(new THREE.Mesh(boxGeo, black), new THREE.LineSegments(boxEdges, lineMat), inner);
  g.quaternion.copy(frameQuat(seg.d, faceN(seg.d, fi)));
  seg.group.add(g);
  seg.sweepers.push({ k, fi, ph: Math.random() * 6.28, w: 1.6 + Math.random() * 1.2, mesh: g, alive: true, x: 0 });
}
function sweeperX(sw) { return Math.sin(U.time.value * sw.w + sw.ph); }
function sweeperAhead(seg, k) { return seg.sweepers.some((sw) => sw.alive && sw.k === k && sw.fi === RUN.fi); }
// Laser: low (jump over) or high (stay on the ground).
function addLaser(seg, k, fi, high) {
  const n = faceN(seg.d, fi);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(laserGeo, white), new THREE.Mesh(laserGlow, glowMat));
  for (const x of [-1.65, 1.65]) { const post = new THREE.Mesh(boxGeo, black); post.scale.set(0.12, high ? 1.9 : 0.9, 0.12); post.position.set(x, -(high ? 1.5 : 0.35) / 2 - 0.1, 0); g.add(post); }
  g.quaternion.copy(frameQuat(seg.d, n));
  g.position.copy(faceCell(seg, k, fi, 0)).addScaledVector(n, 0.5 + R + (high ? 1.5 : 0.35));
  seg.group.add(g);
  seg.lasers.push({ k, fi, high, mesh: g });
}
// Crusher: a block that slams down onto a lane and lifts again.
const CRUSH_T = 1.7;
function crusherH(cr) {
  const p = (U.time.value / CRUSH_T + cr.ph) % 1;
  if (p < 0.12) return 3 * (1 - (p / 0.12) ** 2);
  if (p < 0.4) return 0;
  if (p < 0.8) return 3 * ease((p - 0.4) / 0.4);
  return 3;
}
const ease = (x) => x * x * (3 - 2 * x);
function addCrusher(seg, k, fi, lane) {
  const g = new THREE.Group();
  const block = new THREE.Group();
  const core = new THREE.Mesh(boxGeo, white); core.scale.setScalar(0.35);
  block.add(new THREE.Mesh(boxGeo, black), new THREE.LineSegments(boxEdges, lineMat), core);
  const rod = new THREE.Group();
  rod.add(new THREE.Mesh(boxGeo, black), new THREE.LineSegments(boxEdges, lineMat));
  rod.scale.set(0.16, 6, 0.16);
  g.add(block, rod);
  g.quaternion.copy(frameQuat(seg.d, faceN(seg.d, fi)));
  seg.group.add(g);
  seg.crushers.push({ k, fi, lane, ph: Math.random(), mesh: g, block, rod, alive: true });
}
// Crumbling floor: a marked lane that breaks away just before you get there.
function addCrumble(seg, k, fi, lane, len = 3) {
  const n = faceN(seg.d, fi);
  for (let q = k; q < k + len; q++) setCell(seg, faceCell(seg, q, fi, lane), 4, seg.start + q, n);
  seg.crumbles.push({ k, fi, lane, len, done: false });
}
// Flip tile: roll over it and you are thrown to the opposite side of the beam.
function addFlip(seg, k, fi, lane) {
  const n = faceN(seg.d, fi);
  const pts = [];
  for (let i = 0; i < 2; i++) for (let j = 0; j < 14; j++) {
    const a0 = i * Math.PI + (j / 16) * Math.PI, a1 = i * Math.PI + ((j + 1) / 16) * Math.PI;
    pts.push(Math.cos(a0) * 0.3, 0.02, Math.sin(a0) * 0.3, Math.cos(a1) * 0.3, 0.02, Math.sin(a1) * 0.3);
  }
  for (const i of [0, 1]) { const a = i * Math.PI + (14 / 16) * Math.PI, x = Math.cos(a) * 0.3, z = Math.sin(a) * 0.3; pts.push(x, 0.02, z, x + 0.1, 0.02, z - 0.08 * (i ? -1 : 1), x, 0.02, z, x - 0.1, 0.02, z - 0.06 * (i ? -1 : 1)); }
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const m = new THREE.Group();
  m.add(new THREE.LineSegments(gg, lineMat), new THREE.LineSegments(padGeo, lineMat));
  m.quaternion.copy(frameQuat(seg.d, n));
  m.position.copy(faceCell(seg, k, fi, lane)).addScaledVector(n, 0.5);
  seg.group.add(m);
  seg.flips.push({ k, fi, lane, used: false, mesh: m });
}
// Spinning ring of blocks around the whole beam, with one gap to slip through.
function addRing(seg, k) {
  const g = new THREE.Group();
  const spin = new THREE.Group();
  const gap = (Math.random() * 12) | 0;
  const angles = [];
  for (let j = 0; j < 12; j++) {
    if ((j - gap + 12) % 12 < 3) continue;
    const a = (j / 12) * Math.PI * 2;
    const b = new THREE.Group();
    const core = new THREE.Mesh(boxGeo, white); core.scale.setScalar(0.3);
    b.add(new THREE.Mesh(boxGeo, black), new THREE.LineSegments(boxEdges, lineMat), core);
    b.scale.setScalar(0.85);
    b.position.set(Math.cos(a) * 2.2, Math.sin(a) * 2.2, 0);
    b.rotation.z = a;
    spin.add(b);
    angles.push(a);
  }
  g.add(spin);
  g.quaternion.copy(frameQuat(seg.d, Y));
  g.position.copy(seg.o).addScaledVector(seg.d, k);
  seg.group.add(g);
  seg.rings.push({ k, angles, spin, mesh: g, w: (Math.random() < 0.5 ? -1 : 1) * (0.7 + Math.random() * 0.4), ph: Math.random() * 6.28, alive: true });
}
const pickLane = () => (Math.random() < 0.5 ? -1 : 1);
const ALL = [-1, 0, 1]; // full width incl. the middle rail, for walls that block the whole side
function weighted(list) {
  const total = list.reduce((s, [w]) => s + Math.max(0, w), 0);
  let r = Math.random() * total;
  for (const [w, fn] of list) { r -= Math.max(0, w); if (r <= 0) return fn; }
  return list[0][1];
}
// Every face pattern is beatable on its own face, so staying on one side is always possible.
// Every face pattern is beatable on its own side without the dash:
// one lane stays free, or the obstacle can be jumped, or a pad launches you.
const other = (l) => -l;
// Obstacles are introduced step by step (distance in metres when a type can first appear),
// like Temple Run / Subway Surfers: the basics first, the special stuff later.
const INTRO = { block: 0, row: 0, tower: 0, spike: 0, gap: 30, spikes: 60, laser: 150, pad: 200, flip: 250, phase: 300, crusher: 300, crumble: 350, sweeper: 400, portal: 450, laserHigh: 500, orb: 550, ring: 600 };
const HINTS = {
  block: 'Block: springen oder Spur wechseln', row: 'Blockreihe: drüberspringen, oben weiterrollen', tower: 'Hohe Wand: Spur wechseln oder hochwischen für den Dash',
  spike: 'Stacheln: springen oder ausweichen', spikes: 'Stachelreihe: springen', gap: 'Lücke: springen', laser: 'Tiefer Laser: springen',
  pad: 'Sprungfeld: schleudert dich über die Türme', flip: 'Kipp-Platte: wirft dich auf die Gegenseite', phase: 'Phasenring: nach unten wischen, dann bist du durch',
  crusher: 'Stampfer: abpassen oder Spur wechseln', crumble: 'Rissiger Boden bricht gleich weg: Spur wechseln', sweeper: 'Schieber: die Lücke abpassen',
  portal: 'Kippring: dreht dich auf die Gegenseite des Balkens', laserHigh: 'Hoher Laser: am Boden bleiben, nicht springen', orb: 'Ring in der Luft: im Sprung nochmal tippen',
  ring: 'Drehring: durch die Lücke rollen oder durchdashen',
  wogen: 'Wogen: die Strecke wellt sich, Wellenkämme schleudern dich hoch', senke: 'Gravitationssenke: zieht dich in ihre Spur, spring über das Loch',
  fluss: 'Feldlinien: die Strömung trägt dich, Schienen brechen ab, wechsle im Takt', sand: 'Treibsand: du sinkst ein, spring raus oder wechsle die Spur',
  schlund: 'Schlund: das Sprungfeld trägt dich hinüber',
  spirale: 'Spirale: die Welt dreht sich, die Strecke bleibt', schlange: 'Schlange: die Welt windet sich', negativ: 'Negativ: alles invertiert',
  sog: 'Sog: zieht Splitter an', schild: 'Schild: fängt den nächsten Treffer ab', flug: 'Höhenflug: 6 s über allen Hindernissen',
};
let seenHints = {};
try { seenHints = JSON.parse(localStorage.getItem('kippwelt-seen') || '{}'); } catch (_) {}
const mark = (seg, k, type) => seg.marks.push({ k, type });
const isOpen = (type, dist) => dist >= INTRO[type];
// Every face pattern is beatable on its own side without the dash:
// one lane stays free, or the obstacle can be jumped, or a pad launches you.
function facePattern(seg, k, fi, D, dist) {
  const g = (type, w) => (isOpen(type, dist) ? w : 0);
  const fn = weighted([
    [1.2 - 0.8 * D, () => { shardLine(seg, k, fi, pickLane(), 4); return 0; }],
    [g('block', 2), () => { const l = pickLane(); addObstacle(seg, k, fi, l, 1); shardLine(seg, k - 1, fi, other(l), 3); mark(seg, k, 'block'); return 0; }],
    [g('row', 1.4), () => { ALL.forEach((l) => addObstacle(seg, k, fi, l, 1)); shardLine(seg, k, fi, pickLane(), 2, 1); mark(seg, k, 'row'); return 1; }],
    [g('tower', 1.2 + D), () => { const l = pickLane(); addObstacle(seg, k, fi, l, 2); addObstacle(seg, k, fi, 0, 2); shardLine(seg, k - 1, fi, other(l), 3); mark(seg, k, 'tower'); return 0; }],
    [g('spike', 1.6), () => { addSpike(seg, k, fi, pickLane()); mark(seg, k, 'spike'); return 0; }],
    [g('spikes', 1.1 + D), () => { addSpike(seg, k, fi, -1); addSpike(seg, k, fi, 1); shardArc(seg, k - 2, fi, pickLane(), 4); mark(seg, k, 'spikes'); return 0; }],
    [g('gap', 1.4 + D), () => { const len = D > 0.45 ? 3 : 2; addGap(seg, k, fi, len); shardArc(seg, k - 1, fi, pickLane(), len + 1); mark(seg, k, 'gap'); return len; }],
    [g('pad', 0.6 + D * 0.8), () => { addPad(seg, k, fi); ALL.forEach((l) => { addObstacle(seg, k + 3, fi, l, 2); addObstacle(seg, k + 4, fi, l, 2); }); shardArc(seg, k, fi, pickLane(), 6); mark(seg, k, 'pad'); return 8; }],
    [g('crusher', 0.5 + D * 1.2), () => { addCrusher(seg, k, fi, pickLane()); mark(seg, k, 'crusher'); return 0; }],
    [g('crumble', 0.7 + D * 0.8), () => { const l = pickLane(); addCrumble(seg, k, fi, l, 3); shardLine(seg, k, fi, l, 3, 0.2); mark(seg, k, 'crumble'); return 3; }],
    [g('flip', 0.6 + D * 0.6), () => { const l = pickLane(); addFlip(seg, k, fi, l); addSpike(seg, k + 3, fi, -1); addSpike(seg, k + 3, fi, 1); mark(seg, k, 'flip'); return 3; }],
    [g('sweeper', 0.4 + D * 1.2), () => { addSweeper(seg, k, fi); mark(seg, k, 'sweeper'); return 1; }],
    [g('laser', 0.8 + D), () => { addLaser(seg, k, fi, false); shardArc(seg, k - 2, fi, pickLane(), 4); mark(seg, k, 'laser'); return 0; }],
    [g('laserHigh', 0.8), () => { addLaser(seg, k, fi, true); shardLine(seg, k - 1, fi, pickLane(), 3); mark(seg, k, 'laserHigh'); return 0; }],
    [g('orb', 0.9), () => { addGap(seg, k, fi, 5); [-1, 1].forEach((l) => addOrb(seg, k + 1, fi, l, 1.45)); mark(seg, k, 'orb'); return 5; }],
  ]);
  return fn();
}

// Track-mode patterns. Each one is beatable on its own side.
function modePattern(seg, k, fi, mode, zone) {
  const n = faceN(seg.d, fi);
  if (mode === 1) { // wogen: plain obstacles, the wave is the twist
    const fn = weighted([
      [2, () => { addObstacle(seg, k, fi, pickLane(), 1); return 0; }],
      [1.4, () => { ALL.forEach((l) => addObstacle(seg, k, fi, l, 1)); return 1; }],
      [1.2, () => { const l = pickLane(); addObstacle(seg, k, fi, l, 2); addObstacle(seg, k, fi, 0, 2); return 0; }],
      [1.5, () => { addGap(seg, k, fi, 2); return 2; }],
    ]);
    return fn();
  }
  if (mode === 2) { // senke: a gravity well with a hole; it pulls you into its lane
    const l = pickLane();
    for (const q of [k, k + 1]) { const key = kv(faceCell(seg, q, fi, l)); RUNMAP.delete(key); }
    seg.wells.push({ k, fi, lane: l, pos: faceCell(seg, k, fi, l).addScaledVector(seg.d, 0.5), pulled: false });
    shardArc(seg, k - 2, fi, l, 4);
    return 3;
  }
  if (mode === 3) { // fluss: rails break off on alternating lanes, sometimes both
    seg.railLane = -(seg.railLane || 1);
    if (Math.random() < 0.22) { addGap(seg, k, fi, 3); shardArc(seg, k - 1, fi, pickLane(), 4); return 3; }
    const l = seg.railLane;
    for (let q = k; q < k + 4; q++) RUNMAP.delete(kv(faceCell(seg, q, fi, l)));
    shardLine(seg, k, fi, -l, 4);
    return 2;
  }
  // sand: quicksand lanes; at the end the maw, crossed with a launch pad
  if (zone && seg.start + k > zone.B - 34 && !zone.schlund) {
    zone.schlundPending = true;
    return 0;
  }
  const l = pickLane();
  const both = Math.random() < 0.2;
  for (let q = k; q < k + 4; q++) for (const ll of both ? [-1, 1] : [l]) setCell(seg, faceCell(seg, q, fi, ll), 6, seg.start + q, n);
  if (!both) shardLine(seg, k, fi, -l, 4);
  return 2;
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
    marks: [], wells: [], cells: [], spikes: [], pads: [], orbs: [], portals: [], shards: [], items: [], sweepers: [], lasers: [], crushers: [], crumbles: [], flips: [], rings: [], group: new THREE.Group(), start: RUN.genDist,
  };
  for (let k = prev ? -1 : -8; k <= L; k++) for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { // -1: completes the corner cube
    if (i || j) setCell(seg, o.clone().addScaledVector(d, k).addScaledVector(Y, i).addScaledVector(seg.r, j), i && j ? 0 : 5, RUN.genDist + k, Y.clone().multiplyScalar(i).addScaledVector(seg.r, j).normalize());
  }
  planZones(RUN.genDist + L + 40);
  for (const z of RUN.zonePlan) if (z.A >= RUN.genDist && z.A < RUN.genDist + L) mark(seg, z.A - RUN.genDist, z.type);
  let k = prev ? 9 : 44; // first segment: long run-in while the hints show
  let lastGlobal = false;
  while (k < L - 22) { // the stretch before a corner stays clear: the turn is enough to handle there
    const dd = Math.min(1, (seg.start + k) / 1800);
    let extra = 0;
    const dist = seg.start + k;
    const zone = zoneAt(dist);
    const g = lastGlobal ? 1 : Math.random(); // never two ring-shaped walls in a row
    lastGlobal = false;
    if (zone && zone.mode && dist > zone.A + 10 && dist < zone.B - 6) {
      // inside a track-transforming zone the zone's own patterns take over
      for (let fi = 0; fi < 4; fi++) extra = Math.max(extra, modePattern(seg, k, fi, zone.mode, zone));
      if (zone.schlundPending && !zone.schlund) {
        zone.schlund = seg.start + k + 2;
        for (let fi = 0; fi < 4; fi++) { addPad(seg, k, fi); addGap(seg, k + 2, fi, 7); }
        mark(seg, k, 'schlund');
        extra = 10;
      }
    } else if (zone && zone.mode && dist >= zone.A - 4) {
      // the edges of a zone stay calm while the track transforms
    } else if (isOpen('portal', dist) && g < 0.045 + dd * 0.03) { addPortal(seg, k); mark(seg, k, 'portal'); extra = 3; lastGlobal = true; }
    else if (isOpen('ring', dist) && g < 0.1 + dd * 0.06) { addRing(seg, k); mark(seg, k, 'ring'); extra = 2; lastGlobal = true; }
    else if (isOpen('phase', dist) && g < 0.18 + dd * 0.1) {
      const p = Math.random() < 0.5 ? 1 : 2;
      for (let fi = 0; fi < 4; fi++) for (let l = -1; l <= 1; l++) for (let h = 1; h <= 2; h++) setCell(seg, faceCell(seg, k, fi, l, h), p, seg.start + k, faceN(seg.d, fi));
      mark(seg, k, 'phase');
      extra = 2; lastGlobal = true;
    } else {
      for (let fi = 0; fi < 4; fi++) extra = Math.max(extra, facePattern(seg, k, fi, dd, dist));
    }
    // power-ups every 170-290 m, a little before the next slot
    if (dist > RUN.nextPower) {
      RUN.nextPower = dist + 170 + Math.random() * 120;
      const type = ['schild', 'flug', 'sog'][RUN.powerIdx++ % 3];
      addPower(seg, k - 3, (Math.random() * 4) | 0, pickLane(), type);
    }
    // early on the gaps between obstacles are wider; they tighten towards 1800 m
    k += Math.round(Math.max(6.5, speedAt(dist) * 0.5 + 3) + (1 - dd) * 3.5 + extra);
  }
  const bnd = Math.ceil((seg.start + 1) / BIOME_LEN) * BIOME_LEN;
  if (bnd > seg.start + 4 && bnd < seg.start + L - 4) {
    const gate = makeThroat();
    gate.position.copy(o).addScaledVector(d, bnd - seg.start);
    gate.quaternion.setFromUnitVectors(Z_AXIS, d);
    gate.userData.u.uA.value = 1;
    seg.group.add(gate);
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
  const pos = new Float32Array(n * 3), ph = new Float32Array(n), sd = new Float32Array(n), tr = new Float32Array(n), out = new Float32Array(n * 3);
  let i = 0;
  for (const [k, t] of RUNMAP) {
    const m = RUNMETA.get(k) || [0, 0, 1, 0];
    tr[i] = m[0]; out[i * 3] = m[1]; out[i * 3 + 1] = m[2]; out[i * 3 + 2] = m[3];
    const c = k.split(',');
    pos[i * 3] = +c[0]; pos[i * 3 + 1] = +c[1]; pos[i * 3 + 2] = +c[2];
    ph[i] = t; sd[i] = (Math.sin(+c[0] * 12.9 + +c[1] * 78.2 + +c[2] * 37.7) * 43758.5) % 1;
    i++;
  }
  const g = new THREE.InstancedBufferGeometry().copy(blockGeo);
  g.setAttribute('aPos', new THREE.InstancedBufferAttribute(pos, 3));
  g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(sd.map(Math.abs), 1));
  g.setAttribute('aTrack', new THREE.InstancedBufferAttribute(tr, 1));
  g.setAttribute('aOut', new THREE.InstancedBufferAttribute(out, 3));
  g.instanceCount = n;
  if (runMesh) { runMesh.geometry.dispose(); runMesh.geometry = g; }
  else { runMesh = new THREE.Mesh(g, shader(levelU, RUN_BLOCK_VS, BLOCK_FS)); runMesh.frustumCulled = false; runGroup.add(runMesh); }
}
function dropSeg(seg) {
  seg.cells.forEach((k) => {
    const n = (RUNREF.get(k) || 1) - 1;
    if (n <= 0) { RUNREF.delete(k); RUNMAP.delete(k); RUNMETA.delete(k); } else RUNREF.set(k, n);
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

/* ---------- run flow ---------- */
function clearRun() {
  RUN.segs.forEach(dropSeg);
  RUN.segs = [];
  RUNMAP.clear();
  RUNREF.clear();
  RUNMETA.clear();
}
function setBiome(b, announce) {
  RUN.biome = b;
  const bio = BIOMES[b % BIOMES.length];
  backgrounds.forEach((m, k) => { m.visible = k === bio.bg; });
  musicPlay(bio.name, { fade: announce ? 1.2 : 0.05 });
  if (!RUN.zone) setPalette(BIOME_PALETTE[b % BIOME_PALETTE.length], announce ? 2.5 : 0.01);
  gsap.to(levelU.uStyle, { value: b % BIOMES.length, duration: announce ? 2.5 : 0, ease: 'power2.inOut' });
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
    si: 0, s: 0, fi: 0, lane: -1, uT: -1, uV: -1, y: 0, vy: 0, prevY: 0, grounded: true, speed: 8, dist: 0, genDist: 0,
    shards: 0, phase: 1, turnQueued: false, sog: 0, focus: 1, timeScale: 1, slow: false, jumpBuf: 0,
    moment: 1, dash: 1, dashT: 0, slam: false, zone: null, zonePlan: [], nextZoneGen: 130, lastPlanned: null, sink: 0, boostT: 0, prevFloor: 0, surfV: 0, shield: false, flight: 0, invuln: 0, nextPower: 120, powerIdx: 0,
  });
  gsap.killTweensOf(RUN);
  resetWarp();
  [wormhole, strudel].forEach((o) => { gsap.killTweensOf(o.userData.u.uA); o.userData.u.uA.value = 0; o.visible = false; });
  levelU.uZones.value.forEach((v) => v.set(0, 0, 0, 0)); levelU.uWells.value.forEach((v) => v.set(0, 0, 0, 0));
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
  ballQ.identity();
  runVisual(0);
  vis.prev.copy(vis.pos);
  for (let k = 0; k < TRAIL; k++) trailPos.set([vis.pos.x, vis.pos.y, vis.pos.z], k * 3);
  camState.ready = false;
  hintTimers.forEach(clearTimeout);
  $('hudTop').hidden = true; $('hudBottom').hidden = true;
  $('runHud').hidden = false;
  showOverlay(null);
  G.mode = 'run';
  musicSlow(0);
  musicPlay('wabe', { restart: true, fade: 0.05 }); // like a level song: every attempt starts from the top
  wipe(1);
  toast('los');
  runModeHints();
}
function runModeHints() {
  const el = $('hint');
  $('hudBottom').hidden = false;
  const hints = ['Wisch links / rechts: Spur wechseln. Außen kippst du über die Kante', 'Tippen: springen', 'Pfeil erscheint: in Pfeilrichtung wischen'];
  hints.forEach((h, k) => hintTimers.push(setTimeout(() => {
    if (G.mode !== 'run') return;
    el.textContent = h;
    animate(el, { opacity: [0, 1], translateY: [8, 0], duration: 500, ease: 'outExpo' });
  }, 600 + k * 3800)));
  hintTimers.push(setTimeout(() => { $('hudBottom').hidden = true; }, 600 + hints.length * 3800));
}
function runDie(reason) {
  if (G.mode !== 'run') return;
  if (RUN.invuln > 0 || RUN.shield) {
    if (RUN.shield) {
      RUN.shield = false;
      RUN.invuln = 1;
      sfx.smash(); vibrate([20, 30, 20]); toast('schild weg');
      kick(0.05, 0.8, 0.2);
      burst(vis.pos, 80, 6, 0.9, 3);
    }
    if (reason === 'kurve verpasst') { RUN.turnQueued = true; RUN.s = Math.min(RUN.s, RUN.segs[RUN.si].L); transfer(); }
    RUN.dashT = Math.max(RUN.dashT, 0.3); RUN.dashExt = 0;
    if (RUN.y < 0) { RUN.y = 0.3; RUN.vy = 10; }
    return;
  }
  if (RUN.god) { RUN.godHits = (RUN.godHits || 0) + 1; RUN.lastHit = reason; if (RUN.y < -2) { RUN.y = 0; RUN.vy = 0; } return; }
  G.mode = 'rundying';
  setSlowmo(false);
  musicStop(0.05); // the song cuts on death
  sfx.die(); vibrate([30, 40, 80]);
  gsap.killTweensOf(RUN, 'moment');
  gsap.fromTo(RUN, { moment: 0.12 }, { moment: 1, duration: 1.3, ease: 'power2.in' });
  gsap.fromTo(fx, { after: 0.72 }, { after: 0, duration: 1.4, ease: 'power1.in' });
  kick(0.07, 1.2, 0.18);
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
    sfx[rec ? 'victory' : 'gameover']();
  }, 1200);
}

/* ---------- run actions ---------- */
function turnRequired() {
  const seg = RUN.segs[RUN.si];
  const win = 9 + RUN.speed * 0.45;
  if (seg.L - RUN.s > win || RUN.s > seg.L + 1.6 || RUN.turnQueued) return null; // late swipes still count
  const nd = new THREE.Vector3().crossVectors(seg.d, Y);
  if (seg.turn === 'left') nd.negate();
  const n = faceN(seg.d, RUN.fi), a = faceN(seg.d, RUN.fi + 1);
  const da = nd.dot(a), dn = nd.dot(n);
  return da > 0.5 ? 'right' : da < -0.5 ? 'left' : dn > 0.5 ? 'up' : 'down';
}
// Two lanes per side (the edge lanes). One swipe: other lane; from the outer one: tip over the edge.
function laneShift(dl) {
  if (RUN.lane === -dl) { RUN.lane = dl; RUN.uT += 2 * dl; sfx.lane(); }
  else { RUN.fi += dl; RUN.lane = -dl; RUN.uT += dl; sfx.wrap(); vibrate(8); bgEvent(vis.pos, 0.8); }
  kick(0.006, 0, 0);
}
function shockRing(pos, normal, size = 7) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, ...ADD, side: THREE.DoubleSide }));
  m.position.copy(pos);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  scene.add(m);
  gsap.fromTo(m.scale, { x: 0.3, y: 0.3, z: 0.3 }, { x: size, y: size, z: size, duration: 0.7, ease: 'expo.out' });
  gsap.to(m.material, { opacity: 0, duration: 0.7, ease: 'power2.in', onComplete: () => { scene.remove(m); m.geometry.dispose(); m.material.dispose(); } });
}
// Bullet time moment: time nearly stops, then eases back.
function bulletMoment(hold = 0.35, depth = 0.2) {
  if (REDUCED) return;
  gsap.killTweensOf(RUN, 'moment');
  gsap.timeline()
    .to(RUN, { moment: depth, duration: 0.06, ease: 'power2.out' })
    .to(RUN, { moment: 1, duration: 0.45, ease: 'power2.in' }, `+=${hold}`);
}
function runJump() {
  if (RUN.grounded) {
    RUN.vy = JUMP_V; RUN.grounded = false;
    sfx.jump(); vibrate(6);
    stretchJump(1);
    return true;
  }
  const seg = RUN.segs[RUN.si];
  const orb = seg.orbs.find((o) => !o.used && o.fi === RUN.fi && o.lane === RUN.lane && Math.abs(RUN.s - o.k) < 1.4 && Math.abs(RUN.y - o.h) < 1.3);
  if (orb) {
    orb.used = true;
    RUN.vy = JUMP_V;
    sfx.orb(); vibrate([6, 20, 6]);
    stretchJump(1.3);
    kick(0.03, 0, 0.12);
    bulletMoment(0.1, 0.55);
    burst(orb.mesh.position, 40, 4, 0.8, 3);
    gsap.to(orb.mesh.scale, { x: 2.4, y: 2.4, z: 2.4, duration: 0.3, ease: 'expo.out' });
    gsap.to(orb.mesh.scale, { x: 0, y: 0, z: 0, duration: 0.3, delay: 0.2 });
    return true;
  }
  return false;
}
// Air dash: straight forward at 2.4x speed, gravity off, smashes through blocks.
function runDash() {
  if (RUN.dash < 1 || RUN.dashT > 0) return false;
  RUN.dash = 0; RUN.dashT = 0.4; RUN.vy = 0; RUN.dashExt = 0;
  if (RUN.y < 0) RUN.y = Math.max(RUN.y, -0.2);
  sfx.dash(); vibrate(16);
  stretchDash();
  kick(0.05, 1.6, 0.06);
  gsap.fromTo(fx, { after: 0.75 }, { after: 0, duration: 0.6, ease: 'power2.out' });
  gsap.fromTo(fx, { fovKick: 18 }, { fovKick: 0, duration: 0.7, ease: 'expo.out' });
  burst(vis.pos, 26, 3, 0.5, 2, _c3.set(0, 0, 1).applyQuaternion(vis.frame));
  return true;
}
// Ground pound: drop hard along gravity, shockwave on impact.
function runSlam() {
  if (RUN.grounded || RUN.slam) return;
  RUN.slam = true; RUN.vy = -32; RUN.dashT = 0;
  sfx.phase(); vibrate(10);
  stretchJump(1.3);
  kick(0.02, 0.5, 0);
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
function wallAhead() {
  const seg = RUN.segs[RUN.si];
  const reach = Math.ceil(RUN.speed * 0.4 + 1.5);
  // decide by the FIRST thing in the ball's lane: jumpable stuff is jumped, tall walls are dashed
  for (let dk = 1; dk <= reach; dk++) {
    const h = stackAt(seg, Math.round(RUN.s) + dk);
    if (h === -Infinity) return false;
    if (h >= 2) return true;
    if (h === 1) return false;
    if (sweeperAhead(seg, Math.round(RUN.s) + dk)) return true;
  }
  return false;
}
// Zones are planned while the track is generated, so the track itself is built for them.
// Four of them transform the track (with their own mechanics), three only bend the world.
const TRACK_ZONES = ['wogen', 'senke', 'fluss', 'sand'];
const FX_ZONES = ['spirale', 'schlange', 'negativ'];
const ZONES = [...TRACK_ZONES, ...FX_ZONES];
const TRACK_MODE = { wogen: 1, senke: 2, fluss: 3, sand: 4 };
function planZones(upTo) {
  while (RUN.nextZoneGen < upTo) {
    let type;
    do type = RUN.forceType || (Math.random() < 0.72 ? TRACK_ZONES : FX_ZONES)[(Math.random() * 4) | 0] || 'spirale';
    while (!RUN.forceType && type === RUN.lastPlanned);
    RUN.lastPlanned = type;
    const A = RUN.nextZoneGen, B = A + 180 + Math.random() * 60;
    RUN.zonePlan.push({ type, A, B, mode: TRACK_MODE[type] || 0 });
    RUN.nextZoneGen = B + 80 + Math.random() * 70;
  }
}
const zoneAt = (p) => RUN.zonePlan.find((z) => p >= z.A && p <= z.B);
const zoneFactor = (z, p) => { const a = clamp((p - (z.A - 4)) / 14, 0, 1), b = clamp((p - (z.B - 10)) / 14, 0, 1); return a * a * (3 - 2 * a) * (1 - b * b * (3 - 2 * b)); };
// wogen: the beam's surface rides a travelling wave (same formula as the shader)
function terrainAt(p) {
  const z = zoneAt(p);
  if (!z || z.mode !== 1) return 0;
  return 1.1 * (0.5 + 0.5 * Math.sin(p * 0.35 + U.time.value * 3.0)) * zoneFactor(z, p);
}
// senke: cells around a gravity well sink (same formula as the shader)
function wellDip(seg, k) {
  let dip = 0;
  for (const sg of [seg, RUN.segs[RUN.si + 1]]) {
    if (!sg) continue;
    for (const w of sg.wells) {
      const dd = faceCell(seg, k, RUN.fi, RUN.lane).distanceToSquared(w.pos);
      dip -= 0.8 * Math.exp(-dd / 3);
    }
  }
  return dip;
}
function tweenWarp(t, d) {
  ['uTwist', 'uCurve', 'uWave', 'uSnake'].forEach((k) => gsap.to(WARP[k], { value: t[k] || 0, duration: d, ease: 'sine.inOut', overwrite: true }));
}
function resetWarp() {
  ['uTwist', 'uCurve', 'uWave', 'uSnake'].forEach((k) => { gsap.killTweensOf(WARP[k]); WARP[k].value = 0; });
  gsap.killTweensOf(post.mat.uniforms.uInvert);
  post.mat.uniforms.uInvert.value = 0;
  WARP.uDir.value.set(0, 0, 0);
}
function startZone(z) {
  RUN.zone = z;
  const type = z.type;
  setPalette(ZONE_PALETTE[type], 2.5);
  const D = Math.min(1, RUN.dist / 1800);
  const t = {};
  if (type === 'spirale') t.uTwist = (Math.random() < 0.5 ? -1 : 1) * (0.075 + 0.035 * D);
  if (type === 'schlange') t.uSnake = 1.6;
  if (type === 'negativ') { t.uTwist = 0.03; t.uWave = 0.6; gsap.to(post.mat.uniforms.uInvert, { value: 1, duration: 0.5, ease: 'power2.inOut' }); }
  if (type === 'senke') t.uCurve = 0.003; // the point-grid well opens below and ahead
  if (type === 'fluss') {
    // field-line throats along the way; the lines twist a little
    t.uTwist = 0.02 * (Math.random() < 0.5 ? -1 : 1);
    z.gateAt = (z.A + z.B) / 2 - 35;
    gsap.fromTo(wormhole.userData.u.uA, { value: 0 }, { value: 1, duration: 2.5 });
  }
  if (type === 'sand') {
    t.uCurve = 0.003;
    gsap.fromTo(strudel.userData.u.uA, { value: 0 }, { value: 1, duration: 3 });
  }
  // effect zones combine more often later on
  if (FX_ZONES.includes(type) && type !== 'negativ' && Math.random() < 0.35 + D * 0.4) {
    const extra = ['uTwist', 'uWave', 'uSnake'][(Math.random() * 3) | 0];
    if (!t[extra]) t[extra] = extra === 'uTwist' ? 0.04 * (Math.random() < 0.5 ? -1 : 1) : 0.9;
  }
  tweenWarp(t, 3);
  toast(type);
  wipe(1);
  kick(0.05, 0.8, 0.12);
  bgEvent(vis.pos, 2.5);
}
function endZone() {
  tweenWarp({}, 3);
  gsap.to(wormhole.userData.u.uA, { value: 0, duration: 2 });
  gsap.to(strudel.userData.u.uA, { value: 0, duration: 2.5 });
  gsap.to(post.mat.uniforms.uInvert, { value: 0, duration: 0.6, ease: 'power2.inOut' });
  RUN.zone = null;
  setPalette(BIOME_PALETTE[RUN.biome % BIOME_PALETTE.length], 2.5);
}
function runInput(dir) {
  if (G.mode !== 'run') return;
  // the corner always wins: a swipe in the arrow's direction takes the turn
  const req = turnRequired();
  if (req && dir === req) {
    RUN.turnQueued = true;
    sfx.turn(); vibrate(10);
    $('turnArrow').hidden = true;
    arrowAt(window.innerWidth / 2, window.innerHeight * 0.52, dir);
    burst(vis.pos, 24, 3, 0.6, 2);
    return;
  }
  if (dir === 'tap' || dir === 'up') {
    // a wall too tall to jump: dash through it straight from the ground
    if (RUN.grounded && wallAhead()) {
      if (runDash()) return;
      toast('dash lädt');
    }
    if (dir === 'tap') { if (!runJump()) RUN.jumpBuf = 0.14; return; }
  }
  if (dir === 'left' || dir === 'right') laneShift(dir === 'right' ? 1 : -1);
  else if (dir === 'up') { if (!runJump() && !runDash()) RUN.jumpBuf = 0.14; }
  else { runPhase(); if (!RUN.grounded) runSlam(); } // down always switches the phase; in the air it also slams
}
function setSlowmo(on) {
  if (RUN.slow === on) return;
  RUN.slow = on;
  gsap.to(RUN, { timeScale: on ? 0.3 : 1, duration: on ? 0.25 : 0.4, ease: 'power2.out', overwrite: false });
  musicSlow(on ? 1 : 0);
  if (on) { toast('bullet time'); vibrate(8); kick(0.03, 0, 0.1); }
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
  // inner corner (the new beam rises in front of this side): the ball climbs onto the new beam's
  // inner face, which only starts behind the old beam, so it re-enters a little further along
  const concave = RUN.segs[RUN.si + 1].d.dot(faceN(seg.d, RUN.fi)) > 0.5;
  RUN.s -= seg.L;
  RUN.si++;
  RUN.turnQueued = false;
  if (concave) RUN.s = Math.max(RUN.s, 1.5 + R + 0.2);
  if (RUN.y < 0) { RUN.y = 0; RUN.vy = Math.max(RUN.vy, 0); } // a late swipe puts the ball back onto the new track
  runVisual(0);
  RUN.offset.add(before.sub(vis.pos));
  sfx.wrap();
  bgEvent(vis.pos, 1.2);
  manageSegs();
}
function runStep(dt) {
  const ts = dt * RUN.timeScale * RUN.moment;
  let seg = RUN.segs[RUN.si];
  RUN.speed = speedAt(RUN.dist);
  const dashing = RUN.dashT > 0;
  RUN.dashT = Math.max(0, RUN.dashT - ts);
  // a dash that would end above a hole carries on until there is floor again
  if (dashing && RUN.dashT === 0 && (RUN.dashExt || 0) < 0.8 && stackAt(seg, Math.round(RUN.s + 0.5)) === -Infinity) { RUN.dashT = 0.04; RUN.dashExt = (RUN.dashExt || 0) + 0.04; }
  RUN.dash = Math.min(1, RUN.dash + dt / 2.2);
  const zc = zoneAt(seg.start + RUN.s);
  const mode = zc ? zc.mode : 0;
  // fluss: the current carries you faster; sand: the stream pushes, quicksand drags
  let mult = mode === 3 ? 1.25 : mode === 4 ? (RUN.sink > 0 ? 0.55 : 1.2) : 1;
  if (RUN.boostT > 0) { RUN.boostT -= ts; mult *= 1.5; }
  const adv = RUN.speed * mult * (dashing ? 2.4 : 1) * ts;
  RUN.s += adv; RUN.dist += adv;
  if (RUN.turnQueued && RUN.s >= seg.L) { transfer(); seg = RUN.segs[RUN.si]; }

  if (RUN.flight > 0) {
    RUN.flight -= ts;
    if (RUN.flight <= 0) {
      const land = stackAt(seg, Math.round(RUN.s + 2));
      if ((land === -Infinity || land > 0) && (RUN.flightExt || 0) < 2) { RUN.flight = 0.15; RUN.flightExt = (RUN.flightExt || 0) + 0.15; }
      else { RUN.flight = 0; RUN.flightExt = 0; RUN.vy = 0; RUN.invuln = 0.4; }
    }
    if (RUN.flight > 0) {
      RUN.y += (3.2 - RUN.y) * (1 - Math.exp(-ts * 5));
      RUN.vy = 0; RUN.grounded = false; RUN.prevY = RUN.y;
      collectAndFinish(dt, seg);
      return;
    }
  }
  // vertical motion along the current face normal
  RUN.prevY = RUN.y;
  if (dashing) RUN.vy = 0;
  else RUN.vy -= GRAV * (RUN.slam ? 2.2 : 1) * ts;
  RUN.y += RUN.vy * ts;
  const k = Math.round(RUN.s);
  // floor = cells + the zone's surface: wogen waves, senke dips, quicksand sinking
  const onSand = RUNMAP.get(kv(faceCell(seg, k, RUN.fi, RUN.lane))) === 6;
  if (onSand && RUN.grounded && !dashing) RUN.sink += ts * 1.0; else RUN.sink = 0;
  if (RUN.sink > 0.95) return runDie('versunken');
  let floor = stackAt(seg, k);
  if (floor !== -Infinity) floor += terrainAt(seg.start + k) + (seg.wells.length || (RUN.segs[RUN.si + 1] || {}).wells?.length ? wellDip(seg, k) : 0) - RUN.sink;
  // a falling floor under a grounded ball turns its rising speed into a launch (wave crests)
  if (RUN.grounded && floor < RUN.y - 0.02 && RUN.surfV > 0.5) { RUN.vy = RUN.surfV * 0.9; RUN.grounded = false; RUN.y += RUN.vy * ts; }
  RUN.surfV = RUN.grounded ? (floor - RUN.prevFloor) / Math.max(ts, 1e-4) : 0;
  RUN.prevFloor = floor;
  if (RUN.vy <= 0 && RUN.y <= floor && (RUN.prevY >= floor - 0.05 || RUN.y > floor - 0.45)) {
    if (!RUN.grounded) {
      const impact = Math.min(1.6, -RUN.vy / 14);
      if (RUN.slam) {
        RUN.slam = false;
        sfx.slam(); vibrate([20, 30, 40]);
        squashLand(1.7);
        kick(0.035, 0.9, 0.12);
        gsap.fromTo(fx, { shake: 0.9 }, { shake: 0, duration: 0.6 });
        const n = faceN(seg.d, RUN.fi);
        shockRing(vis.pos.clone().addScaledVector(n, -R + 0.03), n, 8);
        bgEvent(vis.pos, 2.6);
        burst(vis.pos, 50, 5, 0.7, 3, n);
      } else {
        sfx.land();
        squashLand(Math.max(0.5, impact));
        burst(vis.pos, 10, 2, 0.4, 2);
      }
    }
    RUN.y = floor; RUN.vy = 0; RUN.grounded = true;
    if (RUN.jumpBuf > 0) { RUN.jumpBuf = 0; runJump(); }
  } else if (RUN.y > floor + 0.02) RUN.grounded = false;
  RUN.jumpBuf = Math.max(0, RUN.jumpBuf - ts);

  // front collision: anything taller than the ball's height ahead
  const kA = Math.round(RUN.s + 0.32);
  // in the corner, the next beam must not count as a wall once the turn is queued
  let hA = RUN.turnQueued && kA >= seg.L - 1 ? Math.min(stackAt(seg, kA), 0) : stackAt(seg, kA);
  if (hA !== -Infinity) hA += terrainAt(seg.start + kA) + (seg.wells.length ? wellDip(seg, kA) : 0);
  // small ledges (landing a bit short, sinking at the end of a dash) are stepped up, not crashed into
  if (hA > RUN.y + 0.32 && hA - RUN.y <= (mode ? 1.0 : 0.6)) { RUN.y = hA; RUN.vy = Math.max(RUN.vy, 0); RUN.grounded = true; }
  else if (hA > RUN.y + 0.32) {
    if (!dashing) return runDie(kA >= seg.L - 1 ? 'kurve verpasst' : 'aufgeprallt');
    // dash smashes the column in front
    let broke = 0;
    for (let h = 1; h <= 4; h++) {
      const p = faceCell(seg, kA, RUN.fi, RUN.lane, h), key = kv(p);
      const t = RUNMAP.get(key);
      if (t === 3 || t === RUN.phase) { RUNMAP.delete(key); RUNREF.delete(key); burst(p, 30, 6, 0.8, 3); broke++; }
    }
    if (broke) {
      RUN.dashT = Math.max(RUN.dashT, 0.15); // keep going through the next block too
      rebuildBlocks();
      sfx.smash(); vibrate(20);
      kick(0.04, 0.6, 0.1);
      gsap.fromTo(fx, { shake: 0.7 }, { shake: 0, duration: 0.5 });
    }
  }
  if (RUN.y < -2.4) return runDie(RUN.s > seg.L + 0.5 ? 'kurve verpasst' : 'abgestürzt');

  for (const w of seg.wells) {
    const ahead = w.k - RUN.s;
    if (w.pulled || w.fi !== RUN.fi || ahead < 1 || ahead > 6 || !RUN.grounded) continue;
    w.pulled = true;
    if (RUN.lane !== w.lane) { laneShift(w.lane); toast('sog'); kick(0.03, 0.4, 0); vibrate(12); }
  }
  if (zc && zc.type === 'fluss' && zc.gateAt && Math.abs(seg.start + RUN.s - zc.gateAt) < 0.6 && !zc.boosted) {
    zc.boosted = true; RUN.boostT = 1.2; sfx.portal(); kick(0.05, 1.4, 0.1); toast('strömung');
  }
  for (const cr of seg.crushers) {
    if (!cr.alive || cr.fi !== RUN.fi || cr.lane !== RUN.lane || Math.abs(RUN.s - cr.k) > 0.55) continue;
    const h = crusherH(cr);
    if (RUN.y < h + 1 && RUN.y + 0.64 > h) {
      if (!dashing) return runDie('zerquetscht');
      cr.alive = false; cr.mesh.visible = false;
      burst(cr.block.getWorldPosition(new THREE.Vector3()), 50, 6, 0.8, 3); sfx.smash(); kick(0.04, 0.6, 0.1);
    }
  }
  for (const cb of seg.crumbles) {
    if (cb.done || cb.k - RUN.s > 4 + RUN.speed * 0.12) continue;
    cb.done = true;
    const n = faceN(seg.d, cb.fi);
    for (let q = cb.k; q < cb.k + cb.len; q++) {
      const p = faceCell(seg, q, cb.fi, cb.lane), key = kv(p);
      RUNMAP.delete(key); RUNREF.delete(key); RUNMETA.delete(key);
      const chunk = new THREE.Group();
      chunk.add(new THREE.Mesh(boxGeo, black), new THREE.LineSegments(boxEdges, lineMat));
      chunk.position.copy(p);
      scene.add(chunk);
      const to = p.clone().addScaledVector(n, -6 - Math.random() * 4);
      gsap.to(chunk.position, { x: to.x, y: to.y, z: to.z, duration: 1.1, delay: (q - cb.k) * 0.06, ease: 'power2.in' });
      gsap.to(chunk.rotation, { x: Math.random() * 3, z: Math.random() * 3, duration: 1.1, delay: (q - cb.k) * 0.06 });
      gsap.to(chunk.scale, { x: 0, y: 0, z: 0, duration: 1.1, delay: (q - cb.k) * 0.06, ease: 'power2.in', onComplete: () => scene.remove(chunk) });
      burst(p, 8, 2, 0.5, 2);
    }
    rebuildBlocks();
    sfx.smash();
  }
  if (RUN.grounded && RUN.y < 0.05) for (const fl of seg.flips) {
    if (fl.used || fl.fi !== RUN.fi || fl.lane !== RUN.lane || Math.abs(RUN.s - fl.k) > 0.5) continue;
    fl.used = true;
    RUN.fi += 2; RUN.uT += 6; RUN.vy = 4; RUN.grounded = false;
    sfx.portal(); vibrate([10, 30, 10]); toast('gekippt');
    kick(0.04, 0.5, 0.1); bgEvent(vis.pos, 2);
    gsap.fromTo(fx, { fovKick: 12 }, { fovKick: 0, duration: 0.8, ease: 'expo.out' });
    break;
  }
  for (const rg of seg.rings) {
    if (!rg.alive || Math.abs(RUN.s - rg.k) > 0.45 || RUN.y > 1.0) continue;
    // logical lane and computed ring angle, like every other obstacle (not the lagging visuals)
    const rel = faceN(seg.d, RUN.fi).multiplyScalar(1.5 + R + RUN.y).addScaledVector(faceN(seg.d, RUN.fi + 1), RUN.lane);
    const th = Math.atan2(rel.dot(Y), rel.dot(seg.r));
    const phi = rg.ph + U.time.value * rg.w;
    const hit = rg.angles.some((a) => { let dd = th - (a + phi); dd = Math.atan2(Math.sin(dd), Math.cos(dd)); return Math.abs(dd) < 0.28; }); // a bit smaller than the visible blocks: grazing is forgiven
    if (!hit) continue;
    if (!dashing) return runDie('drehring');
    rg.alive = false; rg.mesh.visible = false;
    burst(rg.mesh.position, 90, 7, 1, 3); sfx.smash(); kick(0.05, 0.8, 0.15);
  }
  for (const sw of seg.sweepers) {
    if (!sw.alive || sw.fi !== RUN.fi || Math.abs(RUN.s - sw.k) > 0.6 || RUN.y > 0.85) continue;
    if (Math.abs(sw.x - RUN.lane) > 0.72) continue;
    if (!dashing) return runDie('weggefegt');
    sw.alive = false; sw.mesh.visible = false;
    burst(sw.mesh.position, 50, 6, 0.8, 3); sfx.smash(); kick(0.04, 0.6, 0.1);
  }
  if (!dashing) for (const lz of seg.lasers) {
    if (lz.fi !== RUN.fi || Math.abs(RUN.s - lz.k) > 0.35) continue;
    if (!lz.high && RUN.y < 0.55) return runDie('laser');
    if (lz.high && RUN.y > 1.1 && RUN.y < 1.9) return runDie('laser'); // matches where the beam visibly touches the ball
  }
  if (!dashing) for (const sp of seg.spikes) if (sp.fi === RUN.fi && sp.lane === RUN.lane && Math.abs(RUN.s - sp.k) < 0.42 && RUN.y < 0.45) return runDie('stacheln');
  if (RUN.grounded && RUN.y < 0.05) for (const p of seg.pads) if (p.fi === RUN.fi && Math.abs(RUN.s - p.k) < 0.5) {
    RUN.vy = PAD_V; RUN.grounded = false;
    sfx.pad(); vibrate(14);
    stretchJump(1.6);
    kick(0.02, 0.6, 0);
    burst(vis.pos, 30, 4, 0.7, 3);
    gsap.fromTo(fx, { fovKick: 10 }, { fovKick: 0, duration: 0.8, ease: 'expo.out' });
  }
  for (const p of seg.portals) if (!p.passed && RUN.s >= p.k) {
    p.passed = true;
    RUN.fi += 2; RUN.uT += 6;
    RUN.vy = Math.max(RUN.vy, 3);
    sfx.portal(); vibrate([10, 30, 10]);
    bgEvent(vis.pos, 2.4);
    kick(0.04, 0.5, 0.1);
    toast('gekippt');
    burst(p.mesh.position, 80, 5, 1, 3);
    gsap.fromTo(fx, { fovKick: 16 }, { fovKick: 0, duration: 0.9, ease: 'expo.out' });
    gsap.to(p.mesh.scale, { x: 1.6, y: 1.6, z: 1.6, duration: 0.5, ease: 'expo.out' });
  }

  collectAndFinish(dt, seg);
}
function collectAndFinish(dt, seg) {
  // pickups in the current and next segment
  const reach = RUN.sog > 0 || RUN.flight > 0 ? 3.6 : 0.8;
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
      sfx.sog(); vibrate([10, 30, 10]);
      burst(it.pos, 60, 4, 1, 3);
      kick(0.03, 0, 0.12);
      if (it.type === 'sog') { RUN.sog = 8; toast('sog'); }
      else if (it.type === 'schild') { RUN.shield = true; toast('schild'); }
      else { RUN.flight = 6; RUN.vy = 9; RUN.grounded = false; toast('höhenflug'); }
    });
  }
  RUN.sog = Math.max(0, RUN.sog - dt);
  RUN.invuln = Math.max(0, (RUN.invuln || 0) - dt);

  // focus meter: drains in slow motion, refills otherwise
  if (RUN.slow) { RUN.focus -= dt / 2.5; if (RUN.focus <= 0) { RUN.focus = 0; setSlowmo(false); } }
  else RUN.focus = Math.min(1, RUN.focus + dt / 14);

  const b = Math.floor((seg.start + RUN.s) / BIOME_LEN);
  if (b !== RUN.biome) setBiome(b, true);
  const zNow = zoneAt(seg.start + RUN.s);
  if (zNow !== RUN.zone) { if (RUN.zone) endZone(); if (zNow) startZone(zNow); }
  if (RUN.s > seg.L * 0.5) manageSegs();
}

const _pp = new THREE.Vector3(), _pn = new THREE.Vector3(), _pa = new THREE.Vector3(), _pd = new THREE.Vector3(), _rm = new THREE.Matrix4();
function runVisual(dt) {
  const seg = RUN.segs[RUN.si];
  RUN.uV += (RUN.uT - RUN.uV) * (dt ? 1 - Math.exp(-dt * 16) : 1);
  if (Math.abs(RUN.uT - RUN.uV) < 0.002) RUN.uV = RUN.uT; // settle exactly on the lane
  perim(seg.d, RUN.uV, _pp, _pn);
  vis.pos.copy(seg.o).addScaledVector(seg.d, RUN.s).add(_pp).addScaledVector(_pn, RUN.y).add(RUN.offset);
  if (dt) RUN.offset.multiplyScalar(Math.exp(-dt * 9));
  _pa.crossVectors(seg.d, _pn);
  vis.frame.setFromRotationMatrix(_rm.makeBasis(_pa, _pn, _pd.copy(seg.d).negate()));
}

const _rc = new THREE.Vector3(), _rl = new THREE.Vector3(), _ru = new THREE.Vector3(), _rq = new THREE.Quaternion();
// JS twin of the GLSL warpRun, so the camera can look along the bent track
const _wr = new THREE.Vector3(), _wa = new THREE.Vector3(), _wc = new THREE.Vector3();
function warpPoint(w) {
  const O = WARP.uAxisO.value, D = WARP.uDir.value, Uu = WARP.uUp.value;
  _wr.copy(w).sub(O);
  const a = _wr.dot(D), t = Math.max(a, 0);
  const x = clamp((t - 3) / 15, 0, 1), f = x * x * (3 - 2 * x);
  if (Math.abs(WARP.uTwist.value) > 0.0001) {
    const ang = WARP.uTwist.value * t * f;
    _wa.copy(D).multiplyScalar(a);
    const rad = _wr.sub(_wa);
    _wc.crossVectors(D, rad);
    _wr.copy(_wa).addScaledVector(rad, Math.cos(ang)).addScaledVector(_wc, Math.sin(ang));
  }
  const tt = U.time.value;
  _wr.addScaledVector(Uu, -WARP.uCurve.value * t * t * f);
  _wr.addScaledVector(Uu, WARP.uWave.value * 1.8 * Math.sin(t * 0.32 - tt * 2.2) * f);
  _wc.crossVectors(D, Uu);
  _wr.addScaledVector(_wc, WARP.uSnake.value * 3.0 * Math.sin(t * 0.16 - tt * 1.3) * f);
  return w.copy(O).add(_wr);
}
function runCamera(dt) {
  const seg = RUN.segs[RUN.si];
  _ru.set(0, 1, 0).applyQuaternion(vis.frame);
  // lateral offset of the ball from the face centre, so the camera stays calmer than the ball
  _rl.copy(vis.pos).sub(seg.o).addScaledVector(seg.d, -RUN.s).sub(RUN.offset).addScaledVector(_ru, -(1.5 + R + RUN.y));
  _rl.addScaledVector(_ru, -_rl.dot(_ru));
  _rc.copy(vis.pos).addScaledVector(_ru, 2.7 - RUN.y * 0.45).addScaledVector(seg.d, -5.8).addScaledVector(_rl, -0.4);
  _b.copy(vis.pos).addScaledVector(seg.d, 8).addScaledVector(_rl, -0.35).addScaledVector(_ru, -RUN.y * 0.3);
  // look partly along the bent track ahead: dives, spirals and snakes pull the view with them
  _wc.copy(vis.pos).addScaledVector(seg.d, 20).addScaledVector(_ru, -RUN.y * 0.3);
  const bentAhead = warpPoint(_wc.clone());
  _b.lerp(bentAhead.addScaledVector(seg.d, -12), 0.55);
  _m.lookAt(_rc, _b, _ru);
  _rq.setFromRotationMatrix(_m);
  if (!camState.ready) { camState.pos.copy(_rc); camState.quat.copy(_rq); camState.ready = true; }
  const s = 1 - Math.exp(-dt * 9);
  camState.pos.lerp(_rc, s);
  camState.quat.slerp(_rq, 1 - Math.exp(-dt * 7));
  camera.position.copy(camState.pos);
  camera.quaternion.copy(camState.quat);
}

// Field-line throat (from "fluss"): lines from far away converge into a throat around the
// track and flare out again. Used as biome portals and for the wormhole zone.
function makeThroat() {
  const NU = 140, NV = 60, pos = [], uvA = [], idx = [];
  for (let i = 0; i < NU; i++) {
    const sd = Math.random();
    for (let j = 0; j < NV; j++) {
      pos.push(0, 0, 0); uvA.push((i / NU) * Math.PI * 2, -1 + (2 * j) / (NV - 1), sd);
      if (j < NV - 1) idx.push(i * NV + j, i * NV + j + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aUV', new THREE.Float32BufferAttribute(uvA, 3));
  g.setIndex(idx);
  const u = { ...WARP, uTime: U.time, uA: { value: 0 }, uTw: { value: 1.4 } };
  const m = shader(u, /* glsl */`
    attribute vec3 aUV; uniform float uTime, uA, uTw; varying float vA;
    void main(){
      float v = aUV.y * 1.9;
      float ang = aUV.x + uTw * tanh(v * 1.3) + uTime * 0.15;
      float r = 4.2 * cosh(v);
      vec4 w = modelMatrix * vec4(cos(ang) * r, sin(ang) * r, v * 14.0, 1.0);
      w.xyz = warpRun(w.xyz);
      vec4 mv = viewMatrix * w;
      float flow = pow(fract(aUV.y * 4.0 + uTime * 0.9 + aUV.z), 12.0);
      vA = (0.22 + flow * 1.3 + exp(-v * v * 2.0) * 0.45) * smoothstep(1.0, 0.72, abs(aUV.y)) * uA * exp(-(-mv.z) * 0.01);
      gl_Position = projectionMatrix * mv;
    }`, /* glsl */`
    varying float vA;
    void main(){ gl_FragColor = vec4(vec3(1.0), clamp(vA, 0.0, 1.0)); }`, ADD);
  const lines = new THREE.LineSegments(g, m);
  lines.frustumCulled = false;
  lines.userData.u = u;
  return lines;
}
// place an object on the track at a given track distance (axis point + direction)
function trackPoint(dist) {
  for (const sg of RUN.segs) if (dist >= sg.start && dist <= sg.start + sg.L) return { p: sg.o.clone().addScaledVector(sg.d, dist - sg.start), d: sg.d.clone() };
  return null;
}
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const wormhole = makeThroat();
wormhole.visible = false;
scene.add(wormhole);
// Sand vortex (third reference): a disc of particles streaming in a spiral into a black hole.
const strudel = (() => {
  const N = 26000, a = [];
  for (let i = 0; i < N; i++) a.push(Math.sqrt(Math.random()), Math.random() * Math.PI * 2, Math.random());
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3));
  g.setAttribute('aP', new THREE.Float32BufferAttribute(a, 3));
  const u = { ...WARP, uTime: U.time, uPx: U.px, uA: { value: 0 } };
  const m = shader(u, /* glsl */`
    attribute vec3 aP; uniform float uTime, uPx, uA; varying float vA;
    void main(){
      float R = 78.0;
      float r = mod(aP.x * R - uTime * (4.0 + 70.0 / (aP.x * R + 6.0)), R) + 4.0;
      float ang = aP.y + 34.0 / (r + 2.0) + uTime * 0.18;
      float depth = -30.0 / (1.0 + pow(r / 6.5, 2.2));
      vec4 w = modelMatrix * vec4(cos(ang) * r, depth + (aP.z - 0.5) * 0.5, sin(ang) * r, 1.0);
      w.xyz = warpRun(w.xyz);
      vec4 mv = viewMatrix * w;
      float dz = max(-mv.z, 0.5);
      gl_PointSize = clamp((1.0 + aP.z * 1.8) * uPx * (70.0 / dz), 1.2 * uPx, 7.0 * uPx);
      float tw = 0.35 + 0.65 * step(0.45, fract(aP.z * 13.0 + uTime * (0.4 + aP.z)));
      vA = uA * tw * smoothstep(82.0, 58.0, r) * smoothstep(4.0, 9.0, r) * exp(-dz * 0.008);
      gl_Position = projectionMatrix * mv;
    }`, /* glsl */`
    varying float vA;
    void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(1.0), smoothstep(0.5, 0.1, d) * vA); }`, ADD);
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  pts.visible = false;
  pts.userData.u = u;
  return pts;
})();
scene.add(strudel);
const deco = new THREE.Group();
deco.visible = false;
scene.add(deco);
const decoU = { ...WARP, uTime: U.time, uTravel: { value: 0 }, uPx: U.px, uLen: { value: 1 }, uLineA: { value: 0 }, uBeat: bgU.uBeat };
(() => {
  // tumbling patterned cubes drifting around the beam
  const N = 70, d = [];
  for (let i = 0; i < N; i++) d.push(Math.random() * Math.PI * 2, 8 + Math.random() * 9, Math.random() * 100, Math.random());
  const g = new THREE.InstancedBufferGeometry().copy(blockGeo);
  g.setAttribute('aD', new THREE.InstancedBufferAttribute(new Float32Array(d), 4));
  g.instanceCount = N;
  const m = shader(decoU, /* glsl */`
    attribute vec4 aD; uniform float uTime, uTravel, uBeat;
    varying vec2 vUv; varying vec3 vN; varying float vA;
    void main(){
      float along = mod(aD.z - uTravel * 0.8, 100.0) - 14.0;
      float ang = aD.x + uTime * 0.06 * (aD.w - 0.5);
      vec3 c = vec3(cos(ang) * aD.y, sin(ang) * aD.y, -along);
      vec3 p = position * (0.35 + aD.w * 1.3) * (1.0 + uBeat * 0.08);
      p.xy = rot2(uTime * (0.3 + aD.w)) * p.xy;
      p.yz = rot2(uTime * 0.7 * aD.w + aD.w * 9.0) * p.yz;
      vUv = uv; vN = normal;
      vec4 wq4 = modelMatrix * vec4(c + p, 1.0); wq4.xyz = warpRun(wq4.xyz);
      vec4 mv = viewMatrix * wq4;
      vA = exp(-(-mv.z) * 0.025) * smoothstep(86.0, 64.0, along) * smoothstep(0.0, 8.0, along);
      if (vA < 0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
      gl_Position = projectionMatrix * mv;
    }`, /* glsl */`
    varying vec2 vUv; varying vec3 vN; varying float vA;
    float ring(float d, float r){ return 1.0 - smoothstep(0.01, 0.01 + fwidth(d) * 1.3, abs(d - r)); }
    void main(){
      float ex = min(vUv.x, 1.0 - vUv.x), ey = min(vUv.y, 1.0 - vUv.y);
      float e = min(ex, ey);
      float along = ex < ey ? vUv.y : vUv.x;
      float edge = (1.0 - smoothstep(0.035, 0.035 + fwidth(e) * 1.4, e)) * step(0.42, fract(along * 7.0));
      float d = max(abs(vUv.x - 0.5), abs(vUv.y - 0.5));
      float pat = abs(vN.y) > 0.5 ? ring(d, 0.28) + ring(d, 0.14) : ring(d, 0.22);
      gl_FragColor = vec4(vec3(max(edge, pat * 0.7) * vA), 1.0);
    }`);
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  deco.add(mesh);

  // cartoon speed lines streaming past
  const L = 90, pos = [], a = [];
  for (let i = 0; i < L; i++) {
    const ang = Math.random() * Math.PI * 2, r = 2.4 + Math.random() * 6, z = Math.random() * 60;
    for (const end of [0, 1]) { pos.push(0, 0, 0); a.push(ang, r, z, end); }
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  lg.setAttribute('aL', new THREE.Float32BufferAttribute(a, 4));
  const lm = shader(decoU, /* glsl */`
    attribute vec4 aL; uniform float uTravel, uLen, uLineA; varying float vA;
    void main(){
      float along = mod(aL.z - uTravel * 1.6, 60.0) - 6.0;
      vec3 p = vec3(cos(aL.x) * aL.y, sin(aL.x) * aL.y, -along + aL.w * uLen);
      vA = uLineA * (1.0 - aL.w * 0.8) * smoothstep(54.0, 40.0, along) * smoothstep(-6.0, -2.0, along);
      vec4 wq4 = modelMatrix * vec4(p, 1.0); wq4.xyz = warpRun(wq4.xyz);
      gl_Position = projectionMatrix * viewMatrix * wq4;
    }`, /* glsl */`
    varying float vA;
    void main(){ gl_FragColor = vec4(vec3(1.0), vA); }`, ADD);
  const lines = new THREE.LineSegments(lg, lm);
  lines.frustumCulled = false;
  deco.add(lines);
})();

// Explain each obstacle type the first time it comes into view (remembered on this device).
function showFirstHints() {
  for (let si = RUN.si; si < Math.min(RUN.segs.length, RUN.si + 2); si++) {
    const sg = RUN.segs[si];
    const base = si === RUN.si ? -RUN.s : RUN.segs[RUN.si].L - RUN.s;
    for (const m of sg.marks) {
      const ahead = m.k + base;
      if (ahead < 0 || ahead > 26 || seenHints[m.type]) continue;
      seenHints[m.type] = true;
      try { localStorage.setItem('kippwelt-seen', JSON.stringify(seenHints)); } catch (_) {}
      const el = $('hint');
      $('hudBottom').hidden = false;
      el.textContent = HINTS[m.type];
      animate(el, { opacity: [0, 1], translateY: [8, 0], duration: 400, ease: 'outExpo' });
      clearTimeout(showFirstHints.t);
      showFirstHints.t = setTimeout(() => { $('hudBottom').hidden = true; }, 3200);
      return;
    }
  }
}
const shieldBubble = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(R * 1.9, 1)), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
shieldBubble.visible = false;
ballRig.add(shieldBubble);
let hudTick = 0;
function runFrame(dt) {
  shieldBubble.visible = !!RUN.shield || RUN.invuln > 0;
  shieldBubble.rotation.y += dt * 1.5; shieldBubble.rotation.x += dt * 0.7;
  shieldBubble.material.opacity = RUN.shield ? 0.55 : 0.3 * (0.5 + 0.5 * Math.sin(U.time.value * 30));
  if (G.mode === 'run') runStep(dt);
  else if (G.mode === 'rundying') { const t2 = dt * RUN.moment; RUN.vy -= GRAV * t2 * 0.5; RUN.y += RUN.vy * t2 * 0.5; }
  if (G.mode === 'run' || G.mode === 'rundying') runVisual(dt);
  runCamera(dt);

  // backgrounds travel with the ball, snapped to their lattice so they stay put
  const bio0 = BIOMES[RUN.biome % BIOMES.length];
  const zt = RUN.zone && RUN.zone.type;
  const bio = zt === 'senke' ? { ...bio0, bg: 1 } : bio0; // the well zone shows the point-grid funnel
  backgrounds[0].visible = bio.bg === 0; backgrounds[1].visible = bio.bg === 1;
  RUN.bgLift = (RUN.bgLift || 0) + ((zt === 'senke' ? 8 : 0) - (RUN.bgLift || 0)) * (1 - Math.exp(-dt * 1.2)); // raise the well during the funnel zone
  if (bio.bg === 0) bgRoot.position.set(Math.round(vis.pos.x / 3.12) * 3.12, RUN.bgLift, Math.round(vis.pos.z / 1.8013) * 1.8013);
  else bgRoot.position.set(Math.round(vis.pos.x / 2) * 2, RUN.bgLift, Math.round(vis.pos.z / 2) * 2);
  const shaft = backgrounds[2];
  const seg = RUN.segs[RUN.si];
  if (WARP.uDir.value.lengthSq() < 0.5) WARP.uDir.value.copy(seg.d);
  WARP.uDir.value.lerp(seg.d, 1 - Math.exp(-dt * 5)).normalize();
  WARP.uAxisO.value.copy(seg.o).addScaledVector(seg.d, RUN.s);
  WARP.uUp.value.lerp(_ru.set(0, 1, 0).applyQuaternion(vis.frame), 1 - Math.exp(-dt * 4)).normalize();
  // wormhole: keep the throat ahead until the ball reaches it, then let it pass
  if (zt === 'fluss' || wormhole.userData.u.uA.value > 0.01) {
    const here = seg.start + RUN.s;
    if (RUN.zone && RUN.zone.gateAt && RUN.zone.gateAt - here < 25 && RUN.zone.gateAt - here > -40) {
      // fixed in place: the ball rolls through it
    } else if (RUN.zone && RUN.zone.gateAt) {
      if (RUN.zone.gateAt - here <= -40) { RUN.zone.gateAt = here + 70; RUN.zone.boosted = false; } // next throat
      const tp = trackPoint(RUN.zone.gateAt);
      if (tp) { wormhole.position.copy(tp.p); wormhole.quaternion.setFromUnitVectors(Z_AXIS, tp.d); }
    }
    wormhole.visible = wormhole.userData.u.uA.value > 0.01;
  } else wormhole.visible = false;
  // sand vortex ahead and below; the track dives towards it
  strudel.visible = strudel.userData.u.uA.value > 0.01;
  if (strudel.visible) {
    const sp = RUN.zone && RUN.zone.schlund ? trackPoint(RUN.zone.schlund + 4) : null; // the vortex sits in the maw
    if (sp) strudel.position.copy(sp.p).addScaledVector(WARP.uUp.value, -4);
    else strudel.position.copy(WARP.uAxisO.value).addScaledVector(seg.d, 42).addScaledVector(WARP.uUp.value, -5);
    strudel.quaternion.setFromUnitVectors(UP, WARP.uUp.value);
  }
  const wantShaft = bio.bg === 2 || zt === 'spirale' ? 1 : 0;
  const su = shaft.userData.u.uShow;
  su.value += (wantShaft - su.value) * (1 - Math.exp(-dt * 1.5));
  shaft.visible = su.value > 0.01;
  shaft.position.copy(seg.o).addScaledVector(seg.d, RUN.s);
  shaft.quaternion.copy(frameQuat(seg.d, Y));
  shaft.userData.u.uTravel.value = RUN.dist;
  deco.visible = true;
  deco.position.copy(shaft.position);
  deco.quaternion.copy(shaft.quaternion);
  decoU.uTravel.value = RUN.dist;
  const spK = clamp((RUN.speed - 8) / 11, 0, 1), dashK = RUN.dashT > 0 ? 1 : 0;
  decoU.uLen.value = 0.8 + spK * 2.5 + dashK * 5;
  decoU.uLineA.value = 0.12 + spK * 0.35 + dashK * 0.5;
  levelU.uDist.value = seg.start + RUN.s; // track position of the ball (cells carry the same measure)
  const hereT = seg.start + RUN.s;
  const upcoming = RUN.zonePlan.filter((z) => z.B > hereT - 20 && z.mode).slice(0, 2);
  levelU.uZones.value.forEach((v, i) => { const z = upcoming[i]; if (z) v.set(z.A, z.B, z.mode, 0); else v.set(0, 0, 0, 0); });
  let wi = 0;
  for (let si = RUN.si; si < Math.min(RUN.segs.length, RUN.si + 2) && wi < 6; si++) for (const w of RUN.segs[si].wells) {
    if (wi >= 6) break;
    if (si === RUN.si && w.k < RUN.s - 6) continue;
    levelU.uWells.value[wi++].set(w.pos.x, w.pos.y, w.pos.z, 1);
  }
  for (; wi < 6; wi++) levelU.uWells.value[wi].set(0, 0, 0, 0);
  levelU.uRise.value = Math.max(12, RUN.speed * 1.1);

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
    sg.crushers.forEach((cr) => {
      const h = crusherH(cr);
      const n = faceN(sg.d, cr.fi);
      cr.mesh.position.copy(faceCell(sg, cr.k, cr.fi, cr.lane)).addScaledVector(n, 0.5);
      cr.block.position.set(0, h + 0.5, 0);
      cr.rod.position.set(0, h + 1 + 3, 0);
    });
    sg.rings.forEach((rg) => { rg.spin.rotation.z = rg.ph + U.time.value * rg.w; });
    sg.flips.forEach((fl) => { fl.mesh.children[0].rotation.y = -U.time.value * 2; });
    sg.sweepers.forEach((sw) => {
      sw.x = sweeperX(sw);
      const n = faceN(sg.d, sw.fi);
      sw.mesh.position.copy(faceCell(sg, sw.k, sw.fi, 0)).addScaledVector(faceN(sg.d, sw.fi + 1), sw.x).addScaledVector(n, 1);
      sw.mesh.children[2].rotation.set(t * 3, t * 2, 0);
    });
    sg.lasers.forEach((lz) => { lz.mesh.children[1].material.opacity = 0.12 + 0.12 * Math.abs(Math.sin(t * 20)); });
    sg.items.forEach((it) => { it.mesh.rotation.set(t * 1.3, t * 2, 0); });
    sg.portals.forEach((p) => { p.mesh.rotateZ(dt * 0.8); });
  });

  hudTick += dt;
  if (hudTick > 0.1) {
    hudTick = 0;
    $('runDist').textContent = Math.floor(RUN.dist) + ' m';
    $('runShards').textContent = String(RUN.shards);
    $('focusBar').style.transform = `scaleX(${RUN.focus})`;
    $('dashBar').style.transform = `scaleX(${RUN.dash})`;
    const pw = RUN.flight > 0 ? ['flug', RUN.flight / 6] : RUN.sog > 0 ? ['sog', RUN.sog / 8] : RUN.shield ? ['schild', 1] : null;
    $('sogMeter').hidden = !pw;
    if (pw) { $('powLabel').textContent = pw[0]; $('sogBar').style.transform = `scaleX(${Math.min(1, pw[1])})`; }
    showFirstHints();
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
$('runPauseBtn').addEventListener('click', () => { if (G.mode === 'run') { G.mode = 'runpause'; setSlowmo(false); if (audio.ctx) audio.ctx.suspend(); showOverlay('pause'); } });
$('runAgainBtn').addEventListener('click', startRun);
$('runMenuBtn').addEventListener('click', () => showTitle());

/* ------------------------------------------------------------------ */
/* Camera + loop                                                       */
/* ------------------------------------------------------------------ */
const fx = { fovKick: 0, shake: 0, ca: 0, blur: 0, after: 0, flash: 0 };
function kick(ca = 0, blur = 0, flash = 0) {
  if (REDUCED) return;
  if (ca && post.mat.uniforms.uColor.value > 0.01) gsap.to(post.mat.uniforms.uHue, { value: '+=' + (ca * 5).toFixed(3), duration: 0.5, ease: 'expo.out' });
  if (ca) gsap.fromTo(fx, { ca }, { ca: 0, duration: 0.7, ease: 'expo.out', overwrite: false });
  if (blur) gsap.fromTo(fx, { blur }, { blur: 0, duration: 0.6, ease: 'power2.out', overwrite: false });
  if (flash) gsap.fromTo(fx, { flash }, { flash: 0, duration: 0.35, ease: 'power2.out', overwrite: false });
}
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
const _spin = new THREE.Vector3(), _axis = new THREE.Vector3(), _sq = new THREE.Quaternion(), _sv = new THREE.Vector3(), _c2 = new THREE.Vector3(), _c3 = new THREE.Vector3();

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
    ballQ.premultiply(_sq);
  }
  // velocity stretch (frame-local), times the cartoon impulse, volume preserved
  const inv = dt > 0 ? 1 / dt : 0;
  _sv.copy(_spin).multiplyScalar(inv);
  const fwd = _c2.set(0, 0, -1).applyQuaternion(vis.frame);
  const vn = Math.abs(_c3.subVectors(vis.pos, vis.prev).dot(up)) * inv;
  const vf = Math.abs(_sv.dot(fwd));
  const vl = Math.sqrt(Math.max(0, _sv.lengthSq() - vf * vf));
  let sx = squash.x * (1 + Math.min(vl / 40, 0.5)), sy = squash.y * (1 + Math.min(vn / 45, 0.4)), sz = squash.z * (1 + Math.min(vf / 90, 0.22));
  if (REDUCED) { sx = sy = sz = 1; }
  const vol = Math.cbrt(sx * sy * sz);
  vis.prev.copy(vis.pos);
  ballRig.position.copy(vis.pos);
  ballRig.quaternion.copy(vis.frame);
  ballRig.scale.set(sx / vol, sy / vol, sz / vol).multiplyScalar(Math.max(0.0001, vis.scale) * (G.mode === 'title' ? 0.0001 : 1));
  ball.quaternion.copy(vis.frame).invert().multiply(ballQ);
  orbitPivot.rotation.y += dt * 2.2;
  halo.position.copy(vis.pos);
  halo.material.opacity = vis.scale * (G.mode === 'title' ? 0 : 1);
  _a.copy(vis.pos).sub(bgRoot.position);
  if (RUN.zone && RUN.zone.type === 'senke' && RUN.segs[RUN.si]) _a.addScaledVector(RUN.segs[RUN.si].d, 32); // the well opens up ahead
  bgU.uWell.value.lerp(_a, 1 - Math.exp(-dt * 0.8));

  trailTimer += dt;
  if (trailTimer > 0.016) {
    trailTimer = 0;
    trailPos.copyWithin(3, 0, (TRAIL - 1) * 3);
    trailPos.set([vis.pos.x, vis.pos.y, vis.pos.z], 0);
    trailGeo.attributes.position.needsUpdate = true;
  }
  trail.visible = G.mode !== 'title';

  const inRun = G.mode === 'run' || G.mode === 'rundying' || G.mode === 'runover' || G.mode === 'runpause';
  levelU.uBeat.value = 0; // visuals stay steady; only the music follows the beat

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
    camera.fov = 66 + (RUN.speed - 8) * 0.9 - (1 - RUN.timeScale) * 10 + fx.fovKick;
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
  const inRunFx = G.mode === 'run' || G.mode === 'rundying';
  if (post.mat.uniforms.uColor.value > 0.001) post.mat.uniforms.uHue.value += dt * (0.035 + (inRunFx ? (1 - RUN.timeScale * RUN.moment) * 0.4 : 0));
  const speedK = inRunFx ? clamp((RUN.speed - 8) / 11, 0, 1) : 0;
  const slowK = inRunFx ? 1 - RUN.timeScale * RUN.moment : 0;
  renderFrame(
    (REDUCED ? 0 : 0.0018 + speedK * 0.004 + slowK * 0.012) + fx.ca,
    (REDUCED ? 0 : speedK * 0.45) + fx.blur,
    REDUCED ? 0 : Math.min(0.85, Math.max(fx.after, slowK * 0.85, post.mat.uniforms.uColor.value * 0.62)),
    fx.flash);

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
window.kippwelt = { __t: { runStep, runVisual, occ, stackAt, faceN, faceCell, crusherH, sweeperX, perim, U, GRAV, JUMP_V, PAD_V, turnRequired, manageSegs, laneShift, runJump, runDash, runPhase, runSlam, wallAhead, speedAt, kv, R }, vis, forceZone: (z) => { RUN.forceType = z; }, zoneAt, terrainAt, endZone, music, buffers, audio, G, LEVELS, doAction, startPlay, loadLevel, solve, RUN, startRun, runInput, RUNMAP, faceCell, kv };
