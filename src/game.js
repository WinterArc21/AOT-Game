// Game flow: the title flyover, the Expedition (waves of titans, the Colossal on wave 3), the Training Grounds
// (cut every wooden dummy against the clock), Free Flight, score and combos, and the in-game tutorial.
import * as THREE from 'three';

const WAVES = [
  { msg: 'WAVE 1 — TITANS IN THE FIELD', field: 4, forest: 0, town: 0, abnormal: 0, sizes: [4, 9] },
  { msg: 'WAVE 2 — THEY ARE COMING FROM THE FOREST', field: 3, forest: 3, town: 0, abnormal: 1, sizes: [5, 13] },
  { msg: 'WAVE 3', field: 2, forest: 0, town: 3, abnormal: 1, sizes: [4, 12], colossal: true },
  { msg: 'WAVE 4 — THE FOREST OF GIANT TREES', field: 1, forest: 6, town: 0, abnormal: 2, sizes: [6, 15] },
];

// Tutorial steps: each shows until the player has actually done it (or 14 s pass).
const STEPS = [
  { id: 'horse', keys: ['↑', 'Shift'], text: 'On horseback: ↑ gallop, ← → steer. Shift stands up and leaps off; Z / X fire a rope straight off the horse', done: (p) => !p.riding, when: (p) => !!p.riding },
  { id: 'rope', keys: ['X'], text: 'Hold X to fire your right rope at the X marker', done: (p) => p.odm.attachedCount() > 0 },
  { id: 'zip', keys: ['Z', 'X'], text: 'Hold Z and X together to zip forward between both anchors', done: (p) => p.odm.attachedCount() === 2 },
  { id: 'steer', keys: ['←', '→'], text: 'Steer with the arrows. Let go of Z / X to fly free, then grab the next anchor', done: (p, s) => s.steerT > 0.6 },
  { id: 'gas', keys: ['Shift'], text: 'Hold Shift for a gas boost (tap it on the ground to jump)', done: (p, s) => s.boostT > 0.6 },
  { id: 'cut', keys: ['Space'], text: 'Space cuts. Hit the nape on the back of the neck, fast', done: (p, s) => s.cuts > 0, modes: ['training', 'expedition'] },
  { id: 'aim', keys: ['←', '→', 'C'], text: 'Ropes go where you face: turn to put the marker on the tree you want. C skips to the next anchor', done: (p, s) => s.steerT > 1.5 },
  { id: 'slack', keys: ['↓'], text: 'On a rope, hold ↓ to let the wire out for a longer swing', done: (p, s) => s.payoutT > 0.5 },
];

const NO_ANCHOR = { id: 'no-anchor', keys: ['↑', 'Shift'], text: 'Nothing in rope range yet: run toward the trees or titans (Shift jumps the parapet)' };

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked: records just aren't kept */ } },
};

