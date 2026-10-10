// Procedural battle score (original material): D minor, 150 BPM, driven by a lookahead scheduler.
// Layers fade in with intensity:
//   0.0  ambient   sustained choir pad + soft strings, long reverb
//   0.4  battle    16th-note string ostinato, taiko drums, sub bass
//   0.8+ climax    low brass stabs, choir pad ("aah" formants) singing a heroic theme, high strings, crash cymbals
import { Rig, clamp, smoothstep, mtof, impulseResponse, rand } from './dsp.js';

const BPM = 150;
const BEAT = 60 / BPM; // 0.4 s
const S16 = BEAT / 4; // 0.1 s
const BAR = BEAT * 4; // 1.6 s
const LOOKAHEAD = 0.16; // seconds scheduled ahead of the audio clock (timer runs every 25 ms)

// Dm | Bb | F | C | Dm | Gm | A | A   (8-bar cycle = 12.8 s)
const PROG = [
  [2, 3], [10, 4], [5, 4], [0, 4], [2, 3], [7, 3], [9, 4], [9, 4],
].map(([pc, third]) => {
  let root = 36 + pc;
  if (root > 41) root -= 12; // bass root range G1..F2
  const voice = [pc, (pc + third) % 12, (pc + 7) % 12].map((p) => 57 + ((((p - 57) % 12) + 12) % 12)).sort((a, b) => a - b);
  return { pc, third, root, voice };
});

// Original heroic theme, one entry per bar: [startBeat, durationBeats, midi]
const THEME = [
  [[0, 2, 69], [2, 1, 74], [3, 1, 77]],
  [[0, 3, 77], [3, 1, 74]],
  [[0, 2, 72], [2, 1, 77], [3, 1, 81]],
  [[0, 1.5, 79], [1.5, 1.5, 76], [3, 1, 72]],
  [[0, 2, 74], [2, 1, 77], [3, 1, 81]],
  [[0, 2, 79], [2, 1, 77], [3, 1, 74]],
  [[0, 1.5, 73], [1.5, 0.5, 76], [2, 2, 81]],
  [[0, 1, 76], [1, 1, 74], [2, 2, 73]],
];

// 16th-step ostinato: [semitone offset above the chord root (two octaves over the bass root), accent]
const OST = [
  [0, 1.0], [0, 0.45], [12, 0.55], [0, 0.85],
  [0, 0.45], [7, 0.55], [0, 0.95], [0, 0.45],
  [12, 0.6], [0, 0.85], [0, 0.45], ['3', 0.7],
  [7, 0.95], [0, 0.45], [12, 0.75], [7, 0.6],
];
const OST_ACCENTS = new Set([0, 3, 6, 9, 12, 14]);

// Per-layer: base gain and reverb send
const LAYERS = {
  ambStr: [1.5, 0.65],
  ambChoir: [1.7, 0.8],
  str: [1.5, 0.2],
  hi: [0.5, 0.3],
  bass: [1.0, 0.05],
  drum: [1.7, 0.22],
  brass: [0.8, 0.3],
  warChoir: [0.7, 0.5],
  theme: [0.8, 0.55],
};

export function layerLevels(i) {
  return {
    ambStr: 1 - smoothstep(0.12, 0.42, i),
    ambChoir: 1 - smoothstep(0.15, 0.45, i),
    str: smoothstep(0.2, 0.38, i),
    drum: smoothstep(0.25, 0.42, i),
    bass: smoothstep(0.38, 0.55, i),
    brass: smoothstep(0.58, 0.78, i),
    warChoir: smoothstep(0.62, 0.8, i),
    hi: smoothstep(0.8, 0.95, i),
    theme: smoothstep(0.85, 0.97, i),
  };
}

