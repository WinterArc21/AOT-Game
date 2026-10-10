// Omni-directional mobility gear: two gas-fired anchors on steel wires, each wound by a gas-driven reel.
// The wire is a one-sided distance constraint (it can go slack, never stretch); the reel winds in slack
// instantly and pulls with a torque-limited motor. Tangential speed is untouched by the wire, so swings
// conserve momentum and a shortening wire spins you up (angular momentum) — the anime's slingshot arcs.
import * as THREE from 'three';
import { CFG } from '../config.js';

const _d = new THREE.Vector3(), _t = new THREE.Vector3();

export class Hook {
  constructor(side) {
    this.side = side;               // 0 left, 1 right
    this.state = 'idle';            // idle | flying | attached | retracting
    this.tip = new THREE.Vector3(); // anchor head position (world)
    this.dir = new THREE.Vector3();
    this.anchor = new THREE.Vector3();
    this.local = new THREE.Vector3();
    this.collider = null;
    this.length = 0;                // current wire length (max distance)
    this.payout = 0;                // m/s this wire may run out under tension (0 = reel normally)
    this.travelled = 0;
    this.age = 0;
    this.normal = new THREE.Vector3();
  }
  get attached() { return this.state === 'attached'; }
}

export class OdmGear {
  constructor(game, player) {
    this.game = game;
    this.player = player;
    this.hooks = [new Hook(0), new Hook(1)];
    this.gas = 1;
    this.reelLevel = 0;
    this.wires = this.hooks.map(() => new Wire(game.scene));
  }

  reset() {
    for (const h of this.hooks) { h.state = 'idle'; h.collider = null; }
    this.gas = 1;
  }

  /** Fire one anchor from `origin` toward `target` (or along `dir` if no target). */
  fire(side, origin, target, fallbackDir) {
    const h = this.hooks[side];
    if (h.state === 'flying' || h.state === 'attached') return false;
    if (this.player.infiniteGas !== true) {
      if (this.gas <= 0) { this.player.silent || this.game.audio?.hookMiss?.(); return false; }
      this.gas = Math.max(0, this.gas - CFG.gas.fireCost);
    }
    h.state = 'flying';
    h.tip.copy(origin);
    if (target) h.dir.subVectors(target, origin).normalize(); else h.dir.copy(fallbackDir);
    h.travelled = 0; h.age = 0; h.collider = null;
    if (!this.player.silent) this.game.audio?.hookFire?.(side);
    return true;
  }

  release(side, silent) {
    const h = this.hooks[side];
    h.yank = null;
    if (h.state === 'flying' || h.state === 'attached') {
      h.state = 'retracting';
      h.collider = null;
      if (!silent && !this.player.silent) this.game.audio?.hookRetract?.(side);
    }
  }
  releaseAll(silent) { this.release(0, silent); this.release(1, silent); }

  attachedCount() { return (this.hooks[0].attached ? 1 : 0) + (this.hooks[1].attached ? 1 : 0); }

  /** Advance anchor heads and follow anchors on moving bodies. */
  step(dt, origins) {
    const col = this.game.collision;
    for (const h of this.hooks) {
      h.age += dt;
      if (h.state === 'flying') {
        const step = CFG.hook.speed * dt;
        const hit = col.raycast(h.tip, h.dir, step, { hookableOnly: true });
        if (hit) {
          h.state = 'attached';
          h.collider = hit.collider;
          h.anchor.copy(hit.point);
          h.normal.copy(hit.normal);
          if (hit.collider.dynamic) col.toLocal(hit.collider, hit.point, h.local);
          h.length = Math.max(CFG.hook.minLen, h.anchor.distanceTo(this.player.pos));
          h.tip.copy(hit.point);
          if (!this.player.silent) this.game.audio?.hookHit?.(hit.collider.material);
          this.game.fx?.impact?.(hit.point, hit.normal, hit.collider.material);
          this.game.events.emit('hook:attach', { hook: h, hit });
        } else {
          h.tip.addScaledVector(h.dir, step);
          h.travelled += step;
          if (h.travelled > CFG.hook.range) { h.state = 'retracting'; if (!this.player.silent) this.game.audio?.hookMiss?.(); }
        }
      } else if (h.state === 'attached') {
        const c = h.collider;
        const y = h.yank;
        if (y && (!y.alive || y.state !== 'yank' || y.severed?.[h.yankSide] > 0)) h.yank = null;   // it let go
        if (h.yank) { h.anchor.setFromMatrixPosition(y.J[h.yankSide === 0 ? 'handL' : 'handR'].matrixWorld); h.tip.copy(h.anchor); continue; }
        if (c && c.dynamic) {
          if (!col.dynamics.includes(c)) { h.state = 'retracting'; h.collider = null; continue; }
          col.toWorld(c, h.local, h.anchor);
        }
        h.tip.copy(h.anchor);
      } else if (h.state === 'retracting') {
        const o = origins[h.side];
        _d.subVectors(o, h.tip);
        const l = _d.length(), s = CFG.hook.retract * dt;
        if (l <= s) { h.state = 'idle'; h.tip.copy(o); } else h.tip.addScaledVector(_d, s / l);
      } else {
        h.tip.copy(origins[h.side]);
      }
    }
  }

