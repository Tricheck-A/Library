// Gestenwelten: six shader-driven worlds steered by touch gestures.
// Three.js renders, GSAP drives transitions and gesture-triggered tweens,
// Anime.js animates the DOM layer (touch rings, labels, gesture guide).
import * as THREE from 'three';
import { animate, createTimeline, stagger } from 'animejs';

const gsap = window.gsap;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = THREE.MathUtils.clamp;
const TAU = Math.PI * 2;

/* ------------------------------------------------------------------ */
/* Renderer                                                            */
/* ------------------------------------------------------------------ */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
let dpr = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(dpr);
renderer.setClearColor(0x000000, 1);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);
const shared = { time: { value: 0 }, px: { value: dpr } };
const fx = { fovKick: 0, shake: 0 };

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

/* ------------------------------------------------------------------ */
/* GLSL helpers                                                        */
/* ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------ */
/* World base                                                          */
/* ------------------------------------------------------------------ */
const ray = new THREE.Raycaster();
const _v2 = new THREE.Vector2();
const _v3 = new THREE.Vector3();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

function planeHit(ndc, y = 0) {
  _v2.set(ndc.x, ndc.y);
  ray.setFromCamera(_v2, camera);
  _plane.constant = -y;
  return ray.ray.intersectPlane(_plane, _v3) ? _v3.clone() : null;
}

function orbit(target, yaw, pitch, dist, roll, fov) {
  camera.position.set(
    target.x + Math.sin(yaw) * Math.cos(pitch) * dist,
    target.y + Math.sin(pitch) * dist,
    target.z + Math.cos(yaw) * Math.cos(pitch) * dist
  );
  camera.up.set(0, 1, 0);
  camera.lookAt(target);
  camera.rotateZ(roll);
  camera.fov = fov;
}

class World {
  constructor(meta) {
    Object.assign(this, meta);
    this.group = new THREE.Group();
    this.group.visible = false;
    this.mutTarget = 0;
    this.u = {
      uTime: shared.time,
      uPx: shared.px,
      uReveal: { value: 0 },
      uMut: { value: 0 },
      uHold: { value: new THREE.Vector4(0, 0, 0, 0) },
      uPulse: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, -100, 0)) },
    };
    this._pi = 0;
  }
  material(vs, fs, extra = {}, opts = {}) {
    return new THREE.ShaderMaterial({
      uniforms: { ...this.u, ...extra },
      vertexShader: GLSL + vs,
      fragmentShader: GLSL + fs,
      ...opts,
    });
  }
  addPulse(x, z, amp) {
    this.u.uPulse.value[this._pi++ % 4].set(x, z, shared.time.value, amp);
  }
  // Default ground interaction: raycast onto a horizontal plane.
  groundY() { return 0; }
  pulse(ndc, amp) {
    const h = planeHit(ndc, this.groundY());
    if (h) this.addPulse(h.x, h.z, amp);
  }
  holdStart(ndc) {
    const h = planeHit(ndc, this.groundY());
    if (h) this.u.uHold.value.set(h.x, h.z, this.u.uHold.value.z, 0);
    gsap.to(this.u.uHold.value, { z: 1, duration: 1.4, ease: 'power2.out', overwrite: 'auto' });
  }
  holdMove(ndc) {
    const h = planeHit(ndc, this.groundY());
    if (h) gsap.to(this.u.uHold.value, { x: h.x, y: h.z, duration: 0.4, ease: 'power2.out', overwrite: false });
  }
  holdEnd(ndc) {
    gsap.to(this.u.uHold.value, { z: 0, duration: 1.6, ease: 'elastic.out(1, 0.35)', overwrite: 'auto' });
    this.pulse(ndc, 2.2);
  }
  update() {}
  rig() {}
}

/* ------------------------------------------------------------------ */
/* 01 · WABE: hexagonal columns                                        */
/* ------------------------------------------------------------------ */
function hexPrismGeometry() {
  const pos = [], e = [];
  const V = (k) => [Math.cos((k * Math.PI) / 3), Math.sin((k * Math.PI) / 3)];
  for (let k = 0; k < 6; k++) {
    const [x0, z0] = V(k), [x1, z1] = V(k + 1);
    pos.push(0, 1, 0, x1, 1, z1, x0, 1, z0);            // cap
    e.push(0, 0, 1, 1, 0, 1, 1, 0, 1);
    pos.push(x0, 0, z0, x1, 1, z1, x1, 0, z1);          // side tri 1
    e.push(0, 0, 0, 1, 1, 0, 1, 0, 0);
    pos.push(x0, 0, z0, x0, 1, z0, x1, 1, z1);          // side tri 2
    e.push(0, 0, 0, 0, 1, 0, 1, 1, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aE', new THREE.Float32BufferAttribute(e, 3));
  return g;
}

class Hex extends World {
  constructor() {
    super({ name: 'wabe', sub: 'Sechseckfeld · Säulen steigen und fallen', muts: ['Hügel', 'Terrassen', 'Krater'] });
    this.u.uScroll = { value: 0 };
    const g = new THREE.InstancedBufferGeometry().copy(hexPrismGeometry());
    const cols = 46, rows = 54, sx = 1.5 * 1.04, sz = Math.sqrt(3) * 1.04;
    const off = [], seed = [];
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      off.push((i - cols / 2) * sx, (j - rows * 0.72) * sz + (i % 2 ? sz / 2 : 0));
      seed.push(Math.random());
    }
    g.setAttribute('aOff', new THREE.InstancedBufferAttribute(new Float32Array(off), 2));
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(seed), 1));
    g.instanceCount = cols * rows;
    const m = this.material(/* glsl */`
      attribute vec3 aE; attribute vec2 aOff; attribute float aSeed;
      uniform float uTime, uReveal, uMut, uScroll; uniform vec4 uPulse[4]; uniform vec4 uHold;
      varying vec3 vE; varying float vH, vY, vTop, vSeed, vFog, vRv;
      float heightAt(vec2 p){
        vec2 q = p + vec2(0.0, uScroll);
        float n = fbm(vec3(q * 0.07, uTime * 0.06));
        float hills = 0.3 + 8.0 * n * n;
        float terr = floor(hills * 1.2) / 1.2;
        float r = length(p - vec2(0.0, -10.0));
        float crater = -3.0 + r * 0.34 + 2.4 * vnoise(vec3(q * 0.16, uTime * 0.1));
        float m = uMut * 2.0;
        float h = m < 1.0 ? mix(hills, terr, ease3(m)) : mix(terr, crater, ease3(m - 1.0));
        for (int i = 0; i < 4; i++) {
          vec4 P = uPulse[i]; float age = uTime - P.z;
          if (age < 0.0 || age > 6.0) continue;
          float w = length(p - P.xy) - age * 11.0;
          h += P.w * 3.0 * exp(-w * w * 0.25) * exp(-age * 0.7);
        }
        float hd = length(p - uHold.xy);
        h -= uHold.z * 11.0 * exp(-hd * hd / 50.0);
        return h;
      }
      void main(){
        float h = heightAt(aOff);
        float rv = ease3(uReveal * 1.8 - length(aOff) / 70.0 * 0.8);
        h = mix(-20.0, h, rv);
        float bottom = h - 22.0;
        vec3 wp = vec3(aOff.x + position.x * 0.94, mix(bottom, h, position.y), aOff.y + position.z * 0.94);
        vE = aE; vH = h - bottom; vY = wp.y; vTop = h; vSeed = aSeed; vRv = rv;
        vec4 mv = modelViewMatrix * vec4(wp, 1.0);
        vFog = exp(-(-mv.z) * 0.03);
        gl_Position = projectionMatrix * mv;
      }`, /* glsl */`
      uniform float uTime;
      varying vec3 vE; varying float vH, vY, vTop, vSeed, vFog, vRv;
      void main(){
        float d = vE.z > 0.5 ? (1.0 - vE.x) * 0.866 * 0.94
                             : min(min(vE.x, 1.0 - vE.x) * 0.94, (1.0 - vE.y) * vH);
        float aa = fwidth(d);
        float line = 1.0 - smoothstep(0.03, 0.03 + aa * 1.5, d);
        float glow = exp(-d * 10.0) * 0.22;
        float vert = vE.z > 0.5 ? 1.0 : mix(0.08, 1.0, smoothstep(vTop - 13.0, vTop, vY));
        float hi = 0.5 + 0.5 * step(0.955, fract(vSeed * 7.13 + floor(uTime * 0.6) * 0.317));
        float c = (line + glow) * hi * vert * vFog * vRv;
        gl_FragColor = vec4(vec3(c) * vec3(0.95, 0.96, 1.0), 1.0);
      }`);
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.target = new THREE.Vector3(0, 0, -8);
  }
  groundY() { return 2; }
  update(dt, I) { this.u.uScroll.value -= dt * (1.6 + Math.max(0, I.zoomS) * 2.5); }
  rig(I) {
    orbit(this.target, I.lookS.x * 1.1, clamp(0.42 + I.lookS.y * 0.45, 0.06, 1.35),
      clamp(30 - I.zoomS * 12, 7, 48), I.twistS * 0.6, 58);
  }
}