export class Music {
  constructor(A) {
    this.A = A;
    const ctx = (this.ctx = A.ctx);
    this.intensity = 0;
    this.lv = layerLevels(0);
    this.step = 0;
    this.next = null;
    this.timer = null;
    this.cycle = 0;

    // hall reverb for the whole score
    this.rev = ctx.createConvolver();
    this.rev.buffer = impulseResponse(ctx, 3.4, { rt60: 3.1, pre: 0.02, bright: 0.6, dark: 0.12, slap: false, early: false, hp: 0.98 });
    this.revIn = ctx.createGain();
    this.revIn.gain.value = 1;
    this.revOut = ctx.createGain();
    this.revOut.gain.value = 0.75;
    this.revIn.connect(this.rev); this.rev.connect(this.revOut); this.revOut.connect(A.musicBus);

    // layer buses
    this.L = {};
    for (const [name, [vol, send]] of Object.entries(LAYERS)) {
      const g = ctx.createGain();
      g.gain.value = 0;
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(A.musicBus); g.connect(s); s.connect(this.revIn);
      this.L[name] = g;
      this.L[name + '_vol'] = vol;
    }
    // shared choir formant network ("aah"): ambient, war and theme voices all pass through it
    this.net = ctx.createGain();
    const sum = ctx.createGain();
    sum.gain.value = 1;
    for (const [f, q, gn] of [[700, 3.5, 1.1], [1200, 5, 0.8], [2600, 7, 0.4]]) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      const g = ctx.createGain(); g.gain.value = gn;
      this.net.connect(bp); bp.connect(g); g.connect(sum);
    }
    const body = ctx.createBiquadFilter();
    body.type = 'lowpass'; body.frequency.value = 1400; body.Q.value = 0.5;
    const bg = ctx.createGain(); bg.gain.value = 0.35;
    this.net.connect(body); body.connect(bg); bg.connect(sum);
    this.netOut = ctx.createGain();
    this.netOut.gain.value = 1.4;
    sum.connect(this.netOut);
    this.netBuses = ['ambChoir', 'warChoir', 'theme'];
    for (const n of this.netBuses) {
      // these layer buses feed the network instead of the music bus directly
      this.L[n].disconnect();
      this.L[n].connect(this.net);
    }
    this.netOut.connect(A.musicBus);
    const netSend = ctx.createGain(); netSend.gain.value = 0.55;
    this.netOut.connect(netSend); netSend.connect(this.revIn);

    // shared choir vibrato
    this.vib = ctx.createOscillator();
    this.vib.type = 'sine';
    this.vib.frequency.value = 5.3;
    this.vibAmt = ctx.createGain();
    this.vibAmt.gain.value = 13; // cents
    this.vib.connect(this.vibAmt);
    this.vib.start();

