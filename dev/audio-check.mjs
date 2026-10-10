// Headless audio check for the Wings of Freedom audio engine.
//   node aot/dev/audio-check.mjs [--offline]
// 1. loads aot/dev/audio-test.html, calls every API method before init (must be no-ops) and after init (strict mode)
// 2. verifies no page errors and that one-shot voices are all released (no leaks)
// 3. with --offline: renders every effect / music intensity with an OfflineAudioContext and prints peak/RMS stats.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { serve } from '../../tools/serve.mjs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OFFLINE = process.argv.includes('--offline');
const { srv, url } = await serve(ROOT);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => { errors.push('pageerror: ' + e.message); console.log('[pageerror]', e.message, e.stack?.split('\n').slice(0, 3).join(' | ')); });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { errors.push(m.type() + ': ' + m.text()); console.log(`[console.${m.type()}]`, m.text()); } });
await page.goto(`${url}/aot/dev/audio-test.html`);
await page.waitForFunction(() => !!window.audio);

const CALLS = (p) => [
  ['setListener', [p, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 }]],
  ['hookFire', [0]], ['hookFire', [1]], ['hookHit', ['wood']], ['hookHit', ['bark']], ['hookHit', ['stone']], ['hookHit', ['flesh']],
  ['hookHit', ['roof']], ['hookHit', ['metal']], ['hookHit', ['ground']], ['hookHit', ['bogus']], ['hookHit', ['wood', { x: 30, y: 10, z: -80 }]],
  ['hookRetract', [0]], ['hookRetract', [1]], ['hookMiss', []],
  ['setReel', [0.5]], ['setReel', [1]], ['setReel', [0]], ['setGas', [1]], ['setGas', [0.3]], ['setGas', [0]], ['setWind', [3]], ['setWind', [40]], ['setWind', [90]], ['setWind', [0]],
  ['slash', [false]], ['slash', [true]], ['napeKill', []], ['bladeBreak', []], ['bladeSwap', []], ['refill', []],
  ['impact', [0.1]], ['impact', [1]], ['land', [0.2]], ['land', [1]], ['grabbed', []], ['eaten', []], ['hurt', []],
  ['titanStep', [p, 3]], ['titanStep', [p, 15]], ['titanStep', [p, 60]], ['titanGroan', [p, 3]], ['titanGroan', [p, 15]], ['titanGroan', [p, 60]],
  ['titanFall', [p, 3]], ['titanFall', [p, 15]], ['titanFall', [p, 60]], ['steamHiss', [p, 3]], ['steamHiss', [p, 15]], ['steamHiss', [p, 60]],
  ['titanStep', [{ x: 5000, y: 0, z: 5000 }, 15]], ['titanStep', [undefined, undefined]], ['titanGroan', [null, NaN]],
  ['colossalAppear', []],
  ['setMusic', [0]], ['setMusic', [0.4]], ['setMusic', [0.8]], ['setMusic', [1]], ['setMusic', [NaN]], ['setMusic', [0.5]],
  ['toggleMute', []], ['toggleMute', []],
];

// 1) before init: everything must be a silent no-op
const pre = await page.evaluate((calls) => {
  const a = new window.AudioEngine();
  const bad = [];
  for (const [name, args] of calls) {
    try { a[name](...args); } catch (e) { bad.push(name + ': ' + e.message); }
  }
  return bad;
}, CALLS({ x: 12, y: 0, z: -30 }));
console.log('before init, exceptions:', pre.length ? pre : 'none');

// 2) after init (strict): every method, music sweep, wait for voices to drain
const live = await page.evaluate(async (calls) => {
  const a = window.audio;
  const bad = [];
  if (!a.init()) return { bad: ['init() failed'] };
  a.strict = true;
  await new Promise((r) => setTimeout(r, 400));
  const t0 = performance.now();
  for (const [name, args] of calls) {
    try { a[name](...args); } catch (e) { bad.push(name + ': ' + e.message); }
    await new Promise((r) => setTimeout(r, 30));
  }
  const peakVoices = a._total;
  a.setMusic(0.2);
  for (const i of [0, 0.3, 0.5, 0.9, 1, 0.6]) { a.setMusic(i); await new Promise((r) => setTimeout(r, 1200)); }
  // stop loops and let all one-shots expire (longest is the Colossal, ~9 s)
  a.setMusic(0); a.setReel(0); a.setGas(0); a.setWind(0);
  const musicRigs = a._rigsLive;
  a.music.stop(); // stop scheduling new notes, let everything already queued ring out
  await new Promise((r) => setTimeout(r, 11000));
  return { bad, state: a.state, peakVoices, musicRigs, liveRigs: a._rigsLive, leftOver: a._total + a._rigsLive, hrtf: a._hrtf, active: { ...a._active }, muted: a.muted, ms: Math.round(performance.now() - t0) };
}, CALLS({ x: 12, y: 0, z: -30 }));
console.log('after init:', JSON.stringify(live));

