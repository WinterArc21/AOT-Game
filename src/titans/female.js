// The Female Titan (Annie Leonhart), as in the 57th Expedition (anime season 1, episodes 17–22). A 14 m Titan that
// thinks: she sprints as fast as a galloping horse, slaps soldiers off the back of her neck, kicks, grabs, and
// hardens her skin, so a blade that reaches her nape shatters on it. Cut her eyes and she sits back covering her
// nape with both hands until one eye heals; cut her arms and they hang limp for a while. She screams to call every
// titan near to her. The mission (src/missions/scout.js) drives her: `mode` is what she does when she is free
// ('hold', 'run' to `runTo`, 'fight' the player), and strike() / bind() / scream() / brawl() script the story.
import * as THREE from 'three';
import { Titan } from './titan.js';
import { toonMaterial } from '../core/style.js';

const V3 = THREE.Vector3;
const clamp = THREE.MathUtils.clamp;
const sm = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const UP = new V3(0, 1, 0);
const ANNIE = { build: 'female', skin: 'pale', hair: 5, expr: 'annie' };
// states the base Titan runs for her (its attacks, grabs and guards); when they end she goes back to her mode
const BASE = new Set(['reach', 'grab', 'chew', 'swat', 'bite', 'stun', 'guard', 'yank', 'shake', 'blind']);
const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3();

let _crystalMat = null;
const crystalMat = () => _crystalMat || (_crystalMat = toonMaterial(0xd4f0ff, { emissive: 0x3d6f8f, transparent: true, opacity: 0.9 }));

export class FemaleTitan extends Titan {
  /** spec/height: another shifter on the same moves (the mission's Eren brawls her with them); he does not harden. */
  constructor(mgr, { position, yaw = 0, spec = null, height = 14 } = {}) {
    super(mgr, { kind: 'normal', height, position, yaw, spec: spec || ANNIE });
    this.female = !spec;
    this.hardens = !spec;
    this.name = spec ? 'Eren' : 'the Female Titan';
    this.napeHp = Infinity;                 // nobody cuts this nape: it hardens first
    this.runSpeed = 15.5; this.walkSpeed = 3.4; this.turnRate = 2.4; this.noticeRange = 400;
    this.mode = 'hold'; this.runTo = new V3(); this.faceTo = null; this.paceMul = 1;
    this.eyeHeal = 14;                      // s a blinded eye takes to heal
    this.limp = [0, 0];                     // s each arm hangs limp after its muscles are cut
    this.hard = { nape: 0, napeT: 0, fist: [0, 0], always: false };
    this.screamT = 0; this.cdKick = 2; this.eatenHp = 160;
    this.tiltBias = 0;                      // no dull titan head-tilt: a level, steady stare
    this.jawCap = 0.03;                     // mouth shut; opened only to bite, scream, or with Eren in it (_poseState)
    this._squadBy = 99;                     // comrades' AI pairs never pick her: the mission scripts the squad
    // crystal: the nape and both fists harden over (white-blue, faceted)
    const ico = new THREE.IcosahedronGeometry(1, 0);
    this.crystal = {
      nape: this._crystal(ico, this.J.head, this.d.napeC, [0.62, 0.62, 0.46]),
      fist: [0, 1].map((i) => this._crystal(ico, this.J[i ? 'handR' : 'handL'], new V3(0, -0.1, 0), [0.62 * this.d.handS, 0.62 * this.d.handS, 0.62 * this.d.handS])),
    };
  }

  _crystal(geo, parent, at, scl) {
    const m = new THREE.Mesh(geo, crystalMat());
    m.position.copy(at); m.userData.s = new V3(...scl); m.scale.setScalar(0.001); m.visible = false;
    m.castShadow = false; m.raycast = () => {};
    parent.add(m);
    return m;
  }

