// Foot planting, rope catches, impacts, throws and the cape, measured in the real game (headless, no rendering).
//   node tools/motion-bench.mjs [scenario ...]     scenarios: run titan horse rope trunk throw cape (default: all)
// For each foot it reports how fast it moves over the ground while it is near the ground (a planted foot should
// not move), how much of the time it is down, and the step rate; for the gear, the per-frame speed change.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { serve } from './serve.mjs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const want = process.argv.slice(2);
const all = ['run', 'titan', 'horse', 'rope', 'trunk', 'throw', 'cape'];
const scen = want.length ? want : all;
const { srv, url } = await serve(ROOT);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message, (e.stack || '').split('\n').slice(1, 3).join(' | ')));
await page.goto(`${url}/index.html?noaudio&norender&noallies&play=free`);
await page.waitForFunction(() => window.READY === true, null, { timeout: 240000 });

// shared helpers in the page
await page.evaluate(async () => { window.__CFG = (await import('./src/config.js')).CFG; });
await page.evaluate(() => {
  const V = game.player.pos.constructor;
  window.__B = {
    V,
    steps(n) { for (let i = 0; i < n; i++) window.stepGame(1 / 60); },
    // per-foot tracker: feed world positions of the lowest sole point + ground height each frame
    tracker(n, nearH = 0.07) {
      const T = { n, prev: [], spLow: [], near: Array(n).fill(0), down: Array(n).fill(0), frames: 0, sp: [], heights: Array.from({ length: n }, () => []), touch: Array(n).fill(0), wasDown: Array(n).fill(false) };
      // p: the lowest point of the foot; q (optional): that same point last frame (so a heel peeling up off a
      // planted ball doesn't count as the foot moving)
      T.add = (i, p, g, dt, q0) => {
        const h = p.y - g;
        T.heights[i].push(h);
        const isNear = h < nearH;
        if (isNear) T.down[i]++;
        if (isNear && !T.wasDown[i]) T.touch[i]++;
        T.wasDown[i] = isNear;
        const q = T.prev[i];
        if (q && isNear && q.near) { const r = q0 || q; T.sp.push(Math.hypot(p.x - r.x, p.z - r.z) / dt); if (h < 0.02) T.spLow.push(Math.hypot(p.x - r.x, p.z - r.z) / dt); }
        T.prev[i] = { x: p.x, z: p.z, near: isNear };
      };
      T.report = (frames, secs) => {
        const sp = T.sp.slice().sort((a, b) => a - b), hs = T.heights.flat().sort((a, b) => a - b), sl = T.spLow.slice().sort((a, b) => a - b);
        const q = (a, f) => a.length ? a[Math.min(a.length - 1, Math.floor(f * a.length))] : NaN;
        return { downFrac: +(T.down.reduce((a, b) => a + b, 0) / (frames * n)).toFixed(3), touchdownsPerSec: +(T.touch.reduce((a, b) => a + b, 0) / secs).toFixed(2),
          plantedSpeed: { mean: +(sp.reduce((a, b) => a + b, 0) / Math.max(1, sp.length)).toFixed(2), p50: +q(sp, 0.5).toFixed(2), p90: +q(sp, 0.9).toFixed(2), max: +q(sp, 1).toFixed(2), samples: sp.length },
          onGroundSpeed: { mean: +(sl.reduce((a, b) => a + b, 0) / Math.max(1, sl.length)).toFixed(2), p90: +q(sl, 0.9).toFixed(2), max: +q(sl, 1).toFixed(2), samples: sl.length },
          footHeight: { min: +q(hs, 0).toFixed(3), p50: +q(hs, 0.5).toFixed(3), p90: +q(hs, 0.9).toFixed(3) } };
      };
      return T;
    },
  };
});

const results = {};
const run = (name, fn, arg) => page.evaluate(fn, arg).then((r) => { results[name] = r; console.log(`\n== ${name}\n` + JSON.stringify(r, null, 1)); });