export class Game {
  constructor(game) {
    this._spawnQ = []; this._spawnT = 0;
    this.g = game;
    this.wave = 0; this.score = 0; this.combo = 1; this.comboT = 0;
    this.waveClear = 0; this.run = 0;
    this.hint = null;
    this.tut = { step: 0, t: 0, doneT: 0, steerT: 0, boostT: 0, payoutT: 0, cuts: 0, seen: new Set() };
    const ev = game.events;
    ev.on('titan:killed', (e) => this._onKill(e));
    ev.on('player:hit', (e) => this._onHit(e));
    ev.on('player:died', (e) => this._onDeath(e));
    ev.on('titan:step', (e) => this._onStep(e));
    ev.on('training:cut', (e) => this._onCut(e));
    ev.on('colossal:appear', () => {
      game.hud?.message?.('THE COLOSSAL TITAN HAS APPEARED', 4.5, 'big');
      game.player.cam.trauma = 1;
      this.colossal = true;
    });
    ev.on('player:grabbed', () => game.hud?.message?.('GRABBED! MASH SPACE TO CUT FREE', 2.2, 'warn'));
    ev.on('player:escaped', () => game.hud?.message?.('CUT FREE!', 1.2, 'info'));
    // the squad on the radio
    ev.on('ally:grabbed', (e) => {
      game.hud?.feed?.(`It's got me — HELP!`, 'warn', e.ally.name);
      game.hud?.message?.(`${e.ally.name.toUpperCase()} IS GRABBED — CUT THE HAND OR THE NAPE!`, 2.6, 'warn');
    });
    ev.on('ally:freed', (e) => {
      game.hud?.feed?.(this.g.player.alive ? 'Thanks — I owe you one!' : 'I\'m out!', 'radio', e.ally.name);
      if (this.g.mode === 'expedition') { this.score += 300; game.hud?.message?.('COMRADE SAVED  +300', 1.6, 'info'); }
    });
    ev.on('ally:eaten', (e) => game.hud?.feed?.(`${e.ally.name} was eaten.`, 'warn'));
    ev.on('player:wireGrabbed', () => game.hud?.message?.('IT HAS YOUR WIRE! LET GO OR SPACE TO CUT', 2, 'warn'));
    ev.on('player:wireCut', () => game.hud?.message?.('WIRE CUT', 1.1, 'info'));
    ev.on('player:shaken', () => game.hud?.message?.('SHAKEN OFF!', 1.2, 'warn'));
    ev.on('player:trampled', () => game.hud?.message?.('THROWN FROM THE SADDLE!', 1.6, 'warn'));
    ev.on('titan:windup', (e) => { if (e.kind === 'charge' && game.player?.riding) game.hud?.message?.('ABNORMAL CHARGING — BREAK AWAY!', 1.8, 'warn'); });
    ev.on('player:bladeBroken', () => game.hud?.message?.(game.player.spares > 0 ? 'Blades dull: swapping to a fresh pair' : 'NO BLADES LEFT: find a supply depot (crates under a flag)', 2, 'warn'));
    let lastNone = -9;
    ev.on('hook:none', () => {
      if (game.time - lastNone < 3) return;
      lastNone = game.time;
      game.hud?.message?.('Nothing to anchor to on that side: get closer to trees, buildings or titans', 2, 'info');
    });
  }

  // ---------------------------------------------------------------- modes
  toMenu() {
    const g = this.g;
    this.run++;
    g.mode = 'menu';
    g.paused = false;
    this._stopTraining();
    g.hud?.hideDeath?.(); g.hud?.hidePause?.(); g.hud?.hideTrainingResult?.();
    g.input.unlock?.();
    g.titans?.clear?.();
    this.hint = null;
    // a few titans wandering the field behind the menu for atmosphere
    this._spawnSome('field', 3, [5, 12], 0);
    g.audio?.setMusic?.(0.15);
    g.hud?.showMenu?.((mode) => this.start(mode));
  }