  // ------------------------------------------------------------------ the mission's handles
  setMode(mode) { this.mode = mode; if (!BASE.has(this.state) && this.state !== 'strike' && this.state !== 'bound' && this.state !== 'cover') this._enter(mode); }
  /** Held fast by the harpoons (the special target restraining weapon): standing, both hands over the hardened nape. */
  bind(on = true) { this.bound = on; this.act = null; this._releasePlayer(); this.hard.always = on; this._enter(on ? 'bound' : this.mode); }
  scream(dur = 4.5) {
    this.screamT = dur;
    this.game.audio?.titanGroan?.(this.position, 60);
    this.game.events?.emit?.('female:scream', { titan: this });
  }
  /**
   * A scripted blow: kind 'hand' (a swipe), 'punch' (a hardened fist), 'kick' (a roundhouse), 'stomp' or 'bite'.
   * get() → the world point it goes for (followed through the wind-up); onHit(point) when it lands (sure: it
   * always lands at the strike's midpoint, for the story's deaths). Returns false while she is busy.
   */
  strike(kind, get, onHit, { side = null, sure = false, W = null, run = false } = {}) {
    if (this.state === 'strike' || this.state === 'bound' || this.dying || !this.alive) return false;
    const pt = get().clone();
    const left = _a.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const s = side ?? (_b.subVectors(pt, this.position).dot(left) >= 0 ? 0 : 1);
    const k = kind === 'kick' || kind === 'stomp' ? { W: 0.36, S: 0.3, R: 0.55 } : kind === 'bite' ? { W: 0.45, S: 0.22, R: 0.7 } : { W: 0.3, S: 0.24, R: 0.5 };
    this.act = { kind, side: s, t: 0, W: W ?? k.W, S: k.S, R: k.R, get, onHit, sure, run, hit: false, pt, from: null };
    this._enter('strike');
    if (kind === 'punch' && this.hardens) this.hard.fist[s] = 1;
    this._windupEvent(kind === 'kick' || kind === 'stomp' ? 'swat' : kind, this.act.W);
    return true;
  }
  /** Bound, the titans her scream called can get at her (Titan._thinkEscort: they maul a `drawnTo` target). */
  get vulnerable() { return !!this.bound && this.alive; }
  hurt(damage) {
    if (!this.vulnerable) return;
    this.eatenHp -= damage;
    if (this.rnd() < 0.4) this.game.fx?.blood?.(this._jpos('spine', _a), _b.set(0, 1, 0), 1.6);
    this.game.events?.emit?.('female:eaten', { titan: this, left: this.eatenHp });
  }
  /** Face another titan and trade blows (Eren); the mission calls strike('punch' | 'kick') on her. */
  brawl(foe) { this.foe = foe; this.mode = 'brawl'; if (this.state !== 'strike') this._enter('brawl'); }

  // ------------------------------------------------------------------ hits
  applyHit(o = {}) {
    if (!this.alive) return { killed: false, effect: 'none' };
    const pt = o.point || this._headWorld(new V3());
    let part = o.part;
    // a cut across her jaw: the mission frees Eren from her mouth with it
    if ((part === 'head' || part === 'body' || part === 'eye' || part === 'torso') && this.mouthOpenable && this._mouthWorld(_a).distanceTo(pt) < 0.22 * this.height) {
      this.game.events?.emit?.('female:mouth', { titan: this, damage: o.damage });
      this.game.fx?.blood?.(pt, _b.set(0, 1, 0), 1.6);
      this.flinch = 1;
      return { killed: false, effect: 'mouth' };
    }
    if (part === 'nape' && this.hardens) {
      // hardened: the steel shatters on crystal (a reflex: it closes over the nape as the blade comes)
      this.hard.nape = 1; this.hard.napeT = 5;
      this.crystal.nape.visible = true;
      this.game.fx?.sparks?.(pt, _b.set(0, 1, 0), 22);
      this.game.audio?.bladeBreak?.();
      this.game.events?.emit?.('female:hardened', { titan: this, point: pt });
      return { killed: false, effect: 'hardened', shatter: true };
    }
    if ((part === 'arm' || part === 'hand') && (o.damage || 0) >= 40) {
      const side = this._sideOfPoint(pt);
      this.limp[side] = 16;
      this.flinch = 1;
      this.game.fx?.blood?.(pt, o.dir || _b.set(0, 1, 0), 1.8);
      this.game.fx?.steam?.(pt, 2, 3);
      if (this.state === 'grab' && this.act?.side === side) { this._releasePlayer(); this._setFist(side, false); this.act = null; this._enter(this.mode); }
      if (this.state === 'strike' && this.act?.side === side && (this.act.kind === 'hand' || this.act.kind === 'punch')) { this.act = null; this._enter(this.mode); }
      this.game.events?.emit?.('female:hit', { titan: this, part: 'arm', effect: 'limp', side });
      return { killed: false, effect: 'limp' };
    }
    const r = super.applyHit({ ...o, part });
    if (r.effect === 'blind') this.blindT = this.eyeHeal;
    if (r.effect !== 'none') this.game.events?.emit?.('female:hit', { titan: this, part, effect: r.effect });
    return r;
  }

