// Titan counters bench: a titan grabbing your wire (held on / let go / cut with Space), shaking off a soldier
// hanging on its body, and an abnormal charging a rider.   node aot/tools/counter-bench.mjs
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { serve } from '../../tools/serve.mjs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const { srv, url } = await serve(ROOT);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
await page.goto(`${url}/aot/index.html?noaudio&norender&noallies&play=free`);
await page.waitForFunction(() => window.READY === true, null, { timeout: 180000 });
const r = await page.evaluate(async () => {
  const p = game.player, T = game.titans, V = p.pos.constructor, out = {};
  const { CFG } = await import('./src/config.js');
  const ev = []; for (const k of ['player:wireGrabbed', 'player:grabbed', 'player:wireCut', 'player:shaken', 'player:trampled']) game.events.on(k, () => ev.push(k));
  const clear = () => { for (const t of T.titans) { t.aiEnabled = false; t.position.set(5000, 0, 5000); } };
  const swoop = CFG.combat.swoopRange;
  const field = new V(0, 0, 300);
  const fresh = (kind, h, at, yaw) => { clear(); const t = T.spawn({ kind, height: h, position: at.clone(), yaw }); t.position.y = game.collision.groundHeight(at.x, at.z); return t; };
  const resetP = (pos) => { p.reset(pos, Math.PI); p.grabImmune = 0; T.grabBlockT = 0; ev.length = 0; for (let i = 0; i < 5; i++) window.stepGame(1 / 60); };
  // --- wire grab: hang 18 m in front of a 12 m titan on a rope in its chest; behaviour by `mode`
  const yankCase = (mode) => {
    CFG.combat.swoopRange = 0;
    const gy = game.collision.groundHeight(field.x, field.z);
    const t = fresh('normal', 12, field, 0);
    resetP(new V(field.x + 2, gy + 8, field.z + 18));
    for (let i = 0; i < 10; i++) window.stepGame(1 / 60);
    t.aiEnabled = true; t.state = 'chase'; t.cdAttack = 0; t.cdYank = 0;
    const chest = new V().setFromMatrixPosition(t.J.spine.matrixWorld);
    p.odm.fire(0, p.pos, chest);
    game.input.down.add('Z');
    const rnd = t.rnd; t.rnd = () => 0.001;
    let st = '', heldAt = -1, t0 = 0;
    for (let i = 0; i < 60 * 5; i++) {
      window.stepGame(1 / 60); t0 += 1 / 60;
      if (t.state !== st) { st = t.state; }
      if (heldAt < 0 && p.odm.hooks[0].yank) heldAt = t0;
      if (heldAt > 0 && t0 - heldAt > 0.3) {
        if (mode === 'cut' && !ev.includes('player:wireCut')) game.input.pressed.add('Space');
        if (mode === 'letgo') game.input.down.delete('Z');
      }
      if (p.grabbedBy || (heldAt > 0 && t0 - heldAt > 2.5)) break;
    }
    t.rnd = rnd; game.input.down.delete('Z');
    const res = { heldAt: +heldAt.toFixed(2), grabbed: !!p.grabbedBy, events: [...ev], titanState: t.state };
    if (p.grabbedBy) { p._escapeGrab(); }
    CFG.combat.swoopRange = swoop;
    return res;
  };
  out.yankHold = yankCase('hold');
  out.yankCut = yankCase('cut');
  out.yankLetGo = yankCase('letgo');
  // --- shake: dangling right against its body on a short rope
  {
    CFG.combat.swoopRange = 0;
    const gy = game.collision.groundHeight(field.x, field.z);
    const t = fresh('normal', 12, field, 0);
    resetP(new V(field.x + 4.5, gy + 7, field.z + 1));
    t.aiEnabled = true; t.state = 'chase'; t.cdAttack = 0; t.cdYank = 99;
    const chest = new V().setFromMatrixPosition(t.J.spine.matrixWorld);
    p.odm.fire(0, p.pos, chest); game.input.down.add('Z');
    let shookAt = -1;
    const ss = []; for (let i = 0; i < 60 * 4; i++) { window.stepGame(1 / 60); if (!ss.length || !ss[ss.length - 1].startsWith(t.state)) ss.push(t.state + '@' + (i / 60).toFixed(2)); if (t.state === 'shake' && shookAt < 0) shookAt = i / 60; if (ev.includes('player:shaken')) break; }
    game.input.down.delete('Z');
    out.shake = { ss: ss.join(' '), shookAt: +shookAt.toFixed(2), events: [...ev], attached: p.odm.attachedCount(), vel: p.vel.toArray().map((x) => +x.toFixed(1)) };
    CFG.combat.swoopRange = swoop;
  }
  // --- charge: gallop at an abnormal 90 m ahead
  {
    const h = game.herd.horses[0];
    const gy = game.collision.groundHeight(field.x, field.z);
    const t = fresh('abnormal', 8, new V(field.x, 0, field.z - 60), 0);
    t.crawler = false; t.crawlW = 0; t.cdLeap = 99;
    resetP(new V(field.x, gy + 2, field.z + 30));
    h.pos.set(field.x, gy, field.z + 30); h.yaw = Math.PI; h.speed = 15; h.rider = null; h.mountCd = 0;
    p.riding = h; h.rider = p; p.mounting = null;
    t.aiEnabled = true; t.state = 'chase'; t.cdCharge = 0;
    let st = [], minD = 1e9;
    game.input.down.add('ArrowUp');
    for (let i = 0; i < 60 * 8; i++) {
      window.stepGame(1 / 60);
      if (st[st.length - 1] !== t.state) st.push(t.state);
      minD = Math.min(minD, Math.hypot(t.position.x - h.pos.x, t.position.z - h.pos.z));
      if (ev.includes('player:trampled') && !p.riding && i > 30) break;
    }
    game.input.down.delete('ArrowUp');
    out.charge = { states: st.join('>'), minDist: +minD.toFixed(1), events: [...ev], riding: !!p.riding, hp: +p.hp.toFixed(2), titanTopSpeed: +(t.runSpeed * 2.2).toFixed(1) };
  }
  return out;
});
console.log(JSON.stringify(r));
await browser.close(); srv.close();
