// Plug the Gate: Eren's titan carries the boulder up Trost's main street to the breach. A Titan that walks a fixed
// route with its arms up round the boulder, stops while titans maul it, and heaves the boulder into the gate at the
// end. It is not in TitanManager.titans, so nothing targets, cuts or spots it; its body and the boulder are plain
// hookable shapes, so you can rope onto him and ride along.
import * as THREE from 'three';
import { Titan } from './titan.js';
import { toonMaterial, addOutline } from '../core/style.js';

const V3 = THREE.Vector3;
const R = 6.5;                                // boulder radius while carried (m)
const SEAT = new V3(0, 9.4, -4.5), SEAT_SCALE = 1.6;   // in the gate's town mouth (x ∈ ±8, y ∈ 0..20): wedged in, ~21 m across
const HEAVE = 2.4;                            // s: lifting the boulder off his shoulders and into the gate
const _t = new V3(), _a = new V3(), _q = new THREE.Quaternion();

function boulderMesh() {
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
  const m = new THREE.Mesh(g, toonMaterial(0x9a9184));
  m.castShadow = true; m.receiveShadow = true;
  addOutline(m, 0.12);
  return m;
}

export class Carrier extends Titan {
  constructor(mgr, { position, goalZ = -19 } = {}) {
    super(mgr, { kind: 'normal', height: 15, position, yaw: 0 });
    this.carrier = true;
    this.name = 'Eren';
    this.hpMax = 100; this.hp = 100;
    this.goalZ = goalZ;
    this.phase = 'walk';        // walk → heave → done (sealed) | fallen
    this.mauled = 0;            // titans mauling him this frame
    this.walkSpeed *= 1.05;
    // his body is a plain hookable shape, not a titan: ropes on him don't start the nape swoop
    for (const c of this.colliders) delete c.userData.titan;
    this.root.traverse((c) => { if (c.isMesh) delete c.userData.titan; });
    mgr.group.add(this.root);
    this.boulder = boulderMesh();
    mgr.group.add(this.boulder);
    this.bv = new V3();
    this._placeBoulder();
    this.boulder.updateMatrixWorld(true);
    this.boulderCol = this.game.collision.addSphere({ center: new V3(), radius: R * 0.95, object3D: this.boulder, dynamic: true, material: 'stone' });
  }

  get progress() { return THREE.MathUtils.clamp((this.position.z - this.startZ) / (this.goalZ - this.startZ), 0, 1); }

  /** A titan's blow (titan.js 'maul'). */
  hurt(damage, by) {
    if (this.phase !== 'walk') return;
    this.hp = Math.max(0, this.hp - damage);
    this.flinch = 1;
    this.game.fx?.blood?.(this._jpos('spine', _t), _a.set(0, 1, 0), 1.2);
    if (this.rnd() < 0.4) this.game.audio?.titanGroan?.(this.position, this.height);
    this.game.events?.emit?.('carrier:hurt', { carrier: this, by, damage });
    if (this.hp <= 0) {
      this.phase = 'fallen'; this.crippleT = 1e6; this.stateT = 0;
      this.bv.set(Math.sin(this.yaw) * 4, 2, Math.cos(this.yaw) * 4);
      this.game.events?.emit?.('carrier:fallen', { carrier: this });
    }
  }

  _sense() { this.hasPlayer = false; this.distH = this.dist3 = Infinity; }
  _updateThreat() { this.threat = 0; }

  _think(dt) {
    this.stateT += dt;
    this.speedTarget = 0; this.goal = null; this.faceYaw = 0;
    this.state = 'idle';
    this.mauled = 0;
    for (const t of this.mgr.titans) if (t.alive && t.state === 'maul' && t.mauling) this.mauled++;
    this.gazeTarget = _a.set(0, 12, 0);
    if (this.phase === 'walk') {
      if (this.startZ === undefined) this.startZ = this.position.z;
      if (this.position.z >= this.goalZ) { this.phase = 'heave'; this.stateT = 0; this.heaveFrom = this.boulder.position.clone(); this.game.events?.emit?.('carrier:heave', { carrier: this }); return; }
      if (this.mauled > 0) { this.gazeTarget = null; return; }   // pinned: he can't walk with titans on him
      this.goal = _t.set(0, 0, this.goalZ + 5);
      this.speedTarget = this.walkSpeed;
    }
  }