  start(mode) {
    const g = this.g;
    if (mode === 'training' && !g.training) mode = 'free';
    this.run++;
    g.hud?.hideMenu?.(); g.hud?.hideDeath?.(); g.hud?.hidePause?.(); g.hud?.hideTrainingResult?.();
    g.audio?.init?.();
    g.paused = false;
    g.mode = mode;
    g.titans?.clear?.();
    for (const a of g.allies || []) a.revive?.();
    this._stopTraining();
    this.wave = 0; this.score = 0; this.combo = 1; this.comboT = 0; this.colossal = false; this.colossalSpawned = false; this.waveClear = 0;
    this.startTime = g.time;
    this._spawnQ = []; this._spawnT = 0;
    this.trainStart = null; this.trainEnd = null; this.trainSpeeds = [];

    // where you start: the wall top for the Expedition, the forest edge for Free Flight, the course start for Training
    let sp = g.world?.playerSpawn || { position: new THREE.Vector3(0, 50.6, 0), yaw: 0 };
    if (mode === 'free') {
      const d = (g.world?.supplyDepots || []).filter((x) => x.position.z > 120).sort((a, b) => a.position.z - b.position.z)[0];
      if (d) sp = { position: d.position.clone(), yaw: 0 };
    }
    if (mode === 'training') {
      g.training.start();
      g.trainingActive = true;
      if (g.training.spawn) sp = g.training.spawn;
      this.trainStart = g.time;
    }
    g.player.reset(sp.position.clone().add(new THREE.Vector3(0, 0.6, 0)), sp.yaw ?? 0);
    g.player.infiniteGas = mode !== 'expedition';
    if (mode === 'training') g.player.spares = 99;

    // the Expedition rides out like the Survey Corps: mounted, just outside the breached gate
    if (mode === 'expedition' && g.herd?.horses?.length) {
      const h = g.herd.horses[0];
      h.pos.set(0, g.collision.groundHeight(0, 34), 34); h.yaw = 0; h.speed = 12; h.home.copy(h.pos);
      h.rider = g.player; g.player.riding = h; g.player.yaw = 0;
      h.saddle(g.player.pos); g.player.prev.copy(g.player.pos);
      // the squad rides out with you in a wedge, cloaks streaming
      const SLOTS = [[-5, -4], [5, -4], [-10, -9], [10, -9], [0, -10], [-15, -14], [15, -14]];
      (g.allies || []).forEach((a, i) => {
        const hh = g.herd.horses[i + 1];
        if (!hh || !SLOTS[i]) return;
        const [sx, sz] = SLOTS[i];
        hh.pos.set(sx, g.collision.groundHeight(sx, 34 + sz), 34 + sz); hh.yaw = 0; hh.speed = 12; hh.home.copy(hh.pos);
        a.dismount?.(true);
        a.mount?.(hh, { x: -sx, z: sz });    // slot x is to the leader's right: world -x when facing +z
      });
    } else for (const a of g.allies || []) a.dismount?.(true);
    this._startTutorial();
    if (mode === 'expedition') {
      g.hud?.message?.('DEDICATE YOUR HEART', 2.6, 'big');
      this.waveClear = 2.5; // first wave after the title card
      g.audio?.setMusic?.(0.5);
    } else if (mode === 'training') {
      g.hud?.message?.('TRAINING GROUNDS: cut every dummy\'s nape. The clock is running.', 3.5, 'info');
      g.audio?.setMusic?.(0.4);
    } else {
      g.hud?.message?.('FREE FLIGHT: the forest is yours. Infinite gas.', 3.5, 'info');
      g.audio?.setMusic?.(0.25);
    }
  }

  _stopTraining() {
    const g = this.g;
    if (g.trainingActive) g.training?.stop?.();
    g.trainingActive = false;
  }

  _nextWave() {
    const g = this.g;
    const idx = this.wave;
    const w = WAVES[Math.min(idx, WAVES.length - 1)];
    const scale = 1 + Math.max(0, idx - WAVES.length + 1) * 0.35;
    this.wave++;
    g.hud?.message?.(idx >= WAVES.length ? `WAVE ${this.wave} — THE HORDE GROWS` : w.msg, 3, 'big');
    // the first wave walks right up to the wall: within rope range of the wall top, so you can zip down onto them
    this._spawnSome('field', Math.round(w.field * scale), w.sizes, Math.round(w.abnormal * scale * 0.5), idx === 0 ? { zMin: 45, zMax: 100, xMax: 85 } : null);
    this._spawnSome('forest', Math.round(w.forest * scale), w.sizes, Math.round(w.abnormal * scale * 0.5));
    this._spawnSome('town', Math.round(w.town * scale), w.sizes, 0);
    if (w.colossal && !this.colossalSpawned) {
      this.colossalSpawned = true;
      const run = this.run;
      // only if this is still the same expedition (not a restart or another mode)
      setTimeout(() => { if (this.run === run && g.mode === 'expedition' && g.player.alive) g.titans?.spawn?.({ kind: 'colossal', position: new THREE.Vector3(0, 0, 28), yaw: Math.PI }); }, 3500);
    }
    g.audio?.setMusic?.(Math.min(1, 0.55 + this.wave * 0.12));
  }