  /**
   * Winch acceleration toward the anchors (added to `acc`). Returns the reel level 0..1 for audio.
   * The motor's pull tapers as the inward speed approaches its limit (a torque curve, not a teleport).
   */
  reelAccel(pos, vel, boosting, acc) {
    const n = this.attachedCount();
    if (!n) return 0;
    const share = n === 2 ? CFG.reel.twinShare : 1;
    const A = boosting ? CFG.reel.boostAccel : CFG.reel.accel;
    const cap = boosting ? CFG.reel.boostMaxIn : CFG.reel.maxIn;
    let level = 0;
    this.braking = Math.max(0, (this.braking || 0) - 1 / CFG.physicsHz);
    for (const h of this.hooks) {
      if (!h.attached || h.payout > 0 || h.yank) continue;   // a titan has hold of this wire
      _d.subVectors(h.anchor, pos);
      const dist = _d.length();
      if (dist < CFG.hook.minLen + 0.2) continue;
      _d.multiplyScalar(1 / dist);
      const vin = vel.dot(_d);
      const torque = THREE.MathUtils.clamp((cap - vin) / (cap * 0.35), 0, 1);
      const nearFade = THREE.MathUtils.clamp((dist - CFG.hook.minLen) / CFG.reel.near, 0.12, 1);
      const a = A * torque * nearFade * share;
      acc.addScaledVector(_d, a);
      // head-on arrival: front gas vents bleed off closing speed so you land on the trunk/wall instead of
      // splattering on it (sideways passes are untouched, so swings and slingshots keep their speed)
      const allowed = CFG.reel.arrive + Math.sqrt(2 * CFG.reel.brake * Math.max(0, dist - CFG.hook.minLen - 1));
      const speed = vel.length();
      // no gentle arrival on a titan: you are meant to arrive fast and cut
      const onTitan = !!(h.collider?.userData?.titan || h.collider?.userData?.dummy);
      if (!onTitan && vin > allowed && vin > 0.6 * speed) {
        acc.addScaledVector(_d, -Math.min(CFG.reel.brakeMax, (vin - allowed) * 10) * share);
        this.braking = 0.15;
      }
      level = Math.max(level, torque * nearFade * (boosting ? 1 : 0.55));
    }
    return level;
  }

