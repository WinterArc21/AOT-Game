// Drives the real game in headless Chromium: scripted ODM flight with real key/mouse events, screenshots on the way.
//   node aot/tools/play-bench.mjs [query=play=free] [outDir] [WxH]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { serve } from '../../tools/serve.mjs';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const [query = 'play=free', out = '/tmp/aot-shots', size = '1280x720'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
fs.mkdirSync(out, { recursive: true });
const { srv, url } = await serve(ROOT);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message, (e.stack || '').split('\n').slice(1, 3).join(' | ')); });
page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 300)); } });
await page.goto(`${url}/aot/index.html?${query}&noaudio`);
await page.waitForFunction(() => window.READY === true, null, { timeout: 120000 });
const state = () => page.evaluate(() => { const p = game.player; return { pos: p.pos.toArray().map((v) => +v.toFixed(1)), speed: +p.speed.toFixed(1), hooks: p.odm.hooks.map((h) => h.state), gas: +p.odm.gas.toFixed(2), hp: +p.hp.toFixed(2), fps: +(game.fps || 0).toFixed(1), aim: p.aim.valid, mode: game.mode, titans: game.titans?.titans?.length ?? -1, calls: game.renderer.info.render.calls, tris: game.renderer.info.render.triangles }; });
const look = (yaw, pitch) => page.evaluate(([y, p]) => { game.player.yaw = y; game.player.pitch = p; }, [yaw, pitch]);
// drive frames deterministically at 60 fps regardless of how slow SwiftShader is
const run = (seconds) => page.evaluate((s) => { for (let t = 0; t < s; t += 1 / 60) window.stepGame(1 / 60); }, seconds);
const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.png`, timeout: 120000 }); console.log('shot', name, JSON.stringify(await state())); };

await page.mouse.move(W / 2, H / 2);
await page.waitForTimeout(1500);
await page.evaluate(() => { game.input.mouseDX = 0; game.input.mouseDY = 0; });
await shot('00-start');
if (query.includes('play=')) {
  await run(0.5);
  await look(0, -0.05); await run(0.3);
  await shot('01-wall-view');
  // hook toward the forest with both wires, boosting
  await look(0.08, 0.06); await run(0.1);
  await page.mouse.down({ button: 'right' });
  await page.keyboard.down('Space');
  await run(0.9); await shot('02-zip');
  await run(0.9); await shot('03-zip-late');
  await page.keyboard.up('Space');
  await page.mouse.up({ button: 'right' });
  await run(0.4); await shot('04-release');
  // swing: single hook to the right, pumping
  await look(-0.6, 0.35); await page.keyboard.down('KeyE'); await page.keyboard.down('KeyW');
  await run(1.2); await shot('05-swing');
  await page.keyboard.up('KeyE'); await page.keyboard.up('KeyW');
  await look(0.5, 0.3); await page.keyboard.down('KeyQ'); await page.keyboard.down('Space');
  await run(1.0); await shot('06-swing-left');
  await page.keyboard.up('KeyQ'); await page.keyboard.up('Space');
  await run(0.6); await shot('07-air');
  await page.mouse.down({ button: 'left' }); await run(0.2); await page.mouse.up({ button: 'left' });
  await run(1.5); await shot('08-later');
}
console.log('errors:', errors.length);
await browser.close();
srv.close();