/* ------------------------------------------------------------------ */
/* 02 · SOG: tiled tunnel twisting into black                          */
/* ------------------------------------------------------------------ */
class Vortex extends World {
  constructor() {
    super({ name: 'sog', sub: 'Kacheltunnel · dreht sich ins Schwarze', muts: ['Röhre', 'Kissen', 'Kasten'] });
    this.mutTarget = 0.5;
    this.u.uMut.value = 0.5;
    this.u.uTravel = { value: 0 };
    this.u.uTwist = { value: 0.6 };
    this.u.uSpin = { value: 0 };
    this.u.uBurst = { value: [0, 1, 2].map(() => new THREE.Vector4(0, -100, 0, 0)) };
    this._bi = 0;
    const NA = 56, NS = 72;
    const g = new THREE.InstancedBufferGeometry().copy(new THREE.BoxGeometry(1, 1, 1));
    const p = [], seed = [], shade = [];
    const tones = [0.74, 0.82, 0.9, 0.97];
    for (let i = 0; i < NA; i++) for (let j = 0; j < NS; j++) {
      p.push(i / NA, j / NS);
      seed.push(Math.random());
      shade.push(tones[(Math.random() * tones.length) | 0]);
    }
    g.setAttribute('aP', new THREE.InstancedBufferAttribute(new Float32Array(p), 2));
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(seed), 1));
    g.setAttribute('aShade', new THREE.InstancedBufferAttribute(new Float32Array(shade), 1));
    g.instanceCount = NA * NS;
    const m = this.material(/* glsl */`
      attribute vec2 aP; attribute float aSeed; attribute float aShade;
      uniform float uTime, uReveal, uMut, uTravel, uTwist, uSpin; uniform vec4 uBurst[3]; uniform vec4 uHold;
      varying vec2 vUv; varying float vShade, vDark, vLight;
      const float NA = 56.0; const float NS = 72.0;
      vec3 surf(float a, float s){
        float r = (0.55 + 10.0 * exp(-s * 2.4)) * (1.0 - uHold.z * 0.3 * ease3(s));
        float th = a * 6.2831853 + uSpin + uTwist * s * 4.0;
        float n = mix(2.0, 7.0, uMut);
        float c = cos(th), sn = sin(th);
        float k = pow(pow(abs(c), n) + pow(abs(sn), n), -1.0 / n);
        float z = 3.0 - 7.85 * (0.55 * s + 10.0 / 2.4 * (1.0 - exp(-s * 2.4)));
        return vec3(c * k * r, sn * k * r, z);
      }
      void main(){
        float s = fract(aP.y + uTravel) * 1.12 - 0.12;
        float a = aP.x;
        float da = 0.5 / NA, ds = 0.56 / NS;
        vec3 C = surf(a, s);
        vec3 Ta = surf(a + da, s) - surf(a - da, s);
        vec3 Ds = surf(a, s + ds) - surf(a, s - ds);
        float w = length(Ta) * 0.93, l = length(Ds) * 0.93;
        vec3 T = normalize(Ta), D = normalize(Ds);
        vec3 N = normalize(cross(T, D));
        if (dot(N, -vec3(C.xy, 0.0)) < 0.0) N = -N;
        float loose = step(aSeed, 0.03 + uHold.z * 0.16);
        float burst = 0.0;
        for (int i = 0; i < 3; i++) {
          vec4 B = uBurst[i]; float age = uTime - B.y;
          if (age < 0.0 || age > 5.0) continue;
          float ad = abs(fract(a - B.x + 0.5) - 0.5);
          burst += B.z * exp(-ad * ad * 70.0) * step(aSeed, 0.6) * smoothstep(0.0, 0.35, age) * exp(-age * 0.55);
        }
        float det = clamp(loose + burst, 0.0, 1.0);
        float rr = length(C.xy);
        float lift = det * rr * (0.32 + 0.22 * sin(uTime * 1.3 + aSeed * 40.0));
        float th = min(w, l) * (0.28 + det * 0.9);
        float ang = det * (uTime * 2.0 + aSeed * 20.0);
        vec3 p = position; vec3 nl = normal;
        p.xz = rot2(ang) * p.xz; nl.xz = rot2(ang) * nl.xz;
        p.yz = rot2(ang * 0.7) * p.yz; nl.yz = rot2(ang * 0.7) * nl.yz;
        float rv = ease3(uReveal * 1.6 - aSeed * 0.6);
        vec3 wp = C + T * p.x * w + D * p.y * l + N * ((p.z + 0.5) * th + lift);
        wp.xy *= mix(2.8, 1.0, rv);
        vec3 nw = normalize(T * nl.x + D * nl.y + N * nl.z);
        float depthF = 1.0 - smoothstep(0.3, 1.0, s);
        vShade = aShade; vUv = uv;
        vDark = depthF * depthF * rv;
        vLight = 0.5 + 0.5 * abs(dot(nw, normalize(vec3(0.25, 0.45, 1.0))));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(wp, 1.0);
      }`, /* glsl */`
      varying vec2 vUv; varying float vShade, vDark, vLight;
      void main(){
        float e = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
        float aa = fwidth(e);
        float line = 1.0 - smoothstep(0.045, 0.045 + aa * 1.5, e);
        float c = mix(vShade * vLight, 0.05, line);
        gl_FragColor = vec4(vec3(c * vDark), 1.0);
      }`);
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }
  angleFromNdc(ndc) {
    const th = Math.atan2(ndc.y, ndc.x * camera.aspect);
    const a = (th - this.u.uSpin.value - this.u.uTwist.value * 4 * 0.3) / TAU;
    return a - Math.floor(a);
  }
  pulse(ndc, amp) {
    this.u.uBurst.value[this._bi++ % 3].set(this.angleFromNdc(ndc), shared.time.value, Math.min(1, amp * 0.6), 0);
  }
  holdStart() { gsap.to(this.u.uHold.value, { z: 1, duration: 1.2, ease: 'power2.out', overwrite: 'auto' }); }
  holdMove() {}
  holdEnd(ndc) {
    gsap.to(this.u.uHold.value, { z: 0, duration: 1.8, ease: 'elastic.out(1, 0.3)', overwrite: 'auto' });
    this.pulse(ndc, 2);
  }
  update(dt, I) {
    const hold = this.u.uHold.value.z;
    this.u.uTravel.value += dt * 0.03 * Math.max(0.15, 1 + I.zoomS * 1.4 + hold * 2.5);
    this.u.uSpin.value += dt * (0.12 + hold * 1.4);
    this.u.uTwist.value = 0.6 + I.twistS * 0.9;
  }
  rig(I) {
    const lx = Math.tanh(I.lookS.x), ly = Math.tanh(I.lookS.y);
    camera.position.set(lx * 2.6, -ly * 2.6, 0);
    camera.up.set(0, 1, 0);
    camera.lookAt(-lx * 1.5, ly * 1.5, -30);
    camera.fov = 64;
  }
}

