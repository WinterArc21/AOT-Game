// The Titan: procedural rig + AI + animation + hit handling. One instance per titan (see titans.js for the manager).
import * as THREE from 'three';
import { getArchetype, HAIRS, sizeClass } from './builder.js';
import { buildRig } from './rig.js';
import { outlineMaterial } from '../core/style.js';
import { solveArm } from './ik.js';

// Math.hypot is variadic and boxes its arguments in hot loops (it was the top source of garbage); this doesn't.
const hypot = (a, b, c = 0) => Math.sqrt(a * a + b * b + c * c);


const V3 = THREE.Vector3, Q = THREE.Quaternion, EU = THREE.Euler;
const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;
const TAU = Math.PI * 2;
const UP = new V3(0, 1, 0);
const ZERO = new V3();
const sm = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const wrap = (a) => { a %= TAU; if (a > Math.PI) a -= TAU; else if (a < -Math.PI) a += TAU; return a; };
let UID = 0;

// ---- keyboard-play tuning (exported for benches / the core)
export const TITAN_TUNING = {
  WINDUP: 0.45,                  // s: minimum readable wind-up before every grab reach / swat / bite / leap
  GRAB_MAX_REL_SPEED: 18,        // m/s: a hand only closes on a player slower than this relative to the hand
  GRAB_BLOCK_AFTER_ESCAPE: 1.5,  // s: no titan grabs right after the player cuts free
  LEAP_COOLDOWN: 8,              // s: minimum time between two leaps of one abnormal
  LEAP_CHANCE: 0.6,              // per second while a leap is possible
  LEAP_G: 24,                    // m/s²: titan leaps are heavy
};
const { WINDUP, GRAB_MAX_REL_SPEED, GRAB_BLOCK_AFTER_ESCAPE, LEAP_COOLDOWN, LEAP_CHANCE, LEAP_G } = TITAN_TUNING;

