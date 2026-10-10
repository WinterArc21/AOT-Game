// Per-system frame profile (JS only): which subsystem costs what, and its worst single call. node aot/tools/profile-bench.mjs [frames]
// Reports per-frame ms (p50 / p95 / p99 / max) and heap growth, the things that turn into hitches on a real GPU.
//   node aot/tools/frame-bench.mjs [frames=600]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { serve } from '../../tools/serve.mjs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const N = +(process.argv[2] || 600);
const { srv, url } = await serve(ROOT);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${url}/aot/index.html?noaudio&norender&play=expedition`);
await page.waitForFunction(() => window.READY === true, null, { timeout: 180000 });
const r = await page.evaluate((N) => {
  const T = {}; const wrap = (o, k, name) => { const f = o[k].bind(o); o[k] = (...a) => { const t = performance.now(); const r = f(...a); const d = performance.now() - t; const e = T[name] || (T[name] = { sum: 0, max: 0, n: 0, big: 0 }); e.sum += d; e.n++; if (d > e.max) e.max = d; if (d > 2) e.big++; return r; }; };
  wrap(game.player, "fixedUpdate", "player.fixed"); wrap(game.player, "update", "player.update"); wrap(game.titans, "update", "titans"); for (const a of game.allies) { wrap(a, "fixedUpdate", "ally.fixed"); wrap(a, "update", "ally.update"); wrap(a.model, "update", "ally.model"); wrap(a.model, "_footIK", "ally.footIK"); wrap(a.odm, "render", "ally.odmRender"); wrap(a.model.cape, "step", "ally.cape"); } wrap(game.herd, "fixedUpdate", "herd.fixed"); wrap(game.herd, "update", "herd.update"); wrap(game.flow, "update", "flow"); wrap(game.hud, "update", "hud"); wrap(game.fx, "update", "fx"); wrap(game.collision, "updateDynamic", "colDyn"); if (game.world?.update) wrap(game.world, "update", "world");
  const p = game.player;
  for (let i = 0; i < 300; i++) window.stepGame(1 / 60);            // waves spawn, squad rides out
  if (p.riding) p._leapOff(9);
  const ts = [], heap0 = performance.memory?.usedJSHeapSize || 0;
  let allocs = 0, last = heap0;
  for (let i = 0; i < N; i++) {
    // keep the player busy: fly at the nearest titan with both ropes
    game.input.down.add('ArrowUp'); if (i % 90 === 0) { game.input.pressed.add('Z'); game.input.pressed.add('X'); }
    game.input.down.add('Z'); game.input.down.add('X'); if (i % 90 > 70) { game.input.down.delete('Z'); game.input.down.delete('X'); }
    const t0 = performance.now(); window.stepGame(1 / 60); ts.push(performance.now() - t0);
    const h = performance.memory?.usedJSHeapSize || 0; if (h > last) allocs += h - last; last = h;
  }
  ts.sort((a, b) => a - b);
  const q = (f) => +ts[Math.min(ts.length - 1, Math.floor(ts.length * f))].toFixed(2);
  for (const k in T) { T[k].sum = +T[k].sum.toFixed(0); T[k].max = +T[k].max.toFixed(1); }
  return { T, frames: N, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: +ts[ts.length - 1].toFixed(2), allocMBperSec: +((allocs / 1e6) / (N / 60)).toFixed(2), titans: game.titans.titans.length, allies: game.allies.length };
}, N);
console.log(JSON.stringify(r));
await browser.close(); srv.close();