/* ------------------------------------------------------------------ */
/* 03 · SENKE: point grid falling into a gravity well                  */
/* ------------------------------------------------------------------ */
class Well extends World {
  constructor() {
    super({ name: 'senke', sub: 'Punktgitter · Gravitationstrichter', muts: ['Einzeltrichter', 'Verschmelzung', 'Doppeltrichter'] });
    this.u.uSwirl = { value: 0 };
    const pos = [], seed = [], kind = [];
    const E = 40, gap = 1.6, step = 0.16;
    for (let li = -E; li <= E + 1e-6; li += gap) {
      for (let t = -E; t <= E; t += step) {
        const j = (Math.random() - 0.5) * 0.08, k = (Math.random() - 0.5) * 0.06;
        pos.push(t + k, 0, li + j); seed.push(Math.random()); kind.push(0);
        pos.push(li + j, 0, t + k); seed.push(Math.random()); kind.push(0);
      }
    }
    for (let i = 0; i < 12000; i++) {
      pos.push((Math.random() - 0.5) * 2 * E, 0, (Math.random() - 0.5) * 2 * E);
      seed.push(Math.random()); kind.push(1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
    const m = this.material(/* glsl */`
      attribute float aSeed; attribute float aKind;
      uniform float uTime, uReveal, uMut, uSwirl, uPx; uniform vec4 uPulse[4]; uniform vec4 uHold;
      varying float vA;
      float well(vec2 p, vec2 c, float H, float r0){ float r = length(p - c); return -H / (1.0 + pow(r / r0, 2.4)); }
      void main(){
        vec2 p = position.xz;
        float r = length(p);
        float sw = (uSwirl + 0.35 * sin(uTime * 0.25)) * 16.0 / (r + 3.0);
        p = rot2(sw) * p;
        float m = ease3(uMut);
        float ang = uTime * 0.4;
        vec2 c1 = vec2(cos(ang), sin(ang)) * m * 9.0;
        float y = mix(well(p, vec2(0.0), 26.0, 5.5), well(p, c1, 17.0, 3.6) + well(p, -c1, 17.0, 3.6), m);
        y += well(p, uHold.xy, 20.0 * uHold.z, 3.2);
        for (int i = 0; i < 4; i++) {
          vec4 P = uPulse[i]; float age = uTime - P.z;
          if (age < 0.0 || age > 7.0) continue;
          float w = length(p - P.xy) - age * 12.0;
          y += P.w * 1.8 * sin(w * 0.9) * exp(-w * w * 0.04) * exp(-age * 0.5);
        }
        float h1 = hash11(aSeed * 113.0), h2 = hash11(aSeed * 57.0 + 1.3);
        if (aKind > 0.5) y += (h1 - 0.5) * 10.0 + sin(uTime * 0.4 + h2 * 30.0) * 0.6;
        float rv = ease3(uReveal * 1.7 - h2 * 0.7);
        vec3 wp = vec3(p.x, y + (1.0 - rv) * (18.0 + h1 * 30.0), p.y);
        vec4 mv = modelViewMatrix * vec4(wp, 1.0);
        float depth = max(-mv.z, 0.5);
        gl_PointSize = min(3.0 * uPx * (0.5 + h1 * 0.9) * (28.0 / depth), 22.0 * uPx);
        float tw = 0.35 + 0.65 * step(0.45, fract(h2 * 17.0 + uTime * (0.6 + h1)));
        float edge = smoothstep(40.0, 30.0, length(position.xz));
        vA = tw * rv * edge * exp(-depth * 0.012) * (aKind > 0.5 ? 0.55 : 1.0);
        gl_Position = projectionMatrix * mv;
      }`, /* glsl */`
      varying float vA;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        gl_FragColor = vec4(vec3(1.0), smoothstep(0.5, 0.12, d) * vA);
      }`, {}, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    this.group.add(pts);
    this.target = new THREE.Vector3(0, -6, 0);
  }
  update(dt, I) { this.u.uSwirl.value = I.twistS * 0.8; }
  rig(I) {
    orbit(this.target, I.lookS.x * 1.4, clamp(0.85 + I.lookS.y * 0.45, 0.12, 1.5),
      clamp(44 - I.zoomS * 18, 5, 72), 0, 55);
  }
}

/* ------------------------------------------------------------------ */
/* 04 · WÜRFEL: isometric patterned cubes                              */
/* ------------------------------------------------------------------ */
const CUBE_FS = /* glsl */`
  varying vec2 vUv; varying vec3 vN; varying float vB;
  float ring(float d, float r){ float aa = fwidth(d); return 1.0 - smoothstep(0.008, 0.008 + aa * 1.3, abs(d - r)); }
  void main(){
    float ex = min(vUv.x, 1.0 - vUv.x), ey = min(vUv.y, 1.0 - vUv.y);
    float e = min(ex, ey);
    float along = ex < ey ? vUv.y : vUv.x;
    float aa = fwidth(e);
    float edge = (1.0 - smoothstep(0.03, 0.03 + aa * 1.4, e)) * step(0.42, fract(along * 9.0 + 0.21));
    float d = max(abs(vUv.x - 0.5), abs(vUv.y - 0.5));
    float pat; float f;
    if (abs(vN.y) > 0.5) { pat = ring(d, 0.30) + ring(d, 0.17); f = 1.0; }
    else if (abs(vN.x) > 0.5) { pat = ring(d, 0.34) + ring(d, 0.24) + ring(d, 0.14); f = 0.88; }
    else { pat = ring(d, 0.2); f = 0.74; }
    float c = clamp(max(edge, pat), 0.0, 1.0) * f * vB;
    gl_FragColor = vec4(vec3(c), 1.0);
  }`;
const FREE_PATH = /* glsl */`
  vec3 freePath(float id, float t){
    float a = hash11(id * 3.1) * 6.28, b = hash11(id * 7.7) * 6.28;
    float sp = 0.16 + 0.14 * hash11(id * 1.3);
    return vec3(sin(t * sp + a) * 8.0, 4.2 + 1.4 * sin(t * sp * 1.7 + b), cos(t * sp * 0.8 + b) * 8.0);
  }`;

class Iso extends World {
  constructor() {
    super({ name: 'würfel', sub: 'Isometrie · Blöcke lösen sich und taumeln', muts: ['flach', 'Stufen', 'Türme'] });
    this.mutTarget = 0.5;
    this.u.uMut.value = 0.5;
    const N = 34, L = 4;
    const g = new THREE.InstancedBufferGeometry().copy(new THREE.BoxGeometry(1, 1, 1));
    const cell = [], seed = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) for (let l = 0; l < L; l++) {
      cell.push(i - N / 2 + 0.5, j - N / 2 + 0.5, l); seed.push(Math.random());
    }
    g.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(cell), 3));
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(seed), 1));
    g.instanceCount = N * N * L;
    const m = this.material(/* glsl */`
      attribute vec3 aCell; attribute float aSeed;
      uniform float uTime, uReveal, uMut; uniform vec4 uPulse[4]; uniform vec4 uHold;
      varying vec2 vUv; varying vec3 vN; varying float vB;
      void main(){
        vec2 c = aCell.xy; float lv = aCell.z;
        float amp = 1.4 + uMut * 3.4;
        float h = amp * fbm(vec3(c * 0.11, uTime * 0.035 + uMut * 1.7)) + 0.35 - uMut * 0.4;
        float sc = ease3(h - lv);
        if (lv < 0.5) sc = 1.0;
        float lift = 0.0;
        for (int i = 0; i < 4; i++) {
          vec4 P = uPulse[i]; float age = uTime - P.z;
          if (age < 0.0 || age > 5.0) continue;
          float w = length(c - P.xy) - age * 9.0;
          lift += P.w * 1.3 * exp(-w * w * 0.5) * exp(-age * 0.9);
        }
        float hd = length(c - uHold.xy);
        float hv = uHold.z * exp(-hd * hd / 9.0) * step(0.5, sc);
        lift += hv * (1.5 + lv * 1.1 + aSeed * 2.0);
        float ang = hv * (uTime * 1.6 + aSeed * 6.28);
        vec3 p = position; vec3 n = normal;
        p.xz = rot2(ang) * p.xz; p.xy = rot2(ang * 0.6) * p.xy;
        float rv = ease3(uReveal * 1.7 - (aSeed * 0.4 + length(c) / 40.0) * 0.8);
        vec3 wp = vec3(c.x + p.x * sc, lv + (p.y + 0.5) * sc + lift + (1.0 - rv) * 16.0, c.y + p.z * sc);
        vUv = uv; vN = n;
        vB = rv * smoothstep(17.0, 13.0, max(abs(c.x), abs(c.y))) * step(0.02, sc);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(wp, 1.0);
      }`, CUBE_FS);
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    this.group.add(mesh);

    // tumbling free cubes
    const FREE = 12;
    const fg = new THREE.InstancedBufferGeometry().copy(new THREE.BoxGeometry(1, 1, 1));
    fg.setAttribute('aId', new THREE.InstancedBufferAttribute(new Float32Array([...Array(FREE).keys()]), 1));
    fg.instanceCount = FREE;
    const fm = this.material(FREE_PATH + /* glsl */`
      attribute float aId; uniform float uTime, uReveal;
      varying vec2 vUv; varying vec3 vN; varying float vB;
      void main(){
        vec3 c = freePath(aId, uTime);
        vec3 p = position;
        float a = uTime * (0.6 + hash11(aId * 9.1)) + aId;
        p.xy = rot2(a) * p.xy; p.yz = rot2(a * 0.7) * p.yz; p.xz = rot2(a * 0.4) * p.xz;
        vUv = uv; vN = normal; vB = ease3(uReveal * 1.5 - 0.5);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(c + p * 0.95, 1.0);
      }`, CUBE_FS);
    const free = new THREE.Mesh(fg, fm);
    free.frustumCulled = false;
    this.group.add(free);

    // particle trails behind free cubes
    const tp = [], tk = [], ts = [];
    for (let i = 0; i < FREE; i++) for (let k = 0; k < 90; k++) { tp.push(0, 0, 0); tk.push(i, k / 90); ts.push(Math.random()); }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
    tg.setAttribute('aK', new THREE.Float32BufferAttribute(tk, 2));
    tg.setAttribute('aSeed', new THREE.Float32BufferAttribute(ts, 1));
    const tm = this.material(FREE_PATH + /* glsl */`
      attribute vec2 aK; attribute float aSeed; uniform float uTime, uReveal, uPx;
      varying float vA;
      void main(){
        float k = aK.y;
        vec3 c = freePath(aK.x, uTime - k * 3.0);
        vec3 j = vec3(hash11(aSeed * 11.0), hash11(aSeed * 23.0), hash11(aSeed * 37.0)) - 0.5;
        c += j * (0.4 + k * 1.6);
        vA = (1.0 - k) * ease3(uReveal * 1.5 - 0.5);
        gl_PointSize = (1.0 + 2.2 * (1.0 - k)) * uPx;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(c, 1.0);
      }`, /* glsl */`
      varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(1.0), smoothstep(0.5, 0.1, d) * vA); }`,
    {}, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const trails = new THREE.Points(tg, tm);
    trails.frustumCulled = false;
    this.group.add(trails);
    this.target = new THREE.Vector3();
  }
  groundY() { return 1.5; }
  update(dt, I) {
    const t = shared.time.value;
    this.target.set(Math.sin(t * 0.05) * 2.5, 1, Math.cos(t * 0.04) * 2.5);
  }
  rig(I) {
    const dist = 160;
    const visible = clamp(6.5 - I.zoomS * 3, 3, 20);       // world units on the short screen side
    const vert = camera.aspect < 1 ? visible / camera.aspect : visible;
    const fov = THREE.MathUtils.radToDeg(2 * Math.atan(vert / 2 / dist));
    orbit(this.target, Math.PI / 4 + I.lookS.x * 0.9 + I.twistS * 0.5,
      clamp(0.6155 + I.lookS.y * 0.35, 0.15, 1.3), dist, 0, fov);
  }
}

