// Mount bench: running vault onto a free horse, dropping onto one from the air, and whistling a horse over.
//   node aot/tools/mount-bench.mjs
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { serve } from '../../tools/serve.mjs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const { srv, url } = await serve(ROOT);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${url}/aot/index.html?noaudio&norender&notitans&noallies&play=free`);
await page.waitForFunction(() => window.READY === true, null, { timeout: 180000 });
const r = await page.evaluate(() => {
  const p = game.player, out = {};
  const f = (v) => +v.toFixed(2);
  const horse = game.herd.horses[0];
  const placeNear = (dx, dy, dz) => {
    p.odm.releaseAll?.(true); if (p.riding) p._leapOff(0); p.mountCd = 0;
    horse.mountCd = 0; horse.speed = 0; horse.caller = null;
    const gy = game.collision.groundHeight(horse.pos.x + dx, horse.pos.z + dz);
    p.pos.set(horse.pos.x + dx, Math.max(gy + 0.5, horse.pos.y + dy), horse.pos.z + dz); p.prev.copy(p.pos); p.vel.set(0, 0, 0);
  };
  // 1) run into it from the side
  placeNear(-4, 0.5, 0); p.yaw = Math.PI / 2;
  const trace = []; let t0 = -1, t = 0;
  for (let i = 0; i < 120; i++) {
    game.input.down.add('ArrowUp'); window.stepGame(1 / 60); t += 1 / 60;
    if (p.riding && t0 < 0) t0 = t;
    if (p.riding && i % 4 === 0) trace.push([f(t - t0), f(p.pos.y - horse.pos.y), f(p.rideStand), p.mounting ? 'M' : 'S']);
    if (t0 > 0 && t - t0 > 0.9) break;
  }
  game.input.down.delete('ArrowUp');
  out.run = { mounted: !!p.riding, trace };
  // 2) drop onto it from 3 m up while it trots
  placeNear(0, 4.2, 0); horse.speed = 5; p.vel.set(0, -9, 0);
  const tr2 = []; let jMax = 0;
  for (let i = 0; i < 50; i++) { window.stepGame(1 / 60); jMax = Math.max(jMax, horse._dip()); if (i % 3 === 0) tr2.push([f(p.pos.y - horse.pos.y), f(p.rideStand), p.mounting ? 'M' : p.riding ? 'S' : '-']); }
  out.air = { mounted: !!p.riding, dipMax: f(jMax), horseSpeed: f(horse.speed), trace: tr2 };
  // 3) whistle from 120 m away
  p._leapOff(0); for (let i = 0; i < 90; i++) window.stepGame(1 / 60);
  p.pos.x += 120; p.prev.copy(p.pos); p.pos.y = game.collision.groundHeight(p.pos.x, p.pos.z) + 1; p.vel.set(0, 0, 0);
  const d0 = horse.pos.distanceTo(p.pos); p.lastHorse = horse;
  game.input.pressed.add('F'); window.stepGame(1 / 60);
  let tArr = -1, maxSp = 0;
  for (let i = 0; i < 60 * 20; i++) { window.stepGame(1 / 60); maxSp = Math.max(maxSp, horse.speed); if (!horse.caller) { tArr = i / 60; break; } }
  out.whistle = { d0: f(d0), arrivedIn: f(tArr), endDist: f(Math.hypot(horse.pos.x - p.pos.x, horse.pos.z - p.pos.z)), maxSpeed: f(maxSp) };
  return out;
});
console.log(JSON.stringify(r, null, 0).replace(/\],\[/g, '] ['));
await browser.close(); srv.close();