  /** Blinded: she sits back (against a tree if one is there) with both hands over her nape until an eye heals. */
  _onBlinded() {
    if (this.state === 'grab') this._releasePlayer();
    this._setFist(0, false); this._setFist(1, false);
    this.game.audio?.titanGroan?.(this.position, this.height);
    if (this.state === 'bound') return;
    this.act = null;
    this._enter('cover');
  }

  // ------------------------------------------------------------------ AI
  _timers(dt) {
    super._timers(dt);
    for (let i = 0; i < 2; i++) {
      if (this.limp[i] > 0 && (this.limp[i] -= dt) <= 0) { this.limp[i] = 0; this.game.fx?.steam?.(this._jpos(i ? 'armR' : 'armL', _a), 2.5, 2); }
      if (!(this.state === 'strike' && this.act?.kind === 'punch' && this.act.side === i)) this.hard.fist[i] = Math.max(0, this.hard.fist[i] - dt * 1.5);
    }
    this.cdKick -= dt;
    if (this.screamT > 0) this.screamT -= dt;
    // the nape hardens as a soldier closes in behind it, and stays hard a few seconds after
    const pl = this.game.player, H = this.hard;
    let want = H.always;
    if (!want && pl?.alive && this.hardens) {
      const nw = this.napeWorld(), r = _a.subVectors(pl.position, nw.center), d = r.length();
      if (d < 10 && r.dot(nw.normal) > -0.2 * d) want = true;
    }
    if (want) H.napeT = 4;
    H.napeT -= dt;
    const tgt = H.napeT > 0 ? 1 : 0;
    H.nape += (tgt - H.nape) * Math.min(1, dt * (tgt ? 9 : 1.2));
    const show = (m, k) => {
      m.visible = k > 0.02;
      if (m.visible) m.scale.copy(m.userData.s).multiplyScalar(0.3 + 0.7 * k);
    };
    show(this.crystal.nape, H.nape); show(this.crystal.fist[0], H.fist[0]); show(this.crystal.fist[1], H.fist[1]);
  }

  _think(dt) {
    const pl = this.game.player;
    if (BASE.has(this.state)) {
      super._think(dt);
      if (this.state === 'chase' || this.state === 'idle' || this.state === 'wander') this._enter(this.mode);
      return;
    }
    this.stateT += dt;
    this.speedTarget = 0; this.goal = null; this.faceYaw = null;
    this.gazeTarget = this.hasPlayer && this.dist3 < 150 ? pl.position : null;
    if (this.lookAt) this.gazeTarget = this.lookAt;      // the mission makes her look at someone (Armin's face)
    switch (this.state) {
      case 'strike': this._thinkStrike(dt); break;
      case 'bound':
        this.gazeTarget = this.screamT > 0 ? null : this.gazeTarget;
        break;
      case 'cover':
        // blind, sat back with her hands over the nape, until an eye heals
        this.gazeTarget = null;
        if (this.blindT <= 0) { this._enter(this.mode); this.game.events?.emit?.('female:sees', { titan: this }); }
        break;
      case 'brawl': {
        const f = this.foe;
        if (!f) { this._enter('hold'); break; }
        this.faceYaw = Math.atan2(f.position.x - this.position.x, f.position.z - this.position.z);
        this.gazeTarget = f._headWorld(_d);
        const dist = f.position.distanceTo(this.position);
        if (dist > this.footR + f.footR + 9) { this.goal = f.position; this.speedTarget = this.walkSpeed * 1.6; }
        break;
      }
      case 'run': {
        this.goal = this.runTo;
        this.speedTarget = this.crippleT > 0 ? 0 : this.runSpeed * this.paceMul;
        const dx = this.runTo.x - this.position.x, dz = this.runTo.z - this.position.z;
        this.arrived = dx * dx + dz * dz < 64;
        if (this.arrived) this.speedTarget = 0;
        this._defend(dt);
        break;
      }
      case 'fight': {
        if (this.hasPlayer) {
          this.goal = pl.position;
          this.speedTarget = this.crippleT > 0 ? 0 : this.distH > this.armLen * 1.4 ? this.runSpeed * 0.7 * this.paceMul : this.walkSpeed * 0.3;
        }
        this._defend(dt);
        break;
      }
      case 'hold':
        if (this.faceTo) this.faceYaw = Math.atan2(this.faceTo.x - this.position.x, this.faceTo.z - this.position.z);
        if (this.hasPlayer && this.dist3 < this.height * 1.6) this._defend(dt);
        break;
      default: this._enter(this.mode);   // (her first frame: the base Titan starts 'idle')
    }
  }

