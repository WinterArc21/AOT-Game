// The nape fight, measured: one titan at a time in Free Flight, a keyboard bot that runs at it, ropes it (Z + X),
// rides the swoop round the neck and cuts. Different bots time the cut differently, so the numbers show whether
// skill matters (a well-timed cut from behind kills, an early swing or none at all doesn't), and how often the
// titan answers (slaps at its neck, hunches, whirls round), so no two approaches go the same way.
//   node tools/nape-bench.mjs [trials=6] [sizes=5,8,12,15] [bots=timed,sloppy,early,none]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { serve } from './serve.mjs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const trials = +(process.argv[2] || 6);
const sizes = (process.argv[3] || '5,8,12,15').split(',').map(Number);
const bots = (process.argv[4] || 'timed,sloppy,early,none').split(',');
const { srv, url } = await serve(ROOT);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
const errors = [];
page.on('console', (m) => { if (process.env.TRACE) console.log(m.text()); });
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message, (e.stack || '').split('\n').slice(1, 3).join(' | ')); });
await page.goto(`${url}/index.html?noaudio&norender&noallies&play=free`);
await page.waitForFunction(() => window.READY === true, null, { timeout: 240000 });

const TRACE = process.env.TRACE || '';
const runTrial = (o) => page.evaluate(async ({ size, bot, seed, TRACE }) => {
  const g = game, p = g.player, inp = g.input, V = p.pos.constructor;
  let s = seed >>> 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  g.titans.clear();
  const tp = new V(rnd() * 80 - 40, 0, 90 + rnd() * 30);
  const t = g.titans.spawn({ kind: 'normal', height: size, position: tp, yaw: rnd() * 6.28 });
  const a = rnd() * 6.28, R = 55 + rnd() * 15;
  const sp = new V(tp.x + Math.sin(a) * R, 0, Math.max(14, tp.z + Math.cos(a) * R));
  sp.y = g.collision.groundHeight(sp.x, sp.z) + 0.6;
  p.reset(sp, Math.atan2(tp.x - sp.x, tp.z - sp.z));
  p.infiniteGas = true;
  const key = (k, on) => { if (on) { if (!inp.down.has(k)) inp.pressed.add(k); inp.down.add(k); } else if (inp.down.has(k)) { inp.down.delete(k); inp.released.add(k); } };
  const press = (k) => { inp.pressed.add(k); };
  const r = { kill: false, time: 0, napeHits: 0, shallow: 0, cuts: 0, guard: {}, slapped: 0, grabbed: 0, died: false, angle: [], speedAtHit: [], timing: [], passes: [] };
  let passMin = 1e9, passV = 0;
  const onHit = (e) => { if (e.titan !== t) return; if (e.part === 'nape') { r.napeHits++; r.angle.push(+(e.result?.angle ?? 1).toFixed(2)); r.speedAtHit.push(+(e.result?.speed ?? 0).toFixed(0)); r.timing.push(+(e.result?.timing ?? 1).toFixed(2)); if (e.result?.effect === 'shallow') r.shallow++; } };
  const onSlap = () => r.slapped++;
  const onGrab = () => r.grabbed++;
  g.events.on('player:hit', onHit); g.events.on('player:slapped', onSlap); g.events.on('player:grabbed', onGrab);
  let jitter = null, lastLeg = 0, holding = false, lastState = '', ropeT = 0, lastD = 1e9, pressedAt = -9, mashT = 0, earlyDone = false;
  const dt = 1 / 60;
  for (let f = 0; f < 60 * 30; f++) {
    const time = f * dt;
    if (!t.alive) { r.kill = true; r.time = +time.toFixed(2); break; }
    if (!p.alive) { r.died = true; break; }
    if (t.state !== lastState) { if (t.state === 'guard') r.guard[t.act?.kind] = (r.guard[t.act?.kind] || 0) + 1; lastState = t.state; }
    if (p.grabbedBy) { if (f % 6 === 0) press('Space'); for (const k of ['Z', 'X', 'ArrowUp', 'ShiftLeft']) key(k, false); window.stepGame(dt); continue; }
    const nw = t.napeWorld();
    const rel = nw.center.clone().sub(p.pos), d = rel.length();
    const dx = t.position.x - p.pos.x, dz = t.position.z - p.pos.z;
    let ang = Math.atan2(dx, dz) - p.yaw; ang = Math.atan2(Math.sin(ang), Math.cos(ang));
    const onTitan = p.odm.hooks.some((h) => h.attached && h.collider?.userData?.titan === t);
    // steer at the titan until roped on; in the swoop, pick a side once and hold it briefly
    if (!p.swooping) { key('ArrowLeft', ang > 0.2); key('ArrowRight', ang < -0.2); }
    else { key('ArrowLeft', false); key('ArrowRight', false); }
    key('ArrowUp', true);
    // fire both ropes when the markers are on the titan; a pair that misses (or winds back) is let go and re-fired
    const onMarker = p.targets.some((T) => T.valid && T.titan === t);
    if (!holding && onMarker && d < 95 && p.odm.hooks.every((h) => h.state === 'idle')) holding = true;
    else if (holding && p.odm.hooks.every((h) => h.state === 'idle' || h.state === 'retracting')) holding = false;
    const engage = holding;
    key('Z', engage); key('X', engage);
    key('ShiftLeft', bot !== 'none' && (p.swoopLeg >= 2 || (engage && !onTitan && d > 30)));
    // the cut
    const closing = -rel.dot(p.vel.clone().sub(t.velocity || new V())) / Math.max(d, 1e-3);
    // when (and how close) the nape will pass, from the relative velocity
    const vr = p.vel.clone().sub(t.velocity || new V()), vr2 = Math.max(vr.lengthSq(), 1e-6);
    const tStar = rel.dot(vr) / vr2, dMin = rel.clone().addScaledVector(vr, -tStar).length();
    if (bot === 'timed' || bot === 'sloppy') {
      // a skilled player swings so the middle of the sweep (0.15 s in) meets the nape as it passes; a sloppy one is
      // up to 0.15 s early or late
      if (jitter === null) jitter = bot === 'sloppy' ? (rnd() - 0.5) * 0.3 : 0;
      if (tStar > 0 && dMin < 3.5 && Math.abs(tStar - 0.15 - jitter) < 0.02 && time - pressedAt > 0.35) { press('Space'); pressedAt = time; r.cuts++; jitter = null; }
    } else if (bot === 'early') {
      if (d < 14 && !earlyDone && p.swooping) { press('Space'); earlyDone = true; pressedAt = time; r.cuts++; }
      if (d > 20) earlyDone = false;
    } else if (bot === 'mash') {
      mashT += dt; if (d < 20 && mashT > 0.25) { press('Space'); mashT = 0; r.cuts++; }
    }
    // a person lets go after passing the nape, or when stuck, and fires fresh ropes
    ropeT = onTitan ? ropeT + dt : 0;
    if ((d < 5 && d > lastD + 0.02 && lastLeg >= 2) || ropeT > 6 || (p.speed < 1.5 && onTitan)) { key('Z', false); key('X', false); holding = false; ropeT = 0; window.stepGame(dt); window.stepGame(dt); }
    if (d < passMin) { passMin = d; passV = closing; }
    if (passMin < 10 && d > passMin + 3) { r.passes.push(passMin.toFixed(1) + '@' + passV.toFixed(0)); passMin = 1e9; }
    lastD = d; lastLeg = p.swoopLeg;
    if (TRACE && f % (+TRACE || 15) === 0) console.log(time.toFixed(2), 'd', d.toFixed(1), 'v', p.speed.toFixed(0), 'leg', p.swoopLeg, 'side', p._swoopSide, 'hooks', p.odm.hooks.map((h) => h.state[0] + (h.attached && h.collider?.userData?.titan ? 'T' : '')).join(''), 'tst', t.state, 'y', p.pos.y.toFixed(1), 'ty', nw.center.y.toFixed(1), 'gr', p.grounded ? 1 : 0, 'along', rel.dot(nw.normal).toFixed(1) * -1, 'tyaw', t.yaw.toFixed(2), 'hr', Math.hypot(rel.x, rel.z).toFixed(1), 'vel', p.vel.x.toFixed(0) + ',' + p.vel.y.toFixed(0) + ',' + p.vel.z.toFixed(0));
    window.stepGame(dt);
  }
  if (!r.kill && !r.died) r.time = 30;
  g.events.off?.('player:hit', onHit); g.events.off?.('player:slapped', onSlap); g.events.off?.('player:grabbed', onGrab);
  for (const k of [...inp.down]) key(k, false);
  window.stepGame(1 / 60);
  return r;
}, { ...o, TRACE });