// 3) offline renders
if (OFFLINE) {
  const stats = await page.evaluate(async () => {
    const SR = 44100;
    const res = {};
    const analyse = (buf, win = 1) => {
      const L = buf.getChannelData(0), R = buf.getChannelData(1);
      let peak = 0, sum = 0, tPeak = 0;
      const per = [];
      const wl = Math.floor(SR * win);
      let ws = 0;
      for (let i = 0; i < L.length; i++) {
        const v = Math.max(Math.abs(L[i]), Math.abs(R[i]));
        if (v > peak) { peak = v; tPeak = i / SR; }
        const e = 0.5 * (L[i] * L[i] + R[i] * R[i]);
        sum += e; ws += e;
        if ((i + 1) % wl === 0) { per.push(+Math.sqrt(ws / wl).toFixed(3)); ws = 0; }
      }
      const bad = L.some((x) => !Number.isFinite(x));
      return { peak: +peak.toFixed(3), rms: +Math.sqrt(sum / L.length).toFixed(4), tPeak: +tPeak.toFixed(2), per, nan: bad };
    };
    const make = async (secs, setup, manual = true) => {
      const off = new OfflineAudioContext(2, Math.floor(SR * secs), SR);
      const a = new window.AudioEngine();
      a.strict = true;
      setup.pre && setup.pre(a);
      a.init({ context: off, manual });
      a.setListener({ x: 0, y: 1.7, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
      setup.run(a);
      const buf = await off.startRendering();
      return analyse(buf, setup.win || 1);
    };
    const P = { x: 25, y: 0, z: -40 };
    const one = {
      hookFire: (a) => a.hookFire(0), hookHit_wood: (a) => a.hookHit('wood'), hookHit_bark: (a) => a.hookHit('bark'), hookHit_stone: (a) => a.hookHit('stone'),
      hookHit_flesh: (a) => a.hookHit('flesh'), hookHit_roof: (a) => a.hookHit('roof'), hookHit_metal: (a) => a.hookHit('metal'), hookHit_ground: (a) => a.hookHit('ground'),
      hookRetract: (a) => a.hookRetract(1), hookMiss: (a) => a.hookMiss(), slash_miss: (a) => a.slash(false), slash_hit: (a) => a.slash(true),
      napeKill: (a) => a.napeKill(), bladeBreak: (a) => a.bladeBreak(), bladeSwap: (a) => a.bladeSwap(), refill: (a) => a.refill(),
      impact_1: (a) => a.impact(1), impact_3: (a) => a.impact(0.3), land_1: (a) => a.land(1), grabbed: (a) => a.grabbed(), eaten: (a) => a.eaten(), hurt: (a) => a.hurt(),
      step_3: (a) => a.titanStep(P, 3), step_15: (a) => a.titanStep(P, 15), step_60: (a) => a.titanStep(P, 60),
      groan_3: (a) => a.titanGroan(P, 3), groan_15: (a) => a.titanGroan(P, 15), groan_60: (a) => a.titanGroan(P, 60),
      fall_15: (a) => a.titanFall(P, 15), fall_60: (a) => a.titanFall(P, 60), steam_15: (a) => a.steamHiss(P, 15), steam_5: (a) => a.steamHiss(P, 5),
      colossal: (a) => a.colossalAppear(),
    };
    for (const [k, fn] of Object.entries(one)) res['sfx ' + k] = await make(k === 'colossal' ? 12 : 4, { run: fn });
    // loops
    for (const lv of [0.3, 1]) {
      res['reel ' + lv] = await make(2.5, { pre: (a) => a.setReel(lv), run: () => {} });
      res['gas ' + lv] = await make(2.5, { pre: (a) => a.setGas(lv), run: () => {} });
    }
    for (const v of [4, 20, 50, 80]) res['wind ' + v] = await make(3, { pre: (a) => a.setWind(v), run: () => {} });
    // music at several intensities, a whole 8-bar cycle (12.8 s) plus a tail
    for (const i of [0, 0.2, 0.4, 0.65, 0.9, 1]) {
      res['music ' + i] = await make(14, { pre: (a) => a.setMusic(i), run: (a) => a.music.pump(14.2), win: 2 });
    }
    return res;
  });
  console.log('\noffline render stats (peak/rms measured after limiter, max of L/R):');
  for (const [k, v] of Object.entries(stats)) {
    console.log(k.padEnd(22), 'peak', String(v.peak).padEnd(6), 'rms', String(v.rms).padEnd(7), 'tPeak', String(v.tPeak).padEnd(5), v.nan ? 'NaN!' : '', k.startsWith('music') ? 'per2s ' + v.per.join(' ') : '');
  }
}

await browser.close();
srv.close();
const failed = errors.filter((e) => !/GPU stall|swiftshader|WebGL/i.test(e)).length + (pre.length ? 1 : 0) + (live.bad ? live.bad.length : 0) + (live.leftOver ? 1 : 0);
console.log(failed ? `\nFAIL (${failed} problems)` : '\nOK: no exceptions, no leaked voices');
process.exit(failed ? 1 : 0);
