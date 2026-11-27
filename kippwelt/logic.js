// Kippwelt game rules: grid of unit blocks, a ball sitting on one face of a block.
// Ball state: b = block under the ball, u = up (face normal), f = forward. All integer vectors.
// Pure module: no DOM, no Three.js, so it can be unit-tested and solved in Node.

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const neg = (a) => [-a[0], -a[1], -a[2]];
export const eq = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const key = (a) => a[0] + ',' + a[1] + ',' + a[2];
const add3 = (a, b, c) => add(add(a, b), c);

export const FACE = {
  '+x': [1, 0, 0], '-x': [-1, 0, 0],
  '+y': [0, 1, 0], '-y': [0, -1, 0],
  '+z': [0, 0, 1], '-z': [0, 0, -1],
};
const at = (x, y, z, face) => ({ b: [x, y, z], u: FACE[face] });

/* ------------------------------------------------------------------ */
/* Levels                                                              */
/* blocks: [x0, x1, y0, y1, z0, z1, phase]  phase 0 = always solid,    */
/*         1 / 2 = solid only while the world is in that phase         */
/* ------------------------------------------------------------------ */
export const LEVELS = [
  {
    id: 'I-1', world: 0, name: 'erste kante', time: 90,
    blocks: [[0, 4, 0, 0, 0, 4]],
    start: { b: [2, 0, 4], u: [0, 1, 0], f: [0, 0, -1] },
    keys: [at(0, 0, 0, '+y'), at(2, 0, 2, '-y')],
    shards: [at(2, 0, 3, '+y'), at(2, 0, 2, '+y'), at(2, 0, 1, '+y'), at(2, 0, 0, '-z'), at(4, 0, 2, '+x'), at(0, 0, 4, '-y'), at(4, 0, 4, '-y')],
    spikes: [],
    exit: at(4, 0, 0, '+y'),
    hints: ['Wisch nach oben: ein Feld. Daumen halten: durchrollen', 'Daumen halten und zur Seite schieben: abbiegen. Wieder hoch: weiterrollen', 'Roll über die Kante. Die Schwerkraft kippt mit', 'Halten: Übersicht'],
  },
  {
    id: 'I-2', world: 0, name: 'sprung', time: 100,
    blocks: [[0, 2, 0, 0, 0, 2], [0, 2, 0, 0, 4, 6], [1, 1, 1, 1, 5, 5]],
    start: { b: [1, 0, 0], u: [0, 1, 0], f: [0, 0, 1] },
    keys: [at(1, 1, 5, '+y'), at(1, 0, 1, '-y')],
    shards: [at(1, 0, 1, '+y'), at(0, 0, 4, '+y'), at(2, 0, 4, '+y'), at(1, 1, 5, '+x'), at(0, 0, 6, '-y'), at(2, 0, 0, '-y')],
    spikes: [{ ...at(0, 0, 5, '+y'), mode: 'static' }, { ...at(2, 0, 5, '+y'), mode: 'toggle', offset: 0 }, { ...at(1, 0, 6, '+y'), mode: 'toggle', offset: 0.5 }],
    exit: at(2, 0, 6, '+y'),
    hints: ['Tippen: springen. Zwei Felder weit', 'Vor einem Sockel tippen: hinaufspringen', 'Stacheln meiden. Manche fahren ein und aus'],
  },
  {
    id: 'I-3', world: 0, name: 'würfel', time: 120,
    blocks: [[0, 2, 0, 2, 0, 2], [1, 1, 3, 3, 1, 1]],
    start: { b: [1, 2, 2], u: [0, 1, 0], f: [0, 0, -1] },
    keys: [at(2, 1, 1, '+x'), at(1, 1, 0, '-z'), at(1, 0, 1, '-y'), at(1, 3, 1, '+y')],
    shards: [at(0, 2, 0, '+y'), at(2, 2, 2, '+y'), at(0, 1, 1, '-x'), at(2, 0, 2, '+z'), at(0, 0, 0, '-y'), at(1, 2, 0, '-z')],
    spikes: [{ ...at(2, 1, 2, '+x'), mode: 'static' }, { ...at(0, 1, 0, '-z'), mode: 'static' }, { ...at(1, 0, 2, '-y'), mode: 'toggle', offset: 0.25 }, { ...at(2, 1, 0, '+x'), mode: 'toggle', offset: 0.75 }],
    exit: at(1, 1, 2, '+z'),
    hints: ['Jede Seite des Würfels ist Boden', 'Die Spitze erreichst du per Sprung'],
  },
  {
    id: 'II-1', world: 1, name: 'phase', time: 110,
    blocks: [[0, 2, 0, 0, 0, 2], [1, 1, 0, 0, 3, 5, 1], [0, 2, 0, 0, 6, 8], [3, 5, 0, 0, 7, 7, 2], [6, 8, 0, 0, 6, 8]],
    start: { b: [1, 0, 0], u: [0, 1, 0], f: [0, 0, 1] },
    keys: [at(1, 0, 8, '+y'), at(8, 0, 8, '+y'), at(7, 0, 6, '-y')],
    shards: [at(1, 0, 3, '+y'), at(1, 0, 5, '+y'), at(4, 0, 7, '+y'), at(6, 0, 6, '+y'), at(0, 0, 0, '-y'), at(2, 0, 8, '+z')],
    spikes: [{ ...at(7, 0, 7, '+y'), mode: 'static' }],
    exit: at(0, 0, 2, '+y'),
    phases: true,
    hints: ['Wisch nach unten: Phase wechseln', 'Gepunktete Blöcke sind nur in ihrer Phase fest', 'Wer auf einem Phasenblock wechselt, fällt'],
  },
  {
    id: 'II-2', world: 1, name: 'turm', time: 120,
    blocks: [[0, 0, 0, 1, 0, 0], [0, 0, 2, 2, 0, 0, 2], [0, 0, 3, 6, 0, 0], [1, 3, 3, 3, 0, 0], [-3, -1, 1, 1, 0, 0]],
    start: { b: [0, 6, 0], u: [0, 1, 0], f: [0, 0, -1] },
    keys: [at(3, 3, 0, '+x'), at(-3, 1, 0, '-y'), at(0, 4, 0, '+z')],
    shards: [at(0, 5, 0, '-z'), at(0, 4, 0, '-z'), at(2, 3, 0, '-z'), at(-2, 1, 0, '+z'), at(0, 0, 0, '+x'), at(0, 6, 0, '+x')],
    spikes: [{ ...at(0, 3, 0, '+x'), mode: 'toggle', offset: 0 }, { ...at(2, 3, 0, '+y'), mode: 'static' }, { ...at(-1, 1, 0, '-z'), mode: 'toggle', offset: 0.5 }],
    exit: at(0, 0, 0, '-y'),
    phases: true,
    hints: ['Der Turm ist in der Mitte unterbrochen', 'Phase wechseln, bevor du ins Leere rollst'],
  },
  {
    id: 'II-3', world: 1, name: 'kehle', time: 150,
    blocks: [[0, 6, 0, 0, 0, 0], [0, 6, 6, 6, 0, 0], [0, 0, 1, 2, 0, 0], [0, 0, 3, 3, 0, 0, 1], [0, 0, 4, 5, 0, 0], [6, 6, 1, 2, 0, 0], [6, 6, 3, 3, 0, 0, 2], [6, 6, 4, 5, 0, 0]],
    start: { b: [3, 6, 0], u: [0, 1, 0], f: [1, 0, 0] },
    keys: [at(3, 0, 0, '-y'), at(6, 1, 0, '-x'), at(0, 5, 0, '+x'), at(3, 6, 0, '-y')],
    shards: [at(1, 6, 0, '+y'), at(5, 6, 0, '+y'), at(6, 3, 0, '+x'), at(0, 3, 0, '-x'), at(3, 0, 0, '+z'), at(3, 6, 0, '-z'), at(6, 4, 0, '+z'), at(0, 2, 0, '-z')],
    spikes: [{ ...at(6, 6, 0, '+y'), mode: 'static' }, { ...at(0, 0, 0, '-y'), mode: 'static' }, { ...at(2, 0, 0, '+z'), mode: 'toggle', offset: 0 }, { ...at(4, 6, 0, '-z'), mode: 'toggle', offset: 0.5 }],
    exit: at(3, 0, 0, '+y'),
    phases: true,
    hints: ['Ein Rahmen mit zwei Phasentoren', 'Innenseiten erreichst du über die Stirnflächen'],
  },
];