  /**
   * Wire constraints (position-based): never farther than `length`; removes outward velocity
   * (inelastic) so swings keep their tangential speed. The reel then takes in any slack.
   */
  constrain(pos, vel, dt = 1 / 120) {
    // payout > 0 (↓ held on a rope): a brake-reel. Under tension the wire runs out at up to `payout` m/s,
    // so the outward speed is kept up to that limit and the wire lengthens with it; no slack is taken up.
    const G = this.payout || 0;
    let any = G > 0;
    for (const h of this.hooks) {
      h._keep = 0;
      const P = Math.max(G, h.payout || 0);
      if (P > 0) any = true;
      if (!h.attached || P <= 0) continue;
      _d.subVectors(pos, h.anchor);
      const dist = _d.length();
      if (dist < 1e-6 || dist < h.length - 0.05) continue;
      const vout = vel.dot(_d.multiplyScalar(1 / dist));
      if (vout > 0) { h._keep = Math.min(vout, P); h.length = Math.min(CFG.hook.range, h.length + h._keep * dt); }
    }
    for (let it = 0; it < 2; it++) {
      for (const h of this.hooks) {
        if (!h.attached) continue;
        _d.subVectors(pos, h.anchor);
        const dist = _d.length();
        if (dist <= h.length || dist < 1e-6) continue;
        _d.multiplyScalar(1 / dist);
        pos.copy(h.anchor).addScaledVector(_d, h.length);
        const vo = vel.dot(_d) - h._keep;
        if (vo > 0) {
          // a slack wire snapping taut stretches a little and kicks back (the steel wire's spring)
          const e = vo > CFG.wire.snapSpeed ? CFG.wire.rebound : 0;
          vel.addScaledVector(_d, -vo * (1 + e));
          if (vo > CFG.wire.snapSpeed) this.snap = Math.max(this.snap || 0, vo);
        }
      }
    }
    for (const h of this.hooks) {
      if (!h.attached || G > 0 || h.payout > 0) continue;
      const dist = pos.distanceTo(h.anchor);
      h.length = Math.max(CFG.hook.minLen, Math.min(h.length, dist));
    }
  }

  /** Average direction of the anchored wires from pos (unit), or null. */
  pullDir(pos, out) {
    out.set(0, 0, 0);
    let n = 0;
    for (const h of this.hooks) if (h.attached) { out.add(_t.subVectors(h.anchor, pos).normalize()); n++; }
    if (!n) return null;
    return out.normalize();
  }

  /** Visual wires from the hip launchers to the anchor heads. */
  render(origins, camera, time) {
    for (let i = 0; i < 2; i++) {
      const h = this.hooks[i];
      const w = this.wires[i];
      if (h.state === 'idle') { w.mesh.visible = false; continue; }
      const wobble = h.state === 'flying' ? 0.6 : h.state === 'retracting' ? 1.2 : 0;
      // a slack wire hangs: sag grows with the slack (√(slack·length), a shallow catenary)
      let sag = 0;
      if (h.attached) { const slack = h.length - origins[i].distanceTo(h.anchor); if (slack > 0.05) sag = Math.min(6, Math.sqrt(slack * h.length) * 0.45); }
      w.update(origins[i], h.tip, camera, wobble, time + i * 1.7, sag);
    }
  }
}

/** Camera-facing ribbon with optional travelling wave (for a wire in flight / winding back). */
class Wire {
  constructor(scene) {
    this.N = 24;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array((this.N + 1) * 2 * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < this.N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x2a2826, side: THREE.DoubleSide, fog: true }));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this._a = new THREE.Vector3(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(); this._side = new THREE.Vector3(); this._perp = new THREE.Vector3();
  }
  update(a, b, camera, wobble, time, sag = 0) {
    this.mesh.visible = true;
    const dir = this._a.subVectors(b, a);
    const len = dir.length() || 1e-4;
    dir.multiplyScalar(1 / len);
    const perp = this._perp.set(0, 1, 0).cross(dir);
    if (perp.lengthSq() < 1e-6) perp.set(1, 0, 0); perp.normalize();
    const cam = camera.position;
    for (let i = 0; i <= this.N; i++) {
      const t = i / this.N;
      const p = this._p.copy(a).addScaledVector(dir, len * t);
      if (sag > 0) p.y -= 4 * t * (1 - t) * sag;
      if (wobble > 0) {
        const env = Math.sin(Math.PI * t) * Math.min(1.5, len * 0.02) * wobble;
        p.addScaledVector(perp, Math.sin(t * 9 - time * 40) * env * 0.35);
        p.y += Math.sin(t * 5 + time * 23) * env * 0.25;
      }
      // width grows a little with distance from the camera so the wire never vanishes to sub-pixel
      const dc = p.distanceTo(cam);
      const w = 0.012 + dc * 0.0011;
      const side = this._side.subVectors(p, cam).cross(dir).normalize().multiplyScalar(w);
      const o = i * 6;
      this.pos[o] = p.x - side.x; this.pos[o + 1] = p.y - side.y; this.pos[o + 2] = p.z - side.z;
      this.pos[o + 3] = p.x + side.x; this.pos[o + 4] = p.y + side.y; this.pos[o + 5] = p.z + side.z;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}
