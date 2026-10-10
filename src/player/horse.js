// Survey Corps horses: grazing near the gate, across the field and at the forest edge. Run onto one to mount
// it: you ride seated; hold Shift to stand up on its back, let go to leap off with its speed; Z / X stand and
// fire a rope straight off the running horse. A riderless horse grazes, ambles, and bolts from titans.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMaterial, addOutline } from '../core/style.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _c = new THREE.Color();
const COATS = [0x6b4428, 0x3e2a1c, 0x8c5a30, 0x2b2420, 0xa98c6a, 0x5a3a24];
const SPEED = { walk: 1.8, trot: 5, gallop: 19 };
const TAU = Math.PI * 2;

// one vertex-coloured piece, positioned/rotated/scaled, ready to merge
function piece(geo, color, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = {}) {
  const g = geo.toNonIndexed();
  g.deleteAttribute('uv');
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s)));
  _c.setHex(color);
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
const MAT = () => toonMaterial(0xffffff, { vertexColors: true });
let _mat = null;
function mesh(parts, parent, outline = 0) {
  const m = new THREE.Mesh(mergeGeometries(parts), _mat || (_mat = MAT()));
  m.castShadow = true;
  if (outline) addOutline(m, outline);
  parent.add(m);
  return m;
}

export class Horse {
  constructor(game, pos, yaw, seed) {
    this.game = game;
    this.pos = pos.clone(); this.home = pos.clone();
    this.vel = new THREE.Vector3();
    this.yaw = yaw; this.speed = 0; this.phase = seed * 7; this.bob = 0;
    this.rider = null; this.want = { f: 0, turn: 0 };
    this.state = 'graze'; this.t = seed * 3; this.mountCd = 0; this.crashed = 0;
    const coat = COATS[Math.floor(seed * 97) % COATS.length];
    const dark = 0x1c1511, leather = 0x4a2e1a, hoof = 0x1a1612, sock = Math.floor(seed * 13) % 3 === 0 ? 0xe8e0d0 : coat;
    const g = this.root = new THREE.Group();

    // body: barrel, deep chest, rounded rump (higher), withers, saddle and pad
    this.trunk = new THREE.Group(); this.trunk.position.y = 1.32; g.add(this.trunk);
    mesh([
      piece(new THREE.CapsuleGeometry(0.4, 1.05, 6, 14), coat, { r: [Math.PI / 2, 0, 0], s: [0.92, 1.12, 1] }),
      piece(new THREE.SphereGeometry(0.46, 14, 10), coat, { p: [0, 0.05, 0.62], s: [0.9, 1.08, 0.95] }),        // chest
      piece(new THREE.SphereGeometry(0.47, 14, 10), coat, { p: [0, 0.1, -0.68], s: [0.95, 1.0, 1.0] }),          // rump
      piece(new THREE.SphereGeometry(0.22, 10, 8), coat, { p: [0, 0.42, 0.55], s: [0.8, 0.8, 1.4] }),           // withers
      piece(new THREE.BoxGeometry(0.66, 0.06, 0.78), 0x2e4a2e, { p: [0, 0.47, -0.02] }),                          // green saddle pad
      piece(new THREE.CylinderGeometry(0.3, 0.32, 0.62, 12, 1, false, 0, Math.PI), leather, { p: [0, 0.48, -0.04], r: [Math.PI / 2, 0, Math.PI / 2], s: [1, 1, 0.45] }),
      piece(new THREE.BoxGeometry(0.08, 0.2, 0.12), leather, { p: [0, 0.6, 0.24] }),                              // pommel
      piece(new THREE.BoxGeometry(0.06, 0.62, 0.06), leather, { p: [0.36, 0.12, 0], r: [0, 0, 0.05] }),          // girth L
      piece(new THREE.BoxGeometry(0.06, 0.62, 0.06), leather, { p: [-0.36, 0.12, 0], r: [0, 0, -0.05] }),        // girth R
    ], this.trunk, 0.02);

    // neck (arched, thick at the base) + head with a long muzzle, ears, mane, forelock, bridle
    this.neck = new THREE.Group(); this.neck.position.set(0, 0.3, 0.78); this.neck.rotation.x = 0.72; this.trunk.add(this.neck);
    mesh([
      piece(new THREE.CylinderGeometry(0.17, 0.33, 0.95, 12), coat, { p: [0, 0.42, 0], s: [0.8, 1, 1.15] }),
      piece(new THREE.BoxGeometry(0.07, 0.95, 0.16), dark, { p: [0, 0.45, -0.2], r: [0.12, 0, 0] }),              // mane
    ], this.neck, 0.018);
    this.head = new THREE.Group(); this.head.position.set(0, 0.88, 0.02); this.neck.add(this.head);
    mesh([
      // the face runs forward-down from the poll (head frame is tilted 0.72 rad with the neck)
      piece(new THREE.CylinderGeometry(0.15, 0.095, 0.62, 10), coat, { p: [0, -0.02, 0.29], r: [1.64, 0, 0], s: [1, 1, 1.15] }),  // face
      piece(new THREE.SphereGeometry(0.16, 10, 8), coat, { p: [0, 0, 0.02], s: [0.95, 1, 1.1] }),                   // jowl
      piece(new THREE.SphereGeometry(0.105, 8, 6), coat, { p: [0, -0.06, 0.6], s: [1, 0.85, 1.15] }),               // muzzle
      piece(new THREE.ConeGeometry(0.045, 0.17, 5), coat, { p: [0.07, 0.16, -0.06], r: [-0.72, 0, -0.2] }),          // ears
      piece(new THREE.ConeGeometry(0.045, 0.17, 5), coat, { p: [-0.07, 0.16, -0.06], r: [-0.72, 0, 0.2] }),
      piece(new THREE.BoxGeometry(0.05, 0.1, 0.12), dark, { p: [0, 0.12, 0.06] }),                                  // forelock
      piece(new THREE.SphereGeometry(0.03, 6, 4), 0x0c0a08, { p: [0.12, 0.02, 0.12] }),                             // eyes
      piece(new THREE.SphereGeometry(0.03, 6, 4), 0x0c0a08, { p: [-0.12, 0.02, 0.12] }),
      piece(new THREE.TorusGeometry(0.115, 0.012, 4, 12), leather, { p: [0, -0.05, 0.47] }),                         // noseband
    ], this.head, 0.014);

    // tail
    this.tail = new THREE.Group(); this.tail.position.set(0, 0.3, -1.08); this.trunk.add(this.tail);
    mesh([piece(new THREE.ConeGeometry(0.12, 0.95, 7), dark, { p: [0, -0.45, -0.05], r: [Math.PI, 0, 0] })], this.tail);

    // legs: forearm/gaskin + cannon, knee/hock, fetlock and hoof; hind legs carry the backward hock angle
    this.legs = [];
    for (const [x, z, front] of [[-0.24, 0.62, 1], [0.24, 0.62, 1], [-0.25, -0.72, 0], [0.25, -0.72, 0]]) {
      const hip = new THREE.Group(); hip.position.set(x, front ? 1.1 : 1.26, z); g.add(hip);
      mesh([
        piece(new THREE.CylinderGeometry(front ? 0.1 : 0.15, 0.075, front ? 0.55 : 0.62, 8), coat, { p: [0, front ? -0.27 : -0.3, front ? 0 : 0.06], r: [front ? 0 : -0.25, 0, 0] }),
      ], hip);
      const knee = new THREE.Group(); knee.position.set(0, front ? -0.55 : -0.6, front ? 0 : 0.14); hip.add(knee);
      mesh([
        piece(new THREE.CylinderGeometry(0.055, 0.05, 0.5, 7), sock, { p: [0, -0.25, 0], r: [front ? 0 : 0.18, 0, 0] }),
        piece(new THREE.SphereGeometry(0.065, 7, 5), sock, { p: [0, -0.5, front ? 0 : -0.09] }),                    // fetlock
        piece(new THREE.CylinderGeometry(0.06, 0.08, 0.1, 8), hoof, { p: [0, -0.58, front ? 0.02 : -0.07] }),
      ], knee);
      this.legs.push({ hip, knee, front, side: x < 0 ? 0 : 1 });
    }
    game.scene.add(g);
  }