if (scen.includes('run')) await run('run', () => {
  const B = window.__B, p = game.player, m = p.model, V = B.V;
  const out = {};
  for (const target of [1.4, 4, 11]) {
    const gx = 30, gz = 60, gy = game.collision.groundHeight(gx, gz);
    p.reset(new V(gx, gy + 0.5, gz), Math.PI / 2);
    game.input.down.clear();
    B.steps(30);
    const T = B.tracker(2);
    const heel = new V(), ball = new V(), last = [[null, null], [null, null]];
    let frames = 0, sumV = 0;
    const run0 = window.__CFG.ground.run;
    window.__CFG.ground.run = target;          // hold ↑ at this run speed (a walk, a jog, a sprint)
    for (let i = 0; i < 300; i++) {
      game.input.down.add('ArrowUp');
      window.stepGame(1 / 60);
      const hv = Math.hypot(p.vel.x, p.vel.z);
      if (i < 90) continue;
      frames++; sumV += hv;
      for (let s = 0; s < 2; s++) {
        const an = s ? m.j.legR.an : m.j.legL.an;
        an.updateWorldMatrix(true, false);
        // lowest of heel / ball of the sole
        heel.set(0, -0.075, -0.06).applyMatrix4(an.matrixWorld); ball.set(0, -0.075, 0.15).applyMatrix4(an.matrixWorld);
        const k = heel.y < ball.y ? 0 : 1, lo = k ? ball : heel;
        T.add(s, lo, game.collision.groundHeight(lo.x, lo.z), 1 / 60, last[s][k]);
        last[s][0] = heel.clone(); last[s][1] = ball.clone();
      }
    }
    window.__CFG.ground.run = run0;
    game.input.down.delete('ArrowUp');
    const secs = frames / 60;
    out['v' + target] = { bodySpeed: +(sumV / frames).toFixed(2), ...T.report(frames, secs) };
  }
  return out;
});

if (scen.includes('titan')) await run('titan', () => {
  const B = window.__B, p = game.player, V = B.V;
  const out = {};
  for (const h of [5, 15]) {
    game.titans.clear?.();
    for (const t of [...game.titans.titans]) { t.dispose?.(); }
    game.titans.titans.length = 0;
    const gx = 0, gz = 60, gy = game.collision.groundHeight(gx, gz);
    p.reset(new V(gx, gy + 0.5, gz), 0);
    const t = game.titans.spawn({ kind: 'normal', height: h, position: new V(gx + 90, 0, gz + 10), yaw: -Math.PI / 2 });
    B.steps(90);
    const T = B.tracker(2, 0.07 * h / 5);
    const pt = new V(), last = [[], []];
    let frames = 0, sumV = 0, prev = t.position.clone();
    for (let i = 0; i < 360; i++) {
      p.pos.set(gx, gy + 0.5, gz); p.vel.set(0, 0, 0);       // stand still: bait
      window.stepGame(1 / 60);
      const v = Math.hypot(t.position.x - prev.x, t.position.z - prev.z) * 60; prev.copy(t.position);
      if (v < 0.3) continue;
      frames++; sumV += v;
      for (let s = 0; s < 2; s++) {
        const f = t.J[s ? 'footR' : 'footL'];
        f.updateWorldMatrix(true, false);
        let lo = null, k = 0;
        const pts = [0.0, 0.42, 1.0].map((z, j) => { const q = new V(0, -t.d.ankleH - 0.05, z).applyMatrix4(f.matrixWorld); if (!lo || q.y < lo.y) { lo = q; k = j; } return q; });
        T.add(s, lo, game.collision.groundHeight(lo.x, lo.z), 1 / 60, last[s][k]);
        last[s] = pts;
      }
    }
    // posture: head forward of the pelvis (fraction of height), spine lean
    t.root.updateMatrixWorld(true);
    const hd = t.J.head.getWorldPosition(new V()), pv = t.J.pelvis.getWorldPosition(new V());
    const fwd = new V(Math.sin(t.yaw), 0, Math.cos(t.yaw));
    out['h' + h] = { speed: +(sumV / Math.max(1, frames)).toFixed(2), runSpeed: +t.runSpeed.toFixed(2), frames, headAhead: +((hd.clone().sub(pv).dot(fwd)) / h).toFixed(3), ...T.report(frames, frames / 60) };
    t.dispose?.(); game.titans.titans.length = 0;
  }
  return out;
});

