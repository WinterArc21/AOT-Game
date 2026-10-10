// Squad bench: an Expedition where the player just hangs back on the wall-side field and the comrades work.
// Logs the radio/kill feed and counts pair kills, ankle cuts, grabs, rescues.   node aot/tools/squad-bench.mjs [secs=120]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { serve } from '../../tools/serve.mjs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const SECS = +(process.argv[2] || 120);
const { srv, url } = await serve(ROOT);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${url}/aot/index.html?noaudio&norender&play=expedition`);
await page.waitForFunction(() => window.READY === true, null, { timeout: 180000 });
const r = await page.evaluate((SECS) => {
  const feed = [], c = { allyKills: 0, playerKills: 0, ankles: 0, grabbed: 0, freed: 0, eaten: 0 };
  const f0 = game.hud.feed.bind(game.hud);
  game.hud.feed = (text, kind, who) => { feed.push(`${(game.time).toFixed(1)} ${who ? who + ': ' : ''}${text}`); f0(text, kind, who); };
  game.events.on('titan:killed', (e) => (e.by ? c.allyKills++ : c.playerKills++));
  for (const k of ['grabbed', 'freed', 'eaten']) game.events.on('ally:' + k, () => c[k]++);
  const p = game.player;
  for (let i = 0; i < 60 * SECS; i++) {
    // ride out for 8 s, then stop the horse and stay put (immortal) so the squad does the work
    if (i < 480) game.input.down.add("ArrowUp"); else { game.input.down.delete("ArrowUp"); if (p.riding) p._leapOff(2); }
    p.hp = 1; p.grabImmune = 1;
    window.stepGame(1 / 60);
    for (const t of game.titans.titans) if (t.crippleT > 7.9 && !t._ck) { t._ck = 1; c.ankles++; }
    if (i % 600 === 0) feed.push(`  [${(game.time).toFixed(0)}] ` + game.allies.map((a) => `${a.name}:${a.horse ? "H" : ""}${a.job ? a.job.role + (a.job.wait ? "w" : "") + (a.job.escape > 0 ? "e" : "") + Math.round(a.pos.distanceTo(a.job.titan.position)) : "-"}cd${a.jobCd.toFixed(0)}`).join(" ") + " T:" + game.titans.titans.filter((t) => t.alive).map((t) => Math.round(t.position.distanceTo(p.pos)) + t.state[0]).join(","));
  }
  return { c, wave: game.flow.wave, allies: game.allies.filter((a) => a.alive).length, feed };
}, SECS);
console.log(JSON.stringify(r.c), 'wave', r.wave, 'alliesAlive', r.allies);
console.log(r.feed.join('\n'));
await browser.close(); srv.close();
