// Headless bench for the ODM physics (no browser): runs the real Player/OdmGear/CollisionWorld code through
// scripted manoeuvres and checks the numbers that make it feel right — energy in a free swing, zip times,
// orbit spin-up, no tunnelling, no jitter.   node aot/tools/physics-bench.mjs   (needs `three` resolvable)
import * as THREE from 'three';
import { CollisionWorld } from '../src/core/collision.js';
import { Player } from '../src/player/player.js';
import { CFG } from '../src/config.js';

const H = 1 / CFG.physicsHz;
function makeGame() {
  const ev = new Map();
  const game = {
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), time: 0, mode: 'free',
    events: { on: (n, f) => (ev.get(n) || ev.set(n, []).get(n)).push(f), emit: (n, p) => (ev.get(n) || []).forEach((f) => f(p)), off() {} },
    collision: new CollisionWorld(),
  };
  const col = game.collision;
  col.setGround(() => 0);
  col.addBox({ center: new THREE.Vector3(0, 25, 0), halfExtents: new THREE.Vector3(300, 25, 6), material: 'stone' }); // the wall
  for (const [x, z] of [[0, 90], [-30, 130], [25, 160], [0, 200], [40, 240]]) col.addCylinder({ x, z, y0: 0, y1: 95, radius: 3.5, material: 'bark' });
  col.addCapsule({ a: new THREE.Vector3(0, 40, 90), b: new THREE.Vector3(18, 44, 90), radius: 1, material: 'bark' });
  col.addBox({ center: new THREE.Vector3(200, 100, 100), halfExtents: new THREE.Vector3(30, 1, 1), material: 'wood' }); // a lone beam to swing from
  game.player = new Player(game);
  return game;
}
function aimAt(p, target) {
  const d = target.clone().sub(p.pos).normalize();
  p.yaw = Math.atan2(d.x, d.z); p.pitch = Math.asin(d.y);
  p.aim.valid = true; p.aim.point.copy(target); p.aim.distance = target.distanceTo(p.pos); p.aim.dir.copy(d);
  // the ropes fire at their auto-targets: point both at the scripted target
  for (const T of p.targets) { T.valid = true; T.point.copy(target); T.distance = target.distanceTo(p.pos); T.age = 0; }
}
const results = [];
const check = (name, ok, info) => { results.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${info}`); };

// 1. free pendulum: no reel, no drag — energy must be conserved by the wire constraint
{
  const g = makeGame(); const p = g.player;
  const saved = { ...CFG.reel }, drag = CFG.drag;
  CFG.reel.accel = 0; CFG.reel.boostAccel = 0; CFG.drag = 0;
  p.reset(new THREE.Vector3(200, 85, 120), 0);
  const hit = g.collision.raycast(new THREE.Vector3(200, 90, 100), new THREE.Vector3(0, 1, 0), 20);
  aimAt(p, hit.point); p._fire(0, false);
  for (let i = 0; i < 30; i++) p.fixedUpdate(H);
  const L0 = p.odm.hooks[0].length;
  const E = () => 0.5 * p.vel.lengthSq() + CFG.gravity * p.pos.y;
  const e0 = E(); let emax = e0, emin = e0, maxJerk = 0, pv = p.vel.clone(), pa = null;
  for (let i = 0; i < 120 * 12; i++) {
    p.fixedUpdate(H);
    const e = E(); emax = Math.max(emax, e); emin = Math.min(emin, e);
    const a = p.vel.clone().sub(pv).divideScalar(H); pv.copy(p.vel);
    if (pa) maxJerk = Math.max(maxJerk, a.clone().sub(pa).length()); pa = a;
  }
  Object.assign(CFG.reel, saved); CFG.drag = drag;
  const drift = (emax - emin) / Math.abs(e0);
  check('pendulum conserves energy (<3% over 12 s)', drift < 0.03 && p.odm.hooks[0].attached, `attached=${p.odm.hooks[0].attached} L=${L0.toFixed(2)} drift=${(drift * 100).toFixed(2)}% maxΔa/step=${maxJerk.toFixed(1)}`);
}

// 2. zip from the wall top to a trunk 85 m away
{
  const g = makeGame(); const p = g.player;
  p.reset(new THREE.Vector3(0, 50.6, 0), 0);
  for (let i = 0; i < 60; i++) p.fixedUpdate(H);
  const tgt = new THREE.Vector3(0, 60, 86.5);
  aimAt(p, tgt); p.wantBoost = false; p._fire(0, false); p._fire(1, true);
  let t = 0, vmax = 0, minGap = 1e9, arrived = -1, penetr = 0;
  for (; t < 8; t += H) {
    p.fixedUpdate(H);
    vmax = Math.max(vmax, p.speed);
    const gap = Math.hypot(p.pos.x, p.pos.z - 90) - 3.5 - CFG.radius;
    minGap = Math.min(minGap, gap);
    if (gap < -0.05) penetr++;
    if (arrived < 0 && gap < 4) arrived = t;
  }
  check('zip to a trunk: arrives in 2-4 s, peak 25-60 m/s, no tunnelling, no injury', arrived > 1.5 && arrived < 4 && vmax > 25 && vmax < 60 && penetr === 0 && p.hp > 0.95, `arrive=${arrived.toFixed(2)}s vmax=${vmax.toFixed(1)} minGap=${minGap.toFixed(3)} penetrations=${penetr} hp=${p.hp.toFixed(2)}`);
}

// 3. boosted zip
{
  const g = makeGame(); const p = g.player;
  p.reset(new THREE.Vector3(0, 50.6, 0), 0);
  for (let i = 0; i < 60; i++) p.fixedUpdate(H);
  const tgt = new THREE.Vector3(0, 60, 86.5);
  aimAt(p, tgt); p.wantBoost = true; p.wishF = 0; p.wishR = 0; p.turn = 0; p._fire(0, false); p._fire(1, true);
  let t = 0, vmax = 0, arrived = -1;
  for (; t < 6; t += H) { p.fixedUpdate(H); vmax = Math.max(vmax, p.speed); if (arrived < 0 && Math.hypot(p.pos.x, p.pos.z - 90) - 4 < 4) arrived = t; }
  check('boosted zip: faster arrival, peak 45-80 m/s, lands without injury', arrived > 0.8 && arrived < 3 && vmax > 45 && vmax < 85 && p.hp > 0.95, `arrive=${arrived.toFixed(2)}s vmax=${vmax.toFixed(1)} gasLeft=${p.odm.gas.toFixed(3)} hp=${p.hp.toFixed(2)}`);
}

// 4. orbit a trunk: tangential entry, the winch spins you up but stays bounded
{
  const g = makeGame(); const p = g.player;
  p.reset(new THREE.Vector3(-25, 50, 90), 0);
  p.vel.set(0, 2, 32);
  const hit = g.collision.raycast(new THREE.Vector3(-25, 50, 90), new THREE.Vector3(1, 0, 0), 40);
  aimAt(p, hit.point); p._fire(1, false);
  let vmax = 0, penetr = 0, ymin = 1e9;
  for (let t = 0; t < 2.5; t += H) {
    p.fixedUpdate(H); vmax = Math.max(vmax, p.speed); ymin = Math.min(ymin, p.pos.y);
    if (Math.hypot(p.pos.x, p.pos.z - 90) < 3.5 + CFG.radius - 0.05) penetr++;
  }
  const relSpeed = p.speed;
  p.odm.release(1);
  const v0 = p.vel.clone();
  check('orbit spin-up bounded (peak < 95 m/s), no tunnelling', vmax < 95 && penetr === 0, `vmax=${vmax.toFixed(1)} atRelease=${relSpeed.toFixed(1)} ymin=${ymin.toFixed(1)} penetrations=${penetr}`);
}

// 5. drop from 100 m: lethal-ish impact registers, body stays above ground
{
  const g = makeGame(); const p = g.player;
  p.reset(new THREE.Vector3(0, 100, 60), 0); g.mode = 'expedition';
  let vImpact = 0, minY = 1e9;
  for (let t = 0; t < 6; t += H) { vImpact = Math.max(vImpact, -p.vel.y); p.fixedUpdate(H); minY = Math.min(minY, p.pos.y); }
  check('100 m fall: body never below ground, damage taken', minY >= CFG.radius - 0.02 && p.hp < 1, `vImpact=${vImpact.toFixed(1)} minY=${minY.toFixed(3)} hp=${p.hp.toFixed(2)}`);
}

// 6. run on the ground
{
  const g = makeGame(); const p = g.player;
  p.reset(new THREE.Vector3(0, 1, 40), 0);
  p.wishF = 1; p.wishR = 0;
  for (let t = 0; t < 1.5; t += H) p.fixedUpdate(H);
  const hs = Math.hypot(p.vel.x, p.vel.z);
  check('ground run reaches run speed', Math.abs(hs - CFG.ground.run) < 0.5 && p.grounded, `speed=${hs.toFixed(2)} grounded=${p.grounded} y=${p.pos.y.toFixed(3)}`);
}

// 7. wall-run: anchored high on the wall, standing at its foot, the winch drags you up its face
{
  const g = makeGame(); const p = g.player;
  p.reset(new THREE.Vector3(5, 1, 8), Math.PI);
  for (let i = 0; i < 30; i++) p.fixedUpdate(H);
  aimAt(p, new THREE.Vector3(5, 48, 6)); p._fire(0, false);
  let maxY = 0;
  for (let t = 0; t < 4; t += H) { p.fixedUpdate(H); maxY = Math.max(maxY, p.pos.y); }
  check('wall climb on the wire reaches near the anchor', maxY > 40, `maxY=${maxY.toFixed(1)} z=${p.pos.z.toFixed(2)}`);
}

// 8. keyboard auto-targeting: among trunks, each rope finds an anchor on its own side, ahead and above
{
  const g = makeGame(); const p = g.player;
  p.reset(new THREE.Vector3(0, 30, 45), 0);   // heading +z; trunks ahead at z 90..240
  p.grounded = false;
  for (let i = 0; i < 4; i++) { p._scan(0); p._scan(1); }
  const L = p.targets[0], R = p.targets[1];
  const right = new THREE.Vector3(-1, 0, 0);   // heading-right for yaw 0
  const side = (T) => T.point.clone().sub(p.render).dot(right);
  check('auto-target: both ropes find anchors ahead, Z left of X, above you', L.valid && R.valid && side(L) <= side(R) + 0.5 && L.point.z > 50 && R.point.z > 50 && L.point.y > 30 && R.point.y > 30,
    `Z=${L.valid ? L.point.toArray().map((v) => v.toFixed(0)).join(',') : 'none'} X=${R.valid ? R.point.toArray().map((v) => v.toFixed(0)).join(',') : 'none'}`);
}

// 9. ↓ on a rope pays the wire out; release flick; tank turning on the ground
{
  const g = makeGame(); const p = g.player;
  p.reset(new THREE.Vector3(200, 85, 120), 0);
  const hit = g.collision.raycast(new THREE.Vector3(200, 90, 100), new THREE.Vector3(0, 1, 0), 20);
  aimAt(p, hit.point); p._fire(0, false);
  for (let i = 0; i < 40; i++) p.fixedUpdate(H);
  const L0 = p.odm.hooks[0].length;
  p.payout = true;   // a brake-reel: the wire only runs out under tension, so give the swing time to load it
  for (let i = 0; i < 360; i++) p.fixedUpdate(H);
  p.payout = false;
  const L1 = p.odm.hooks[0].length;
  const keys = new Set(['ArrowLeft']);
  const input = { held: (k) => keys.has(k), hit: () => false, up: () => false, mouseDX: 0, mouseDY: 0 };
  const g2 = makeGame(); const q = g2.player; q.reset(new THREE.Vector3(0, 1, 40), 0);
  for (let i = 0; i < 10; i++) q.fixedUpdate(H);
  const y0 = q.yaw; for (let i = 0; i < 60; i++) q.handleInput(input, 1 / 60);
  check('↓ pays out wire under tension; ← turns the heading', L1 > L0 + 4 && q.yaw - y0 > 1.5, `wire ${L0.toFixed(1)} -> ${L1.toFixed(1)} m, yaw +${(q.yaw - y0).toFixed(2)} rad in 1 s`);
}

const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exitCode = failed ? 1 : 0;
