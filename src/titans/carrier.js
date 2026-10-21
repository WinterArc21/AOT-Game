// The Struggle for Trost: Eren's titan and the boulder. A Titan with Eren's design that the mission (src/gate.js)
// takes through the anime's beats: emerges in a lightning strike, goes berserk (swings at Mikasa, hits his own face),
// slumps against the boulder, wakes, lifts it onto his shoulders, carries it bent under the weight to the breach,
// slams it into the gate and collapses, steaming. It is not in TitanManager.titans, so nothing targets, cuts or
// spots it; titans in state 'maul' go for it (titan.js _thinkEscort). Its body and the boulder are plain hookable
// shapes: you can rope onto him and ride along.
import * as THREE from 'three';
import { Titan } from './titan.js';
import { toonMaterial, addOutline } from '../core/style.js';

const V3 = THREE.Vector3;
export const BOULDER_R = 7.2;                 // the boulder is as big as he is (~14 m across)
const R = BOULDER_R;
// in the gate's town mouth (the tunnel is x ∈ ±8, y ∈ 0..20, z ∈ ±6): wedged in, ~19 m across
const SEAT = new V3(0, 9.2, -4.6), SEAT_SCALE = 1.32;
const T = { emerge: 1.8, berserk: 4.2, lift: 3.4, heave: 1.9 };
const ERE = { build: 'muscular', skin: 'tan', hair: 0, expr: 'eren' };
const _t = new V3(), _a = new V3(), _b = new V3(), _q = new THREE.Quaternion(), UP = new V3(0, 1, 0);
const sm = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

/** The boulder: a lumpy toon rock with a hookable collider that rides on it. */
export class Boulder {
  constructor(game, position) {
    this.game = game;
    const g = new THREE.IcosahedronGeometry(R, 3);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      _t.fromBufferAttribute(p, i);
      const n = Math.sin(_t.x * 0.9 + 1.3) * Math.sin(_t.y * 0.7 + 0.4) * Math.sin(_t.z * 0.8 + 2.1);
      _t.multiplyScalar(1 + 0.09 * n + 0.04 * Math.sin(_t.x * 2.3 + _t.z * 1.7));
      _t.y *= 0.92;
      p.setXYZ(i, _t.x, _t.y, _t.z);
    }
    g.computeVertexNormals();
    this.mesh = new THREE.Mesh(g, toonMaterial(0x9a9184));
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    addOutline(this.mesh, 0.12);
    game.titans.group.add(this.mesh);
    this.mesh.position.copy(position);
    this.mesh.updateMatrixWorld(true);
    this.col = game.collision.addSphere({ center: new V3(), radius: R * 0.95, object3D: this.mesh, dynamic: true, material: 'stone' });
    this.vel = new V3();
  }
  get position() { return this.mesh.position; }
  /** Seated in the gate for good: a static shape the full size of it. */
  seat() {
    const col = this.game.collision;
    col.remove(this.col);
    this.col = col.addSphere({ center: SEAT.clone(), radius: R * SEAT_SCALE * 0.95, material: 'stone' });
  }
  dispose() {
    if (this.col) this.game.collision.remove(this.col);
    this.col = null;
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
  }
}

export class Carrier extends Titan {
  /** o: { position, yaw, boulder: Boulder, goalZ } */
  constructor(mgr, o) {
    super(mgr, { kind: 'normal', height: 15, position: o.position, yaw: o.yaw ?? 0, spec: ERE });
    this.carrier = true;
    this.name = 'Eren';
    this.hpMax = 100; this.hp = 100;
    this.goalZ = o.goalZ ?? -19;
    this.boulder = o.boulder;
    this.rest = this.boulder.position.clone();
    this.phase = 'emerge'; this.phaseT = 0;
    this.mauled = 0; this.blocked = false;
    this.walkSpeed *= 0.8;                    // heavy: the boulder bends him double
    this.punchAt = new V3();
    for (const c of this.colliders) delete c.userData.titan;   // not a titan as far as ropes are concerned
    this.root.traverse((c) => { if (c.isMesh) delete c.userData.titan; });
    mgr.group.add(this.root);
  }

  /** Titans can hurt him (and his health matters) in these phases. */
  get vulnerable() { return this.phase === 'down' || this.phase === 'lift' || this.phase === 'walk' || this.phase === 'done'; }
  get progress() { return THREE.MathUtils.clamp((this.position.z - this.startZ) / (this.goalZ - this.startZ), 0, 1); }

