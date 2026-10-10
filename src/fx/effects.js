// Wings of Freedom — visual effects.
//
//  * Effects     : one GPU particle system (2 draw calls for ALL particles: a normal-blended instanced-quad pool
//                  for steam / gas / blood / dust / chips / leaves, and an additive pool for sparks / glows),
//                  plus a handful of dedicated meshes (lightning bolt ribbon, light pillar, shockwave ring,
//                  slash crescents, screen flash).
//  * SpeedLines  : anime radial speed-line overlay.
//
// HOW THE CORE CALLS IT
//   const fx = new Effects(game);              // after game.scene / game.camera / game.collision exist
//   fx.update(dt);                              // once per rendered frame (after titans / player)
//   // after renderer.render(scene, camera):
//   const lines = new SpeedLines(renderer);     // once
//   lines.setIntensity(clamp((speed - 25) / 60, 0, 1));
//   renderer.render(scene, camera);
//   lines.render();                             // draws the overlay on top, without clearing; restores
//                                               // renderer.autoClear and renderer.info counters
//
// Everything is pooled; nothing allocates per frame. Colours are linear THREE.Colors (the shader converts to the
// output colour space), the particle quads honour scene.fog on the normal-blended pool.
import * as THREE from 'three';

// Math.hypot is variadic and boxes its arguments in hot loops (it was the top source of garbage); this doesn't.
const hypot = (a, b, c = 0) => Math.sqrt(a * a + b * b + c * c);


// ───────────────────────────────────────────────────────── helpers ──────────────────────────────────────────
const rnd = Math.random;
const rr = (a, b) => a + (b - a) * rnd();
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TILE = { PUFF: 0, CLOUD_A: 1, CLOUD_B: 2, SPARK: 3, CHIP: 4, LEAF: 5, DUST: 6, DROP: 7 };
const COLS = 4, ROWS = 2, TS = 128;

// flags
const F_GROUND = 1;        // collides with the ground (bounce / die)
const F_WISP = 2;          // on death leaves a faint steam wisp (blood)
const F_FLUTTER = 4;       // leaf flutter
const F_BOUNCE = 8;        // bounce instead of dying on the ground
const F_LIFT = 16;         // keep the puff's lower edge above the ground (steam / dust sit on it instead of clipping)

const col = (hex) => new THREE.Color(hex);
const C = {
  white: col(0xffffff), steam: col(0xf4f8ff), steamEnd: col(0xc9d6e8), gas: col(0xffffff), gasEnd: col(0xdfe9f7),
  bloodA: col(0x7a0509), bloodB: col(0x3d0206), mistA: col(0xa3181c), mistB: col(0xffe6e6),
  stone: col(0x8a8c90), stoneDark: col(0x55575c), dustStone: col(0xb9b6ae), dustDirt: col(0x9a7a52), dustEnd: col(0xcfc3ae),
  wood: col(0x8a5a2e), woodDark: col(0x5a3a1c), bark: col(0x6b4a2a), roof: col(0xb0502e),
  sparkHot: col(0xfff6c8), sparkEnd: col(0xff6a14), leafA: col(0x3f9a2a), leafB: col(0x9cc43a), leafC: col(0x2c7a28),
  bolt: col(0xfff2b0), boltGlow: col(0xffd84a), flash: col(0xfff3c4),
};
const _c = new THREE.Color();
const _fallbackCam = new THREE.PerspectiveCamera();
const UP = new THREE.Vector3(0, 1, 0);