/* ------------------------------------------------------------------ */
/* 05 · SCHACHT: wireframe corridor with cubes growing from the walls  */
/* ------------------------------------------------------------------ */
const LEN = 90.0;
const TUNNEL = /* glsl */`
  uniform float uTravel, uW, uRoll, uMut;
  float wrapZ(float z0, float speed){ return mod(z0 + uTravel * speed, ${LEN.toFixed(1)}) - ${LEN.toFixed(1)} + 8.0; }
  vec3 warp(vec3 p){ p.xy = rot2(uMut * p.z * 0.045) * p.xy; return p; }
`;
class Corridor extends World {
  constructor() {
    super({ name: 'schacht', sub: 'Drahtkorridor · Flug durch den Schacht', muts: ['gerade', 'gedreht', 'Spirale'] });
    Object.assign(this.u, { uTravel: { value: 0 }, uW: { value: 6 }, uRoll: { value: 0 } });
    this.u.uPulseZ = { value: [0, 1, 2].map(() => -100) };
    this._zi = 0;
    // --- grid lines: rings (wrap) + longitudinals (static, subdivided so they can twist)
    const lp = [], lw = [];
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let z = 0; z < LEN; z += 1) {
      for (let c = 0; c < 4; c++) {
        const a = corners[c], b = corners[(c + 1) % 4];
        lp.push(a[0], a[1], -z, b[0], b[1], -z); lw.push(1, 1);
      }
    }
    const per = 12;
    for (let wall = 0; wall < 4; wall++) for (let i = 0; i <= per; i++) {
      const t = -1 + (2 * i) / per;
      const xy = [[t, -1], [1, t], [t, 1], [-1, t]][wall];
      for (let z = 8; z > -LEN + 8; z -= 2) { lp.push(xy[0], xy[1], z, xy[0], xy[1], z - 2); lw.push(0, 0); }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    lg.setAttribute('aWrap', new THREE.Float32BufferAttribute(lw, 1));
    const lm = this.material(TUNNEL + /* glsl */`
      attribute float aWrap; uniform float uTime, uReveal;
      varying float vA;
      void main(){
        float z = aWrap > 0.5 ? wrapZ(position.z, 1.0) : position.z;
        vec3 p = warp(vec3(position.xy * uW, z));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float far = smoothstep(-${LEN.toFixed(1)} + 8.0, -${LEN.toFixed(1)} + 30.0, z);
        vA = exp(-(-mv.z) * 0.035) * far * ease3(uReveal * 1.4 - (-z / ${LEN.toFixed(1)}) * 0.6) * (aWrap > 0.5 ? 0.9 : 0.55);
        gl_Position = projectionMatrix * mv;
      }`, /* glsl */`
      varying float vA;
      void main(){ gl_FragColor = vec4(vec3(1.0), vA); }`,
    {}, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const lines = new THREE.LineSegments(lg, lm);
    lines.frustumCulled = false;
    this.group.add(lines);

    // --- cubes on the walls
    const cell = [], seed = [];
    for (let i = 0; i < 190; i++) {
      const wall = (Math.random() * 4) | 0;
      const u = Math.floor(Math.random() * 12) - 5.5;
      cell.push(wall, u / 6, -Math.floor(Math.random() * LEN));
      seed.push(Math.random());
    }
    const cg = new THREE.InstancedBufferGeometry().copy(new THREE.BoxGeometry(1, 1, 1));
    cg.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(cell), 3));
    cg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(seed), 1));
    cg.instanceCount = cell.length / 3;
    const cm = this.material(TUNNEL + /* glsl */`
      attribute vec3 aCell; attribute float aSeed;
      uniform float uTime, uReveal; uniform float uPulseZ[3];
      varying vec2 vUv; varying float vA;
      void main(){
        float wall = aCell.x; float u = aCell.y;
        float z = wrapZ(aCell.z, 1.0);
        vec3 base, tang, nrm;
        if (wall < 0.5)      { base = vec3(u * uW, -uW, z); tang = vec3(1,0,0); nrm = vec3(0,1,0); }
        else if (wall < 1.5) { base = vec3(uW, u * uW, z);  tang = vec3(0,1,0); nrm = vec3(-1,0,0); }
        else if (wall < 2.5) { base = vec3(u * uW, uW, z);  tang = vec3(1,0,0); nrm = vec3(0,-1,0); }
        else                 { base = vec3(-uW, u * uW, z); tang = vec3(0,1,0); nrm = vec3(1,0,0); }
        float len = 0.6 + aSeed * aSeed * (1.2 + uMut * 2.5);
        for (int i = 0; i < 3; i++) {
          float age = uTime - uPulseZ[i];
          if (age < 0.0 || age > 4.0) continue;
          float wz = (z + age * 28.0) / 5.0;
          len += 3.0 * exp(-wz * wz) * exp(-age * 0.5);
        }
        float cs = uW / 6.0 * 0.92;
        vec3 p = base + tang * position.x * cs + nrm * (position.y + 0.5) * len + vec3(0,0,1) * position.z * cs;
        p = warp(p);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float far = smoothstep(-${LEN.toFixed(1)} + 8.0, -${LEN.toFixed(1)} + 30.0, z);
        vA = exp(-(-mv.z) * 0.03) * far * ease3(uReveal * 1.5 - aSeed * 0.5);
        vUv = uv;
        gl_Position = projectionMatrix * mv;
      }`, /* glsl */`
      varying vec2 vUv; varying float vA;
      void main(){
        float e = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
        float aa = fwidth(e);
        float edge = 1.0 - smoothstep(0.035, 0.035 + aa * 1.5, e);
        vec2 g = fract(vUv * 5.0) - 0.5;
        float dots = 1.0 - smoothstep(0.12, 0.12 + fwidth(g.x) * 2.0, length(g));
        float c = max(edge, dots * 0.75);
        gl_FragColor = vec4(vec3(c * vA), 1.0);
      }`);
    const cubes = new THREE.Mesh(cg, cm);
    cubes.frustumCulled = false;
    this.group.add(cubes);

    // --- stars outside the shaft
    const sp = [], ss = [];
    for (let i = 0; i < 2600; i++) {
      let x, y;
      do { x = (Math.random() - 0.5) * 70; y = (Math.random() - 0.5) * 70; } while (Math.abs(x) < 7 && Math.abs(y) < 7);
      sp.push(x, y, -Math.random() * LEN); ss.push(Math.random());
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    sg.setAttribute('aSeed', new THREE.Float32BufferAttribute(ss, 1));
    const sm = this.material(TUNNEL + /* glsl */`
      attribute float aSeed; uniform float uTime, uReveal, uPx;
      varying float vA;
      void main(){
        float z = wrapZ(position.z, 0.55);
        vec4 mv = modelViewMatrix * vec4(warp(vec3(position.xy, z)), 1.0);
        gl_PointSize = (1.0 + aSeed * 2.4) * uPx;
        vA = (0.3 + 0.7 * step(0.5, fract(aSeed * 31.0 + uTime * aSeed))) * exp(-(-mv.z) * 0.02) * ease3(uReveal * 1.3 - aSeed * 0.3);
        gl_Position = projectionMatrix * mv;
      }`, /* glsl */`
      varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(1.0), smoothstep(0.5, 0.1, d) * vA); }`,
    {}, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const stars = new THREE.Points(sg, sm);
    stars.frustumCulled = false;
    this.group.add(stars);
  }
  pulse() { this.u.uPulseZ.value[this._zi++ % 3] = shared.time.value; }
  holdStart() {
    gsap.to(this.u.uW, { value: 3.4, duration: 1.4, ease: 'power3.out', overwrite: 'auto' });
    gsap.to(this.u.uHold.value, { z: 1, duration: 1.2, overwrite: 'auto' });
  }
  holdMove() {}
  holdEnd() {
    gsap.to(this.u.uW, { value: 6, duration: 1.8, ease: 'elastic.out(1, 0.35)', overwrite: 'auto' });
    gsap.to(this.u.uHold.value, { z: 0, duration: 1, overwrite: 'auto' });
    this.pulse();
  }
  update(dt, I) {
    const speed = Math.max(1.2, 7 + I.zoomS * 12 + this.u.uHold.value.z * 26);
    this.u.uTravel.value += dt * speed;
    this.speedNorm = speed;
  }
  rig(I) {
    const lx = Math.tanh(I.lookS.x), ly = Math.tanh(I.lookS.y);
    camera.position.set(-lx * 2, ly * 2, 6);
    camera.up.set(0, 1, 0);
    camera.lookAt(-lx * 9, ly * 9, -30);
    camera.rotateZ(I.twistS);
    camera.fov = 66 + clamp((this.speedNorm || 7) - 7, 0, 30) * 0.5;
  }
}

