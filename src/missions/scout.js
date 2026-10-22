// The 57th Exterior Scouting Mission (anime season 1, episodes 17–22; manga chapters 23–30), in four chapters.
//  1 Ride Out: the Long-Range Scouting Formation leaves the wall at dawn. Scouts on the wings fire red smoke at a
//    titan and black at an abnormal; the command at the front fires green for the new course. You relay them (T).
//  2 The Right Flank: the Female Titan comes out of the trees with no flare before her, kills Luke Cis and Dieter
//    Ness, throws Armin and looks at his face. Reiner and Jean hood up to slow her; Armin's bluff freezes her; she
//    catches Reiner, who cuts his way out, and she runs for the centre rear.
//  3 The Forest of Giant Trees: only the centre column goes in. Levi's squad rides the road with her behind them and
//    Levi gives no order but to ride. She runs into Erwin's trap; her nape is hardened; she screams, the titans
//    come to eat her, the Corps defends her, and she gets away in the steam.
//  4 Squad Levi: she comes back for Eren. Gunther, Eld, Petra and Oluo die; Eren transforms and loses; she bites
//    him out of his nape and runs; Mikasa and Levi catch her, and Levi cuts Eren out of her mouth.
// Game (src/game.js) owns one of these. Story source: the AOT wiki's episode and expedition pages.
import * as THREE from 'three';
import { Horse } from '../player/horse.js';
import { spawnFemale } from '../titans/female.js';
import { ERE } from '../titans/carrier.js';
import { roadX } from '../world/terrain.js';
import * as keys from '../keys.js';

const V3 = THREE.Vector3;
const clamp = THREE.MathUtils.clamp;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const fwd = (yaw, out = new V3()) => out.set(Math.sin(yaw), 0, Math.cos(yaw));
const rgt = (yaw, out = new V3()) => out.set(-Math.cos(yaw), 0, Math.sin(yaw));   // the rider's right (steerToSlot)
const _a = new V3(), _b = new V3(), _c = new V3();
const TRAP_Z = 590;        // ch 3: the trap in the forest, on the road
const RELAY_T = 8;         // s to relay a signal before the next rider does it for you

export const CHAPTERS = [
  { title: 'Ride Out', eps: 'Episode 17', desc: 'The Long-Range Scouting Formation leaves the wall. Relay the smoke signals (T).' },
  { title: 'The Right Flank', eps: 'Episodes 17–18', desc: 'The Female Titan breaks through the right wing. Hood up and slow her down.' },
  { title: 'The Forest of Giant Trees', eps: 'Episodes 19–20', desc: 'Ride with Levi\'s squad. Do not fight. Then hold the titans off her.' },
  { title: 'Squad Levi', eps: 'Episodes 21–22', desc: 'She comes back for Eren. Fight beside the squad, then get him back.' },
];

export class ScoutMission {
  constructor(flow) {
    this.flow = flow; this.g = flow.g;
    this.phase = 'none'; this.done = false;
    this.horses = []; this.borrowed = []; this.pins = new Map();
    const ev = this.g.events, on = (n, f) => ev.on(n, (e) => { if (this.g.mode === 'scout' && this.phase !== 'none') f(e); });
    on('player:hit', (e) => this._onPlayerHit(e));
    on('female:mouth', () => this._freeEren(false));
    on('female:sees', () => this._sees());
    on('titan:killed', (e) => this._onKill(e));
    on('player:kicked', () => this.g.hud?.message?.('KICKED!', 1.2, 'warn'));
    on('female:scream', () => { this.g.player.cam.trauma = 1; });
  }

  /** Each chapter's sky: the formation rides out at dawn; it's full day by the time they reach the forest. */
  atmosphere(ch) { return ch < 2 ? 'dawn' : 'day'; }

  /** Where the player starts (Game resets them there; start() puts them in the saddle). */
  spawn(ch) {
    const g = this.g, y = (x, z) => g.collision.groundHeight(x, z);
    const at = [[22, 40, 0], [160, 160, Math.PI / 2], [roadX(220), 220, 0], [roadX(700) + 3, 700, Math.PI]][ch] || [22, 40, 0];
    return { position: new V3(at[0], y(at[0], at[1]), at[1]), yaw: at[2] };
  }

  // ---------------------------------------------------------------- setup
  start(ch) {
    const g = this.g;
    this.ch = ch; this.t = 0; this.pt = 0; this.done = false; this.lines = new Set(); this.want = null;
    this.hits = 0; this.limps = 0; this.kills = 0; this.step = 0; this.stepT = 0; this.female = null; this.eren = null;
    this.lead = null; this.riders = []; this.pins.clear();
    const names = [
      ['Henning', 'Lotte', 'Konrad', 'Greta', 'Wilhelm'],
      ['Armin', 'Reiner', 'Jean', 'Christa', 'Connie'],
      ['Petra', 'Oluo', 'Eld', 'Gunther', 'Eren'],
      ['Petra', 'Oluo', 'Eld', 'Gunther', 'Eren'],
    ][ch];
    (g.allies || []).forEach((a, i) => { a._baseName = a._baseName || a.name; a.name = names[i] || a._baseName; });
    [this._ride1, this._ride2, this._forest3, this._squad4][ch].call(this, true);
    g.audio?.setMusic?.(ch === 0 ? 0.35 : 0.55);
  }

  dispose() {
    const g = this.g;
    for (const h of this.horses) { h.root.removeFromParent(); const i = g.herd?.horses.indexOf(h); if (i >= 0) g.herd.horses.splice(i, 1); }
    for (const b of this.borrowed) { const h = b.h; h.follow = null; if (h.rider && h.rider !== g.player) h.rider = null; h.pos.copy(b.pos); h.home.copy(b.pos); h.yaw = b.yaw; h.speed = 0; }
    this.horses = []; this.borrowed = []; this.riders = []; this.pins.clear();
    if (this.harpoons) { this.harpoons.removeFromParent(); this.harpoons.geometry.dispose(); this.harpoons = null; }
    for (const a of g.allies || []) if (a._baseName) a.name = a._baseName;
    this.female = null; this.eren = null; this.lead = null;
    this.phase = 'none';
  }

