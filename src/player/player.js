// The soldier: fixed-step body physics (gravity, quadratic drag, ODM wires, gas thrust, swept sphere contacts),
// ground running, blades and nape strikes, being grabbed, and the third-person camera.
import * as THREE from 'three';
import { CFG } from '../config.js';
import { OdmGear } from './odm.js';

// Math.hypot is variadic and boxes its arguments in hot loops (it was the top source of garbage); this doesn't.
const hypot = (a, b, c = 0) => Math.sqrt(a * a + b * b + c * c);


const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _e = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const damp = (k, dt) => 1 - Math.exp(-k * dt);

export class Player {
  constructor(game) {
    this.game = game;
    this.pos = new THREE.Vector3();
    this.prev = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.render = new THREE.Vector3();      // interpolated body centre for drawing
    this.position = this.render;             // public (contract): where the soldier is drawn
    this.velocity = this.vel;
    this.odm = new OdmGear(game, this);
    this.model = null;
    this.yaw = 0; this.pitch = -0.12;
    this.cam = { pos: new THREE.Vector3(), roll: 0, fov: CFG.cam.fov, trauma: 0, dist: CFG.cam.dist, look: new THREE.Vector3() };
    this.forward = new THREE.Vector3(0, 0, 1);
    this.bodyUp = new THREE.Vector3(0, 1, 0);
    this.aim = { valid: false, point: new THREE.Vector3(), distance: 0, lockTitan: false, collider: null, dir: new THREE.Vector3() };
    // auto-targeted anchor for each rope (0 = Z / left, 1 = X / right), rescanned alternately every frame
    this.targets = [0, 1].map(() => ({ valid: false, point: new THREE.Vector3(), collider: null, titan: null, distance: 0, age: 0 }));
    this._scanSide = 0;
    this._anchorTmp = [];
    this._origins = [new THREE.Vector3(), new THREE.Vector3()];
    this._modelPos = new THREE.Vector3();
    this._released = [0, 1].map(() => ({ p: new THREE.Vector3(), t: 0 }));
    this._bans = [];
    this._flipF = new THREE.Vector3(); this._flipU = new THREE.Vector3(); this.flipT = 0; this._lastAnchorY = 0;
    this.reset(new THREE.Vector3(0, 50.6, 0), 0);
  }

  reset(position, yaw = 0) {
    this.pos.copy(position); this.prev.copy(position); this.render.copy(position);
    this.vel.set(0, 0, 0);
    this.yaw = yaw; this.pitch = -0.15;
    this.alive = true; this.hp = 1; this.lastHurt = -99;
    this.grounded = false; this.groundTime = 0; this.airTime = 0; this.groundN = new THREE.Vector3(0, 1, 0);
    this.wallN = null; this.wallTime = 0;
    this.blade = 1; this.spares = CFG.combat.spares; this.swapT = 0;
    this.slashT = -1; this.slashHit = false; this.spin = false; this.spinT = 0;
    this.dashCd = 0; this.boosting = false; this.boostLevel = 0; this.spaceHeld = 0;
    this.stun = 0; this.grabbedBy = null; this.grabHand = null; this.struggle = 0; this.grabImmune = 0;
    this.reelLevel = 0; this.impactCooldown = 0;
    this.wishF = 0; this.wishR = 0; this.turn = 0; this.wantBoost = false; this._dashPuff = 0;
    this.shiftHeld = 0; this.payout = false; this.mouseT = 99; this.autoSwapT = 0; this.primeT = 0; this.perch = null; this.cling = null; this.flipT = 0; this.mountCd = 0; this.rideStand = 0; this.rideStandT = 0; this.crouch = 0; if (this.riding) this.riding.rider = null; this.riding = null; this.mounting = null; this.prey = null; this.preyDist = 1e9; this.swooping = false;
    if (this.targets) for (const t of this.targets) { t.valid = false; t.collider = null; t.titan = null; }
    this.odm.reset();
    this.cam.pos.copy(position).add(new THREE.Vector3(Math.sin(yaw) * -5, 2, Math.cos(yaw) * -5));
    this.landed = 0;
    this.stats = { kills: 0, damage: 0, best: 0, start: this.game.time || 0, topSpeed: 0 };
  }

  get speed() { return this.vel.length(); }

  // ---------------------------------------------------------------- input (once per frame)
  // Keyboard-first: arrows (or WASD) move and steer, Z / X fire the left / right rope at the auto-targeted
  // anchor, Shift is gas (tap on the ground to jump), Space cuts. The mouse is optional (click to look).
  handleInput(input, dt) {
    if (!this.alive) return;
    if (input.mouseDX || input.mouseDY) {
      const sens = CFG.cam.sens * (this.game.settings?.sens ?? 1);
      this.yaw -= input.mouseDX * sens;
      this.pitch = THREE.MathUtils.clamp(this.pitch - input.mouseDY * sens * (this.game.settings?.invertY ? -1 : 1), -1.45, 1.45);
      this.mouseT = 0;
    } else this.mouseT += dt;

    const k = (a, b) => input.held(a) || input.held(b);
    const F = k('ArrowUp', 'W') ? 1 : 0, B = k('ArrowDown', 'S') ? 1 : 0;
    const L = k('ArrowLeft', 'A') ? 1 : 0, R = k('ArrowRight', 'D') ? 1 : 0;
    const cut = input.hit('Space') || input.hit('Mouse0');

    if (this.grabbedBy) {
      if (cut) {
        this.struggle += CFG.combat.grabEscapePerPress * (this.blade > 0 ? 1 : 0.55);
        this.game.audio?.slash?.(true);
        this.slashT = 0;
        if (this.struggle >= 1) this._escapeGrab();
      }
      return;
    }

    // on horseback: ↑ gallops, ← → steer, Shift leaps off, Z / X fire a rope straight off the running horse
    if (this.riding) {
      const h = this.riding;
      h.want.f = F - B; h.want.turn = R - L;
      this.turn = 0; this.wishF = 0; this.wishR = 0;
      if (this.mounting) return;   // still climbing on: you can already steer, but not leap
      // hold Shift: rise from the saddle and stand on the galloping horse; let go to spring off it
      const shiftHeld = input.held('ShiftLeft') || input.held('ShiftRight');
      const rope = input.hit('Z') || input.hit('X') || input.hit('Q') || input.hit('E') || input.hit('Mouse2');
      this.rideStandT = shiftHeld || rope ? 1 : 0;
      const release = !shiftHeld && this.rideStand > 0.7;
      if (release || rope) this._leapOff(rope ? CFG.horse.ropeLeap : CFG.horse.leap);
      else {
        if (cut && this.swapT <= 0) this._slash();
        return;
      }
    }

    if (input.hit('F')) this._whistle();

    // steering: the arrows turn your heading; the camera rides behind it
    this.turn = R - L;
    const anchored = this.odm.attachedCount();
    const rate = this.grounded && !anchored ? CFG.keys.turnGround : anchored ? CFG.keys.turnRope : CFG.keys.turnAir;
    this.yaw -= this.turn * rate * dt;
    this.wishF = F - B; this.wishR = this.turn;
    this.payout = B > 0 && anchored > 0 && !this.grounded;   // ↓ on a rope: stop the winch, let the wire out

    // ropes: Z = left, X = right (Q / E and the mouse buttons still work for mouse players)
    const wantL = input.held('Z') || input.held('Q') || input.held('Mouse2');
    const wantR = input.held('X') || input.held('E') || input.held('Mouse2');
    const fireL = input.hit('Z') || input.hit('Q') || input.hit('Mouse2');
    const fireR = input.hit('X') || input.hit('E') || input.hit('Mouse2');
    this._wantL = wantL; this._wantR = wantR;
    if ((fireL || fireR) && this.stun <= 0) for (const b of this._bans) b.t = 0;
    if ((fireL || fireR) && (this.cling || this.perch)) { this.cling = null; this.perch = null; }
    if (this.stun <= 0) {
      if (fireL) this._fire(0, wantR);
      if (fireR) this._fire(1, wantL);
    }
    const wasAnchored = anchored;
    for (const h of this.odm.hooks) if (h.attached) this._lastAnchorY = h.anchor.y;
    for (let i = 0; i < 2; i++) {
      const want = i ? wantR : wantL, h = this.odm.hooks[i];
      if (!want && h.attached) { this._released[i].p.copy(h.anchor); this._released[i].t = 1.5; }
      this._released[i].t -= dt;
    }
    if (!wantL) this.odm.release(0);
    if (!wantR) this.odm.release(1);
    // letting go: the anime's release-and-fly. Timed at the bottom of a swing (moving level, anchor overhead)
    // it slings you out with a burst of speed and a forward flip.
    if (wasAnchored && !this.odm.attachedCount() && !this.grounded && this.speed > 14) {
      const sp = this.speed, v = this.vel;
      const level = 1 - Math.min(1, Math.abs(v.y) / (sp * 0.55));
      const overhead = THREE.MathUtils.clamp((this._lastAnchorY - this.pos.y) / 12, 0, 1);
      const q = level * overhead;
      v.y += CFG.keys.releaseLift;
      if (q > 0.35) {
        v.addScaledVector(_e.copy(v).normalize(), CFG.release.boost * q);
        v.y += CFG.release.lift * q;
        this.flipT = CFG.release.flipTime;
        this.cam.trauma = Math.min(1, this.cam.trauma + 0.12);
        this._dashPuff = 0.2;
        this.game.audio?.setGas?.(1);
        if (q > 0.8) this.game.hud?.message?.('PERFECT RELEASE', 0.9, 'info');
      }
    }

    // gas: Shift. Tap on the ground = jump; clinging to a trunk = kick off; held = boost
    const shiftHit = input.hit('ShiftLeft') || input.hit('ShiftRight');
    const shiftHeld = input.held('ShiftLeft') || input.held('ShiftRight');
    if (shiftHit && this.cling) { this.cling = null; this.wallTime = 0.2; }
    if (shiftHit && this.wallTime > 0 && this.wallN && !this.grounded) {
      this.vel.addScaledVector(this.wallN, 10).y += 7;
      this.odm.releaseAll();
      this.wallTime = 0;
      this.game.audio?.land?.(0.3);
    } else if (shiftHit && this.grounded && this.groundTime < CFG.ground.coyote + 0.01) {
      this.vel.y = Math.max(this.vel.y, CFG.ground.jump);
      if (F) { const f = this._heading(_e); this.vel.addScaledVector(f, 3); }
      this.crouch = Math.max(this.crouch, 0.45);
      this.grounded = false; this.groundTime = 1;
      this.spaceHeld = 0;
    }
    this.spaceHeld = shiftHeld ? this.spaceHeld + dt : 0;
    this.wantBoost = shiftHeld;
    // C: the marker isn't on the anchor you want? skip both picks to the next-best ones
    if (input.hit('C') || input.hit('Tab')) {
      for (const T of this.targets) if (T.valid) {
        const b = this._bans.find((x) => x.t <= 0) || (this._bans.length < 6 ? (this._bans[this._bans.length] = { p: new THREE.Vector3(), t: 0 }) : this._bans[0]);
        b.p.copy(T.point); b.t = CFG.aim.banTime;
      }
      this.game.audio?.bladeSwap?.();
    }
    for (const b of this._bans) b.t -= dt;

    // blades: Space cuts, held at speed in the air = Levi's spinning slash; dull blades swap themselves
    if (input.hit('R')) this._swapBlades();
    const yh = this.odm.hooks[0].yank ? this.odm.hooks[0] : this.odm.hooks[1].yank ? this.odm.hooks[1] : null;
    if (cut && yh) this._cutWire(yh);                 // a titan has your wire: Space severs it
    else if (cut && this.swapT <= 0) {
      // swooping in on a nape: Space primes the cut and the blades fire the moment you reach it
      if (this.swooping && this.preyDist < CFG.combat.primeRange) this.primeT = CFG.combat.primeTime;
      else this._slash();
    }
    const cutHeld = input.held('Space') || input.held('Mouse0');
    this.spin = cutHeld && !this.grounded && this.speed > CFG.combat.spinMinSpeed && this.blade > 0 && this.swapT <= 0 && (this.slashT < 0 || this.slashT > 0.15);
    if (this.blade <= 0 && this.spares > 0 && this.swapT <= 0) {
      this.autoSwapT += dt;
      if (this.autoSwapT > 0.25) { this.autoSwapT = 0; this._swapBlades(); }
    } else this.autoSwapT = 0;
  }