// ───────────────────────────────────────────── particle texture atlas ───────────────────────────────────────
function makeAtlas() {
  const W = COLS * TS, H = ROWS * TS;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const put = (c, r, fn) => {
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      const u = (x + 0.5) / TS - 0.5, v = (y + 0.5) / TS - 0.5;      // -0.5..0.5, y down
      const o = ((r * TS + y) * W + c * TS + x) * 4;
      const px = fn(u, v, x, y);
      d[o] = clamp(px[0], 0, 1) * 255; d[o + 1] = clamp(px[1], 0, 1) * 255; d[o + 2] = clamp(px[2], 0, 1) * 255; d[o + 3] = clamp(px[3], 0, 1) * 255;
    }
  };
  const out = [0, 0, 0, 0];
  const edge = (r) => 1 - smooth(0.36, 0.5, r);

  // soft puff
  put(0, 0, (u, v) => { const r = hypot(u, v) * 2; const a = Math.pow(clamp(1 - r, 0, 1), 1.6); out[0] = out[1] = out[2] = 1; out[3] = a; return out; });

  // billowing cloud: height field from overlapping domes, lit from the upper left, banded softly (anime-ish)
  const cloud = (seed, flat, count, spread) => {
    const R = mulberry32(seed);
    const domes = [{ x: 0, y: 0.02, r: 0.3 }];
    for (let i = 0; i < count; i++) {
      const a = R() * Math.PI * 2, rad = Math.sqrt(R()) * spread;
      domes.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad * 0.9, r: 0.1 + R() * 0.15 });
    }
    const hf = new Float32Array((TS + 2) * (TS + 2));
    for (let y = -1; y <= TS; y++) for (let x = -1; x <= TS; x++) {
      const u = (x + 0.5) / TS - 0.5, v = (y + 0.5) / TS - 0.5;
      let s = 0;
      for (const m of domes) {
        const dd = hypot(u - m.x, v - m.y) / m.r;
        if (dd < 1) s += Math.pow(Math.sqrt(1 - dd * dd) * m.r, 3);
      }
      hf[(y + 1) * (TS + 2) + x + 1] = Math.pow(s, 1 / 3);
    }
    return (u, v, x, y) => {
      const h = hf[(y + 1) * (TS + 2) + x + 1];
      const hx = hf[(y + 1) * (TS + 2) + x + 2] - hf[(y + 1) * (TS + 2) + x];
      const hy = hf[(y + 2) * (TS + 2) + x + 1] - hf[y * (TS + 2) + x + 1];
      const r = hypot(u, v) * 2;
      let a = smooth(0.012, 0.15, h) * (1 - smooth(0.78, 1.0, r));
      // normal from the height gradient; light from upper-left-front
      let nx = -hx * 26, ny = -hy * 26, nz = 1;
      const l = hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      let lit = clamp(nx * -0.45 + ny * -0.6 + nz * 0.66, 0, 1);
      lit = 0.52 + 0.48 * lit;
      const band = Math.floor(lit * 3 + 0.5) / 3;
      lit = lit * 0.6 + band * 0.4;
      lit = flat ? 0.9 + 0.1 * lit : lit;
      // darker cool rim towards the bottom
      const cool = clamp(v * 1.4 + 0.1, 0, 1) * (flat ? 0.1 : 0.22);
      out[0] = lit * (1 - cool * 0.5); out[1] = lit * (1 - cool * 0.22); out[2] = lit * (1 + cool * 0.02) + 0.02; out[3] = a;
      return out;
    };
  };
  put(1, 0, cloud(11, false, 11, 0.27));
  put(2, 0, cloud(37, false, 13, 0.3));

  // spark: hot core + tight falloff (stretched along velocity in the shader)
  put(3, 0, (u, v) => { const r = hypot(u * 1.0, v * 1.0) * 2; const a = Math.pow(clamp(1 - r, 0, 1), 2.4) * 0.85 + Math.exp(-r * r * 38); out[0] = out[1] = out[2] = 1; out[3] = clamp(a, 0, 1); return out; });

  // chip: hard-edged irregular polygon, two facets
  {
    const R = mulberry32(5);
    const pts = [];
    const n = 6;
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + R() * 0.5; const rad = 0.28 + R() * 0.16; pts.push([Math.cos(a) * rad, Math.sin(a) * rad]); }
    const inside = (u, v) => {
      let sgn = 0;
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        const cr = (b[0] - a[0]) * (v - a[1]) - (b[1] - a[1]) * (u - a[0]);
        if (cr < 0) return false;
      }
      return true;
    };
    put(0, 1, (u, v) => { const ins = inside(u, v); out[0] = out[1] = out[2] = ins ? (u + v > 0.02 ? 0.62 : 1.0) : 0; out[3] = ins ? 1 : 0; return out; });
  }

  // leaf (along +x), pointed at both ends, darker midrib
  put(1, 1, (u, v) => {
    const x = u * 2 / 0.95;                                  // -1..1 along the leaf
    if (Math.abs(x) > 1) { out[3] = 0; return out; }
    const w = 0.34 * Math.pow(Math.sin((x * 0.5 + 0.5) * Math.PI), 0.8) * (x < 0 ? 0.78 : 1);
    const ins = Math.abs(v) < w * 0.5 ? 1 : 0;
    const rib = Math.abs(v) < 0.012 ? 0.7 : 1;
    const shade = 0.86 + 0.14 * (v > 0 ? 1 : 0.55) * (1 - Math.abs(x) * 0.2);
    out[0] = out[1] = out[2] = shade * rib; out[3] = ins; return out;
  });

  // dust: lumpy soft, mostly flat
  put(2, 1, cloud(77, true, 9, 0.25));

  // drop: round with highlight (stretches into a streak in motion)
  put(3, 1, (u, v) => {
    const r = hypot(u, v) * 2;
    const a = 1 - smooth(0.82, 1.0, r);
    const hl = Math.exp(-(Math.pow((u + 0.12) * 6, 2) + Math.pow((v + 0.12) * 6, 2)));
    out[0] = out[1] = out[2] = 0.78 + 0.22 * hl; out[3] = a; return out;
  });

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// ─────────────────────────────────────────────── particle pool ──────────────────────────────────────────────
const VERT = /* glsl */`
attribute vec4 aPosSize;   // xyz position, w size (quad edge length)
attribute vec4 aVel;       // xyz velocity (streak direction), w streak length in metres (0 = billboard)
attribute vec4 aColor;
attribute vec4 aMisc;      // x tile, y rotation
uniform vec2 uGrid;
varying vec4 vColor;
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(aPosSize.xyz, 1.0);
  vec2 q = position.xy;
  float size = aPosSize.w;
  vec2 off;
  if (aVel.w > 0.0) {
    vec3 vd = (viewMatrix * vec4(aVel.xyz, 0.0)).xyz;
    float l3 = length(vd);
    vec2 d = vd.xy;
    float l = length(d);
    d = l > 1e-5 ? d / l : vec2(1.0, 0.0);
    float fs = clamp(l / max(l3, 1e-5), 0.2, 1.0);
    off = d * q.x * max(aVel.w * fs, size) + vec2(-d.y, d.x) * q.y * size;
  } else {
    float c = cos(aMisc.y), s = sin(aMisc.y);
    off = vec2(c * q.x - s * q.y, s * q.x + c * q.y) * size;
  }
  mvPosition.xy += off;
  gl_Position = projectionMatrix * mvPosition;
  float tile = aMisc.x;
  float col = mod(tile, uGrid.x);
  float row = floor(tile / uGrid.x);
  vUv = vec2((col + q.x + 0.5) / uGrid.x, (uGrid.y - 1.0 - row + q.y + 0.5) / uGrid.y);
  vColor = aColor;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */`
