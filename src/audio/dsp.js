// Shared DSP helpers for the audio engine: maths, noise / impulse-response generation, and `Rig`,
// a tiny builder that creates one-shot node graphs and disconnects every node once the last source ends.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Loopable mono noise buffer ('white' | 'pink' | 'brown'), RMS-normalised to ~0.3, with an equal-power crossfaded seam.
 */
export function noiseBuffer(ctx, kind, seconds) {
  const sr = ctx.sampleRate;
  const N = Math.floor(seconds * sr);
  const X = 2048;
  const tmp = new Float32Array(N + X);
  if (kind === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < tmp.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      tmp[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    }
  } else if (kind === 'brown') {
    let l = 0;
    for (let i = 0; i < tmp.length; i++) {
      const w = Math.random() * 2 - 1;
      l = (l + 0.02 * w) / 1.02;
      tmp[i] = l;
    }
  } else {
    for (let i = 0; i < tmp.length; i++) tmp[i] = Math.random() * 2 - 1;
  }
  let s = 0;
  for (let i = 0; i < tmp.length; i++) s += tmp[i] * tmp[i];
  const g = 0.3 / Math.sqrt(s / tmp.length || 1);
  const buf = ctx.createBuffer(1, N, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < N; i++) d[i] = tmp[i] * g;
  // seam: the stream continues past d[N-1] into d[0]; make d[0..X) fade from "tail continuation" into the true start.
  for (let i = 0; i < X; i++) {
    const w = i / X;
    d[i] = (tmp[N + i] * Math.cos(w * Math.PI * 0.5) + tmp[i] * Math.sin(w * Math.PI * 0.5)) * g;
  }
  return buf;
}

/**
 * Stereo reverb impulse response: decaying noise whose highs die faster than its lows, a handful of
 * sparse early reflections and (optionally) two wall slap-backs for an outdoor "between city walls" feel.
 */
export function impulseResponse(ctx, seconds, { rt60 = 2.2, pre = 0.012, bright = 0.85, dark = 0.2, slap = true, early = true, hp = 0.985 } = {}) {
  const sr = ctx.sampleRate;
  const len = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(2, len, sr);
  const k = 6.908 / rt60;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let y = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr - pre;
      if (t < 0) continue;
      const env = Math.exp(-t * k) * Math.min(1, t / 0.02);
      const a = lerp(bright, dark, Math.min(1, t / (rt60 * 0.8)));
      y += a * ((Math.random() * 2 - 1) - y);
      d[i] = y * env * 2.2;
    }
    // high-pass the tail (one-pole) so the reverb never adds boomy low end under every sound
    let px = 0, py = 0;
    for (let i = 0; i < len; i++) {
      const x = d[i];
      py = hp * (py + x - px);
      px = x;
      d[i] = py;
    }
    const tap = (time, amp) => {
      const i = Math.floor((time + (ch ? 0.0011 : 0)) * sr);
      for (let j = 0; j < 12 && i + j < len; j++) d[i + j] += amp * (Math.random() * 2 - 1) * (1 - j / 12);
    };
    if (early) {
      [0.017, 0.031, 0.047, 0.071, 0.098].forEach((tm, n) => tap(tm + ch * 0.0023, 0.5 / (1 + n * 0.5)));
    }
    if (slap) {
      tap(0.142 + ch * 0.011, 0.34);
      tap(0.27 + ch * 0.017, 0.22);
    }
  }
  return buf;
}

/** Soft-clip curve (tanh) for waveshapers. `drive` > 1 for harder saturation. */
export function satCurve(drive = 1, n = 2048) {
  const c = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * drive) / norm;
  }
  return c;
}

/** Percussive amplitude envelope on an AudioParam: linear attack `a`, exponential-ish decay over `d` seconds. */
export function perc(param, t, peak, a, d) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + Math.max(a, 0.0005));
  param.setTargetAtTime(0, t + Math.max(a, 0.0005), Math.max(d, 0.004) / 5);
}

/**
 * One-shot node-graph builder. Every node created through a Rig is tracked; when the last scheduled
 * source has ended the whole graph is disconnected (so nothing leaks) and bookkeeping is released.
 */
export class Rig {
  constructor(A, cat = null) {
    this.A = A;
    this.ctx = A.ctx;
    this.cat = cat;
    this.nodes = [];
    this.srcs = [];
    this.live = 0;
    this.sealed = false;
    this.dead = false;
    this.cleanups = [];
    A._rigsLive = (A._rigsLive | 0) + 1;
  }

