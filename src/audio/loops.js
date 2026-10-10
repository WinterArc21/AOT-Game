// Continuous sound loops, created once in Audio.init(): winch (reel), gas jet and wind.
// All parameter changes are smoothed with setTargetAtTime so per-frame updates never click.
import { clamp, smoothstep } from './dsp.js';

function loopNoise(A, kind) {
  const s = A.ctx.createBufferSource();
  s.buffer = A.noise[kind];
  s.loop = true;
  s.start(0, Math.random() * (s.buffer.duration - 0.05));
  return s;
}

function osc(ctx, type, f) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = f;
  o.start();
  return o;
}

/** Sharp-edged pulse curve: sawtooth in (-1..1) -> spike right after the wrap, for ratchet clicks. */
function spikeCurve(width = 0.1, n = 1024) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const u = Math.max(0, 1 - (x + 1) / (width * 2));
    c[i] = u * u;
  }
  return c;
}

// ─────────────────────────────────────────────────────────────────────────────

export class ReelLoop {
  constructor(A) {
    const ctx = A.ctx;
    this.ctx = ctx;
    this.level = 0;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(A.sfx);

    // motor whirr: two detuned saws + octave sine through a resonant lowpass
    this.s1 = osc(ctx, 'sawtooth', 80);
    this.s2 = osc(ctx, 'sawtooth', 81.4);
    this.s3 = osc(ctx, 'sine', 160);
    const mix = ctx.createGain();
    mix.gain.value = 0.5;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 600;
    this.lp.Q.value = 3.5;
    this.motorGain = ctx.createGain();
    this.motorGain.gain.value = 0;
    this.s1.connect(mix); this.s2.connect(mix); this.s3.connect(mix);
    mix.connect(this.lp); this.lp.connect(this.motorGain); this.motorGain.connect(this.out);

    // servo whine with a little wobble
    this.whine = osc(ctx, 'sine', 1000);
    this.wob = osc(ctx, 'sine', 6.5);
    const wobG = ctx.createGain();
    wobG.gain.value = 22;
    this.wob.connect(wobG); wobG.connect(this.whine.frequency);
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whine.connect(this.whineGain); this.whineGain.connect(this.out);

    // ratchet ticks: sawtooth -> spike shaper -> amplitude of (noise + tone)
    this.tickOsc = osc(ctx, 'sawtooth', 10);
    const spike = ctx.createWaveShaper();
    spike.curve = spikeCurve(0.07);
    this.tickOsc.connect(spike);
    this.tickGain = ctx.createGain();
    this.tickGain.gain.value = 0;
    spike.connect(this.tickGain.gain);
    this.tickNoise = loopNoise(A, 'white');
    this.tickBp = ctx.createBiquadFilter();
    this.tickBp.type = 'bandpass';
    this.tickBp.frequency.value = 3200;
    this.tickBp.Q.value = 1.6;
    this.tickTone = osc(ctx, 'sine', 1900);
    const tt = ctx.createGain();
    tt.gain.value = 0.5;
    this.tickNoise.connect(this.tickBp); this.tickBp.connect(this.tickGain);
    this.tickTone.connect(tt); tt.connect(this.tickGain);
    this.tickLevel = ctx.createGain();
    this.tickLevel.gain.value = 0;
    this.tickGain.connect(this.tickLevel); this.tickLevel.connect(this.out);
  }

