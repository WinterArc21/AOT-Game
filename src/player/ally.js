// Survey Corps comrades: AI soldiers flying on the same ODM physics as the player (same wires, winch,
// constraints and contacts), hopping anchor to anchor through the trees and circling titans.
import * as THREE from 'three';
import { CFG } from '../config.js';
import { OdmGear } from './odm.js';

// Math.hypot is variadic and boxes its arguments in hot loops (it was the top source of garbage); this doesn't.
const hypot = (a, b, c = 0) => Math.sqrt(a * a + b * b + c * c);


const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _s = new THREE.Vector3(), _f = new THREE.Vector3();
const _acc = new THREE.Vector3();
const NAMES = ['Henning', 'Lotte', 'Konrad', 'Greta', 'Wilhelm', 'Ada', 'Fritz', 'Mina'];

export class Ally {
  constructor(game, model, start, seed) {
    this.game = game;
    this.pos = start.clone();
    this.prev = start.clone();
    this.render = start.clone();
    this.vel = new THREE.Vector3(0, 0, 0);
    this.infiniteGas = true;
    this.silent = true;
    this.odm = new OdmGear(game, this);
    this.model = model;
    this.heading = new THREE.Vector3(Math.sin(seed), 0, Math.cos(seed));
    this.forward = this.heading.clone();
    this.up = new THREE.Vector3(0, 1, 0);
    this.t = seed * 3;
    this.holdT = 0; this.nextT = 0.3 + (seed % 1);
    this.rand = mulberry(Math.floor(seed * 1000) + 7);
    this._origins = [new THREE.Vector3(), new THREE.Vector3()];
    this.boost = 0;
    this.horse = null; this._mp = new THREE.Vector3();
    // cheap comrades: no shadow casting (tiny at range), cel outlines only when close to the camera
    this.outlines = [];
    model?.root?.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false;
      const m = o.material;
      if (m && m.isMeshBasicMaterial && m.side === THREE.BackSide) this.outlines.push(o);
    });
    this.outlinesOn = true;
    // squad: pairs of comrades take titans down together, the even one cuts the ankles, the odd one the nape
    this.idx = game.allies?.length || 0;
    this.name = NAMES[this.idx % NAMES.length];
    this.alive = true; this.grabbedBy = null; this.grabHand = null;
    this.job = null; this.jobCd = 9 + this.rand() * 8;
  }

  revive() {
    if (this.grabbedBy) this.grabbedBy = null;
    this.alive = true; this.job = null; this.jobCd = 9 + this.rand() * 8;
    if (this.model?.root) this.model.root.visible = true;
  }
  partner() { const o = this.game.allies?.[this.idx ^ 1]; return o && o !== this && o.alive && !o.grabbedBy ? o : null; }
  radio(text) {
    const g = this.game;
    if ((g.time || 0) - (g._radioAt ?? -9) < 1.4) return;
    g._radioAt = g.time || 0;
    g.hud?.feed?.(text, 'radio', this.name);
  }

  // ---------------------------------------------------------------- caught by a titan
  grab(titan, hand) {
    this.grabbedBy = titan; this.grabHand = hand;
    this.odm.releaseAll(true); this._dropJob();
    this.vel.set(0, 0, 0);
    this.game.events.emit('ally:grabbed', { ally: this, titan });
  }
  freed() {
    if (!this.grabbedBy) return;
    this.grabbedBy = null; this.grabHand = null;
    this.vel.set(0, 7, 0); this.nextT = 0.1; this.boost = 0.6;
    this.game.events.emit('ally:freed', { ally: this });
  }
  eaten() {
    this.grabbedBy = null; this.grabHand = null; this.alive = false;
    this.odm.releaseAll(true);
    if (this.model?.root) this.model.root.visible = false;
    this.game.events.emit('ally:eaten', { ally: this });
  }

  // ---------------------------------------------------------------- squad tactics
  _dropJob() {
    const j = this.job;
    if (!j) return;
    if (j.titan && j.titan._squadBy === (this.idx >> 1)) j.titan._squadBy = null;
    this.job = null;
  }
  /** Pick a titan for the pair (the ankle-cutter leads; the partner follows its pick). */
  _plan() {
    const g = this.game, p = g.player.pos, pair = this.idx >> 1;
    const lead = this.idx % 2 === 0;
    const mate = this.partner();
    if (!lead && mate) return;                       // the lead calls the target and brings the partner in
    let best = null, bd = 1e9;
    for (const t of g.titans?.titans || []) {
      if (!t.alive || t.kind === 'colossal' || (t._squadBy != null && t._squadBy !== pair)) continue;
      const d = t.position.distanceTo(this.pos);
      if (d > 95 || t.position.distanceTo(p) > 140) continue;
      if (!mate && !(t.crippleT > 0)) continue;          // alone, a comrade only finishes off a hobbled titan
      if (d < bd) { bd = d; best = t; }
    }
    if (!best) return;
    best._squadBy = pair;
    const solo = !mate;
    this.job = { titan: best, role: solo ? 'nape' : 'ankle', t: 0, wait: false, tries: 0, leg: this.rand() < 0.5 ? 'L' : 'R' };
    this.radio(solo ? `Going for the nape on the ${Math.round(best.height)}-metre!` : `Ankles on the ${Math.round(best.height)}-metre, cover me!`);
    if (mate && !mate.job && !mate.horse && mate.pos.distanceTo(best.position) < 130) {
      mate.job = { titan: best, role: 'nape', t: 0, wait: true, tries: 0 };
      setTimeout(() => mate.alive && mate.job?.titan === best && mate.radio(`Nape's mine!`), 1500);
    }
  }
  /** Where to cut (into _s) and where to throw the hooks (into _a); returns false if the target is gone. */
  _strikePoint(j) {
    const t = j.titan;
    if (!t.alive || t.dying) return false;
    if (j.role === 'ankle') {
      t._jpos('foot' + j.leg, _s); t._jpos('shin' + j.leg, _a);
      _f.set(Math.sin(t.yaw), 0, Math.cos(t.yaw));
      _s.addScaledVector(_f, -0.05 * t.height).y += 0.05 * t.height;    // the tendon behind the heel
      _a.lerp(_s, 0.4);
      return true;
    }
    const nw = t.napeWorld();
    _s.copy(nw.center).addScaledVector(nw.normal, 0.3);
    const an = t.anchors([]);
    _a.copy(an[1 + (this.idx & 1)] || nw.center);
    j.nrm = j.nrm || new THREE.Vector3(); j.nrm.copy(nw.normal);
    return true;
  }
  /** Run the job: throw hooks, swing round behind the target, cut. Adds steering into acc; false = no job now. */
  _squad(dt, acc) {
    if (!this.job) {
      if ((this.jobCd -= dt) <= 0) { this.jobCd = 0.5; this._plan(); }
      if (!this.job) return false;
    }
    const j = this.job, t = j.titan, odm = this.odm, p = this.pos, v = this.vel;
    j.t += dt;
    if (!this._strikePoint(j) || j.t > 14) { this._dropJob(); this.jobCd = 2; return false; }
    if (j.wait) {                              // the nape-cutter hangs back until the ankles go (or the lead stalls)
      if (t.crippleT > 0 || j.t > 5 || !this.partner()) { j.wait = false; j.t = 0; } else return false;
    }
    if (j.escape > 0) {                         // after a cut: let go and carry the speed up and away
      j.escape -= dt;
      if (j.escape <= 0) {
        if (j.done) { this._dropJob(); this.jobCd = 14 + this.rand() * 10; } else { j.t = 0; }
      }
      return false;
    }
    const mine = odm.hooks.some((h) => h.attached && h.collider?.userData?.titan === t);
    if (!mine && odm.hooks.every((h) => h.state !== 'flying') && (j.fireT = (j.fireT || 0) - dt) <= 0) {
      odm.releaseAll(true);
      odm.fire(0, p, _b.copy(_a).addScaledVector(_c.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5), 1.2), _c.subVectors(_a, p).normalize());
      odm.fire(1, p, _b.copy(_a).addScaledVector(_c.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5), 1.2), _c.subVectors(_a, p).normalize());
      j.fireT = 0.9;
    }
    const dS = p.distanceTo(_s);
    if (dS > 85) { this.heading.lerp(_b.subVectors(_s, p).setY(0).normalize(), 0.1).normalize(); return false; }
    // the swoop: come round behind the target point, then straight through it
    if (mine || dS < 25) {
      const nrm = j.role === 'nape' ? j.nrm : _f.set(-Math.sin(t.yaw), 0, -Math.cos(t.yaw));
      const rx = p.x - _s.x, ry = p.y - _s.y, rz = p.z - _s.z;
      const along = rx * nrm.x + ry * nrm.y + rz * nrm.z;
      const aim = _c.copy(_s);
      if (along < 1 && dS > 3) {
        const rt = _b.crossVectors(UP, nrm); if (rt.lengthSq() < 1e-4) rt.set(1, 0, 0); rt.normalize();
        const R = Math.max(3, t.height * 0.35);
        aim.addScaledVector(rt, (rx * rt.x + rz * rt.z) >= 0 ? R : -R).addScaledVector(nrm, 2);
      } else if (dS > 5) aim.addScaledVector(nrm, Math.min(6, dS * 0.4));
      else aim.addScaledVector(nrm, -2.5);
      aim.sub(p).normalize().multiplyScalar(31).sub(v).multiplyScalar(4.2);
      const al = aim.length(); if (al > 60) aim.multiplyScalar(60 / al);
      acc.add(aim); acc.y += CFG.gravity * 0.6;
      this.boost = Math.max(this.boost, 0.1);
      for (const h of odm.hooks) h.payout = dS < 14 ? 40 : 0;
    }
    if (dS < (j.role === 'ankle' ? 2.8 : 2.4)) this._cut(j);
    return true;
  }
  _cut(j) {
    const t = j.titan, g = this.game;
    for (const h of this.odm.hooks) h.payout = 0;
    this.odm.releaseAll(true);
    j.escape = 0.7; this.boost = 0.6;
    this.vel.y += 6;
    const near = this.pos.distanceTo(g.camera.position) < 70;
    if (near) g.audio?.slash?.(true);
    if (j.role === 'ankle') {
      t.applyHit({ part: 'ankle', damage: 60, point: _s.clone(), dir: this.vel.clone() });
      j.done = true;
      this.radio(this.rand() < 0.5 ? 'Ankles are down — now!' : `Its legs are gone, take it!`);
      return;
    }
    // a clean nape cut most of the time (better when it's hobbled); otherwise come round and try again
    if (this.rand() < (t.crippleT > 0 ? 0.7 : 0.3)) {
      t.killedBy = this;
      t.applyHit({ part: 'nape', damage: (t.napeHp || 600) + 1, point: _s.clone(), dir: this.vel.clone() });
      j.done = true;
    } else {
      t.applyHit({ part: 'nape', damage: 15, point: _s.clone(), dir: this.vel.clone() });
      if (++j.tries >= 2) j.done = true;
      this.radio(j.done ? 'Too shallow — I need help here!' : 'Too shallow! Coming round again!');
    }
  }

  _pickAnchor() {
    const col = this.game.collision;
    const r = this.rand;
    // prefer a titan's body if one is near (Survey Corps harass the big ones), else trees ahead and above
    const titans = this.game.titans?.titans || [];
    let target = null;
    for (const t of titans) {
      if (!t.alive || t.kind === 'colossal') continue;
      const d = t.position.distanceTo(this.pos);
      if (d < 70 && r() < 0.5) { target = t.napeWorld?.()?.center; break; }
    }
    for (let attempt = 0; attempt < 6; attempt++) {
      const dir = _a;
      if (target && attempt === 0) dir.subVectors(target, this.pos).normalize();
      else {
        const yaw = Math.atan2(this.heading.x, this.heading.z) + (r() - 0.5) * 1.6;
        const pitch = 0.22 + r() * 0.5 + (this.pos.y < 25 ? 0.35 : 0) - (this.pos.y > 95 ? 0.55 : 0);
        dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      }
      const hit = col.raycast(this.pos, dir, CFG.hook.range * 0.85, { hookableOnly: true });
      if (hit && hit.distance > 12 && hit.collider.type !== 'ground') return hit.point;
    }
    return null;
  }

  /** Ride in formation: slot = metres to the leader's right (x) and ahead (z, negative = behind). */
  mount(horse, slot) {
    this.horse = horse; horse.rider = this; this.slot = slot;
    this.odm.releaseAll(true);
    horse.saddle(this.pos); this.prev.copy(this.pos); this.render.copy(this.pos);
    this.dismountT = -1;
  }
  dismount(silent) {
    const h = this.horse;
    if (!h) return;
    this.horse = null; h.rider = null; h.mountCd = 3; h.want.f = 0; h.want.turn = 0;
    this.vel.copy(h.vel); this.vel.y = silent ? 0 : 9.5;
    this.nextT = 0.15; this.boost = silent ? 0 : 0.6;
  }
  _ride(dt) {
    const h = this.horse, g = this.game, p = g.player;
    const lead = p.riding || p;
    const ly = p.riding ? p.riding.yaw : p.yaw;
    const fx = Math.sin(ly), fz = Math.cos(ly), rx = -fz, rz = fx;
    const lp = p.riding ? p.riding.pos : p.pos;
    // aim a little ahead of the slot so the column flows; gallop to catch up, ease off when ahead
    const sx = lp.x + rx * this.slot.x + fx * this.slot.z, sz = lp.z + rz * this.slot.x + fz * this.slot.z;
    const tx = sx + fx * 10 - h.pos.x, tz = sz + fz * 10 - h.pos.z;
    let d = Math.atan2(tx, tz) - h.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    h.want.turn = Math.max(-1, Math.min(1, -d * 2.5));
    const behind = (sx - h.pos.x) * fx + (sz - h.pos.z) * fz;
    const leadSpeed = (lead.speed ?? lead.vel?.length?.() ?? 0);
    h.want.f = behind > -1 || leadSpeed > 8 ? 1 : 0;
    h.speedMul = behind > 6 ? 1.3 : behind > 1.5 ? 1.12 : behind < -2 ? 0.88 : 1;
    h.saddle(this.pos); this.vel.copy(h.vel);
    // leave the saddle when the leader takes to the air, or when a titan comes close (staggered, not all at once)
    if (this.dismountT < 0) {
      let titanNear = false;
      for (const t of g.titans?.titans || []) if (t.alive && t.position.distanceToSquared(this.pos) < 70 * 70) { titanNear = true; break; }
      if (!p.riding || titanNear) this.dismountT = 0.15 + this.rand() * 0.9;
    } else if ((this.dismountT -= dt) <= 0) this.dismount();
    if (h.crashed > 0) { h.crashed = 0; this.dismount(); }
  }

  fixedUpdate(dt) {
    if (!this.alive) return;
    if (this.horse) { this.prev.copy(this.pos); this._ride(dt); return; }
    this.prev.copy(this.pos);
    if (this.grabbedBy) {                       // in a titan's fist
      if (!this.grabbedBy.alive || !this.grabHand) { this.freed(); return; }
      this.grabHand.getWorldPosition(this.pos); this.vel.set(0, 0, 0);
      return;
    }
    const odm = this.odm, v = this.vel, p = this.pos;
    this.launcher(0, this._origins[0]); this.launcher(1, this._origins[1]);
    odm.step(dt, this._origins);
    this.t += dt;
    this.holdT -= dt;
    this.nextT -= dt;
    const acc = _acc.set(0, -CFG.gravity, 0);
    const busy = this._squad(dt, acc);
    if (!busy) for (const h of odm.hooks) h.payout = 0;
    const anchored = odm.attachedCount();
    if (!busy && anchored && this.holdT <= 0) odm.releaseAll(true);
    if (!busy && !anchored && this.nextT <= 0 && odm.hooks.every((h) => h.state === 'idle' || h.state === 'retracting')) {
      const pt = this._pickAnchor();
      if (pt) {
        const twin = this.rand() < 0.5;
        odm.fire(0, p, pt, _b.subVectors(pt, p).normalize());
        if (twin) odm.fire(1, p, pt.clone().add(_c.set(this.rand() - 0.5, 0, this.rand() - 0.5).multiplyScalar(3)), _b);
        this.holdT = 1.1 + this.rand() * 1.3;
        this.boost = this.rand() < 0.4 ? 0.7 : 0;
      }
      this.nextT = 0.2 + this.rand() * 0.35;
    }
    const sp = v.length();
    acc.addScaledVector(v, -CFG.drag * sp);
    odm.reelAccel(p, v, this.boost > 0, acc);
    if (this.boost > 0) this.boost -= dt;
    // stay in the playable air: a bit of gas when low, steer back toward the action area
    if (p.y < 8 && v.y < 4) acc.y += 30;
    // stay with the squad leader (you): drift back when more than ~110 m away
    const lp = this.game.player.pos;
    const home = _b.set(lp.x - p.x, 0, lp.z - p.z);
    if (!busy && home.length() > 110) acc.addScaledVector(home.normalize(), 8);
    v.addScaledVector(acc, dt);
    const n = Math.min(10, Math.max(1, Math.ceil((v.length() * dt) / 0.35)));
    for (let i = 0; i < n; i++) {
      p.addScaledVector(v, dt / n);
      odm.constrain(p, v);
      const cs = this.game.collision.collideSphere(p, CFG.radius, { dynamic: false });
      for (const c of cs) {
        if (c.depth <= 0) continue;
        p.addScaledVector(c.normal, c.depth);
        const vn = v.dot(c.normal);
        if (vn < 0) v.addScaledVector(c.normal, -vn * 1.2);
      }
    }
    if (v.lengthSq() > 4) this.heading.lerp(_c.set(v.x, 0, v.z).normalize(), 0.02).normalize();
  }

  launcher(side, out) {
    if (this.model?.hookOrigin && this.model.root?.visible) return this.model.hookOrigin(side, out);
    return out.copy(this.render);
  }

  update(dt, alpha) {
    if (!this.alive) return;
    this.render.lerpVectors(this.prev, this.pos, alpha);
    const sp = this.vel.length();
    const gy = this.game.collision.groundHeight(this.render.x, this.render.z);
    const landing = !this.horse && this.vel.y < -2 && !this.odm.attachedCount() && (this.render.y - gy) / -this.vel.y < 0.7;
    if (this.horse) {
      this.forward.set(Math.sin(this.horse.yaw), 0, Math.cos(this.horse.yaw));
      this.horse.up(this.up);
    } else if (landing) {
      const hl = hypot(this.vel.x, this.vel.z) || 1;
      this.forward.lerp(_a.set(this.vel.x / hl, 0, this.vel.z / hl), 1 - Math.exp(-12 * dt)).normalize();
      this.up.lerp(UP, 1 - Math.exp(-14 * dt)).normalize();
    } else if (sp > 2) this.forward.lerp(_a.copy(this.vel).multiplyScalar(1 / sp).addScaledVector(this.heading, 0.4).normalize(), 1 - Math.exp(-6 * dt)).normalize();
    const pd = this.odm.pullDir(this.render, _b);
    const upT = _c.copy(UP);
    if (pd) upT.lerp(pd, 0.5);
    upT.addScaledVector(this.forward, -upT.dot(this.forward));
    if (!this.horse && !landing && upT.lengthSq() > 1e-3) this.up.lerp(upT.normalize(), 1 - Math.exp(-5 * dt)).normalize();
    const dist = this.render.distanceTo(this.game.camera.position);
    const visible = dist < (this.game.allyRange || 260);
    const wantOutlines = dist < 45;
    // far comrades: a coarser, less frequent cape sim (it's 2/3 of their cost and invisible at range)
    if (this.model?.cape) { const cape = this.model.cape; cape.hz = dist < 12 ? 120 : dist < 80 ? 60 : 30; cape.iters = dist < 12 ? 5 : 3; this.model.capeEvery = dist < 80 ? 1 : dist < 160 ? 2 : 3; }
    if (wantOutlines !== this.outlinesOn) { this.outlinesOn = wantOutlines; for (const o of this.outlines) o.visible = wantOutlines; }
    if (this.model) {
      this.model.root.visible = visible && this.alive;
      if (visible) this.model.update(dt, {
        landPrep: landing ? 1 : 0, riding: this.horse ? 1 : 0, horseGallop: this.horse?.gallop || 0, horsePhase: this.horse?.phase || 0,
        position: this._mp.copy(this.render).addScaledVector(this.up, 0.4), velocity: this.vel, forward: this.forward, up: this.up, grounded: !!this.horse, running: 0,
        hooks: this.odm.hooks.map((h) => ({ attached: h.attached, anchor: h.attached ? h.anchor : null, state: h.state })),
        boosting: this.boost > 0 ? 1 : 0, slash: -1, spin: false, grabbed: !!this.grabbedBy, blades: !this.horse, speed: sp, alive: true,
      });
    }
    this.launcher(0, this._origins[0]); this.launcher(1, this._origins[1]);
    this.odm.render(this._origins, this.game.camera, this.game.time + this.t);
    if (this.boost > 0 && visible && this.model?.gasNozzle) { this.model.gasNozzle(_a, _b); this.game.fx?.gas?.(_a, _b, 0.5); }
  }

  dispose() {
    this.model?.root?.parent?.remove(this.model.root);
    for (const w of this.odm.wires) w.mesh.parent?.remove(w.mesh);
  }
}

function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