  // ---------------------------------------------------------------- helpers
  _say(who, text, key = who + text) {
    if (this.lines.has(key)) return;
    this.lines.add(key);
    const ally = (this.g.allies || []).find((a) => a.name === who);
    if (ally && !ally.alive) return;
    this.g.hud?.feed?.(text, 'radio', who);
  }
  /** Lines on a clock: [[t, who, text], …], said once each as `t` passes. */
  _script(t, list) { for (const [at, who, text] of list) if (t >= at) this._say(who, text); }
  _ally(name) { return (this.g.allies || []).find((a) => a.name === name); }
  _place(a, at) { a.odm?.releaseAll?.(true); a.land = null; a.rest = null; a.job = null; a.pos.copy(at); a.prev.copy(at); a.render.copy(at); a.vel.set(0, 0, 0); }
  _hide(a) { a.alive = false; a.odm?.releaseAll?.(true); if (a.model?.root) a.model.root.visible = false; this.pins.delete(a); }
  /** A comrade dies (no 'eaten' event: the story's deaths are told on the radio). */
  _killAlly(a, at, line) {
    if (!a || !a.alive) return;
    if (a.horse) a.dismount(true);
    this.g.fx?.blood?.(at || a.pos, _a.set(0, 1, 0), 2.2);
    this._hide(a);
    if (line) this.g.hud?.feed?.(line, 'warn');
  }
  _ground(x, z) { return this.g.collision.groundHeight(x, z); }

  /** The formation's lead (Erwin, or Levi in the forest): a point that rides a path of waypoints. */
  _makeLead(at, yaw, path, speed) {
    this.lead = { pos: new V3(at.x, this._ground(at.x, at.z), at.z), yaw, speed: 0, want: speed, path: path.map(([x, z]) => new V3(x, 0, z)), i: 0 };
  }
  _moveLead(dt) {
    const L = this.lead;
    if (!L) return;
    const tgt = L.path[L.i];
    let want = L.want;
    if (tgt) {
      const d = Math.hypot(tgt.x - L.pos.x, tgt.z - L.pos.z);
      if (d < 18 && L.i < L.path.length - 1) L.i++;
      const turn = wrap(Math.atan2(tgt.x - L.pos.x, tgt.z - L.pos.z) - L.yaw);
      L.yaw += clamp(turn, -0.4 * dt, 0.4 * dt);
      if (L.i === L.path.length - 1 && d < 25) want = 0;
    } else want = 0;
    // it waits for a soldier who has fallen far behind (the formation can't lose its relays)
    const p = this.g.player.pos, back = Math.hypot(p.x - L.pos.x, p.z - L.pos.z);
    if (this.waitForYou) want *= clamp(1 - (back - 140) / 260, 0.25, 1);
    L.speed += clamp(want - L.speed, -6 * dt, 4 * dt);
    fwd(L.yaw, _a);
    L.pos.addScaledVector(_a, L.speed * dt);
    L.pos.y = this._ground(L.pos.x, L.pos.z);
  }
  _slotAt(slot, out = new V3()) {
    const L = this.lead;
    out.copy(L.pos).addScaledVector(rgt(L.yaw, _b), slot.x).addScaledVector(fwd(L.yaw, _c), slot.z);
    out.y = this._ground(out.x, out.z);
    return out;
  }
  /** A cloaked rider of the formation on a horse that keeps its slot. */
  _rider(name, x, z, { hood = false } = {}) {
    const g = this.g, L = this.lead, slot = { x, z };
    const at = this._slotAt(slot);
    const h = new Horse(g, at, L.yaw, 0.11 + this.horses.length * 0.173);
    h.speed = L.want * 0.6; h.mountCd = 1e9;
    h.follow = { lead: L, slot };
    h.addDummyRider({ hood });
    g.herd?.horses.push(h);
    this.horses.push(h);
    const r = { name, h, slot, base: { x, z }, alive: true, head: () => _a.copy(h.pos).setY(h.pos.y + 2.3) };
    this.riders.push(r);
    return r;
  }
  _riderNamed(n) { return this.riders.find((r) => r.name === n); }
  /** A rider is killed: the saddle empties and the horse bolts (and can be caught: it's a spare now). */
  _killRider(r, line) {
    if (!r || !r.alive) return;
    r.alive = false; r.h.dummy.visible = false; r.h.follow = null; r.h.mountCd = 0; r.h.crashed = 0;
    this.g.fx?.blood?.(r.h.pos.clone().setY(r.h.pos.y + 2.2), _a.set(0, 1, 0), 2.4);
    if (line) this.g.hud?.feed?.(line, 'warn');
  }
  /** Put the player in the saddle of a herd horse here, and the comrades on others in slots of the lead. */
  _mountUp(allySlots) {
    const g = this.g, p = g.player, herd = g.herd?.horses || [];
    const free = herd.filter((h) => !this.horses.includes(h));
    const take = () => { const h = free.shift(); if (h) this.borrowed.push({ h, pos: h.home.clone(), yaw: h.yaw }); return h; };
    const yaw = this.lead.yaw;
    const h = take();
    if (h) {
      h.pos.copy(p.pos); h.pos.y = this._ground(h.pos.x, h.pos.z); h.yaw = yaw; h.speed = this.lead.want * 0.6; h.home.copy(h.pos);
      h.rider = p; p.riding = h; p.yaw = yaw; h.saddle(p.pos); p.prev.copy(p.pos);
    }
    (g.allies || []).forEach((a, i) => {
      const s = allySlots[i];
      if (!s) return;
      const hh = take();
      if (!hh) return;
      const slot = { x: s[0], z: s[1], lead: this.lead, stay: true };
      hh.pos.copy(this._slotAt(slot)); hh.yaw = yaw; hh.speed = this.lead.want * 0.6; hh.home.copy(hh.pos);
      a.dismount?.(true);
      a.mount?.(hh, slot);
    });
  }
  _spawn(pos, height, { kind = 'normal', yaw, then } = {}) {
    pos.y = this._ground(pos.x, pos.z);
    this.flow._spawnQ.push({ kind, height, position: pos, yaw: yaw ?? Math.random() * Math.PI * 2, then });
  }
  /** Keep a comrade fixed in the air (a scripted moment: in her hand, at her eyes). */
  _pin(a, at) { if (a?.alive) this.pins.set(a, at.clone()); }
  _holdPins() {
    for (const [a, at] of this.pins) {
      if (!a.alive) { this.pins.delete(a); continue; }
      if (a.horse) a.dismount(true);
      a.odm?.releaseAll?.(true);
      a.pos.copy(at); a.prev.copy(at); a.vel.set(0, 0, 0);
    }
  }