  setPhase(p) {
    this.phase = p; this.phaseT = 0;
    this.crippleT = p === 'down' || p === 'done' || p === 'fallen' ? 1e6 : 0;   // kneels (titan.js _poseKneel)
    if (p === 'lift') this.liftFrom = this.boulder.position.clone();
    if (p === 'walk' && this.startZ === undefined) this.startZ = this.position.z;
    if (p === 'heave') this.heaveFrom = this.boulder.position.clone();
    if (p === 'fallen') this.boulder.vel.set(Math.sin(this.yaw) * 5, 3, Math.cos(this.yaw) * 5);
    this.game.events?.emit?.('carrier:' + p, { carrier: this });
  }

  /** A titan's blow (titan.js 'maul'). */
  hurt(damage, by) {
    if (!this.vulnerable) return;
    this.hp = Math.max(0, this.hp - damage);
    this.flinch = 1;
    this.game.fx?.blood?.(this._jpos('spine', _t), _a.set(0, 1, 0), 1.2);
    if (this.rnd() < 0.4) this.game.audio?.titanGroan?.(this.position, this.height);
    this.game.events?.emit?.('carrier:hurt', { carrier: this, by, damage });
    if (this.hp <= 0) this.setPhase('fallen');
  }

  roar() {
    this.roarT = 1.6;
    this.game.audio?.titanGroan?.(this.position, 40);
    this.game.events?.emit?.('titan:step', { position: this.position.clone(), size: 26 });
  }

  _sense() { this.hasPlayer = false; this.distH = this.dist3 = Infinity; }
  _updateThreat() { this.threat = 0; }

  _think(dt) {
    this.stateT += dt; this.phaseT += dt;
    this.speedTarget = 0; this.goal = null; this.faceYaw = null;
    this.state = 'idle';
    this.roarT = Math.max(0, (this.roarT || 0) - dt);
    this.mauled = 0;
    for (const t of this.mgr.titans) if (t.alive && t.state === 'maul' && t.mauling) this.mauled++;
    this.gazeTarget = null;
    const ph = this.phase;
    if (ph === 'emerge' && this.phaseT > T.emerge) { this.roar(); this.setPhase('berserk'); }
    else if (ph === 'berserk') {
      this.faceYaw = Math.atan2(this.punchAt.x - this.position.x, this.punchAt.z - this.position.z);
      this.gazeTarget = this.punchAt;
      if (this.phaseT > T.berserk) this.setPhase('down');
    } else if (ph === 'lift' && this.phaseT > T.lift) { this.roar(); this.setPhase('walk'); }
    else if (ph === 'walk') {
      if (this.position.z >= this.goalZ) { this.setPhase('heave'); return; }
      // a titan in his way, or on him: he can't push on
      this.blocked = false;
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      for (const t of this.mgr.titans) {
        if (!t.alive) continue;
        const dx = t.position.x - this.position.x, dz = t.position.z - this.position.z, d = Math.hypot(dx, dz);
        if (d < this.footR + t.footR + 7 && (dx * fx + dz * fz) > d * 0.6) { this.blocked = true; break; }
      }
      this.faceYaw = 0;
      if (this.mauled > 0 || this.blocked) return;
      this.goal = _t.set(0, 0, this.goalZ + 5);
      this.speedTarget = this.walkSpeed;
    } else if (ph === 'heave' && this.phaseT > T.heave) {
      this.boulder.seat();
      this.setPhase('done');
      this.game.events?.emit?.('carrier:sealed', { carrier: this });
    }
  }