  /** Answer a soldier close to her: guard the nape, kick one at her legs, swat or grab one in front. */
  _defend(dt) {
    const pl = this.game.player;
    if (!this.hasPlayer || pl.grabbedBy || this.blindT > 0) return false;
    if (this._tryGuard(dt)) return true;
    // a roundhouse at a soldier low beside or in front of her (on horseback, or on the ground)
    const rel = pl.position.y - this.position.y;
    if (this.cdKick <= 0 && this.distH < this.armLen * 1.15 && rel < this.shoulderH * 0.6 && Math.abs(this.relYaw) < 1.9 && this.rnd() < dt * 2.5) {
      this.cdKick = 3.5 + this.rnd() * 2;
      return this.strike('kick', () => pl.position, (p) => this._kickPlayer(p));
    }
    this._chooseAttack(Math.max(0.7, Math.sqrt(this.height / 7)));
    return this.state !== 'run' && this.state !== 'fight' && this.state !== 'hold';
  }
  _kickPlayer(foot) {
    const pl = this.game.player;
    if (!pl.alive || pl.grabbedBy || foot.distanceTo(pl.position) > 3.2) return;
    const d = _a.subVectors(pl.position, this.position).setY(0);
    if (d.lengthSq() < 1e-4) d.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    d.normalize().multiplyScalar(30); d.y = 9;
    for (const h of pl.odm?.hooks || []) if (h.attached) pl.odm.release(h.side);
    if (pl.riding) pl.riding.crashed = Math.max(16, pl.riding.speed + 6);
    pl.applyImpulse?.(d, 45);
    this.game.fx?.impact?.(foot, UP, 'flesh');
    this.game.audio?.titanStep?.(foot, this.height * 0.7);
    this.game.events?.emit?.('player:kicked', { titan: this });
  }

  _thinkStrike(dt) {
    const a = this.act;
    if (!a) { this._enter(this.mode); return; }
    a.t += dt;
    if (a.t < a.W) a.pt.copy(a.get());
    this.faceYaw = Math.atan2(a.pt.x - this.position.x, a.pt.z - this.position.z);
    if (a.kind === 'kick') this.faceYaw += (a.side === 0 ? -1 : 1) * 0.5;   // a roundhouse comes round from the side
    this.gazeTarget = a.pt;
    if (a.run) { this.goal = a.pt; this.speedTarget = this.runSpeed * 0.6; }
    if (!a.hit && a.t > a.W) {
      const eff = this._effector(a, _b);
      if (eff.distanceTo(a.pt) < 0.2 * this.height + 1.5 || (a.sure && a.t > a.W + a.S * 0.6)) {
        a.hit = true;
        a.onHit?.(a.sure ? a.pt.clone() : eff.clone());
      }
    }
    if (a.t > a.W + a.S + a.R) { this.act = null; this.kickW = 0; this.cdAttack = 1 + this.rnd(); this._enter(this.mode); }
  }
  /** The part of her that lands the blow (world). */
  _effector(a, out) {
    if (a.kind === 'kick' || a.kind === 'stomp') return this._jpos(a.side ? 'footR' : 'footL', out);
    if (a.kind === 'bite') return this._mouthWorld(out);
    return this._jpos(a.side ? 'handR' : 'handL', out);
  }