  // ---------------------------------------------------------------- signals
  /** A rider fires a signal; the player should relay it (T) within RELAY_T s. */
  _signal(from, color, dir = null, line = null) {
    this.g.fx?.flare?.(from, color, dir);
    this.g.audio?.hookFire?.(1);
    this.want = { color, t: RELAY_T, dir: dir ? dir.clone() : null };
    if (line) this.g.hud?.feed?.(line, 'radio', line.who || '');
    this.g.hud?.message?.(keys.fill(`${color.toUpperCase()} SMOKE · relay it: {flare}`), 3, 'info');
  }
  _flareKey() {
    const g = this.g, p = g.player;
    if (!g.input?.actHit?.('flare') || !p.alive || (g.time - (this._flareAt ?? -9)) < 1.2) return;
    this._flareAt = g.time;
    const w = this.want;
    g.fx?.flare?.(p.pos, w?.color || 'red', w?.dir || null);
    g.audio?.hookFire?.(1);
    if (w) {
      this.want = null;
      this.flow.score += 250;
      this.relayed = (this.relayed || 0) + 1;
      g.hud?.message?.(`SIGNAL RELAYED  +250`, 1.6, 'info');
    }
  }
  _relayTimeout(dt) {
    const w = this.want;
    if (!w || (w.t -= dt) > 0) return;
    this.want = null;
    const r = this.riders.find((x) => x.alive && x.base.x < 0) || this.riders.find((x) => x.alive);
    if (r) this.g.fx?.flare?.(r.head(), w.color, w.dir);
    this.g.hud?.feed?.('Too slow! I relayed it for you. Keep your eyes on the sky.', 'radio', r?.name || 'Henning');
  }

  // ---------------------------------------------------------------- the Female Titan
  _female(at, yaw) {
    const g = this.g;
    const f = this.female = spawnFemale(g.titans, at, yaw);
    f.home.copy(f.position);
    return f;
  }
  _transform(at, big = 1) {
    const g = this.g, y = this._ground(at.x, at.z);
    g.fx?.lightning?.(new V3(at.x, y, at.z), 60 * big);
    g.fx?.steam?.(new V3(at.x, y + 6, at.z), 14 * big, 4);
    g.events.emit('titan:step', { position: new V3(at.x, y, at.z), size: 50 });
    g.player.cam.trauma = 1;
  }
  _onPlayerHit(e) {
    const f = e.titan;
    if (!f?.female) return;
    const fx = e.result?.effect;
    if (fx === 'hardened') { this.g.hud?.message?.('HARDENED! YOUR BLADES SHATTERED ON HER NAPE', 2.4, 'warn'); this.shattered = true; return; }
    if (fx && fx !== 'none') this.hits++;
    if (fx === 'limp') { this.limps++; this.flow.score += 400; this.g.hud?.message?.('ARM CUT: IT HANGS LIMP', 1.4, 'info'); }
    if (fx === 'cripple') { this.flow.score += 400; this.g.hud?.message?.('ANKLE CUT: SHE\'S DOWN', 1.4, 'info'); }
    if (fx === 'blind') { this.flow.score += 300; this.g.hud?.message?.('EYES CUT: SHE COVERS HER NAPE', 1.4, 'info'); }
  }
  _onKill(e) { if (!e.by) this.kills++; }

  /** Her strike at a comrade held in place (the story's deaths land: sure). */
  _strikeAt(kind, a, at, onHit) {
    const f = this.female;
    this._pin(a, at);
    return f.strike(kind, () => (a.alive ? a.pos : at), (pt) => { onHit(pt); }, { sure: true });
  }

  // ================================================================ chapter 1: Ride Out
  _ride1(init) {
    const g = this.g;
    if (init) {
      this.phase = 'gate'; this.waitForYou = true;
      this._makeLead(new V3(0, 0, 70), 0, [[0, 115], [140, 122], [420, 118], [900, 112], [1000, 110]], 14);
      // the formation (slots: metres to Erwin's right, ahead). It starts in a tight column and spreads out.
      const R = [
        ['Erwin', 0, 0], ['Hange', -6, -14], ['Moblit', 6, -14],                                  // command
        ['scout R1', 95, 40, true], ['scout R2', 140, 5, true], ['scout R3', 120, -40, true],      // right wing (north)
        ['scout L1', -95, 40, true], ['scout L2', -140, 5, true], ['scout L3', -120, -40, true],   // left wing (south)
        ['wagon 1', 0, -36], ['wagon 2', 0, -52],
      ];
      for (const [n, x, z, hood] of R) this._rider(n, x, z, { hood });
      for (const r of this.riders) { r.slot.x = r.base.x * 0.2; r.slot.z = r.base.z * 0.5 - 6; }
      this._mountUp([[-40, -18], [-46, -30], [-34, -30], [40, -18], [0, -66]]);
      // the support team holds the gate while the main force rides out
      this._spawn(new V3(-70, 0, 55), 9, { yaw: 1.2, then: (t) => { this.support = t; } });
      g.hud?.message?.('THE 57TH EXTERIOR SCOUTING MISSION', 3.4, 'big');
      return;
    }
  }
  _update1(dt) {
    const g = this.g, L = this.lead, t = this.t;
    this._script(t, [
      [0.8, 'Erwin', 'The 57th Exterior Scouting Mission begins! Advance!'],
      [3.5, 'Henning', 'Support team\'s got the gate. Ride!'],
      [7, 'Erwin', 'Long-Range Scouting Formation: spread out!'],
      [9.5, 'Lotte', 'Remember: red smoke is a titan, black an abnormal. Green is our new course. Pass every signal on.'],
    ]);
    if (t > 5 && this.support?.alive) { const s = this.support; s.killedBy = { name: 'The support team' }; s.applyHit({ part: 'nape', damage: 1e5, point: s.napeWorld().center }); }
    // spread out to the full formation over 8 s
    const k = clamp((t - 6) / 8, 0, 1), e = k * k * (3 - 2 * k);
    for (const r of this.riders) { r.slot.x = THREE.MathUtils.lerp(r.base.x * 0.2, r.base.x, e); r.slot.z = THREE.MathUtils.lerp(r.base.z * 0.5 - 6, r.base.z, e); }
    this._relayTimeout(dt);
    const ev = this.ev1 || (this.ev1 = {});
    if (t > 13 && !ev.red) {
      ev.red = 1; this.phase = 'ride';
      const s = this._riderNamed('scout R1');
      this._signal(s.head().clone(), 'red');
      this._say('Konrad', 'Red smoke, right flank! A titan!');
      const at = L.pos.clone().addScaledVector(fwd(L.yaw, _a), 190).addScaledVector(rgt(L.yaw, _b), 70);
      at.z = Math.min(at.z, 175);
      this._spawn(at, 11, { yaw: Math.PI });
    }
    if (t > 21 && !ev.green) {
      ev.green = 1;
      // Erwin turns the formation away from it, to the left: south-east
      const dir = fwd(L.yaw + 0.45, new V3());
      L.path = [L.pos.clone().addScaledVector(dir, 160), new V3(560, 0, 70), new V3(900, 0, 80), new V3(1000, 0, 90)]; L.i = 0;
      this._signal(this._riderNamed('Erwin').head().clone(), 'green', dir);
      this._say('Lotte', 'Green smoke from the command! We change course!');
    }
    if (t > 34 && !ev.black) {
      ev.black = 1;
      const s = this._riderNamed('scout R3');
      this._signal(s.head().clone(), 'black');
      this._say('Konrad', 'Black smoke! An abnormal, right side, and it\'s coming straight at us!');
      const at = L.pos.clone().addScaledVector(rgt(L.yaw, _a), 170).addScaledVector(fwd(L.yaw, _b), 20);
      at.z = clamp(at.z, 20, 230);
      this._spawn(at, 9, { kind: 'abnormal', then: (a) => { this.abnormal = a; if (a) a.noticeRange = 400; } });
      this.phase = 'abnormal';
    }
    if (this.phase === 'abnormal') {
      const a = this.abnormal;
      if (a && !a.alive) {
        this.phase = 'rejoin';
        this.flow.score += 1000;
        this._say('Erwin', 'Good work. Back to your place in the formation.');
      } else if (a && a.alive) {
        // it goes for the riders if you leave it alone
        const victim = this.riders.find((r) => r.alive && r.name.startsWith('scout R') && r.h.pos.distanceTo(a.position) < a.footR + a.armLen);
        if (victim) this._killRider(victim, `${victim.name === 'scout R3' ? 'Fritz' : 'Mina'} was killed by the abnormal.`);
      }
    }
    if (this.phase === 'rejoin') {
      const p = g.player;
      if (p.riding && p.pos.distanceTo(L.pos) < 130) this._chapter('THE FORMATION HOLDS');
    }
  }