uniform sampler2D uMap;
varying vec4 vColor;
varying vec2 vUv;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = vColor.a * t.a;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor.rgb * t.rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #ifdef USE_FOG
  #ifdef ADDITIVE
  #else
  #include <fog_fragment>
  #endif
  #endif
}`;

class Pool {
  constructor(max, atlas, additive, renderOrder) {
    this.max = max; this.next = 0; this.high = 0; this.alive = 0;
    const f = () => new Float32Array(max);
    this.px = f(); this.py = f(); this.pz = f(); this.vx = f(); this.vy = f(); this.vz = f();
    this.age = f(); this.life = f(); this.s0 = f(); this.s1 = f(); this.rot = f(); this.rotV = f();
    this.drag = f(); this.grav = f(); this.stretch = f(); this.fi = f(); this.fo = f();
    this.r0 = f(); this.g0 = f(); this.b0 = f(); this.r1 = f(); this.g1 = f(); this.b1 = f(); this.a0 = f(); this.a1 = f();
    this.flags = new Uint8Array(max);

    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (n) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(n, a); return a; };
    this.aPos = mk('aPosSize'); this.aVel = mk('aVel'); this.aCol = mk('aColor'); this.aMisc = mk('aMisc');
    this._attrs = [this.aPos, this.aVel, this.aCol, this.aMisc];
    g.instanceCount = 0;
    this.geo = g;

    const defines = additive ? { ADDITIVE: '' } : {};
    const mat = new THREE.ShaderMaterial({
      defines,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: atlas }, uGrid: { value: new THREE.Vector2(COLS, ROWS) } }]),
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: true, fog: !additive,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: !additive,
    });
    this.mat = mat;
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.raycast = () => {};
  }

  /** Allocates a slot (ring buffer: the oldest particle is recycled) and sets defaults. */
  spawn(x, y, z, vx, vy, vz, life, s0, s1, tile) {
    const i = this.next; this.next = (i + 1) % this.max;
    if (i >= this.high) this.high = i + 1;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z; this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.age[i] = 0; this.life[i] = life; this.s0[i] = s0; this.s1[i] = s1;
    this.rot[i] = rnd() * 6.2832; this.rotV[i] = 0; this.drag[i] = 0; this.grav[i] = 0; this.stretch[i] = 0;
    this.fi[i] = 0.08; this.fo[i] = 0.5; this.flags[i] = 0;
    this.r0[i] = this.g0[i] = this.b0[i] = this.r1[i] = this.g1[i] = this.b1[i] = 1; this.a0[i] = 1; this.a1[i] = 1;
    this.aMisc.array[i * 4] = tile;
    this.aPos.array[i * 4 + 3] = 0;       // invisible until the first update
    return i;
  }
  color(i, c0, c1, a0, a1) {
    this.r0[i] = c0.r; this.g0[i] = c0.g; this.b0[i] = c0.b; this.r1[i] = c1.r; this.g1[i] = c1.g; this.b1[i] = c1.b;
    this.a0[i] = a0; this.a1[i] = a1 === undefined ? a0 : a1;
  }
  phys(i, drag, grav, rotV, stretch, flags) { this.drag[i] = drag; this.grav[i] = grav; this.rotV[i] = rotV; this.stretch[i] = stretch; this.flags[i] = flags; }
  env(i, fi, fo, delay) { this.fi[i] = fi; this.fo[i] = fo; if (delay) this.age[i] = -delay; }

  update(dt, fx) {
    const { px, py, pz, vx, vy, vz, age, life, s0, s1, rot, rotV, drag, grav, stretch, fi, fo, flags } = this;
    const aP = this.aPos.array, aV = this.aVel.array, aC = this.aCol.array, aM = this.aMisc.array;
    let hi = 0, alive = 0;
    for (let i = 0; i < this.high; i++) {
      const lf = life[i];
      if (lf <= 0) continue;
      const a = age[i] + dt;
      age[i] = a;
      const o = i * 4;
      if (a < 0) { hi = i + 1; alive++; continue; }
      const fl = flags[i];
      if (a >= lf) {
        if (fl & F_WISP) fx._queueWisp(px[i], py[i], pz[i]);
        life[i] = 0; aP[o + 3] = 0; continue;
      }
      hi = i + 1; alive++;
      // integrate
      const k = Math.exp(-drag[i] * dt);
      let x = vx[i] * k, y = vy[i] * k - grav[i] * dt, z = vz[i] * k;
      if (fl & F_FLUTTER) {
        const ph = a * 8 + i * 1.7;
        x += Math.sin(ph) * dt * 7; z += Math.cos(ph * 0.83) * dt * 7; y += Math.sin(ph * 1.3) * dt * 3.5;
      }
      vx[i] = x; vy[i] = y; vz[i] = z;
      let X = px[i] + x * dt, Y = py[i] + y * dt, Z = pz[i] + z * dt;
      if (fl & F_GROUND) {
        const gh = fx._ground(X, Z);
        if (Y < gh + 0.02) {
          if (fl & F_BOUNCE) {
            Y = gh + 0.02; vy[i] = -vy[i] * 0.32; vx[i] *= 0.6; vz[i] *= 0.6; rotV[i] *= 0.4;
            if (Math.abs(vy[i]) < 0.8) { vy[i] = 0; vx[i] *= 0.85; vz[i] *= 0.85; }
          } else { age[i] = lf; Y = gh + 0.02; }
        }
      }
      const t = a / lf;
      const e = 1 - (1 - t) * (1 - t);
      const size = s0[i] + (s1[i] - s0[i]) * e;
      if (fl & F_LIFT) {
        const gl = fx._ground(X, Z) + size * 0.4;
        if (Y < gl) { Y = gl; if (vy[i] < 0) vy[i] = 0; }
      }
      px[i] = X; py[i] = Y; pz[i] = Z;
      rot[i] += rotV[i] * dt;
      let al = this.a0[i] + (this.a1[i] - this.a0[i]) * t;
      const f0 = fi[i];
      if (f0 > 0 && t < f0) al *= smooth(0, 1, t / f0);
      const f1 = fo[i];
      if (t > f1) { const u = (t - f1) / (1 - f1 + 1e-6); al *= 1 - u * u * (3 - 2 * u); }
      aP[o] = X; aP[o + 1] = Y; aP[o + 2] = Z; aP[o + 3] = size;
      const st = stretch[i];
      if (st > 0) {
        const vv = hypot(vx[i], vy[i], vz[i]);
        aV[o] = vx[i]; aV[o + 1] = vy[i]; aV[o + 2] = vz[i]; aV[o + 3] = Math.max(size, vv * st);
      } else aV[o + 3] = 0;
      aC[o] = this.r0[i] + (this.r1[i] - this.r0[i]) * t; aC[o + 1] = this.g0[i] + (this.g1[i] - this.g0[i]) * t;
      aC[o + 2] = this.b0[i] + (this.b1[i] - this.b0[i]) * t; aC[o + 3] = al;
      aM[o + 1] = rot[i];
    }
    this.high = hi; this.alive = alive;
    this.geo.instanceCount = hi;
    this.mesh.visible = hi > 0;
    if (hi > 0) {
      const A = this._attrs;
      for (let q = 0; q < 4; q++) { const at = A[q]; at.clearUpdateRanges(); at.addUpdateRange(0, hi * 4); at.needsUpdate = true; }
    }
  }
}

// ───────────────────────────────────────────────── bolt ribbon ──────────────────────────────────────────────
const MAX_BOLT_PTS = 220;          // polyline points per bolt (main + branches)
class Bolt {
  constructor(tex) {
    this.pts = new Float32Array(MAX_BOLT_PTS * 3);
    this.wid = new Float32Array(MAX_BOLT_PTS);
    this.start = []; this.len = [];            // polylines
    const quadsMax = MAX_BOLT_PTS * 2;          // two layers
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(quadsMax * 2 * 3), 3); this.pos.setUsage(THREE.DynamicDrawUsage);
    this.uv = new THREE.BufferAttribute(new Float32Array(quadsMax * 2 * 2), 2);
    this.rgb = new THREE.BufferAttribute(new Float32Array(quadsMax * 2 * 3), 3);
    this.index = new THREE.BufferAttribute(new Uint16Array(quadsMax * 6), 1);
    g.setAttribute('position', this.pos); g.setAttribute('uv', this.uv); g.setAttribute('color', this.rgb); g.setIndex(this.index);
    const m = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.renderOrder = 30;
    this.mesh.raycast = () => {};
    this.npts = 0; this.age = 99; this.nverts = 0; this.nidx = 0;
  }
}

// ─────────────────────────────────────────────────── Effects ────────────────────────────────────────────────
export class Effects {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.time = 0;
    this._dt = 1 / 60;
    this._gasAcc = 0;
    this._lastSteam = -9; this._lastSteamPos = new THREE.Vector3();
    this._wisps = new Float32Array(3 * 96); this._nWisps = 0;
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3();
    this._q = new THREE.Quaternion();

    this.group = new THREE.Group();
    this.group.name = 'fx';
    this.scene.add(this.group);

    const atlas = makeAtlas();
    this.atlas = atlas;
    this.norm = new Pool(3300, atlas, false, 20);
    this.add = new Pool(800, atlas, true, 21);
    this.group.add(this.norm.mesh, this.add.mesh);

    this._initSlash();
    this._initLightning();
  }

  /** world ground height (0 when no collision world is available). */
  _ground(x, z) {
    const c = this.game.collision;
    return c && c.groundHeight ? c.groundHeight(x, z) : 0;
  }

  _queueWisp(x, y, z) {
    if (rnd() > 0.4 || this._nWisps >= 96) return;
    const i = this._nWisps++ * 3;
    this._wisps[i] = x; this._wisps[i + 1] = y; this._wisps[i + 2] = z;
  }

  /** free fraction of the normal pool (used to throttle bursty callers). */
  _free() { return 1 - this.norm.alive / this.norm.max; }

  // ───────────────────────── public emitters ─────────────────────────

  /** ODM gas jet. `direction` = ejection direction (backwards from the nozzle). Call every frame while boosting. */
  gas(position, direction, intensity = 1) {
    direction = direction || UP;
    intensity = clamp(intensity === undefined ? 1 : intensity, 0, 1.5);
    if (intensity <= 0.001) return;
    const P = this.norm;
    this._gasAcc += (70 + 110 * intensity) * intensity * Math.min(this._dt, 0.05);
    let guard = 0;
    while (this._gasAcc >= 1 && guard++ < 24) {
      this._gasAcc -= 1;
      const sp = rr(5, 11) * (0.7 + 0.5 * intensity);
      const sx = rr(-1, 1) * 0.16, sy = rr(-1, 1) * 0.16, sz = rr(-1, 1) * 0.16;
      const life = rr(0.38, 0.8) * (0.7 + 0.4 * intensity);
      const s1 = rr(1.1, 2.0) * (0.6 + 0.5 * intensity);
      const t = rnd();
      const i = P.spawn(position.x + rr(-0.03, 0.03), position.y + rr(-0.03, 0.03), position.z + rr(-0.03, 0.03),
        (direction.x + sx) * sp, (direction.y + sy) * sp, (direction.z + sz) * sp,
        life, rr(0.16, 0.3), s1, t < 0.4 ? TILE.CLOUD_A : t < 0.7 ? TILE.CLOUD_B : TILE.PUFF);
      P.color(i, C.gas, C.gasEnd, rr(0.75, 0.98), 0.3);
      P.phys(i, rr(3.0, 4.6), -0.7, rr(-1.2, 1.2), 0, 0);
      P.env(i, 0.05, 0.3, 0);
      if (rnd() < 0.18) {      // hot flash right at the nozzle
        const j = this.add.spawn(position.x, position.y, position.z, direction.x * 2, direction.y * 2, direction.z * 2, 0.09, 0.3, 0.7, TILE.PUFF);
        this.add.color(j, C.white, C.sparkHot, 0.55 * intensity, 0);
        this.add.phys(j, 4, 0, 0, 0, 0); this.add.env(j, 0, 0.1, 0);
      }
    }
  }

  /** Titan steam: big white billowing clouds rising for `duration` s. One call = one staggered burst. */
  steam(position, size = 3, duration = 3) {
    const P = this.norm;
    size = Math.max(0.3, size);
    // thin out callers that fire every frame at the same spot
    let n = clamp(Math.round(5 + size * 2.4), 6, 46);
    if (this.time - this._lastSteam < 0.12 && this._lastSteamPos.distanceToSquared(position) < size * size) n = Math.max(2, Math.round(n * 0.2));
    this._lastSteam = this.time; this._lastSteamPos.copy(position);
    n = Math.round(n * clamp((this._free() - 0.08) / 0.4, 0, 1));
    const rise = clamp(0.9 + size * 0.22, 1.1, 4.5);
    for (let k = 0; k < n; k++) {
      const a = rnd() * 6.2832, rad = Math.sqrt(rnd()) * size * 0.42;
      const life = duration * rr(0.7, 1.25);
      const i = P.spawn(position.x + Math.cos(a) * rad, position.y + rr(0, size * 0.25), position.z + Math.sin(a) * rad,
        Math.cos(a) * rr(0.1, 0.6) + rr(-0.3, 0.3), rise * rr(0.6, 1.25), Math.sin(a) * rr(0.1, 0.6) + rr(-0.3, 0.3),
        life, size * rr(0.3, 0.55), size * rr(1.2, 2.0), rnd() < 0.5 ? TILE.CLOUD_A : TILE.CLOUD_B);
      P.color(i, C.steam, C.steamEnd, rr(0.55, 0.85), 0.3);
      P.phys(i, rr(0.55, 0.9), -rr(0.15, 0.45) * (1 + size * 0.02), rr(-0.25, 0.25), 0, F_LIFT);
      P.rot[i] = rr(-0.5, 0.5);
      P.env(i, 0.22, 0.4, rnd() * duration * 0.45);
    }
    // a few small bright wisps that shoot up
    for (let k = 0; k < Math.min(6, n >> 2); k++) {
      const i = P.spawn(position.x + rr(-1, 1) * size * 0.3, position.y, position.z + rr(-1, 1) * size * 0.3,
        rr(-0.4, 0.4), rise * rr(1.6, 2.4), rr(-0.4, 0.4), duration * rr(0.5, 0.9), size * 0.15, size * rr(0.5, 0.8), TILE.PUFF);
      P.color(i, C.white, C.steamEnd, 0.5, 0.2); P.phys(i, 0.6, -0.3, 0, 0, 0); P.env(i, 0.15, 0.3, rnd() * duration * 0.3);
    }
  }

  /** Titan blood: dark red droplets that fall, burst into red mist and fade into faint steam. */
  blood(position, direction, size = 1) {
    direction = direction || UP;
    const P = this.norm;
    size = Math.max(0.2, size);
    let n = clamp(Math.round(10 + size * 10), 8, 50);
    n = Math.round(n * clamp((this._free() - 0.05) / 0.3, 0, 1));
    for (let k = 0; k < n; k++) {
      const sp = rr(3, 12) * (0.6 + 0.25 * Math.min(size, 3));
      const i = P.spawn(position.x, position.y, position.z,
        (direction.x + rr(-0.45, 0.45)) * sp, (direction.y + rr(-0.35, 0.55)) * sp, (direction.z + rr(-0.45, 0.45)) * sp,
        rr(0.7, 1.5), 0.06 * size * rr(0.6, 1.4) + 0.025, 0.05 * size * rr(0.5, 1.0) + 0.02, TILE.DROP);
      P.color(i, rnd() < 0.5 ? C.bloodA : C.bloodB, C.bloodB, 0.95, 0.9);
      P.phys(i, 0.35, 15, 0, 0.045, F_GROUND | F_WISP);
      P.env(i, 0, 0.85, 0);
    }
    const m = clamp(Math.round(2 + size * 2), 2, 8);
    for (let k = 0; k < m; k++) {          // mist burst
      const sp = rr(1, 4);
      const i = P.spawn(position.x, position.y, position.z, (direction.x + rr(-0.5, 0.5)) * sp, (direction.y + rr(-0.2, 0.7)) * sp, (direction.z + rr(-0.5, 0.5)) * sp,
        rr(0.6, 1.3), size * 0.25, size * rr(0.9, 1.6) + 0.4, rnd() < 0.5 ? TILE.CLOUD_A : TILE.PUFF);
      P.color(i, C.mistA, C.mistB, rr(0.35, 0.55), 0.12);
      P.phys(i, 2.2, -0.5, rr(-1, 1), 0, 0); P.env(i, 0.05, 0.2, 0);
    }
  }

  /** Hit/landing debris by material: 'stone' | 'wood' | 'bark' | 'roof' | 'ground' | 'metal' | 'flesh'. */
  impact(position, normal, material = 'ground') {
    const P = this.norm;
    normal = normal || UP;
    const N = normal;
    const px = position.x, py = position.y, pz = position.z;
    const dust = (n, c0, big, ydrift) => {
      for (let k = 0; k < n; k++) {
        const sp = rr(0.6, 3.2);
        const i = P.spawn(px, py, pz, (N.x + rr(-0.7, 0.7)) * sp, (N.y + rr(-0.4, 0.8)) * sp + ydrift, (N.z + rr(-0.7, 0.7)) * sp,
          rr(0.6, 1.3), big * rr(0.25, 0.4), big * rr(0.9, 1.5), TILE.DUST);
        P.color(i, c0, C.dustEnd, rr(0.5, 0.75), 0.12);
        P.phys(i, rr(2.2, 3.4), -0.3, rr(-1.5, 1.5), 0, F_LIFT); P.env(i, 0.06, 0.25, 0);
      }
    };
    const chips = (n, c0, c1, sizeMin, sizeMax, speed, stretch) => {
      for (let k = 0; k < n; k++) {
        const sp = rr(0.4, 1) * speed;
        const i = P.spawn(px, py, pz, (N.x * 1.2 + rr(-0.8, 0.8)) * sp, (N.y * 1.2 + rr(-0.3, 1.0)) * sp, (N.z * 1.2 + rr(-0.8, 0.8)) * sp,
          rr(0.7, 1.4), rr(sizeMin, sizeMax), rr(sizeMin, sizeMax) * 0.9, TILE.CHIP);
        P.color(i, rnd() < 0.5 ? c0 : c1, c1, 1, 1);
        P.phys(i, 0.5, 15, rr(-12, 12), stretch, F_GROUND | F_BOUNCE); P.env(i, 0, 0.8, 0);
      }
    };
    switch (material) {
      case 'stone':
        chips(9, C.stone, C.stoneDark, 0.05, 0.12, 9, 0); dust(4, C.dustStone, 1.6, 0.3); this.sparks(position, normal, 5); break;
      case 'wood': case 'bark':
        chips(8, material === 'wood' ? C.wood : C.bark, C.woodDark, 0.04, 0.09, 8, 0.05); dust(3, C.dustDirt, 1.2, 0.2); break;
      case 'roof':
        chips(9, C.roof, C.stoneDark, 0.05, 0.11, 9, 0); dust(3, C.dustStone, 1.4, 0.2); break;
      case 'metal':
        this.sparks(position, normal, 14); break;
      case 'flesh':
        this.blood(position, normal, 0.6); break;
      default:   // ground
        dust(6, C.dustDirt, 2.4, 0.5); chips(4, C.dustDirt, C.woodDark, 0.05, 0.1, 5, 0);
    }
  }

  /** Bright additive streaks (blade on metal / stone). */
  sparks(position, normal, count = 14) {
    const A = this.add;
    normal = normal || UP;
    const N = normal;
    for (let k = 0; k < count; k++) {
      const sp = rr(4, 15);
      const i = A.spawn(position.x, position.y, position.z, (N.x + rr(-0.9, 0.9)) * sp, (N.y + rr(-0.5, 1.1)) * sp, (N.z + rr(-0.9, 0.9)) * sp,
        rr(0.2, 0.55), rr(0.025, 0.05), rr(0.015, 0.03), TILE.SPARK);
      A.color(i, C.sparkHot, C.sparkEnd, 1, 0.9);
      A.phys(i, 1.3, 9, 0, 0.05, 0); A.env(i, 0, 0.55, 0);
    }
    const j = A.spawn(position.x, position.y, position.z, 0, 0, 0, 0.07, 0.35, 0.9, TILE.PUFF);
    A.color(j, C.white, C.sparkHot, 0.9, 0); A.env(j, 0, 0.1, 0);
  }

  /** Green leaves fluttering. */
  leaves(position, count = 12) {
    const P = this.norm;
    count = Math.min(Math.round(count), 40);
    for (let k = 0; k < count; k++) {
      const i = P.spawn(position.x + rr(-1.5, 1.5), position.y + rr(-1, 1), position.z + rr(-1.5, 1.5),
        rr(-3, 3), rr(-0.5, 3), rr(-3, 3), rr(1.6, 3.2), rr(0.14, 0.26), rr(0.14, 0.26), TILE.LEAF);
      const r = rnd();
      P.color(i, r < 0.5 ? C.leafA : r < 0.8 ? C.leafC : C.leafB, r < 0.8 ? C.leafB : C.leafA, 1, 1);
      P.phys(i, 1.4, 2.6, rr(-7, 7), 0, F_FLUTTER | F_GROUND);
      P.env(i, 0, 0.8, 0);
    }
  }

  // ───────────────────────────── slash arc ─────────────────────────────
  _initSlash() {
    const N = 32, a0 = -1.15, a1 = 1.15, T = 0.3;
    const pos = [], uvs = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N, a = a0 + u * (a1 - a0), w = Math.pow(Math.sin(Math.PI * u), 0.75);
      pos.push(Math.cos(a), Math.sin(a), 0, Math.cos(a) * (1 - T * w), Math.sin(a) * (1 - T * w), 0);
      uvs.push(u, 0, u, 1);
      if (i < N) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    const base = new THREE.ShaderMaterial({
      uniforms: { uHead: { value: 0 }, uTail: { value: 0 }, uAlpha: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec2 vUv; uniform float uHead, uTail, uAlpha;
        void main(){
          float u = vUv.x, v = vUv.y;
          float vis = smoothstep(uTail - 0.02, uTail + 0.22, u) * (1.0 - smoothstep(uHead - 0.015, uHead + 0.01, u));
          float lead = smoothstep(uHead - 0.35, uHead, u);                 // brighter at the leading edge
          float body = smoothstep(0.0, 0.18, v) * (1.0 - smoothstep(0.72, 1.0, v));
          float core = smoothstep(0.55, 0.0, abs(v - 0.38) * 2.2);
          vec3 c = mix(vec3(0.62, 0.82, 1.0), vec3(1.0), core);
          float a = vis * body * (0.35 + 0.65 * lead) * uAlpha;
          gl_FragColor = vec4(c * (0.8 + core * 0.7), a);
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
    });
    this.slashes = [];
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(g, base.clone());
      m.visible = false; m.frustumCulled = false; m.renderOrder = 25; m.raycast = () => {};
      m.userData.age = 99;
      this.group.add(m);
      this.slashes.push(m);
    }
    this._slashNext = 0;
  }

  /**
   * White crescent blade trail. The crescent lies in the XY plane of `quaternion` (local +Z = plane normal, so
   * pass camera.quaternion for a screen-facing slash; roll it about Z for diagonal cuts), centred on `position`,
   * bulging towards local +X, swept from -X/-Y up to +Y over ~0.18 s. `radius` in metres.
   */
  slashArc(position, quaternion, radius = 2) {
    const m = this.slashes[this._slashNext]; this._slashNext = (this._slashNext + 1) % this.slashes.length;
    m.position.copy(position); m.quaternion.copy(quaternion);
    m.scale.setScalar(radius);
    m.userData.age = 0; m.visible = true;
  }

  // ───────────────────────────── lightning ─────────────────────────────
  _initLightning() {
    // gradient across the ribbon width
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 4;
    const cx = cv.getContext('2d');
    const gr = cx.createLinearGradient(0, 0, 64, 0);
    for (let i = 0; i <= 16; i++) { const t = i / 16; const a = Math.exp(-Math.pow((t - 0.5) * 2 * 1.9, 2)); gr.addColorStop(t, `rgba(255,255,255,${a.toFixed(3)})`); }
    cx.fillStyle = gr; cx.fillRect(0, 0, 64, 4);
    const boltTex = new THREE.CanvasTexture(cv);
    boltTex.colorSpace = THREE.NoColorSpace;
    this.bolts = [new Bolt(boltTex), new Bolt(boltTex)];
    for (const b of this.bolts) this.group.add(b.mesh);

    // light pillar (soft-edged cylinder)
    const pg = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
    pg.translate(0, 0.5, 0);
    this.pillar = new THREE.Mesh(pg, new THREE.ShaderMaterial({
      uniforms: { uA: { value: 0 } },
      vertexShader: 'varying vec3 vN; varying vec3 vP; varying float vY; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vP = mv.xyz; vY = position.y; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying vec3 vN; varying vec3 vP; varying float vY; uniform float uA; void main(){ float d = abs(dot(normalize(vN), normalize(-vP))); float a = pow(d, 1.6) * uA * (1.0 - 0.55 * vY); gl_FragColor = vec4(vec3(1.0, 0.95, 0.72) * a, a); }',
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
    }));
    this.pillar.visible = false; this.pillar.frustumCulled = false; this.pillar.renderOrder = 28; this.pillar.raycast = () => {};
    this.group.add(this.pillar);

    // shockwave rings
    const rg = new THREE.RingGeometry(0.93, 1, 96, 1);
    rg.rotateX(-Math.PI / 2);
    this.rings = [];
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: i === 0 ? 0xfff2c0 : 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false }));
      m.visible = false; m.frustumCulled = false; m.renderOrder = 27; m.raycast = () => {};
      this.group.add(m); this.rings.push(m);
    }

    // screen-filling flash + temporary light (the light exists permanently at intensity 0 so materials never recompile)
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: { uI: { value: 0 }, uC: { value: new THREE.Vector2() } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'varying vec2 vP; uniform float uI; uniform vec2 uC; void main(){ float d = length((vP - uC) * vec2(1.6, 1.0)); float g = 0.38 + 0.62 * exp(-d * 1.5); vec3 c = mix(vec3(1.0, 0.93, 0.62), vec3(1.0), smoothstep(0.0, 1.2, g)); float a = clamp(uI * g, 0.0, 1.0); gl_FragColor = vec4(c, a); }',
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
    }));
    this.flash.frustumCulled = false; this.flash.renderOrder = 1000; this.flash.visible = false; this.flash.raycast = () => {};
    this.group.add(this.flash);
    this.light = new THREE.PointLight(0xfff0c0, 0, 500, 2);
    this.light.castShadow = false;
    this.group.add(this.light);

    this.strikes = [];      // active lightning events
    for (let i = 0; i < 2; i++) this.strikes.push({ active: false, age: 0, x: 0, y: 0, z: 0, h: 5, R: 30, bolt: this.bolts[i], steamAcc: 0, seed: 1 });
    this._strikeNext = 0;
  }

  /** Titan transformation: sky bolt, flash, shockwave ring, dust wave and a steam column. `height` = titan height (m). */
  lightning(position, height = 10) {
    const s = this.strikes[this._strikeNext]; this._strikeNext = (this._strikeNext + 1) % this.strikes.length;
    s.active = true; s.age = 0; s.x = position.x; s.y = position.y; s.z = position.z; s.h = Math.max(2, height);
    s.R = clamp(s.h * 2.6, 24, 170); s.steamAcc = 0; s.seed = (Math.random() * 1000) | 0;
    this._buildBolt(s);
    // immediate: dust/steam burst
    const P = this.norm;
    const n = Math.round(clamp(18 + s.h * 1.4, 18, 70) * clamp((this._free() - 0.05) / 0.3, 0, 1));
    for (let k = 0; k < n; k++) {         // radial dust wave
      const a = (k / n) * 6.2832 + rr(-0.1, 0.1), sp = s.R * rr(0.55, 0.95);
      const i = P.spawn(s.x + Math.cos(a) * 1.5, s.y + 0.6, s.z + Math.sin(a) * 1.5, Math.cos(a) * sp, rr(0.5, 3), Math.sin(a) * sp,
        rr(1.0, 1.9), s.h * 0.18, s.h * rr(0.5, 0.9), TILE.DUST);
      P.color(i, C.dustEnd, C.steamEnd, 0.55, 0.1); P.phys(i, 2.6, -0.4, rr(-1, 1), 0, F_LIFT); P.env(i, 0.05, 0.3, 0);
    }
    this.steam(position, s.h * 0.55, 3.5);
  }

  _buildBolt(s) {
    const b = s.bolt;
    const R = mulberry32(s.seed * 7919 + 13);
    const top = this._v.set(s.x + (R() - 0.5) * s.h * 3, s.y + 180 + s.h * 6, s.z + (R() - 0.5) * s.h * 3);
    let np = 0;
    b.start.length = 0; b.len.length = 0;
    const poly = (ax, ay, az, bx, by, bz, segs, jitter, w0, w1) => {
      b.start.push(np);
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      // random walk perpendicular offsets, pinned at both ends
      let ox = 0, oz = 0;
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const k = i === 0 || i === segs ? 0 : 1;
        ox += (R() - 0.5) * jitter * 1.6; oz += (R() - 0.5) * jitter * 1.6;
        ox *= 0.9; oz *= 0.9;
        const env = Math.sin(Math.PI * t);
        b.pts[np * 3] = ax + dx * t + ox * k * env; b.pts[np * 3 + 1] = ay + dy * t; b.pts[np * 3 + 2] = az + dz * t + oz * k * env;
        b.wid[np] = w0 + (w1 - w0) * t;
        np++;
      }
      b.len.push(segs + 1);
    };
    const segs = 34;
    poly(top.x, top.y, top.z, s.x, s.y, s.z, segs, (top.y - s.y) / segs * 0.9, 0.5 + s.h * 0.035, 0.2 + s.h * 0.025);
    // branches off the main stem
    const mainStart = 0;
    const nb = 4 + ((R() * 3) | 0);
    for (let k = 0; k < nb && np < MAX_BOLT_PTS - 14; k++) {
      const pi = mainStart + 5 + ((R() * (segs - 12)) | 0);
      const ax = b.pts[pi * 3], ay = b.pts[pi * 3 + 1], az = b.pts[pi * 3 + 2];
      const ang = R() * 6.2832, len = (top.y - s.y) * (0.05 + R() * 0.12);
      poly(ax, ay, az, ax + Math.cos(ang) * len * 0.8, ay - len * (0.4 + R() * 0.7), az + Math.sin(ang) * len * 0.8, 9, len * 0.12, 0.28 + s.h * 0.012, 0.03);
    }
    b.npts = np;
    // index buffer (two layers: glow then core)
    let vi = 0, ii = 0;
    const idx = b.index.array;
    for (let layer = 0; layer < 2; layer++) {
      for (let p = 0; p < b.start.length; p++) {
        const base = vi;
        for (let i = 0; i < b.len[p]; i++) {
          if (i < b.len[p] - 1) {
            idx[ii++] = vi; idx[ii++] = vi + 1; idx[ii++] = vi + 2;
            idx[ii++] = vi + 1; idx[ii++] = vi + 3; idx[ii++] = vi + 2;
          }
          vi += 2;
        }
      }
    }
    b.nverts = vi; b.nidx = ii;
    b.index.needsUpdate = true;
    const uv = b.uv.array;
    for (let v = 0; v < vi; v += 2) { uv[v * 2] = 0; uv[v * 2 + 1] = 0; uv[v * 2 + 2] = 1; uv[v * 2 + 3] = 0; }
    b.uv.needsUpdate = true;
    b.mesh.geometry.setDrawRange(0, ii);
    b.mesh.visible = true;
    // colours: glow layer first (warm, wide), core second (white)
    const col = b.rgb.array;
    const half = vi / 2;
    for (let v = 0; v < vi; v++) {
      if (v < half) { col[v * 3] = 0.95; col[v * 3 + 1] = 0.75; col[v * 3 + 2] = 0.25; }
      else { col[v * 3] = 1; col[v * 3 + 1] = 1; col[v * 3 + 2] = 0.95; }
    }
    b.rgb.needsUpdate = true;
  }

  _updateBoltGeometry(b, cam, glowW, coreW) {
    const pts = b.pts, wid = b.wid, P = b.pos.array;
    let vi = 0;
    const cx = cam.x, cy = cam.y, cz = cam.z;
    for (let layer = 0; layer < 2; layer++) {
      const wm = layer === 0 ? glowW : coreW;
      for (let p = 0; p < b.start.length; p++) {
        const s0 = b.start[p], n = b.len[p];
        for (let i = 0; i < n; i++) {
          const k = (s0 + i) * 3;
          const a = (s0 + Math.max(i - 1, 0)) * 3, c = (s0 + Math.min(i + 1, n - 1)) * 3;
          const tx = pts[c] - pts[a], ty = pts[c + 1] - pts[a + 1], tz = pts[c + 2] - pts[a + 2];
          const vx = cx - pts[k], vy = cy - pts[k + 1], vz = cz - pts[k + 2];
          let sx = ty * vz - tz * vy, sy = tz * vx - tx * vz, sz = tx * vy - ty * vx;
          const l = hypot(sx, sy, sz) || 1;
          // keep ribbon width roughly constant on screen at distance: widen with camera distance
          const dist = hypot(vx, vy, vz);
          const w = wid[s0 + i] * wm * (0.5 + Math.min(dist, 600) * 0.0035) / l;
          P[vi * 3] = pts[k] - sx * w; P[vi * 3 + 1] = pts[k + 1] - sy * w; P[vi * 3 + 2] = pts[k + 2] - sz * w;
          P[vi * 3 + 3] = pts[k] + sx * w; P[vi * 3 + 4] = pts[k + 1] + sy * w; P[vi * 3 + 5] = pts[k + 2] + sz * w;
          vi += 2;
        }
      }
    }
    b.pos.needsUpdate = true;
  }

  _updateLightning(dt) {
    const cam = this.game.camera || _fallbackCam;
    let flash = 0, lightI = 0, fx = 0, fy = 0, any = false, pillarA = 0, ringsUsed = 0;
    for (let si = 0; si < this.strikes.length; si++) {
      const s = this.strikes[si];
      if (!s.active) continue;
      s.age += dt;
      const a = s.age;
      if (a > 2.2) { s.active = false; s.bolt.mesh.visible = false; this.rings[si].visible = false; continue; }
      any = true;
      // flicker pattern: strong first strike, two re-strikes
      const pulse = a < 0.06 ? 1 : a < 0.1 ? 0.35 : a < 0.17 ? 0.95 : a < 0.22 ? 0.3 : a < 0.3 ? 0.75 : Math.exp(-(a - 0.3) * 6) * 0.6;
      const boltVis = a < 0.6 ? pulse * (a < 0.35 ? 1 : 1 - (a - 0.35) / 0.25) : 0;
      // bolt
      const b = s.bolt;
      if (boltVis > 0.01) {
        b.mesh.visible = true;
        // slightly re-jitter the branches while it flickers
        this._updateBoltGeometry(b, cam.position, 1.0 + 3.2 * pulse, 0.9);
        b.mesh.material.color.setScalar(clamp(boltVis * 1.25, 0, 1.5));
      } else b.mesh.visible = false;
      // flash / light
      const f = (a < 0.1 ? 1 : 0.7 + 0.3 * Math.sin(a * 55)) * Math.exp(-a * 3.8);
      flash = Math.max(flash, f * 1.05);
      lightI = Math.max(lightI, f);
      if (f > 0.5 || !fx) {
        // flash centre follows the strike on screen
        this._v.set(s.x, s.y + s.h * 0.5, s.z).project(cam);
        if (this._v.z < 1) { fx = clamp(this._v.x, -1.5, 1.5); fy = clamp(this._v.y, -1.5, 1.5); }
      }
      // pillar
      const pa = a < 0.5 ? (a < 0.12 ? 1 : 0.8 * (1 - (a - 0.12) / 0.38)) : 0;
      if (pa > 0) { pillarA = Math.max(pillarA, pa); this.pillar.position.set(s.x, s.y, s.z); this.pillar.scale.set(s.h * 0.35 * (1 + a * 2), 400, s.h * 0.35 * (1 + a * 2)); }
      // rings
      const rg = this.rings[si];
      if (a < 1.1) {
        const t = a / 1.1, e = 1 - Math.pow(1 - t, 2.6);
        rg.visible = true; rg.position.set(s.x, s.y + 0.4, s.z); rg.scale.set(1 + s.R * e, 1, 1 + s.R * e);
        rg.material.opacity = Math.pow(1 - t, 1.3) * 1.0;
      } else rg.visible = false;
      // sustained steam column for ~1.4 s
      if (a < 1.4) {
        s.steamAcc += dt * (30 + s.h * 2.5) * (1 - a / 1.4);
        const P = this.norm;
        let guard = 0;
        while (s.steamAcc >= 1 && guard++ < 6) {
          s.steamAcc -= 1;
          if (this._free() < 0.12) break;
          const ang = rnd() * 6.2832, rad = Math.sqrt(rnd()) * s.h * 0.4;
          const i = P.spawn(s.x + Math.cos(ang) * rad, s.y + rr(0, s.h * 0.6), s.z + Math.sin(ang) * rad,
            Math.cos(ang) * rr(0.3, 2), rr(3, 6 + s.h * 0.5), Math.sin(ang) * rr(0.3, 2), rr(2.2, 4), s.h * rr(0.25, 0.4), s.h * rr(1.0, 1.6),
            rnd() < 0.5 ? TILE.CLOUD_A : TILE.CLOUD_B);
          P.color(i, C.steam, C.steamEnd, rr(0.55, 0.8), 0.3); P.phys(i, 0.7, -0.3, rr(-0.3, 0.3), 0, F_LIFT); P.env(i, 0.12, 0.45, 0);
        }
      }
    }
    this.pillar.visible = pillarA > 0;
    this.pillar.material.uniforms.uA.value = pillarA;
    this.flash.visible = flash > 0.004;
    this.flash.material.uniforms.uI.value = flash;
    this.flash.material.uniforms.uC.value.set(fx, fy);
    this.light.intensity = lightI * 6500;
    if (any || lightI > 0) {
      // light sits above the strike
      for (const s of this.strikes) if (s.active) { this.light.position.set(s.x, s.y + s.h * 1.2 + 6, s.z); break; }
    }
  }

  // ───────────────────────────── per-frame ─────────────────────────────
  update(dt) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    this._dt = dt;
    this.time += dt;
    this._nWisps = 0;
    this.norm.update(dt, this);
    this.add.update(dt, this);
    // blood wisps queued by dying droplets → faint steam
    for (let k = 0; k < this._nWisps; k++) {
      const x = this._wisps[k * 3], y = this._wisps[k * 3 + 1], z = this._wisps[k * 3 + 2];
      const i = this.norm.spawn(x, y, z, rr(-0.3, 0.3), rr(0.4, 1.0), rr(-0.3, 0.3), rr(0.9, 1.6), 0.25, rr(0.8, 1.4), TILE.CLOUD_A);
      this.norm.color(i, C.mistA, C.steam, 0.22, 0.1); this.norm.phys(i, 0.8, -0.35, rr(-0.5, 0.5), 0, 0); this.norm.env(i, 0.2, 0.3, 0);
    }
    this._nWisps = 0;
    // slash arcs
    for (const m of this.slashes) {
      if (!m.visible) continue;
      const u = m.userData;
      u.age += dt;
      const a = u.age, D = 0.2;
      if (a >= D) { m.visible = false; continue; }
      const head = 1.05 * (1 - Math.pow(1 - clamp(a / 0.085, 0, 1), 2.2));
      const tail = clamp((a - 0.03) / 0.17, 0, 1.15) * 1.1;
      const un = m.material.uniforms;
      un.uHead.value = head * 1.02; un.uTail.value = tail; un.uAlpha.value = 1 - smooth(0.1, 0.2, a);
    }
    this._updateLightning(dt);
  }

  /** drop everything (scene change / restart). */
  clear() {
    for (const P of [this.norm, this.add]) { P.life.fill(0); P.aPos.array.fill(0); P.high = 0; P.alive = 0; P.geo.instanceCount = 0; P.mesh.visible = false; }
    for (const s of this.strikes) { s.active = false; s.bolt.mesh.visible = false; }
    for (const m of this.slashes) m.visible = false;
    for (const r of this.rings) r.visible = false;
    this.pillar.visible = false; this.flash.visible = false; this.light.intensity = 0;
  }
}

// ──────────────────────────────────────────────── SpeedLines ───────────────────────────────────────────────
/**
 * Anime radial speed lines drawn over the finished frame.
 *   const lines = new SpeedLines(renderer);
 *   lines.setIntensity(0..1);               // 0 = off (render() is then a no-op)
 *   renderer.render(scene, camera);
 *   lines.render();                         // right after; keeps autoClear / info counters intact
 */
export class SpeedLines {
  constructor(renderer) {
    this.renderer = renderer;
    this.intensity = 0; this.shown = 0;
    this.time = 0; this._last = performance.now();
    this._size = new THREE.Vector2();
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uI: { value: 0 }, uAspect: { value: 1.78 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `varying vec2 vUv; uniform float uTime, uI, uAspect;
        float hash(float n){ return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
        void main(){
          vec2 p = (vUv - 0.5) * 2.0 * vec2(uAspect, 1.0);
          float r = length(p);
          float an = atan(p.y, p.x) / 6.2831853 + 0.5;
          float step_ = floor(uTime * 15.0);          // animate "on twos" like hand-drawn lines
          float alpha = 0.0;
          for (int L = 0; L < 3; L++) {
            float N = L == 0 ? 70.0 : (L == 1 ? 130.0 : 220.0);
            float x = an * N;
            float id = floor(x);
            float f = fract(x);
            float seed = id * 1.731 + float(L) * 57.3 + step_ * 3.17;
            float h = hash(seed);
            float on = step(1.0 - (0.22 + 0.5 * uI) * (L == 0 ? 1.0 : (L == 1 ? 0.8 : 0.6)), h);
            float start = mix(0.5, 1.0, hash(seed + 3.1)) - 0.32 * uI;
            float w = mix(0.1, 0.34, hash(seed + 5.7)) * (L == 0 ? 1.0 : (L == 1 ? 0.7 : 0.5));
            float taper = smoothstep(start, start + 0.9, r);
            float d = abs(f - 0.5) * 2.0;
            float line = clamp(1.0 - d / max(w * taper, 1e-3), 0.0, 1.0);
            line = line * line * (3.0 - 2.0 * line);
            alpha += on * line * smoothstep(start, start + 0.18, r);
          }
          alpha = clamp(alpha, 0.0, 1.0) * clamp(uI * 1.15, 0.0, 1.0) * 0.9;
          gl_FragColor = vec4(vec3(0.97, 0.985, 1.0), alpha);
        }`,
      transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  /** 0..1 */
  setIntensity(v) { this.intensity = clamp(v || 0, 0, 1); }

  render() {
    const now = performance.now();
    const dt = Math.min((now - this._last) / 1000, 0.1); this._last = now;
    // smooth in/out so the lines never pop
    this.shown += (this.intensity - this.shown) * (1 - Math.exp(-(this.intensity > this.shown ? 9 : 5) * dt));
    this.time += dt;
    if (this.shown < 0.01) return;
    const r = this.renderer;
    r.getSize(this._size);
    this.mat.uniforms.uAspect.value = this._size.x / Math.max(1, this._size.y);
    this.mat.uniforms.uTime.value = this.time;
    this.mat.uniforms.uI.value = this.shown;
    const ac = r.autoClear, info = r.info.render;
    const calls = info.calls, tri = info.triangles, pts = info.points, lines = info.lines;
    r.autoClear = false;
    r.render(this.scene, this.cam);
    r.autoClear = ac;
    info.calls = calls; info.triangles = tri; info.points = pts; info.lines = lines;
  }
}