export const SPIKE_PERIOD = 2.4;
export function spikeUp(spike, time) {
  if (spike.mode === 'static') return 1;
  const ph = (time / SPIKE_PERIOD + spike.offset) % 1;
  // up for the first half, with short ramps
  if (ph < 0.08) return ph / 0.08;
  if (ph < 0.5) return 1;
  if (ph < 0.58) return 1 - (ph - 0.5) / 0.08;
  return 0;
}

/* ------------------------------------------------------------------ */
/* Level model                                                         */
/* ------------------------------------------------------------------ */
export class Level {
  constructor(def) {
    this.def = def;
    this.blocks = new Map();
    for (const [x0, x1, y0, y1, z0, z1, phase = 0] of def.blocks)
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++)
        this.blocks.set(key([x, y, z]), { p: [x, y, z], phase });
    this.hasPhases = !!def.phases;
  }
  solid(p, phase) {
    const bl = this.blocks.get(key(p));
    return !!bl && (bl.phase === 0 || bl.phase === phase);
  }
  spikeAt(s) { return this.def.spikes.find((k) => eq(k.b, s.b) && eq(k.u, s.u)); }
  bounds() {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const { p } of this.blocks.values()) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i]); }
    return { min, max, center: [0, 1, 2].map((i) => (min[i] + max[i]) / 2), size: Math.max(...[0, 1, 2].map((i) => max[i] - min[i] + 1)) };
  }
}

