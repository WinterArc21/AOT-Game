// Keyboard-only bot in the real game (no rendering): holds ↑ and alternates the X and Z ropes with real key
// events, like a first-time player would, and reports how far it gets, how often ropes catch, altitude, stalls.
//   node aot/tools/keyboard-bench.mjs [seconds=40] [mode=free]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { serve } from '../../tools/serve.mjs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const secs = +(process.argv[2] || 40), mode = process.argv[3] || 'free';
const { srv, url } = await serve(ROOT);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message, (e.stack || '').split('\n').slice(1, 3).join(' | ')); });
page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });
await page.goto(`${url}/aot/index.html?noaudio&norender&allies=0&notitans&play=${mode}`);
await page.waitForFunction(() => window.READY === true, null, { timeout: 180000 });
await page.evaluate(() => { window.__fires = 0; window.__attach = 0; window.__none = 0; game.events.on('hook:attach', () => window.__attach++); game.events.on('hook:none', () => window.__none++); });
const step = (s) => page.evaluate((s) => { const out = []; for (let t = 0; t < s; t += 1 / 60) { window.stepGame(1 / 60); } const p = game.player; return { x: p.pos.x, y: p.pos.y, z: p.pos.z, v: p.speed, hp: p.hp, alive: p.alive, hooks: p.odm.hooks.map((h) => h.state[0]).join(''), tv: p.targets.map((t) => t.valid ? 1 : 0).join('') }; }, s);
const start = await step(0.2);
let ymin = 1e9, ymax = -1e9, vmax = 0, stall = 0, samples = 0, fires = 0, dist = 0, prev = start;
const keys = ['KeyX', 'KeyZ'];
await page.keyboard.down('ArrowUp');
for (let t = 0, i = 0; t < secs; i++) {
  const k = keys[i % 2];
  // hold a rope ~1.1 s, sometimes with gas, sometimes steering; then fly free 0.35 s
  await page.keyboard.down(k); fires++;
  if (i % 3 === 1) await page.keyboard.down('ShiftLeft');
  if (i % 5 === 3) await page.keyboard.down(i % 2 ? 'ArrowLeft' : 'ArrowRight');
  const a = await step(1.1); t += 1.1;
  await page.keyboard.up(k); await page.keyboard.up('ShiftLeft'); await page.keyboard.up('ArrowLeft'); await page.keyboard.up('ArrowRight');
  const b = await step(0.35); t += 0.35;
  for (const s of [a, b]) {
    ymin = Math.min(ymin, s.y); ymax = Math.max(ymax, s.y); vmax = Math.max(vmax, s.v); samples++;
    if (s.v < 2) stall++;
    dist += Math.hypot(s.x - prev.x, s.z - prev.z); prev = s;
  }
  if (!b.alive) break;
}
const end = await step(0.1);
const r = await page.evaluate(() => ({ attach: window.__attach, none: window.__none, kills: game.player.stats.kills }));
console.log(JSON.stringify({ mode, secs, start: [start.x, start.y, start.z].map((v) => v.toFixed(0)).join(','), end: [end.x, end.y, end.z].map((v) => v.toFixed(0)).join(','),
  pathMetres: Math.round(dist), y: `${ymin.toFixed(0)}..${ymax.toFixed(0)}`, vmax: +vmax.toFixed(1), ropePresses: fires, attaches: r.attach, noTarget: r.none,
  stalledSamples: `${stall}/${samples}`, hp: +end.hp.toFixed(2), alive: end.alive, errors: errors.length }));
await browser.close(); srv.close();