  /** The rider's collision-centre position: seated in the saddle (stand = 0) or standing on it (stand = 1). */
  saddle(out, stand = 0) {
    return out.set(0, 1.5 + this.bob + stand * 0.86, -0.08)
      .applyAxisAngle(_w.set(0, 0, 1), this.lean || 0)          // the saddle tilts with the horse's bank
      .applyAxisAngle(_w.set(0, 1, 0), this.yaw).add(this.pos);
  }
  /** The horse's up vector (banked), for the rider. */
  up(out) { return out.set(0, 1, 0).applyAxisAngle(_w.set(0, 0, 1), this.lean || 0).applyAxisAngle(_w.set(0, 1, 0), this.yaw); }

  fixedUpdate(dt) {
    const col = this.game.collision;
    this.t += dt; this.mountCd -= dt;
    let target = 0, turn = 0;
    if (this.rider) {
      target = this.want.f > 0 ? SPEED.gallop * (this.speedMul || 1) : this.want.f < 0 ? 0 : Math.max(this.speed - 3 * dt, Math.min(this.speed, SPEED.trot));
      turn = this.want.turn;
    } else {
      let threat = null, td = 45;
      for (const t of this.game.titans?.titans || []) {
        if (!t.alive) continue;
        const d = t.position.distanceTo(this.pos); if (d < td) { td = d; threat = t; }
      }
      if (threat) {
        const away = Math.atan2(this.pos.x - threat.position.x, this.pos.z - threat.position.z);
        turn = -Math.sign(Math.sin(away - this.yaw)); target = SPEED.gallop * 0.8; this.state = 'flee';
      } else {
        if (this.state === 'flee' || this.speed > 3) target = 0;
        if (this.t > 6) { this.t = 0; this.state = Math.random() < 0.45 ? 'walk' : 'graze'; }
        if (this.state === 'walk') {
          target = SPEED.walk;
          const home = Math.atan2(this.home.x - this.pos.x, this.home.z - this.pos.z);
          if (this.pos.distanceTo(this.home) > 25) turn = -Math.sign(Math.sin(home - this.yaw)) * 0.6;
        }
      }
    }
    const accel = target > this.speed ? 6 : 9;
    this.speed += THREE.MathUtils.clamp(target - this.speed, -accel * dt, accel * dt);
    // ease into and out of turns (reins, not a switch); → turns right, the same convention as the player's heading
    this.turnS = (this.turnS || 0) + (turn - (this.turnS || 0)) * Math.min(1, dt * 5);
    this.turnRate = -this.turnS * (1.9 - this.speed * 0.035);
    this.yaw += this.turnRate * dt;
    // bank into the turn like a real horse at speed (centripetal lean), eased
    const leanT = THREE.MathUtils.clamp(-this.turnRate * this.speed * 0.011, -0.2, 0.2);
    this.lean = (this.lean || 0) + (leanT - (this.lean || 0)) * Math.min(1, dt * 4);
    this.vel.set(Math.sin(this.yaw) * this.speed, 0, Math.cos(this.yaw) * this.speed);
    this.pos.addScaledVector(this.vel, dt);
    _v.copy(this.pos); _v.y = col.groundHeight(this.pos.x, this.pos.z) + 1.2;
    for (const c of col.collideSphere(_v, 1.0, { dynamic: false })) {
      if (c.collider.type === 'ground' || c.depth <= 0) continue;
      this.pos.x += c.normal.x * c.depth; this.pos.z += c.normal.z * c.depth;
      const head = -(c.normal.x * Math.sin(this.yaw) + c.normal.z * Math.cos(this.yaw));
      if (this.rider && head > 0.7 && this.speed > 12) this.crashed = this.speed;
      if (this.speed > 6) this.speed *= head > 0.7 ? 0.3 : 0.9;
    }
    this.pos.y = col.groundHeight(this.pos.x, this.pos.z);
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -1050, 1050);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -620, 1020);
    if (this.pos.z > -7 && this.pos.z < 7 && Math.abs(this.pos.x) > 7) this.pos.z = this.pos.z < 0 ? -7 : 7;   // the wall
    // gait phase and the body's rise and fall (the rider moves with it)
    const s = this.speed;
    this.gallop = THREE.MathUtils.smoothstep(s, 6, 12);
    this.phase += dt * (s < 0.2 ? 0 : s < 6 ? 0.55 + s * 0.22 : 1.9 + s * 0.035);
    const P = this.phase * TAU;
    this.bob = this.gallop * 0.11 * Math.sin(P * 1) + (1 - this.gallop) * Math.min(1, s / 4) * 0.035 * Math.sin(P * 2);
  }

  update(dt) {
    const g = this.root, s = this.speed, ga = this.gallop || 0;
    g.position.copy(this.pos);
    g.rotation.y = this.yaw;
    const P = this.phase * TAU;
    // gallop: a transverse four-beat (hind L, hind R, fore L, fore R) with a gathered suspension phase;
    // walk/trot: diagonal pairs
    const offsG = [0.42, 0.52, 0.0, 0.1], offsW = [0.5, 0.0, 0.0, 0.5];
    const amp = Math.min(1, s / 5);
    this.legs.forEach((l, i) => {
      const off = THREE.MathUtils.lerp(offsW[i], offsG[i], ga);
      const ph = P + off * TAU;
      const sw = Math.sin(ph) * amp * (0.32 + ga * 0.38);          // + = reaching forward
      const lift = Math.max(0, Math.cos(ph)) * amp * (0.35 + ga * 0.9); // the leg folds while it swings forward
      l.hip.rotation.x = -sw;
      l.knee.rotation.x = l.front ? lift * 1.2 : -lift * 0.9;        // fore knee folds back, hind hock folds forward
    });
    this.trunk.position.y = 1.32 + this.bob;
    this.trunk.rotation.x = ga * 0.07 * Math.sin(P + 1.2);           // rocking: forehand up, then hindquarters up
    g.rotation.z = this.lean || 0;   // banked into the turn
    const graze = this.state === 'graze' && s < 0.4 && !this.rider;
    const nodT = graze ? 1.85 : 0.72 + ga * (0.18 + 0.12 * Math.sin(P + 2.2)) + (1 - ga) * 0.04 * Math.sin(P * 2);
    this.neck.rotation.x += (nodT - this.neck.rotation.x) * Math.min(1, dt * (graze ? 1.5 : 8));
    this.head.rotation.x = graze ? -0.3 : 0.05 - ga * 0.12;
    this.tail.rotation.x = 0.25 + ga * 0.75 + Math.sin(this.phase * 3.1) * 0.12;
  }
}

/** A few horses near the gate (the Expedition's mounts) and scattered over the field and the forest edge. */
export class Herd {
  constructor(game) {
    this.game = game;
    const spots = [[-14, 22], [14, 26], [0, 34], [-60, 70], [70, 95], [-120, 140], [130, 150], [20, 175]];
    this.horses = spots.map(([x, z], i) => new Horse(game, new THREE.Vector3(x, game.collision.groundHeight(x, z), z), (i * 2.4) % TAU, (i + 1) * 0.137));
  }
  fixedUpdate(dt) { for (const h of this.horses) h.fixedUpdate(dt); }
  update(dt) {
    const cam = this.game.camera.position;
    for (const h of this.horses) {
      const vis = h.pos.distanceToSquared(cam) < 450 * 450;
      h.root.visible = vis;
      if (vis) h.update(dt);
    }
  }
}