const out = {};
for (const bot of bots) for (const size of sizes) {
  const rows = [];
  for (let i = 0; i < trials; i++) rows.push(await runTrial({ size, bot, seed: 1000 + i * 77 + size }));
  const kills = rows.filter((x) => x.kill);
  const sum = (f) => rows.reduce((a, x) => a + f(x), 0);
  const guard = {}; for (const x of rows) for (const [k, v] of Object.entries(x.guard)) guard[k] = (guard[k] || 0) + v;
  out[`${bot} ${size}m`] = {
    kills: `${kills.length}/${rows.length}`,
    meanTimeToKill: kills.length ? +(kills.reduce((a, x) => a + x.time, 0) / kills.length).toFixed(1) : null,
    timeSpread: kills.length ? [Math.min(...kills.map((x) => x.time)), Math.max(...kills.map((x) => x.time))] : null,
    napeHits: sum((x) => x.napeHits), shallow: sum((x) => x.shallow), cuts: sum((x) => x.cuts),
    guard, slapped: sum((x) => x.slapped), grabbed: sum((x) => x.grabbed), died: sum((x) => (x.died ? 1 : 0)),
    angles: rows.flatMap((x) => x.angle).slice(0, 12), hitSpeeds: rows.flatMap((x) => x.speedAtHit).slice(0, 12), timing: rows.flatMap((x) => x.timing).slice(0, 12), passes: rows.flatMap((x) => x.passes).slice(0, 16),
  };
  console.log(`${bot} ${size}m`, JSON.stringify(out[`${bot} ${size}m`]));
}
console.log(JSON.stringify({ errors: errors.length }));
await browser.close(); srv.close();