  // ------------------------------------------------------------------ pose
  _poseState(dt) {
    const P = this.P, st = this.state, sgn = (i) => (i === 0 ? 1 : -1);
    this.kickW = 0; this.sitting = false;
    if (this.carrying) this.jawExtra += 0.16;   // Eren in her mouth
    this.jawCap = this.carrying || this.screamT > 0 || this.mouthOpenable || (st === 'strike' && this.act?.kind === 'bite') || BASE.has(st) ? null : 0.03;
    if (this.screamT > 0) {
      // head thrown back, jaw wide, arms out: the scream that calls the titans
      const k = sm(Math.min(this.screamT, 0.6) / 0.6);
      P.head[0] -= 0.75 * k; P.neck[0] -= 0.35 * k; P.spine[0] -= 0.12 * k; this.jawExtra += 0.95 * k;
    }
    switch (st) {
      case 'strike': this._poseStrike(dt); break;
      case 'bound': this._poseCover(1, 0.15); break;
      case 'cover': this._poseCover(1, 1); break;
      case 'brawl': // fists up, guard high, weight on the back foot: Annie's stance
        P.spine[0] += 0.08;
        for (let i = 0; i < 2; i++) {
          const sh = this._jpos(i ? 'armR' : 'armL', _a), f = _c.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
          _b.copy(sh).addScaledVector(f, this.armLen * (i ? 0.45 : 0.6)).addScaledVector(UP, this.armLen * 0.25)
            .addScaledVector(_d.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)), sgn(i) * -0.2 * this.armLen);
          this._arm(i, _b, this._pole(i, 0.7, -0.8, 0), 12);
        }
        P.thighL[0] -= 0.25; P.shinL[0] += 0.3; P.thighR[0] += 0.15;
        break;
      case 'hold':
        if (this.reachTo) {
          // stooped low over a soldier on the ground, one hand reaching down to them (lifting Armin's hood)
          P.spine[0] += 0.55; P.neck[0] += 0.3; P.head[0] += 0.2;
          P.thighL[0] -= 0.35; P.thighR[0] -= 0.35; P.shinL[0] += 0.6; P.shinR[0] += 0.6; this.hipT.y -= this.d.hipY * 0.12;
          this._arm(1, this.reachTo, this._pole(1, 0.8, -0.4, -0.3), 5);
          break;
        }
        super._poseState(dt);
        break;
      default:
        if (st === 'run' && this.speed > 8) { P.foreL[0] -= 1.0; P.foreR[0] -= 1.0; P.spine[0] += 0.06; }   // sprinting: elbows bent, arms pumping
        super._poseState(dt);
    }
    // arms whose muscles were cut hang down at her sides
    for (let i = 0; i < 2; i++) if (this.limp[i] > 0) {
      this.ik[i].wT = 0;
      const n = i ? 'R' : 'L';
      P['arm' + n][0] = 0.1; P['arm' + n][1] = 0; P['arm' + n][2] = sgn(i) * 0.12; P['fore' + n][0] = -0.05;
      if (this.fist[i]) this._setFist(i, false);
    }
  }

  /** Both hands clamped over the back of her neck (the hardened nape under them). sit: 0 standing … 1 sat back. */
  _poseCover(cover, sit) {
    const P = this.P;
    const nw = this.napeWorld();
    for (let i = 0; i < 2; i++) {
      if (this.limp[i] > 0) continue;
      _b.copy(nw.center).addScaledVector(nw.normal, 0.06 * this.height)
        .addScaledVector(_a.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)), (i ? -1 : 1) * 0.05 * this.height);
      this._arm(i, _b, this._pole(i, 1, 0.3, 0.5), 10);
    }
    P.head[0] += 0.35 * cover; P.neck[0] += 0.2 * cover; P.spine[0] += 0.12 * cover;
    if (sit > 0) {
      // sat back on her heels, the knees up
      P.thighL[0] -= 1.2 * sit; P.thighR[0] -= 1.2 * sit; P.shinL[0] += 1.9 * sit; P.shinR[0] += 1.9 * sit;
      P.footL[0] -= 0.4 * sit; P.footR[0] -= 0.4 * sit;
      this.hipT.y -= this.d.hipY * 0.55 * sit;
    }
    this.sitting = sit > 0;
  }

  _poseStrike() {
    const P = this.P, a = this.act;
    if (!a) return;
    const i = a.side, sg = i === 0 ? 1 : -1, A = this.armLen;
    const wind = sm(a.t / a.W), hitK = sm((a.t - a.W) / a.S), back = sm((a.t - a.W - a.S) / a.R);
    const out = hitK * (1 - back);
    if (a.kind === 'hand' || a.kind === 'punch') {
      const sh = this._jpos(i ? 'armR' : 'armL', _a);
      const f = _c.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      // cocked back and up, then driven at the point (clamped to her reach)
      _b.copy(sh).addScaledVector(f, -0.35 * A).addScaledVector(UP, 0.3 * A);
      _d.subVectors(a.pt, sh); const l = _d.length(); if (l > 0.98 * A) _d.multiplyScalar(0.98 * A / l);
      _d.add(sh);
      _b.lerp(_d, a.t < a.W ? 0 : out);
      this._arm(i, _b, this._pole(i, 0.8, -0.4, -0.3), a.t < a.W ? 10 : 26);
      P.spine[1] += sg * (0.35 * wind - 0.7 * out); P.spine[0] += 0.15 * out;
      if (a.kind === 'punch') this._setFist(i, true);
      if (back > 0.9 && this.fist[i]) this._setFist(i, false);
      return;
    }
    if (a.kind === 'bite') {
      const k = wind * (1 - back);
      P.spine[0] += 0.55 * k; P.neck[0] += 0.4 * k; P.head[0] += 0.2 * k;
      this.jawExtra += a.t < a.W ? 0.9 * wind : 0.9 * (1 - hitK);
      return;
    }
    // kick / stomp: the leg is freed from the foot planting (see _plantLegs) and swung round
    const n = i ? 'R' : 'L';
    this.kickLeg = i;
    this.kickW = sm(a.t / (a.W * 0.6)) * (1 - back);
    if (a.kind === 'kick') {
      // the roundhouse: chamber the knee, pivot on the standing foot, snap the shin round at the head of the swing
      P['thigh' + n][0] -= 1.15 * wind + 0.35 * out;
      P['thigh' + n][2] += sg * (0.55 * wind + 0.5 * out);
      P['shin' + n][0] += 1.6 * wind * (1 - out) + 0.15;
      P.pelvis[1] += -sg * 0.9 * out; P.spine[1] += sg * 0.5 * out;
      P.spine[2] += sg * 0.35 * this.kickW;
      P.armL[2] += 0.5 * this.kickW; P.armR[2] -= 0.5 * this.kickW;
    } else {
      // stomp: knee high, then the sole driven down
      P['thigh' + n][0] -= 1.4 * wind * (1 - hitK) + 0.5 * out;
      P['shin' + n][0] += 1.7 * wind * (1 - hitK) + 0.2;
      P.spine[0] += 0.15 * out;
    }
  }

  /** The kicking leg keeps its swing; the other stays planted. */
  _plantLegs(dt) {
    const k = this.kickW || 0, n = this.kickLeg ? 'R' : 'L';
    const th = this.J['thigh' + n], sh = this.J['shin' + n], ft = this.J['foot' + n];
    let s0, s1, s2;
    if (k > 0.01) { s0 = th.quaternion.clone(); s1 = sh.quaternion.clone(); s2 = ft.quaternion.clone(); }
    // sat back on her heels, the legs keep the pose: the planting only runs on its feet (it reads crippleT for that)
    const cr = this.crippleT;
    if (this.sitting) this.crippleT = 1;
    super._plantLegs(dt);
    this.crippleT = cr;
    if (k > 0.01) {
      th.quaternion.slerp(s0, k); sh.quaternion.slerp(s1, k); ft.quaternion.slerp(s2, k);
      this.root.updateMatrixWorld(true);
    }
  }

  _updateThreat(dt) {
    super._updateThreat(dt);
    if (this.state === 'strike' && this.act?.get) this.threat = Math.max(this.threat, this.act.t < this.act.W + this.act.S ? 0.9 : 0.3);
  }

  dispose() {
    super.dispose();
    this.foe = null;
  }
}

/** Spawn her into the titan list (ropes, cuts, the HUD's threat markers all see her). */
export function spawnFemale(mgr, position, yaw, o = {}) {
  const t = new FemaleTitan(mgr, { position, yaw, ...o });
  mgr.titans.push(t);
  mgr.group.add(t.root);
  return t;
}

