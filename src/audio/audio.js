// Wings of Freedom — audio engine. Everything is synthesised at runtime with the Web Audio API
// (no audio files). Every public method is safe to call before init() and when audio is unavailable.
//
//   const audio = new Audio();  audio.init();                     // first user gesture
//   audio.setListener(pos, fwd, up)                                // every frame (THREE.Vector3-like {x,y,z})
//   audio.hookFire(side) hookHit(material[, pos]) hookRetract(side) hookMiss()
//   audio.setReel(0..1) setGas(0..1) setWind(m/s)                  // continuous loops, call every frame
//   audio.slash(hit) napeKill() bladeBreak() bladeSwap() refill() impact(0..1) land(0..1) grabbed() eaten() hurt()
//   audio.titanStep|titanGroan|titanFall|steamHiss(pos, sizeMetres) colossalAppear()
//   audio.setMusic(0..1)  toggleMute() -> muted
//
// Graph:  one-shots/loops -> sfx bus ┐                                   ┌ reverb send (generated IR, ~2.5 s)
//         music layers -> music bus ─┴-> compressor -> soft clip -> mute gain -> destination
// Files: dsp.js (helpers, Rig), sfx.js (one-shots), loops.js (reel/gas/wind), music.js (score), this file (engine).
import { Rig, clamp, noiseBuffer, impulseResponse, satCurve } from './dsp.js';
import { ReelLoop, GasLoop, WindLoop } from './loops.js';
import { Music } from './music.js';
import * as sfx from './sfx.js';

const MUSIC_LEVEL = 0.06;
// Minimum seconds between two one-shots of a category (protects against per-frame retriggering).
const MIN_GAP = { thump: 0.07, slash: 0.07, hurt: 0.25, grab: 0.6, eaten: 1, kill: 0.12, swap: 0.15, refill: 0.5, break: 0.15, groan: 0.12, colossal: 3 };