  _poseState() {
    const P = this.P, ph = this.phase, u = this.phaseT;
    if (this.roarT > 0) { this.jawExtra += 0.55 * Math.min(1, this.roarT * 2); P.head[0] -= 0.35 * Math.min(1, this.roarT * 2); P.spine[0] -= 0.12; }
    if (ph === 'emerge') { P.spine[0] -= 0.15 * sm(u / T.emerge); return; }
    if (ph === 'berserk') {
      // a haymaker at Mikasa, then his own fist into his face; he reels
      if (u > 0.5 && u < 1.6) {
        const k = sm((u - 0.5) / 0.35) * (1 - sm((u - 1.25) / 0.35));
        this._jpos('armR', _a); _t.lerpVectors(_a, this.punchAt, 0.85 * k + 0.1);
        this._arm(1, _t, this._pole(1, 0.6, -0.3, -0.5), 22);
        P.spine[1] -= 0.45 * k; P.spine[0] += 0.2 * k;
      }
      if (u > 2.3 && u < 3.3) {
        const k = sm((u - 2.3) / 0.2) * (1 - sm((u - 3.0) / 0.3));
        this._headWorld(_t).addScaledVector(_a.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)), this.d.rz * this.s * 1.1);
        this._arm(0, _t, this._pole(0, 0.9, -0.2, 0.2), 26);
        P.head[2] += 0.5 * k; P.head[0] -= 0.3 * k; P.spine[2] += 0.15 * k;
      }
      if (u > 3.0) { const k = sm((u - 3.0) / 1.0); P.spine[0] += 0.4 * k; P.head[0] += 0.4 * k; }
      return;
    }
    if (ph === 'down' || ph === 'fallen') {      // slumped on his knees against the boulder, head hanging
      P.spine[0] += 0.55; P.neck[0] += 0.3; P.head[0] += 0.45; P.armL[2] += 0.25; P.armR[2] -= 0.25;
      return;
    }
    if (ph === 'done') {                          // collapsed forward onto the boulder, spent
      P.spine[0] += 0.75; P.head[0] += 0.3;
      this._hands(0.7, 0.2);
      return;
    }
    // lift / walk / heave: hands on the boulder, bent under it
    const lean = ph === 'lift' ? 0.6 - 0.32 * sm(u / T.lift) : ph === 'heave' ? 0.28 + 0.4 * sm(u / T.heave) : 0.28;
    P.spine[0] += lean; P.head[0] -= lean * 0.6;  // head up: he looks where he's going
    P.thighL[2] += 0.07; P.thighR[2] -= 0.07;
    if (ph === 'walk' && (this.mauled || this.blocked)) P.spine[2] += 0.1 * Math.sin(this.t * 7);
    this._hands(0.82, -0.3);
  }

  /** Both hands on the boulder's sides: `side` of the radius out to each side, `up` of it above/below the centre. */
  _hands(side, up) {
    const b = this.boulder.mesh, r = R * b.scale.x;
    const lx = Math.cos(this.yaw), lz = -Math.sin(this.yaw);   // his left in world
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      _t.set(b.position.x + lx * s * r * side + fx * r * 0.3, b.position.y + r * up, b.position.z + lz * s * r * side + fz * r * 0.3);
      this._arm(i, _t, this._pole(i, 1, -0.4, -0.2), 16);
    }
  }

  update(dt) {
    super.update(dt);
    if (this.dead) return;
    dt = Math.min(dt, 0.05);
    // other titans can't walk through him
    const pos = this.position;
    for (const o of this.mgr.titans) {
      if (!o.alive || o.airborne) continue;
      const dx = o.position.x - pos.x, dz = o.position.z - pos.z, md = (this.footR + o.footR) * 1.3, d2 = dx * dx + dz * dz;
      if (d2 < md * md && d2 > 1e-6) { const d = Math.sqrt(d2); o.position.x += dx / d * (md - d); o.position.z += dz / d * (md - d); }
    }
    if (this.phase === 'emerge' || this.phase === 'done') {
      this.steamT = (this.steamT || 0) - dt;
      if (this.steamT <= 0) { this.steamT = 0.35; this.game.fx?.steam?.(this._jpos('neck', _t), this.phase === 'done' ? 5 : 7, 3); }
    }
    this._placeBoulder(dt);
    this.boulder.mesh.updateMatrixWorld(true);
  }

  /** Where the boulder rides on his shoulders: above and behind them, following his lean. */
  _carryPos(out) {
    this._jpos('armL', _a); this._jpos('armR', _b);
    out.addVectors(_a, _b).multiplyScalar(0.5);
    return out.addScaledVector(UP, R * 0.62).addScaledVector(_a.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)), -R * 0.42);
  }

  _placeBoulder(dt) {
    const b = this.boulder.mesh, ph = this.phase, u = this.phaseT;
    if (ph === 'lift') {
      const e = sm(u / T.lift);
      b.position.lerpVectors(this.liftFrom, this._carryPos(_t), e);
      b.quaternion.multiply(_q.setFromAxisAngle(_a.set(1, 0, 0), dt * 0.3));
    } else if (ph === 'walk') {
      b.position.lerp(this._carryPos(_t), 1 - Math.exp(-12 * dt));
    } else if (ph === 'heave') {
      // forward off his shoulders, down into the breach
      const e = sm(u / T.heave);
      b.position.lerpVectors(this.heaveFrom, SEAT, e);
      b.position.y += Math.sin(e * Math.PI) * 3;
      b.scale.setScalar(1 + (SEAT_SCALE - 1) * e);
      b.quaternion.multiply(_q.setFromAxisAngle(_a.set(1, 0, 0), dt * 0.8));
    } else if (ph === 'fallen' && this.liftFrom) {
      // it rolls off his shoulders and comes to rest in the street
      const bv = this.boulder.vel, gy = this._ground(b.position.x, b.position.z) + R * 0.9;
      if (b.position.y > gy || bv.y > 0) {
        bv.y -= 14.5 * dt;
        b.position.addScaledVector(bv, dt);
        if (b.position.y <= gy) {
          b.position.y = gy; bv.set(0, 0, 0);
          this.game.events?.emit?.('titan:step', { position: b.position.clone(), size: 30 });
          this.game.fx?.impact?.(b.position.clone(), _a.set(0, 1, 0), 'ground');
        }
      }
    }
  }
}
