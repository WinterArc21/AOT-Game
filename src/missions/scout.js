// The 57th Exterior Scouting Mission (anime season 1, episodes 17–22; manga chapters 23–30), as one mission in four
// acts. Each act is a checkpoint: die, and you start again from the last one.
//  0 Ride Out: at dawn the formation rides out of the gate in a column and spreads into the Long-Range Scouting
//    Formation across the plain. Wing scouts draw the signal gun and fire red smoke at a titan, black at an abnormal;
//    Erwin fires green for the new course. You relay each one (T). An abnormal comes for the right wing.
//  1 The Right Flank: the Female Titan comes out of the trees with no flare before her. She snatches Luke Cis, kicks
//    Dieter Ness down, throws Armin and stoops to lift his hood. Reiner and Jean hood up with you to slow her; Armin's
//    bluff freezes her; she catches Reiner, who cuts his way out, and she runs for the centre rear.
//  2 The Forest of Giant Trees (after a cut): only the centre column goes in. You ride with Levi's squad, she runs
//    them down the road, killing the soldiers behind, and Levi only says to ride. She runs into Erwin's trap; her nape
//    is hardened; she screams, the titans come to eat her, the Corps defends her, and she gets away in the steam.
//  3 Squad Levi: she comes back for Eren. Gunther, Eld, Petra and Oluo die; Eren transforms and loses; she bites him
//    out of his nape and runs; Mikasa and Levi catch her, and you cut Eren out of her mouth.
// Scenes are told with the director (game.cine: set shots in letterbox, or the view turning to look at something
// while you ride on) and subtitles. Story source: the AOT wiki's episode and expedition pages.
import * as THREE from 'three';
import { Horse } from '../player/horse.js';
import { spawnFemale } from '../titans/female.js';
import { ERE } from '../titans/carrier.js';
import { roadX, FS } from '../world/terrain.js';
import * as keys from '../keys.js';

const V3 = THREE.Vector3;
const clamp = THREE.MathUtils.clamp;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const fwd = (yaw, out = new V3()) => out.set(Math.sin(yaw), 0, Math.cos(yaw));
const rgt = (yaw, out = new V3()) => out.set(-Math.cos(yaw), 0, Math.sin(yaw));   // the rider's right (steerToSlot)
const beyond = (a, b) => a.clone().multiplyScalar(2).sub(b);                      // the far side of a, seen from b
const _a = new V3(), _b = new V3(), _c = new V3();
const TRAP_Z = 590 + FS;   // the trap in the forest, on the road
const RELAY_T = 8;         // s to relay a signal before the next rider does it for you
const CADETS = ['Armin', 'Reiner', 'Jean', 'Connie', 'Christa'];
const SQUAD = ['Petra', 'Oluo', 'Eld', 'Gunther', 'Eren'];

export const ACTS = ['Ride Out', 'The Right Flank', 'The Forest of Giant Trees', 'Squad Levi'];
export const CHAPTERS = [
  { title: 'The 57th Expedition', eps: 'Episodes 17–22', desc: 'The Long-Range Scouting Formation, the Female Titan, the forest trap and Squad Levi. One mission, with checkpoints.' },
];

export class ScoutMission {
  constructor(flow) {
    this.flow = flow; this.g = flow.g;
    this.phase = 'none'; this.done = false;
    this.horses = []; this.borrowed = []; this.pins = new Map(); this.clock = 0;
    const ev = this.g.events, on = (n, f) => ev.on(n, (e) => { if (this.g.mode === 'scout' && this.phase !== 'none') f(e); });
    on('player:hit', (e) => this._onPlayerHit(e));
    on('female:mouth', () => this._freeEren(false));
    on('female:sees', () => this._sees());
    on('titan:killed', (e) => { if (!e.by) this.kills = (this.kills || 0) + 1; });
    on('player:kicked', () => this.g.hud?.message?.('KICKED!', 1.2, 'warn'));
    on('female:scream', () => { this.g.player.cam.trauma = 1; });
  }

  /** The sky: dawn on the plain; full day by the time the centre column reaches the forest. */
  atmosphere(ch) { return ch < 2 ? 'dawn' : 'day'; }

  /** Where the player starts an act (Game resets them there; the act puts them in the saddle). */
  spawn(ch) {
    const y = (x, z) => this.g.collision.groundHeight(x, z);
    const at = [[-9, 59, 0], [140, 375, Math.PI / 2], [roadX(505), 505, 0], [roadX(TRAP_Z + 30) + 3, TRAP_Z + 30, Math.PI]][ch] || [-9, 59, 0];
    return { position: new V3(at[0], y(at[0], at[1]), at[1]), yaw: at[2] };
  }

  // ---------------------------------------------------------------- setup
  start(ch) {
    this.done = false; this.lines = new Set(); this.subQ = []; this.subT = 0; this.cut = null; this.kills = 0;
    this.g.cine = { shot: null, focus: null, bars: false };
    this._enterAct(ch, true);
  }

  /** Begin act n. fresh: from a checkpoint (or the start), with nothing of the act before it left in the world. */
  _enterAct(n, fresh) {
    const g = this.g;
    this.ch = n; this.flow.chapter = n; this.t = 0; this.pt = 0; this.want = null; this.hits = 0; this.step = 0; this.stepT = 0;
    if (fresh) { this._clearCast(); this.female = null; this.eren = null; }
    const names = n < 2 ? CADETS : SQUAD;
    (g.allies || []).forEach((a, i) => { a._baseName = a._baseName || a.name; a.name = names[i] || a._baseName; if (fresh) a.revive(); });
    [this._ride0, this._flank1, this._forest2, this._squad3][n].call(this, fresh);
    if (!fresh) g.hud?.message?.(`CHECKPOINT · ${ACTS[n].toUpperCase()}`, 2, 'info');
    g.audio?.setMusic?.(n === 0 ? 0.35 : 0.55);
  }

