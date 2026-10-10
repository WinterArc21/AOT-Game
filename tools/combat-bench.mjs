// Keyboard-only combat bot in the real Expedition (no rendering): steers with ← → toward the nearest titan,
// holds Z + X (the ropes auto-target titan shoulders), presses Space near the nape, Shift to boost in.
// Reports kills, deaths, grabs, cut attempts and nape hits.   node aot/tools/combat-bench.mjs [seconds=60]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { serve } from '../../tools/serve.mjs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const secs = +(process.argv[2] || 60);
const { srv, url } = await serve(ROOT);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message, (e.stack || '').split('\n').slice(1, 3).join(' | ')); });
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404') && !m.text().includes('dummies')) { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });
await page.goto(`${url}/aot/index.html?noaudio&norender&allies=0&play=expedition`);
await page.waitForFunction(() => window.READY === true, null, { timeout: 180000 });
await page.evaluate(() => { const c = window.__c = { kills: 0, hits: 0, nape: 0, grabs: 0, deaths: 0, titanHook: 0 };
  game.events.on('titan:killed', () => c.kills++); game.events.on('player:hit', (e) => { c.hits++; if (e.part === 'nape') c.nape++; });
  game.events.on('player:grabbed', () => c.grabs++); game.events.on('player:died', () => c.deaths++);
  game.events.on('hook:attach', (e) => { if (e.hit.collider.userData?.titan) c.titanHook++; }); });
const look = () => page.evaluate(() => {
  const p = game.player; let best = null, bd = 1e9;
  for (const t of game.titans?.titans || []) { if (!t.alive || t.kind === 'colossal') continue; const d = t.position.distanceTo(p.pos); if (d < bd) { bd = d; best = t; } }
  const out = { swoop: !!p.swooping, alive: p.alive, grabbed: !!p.grabbedBy, dist: bd, napeD: 1e9, ang: 0, wave: game.flow.wave, y: p.pos.y, v: p.speed, hooks: p.odm.hooks.map(h => h.state[0] + (h.attached && h.collider?.userData?.titan ? 'T' : '')).join(' '), tg: p.targets.map(T => T.valid ? (T.titan ? 'T' : T.collider?.type?.[0]) : '-').join(''), gr: p.grounded, th: best ? best.height.toFixed(0) : '' };
  if (best) { const nw = best.napeWorld(); out.napeD = nw.center.distanceTo(p.pos);
    const dx = best.position.x - p.pos.x, dz = best.position.z - p.pos.z; let a = Math.atan2(dx, dz) - p.yaw; out.ang = Math.atan2(Math.sin(a), Math.cos(a)); }
  return out; });
const step = (s) => page.evaluate((s) => { for (let t = 0; t < s; t += 1 / 60) window.stepGame(1 / 60); }, s);
await step(3);   // title card + first wave spawns
let t = 0, deadT = 0, holdT = 0;
const down = new Set();
const set = async (k, on) => { if (on && !down.has(k)) { await page.keyboard.down(k); down.add(k); } if (!on && down.has(k)) { await page.keyboard.up(k); down.delete(k); } };
while (t < secs) {
  const s = await look();
  if (!s.alive) {   // retry from the death screen like a player would
    for (const k of [...down]) await set(k, false);
    deadT += 0.5; await step(0.5); t += 0.5;
    if (deadT > 2) { await page.evaluate(() => game.flow.start('expedition')); await step(3); deadT = 0; }
    continue;
  }
  if (process.env.TRACE && Math.round(t * 100) % 50 < 15) console.log(t.toFixed(1), 'd', s.dist.toFixed(0), 'nape', s.napeD.toFixed(0), 'ang', s.ang.toFixed(2), 'y', s.y.toFixed(0), 'v', s.v.toFixed(0), 'hooks', s.hooks, 'tg', s.tg, s.gr ? 'G' : 'A', 'h', s.th);
  if (s.grabbed) { await page.keyboard.press('Space'); await step(0.08); t += 0.08; continue; }
  // steer toward the titan
  await set('ArrowLeft', s.ang > 0.25); await set('ArrowRight', s.ang < -0.25);
  await set('ArrowUp', true);
  const engage = s.dist < 105;
  await set('KeyZ', engage); await set('KeyX', engage);
  await set('ShiftLeft', engage && s.dist > 25);
  if (s.napeD < 14) await page.keyboard.press("Space");
  await step(0.15); t += 0.15;
  // like a person: let go after passing the nape, when stuck, or after ~1.6 s on ropes that aren't on a titan,
  // then fire fresh ropes (they re-target whatever is best now)
  holdT = down.has('KeyZ') ? holdT + 0.15 : 0;
  if (s.napeD < 4 || (s.v < 2 && engage) || (holdT > 1.6 && !s.swoop)) { await set('KeyZ', false); await set('KeyX', false); holdT = 0; await step(0.15); t += 0.15; }
}
const c = await page.evaluate(() => ({ ...window.__c, wave: game.flow.wave, score: game.flow.score }));
console.log(JSON.stringify({ secs, ...c, errors: errors.length }));
await browser.close(); srv.close();