  _spawnSome(area, count, sizes, abnormals, box = null) {
    const g = this.g;
    if (!g.titans?.spawn || count <= 0) return;
    const zones = (g.world?.titanSpawns || []).filter((z) => z.area === area);
    const fallback = { field: { center: new THREE.Vector3(0, 0, 100), radius: 70 }, forest: { center: new THREE.Vector3(0, 0, 260), radius: 120 }, town: { center: new THREE.Vector3(0, 0, -80), radius: 40 } }[area];
    for (let i = 0; i < count; i++) {
      const z = zones.length ? zones[(Math.random() * zones.length) | 0] : fallback;
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * z.radius;
      const pos = new THREE.Vector3(z.center.x + Math.cos(a) * r, 0, z.center.z + Math.sin(a) * r);
      if (box) {
        pos.z = box.zMin + Math.random() * (box.zMax - box.zMin);
        pos.x = (Math.random() * 2 - 1) * box.xMax;
      }
      pos.y = g.collision.groundHeight(pos.x, pos.z);
      const h = sizes[0] + Math.random() * (sizes[1] - sizes[0]);
      // queued: building a titan takes milliseconds, so a wave arrives over a few frames instead of in one long hitch
      this._spawnQ.push({ kind: i < abnormals ? 'abnormal' : 'normal', height: h, position: pos, yaw: Math.random() * Math.PI * 2 });
    }
  }

  // ---------------------------------------------------------------- tutorial
  _startTutorial() {
    const t = this.tut;
    t.step = 0; t.t = 0; t.doneT = 0; t.steerT = 0; t.boostT = 0; t.payoutT = 0; t.cuts = 0;
    this.hint = null;
  }
  _tutorial(dt) {
    const g = this.g, p = g.player, t = this.tut;
    if (!p.alive || g.mode === 'menu') { this.hint = null; return; }
    if (!p.grounded && p.turn) t.steerT += dt;
    if (p.boosting) t.boostT += dt;
    if (p.payout) t.payoutT += dt;
    // skip steps already learnt this session, and ones that don't apply to this mode
    while (t.step < STEPS.length && (t.seen.has(STEPS[t.step].id) || (STEPS[t.step].modes && !STEPS[t.step].modes.includes(g.mode)) || (STEPS[t.step].when && !STEPS[t.step].when(p)))) t.step++;
    if (t.step >= STEPS.length) { this.hint = null; return; }
    const s = STEPS[t.step];
    if (t.doneT > 0) {
      t.doneT -= dt;
      if (t.doneT <= 0) { t.seen.add(s.id); t.step++; t.t = 0; this.hint = null; }
      return;
    }
    t.t += dt;
    if (t.t < 1.2) { this.hint = null; return; }   // let the title card breathe first
    this.hint = s;
    // nothing in rope range yet: say how to get somewhere that has anchors instead
    if ((s.id === 'rope' || s.id === 'zip') && !p.targets[0].valid && !p.targets[1].valid) {
      this.hint = NO_ANCHOR;
      t.t = Math.min(t.t, 10);   // don't time this step out while there's nothing to hook
    }
    if (s.done(p, t) || t.t > 15) t.doneT = 0.7;
  }

  // ---------------------------------------------------------------- events
  _onHit(e) {
    const g = this.g;
    const { damage, result, point, part } = e;
    if (part === 'nape' || e.titan?.kind === 'dummy') this.tut.cuts++;
    if (!g.hud?.damageNumber) return;
    const sp = point.clone().project(g.camera);
    if (sp.z < 1) {
      const x = (sp.x * 0.5 + 0.5) * innerWidth, y = (-sp.y * 0.5 + 0.5) * innerHeight;
      g.hud.damageNumber(damage, x, y, !!result?.killed);
    }
    if (!result?.killed && part === 'nape' && result?.effect === 'shallow') g.hud?.message?.('TOO SLOW: hit the nape faster (zip in on a rope, then cut)', 1.6, 'warn');
    if (result?.effect === 'blind') g.hud?.message?.('BLINDED', 1, 'info');
    if (result?.effect === 'cripple') g.hud?.message?.('ANKLE CUT: IT\'S DOWN', 1.2, 'info');
  }

