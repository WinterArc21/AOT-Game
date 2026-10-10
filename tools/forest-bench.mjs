// Flies soldiers through the real Forest of Giant Trees with the real physics (no rendering) and reports
// how they move: altitude band, speed, time anchored, canopy passes, stalls, and any tunnelling.
//   node aot/tools/forest-bench.mjs [seconds=60]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { serve } from '../../tools/serve.mjs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const secs = +(process.argv[2] || 60);
const { srv, url } = await serve(ROOT);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)); });
await page.goto(`${url}/aot/index.html?noaudio&norender&notitans&allies=5`);
await page.waitForFunction(() => window.READY === true, null, { timeout: 180000 });
const r = await page.evaluate((secs) => {
  const col = game.collision;
  const st = game.allies.map(() => ({ ymin: 1e9, ymax: -1e9, vmax: 0, vsum: 0, n: 0, anch: 0, foliage: 0, stall: 0, inside: 0, zmin: 1e9, zmax: -1e9 }));
  for (let k = 0; k < secs * 60; k++) {
    window.stepGame(1 / 60);
    game.allies.forEach((a, i) => {
      const s = st[i], p = a.pos, v = a.vel.length();
      s.ymin = Math.min(s.ymin, p.y); s.ymax = Math.max(s.ymax, p.y); s.vmax = Math.max(s.vmax, v); s.vsum += v; s.n++;
      s.zmin = Math.min(s.zmin, p.z); s.zmax = Math.max(s.zmax, p.z);
      if (a.odm.attachedCount()) s.anch++;
      if (game.world.inFoliage?.(p)) s.foliage++;
      if (v < 1.5) s.stall++;
      for (const c of col.collideSphere(p, 0.3, { dynamic: false })) if (c.depth > 0.35 && c.collider.type !== 'ground') { s.inside++; break; }
    });
  }
  return st.map((s) => ({ y: `${s.ymin.toFixed(0)}..${s.ymax.toFixed(0)}`, z: `${s.zmin.toFixed(0)}..${s.zmax.toFixed(0)}`, vavg: +(s.vsum / s.n).toFixed(1), vmax: +s.vmax.toFixed(1), anchored: +(s.anch / s.n).toFixed(2), canopyFrames: s.foliage, stalledFrames: s.stall, deepPenetrationFrames: s.inside }));
}, secs);
console.table(r);
await browser.close(); srv.close();