  /** Horizontal heading (unit) into out. */
  _heading(out) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  /** Heading-right (unit) into out. */
  _right(out) { return out.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw)); }

  _camBasis() {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    _a.set(sy * cp, sp, cy * cp); // look forward
    return _a;
  }
  /** Horizontal wish direction (unit or zero): along the heading, plus a sideways pull while turning. */
  _wish(out) {
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const side = this.grounded ? 0 : this.wishR * 0.8;
    out.set(sy * this.wishF - cy * side, 0, cy * this.wishF + sy * side);
    const l = out.length();
    return l > 0 ? out.multiplyScalar(1 / l) : out;
  }

  launcher(side, out) {
    if (this.model?.hookOrigin) return this.model.hookOrigin(side, out);
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    return out.copy(this.render).add(_e.set(cy * (side ? -0.25 : 0.25), -0.1, -sy * (side ? -0.25 : 0.25)));
  }

  _fire(side, twin) {
    const o = _b.copy(this.pos);
    let T = this.targets[side];
    const O = this.targets[1 - side];
    // only one side has a target (e.g. Z + X with trees on one side): both ropes go there, splayed a little;
    // and with both held, a titan on either side takes both ropes
    if ((!T.valid && twin && O.valid) || (twin && O.valid && O.titan && !T.titan)) T = O;
    // both held with two different titans in view: both ropes take the nearer one
    else if (twin && T.valid && O.valid && T.titan && O.titan && T.titan !== O.titan && O.distance < T.distance) T = O;
    let target = null;
    const dir = this.aim.dir;
    if (T.valid) {
      target = _c.copy(T.point);
      if (T === this.targets[1 - side] && !T.titan) target.addScaledVector(this._right(_d), (side ? 1 : -1) * 1.2);
      dir.subVectors(target, o).normalize();
    } else {
      // nothing in range: fire ahead-and-up on that side anyway (it will miss and wind back)
      this._heading(dir).addScaledVector(this._right(_d), side ? 0.5 : -0.5).setY(0.7).normalize();
      this.game.events.emit('hook:none', { side });
    }
    if (this.odm.fire(side, o, target, dir) && this.game.fx?.gas) {
      this.launcher(side, _e); this.game.fx.gas(_e, dir, 0.3);
    }
  }

  /**
   * Auto-targeting for one rope. Candidate anchor points come straight from the geometry around you (the side
   * of each trunk facing you at a height above you, the nearest stretch of each branch, the nearest face of
   * each building or wall, the shoulders of titans and dummies). Each is scored by distance (sweet spot ~40 m),
   * height above you (a swing needs an anchor overhead), how well it lies along where you are going, and which
   * side it is on; the best few are confirmed by line of sight. The previous pick wins ties, so markers hold still.
   */
  _scan(side) {
    const T = this.targets[side];
    const col = this.game.collision, p = this.render;
    const sgn = side === 0 ? -1 : 1;
    const fwd = this._heading(_a), right = this._right(_b);
    const v = this.vel, hs = hypot(v.x, v.z);
    const ax = hs > 8 ? v.x / hs : fwd.x, az = hs > 8 ? v.z / hs : fwd.z;
    const range = CFG.hook.range - 3;
    const gy = col.groundHeight(p.x, p.z);
    // the height we'd like to anchor at: above us, lower when we're already high over the canopy
    const wantY = p.y + (p.y - gy > 80 ? -10 : this.grounded ? 16 : 12 + THREE.MathUtils.clamp(-v.y * 0.3, -6, 10));
    const cands = this._cands || (this._cands = []);
    let n = 0;
    // lead: the anchor lands ~0.2 s from now, so judge candidates from where you'll be
    const lx = p.x + v.x * 0.2, ly = p.y + v.y * 0.2, lz = p.z + v.z * 0.2;
    const sp = v.length(), flying = !this.grounded && sp > 10;
    const other = this.odm.hooks[1 - side];
    const rel = this._released[side];
    // aim where you face: the camera's view direction decides; Z takes the left half of the view, X the right
    const cf = this.game.camera.getWorldDirection(this._camF || (this._camF = new THREE.Vector3()));
    const crx = -cf.z, crz = cf.x, crl = hypot(crx, crz) || 1;          // camera right (horizontal)
    const bans = this._bans;
    const push = (x, y, z, c, titan) => {
      const dx = x - lx, dy = y - ly, dz = z - lz;
      const d = hypot(dx, dy, dz);
      if (d < (titan ? 2.5 : 7) || d > range) return;
      const dl = hypot(dx, dz) || 1e-6;
      const ahead = (dx * ax + dz * az) / dl;
      if (ahead < -0.35) return;                                        // never behind you
      const lateral = ((dx * right.x + dz * right.z) / dl) * sgn;          // > 0: on this rope's side
      const sd = 1 - Math.min(1, Math.abs(d - 40) / 60);
      const sh = this.grounded ? THREE.MathUtils.clamp((dy - 3) / 18, 0, 1) : THREE.MathUtils.clamp((dy + 10) / 30, 0, 1);
      // facing: how close to the centre of your view (cone ~55° wide); this dominates the pick
      const ex = x - p.x, ey = y - p.y, ez = z - p.z, el = hypot(ex, ey, ez) || 1;
      // keyboard: facing is left/right only (the height preference picks anchors overhead); mouse: full 3D aim
      const mouseAim = this.mouseT < 3;
      const hl = hypot(ex, ez) || 1, cfl = hypot(cf.x, cf.z) || 1;
      const cosc = mouseAim ? (ex * cf.x + ey * cf.y + ez * cf.z) / el : (ex * cf.x + ez * cf.z) / (hl * cfl);
      const facing = THREE.MathUtils.clamp((cosc - CFG.aim.cone) / (1 - CFG.aim.cone), -1, 1);
      // which half of the view: Z wants the left half, X the right (a centred anchor suits either)
      const half = ((ex * crx + ez * crz) / (crl * (hypot(ex, ez) || 1))) * sgn;
      let score = facing * CFG.aim.facingWeight + (half < -0.08 ? -1.2 : Math.min(half, 0.4) * 0.8)
        + sd * 0.7 + sh * 0.9 + (ahead + 1) * 0.25 + THREE.MathUtils.clamp(lateral, 0, 0.6) * 0.3;
      for (const b of bans) if (b.t > 0 && (x - b.p.x) ** 2 + (y - b.p.y) ** 2 + (z - b.p.z) ** 2 < 36) score -= 4;
      // titans (and training dummies) are the point: within reach and roughly ahead they win outright
      if (titan) score += 1.6 + (ahead > 0.5 ? 0.4 : 0);
      if (flying && !titan) {
        // swing quality: the best rope makes ~40-75° with your velocity, from an anchor above you, so the arc
        // carries you forward and up; a rope dead along your velocity is a collision course
        const cosv = (dx * v.x + dy * v.y + dz * v.z) / (d * sp);
        score += (1 - Math.min(1, Math.abs(cosv - 0.5) / 0.6)) * 0.9;
        if (cosv > 0.92 && d < sp * 1.2) score -= 0.8;
        // the lowest point of the swing must clear the ground
        const lowest = y - d;
        if (lowest < col.groundHeight(x, z) + 2) score -= 0.5;
      }
      // chaining: with the other rope anchored, this one reaches for the next anchor, not the same one
      if (other.attached && (x - other.anchor.x) ** 2 + (y - other.anchor.y) ** 2 + (z - other.anchor.z) ** 2 < 100) score -= 0.9;
      // don't grab the anchor you just let go of
      if (rel.t > 0 && (x - rel.p.x) ** 2 + (z - rel.p.z) ** 2 < 64) score -= 1.2;
      if (T.valid && (x - T.point.x) ** 2 + (y - T.point.y) ** 2 + (z - T.point.z) ** 2 < 25) score += 0.35;
      let o = cands[n];
      if (!o) o = cands[n] = { p: new THREE.Vector3(), c: null, t: null, s: 0 };
      o.p.set(x, y, z); o.c = c; o.t = titan; o.s = score; n++;
    };
    _c.set(p.x + ax * 12, wantY, p.z + az * 12);   // a point ahead and above: the "ideal" anchor
    for (const c of col.querySphere(p, range)) {
      if (!c.hookable) continue;
      if (c.type === 'cylinder') {
        if (c.y1 - c.y0 < 4 && c.r < 1.5) continue;   // cannons, barrels, posts: useless to swing from
        let dx = p.x - c.x, dz = p.z - c.z; const l = hypot(dx, dz) || 1; dx /= l; dz /= l;
        const y = THREE.MathUtils.clamp(wantY, c.y0 + 1.5, c.y1 - 1);
        push(c.x + dx * c.r, y, c.z + dz * c.r, c, null);
      } else if (c.type === 'capsule') {
        _d.subVectors(c.b, c.a);
        const t = THREE.MathUtils.clamp(_e.subVectors(_c, c.a).dot(_d) / Math.max(_d.lengthSq(), 1e-6), 0, 1);
        _e.copy(c.a).addScaledVector(_d, t);
        _d.subVectors(p, _e).normalize();
        push(_e.x + _d.x * c.r, _e.y + _d.y * c.r, _e.z + _d.z * c.r, c, null);
      } else if (c.type === 'box') {
        // closest point of the box to the ideal point, nudged onto the face that looks at you
        _e.subVectors(_c, c.center);
        let px = c.center.x, py = c.center.y, pz = c.center.z;
        for (let i = 0; i < 3; i++) {
          const ax2 = c.axes[i], h = i === 0 ? c.half.x : i === 1 ? c.half.y : c.half.z;
          const k = THREE.MathUtils.clamp(_e.dot(ax2), -h, h);
          px += ax2.x * k; py += ax2.y * k; pz += ax2.z * k;
        }
        if (Math.min(c.half.x, c.half.y, c.half.z) < 0.25 && py < p.y) continue;   // thin slabs below you: skip
        if (c.half.x < 1.2 && c.half.y < 1.2 && c.half.z < 1.2) continue;            // crates and props
        push(px, py, pz, c, null);
      } else if (c.type === 'sphere') {
        _d.subVectors(p, c.center).normalize();
        push(c.center.x + _d.x * c.r, c.center.y + _d.y * c.r, c.center.z + _d.z * c.r, c, null);
      }
    }
    // titans and training dummies: their shoulders / upper back, where Survey Corps anchor to reach the nape
    for (const t of this.game.targetList?.() || []) {
      if (!t.alive || !t.position || t.position.distanceToSquared(p) > (range + 25) ** 2) continue;
      const pts = this._anchorTmp; pts.length = 0;
      if (t.anchors) t.anchors(pts);
      else { const nw = t.napeWorld?.(); if (nw?.center) pts.push(nw.center); }
      for (const a of pts) push(a.x, a.y, a.z, null, t);
    }
    // best first; confirm line of sight on the top few
    const list = cands.slice(0, n).sort((x, y) => y.s - x.s);
    let found = null;
    for (let i = 0; i < Math.min(list.length, 7); i++) {
      const o = list[i];
      _d.subVectors(o.p, p); const dl = _d.length(); _d.multiplyScalar(1 / dl);
      const hit = col.raycast(p, _d, dl + 2.5, { hookableOnly: true });
      if (!hit || hit.collider.type === 'ground' || hit.distance < (o.t ? 2 : 6)) continue;
      const same = o.c ? hit.collider === o.c : (hit.collider.userData?.titan === o.t || hit.collider.userData?.dummy === o.t || hit.point.distanceTo(o.p) < 3);
      if (!same && hit.point.distanceTo(o.p) > 4) continue;
      found = { hit, titan: o.t || hit.collider.userData?.titan || null };
      break;
    }
    T.age += 1;
    if (found) {
      T.valid = true; T.point.copy(found.hit.point); T.collider = found.hit.collider; T.titan = found.titan;
      T.distance = found.hit.distance; T.age = 0;
    } else if (T.age > 2) { T.valid = false; T.collider = null; T.titan = null; }
  }

  _dash(input) {
    if (this.dashCd > 0 || this.grabbedBy || (!this.infiniteGas && this.odm.gas < CFG.gas.dashCost)) return;
    const w = this._wish(_b);
    if (w.lengthSq() === 0) w.copy(this._camBasis());
    else { const look = this._camBasis(); if (this.wishF > 0) w.y = look.y * 0.8; w.normalize(); }
    this.vel.addScaledVector(w, CFG.gas.dashDv);
    if (!this.infiniteGas) this.odm.gas -= CFG.gas.dashCost;
    this.dashCd = CFG.gas.dashCooldown;
    this.game.audio?.setGas?.(1);
    this._dashPuff = 0.18;
    this.cam.trauma = Math.min(1, this.cam.trauma + 0.12);
  }

  // ---------------------------------------------------------------- landing on branches, roofs and trunks
  /** Holding a rope and coming in slowly: arc up onto the branch / roof it hit, or stick to the trunk / wall. */
  _perchCheck() {
    if (this.grounded || this.payout || this.swooping || this.stun > 0) return;
    const p = this.pos, v = this.vel;
    for (const h of this.odm.hooks) {
      if (!h.attached || !h.collider || h.collider.dynamic || h.collider.type === 'ground') continue;
      if (!(h.side ? this._wantR : this._wantL)) continue;
      const d = p.distanceTo(h.anchor);
      _e.subVectors(h.anchor, p).multiplyScalar(1 / Math.max(d, 1e-3));
      const vin = v.dot(_e);
      if (d > CFG.perch.reach + Math.max(0, vin) * 0.12 || vin > CFG.perch.maxSpeed) continue;
      const tgt = this._perchTarget(h);
      if (!tgt) continue;
      this._startPerch(tgt.pos, tgt.wall ? tgt.normal : null, h);
      return;
    }
  }
  _perchTarget(h) {
    const c = h.collider, R = CFG.radius, a = h.anchor, n = h.normal;
    const out = { pos: new THREE.Vector3(), normal: n.clone(), wall: false };
    if (c.type === 'capsule') {
      _a.subVectors(c.b, c.a); const L2 = _a.lengthSq();
      const dirY = Math.abs(_a.y) / Math.sqrt(L2 || 1);
      if (dirY < 0.7) {   // a branch: stand on its top
        const t = THREE.MathUtils.clamp(_b.subVectors(a, c.a).dot(_a) / (L2 || 1), 0.08, 0.92);
        out.pos.copy(c.a).addScaledVector(_a, t); out.pos.y += c.r + R + 0.02;
      } else { out.wall = true; out.normal.set(a.x - c.a.x, 0, a.z - c.a.z).normalize(); out.pos.copy(a).addScaledVector(out.normal, R + 0.05); }
    } else if (n.y > 0.55) {
      out.pos.copy(a).addScaledVector(UP, R + 0.02);
    } else if (Math.abs(n.y) < 0.5) {
      out.normal.set(n.x, 0, n.z).normalize();
      // a wall or rooftop edge just above the anchor: vault up onto the top instead of clinging under the lip
      // (step back from the edge until there's a clear spot: parapets and gutters sit right on the lip)
      let found = false;
      for (const back of [0.9, 1.8, 2.8]) {
        _b.copy(a).addScaledVector(out.normal, -back); _b.y += 3.2;
        const top = this.game.collision.raycast(_b, _d.set(0, -1, 0), 4.2, { dynamic: false });
        if (!top || top.normal.y < 0.7 || top.collider.type === 'ground') continue;
        out.pos.copy(top.point); out.pos.y += R + 0.02;
        let clear = true;
        for (const k of this.game.collision.collideSphere(out.pos, R * 0.9, { dynamic: false })) if (k.depth > 0.12 && k.collider !== top.collider) { clear = false; break; }
        if (clear) { found = true; return out; }
      }
      if (!found) { out.wall = true; out.pos.copy(a).addScaledVector(out.normal, R + 0.05); }
    } else return null;
    for (const k of this.game.collision.collideSphere(out.pos, R * 0.9, { dynamic: false })) if (k.depth > 0.12 && k.collider !== c && k.collider.type !== 'ground') return null;
    return out;
  }
  _startPerch(target, wallN, hook) {
    const d = this.pos.distanceTo(target);
    this.perch = {
      s: this.pos.clone(), e: target.clone(), wall: wallN ? wallN.clone() : null, t: 0,
      dur: THREE.MathUtils.clamp(d / 13, 0.28, 0.6),
      c: this.pos.clone().lerp(target, 0.5).add(_e.set(0, 1.1 + d * 0.12 + (wallN ? 0 : Math.max(0, target.y - this.pos.y) * 0.3), 0)),
      mat: hook.collider.material,
    };
    if (wallN) this.perch.c.addScaledVector(wallN, 1.2);
    this.odm.braking = 0.25;
    this.game.audio?.setGas?.(0.7);
  }
  _perchStep(dt) {
    const P = this.perch;
    P.t += dt;
    const k = Math.min(1, P.t / P.dur), e = k * k * (3 - 2 * k), u = 1 - e;
    // quadratic Bezier: start -> over the top -> landing spot (eased); velocity from its derivative
    this.pos.set(0, 0, 0).addScaledVector(P.s, u * u).addScaledVector(P.c, 2 * u * e).addScaledVector(P.e, e * e);
    const de = 6 * k * (1 - k) / P.dur;
    this.vel.set(0, 0, 0).addScaledVector(P.s, -2 * u * de).addScaledVector(P.c, 2 * (u - e) * de).addScaledVector(P.e, 2 * e * de);
    this.launcher(0, this._origins[0]); this.launcher(1, this._origins[1]);
    this.odm.step(dt, this._origins);
    if (k >= 1) {
      this.perch = null;
      this.odm.releaseAll(true);
      this.pos.copy(P.e);
      this.game.fx?.impact?.(_e.copy(P.e).addScaledVector(P.wall || UP, -CFG.radius), P.wall || UP, P.mat || 'bark');
      this.game.audio?.land?.(0.45);
      this.cam.trauma = Math.min(1, this.cam.trauma + 0.12);
      this.crouch = 0.85;
      if (P.wall) { this.cling = { n: P.wall.clone(), t: 0 }; this.vel.set(0, 0, 0); }
      else { this.vel.multiplyScalar(0.12).setY(0); this.grounded = true; this.groundTime = 0; this._landT = 0; }
      this.game.events.emit('player:perched', { wall: !!P.wall });
    }
  }
  _clingStep(dt) {
    const C = this.cling;
    C.t += dt;
    this.vel.set(0, 0, 0);
    this.wallN = (this.wallN || new THREE.Vector3()).copy(C.n); this.wallTime = 0.2;
    this.grounded = false; this.groundTime = 1;
    this.launcher(0, this._origins[0]); this.launcher(1, this._origins[1]);
    this.odm.step(dt, this._origins);
    if (C.t > CFG.perch.clingTime) { this.cling = null; this.vel.addScaledVector(C.n, 1.5); }
  }

  /** Run up to a free horse and vault on (hand on the saddle, leg swung over), or drop onto it from the air. */
  _tryMount() {
    const herd = this.game.herd;
    if (!herd || this.mountCd > 0 || this.odm.attachedCount() || this.speed > CFG.horse.maxMountSpeed) return;
    const air = !this.grounded && this.vel.y < -1;
    const r = CFG.horse.mountRadius * (air ? 1.35 : 1);
    for (const h of herd.horses) {
      if (h.rider || h.mountCd > 0) continue;
      h.saddle(_e);
      const dxz = (_e.x - this.pos.x) ** 2 + (_e.z - this.pos.z) ** 2;
      // on foot you run right up to the flank before vaulting; from the air the saddle is a bigger target
      if (_e.distanceToSquared(this.pos) < r * r && (air || dxz < 1.8 * 1.8) && this.vel.y < 2) {
        const hs = hypot(this.vel.x, this.vel.z);
        this.riding = h; h.rider = this; h.caller = null; this.lastHorse = h;
        h.speed = Math.max(h.speed, hs * 0.8);
        const off = new THREE.Vector3().subVectors(this.pos, h.pos);
        const lateral = -off.x * Math.cos(h.yaw) + off.z * Math.sin(h.yaw);       // + = on the horse's right
        this.mounting = { t: 0, air, dur: air ? 0.62 : CFG.horse.mountTime, off, fall: -this.vel.y, side: lateral < 0 ? 1 : -1, hit: false };
        this.rideStand = 0; this.rideStandT = 0;
        if (!air) this.game.audio?.land?.(0.2);
        this.game.events.emit('player:mounted', { horse: h });
        return;
      }
    }
  }
  /** One fixed step of climbing on. The pose is keyed in the model (s.mount); this moves the body along with it.
   *  run: crouch and plant a hand (0-0.2), spring up and over the saddle (0.2-0.75), seat (0.78), sit up.
   *  air: the last metre of the fall into the saddle (0-0.23), the impact folds you forward, then you sit up. */
  _mountStep(dt, h) {
    const M = this.mounting;
    M.t += dt;
    const q = Math.min(1, M.t / M.dur);
    _d.copy(h.pos).add(M.off);                                   // where you took off from, carried along with the horse
    h.saddle(_e, 0);
    if (!M.air) {
      const e = THREE.MathUtils.smoothstep(q, 0.14, 0.78);
      _a.lerpVectors(_d, _e, 0.75); _a.y = Math.max(_d.y, _e.y) + 0.75;   // up beside the saddle, then over it
      const u = 1 - e;
      this.pos.set(0, 0, 0).addScaledVector(_d, u * u).addScaledVector(_a, 2 * u * e).addScaledVector(_e, e * e);
      if (q > 0.22 && !M.sprung) { M.sprung = true; this.game.audio?.land?.(0.15); }
      if (q >= 0.78 && !M.hit) { M.hit = true; h.hit(0.25); this.game.audio?.land?.(0.3); }
    } else {
      const k = Math.min(1, q / 0.23);
      this.pos.lerpVectors(_d, _e, k * k);
      if (k >= 1 && !M.hit) {
        M.hit = true;
        const s = Math.min(1.3, M.fall / 11);
        h.hit(0.6 + s * 0.6);
        this.game.audio?.land?.(0.45 + s * 0.3);
        this.cam.trauma = Math.min(1, this.cam.trauma + 0.12 + s * 0.15);
      }
    }
    if (q >= 1) { this.mounting = null; this.rideStand = 0; }
  }
  /** Falling toward a free horse with no ropes out: drift onto its back (leading its gallop) and open the legs. */
  _saddleMagnet(dt, acc) {
    this.straddle = 0;
    const herd = this.game.herd;
    const hs = hypot(this.vel.x, this.vel.z);
    if (!herd || this.grounded || this.odm.attachedCount() || this.vel.y > -1 || this.boosting || this.mountCd > 0 || hs > 22) return;
    let best = null, bd = 1e9;
    for (const h of herd.horses) {
      if (h.rider || h.mountCd > 0) continue;
      const dx = h.pos.x - this.pos.x, dz = h.pos.z - this.pos.z, d2 = dx * dx + dz * dz;
      const dy = this.pos.y - (h.pos.y + 1.5);
      if (dy < 0.5 || dy > 12 || d2 > 12 * 12) continue;
      if (hs > 4 && dx * this.vel.x + dz * this.vel.z < 0.5 * Math.sqrt(d2) * hs) continue;   // only a horse you're heading for
      if (d2 < bd) { bd = d2; best = h; }
    }
    if (!best) return;
    // time to fall to saddle height, and where the saddle will be by then
    const dy = this.pos.y - (best.pos.y + 1.5), vy = -this.vel.y, g = CFG.gravity;
    const tf = Math.max(0.12, (-vy + Math.sqrt(vy * vy + 2 * g * dy)) / g);
    best.saddle(_e, 0).addScaledVector(best.vel, tf);
    const wx = (_e.x - this.pos.x) / tf, wz = (_e.z - this.pos.z) / tf;     // horizontal velocity that lands on it
    const ax = THREE.MathUtils.clamp((wx - this.vel.x) * 6, -30, 30), az = THREE.MathUtils.clamp((wz - this.vel.z) * 6, -30, 30);
    const hd = Math.sqrt(bd);
    const w = THREE.MathUtils.clamp(1.3 - hd / 10, 0, 1);
    acc.x += ax * w; acc.z += az * w;
    this.straddle = THREE.MathUtils.clamp(1 - (tf - 0.15) / 0.6, 0, 1) * w;
  }
  _mountS(M) { const o = this._ms || (this._ms = { k: 0, kind: 'run', side: 1 }); o.k = M.t / M.dur; o.kind = M.air ? 'air' : 'run'; o.side = M.side; return o; }
  /** Fingers in mouth: your horse (or the nearest free one) comes galloping. */
  _whistle() {
    const herd = this.game.herd, now = this.game.time || 0;
    if (!herd || now - (this._whistleAt ?? -9) < 1.2) return;
    this._whistleAt = now;
    this.game.audio?.whistle?.();
    let best = null, bd = 450 * 450;
    const lh = this.lastHorse;
    if (lh && !lh.rider && lh.pos.distanceToSquared(this.pos) < 700 * 700) best = lh;
    else for (const h of herd.horses) {
      if (h.rider) continue;
      const d = h.pos.distanceToSquared(this.pos);
      if (d < bd) { bd = d; best = h; }
    }
    if (best) { best.call(this); this.game.hud?.message?.('YOUR HORSE IS COMING', 1.6, 'info'); }
    else this.game.hud?.message?.('NO HORSE WITHIN EARSHOT', 1.6, 'warn');
  }
  /** Stand up on the running horse and spring off it: you keep the horse's speed. */
  _leapOff(up) {
    const h = this.riding;
    if (!h) return;
    this.riding = null; this.mounting = null; h.rider = null; h.mountCd = 2; this.mountCd = 1.2;
    h.want.f = 0; h.want.turn = 0;
    this.vel.copy(h.vel).addScaledVector(this._heading(_e), CFG.horse.leapForward);
    this.vel.y = up;
    this.grounded = false; this.groundTime = 1;
    this.game.audio?.land?.(0.3);
  }

  /** Cut your own wire where a titan's fist has it: you drop free, it hauls on nothing. */
  _cutWire(h) {
    const at = _a.copy(h.anchor).sub(this.pos);
    const L = at.length();
    at.multiplyScalar(Math.min(2.5, L * 0.3) / (L || 1)).add(this.pos);
    this.game.fx?.sparks?.(at, _b.copy(this.pos).sub(at).normalize(), 18);
    this.odm.release(h.side, true);
    this.game.audio?.slash?.(true);
    this.vel.multiplyScalar(0.55);
    this.cam.trauma = Math.min(1, this.cam.trauma + 0.25);
    this.slashT = 0; this.slashHit = true;
    this.game.events.emit('player:wireCut', {});
  }

  _swapBlades() {
    if (this.swapT > 0 || this.spares <= 0 || this.blade >= 0.999) return;
    this.spares--; this.swapT = CFG.combat.swapTime;
    this.game.audio?.bladeSwap?.();
  }

  _slash() {
    if (this.slashT >= 0 && this.slashT < CFG.combat.slashTime * 0.7) return;
    this.slashT = 0; this.slashHit = false; this._arcShown = false;
    this.game.audio?.slash?.(false);
  }

  // ---------------------------------------------------------------- fixed-step physics
  fixedUpdate(dt) {
    this.prev.copy(this.pos);
    if (!this.alive) { this.vel.set(0, 0, 0); return; }
    if (this.grabbedBy) { this._followHand(); return; }
    if (this.riding) {
      const h = this.riding;
      if (h.crashed > 0) {   // ran into a trunk or wall at a gallop: thrown over its head
        const sp = h.crashed; h.crashed = 0;
        this._leapOff(5);
        this.vel.addScaledVector(this._heading(_e), sp * 0.6);
        this.hurt(Math.max(0, sp - 10) * 0.02, 'impact');
        this.cam.trauma = Math.min(1, this.cam.trauma + 0.5);
        return;
      }
      if (this.mounting) this._mountStep(dt, h);
      else {
        this.rideStand += ((this.rideStandT || 0) - this.rideStand) * Math.min(1, dt * 5);
        h.saddle(this.pos, this.rideStand);
      }
      this.vel.copy(h.vel);
      this.grounded = true; this.groundTime = 0; this.airTime = 0;
      this.yaw += Math.atan2(Math.sin(h.yaw - this.yaw), Math.cos(h.yaw - this.yaw)) * Math.min(1, dt * 9);
      this.launcher(0, this._origins[0]); this.launcher(1, this._origins[1]);
      this.odm.step(dt, this._origins);
      return;
    }
    this._tryMount();
    if (this.perch) { this._perchStep(dt); return; }
    if (this.cling) { this._clingStep(dt); return; }
    this._perchCheck();

    const odm = this.odm;
    this.launcher(0, this._origins[0]); this.launcher(1, this._origins[1]);
    // the launcher positions are only for visuals; physics fires from the body centre
    odm.step(dt, this._origins);

    const v = this.vel, p = this.pos;
    const acc = _d.set(0, -CFG.gravity, 0);
    const speed = v.length();

    // quadratic drag (+ a hard ramp above the cap so nothing runs away)
    let k = CFG.drag;
    if (speed > CFG.hardCap) k *= 1 + (speed - CFG.hardCap) * 0.15;
    acc.addScaledVector(v, -k * speed);

    const hasGas = this.infiniteGas || odm.gas > 0;
    const anchored = odm.attachedCount();
    const groundedNow = this.grounded;
    this._saddleMagnet(dt, acc);
    this.boosting = this.wantBoost && hasGas && this.stun <= 0 && (!groundedNow || this.spaceHeld > 0.16 || anchored > 0);

    // winch (↓ on a rope stops it and pays the wire out for a longer, lower swing)
    odm.payout = this.payout ? CFG.keys.payout : 0;
    this.reelLevel = this.payout || this.stun > 0 ? 0 : odm.reelAccel(p, v, this.boosting, acc);
    if (anchored && !this.infiniteGas) odm.gas -= CFG.gas.reelRate * anchored * dt * (this.boosting ? 2 : 1);

    // roped to a titan: the swoop. The gear carries you round behind the neck and straight through the nape at
    // cutting speed (how Survey Corps take a titan down, and the keyboard player's assist). Ropes on anything
    // else go slack meanwhile so they don't hold you back.
    let prey = null;
    const yanked = odm.hooks[0].yank || odm.hooks[1].yank;   // being hauled in: no swoop until you get free
    for (const hk of odm.hooks) {
      const t = hk.attached && !yanked ? hk.collider?.userData?.titan || hk.collider?.userData?.dummy : null;
      if (t && t.alive && t.napeWorld) { prey = t; break; }
    }
    this.swooping = false; this.prey = prey; this.preyDist = 1e9;
    if (prey) {
      const nw = prey.napeWorld();
      const close = nw?.center && p.distanceTo(nw.center) < CFG.combat.swoopRange;
      // other ropes go slack; the titan's own rope runs free once the swoop takes over (it only steadies you)
      for (const hk of odm.hooks) {
        const mine = hk.collider?.userData?.titan === prey || hk.collider?.userData?.dummy === prey;
        hk.payout = hk.attached && (!mine || close) ? 40 : 0;
      }
      if (nw?.center) {
        const nrm = nw.normal || UP;
        const dN = p.distanceTo(nw.center);
        this.preyDist = dN;
        if (dN < CFG.combat.swoopRange) {
          this.swooping = true;
          // three legs: from in front, swing out beside the head; then come round behind the neck; then cut
          // straight through the nape. (Flying straight at it from the front would only hit the face.)
          const rx = p.x - nw.center.x, ry = p.y - nw.center.y, rz = p.z - nw.center.z;
          const along = rx * nrm.x + ry * nrm.y + rz * nrm.z;              // > 0: behind the neck
          const rt = _a.crossVectors(UP, nrm);
          if (rt.lengthSq() < 1e-4) rt.set(1, 0, 0); rt.normalize();
          const side = rx * rt.x + rz * rt.z;
          const R = Math.max(3, (prey.height || 8) * 0.35);
          const aim = _e.copy(nw.center);
          if (along < 1.2) aim.addScaledVector(rt, (side >= 0 ? 1 : -1) * R).addScaledVector(nrm, 2).y += 1.5;
          else if (dN > 5) aim.addScaledVector(nrm, Math.min(6, dN * 0.4)).y += 0.5;
          else aim.addScaledVector(nrm, -2.5);
          aim.sub(p);
          const S = this.boosting ? CFG.combat.swoopBoost : CFG.combat.swoop;
          aim.normalize().multiplyScalar(S).sub(v).multiplyScalar(CFG.combat.swoopGain);
          const al = aim.length();
          if (al > CFG.combat.swoopMax) aim.multiplyScalar(CFG.combat.swoopMax / al);
          acc.add(aim);
          acc.y += CFG.gravity * 0.6;   // the wires hold most of your weight through the swoop
        }
      }
    } else for (const hk of odm.hooks) hk.payout = 0;

    // gas thrust
    const wish = this._wish(_b);
    if (this.boosting) {
      // thrust along the heading (a little lift so you don't plough into the ground); on a rope, along the swing
      const dir = _c;
      if (anchored && speed > 8) dir.copy(v).multiplyScalar(1 / speed).addScaledVector(this._heading(_e), 0.6);
      else { this._heading(dir).multiplyScalar(this.wishF < 0 ? -0.4 : 1); dir.y = 0.22 + Math.max(0, this.pitch) * 0.8; }
      if (this.turn) dir.addScaledVector(this._right(_e), this.turn * 0.45);
      dir.normalize();
      acc.addScaledVector(dir, anchored ? CFG.gas.hookedBoostAccel : CFG.gas.boostAccel);
      if (!this.infiniteGas) odm.gas -= CFG.gas.boostRate * dt;
    }
    if (!this.infiniteGas) odm.gas = Math.max(0, odm.gas);

    if (groundedNow && !anchored) {
      // running: accelerate toward the wish velocity, skid off excess speed
      const n = this.groundN;
      const target = _c.copy(wish).multiplyScalar(CFG.ground.run * (this.stun > 0 ? 0.3 : 1) * (this.wishF < 0 ? 0.45 : 1));
      const hv = _e.set(v.x, 0, v.z);
      const hs = hv.length();
      if (hs > CFG.ground.run + 0.5 && wish.dot(hv) > 0) {
        // carrying momentum from the air: skid
        v.x -= (v.x / hs) * CFG.ground.skid * dt; v.z -= (v.z / hs) * CFG.ground.skid * dt;
      } else {
        const dx = target.x - v.x, dz = target.z - v.z, dl = hypot(dx, dz);
        const maxStep = CFG.ground.accel * dt * (hs > CFG.ground.run + 0.5 ? 0.4 : 1);
        const s = dl > maxStep ? maxStep / dl : 1;
        v.x += dx * s; v.z += dz * s;
      }
      // stick to slopes
      acc.addScaledVector(n, -2);
    } else if (anchored) {
      // pump the swing: ↑ drives along the heading, ← → swing you around the anchor (perpendicular to the wire)
      const pd = odm.pullDir(p, _c);
      if (pd && (this.wishF > 0 || this.turn)) {
        const w = _e.set(0, 0, 0);
        if (this.wishF > 0) this._heading(w);
        if (this.turn) w.addScaledVector(this._right(_a), this.turn * 1.2);
        w.addScaledVector(pd, -w.dot(pd));
        acc.addScaledVector(w, CFG.air.pump);
      }
    } else if (wish.lengthSq() > 0) {
      acc.addScaledVector(wish, CFG.air.control);
    }

    v.addScaledVector(acc, dt);

    // landing assist: about to hit a surface head-on while flying on the wires (or holding gas)?
    // the front vents fire and bleed off the closing speed, so you land on the trunk like in the anime.
    if ((anchored || this.boosting) && hasGas && !groundedNow) {
      const sp = v.length();
      if (sp > CFG.reel.arrive) {
        const look = (sp * sp) / (2 * CFG.reel.brake) + 3;
        const hit = this.game.collision.raycast(p, _c.copy(v).multiplyScalar(1 / sp), look, { dynamic: false });
        if (hit && hit.normal.dot(_c) < -0.35) {
          const vn = -v.dot(hit.normal);
          const allowed = CFG.reel.arrive + Math.sqrt(2 * CFG.reel.brake * Math.max(0, hit.distance - CFG.radius - 0.6));
          if (vn > allowed) {
            const b = Math.min(CFG.reel.brakeMax, (vn - allowed) * 12);
            v.addScaledVector(hit.normal, b * dt);
            this.odm.braking = 0.15;
          }
        }
      }
    }

    // integrate with swept substeps: never move more than 0.3 m per sub-step
    const travel = v.length() * dt;
    const n = Math.min(12, Math.max(1, Math.ceil(travel / 0.3)));
    const h = dt / n;
    this._hitN = 0;
    let groundedStep = false;
    this.wallN = null;
    for (let i = 0; i < n; i++) {
      p.addScaledVector(v, h);
      odm.constrain(p, v, h);
      if (this._contacts(p, v, dt)) groundedStep = true;
    }
    // auto-vault: running into something waist-high (a parapet, rubble, a cart) hops you over it
    if (groundedStep && this.wallN && this.wishF > 0 && !anchored && this.stun <= 0) {
      const f = this._heading(_c);
      if (this.wallN.dot(f) < -0.5) {
        _e.copy(p).addScaledVector(f, 0.9).y += 1.9;
        const top = this.game.collision.raycast(_e, _a.set(0, -1, 0), 2.6, { dynamic: false });
        const rise = top ? top.point.y - (p.y - CFG.radius) : 0;
        if (top && top.normal.y > 0.7 && rise > 0.25 && rise < 1.8) {
          v.y = Math.max(v.y, Math.sqrt(2 * CFG.gravity * (rise + 0.45)));
          v.addScaledVector(f, 2.5);
          groundedStep = false; this.grounded = false; this.groundTime = 1;
        }
      }
    }
    if (groundedStep && this.airTime > 0.35) this._landT = Math.min(1, (this._preLandSpeed || 0) / 30) + 0.001;
    this._preLandSpeed = v.length();
    if (groundedStep) { this.grounded = true; this.groundTime = 0; }
    else { this.groundTime += dt; if (this.groundTime > CFG.ground.coyote) this.grounded = false; }
    if (this.grounded) this.airTime = 0; else this.airTime += dt;

    // timers
    this.dashCd -= dt; this.mountCd -= dt; this.stun -= dt; this.grabImmune -= dt; this.impactCooldown -= dt;
    if (this._dashPuff > 0) this._dashPuff -= dt;
    if (this.swapT > 0) { this.swapT -= dt; if (this.swapT <= 0) this.blade = 1; }
    if (this.game.time - this.lastHurt > 4 && this.hp < 1) this.hp = Math.min(1, this.hp + dt * 0.04);
    this.stats.topSpeed = Math.max(this.stats.topSpeed, this.speed);

    this._bounds();
  }

  /** Push the sphere out of everything it overlaps; returns true if standing on something. */
  _contacts(p, v, dt) {
    const R = CFG.radius;
    let grounded = false;
    for (let it = 0; it < 3; it++) {
      const cs = this.game.collision.collideSphere(p, R);
      if (!cs.length) break;
      let any = false;
      for (const c of cs) {
        if (c.depth <= 1e-5) continue;
        any = true;
        p.addScaledVector(c.normal, c.depth);
        const vn = v.dot(c.normal);
        if (vn < 0) {
          // impact
          if (-vn > CFG.impact.safe && this.impactCooldown <= 0) this._impact(-vn, c);
          v.addScaledVector(c.normal, -vn);
          // surface friction: strong on floors when not anchored, slick on walls (wall-running on a wire)
          const tang = _e.copy(v);
          const ts = tang.length();
          if (ts > 1e-4) {
            const floor = c.normal.y > 0.6;
            const mu = floor ? (this.odm.attachedCount() ? 0.15 : 0.0) : 0.06;
            const dv = Math.min(ts, -vn * mu);
            v.addScaledVector(tang, -dv / ts);
          }
        }
        if (c.normal.y > 0.6) { grounded = true; this.groundN.copy(c.normal); }
        else if (Math.abs(c.normal.y) < 0.6) { this.wallN = (this.wallN || new THREE.Vector3()).copy(c.normal); this.wallTime = 0.15; }
        if (c.collider?.dynamic && c.collider.userData?.titan) this._touchTitan = c.collider.userData.titan;
      }
      if (!any) break;
    }
    return grounded;
  }

  _impact(speed, contact) {
    this.impactCooldown = 0.35;
    const s = THREE.MathUtils.clamp((speed - CFG.impact.safe) / 40, 0, 1);
    this.cam.trauma = Math.min(1, this.cam.trauma + 0.25 + s * 0.6);
    this.game.audio?.impact?.(s);
    this.game.fx?.impact?.(this.pos.clone().addScaledVector(contact.normal, -CFG.radius), contact.normal, contact.collider?.material || 'ground');
    const dmg = (speed - CFG.impact.safe) * CFG.impact.dmg;
    if (dmg > 0.02) this.hurt(dmg, 'impact');
    if (speed > CFG.impact.stun) { this.stun = 0.45; this.odm.releaseAll(); }
  }

  _bounds() {
    const p = this.pos, v = this.vel;
    const push = (val, lo, hi) => (val < lo ? lo - val : val > hi ? hi - val : 0);
    const bx = push(p.x, -1100, 1100), bz = push(p.z, -650, 1050);
    if (bx) { v.x += bx * 4 * (1 / 60); if (Math.sign(v.x) !== Math.sign(bx)) v.x *= 0.96; }
    if (bz) { v.z += bz * 4 * (1 / 60); if (Math.sign(v.z) !== Math.sign(bz)) v.z *= 0.96; }
    if (p.y > 420) v.y = Math.min(v.y, 0);
    if (p.y < -50) this.hurt(1, 'fell');
  }

  hurt(amount, cause) {
    if (!this.alive || this.game.mode === 'menu') return;
    if (this.game.mode === 'free') amount *= 0.25;
    this.hp -= amount; this.lastHurt = this.game.time;
    this.game.audio?.hurt?.();
    this.game.events.emit('player:hurt', { amount, cause });
    if (this.hp <= 0) this.die(cause);
  }

  die(cause) {
    if (!this.alive) return;
    this.hp = 0; this.alive = false;
    this.odm.releaseAll(true);
    this.game.events.emit('player:died', { cause });
  }

  // ---------------------------------------------------------------- titan interaction (contract)
  grab(titan, hand) {
    if (!this.alive || this.grabbedBy || this.grabImmune > 0) return false;
    if (this.riding) { this.riding.rider = null; this.riding = null; this.mounting = null; }
    this.grabbedBy = titan; this.grabHand = hand; this.struggle = 0;
    this.odm.releaseAll(true);
    this.vel.set(0, 0, 0);
    this.cam.trauma = Math.min(1, this.cam.trauma + 0.6);
    this.game.audio?.grabbed?.();
    this.game.events.emit('player:grabbed', { titan });
    return true;
  }
  _followHand() {
    const h = this.grabHand;
    if (!h || !this.grabbedBy || this.grabbedBy.alive === false) { this._release(); return; }
    h.getWorldPosition(this.pos);
    this.vel.set(0, 0, 0);
    this.struggle = Math.max(0, this.struggle - CFG.combat.grabDecay / CFG.physicsHz);
  }
  _escapeGrab() {
    const t = this.grabbedBy;
    this._release();
    t?.onGrabEscape?.();
    this.game.fx?.blood?.(this.pos.clone(), new THREE.Vector3(0, 1, 0), 1.2);
    this.game.audio?.slash?.(true);
    const away = _a.subVectors(this.pos, t?.position || this.pos).setY(0);
    if (away.lengthSq() < 1e-4) away.set(0, 0, 1);
    away.normalize();
    this.vel.copy(away).multiplyScalar(14).setY(10);
    this.blade = Math.max(0, this.blade - 0.25);
    this.game.events.emit('player:escaped', {});
  }
  _release() { this.grabbedBy = null; this.grabHand = null; this.grabImmune = 1.6; }
  /** Called by a titan that lets go (blinded, arm severed, killed while holding us). */
  release() { if (this.grabbedBy) { this._release(); this.vel.set(0, 4, 0); } }
  eaten(titan) {
    if (!this.alive) return;
    this._release();
    this.game.audio?.eaten?.();
    this.die('eaten');
  }
  applyImpulse(dv, damage = 0) {
    if (!this.alive || this.grabbedBy) return;
    this.vel.add(dv);
    this.cam.trauma = Math.min(1, this.cam.trauma + 0.35);
    if (damage) this.hurt(damage / 100, 'struck');
  }

  // ---------------------------------------------------------------- per-frame (variable dt)
  update(dt, alpha) {
    const game = this.game;
    this.render.lerpVectors(this.prev, this.pos, alpha);
    const v = this.vel, speed = v.length();

    // blades & combat
    if (this.slashT >= 0) {
      // the blades are live for most of the sweep: the first nape/limb they meet in that window is cut
      this.slashT += dt;
      const st = CFG.combat.slashTime;
      if (!this.slashHit && this.slashT > st * 0.15 && this.slashT < st * 0.85) {
        if (this._strike(CFG.combat.reach + speed * 0.025, false, !this._arcShown)) this.slashHit = true;
        this._arcShown = true;
      }
      if (this.slashT > st) this.slashT = -1;
    }
    if (this.primeT > 0) {
      this.primeT -= dt;
      const nw = this.prey?.alive ? this.prey.napeWorld?.() : null;
      if (!nw?.center) this.primeT = 0;
      else if (nw.center.distanceTo(this.render) < CFG.combat.reach + 1.4 + speed * 0.02) { this.primeT = 0; this._slash(); }
      else if (this.primeT <= 0) this._slash();   // never reached it: swing anyway
    }
    if (this.spin) {
      this.spinT += dt;
      if (this.spinT > CFG.combat.spinInterval) { this.spinT = 0; this._strike(CFG.combat.reach + 1 + speed * 0.02, true); }
    } else this.spinT = CFG.combat.spinInterval;

    // rope auto-targets (one side per frame) and the legacy aim summary for the HUD
    this._scanSide ^= 1;
    this._scan(this._scanSide);
    const tL = this.targets[0], tR = this.targets[1];
    const tb = tL.valid && (!tR.valid || tL.distance <= tR.distance) ? tL : tR;
    this.aim.valid = tL.valid || tR.valid;
    if (this.aim.valid) { this.aim.point.copy(tb.point); this.aim.distance = tb.distance; this.aim.collider = tb.collider; }
    this.aim.lockTitan = !!(tL.titan || tR.titan);

    // body orientation for the model
    const anchored = this.odm.attachedCount();
    const tf = _a;
    if (this.grounded && !anchored) {
      tf.set(v.x, 0, v.z);
      if (tf.lengthSq() < 0.5 || this.wishF < 0) tf.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    } else if (speed > 2.5) {
      // fly along the velocity, but never a pure vertical dive: keep a heading so the pose stays readable
      tf.copy(v).multiplyScalar(1 / speed).addScaledVector(_e.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)), anchored ? 0.25 : 0.55);
    } else tf.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    if (this.riding) {
      tf.set(Math.sin(this.riding.yaw), 0, Math.cos(this.riding.yaw));
      const M = this.mounting;
      if (M && !M.air) {
        const q = M.t / M.dur, w = 1 - THREE.MathUtils.smoothstep(q, 0.25, 0.75);
        _e.set(-M.off.x, 0, -M.off.z); if (_e.lengthSq() > 1e-4) tf.addScaledVector(_e.normalize(), 0.3 * w);   // a quarter-turn in to the flank, no more
      }
    }
    // coming in to land: swing upright and feet-first before touchdown (never a head-first dive into the ground)
    this.landPrep = 0;
    if (!this.grounded && !anchored && v.y < -2) {
      const below = this.game.collision.raycast(this.render, _e.set(0, -1, 0), 40, { dynamic: false });
      if (below && below.normal.y > 0.5) {
        const tti = (below.distance - CFG.radius) / -v.y;           // seconds until touchdown
        this.landPrep = THREE.MathUtils.clamp(1 - (tti - 0.15) / 0.55, 0, 1);
      }
    }
    if (this.perch) this.landPrep = 1;
    if (this.landPrep > 0) {
      const hx = v.x, hz = v.z, hl = hypot(hx, hz);
      _e.set(hl > 0.5 ? hx / hl : Math.sin(this.yaw), 0, hl > 0.5 ? hz / hl : Math.cos(this.yaw));
      tf.normalize().lerp(_e, this.landPrep);
    }
    tf.normalize();
    this.forward.lerp(tf, damp(this.riding ? 30 : this.grounded ? 14 : this.landPrep > 0 ? 12 : 7, dt)).normalize();
    const upT = _b.copy(UP);
    const pd = this.odm.pullDir(this.render, _c);
    if (pd && !this.grounded) upT.lerp(pd, 0.55);
    if (this.wallN && this.wallTime > 0 && anchored) upT.copy(this.wallN);
    if (this.riding) this.riding.up(upT);
    if (this.cling) {
      // standing on the side of the trunk: feet on the bark, body out level, facing along the heading
      upT.copy(this.cling.n);
      const cf = _d.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); cf.addScaledVector(this.cling.n, -cf.dot(this.cling.n));
      if (cf.lengthSq() < 1e-3) cf.set(0, 1, 0);
      this.forward.copy(cf.normalize());
    }
    if (this.landPrep > 0) upT.lerp(UP, this.landPrep);
    upT.addScaledVector(this.forward, -upT.dot(this.forward));
    if (upT.lengthSq() < 1e-3) upT.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).addScaledVector(this.forward, -0.0);
    upT.normalize();
    this.bodyUp.lerp(upT, damp(this.riding ? 20 : this.landPrep > 0 ? 14 : 6, dt)).normalize();
    this.wallTime -= dt;

    if (this.model) {
      const hooks = this.odm.hooks.map((h) => ({ attached: h.attached, anchor: h.attached ? h.anchor : null, state: h.state }));
      const run = this.riding ? 0 : this.grounded ? Math.min(1, hypot(v.x, v.z) / CFG.ground.run) : (this.wallN && anchored ? 1 : 0);
      const slash = this.slashT >= 0 ? this.slashT / CFG.combat.slashTime : -1;
      this.boostLevel += ((this.boosting || this._dashPuff > 0 ? 1 : 0) - this.boostLevel) * damp(18, dt);
      this.crouch = Math.max(0, this.crouch - dt * 2.6);
      let mf = this.forward, mu = this.bodyUp;
      if (this.flipT > 0) {
        this.flipT -= dt;
        const k = 1 - Math.max(0, this.flipT) / CFG.release.flipTime;
        const ang = (k * k * (3 - 2 * k)) * Math.PI * 2;           // eased full forward somersault
        const ax = _q2.setFromAxisAngle(_a.crossVectors(this.forward, this.bodyUp).normalize(), -ang);
        mf = this._flipF.copy(this.forward).applyQuaternion(ax);
        mu = this._flipU.copy(this.bodyUp).applyQuaternion(ax);
      }
      this.model.update(dt, {
        riding: this.riding ? 1 - this.rideStand : 0, crouch: this.grounded ? this.crouch : 0, landPrep: this.straddle > 0.05 ? 0 : this.landPrep,
        mount: this.mounting ? this._mountS(this.mounting) : null, straddle: this.straddle || 0,
        horseGallop: this.riding?.gallop || 0, horsePhase: this.riding?.phase || 0,
        position: this._modelPos.copy(this.render).addScaledVector(this.bodyUp, CFG.modelLift), velocity: v, forward: mf, up: mu,
        grounded: this.grounded, running: run, hooks, boosting: this.boostLevel, slash,
        spin: this.spin, grabbed: !!this.grabbedBy, blades: this.blade > 0 && this.swapT <= 0 && !(this.riding && this.rideStand < 0.5), speed,
        alive: this.alive,
      });
      if (this.model.root) this.model.root.visible = this.alive || !!this.grabbedBy;
    }

    // a wire snapping taut: feel it
    if (this.odm.snap > 0) {
      const k = Math.min(1, this.odm.snap / 25);
      this.cam.trauma = Math.min(1, this.cam.trauma + 0.15 + k * 0.25);
      game.audio?.impact?.(k * 0.5);
      this.odm.snap = 0;
    }
    // landing dust
    if (this._landT > 0) {
      const s = this._landT; this._landT = 0;
      this.crouch = Math.max(this.crouch, 0.35 + s * 0.65);   // knees take the landing
      game.audio?.land?.(s);
      game.fx?.impact?.(_c.copy(this.render).addScaledVector(this.groundN, -CFG.radius), this.groundN, 'ground');
      if (s > 0.4) this.cam.trauma = Math.min(1, this.cam.trauma + s * 0.3);
    }
    // gas brake vents fire forward
    if (this.odm.braking > 0 && game.fx?.gas) game.fx.gas(_c.copy(this.render).addScaledVector(this.forward, 0.35), this.forward, 0.6);
    // gas puffs
    if ((this.boosting || this._dashPuff > 0) && game.fx?.gas) {
      const np = _c, nd = _d;
      if (this.model?.gasNozzle) this.model.gasNozzle(np, nd);
      else { np.copy(this.render).addScaledVector(this.forward, -0.4); nd.copy(this.forward).negate(); }
      game.fx.gas(np, nd, this._dashPuff > 0 ? 1 : 0.7);
    }

    // wires
    this.launcher(0, this._origins[0]); this.launcher(1, this._origins[1]);
    this.odm.render(this._origins, game.camera, game.time);

    // leaves when blasting through canopies (no collider: we just test the world's foliage callback)
    if (speed > 25 && game.world?.inFoliage?.(this.render) && Math.random() < dt * 20) game.fx?.leaves?.(this.render, 4);

    this._camera(dt);
    this._audio(dt);
    this._supply(dt);
  }

  /** One blade check. Returns true if anything was hit. */
  _strike(radius, spin, showArc = true) {
    if (this.blade <= 0 || this.swapT > 0) { if (!spin && showArc) this.game.audio?.bladeBreak?.(); return false; }
    const hitTest = this.game.hitTest;
    if (!hitTest) return false;
    // reach forward along the motion (or the heading), generous like the anime's blur of steel
    const look = this._heading(_a);
    const dir = this.speed > 6 ? _b.copy(this.vel).normalize().lerp(look, 0.35).normalize() : _b.copy(look);
    const center = _c.copy(this.render).addScaledVector(dir, spin ? 0.6 : 1.3);
    // the blades find the nape: if one is within reach, strike it (anime precision at full speed)
    let bestNape = null, bestD = radius + 2.2;
    for (const t of this.game.targetList?.() || []) {
      if (!t.alive || !t.napeWorld) continue;
      const nw = t.napeWorld();
      if (!nw?.center) continue;
      const d = nw.center.distanceTo(this.render);
      if (d < bestD) { bestD = d; bestNape = nw.center; }
    }
    if (bestNape) center.copy(bestNape);
    if (showArc && this.game.fx?.slashArc && (!spin || Math.random() < 0.5)) {
      _q.copy(this.game.camera.quaternion).multiply(_q2.setFromAxisAngle(_a.set(0, 0, 1), (Math.random() - 0.5) * 1.6));
      this.game.fx.slashArc(_e.copy(this.render).addScaledVector(dir, 1.1), _q, radius * 0.7);
    }
    const hits = hitTest(center, radius);
    if (!hits || !hits.length) return false;
    // best part: nape > eye > ankle > others
    const rank = { nape: 5, eye: 4, ankle: 3, hand: 2, arm: 2, body: 1 };
    const seen = new Set();
    hits.sort((x, y) => (rank[y.part] || 0) - (rank[x.part] || 0));
    for (const hit of hits) {
      if (seen.has(hit.titan) || !hit.titan.alive) continue;
      seen.add(hit.titan);
      const tv = hit.titan.velocity || _e.set(0, 0, 0);
      const rel = _d.subVectors(this.vel, tv).length();
      const sharp = 0.55 + 0.45 * this.blade;
      const damage = Math.round((CFG.combat.dmgBase + rel * CFG.combat.dmgPerMs) * sharp * (spin ? 1.1 : 1));
      const res = hit.titan.applyHit({ part: hit.part, damage, point: hit.point.clone(), dir: dir.clone() }) || {};
      this.blade = Math.max(0, this.blade - CFG.combat.wear * (hit.part === 'nape' ? 1 : 0.35));
      this.game.audio?.slash?.(true);
      if (hit.titan.kind !== 'dummy') this.game.fx?.blood?.(hit.point, dir, res.killed ? 2 : 1);
      this.game.events.emit('player:hit', { titan: hit.titan, part: hit.part, damage, result: res, point: hit.point.clone() });
      this.stats.damage += damage;
      if (this.blade <= 0) { this.game.audio?.bladeBreak?.(); this.game.events.emit('player:bladeBroken', {}); }
      this.cam.trauma = Math.min(1, this.cam.trauma + (res.killed ? 0.5 : 0.2));
      if (res.killed) this._killMoment(hit, dir);
    }
    return true;
  }

  /** The nape cut: freeze-frame, slow motion, a side-on kill cam, a flash, a crescent of steel, blood and steam. */
  _killMoment(hit, dir) {
    const g = this.game;
    g.hitstop = 0.09;
    g.slowmo = CFG.kill.slowmo; g.slowmoDur = CFG.kill.slowmo;
    g.flash?.(0.55);
    const nape = hit.point.clone();
    g.fx?.blood?.(nape, dir, 3);
    g.fx?.steam?.(nape, Math.max(2, (hit.titan.height || 8) * 0.3), 2.5);
    if (g.fx?.slashArc) {
      _q.copy(g.camera.quaternion).multiply(_q2.setFromAxisAngle(_a.set(0, 0, 1), -0.5));
      g.fx.slashArc(nape, _q, 3.5);
    }
    this.cam.trauma = Math.min(1, this.cam.trauma + 0.6);
    if (hit.titan.kind !== 'dummy' && (g.time - (this._lastKillCam ?? -99)) > CFG.kill.camCooldown) {
      this._lastKillCam = g.time;
      // frame the cut from the side the soldier is passing on
      const toN = _e.subVectors(nape, this.render).setY(0);
      if (toN.lengthSq() < 1e-4) toN.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      toN.normalize();
      const side = _b.crossVectors(UP, toN).normalize().multiplyScalar(this.vel.dot(_b) >= 0 ? 1 : -1);
      g.killCam = { t: 0, dur: CFG.kill.camTime, nape, side: side.clone(), toN: toN.clone(), size: hit.titan.height || 8 };
    }
    g.hud?.message?.(hit.titan.kind === 'dummy' ? 'CUT!' : 'NAPE CUT', 1.1, 'big');
  }

  _camera(dt) {
    const cam = this.game.camera, c = this.cam;
    const speed = this.speed;
    // keyboard camera: in the air the heading eases toward where you are flying (so after whipping round a
    // trunk the view comes with you); the pitch follows the flight path. Mouse look suspends both for a moment.
    const nwCam = this.swooping && this.prey?.alive ? this.prey.napeWorld?.() : null;
    if (this.mouseT > 1.5 && !this.grabbedBy && nwCam?.center) {
      // swooping on a titan: frame its nape (lock-on), so you see the cut coming
      const dx = nwCam.center.x - this.render.x, dz = nwCam.center.z - this.render.z;
      let dy = Math.atan2(dx, dz) - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += dy * damp(3.2, dt);
      const el = Math.atan2(nwCam.center.y - this.render.y, hypot(dx, dz));
      this.pitch += (THREE.MathUtils.clamp(el * 0.7, -0.6, 0.45) - this.pitch) * damp(3, dt);
    } else if (this.mouseT > 1.5 && !this.grabbedBy) {
      const v = this.vel, hs = hypot(v.x, v.z);
      if (!this.grounded && hs > 7 && !this.turn) {
        let dy = Math.atan2(v.x, v.z) - this.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        if (Math.abs(dy) < 2.6) this.yaw += dy * damp(CFG.keys.followRate * Math.min(1.6, hs / 30), dt);
      }
      const vp = speed > 5 ? Math.asin(THREE.MathUtils.clamp(this.vel.y / speed, -1, 1)) : 0;
      const pitchT = this.grounded && !this.odm.attachedCount() ? -0.16 : THREE.MathUtils.clamp(vp * 0.45 - 0.1, -0.55, 0.3);
      this.pitch += (pitchT - this.pitch) * damp(2.2, dt);
    }
    // trauma-based shake
    c.trauma = Math.max(0, c.trauma - dt * 1.4);
    const sh = c.trauma * c.trauma;
    const t = this.game.time;
    const shx = (Math.sin(t * 47.3) + Math.sin(t * 31.1 + 1.3)) * 0.5 * sh, shy = (Math.sin(t * 53.7 + 2.1) + Math.sin(t * 29.3)) * 0.5 * sh;

    const yaw = this.yaw + shx * 0.03, pitch = this.pitch + shy * 0.03;
    const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
    const fwd = _a.set(sy * cp, sp, cy * cp);
    const right = _b.set(-cy, 0, sy);
    const targetDist = CFG.cam.dist + Math.min(speed, 90) * 0.028 + (this.grabbedBy ? 3 : 0);
    c.dist += (targetDist - c.dist) * damp(3, dt);
    // pivot: over the shoulder, a bit higher when standing
    const pivot = _c.copy(this.render).addScaledVector(UP, CFG.cam.height).addScaledVector(right, CFG.cam.side);
    const want = _d.copy(pivot).addScaledVector(fwd, -c.dist);
    // keep the camera out of walls/trees: cast from the body to the wanted spot
    const toCam = _e.subVectors(want, pivot);
    const len = toCam.length();
    toCam.multiplyScalar(1 / len);
    const block = this.game.collision.raycast(pivot, toCam, len + 0.4, { dynamic: false });
    if (block) want.copy(pivot).addScaledVector(toCam, Math.max(0.4, block.distance - 0.4));
    c.pos.copy(want);
    cam.position.copy(c.pos);
    cam.up.copy(UP);
    c.look.copy(pivot).addScaledVector(fwd, 30);
    cam.lookAt(c.look);
    // bank into hard turns (centripetal acceleration from the wire), like an anime camera riding the swing
    let rollT = 0;
    if (this.odm.attachedCount() && !this.grounded) {
      const pd = this.odm.pullDir(this.render, _e);
      if (pd) rollT = THREE.MathUtils.clamp(pd.dot(right) * Math.min(speed, 70) * 0.0035, -0.17, 0.17);
    }
    c.roll += (rollT - c.roll) * damp(3, dt);
    cam.rotateZ(-c.roll + shx * 0.02);
    // FOV opens with speed
    const fovT = CFG.cam.fov + (CFG.cam.fovMax - CFG.cam.fov) * THREE.MathUtils.smoothstep(speed, 12, 85);
    c.fov += (fovT - c.fov) * damp(4, dt);
    if (Math.abs(cam.fov - c.fov) > 0.01) { cam.fov = c.fov; cam.updateProjectionMatrix(); }
    // kill cam: side-on, framing the soldier and the nape, eased in and out (driven by real time in main)
    const kc = this.game.killCam;
    if (kc) {
      const w = Math.min(1, kc.t / 0.12) * Math.min(1, (kc.dur - kc.t) / 0.3);
      if (w > 0) {
        const R = 6 + kc.size * 0.45;
        const mid = _a.copy(this.render).lerp(kc.nape, 0.55);
        const kp = _b.copy(mid).addScaledVector(kc.side, R).addScaledVector(kc.toN, -R * 0.35).addScaledVector(UP, 1.5 + kc.size * 0.08);
        // drift slowly round the cut while time crawls
        kp.addScaledVector(kc.toN, kc.t * 2.5);
        _q.copy(cam.quaternion);
        cam.position.lerp(kp, w);
        cam.lookAt(mid);
        _q2.copy(cam.quaternion);
        cam.quaternion.copy(_q).slerp(_q2, w);
      }
    }
  }

  _audio() {
    const a = this.game.audio;
    if (!a) return;
    a.setReel?.(this.reelLevel);
    a.setGas?.(this.boosting ? 1 : this._dashPuff > 0 ? 0.8 : 0);
    a.setWind?.(this.speed);
    const cam = this.game.camera;
    a.setListener?.(cam.position, _a.set(0, 0, -1).applyQuaternion(cam.quaternion), _b.set(0, 1, 0).applyQuaternion(cam.quaternion));
  }

  _supply(dt) {
    if (!this.infiniteGas && this.odm.gas < 0.25 && !this._lowGasTold) {
      this._lowGasTold = true;
      this.game.hud?.message?.('GAS LOW: supply depots are on the wall top either side of the gate, on the HQ roof and on the forest platform', 4, 'warn');
    }
    if (this.odm.gas > 0.5) this._lowGasTold = false;
    const depots = this.game.world?.supplyDepots;
    if (!depots || !this.alive) return;
    let inside = false;
    for (const d of depots) if (this.render.distanceTo(d.position) < d.radius) { inside = true; break; }
    if (!inside) { this._supplyT = 0; return; }
    const needs = this.odm.gas < 0.98 || this.spares < CFG.combat.spares || this.blade < 0.99 || this.hp < 0.99;
    if (!needs) return;
    this._supplyT = (this._supplyT || 0) + dt;
    if (this._supplyT > 0.8) {
      this.odm.gas = 1; this.spares = CFG.combat.spares; this.blade = 1; this.hp = 1;
      this._supplyT = -2;
      this.game.audio?.refill?.();
      this.game.hud?.message?.('RESUPPLIED — gas, blades and bandages', 2.2, 'info');
    }
  }
}