  _onKill(e) {
    const g = this.g;
    const t = e.titan;
    const size = t?.kind === 'colossal' ? 'the Colossal Titan' : `a ${Math.round(t?.height || 8)} m ${t?.kind === 'abnormal' ? 'abnormal' : 'titan'}`;
    if (e.by) { g.hud?.feed?.(`${e.by.name} took down ${size}`, 'kill'); if (g.mode === 'expedition') this.score += 150; return; }
    g.hud?.feed?.(`You took down ${size}`, 'kill');
    if (g.mode !== 'expedition') return;
    const p = g.player;
    if (this.comboT > 0) this.combo = Math.min(9, this.combo + 1); else this.combo = 1;
    this.comboT = 7;
    const base = t?.kind === 'colossal' ? 5000 : Math.round(100 + (t?.height || 8) * 25);
    const speedBonus = Math.round(p.speed * 4);
    this.score += (base + speedBonus) * this.combo;
    p.stats.kills++;
    if (t?.kind === 'colossal') { g.hud?.message?.('THE COLOSSAL TITAN HAS FALLEN', 4, 'big'); g.hitstop = 0.4; }
    else if (this.combo > 1) g.hud?.message?.(`${this.combo}× COMBO`, 1.2, 'info');
  }

  _onCut(e) {
    const g = this.g;
    if (g.mode !== 'training') return;
    const p = g.player;
    this.trainSpeeds.push(p.speed);
    p.stats.kills++;
    this.score += Math.round(200 + p.speed * 6);
    const tr = g.training;
    const left = tr?.remaining ?? 0, total = tr?.total ?? 0;
    if (left > 0) g.hud?.message?.(`CUT! ${total - left} / ${total}`, 1.2, 'info');
    else this._finishTraining();
  }

  _finishTraining() {
    const g = this.g;
    if (this.trainEnd != null) return;
    this.trainEnd = g.time;
    const time = this.trainEnd - this.trainStart;
    const prev = parseFloat(store.get('wof.trainingBest'));
    const newBest = !(prev > 0) || time < prev;
    if (newBest) store.set('wof.trainingBest', time.toFixed(2));
    const avg = this.trainSpeeds.length ? this.trainSpeeds.reduce((a, b) => a + b, 0) / this.trainSpeeds.length : 0;
    g.hud?.message?.('COURSE COMPLETE', 2.5, 'big');
    g.audio?.setMusic?.(0.2);
    const run = this.run;
    setTimeout(() => {
      if (this.run !== run) return;
      g.input.unlock?.();
      g.hud?.showTrainingResult?.({ time, best: newBest ? time : prev, cuts: g.training?.total ?? 0, total: g.training?.total ?? 0, avgSpeed: avg * 3.6, newBest },
        () => this.start('training'), () => this.toMenu());
    }, 1400);
  }

  _onDeath(e) {
    const g = this.g;
    const p = g.player;
    const cause = { eaten: 'YOU WERE EATEN', impact: 'YOU HIT THE GROUND TOO HARD', struck: 'CRUSHED BY A TITAN', fell: 'YOU FELL' }[e.cause] || 'YOU DIED';
    g.audio?.setMusic?.(0.1);
    const run = this.run, mode = g.mode;
    setTimeout(() => {
      if (this.run !== run) return;
      g.input.unlock?.();
      g.hud?.showDeath?.({ cause, kills: p.stats.kills, score: this.score, time: Math.round(g.time - (this.startTime || 0)), wave: this.wave, topSpeed: Math.round(p.stats.topSpeed * 3.6) },
        () => this.start(mode === 'menu' ? 'expedition' : mode), () => this.toMenu());
    }, e.cause === 'eaten' ? 1400 : 900);
  }

