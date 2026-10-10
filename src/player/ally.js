// Survey Corps comrades: AI soldiers flying on the same ODM physics as the player (same wires, winch,
// constraints and contacts), hopping anchor to anchor through the trees and circling titans.
import * as THREE from 'three';
import { CFG } from '../config.js';
import { OdmGear } from './odm.js';

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

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
    if (this.horse) { this.prev.copy(this.pos); this._ride(dt); return; }
    this.prev.copy(this.pos);
    const odm = this.odm, v = this.vel, p = this.pos;
    this.launcher(0, this._origins[0]); this.launcher(1, this._origins[1]);
    odm.step(dt, this._origins);
    this.t += dt;
    this.holdT -= dt;
    this.nextT -= dt;
    const anchored = odm.attachedCount();
    if (anchored && this.holdT <= 0) odm.releaseAll(true);
    if (!anchored && this.nextT <= 0 && odm.hooks.every((h) => h.state === 'idle' || h.state === 'retracting')) {
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
    const acc = _a.set(0, -CFG.gravity, 0);
    const sp = v.length();
    acc.addScaledVector(v, -CFG.drag * sp);
    odm.reelAccel(p, v, this.boost > 0, acc);
    if (this.boost > 0) this.boost -= dt;
    // stay in the playable air: a bit of gas when low, steer back toward the action area
    if (p.y < 8 && v.y < 4) acc.y += 30;
    const home = _b.set(-p.x, 0, 380 - p.z);
    if (home.length() > 260) acc.addScaledVector(home.normalize(), 8);
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
    this.render.lerpVectors(this.prev, this.pos, alpha);
    const sp = this.vel.length();
    if (this.horse) {
      this.forward.set(Math.sin(this.horse.yaw), 0, Math.cos(this.horse.yaw));
      this.horse.up(this.up);
    } else if (sp > 2) this.forward.lerp(_a.copy(this.vel).multiplyScalar(1 / sp).addScaledVector(this.heading, 0.4).normalize(), 1 - Math.exp(-6 * dt)).normalize();
    const pd = this.odm.pullDir(this.render, _b);
    const upT = _c.copy(UP);
    if (pd) upT.lerp(pd, 0.5);
    upT.addScaledVector(this.forward, -upT.dot(this.forward));
    if (!this.horse && upT.lengthSq() > 1e-3) this.up.lerp(upT.normalize(), 1 - Math.exp(-5 * dt)).normalize();
    const dist = this.render.distanceTo(this.game.camera.position);
    const visible = dist < 260;
    const wantOutlines = dist < 45;
    if (wantOutlines !== this.outlinesOn) { this.outlinesOn = wantOutlines; for (const o of this.outlines) o.visible = wantOutlines; }
    if (this.model) {
      this.model.root.visible = visible;
      if (visible) this.model.update(dt, {
        riding: this.horse ? 1 : 0, horseGallop: this.horse?.gallop || 0, horsePhase: this.horse?.phase || 0,
        position: this._mp.copy(this.render).addScaledVector(this.up, 0.4), velocity: this.vel, forward: this.forward, up: this.up, grounded: !!this.horse, running: 0,
        hooks: this.odm.hooks.map((h) => ({ attached: h.attached, anchor: h.attached ? h.anchor : null, state: h.state })),
        boosting: this.boost > 0 ? 1 : 0, slash: -1, spin: false, grabbed: false, blades: !this.horse, speed: sp, alive: true,
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