  // ================================================================ chapter 2: The Right Flank
  _ride2(init) {
    const g = this.g;
    if (!init) return;
    this.phase = 'ride'; this.waitForYou = false;
    // riding east; the right wing is the north side, along the forest edge
    this._makeLead(new V3(150, 0, 96), Math.PI / 2, [[1000, 96]], 13.5);
    this._rider('Erwin', 0, 0);
    this._rider('Luke', 82, 46, { hood: true });
    this._rider('Ness', 74, 30, { hood: true });
    this._rider('scout', 60, 10, { hood: true });
    this._rider('Hange', -8, -16); this._rider('wagon', 0, -34);
    this._mountUp([[62, -4], [30, -36], [24, -44], [6, -60], null]);
    const c = g.allies?.[4];
    if (c) this._hide(c);
    // the horde she drags behind her
    for (const [dx, z] of [[170, 236], [220, 250]]) this._spawn(new V3(this.lead.pos.x + dx, 0, z), 8 + Math.random() * 5, { yaw: Math.PI });
    g.hud?.message?.('THE RIGHT FLANK', 3, 'big');
  }
  _update2(dt) {
    const g = this.g, L = this.lead, t = this.t, f = this.female;
    const armin = this._ally('Armin'), reiner = this._ally('Reiner'), jean = this._ally('Jean');
    this._script(t, [
      [1, 'Armin', 'Smoke on the right... red? It\'s faint. Something\'s wrong over there.'],
      [3.5, 'Ness', 'Titans, no flare before them! A whole pack of them, out of the trees!'],
    ]);
    const ph = this.phase;
    this.pt += dt;
    if (ph === 'ride' && t > 5) {
      const at = new V3(L.pos.x + 120, 0, 232);
      this._female(at, Math.PI);
      this.female.setMode('run'); this.female.paceMul = 1;
      this.phase = 'luke'; this.pt = 0;
      g.hud?.message?.('A 14-METRE ABNORMAL', 2.4, 'warn');
      this._say('Ness', 'An abnormal! Luke, we\'ll draw it off the formation!');
      return;
    }
    if (!f) return;
    const go = (r) => { f.setMode('run'); f.runTo.copy(r.h.pos); };
    if (ph === 'luke' || ph === 'ness') {
      const r = this._riderNamed(ph === 'luke' ? 'Luke' : 'Ness');
      if (r.alive) {
        go(r);
        if (f.position.distanceTo(r.h.pos) < 13) f.strike('hand', () => r.head(), () => this._killRider(r, ph === 'luke' ? 'She snatched Luke out of the air and threw him down.' : 'She smashed Dieter Ness and his horse to the ground.'), { sure: true, run: true });
      } else if (f.state !== 'strike') { this.phase = ph === 'luke' ? 'ness' : 'armin'; this.pt = 0; if (ph === 'ness') this._say('Armin', 'She\'s... she isn\'t like the others. She\'s smart.'); }
    }
    if (ph === 'armin' && armin) {
      f.setMode('run'); f.runTo.copy(armin.pos);
      if (f.position.distanceTo(armin.pos) < 13 && f.state !== 'strike') {
        f.strike('hand', () => armin.pos, () => {
          if (armin.horse) { const h = armin.horse; armin.dismount(true); h.crashed = 20; }
          armin.vel.set(0, 6, 0); g.fx?.impact?.(armin.pos, _a.set(0, 1, 0), 'ground');
          this.phase = 'look'; this.pt = 0;
        }, { sure: true });
      }
    }
    if (ph === 'look') {
      f.setMode('hold'); f.faceTo = armin?.pos || null;
      this._say('Armin', 'She lifted my hood... she\'s looking for someone. She\'s looking at our faces!');
      if (this.pt > 3) {
        this.phase = 'harass'; this.pt = 0; this.hits = 0;
        f.faceTo = null; f.setMode('run'); f.paceMul = 1;
        // Reiner and Jean ride up
        for (const [a, x] of [[reiner, 48], [jean, 54]]) if (a?.horse) { a.slot.x = x; a.slot.z = -18; }
        if (jean) g.fx?.flare?.(jean.pos, 'red');
        this._say('Jean', 'Armin! Get on, we\'re not leaving you! Hoods up! She can\'t know which one of us she\'s after.');
        this._say('Reiner', 'If she reaches the centre rear, it\'s over. We slow her down here.');
        g.hud?.message?.('HOOD UP · HARASS HER: cut her legs and arms', 3, 'big');
      }
    }
    if (ph === 'harass') {
      _a.copy(L.pos).addScaledVector(fwd(L.yaw, _b), -20);
      f.runTo.copy(_a);
      if (this.hits >= 3 || this.pt > 32) {
        this.phase = 'bluff'; this.pt = 0;
        f.setMode('hold'); f.faceTo = armin?.pos || g.player.pos;
        this._say('Armin', 'That suicidal bastard is dead! Eren\'s gone! Your search ends here!');
        g.hud?.message?.('ARMIN\'S BLUFF', 2, 'big');
      }
    }
    if (ph === 'bluff' && this.pt > 3.5 && reiner) {
      this.phase = 'reiner'; this.pt = 0;
      const at = f._jpos('armR', new V3()).addScaledVector(fwd(f.yaw, _a), 6);
      this._strikeAt('hand', reiner, at, () => { this._say('Reiner', 'She\'s got me!'); });
    }
    if (ph === 'reiner') {
      if (this.pt > 0.9 && this.pt < 2.6 && reiner?.alive) this._pin(reiner, f._jpos('handR', _a));
      if (this.pt > 2.6 && reiner && this.pins.has(reiner)) {
        this.pins.delete(reiner);
        reiner.vel.set(0, 12, 0);
        f.applyHit({ part: 'hand', damage: 200, point: f._jpos('handR', new V3()) });
        this._say('Reiner', 'I cut my way out of her fingers!');
      }
      if (this.pt > 4) {
        this.phase = 'gone'; this.pt = 0;
        f.setMode('run'); f.paceMul = 1.5;
        this._say('Armin', 'She\'s turning... she\'s heading for the centre rear!');
      }
    }
    if (ph === 'gone') {
      f.runTo.copy(L.pos).addScaledVector(fwd(L.yaw, _a), 400).setZ(150);
      if (this.pt > 3) this._say('Christa', 'Armin! I brought the horses! Everyone, mount up!');
      if (this.pt > 7) this._chapter('SHE IS HEADING FOR THE CENTRE REAR');
    }
  }