if (scen.includes('horse')) await run('horse', () => {
  const B = window.__B, p = game.player, V = B.V;
  const h = game.herd.horses[0];
  const out = {};
  for (const sp of [1.8, 5, 19]) {
    const gx = 205, gz = 150;          // a hillside in the field (≈4° along x)
    h.pos.set(gx, game.collision.groundHeight(gx, gz), gz); h.yaw = Math.PI / 2; h.speed = sp; h.rider = null; h.state = 'graze'; h.caller = null;
    p.reset(new V(gx - 30, game.collision.groundHeight(gx - 30, gz + 25) + 0.5, gz + 25), 0);   // the camera nearby: horses only animate in view range
    const T = B.tracker(4, 0.06);
    const pt = new V();
    let frames = 0, pitchErr = 0, slopeAbs = 0;
    for (let i = 0; i < 240; i++) {
      h.speed = sp; h.want.f = 0; h.state = 'walk'; h.t = 0; h.caller = null; h.home.copy(h.pos);
      if (Math.abs(h.pos.x - gx) > 25 && Math.sign(h.pos.x - gx) === Math.sign(Math.sin(h.yaw))) h.yaw += Math.PI;
      window.stepGame(1 / 60);
      h.speed = sp;
      if (i < 60) continue;
      frames++;
      h.root.updateMatrixWorld(true);
      h.legs.forEach((l, k) => {
        l.knee.updateWorldMatrix(true, false);
        pt.set(0, -0.63, l.front ? 0.02 : -0.07).applyMatrix4(l.knee.matrixWorld);
        T.add(k, pt.clone(), game.collision.groundHeight(pt.x, pt.z), 1 / 60);
      });
      // body pitch vs the ground slope under it
      const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw);
      const slope = Math.atan2(game.collision.groundHeight(h.pos.x + fx * 0.7, h.pos.z + fz * 0.7) - game.collision.groundHeight(h.pos.x - fx * 0.7, h.pos.z - fz * 0.7), 1.4);
      const q = new V(0, 0, 1).applyQuaternion(h.trunk.getWorldQuaternion(new h.root.quaternion.constructor()));
      pitchErr += Math.abs(Math.asin(q.y) - slope); slopeAbs += Math.abs(slope);
    }
    out['v' + sp] = { ...T.report(frames, frames / 60), meanSlope: +(slopeAbs / frames).toFixed(3), meanPitchVsSlope: +(pitchErr / frames).toFixed(3) };
  }
  return out;
});

if (scen.includes('rope')) await run('rope', () => {
  // flying fast past a trunk, a rope catches it point-blank behind you
  const B = window.__B, p = game.player, V = B.V, col = game.collision;
  p.reset(new V(0, 60, -200), 0); B.steps(5);
  const out = [];
  for (const [sp, off] of [[52.9, 2], [35, 3], [20, 4]]) {
    const anchor = new V(0, 40, -150);
    p.reset(new V(0, 40, -150 + off), 0);
    p.grounded = false; p.vel.set(0, 0, sp);
    // anchor point-blank behind (a beam we add for the test)
    const c = col.addSphere({ center: anchor.clone(), radius: 0.6, material: 'wood' });
    p.odm.fire(0, p.pos.clone(), anchor.clone().add(new V(0, 0, 0.5)));
    const speeds = [p.speed];
    game.input.down.add('Z');
    for (let i = 0; i < 90; i++) { window.stepGame(1 / 60); speeds.push(p.speed); }
    game.input.down.delete('Z'); p.odm.releaseAll(true);
    col.remove(c);
    let worst = 0, at = 0;
    for (let i = 1; i < speeds.length; i++) { const d = speeds[i - 1] - speeds[i]; if (d > worst) { worst = d; at = i; } }
    out.push({ approach: sp, worstFrameDrop: +worst.toFixed(1), from: +speeds[at - 1].toFixed(1), to: +speeds[at].toFixed(1), after05s: +speeds[30].toFixed(1), hp: +p.hp.toFixed(2) });
  }
  return out;
});