/* ------------------------------------------------------------------ */
/* 06 · FLUSS: field lines through a throat (catenoid ↔ helicoid)     */
/* ------------------------------------------------------------------ */
class Throat extends World {
  constructor() {
    super({ name: 'fluss', sub: 'Feldlinien · Kehle zwischen zwei Ebenen', muts: ['Katenoid', 'Übergang', 'Helikoid'] });
    Object.assign(this.u, { uTwist: { value: 0.9 }, uR0: { value: 1.6 } });
    const NU = 150, NV = 220, V = 3.6;
    const pos = [], uvA = [], idx = [];
    for (let i = 0; i < NU; i++) {
      const s = Math.random();
      for (let j = 0; j < NV; j++) {
        const t = -1 + (2 * j) / (NV - 1);
        pos.push(0, 0, 0);
        uvA.push((i / NU) * TAU, t, s);
        if (j < NV - 1) idx.push(i * NV + j, i * NV + j + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aUV', new THREE.Float32BufferAttribute(uvA, 3));
    g.setIndex(idx);
    const m = this.material(/* glsl */`
      attribute vec3 aUV;
      uniform float uTime, uReveal, uMut, uTwist, uR0; uniform vec4 uPulse[4]; uniform vec4 uHold;
      varying float vA;
      void main(){
        float v = aUV.y * ${V.toFixed(1)};
        float a = uMut * 1.5707963;
        float u = aUV.x + uTwist * tanh(v * 1.2) + uTime * 0.05;
        float ch = cosh(v), sh = sinh(v);
        vec3 p = vec3(
          cos(a) * ch * cos(u) + sin(a) * sh * sin(u),
          cos(a) * v + sin(a) * (u - 3.14159),
          cos(a) * ch * sin(u) - sin(a) * sh * cos(u)) * uR0;
        float flow = pow(fract(aUV.y * 5.0 - uTime * 0.35 + aUV.z), 14.0);
        float throat = exp(-v * v * 1.2);
        float pulse = 0.0;
        for (int i = 0; i < 4; i++) {
          float age = uTime - uPulse[i].z;
          if (age < 0.0 || age > 5.0) continue;
          float w = abs(v) - age * 2.2;
          pulse += uPulse[i].w * exp(-w * w * 6.0) * exp(-age * 0.4);
        }
        float rv = ease3(uReveal * 1.6 - abs(aUV.y) * 0.6);
        vA = (0.32 + flow * 1.4 + throat * 0.35 + pulse) * smoothstep(1.0, 0.72, abs(aUV.y)) * rv;
        p *= mix(0.2, 1.0, rv);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`, /* glsl */`
      varying float vA;
      void main(){ gl_FragColor = vec4(vec3(1.0), clamp(vA, 0.0, 1.0)); }`,
    {}, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const lines = new THREE.LineSegments(g, m);
    lines.frustumCulled = false;
    this.group.add(lines);
    this.target = new THREE.Vector3();
  }
  pulse(ndc, amp) { this.addPulse(0, 0, Math.min(1.6, amp * 0.8)); }
  holdStart() {
    gsap.to(this.u.uR0, { value: 0.55, duration: 1.4, ease: 'power3.out', overwrite: 'auto' });
    gsap.to(this.u.uHold.value, { z: 1, duration: 1.4, overwrite: 'auto' });
  }
  holdMove() {}
  holdEnd(ndc) {
    gsap.to(this.u.uR0, { value: 1.6, duration: 2.2, ease: 'elastic.out(1, 0.3)', overwrite: 'auto' });
    gsap.to(this.u.uHold.value, { z: 0, duration: 1, overwrite: 'auto' });
    this.pulse(ndc, 2);
  }
  update(dt, I) { this.u.uTwist.value = 0.9 + I.twistS * 1.2 + this.u.uHold.value.z * 2.5; }
  rig(I) {
    orbit(this.target, I.lookS.x * 1.3, clamp(0.12 + I.lookS.y * 0.6, -1.2, 1.35),
      clamp(24 - I.zoomS * 9, 3, 50), 0, 58);
  }
}

/* ------------------------------------------------------------------ */
/* World manager                                                       */
/* ------------------------------------------------------------------ */
const worlds = [new Hex(), new Vortex(), new Well(), new Iso(), new Corridor(), new Throat()];
worlds.forEach((w) => scene.add(w.group));
let cur = 0;
let busy = false;
worlds[0].group.visible = true;

const I = { look: { x: 0, y: 0 }, lookS: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, zoom: 0, zoomS: 0, twist: 0, twistS: 0 };

/* ---------- HUD ---------- */
const $ = (id) => document.getElementById(id);
const dotsEl = $('dots');
worlds.forEach((w, i) => {
  const b = document.createElement('button');
  b.className = 'dot'; b.type = 'button';
  b.setAttribute('aria-label', `Welt ${i + 1}: ${w.name}`);
  b.innerHTML = '<i></i>';
  b.addEventListener('click', () => goTo(i, i > cur ? 1 : -1));
  dotsEl.append(b);
});

function splitLetters(el, text) {
  el.innerHTML = [...text].map((ch) => `<span>${ch === ' ' ? '&nbsp;' : ch}</span>`).join('');
  return el.querySelectorAll('span');
}

function updateHud(animateIn = true) {
  const w = worlds[cur];
  $('wIdx').textContent = String(cur + 1).padStart(2, '0');
  const letters = splitLetters($('wName'), w.name);
  $('wSub').textContent = w.sub;
  [...dotsEl.children].forEach((d, i) => d.setAttribute('aria-current', i === cur ? 'true' : 'false'));
  updateMutHud();
  if (animateIn && !REDUCED) {
    animate(letters, { opacity: [0, 1], translateY: ['0.5em', 0], rotateX: [80, 0], delay: stagger(45), duration: 700, ease: 'outExpo' });
    animate('#wSub', { opacity: [0, 1], translateX: [-12, 0], duration: 700, delay: 200, ease: 'outExpo' });
  }
}
function updateMutHud() {
  const w = worlds[cur];
  const step = Math.round(w.mutTarget * 2);
  $('mutLabel').textContent = w.muts[step];
  [...$('mutSteps').children].forEach((el, i) => el.classList.toggle('on', i === step));
}

let toastTimer = null;
function toast(text) {
  const el = $('toast');
  const letters = splitLetters(el, text);
  clearTimeout(toastTimer);
  animate(letters, { opacity: [0, 1], translateY: [10, 0], delay: stagger(16), duration: 420, ease: 'outExpo' });
  toastTimer = setTimeout(() => animate(el.querySelectorAll('span'), { opacity: 0, translateY: -8, delay: stagger(10), duration: 300, ease: 'inQuad' }), 1300);
}

/* ---------- transitions ---------- */
function wipe(dir) {
  const from = dir > 0 ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)';
  const to = dir > 0 ? 'inset(0 100% 0 0)' : 'inset(0 0 0 100%)';
  gsap.timeline()
    .set('#wipe', { clipPath: from })
    .to('#wipe', { clipPath: 'inset(0 0% 0 0%)', duration: 0.45, ease: 'power3.in' })
    .to('#wipe', { clipPath: to, duration: 0.6, ease: 'power3.out' });
}

function goTo(i, dir = 1) {
  if (busy || i === cur) return;
  busy = true;
  const from = worlds[cur], to = worlds[i];
  if (!REDUCED) wipe(dir);
  gsap.timeline({ onComplete: () => { busy = false; } })
    .to(from.u.uReveal, { value: 0, duration: REDUCED ? 0.2 : 0.55, ease: 'power3.in' })
    .to(fx, { fovKick: REDUCED ? 0 : 28, duration: 0.55, ease: 'power3.in' }, 0)
    .add(() => {
      from.group.visible = false;
      from.u.uHold.value.z = 0;
      cur = i;
      to.group.visible = true;
      Object.assign(I, { look: { x: 0, y: 0 }, lookS: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, zoom: 0, zoomS: 0, twist: 0, twistS: 0 });
      updateHud();
    })
    .fromTo(to.u.uReveal, { value: 0 }, { value: 1, duration: REDUCED ? 0.3 : 1.7, ease: 'expo.out' })
    .to(fx, { fovKick: 0, duration: 1.4, ease: 'expo.out' }, '<');
}
const next = () => goTo((cur + 1) % worlds.length, 1);
const prev = () => goTo((cur - 1 + worlds.length) % worlds.length, -1);

function mutate(dir, quiet = false) {
  const w = worlds[cur];
  const t = clamp(Math.round(w.mutTarget * 2) / 2 + dir * 0.5, 0, 1);
  if (t === w.mutTarget) {
    if (!quiet) toast(dir > 0 ? 'Ende erreicht' : 'Anfang erreicht');
    gsap.fromTo(fx, { shake: 0.4 }, { shake: 0, duration: 0.5 });
    return;
  }
  w.mutTarget = t;
  gsap.to(w.u.uMut, { value: t, duration: quiet ? 4 : 2.4, ease: 'power2.inOut', overwrite: 'auto' });
  updateMutHud();
  if (!quiet) toast('Wandlung · ' + w.muts[t * 2]);
}

/* ------------------------------------------------------------------ */
/* Gestures                                                            */
/* ------------------------------------------------------------------ */
const fxLayer = $('fx');
const rings = new Map();
let lastInput = performance.now();
const markActive = () => { lastInput = performance.now(); };
const vibrate = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (_) {} };
const toNdc = (x, y) => ({ x: (x / window.innerWidth) * 2 - 1, y: -(y / window.innerHeight) * 2 + 1 });

const RING_SVG = '<svg viewBox="0 0 80 80"><circle class="base" cx="40" cy="40" r="26"/><circle class="prog" cx="40" cy="40" r="36"/></svg>';
function ringDown(id, x, y) {
  const el = document.createElement('div');
  el.className = 'touch';
  el.innerHTML = RING_SVG;
  el.style.left = x + 'px'; el.style.top = y + 'px';
  fxLayer.append(el);
  animate(el, { scale: [0.3, 1], opacity: [0, 1], duration: 380, ease: 'outExpo' });
  const prog = animate(el.querySelector('.prog'), { strokeDashoffset: [226.2, 0], duration: HOLD_MS, delay: 90, ease: 'linear' });
  rings.set(id, { el, prog });
}
function ringMove(id, x, y) { const r = rings.get(id); if (r) { r.el.style.left = x + 'px'; r.el.style.top = y + 'px'; } }
function ringCancelHold(id) {
  const r = rings.get(id); if (!r) return;
  r.prog.pause();
  animate(r.el.querySelector('.prog'), { opacity: 0, duration: 200 });
}
function ringHolding(id) {
  const r = rings.get(id); if (!r) return;
  r.pulse = animate(r.el.querySelector('.base'), { scale: [1, 1.5], opacity: [0.9, 0.2], duration: 700, loop: true, alternate: true, ease: 'inOutSine' });
  r.el.querySelector('.base').style.transformOrigin = '40px 40px';
}
function ringUp(id) {
  const r = rings.get(id); if (!r) return;
  rings.delete(id);
  r.prog.pause(); r.pulse && r.pulse.pause();
  animate(r.el, { scale: 1.7, opacity: 0, duration: 520, ease: 'outExpo', onComplete: () => r.el.remove() });
}
function ripple(x, y, big) {
  for (let k = 0; k < (big ? 3 : 1); k++) {
    const el = document.createElement('div');
    el.className = 'ripple';
    el.innerHTML = '<svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="30"/></svg>';
    el.style.left = x + 'px'; el.style.top = y + 'px';
    fxLayer.append(el);
    animate(el, { scale: [0.2, big ? 5 : 2.6], opacity: [1, 0], duration: big ? 1100 : 800, delay: k * 120, ease: 'outExpo', onComplete: () => el.remove() });
  }
}

const HOLD_MS = 380;
const ptrs = new Map();
let start = null, multi = false, holding = false, holdTimer = null, lookAtStart = null, pinchPrev = null;
let lastTap = { t: 0, x: 0, y: 0 };
let lastMove = 0;
let dragging = false;

function pinchMetrics() {
  const [a, b] = [...ptrs.values()];
  return { d: Math.hypot(b.x - a.x, b.y - a.y) || 1, a: Math.atan2(b.y - a.y, b.x - a.x) };
}
function cancelHoldTimer() {
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  markActive();
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  ringDown(e.pointerId, e.clientX, e.clientY);
  if (ptrs.size === 1) {
    multi = false; dragging = true;
    start = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    lookAtStart = { ...I.look };
    I.vel.x = I.vel.y = 0;
    lastMove = performance.now();
    holdTimer = setTimeout(() => {
      holdTimer = null;
      holding = true;
      worlds[cur].holdStart(toNdc(start.x, start.y));
      ringHolding(start.id);
      toast('Sog');
      vibrate(12);
    }, HOLD_MS);
  } else {
    multi = true;
    cancelHoldTimer();
    ptrs.forEach((_, id) => ringCancelHold(id));
    if (holding) { holding = false; worlds[cur].holdEnd(toNdc(e.clientX, e.clientY)); }
    pinchPrev = pinchMetrics();
  }
});

canvas.addEventListener('pointermove', (e) => {
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  markActive();
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  ringMove(e.pointerId, p.x, p.y);
  if (ptrs.size >= 2) {
    const m = pinchMetrics();
    I.zoom = clamp(I.zoom + Math.log(m.d / pinchPrev.d) * 1.8, -1, 2.2);
    let da = m.a - pinchPrev.a;
    if (da > Math.PI) da -= TAU; if (da < -Math.PI) da += TAU;
    I.twist = clamp(I.twist + da, -3, 3);
    pinchPrev = m;
    return;
  }
  if (holding) { worlds[cur].holdMove(toNdc(p.x, p.y)); return; }
  if (holdTimer && Math.hypot(p.x - start.x, p.y - start.y) > 10) { cancelHoldTimer(); ringCancelHold(e.pointerId); }
  if (multi) return;
  const k = 2.6 / Math.min(window.innerWidth, window.innerHeight);
  I.look.x -= dx * k;
  I.look.y = clamp(I.look.y + dy * k, -1.3, 1.3);
  const now = performance.now();
  const sdt = Math.max(1, now - lastMove) / 1000;
  lastMove = now;
  I.vel.x = I.vel.x * 0.5 + (-dx * k / sdt) * 0.5;
  I.vel.y = I.vel.y * 0.5 + (dy * k / sdt) * 0.5;
});

function endPointer(e, cancelled) {
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  ptrs.delete(e.pointerId);
  ringUp(e.pointerId);
  if (ptrs.size === 0) dragging = false;
  if (holding && ptrs.size === 0) {
    holding = false;
    worlds[cur].holdEnd(toNdc(p.x, p.y));
    ripple(p.x, p.y, true);
    toast('Entladung');
    vibrate(20);
    I.vel.x = I.vel.y = 0;
    return;
  }
  cancelHoldTimer();
  if (multi) { if (ptrs.size === 0) multi = false; else pinchPrev = ptrs.size >= 2 ? pinchMetrics() : pinchPrev; return; }
  if (cancelled || !start) return;
  const now = performance.now();
  const dt = now - start.t, dx = p.x - start.x, dy = p.y - start.y, dist = Math.hypot(dx, dy);
  if (now - lastMove > 90) { I.vel.x = I.vel.y = 0; }
  if (dist < 10 && dt < 300) {
    if (now - lastTap.t < 330 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 50) {
      lastTap.t = 0;
      worlds[cur].pulse(toNdc(p.x, p.y), 2.4);
      ripple(p.x, p.y, true);
      gsap.fromTo(fx, { shake: 1 }, { shake: 0, duration: 0.9, ease: 'power2.out' });
      toast('Schockwelle');
      vibrate([8, 40, 14]);
    } else {
      lastTap = { t: now, x: p.x, y: p.y };
      worlds[cur].pulse(toNdc(p.x, p.y), 1);
      ripple(p.x, p.y, false);
    }
  } else if (dt < 420 && dist > 55 && dist / dt > 0.35) {
    I.look = { ...lookAtStart };
    I.vel.x = I.vel.y = 0;
    if (Math.abs(dx) > Math.abs(dy)) { dx < 0 ? next() : prev(); vibrate(10); }
    else mutate(dy < 0 ? 1 : -1);
  }
}
canvas.addEventListener('pointerup', (e) => endPointer(e, false));
canvas.addEventListener('pointercancel', (e) => endPointer(e, true));
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  markActive();
  if (e.shiftKey) I.twist = clamp(I.twist + e.deltaY * 0.004, -3, 3);
  else I.zoom = clamp(I.zoom - e.deltaY * (e.ctrlKey ? 0.012 : 0.0015), -1, 2.2);
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (!introClosed) return;
  markActive();
  const k = e.key;
  if (k === 'ArrowRight') next();
  else if (k === 'ArrowLeft') prev();
  else if (k === 'ArrowUp') mutate(1);
  else if (k === 'ArrowDown') mutate(-1);
  else if (k === 'q' || k === 'Q') I.twist = clamp(I.twist - 0.3, -3, 3);
  else if (k === 'e' || k === 'E') I.twist = clamp(I.twist + 0.3, -3, 3);
  else if (k === ' ') { e.preventDefault(); worlds[cur].pulse({ x: 0, y: -0.2 }, 1.6); ripple(window.innerWidth / 2, window.innerHeight * 0.6, false); }
  else return;
});