  set(level) {
    level = clamp(Number.isFinite(level) ? level : 0, 0, 1);
    if (Math.abs(level - this.level) < 0.004 && (level > 0) === (this.level > 0)) return;
    this.level = level;
    const t = this.ctx.currentTime;
    const on = level > 0.02;
    const lv = on ? level : 0;
    const tc = on ? 0.05 : 0.07;
    const base = 62 + 250 * Math.pow(lv, 0.9);
    this.out.gain.setTargetAtTime(on ? 0.065 : 0, t, tc);
    this.s1.frequency.setTargetAtTime(base, t, 0.09);
    this.s2.frequency.setTargetAtTime(base * 1.017, t, 0.09);
    this.s3.frequency.setTargetAtTime(base * 2, t, 0.09);
    this.lp.frequency.setTargetAtTime(380 + 2600 * lv, t, 0.09);
    this.motorGain.gain.setTargetAtTime(on ? 0.22 + 0.5 * lv : 0, t, tc);
    this.whine.frequency.setTargetAtTime(780 + 2600 * lv, t, 0.08);
    this.whineGain.gain.setTargetAtTime(on ? 0.01 + 0.035 * lv : 0, t, tc);
    this.tickOsc.frequency.setTargetAtTime(8 + 36 * lv, t, 0.07);
    this.tickBp.frequency.setTargetAtTime(2600 + 2400 * lv, t, 0.08);
    this.tickTone.frequency.setTargetAtTime(1700 + 1500 * lv, t, 0.08);
    this.tickLevel.gain.setTargetAtTime(on ? 0.45 + 0.35 * lv : 0, t, tc);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export class GasLoop {
  constructor(A) {
    const ctx = A.ctx;
    this.ctx = ctx;
    this.level = 0;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(A.sfx);
    // flutter on the jet (pressure fluctuation)
    this.flut = ctx.createGain();
    this.flut.gain.value = 0.92;
    this.flut.connect(this.out);
    this.lfo = osc(ctx, 'sine', 19);
    const lg = ctx.createGain();
    lg.gain.value = 0.07;
    this.lfo.connect(lg); lg.connect(this.flut.gain);

    const n = loopNoise(A, 'white');
    this.bp = ctx.createBiquadFilter(); // main hiss body
    this.bp.type = 'bandpass'; this.bp.frequency.value = 3200; this.bp.Q.value = 1.0;
    const g1 = ctx.createGain(); g1.gain.value = 1.0;
    this.edge = ctx.createBiquadFilter(); // resonant edge: the whistle of the nozzle
    this.edge.type = 'bandpass'; this.edge.frequency.value = 6800; this.edge.Q.value = 9;
    const g2 = ctx.createGain(); g2.gain.value = 0.16;
    const body = ctx.createBiquadFilter(); // low body
    body.type = 'lowpass'; body.frequency.value = 900; body.Q.value = 0.7;
    const g3 = ctx.createGain(); g3.gain.value = 0.28;
    const hp = ctx.createBiquadFilter(); // keep rumble out of the main hiss
    hp.type = 'highpass'; hp.frequency.value = 1100;
    n.connect(this.bp); this.bp.connect(g1); g1.connect(hp); hp.connect(this.flut);
    n.connect(this.edge); this.edge.connect(g2); g2.connect(this.flut);
    n.connect(body); body.connect(g3); g3.connect(this.flut);
  }

  set(level) {
    level = clamp(Number.isFinite(level) ? level : 0, 0, 1);
    if (Math.abs(level - this.level) < 0.004 && (level > 0) === (this.level > 0)) return;
    const prev = this.level;
    this.level = level;
    const t = this.ctx.currentTime;
    const on = level > 0.01;
    const g = on ? 0.24 * Math.pow(level, 0.8) : 0;
    this.out.gain.cancelScheduledValues(t);
    if (on && prev < 0.15 && level > 0.5) {
      // start of a burst: pressure spike that settles
      this.out.gain.setTargetAtTime(g * 1.7, t, 0.012);
      this.out.gain.setTargetAtTime(g, t + 0.06, 0.07);
    } else {
      this.out.gain.setTargetAtTime(g, t, on ? 0.01 : 0.04); // attack ~30 ms, release ~120 ms
    }
    this.bp.frequency.setTargetAtTime(2500 + 2400 * level, t, 0.05);
    this.edge.frequency.setTargetAtTime(6200 + 1600 * level, t, 0.05);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export class WindLoop {
  constructor(A) {
    const ctx = A.ctx;
    this.ctx = ctx;
    this.speed = 0;
    this.out = ctx.createGain();
    this.out.gain.value = 0.35;
    this.out.connect(A.sfx);

    // low rumble
    const brown = loopNoise(A, 'brown');
    this.rumbleLp = ctx.createBiquadFilter();
    this.rumbleLp.type = 'lowpass'; this.rumbleLp.frequency.value = 140; this.rumbleLp.Q.value = 0.7;
    this.rumble = ctx.createGain(); this.rumble.gain.value = 0;
    brown.connect(this.rumbleLp); this.rumbleLp.connect(this.rumble); this.rumble.connect(this.out);

    // mid whoosh with slow gusting
    const pink = loopNoise(A, 'pink');
    this.whooshBp = ctx.createBiquadFilter();
    this.whooshBp.type = 'bandpass'; this.whooshBp.frequency.value = 500; this.whooshBp.Q.value = 0.6;
    this.whoosh = ctx.createGain(); this.whoosh.gain.value = 0;
    const gust = ctx.createGain(); gust.gain.value = 1;
    pink.connect(this.whooshBp); this.whooshBp.connect(this.whoosh); this.whoosh.connect(gust); gust.connect(this.out);
    this.gustLfo = osc(ctx, 'sine', 0.27);
    this.gustLfo2 = osc(ctx, 'sine', 0.61);
    const gl = ctx.createGain(); gl.gain.value = 0.16;
    const gl2 = ctx.createGain(); gl2.gain.value = 0.08;
    this.gustLfo.connect(gl); gl.connect(gust.gain);
    this.gustLfo2.connect(gl2); gl2.connect(gust.gain);

    // high whistle (narrow resonances whose pitch wanders)
    const white = loopNoise(A, 'white');
    this.whistleBp = ctx.createBiquadFilter();
    this.whistleBp.type = 'bandpass'; this.whistleBp.frequency.value = 2600; this.whistleBp.Q.value = 14;
    this.whistleBp2 = ctx.createBiquadFilter();
    this.whistleBp2.type = 'bandpass'; this.whistleBp2.frequency.value = 4100; this.whistleBp2.Q.value = 10;
    this.whistle = ctx.createGain(); this.whistle.gain.value = 0;
    white.connect(this.whistleBp); white.connect(this.whistleBp2);
    this.whistleBp.connect(this.whistle); this.whistleBp2.connect(this.whistle); this.whistle.connect(this.out);
    this.wanderLfo = osc(ctx, 'sine', 0.43);
    const wg = ctx.createGain(); wg.gain.value = 180;
    this.wanderLfo.connect(wg); wg.connect(this.whistleBp.frequency);
    this.wanderLfo2 = osc(ctx, 'sine', 0.71);
    const wg2 = ctx.createGain(); wg2.gain.value = 260;
    this.wanderLfo2.connect(wg2); wg2.connect(this.whistleBp2.frequency);

    // hiss of fast air
    this.airHp = ctx.createBiquadFilter();
    this.airHp.type = 'highpass'; this.airHp.frequency.value = 5500;
    this.air = ctx.createGain(); this.air.gain.value = 0;
    white.connect(this.airHp); this.airHp.connect(this.air); this.air.connect(this.out);
  }

  set(speed) {
    speed = Number.isFinite(speed) ? Math.max(0, speed) : 0;
    if (Math.abs(speed - this.speed) < 0.15) return;
    this.speed = speed;
    const t = this.ctx.currentTime;
    const s = clamp((speed - 5) / 75, 0, 1);
    const tc = 0.18;
    this.rumble.gain.setTargetAtTime(0.42 * Math.pow(s, 0.85), t, tc);
    this.rumbleLp.frequency.setTargetAtTime(110 + 220 * s, t, tc);
    this.whoosh.gain.setTargetAtTime(0.36 * Math.pow(s, 1.3), t, tc);
    this.whooshBp.frequency.setTargetAtTime(420 + 1100 * s, t, tc);
    this.whooshBp.Q.setTargetAtTime(0.5 + 0.5 * s, t, tc);
    this.whistle.gain.setTargetAtTime(0.15 * smoothstep(0.22, 1, s), t, tc);
    this.whistleBp.frequency.setTargetAtTime(2200 + 1500 * s, t, tc);
    this.whistleBp2.frequency.setTargetAtTime(3600 + 2200 * s, t, tc);
    this.air.gain.setTargetAtTime(0.1 * smoothstep(0.35, 1, s), t, tc);
  }
}