  /** Take the act's riders, borrowed horses, harpoons and pinned comrades out of the world. */
  _clearCast() {
    const g = this.g, p = g.player;
    for (const h of this.horses) { if (h.rider === p) { p.riding = null; h.rider = null; } h.root.removeFromParent(); const i = g.herd?.horses.indexOf(h); if (i >= 0) g.herd.horses.splice(i, 1); }
    for (const b of this.borrowed) {
      const h = b.h; h.follow = null; h.autoSlot = null;
      if (h.rider === p) { p.riding = null; } else if (h.rider) h.rider.horse === h && h.rider.dismount?.(true);
      h.rider = null; h.pos.copy(b.pos); h.home.copy(b.pos); h.yaw = b.yaw; h.speed = 0;
    }
    this.horses = []; this.borrowed = []; this.riders = []; this.pins.clear(); this.lead = null;
    if (this.harpoons) { this.harpoons.removeFromParent(); this.harpoons.geometry.dispose(); this.harpoons = null; }
  }

  dispose() {
    const g = this.g;
    this._clearCast();
    for (const a of g.allies || []) if (a._baseName) a.name = a._baseName;
    this.female = null; this.eren = null; this.cut = null;
    g.cine = null; g.hud?.hideSubtitle?.(); g.hud?.fade?.(false);
    this.phase = 'none';
  }