    this.setIntensity(A._pendingMusic || 0, true);
  }

  // ──────────────────────────────────────────────────────────── control

  setIntensity(i, immediate = false) {
    i = clamp(Number.isFinite(i) ? i : 0, 0, 1);
    const prev = this.lv;
    this.intensity = i;
    this.lv = layerLevels(i);
    const t = this.ctx.currentTime;
    for (const name of Object.keys(LAYERS)) {
      const target = this.lv[name] * this.L[name + '_vol'];
      const g = this.L[name].gain;
      g.cancelScheduledValues(t);
      if (immediate) g.setValueAtTime(target, t);
      else g.setTargetAtTime(target, t, this.lv[name] > prev[name] ? 0.3 : 0.8); // layers enter quickly, leave slowly
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.pump(), 25);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Lookahead scheduler: queue every 16th-note step that falls before `until` (default: now + 0.12 s). */
  pump(until) {
    const ctx = this.ctx;
    const explicit = until !== undefined;
    if (until === undefined) {
      if (!this.A._running()) return;
      const now = ctx.currentTime;
      if (this.next === null || this.next < now - LOOKAHEAD * 2.5) this.next = now + 0.06; // first run, or fell far behind (stalled / throttled tab)
      until = now + LOOKAHEAD;
    } else if (this.next === null) this.next = 0.05;
    let guard = 0;
    while (this.next < until && (guard++ < 64 || explicit)) {
      this.scheduleStep(this.step, this.next);
      this.next += S16;
      this.step++;
    }
  }

  // ──────────────────────────────────────────────────────────── sequencing

  scheduleStep(step, t) {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const bi = bar % 8;
    const ch = PROG[bi];
    const lv = this.lv;
    if (s === 0) this.scheduleBar(bar, bi, ch, t);

    // string ostinato
    if (lv.str > 0.03) {
      let [off, acc] = OST[s];
      if (off === '3') off = 12 + ch.third;
      if (bi === 7 && s >= 12) off = [7, 12, 15, 19][s - 12]; // rising run into the next cycle
      const note = ch.root + 24 + off;
      const accent = OST_ACCENTS.has(s);
      this.pluck(t, note, 0.08 + (accent ? 0.045 : 0), 0.4 + 0.6 * acc, this.L.str, false);
      if (accent) this.pluck(t, note - 12, 0.11, 0.35 + 0.35 * acc, this.L.str, false); // cellos double the accents
      if (lv.hi > 0.03 && accent) this.pluck(t, note + 12, 0.1, 0.55 + 0.4 * acc, this.L.hi, true);
    }
    // bass: eighth-note pulse
    if (lv.bass > 0.03 && s % 2 === 0) this.bass(t, ch.root, 0.16, s === 0 ? 1 : s % 4 === 0 ? 0.75 : 0.55);

    // drums
    if (lv.drum > 0.03) this.drums(bi, s, t);
  }

  scheduleBar(bar, bi, ch, t) {
    const lv = this.lv;
    // ambient pads change every second bar
    if (bar % 2 === 0) {
      const ac = PROG[(bar >> 1) % 8];
      if (lv.ambStr > 0.03) {
        const dur = BAR * 2 + 0.9;
        for (const m of ac.voice) this.padNote(t, dur, m, this.L.ambStr, 0.07);
        this.padNote(t, dur, ac.root + 12, this.L.ambStr, 0.09);
        this.padNote(t, dur, ac.voice[2] + 12, this.L.ambStr, 0.035, true);
      }
      if (lv.ambChoir > 0.03) {
        const dur = BAR * 2 + 1.2;
        ac.voice.forEach((m, i) => this.choirNote(t, dur, m, this.L.ambChoir, 0.16, 1.3, 1.8, i));
        this.choirNote(t, dur, ac.voice[0] + 12, this.L.ambChoir, 0.1, 1.5, 1.8, 3);
      }
    }
    // brass: swelling stab on the downbeat, shorter stabs later in the bar
    if (lv.brass > 0.03) {
      const big = bi === 0 || bi === 4;
      this.brass(t, ch, big ? 1.1 : 0.62, 1);
      this.brass(t + BEAT * 2, ch, 0.34, 0.75);
      if (bi % 2 === 1 || bi === 7) this.brass(t + BEAT * 3.5, ch, 0.24, 0.7);
    }
    // war choir: one sustained chord per bar
    if (lv.warChoir > 0.03) {
      const dur = BAR + 0.15;
      ch.voice.forEach((m, i) => this.choirNote(t, dur, m, this.L.warChoir, 0.2, 0.18, 0.5, i));
      this.choirNote(t, dur, ch.voice[2] + 12, this.L.warChoir, 0.11, 0.2, 0.5, 4);
      this.choirNote(t, dur, ch.root + 12, this.L.warChoir, 0.14, 0.18, 0.5, 5);
    }
    // theme
    if (lv.theme > 0.05) {
      for (const [b, d, m] of THEME[bi]) {
        this.choirNote(t + b * BEAT, d * BEAT + 0.08, m, this.L.theme, 0.34, 0.07, 0.22, 6);
        this.choirNote(t + b * BEAT, d * BEAT + 0.08, m - 12, this.L.theme, 0.18, 0.09, 0.22, 7);
      }
    }
    // cymbal crash on the first bar of the cycle (and half-way through at full intensity)
    if (lv.drum > 0.5 && this.intensity > 0.55 && (bi === 0 || (bi === 4 && this.intensity > 0.85))) this.crash(t, bi === 0 ? 1 : 0.7);
  }

  drums(bi, s, t) {
    const I = this.intensity;
    const v = this.lv.drum;
    const lastBar = bi === 7;
    // big taiko: downbeat, beat 3, plus syncopation as intensity grows
    if (s === 0) this.taiko(t, 1.0 * v, 66);
    if (s === 8 && !lastBar) this.taiko(t, 0.9 * v, 66);
    if (I > 0.5 && (s === 6 || s === 11 || s === 14)) this.taiko(t, 0.7 * v, 78);
    if (I > 0.8 && (s === 3 || s === 10)) this.taiko(t, 0.65 * v, 78);
    // shime / rim backbeat
    if (s === 4 || s === 12) this.rim(t, 0.9 * v, 1);
    if (I > 0.6 && (s === 2 || s === 7 || s === 15)) this.rim(t, 0.35 * v, 1.25);
    // turnaround fill: rolling 16ths on the last bar of the cycle
    if (lastBar && s >= 8) {
      const k = (s - 8) / 8;
      this.taiko(t, (0.45 + 0.5 * k) * v, 66 + (s % 2 ? 22 : 8) + 8 * (1 - k));
      if (s >= 12) this.rim(t, (0.4 + 0.5 * k) * v, 1.3);
    } else if (s === 12 || s === 14) { // light pickup into the next bar
      if (I > 0.7 && bi % 2 === 1) this.taiko(t, 0.5 * v, 90);
    }
  }

  // ──────────────────────────────────────────────────────────── voices

  /** Plucked string-section note: two detuned saws through a quickly closing lowpass. */
  pluck(t, midi, len, vel, dest, bright) {
    const f = mtof(midi);
    const r = new Rig(this.A);
    const end = t + len + 0.12;
    const g = r.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime((bright ? 0.1 : 0.14) * vel, t + 0.006);
    g.gain.setValueAtTime((bright ? 0.1 : 0.14) * vel, t + len * 0.4);
    g.gain.setTargetAtTime(0, t + len * 0.5, len * 0.22);
    const lp = r.filter('lowpass', f * (bright ? 9 : 7), 1.4);
    lp.frequency.setValueAtTime(f * (bright ? 9 : 7), t);
    lp.frequency.exponentialRampToValueAtTime(f * 2.4, t + len);
    const o1 = r.osc('sawtooth', f, t, end, -9);
    const o2 = r.osc('sawtooth', f, t, end, 9);
    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(dest);
    r.seal();
  }

  /** Slow string-pad note. */
  padNote(t, dur, midi, dest, vol, air) {
    const f = mtof(midi);
    const r = new Rig(this.A);
    const end = t + dur + 1.9;
    const g = r.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 1.2);
    g.gain.setValueAtTime(vol, t + dur);
    g.gain.setTargetAtTime(0, t + dur, 0.5);
    const lp = r.filter('lowpass', air ? 3500 : 1000, 0.6);
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.linearRampToValueAtTime(air ? 3500 : 1300, t + dur * 0.6);
    for (const dt of [-11, 0, 10]) {
      const o = r.osc('sawtooth', f, t, end, dt + rand(-2, 2));
      o.connect(lp);
    }
    lp.connect(g); g.connect(dest);
    r.seal();
  }

  /** Choir "aah" voice: detuned saws with shared vibrato, into the formant network via `dest`. */
  choirNote(t, dur, midi, dest, vol, att, rel, seed = 0) {
    const f = mtof(midi);
    const r = new Rig(this.A);
    const end = t + dur + rel * 1.4 + 0.1;
    const g = r.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + att);
    g.gain.setValueAtTime(vol, t + Math.max(att, dur));
    g.gain.setTargetAtTime(0, t + Math.max(att, dur), rel / 4);
    const oscs = [];
    for (const dt of [-8, 7]) {
      const o = r.osc('sawtooth', f, t, end, dt + ((seed * 3.7) % 5) - 2);
      this.vibAmt.connect(o.detune);
      oscs.push(o);
      o.connect(g);
    }
    r.onDispose(() => { for (const o of oscs) { try { this.vibAmt.disconnect(o.detune); } catch (e) { /* ok */ } } });
    // a touch of breath
    const nz = r.noise('pink', t, dur + rel);
    const ng = r.gain(vol * 0.18);
    nz.connect(ng); ng.connect(g);
    g.connect(dest);
    r.seal();
  }

  /** Low brass stab: stacked detuned saws, filter swell. */
  brass(t, ch, len, vel) {
    const r = new Rig(this.A);
    const end = t + len + 0.35;
    const g = r.gain(0);
    const pk = 0.2 * vel;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(pk, t + 0.045);
    g.gain.setValueAtTime(pk * 0.85, t + Math.max(0.06, len - 0.1));
    g.gain.setTargetAtTime(0, t + Math.max(0.06, len - 0.04), 0.07);
    const lp = r.filter('lowpass', 300, 2.6);
    lp.frequency.setValueAtTime(260, t);
    lp.frequency.exponentialRampToValueAtTime(2600, t + 0.11 + len * 0.1);
    lp.frequency.exponentialRampToValueAtTime(1000, t + Math.max(len, 0.3) + 0.1);
    const root = ch.root + 12;
    const notes = [root - 12, root, root + 7, root + 12, root + ch.third + 12];
    notes.forEach((m, i) => {
      const lvl = i === 0 ? 0.7 : i === 4 ? 0.35 : 1;
      const og = r.gain(lvl);
      for (const dt of [-13, 12]) r.osc('sawtooth', mtof(m), t, end, dt).connect(og);
      og.connect(lp);
    });
    lp.connect(g); g.connect(this.L.brass);
    // blat of air at the attack
    r.burst(this.L.brass, { t, peak: 0.05 * vel, a: 0.01, d: 0.12, type: 'bandpass', f0: 1800, q: 1 });
    r.seal();
  }

  bass(t, rootMidi, len, vel) {
    const f = mtof(rootMidi);
    const r = new Rig(this.A);
    const end = t + len + 0.1;
    const g = r.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22 * vel, t + 0.008);
    g.gain.setTargetAtTime(0, t + len * 0.45, len * 0.25);
    const lp = r.filter('lowpass', 420, 1.2);
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + len);
    const o1 = r.osc('sawtooth', f, t, end, -6);
    const o2 = r.osc('sine', f, t, end);
    const og = r.gain(0.9);
    o1.connect(lp); lp.connect(g); o2.connect(og); og.connect(g);
    g.connect(this.L.bass);
    r.seal();
  }

  /** Taiko: pitched-down sine thump + skin slap + low body noise. p = fundamental in Hz. */
  taiko(t, vel, p) {
    if (vel < 0.02) return;
    const r = new Rig(this.A);
    const out = this.L.drum;
    r.tone(out, { f0: p * 2.3, f1: p, glide: 0.05, t, peak: 0.9 * vel, a: 0.002, d: 0.42 });
    r.tone(out, { f0: p * 1.52, f1: p * 1.2, glide: 0.08, t, peak: 0.25 * vel, a: 0.002, d: 0.16 });
    r.burst(out, { t, peak: 0.34 * vel, a: 0.001, d: 0.045, type: 'bandpass', f0: 1100, q: 0.8 });
    r.burst(out, { kind: 'brown', t, peak: 0.55 * vel, a: 0.003, d: 0.28, type: 'lowpass', f0: 220, q: 0.7 });
    r.seal();
  }

  /** Shime / rim hit. */
  rim(t, vel, pitch = 1) {
    if (vel < 0.02) return;
    const r = new Rig(this.A);
    const out = this.L.drum;
    r.burst(out, { t, peak: 0.34 * vel, a: 0.0008, d: 0.06, type: 'bandpass', f0: 2400 * pitch, q: 1.4 });
    r.tone(out, { f0: 430 * pitch, f1: 300 * pitch, glide: 0.04, t, peak: 0.28 * vel, a: 0.001, d: 0.07 });
    r.burst(out, { t, peak: 0.12 * vel, a: 0.0008, d: 0.025, type: 'highpass', f0: 5000 });
    r.seal();
  }

  crash(t, vel) {
    const r = new Rig(this.A);
    const out = this.L.drum;
    r.burst(out, { t, peak: 0.28 * vel, a: 0.006, d: 2.4, type: 'highpass', f0: 5200, q: 0.6 });
    r.burst(out, { t, peak: 0.14 * vel, a: 0.006, d: 1.5, type: 'bandpass', f0: 7600, q: 3 });
    r.seal();
  }
}
