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
    h.state = 'flying'; h.parked = false;
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
          this.game.fx?.hookBite?.(hit.point, hit.normal, hit.collider.material);
          h.bite = 1;                       // the wire flashes and a glint runs up it (Wire, render)
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
      if (!h.attached || h.payout > 0 || h.yank || h.parked) continue;   // a titan has hold of this wire / it's a safety line
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
    // A wire going taut while you fly away from its anchor (a point-blank catch, a slack wire snapping tight) slips
    // through the reel's clutch: the outward speed bleeds off at slipDecel and the wire runs out meanwhile, instead
    // of the whole closing speed vanishing in one tick. Swings never slip (their outward speed per tick is tiny).
    const G = this.payout || 0;
    const W = CFG.wire;
    for (const h of this.hooks) {
      h._keep = 0;
      if (!h.attached) { h.slipping = false; continue; }
      const P = Math.max(G, h.payout || 0);
      _d.subVectors(pos, h.anchor);
      const dist = _d.length();
      if (dist < 1e-6 || dist < h.length - 0.05) { h.slipping = false; continue; }
      const vout = vel.dot(_d.multiplyScalar(1 / dist));
      if (vout <= 0) { h.slipping = false; continue; }
      let keep = P > 0 ? Math.min(vout, P) : 0;
      if (vout > W.slipFrom && h.length < CFG.hook.range) {
        if (!h.slipping && vout > W.snapSpeed) { this.snap = Math.max(this.snap || 0, vout); h.twang = Math.max(h.twang || 0, vout); }   // the jolt: felt once
        h.slipping = true;
        keep = Math.max(keep, vout - W.slipDecel * dt);
      } else h.slipping = false;
      if (keep > 0) { h._keep = keep; h.length = Math.min(CFG.hook.range, h.length + keep * dt); }
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
          // a wire at full length (it can't slip any further) stops you and kicks back a little (the steel's spring)
          const e = vo > W.snapSpeed ? W.rebound : 0;
          vel.addScaledVector(_d, -vo * (1 + e));
          if (vo > W.snapSpeed) { this.snap = Math.max(this.snap || 0, vo); h.twang = Math.max(h.twang || 0, vo); }
        }
      }
    }
    for (const h of this.hooks) {
      if (!h.attached || G > 0 || h.payout > 0 || h.slipping || h.parked) continue;
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
      // (the wire's own slack, measured from the body centre the physics uses, not from the launcher on the hip). A wire
      // running free (h.payout: the titan swoop, the other rope during a climb) is drawn taut: its reel spools the
      // slack in as you close, it only stops holding you back (it used to hang in a long loop under you)
      if (h.attached && !(h.payout > 0)) { const slack = h.length - this.player.pos.distanceTo(h.anchor); if (slack > 0.05) sag = Math.min(6, Math.sqrt(slack * h.length) * 0.45); }
      // catch feel: a bite flash + a glint up the wire on attach, a twang wave when it snaps taut
      if (h.bite) { w.bite(); h.bite = 0; }
      if (h.twang > 0) { w.pluck(Math.min(1, h.twang / 22)); h.twang = 0; }
      w.update(origins[i], h.tip, camera, wobble, time + i * 1.7, sag, h.attached, this.game.world?.sun);
    }
  }
}

/** Camera-facing ribbon with optional travelling wave (for a wire in flight / winding back), a sunlit glint
 *  that runs along it, a flash when the anchor bites and a decaying standing wave when it snaps taut. */
