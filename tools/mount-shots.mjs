// Contact sheet of the horse mounts, filmed side-on: node aot/tools/mount-shots.mjs <run|air> <out.png> [horseSpeed=0]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { serve } from '../../tools/serve.mjs';
import path from 'node:path';
import fs from 'node:fs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const [kind = 'run', out = 'mount.png', hs = '0'] = process.argv.slice(2);
const { srv, url } = await serve(ROOT);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${url}/aot/index.html?noaudio&notitans&noallies&play=free`);
await page.waitForFunction(() => window.READY === true, null, { timeout: 240000 });
const data = await page.evaluate(async ({ kind, hs }) => {
  const p = game.player, h = game.herd.horses[0], V = p.pos.constructor;
  game.autoQuality = () => {};
  game.hud.root.style.display = 'none';
  // an open patch of field
  const gx = 30, gz = 120, gy = game.collision.groundHeight(gx, gz);
  h.pos.set(gx, gy, gz); h.yaw = 0; h.speed = +hs; h.state = 'graze'; h.t = 0; h.mountCd = 0; h.rider = null; h.home.copy(h.pos);
  if (kind === 'run') { p.reset(new V(gx + 7, gy + 0.5, gz - 1.5 - +hs * 0.4), -Math.PI / 2 + 0.25); for (let i = 0; i < 20; i++) window.stepGame(1 / 60); }
  else { p.reset(new V(gx, gy + 7, gz - 4 - +hs * 0.6), 0); p.vel.set(0, -2, 4 + +hs); p.grounded = false; }
  p.mountCd = 0;
  game.noRender = true;
  const frames = [];
  const sheet = document.createElement('canvas'); sheet.width = 4 * 300; sheet.height = 3 * 225;
  const ctx = sheet.getContext('2d'); ctx.font = '14px sans-serif'; ctx.fillStyle = '#fff';
  let shots = 0, t = 0, mountedAt = -1;
  for (let i = 0; i < 400 && shots < 12; i++) {
    if (kind === 'run' && !p.riding) game.input.down.add('ArrowUp'); else game.input.down.delete('ArrowUp');
    window.stepGame(1 / 60); t += 1 / 60;
    if (p.riding && mountedAt < 0) mountedAt = t;
    const since = mountedAt < 0 ? -1 : t - mountedAt;
    const want = kind === 'run' ? [-0.25, 0, 0.08, 0.16, 0.24, 0.32, 0.4, 0.48, 0.56, 0.64, 0.75, 1.0] : [-0.5, -0.3, -0.12, 0, 0.05, 0.1, 0.15, 0.22, 0.32, 0.45, 0.6, 0.9];
    const cond = kind === 'air' && mountedAt < 0 ? (shots < 3 && (p.pos.y - h.pos.y) < [6.6, 5, 3.6][shots]) : since >= want[shots] - 1e-6 && since >= 0;
    if (cond) {
      // side-on camera from the horse's right
      const c = game.camera; const hp = h.pos;
      if (kind === 'run') { c.position.set(hp.x + 3.6, hp.y + 2.6, hp.z - 4.2); c.lookAt(hp.x + 0.3, hp.y + 1.7, hp.z); } else { c.position.set(hp.x + 6.5, hp.y + 3, hp.z - 1.5); c.lookAt(hp.x, hp.y + 2.6, hp.z + 0.5); } c.fov = 45; c.updateProjectionMatrix();
      game.renderer.render(game.scene, c);
      const x = (shots % 4) * 300, y = Math.floor(shots / 4) * 225;
      ctx.drawImage(game.renderer.domElement, x, y, 300, 225);
      ctx.fillText(`${since < 0 ? 'pre' : since.toFixed(2) + 's'} ${p.mounting ? 'q=' + (p.mounting.t / p.mounting.dur).toFixed(2) : p.riding ? 'seated' : ''}`, x + 6, y + 18);
      shots++;
    }
  }
  return { png: sheet.toDataURL('image/png'), mountedAt, riding: !!p.riding, prewarmMs: game.titans?.prewarmMs };
}, { kind, hs });
fs.writeFileSync(out, Buffer.from(data.png.split(',')[1], 'base64'));
console.log('saved', out, 'mountedAt', data.mountedAt, 'riding', data.riding);
await browser.close(); srv.close();
