// Contact sheets of the animation, filmed with a fixed side-on camera that tracks the subject.
//   node tools/filmstrip.mjs <scene> <out.png> [arg]
// scenes: run [speed=11] · titan [height=5] · horse [speed=19] · grab [height=7] · idle · cape · land · throw
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { serve } from './serve.mjs';
import path from 'node:path';
import fs from 'node:fs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const [scene = 'run', out = '/tmp/strip.png', arg = ''] = process.argv.slice(2);
const { srv, url } = await serve(ROOT);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 480, height: 360 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message, (e.stack || '').split('\n').slice(1, 3).join(' | ')));
const titans = scene === 'titan' || scene === 'grab';
await page.goto(`${url}/index.html?noaudio&noallies&play=free${titans ? '' : '&notitans'}`);
await page.waitForFunction(() => window.READY === true, null, { timeout: 240000 });
await page.evaluate(async () => { window.__CFG = (await import('./src/config.js')).CFG; });
const data = await page.evaluate(async ({ scene, arg }) => {
  const p = game.player, V = p.pos.constructor, col = game.collision, cam = game.camera;
  game.autoQuality = () => {};
  game.hud.root.style.display = 'none';
  game.noRender = true;
  const W = 300, H = 225, COLS = 4, ROWS = 3;
  const sheet = document.createElement('canvas'); sheet.width = COLS * W; sheet.height = ROWS * H;
  const ctx = sheet.getContext('2d'); ctx.font = '13px sans-serif'; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
  let shots = 0;
  const snap = (label, pos, side, dist, height, lookY = 0, fov = 40) => {
    // side: unit horizontal vector from the subject to the camera
    cam.position.set(pos.x + side.x * dist, pos.y + height, pos.z + side.z * dist);
    cam.lookAt(pos.x, pos.y + lookY, pos.z); cam.fov = fov; cam.updateProjectionMatrix();
    game.renderer.render(game.scene, cam);
    const x = (shots % COLS) * W, y = Math.floor(shots / COLS) * H;
    ctx.drawImage(game.renderer.domElement, x, y, W, H);
    ctx.strokeText(label, x + 6, y + 18); ctx.fillText(label, x + 6, y + 18);
    shots++;
  };
  const step = (n = 1) => { for (let i = 0; i < n; i++) window.stepGame(1 / 60); };
  const info = {};
  if (scene === 'run' || scene === 'idle') {
    const v = scene === 'idle' ? 0 : +(arg || 11);
    const gx = 30, gz = 60, gy = col.groundHeight(gx, gz);
    p.reset(new V(gx, gy + 0.5, gz), Math.PI / 2);
    if (v) window.__CFG.ground.run = v;
    step(30);
    for (let i = 0; i < 400 && shots < 12; i++) {
      if (v) game.input.down.add('ArrowUp');
      step(1);
      if (i >= 90 && (i - 90) % (v ? 2 : 20) === 0) {
        const r = p.model.root.position, hd = new V(Math.sin(p.yaw), 0, Math.cos(p.yaw));
        const side = new V(-hd.z, 0, hd.x);
        if (scene === 'idle') { const s2 = shots < 6 ? side : hd.clone().multiplyScalar(0.8).add(side.clone().multiplyScalar(0.6)).normalize(); snap(`idle t=${((i - 90) / 60).toFixed(2)}`, r, s2, 3.2, 0.1, -0.1, 40); }
        else snap(`v=${p.speed.toFixed(1)} t=${((i - 90) / 60).toFixed(3)}`, r, side, 4.5, 0.1, -0.2, 40);
      }
    }
    game.input.down.delete('ArrowUp');
  } else if (scene === 'cape' || scene === 'land') {
    const gx = 30, gz = 60, gy = col.groundHeight(gx, gz);
    p.reset(new V(gx, gy + (scene === 'land' ? 12 : 0.5), gz), 0);
    if (scene === 'land') { p.vel.set(0, -2, 6); p.grounded = false; }
    let landed = -1;
    for (let i = 0; i < 400 && shots < 12; i++) {
      step(1);
      if (p.grounded && landed < 0 && i > 5) landed = i;
      const r = p.model.root.position, hd = new V(Math.sin(p.yaw), 0, Math.cos(p.yaw)), side = new V(-hd.z, 0, hd.x);
      if (scene === 'cape' && i >= 120 && (i - 120) % 15 === 0) snap(`rest ${((i - 120) / 60).toFixed(2)}s`, r, shots % 2 ? side : side.clone().multiplyScalar(0.5).sub(hd).normalize(), 3.4, 0.2, -0.1);
      if (scene === 'land' && landed >= 0 && (i - landed) % 4 === 0 && i - landed < 48) snap(`landing +${((i - landed) / 60).toFixed(2)}s`, r, side, 4, 0.4, -0.2);
    }
  } else if (scene === 'titan') {
    const h = +(arg || 5);
    const gx = 0, gz = 60, gy = col.groundHeight(gx, gz);
    p.reset(new V(gx, gy + 0.5, gz), 0);
    const t = game.titans.spawn({ kind: 'normal', height: h, position: new V(gx + 90, 0, gz + 10), yaw: -Math.PI / 2 });
    step(90);
    let lastX = t.position.x;
    for (let i = 0; i < 600 && shots < 12; i++) {
      p.pos.set(gx, gy + 0.5, gz); p.vel.set(0, 0, 0);
      step(1);
      if (i % (h > 10 ? 9 : 6) === 0) {
        const hd = new V(Math.sin(t.yaw), 0, Math.cos(t.yaw)), side = new V(-hd.z, 0, hd.x);
        const vel = (lastX - t.position.x) * 60 / (h > 10 ? 9 : 6); lastX = t.position.x;
        snap(`${h} m  ${t.state} v=${t.speed.toFixed(1)}`, t.position, side, h * 2.1, h * 0.5, h * 0.48, 40);
      }
    }
    info.state = t.state;
  } else if (scene === 'horse') {
    const v = +(arg || 19);
    const hz = game.herd.horses[0];
    const gx = 40, gz = 40;
    hz.pos.set(gx, col.groundHeight(gx, gz), gz); hz.yaw = Math.PI / 2; hz.speed = v; hz.rider = null; hz.caller = null;
    p.reset(new V(-300, 50.6, 0), 0);
    for (let i = 0; i < 400 && shots < 12; i++) {
      hz.speed = v; hz.want.f = 0; hz.state = 'walk'; hz.t = 0; hz.caller = null; hz.home.copy(hz.pos);
      step(1);
      if (i >= 60 && (i - 60) % (v > 10 ? 2 : 4) === 0) {
        const hd = new V(Math.sin(hz.yaw), 0, Math.cos(hz.yaw)), side = new V(-hd.z, 0, hd.x);
        snap(`horse v=${hz.speed.toFixed(1)} ph=${(hz.phase % 1).toFixed(2)}`, hz.pos, side, 6, 1.0, 1.0, 40);
      }
    }
  } else if (scene === 'grab') {
    const h = +(arg || 7);
    const gx = 0, gz = 60, gy = col.groundHeight(gx, gz);
    p.reset(new V(gx, gy + 0.5, gz), 0);
    const t = game.titans.spawn({ kind: 'normal', height: h, position: new V(gx, 0, gz + h * 0.42), yaw: Math.PI });
    step(10);
    t._catch(0);
    for (let i = 0; i < 140 && shots < 12; i++) {
      step(1);
      if (i % 12 === 0) {
        // alternate: the game's own camera, and a side view of the hand
        if (shots % 2 === 0) { game.renderer.render(game.scene, cam); const x = (shots % COLS) * W, y = Math.floor(shots / COLS) * H; ctx.drawImage(game.renderer.domElement, x, y, W, H); ctx.strokeText(`game cam t=${(i / 60).toFixed(2)}`, x + 6, y + 18); ctx.fillText(`game cam t=${(i / 60).toFixed(2)}`, x + 6, y + 18); shots++; }
        else { const hd = new V(Math.sin(t.yaw), 0, Math.cos(t.yaw)), side = new V(-hd.z, 0, hd.x).add(hd).normalize(); snap(`hand t=${(i / 60).toFixed(2)} grabbed=${!!p.grabbedBy}`, p.render, side, 4.5, 0.5, 0, 40); }
      }
    }
  } else if (scene === 'throw') {
    const h = game.herd.horses[1];
    const gx = 60, gz = 9 + 19 * 0.9;
    h.pos.set(gx, 0, gz); h.yaw = Math.PI; h.speed = 19; h.rider = null; h.crashed = 0; h.mountCd = 0;
    p.reset(new V(gx, 2, gz), Math.PI); p.riding = h; h.rider = p; p.mounting = null;
    for (let i = 0; i < 200 && shots < 12; i++) {
      game.input.down.add('ArrowUp'); step(1);
      if (i % 4 === 0 && i > 8) snap(`t=${(i / 60).toFixed(2)} v=${p.speed.toFixed(1)}${p.riding ? ' riding' : ''}`, p.render, new V(1, 0, 0), 9, 1.5, 0.5, 45);
    }
    game.input.down.delete('ArrowUp');
  }
  return { png: sheet.toDataURL('image/png'), ...info };
}, { scene, arg });
fs.writeFileSync(out, Buffer.from(data.png.split(',')[1], 'base64'));
console.log('saved', out, JSON.stringify({ ...data, png: undefined }));
await browser.close(); srv.close();