  _poseState() {
    const P = this.P, sg = (i) => (i === 0 ? 1 : -1);
    if (this.phase === 'fallen') return;          // kneels (crippleT), the boulder rolls off
    const lift = this.phase === 'heave' ? Math.min(1, this.stateT / (HEAVE * 0.45)) : 0;
    if (this.phase === 'done' && this.stateT > 0.6) { P.spine[0] += 0.5; P.head[0] += 0.3; return; }   // spent
    // under the weight: a forward lean, braced legs; in the heave he straightens and shoves it ahead
    P.spine[0] += 0.12 - 0.3 * lift; P.thighL[2] += 0.06; P.thighR[2] -= 0.06;
    if (this.phase === 'walk' && this.mauled) { P.spine[2] += 0.1 * Math.sin(this.t * 7); }
    const b = this.boulder, r = R * b.scale.x;
    const lx = Math.cos(this.yaw), lz = -Math.sin(this.yaw);   // his left in world
    for (let i = 0; i < 2; i++) {
      _t.set(b.position.x + lx * sg(i) * r * 0.8, b.position.y - r * 0.45, b.position.z + lz * sg(i) * r * 0.8);
      this._arm(i, _t, this._pole(i, 1, -0.5, -0.3), 18);
    }
  }

  update(dt) {
    super.update(dt);
    if (this.dead) return;
    // other titans can't walk through him
    const pos = this.position;
    for (const o of this.mgr.titans) {
      if (!o.alive || o.airborne) continue;
      const dx = o.position.x - pos.x, dz = o.position.z - pos.z, md = (this.footR + o.footR) * 1.3, d2 = dx * dx + dz * dz;
      if (d2 < md * md && d2 > 1e-6) { const d = Math.sqrt(d2); o.position.x += dx / d * (md - d); o.position.z += dz / d * (md - d); }
    }
    this._placeBoulder(Math.min(dt, 0.05));
    this.boulder.updateMatrixWorld(true);
  }

  _placeBoulder(dt = 0) {
    const b = this.boulder;
    if (this.phase === 'walk') {
      // on his raised hands above and a little behind the head, bobbing with his steps
      const bob = Math.abs(Math.sin(this.gait || 0)) * 0.25;
      this._fp(0, this.height + R * 0.55 - bob, -1.2, b.position);
      b.quaternion.setFromAxisAngle(_a.set(0, 1, 0), this.yaw);
      return;
    }
    if (this.phase === 'heave') {
      const u = Math.min(1, this.stateT / HEAVE), e = u * u * (3 - 2 * u);
      b.position.lerpVectors(this.heaveFrom, SEAT, e);
      b.position.y += Math.sin(u * Math.PI) * 4;
      b.scale.setScalar(1 + (SEAT_SCALE - 1) * e);
      b.quaternion.multiply(_q.setFromAxisAngle(_a.set(1, 0, 0), dt * 0.4));
      if (u >= 1) {
        this.phase = 'done'; this.stateT = 0;
        // wedged for good: a static shape the full size of the seated boulder
        const col = this.game.collision;
        col.remove(this.boulderCol);
        this.boulderCol = col.addSphere({ center: SEAT.clone(), radius: R * SEAT_SCALE * 0.95, material: 'stone' });
        this.game.events?.emit?.('carrier:sealed', { carrier: this });
      }
      return;
    }
    if (this.phase === 'fallen') {
      // it rolls off his shoulders and comes to rest in the street
      const gy = this._ground(b.position.x, b.position.z) + R * 0.92;
      if (b.position.y > gy || this.bv.y > 0) {
        this.bv.y -= 14.5 * dt;
        b.position.addScaledVector(this.bv, dt);
        if (b.position.y <= gy) { b.position.y = gy; this.bv.set(0, 0, 0); this.game.events?.emit?.('titan:step', { position: b.position.clone(), size: 30 }); this.game.fx?.impact?.(b.position.clone(), _a.set(0, 1, 0), 'ground'); }
      }
    }
  }

  dispose() {
    super.dispose();
    if (this.boulderCol) this.game.collision.remove(this.boulderCol);
    this.boulderCol = null;
    this.boulder.parent?.remove(this.boulder);
    this.boulder.geometry.dispose();
  }
}