  // ================================================================ chapter 3: The Forest of Giant Trees
  _forest3(init) {
    const g = this.g;
    if (!init) return;
    this.phase = 'ride'; this.waitForYou = false;
    const path = [];
    for (let z = 250; z <= 700; z += 25) path.push([roadX(z), z]);
    this._makeLead(new V3(roadX(232), 0, 232), 0, path, 15);
    this._rider('Levi', 0, 4);
    this._mountUp([[-4, -4], [4, -4], [-4, -12], [4, -12], [0, -8]]);
    g.hud?.message?.('THE FOREST OF GIANT TREES', 3, 'big');
  }
  _update3(dt) {
    const g = this.g, L = this.lead, t = this.t, p = g.player;
    let f = this.female;
    this.pt += dt;
    this._script(t, [
      [1, 'Petra', 'Into the forest... only the centre column. Why here?'],
      [2.5, 'Levi', 'Keep riding.'],
    ]);
    if (this.phase === 'ride') {
      if (!f && t > 3) {
        const z0 = L.pos.z - 85;
        f = this._female(new V3(roadX(z0), 0, z0), 0);
        f.setMode('run');
        this._say('Gunther', 'Behind us! The Female Titan! She\'s in the forest!');
      }
      if (!f) return;
      // she runs the road behind them, closing slowly; the soldiers in the trees fly at her and die
      const gap = L.pos.z - f.position.z, target = Math.max(20, 60 - t * 1.6);
      f.paceMul = clamp((L.speed + (gap - target) * 0.6) / f.runSpeed, 0.3, 1.7);
      f.runTo.set(roadX(f.position.z + 40), 0, f.position.z + 40);
      this._script(t, [
        [7, 'Eld', 'There are soldiers in the trees behind her... they\'re going for her nape!'],
        [13, 'Eren', 'Captain! We have to fight! They\'re dying back there!'],
        [16, 'Levi', 'Eyes forward.'],
        [19, 'Petra', 'Captain, your orders!'],
        [24, 'Eren', 'I can do it myself. I\'ll transform!'],
        [26, 'Petra', 'Eren, don\'t! Trust the captain!'],
        [29, 'Levi', 'Choose, Eren. Trust yourself, or trust us. I don\'t know which is right. Nobody ever does.'],
        [33, 'Eren', '...I\'ll ride.'],
      ]);
      for (const at of [9, 15.5, 22]) if (t > at && !this.lines.has('pursuer' + at)) {
        this.lines.add('pursuer' + at);
        const pt = f._headWorld(new V3()).add(rgt(f.yaw, _a).multiplyScalar(at % 2 ? 4 : -4));
        f.strike('hand', () => pt, (q) => { g.fx?.blood?.(q, _a.set(0, 1, 0), 2.2); }, { sure: true, run: true });
        g.fx?.gas?.(pt, _b.set(0, -1, 0), 1);
        g.hud?.feed?.(['She swatted him out of the air.', 'She crushed him against the trunk without slowing.', 'Another one. She didn\'t even look.'][(this.pursuers = (this.pursuers || 0) + 1) % 3], 'warn');
      }
      if (t > 17 && !this.lines.has('grenade')) {
        this.lines.add('grenade');
        g.fx?.sparks?.(this._slotAt({ x: 0, z: 4 }).setY(L.pos.y + 4), _a.set(0, 1, 0), 30);
        g.audio?.titanStep?.(L.pos, 30);
        p.cam.trauma = Math.min(1, p.cam.trauma + 0.4);
        g.hud?.message?.('LEVI FIRES A SOUND GRENADE', 2, 'info');
      }
      if (!p.riding && f.position.distanceTo(p.pos) < 90) this._say('Levi', 'Who told you to leave your horse? Get back on.');
      if (f.position.z > TRAP_Z) this._trap();
      return;
    }
    if (this.phase === 'trap') {
      this._updateHarpoons();
      this._script(this.pt, [
        [1.5, 'Erwin', 'Second volley, fire!'],
        [3, 'Levi', 'Squad, stay here with the horses. Eren, you too.'],
        [5, 'Petra', 'So that was the plan... the captain knew all along.'],
        [9, 'Mike', 'Her nape! My blades broke on it... it\'s hardened!'],
        [12, 'Erwin', 'Prepare the explosives. Blow her hands off the nape.'],
        [18, 'Levi', 'Hey. I\'m going to cut you out of there. Your arms, your legs... they grow back, right?'],
      ]);
      if (this.pt > 3 && this.lead.want) { this.lead.want = 0; for (const a of g.allies || []) if (a.slot) a.slot.stay = false; }
      if (this.pt > 9 && !this.lines.has('mike')) { this.lines.add('mike'); f.applyHit({ part: 'nape', damage: 300, point: f.napeWorld().center }); }
      if (this.pt > 13 && !this.lines.has('boom')) {
        this.lines.add('boom');
        for (let i = 0; i < 6; i++) { const c = f.napeWorld().center.add(new V3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3)); g.fx?.impact?.(c, _a.set(0, 1, 0), 'stone'); g.fx?.steam?.(c, 3, 2, null); }
        g.audio?.titanFall?.(f.position, 20);
        p.cam.trauma = Math.min(1, p.cam.trauma + 0.5);
        g.hud?.message?.('THE EXPLOSIVES DON\'T BREAK THE CRYSTAL', 2.4, 'warn');
      }
      if (this.pt > 22) this._scream();
      return;
    }
    if (this.phase === 'defend') {
      this._updateHarpoons();
      this._script(this.pt, [
        [2, 'Erwin', 'All units, engage! Protect the Female Titan with your lives!'],
        [6, 'Levi', 'She called them to eat her. Tch.'],
        [20, 'Petra', 'There are too many! They\'re on her!'],
      ]);
      if (f.eatenHp <= 0 || this.pt > 55) this._escape();
      return;
    }
    if (this.phase === 'escaped' && this.pt > 4) this._chapter('SHE ESCAPED IN THE STEAM');
  }
  _trap() {
    const g = this.g, f = this.female;
    this.phase = 'trap'; this.pt = 0;
    f.bind(true); f.speed = 0;
    // the special target restraining weapon: harpoons fired from the trees round her into every limb
    const N = 18, pos = new Float32Array(N * 6);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.harpoons = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x2a2624 }));
    this.harpoons.frustumCulled = false;
    const J = ['spine', 'armL', 'armR', 'foreL', 'foreR', 'thighL', 'thighR', 'shinL', 'shinR', 'neck', 'pelvis'];
    this.harpoonAt = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + Math.random() * 0.3, r = 28 + Math.random() * 14;
      this.harpoonAt.push({ from: new V3(f.position.x + Math.cos(a) * r, f.position.y + 12 + Math.random() * 26, f.position.z + Math.sin(a) * r), j: J[i % J.length] });
    }
    g.scene.add(this.harpoons);
    this._updateHarpoons();
    for (const h of this.harpoonAt) g.fx?.steam?.(h.from, 2, 1.5, null);
    g.audio?.titanFall?.(f.position, 25);
    g.player.cam.trauma = 1;
    g.hud?.message?.('THE TRAP · SHE IS RESTRAINED', 3, 'big');
    this.flow.score += 1500;
  }
  _updateHarpoons() {
    const H = this.harpoons, f = this.female;
    if (!H || !f) return;
    const a = H.geometry.attributes.position;
    this.harpoonAt.forEach((h, i) => { a.setXYZ(i * 2, h.from.x, h.from.y, h.from.z); const j = f._jpos(h.j, _a); a.setXYZ(i * 2 + 1, j.x, j.y, j.z); });
    a.needsUpdate = true;
  }
  _scream() {
    const g = this.g, f = this.female;
    this.phase = 'defend'; this.pt = 0;
    f.scream(5);
    g.hud?.message?.('SHE SCREAMED · THE TITANS ARE COMING', 3.5, 'big');
    g.audio?.setMusic?.(1);
    // from every side, out of the trees, all of them for her
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.random() * 0.4, r = 75 + Math.random() * 40;
      this._spawn(new V3(f.position.x + Math.cos(a) * r, 0, f.position.z + Math.sin(a) * r), 7 + Math.random() * 7,
        { kind: i === 5 ? 'abnormal' : 'normal', then: (t) => { if (t && !t.abnormal) { t.drawnTo = f; t.noticeRange = 60; } } });
    }
  }
  _escape() {
    const g = this.g, f = this.female;
    this.phase = 'escaped'; this.pt = 0;
    const c = f._jpos('spine', new V3());
    for (let i = 0; i < 6; i++) g.fx?.steam?.(c.clone().add(new V3((Math.random() - 0.5) * 8, Math.random() * 10, (Math.random() - 0.5) * 8)), 16, 6);
    for (const t of g.titans?.titans || []) if (t.drawnTo === f) t.drawnTo = null;
    f.dispose(); this.female = null;
    if (this.harpoons) { this.harpoons.removeFromParent(); this.harpoons.geometry.dispose(); this.harpoons = null; }
    g.hud?.message?.('SHE GOT AWAY IN THE STEAM', 3, 'big');
    this._say('Erwin', 'Her body\'s gone. She escaped in the steam, in a cloak like ours. Fire the retreat signal.');
    g.fx?.flare?.(g.player.pos.clone().add(new V3(6, 0, 0)), 'green');
  }

  // ================================================================ chapter 4: Squad Levi
  _squad4(init) {
    const g = this.g, p = g.player;
    if (!init) return;
    this.phase = 'regroup'; this.waitForYou = false;
    (g.allies || []).forEach((a, i) => {
      const ang = (i / 5) * Math.PI * 2;
      _a.set(p.pos.x + Math.cos(ang) * 6, 0, p.pos.z + Math.sin(ang) * 6); _a.y = this._ground(_a.x, _a.z) + 1;
      a.dismount?.(true); this._place(a, _a);
    });
    g.hud?.message?.('SQUAD LEVI', 3, 'big');
  }
  _update4(dt) {
    const g = this.g, p = g.player, t = this.t, ph = this.phase;
    const f = this.female;
    this.pt += dt;
    if (ph === 'regroup') {
      this._script(t, [
        [1, 'Eld', 'The captain\'s gone for gas. We head for the horses and wait for him there.'],
        [4, 'Oluo', 'Hmph. The great Female Titan, beaten by the captain\'s plan. I knew it would end like this.'],
        [6.5, 'Petra', 'Someone fired a flare from the trees ahead... ours?'],
      ]);
      if (t > 6.2 && !this.lines.has('flare')) { this.lines.add('flare'); g.fx?.flare?.(p.pos.clone().add(new V3(-30, 20, -80)), 'green'); }
      if (t > 9 && !this.lines.has('gunther')) {
        this.lines.add('gunther');
        this._killAlly(this._ally('Gunther'), null, 'A hooded soldier dropped out of the trees and cut Gunther\'s neck.');
        this._say('Eld', 'GUNTHER!');
        this._say('Petra', 'Who\'s there?! Show yourself!');
      }
      if (t > 12) {
        this.phase = 'squad'; this.pt = 0;
        const at = p.pos.clone().addScaledVector(fwd(p.yaw + Math.PI, _a), 55);
        this._transform(at, 0.6);
        const fem = this._female(at, Math.atan2(p.pos.x - at.x, p.pos.z - at.z));
        fem.setMode('fight');
        g.hud?.message?.('THE FEMALE TITAN', 3, 'big');
        this._say('Eld', 'Eren, keep going! We\'ll take her! Trust us!');
        g.audio?.setMusic?.(0.9);
      }
      return;
    }
    if (!f && ph !== 'won') return;
    if (ph === 'squad') {
      const eld = this._ally('Eld'), petra = this._ally('Petra'), oluo = this._ally('Oluo');
      if (this.pt > 3 && !this.lines.has('blind')) {
        this.lines.add('blind');
        const hw = f._headWorld(new V3()).addScaledVector(fwd(f.yaw, _a), 3);
        if (eld) this._place(eld, hw.clone().addScaledVector(rgt(f.yaw, _b), 2));
        if (petra) this._place(petra, hw.clone().addScaledVector(rgt(f.yaw, _b), -2));
        f.applyHit({ part: 'eye', damage: 100, point: hw });
        this._say('Eld', 'Her eyes are out! She can\'t see!');
        this._say('Oluo', 'Her arms! Cut the muscles so she can\'t guard her nape!');
        this.blindAt = this.pt;
      }
      // the squad cuts too: an arm every few seconds if you don't
      if (this.blindAt && this.pt - this.blindAt > 5 && f.limp[0] <= 0) f.applyHit({ part: 'arm', damage: 100, point: f._jpos('armL', new V3()) });
      if (this.blindAt && this.pt - this.blindAt > 8 && f.limp[1] <= 0) f.applyHit({ part: 'arm', damage: 100, point: f._jpos('armR', new V3()) });
      if (this.blindAt && this.pt - this.blindAt > 9.5 && !this.lines.has('oluo')) {
        this.lines.add('oluo');
        if (oluo) this._place(oluo, f.napeWorld().center.addScaledVector(f.napeWorld().normal, 3));
        f.applyHit({ part: 'nape', damage: 300, point: f.napeWorld().center });
        this._say('Oluo', 'What—? My blades! Her nape... it\'s crystal!');
      }
      return;
    }
    if (ph === 'kills') {
      const order = [
        ['Eld', 'bite', 'She healed one eye first. She bit Eld in half out of the air.', (fe) => fe._headWorld(new V3()).addScaledVector(fwd(fe.yaw, _a), 5)],
        ['Petra', 'stomp', 'She stomped Petra against a tree.', (fe) => fe.position.clone().addScaledVector(fwd(fe.yaw, _a), 6).setY(fe.position.y + 1.5)],
        ['Oluo', 'kick', 'Oluo\'s blade shattered on her nape. She kicked him into a trunk.', (fe) => fe.position.clone().addScaledVector(rgt(fe.yaw, _a), 5).setY(fe.position.y + 5)],
      ];
      const k = order[this.step];
      if (k && this.pt > 1.4 + this.step * 2.6 && f.state !== 'strike') {
        const [name, kind, line, where] = k, a = this._ally(name);
        this.step++;
        if (a?.alive) this._strikeAt(kind, a, where(f), (pt) => this._killAlly(a, pt, line));
      }
      if (this.step >= 3 && this.pt > 10.5) this._erenTransforms();
      return;
    }
    if (ph === 'eren') {
      const e = this.eren;
      this._script(this.pt, [[1, 'Eren', 'I\'ll kill you!'], [4, 'Eren', 'I should have fought from the start!']]);
      if (f.state !== 'strike' && e.state !== 'strike' && this.pt > 2 && (this.stepT -= dt) <= 0) {
        this.stepT = 1.7;
        const n = this.step++;
        if (n < 7) {
          const [att, def] = n % 2 === 0 ? [e, f] : [f, e];
          att.strike(n % 4 === 1 ? 'kick' : 'punch', () => def._headWorld(_c), (q) => { def.flinch = 1; g.fx?.impact?.(q, _a.set(0, 1, 0), 'flesh'); g.audio?.titanStep?.(q, 40); g.events.emit('titan:step', { position: q, size: 40 }); }, { sure: true });
        } else if (n === 7) {
          // Annie's stance; then the hardened fist
          this._say('Eren', '...that stance. Annie?!');
          f.strike('punch', () => e._headWorld(_c), (q) => { g.fx?.impact?.(q, _a.set(0, 1, 0), 'stone'); g.fx?.steam?.(q, 8, 3); e.stunT = 3; g.player.cam.trauma = 1; }, { sure: true, W: 0.6 });
        } else if (n === 8) {
          f.strike('bite', () => e.napeWorld().center, (q) => {
            g.fx?.blood?.(q, _a.set(0, 1, 0), 3); g.fx?.steam?.(q, 12, 5);
            for (let i = 0; i < 4; i++) g.fx?.steam?.(e._jpos('spine', new V3()).add(new V3(0, i * 3, 0)), 10, 6);
            e.dispose(); this.eren = null;
            f.brawl(null); f.setMode('run'); f.paceMul = 0.72; f.runTo.set(roadX(980), 0, 1000);
            this.phase = 'chase'; this.pt = 0;
            const m = this._ally('Gunther');
            if (m) { m.name = 'Mikasa'; m.revive(); this._place(m, p.pos.clone().add(new V3(3, 2, 0))); }
            g.hud?.message?.('SHE BIT EREN OUT OF HIS NAPE', 3, 'big');
          }, { sure: true });
        }
      }
      return;
    }
    if (ph === 'chase') {
      this._script(this.pt, [
        [1.5, 'Mikasa', 'She has Eren in her mouth! I\'m going after her!'],
        [5, 'Levi', 'Mikasa. Don\'t do anything stupid. We bring him back; we don\'t kill her.'],
      ]);
      if ((this.pt > 8 && f.position.distanceTo(p.pos) < 50) || this.pt > 30) this._levi();
      return;
    }
    if (ph === 'mouth') {
      this._script(this.pt, [[2, 'Levi', 'Now. Cut him out of her jaw while she can\'t move.']]);
      if (this.pt > 40) this._freeEren(true);
      return;
    }
    if (ph === 'freed' && this.pt > 3) this._chapter('WE GOT EREN BACK', true);
  }
  /** Her one eye has healed: she stands up and kills the squad. */
  _sees() {
    if (this.ch !== 3 || this.phase !== 'squad') return;
    this.phase = 'kills'; this.pt = 0; this.step = 0;
    this._say('Petra', 'Wait... she\'s seeing! One eye\'s back already—');
  }
  _erenTransforms() {
    const g = this.g, f = this.female, er = this._ally('Eren');
    this.phase = 'eren'; this.pt = 0; this.step = 0; this.stepT = 0;
    const from = er?.alive ? er.pos.clone() : g.player.pos.clone();
    const at = f.position.clone().addScaledVector(_a.subVectors(from, f.position).setY(0).normalize(), 22);
    if (er) { this._hide(er); er.name = 'Eren\u200b'; }   // (his titan speaks for him now)
    this._transform(at, 1);
    const e = this.eren = spawnFemale(g.titans, at, Math.atan2(f.position.x - at.x, f.position.z - at.z), { spec: ERE, height: 15 });
    e.brawl(f); f.brawl(e); f.setMode('brawl');
    g.hud?.message?.('EREN TRANSFORMS', 2.5, 'big');
  }
  _levi() {
    const g = this.g, f = this.female;
    this.phase = 'mouth'; this.pt = 0;
    const levi = (pt, sz) => { g.fx?.slashArc?.(pt, f.root.quaternion, sz); g.fx?.blood?.(pt, _a.set(0, 1, 0), 1.6); };
    // he spins along her at a speed nobody else can: eyes, both arms, the ankles, and she's down
    levi(f._headWorld(new V3()), 3); f.applyHit({ part: 'eye', damage: 100, point: f._headWorld(new V3()) });
    for (const j of ['armL', 'armR']) { const q = f._jpos(j, new V3()); levi(q, 3); f.applyHit({ part: 'arm', damage: 100, point: q }); }
    const ft = f._jpos('footL', new V3()); levi(ft, 2); f.applyHit({ part: 'ankle', damage: 100, point: ft });
    f.crippleT = 60; f.blindT = 60; f.limp = [60, 60]; f.mouthOpenable = true; f.setMode('hold');
    g.hud?.message?.('CAPTAIN LEVI', 3, 'big');
    this._say('Levi', 'Mikasa, hold back. Your rage is clouding your judgement.');
    this._say('Mikasa', 'Captain... your leg. You hurt it saving me.');
    g.hud?.message?.('CUT EREN OUT OF HER MOUTH: strike her jaw', 3.5, 'info');
  }
  _freeEren(byLevi) {
    const g = this.g, f = this.female;
    if (this.ch !== 3 || this.phase !== 'mouth' || !f) return;
    this.phase = 'freed'; this.pt = 0;
    f.mouthOpenable = false;
    const m = f._mouthWorld(new V3());
    g.fx?.blood?.(m, _a.set(0, 1, 0), 3); g.fx?.steam?.(m, 6, 3);
    if (!byLevi) this.flow.score += 3000;
    this._say('Levi', byLevi ? 'Tch. I\'ll do it myself.' : 'Good. He\'s out. He\'s covered in spit, but he\'s alive.');
    this._say('Levi', 'Retreat. We\'re done here.');
    g.hud?.message?.('EREN IS FREE', 3, 'big');
    // she sits against the tree, crying, and lets them go
    f.mode = 'hold';
  }

  // ---------------------------------------------------------------- flow
  _chapter(title, last = false) {
    if (this.done) return;
    this.done = true; this.phase = 'won'; this.title = title;
    this.flow.score += 2000;
    this.g.audio?.setMusic?.(0.25);
    this.g.hud?.message?.(title, 3.2, 'big');
    this.flow.chapterDone('scout', { title, delay: last ? 3500 : 2500 });
  }

  update(dt) {
    if (this.phase === 'none' || this.phase === 'won') { if (this.phase === 'won') this._moveLead(dt); return; }
    this.t += dt;
    this._moveLead(dt);
    this._flareKey();
    [this._update1, this._update2, this._update3, this._update4][this.ch].call(this, dt);
    this._holdPins();
  }

  // ---------------------------------------------------------------- HUD
  objective() {
    const g = this.g, f = this.female, p = g.player, ph = this.phase;
    if (ph === 'won') return this.title;
    const relay = this.want ? keys.fill(` · RELAY ${this.want.color.toUpperCase()}: {flare}`) : '';
    const dist = (o) => (o ? `${Math.round(o.position.distanceTo(p.pos))} m` : '');
    switch (this.ch) {
      case 0:
        if (ph === 'gate') return 'THE 57TH EXPEDITION · ride out with the formation';
        if (ph === 'abnormal') return `BLACK SMOKE · kill the abnormal before it reaches the riders ${this.abnormal?.alive ? dist(this.abnormal) : ''}${relay}`;
        if (ph === 'rejoin') return keys.fill('Back to the formation: on horseback near Erwin ({whistle} calls your horse)');
        return `LONG-RANGE SCOUTING FORMATION · watch the sky for smoke${relay}`;
      case 1:
        if (ph === 'ride') return 'THE RIGHT WING · something is coming out of the trees';
        if (ph === 'harass') return `SLOW HER DOWN · cut her legs and arms (${this.hits}/3) · she's ${dist(f)} away`;
        if (ph === 'gone') return 'SHE IS RUNNING FOR THE CENTRE REAR';
        return `THE FEMALE TITAN · ${dist(f)} · stay alive`;
      case 2:
        if (ph === 'ride') return `RIDE · Levi's order: do not fight · she's ${f ? Math.max(0, Math.round(this.lead.pos.z - f.position.z)) + ' m behind' : 'coming'}`;
        if (ph === 'trap') return 'SHE IS RESTRAINED · try her nape yourself';
        if (ph === 'defend') return `DEFEND THE FEMALE TITAN · kill the titans eating her · ${Math.max(0, Math.round((f?.eatenHp || 0) / 1.6))}% left`;
        return 'SHE ESCAPED';
      default:
        if (ph === 'regroup') return 'SQUAD LEVI · head for the horses';
        if (ph === 'squad') return f?.blindT > 0 ? `SHE IS BLIND · cut her arms so she can't guard (${f.limp.filter((x) => x > 0).length}/2)` : 'FIGHT BESIDE THE SQUAD';
        if (ph === 'kills') return 'SHE CAN SEE AGAIN';
        if (ph === 'eren') return 'EREN FIGHTS HER · cut her ankles and arms to help him';
        if (ph === 'chase') return `CATCH HER · she has Eren in her mouth · ${dist(f)}`;
        if (ph === 'mouth') return 'CUT EREN OUT OF HER MOUTH · strike her jaw';
        return 'EREN IS SAFE';
    }
  }
}