  // ---------------------------------------------------------------- the director: subtitles, shots, cuts
  _say(who, text, key = who + text) {
    if (this.lines.has(key)) return;
    this.lines.add(key);
    const ally = (this.g.allies || []).find((a) => a.name === who);
    if (ally && !ally.alive) return;     // the dead don't speak
    this.subQ.push([who, text]);
  }
  _narrate(text) { if (!this.lines.has(text)) { this.lines.add(text); this.subQ.push([null, text]); } }
  /** Lines on a clock: [[t, who, text], …], said once each as `t` passes (who null: the narrator). */
  _script(t, list) { for (const [at, who, text] of list) if (t >= at) (who ? this._say(who, text) : this._narrate(text)); }
  _subs(dt) {
    if ((this.subT -= dt) > 0 || !this.subQ.length) return;
    const [who, text] = this.subQ.shift();
    this.subT = clamp(1.3 + text.length * 0.05, 2.2, 5.5) / (1 + 0.35 * this.subQ.length);
    this.g.hud?.subtitle?.(who, text, this.subT + 0.15);
  }
  /** A set shot for `dur` s (letterboxed): the camera at pos(), looking at look(). */
  _shot(dur, pos, look, fov = 50) { this.g.cine.shot = { pos, look, fov }; this.shotEnd = this.clock + dur; }
  /**
   * A shot of center(): from the side of `from()` (or at world angle `yaw`, turning `spin` rad/s), `dist` m off and
   * `h` m up, looking at look() (default the centre). Points are functions, so the shot follows what it frames.
   */
  _shotAt(dur, center, { from = null, yaw = 0, dist = 20, h = 4, spin = 0, fov = 50, look = null } = {}) {
    const t0 = this.clock, dir = new V3(), cc = new V3(), col = this.g.collision;
    this._shot(dur, (out) => {
      cc.copy(center());
      if (from) { dir.subVectors(from(), cc).setY(0); if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1); dir.normalize(); }
      else { const a = yaw + spin * (this.clock - t0); dir.set(Math.sin(a), 0, Math.cos(a)); }
      out.copy(cc).addScaledVector(dir, dist); out.y += h;
      out.y = Math.max(out.y, col.groundHeight(out.x, out.z) + 1.2);
      return out;
    }, (out) => out.copy(look ? look() : center()), fov);
  }
  /** The view turns to look at at() for `dur` s while you ride on (the head turning to a titan). */
  _focus(dur, at) { this.g.cine.focus = at; this.focusEnd = this.clock + dur; }
  _director(dt) {
    const c = this.g.cine;
    if (!c) return;
    if (c.shot && this.clock > this.shotEnd) c.shot = null;
    if (c.focus && this.clock > this.focusEnd) c.focus = null;
    c.bars = !!c.shot || !!this.cut;
  }
  /** Fade to black, the narrator's line over it, and the next act set up behind the black. */
  _cutTo(n, line) {
    this.cut = { t: 0, n, done: false };
    this.g.hud?.fade?.(true);
    this.subQ.length = 0; this.subT = 0;
    if (line) this._narrate(line);
    this.phase = 'cut';
  }
  _cutStep(dt) {
    const C = this.cut, g = this.g;
    C.t += dt;
    if (!C.done && C.t > 0.9) {
      C.done = true;
      g.titans?.clear?.();
      const sp = this.spawn(C.n);
      this._clearCast();
      g.player.reset(sp.position.clone().add(new V3(0, 0.6, 0)), sp.yaw);
      g.world?.setAtmosphere?.(this.atmosphere(C.n));
      this._enterAct(C.n, true);
      g.hud?.message?.(`CHECKPOINT · ${ACTS[C.n].toUpperCase()}`, 2, 'info');
      this.t = -2.2;   // (the act's clock starts when the picture comes back)
    }
    if (C.t > 3) { g.hud?.fade?.(false); this.cut = null; }
  }

  // ---------------------------------------------------------------- helpers
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
    this.lead = { pos: new V3(at.x, this._ground(at.x, at.z), at.z), yaw, speed: speed * 0.5, want: speed, path: path.map(([x, z]) => new V3(x, 0, z)), i: 0 };
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
    L.pos.addScaledVector(fwd(L.yaw, _a), L.speed * dt);
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
    const h = new Horse(g, this._slotAt(slot), L.yaw, 0.11 + this.horses.length * 0.173);
    h.speed = L.want * 0.6; h.mountCd = 1e9;
    h.follow = { lead: L, slot };
    h.addDummyRider({ hood });
    g.herd?.horses.push(h);
    this.horses.push(h);
    const r = { name, h, slot, base: { x, z }, alive: true, head: () => h.pos.clone().setY(h.pos.y + 2.3) };
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
  /** The player in the saddle at their slot (hands off the reins: the horse keeps it), the comrades in theirs. */
  _mountUp(playerSlot, allySlots) {
    const g = this.g, p = g.player, herd = g.herd?.horses || [];
    const free = herd.filter((h) => !this.horses.includes(h) && !this.borrowed.some((b) => b.h === h));
    const take = () => { const h = free.shift(); if (h) this.borrowed.push({ h, pos: h.home.clone(), yaw: h.yaw }); return h; };
    const L = this.lead, h = take();
    if (h) {
      const slot = { x: playerSlot[0], z: playerSlot[1] };
      h.pos.copy(this._slotAt(slot)); h.yaw = L.yaw; h.speed = L.want * 0.6; h.home.copy(h.pos);
      h.autoSlot = { lead: L, slot };
      h.rider = p; p.riding = h; p.yaw = L.yaw; h.saddle(p.pos); p.prev.copy(p.pos); p.render.copy(p.pos);
    }
    (g.allies || []).forEach((a, i) => {
      const s = allySlots[i];
      if (!s || !a.alive) return;
      const hh = take();
      if (!hh) return;
      const slot = { x: s[0], z: s[1], lead: L, stay: true };
      hh.pos.copy(this._slotAt(slot)); hh.yaw = L.yaw; hh.speed = L.want * 0.6; hh.home.copy(hh.pos);
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
  /** A rider draws the signal gun and fires; the camera turns to watch; the player should relay it (T). */
  _signal(r, color, dir = null, look = true) {
    if (!r?.alive) return;
    r.h.fireFlare(color, dir);
    if (look) this._focus(3, () => r.h.pos.clone().setY(r.h.pos.y + 4 + 10 * Math.min(1, this.clock - this._sigAt)));
    this._sigAt = this.clock;
    this.want = { color, t: RELAY_T, dir: dir ? dir.clone() : null };
    this.g.hud?.message?.(keys.fill(`${color.toUpperCase()} SMOKE · relay it: {flare}`), 3, 'info');
  }
  _flareKey() {
    const g = this.g, p = g.player;
    if (!g.input?.actHit?.('flare') || !p.alive || (g.time - (this._flareAt ?? -9)) < 1.2) return;
    this._flareAt = g.time;
    const w = this.want;
    p.fireFlare(w?.color || 'red', w?.dir || null);
    if (w) {
      this.want = null;
      this.flow.score += 250;
      g.hud?.message?.('SIGNAL RELAYED  +250', 1.6, 'info');
    }
  }
  _relayTimeout(dt) {
    const w = this.want;
    if (!w || (w.t -= dt) > 0) return;
    this.want = null;
    const r = this.riders.find((x) => x.alive && x.name.startsWith('scout'));
    r?.h.fireFlare(w.color, w.dir);
    this.g.hud?.feed?.('Too slow! I relayed it for you. Keep your eyes on the sky.', 'radio', 'Hange');
  }

  // ---------------------------------------------------------------- the Female Titan
  _female(at, yaw) {
    const f = this.female = spawnFemale(this.g.titans, at, yaw);
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
    if (!e.titan?.female) return;
    const fx = e.result?.effect;
    if (fx === 'hardened') { this.g.hud?.message?.('HARDENED! YOUR BLADES SHATTERED ON HER NAPE', 2.4, 'warn'); return; }
    if (fx && fx !== 'none') this.hits++;
    if (fx === 'limp') { this.flow.score += 400; this.g.hud?.message?.('ARM CUT: IT HANGS LIMP', 1.4, 'info'); }
    if (fx === 'cripple') { this.flow.score += 400; this.g.hud?.message?.('ANKLE CUT: SHE\'S DOWN', 1.4, 'info'); }
    if (fx === 'blind') { this.flow.score += 300; this.g.hud?.message?.('EYES CUT: SHE COVERS HER NAPE', 1.4, 'info'); }
  }
  /** Her strike at a comrade held in place (the story's deaths land: sure), with a shot of it. */
  _strikeAt(kind, a, at, onHit) {
    const f = this.female;
    this._pin(a, at);
    this._shotAt(2.4, () => at.clone(), { from: () => beyond(at, f.position), dist: 11, h: 1.5, look: () => f._headWorld(new V3()).lerp(at, 0.45), fov: 55 });
    return f.strike(kind, () => (a.alive ? a.pos : at), (pt) => onHit(pt), { sure: true });
  }
  /** Her blow at a formation rider, with a cut to it. */
  _strikeRider(kind, r, line) {
    const f = this.female;
    if (!f.strike(kind, () => r.head(), () => this._killRider(r, line), { sure: true, run: true })) return false;
    this._shotAt(2.3, () => r.head(), { from: () => beyond(r.head(), f.position), dist: 13, h: 1, look: () => f._headWorld(new V3()).lerp(r.head(), 0.5), fov: 56 });
    return true;
  }

  // ================================================================ act 0: Ride Out
  /** The whole formation on lead L (rider slots: metres to the lead's right, ahead). */
  _formation(spread) {
    const R = [
      ['Erwin', 0, 0], ['Hange', -6, -14], ['Moblit', 6, -14],                                  // command
      ['scout R1', 95, 40, true], ['scout R2', 140, 5, true], ['scout R3', 120, -40, true],      // right wing
      ['scout L1', -95, 40, true], ['scout L2', -140, 5, true], ['scout L3', -120, -40, true],   // left wing
      ['wagon 1', 0, -36], ['wagon 2', 0, -52],
    ];
    for (const [n, x, z, hood] of R) this._rider(n, x, z, { hood });
    this._spread(spread);
    this._mountUp([45, -10], [[52, -18], [38, -22], [60, -28], [30, -16], [22, -40]]);
  }
  /** 0: a tight column out of the gate; 1: the full Long-Range Scouting Formation. */
  _spread(k) {
    const e = k * k * (3 - 2 * k);
    for (const r of this.riders) { r.slot.x = THREE.MathUtils.lerp(r.base.x * 0.12, r.base.x, e); r.slot.z = THREE.MathUtils.lerp(r.base.z * 0.5 - 6, r.base.z, e); }
    for (const a of this.g.allies || []) if (a.slot?.base) { a.slot.x = THREE.MathUtils.lerp(a.slot.base[0] * 0.2, a.slot.base[0], e); }
    const ph = this.g.player.riding?.autoSlot?.slot;
    if (ph) ph.x = THREE.MathUtils.lerp(9, 45, e);
  }
  _ride0(fresh) {
    const g = this.g;
    this.phase = 'gate'; this.waitForYou = true;
    if (fresh) {
      // out of the gate, north-west across the plain
      this._makeLead(new V3(0, 0, 70), 0, [[roadX(120), 120], [-120, 210], [-260, 280]], 14);
      this._formation(0);
      for (const a of g.allies || []) if (a.slot) a.slot.base = [a.slot.x, a.slot.z];
      this._spread(0);
      this._spawn(new V3(-70, 0, 55), 9, { yaw: 1.2, then: (t) => { this.support = t; } });
    }
    // opening shots: the column streams out of the gate toward the camera; then the crane over the formation
    this._shot(4.6, (o) => o.set(14, this._ground(14, 125) + 2.4, 125), (o) => o.set(0, 7, 45), 46);
    this._narrate('Karanes District, Wall Rose. The morning of the 57th Exterior Scouting Mission.');
    this._shotT = 4.6;
  }
  _update0(dt) {
    const g = this.g, L = this.lead, t = this.t;
    if (this._shotT && t > this._shotT) {
      this._shotT = 0;
      this._shotAt(4, () => L.pos.clone().addScaledVector(fwd(L.yaw, new V3()), 20), { yaw: L.yaw + Math.PI + 0.7, dist: 75, h: 48, fov: 52 });
    }
    this._script(t, [
      [1.6, 'Erwin', 'Advance! The 57th Exterior Scouting Mission begins!'],
      [4.8, null, 'Their orders: open a route to Shiganshina. Their true aim, known to a few: to draw out the titan inside the walls.'],
      [9.5, 'Erwin', 'Long-Range Scouting Formation: spread out!'],
      [12, 'Armin', 'Red smoke means a titan, black an abnormal. Green is the new course. Every signal gets passed on.'],
    ]);
    if (t > 5 && this.support?.alive) { const s = this.support; s.killedBy = { name: 'The support team' }; s.applyHit({ part: 'nape', damage: 1e5, point: s.napeWorld().center }); }
    if (t > 9.5 && t < 18) this._spread(clamp((t - 9.5) / 8, 0, 1));
    this._relayTimeout(dt);
    const ev = this.ev0 || (this.ev0 = {});
    if (t > 17 && !ev.red) {
      ev.red = 1; this.phase = 'ride';
      const s = this._riderNamed('scout R1');
      this._signal(s, 'red');
      this._say('Connie', 'Red smoke on the right! A titan!');
      const at = L.pos.clone().addScaledVector(fwd(L.yaw, _a), 200).addScaledVector(rgt(L.yaw, _b), 80);
      this._spawn(at, 11, { yaw: L.yaw + Math.PI });
    }
    if (t > 26 && !ev.green) {
      ev.green = 1;
      // Erwin turns the formation away from it: east, along the forest
      const dir = new V3(1, 0, 0.1).normalize();
      L.path = [L.pos.clone().addScaledVector(dir, 140).setZ(Math.max(L.pos.z + 30, 300)), new V3(1050, 0, 335)]; L.i = 0; L.want = 11;
      this._signal(this._riderNamed('Erwin'), 'green', dir);
      this._say('Jean', 'Green smoke from the command! We change course!');
    }
    if (t > 38 && !ev.black) {
      ev.black = 1;
      this._signal(this._riderNamed('scout R3'), 'black');
      this._say('Reiner', 'Black smoke! An abnormal on the right wing, and it\'s coming straight for them!');
      const at = L.pos.clone().addScaledVector(rgt(L.yaw, _a), 260).addScaledVector(fwd(L.yaw, _b), 40);
      this._spawn(at, 9, { kind: 'abnormal', then: (a) => { this.abnormal = a; if (a) { a.noticeRange = 400; this._focus(3, () => a._headWorld(new V3())); } } });
      this.phase = 'abnormal'; this.pt = 0;
    }
    if (this.phase === 'abnormal') {
      this.pt += dt;
      const a = this.abnormal;
      if (a && !a.alive) {
        this.phase = 'rejoin'; this.pt = 0;
        this.flow.score += 1000;
        this._say('Erwin', 'Good. Back to your place in the formation.');
      } else if (a?.alive) {
        // it goes for the right wing if you leave it to them
        const r = this._riderNamed('scout R3');
        if (r?.alive && r.h.pos.distanceTo(a.position) < a.footR + a.armLen) this._killRider(r, 'Fritz was caught by the abnormal.');
        if (this.pt > 32) { a.killedBy = { name: 'The right wing' }; a.applyHit({ part: 'nape', damage: 1e5, point: a.napeWorld().center }); }
      }
    }
    if (this.phase === 'rejoin' && (this.pt += dt) > 4) this._enterAct(1, false);
  }

  // ================================================================ act 1: The Right Flank
  _flank1(fresh) {
    this.phase = 'ride'; this.waitForYou = false;
    if (fresh) {
      this._makeLead(new V3(150, 0, 330), Math.PI / 2, [[1050, 335]], 11);
      this._formation(1);
    }
    const r = this.riders.filter((x) => x.alive && x.name.startsWith('scout R'));
    if (r[0]) r[0].name = 'Luke';
    if (r[1]) r[1].name = 'Ness';
    const c = this._ally('Christa');
    if (c?.horse) { c.slot.x = 0; c.slot.z = -90; }   // she rides with the spare horses at the back
  }
  _update1(dt) {
    const g = this.g, L = this.lead, t = this.t, f = this.female;
    const armin = this._ally('Armin'), reiner = this._ally('Reiner'), jean = this._ally('Jean');
    this.pt += dt;
    this._relayTimeout(dt);
    this._script(t, [
      [1, 'Armin', 'Smoke on the right... red? So faint. Something\'s wrong over there.'],
      [4, 'Ness', 'Titans out of the trees, and no flare before them! A whole pack!'],
    ]);
    const ph = this.phase;
    if (ph === 'ride' && t > 6) {
      // she comes out of the trees on the right, running as fast as the horses
      const at = L.pos.clone().addScaledVector(rgt(L.yaw, _a), 220).addScaledVector(fwd(L.yaw, _b), 80);
      const fe = this._female(at, L.yaw + Math.PI * 0.8);
      fe.setMode('run'); fe.paceMul = 1;
      for (const k of [-1, 1]) this._spawn(at.clone().addScaledVector(fwd(L.yaw, _a), 40 * k).addScaledVector(rgt(L.yaw, _b), 25), 8 + Math.random() * 5, { yaw: L.yaw + Math.PI });
      this.phase = 'luke'; this.pt = 0;
      this._focus(5, () => fe._headWorld(new V3()));
      g.hud?.message?.('A 14-METRE ABNORMAL', 2.4, 'warn');
      this._say('Ness', 'An abnormal! Luke, with me, we draw it off the formation!');
      return;
    }
    if (!f) return;
    if (ph === 'luke' || ph === 'ness') {
      const r = this._riderNamed(ph === 'luke' ? 'Luke' : 'Ness');
      if (r?.alive) {
        f.setMode('run'); f.runTo.copy(r.h.pos);
        if (f.position.distanceTo(r.h.pos) < 13 && f.state !== 'strike') {
          if (ph === 'luke') this._strikeRider('hand', r, 'She snatched Luke out of the air and threw him down.');
          else this._strikeRider('kick', r, 'She kicked Dieter Ness and his horse into the ground.');
        }
      } else if (f.state !== 'strike') {
        this.phase = ph === 'luke' ? 'ness' : 'armin'; this.pt = 0;
        if (ph === 'ness') { this._say('Armin', 'She isn\'t like the others... she\'s thinking.'); this._focus(3, () => f._headWorld(new V3())); }
      }
    }
    if (ph === 'armin' && armin) {
      f.setMode('run'); f.runTo.copy(armin.pos);
      if (f.position.distanceTo(armin.pos) < 13 && f.state !== 'strike') {
        f.strike('hand', () => armin.pos, () => {
          if (armin.horse) { const h = armin.horse; armin.dismount(true); h.crashed = 20; }
          g.fx?.impact?.(armin.pos, _a.set(0, 1, 0), 'ground');
          const at = armin.pos.clone(); at.y = this._ground(at.x, at.z) + 0.9;
          this._pin(armin, at);
          this.phase = 'look'; this.pt = 0;
          // she stoops over him and lifts his hood with one finger, looking into his face
          f.setMode('hold'); f.faceTo = at; f.lookAt = at; f.reachTo = at.clone().add(new V3(0, 0.8, 0));
          this._shotAt(4.2, () => at.clone(), { from: () => beyond(at, f.position), dist: 4.5, h: 0.6, look: () => f._headWorld(new V3()), fov: 58 });
        }, { sure: true });
      }
    }
    if (ph === 'look') {
      this._say('Armin', 'She lifted my hood... she\'s looking at our faces. She\'s looking for someone!');
      if (this.pt > 4.2) {
        this.phase = 'harass'; this.pt = 0; this.hits = 0;
        this.pins.delete(armin);
        f.faceTo = null; f.lookAt = null; f.reachTo = null; f.setMode('run'); f.paceMul = 1;
        for (const [a, x] of [[reiner, 48], [jean, 54]]) if (a?.horse) { a.slot.x = x; a.slot.z = -18; a.slot.base = null; }
        jean?.fireFlare('red');
        this._say('Jean', 'Armin! Get on, we\'re not leaving you! Hoods up! She can\'t tell which one of us she\'s after.');
        this._say('Reiner', 'If she reaches the centre rear, it\'s over. We slow her down here.');
        g.hud?.message?.('HOOD UP · SLOW HER DOWN: cut her legs and arms', 3, 'big');
      }
    }
    if (ph === 'harass') {
      f.runTo.copy(L.pos).addScaledVector(fwd(L.yaw, _b), -20);
      if (this.pt > 6 && this.pt < 9) this._focus(0.2, () => f._headWorld(new V3()));
      if (this.hits >= 3 || this.pt > 32) {
        this.phase = 'bluff'; this.pt = 0;
        f.setMode('hold'); f.faceTo = armin?.pos || g.player.pos;
        this._shotAt(3.6, () => f._headWorld(new V3()), { from: () => (armin?.pos || g.player.pos).clone(), dist: 16, h: -3, fov: 45 });
        this._say('Armin', 'That suicidal bastard is dead! Eren\'s gone! Your search ends here!');
      }
    }
    if (ph === 'bluff' && this.pt > 3.6 && reiner) {
      this.phase = 'reiner'; this.pt = 0;
      const at = f._jpos('armR', new V3()).addScaledVector(fwd(f.yaw, _a), 6);
      this._strikeAt('hand', reiner, at, () => this._say('Reiner', 'She\'s got me!'));
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
        this._focus(3.5, () => f._headWorld(new V3()));
        this._say('Armin', 'She\'s turning... she\'s heading for the centre rear!');
      }
    }
    if (ph === 'gone') {
      f.runTo.copy(L.pos).addScaledVector(fwd(L.yaw, _a), 400);
      if (this.pt > 3) this._say('Christa', 'Armin! I brought the horses! Everyone, mount up!');
      if (this.pt > 8) this._cutTo(2, 'An hour later, Erwin turned the formation into the Forest of Giant Trees. Only the centre column went in.');
    }
  }

  // ================================================================ act 2: The Forest of Giant Trees
  _forest2() {
    this.phase = 'ride'; this.waitForYou = false;
    const path = [];
    for (let z = 530; z <= TRAP_Z + 130; z += 25) path.push([roadX(z), z]);
    this._makeLead(new V3(roadX(512), 0, 512), 0, path, 15);
    this._rider('Levi', 0, 4);
    this._mountUp([0, -16], [[-4, -4], [4, -4], [-4, -11], [4, -11], [0, -8]]);
    // the column rides in under the trees, toward the camera
    const L = this.lead;
    this._shotAt(4.5, () => L.pos.clone(), { yaw: L.yaw, dist: 55, h: 3, fov: 48, look: () => L.pos.clone().setY(L.pos.y + 6) });
  }
  _update2(dt) {
    const g = this.g, L = this.lead, t = this.t, p = g.player;
    let f = this.female;
    this.pt += dt;
    this._script(t, [
      [0.5, 'Petra', 'Into the forest... only the centre column. Why here?'],
      [2.5, 'Levi', 'Keep riding.'],
    ]);
    if (this.phase === 'ride') {
      if (!f && t > 4) {
        const z0 = L.pos.z - 85;
        f = this._female(new V3(roadX(z0), 0, z0), 0);
        f.setMode('run');
        this._focus(4, () => f._headWorld(new V3()));
        this._say('Gunther', 'Behind us! The Female Titan! She\'s in the forest!');
      }
      if (!f) return;
      // she runs the road behind them, closing in; the soldiers in the trees fly at her and die
      const gap = L.pos.z - f.position.z, target = Math.max(20, 60 - t * 1.6);
      f.paceMul = clamp((L.speed + (gap - target) * 0.6) / f.runSpeed, 0.3, 1.7);
      f.runTo.set(roadX(f.position.z + 40), 0, f.position.z + 40);
      this._script(t, [
        [7, 'Eld', 'Soldiers in the trees behind her... they\'re going for her nape!'],
        [12, 'Eren', 'Captain! We have to fight! They\'re dying back there!'],
        [15.5, 'Levi', 'Eyes forward.'],
        [19, 'Petra', 'Captain, your orders!'],
        [23, 'Eren', 'I can do it myself. I\'ll transform!'],
        [25.5, 'Petra', 'Eren, don\'t! Trust the captain!'],
        [28, 'Levi', 'Choose, Eren. Trust yourself, or trust us. I don\'t know which is right. Nobody ever does.'],
        [33, 'Eren', '...I\'ll ride.'],
      ]);
      for (const at of [9, 15.5, 22]) if (t > at && !this.lines.has('pursuer' + at)) {
        this.lines.add('pursuer' + at);
        const pt = f._headWorld(new V3()).add(rgt(f.yaw, _a).multiplyScalar(at % 2 ? 4 : -4));
        f.strike('hand', () => pt, (q) => g.fx?.blood?.(q, _a.set(0, 1, 0), 2.2), { sure: true, run: true });
        g.fx?.gas?.(pt, _b.set(0, -1, 0), 1);
        this._focus(2.6, () => f._headWorld(new V3()));
        g.hud?.feed?.(['She crushed him against the trunk without slowing.', 'Another one. She didn\'t even look.', 'She swatted him out of the air.'][(this.pursuers = (this.pursuers || 0) + 1) % 3], 'warn');
      }
      if (t > 17 && !this.lines.has('grenade')) {
        this.lines.add('grenade');
        const lv = this._riderNamed('Levi');
        lv?.h.fireFlare([new THREE.Color(0xf2efe6), new THREE.Color(0xb9b4aa)]);
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
        [4.6, 'Levi', 'Squad, stay here with the horses. Eren, you too.'],
        [6.5, 'Petra', 'So that was the plan... the captain knew all along.'],
        [9.5, 'Mike', 'Her nape! My blades broke on it... it\'s hardened!'],
        [12, 'Erwin', 'Prepare the explosives. Blow her hands off the nape.'],
        [18, 'Levi', 'Hey. I\'m going to cut you out of there. Your arms, your legs... they grow back, right?'],
      ]);
      if (this.pt > 3 && this.lead.want) { this.lead.want = 0; for (const a of g.allies || []) if (a.slot) a.slot.stay = false; }
      if (this.pt > 9 && !this.lines.has('mike')) {
        this.lines.add('mike');
        const nw = f.napeWorld();
        this._shotAt(2.6, () => f.napeWorld().center, { from: () => nw.center.clone().addScaledVector(nw.normal, 5), dist: 7, h: 1.5, fov: 50 });
        f.applyHit({ part: 'nape', damage: 300, point: nw.center });
      }
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
        [4, 'Erwin', 'All units, engage! Protect the Female Titan with your lives!'],
        [8, 'Levi', 'She called them to eat her. Tch.'],
        [20, 'Petra', 'There are too many! They\'re on her!'],
      ]);
      if (f.eatenHp <= 0 || this.pt > 55) this._escape();
      return;
    }
    if (this.phase === 'escaped' && this.pt > 4.5) this._enterAct(3, false);
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
    // round her, slowly, the wires coming in from the trees
    this._shotAt(4.5, () => f._jpos('spine', new V3()), { yaw: f.yaw + 0.6, spin: 0.22, dist: 34, h: 6, fov: 55 });
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
    this._shotAt(3.8, () => f._headWorld(new V3()), { yaw: f.yaw, dist: 18, h: -7, fov: 44 });
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
    this._shotAt(3.5, () => c.clone(), { yaw: f.yaw + 2, dist: 45, h: 8, fov: 52 });
    for (const t of g.titans?.titans || []) if (t.drawnTo === f) t.drawnTo = null;
    f.dispose(); this.female = null;
    if (this.harpoons) { this.harpoons.removeFromParent(); this.harpoons.geometry.dispose(); this.harpoons = null; }
    g.hud?.message?.('SHE GOT AWAY IN THE STEAM', 3, 'big');
    this._say('Erwin', 'Her body\'s gone. She slipped out in the steam, in a cloak like ours. Fire the retreat signal.');
    (this._ally('Petra') || g.player).fireFlare('green');
  }

  // ================================================================ act 3: Squad Levi
  _squad3(fresh) {
    const g = this.g, p = g.player;
    this.phase = 'regroup'; this.waitForYou = false;
    if (!fresh) {
      // Levi has gone for gas; the column breaks up
      for (const r of this.riders) { r.h.follow = null; if (r.name === 'Levi') r.h.dummy.visible = false; }
      for (const b of this.borrowed) b.h.autoSlot = null;
      this.lead = null;
    }
    (g.allies || []).forEach((a, i) => {
      if (!a.alive) return;
      const ang = (i / 5) * Math.PI * 2;
      _a.set(p.pos.x + Math.cos(ang) * 6, 0, p.pos.z + Math.sin(ang) * 6); _a.y = this._ground(_a.x, _a.z) + 1;
      a.dismount?.(true); this._place(a, _a);
    });
  }
  _update3(dt) {
    const g = this.g, p = g.player, t = this.t, ph = this.phase;
    const f = this.female;
    this.pt += dt;
    if (ph === 'regroup') {
      this._script(t, [
        [1, 'Eld', 'The captain\'s gone for gas. We head for the horses and wait for him there.'],
        [4, 'Oluo', 'Hmph. The great Female Titan, beaten by the captain\'s plan. I knew it would end like this.'],
        [6.8, 'Petra', 'A flare, from the trees ahead... one of ours?'],
      ]);
      if (t > 6.2 && !this.lines.has('flare')) {
        this.lines.add('flare');
        const at = p.pos.clone().add(new V3(-30, 20, -80));
        g.fx?.flare?.(at, 'green');
        this._focus(2.6, () => at.clone().setY(at.y + 30));
      }
      if (t > 9.5 && !this.lines.has('gunther')) {
        this.lines.add('gunther');
        const gu = this._ally('Gunther');
        if (gu?.alive) this._shotAt(2.2, () => gu.pos.clone(), { from: () => p.pos.clone(), dist: 6, h: 1.5, fov: 55 });
        this._killAlly(gu, null, 'A hooded soldier dropped out of the trees and cut Gunther\'s neck.');
        this._say('Eld', 'GUNTHER!');
        this._say('Petra', 'Who\'s there?! Show yourself!');
      }
      if (t > 13) {
        this.phase = 'squad'; this.pt = 0;
        const at = p.pos.clone().addScaledVector(fwd(p.yaw + Math.PI, _a), 55);
        this._transform(at, 0.6);
        const fem = this._female(at, Math.atan2(p.pos.x - at.x, p.pos.z - at.z));
        fem.setMode('fight');
        // out of the lightning: low, looking up at her
        this._shotAt(3.4, () => fem._headWorld(new V3()), { from: () => p.pos.clone(), dist: 30, h: -10, fov: 50 });
        g.hud?.message?.('THE FEMALE TITAN', 3, 'big');
        this._say('Eld', 'Eren, keep going! We\'ll take her! Trust us!');
        g.audio?.setMusic?.(0.9);
      }
      return;
    }
    if (!f && ph !== 'won') return;
    if (ph === 'squad') {
      const eld = this._ally('Eld'), petra = this._ally('Petra'), oluo = this._ally('Oluo');
      if (this.pt > 3.5 && !this.lines.has('blind')) {
        this.lines.add('blind');
        const hw = f._headWorld(new V3()).addScaledVector(fwd(f.yaw, _a), 3);
        if (eld) this._place(eld, hw.clone().addScaledVector(rgt(f.yaw, _b), 2));
        if (petra) this._place(petra, hw.clone().addScaledVector(rgt(f.yaw, _b), -2));
        f.applyHit({ part: 'eye', damage: 100, point: hw });
        this._shotAt(2.4, () => f._headWorld(new V3()), { yaw: f.yaw + 0.5, dist: 14, h: 1, fov: 50 });
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
      if (k && this.pt > 1.4 + this.step * 2.8 && f.state !== 'strike') {
        const [name, kind, line, where] = k, a = this._ally(name);
        this.step++;
        if (a?.alive) this._strikeAt(kind, a, where(f), (pt) => this._killAlly(a, pt, line));
      }
      if (this.step >= 3 && this.pt > 11) this._erenTransforms();
      return;
    }
    if (ph === 'eren') {
      const e = this.eren;
      this._script(this.pt, [[1, 'Eren', 'I\'ll kill you!'], [4, 'Eren', 'I should have fought from the start!']]);
      if (f.state !== 'strike' && e.state !== 'strike' && this.pt > 3 && (this.stepT -= dt) <= 0) {
        this.stepT = 1.7;
        const n = this.step++;
        if (n < 7) {
          const [att, def] = n % 2 === 0 ? [e, f] : [f, e];
          att.strike(n % 4 === 1 ? 'kick' : 'punch', () => def._headWorld(_c), (q) => { def.flinch = 1; g.fx?.impact?.(q, _a.set(0, 1, 0), 'flesh'); g.audio?.titanStep?.(q, 40); g.events.emit('titan:step', { position: q, size: 40 }); }, { sure: true });
          if (n === 3) this._focus(3, () => e._headWorld(new V3()).lerp(f._headWorld(new V3()), 0.5));
        } else if (n === 7) {
          // Annie's stance; then the hardened fist
          this._shotAt(2.6, () => f._jpos('spine', new V3()), { from: () => e.position.clone(), dist: 22, h: 2, fov: 46 });
          this._say('Eren', '...that stance. Annie?!');
          f.strike('punch', () => e._headWorld(_c), (q) => { g.fx?.impact?.(q, _a.set(0, 1, 0), 'stone'); g.fx?.steam?.(q, 8, 3); e.stunT = 3; g.player.cam.trauma = 1; }, { sure: true, W: 0.6 });
        } else if (n === 8) {
          this._shotAt(3, () => e.napeWorld().center, { yaw: f.yaw + 1.6, dist: 20, h: 2, fov: 50 });
          f.strike('bite', () => e.napeWorld().center, (q) => {
            g.fx?.blood?.(q, _a.set(0, 1, 0), 3); g.fx?.steam?.(q, 12, 5);
            for (let i = 0; i < 4; i++) g.fx?.steam?.(e._jpos('spine', new V3()).add(new V3(0, i * 3, 0)), 10, 6);
            e.dispose(); this.eren = null;
            f.brawl(null); f.setMode('run'); f.paceMul = 0.72; f.carrying = true; f.runTo.set(roadX(1230), 0, 1230);
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
        [5, 'Levi', 'Mikasa. Don\'t do anything stupid. We bring him back. We don\'t kill her.'],
      ]);
      if ((this.pt > 8 && f.position.distanceTo(p.pos) < 50) || this.pt > 30) this._levi();
      return;
    }
    if (ph === 'mouth') {
      this._script(this.pt, [[3, 'Levi', 'Now. Cut him out of her jaw while she can\'t move.']]);
      if (this.pt > 40) this._freeEren(true);
      return;
    }
    if (ph === 'freed' && this.pt > 3.5) this._complete('WE GOT EREN BACK');
  }
  /** Her one eye has healed: she stands up and kills the squad. */
  _sees() {
    if (this.ch !== 3 || this.phase !== 'squad') return;
    this.phase = 'kills'; this.pt = 0; this.step = 0;
    this._say('Petra', 'Wait... she can see! One eye\'s back already—');
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
    // the two of them, side on
    this._shotAt(3.2, () => e.position.clone().lerp(f.position, 0.5).setY(e.position.y + 8), { yaw: Math.atan2(f.position.x - at.x, f.position.z - at.z) + Math.PI / 2, dist: 48, h: 2, fov: 52 });
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
    this._shotAt(3.5, () => f._jpos('spine', new V3()), { yaw: f.yaw + 0.8, spin: 0.5, dist: 26, h: 4, fov: 52 });
    g.hud?.message?.('CAPTAIN LEVI', 3, 'big');
    this._say('Levi', 'Mikasa, hold back. Your rage is clouding your judgement.');
    this._say('Mikasa', 'Captain... your leg. You hurt it saving me.');
    g.hud?.message?.('CUT EREN OUT OF HER MOUTH: strike her jaw', 3.5, 'info');
  }
  _freeEren(byLevi) {
    const g = this.g, f = this.female;
    if (this.ch !== 3 || this.phase !== 'mouth' || !f) return;
    this.phase = 'freed'; this.pt = 0;
    f.mouthOpenable = false; f.carrying = false;
    const m = f._mouthWorld(new V3());
    g.fx?.blood?.(m, _a.set(0, 1, 0), 3); g.fx?.steam?.(m, 6, 3);
    this._shotAt(3.5, () => f._headWorld(new V3()), { yaw: f.yaw + 0.4, dist: 15, h: 0.5, fov: 48 });
    if (!byLevi) this.flow.score += 3000;
    this._say('Levi', byLevi ? 'Tch. I\'ll do it myself.' : 'Good. He\'s out. Covered in spit, but alive.');
    this._say('Levi', 'Retreat. We\'re done here.');
    g.hud?.message?.('EREN IS FREE', 3, 'big');
    f.mode = 'hold';   // she sits against the tree, crying, and lets them go
  }

  // ---------------------------------------------------------------- flow
  _complete(title) {
    if (this.done) return;
    this.done = true; this.phase = 'won'; this.title = title;
    this.flow.score += 5000;
    this.flow.chapter = 0;   // PLAY AGAIN starts from the gate
    this.g.audio?.setMusic?.(0.25);
    this.g.hud?.message?.(title, 3.2, 'big');
    this.flow.chapterDone('scout', { title, delay: 3500 });
  }

  update(dt) {
    if (this.phase === 'none') return;
    this.clock += dt;
    this._subs(dt);
    this._director(dt);
    this._moveLead(dt);
    if (this.phase === 'won') return;
    if (this.cut) { this._cutStep(dt); if (this.cut) return; }
    this.t += dt;
    this._flareKey();
    [this._update0, this._update1, this._update2, this._update3][this.ch].call(this, dt);
    this._holdPins();
  }

  // ---------------------------------------------------------------- HUD
  objective() {
    const g = this.g, f = this.female, p = g.player, ph = this.phase;
    if (ph === 'won') return this.title;
    if (ph === 'cut') return '';
    const relay = this.want ? keys.fill(` · RELAY ${this.want.color.toUpperCase()}: {flare}`) : '';
    const dist = (o) => (o ? `${Math.round(o.position.distanceTo(p.pos))} m` : '');
    const act = `${ACTS[this.ch].toUpperCase()} · `;
    switch (this.ch) {
      case 0:
        if (ph === 'gate') return 'THE 57TH EXPEDITION · ride with the formation (let go of the reins and your horse keeps its place)';
        if (ph === 'abnormal') return `${act}BLACK SMOKE · kill the abnormal before it reaches the right wing ${this.abnormal?.alive ? dist(this.abnormal) : ''}${relay}`;
        if (ph === 'rejoin') return `${act}back to your place in the formation`;
        return `${act}LONG-RANGE SCOUTING FORMATION · watch the sky for smoke${relay}`;
      case 1:
        if (ph === 'ride') return `${act}the right wing · something is coming out of the trees${relay}`;
        if (ph === 'harass') return `${act}SLOW HER DOWN · cut her legs and arms (${this.hits}/3) · she's ${dist(f)} away`;
        if (ph === 'gone') return `${act}SHE IS RUNNING FOR THE CENTRE REAR`;
        return `${act}THE FEMALE TITAN · ${dist(f)} · stay alive`;
      case 2:
        if (ph === 'ride') return `${act}RIDE · Levi's order: do not fight · she's ${f ? Math.max(0, Math.round(this.lead.pos.z - f.position.z)) + ' m behind' : 'coming'}`;
        if (ph === 'trap') return `${act}SHE IS RESTRAINED · try her nape yourself`;
        if (ph === 'defend') return `${act}DEFEND THE FEMALE TITAN · kill the titans eating her · ${Math.max(0, Math.round((f?.eatenHp || 0) / 1.6))}% left`;
        return `${act}SHE ESCAPED`;
      default:
        if (ph === 'regroup') return `${act}head for the horses`;
        if (ph === 'squad') return f?.blindT > 0 ? `${act}SHE IS BLIND · cut her arms so she can't guard (${f.limp.filter((x) => x > 0).length}/2)` : `${act}FIGHT BESIDE THE SQUAD`;
        if (ph === 'kills') return `${act}SHE CAN SEE AGAIN`;
        if (ph === 'eren') return `${act}EREN FIGHTS HER · cut her ankles and arms to help him`;
        if (ph === 'chase') return `${act}CATCH HER · she has Eren in her mouth · ${dist(f)}`;
        if (ph === 'mouth') return `${act}CUT EREN OUT OF HER MOUTH · strike her jaw`;
        return 'EREN IS SAFE';
    }
  }
}