  _onStep(e) {
    const p = this.g.player;
    if (!e?.position) return;
    const d = e.position.distanceTo(p.render);
    const s = (e.size || 8) / Math.max(8, d);
    p.cam.trauma = Math.min(1, p.cam.trauma + Math.min(0.35, s * s * 0.5));
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    const g = this.g;
    this.comboT -= dt;
    if (this.comboT <= 0) this.combo = 1;
    this._tutorial(dt);
    this._spotting();
    if (this._spawnQ?.length && (this._spawnT -= dt) <= 0) {
      this._spawnT = 0.05;
      try { g.titans?.spawn(this._spawnQ.shift()); } catch (err) { console.warn('spawn failed', err); }
    }
    if (g.mode === 'expedition' && g.player.alive) {
      const ts = g.titans?.titans || [];
      const alive = ts.filter((t) => t.alive && t.kind !== 'colossal').length;
      const colossalUp = ts.some((t) => t.kind === 'colossal' && t.alive);
      if (this.waveClear > 0) {
        this.waveClear -= dt;
        if (this.waveClear <= 0) this._nextWave();
      } else if (alive === 0 && !this._spawnQ?.length && !(this.colossalSpawned && colossalUp)) {
        if (this.wave > 0) g.hud?.message?.(`WAVE ${this.wave} CLEARED`, 2.5, 'info');
        this.waveClear = 4;
      }
    }
    if (g.mode === 'training' && g.trainingActive && this.trainEnd == null && (g.training?.remaining ?? 1) === 0) this._finishTraining();
  }

  /** A comrade calls out each new titan as it comes within 110 m, by clock bearing from your heading. */
  _spotting() {
    const g = this.g, p = g.player;
    if (!p.alive || g.mode === 'training') return;
    const caller = (g.allies || []).find((a) => a.alive && !a.grabbedBy && !a.horse) || (g.allies || []).find((a) => a.alive && !a.grabbedBy);
    if (!caller) return;
    for (const t of g.titans?.titans || []) {
      if (!t.alive || t._spotted || t.kind === 'colossal') continue;
      const dx = t.position.x - p.pos.x, dz = t.position.z - p.pos.z;
      if (dx * dx + dz * dz > 110 * 110) continue;
      t._spotted = true;
      const yaw = p.riding ? p.riding.yaw : p.yaw;
      let rel = Math.atan2(dx, dz) - yaw; rel = Math.atan2(Math.sin(rel), Math.cos(rel));   // + = to your left
      const hr = ((Math.round(-rel / (Math.PI / 6)) % 12) + 12) % 12 || 12;
      caller.radio(t.kind === 'abnormal' ? `Abnormal, ${hr} o'clock! Watch it!` : `Titan, ${hr} o'clock — ${Math.round(t.height)}-metre class!`);
      break;
    }
  }

  timer() {
    const g = this.g;
    if (g.mode !== 'training' || this.trainStart == null) return null;
    return (this.trainEnd ?? g.time) - this.trainStart;
  }
  trainingTargets() {
    const g = this.g;
    if (g.mode !== 'training' || !g.training) return null;
    return { left: g.training.remaining, total: g.training.total };
  }

  objective() {
    const g = this.g;
    if (g.mode === 'free') return 'FREE FLIGHT · fly the Forest of Giant Trees · supply depots refill you';
    if (g.mode === 'training') {
      const best = parseFloat(store.get('wof.trainingBest'));
      return `TRAINING GROUNDS · cut every dummy's nape${best > 0 ? ` · best ${best.toFixed(1)} s` : ''}`;
    }
    if (g.mode !== 'expedition') return '';
    const ts = (g.titans?.titans || []).filter((t) => t.alive);
    if (this.waveClear > 0 && this.wave > 0) return `Wave ${this.wave} cleared · next wave incoming`;
    // nearest titan: distance and an arrow relative to where you're heading (↑ = straight ahead)
    const p = g.player;
    let near = null, nd = 1e9;
    for (const t of ts) { const d = t.position.distanceTo(p.render); if (d < nd) { nd = d; near = t; } }
    let guide = '';
    if (near) {
      const a = Math.atan2(near.position.x - p.render.x, near.position.z - p.render.z) - p.yaw;
      const rel = Math.atan2(Math.sin(a), Math.cos(a));               // > 0: to your left
      const arrows = ['↑', '↖', '←', '↙', '↓', '↘', '→', '↗'];
      guide = ` · nearest ${Math.round(nd)} m ${arrows[((Math.round(rel / (Math.PI / 4)) % 8) + 8) % 8]}`;
    }
    return `WAVE ${this.wave} · Titans: ${ts.length}${guide} · Cut the nape`;
  }
}