/* ------------------------------------------------------------------ */
/* Intro / gesture guide                                               */
/* ------------------------------------------------------------------ */
let introClosed = false;
const introEl = $('intro');
let glyphAnims = [];

function startGlyphs() {
  if (REDUCED) return;
  const q = (g, sel) => document.querySelectorAll(`.glyph[data-g="${g}"] ${sel}`);
  const opt = { loop: true, ease: 'inOutSine' };
  glyphAnims = [
    animate(q('drag', '.f'), { translateX: [-8, 8, -8], translateY: [4, -6, 4], duration: 2200, ...opt }),
    animate(q('swipex', '.f'), { translateX: [10, -12], opacity: [1, 0], duration: 900, loopDelay: 400, loop: true, ease: 'inQuad' }),
    animate(q('swipey', '.f'), { translateY: [10, -12], opacity: [1, 0], duration: 900, loopDelay: 400, loop: true, ease: 'inQuad' }),
    animate(q('pinch', '.f:first-child'), { translateX: [-3, -11], translateY: [3, 11], duration: 1100, alternate: true, ...opt }),
    animate(q('pinch', '.f:last-child'), { translateX: [3, 11], translateY: [-3, -11], duration: 1100, alternate: true, ...opt }),
    animate(q('twist', '.f:first-child'), { translateX: [-10, 0, 10], translateY: [0, -10, 0], duration: 1400, alternate: true, ...opt }),
    animate(q('twist', '.f:last-child'), { translateX: [10, 0, -10], translateY: [0, 10, 0], duration: 1400, alternate: true, ...opt }),
    animate(q('tap', '.r'), { scale: [0.4, 1.7], opacity: [1, 0], duration: 1000, loopDelay: 500, loop: true, ease: 'outExpo' }),
    animate(q('hold', '.r'), { scale: [1.5, 0.5], opacity: [0, 1], duration: 1300, alternate: true, ...opt }),
    animate(q('dtap', '.r'), {
      keyframes: [{ scale: [0.4, 1.6], opacity: [1, 0], duration: 420 }, { scale: [0.4, 1.6], opacity: [1, 0], duration: 420 }],
      loopDelay: 700, loop: true, ease: 'outExpo',
    }),
  ];
}
function stopGlyphs() { glyphAnims.forEach((a) => a && a.pause && a.pause()); glyphAnims = []; }