const WIRE_VERT = /* glsl */`
attribute float aT;
varying float vT;
#include <fog_pars_vertex>
void main() {
  vT = aT;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const WIRE_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uGlint, uGlintW, uGlintI, uFlash, uSheen;
varying float vT;
#include <common>
#include <fog_pars_fragment>
void main() {
  float d = (vT - uGlint) / uGlintW;
  float g = exp(-d * d) * uGlintI;
  vec3 c = uColor + vec3(0.30, 0.31, 0.33) * uSheen;                 // steel catching the sky
  c = mix(c, vec3(1.0, 0.97, 0.86), clamp(g + uFlash, 0.0, 1.0));
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;
const _sunD = new THREE.Vector3(), _hv = new THREE.Vector3();

class Wire {
  constructor(scene) {
    this.N = 40;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array((this.N + 1) * 2 * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    const ts = new Float32Array((this.N + 1) * 2);
    for (let i = 0; i <= this.N; i++) ts[i * 2] = ts[i * 2 + 1] = i / this.N;
    g.setAttribute('aT', new THREE.BufferAttribute(ts, 1));
    const idx = [];
    for (let i = 0; i < this.N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uColor: { value: new THREE.Color(0x2a2826) }, uGlint: { value: -1 }, uGlintW: { value: 0.05 }, uGlintI: { value: 0 },
        uFlash: { value: 0 }, uSheen: { value: 0 },
      }]),
      vertexShader: WIRE_VERT, fragmentShader: WIRE_FRAG, side: THREE.DoubleSide, fog: true,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this._a = new THREE.Vector3(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(); this._side = new THREE.Vector3(); this._perp = new THREE.Vector3();
    this._cp = new THREE.Vector3();
    this.glint = -1; this.glintI = 0; this.glintNext = 0.8 + Math.random(); this.flash = 0;
    this.twang = 0; this.twangAge = 9; this.lastTime = 0;
  }
  /** the anchor bit: flash the wire and send a bright glint racing from the launcher up to the anchor */
  bite() { this.flash = 1; this.glint = 0; this.glintI = 1.4; this.glintSpeed = 130; }
  /** the wire snapped taut: a vibration that decays over ~0.4 s (k 0..1) */
  pluck(k) { if (k > this.twang * Math.exp(-this.twangAge * 7)) { this.twang = k; this.twangAge = 0; } }

  update(a, b, camera, wobble, time, sag = 0, attached = false, sun = null) {
    this.mesh.visible = true;
    let dt = time - this.lastTime; this.lastTime = time;
    dt = dt > 0 && dt < 0.1 ? dt : 1 / 60;
    const dir = this._a.subVectors(b, a);
    const len = dir.length() || 1e-4;
    dir.multiplyScalar(1 / len);
    const perp = this._perp.set(0, 1, 0).cross(dir);
    if (perp.lengthSq() < 1e-6) perp.set(1, 0, 0); perp.normalize();
    const cam = camera.position;
    // the twang moves across the line of sight so it reads on screen
    const mid = this._s.copy(a).addScaledVector(dir, len * 0.5);
    const cp = this._cp.subVectors(mid, cam).cross(dir);
    if (cp.lengthSq() < 1e-8) cp.copy(perp); cp.normalize();
    this.twangAge += dt;
    const tw = this.twang * Math.exp(-this.twangAge * 7);
    const twA = tw > 0.01 ? tw * Math.min(0.55, 0.06 + len * 0.012) : 0;
    const ta = this.twangAge;
    // glint: sunlit highlight sliding along the wire. A steel cylinder shows a highlight where the half vector between
    // the sun and the eye is square to its axis; a periodic glint runs up an anchored wire
    let sheen = 0;
    if (sun) {
      _sunD.subVectors(sun.position, sun.target.position).normalize();
      _hv.subVectors(cam, mid).normalize().add(_sunD).normalize();
      sheen = Math.pow(1 - Math.abs(_hv.dot(dir)), 6);
    }
    if (this.glint >= 0) {
      this.glint += dt * Math.min((this.glintSpeed || 45) / len, 7);
      if (this.glint > 1.15) this.glint = -1;
    } else if (attached) {
      this.glintNext -= dt;
      if (this.glintNext <= 0) { this.glint = 0; this.glintI = 0.55 + 0.6 * sheen; this.glintSpeed = 45; this.glintNext = 1.2 + Math.random() * 1.6; }
    }
    this.flash *= Math.exp(-dt * 14);
    const u = this.mat.uniforms;
    u.uGlint.value = this.glint; u.uGlintI.value = this.glint >= 0 ? this.glintI * Math.min(1, (1.15 - this.glint) * 5) : 0;
    u.uGlintW.value = Math.max(0.04, Math.min(0.3, 2.4 / len)); u.uFlash.value = this.flash * 0.9; u.uSheen.value = sheen;
    const gl = this.glint, gw = u.uGlintW.value;
    for (let i = 0; i <= this.N; i++) {
      const t = i / this.N;
      const p = this._p.copy(a).addScaledVector(dir, len * t);
      if (sag > 0) p.y -= 4 * t * (1 - t) * sag;
      if (wobble > 0) {
        const env = Math.sin(Math.PI * t) * Math.min(1.5, len * 0.02) * wobble;
        p.addScaledVector(perp, Math.sin(t * 9 - time * 40) * env * 0.35);
        p.y += Math.sin(t * 5 + time * 23) * env * 0.25;
      }
      if (twA > 0) {
        // standing wave: the fundamental plus a faster overtone, both decaying
        const d = Math.sin(Math.PI * t) * Math.cos(ta * 46) + 0.45 * Math.sin(2 * Math.PI * t) * Math.cos(ta * 83 + 1.1) + 0.25 * Math.sin(3 * Math.PI * t) * Math.cos(ta * 121);
        p.addScaledVector(cp, d * twA);
      }
      // width grows a little with distance from the camera so the wire never vanishes to sub-pixel; it swells
      // under the glint and the bite flash so the light reads
      const dc = p.distanceTo(cam);
      let w = 0.012 + dc * 0.0011;
      if (gl >= 0) { const q = (t - gl) / gw; w *= 1 + 2.4 * Math.exp(-q * q) * Math.min(1, this.glintI); }
      w *= 1 + this.flash * 0.8;
      const side = this._side.subVectors(p, cam).cross(dir).normalize().multiplyScalar(w);
      const o = i * 6;
      this.pos[o] = p.x - side.x; this.pos[o + 1] = p.y - side.y; this.pos[o + 2] = p.z - side.z;
      this.pos[o + 3] = p.x + side.x; this.pos[o + 4] = p.y + side.y; this.pos[o + 5] = p.z + side.z;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}