if (scen.includes('trunk')) await run('trunk', () => {
  const B = window.__B, p = game.player, V = B.V, col = game.collision;
  const out = [];
  for (const [sp, gap, hooked] of [[27, 1.05, true], [27, 1.05, false], [27, 6, true], [40, 3, false]]) {
    const tr = col.addCylinder({ x: 500, z: 500, y0: 0, y1: 120, radius: 3, material: 'bark' });
    const start = new V(500, 60, 500 - 3 - 0.5 - gap);
    p.reset(start, 0); p.grounded = false; p.vel.set(0, 0, sp); p.hp = 1;
    if (hooked) { p.odm.hooks[1].state = 'attached'; p.odm.hooks[1].anchor.set(520, 100, 470); p.odm.hooks[1].length = 80; p.odm.hooks[1].collider = null; }
    let dust = 0;
    const fxi = game.fx.impact; game.fx.impact = (...a) => { dust++; return fxi.apply(game.fx, a); };
    const speeds = [p.speed];
    let shake = 0;
    if (hooked) game.input.down.add('X');
    for (let i = 0; i < 30; i++) { window.stepGame(1 / 60); speeds.push(p.speed); shake = Math.max(shake, p.cam.trauma); }
    game.input.down.delete('X');
    game.fx.impact = fxi;
    let worst = 0, at = 1; for (let i = 1; i < speeds.length; i++) { const d = speeds[i - 1] - speeds[i]; if (d > worst) { worst = d; at = i; } }
    out.push({ speed: sp, gap, hooked, worstFrameDrop: +worst.toFixed(1), from: +speeds[at - 1].toFixed(1), to: +speeds[at].toFixed(1), shake: +shake.toFixed(2), dustFx: dust, hp: +p.hp.toFixed(3) });
    col.remove(tr); p.odm.releaseAll(true);
  }
  return out;
});

if (scen.includes('throw')) await run('throw', () => {
  const B = window.__B, p = game.player, V = B.V, h = game.herd.horses[1];
  // gallop at the wall (Wall Rose at z = 6) from the field side
  const gx = 60, gz = 9 + 19 * 0.4;
  h.pos.set(gx, 0, gz); h.yaw = Math.PI; h.speed = 19; h.rider = null; h.crashed = 0; h.mountCd = 0;
  p.reset(new V(gx, 2, gz), Math.PI);
  p.riding = h; h.rider = p; p.mounting = null;
  const log = [];
  for (let i = 0; i < 60; i++) {
    game.input.down.add('ArrowUp');
    window.stepGame(1 / 60);
    log.push({ riding: !!p.riding, v: +p.speed.toFixed(1), vy: +p.vel.y.toFixed(1), vz: +p.vel.z.toFixed(1), z: +p.pos.z.toFixed(2), y: +p.pos.y.toFixed(2), hs: +h.speed.toFixed(1) });
  }
  game.input.down.delete('ArrowUp');
  const k = log.findIndex((l) => !l.riding);
  return { horseSpeedBefore: log[Math.max(0, k - 1)]?.hs, thrown: log.slice(Math.max(0, k - 1), k + 6), peakAfter: Math.max(...log.slice(k).map((l) => l.v)) };
});

if (scen.includes('cape')) await run('cape', () => {
  const B = window.__B, p = game.player, V = B.V, m = p.model;
  const gx = 30, gz = 60, gy = game.collision.groundHeight(gx, gz);
  const capeStats = () => {
    // angle of the cape's centre line (pin row -> hem) from straight down, and how far the hem sticks out behind the back
    const P = m.cape.pos, c = 4, top = c * 3, bot = (9 * 9 + c) * 3;
    const dx = P[bot] - P[top], dy = P[bot + 1] - P[top + 1], dz = P[bot + 2] - P[top + 2];
    const L = Math.hypot(dx, dy, dz);
    return { fromVertical: +(Math.acos(Math.max(-1, Math.min(1, -dy / L))) * 180 / Math.PI).toFixed(1), hemOut: +Math.hypot(dx, dz).toFixed(2) };
  };
  p.reset(new V(gx, gy + 0.5, gz), 0); game.input.down.clear();
  B.steps(240);
  const rest = []; for (let i = 0; i < 60; i++) { window.stepGame(1 / 60); rest.push(capeStats().fromVertical); }
  // a landing from a 12 m drop
  p.reset(new V(gx, gy + 12, gz), 0); p.vel.set(0, -2, 6); p.grounded = false;
  const land = []; for (let i = 0; i < 120; i++) { window.stepGame(1 / 60); land.push(capeStats().fromVertical); }
  const g0 = land.findIndex((_, i) => i > 5 && p.grounded);
  return { restAngleMean: +(rest.reduce((a, b) => a + b, 0) / rest.length).toFixed(1), restAngleMax: Math.max(...rest), landingAngleMax: Math.max(...land), landingSeries: land.filter((_, i) => i % 6 === 0) };
});

await browser.close(); srv.close();