export class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.strict = false; // dev: rethrow synthesis errors instead of logging one warning
    this.music = null;

    this.lpos = { x: 0, y: 0, z: 0 };
    this.lfwd = { x: 0, y: 0, z: -1 };
    this.lup = { x: 0, y: 1, z: 0 };

    this._offline = false;
    this._active = Object.create(null);
    this._last = Object.create(null);
    this._total = 0;
    this._hrtf = 0;
    this._fresh = [];
    this._warned = false;
    this._lastResume = 0;
    this._pendingMusic = 0;
    this._pendingLoops = { reel: 0, gas: 0, wind: 0 };
  }

  // ───────────────────────────────────────────────────────────────────────── lifecycle

  /**
   * Create the AudioContext and the whole graph. Call from a user gesture. Idempotent; returns true when audio works.
   * opts.context: use this (Offline)AudioContext instead of creating one (tests); opts.manual: do not start timers.
   */
  init(opts = {}) {
    if (this.ready) {
      this._resumeMaybe(true);
      return true;
    }
    try {
      const Ctor = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
      const ctx = opts.context || (Ctor ? new Ctor({ latencyHint: 'interactive' }) : null);
      if (!ctx) return false;
      this.ctx = ctx;
      this._offline = !!opts.context && typeof ctx.startRendering === 'function';

      // noise sources
      this.noise = {
        white: noiseBuffer(ctx, 'white', 3),
        pink: noiseBuffer(ctx, 'pink', 5),
        brown: noiseBuffer(ctx, 'brown', 5),
      };
      this.satHard = satCurve(3.5);

      // master chain: buses -> compressor (limiter-ish) -> soft clip -> mute gain -> destination
      this.sfx = ctx.createGain();
      this.sfx.gain.value = 0.9;
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = MUSIC_LEVEL;
      const pre = ctx.createGain();
      pre.gain.value = 1;
      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -16;
      this.comp.knee.value = 10;
      this.comp.ratio.value = 8;
      this.comp.attack.value = 0.003;
      this.comp.release.value = 0.2;
      const makeup = ctx.createGain();
      makeup.gain.value = 1.1;
      const clip = ctx.createWaveShaper();
      clip.curve = satCurve(0.9);
      clip.oversample = '2x';
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.sfx.connect(pre);
      this.musicBus.connect(pre);
      pre.connect(this.comp); this.comp.connect(makeup); makeup.connect(clip); clip.connect(this.master);
      this.master.connect(ctx.destination);

      // outdoor-ish reverb send for big sounds (generated impulse response, ~2.5 s)
      this.conv = ctx.createConvolver();
      this.conv.buffer = impulseResponse(ctx, 2.6, { rt60: 2.3, pre: 0.012, bright: 0.85, dark: 0.2, slap: true, early: true });
      this.revIn = ctx.createGain();
      this.revIn.gain.value = 1;
      const revOut = ctx.createGain();
      revOut.gain.value = 0.85;
      this.revIn.connect(this.conv); this.conv.connect(revOut); revOut.connect(this.sfx);

      // analyser for dev tooling
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.6;
      clip.connect(this.analyser);

      // listener
      this._applyListener();

      // continuous loops (created once)
      this.reelLoop = new ReelLoop(this);
      this.gasLoop = new GasLoop(this);
      this.windLoop = new WindLoop(this);

      this.music = new Music(this);
      this.ready = true;
      if (!opts.manual) this.music.start();

      this.reelLoop.set(this._pendingLoops.reel);
      this.gasLoop.set(this._pendingLoops.gas);
      this.windLoop.set(this._pendingLoops.wind);

      if (!this._offline) {
        this._resumeMaybe(true);
        if (ctx.state !== 'running') this._armGestureResume();
        this._watchVisibility();
      }
      return true;
    } catch (e) {
      console.warn('[audio] unavailable:', e);
      this.ready = false;
      if (this.music) this.music.stop();
      try { if (this.ctx && !opts.context) this.ctx.close(); } catch (e2) { /* ignore */ }
      this.ctx = null;
      this.music = null;
      return false;
    }
  }

  get state() {
    return this.ctx ? this.ctx.state : 'none';
  }

  _running() {
    return this.ready && (this._offline || this.ctx.state === 'running');
  }

  _resumeMaybe(force = false) {
    const ctx = this.ctx;
    if (!ctx || this._offline || this._hidden || ctx.state === 'running' || ctx.state === 'closed') return;
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!force && nowMs - this._lastResume < 1000) return;
    this._lastResume = nowMs;
    try {
      const p = ctx.resume();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* ignore */ }
  }

  /** Silence everything while the tab is hidden (the game loop stops, so loops would otherwise hang on their last value). */
  _watchVisibility() {
    if (this._visWatch || typeof document === 'undefined') return;
    this._visWatch = true;
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx || this._offline) return;
      if (document.hidden) {
        this._hidden = true;
        try { this.ctx.suspend(); } catch (e) { /* ignore */ }
      } else {
        this._hidden = false;
        this._resumeMaybe(true);
      }
    });
  }

  _armGestureResume() {
    if (this._gestureArmed || typeof window === 'undefined') return;
    this._gestureArmed = true;
    const evs = ['pointerdown', 'keydown', 'touchstart', 'mousedown'];
    const go = () => {
      this._resumeMaybe(true);
      if (this.ctx.state === 'running') {
        for (const e of evs) window.removeEventListener(e, go, true);
        this._gestureArmed = false;
      }
    };
    for (const e of evs) window.addEventListener(e, go, true);
  }

  // ───────────────────────────────────────────────────────────────────────── plumbing used by sfx/music

  /** Allocate a one-shot rig in category `cat` (at most `max` alive at once); null when audio is off or the voice cap is hit. */
  _rig(cat, max = 8) {
    if (!this._running()) return null;
    if ((this._active[cat] | 0) >= max || this._total >= 90) return null;
    const gap = MIN_GAP[cat];
    if (gap) {
      const t = this.ctx.currentTime;
      if (t - (this._last[cat] || -9) < gap) return null; // retriggering faster than this just smears into noise
      this._last[cat] = t;
    }
    const r = new Rig(this, cat);
    this._active[cat] = (this._active[cat] | 0) + 1;
    this._total++;
    this._fresh.push(r);
    return r;
  }

  _release(r) {
    if (!r.cat) return;
    this._active[r.cat]--;
    this._total--;
  }

  /** Output stage for a one-shot: gain -> (stereo pan) -> bus (default sfx, or `to`), plus a reverb send. */
  _dest(r, o = {}) {
    const g = r.gain(o.vol == null ? 1 : o.vol);
    let n = g;
    if (o.pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = clamp(o.pan, -1, 1);
      r.nodes.push(p);
      g.connect(p);
      n = p;
    }
    n.connect(o.to || this.sfx);
    if (o.rev > 0) {
      const s = r.gain(o.rev * (o.revScale == null ? 1 : o.revScale));
      n.connect(s);
      s.connect(this.revIn);
    }
    return g;
  }

  /**
   * Spatialise a one-shot at world position `pos` for a source of `size` metres. Returns { in, g, d, rev } where `in`
   * is the node to feed (air-absorption lowpass -> PannerNode -> sfx bus), or null when too far to be audible.
   */
  _place(r, pos, size, { ref, rolloff = 1, cut = 0.004, air = 8000 } = {}) {
    const has = pos && Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z);
    const l = this.lpos;
    const d = has ? Math.hypot(pos.x - l.x, pos.y - l.y, pos.z - l.z) : 30;
    ref = ref == null ? clamp(size * 1.6, 3, 80) : ref;
    const g = ref / (ref + rolloff * Math.max(0, d - ref));
    if (g < cut) return null;
    const lp = r.filter('lowpass', clamp(air / (1 + d / 140), 500, 18000), 0.5);
    if (has) {
      const hrtf = this._hrtf < 8;
      if (hrtf) {
        this._hrtf++;
        r.onDispose(() => { this._hrtf--; });
      }
      const p = this.ctx.createPanner();
      p.panningModel = hrtf ? 'HRTF' : 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = ref;
      p.maxDistance = 20000;
      p.rolloffFactor = rolloff;
      if (p.positionX) {
        p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
      } else p.setPosition(pos.x, pos.y, pos.z);
      r.nodes.push(p);
      lp.connect(p);
      p.connect(this.sfx);
    } else lp.connect(this.sfx);
    return { in: lp, g, d, rev: clamp(g * 1.6, 0.12, 1) };
  }

  /** Briefly pull the music down (e.g. under the Colossal's arrival). */
  _duckMusic(amount = 0.4, attack = 0.2, hold = 3) {
    if (!this.musicBus) return;
    const g = this.musicBus.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(MUSIC_LEVEL * amount, t, attack / 3);
    g.setTargetAtTime(MUSIC_LEVEL, t + hold, 0.9);
  }

  _applyListener() {
    const L = this.ctx.listener;
    const p = this.lpos, f = this.lfwd, u = this.lup;
    if (L.positionX) {
      L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z;
      L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z;
      L.upX.value = u.x; L.upY.value = u.y; L.upZ.value = u.z;
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  _run(fn, ...args) {
    if (!this.ready) return;
    try {
      this._fresh.length = 0;
      fn(this, ...args);
      for (const r of this._fresh) r.seal();
    } catch (e) {
      for (const r of this._fresh) r.abort();
      if (this.strict) throw e;
      if (!this._warned) {
        this._warned = true;
        console.warn('[audio] error in', fn.name, e);
      }
    } finally {
      this._fresh.length = 0;
    }
  }

  // ───────────────────────────────────────────────────────────────────────── contract API

  setListener(position, forward, up) {
    const l = this.lpos, f = this.lfwd, u = this.lup;
    if (position && Number.isFinite(position.x + position.y + position.z)) { l.x = position.x; l.y = position.y; l.z = position.z; }
    if (forward && Number.isFinite(forward.x + forward.y + forward.z) && forward.x * forward.x + forward.y * forward.y + forward.z * forward.z > 1e-8) { f.x = forward.x; f.y = forward.y; f.z = forward.z; }
    if (up && Number.isFinite(up.x + up.y + up.z) && up.x * up.x + up.y * up.y + up.z * up.z > 1e-8) { u.x = up.x; u.y = up.y; u.z = up.z; }
    if (!this.ready) return;
    try {
      this._resumeMaybe();
      this._applyListener();
    } catch (e) {
      if (this.strict) throw e;
    }
  }

  // ODM gear
  hookFire(side) { this._run(sfx.hookFire, side); }
  hookHit(material, position) { this._run(sfx.hookHit, material, position); }
  hookRetract(side) { this._run(sfx.hookRetract, side); }
  hookMiss() { this._run(sfx.hookMiss); }

  // continuous loops
  setReel(level) {
    this._pendingLoops.reel = level;
    if (this.ready) this._guard(() => this.reelLoop.set(level));
  }
  setGas(level) {
    this._pendingLoops.gas = level;
    if (this.ready) this._guard(() => this.gasLoop.set(level));
  }
  setWind(speed) {
    this._pendingLoops.wind = speed;
    if (this.ready) this._guard(() => this.windLoop.set(speed));
  }

  // combat
  slash(hit) { this._run(sfx.slash, !!hit); }
  napeKill() { this._run(sfx.napeKill); }
  bladeBreak() { this._run(sfx.bladeBreak); }
  bladeSwap() { this._run(sfx.bladeSwap); }
  refill() { this._run(sfx.refill); }
  impact(strength) { this._run(sfx.impact, strength); }
  land(strength) { this._run(sfx.land, strength); }
  grabbed() { this._run(sfx.grabbed); }
  eaten() { this._run(sfx.eaten); }
  hurt() { this._run(sfx.hurt); }

  // titans (3D)
  titanStep(position, size) { this._run(sfx.titanStep, position, size); }
  titanGroan(position, size) { this._run(sfx.titanGroan, position, size); }
  titanFall(position, size) { this._run(sfx.titanFall, position, size); }
  steamHiss(position, size) { this._run(sfx.steamHiss, position, size); }
  colossalAppear() { this._run(sfx.colossalAppear); }

  // music / mute
  setMusic(intensity) {
    const i = clamp(Number.isFinite(intensity) ? intensity : 0, 0, 1);
    this._pendingMusic = i;
    if (this.ready && this.music) this._guard(() => this.music.setIntensity(i));
  }

  /** Toggle mute for everything; returns the new muted state. */
  toggleMute() {
    return this.setMuted(!this.muted);
  }

  setMuted(m) {
    this.muted = !!m;
    if (this.ready) {
      this._guard(() => {
        const g = this.master.gain;
        const t = this.ctx.currentTime;
        g.cancelScheduledValues(t);
        g.setTargetAtTime(this.muted ? 0 : 1, t, 0.03);
      });
    }
    return this.muted;
  }

  _guard(fn) {
    try {
      fn();
    } catch (e) {
      if (this.strict) throw e;
      if (!this._warned) {
        this._warned = true;
        console.warn('[audio]', e);
      }
    }
  }
}

export default Audio;