function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ['pelvis', 'spine', 'neck', 'head', 'jaw', 'armL', 'foreL', 'armR', 'foreR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];

/** A small fixed pool of designs per kind keeps the number of cached archetypes (geometry sets) bounded. */
const DESIGNS = {
  normal: [
    { build: 'average', skin: 'beige', hair: 0, expr: 'grin' },
    { build: 'average', skin: 'pink', hair: false, expr: 'wide' },
    { build: 'potbelly', skin: 'pink', hair: false, expr: 'grin' },
    { build: 'potbelly', skin: 'tan', hair: 1, expr: 'wide' },
    { build: 'lanky', skin: 'pale', hair: 0, expr: 'grin' },
    { build: 'lanky', skin: 'beige', hair: false, expr: 'wide' },
    { build: 'muscular', skin: 'tan', hair: false, expr: 'grin' },
    { build: 'muscular', skin: 'ruddy', hair: 1, expr: 'wide' },
    { build: 'average', skin: 'tan', hair: 1, expr: 'grin' },
    { build: 'potbelly', skin: 'beige', hair: 0, expr: 'grin' },
  ],
  abnormal: [
    { build: 'gaunt', skin: 'ruddy', hair: 3 % HAIRS.length, expr: 'snarl' },
    { build: 'gaunt', skin: 'pale', hair: false, expr: 'snarl' },
    { build: 'lanky', skin: 'pink', hair: false, expr: 'snarl' },
    { build: 'gaunt', skin: 'beige', hair: 0, expr: 'wide' },
  ],
};

export class Titan {
  constructor(mgr, o) {
    this.mgr = mgr; this.game = mgr.game; this.id = ++UID;
    this.kind = o.kind || 'normal';
    this.isColossal = this.kind === 'colossal';
    this.abnormal = this.kind === 'abnormal';
    this.height = o.height ?? (this.isColossal ? 60 : this.abnormal ? 7 : 6);
    const rnd = this.rnd = mulberry(0x9e3779b1 ^ (this.id * 2654435761));
    this.alive = true; this.dying = false; this.dead = false;

    // ---- model
    let spec;
    if (this.isColossal) spec = { build: 'colossal', size: 'XL', skin: 'pink', hair: false, expr: 'colossal' };
    else {
      const list = this.abnormal ? DESIGNS.abnormal : DESIGNS.normal;
      spec = { ...list[Math.floor(rnd() * list.length)], size: sizeClass(this.height) };
      if (this.height >= 11 && spec.build === 'lanky') spec.build = 'average';
    }
    this.arch = getArchetype(spec);
    this.d = this.arch.dims;
    this.rig = buildRig(this.arch, this.height);
    this.root = this.rig.root; this.J = this.rig.J; this.s = this.rig.scale;
    this.root.rotation.order = 'YXZ';
    this.position = this.root.position;
    this.yaw = o.yaw ?? rnd() * TAU;
    this.root.rotation.y = this.yaw;

    // ---- stats
    const h = this.height;
    this.napeHp = this.isColossal ? 2500 : h <= 7 ? 300 : h >= 15 ? 600 : lerp(300, 600, (h - 7) / 8);
    this.napeDamage = 0;
    this.runSpeed = 1.4 * Math.sqrt(h) * (this.abnormal ? 2.5 : 1);
    this.walkSpeed = 0.42 * 1.4 * Math.sqrt(h) * (this.abnormal ? 1.3 : 1);
    this.turnRate = (1.7 / Math.sqrt(Math.max(h, 3) / 5)) * (this.abnormal ? 2.2 : 1);
    this.noticeRange = this.abnormal ? 180 : 120;
    this.footR = 0.15 * h;
    this.armLen = (this.d.upperLen + this.d.foreLen) * this.s;
    this.shoulderH = (this.d.hipY + this.d.spineY + this.d.shoulderY) * this.s;
    this.phase0 = rnd() * TAU;
    this.tiltBias = (rnd() - 0.5) * (this.abnormal ? 0.9 : 0.6);
    this.mood = rnd();

    // ---- state
    this.t = 0;
    this.state = 'idle'; this.stateT = 0; this.idleDur = 0.5 + rnd() * 3;
    this.act = null;
    this.speed = 0; this.speedTarget = 0; this.goal = null; this.faceYaw = null;
    this.gait = rnd() * TAU; this._stepIdx = 0;
    this.home = new V3(); this.wanderGoal = new V3();
    this.cdAttack = 1 + rnd(); this.cdGroan = 3 + rnd() * 8;
    this.blindT = 0; this.crippleT = 0; this.stunT = 0; this.flinch = 0; this.recoil = 0;
    this.severed = [0, 0]; this.fist = [false, false];
    this.toP = new V3(); this.distH = Infinity; this.dist3 = Infinity; this.relYaw = 0; this.hasPlayer = false;
    this.gy = 0; this.gp = 0; this.stuckT = 0; this.sideBias = 0; this._lastPos = new V3();
    this.jawExtra = 0; this.jawNow = this.arch.jawRest;
    this.vy = 0; this.airborne = false;
    this.steaming = false; this.fadeMats = null; this.deathT = 0; this.fell = false;

    // ---- keyboard-play polish (public): ground velocity, hook points, attack threat
    /** world velocity of the root (m/s), smoothed; the player uses it for relative cut speed */
    this.velocity = new V3();
    /** 0..1: how imminently this titan is attacking the player (1 during a grab/swat/leap wind-up or strike) */
    this.threat = 0;
    this._prevPos = new V3(); this._anc = [new V3(), new V3(), new V3(), new V3()];
    this._handPrev = [new V3(), new V3()]; this._handVel = [new V3(), new V3()]; this._handInit = false;
    // abnormals: a crawling gait variant and an occasional leap at the player
    this.crawler = this.abnormal && (o.crawler ?? rnd() < 0.5);
    this.crawlW = this.crawler ? 1 : 0;
    this.cdLeap = this.abnormal ? 3 + rnd() * 5 : Infinity;
    this.leap = { phase: 0, t: 0, W: 0.45, T: 1, target: new V3(), vx: 0, vz: 0 };
    // wire grabs, shaking off a soldier hanging on the body, abnormals running down horses
    this.clingT = 0; this.cdYank = 2 + rnd() * 3; this.cdCharge = this.abnormal ? 3 + rnd() * 4 : Infinity;

    // ---- pose buffers
    this.P = {}; this.tq = {};
    for (const n of NAMES) { this.P[n] = [0, 0, 0]; this.tq[n] = new Q(); }
    this.hipT = new V3(); this.hipNow = new V3();
    this.ik = [0, 1].map(() => ({ w: 0, wT: 0, rate: 12, tgt: new V3(), pole: new V3(), q1: new Q(), q2: new Q() }));

    // ---- placement
    this.position.copy(o.position || ZERO);
    const gh = this._ground(this.position.x, this.position.z);
    this.position.y = gh;
    this._prevPos.copy(this.position);
    this.home.copy(this.position);
    this.wanderGoal.copy(this.position);
    this._lastPos.copy(this.position);
    this.jawNow = this.arch.jawRest;
    this.J.jaw.rotation.x = this.jawNow;
    this.root.updateMatrixWorld(true);
    this.colliders = [];
    this._registerColliders();
    if (this.isColossal) this._initColossal();
    this.root.traverse((c) => { if (c.isMesh) c.userData.titan = this; });
  }

  // ====================================================================================== helpers
  _ground(x, z) { const c = this.game.collision; return c && c.groundHeight ? c.groundHeight(x, z) : 0; }
  _jpos(name, out) { return out.setFromMatrixPosition(this.J[name].matrixWorld); }
  _headWorld(out) { return this.J.head.localToWorld(out.set(0, this.d.cy, this.d.cz)); }
  _mouthWorld(out) { return this.J.head.localToWorld(out.copy(this.d.mouthLocal)); }
  /** metres in the titan's yaw frame (x = its left, z = its forward) -> world */
  _fp(x, y, z, out) { return out.set(x, y, z).applyAxisAngle(UP, this.yaw).add(this.position); }

  _registerColliders() {
    const col = this.game.collision;
    if (!col || !col.addSphere) return;
    const PART = { head: 'body', torso: 'body', pelvis: 'body', leg: 'body', arm: 'arm', hand: 'hand', foot: 'ankle' };
    for (const sh of this.rig.shapes) {
      if (!sh.collide) continue;
      const userData = { titan: this, part: PART[sh.part] || 'body', sub: sh.part };
      let c;
      if (sh.type === 'capsule') c = col.addCapsule({ a: sh.a, b: sh.b, radius: sh.r, object3D: sh.joint, dynamic: true, material: 'flesh', userData });
      else if (sh.type === 'sphere') c = col.addSphere({ center: sh.c, radius: sh.r, object3D: sh.joint, dynamic: true, material: 'flesh', userData });
      else c = col.addBox({ center: sh.c, halfExtents: sh.h, object3D: sh.joint, dynamic: true, material: 'flesh', userData });
      c._shape = sh;
      this.colliders.push(c);
    }
  }
  _removeColliders(filter) {
    const col = this.game.collision;
    if (!col || !col.remove) return;
    this.colliders = this.colliders.filter((c) => {
      if (filter && !filter(c)) return true;
      col.remove(c); return false;
    });
  }

  _setFist(side, on) {
    if (this.fist[side] === on) return;
    this.fist[side] = on;
    const g = this.arch.geo;
    const key = side === 0 ? (on ? 'foreLFist' : 'foreL') : (on ? 'foreRFist' : 'foreR');
    const m = this.rig.meshes.find((x) => x.key === (side === 0 ? 'foreL' : 'foreR'));
    if (m) { m.mesh.geometry = g[key].full; m.outline.geometry = g[key].outline; }
  }

  // ====================================================================================== public API
  /** Hit-test a sphere against this titan's parts. Pushes {titan, part, point} entries into out. */
  hitTest(center, radius, out) {
    if (!this.alive) return out;
    const R = this.height * 0.75 + radius + 1;
    if (_t0.copy(this.position).addScaledVector(UP, this.height * 0.5).distanceToSquared(center) > R * R) return out;
    const s = this.s, rl = radius / s;
    const best = {};
    for (const sh of this.rig.shapes) {
      if (sh.group === 'arm' && this._sevPart(sh.joint)) continue;
      if (sh.group === 'hand' && this._sevPart(sh.joint)) continue;
      const p = sh.joint.worldToLocal(_t1.copy(center));
      let dist, cp = _t2;
      if (sh.type === 'sphere') { cp.copy(sh.c); dist = p.distanceTo(sh.c) - sh.r; cp.copy(p).sub(sh.c); const l = cp.length(); cp.copy(sh.c); if (l > 1e-6) cp.addScaledVector(_t3.copy(p).sub(sh.c), Math.min(sh.r, l) / l); }
      else if (sh.type === 'capsule') {
        _t3.copy(sh.b).sub(sh.a);
        const tt = clamp(_t4.copy(p).sub(sh.a).dot(_t3) / Math.max(_t3.lengthSq(), 1e-9), 0, 1);
        cp.copy(sh.a).addScaledVector(_t3, tt);
        const l = _t4.copy(p).sub(cp).length();
        dist = l - sh.r; if (l > 1e-6) cp.addScaledVector(_t4.multiplyScalar(Math.min(sh.r, l) / l), 1);
      } else {
        _t3.copy(p).sub(sh.c);
        const cx = clamp(_t3.x, -sh.h.x, sh.h.x), cy = clamp(_t3.y, -sh.h.y, sh.h.y), cz = clamp(_t3.z, -sh.h.z, sh.h.z);
        cp.set(sh.c.x + cx, sh.c.y + cy, sh.c.z + cz);
        dist = hypot(_t3.x - cx, _t3.y - cy, _t3.z - cz);
      }
      if (dist > rl) continue;
      const cat = (sh.part === 'nape' || sh.part === 'eye' || sh.part === 'ankle' || sh.part === 'hand' || sh.part === 'arm') ? sh.part : 'body';
      if (!best[cat] || dist < best[cat].dist) best[cat] = { dist, point: sh.joint.localToWorld(cp.clone()) };
    }
    for (const cat of ['nape', 'eye', 'ankle', 'hand', 'arm', 'body']) if (best[cat]) out.push({ titan: this, part: cat, point: best[cat].point });
    return out;
  }
  _sevPart(joint) {
    const n = joint.name;
    return (n.endsWith('L') && this.severed[0] > 0) || (n.endsWith('R') && this.severed[1] > 0) ? (n.startsWith('fore') || n.startsWith('hand')) : false;
  }

  napeWorld() {
    const d = this.d;
    const center = this.J.head.localToWorld(d.napeC.clone());
    const normal = new V3(0, 0.25, -1).normalize().applyQuaternion(this.J.head.getWorldQuaternion(_q0));
    return { center, normal };
  }

  /**
   * Good world-space hook points for auto-targeting: back of the head, both shoulder blades and the upper back
   * just under the nape (where Survey Corps anchor to reach it). Pushes 4 Vector3 into out (reused every call:
   * copy them if you keep them). Points sit just inside the torso box / head sphere colliders, so a ray from the
   * player towards one hits this titan's flesh.
   */
  anchors(out = []) {
    if (!this.alive) return out;
    const d = this.d, A = this._anc, sp = this.J.spine.matrixWorld;
    A[0].set(0, d.cy + 0.15 * d.ry, d.cz - 0.82 * d.rz).applyMatrix4(this.J.head.matrixWorld);
    A[1].set(0.62 * d.shoulderX, d.shoulderY + 0.15, -0.72).applyMatrix4(sp);
    A[2].set(-0.62 * d.shoulderX, d.shoulderY + 0.15, -0.72).applyMatrix4(sp);
    A[3].set(0, d.shoulderY + 0.45, -0.74).applyMatrix4(sp);
    out.push(A[0], A[1], A[2], A[3]);
    return out;
  }

  /** Called when the player cuts itself free of the hand. */
  onGrabEscape() {
    this.mgr.grabBlockT = Math.max(this.mgr.grabBlockT || 0, GRAB_BLOCK_AFTER_ESCAPE);
    if (this.state !== 'grab') { this._releasePlayer(); return; }
    this._setFist(this.act?.side ?? 0, false); this._setFist(1, false); this._setFist(0, false);
    const hp = this._jpos(this.act?.side === 1 ? 'handR' : 'handL', new V3());
    this.game.fx?.blood?.(hp, new V3(0, 1, 0), 1.6);
    this.game.audio?.titanGroan?.(this.position, this.height);
    this.recoil = 1; this.cdAttack = 3.5;
    this.stunT = 1.4;
    this.act = null; this._enter('stun');
  }

  _releasePlayer() {
    const al = this.act?.ally;
    if (al && al.grabbedBy === this) al.freed(this);
    const pl = this.game.player;
    if (pl && pl.grabbedBy === this) { if (typeof pl.release === 'function') pl.release(this); else pl.grabbedBy = null; }
  }

  applyHit({ part = 'body', damage = 0, point = null, dir = null } = {}) {
    if (!this.alive) return { killed: false, effect: 'none' };
    const fx = this.game.fx, pt = point ? point.clone() : this._headWorld(new V3());
    const dd = dir ? dir.clone().normalize() : new V3(0, 1, 0);
    if (part === 'head' || part === 'torso' || part === 'leg' || part === 'pelvis') part = 'body';
    if (part === 'foot') part = 'ankle';
    let effect = 'none', killed = false;
    switch (part) {
      case 'nape': {
        if (this.isColossal) {
          this.napeDamage += damage;
          if (this.napeDamage >= this.napeHp) { killed = true; effect = 'kill'; } else { effect = 'shallow'; }
        } else if (damage >= this.napeHp) { killed = true; effect = 'kill'; } else effect = damage > 10 ? 'shallow' : 'none';
        break;
      }
      case 'eye':
        if (damage >= 25 && !this.isColossal) { this.blindT = 6; effect = 'blind'; this._onBlinded(); } else effect = damage > 10 ? 'shallow' : 'none';
        break;
      case 'ankle':
        if (damage >= 40 && !this.isColossal) { this.crippleT = 8; effect = 'cripple'; this._onCrippled(); } else effect = damage > 10 ? 'shallow' : 'none';
        break;
      case 'arm': case 'hand':
        if (damage >= 140 && !this.isColossal) {
          const side = this._sideOfPoint(pt);
          this.severed[side] = 14; this._onSevered(side); effect = 'sever';
        } else effect = damage > 10 ? 'shallow' : 'none';
        break;
      default: effect = damage > 20 ? 'shallow' : 'none';
    }
    if ((part === 'arm' || part === 'hand') && damage > 25 && this.state === 'grab' && this.act?.ally) {
      this._releasePlayer(); this._setFist(this.act.side, false); this.act = null; this.stunT = 1.2; this._enter('stun'); effect = effect === 'none' ? 'shallow' : effect;
    }
    if (effect !== 'none') {
      this.flinch = Math.min(1, this.flinch + (effect === 'shallow' ? 0.5 : 1));
      fx?.blood?.(pt, dd, killed ? 3 : effect === 'shallow' ? 1.0 : 1.8);
    }
    if (killed) this._die(pt);
    else if (effect !== 'none' && this.rnd() < 0.35) this.game.audio?.titanGroan?.(this.position, this.height);
    return { killed, effect };
  }
  _sideOfPoint(p) {
    const a = this._jpos('handL', _t5).distanceToSquared(p), b = this._jpos('handR', _t6).distanceToSquared(p);
    return a <= b ? 0 : 1;
  }
  _onSevered(side) {
    const j = this.J[side === 0 ? 'foreL' : 'foreR'];
    j.scale.setScalar(0.02);
    const hide = this.rig.meshes.find((m) => m.key === (side === 0 ? 'foreL' : 'foreR'));
    if (hide) hide.mesh.visible = false;
    this._removeColliders((c) => c._shape.joint === j || c._shape.joint === this.J[side === 0 ? 'handL' : 'handR']);
    if (this.state === 'grab' && this.act?.side === side) { this._releasePlayer(); this.act = null; this._enter('stun'); this.stunT = 1.2; }
    if (this.state === 'reach' && this.act?.side === side) { this.act = null; this._enter('chase'); }
  }
  _regrow(side) {
    const j = this.J[side === 0 ? 'foreL' : 'foreR'];
    j.scale.setScalar(1);
    const m = this.rig.meshes.find((x) => x.key === (side === 0 ? 'foreL' : 'foreR'));
    if (m) m.mesh.visible = true;
    this.game.fx?.steam?.(this._jpos(side === 0 ? 'foreL' : 'foreR', new V3()), this.height * 0.2, 2.5);
    const col = this.game.collision;
    if (col) for (const sh of this.rig.shapes) {
      if (!sh.collide || (sh.joint !== j && sh.joint !== this.J[side === 0 ? 'handL' : 'handR'])) continue;
      const userData = { titan: this, part: sh.part === 'hand' ? 'hand' : 'arm', sub: sh.part };
      const c = sh.type === 'capsule'
        ? col.addCapsule({ a: sh.a, b: sh.b, radius: sh.r, object3D: sh.joint, dynamic: true, material: 'flesh', userData })
        : col.addSphere({ center: sh.c, radius: sh.r, object3D: sh.joint, dynamic: true, material: 'flesh', userData });
      c._shape = sh; this.colliders.push(c);
    }
  }
  _onBlinded() {
    if (this.state === 'grab') this._releasePlayer();
    this.act = null; this._setFist(0, false); this._setFist(1, false);
    this.game.audio?.titanGroan?.(this.position, this.height);
    this._enter('blind');
  }
  _onCrippled() {
    if (this.state === 'grab') { /* keeps holding */ } else if (this.state === 'reach' || this.state === 'swat' || this.state === 'bite') { this.act = null; this._enter('chase'); }
    else if (this.state === 'leap' && !this.airborne) { this.cdLeap = LEAP_COOLDOWN; this._enter('chase'); }
    this.game.audio?.titanGroan?.(this.position, this.height);
    const ft = this._jpos('footL', new V3());
    this.game.fx?.steam?.(ft, this.height * 0.15, 2);
  }

  _die(point) {
    if (this.dying) return;
    this.alive = false; this.dying = true; this.deathT = 0; this.fell = false;
    this.airborne = false; this.threat = 0; this.velocity.set(0, 0, 0);
    this._releasePlayer();
    this.fist[0] && this._setFist(0, false); this.fist[1] && this._setFist(1, false);
    this.ik[0].wT = this.ik[1].wT = 0;
    this.fallSign = this.isColossal ? -1 : (this.rnd() < 0.5 ? 1 : -1);
    this.game.events?.emit?.('titan:killed', { titan: this, by: this.killedBy || null, point: point ? point.clone() : this._headWorld(new V3()) });
    this.game.audio?.napeKill?.();
    this.game.fx?.steam?.(point || this._headWorld(new V3()), Math.max(2, this.height * 0.18), 3);
  }

  // ====================================================================================== update
  update(dt) {
    if (this.dead) return;
    dt = Math.min(dt, 0.05);
    if (dt <= 0) return;
    this.t += dt;
    if (this.dying) { this.velocity.set(0, 0, 0); this.threat = 0; this._updateDying(dt); return; }
    if (this.appearT !== undefined && this.appearT < 0.3) { this.appearT += dt; this.root.visible = this.appearT >= 0.25; }
    this._prevPos.copy(this.position);
    this._timers(dt);
    this._sense();
    if (this.isColossal) this._thinkColossal(dt); else this._think(dt);
    if (!this.isColossal) this._locomote(dt);
    this._groundSnap();
    this.root.rotation.y = this.yaw;   // the body faces where it walks (it was left at the spawn heading)
    this._buildPose(dt);
    this._applyPose(dt);
    this.root.updateMatrixWorld(true);
    this._applyArmIK(dt);
    this.root.updateMatrixWorld(true);
    this._post(dt);
    this._updateVelocity(dt);
    this._updateThreat(dt);
  }

  _updateVelocity(dt) {
    const v = _t0.subVectors(this.position, this._prevPos).multiplyScalar(1 / dt);
    if (v.lengthSq() > 90 * 90) v.set(0, 0, 0);          // teleported (spawn / reposition): not a real velocity
    this.velocity.lerp(v, 1 - Math.exp(-40 * dt));
  }

  /** 0..1 danger for the HUD: 1 while a grab reach / swat / bite / leap is winding up or striking. */
  _updateThreat(dt) {
    let th = 0;
    const a = this.act, st = this.state;
    if (this.hasPlayer && this.blindT <= 0) {
      if (this.isColossal) {
        const pl = this.game.player;
        if (this.sweepT >= 0 && this.sweepT < 3.6 && pl.position.y > 25 && Math.abs(pl.position.z) < 40) th = this.sweepT < 1.4 ? 0.6 + 0.4 * this.sweepT / 1.4 : 1;
        else if (this.steamOn && this.distH < 45) th = 0.6;
      } else if (st === 'reach' && a) th = a.ally ? 0.3 : a.t < a.W + a.E + a.H ? 1 : 0.35;
      else if (st === 'swat' && a) th = a.t < a.W + a.S + 0.1 ? 1 : 0.3;
      else if (st === 'bite' && a) th = a.t < a.W + a.B ? 0.9 : 0.3;
      else if (st === 'grab') th = 1;
      else if (st === 'yank' && a) th = 1;
      else if (st === 'shake' && a) th = a.t < a.W + 0.25 ? 1 : 0.4;
      else if (st === 'charge' && a) th = 1;
      else if (st === 'leap') th = this.leap.phase < 2 ? 1 : 0.45;
      else if (st === 'chase') {
        // closing in: up to ~0.45 when inside a couple of arm lengths and facing, more when the attack is ready
        const A = this.armLen;
        const near = clamp(1 - (this.dist3 - A) / (2.5 * A), 0, 1);
        th = 0.45 * near * (Math.abs(this.relYaw) < 1.2 ? 1 : 0.5) * (this.cdAttack < 0.6 ? 1 : 0.6);
      }
    }
    this.threat = th >= this.threat ? th : Math.max(th, this.threat - dt * 2.5);
  }

  /** May this titan close a hand on the player right now? (difficulty easing for keyboard play) */
  _grabAllowed() {
    const pl = this.game.player;
    return !!pl && !pl.grabbedBy && !((this.mgr.grabBlockT || 0) > 0) && !(pl.grabImmune > 0);
  }

  _timers(dt) {
    this.cdAttack = Math.max(0, this.cdAttack - dt);
    if (this.cdLeap > 0) this.cdLeap -= dt;
    this.flinch = Math.max(0, this.flinch - dt * 2.5);
    this.recoil = Math.max(0, this.recoil - dt * 1.5);
    if (this.blindT > 0) { this.blindT -= dt; if (this.blindT <= 0 && this.state === 'blind') { this.blindT = 0; this._enter('chase'); } }
    if (this.crippleT > 0) { this.crippleT -= dt; if (this.crippleT <= 0) { this.crippleT = 0; this.game.fx?.steam?.(this._jpos('footL', new V3()), this.height * 0.12, 2); } }
    if (this.stunT > 0) { this.stunT -= dt; if (this.stunT <= 0 && this.state === 'stun') this._enter('chase'); }
    for (let i = 0; i < 2; i++) if (this.severed[i] > 0) { this.severed[i] -= dt; if (this.severed[i] <= 0) { this.severed[i] = 0; this._regrow(i); } }
    this.cdGroan -= dt;
    this.cdYank -= dt; this.cdCharge -= dt;
  }

  _enter(state) { this.state = state; this.stateT = 0; }

  _sense() {
    const pl = this.game.player;
    this.hasPlayer = !!(pl && pl.alive && pl.position);
    if (!this.hasPlayer) { this.distH = Infinity; this.dist3 = Infinity; return; }
    this.toP.copy(pl.position).sub(this.position);
    this.distH = hypot(this.toP.x, this.toP.z);
    this.dist3 = this.toP.length();
    this.relYaw = wrap(Math.atan2(this.toP.x, this.toP.z) - this.yaw);
  }

  // ====================================================================================== AI (normal + abnormal)
  _think(dt) {
    const pl = this.game.player;
    this.stateT += dt;
    this.speedTarget = 0; this.goal = null; this.faceYaw = null;
    if (this.aiEnabled === false) { this.state = 'idle'; return; }
    const crippled = this.crippleT > 0;
    const blind = this.blindT > 0;
    const k = Math.max(0.7, Math.sqrt(this.height / 7));
    const canMove = !crippled;

    // random groans
    if (this.cdGroan <= 0) { this.cdGroan = 9 + this.rnd() * 12; if (this.hasPlayer && this.dist3 < 220) this.game.audio?.titanGroan?.(this.position, this.height); }

    // a soldier hanging off us on a short rope, not swinging past: counts toward shaking them off
    if (this.hasPlayer) {
      const hk = this._ropeOnMe(), slow = (pl.velocity?.length?.() || 0) < 14;
      this.clingT = hk >= 0 && slow && this.dist3 < this.height * 0.9 ? this.clingT + dt : Math.max(0, this.clingT - dt * 2);
    }
    switch (this.state) {
      case 'idle':
        if (this._notice()) break;
        if (this.stateT > this.idleDur) { this._pickWander(); this._enter('wander'); }
        break;
      case 'wander': {
        if (this._notice()) break;
        this.goal = this.wanderGoal;
        this.speedTarget = canMove ? this.walkSpeed * (0.55 + 0.3 * this.mood) : 0;
        const dx = this.wanderGoal.x - this.position.x, dz = this.wanderGoal.z - this.position.z;
        if (hypot(dx, dz) < 3 + this.footR || this.stateT > 40) { this.idleDur = 2 + this.rnd() * 5; this._enter('idle'); }
        break;
      }
      case 'chase': {
        if (!this.hasPlayer || this.distH > this.noticeRange * 1.7) { this.home.copy(this.position); this.idleDur = 1; this._enter('idle'); break; }
        this.goal = _g0.copy(pl.position);
        this.speedTarget = canMove ? this.runSpeed : 0;
        // slow down inside arm reach so we do not run through the player
        if (this.distH < this.armLen * 0.8 + this.footR) this.speedTarget = Math.min(this.speedTarget, this.walkSpeed * 0.2);
        if (this.abnormal && canMove && this._tryLeap(dt)) break;
        if (this._tryCounter(dt)) break;
        this._chooseAttack(k);
        break;
      }
      case 'leap': this._thinkLeap(dt); break;
      case 'reach': this._thinkReach(dt, k); break;
      case 'grab': this._thinkGrab(dt); break;
      case 'chew': this.stateT > 1.6 && this._enter(this.hasPlayer ? 'chase' : 'idle'); break;
      case 'swat': this._thinkSwat(dt, k); break;
      case 'bite': this._thinkBite(dt, k); break;
      case 'yank': this._thinkYank(dt); break;
      case 'shake': this._thinkShake(dt); break;
      case 'charge': this._thinkCharge(dt); break;
      case 'stun':
        if (this.stunT <= 0) this._enter('chase');
        break;
      case 'blind': {
        // stumble about
        if (this.stateT % 1.4 < dt) this.sideBias = (this.rnd() - 0.5) * 2.4;
        this.faceYaw = this.yaw + this.sideBias;
        this.goal = _g0.set(this.position.x + Math.sin(this.yaw + this.sideBias) * 20, 0, this.position.z + Math.cos(this.yaw + this.sideBias) * 20);
        this.speedTarget = canMove ? this.walkSpeed * 0.5 : 0;
        if (this.blindT <= 0) this._enter('chase');
        break;
      }
      default: this._enter('idle');
    }
    if (this.state === 'wander' || this.state === 'idle') this.gazeTarget = this.hasPlayer && this.dist3 < 160 ? pl.position : null;
    else this.gazeTarget = this.hasPlayer ? pl.position : null;
    if (blind) this.gazeTarget = null;
  }

  _notice() {
    if (this.hasPlayer && this.distH < this.noticeRange) {
      this._enter('chase');
      if (this.rnd() < 0.7) this.game.audio?.titanGroan?.(this.position, this.height);
      return true;
    }
    return false;
  }

  _pickWander() {
    const r = 15 + this.rnd() * 55, a = this.rnd() * TAU;
    const hx = this.home.x, hz = this.home.z;
    let x = hx + Math.sin(a) * r, z = hz + Math.cos(a) * r;
    x = clamp(x, -1000, 1000); z = clamp(z, -600, 1000);
    // stay on the home side of the wall
    const lim = 6 + this.footR + 4;
    if (hz > 6) z = Math.max(z, lim); else if (hz < -6) z = Math.min(z, -lim);
    this.wanderGoal.set(x, 0, z);
  }

  /** Decide whether to start an attack while chasing. */
  _chooseAttack(k) {
    const pl = this.game.player;
    if (!this.hasPlayer || this.cdAttack > 0 || pl.grabbedBy || this.blindT > 0 || this.stunT > 0) return;
    const A = this.armLen, h = this.height;
    const gy = this._ground(this.position.x, this.position.z);
    const rel = pl.position.y - gy;
    const speedP = pl.velocity ? pl.velocity.length() : 0;
    const airborne = rel > 0.12 * h + 1.0 || speedP > 14;
    const facing = Math.abs(this.relYaw) < 1.0;
    const crippled = this.crippleT > 0;
    const reachMul = crippled ? 0.8 : 1;
    // nearest shoulder
    const sL = this._jpos('armL', _t7), sR = this._jpos('armR', _t8);
    const dL = sL.distanceTo(pl.position) + (this.severed[0] ? 1e3 : 0), dR = sR.distanceTo(pl.position) + (this.severed[1] ? 1e3 : 0);
    const side = dL <= dR ? 0 : 1, dS = Math.min(dL, dR);
    const mouth = this._mouthWorld(_t9);
    const dMouth = mouth.distanceTo(pl.position);

    if (facing && dMouth < 0.5 * h + 1.5 && rel > 0.3 * h && this.rnd() < 2 * 0.016 * 60 * 0.02) { this._startBite(); return; }
    if (facing && airborne && dS < A * 1.05 * reachMul && dS < 1e3) { this._startSwat(side, k); return; }
    if (facing && !airborne && rel < this.shoulderH * 0.95 && this._grabAllowed()) {
      // a stooping titan drops its shoulders and leans forward: effective shoulder for ground-level targets
      const fx = Math.sin(this.yaw) * 0.22 * this.shoulderH, fz = Math.cos(this.yaw) * 0.22 * this.shoulderH;
      let bestS = 0, bestD = 1e9;
      for (let i = 0; i < 2; i++) {
        if (this.severed[i]) continue;
        const sh = i === 0 ? sL : sR;
        const dd = hypot(sh.x + fx - pl.position.x, sh.y - 0.32 * this.shoulderH - pl.position.y, sh.z + fz - pl.position.z);
        if (dd < bestD) { bestD = dd; bestS = i; }
      }
      if (bestD < A * 1.0 * reachMul * (crippled ? 0.8 : 1)) { this._startReach(bestS, k); return; }
    }
    // flying low past us at arm's length: swat too
    if (facing && airborne && this.distH < A * 1.15 && rel < this.shoulderH * 1.15 && dS < 1e3) this._startSwat(side, k);
  }

  _startReach(side, k) {
    // W: a readable wind-up (lean back, open hand, jaw opens) of at least WINDUP s; E (the actual grab) is unchanged
    this.act = { side, t: 0, k, W: Math.max(WINDUP, 0.32 * k), E: 0.5 * k, H: 0.35 * k, R: 0.55 * k, pred: new V3(), cur: new V3(), start: new V3() };
    this._setFist(side, false);
    this._enter('reach');
    this._windupEvent('grab', this.act.W);
  }
  _windupEvent(kind, duration) {
    this.game.events?.emit?.('titan:windup', { titan: this, kind, duration });
  }
  _thinkReach(dt, k) {
    const a = this.act, pl = this.game.player;
    if (!a) { this._enter('chase'); return; }
    a.t += dt;
    this.faceYaw = this.yaw + this.relYaw * 0.6; this.speedTarget = 0;
    const al = a.ally;
    if (al) {
      if (!al.alive || al.grabbedBy || al.horse) { this.act = null; this.cdAttack = 1; this._enter('chase'); return; }
      this.faceYaw = Math.atan2(al.pos.x - this.position.x, al.pos.z - this.position.z);
    } else if (!this.hasPlayer) { this.act = null; this._enter('chase'); return; }
    const tp = al ? al.pos : pl.position, tv = al ? al.vel : pl.velocity;
    const tE = a.W + a.E;
    if (a.t < a.W) { a.pred.copy(tp); }
    else if (a.t < tE) {
      const lead = a.E * 0.7;
      a.pred.copy(tp).addScaledVector(tv || ZERO, lead * 0.9);
    }
    if (al) {
      if (a.t > a.W && a.t < tE + a.H && this._jpos(a.side === 0 ? 'handL' : 'handR', _t10).distanceTo(al.pos) < 1.6 + 0.1 * this.height) { this._catchAlly(a.side, al); return; }
      if (a.t > tE + a.H + a.R) { this.act = null; this.cdAttack = 2 + this.rnd(); this._enter('chase'); }
      return;
    }
    if (a.t > a.W && a.t < a.W + a.E + a.H && this._grabAllowed()) {
      // catch check: palm within reach of the player, and the player is not streaking past the hand
      // (fast ODM flyers are hard to catch: relative speed must be under GRAB_MAX_REL_SPEED)
      const hp = this._jpos(a.side === 0 ? 'handL' : 'handR', _t10);
      if (hp.distanceTo(pl.position) < 0.55 + 0.055 * this.height) {
        const hv = this._handVel[a.side], pv = pl.velocity || ZERO;
        const rel = hypot(pv.x - hv.x, pv.y - hv.y, pv.z - hv.z);
        if (rel < GRAB_MAX_REL_SPEED && this._catch(a.side)) return;
      }
    }
    if (a.t > a.W + a.E + a.H + a.R) { this.act = null; this.cdAttack = (this.abnormal ? 1.2 : 2.2) + this.rnd(); this._enter('chase'); }
  }
  _catch(side) {
    const pl = this.game.player;
    if (pl.grab) { if (pl.grab(this, this.J[side === 0 ? 'handL' : 'handR']) === false) return false; }
    else pl.grabbedBy = this;
    this._setFist(side, true);
    this.act = { side, t: 0, dur: 2.2 };
    this._enter('grab');
    return true;
  }
  /** Close the fist on a comrade: they get a few seconds for someone to cut the hand or the nape. */
  _catchAlly(side, ally) {
    ally.grab(this, this.J[side === 0 ? 'handL' : 'handR']);
    this._setFist(side, true);
    this.act = { side, t: 0, dur: 5.5, ally };
    this.mgr.allyGrabT = 30;
    this._enter('grab');
    this.game.audio?.titanGroan?.(this.position, this.height);
  }
  _thinkGrab(dt) {
    const a = this.act, pl = this.game.player;
    this.speedTarget = 0; this.faceYaw = null;
    if (!a) { this._enter('chase'); return; }
    a.t += dt;
    if (a.ally) {
      if (a.ally.grabbedBy !== this) { this._setFist(a.side, false); this.act = null; this.cdAttack = 2.5; this._enter('chase'); return; }
      if (a.t >= a.dur) {
        this.game.audio?.titanGroan?.(this.position, this.height);
        a.ally.eaten(this);
        this._setFist(a.side, false);
        this.act = null; this.cdAttack = 3; this._enter('chew');
      }
      return;
    }
    if (pl.grabbedBy !== this && a.t > 0.1) { // player got free some other way
      this._setFist(a.side, false); this.act = null; this.cdAttack = 2.5; this._enter('chase'); return;
    }
    if (a.t >= a.dur) {
      this.game.audio?.titanGroan?.(this.position, this.height);
      if (pl.eaten) pl.eaten(this);
      this._setFist(a.side, false);
      this.act = null; this.cdAttack = 3; this._enter('chew');
    }
  }

  // ------------------------------------------------------------------ counters to ODM tactics
  /** Which of the player's hooks is anchored in this titan's body (-1: none). */
  _ropeOnMe() {
    const hooks = this.game.player?.odm?.hooks;
    if (!hooks) return -1;
    for (let i = 0; i < 2; i++) { const h = hooks[i]; if (h.attached && h.collider?.userData?.titan === this) return i; }
    return -1;
  }
  /** The point on a hook's wire nearest this shoulder (kept off both ends), into `out`; returns the distance. */
  _wirePoint(h, shoulder, out) {
    const P = this.game.player.position, A = h.anchor;
    const dx = P.x - A.x, dy = P.y - A.y, dz = P.z - A.z, L2 = dx * dx + dy * dy + dz * dz || 1;
    const u = clamp(((shoulder.x - A.x) * dx + (shoulder.y - A.y) * dy + (shoulder.z - A.z) * dz) / L2, Math.min(0.5, 1.5 / Math.sqrt(L2)), 0.85);
    out.set(A.x + dx * u, A.y + dy * u, A.z + dz * u);
    return out.distanceTo(shoulder);
  }
  /** Chasing: answer the soldier's tactics. Abnormals run down a rider; a rope strung in front of us gets grabbed;
   *  a soldier dangling on our body gets shaken off. Returns true when an action started. */
  _tryCounter(dt) {
    const pl = this.game.player;
    if (!this.hasPlayer || !pl.odm || pl.grabbedBy || this.blindT > 0 || this.stunT > 0) return false;
    if (this.abnormal && pl.riding && this.cdCharge <= 0 && this.crippleT <= 0 && this.distH > 18 && this.distH < 130 && Math.abs(this.relYaw) < 1.4) {
      this.act = { t: 0, W: 0.8, run: 3.4, hit: false };
      this.cdCharge = 11 + this.rnd() * 6; this._enter('charge'); this._windupEvent('charge', 0.8);
      this.game.audio?.titanGroan?.(this.position, this.height * 1.3);
      return true;
    }
    if (!((this.mgr.allyGrabT || 0) > 0) && this.cdAttack <= 0 && this.rnd() < dt * 1.6) {
      for (const al of this.game.allies || []) {
        if (!al.alive || al.grabbedBy || al.horse || !al.job || al.job.titan !== this) continue;
        const ry = wrap(Math.atan2(al.pos.x - this.position.x, al.pos.z - this.position.z) - this.yaw);
        if (Math.abs(ry) > 1.1) continue;
        const sL = this._jpos('armL', _t7).distanceTo(al.pos), sR = this._jpos('armR', _t8).distanceTo(al.pos);
        const side = this.severed[0] ? 1 : this.severed[1] ? 0 : sL <= sR ? 0 : 1;
        if (Math.min(sL, sR) > this.armLen * 1.05 || this.severed[side]) continue;
        this.act = { side, t: 0, k: 1, W: 0.4, E: 0.4, H: 0.3, R: 0.5, pred: new V3(), cur: new V3(), start: new V3(), ally: al };
        this._setFist(side, false); this._enter('reach');
        return true;
      }
    }
    const hk = this._ropeOnMe();
    if (this.clingT > 0.9 && (this.cdAttack <= 0.5 || this.clingT > 1.5)) {
      this.act = { t: 0, W: 0.35, S: 0.8, flung: false };
      this._enter('shake'); this._windupEvent('shake', 0.35);
      this.game.audio?.titanGroan?.(this.position, this.height);
      return true;
    }
    if (hk >= 0 && this.cdAttack <= 0 && this.cdYank <= 0 && Math.abs(this.relYaw) < 1.1 && this._grabAllowed() && this.rnd() < dt * 2.4) {
      const h = pl.odm.hooks[hk];
      let side = -1, best = this.armLen * 1.15;
      for (let i = 0; i < 2; i++) {
        if (this.severed[i]) continue;
        const d = this._wirePoint(h, this._jpos(i === 0 ? 'armL' : 'armR', _t7), _t8);
        if (d < best) { best = d; side = i; }
      }
      if (side >= 0 && h.anchor.distanceTo(pl.position) > 6) {
        this.act = { side, hook: hk, t: 0, W: 0.55, R: 0.24, P: 1.5, q: new V3(), start: new V3(), held: false };
        this.cdYank = 7 + this.rnd() * 4;
        this._setFist(side, false); this._enter('yank'); this._windupEvent('yank', 0.55);
        return true;
      }
    }
    return false;
  }
  _endAct(cd) { this.act = null; this.cdAttack = cd + this.rnd(); this._enter('chase'); }

  /** Snatch the wire out of the air and haul the soldier in, hand over fist, toward the mouth. */
  _thinkYank(dt) {
    const a = this.act, pl = this.game.player;
    if (!a) { this._enter('chase'); return; }
    a.t += dt; this.speedTarget = 0; this.faceYaw = this.yaw + this.relYaw * 0.6;
    const h = pl.odm.hooks[a.hook];
    const hand = a.side === 0 ? 'handL' : 'handR';
    if (!a.held) {
      if (!this.hasPlayer || pl.grabbedBy || !h.attached || h.collider?.userData?.titan !== this) { this._setFist(a.side, false); this._endAct(1.4); return; }
      this._wirePoint(h, this._jpos(a.side === 0 ? 'armL' : 'armR', _t7), a.q);
      if (a.t >= a.W + a.R) {
        a.held = true; h.yank = this; h.yankSide = a.side; h.payout = 0;
        this._setFist(a.side, true); this._jpos(hand, a.start);
        this.game.audio?.titanGroan?.(this.position, this.height);
        this.game.events?.emit?.('player:wireGrabbed', { titan: this });
      }
      return;
    }
    if (h.yank !== this || !h.attached) {            // cut, or let go in time: it hauls on nothing and staggers
      this._setFist(a.side, false); this.recoil = 1; this._endAct(2); return;
    }
    const u = (a.t - a.W - a.R) / a.P;
    const hp = this._jpos(hand, _t10);
    const dir = _t11.subVectors(hp, pl.position);
    const dist = dir.length() || 1; dir.multiplyScalar(1 / dist);
    const sp = 8 + 18 * Math.min(1, u * 2);
    h.length = Math.max(u < 0.4 ? 2.5 : 0.8, Math.min(h.length, dist) - sp * dt);
    const v = pl.velocity, vr = v.dot(dir);
    if (vr < sp) v.addScaledVector(dir, (sp - vr) * Math.min(1, dt * 6));
    // a moment to react (let go / cut) before the other hand can close on you
    if (u > 0.4 && dist < 1.6 + 0.1 * this.height && this._grabAllowed()) { h.yank = null; if (this._catch(a.side)) return; }
    if (u >= 1) { h.yank = null; pl.odm.release(a.hook); this._setFist(a.side, false); this._endAct(2.2); }
  }
  _poseYank() {
    const P = this.P, a = this.act, side = a.side, sg = sideSign(side), A = this.armLen;
    const pole = this._pole(side, 0.7, -0.6, -0.2);
    this._fp(sg * (this.d.shoulderX * this.s + 0.35 * A), this.shoulderH + 0.25 * A, -0.45 * A, _tw);   // cocked, hand open
    if (a.t < a.W) {
      const w = sm(a.t / a.W);
      this._arm(side, _tw, pole, 16);
      P.spine[0] += -0.22 * w; P.spine[1] += sg * 0.3 * w; P.head[0] += -0.2 * w; this.jawExtra += 0.4 * w;
    } else if (!a.held) {
      const e = sm(clamp((a.t - a.W) / a.R, 0, 1));
      _tw.lerp(a.q, e);
      this._arm(side, _tw, pole, 28);
      P.spine[0] += -0.22 + 0.42 * e; P.spine[1] += sg * 0.3 * (1 - e); this.jawExtra += 0.4;
    } else {
      // hand over fist: the fist drags back toward the jaw, the body leans back into the pull
      const u = clamp((a.t - a.W - a.R) / a.P, 0, 1), e = sm(Math.min(1, u * 1.5));
      _tw3.copy(a.start).lerp(this._mouthWorld(_tw2), e * 0.85);
      this._arm(side, _tw3, pole, 14);
      P.spine[0] += 0.2 - 0.38 * e; P.spine[1] += sg * 0.28 * e; P.head[0] += -0.18 * e; this.jawExtra += 0.55 * e;
      const o = 1 - side;                             // the other hand comes up, open, ready to take you
      this._fp(sideSign(o) * (this.d.shoulderX * this.s + 0.2 * A), this.shoulderH - 0.05 * A, 0.45 * A, _tw);
      this._arm(o, _tw, this._pole(o, 0.8, -0.6, -0.2), 8);
    }
  }

  /** A soldier hanging off our body: hunch, then thrash the torso until the anchors tear out. */
  _thinkShake(dt) {
    const a = this.act, pl = this.game.player;
    if (!a) { this._enter('chase'); return; }
    a.t += dt; this.speedTarget = 0; this.faceYaw = null;
    if (!a.flung && a.t > a.W + 0.2) {
      a.flung = true;
      let n = 0;
      for (const h of pl.odm?.hooks || []) if (h.attached && h.collider?.userData?.titan === this) { pl.odm.release(h.side); n++; }
      if (n && this.hasPlayer && this.dist3 < this.height * 1.2) {
        const d = _t11.copy(pl.position).sub(this.position).setY(0);
        if (d.lengthSq() < 1e-4) d.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        d.normalize().multiplyScalar(12); d.y = 7;
        pl.applyImpulse?.(d, 6);
        this.game.events?.emit?.('player:shaken', { titan: this });
      }
    }
    if (a.t > a.W + a.S) { this.clingT = 0; this._endAct(1.5); }
  }
  _poseShake() {
    const P = this.P, a = this.act, t = this.t;
    if (a.t < a.W) {
      const w = sm(a.t / a.W);
      P.spine[0] += 0.25 * w; P.head[0] += 0.2 * w; P.armL[2] += -0.2 * w; P.armR[2] += 0.2 * w; this.jawExtra += 0.3 * w;
      return;
    }
    const env = Math.sin(Math.PI * clamp((a.t - a.W) / a.S, 0, 1));
    P.spine[1] += 0.5 * env * Math.sin(t * 24); P.spine[2] += 0.25 * env * Math.sin(t * 17 + 1);
    P.pelvis[1] += -0.2 * env * Math.sin(t * 24); P.head[1] += 0.45 * env * Math.sin(t * 21 + 2); P.head[2] += 0.2 * env * Math.sin(t * 13);
    P.armL[2] += 0.7 * env; P.armR[2] += -0.7 * env; P.armL[0] += -0.3 * env * Math.sin(t * 19); P.armR[0] += -0.3 * env * Math.sin(t * 19 + 2);
    this.jawExtra += 0.6 * env;
  }

  /** Abnormal: drop low, roar, then sprint straight through a soldier on horseback. */
  _thinkCharge(dt) {
    const a = this.act, pl = this.game.player;
    if (!a) { this._enter('chase'); return; }
    a.t += dt;
    if (this.crippleT > 0 || !this.hasPlayer) { this._endAct(1); return; }
    const hz = pl.riding;
    if (a.t < a.W) { this.speedTarget = 0; this.faceYaw = this.yaw + this.relYaw; return; }
    const tgt = hz ? hz.pos : pl.position, tv = hz ? hz.vel : pl.velocity;
    const lead = clamp(this.distH / (this.runSpeed * 2.2), 0, 1.2);
    this.goal = _g0.copy(tgt).addScaledVector(tv, lead);
    this.speedTarget = this.runSpeed * 2.2;
    const reach = this.footR + 2.2 + 0.1 * this.height;
    for (const h of this.game.herd?.horses || []) {
      if (!h.rider) continue;
      const dx = h.pos.x - this.position.x, dz = h.pos.z - this.position.z;
      if (dx * dx + dz * dz > reach * reach) continue;
      h.hit(1.4);
      if (h.rider === pl) { h.crashed = Math.max(16, h.speed + 6); this.game.events?.emit?.('player:trampled', { titan: this }); }
      else h.rider.dismount?.();
      h.speed = 0; h.yaw += (this.rnd() - 0.5) * 2;
      this.game.fx?.impact?.(h.pos, UP, 'ground');
      this.game.audio?.titanStep?.(h.pos, this.height);
      a.hit = true;
    }
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const ahead = (tgt.x - this.position.x) * fx + (tgt.z - this.position.z) * fz;
    // hit, overshot, lost the rider or out of breath: dig the heels in, skid and stumble
    if (a.hit || a.t > a.W + a.run || (ahead < -3 && this.distH > 6) || (!hz && a.t > a.W + 0.6)) {
      this.act = null; this.cdAttack = 1 + this.rnd(); this.stunT = a.hit ? 0.7 : 1.4; this._enter('stun');
    }
  }
  _poseChargeWindup() {
    const P = this.P, w = sm(this.act.t / this.act.W);
    P.pelvis[0] += 0.5 * w; P.thighL[0] += -0.7 * w; P.thighR[0] += -0.7 * w; P.shinL[0] += 0.5 * w; P.shinR[0] += 0.5 * w;
    P.spine[0] += 0.35 * w; P.head[0] += -0.45 * w; this.hipT.y += -0.2 * this.d.thighLen * w; this.jawExtra += 0.8 * w;
    P.armL[2] += 0.4 * w; P.armR[2] += -0.4 * w;
  }

  _startSwat(side, k) {
    this.act = { side, t: 0, k, W: Math.max(WINDUP, 0.34 * k), S: 0.22 * k, R: 0.65 * k, hit: false, p0: new V3(), p1: new V3(), mid: new V3() };
    this._setFist(side, false);
    this._enter('swat');
    this._windupEvent('swat', this.act.W);
  }
  _thinkSwat(dt, k) {
    const a = this.act, pl = this.game.player;
    if (!a) { this._enter('chase'); return; }
    a.t += dt; this.speedTarget = 0;
    this.faceYaw = this.yaw + this.relYaw * 0.7;
    if (a.t < a.W && this.hasPlayer) {   // aim: keep updating where the player will be
      a.mid.copy(pl.position).addScaledVector(pl.velocity || ZERO, a.W + a.S * 0.5 - a.t);
    }
    if (a.t > a.W && a.t < a.W + a.S + 0.1 && !a.hit && this.hasPlayer) {
      const hp = this._jpos(a.side === 0 ? 'handL' : 'handR', _t10);
      if (hp.distanceTo(pl.position) < 1.3 + 0.1 * this.height) {
        a.hit = true;
        const d = _t11.copy(a.p1).sub(a.p0); d.y = 0; if (d.lengthSq() < 1e-4) d.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); d.normalize();
        d.y = 0.25; d.normalize().multiplyScalar(24 + 0.8 * this.height);
        pl.applyImpulse?.(d, 18 + this.height);
        this.game.fx?.impact?.(hp, UP, 'flesh');
        this.game.audio?.titanStep?.(hp, this.height * 0.6);
      }
    }
    if (a.t > a.W + a.S + a.R) { this.act = null; this.cdAttack = (this.abnormal ? 1.0 : 2.0) + this.rnd(); this._enter('chase'); }
  }

  _startBite() { this.act = { t: 0, W: WINDUP, B: 0.18, R: 0.7, hit: false }; this._enter('bite'); this._windupEvent('bite', WINDUP); }
  _thinkBite(dt) {
    const a = this.act, pl = this.game.player;
    if (!a) { this._enter('chase'); return; }
    a.t += dt; this.speedTarget = 0; this.faceYaw = this.yaw + this.relYaw * 0.8;
    if (!a.hit && a.t > a.W + a.B * 0.6 && this.hasPlayer) {
      a.hit = true;
      const mw = this._mouthWorld(_t9);
      if (mw.distanceTo(pl.position) < 0.2 * this.height + 2) {
        const d = _t11.copy(pl.position).sub(this.position).setY(0.3).normalize().multiplyScalar(14);
        pl.applyImpulse?.(d, 35);
        this.game.audio?.titanStep?.(mw, this.height * 0.5);
      }
    }
    if (a.t > a.W + a.B + a.R) { this.act = null; this.cdAttack = 2 + this.rnd(); this._enter('chase'); }
  }

  // ---------------------------------------------------------------- abnormal leap
  /** Abnormals pounce at a player on (or near) the ground: ballistic arc, never across the wall, ≥ LEAP_COOLDOWN apart. */
  _tryLeap(dt) {
    if (this.cdLeap > 0 || this.blindT > 0 || this.stunT > 0 || !this.hasPlayer) return false;
    const pl = this.game.player, h = this.height, pos = this.position;
    if (pl.grabbedBy || Math.abs(this.relYaw) > 0.55) return false;
    const dMin = Math.max(9, 1.8 * this.armLen), dMax = Math.min(46, 6 + 5 * h);
    if (this.distH < dMin || this.distH > dMax) return false;
    const gp = this._ground(pl.position.x, pl.position.z);
    if (pl.position.y - gp > 0.6 * h + 2) return false;                     // player up on a roof / wall: no pounce
    if (this.rnd() > dt * LEAP_CHANCE) return false;                         // occasional, not the moment it is possible
    // landing point: just short of where the player will be
    const v = pl.velocity || ZERO, lead = 0.4;
    let tx = pl.position.x + v.x * lead, tz = pl.position.z + v.z * lead;
    let dx = tx - pos.x, dz = tz - pos.z;
    let dist = hypot(dx, dz);
    if (dist < 1e-3) return false;
    const land = clamp(dist - (0.45 * this.armLen + 0.5), dMin * 0.6, dMax);
    tx = pos.x + dx / dist * land; tz = pos.z + dz / dist * land;
    tx = clamp(tx, -1095, 1095); tz = clamp(tz, -645, 1045);
    // never through the wall: both ends clearly on the same side of it (a straight segment then cannot cross it)
    const band = 6 + this.footR + 2;
    if (Math.abs(pos.z) < band || Math.abs(tz) < band || Math.sign(pos.z) !== Math.sign(tz)) return false;
    // landing spot and the apex of the arc must be free of houses / trunks
    const col = this.game.collision, r = this.footR;
    const gl = this._ground(tx, tz);
    const T = clamp(0.55 + 0.016 * land + 0.012 * h, 0.75, 1.35);
    if (col && col.collideSphere) {
      if (this._blocked(col, _c0.set(tx, gl + r + 0.3, tz), r)) return false;
      const apex = LEAP_G * T * T / 8;
      if (this._blocked(col, _c0.set((pos.x + tx) / 2, (this.position.y + gl) / 2 + apex + r, (pos.z + tz) / 2), r)) return false;
    }
    const L = this.leap;
    L.phase = 0; L.t = 0; L.W = WINDUP; L.T = T; L.target.set(tx, gl, tz);
    this.act = null;
    this._enter('leap');
    this._windupEvent('leap', L.W);
    return true;
  }
  _blocked(col, c, r) {
    const cs = col.collideSphere(c, r, { dynamic: false });
    for (let i = 0; i < cs.length; i++) {
      const k = cs[i];
      if (k.collider.material === 'ground' || k.collider.type === 'ground' || Math.abs(k.normal.y) > 0.75) continue;
      return true;
    }
    return false;
  }
  _thinkLeap(dt) {
    const L = this.leap, pos = this.position;
    L.t += dt; this.speedTarget = 0;
    this.faceYaw = Math.atan2(L.target.x - pos.x, L.target.z - pos.z);
    if (L.phase === 0) {
      this.speed *= Math.exp(-7 * dt);                     // plant the feet for the crouch
      if (L.t >= L.W) {
        // launch: horizontal speed covers the distance in T, vertical speed returns to the landing height in T
        const dx = L.target.x - pos.x, dz = L.target.z - pos.z;
        L.vx = dx / L.T; L.vz = dz / L.T;
        this.vy = (L.target.y - pos.y) / L.T + 0.5 * LEAP_G * L.T;
        this.airborne = true; this.speed = 0;
        this.yaw = wrap(Math.atan2(dx, dz));
        L.phase = 1; L.t = 0;
        this.game.audio?.titanGroan?.(pos, this.height);
        this.game.fx?.impact?.(_t20.set(pos.x, pos.y + 0.1, pos.z), UP, 'ground');
      }
    } else if (L.phase === 1 && !this.airborne) { L.phase = 2; L.t = 0; }
    else if (L.phase === 2 && L.t > 0.6) {
      this.cdAttack = Math.max(this.cdAttack, 0.8);
      this._enter('chase');
    }
  }
  /** ballistic step while airborne (leaps); returns true when it handled the movement this frame */
  _flight(dt) {
    if (!this.airborne) return false;
    const pos = this.position, L = this.leap;
    const px = pos.x, pz = pos.z;
    pos.x += L.vx * dt; pos.z += L.vz * dt;
    this.vy -= LEAP_G * dt; pos.y += this.vy * dt;
    this._collide();
    this._wallClamp(px, pz);
    pos.x = clamp(pos.x, -1100, 1100); pos.z = clamp(pos.z, -650, 1050);
    const gy = this._ground(pos.x, pos.z);
    if (this.vy < 0 && pos.y <= gy) { pos.y = gy; this._land(); }
    this._lastPos.copy(pos);
    return true;
  }
  _land() {
    const pos = this.position, h = this.height, pl = this.game.player;
    this.airborne = false; this.vy = 0;
    if (this.state === 'leap') { this.leap.phase = 2; this.leap.t = 0; }
    this.cdLeap = LEAP_COOLDOWN + this.rnd() * 4;
    const p = pos.clone();                                  // event payload (kept by listeners): one per landing
    const fx = this.game.fx;
    if (fx?.impact) {
      fx.impact(p, UP, 'ground');
      for (let i = 0; i < 3; i++) {
        const a = this.rnd() * TAU, r = this.footR * (1 + this.rnd());
        fx.impact(_t20.set(pos.x + Math.sin(a) * r, pos.y + 0.1, pos.z + Math.cos(a) * r), UP, 'ground');
      }
    }
    this.game.audio?.titanStep?.(p, 2 * h);
    this.game.events?.emit?.('titan:step', { position: p, size: 2 * h, titan: this });
    // crushed / knocked flat by the landing
    if (this.hasPlayer && pl.alive && !pl.grabbedBy) {
      const dx = pl.position.x - pos.x, dz = pl.position.z - pos.z, dH = hypot(dx, dz), up = pl.position.y - pos.y;
      if (up < 0.6 * h && dH < 0.25 * h + 2) {
        const d = _t11.set(dx, 0, dz); if (d.lengthSq() < 1e-4) d.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        d.normalize(); d.y = 0.45; d.normalize().multiplyScalar(16 + 0.6 * h);
        pl.applyImpulse?.(d, 15 + 1.5 * h);
      } else if (up < 2.5 && dH < 1.2 * h + 3) {
        const d = _t11.set(dx, 0, dz); if (d.lengthSq() < 1e-4) d.set(0, 0, 1);
        d.normalize(); d.y = 0.6; d.normalize().multiplyScalar(7);
        pl.applyImpulse?.(d, 0);
      }
    }
  }

  // ====================================================================================== movement
  _locomote(dt) {
    if (this._flight(dt)) return;
    const pos = this.position, h = this.height;
    // ----- desired heading / speed
    let wantYaw = this.yaw, wantSpeed = this.speedTarget, goalDirValid = false;
    if (this.goal && wantSpeed > 0) {
      const g = this._navGoal(this.goal, _g1);
      const dx = g.x - pos.x, dz = g.z - pos.z, dist = hypot(dx, dz);
      if (dist > 0.6) {
        _dir.set(dx / dist, 0, dz / dist);
        this._avoid(_dir, wantSpeed);
        wantYaw = Math.atan2(_dir.x, _dir.z); goalDirValid = true;
      } else wantSpeed = 0;
    }
    if (!goalDirValid && this.faceYaw !== null) wantYaw = this.faceYaw;
    const dy = wrap(wantYaw - this.yaw);
    const turn = this.turnRate * (this.crippleT > 0 ? 0.5 : 1) * (1 + 0.5 * clamp(this.speed / Math.max(this.runSpeed, 1), 0, 1));
    this.yaw = wrap(this.yaw + clamp(dy, -turn * dt, turn * dt));
    const align = goalDirValid ? clamp(Math.cos(dy) * 1.6 - 0.35, 0, 1) : 0;
    const tgtSp = goalDirValid ? wantSpeed * align : 0;
    const acc = (tgtSp > this.speed ? (this.state === 'charge' ? 2.6 : 0.9) : 2.2) * Math.max(this.runSpeed, 2);
    this.speed += clamp(tgtSp - this.speed, -acc * dt, acc * dt);
    if (this.speed < 0.02) this.speed = 0;
    // ----- integrate
    const px = pos.x, pz = pos.z;
    pos.x += Math.sin(this.yaw) * this.speed * dt;
    pos.z += Math.cos(this.yaw) * this.speed * dt;
    // spread out from other titans
    for (const o of this.mgr.titans) {
      if (o === this || !o.alive) continue;
      const dx = pos.x - o.position.x, dz = pos.z - o.position.z, md = (this.footR + o.footR) * 1.15;
      const d2 = dx * dx + dz * dz;
      if (d2 < md * md && d2 > 1e-6) { const d = Math.sqrt(d2), push = (md - d) * 0.5; pos.x += dx / d * push; pos.z += dz / d * push; }
      else if (d2 <= 1e-6) { pos.x += 0.1; }
    }
    this._collide();
    this._wallClamp(px, pz);
    pos.x = clamp(pos.x, -1100, 1100); pos.z = clamp(pos.z, -650, 1050);
    // stuck detection (chasing but not getting anywhere)
    if (goalDirValid && this.speedTarget > 1) {
      const moved = hypot(pos.x - this._lastPos.x, pos.z - this._lastPos.z);
      if (moved < this.speedTarget * dt * 0.25) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt * 2);
      if (this.stuckT > 1.2) { this.sideBias = (this.rnd() < 0.5 ? -1 : 1) * (0.9 + this.rnd() * 0.8); this.sideT = 1.8; this.stuckT = 0; }
    }
    if (this.sideT > 0) { this.sideT -= dt; if (this.sideT <= 0) this.sideBias = 0; }
    this._lastPos.copy(pos);
  }

  _navGoal(goal, out) {
    out.copy(goal);
    const pos = this.position, r = this.footR, WH = 6, GATE = 8;
    const side = (z) => (z > WH ? 1 : z < -WH ? -1 : 0);
    const sT = side(pos.z), sG = side(goal.z);
    const canPass = this.height < 18 && !this.isColossal;
    const apY = WH + r + 8;
    if (sT !== 0 && sG !== sT) {
      if (!canPass || sG === 0) { out.set(clamp(goal.x, -1190, 1190), 0, sT * (WH + r + 1.5)); return out; }
      // other side: head for the gate
      if (Math.abs(pos.x) > GATE - r * 0.5 || Math.abs(pos.z) > apY + 3) {
        if (Math.abs(pos.z) > apY - 1 || Math.abs(pos.x) > GATE - r * 0.7) { out.set(0, 0, sT * apY); return out; }
      }
      out.set(0, 0, -sT * apY); return out;
    }
    if (sT === 0) { // inside the gate corridor
      const to = goal.z >= pos.z ? 1 : -1;
      out.set(0, 0, to * (WH + r + 10));
    }
    return out;
  }

  _avoid(dir, speed) {
    const col = this.game.collision;
    if (this.sideBias) { const a = Math.atan2(dir.x, dir.z) + this.sideBias; dir.set(Math.sin(a), 0, Math.cos(a)); }
    if (!col || !col.collideSphere) return dir;
    const pos = this.position, r = this.footR;
    const gy = this._ground(pos.x, pos.z);
    let sx = 0, sz = 0;
    for (let pass = 0; pass < 2; pass++) {
      const dist = r * 1.5 + 1 + (pass ? Math.max(speed, 2) * 1.1 : 0);
      _c0.set(pos.x + dir.x * dist, gy + r * 1.05 + 0.4, pos.z + dir.z * dist);
      const cs = col.collideSphere(_c0, r * 1.1, { dynamic: false });
      for (const c of cs) {
        if (c.collider.material === 'ground' || c.collider.type === 'ground' || Math.abs(c.normal.y) > 0.75) continue;
        const w = clamp(c.depth / r, 0.1, 1.5);
        const nl = hypot(c.normal.x, c.normal.z) || 1;
        sx += c.normal.x / nl * w; sz += c.normal.z / nl * w;
      }
    }
    if (sx || sz) {
      dir.x += sx * 1.4; dir.z += sz * 1.4;
      const l = hypot(dir.x, dir.z) || 1; dir.x /= l; dir.z /= l;
    }
    return dir;
  }

  _collide() {
    const col = this.game.collision;
    if (!col || !col.collideSphere) return;
    const pos = this.position, r = this.footR;
    for (let it = 0; it < 2; it++) {
      const gy = this._ground(pos.x, pos.z);
      _c0.set(pos.x, gy + r + 0.3, pos.z);
      const cs = col.collideSphere(_c0, r, { dynamic: false });
      let moved = false;
      for (const c of cs) {
        if (c.collider.material === 'ground' || c.collider.type === 'ground' || Math.abs(c.normal.y) > 0.75) continue;
        const nl = hypot(c.normal.x, c.normal.z); if (nl < 1e-4) continue;
        const dep = Math.min(c.depth, r * 0.6);
        pos.x += c.normal.x / nl * dep; pos.z += c.normal.z / nl * dep; moved = true;
      }
      if (!moved) break;
    }
    // upper body: only pushes out of tall structures (house walls) a little
    const gy = this._ground(pos.x, pos.z);
    _c0.set(pos.x, gy + this.height * 0.55, pos.z);
    const cs = col.collideSphere(_c0, this.height * 0.17, { dynamic: false });
    for (const c of cs) {
      if (c.collider.material === 'ground' || c.collider.type === 'ground' || Math.abs(c.normal.y) > 0.75) continue;
      const nl = hypot(c.normal.x, c.normal.z); if (nl < 1e-4) continue;
      const dep = Math.min(c.depth, this.height * 0.1) * 0.5;
      pos.x += c.normal.x / nl * dep; pos.z += c.normal.z / nl * dep;
    }
  }

  _wallClamp(px, pz) {
    const pos = this.position, r = this.footR, WH = 6, GATE = 8;
    const band = WH + r * 0.4;
    if (Math.abs(pos.z) >= band) return;
    const canPass = this.height < 18 && !this.isColossal;
    if (canPass && Math.abs(pos.x) < GATE - r * 0.5) return;
    // inside the wall: push back to the side it came from
    const side = Math.abs(pz) >= WH ? Math.sign(pz) : (Math.sign(pos.z) || 1);
    pos.z = side * band;
  }

  _groundSnap() {
    const pos = this.position;
    if (this.airborne) return;
    pos.y = this._ground(pos.x, pos.z);
  }

  // ====================================================================================== pose
  _buildPose(dt) {
    const P = this.P, d = this.d, t = this.t + this.phase0;
    for (const n of NAMES) { const a = P[n]; a[0] = a[1] = a[2] = 0; }
    this.hipT.set(0, 0, 0);
    this.ik[0].wT = 0; this.ik[1].wT = 0;
    this.jawExtra = 0; this.rate = 10; this.legRate = 18;
    const crippled = this.crippleT > 0;

    // ---- default stance + idle sway
    P.armL[2] += 0.12; P.armR[2] -= 0.12; P.foreL[0] -= 0.25; P.foreR[0] -= 0.25;
    P.armL[0] += 0.05; P.armR[0] += 0.05;
    P.thighL[2] += 0.05; P.thighR[2] -= 0.05; P.footL[2] -= 0.05; P.footR[2] += 0.05;
    const br = Math.sin(t * 1.3);
    P.spine[0] += 0.02 * br + 0.04; P.spine[2] += 0.025 * Math.sin(t * 0.7);
    P.armL[2] += 0.025 * Math.sin(t * 0.9 + 1); P.armR[2] -= 0.025 * Math.sin(t * 0.9 + 2);
    P.armL[0] += 0.04 * Math.sin(t * 0.8); P.armR[0] += 0.04 * Math.sin(t * 0.8 + 1.7);
    this.hipT.y += 0.03 * br;

    // ---- locomotion (not for the colossal, which stands its ground)
    if (!this.isColossal) {
      if (crippled) this._poseKneel(); else this._poseGait(dt);
      if (this.crawler) this._poseCrawl(dt);
    }

    // ---- state overlays
    if (this.isColossal) this._poseColossal(dt);
    else this._poseState(dt);

    // ---- reactions
    const fl = this.flinch, rc = this.recoil;
    P.spine[0] += -0.18 * fl - 0.3 * rc; P.head[0] += -0.2 * fl - 0.25 * rc;
    P.armL[2] += 0.2 * rc; P.armR[2] -= 0.2 * rc; P.armL[0] += -0.3 * rc; P.armR[0] += -0.3 * rc;
    P.spine[2] += 0.08 * fl * Math.sin(t * 40);

    // ---- gaze: the head tracks the player (creepily), tilted
    const lean = P.spine[0] + P.pelvis[0];
    let gy, gp;
    if (this.gazeTarget) {
      const hw = this._jpos('head', _t12);
      const vx = this.gazeTarget.x - hw.x, vy = this.gazeTarget.y - hw.y, vz = this.gazeTarget.z - hw.z;
      const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
      const xl = vx * cy - vz * sy, zl = vx * sy + vz * cy;
      gy = Math.atan2(xl, zl); gp = Math.atan2(-vy, hypot(xl, zl));
      if (Math.abs(gy) > 2.2) gy = 0;
    } else { gy = Math.sin(t * 0.33) * 0.55; gp = 0.12 + 0.08 * Math.sin(t * 0.5); }
    const gk = 1 - Math.exp(-(this.isColossal ? 1.4 : 3.5) * dt);
    this.gy += (clamp(gy, -1.7, 1.7) - this.gy) * gk;
    this.gp += (clamp(gp, -0.7, 0.9) - this.gp) * gk;
    const blindK = this.blindT > 0 ? 0 : 1;
    P.spine[1] += this.gy * 0.2 * blindK; P.neck[1] += this.gy * 0.28 * blindK; P.head[1] += this.gy * 0.4 * blindK;
    P.neck[0] += this.gp * 0.3 * blindK - lean * 0.3; P.head[0] += this.gp * 0.5 * blindK - lean * 0.55;
    const tilt = (this.tiltBias + 0.12 * Math.sin(t * 0.55)) * (this.isColossal ? 0.3 : 1) * (this.gazeTarget ? 1 : 0.5);
    P.head[2] += tilt; P.neck[2] += tilt * 0.35;

    // ---- jaw
    let jawT = this.arch.jawRest + this.jawExtra;
    if (!this.isColossal && this.gazeTarget && this.state !== 'bite' && this.state !== 'grab') jawT += 0.05 * Math.sin(t * 2.1) + 0.05;
    P.jaw[0] = jawT;
  }

  _poseGait(dt) {
    const P = this.P, d = this.d, s = this.s, h = this.height;
    const sp = this.speed;
    const m = clamp(sp / 0.8, 0, 1);
    const rf = clamp(sp / this.runSpeed, 0, 1.4);
    if (m <= 0.001) return;
    const legLen = (d.thighLen + d.shinLen) * 0.97 * s;
    const stepLen = h * (0.30 + 0.30 * Math.min(rf, 1.2)) * (this.abnormal ? 1.15 : 1) * (1 - 0.3 * this.crawlW);
    this.gait += Math.PI * sp / stepLen * dt;
    const amp = Math.asin(clamp(stepLen * 0.5 / legLen, 0, 0.8)) * m;
    const ph = this.gait;
    for (let i = 0; i < 2; i++) {
      const th = i ? 'thighR' : 'thighL', sh = i ? 'shinR' : 'shinL', ft = i ? 'footR' : 'footL';
      const p = ph + i * Math.PI;
      const sw = -amp * Math.sin(p);
      const kn = m * (0.1 + (0.3 + 0.8 * amp) * Math.pow(Math.max(0, Math.cos(p)), 1.3));
      P[th][0] += sw; P[sh][0] += kn;
      P[ft][0] += -(sw + kn) * 0.85 + 0.3 * m * Math.pow(Math.max(0, -Math.sin(p)), 2);
    }
    const bob = 0.11 * d.thighLen * m * (0.4 + Math.min(rf, 1.2));
    this.hipT.y += bob * (Math.cos(2 * ph) - 1) * 0.5;
    this.hipT.x += -0.1 * m * (0.5 + 0.5 * rf) * Math.cos(ph);
    P.pelvis[1] += -0.13 * m * (0.6 + rf) * Math.sin(ph); P.spine[1] += 0.12 * m * (0.6 + rf) * Math.sin(ph);
    P.pelvis[2] += 0.04 * m * Math.cos(ph);
    const lean = m * (0.05 + 0.2 * Math.min(rf, 1.2)) * (this.abnormal ? 1.5 : 1);
    P.spine[0] += lean; P.pelvis[0] += lean * 0.25;
    P.head[0] += 0.03 * m * Math.cos(2 * ph + 0.5);
    // arms swing opposite to the legs, hanging heavy
    const aa = m * (0.3 + 0.45 * Math.min(rf, 1.3));
    P.armL[0] += aa * Math.sin(ph); P.armR[0] -= aa * Math.sin(ph);
    P.foreL[0] -= m * (0.12 + 0.35 * rf); P.foreR[0] -= m * (0.12 + 0.35 * rf);
    // abnormals: fast flailing arms, lolling head
    if (this.abnormal) {
      const fl = clamp(rf - 0.35, 0, 1);
      P.armL[0] += fl * 1.3 * Math.sin(ph + 0.3); P.armR[0] -= fl * 1.3 * Math.sin(ph + 0.3);
      P.armL[2] += fl * (0.5 + 0.5 * Math.sin(ph * 2)); P.armR[2] -= fl * (0.5 + 0.5 * Math.sin(ph * 2 + 1.3));
      P.foreL[0] -= fl * 0.5 * (1 + Math.sin(ph * 2)); P.foreR[0] -= fl * 0.5 * (1 + Math.sin(ph * 2 + 1));
      P.head[2] += fl * 0.3 * Math.sin(ph); P.neck[1] += fl * 0.25 * Math.sin(ph * 0.5);
      this.jawExtra += 0.4 * fl;
    }
    // footfalls
    const idx = Math.floor((ph - Math.PI / 2) / Math.PI);
    if (idx !== this._stepIdx) { this._stepIdx = idx; this._footfall(idx & 1 ? 'footR' : 'footL'); }
    this.rate = 12;
  }

  _footfall(joint) {
    if (this.speed < 0.6) return;
    const fp = this._jpos(joint, new V3()); fp.y = this._ground(fp.x, fp.z);
    this.game.audio?.titanStep?.(fp, this.height);
    this.game.events?.emit?.('titan:step', { position: fp, size: this.height, titan: this });
    if (this.height >= 8 && this.game.fx?.impact) this.game.fx.impact(fp, UP, 'ground');
  }

  _poseKneel() {
    const P = this.P, d = this.d;
    P.thighL[0] += -0.2; P.thighR[0] += -0.2; P.shinL[0] += 1.5; P.shinR[0] += 1.5;
    P.footL[0] += -1.25; P.footR[0] += -1.25;
    P.thighL[2] += 0.05; P.thighR[2] -= 0.05;
    this.hipT.y += -(d.shinLen + d.ankleH - 0.55);
    P.spine[0] += 0.22; P.head[0] += -0.1;
    P.armL[0] += -0.35; P.armR[0] += -0.35;
  }

  /**
   * Crawling abnormal: torso pitched nearly flat, hips dropped on bent legs, hands planted on the ground ahead of
   * the shoulders in a trot (left hand with the right foot). Blends out (rears up) for attacks, stuns and blindness.
   */
  _poseCrawl(dt) {
    const st = this.state;
    const want = this.crippleT <= 0 && this.blindT <= 0 && !this.airborne && (st === 'idle' || st === 'wander' || st === 'chase') ? 1 : 0;
    this.crawlW += (want - this.crawlW) * (1 - Math.exp(-7 * dt));
    const w = this.crawlW;
    if (w < 0.01) return;
    const P = this.P, d = this.d, s = this.s;
    // pitch: pelvis + spine; thigh / shin world angles from vertical (negative = forward); feet flat
    const PP = 1.0, SP = 0.32, TA = -0.85, SA = 0.55;
    P.pelvis[0] += PP * w; P.spine[0] += SP * w;
    P.thighL[0] += (TA - PP) * w; P.thighR[0] += (TA - PP) * w;
    P.shinL[0] += (SA - TA) * w; P.shinR[0] += (SA - TA) * w;
    P.footL[0] += -SA * w; P.footR[0] += -SA * w;
    P.thighL[2] += 0.14 * w; P.thighR[2] -= 0.14 * w;
    this.hipT.y -= w * (d.thighLen * (1 - Math.cos(TA)) + d.shinLen * (1 - Math.cos(SA)));
    this.jawExtra += 0.25 * w;
    // hands: ground targets in the titan's yaw frame, swinging with the gait phase
    const m = clamp(this.speed / 0.8, 0, 1), rf = clamp(this.speed / this.runSpeed, 0, 1.4);
    const stepLen = this.height * (0.30 + 0.30 * Math.min(rf, 1.2)) * 1.15 * 0.7;
    const reachZ = (d.spineY + d.shoulderY) * Math.sin(PP + SP) * s + 0.32 * this.armLen;
    const gy = this.position.y + 0.45 * d.handS * s;
    for (let i = 0; i < 2; i++) {
      if (this.severed[i] > 0) continue;
      const pa = this.gait + (i === 0 ? Math.PI : 0);        // left hand pairs with the right foot
      const z = reachZ + 0.5 * stepLen * Math.sin(pa) * m;
      const lift = 0.18 * stepLen * m * Math.max(0, Math.cos(pa));
      this._fp(sideSign(i) * d.shoulderX * s * 1.2, 0, z, _tw);
      _tw.y = gy + lift;
      this._arm(i, _tw, this._pole(i, 0.55, -1, 0.15), 16);
      this.ik[i].wT = w;
    }
  }

  /** arm IK request. targetWorld: Vector3, poleLocal: direction in spine space the elbow should point to */
  _arm(side, target, pole, rate = 14) {
    const a = this.ik[side];
    a.wT = 1; a.rate = rate; a.tgt.copy(target); a.pole.copy(pole);
  }
  _pole(side, x, y, z) { return _pl.set((side === 0 ? 1 : -1) * x, y, z); }

  _poseState(dt) {
    const P = this.P, d = this.d, s = this.s, st = this.state, a = this.act, A = this.armLen;
    const sgn = (side) => (side === 0 ? 1 : -1);
    if (this.blindT > 0 || st === 'blind') {
      // both hands clamped over the eyes, head shaking, stumbling
      const hw = this._headWorld(_t13), t = this.t;
      const f = _t14.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const ax = Math.cos(this.yaw), az = -Math.sin(this.yaw);   // titan-left in world
      for (let i = 0; i < 2; i++) {
        const sg = sgn(i);
        _t15.set(hw.x + f.x * this.d.rz * 0.9 * s * 1.0 + ax * sg * this.d.headR * 0.42 * s, hw.y + this.d.headR * 0.14 * s, hw.z + f.z * this.d.rz * 0.9 * s + az * sg * this.d.headR * 0.42 * s);
        this._arm(i, _t15, this._pole(i, 1.0, 0.1, -0.2), 16);
      }
      P.head[2] += 0.25 * Math.sin(t * 9); P.head[1] += 0.2 * Math.sin(t * 7.3); P.spine[0] += 0.28; P.spine[2] += 0.1 * Math.sin(t * 3.3);
      this.jawExtra += 0.35;
      P.thighL[0] += -0.1; P.thighR[0] += -0.1; P.shinL[0] += 0.2; P.shinR[0] += 0.2;
      this.rate = 14;
      return;
    }
    switch (st) {
      case 'leap': this._poseLeap(dt); break;
      case 'reach': if (a) this._poseReach(dt); break;
      case 'grab': if (a) this._poseGrab(dt); break;
      case 'swat': if (a) this._poseSwat(dt); break;
      case 'bite': if (a) this._poseBite(dt); break;
      case 'yank': if (a) this._poseYank(); break;
      case 'shake': if (a) this._poseShake(); break;
      case 'charge': if (a && a.t < a.W) this._poseChargeWindup(); break;
      case 'chew': {
        const t = this.stateT;
        this.jawExtra += 0.22 + 0.22 * Math.sin(t * 11);
        P.head[0] += -0.1 + 0.08 * Math.sin(t * 11); P.spine[0] += -0.05;
        break;
      }
      case 'stun': {
        const t = this.stateT;
        P.spine[0] += -0.2 + 0.06 * Math.sin(t * 8); P.head[0] += -0.3; P.armL[0] += -0.4; P.armR[0] += -0.4;
        P.armL[2] += 0.35; P.armR[2] -= 0.35;
        break;
      }
      default: break;
    }
  }

  _shoulderRel(side, out) { return out.set(sideSign(side) * this.d.shoulderX * this.s, this.shoulderH, 0); }

  _poseReach() {
    const P = this.P, a = this.act, A = this.armLen, side = a.side, sg = sideSign(side);
    const tE = a.W + a.E;
    let w;
    if (a.t < a.W) {
      w = sm(a.t / a.W);
      // wind up (readable tell): arm cocked back, high and out with the hand open, torso and head lean back, jaw drops
      this._fp(sg * (this.d.shoulderX * this.s + 0.35 * A), this.shoulderH + 0.25 * A, -0.45 * A, _tw);
      this._arm(side, _tw, this._pole(side, 0.8, -0.4, -0.2), 16);
      P.spine[0] += -0.24 * w; P.spine[1] += sg * 0.3 * w;
      P.neck[0] += -0.12 * w; P.head[0] += -0.22 * w;
      this.jawExtra += 0.45 * w;
    } else {
      const u = clamp((a.t - a.W) / a.E, 0, 1);
      const e = a.t < tE ? sm(u) : 1;
      this.jawExtra += 0.45 * (1 - e) + 0.15;
      this._fp(sg * (this.d.shoulderX * this.s + 0.35 * A), this.shoulderH + 0.25 * A, -0.45 * A, _tw);
      _tw2.copy(a.pred);
      if (a.t >= tE && (a.ally || this.hasPlayer)) a.pred.lerp(a.ally ? a.ally.pos : this.game.player.position, 0.15);
      _tw.lerp(_tw2, e);
      let retract = 0;
      if (a.t > tE + a.H) retract = sm((a.t - tE - a.H) / a.R);
      if (retract > 0) { this._fp(sg * (this.d.shoulderX * this.s + 0.1 * A), this.shoulderH - 0.4 * A, 0.1 * A, _tw3); _tw.lerp(_tw3, retract); }
      this._arm(side, _tw, this._pole(side, 0.6, -0.8, -0.3), a.t < tE ? 22 : 12);
      P.spine[0] += 0.28 * e * (1 - retract); P.spine[1] += clamp(this.relYaw, -0.7, 0.7) * 0.3 * e;
      // stoop (bend at the hips, knees give) when the target is low
      const gy = this.position.y;
      const need = clamp((this.shoulderH * 0.85 - (a.pred.y - gy)) / (this.shoulderH * 0.7), 0, 1);
      const stp = need * e * (1 - retract);
      P.pelvis[0] += 0.75 * stp; P.thighL[0] += -1.0 * stp; P.thighR[0] += -1.0 * stp;
      P.shinL[0] += 0.5 * stp; P.shinR[0] += 0.5 * stp; P.footL[0] += -0.25 * stp; P.footR[0] += -0.25 * stp;
      P.spine[0] += 0.3 * stp; this.hipT.y += -0.28 * this.d.thighLen * stp;
    }
    this.jawExtra += 0.2;
  }

  _poseGrab() {
    const P = this.P, a = this.act, side = a.side;
    const u = sm(a.t / a.dur);
    // from the hand's grab position to the mouth
    const mouth = this._mouthWorld(_tw);
    if (!a.start) { a.start = this._jpos(side === 0 ? 'handL' : 'handR', new V3()); }
    _tw2.copy(a.start).lerp(mouth, u);
    _tw2.y += Math.sin(u * Math.PI) * 0.06 * this.height;
    this._arm(side, _tw2, this._pole(side, 0.8, -0.5, -0.1), 20);
    // the other hand: held up, clenched
    const o = 1 - side;
    this._fp(sideSign(o) * (this.d.shoulderX * this.s + 0.15 * this.armLen), this.shoulderH - 0.15 * this.armLen, 0.3 * this.armLen, _tw3);
    this._arm(o, _tw3, this._pole(o, 0.8, -0.6, -0.2), 8);
    P.head[0] += -0.38 * u; P.neck[0] += -0.12 * u; P.spine[0] += -0.1 * u;
    this.jawExtra += 0.75 * u;
  }

  _poseSwat() {
    const P = this.P, a = this.act, A = this.armLen, side = a.side, sg = sideSign(side);
    const pl = this.game.player;
    const tS = a.W + a.S;
    const mid = a.mid;
    // swing across the player's position from the outside in
    const dirH = _t16.set(mid.x - this.position.x, 0, mid.z - this.position.z);
    if (dirH.lengthSq() < 1e-4) dirH.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    dirH.normalize();
    const perp = _t17.set(dirH.z, 0, -dirH.x).multiplyScalar(sg * 0.75 * A);   // sg>0: from the titan-left side
    a.p0.copy(mid).add(perp); a.p1.copy(mid).sub(perp);
    const sh = this._jpos(side === 0 ? 'armL' : 'armR', _t18);
    // keep path points within a sane reach of the shoulder (the IK clamps the rest)
    let w, e;
    if (a.t < a.W) {
      e = 0; w = sm(a.t / a.W);
      _tw.copy(a.p0); _tw.y = Math.max(_tw.y, sh.y + 0.15 * A);
      _tw.lerp(_tw3.copy(sh).add(_t19.set(sg * 0.5 * A, 0.3 * A, 0).applyAxisAngle(UP, this.yaw)), 1 - w);
      // wind-up tell: twist away, lean back, head back, jaw open
      P.spine[1] += sg * 0.4 * w; P.spine[0] += -0.2 * w;
      P.neck[0] += -0.1 * w; P.head[0] += -0.18 * w;
      this.jawExtra += 0.45 * w;
    } else if (a.t < tS) {
      e = sm((a.t - a.W) / a.S);
      _tw.copy(a.p0).lerp(a.p1, e);
      P.spine[1] += sg * 0.35 * (1 - 2 * e); P.spine[0] += 0.12 * e;
    } else {
      const rr = sm((a.t - tS) / a.R);
      _tw.copy(a.p1).lerp(_tw3.copy(sh).add(_t19.set(sg * 0.2 * A, -0.5 * A, 0.1 * A).applyAxisAngle(UP, this.yaw)), rr);
      P.spine[1] += -sg * 0.35 * (1 - rr);
    }
    this._arm(side, _tw, this._pole(side, 0.9, 0.2, -0.3), a.t < tS ? 26 : 10);
  }

  _poseBite() {
    const P = this.P, a = this.act;
    let k;
    if (a.t < a.W) { k = sm(a.t / a.W); P.head[0] += -0.35 * k; P.spine[0] += -0.15 * k; this.jawExtra += 0.9 * k; }
    else if (a.t < a.W + a.B) { const u = sm((a.t - a.W) / a.B); P.head[0] += lerp(-0.35, 0.4, u); P.neck[0] += 0.3 * u; P.spine[0] += lerp(-0.15, 0.45, u); this.jawExtra += 0.9 * (1 - u); }
    else { const u = sm((a.t - a.W - a.B) / a.R); P.head[0] += 0.4 * (1 - u); P.neck[0] += 0.3 * (1 - u); P.spine[0] += 0.45 * (1 - u); this.jawExtra += 0.1 * (1 - u); }
    this.rate = 22;
  }

  /** leap: deep crouch with arms thrown back (wind-up), arms-first dive (air), heavy squat with hands slammed down (landing) */
  _poseLeap() {
    const P = this.P, d = this.d, L = this.leap;
    const crouch = (k, lean) => {
      // thighs 0.95 rad forward, shins 0.65 back (world), feet flat; pelvis pitched by `lean`
      const TA = -0.95, SA = 0.65;
      P.pelvis[0] += lean * k; P.spine[0] += lean * k;
      P.thighL[0] += (TA - lean) * k; P.thighR[0] += (TA - lean) * k;
      P.shinL[0] += (SA - TA) * k; P.shinR[0] += (SA - TA) * k;
      P.footL[0] += -SA * k; P.footR[0] += -SA * k;
      this.hipT.y -= k * (d.thighLen * (1 - Math.cos(TA)) + d.shinLen * (1 - Math.cos(SA)));
    };
    if (L.phase === 0) {
      const w = sm(L.t / L.W);
      crouch(w, 0.35);
      P.armL[0] += 0.9 * w; P.armR[0] += 0.9 * w; P.armL[2] += 0.25 * w; P.armR[2] -= 0.25 * w;
      P.foreL[0] -= 0.4 * w; P.foreR[0] -= 0.4 * w;
      this.jawExtra += 0.6 * w;
      this.rate = 16; this.legRate = 20;
    } else if (L.phase === 1) {
      const u = clamp(L.t / L.T, 0, 1), tuck = u < 0.65 ? 1 : 1 - sm((u - 0.65) / 0.35);
      P.spine[0] += 0.45; P.pelvis[0] += 0.15;
      P.armL[0] += -2.2; P.armR[0] += -2.2; P.armL[2] += 0.45; P.armR[2] -= 0.45;
      P.foreL[0] -= 0.2; P.foreR[0] -= 0.2;
      // legs trail behind, then swing under for the landing
      P.thighL[0] += lerp(-0.7, 0.35, tuck); P.thighR[0] += lerp(-0.8, 0.5, tuck);
      P.shinL[0] += lerp(0.9, 1.1, tuck); P.shinR[0] += lerp(0.9, 1.2, tuck);
      this.jawExtra += 0.85;
      this.rate = 12; this.legRate = 14;
    } else {
      const v = 1 - sm(L.t / 0.6);
      crouch(1.15 * v, 0.55);
      P.armL[0] += -0.9 * v; P.armR[0] += -0.9 * v; P.armL[2] += 0.3 * v; P.armR[2] -= 0.3 * v;
      this.jawExtra += 0.4 * v;
      this.rate = 18; this.legRate = 24;
    }
  }

  _applyPose(dt) {
    const P = this.P, ra = 1 - Math.exp(-this.rate * dt), la = 1 - Math.exp(-this.legRate * dt);
    for (const n of NAMES) {
      const v = P[n];
      const q = this.tq[n].setFromEuler(_eu.set(v[0], v[1], v[2], 'YXZ'));
      const leg = n.startsWith('thigh') || n.startsWith('shin') || n.startsWith('foot');
      this.J[n].quaternion.slerp(q, leg ? la : ra);
    }
    this.hipNow.lerp(this.hipT, ra);
    this.J.pelvis.position.set(this.hipNow.x, this.d.hipY + this.hipNow.y, this.hipNow.z);
  }

  _applyArmIK(dt) {
    const spine = this.J.spine;
    let inv = null;
    for (let side = 0; side < 2; side++) {
      const a = this.ik[side];
      a.w += (a.wT - a.w) * (1 - Math.exp(-a.rate * dt));
      if (a.w < 0.003) { a.w = a.wT === 0 ? 0 : a.w; continue; }
      if (!inv) inv = _mi.copy(spine.matrixWorld).invert();
      const arm = this.J[side === 0 ? 'armL' : 'armR'], fore = this.J[side === 0 ? 'foreL' : 'foreR'];
      _il.copy(a.tgt).applyMatrix4(inv);
      solveArm(arm.position, _il, this.d.upperLen, this.d.foreLen, a.pole, a.q1, a.q2);
      const w = a.w >= 0.995 ? 1 : sm(a.w);
      arm.quaternion.slerp(a.q1, w); fore.quaternion.slerp(a.q2, w);
    }
  }

  _post(dt) {
    // pose is final; keep helpers current. Footsteps for huge titans etc. are handled in the gait.
    if (this.state === 'grab' && this.act && !this.act.start) this.act.start = this._jpos(this.act.side === 0 ? 'handL' : 'handR', new V3());
    // palm velocities (for the grab's relative-speed check)
    for (let i = 0; i < 2; i++) {
      const hp = this._jpos(i === 0 ? 'handL' : 'handR', _t21), prev = this._handPrev[i];
      if (this._handInit) this._handVel[i].subVectors(hp, prev).multiplyScalar(1 / dt);
      prev.copy(hp);
    }
    this._handInit = true;
  }

  // ====================================================================================== colossal
  _initColossal() {
    this.appearT = 0; this.root.visible = false;
    this.steamOn = true; this.steamT = 0; this.steamDur = 9; this.steamEmit = 0; this.steamPush = 0; this.steaming = true;
    this.sweepT = -1; this.sweepCd = 7 + this.rnd() * 3; this.sweepSide = 1; this.sweepHit = false;
    this.state = 'colossal';
    this.stepSkip = true;
  }

  _thinkColossal(dt) {
    const pl = this.game.player, fx = this.game.fx;
    // steam vent cycle: ~9 s of scalding steam, ~6 s of quiet windows in which the nape can be attacked
    this.steamT += dt;
    if (this.steamT >= this.steamDur) {
      this.steamOn = !this.steamOn; this.steamT = 0;
      this.steamDur = this.steamOn ? 8 + this.rnd() * 3 : 6 + this.rnd() * 0.5;
      this.steaming = this.steamOn;
      if (this.steamOn) {
        const c = this.position.clone(); c.y += this.height * 0.6;
        fx?.steam?.(c, 16, 4); this.game.audio?.steamHiss?.(this.position, this.height);
      }
    }
    this.gazeTarget = this.hasPlayer ? pl.position : null;
    this.speedTarget = 0; this.speed = 0;
    this.faceYaw = null;
    if (this.steamOn && this.appearT >= 0.25) {
      this.steamEmit -= dt;
      if (this.steamEmit <= 0) {
        this.steamEmit = 0.22;
        const J = this.J, p = _t20;
        const parts = ['armL', 'armR', 'spine', 'head', 'thighL', 'thighR', 'pelvis', 'foreL', 'foreR'];
        const nm = parts[Math.floor(this.rnd() * parts.length)];
        this._jpos(nm, p);
        p.x += (this.rnd() - 0.5) * 8; p.z += (this.rnd() - 0.5) * 8;
        fx?.steam?.(p, 7 + this.rnd() * 8, 3.5);
      }
      this.steamPush -= dt;
      if (this.steamPush <= 0) {
        this.steamPush = 0.45;
        if (this.hasPlayer && this.distH < 35 && pl.applyImpulse) {
          const dir = _t21.set(pl.position.x - this.position.x, 0, pl.position.z - this.position.z);
          if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
          dir.normalize(); dir.y = 0.3; dir.normalize().multiplyScalar(25);
          pl.applyImpulse(dir, 10);
          fx?.steam?.(pl.position.clone().addScaledVector(dir, -0.04), 5, 1.5);
        }
      }
    }
    // arm sweep across the wall top
    if (this.sweepT >= 0) {
      this.sweepT += dt;
      if (this.sweepT > 6) { this.sweepT = -1; this.sweepCd = 9 + this.rnd() * 5; }
    } else {
      this.sweepCd -= dt;
      const nearWall = this.hasPlayer && pl.position.y > 25 && Math.abs(pl.position.z) < 25;
      if (this.sweepCd <= 0 || (nearWall && this.sweepCd < 4 && this.rnd() < 0.5 * dt)) {
        this.sweepT = 0; this.sweepHit = false; this.sweepSide = -this.sweepSide;
      }
    }
  }

  _poseColossal(dt) {
    const P = this.P, A = this.armLen;
    this.rate = 6;
    P.spine[0] += 0.06; P.head[0] += 0.0;
    P.armL[2] += 0.12; P.armR[2] -= 0.12;
    if (this.sweepT < 0) return;
    // sweep: right arm from outside across the wall top (or mirrored)
    const t = this.sweepT, side = this.sweepSide < 0 ? 1 : 0, sg = sideSign(side);
    const T1 = 1.4, T2 = 3.6, T3 = 4.2, T4 = 6;
    const sh = this._jpos(side === 0 ? 'armL' : 'armR', _t18);
    const fwd = _t16.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const left = _t17.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const Rs = 0.93 * A;
    const point = (phi, dy, out) => out.copy(sh).addScaledVector(fwd, Math.cos(phi) * Rs).addScaledVector(left, Math.sin(phi) * Rs * sg).setY(sh.y + dy);
    let phi, dy, w;
    if (t < T1) { w = sm(t / T1); phi = -1.3; dy = lerp(-0.5, 0.15, w) * A; }
    else if (t < T2) { w = sm((t - T1) / (T2 - T1)); phi = lerp(-1.3, 1.1, w); dy = 0.0 * A + 0.1 * A * Math.sin(w * Math.PI); }
    else if (t < T3) { phi = 1.1; dy = 0.05 * A; }
    else { w = sm((t - T3) / (T4 - T3)); phi = lerp(1.1, 0.4, w); dy = lerp(0.05, -0.55, w) * A; }
    point(phi, dy, _tw);
    this._arm(side, _tw, this._pole(side, 1.0, 0.3, -0.2), 5);
    P.spine[1] += sg * clamp(phi, -1.2, 1.2) * -0.25; P.spine[0] += 0.05;
    // the hand sweeping through the player
    if (!this.sweepHit && t > T1 && t < T2 && this.hasPlayer) {
      const hp = this._jpos(side === 0 ? 'handL' : 'handR', _t10);
      const pl = this.game.player;
      if (hp.distanceTo(pl.position) < 7 + 0.0 * this.height) {
        this.sweepHit = true;
        const dir = _t11.copy(left).multiplyScalar(-sg).setY(0.35).normalize().multiplyScalar(32);
        pl.applyImpulse?.(dir, 30);
        this.game.fx?.impact?.(hp, UP, 'stone');
        this.game.events?.emit?.('titan:step', { position: hp.clone(), size: this.height * 0.6, titan: this });
      }
    }
  }

  // ====================================================================================== death
  _updateDying(dt) {
    this.deathT += dt;
    const T = this.isColossal ? 3.2 : 1.5, tt = this.deathT;
    const P = this.P, fx = this.game.fx, h = this.height, s = this.s, sgn = this.fallSign;
    for (const n of NAMES) { const a = P[n]; a[0] = a[1] = a[2] = 0; }
    // pose: knees buckle, arms flung, head lolls
    const u = clamp(tt / T, 0, 1);
    P.thighL[0] += -0.5 * u; P.thighR[0] += -0.3 * u; P.shinL[0] += 0.9 * u; P.shinR[0] += 0.6 * u;
    P.footL[0] += -0.4 * u; P.footR[0] += -0.2 * u;
    P.armL[0] += -sgn * 0.9 * u; P.armR[0] += -sgn * 0.6 * u; P.armL[2] += 0.8 * u; P.armR[2] -= 0.8 * u;
    P.foreL[0] += -0.3 * u; P.foreR[0] += -0.3 * u;
    P.head[0] += sgn * -0.5 * u; P.neck[0] += sgn * -0.3 * u; P.head[2] += 0.3 * u;
    P.jaw[0] = 0.5 * u + this.arch.jawRest;
    P.spine[0] += sgn * -0.2 * u;
    this.hipT.set(0, -0.8 * u, 0);
    this.rate = 7; this.legRate = 7;
    this._applyPose(dt);
    this.ik[0].wT = this.ik[1].wT = 0;
    for (const a of this.ik) a.w = 0;
    // topple about the heels
    const ang = sgn * (Math.PI / 2) * u * u;
    let extra = 0;
    if (tt > T) { const b = tt - T; extra = sgn * 0.05 * Math.exp(-b * 6) * Math.sin(b * 22); }
    this.root.rotation.x = ang + extra;
    this.position.y = this._ground(this.position.x, this.position.z) + 1.15 * s * Math.abs(Math.sin(clamp(ang, -1.55, 1.55)));
    this.root.updateMatrixWorld(true);
    if (!this.fell && tt >= T) {
      this.fell = true;
      const hp = this._headWorld(new V3()); hp.y = this._ground(hp.x, hp.z) + 0.2;
      fx?.impact?.(hp, UP, 'ground');
      for (let i = 0; i < 3; i++) fx?.impact?.(hp.clone().add(new V3((Math.random() - 0.5) * h * 0.4, 0, (Math.random() - 0.5) * h * 0.4)), UP, 'ground');
      this.game.audio?.titanFall?.(this.position, h);
      this.game.events?.emit?.('titan:step', { position: hp, size: h * 2.5, titan: this });
      this._steamBurst(1.5);
      this._beginFade();
    }
    if (this.fell) {
      const b = tt - T;
      // heavy steam, then the body evaporates
      this.steamEmit = (this.steamEmit ?? 0) - dt;
      if (this.steamEmit <= 0 && b < 8) {
        this.steamEmit = this.isColossal ? 0.18 : 0.3;
        this._steamBurst(1 - 0.6 * (b / 8));
      }
      const f = clamp((b - 2.0) / 6.0, 0, 1);       // 0..1 over the last 6 s of 8
      if (this.fadeMats) {
        const k = 1 - 0.75 * f;
        this.fadeMats.body.color.setScalar(1 - 0.7 * f);
        this.fadeMats.body.opacity = 1 - f; this.fadeMats.outline.opacity = 1 - f;
        void k;
        this.root.scale.setScalar(this.s * (1 - 0.15 * f));
      }
      if (b >= 8) this._finish();
    }
  }
  _steamBurst(k) {
    const fx = this.game.fx; if (!fx?.steam) return;
    const h = this.height;
    const names = ['pelvis', 'spine', 'head', 'armL', 'armR', 'thighL', 'thighR', 'shinL', 'shinR'];
    for (let i = 0; i < (this.isColossal ? 2 : 1); i++) {
      const nm = names[Math.floor(this.rnd() * names.length)];
      const p = this._jpos(nm, new V3()); p.x += (this.rnd() - 0.5) * h * 0.1; p.z += (this.rnd() - 0.5) * h * 0.1;
      fx.steam(p, Math.max(2.5, h * (this.isColossal ? 0.12 : 0.28)) * k, 3.5);
    }
  }
  _beginFade() {
    if (this.fadeMats) return;
    const body = this.arch.material.clone();
    body.transparent = true; body.opacity = 1;
    const base = outlineMaterial(this.rig.outlineThickness);
    const outline = base.clone();
    outline.onBeforeCompile = base.onBeforeCompile; outline.customProgramCacheKey = base.customProgramCacheKey;
    outline.transparent = true; outline.opacity = 1;
    for (const m of this.rig.meshes) { m.mesh.material = body; m.outline.material = outline; }
    this.fadeMats = { body, outline };
  }
  _finish() {
    this.dead = true; this.dying = false;
    this._removeColliders();
    this.root.visible = false;
    if (this.root.parent) this.root.parent.remove(this.root);
    if (this.fadeMats) { this.fadeMats.body.dispose(); this.fadeMats.outline.dispose(); this.fadeMats = null; }
  }
  /** Remove immediately (manager.clear()). */
  dispose() {
    this.alive = false; this.dead = true; this.dying = false;
    this._releasePlayer();
    this._removeColliders();
    if (this.root.parent) this.root.parent.remove(this.root);
    if (this.fadeMats) { this.fadeMats.body.dispose(); this.fadeMats.outline.dispose(); this.fadeMats = null; }
  }
}

function sideSign(side) { return side === 0 ? 1 : -1; }

// scratch objects
const _t0 = new V3(), _t1 = new V3(), _t2 = new V3(), _t3 = new V3(), _t4 = new V3(), _t5 = new V3(), _t6 = new V3(), _t7 = new V3(), _t8 = new V3(), _t9 = new V3();
const _t10 = new V3(), _t11 = new V3(), _t12 = new V3(), _t13 = new V3(), _t14 = new V3(), _t15 = new V3(), _t16 = new V3(), _t17 = new V3(), _t18 = new V3(), _t19 = new V3(), _t20 = new V3(), _t21 = new V3();
const _tw = new V3(), _tw2 = new V3(), _tw3 = new V3(), _pl = new V3(), _il = new V3(), _g0 = new V3(), _g1 = new V3(), _dir = new V3(), _c0 = new V3();
const _q0 = new Q(), _eu = new EU(), _mi = new THREE.Matrix4();