export const sameSpot = (a, b) => eq(a.b, b.b) && eq(a.u, b.u);

// Returns the outcome of an action. Never mutates its inputs.
export function act(L, s, action, phase) {
  const { b, u, f } = s;
  const S = (p) => L.solid(p, phase);
  switch (action) {
    case 'left': return { kind: 'turn', to: { b, u, f: cross(u, f) }, dir: 1 };
    case 'right': return { kind: 'turn', to: { b, u, f: cross(f, u) }, dir: -1 };
    case 'back': return { kind: 'turn', to: { b, u, f: neg(f) }, dir: 2 };
    case 'fwd': {
      if (S(add3(b, f, u))) return { kind: 'blocked' };
      const g = add(b, f);
      if (S(g)) return { kind: 'roll', to: { b: g, u, f } };
      return { kind: 'wrap', to: { b, u: f, f: neg(u) } };
    }
    case 'jump': {
      if (S(add(b, scale(u, 2)))) return { kind: 'jump', sub: 'hop', to: s };
      const A = add3(b, f, u);
      if (S(A)) {
        if (!S(add(A, u)) && !S(add(add(b, f), scale(u, 2)))) return { kind: 'jump', sub: 'climb', to: { b: A, u, f } };
        return { kind: 'jump', sub: 'hop', to: s };
      }
      const column = (c) => {
        for (let k = 0; k <= 6; k++) {
          const p = add(c, scale(u, -k));
          if (S(p)) return { kind: 'jump', sub: k === 0 ? 'jump' : 'drop', k, to: { b: p, u, f } };
        }
        return { kind: 'fall', at: c };
      };
      const far = add(b, scale(f, 2));
      if (S(add(far, u))) {
        if (S(add(b, f))) return { kind: 'jump', sub: 'short', to: { b: add(b, f), u, f } };
        return column(add(b, f));
      }
      return column(far);
    }
  }
  throw new Error('unknown action ' + action);
}

// What happens to the ball when the world flips to `phase`.
export function afterPhase(L, s, phase) {
  if (L.solid(add(s.b, s.u), phase)) return { kind: 'crush' };
  if (L.solid(s.b, phase)) return { kind: 'stay' };
  for (let k = 1; k <= 6; k++) {
    const p = add(s.b, scale(s.u, -k));
    if (L.solid(p, phase)) return { kind: 'drop', k, to: { b: p, u: s.u, f: s.f } };
  }
  return { kind: 'fall' };
}

/* ------------------------------------------------------------------ */
/* Solver (breadth-first) used by tests to prove every level winnable. */
/* Toggling spikes count as passable; static spikes kill.              */
/* ------------------------------------------------------------------ */
export function solve(def) {
  const L = new Level(def);
  const keyIdx = (s) => def.keys.findIndex((k) => sameSpot(k, s));
  const full = (1 << def.keys.length) - 1;
  const deadly = (s) => { const sp = L.spikeAt(s); return sp && sp.mode === 'static'; };
  const sk = (s, ph, m) => key(s.b) + '|' + key(s.u) + '|' + key(s.f) + '|' + ph + '|' + m;
  const collect = (s, m) => { const i = keyIdx(s); return i >= 0 ? m | (1 << i) : m; };
  const start = { s: def.start, ph: 1, m: collect(def.start, 0), path: [] };
  const seen = new Set([sk(start.s, 1, start.m)]);
  const queue = [start];
  const actions = ['fwd', 'left', 'right', 'jump', ...(L.hasPhases ? ['phase'] : [])];
  const visitedSpots = new Set();
  let win = null;
  while (queue.length) {
    const n = queue.shift();
    visitedSpots.add(key(n.s.b) + '|' + key(n.s.u));
    if (!win && n.m === full && sameSpot(n.s, def.exit)) win = n.path;
    for (const a of actions) {
      let s2, ph2 = n.ph;
      if (a === 'phase') {
        ph2 = n.ph === 1 ? 2 : 1;
        const r = afterPhase(L, n.s, ph2);
        if (r.kind === 'crush' || r.kind === 'fall') continue;
        s2 = r.kind === 'drop' ? r.to : n.s;
      } else {
        const r = act(L, n.s, a, n.ph);
        if (r.kind === 'fall' || r.kind === 'blocked') continue;
        s2 = r.to;
      }
      if (deadly(s2)) continue;
      const m2 = collect(s2, n.m);
      const k2 = sk(s2, ph2, m2);
      if (seen.has(k2)) continue;
      seen.add(k2);
      queue.push({ s: s2, ph: ph2, m: m2, path: [...n.path, a] });
    }
  }
  const unreachableShards = def.shards.filter((sh) => !visitedSpots.has(key(sh.b) + '|' + key(sh.u)));
  return { win, unreachableShards };
}