  _t(n) {
    this.nodes.push(n);
    return n;
  }
  gain(v = 1) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return this._t(g);
  }
  filter(type, f, q = 1, gainDb = 0) {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    if (gainDb) b.gain.value = gainDb;
    return this._t(b);
  }
  shaper(curve, oversample = '2x') {
    const s = this.ctx.createWaveShaper();
    s.curve = curve;
    s.oversample = oversample;
    return this._t(s);
  }

  _start(s, t0, t1, offset) {
    this.nodes.push(s);
    this.srcs.push(s);
    this.live++;
    s.onended = () => {
      if (--this.live <= 0) this.dispose();
    };
    if (offset !== undefined) s.start(t0, offset);
    else s.start(t0);
    s.stop(Math.max(t1, t0 + 0.002));
    return s;
  }

  /** Oscillator running t0..t1. */
  osc(type, f0, t0, t1, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (detune) o.detune.value = detune;
    return this._start(o, t0, t1);
  }

  /** Looped noise source ('white' | 'pink' | 'brown') running t0..t0+dur from a random offset. */
  noise(kind, t0, dur) {
    const s = this.ctx.createBufferSource();
    const buf = this.A.noise[kind] || this.A.noise.white;
    s.buffer = buf;
    s.loop = true;
    return this._start(s, t0, t0 + dur, rand(0, buf.duration - 0.01));
  }

  /** Oscillator with a pitch glide f0 -> f1 and a percussive amp envelope, connected to `out`. */
  tone(out, o) {
    const { type = 'sine', f0, f1 = f0, glide = 0.05, t, peak = 0.5, a = 0.002, d = 0.2, detune = 0 } = o;
    const g = this.gain(0);
    perc(g.gain, t, peak, a, d);
    const os = this.osc(type, f0, t, t + a + d * 1.3, detune);
    if (f1 !== f0) os.frequency.exponentialRampToValueAtTime(f1, t + glide);
    os.connect(g);
    g.connect(out);
    return g;
  }

  /** Noise through one or two (optionally swept) filters with a percussive envelope, connected to `out`. */
  burst(out, o) {
    const { kind = 'white', t, peak = 0.5, a = 0.002, d = 0.1, type = 'bandpass', f0 = 1000, f1 = f0, sweep = d, q = 1, type2, f2 = 1000, q2 = 0.7 } = o;
    const g = this.gain(0);
    perc(g.gain, t, peak, a, d);
    const n = this.noise(kind, t, a + d * 1.3);
    const f = this.filter(type, f0, q);
    if (f1 !== f0) {
      f.frequency.setValueAtTime(f0, t);
      f.frequency.exponentialRampToValueAtTime(f1, t + sweep);
    }
    n.connect(f);
    let last = f;
    if (type2) {
      const ff = this.filter(type2, f2, q2);
      f.connect(ff);
      last = ff;
    }
    last.connect(g);
    g.connect(out);
    return g;
  }

  /** Inharmonic modal partials (metal / wood / glass), each with its own decay; connected to `out`. */
  modes(out, o) {
    const { t, f, decay = 0.1, amp = null, peak = 0.3, type = 'sine', a = 0.0005 } = o;
    for (let i = 0; i < f.length; i++) {
      const am = Array.isArray(amp) ? amp[i] : 1 / (1 + i * 0.6);
      const dc = Array.isArray(decay) ? decay[i] : decay / (1 + i * 0.35);
      this.tone(out, { type, f0: f[i], t, peak: peak * am, a, d: dc });
    }
  }

  /** Register a function to run when this rig is disposed. */
  onDispose(fn) {
    this.cleanups.push(fn);
  }

  /** Called by the owner after building: if nothing was scheduled there is nothing to wait for. */
  seal() {
    this.sealed = true;
    if (this.live <= 0) this.dispose();
  }

  /** Stop everything right now (used when synthesis threw half-way). */
  abort() {
    for (const s of this.srcs) {
      try { s.onended = null; s.stop(); } catch (e) { /* not started */ }
    }
    this.live = 0;
    this.dispose();
  }

  dispose() {
    if (this.dead) return;
    this.dead = true;
    this.A._rigsLive--;
    for (const fn of this.cleanups) {
      try { fn(); } catch (e) { /* ignore */ }
    }
    for (const n of this.nodes) {
      try { n.disconnect(); } catch (e) { /* ignore */ }
    }
    this.nodes.length = 0;
    this.srcs.length = 0;
    this.cleanups.length = 0;
    this.A._release(this);
  }
}