function openIntro() {
  introClosed = false;
  introEl.hidden = false;
  startGlyphs();
  if (!REDUCED) {
    createTimeline({ defaults: { ease: 'outExpo' } })
      .add(introEl, { opacity: [0, 1], duration: 400 })
      .add('.intro-inner > *', { opacity: [0, 1], translateY: [24, 0], delay: stagger(70), duration: 900 }, 100)
      .add('.gestures li', { opacity: [0, 1], translateX: [-10, 0], delay: stagger(45), duration: 700 }, 250);
  }
}
function closeIntro() {
  if (introClosed) return;
  introClosed = true;
  markActive();
  const done = () => { introEl.hidden = true; stopGlyphs(); };
  if (REDUCED) return done();
  animate(introEl, { opacity: 0, translateY: 30, duration: 600, ease: 'inOutExpo', onComplete: () => { done(); introEl.style.transform = ''; } });
  toast('Wische nach links');
}
$('enter').addEventListener('click', closeIntro);
$('helpBtn').addEventListener('click', openIntro);

/* ------------------------------------------------------------------ */
/* Loop                                                                */
/* ------------------------------------------------------------------ */
const clock = new THREE.Clock();
let frames = 0, slowFrames = 0, lastAuto = 0;

function loop() {
  requestAnimationFrame(loop);
  if (document.hidden) { clock.getDelta(); return; }
  const dt = Math.min(clock.getDelta(), 1 / 20);
  shared.time.value += dt * (REDUCED ? 0.5 : 1);

  // inertia + smoothing
  if (!dragging && !holding) {
    I.look.x += I.vel.x * dt;
    I.look.y = clamp(I.look.y + I.vel.y * dt, -1.3, 1.3);
    const decay = Math.exp(-dt * 3.5);
    I.vel.x *= decay; I.vel.y *= decay;
  }
  const s = 1 - Math.exp(-dt * 6);
  I.lookS.x += (I.look.x - I.lookS.x) * s;
  I.lookS.y += (I.look.y - I.lookS.y) * s;
  I.zoomS += (I.zoom - I.zoomS) * s;
  I.twistS += (I.twist - I.twistS) * s;

  // idle: worlds keep transforming by themselves
  const now = performance.now();
  if (introClosed && !busy && now - lastInput > 14000 && now - lastAuto > 9000) {
    lastAuto = now;
    const w = worlds[cur];
    const dir = w.mutTarget >= 1 ? -1 : w.mutTarget <= 0 ? 1 : (Math.random() < 0.5 ? -1 : 1);
    mutate(dir, true);
  }

  const w = worlds[cur];
  w.update(dt, I);
  camera.near = 0.1; camera.far = 400;
  w.rig(I);
  if (w instanceof Iso) { camera.near = 60; camera.far = 280; }
  camera.fov = Math.min(150, camera.fov + fx.fovKick);
  if (fx.shake > 0.001) {
    const t = shared.time.value * 60;
    camera.rotateZ(Math.sin(t) * 0.02 * fx.shake);
    camera.rotateX(Math.cos(t * 1.3) * 0.015 * fx.shake);
  }
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);

  // adaptive resolution for weaker phones
  frames++;
  if (frames > 30 && frames < 150 && dt > 1 / 40) slowFrames++;
  if (frames === 150 && slowFrames > 50 && dpr > 1) {
    dpr = Math.max(1, dpr * 0.66);
    renderer.setPixelRatio(dpr);
    shared.px.value = dpr;
    resize();
  }
}

updateHud(false);
openIntro();
gsap.to(worlds[0].u.uReveal, { value: 1, duration: REDUCED ? 0.3 : 2.4, ease: 'expo.out', delay: 0.2 });
loop();

// expose for debugging in the console
window.gestenwelten = { worlds, goTo, mutate, I };
