// Automated playtest bot for the runner ("Lauf"). Injected into the page by a test driver.
// It plays the real game logic headlessly (no waiting for frames) and plans each move with a
// forward model of the collision rules. Two kinds of findings come out of it:
//   - "unexpected" deaths: the model expected survival, the game killed the ball -> game bug
//   - "no solution": no input sequence in the planning horizon survives -> unfair track
// Usage in the page:  await window.kippweltBot.run({ runs: 6, maxDist: 2500 })
(function () {
  const K = window.kippwelt, T = K.__t, RUN = K.RUN, G = K.G;
  const V3 = K.vis.pos.constructor;
  const Y = new V3(0, 1, 0);
  const R = 0.32, DT = 1 / 60;
  let HORIZON = 1.4;

  const occM = (p, phase) => {
    const t = K.RUNMAP.get(T.kv(p));
    if (t === undefined || t === 4) return false; // crumbling floor counts as a hole (it will be one)
    return t === 0 || t === 3 || t === 5 || t === phase;
  };
  function stackM(st, seg, k, fi, lane) {
    if (!occM(T.faceCell(seg, k, fi, lane), st.phase)) return -Infinity;
    if (st.smashed.has(seg.id + '|' + k + '|' + fi + '|' + lane)) return 0;
    let h = 0;
    while (h < 4 && occM(T.faceCell(seg, k, fi, lane, h + 1), st.phase)) h++;
    return h;
  }
  const crusherAt = (cr, tt) => {
    const p = (tt / 1.7 + cr.ph) % 1;
    if (p < 0.12) return 3 * (1 - (p / 0.12) ** 2);
    if (p < 0.4) return 0;
    if (p < 0.8) { const x = (p - 0.4) / 0.4; return 3 * x * x * (3 - 2 * x); }
    return 3;
  };
  const near = (a, b, d) => Math.abs(a - b) <= d;

  function snapshot() {
    return {
      si: RUN.si, s: RUN.s, y: RUN.y, vy: RUN.vy, grounded: RUN.grounded, fi: RUN.fi, lane: RUN.lane,
      dashT: RUN.dashT, dash: RUN.dash, dashExt: RUN.dashExt || 0, phase: RUN.phase, dist: RUN.dist, slam: RUN.slam,
    };
  }

  function apply(st, a) {
    const seg = RUN.segs[st.si];
    if (a === 'jump') {
      if (st.grounded) { st.vy = T.JUMP_V; st.grounded = false; return; }
      const orb = seg && seg.orbs.find((o) => o.fi === st.fi && o.lane === st.lane && near(st.s, o.k, 1.4) && near(st.y, o.h, 1.3));
      if (orb && !st.orbUsed) { st.orbUsed = true; st.vy = T.JUMP_V; }
    } else if (a === 'dash') {
      if (st.dash >= 1 && st.dashT === 0) { st.dash = 0; st.dashT = 0.4; st.vy = 0; st.dashExt = 0; if (st.y < 0) st.y = Math.max(st.y, -0.2); }
    } else if (a === 'left' || a === 'right') {
      const dl = a === 'right' ? 1 : -1;
      if (st.lane === -dl) st.lane = dl; else { st.fi += dl; st.lane = -dl; }
    } else if (a === 'phase') {
      st.phase = st.phase === 1 ? 2 : 1;
      if (seg && occM(T.faceCell(seg, Math.round(st.s), st.fi, st.lane, Math.floor(st.y + 0.3) + 1), st.phase)) st.dead = 'zerdrückt';
    } else if (a === 'slam') {
      if (!st.grounded) { st.slam = true; st.vy = -32; st.dashT = 0; }
    }
  }

  // one physics step, mirroring runStep; returns a death reason or null
  function stepM(st, t) {
    let seg = RUN.segs[st.si];
    if (!seg) return null;
    const speed = T.speedAt(st.dist);
    const dashing = st.dashT > 0;
    st.dashT = Math.max(0, st.dashT - DT);
    st.dash = Math.min(1, st.dash + DT / 2.2);
    if (dashing && st.dashT === 0 && st.dashExt < 0.8 && stackM(st, seg, Math.round(st.s + 0.5), st.fi, st.lane) === -Infinity) { st.dashT = 0.04; st.dashExt += 0.04; }
    const adv = speed * (dashing ? 2.4 : 1) * DT;
    st.s += adv; st.dist += adv;
    if (st.s >= seg.L) { st.s -= seg.L; st.si++; seg = RUN.segs[st.si]; if (!seg) return null; }
    st.prevY = st.y;
    if (dashing) st.vy = 0; else st.vy -= T.GRAV * (st.slam ? 2.2 : 1) * DT;
    st.y += st.vy * DT;
    const k = Math.round(st.s);
    const floor = stackM(st, seg, k, st.fi, st.lane);
    if (st.vy <= 0 && st.y <= floor && (st.prevY >= floor - 0.05 || st.y > floor - 0.45)) { st.y = floor; st.vy = 0; st.grounded = true; st.slam = false; }
    else if (st.y > floor + 0.02) st.grounded = false;
    const kA = Math.round(st.s + 0.32);
    const hA = stackM(st, seg, kA, st.fi, st.lane);
    if (hA > st.y + 0.32 && hA - st.y <= 0.6) { st.y = hA; st.vy = Math.max(st.vy, 0); st.grounded = true; }
    else if (hA > st.y + 0.32) {
      if (!dashing) return 'aufgeprallt';
      st.smashed.add(seg.id + '|' + kA + '|' + st.fi + '|' + st.lane);
      st.dashT = Math.max(st.dashT, 0.15);
    }
    if (st.y < -2.4) return 'abgestürzt';
    const now = T.U.time.value + t + DT; // the game advances the clock before stepping
    for (const cr of seg.crushers) {
      if (!cr.alive || cr.fi !== st.fi || cr.lane !== st.lane || !near(st.s, cr.k, 0.55)) continue;
      const h = crusherAt(cr, now);
      if (st.y < h + 1 && st.y + 0.64 > h && !dashing) return 'zerquetscht';
    }
    for (const sw of seg.sweepers) {
      if (!sw.alive || sw.fi !== st.fi || !near(st.s, sw.k, 0.6) || st.y > 0.85) continue;
      if (near(Math.sin(now * sw.w + sw.ph), st.lane, 0.72) && !dashing) return 'weggefegt';
    }
    if (!dashing) for (const lz of seg.lasers) {
      if (lz.fi !== st.fi || !near(st.s, lz.k, 0.35)) continue;
      if (!lz.high && st.y < 0.55) return 'laser';
      if (lz.high && st.y > 1.1 && st.y < 1.9) return 'laser';
    }
    if (!dashing) for (const sp of seg.spikes) if (sp.fi === st.fi && sp.lane === st.lane && Math.abs(st.s - sp.k) < 0.42 && st.y < 0.45) return 'stacheln';
    if (st.grounded && st.y < 0.05) for (const p of seg.pads) if (p.fi === st.fi && Math.abs(st.s - p.k) < 0.5) { st.vy = T.PAD_V; st.grounded = false; }
    for (const p of seg.portals) {
      const key = seg.id + '|' + p.k;
      if (!p.passed && !st.portals.has(key) && st.s >= p.k) { st.portals.add(key); st.fi += 2; st.vy = Math.max(st.vy, 3); }
    }
    if (st.grounded && st.y < 0.05) for (const fl of seg.flips) {
      const key = seg.id + '|' + fl.k + '|' + fl.fi + '|' + fl.lane;
      if (fl.used || st.flips.has(key) || fl.fi !== st.fi || fl.lane !== st.lane || Math.abs(st.s - fl.k) > 0.5) continue;
      st.flips.add(key); st.fi += 2; st.vy = 4; st.grounded = false; break;
    }
    for (const rg of seg.rings) {
      if (!rg.alive || !near(st.s, rg.k, 0.45) || st.y > 1.0 || dashing) continue;
      const n = T.faceN(seg.d, st.fi), a = T.faceN(seg.d, st.fi + 1);
      const rel = n.clone().multiplyScalar(1.5 + R + st.y).addScaledVector(a, st.lane);
      const th = Math.atan2(rel.dot(Y), rel.dot(seg.r));
      const phi = rg.ph + now * rg.w;
      if (rg.angles.some((ang) => { let d = th - (ang + phi); d = Math.atan2(Math.sin(d), Math.cos(d)); return Math.abs(d) < 0.28; })) return 'drehring';
    }
    return null;
  }

  function rollout(st0, plan) {
    const st = { ...st0, smashed: new Set(), portals: new Set(), flips: new Set() };
    let ai = 0;
    for (let t = 0; t < HORIZON; t += DT) {
      while (ai < plan.length && plan[ai].t <= t + 1e-9) { apply(st, plan[ai].a); ai++; if (st.dead) return { alive: false, t, why: st.dead }; }
      const why = stepM(st, t);
      if (why) return { alive: false, t, why };
    }
    return { alive: true, t: HORIZON };
  }

  const FIRST = ['none', 'jump', 'left', 'right', 'phase', 'dash', 'slam'];
  const SECOND = ['jump', 'left', 'right', 'phase', 'dash', 'slam'];
  const TIMES = [0.12, 0.25, 0.4, 0.55, 0.75, 1.0];
  function plan(st0, off = 0) {
    let best = null;
    for (const a0 of FIRST) {
      const base = a0 === 'none' ? [] : [{ t: off, a: a0 }];
      const cand = [base];
      for (const a1 of SECOND) for (const t1 of TIMES) cand.push([...base, { t: off + t1, a: a1 }]);
      for (const p of cand) {
        const r = rollout(st0, p);
        // prefer survival, then fewer inputs, then doing nothing now, then not burning the dash
        const score = r.t * 100 - p.length * 0.5 - (a0 === 'none' ? 0 : 0.3) - p.filter((x) => x.a === 'dash').length * 0.4;
        if (!best || score > best.score) best = { score, plan: p, r };
        if (r.alive && a0 === 'none' && p.length === 0) return best; // nothing to do
      }
    }
    return best;
  }

  function ctx(range = 14) {
    // compact description of what lies ahead on the ball's side
    const seg = RUN.segs[RUN.si], k0 = Math.round(RUN.s), out = [];
    for (let k = k0; k <= k0 + range; k++) {
      const row = [];
      for (const l of [-1, 1]) {
        const st = { phase: RUN.phase, smashed: new Set() };
        const h = stackM(st, seg, k, RUN.fi, l);
        row.push(h === -Infinity ? '_' : String(h));
      }
      const tags = [];
      seg.spikes.forEach((x) => x.k === k && x.fi === RUN.fi && tags.push('sp' + x.lane));
      seg.crushers.forEach((x) => x.k === k && x.fi === RUN.fi && tags.push('cr' + x.lane));
      seg.sweepers.forEach((x) => x.k === k && x.fi === RUN.fi && tags.push('sw'));
      seg.lasers.forEach((x) => x.k === k && x.fi === RUN.fi && tags.push(x.high ? 'LH' : 'LL'));
      seg.rings.forEach((x) => x.k === k && tags.push('ring'));
      seg.portals.forEach((x) => x.k === k && tags.push('portal'));
      seg.pads.forEach((x) => x.k === k && x.fi === RUN.fi && tags.push('pad'));
      seg.flips.forEach((x) => x.k === k && x.fi === RUN.fi && tags.push('flip' + x.lane));
      seg.orbs.forEach((x) => x.k === k && x.fi === RUN.fi && tags.push('orb'));
      seg.crumbles.forEach((x) => k >= x.k && k < x.k + x.len && x.fi === RUN.fi && tags.push('cb' + x.lane));
      out.push(`${k - k0}:${row.join('')}${tags.length ? '[' + tags.join(',') + ']' : ''}`);
    }
    return out.join(' ');
  }

  function act(a) {
    if (a === 'jump') T.runJump();
    else if (a === 'dash') T.runDash();
    else if (a === 'left') T.laneShift(-1);
    else if (a === 'right') T.laneShift(1);
    else if (a === 'phase') T.runPhase();
    else if (a === 'slam') T.runSlam();
  }

  async function run({ runs = 5, maxDist = 2500, onLog = null, horizon = 1.4, delay = 0, lapse = 0 } = {}) {
    HORIZON = horizon;
    const results = [];
    for (let n = 0; n < runs; n++) {
      K.startRun();
      const rec = { dist: 0, reason: null, unexpected: null, noSolution: [], inputs: 0, shards: 0, speedAtEnd: 0, zones: [] };
      let frame = 0, last = null, lastZone = null;
      const pending = [];
      while (true) {
        // chunk of synchronous simulation, then yield so the page stays alive
        for (let i = 0; i < 600; i++) {
          G.mode = 'run';
          const req = T.turnRequired();
          if (req) K.runInput(req);
          if (frame % 3 === 0 && !pending.length && !(RUN.flight > 0)) {
            const st0 = snapshot();
            const b = plan(st0, delay);
            last = { ...b, at: RUN.dist };
            if (!b.r.alive) {
              const lastNs = rec.noSolution[rec.noSolution.length - 1];
              if (!lastNs || RUN.dist - lastNs.dist > 3) rec.noSolution.push({ dist: Math.round(RUN.dist), why: b.r.why, in: +b.r.t.toFixed(2), ctx: ctx(), speed: +RUN.speed.toFixed(1), phase: RUN.phase, y: +RUN.y.toFixed(2), zone: RUN.zone && RUN.zone.type });
            }
            const first = b.plan[0];
            if (first && first.t === delay && Math.random() >= lapse) {
              if (delay > 0) pending.push({ at: frame + Math.round(delay / DT), a: first.a }); else act(first.a);
              rec.inputs++;
            }
          }
          while (pending.length && pending[0].at <= frame) act(pending.shift().a);
          T.U.time.value += DT;
          RUN.moment = 1; RUN.timeScale = 1;
          T.runStep(DT);
          T.runVisual(DT);
          frame++;
          if (RUN.zone && RUN.zone.type !== lastZone) { lastZone = RUN.zone.type; rec.zones.push(lastZone + '@' + Math.round(RUN.dist)); }
          if (G.mode !== 'run') {
            rec.reason = document.getElementById('toast').textContent.replace(/ /g, ' ');
            const predictedAlive = last && last.r.alive && RUN.dist - last.at < 3;
            if (predictedAlive) rec.unexpected = { ctx: ctx(6), y: +RUN.y.toFixed(2), vy: +RUN.vy.toFixed(1), lane: RUN.lane, fi: RUN.fi, grounded: RUN.grounded, dashT: +RUN.dashT.toFixed(2), plan: last.plan.map((p) => p.a + '@' + p.t).join(' ') };
            break;
          }
          if (RUN.dist > maxDist) { rec.reason = 'max'; break; }
        }
        if (rec.reason) break;
        G.mode = 'simpause';
        await new Promise((r) => setTimeout(r, 0));
      }
      rec.dist = Math.round(RUN.dist); rec.shards = RUN.shards; rec.speedAtEnd = +RUN.speed.toFixed(1);
      results.push(rec);
      onLog && onLog(rec);
      G.mode = 'simpause';
      await new Promise((r) => setTimeout(r, 50));
    }
    return results;
  }
  window.kippweltBot = { run, plan, snapshot, ctx };
})();
