// Wings of Freedom — the Survey Corps soldier (procedural, cel-shaded) with ODM gear, two blades and a cloth-sim cape.
//
//   const model = new PlayerModel(game);      // game.scene gets model.root added by the CORE (we only build the Group)
//   model.update(dt, state);                  // see ARCHITECTURE.md; positions itself from state.position (body centre,
//                                             // feet at position.y - 0.9) and orients itself from forward/up.
//   model.hookOrigin(side, outVec3)           // world position of the anchor launcher barrel (0 left, 1 right)
//   model.gasNozzle(outPos, outDir)           // world position + unit ejection direction of the gas jet
//
// Extras (not in the contract): model.autoGas (default true: update() calls game.fx.gas() itself while boosting;
// set false if the core calls fx.gas(gasNozzle…) on its own), model.setVisible(bool), model.dispose().
//
// Frames: model +Z = the way the chest faces, +Y = head, +X = the soldier's LEFT. The pelvis (body centre) is the pivot
// of the whole body; `root` only translates, the `pivot` child carries the orientation. The cape is simulated in the
// root-relative world-aligned frame (a translating, non-rotating frame): inertial pseudo-force = -body acceleration
// (clamped), air drag against the apparent wind (-velocity), so it streams behind at speed and flutters.
//
// Draw calls: the soldier is modelled as ~100 small parts on 15 animated joint groups (+ the two blade groups), then
// _bake() packs them: every static part is baked into ONE rigidly skinned body mesh (each vertex weighted 1.0 to its
// joint group, so it moves exactly like the per-part meshes did) with per-vertex colour + emissive on one shared
// toon material, and every cel outline into ONE baked inverted hull (offsets pre-applied, per-vertex outline colour).
// Each blade is one mesh + one hull. Colour pass: 2 body + 4 blades + 3 cape = 9 calls (+1 gas jet while boosting);
// shadow pass: body, 2 blades, cape = 4 (was ~180 + ~90).
import * as THREE from 'three';
import { toonMaterial } from '../core/style.js';

// Math.hypot is variadic and boxes its arguments in hot loops (it was the top source of garbage); this doesn't.
const hypot = (a, b, c = 0) => Math.sqrt(a * a + b * b + c * c);


const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const finite = (x) => (Number.isFinite(x) ? x : 0);

// ───────────────────────────────────────────── Wings of Freedom emblem ──────────────────────────────────────
function drawWing(ctx, x, y, ang, L, fill, stroke, lw, mirror) {
  // one stylised wing: smooth leading edge on top, long stepped feather tips along the underside
  ctx.save();
  ctx.translate(x, y);
  if (mirror) ctx.scale(-1, 1);
  ctx.rotate(ang);
  ctx.lineJoin = 'miter'; ctx.miterLimit = 3; ctx.lineCap = 'round';
  const pts = [[1.0, 0.0], [0.80, 0.075], [0.9, 0.2], [0.66, 0.2], [0.74, 0.34], [0.5, 0.33], [0.55, 0.46], [0.34, 0.44], [0.3, 0.52]];
  ctx.beginPath();
  ctx.moveTo(-0.04 * L, 0.1 * L);
  ctx.bezierCurveTo(0.02 * L, -0.22 * L, 0.55 * L, -0.34 * L, L, 0);                 // leading edge
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * L, pts[i][1] * L);
  ctx.quadraticCurveTo(0.05 * L, 0.5 * L, -0.04 * L, 0.1 * L);
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke();
  // feather separations: from each inner notch back towards the root
  ctx.lineWidth = lw * 0.75;
  for (const i of [1, 3, 5, 7]) {
    const nx = pts[i][0] * L, ny = pts[i][1] * L;
    ctx.beginPath(); ctx.moveTo(nx, ny); ctx.quadraticCurveTo(nx * 0.6, ny * 0.75 - 0.04 * L, 0.04 * L, 0.02 * L + ny * 0.1); ctx.stroke();
  }
  ctx.restore();
}

/** Draws the Wings of Freedom crest (shield + white wing over blue wing) centred at (cx, cy); S = shield width. */
export function drawEmblem(ctx, cx, cy, S) {
  ctx.save();
  ctx.translate(cx, cy);
  // shield
  const w = S * 0.5, top = -S * 0.58, bot = S * 0.64;
  ctx.beginPath();
  ctx.moveTo(-w, top + S * 0.06);
  ctx.quadraticCurveTo(0, top - S * 0.06, w, top + S * 0.06);
  ctx.lineTo(w, S * 0.12);
  ctx.quadraticCurveTo(w * 0.92, bot * 0.7, 0, bot);
  ctx.quadraticCurveTo(-w * 0.92, bot * 0.7, -w, S * 0.12);
  ctx.closePath();
  ctx.fillStyle = '#1b2a22'; ctx.fill();
  ctx.lineWidth = S * 0.035; ctx.strokeStyle = '#f3f1e6'; ctx.stroke();
  ctx.lineWidth = S * 0.012; ctx.strokeStyle = '#7e9a86';
  ctx.save(); ctx.scale(0.9, 0.9); ctx.stroke(); ctx.restore();
  // clip wings to the shield interior so they never leave the crest
  ctx.save();
  ctx.clip();
  const L = S * 0.8;
  // blue wing (behind): root lower-right, sweeping to the upper left
  drawWing(ctx, S * 0.15, S * 0.24, -0.95, L, '#2f6fe0', '#0b1a3a', S * 0.02, true);
  // white wing (front): root lower-left, sweeping to the upper right, overlapping the blue one
  drawWing(ctx, -S * 0.17, S * 0.26, -0.5, L, '#f7f6ee', '#15202c', S * 0.02, false);
  ctx.restore();
  ctx.restore();
}

function makeCapeTexture() {
  const W = 512, H = 800;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#3f6e47'); g.addColorStop(0.55, '#34603d'); g.addColorStop(1, '#2a4c33');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  // soft vertical fabric folds
  for (let i = 0; i < 46; i++) {
    const x = Math.random() * W, w = 6 + Math.random() * 26;
    c.fillStyle = `rgba(${Math.random() < 0.5 ? '12,36,20' : '95,150,100'},${(0.05 + Math.random() * 0.07).toFixed(3)})`;
    c.fillRect(x, 0, w, H);
  }
  // hem + side trim (reads as the cel outline)
  c.fillStyle = '#1d3524'; c.fillRect(0, H - 34, W, 34);
  c.fillStyle = '#9fba9d'; c.fillRect(0, H - 40, W, 4);
  c.fillStyle = '#1d3524'; c.fillRect(0, 0, 12, H); c.fillRect(W - 12, 0, 12, H);
  drawEmblem(c, W / 2, 330, 330);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ───────────────────────────────────────────────── cape cloth sim ───────────────────────────────────────────
const CC = 9, CR = 10, CN = CC * CR;
const CAPE_LEN = 1.22, CAPE_W0 = 0.46, CAPE_W1 = 0.98;

class CapeSim {
  constructor() {
    this.pos = new Float32Array(CN * 3);
    this.pred = new Float32Array(CN * 3);
    this.vel = new Float32Array(CN * 3);
    this.anchor = new Float32Array(CC * 3);      // current pin targets (root-relative)
    this.anchorPrev = new Float32Array(CC * 3);
    this.nrm = new Float32Array(CN * 3);
    this.rest0 = new Float32Array(CN * 3);        // flat rest layout (x, y, 0)
    this.inited = false;
    // constraints
    const ia = [], ib = [], rest = [], k = [];
    const idx = (r, c) => r * CC + c;
    const rp = this.rest0;
    for (let r = 0; r < CR; r++) {
      const w = lerp(CAPE_W0, CAPE_W1, r / (CR - 1));
      for (let c = 0; c < CC; c++) {
        const i = idx(r, c) * 3;
        rp[i] = (0.5 - c / (CC - 1)) * w; rp[i + 1] = -r * (CAPE_LEN / (CR - 1)); rp[i + 2] = 0;
      }
    }
    const add = (a, b, stiff) => {
      const dx = rp[a * 3] - rp[b * 3], dy = rp[a * 3 + 1] - rp[b * 3 + 1];
      ia.push(a); ib.push(b); rest.push(hypot(dx, dy)); k.push(stiff);
    };
    for (let r = 0; r < CR; r++) for (let c = 0; c < CC; c++) {
      if (c + 1 < CC) add(idx(r, c), idx(r, c + 1), 1.0);
      if (r + 1 < CR) add(idx(r, c), idx(r + 1, c), 1.0);
      if (r + 1 < CR && c + 1 < CC) { add(idx(r, c), idx(r + 1, c + 1), 0.6); add(idx(r, c + 1), idx(r + 1, c), 0.6); }
      if (c + 2 < CC) add(idx(r, c), idx(r, c + 2), 0.12);
      if (r + 2 < CR) add(idx(r, c), idx(r + 2, c), 0.12);
    }
    this.ia = Uint16Array.from(ia); this.ib = Uint16Array.from(ib); this.rest = Float32Array.from(rest); this.k = Float32Array.from(k);
    this.nCon = ia.length;
    this.spheres = new Float32Array(12 * 7);       // x,y,z,r, back-direction nx,ny,nz (root-relative)
    this.nSph = 0;
    this.accel = new THREE.Vector3();             // low-passed body acceleration
    this.prevVel = new THREE.Vector3();
    this.hasPrev = false;
    this.t = 0;
  }

  /** lay the cape out streaming away from the apparent wind (or hanging when still), on the back side of the body. */
  reset(windX, windY, windZ, backX, backY, backZ) {
    const a = this.anchor, p = this.pos;
    let dx = windX * 0.05, dy = windY * 0.05 - 3.5, dz = windZ * 0.05;
    const l = hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    const dy2 = CAPE_LEN / (CR - 1);
    for (let r = 0; r < CR; r++) for (let c = 0; c < CC; c++) {
      const i = (r * CC + c) * 3, ai = c * 3;
      const spread = 1 + 0.9 * r / (CR - 1);
      p[i] = a[ai] * spread + dx * r * dy2 + backX * (0.03 + 0.012 * r);
      p[i + 1] = a[ai + 1] + dy * r * dy2 + backY * (0.03 + 0.012 * r);
      p[i + 2] = a[ai + 2] + dz * r * dy2 + backZ * (0.03 + 0.012 * r);
      this.vel[i] = this.vel[i + 1] = this.vel[i + 2] = 0;
    }
    this.pred.set(p);
    this.anchorPrev.set(a);
    this.inited = true;
  }

  /** smooth outward normals (-Z side) from the grid, written into `out` (Float32Array CN*3). Allocation-free. */
  normals(P, out) {
    for (let r = 0; r < CR; r++) {
      const r0 = Math.max(r - 1, 0), r1 = Math.min(r + 1, CR - 1);
      for (let c = 0; c < CC; c++) {
        const c0 = Math.max(c - 1, 0), c1 = Math.min(c + 1, CC - 1);
        const a = (r * CC + c1) * 3, b = (r * CC + c0) * 3, d = (r1 * CC + c) * 3, e = (r0 * CC + c) * 3;
        const ux = P[a] - P[b], uy = P[a + 1] - P[b + 1], uz = P[a + 2] - P[b + 2];
        const vx = P[d] - P[e], vy = P[d + 1] - P[e + 1], vz = P[d + 2] - P[e + 2];
        const nx = vy * uz - vz * uy, ny = vz * ux - vx * uz, nz = vx * uy - vy * ux;
        const l = hypot(nx, ny, nz) || 1;
        const o = (r * CC + c) * 3;
        out[o] = nx / l; out[o + 1] = ny / l; out[o + 2] = nz / l;
      }
    }
  }

  /** advance by dt. wind = apparent air velocity in the frame (−body velocity), accel = body acceleration. */
  step(dt, windX, windY, windZ, speedFrac, bkX, bkY, bkZ) {
    const nSub = clamp(Math.ceil(dt * 120), 1, 6);
    const h = dt / nSub;
    const P = this.pos, Q = this.pred, V = this.vel, N = this.nrm;
    const ax = -this.accel.x, ay = -this.accel.y, az = -this.accel.z;       // inertial pseudo-force
    const fT = 1 - Math.exp(-1.15 * h), fN = 1 - Math.exp(-4.4 * h);
    const damp = Math.exp(-0.5 * h);
    const gy = -9.8 * 0.55;
    const ia = this.ia, ib = this.ib, rest = this.rest, kk = this.k, nCon = this.nCon;
    const sph = this.spheres, nSph = this.nSph;
    const gustAmp = (2.5 + 30.0 * speedFrac), lift = 60.0 * speedFrac;
    for (let sub = 0; sub < nSub; sub++) {
      const al = (sub + 1) / nSub;
      this.t += h;
      // pins slide from the previous anchor to the current one across the frame
      for (let c = 0; c < CC; c++) {
        const i = c * 3;
        Q[i] = P[i] = this.anchorPrev[i] + (this.anchor[i] - this.anchorPrev[i]) * al;
        Q[i + 1] = P[i + 1] = this.anchorPrev[i + 1] + (this.anchor[i + 1] - this.anchorPrev[i + 1]) * al;
        Q[i + 2] = P[i + 2] = this.anchorPrev[i + 2] + (this.anchor[i + 2] - this.anchorPrev[i + 2]) * al;
        V[i] = V[i + 1] = V[i + 2] = 0;
      }
      // surface normals from the current positions
      for (let r = 0; r < CR; r++) {
        const r0 = Math.max(r - 1, 0), r1 = Math.min(r + 1, CR - 1);
        for (let c = 0; c < CC; c++) {
          const c0 = Math.max(c - 1, 0), c1 = Math.min(c + 1, CC - 1);
          const a = (r * CC + c1) * 3, b = (r * CC + c0) * 3, d = (r1 * CC + c) * 3, e = (r0 * CC + c) * 3;
          const ux = P[a] - P[b], uy = P[a + 1] - P[b + 1], uz = P[a + 2] - P[b + 2];
          const vx = P[d] - P[e], vy = P[d + 1] - P[e + 1], vz = P[d + 2] - P[e + 2];
          let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          const l = hypot(nx, ny, nz) || 1;
          const o = (r * CC + c) * 3;
          N[o] = nx / l; N[o + 1] = ny / l; N[o + 2] = nz / l;
        }
      }
      // forces → predicted positions
      for (let r = 1; r < CR; r++) {
        for (let c = 0; c < CC; c++) {
          const i = (r * CC + c) * 3;
          let vx = V[i], vy = V[i + 1], vz = V[i + 2];
          // gust: flutter along the normal, stronger lower down and with speed
          const ph = this.t * 11 + r * 0.85 + c * 1.35 + Math.sin(this.t * 2.3 + c) * 1.5;
          const sn = Math.sin(ph);
          const edge = 0.55 + 0.45 * Math.abs(c - 4) / 4;                  // the corners whip more than the centre
          const gust = sn * gustAmp * (0.25 + r / CR) * edge;
          const lf = lift * (0.5 + 0.5 * Math.sin(ph * 0.8 - c * 0.5)) * Math.pow(r / CR, 1.4) * edge;   // billow away from the back
          vx += (ax + N[i] * gust + bkX * lf) * h; vy += (gy + ay + N[i + 1] * gust + bkY * lf) * h; vz += (az + N[i + 2] * gust + bkZ * lf) * h;
          // drag against the wind: isotropic part + extra along the normal (cloth catches air)
          const rx = windX - vx, ry = windY - vy, rz = windZ - vz;
          const nd = N[i] * rx + N[i + 1] * ry + N[i + 2] * rz;
          vx += rx * fT + N[i] * nd * fN; vy += ry * fT + N[i + 1] * nd * fN; vz += rz * fT + N[i + 2] * nd * fN;
          const sp = vx * vx + vy * vy + vz * vz;
          if (sp > 22500) { const s = 150 / Math.sqrt(sp); vx *= s; vy *= s; vz *= s; }
          V[i] = vx; V[i + 1] = vy; V[i + 2] = vz;
          Q[i] = P[i] + vx * h; Q[i + 1] = P[i + 1] + vy * h; Q[i + 2] = P[i + 2] + vz * h;
        }
      }
      // constraints + collisions
      for (let it = 0; it < 5; it++) {
        for (let j = 0; j < nCon; j++) {
          const a = ia[j], b = ib[j];
          const A = a * 3, B = b * 3;
          let dx = Q[B] - Q[A], dy = Q[B + 1] - Q[A + 1], dz = Q[B + 2] - Q[A + 2];
          const d = hypot(dx, dy, dz);
          if (d < 1e-7) continue;
          const diff = (d - rest[j]) / d * kk[j];
          const wa = a < CC ? 0 : 1, wb = b < CC ? 0 : 1;
          const ws = wa + wb;
          if (ws === 0) continue;
          const fa = diff * wa / ws, fb = diff * wb / ws;
          Q[A] += dx * fa; Q[A + 1] += dy * fa; Q[A + 2] += dz * fa;
          Q[B] -= dx * fb; Q[B + 1] -= dy * fb; Q[B + 2] -= dz * fb;
        }
        for (let i = CC; i < CN; i++) {
          const o = i * 3;
          for (let s = 0; s < nSph; s++) {
            const so = s * 7;
            const dx = Q[o] - sph[so], dy = Q[o + 1] - sph[so + 1], dz = Q[o + 2] - sph[so + 2];
            const rr = sph[so + 3];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < rr * rr) {
              // always leave through the BACK of the body (the cape never ends up on the belly side)
              const nx = sph[so + 4], ny = sph[so + 5], nz = sph[so + 6];
              const dn = dx * nx + dy * ny + dz * nz;
              const tt = -dn + Math.sqrt(Math.max(dn * dn - d2 + rr * rr, 0));
              Q[o] += nx * tt; Q[o + 1] += ny * tt; Q[o + 2] += nz * tt;
            }
          }
        }
      }
      // velocity from the corrected positions
      for (let i = CC * 3; i < CN * 3; i++) { V[i] = (Q[i] - P[i]) / h * damp; P[i] = Q[i]; }
    }
    this.anchorPrev.set(this.anchor);
  }
}

// ───────────────────────────────────────────────── the model ────────────────────────────────────────────────
// pose channels (all in the body-local joint frame; arms/legs in radians)
const SPX = 0, SPY = 1, SPZ = 2, HDX = 3, HDY = 4,
  LSX = 5, LSZ = 6, LSY = 7, LEX = 8, LWX = 9,
  RSX = 10, RSZ = 11, RSY = 12, REX = 13, RWX = 14,
  LHX = 15, LHZ = 16, LKX = 17, LAX = 18,
  RHX = 19, RHZ = 20, RKX = 21, RAX = 22,
  BOB = 23, NCH = 24;

const kf = (q, v0, v1, v2, v3) => (q < 0.2 ? lerp(v0, v1, sstep(0, 0.2, q)) : q < 0.58 ? lerp(v1, v2, sstep(0.2, 0.58, q)) : lerp(v2, v3, sstep(0.58, 1, q)));

// a modelling part: a temporary Mesh in the joint hierarchy; _bake() merges it away. `outline` = hull thickness (m).
function mesh(geo, mat, parent, x = 0, y = 0, z = 0, outline = 0.01) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.userData.ol = outline;
  if (parent) parent.add(m);
  return m;
}
function group(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group(); g.position.set(x, y, z); if (parent) parent.add(g); return g;
}

// ───────────────────────────────────────────── part baking (draw-call merge) ─────────────────────────────────
const OUTLINE_COLOR = 0x1a1410;      // = core/style.js outlineMaterial default
/** Toon material driven by vertex colour + a per-vertex emissive (aEmis.rgb) + aEmis.a × uFlash (the blade shine). */
function vcMaterial(flash = 0x000000) {
  const m = toonMaterial(0xffffff, { vertexColors: true });
  const u = { value: new THREE.Color(flash) };
  m.userData.flash = u.value;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFlash = u;
    sh.vertexShader = 'attribute vec4 aEmis;\nvarying vec4 vEmis;\n' +
      sh.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\n\tvEmis = aEmis;');
    sh.fragmentShader = 'uniform vec3 uFlash;\nvarying vec4 vEmis;\n' +
      sh.fragmentShader.replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = vEmis.rgb + vEmis.a * uFlash;');
  };
  m.customProgramCacheKey = () => 'wof-vc-emis';
  return m;
}
let _bodyMat = null, _hullMat = null;
const bodyMaterial = () => (_bodyMat ||= vcMaterial());
// inverted hull with the offsets baked into the geometry: plain back faces, per-vertex outline colour
const hullMaterial = () => (_hullMat ||= new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, side: THREE.BackSide, fog: true }));

/**
 * Bakes parts [{ m: Mesh, rel: Matrix4 (part → joint), bone }] into one geometry (+ one outline-hull geometry).
 * Colour = the part material's colour; emissive = its emissive (an unlit MeshBasicMaterial part → black diffuse +
 * emissive = its colour, which renders identically); a part flagged userData.flash takes the uFlash uniform instead.
 * Hull vertices = rel · (p + normalize(n) · thickness), exactly what the inverted-hull outline shader did per part.
 */
function bakeParts(parts, skinned) {
  const P = [], N = [], C = [], E = [], B = [], I = [];
  const HP = [], HC = [], HB = [], HI = [];
  const nm = new THREE.Matrix3(), v = new THREE.Vector3(), n = new THREE.Vector3(), h = new THREE.Vector3();
  const col = new THREE.Color(), em = new THREE.Color(), oc = new THREE.Color();
  for (const { m, rel, bone } of parts) {
    const g = m.geometry, mat = m.material, pa = g.attributes.position, na = g.attributes.normal;
    nm.getNormalMatrix(rel);
    const flash = m.userData.flash ? 1 : 0;
    if (mat.isMeshBasicMaterial) { col.setRGB(0, 0, 0); em.copy(mat.color); }
    else { col.copy(mat.color); if (flash) em.setRGB(0, 0, 0); else em.copy(mat.emissive); }
    const ol = m.userData.ol || 0;
    oc.setHex(m.userData.olColor ?? OUTLINE_COLOR);
    const base = P.length / 3, hbase = HP.length / 3;
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i); n.fromBufferAttribute(na, i);
      if (ol > 0) {
        h.copy(n).normalize().multiplyScalar(ol).add(v).applyMatrix4(rel);
        HP.push(h.x, h.y, h.z); HC.push(oc.r, oc.g, oc.b); HB.push(bone);
      }
      v.applyMatrix4(rel); n.applyNormalMatrix(nm);
      P.push(v.x, v.y, v.z); N.push(n.x, n.y, n.z); C.push(col.r, col.g, col.b); E.push(em.r, em.g, em.b, flash); B.push(bone);
    }
    const ix = g.index ? g.index.array : null, cnt = ix ? ix.length : pa.count;
    for (let k = 0; k < cnt; k++) { const j = ix ? ix[k] : k; I.push(base + j); if (ol > 0) HI.push(hbase + j); }
  }
  const skin = (geo, bones) => {
    if (!skinned) return;
    const si = new Uint16Array(bones.length * 4), sw = new Float32Array(bones.length * 4);
    for (let i = 0; i < bones.length; i++) { si[i * 4] = bones[i]; sw[i * 4] = 1; }
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  geo.setAttribute('aEmis', new THREE.Float32BufferAttribute(E, 4));
  geo.setIndex(I); skin(geo, B);
  const hull = new THREE.BufferGeometry();
  hull.setAttribute('position', new THREE.Float32BufferAttribute(HP, 3));
  hull.setAttribute('color', new THREE.Float32BufferAttribute(HC, 3));
  hull.setIndex(HI); skin(hull, HB);
  return { geo, hull };
}

// reusable scratch
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);

/** Anime face, painted once: heavy upper lids, grey-green irises with highlights, stern brows, nose, mouth. */
let _faceTex = null;
function faceTexture() {
  if (_faceTex) return _faceTex;
  const W = 256, H = 160, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const ink = '#1a120c';
  for (const side of [-1, 1]) {
    const cx = W / 2 + side * 46, cy = 70;
    // white of the eye
    g.fillStyle = '#fbf6ee';
    g.beginPath(); g.ellipse(cx, cy, 22, 13, 0, 0, Math.PI * 2); g.fill();
    // iris + pupil + highlights
    const ir = g.createRadialGradient(cx, cy - 3, 2, cx, cy, 13);
    ir.addColorStop(0, '#6f9a86'); ir.addColorStop(0.7, '#3e6a5a'); ir.addColorStop(1, '#1f3a30');
    g.fillStyle = ir; g.beginPath(); g.ellipse(cx + side * -2, cy + 1, 10.5, 12.5, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#0d1410'; g.beginPath(); g.ellipse(cx + side * -2, cy + 1, 4.5, 6, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(cx + side * -2 - 4, cy - 4, 3, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(cx + side * -2 + 3, cy + 5, 1.5, 0, Math.PI * 2); g.fill();
    // heavy upper lid (thick, angled down toward the nose: the determined Survey Corps glare)
    g.strokeStyle = ink; g.lineCap = 'round';
    g.lineWidth = 6;
    g.beginPath(); g.moveTo(cx - side * 25, cy - 4 + 2); g.quadraticCurveTo(cx, cy - 18, cx + side * 24, cy - 8); g.stroke();
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx - side * 18, cy + 12); g.quadraticCurveTo(cx, cy + 16, cx + side * 18, cy + 10); g.stroke();
    // brow: low and angled, pinched toward the centre
    g.lineWidth = 7;
    g.beginPath(); g.moveTo(cx - side * 26, cy - 22); g.lineTo(cx + side * 22, cy - 30); g.stroke();
  }
  // nose (shadow line) and mouth
  g.strokeStyle = 'rgba(150,90,60,0.8)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(W / 2 + 4, 92); g.lineTo(W / 2 + 7, 112); g.lineTo(W / 2 + 1, 114); g.stroke();
  g.strokeStyle = '#6a3a2a'; g.lineWidth = 3.5;
  g.beginPath(); g.moveTo(W / 2 - 13, 136); g.quadraticCurveTo(W / 2, 133, W / 2 + 13, 137); g.stroke();
  _faceTex = new THREE.CanvasTexture(c);
  _faceTex.colorSpace = THREE.SRGBColorSpace;
  _faceTex.anisotropy = 4;
  return _faceTex;
}

const _fa = new THREE.Vector3(), _fdown = new THREE.Vector3(0, -1, 0);
const SOLE = 0.075;   // ankle joint height above the sole

export class PlayerModel {
  constructor(game) {
    this.game = game;
    this.autoGas = true;
    this.root = new THREE.Group();
    this.root.name = 'PlayerModel';
    this.pivot = group(this.root);
    if (game && game.scene) game.scene.add(this.root);       // idempotent: the core may add it again
    this.time = 0;
    this._build();
    this.cape = new CapeSim();
    this._buildCapeMesh();
    if (this._face) this.j.head.add(this._face);
    // loose locks on top of the baked hair: they stream back with speed and flutter in the air
    this.locks = [];
    {
      const hm = toonMaterial(0x2b2019);
      const lg = new THREE.ConeGeometry(0.022, 0.1, 4); lg.translate(0, -0.05, 0);
      for (let i = 0; i < 5; i++) {
        const piv = new THREE.Group();
        piv.position.set((i - 2) * 0.035, 0.235 - Math.abs(i - 2) * 0.012, -0.03 - Math.abs(i - 2) * 0.012);
        const m = new THREE.Mesh(lg, hm); m.castShadow = false;
        m.rotation.x = Math.PI * 0.62;          // swept back over the crown
        piv.add(m); this.j.head.add(piv);
        this.locks.push(piv);
      }
    }

    // smoothed state
    this.wRide = 0; this.wCrouch = 0; this.wAir = 0; this.wSpin = 0; this.wGrab = 0; this.wSlash = 0; this.wHook = 0; this.wBoost = 0; this.wRun = 0;
    this.theta = 0.05; this.roll = 0; this.spinAngle = 0; this.slashP = 0;
    this.up = new THREE.Vector3(0, 1, 0);
    this.heading = new THREE.Vector3(0, 0, 1);
    this.fwd = new THREE.Vector3(0, 0, 1);
    this.yawRate = 0; this._prevHeading = new THREE.Vector3(0, 0, 1);
    this.phase = 0;
    this.speedS = 0;
    this.pos = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.J = new Float32Array(NCH);               // current joint values
    this.TG = new Float32Array(NCH); this.TA = new Float32Array(NCH); this.TS = new Float32Array(NCH);
    this.TP = new Float32Array(NCH); this.TR = new Float32Array(NCH); this.TC = new Float32Array(NCH);
    this.first = true;
    this.bladeFlash = 0;
    this._gasPos = new THREE.Vector3(); this._gasDir = new THREE.Vector3();
  }

  // ───────────────────────────── construction ─────────────────────────────
  _build() {
    const M = this.mats = {
      jacket: toonMaterial(0x9a7447), jacketDark: toonMaterial(0x6f5232), trousers: toonMaterial(0xf1efe6),
      boot: toonMaterial(0x3c2616), skin: toonMaterial(0xf3cba8), hair: toonMaterial(0x2b2019),
      strap: toonMaterial(0x2a1b12), brass: toonMaterial(0xb89c5c, { emissive: 0x2a2208 }),
      steel: toonMaterial(0x6e7680, { emissive: 0x0e1014 }), steelDark: toonMaterial(0x3a3f47),
      cravat: toonMaterial(0xf5f4ee), cape: toonMaterial(0x2e5a38), eye: new THREE.MeshBasicMaterial({ color: 0x2a3a2a }),
      blade: toonMaterial(0xdde7f0, { emissive: 0x4d5f72 }), grip: toonMaterial(0x1d1a18),
      jet: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    };
    const P = this.pivot;
    const J = this.j = {};

    // ── pelvis / trousers / belt
    const pelvis = mesh(new THREE.BoxGeometry(0.31, 0.17, 0.2), M.trousers, P, 0, -0.025, 0, 0.008);
    pelvis.geometry.translate(0, 0, 0);
    mesh(new THREE.CylinderGeometry(0.165, 0.17, 0.05, 18), M.strap, P, 0, 0.05, 0, 0.006).scale.set(1.0, 1, 0.74);

    // ── spine / chest
    J.spine = group(P, 0, 0.08, 0);
    const chest = J.chest = group(J.spine, 0, 0, 0);
    const jacket = mesh(new THREE.CylinderGeometry(0.168, 0.15, 0.42, 20), M.jacket, chest, 0, 0.21, 0, 0.011);
    jacket.scale.set(1.18, 1, 0.8);
    // cropped hem flare + stand-up collar
    mesh(new THREE.CylinderGeometry(0.152 * 1.18, 0.18 * 1.18, 0.09, 20), M.jacket, chest, 0, -0.025, 0, 0.009).scale.set(1, 1, 0.78);
    const collar = mesh(new THREE.TorusGeometry(0.085, 0.024, 8, 20), M.jacketDark, chest, 0, 0.43, 0, 0.007);
    collar.rotation.x = Math.PI / 2;
    // shoulder pads
    for (const sx of [1, -1]) mesh(new THREE.SphereGeometry(0.052, 12, 10), M.jacket, chest, sx * 0.215, 0.405, 0, 0.008);

    // ── head
    const head = J.head = group(chest, 0, 0.455, 0.0);
    mesh(new THREE.CylinderGeometry(0.036, 0.04, 0.07, 10), M.skin, head, 0, 0.0, 0, 0.006);
    const skull = mesh(new THREE.SphereGeometry(0.1, 20, 16), M.skin, head, 0, 0.145, 0.008, 0.008);
    skull.scale.set(0.96, 1.08, 1.0);
    // hair cap + fringe
    const hair = mesh(new THREE.SphereGeometry(0.106, 20, 14, 0, TAU, 0, 1.92), M.hair, head, 0, 0.155, -0.004, 0.007);
    hair.scale.set(0.99, 1.08, 1.04);
    for (let i = 0; i < 5; i++) {
      const f = mesh(new THREE.ConeGeometry(0.03, 0.07, 6), M.hair, head, (i - 2) * 0.04, 0.197 - Math.abs(i - 2) * 0.012, 0.085, 0.004);
      f.rotation.x = Math.PI * 0.92; f.rotation.z = (i - 2) * 0.12;
    }
    // fuller, spikier fringe and side locks (the Survey Corps cut)
    for (let i = 0; i < 4; i++) {
      const f = mesh(new THREE.ConeGeometry(0.026, 0.085, 5), M.hair, head, (i - 1.5) * 0.05, 0.2, 0.07, 0.004);
      f.rotation.x = Math.PI * 0.86; f.rotation.z = (i - 1.5) * 0.25;
    }
    for (const sx of [1, -1]) {
      const lock = mesh(new THREE.ConeGeometry(0.028, 0.11, 5), M.hair, head, sx * 0.092, 0.15, 0.03, 0.004);
      lock.rotation.z = sx * 2.9; lock.rotation.x = 0.15;
      const back = mesh(new THREE.ConeGeometry(0.035, 0.09, 5), M.hair, head, sx * 0.04, 0.1, -0.085, 0.004);
      back.rotation.x = 2.6; back.rotation.z = sx * 0.3;
      mesh(new THREE.SphereGeometry(0.018, 8, 6), M.skin, head, sx * 0.1, 0.14, 0, 0.004);   // ears
    }
    // the face: painted anime eyes, brows, nose shadow and mouth on a patch that hugs the skull
    {
      const face = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 24, 16, Math.PI / 2 - 0.95, 1.9, 0.95, 1.15),
        new THREE.MeshBasicMaterial({ map: faceTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, fog: true }));
      face.position.set(0, 0.145, 0.008); face.scale.set(0.96 * 1.012, 1.08 * 1.012, 1.012);
      face.renderOrder = 1;
      this._face = face;    // attached after the bake (not merged into the body)
    }
    // cravat (the white Survey Corps jabot)
    const cr = mesh(new THREE.ConeGeometry(0.052, 0.13, 10), M.cravat, chest, 0, 0.375, 0.12, 0.008);
    cr.rotation.x = Math.PI * 0.07; cr.rotation.z = Math.PI;
    mesh(new THREE.TorusGeometry(0.066, 0.016, 8, 16), M.cravat, chest, 0, 0.452, 0.0, 0.005).rotation.x = Math.PI / 2;
    // hood (down): a bunched cowl behind the neck and over the shoulders
    const hood = mesh(new THREE.SphereGeometry(0.115, 14, 10), M.cape, chest, 0, 0.455, -0.1, 0.008);
    hood.scale.set(1.55, 0.72, 0.85);
    const hood2 = mesh(new THREE.TorusGeometry(0.14, 0.03, 8, 20, Math.PI * 1.3), M.cape, chest, 0, 0.44, -0.015, 0.006);
    hood2.rotation.x = Math.PI / 2; hood2.rotation.z = Math.PI * 0.85;

    // ── harness straps (tubes hugging the jacket), chest X, waist belts
    const surf = (phi, y) => {
      const t = clamp(y / 0.42, 0, 1), a = 0.168 * 1.18 * lerp(0.9, 1.0, t) + 0.006, b = 0.168 * 0.8 * lerp(0.92, 1.0, t) + 0.006;
      return new THREE.Vector3(Math.sin(phi) * a, y, Math.cos(phi) * b);
    };
    const strap = (pts, r, mat, parent) => {
      const curve = new THREE.CatmullRomCurve3(pts);
      const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 28, r, 6, false), mat);
      parent.add(m); return m;
    };
    for (const sx of [1, -1]) {
      strap([surf(-sx * 0.75, 0.04), surf(-sx * 0.35, 0.16), surf(0.12 * sx, 0.31), surf(sx * 0.62, 0.42), surf(sx * 1.35, 0.4), surf(sx * 2.4, 0.26), surf(sx * 2.9, 0.1)], 0.014, M.strap, chest);
    }
    strap(Array.from({ length: 14 }, (_, i) => surf((i / 13) * TAU - Math.PI, 0.04)), 0.016, M.strap, chest).position.y = 0;
    strap(Array.from({ length: 14 }, (_, i) => surf((i / 13) * TAU - Math.PI, 0.3)), 0.012, M.strap, chest);
    mesh(new THREE.BoxGeometry(0.05, 0.04, 0.016), M.brass, chest, 0, 0.04, 0.138, 0.004);        // belt buckle
    mesh(new THREE.BoxGeometry(0.03, 0.03, 0.014), M.brass, chest, 0, 0.215, 0.134, 0.004);       // chest buckle

    // ── arms
    const arm = (side) => {
      const sx = side === 0 ? 1 : -1;
      const sh = group(chest, sx * 0.215, 0.405, 0);
      const up = mesh(new THREE.CylinderGeometry(0.043, 0.037, 0.28, 10), M.jacket, sh, 0, -0.14, 0, 0.008);
      const el = group(sh, 0, -0.28, 0);
      mesh(new THREE.SphereGeometry(0.04, 10, 8), M.jacket, el, 0, 0, 0, 0.007);
      mesh(new THREE.CylinderGeometry(0.037, 0.031, 0.26, 10), M.jacket, el, 0, -0.13, 0, 0.007);
      mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.04, 10), M.strap, el, 0, -0.235, 0, 0.005);  // glove cuff
      const wr = group(el, 0, -0.26, 0);
      mesh(new THREE.SphereGeometry(0.042, 10, 8), M.skin, wr, 0, -0.02, 0.0, 0.006);
      // grip + guard + blade (blade points along the forearm: -Y)
      const grip = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.15, 8), M.grip, wr, 0, -0.03, 0, 0.004);
      const blade = new THREE.Group(); wr.add(blade);
      mesh(new THREE.BoxGeometry(0.07, 0.02, 0.03), M.steelDark, blade, 0, -0.11, 0, 0.004);
      const L = 0.86;
      const sh2 = new THREE.Shape();
      sh2.moveTo(-0.022, 0); sh2.lineTo(0.022, 0); sh2.lineTo(0.022, -L * 0.93); sh2.lineTo(-0.022, -L); sh2.lineTo(-0.022, 0);
      const bg = new THREE.ExtrudeGeometry(sh2, { depth: 0.006, bevelEnabled: false });
      bg.translate(0, -0.12, -0.003);
      const bm = new THREE.Mesh(bg, M.blade); Object.assign(bm.userData, { ol: 0.004, olColor: 0x2b3440, flash: true }); blade.add(bm);
      const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.008, L * 0.8, 0.0075), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      fuller.position.set(0, -0.12 - L * 0.46, 0); blade.add(fuller);
      const handle = [grip];
      return { sh, el, wr, blade, handle };
    };
    J.armL = arm(0); J.armR = arm(1);

    // ── legs
    const leg = (side) => {
      const sx = side === 0 ? 1 : -1;
      const hip = group(P, sx * 0.09, -0.02, 0);
      mesh(new THREE.CylinderGeometry(0.083, 0.063, 0.43, 12), M.trousers, hip, 0, -0.215, 0, 0.009);
      const kn = group(hip, 0, -0.43, 0);
      mesh(new THREE.SphereGeometry(0.064, 10, 8), M.trousers, kn, 0, 0, 0, 0.006);
      mesh(new THREE.CylinderGeometry(0.06, 0.048, 0.1, 10), M.trousers, kn, 0, -0.05, 0, 0.006);
      mesh(new THREE.CylinderGeometry(0.064, 0.05, 0.3, 12), M.boot, kn, 0, -0.2, 0, 0.009);          // boot shaft
      mesh(new THREE.CylinderGeometry(0.07, 0.066, 0.025, 12), M.boot, kn, 0, -0.055, 0, 0.006);      // boot cuff
      const an = group(kn, 0, -0.4, 0);
      mesh(new THREE.BoxGeometry(0.088, 0.065, 0.25), M.boot, an, 0, -0.02, 0.06, 0.008);
      mesh(new THREE.BoxGeometry(0.09, 0.02, 0.255), M.strap, an, 0, -0.05, 0.06, 0.005);               // sole
      // harness: thigh rings + front strap, shin strap
      for (const y of [-0.1, -0.29]) { const t = mesh(new THREE.TorusGeometry(0.083 - (y < -0.2 ? 0.014 : 0), 0.013, 6, 16), M.strap, hip, 0, y, 0, 0); t.rotation.x = Math.PI / 2; }
      mesh(new THREE.BoxGeometry(0.028, 0.032, 0.014), M.brass, hip, 0, -0.1, 0.082, 0.003);
      mesh(new THREE.BoxGeometry(0.018, 0.38, 0.01), M.strap, hip, 0, -0.2, 0.074, 0);
      const t2 = mesh(new THREE.TorusGeometry(0.062, 0.011, 6, 14), M.strap, kn, 0, -0.12, 0, 0); t2.rotation.x = Math.PI / 2;
      // blade scabbard box on the outer thigh
      const sc = mesh(new THREE.BoxGeometry(0.052, 0.26, 0.1), M.steel, hip, sx * 0.09, -0.16, -0.01, 0.007);
      mesh(new THREE.BoxGeometry(0.056, 0.03, 0.105), M.steelDark, sc, 0, 0.11, 0, 0.004);
      for (let i = 0; i < 3; i++) mesh(new THREE.BoxGeometry(0.012, 0.075, 0.012), M.steelDark, sc, sx * 0.0, 0.17, -0.032 + i * 0.032, 0.003);
      return { hip, kn, an };
    };
    J.legL = leg(0); J.legR = leg(1);

    // ── ODM gear: central unit + canisters on the lower back, launchers on the hips
    const odm = group(P, 0, 0.0, 0);
    this.odm = odm;
    mesh(new THREE.BoxGeometry(0.21, 0.17, 0.1), M.steelDark, odm, 0, 0.045, -0.15, 0.007);
    mesh(new THREE.BoxGeometry(0.15, 0.06, 0.04), M.steel, odm, 0, 0.06, -0.205, 0.005);
    mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 10), M.brass, odm, 0, 0.0, -0.215, 0.004).rotation.x = Math.PI / 2;
    for (const sx of [1, -1]) {
      const can = mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.3, 14), M.steel, odm, sx * 0.19, 0.0, -0.158, 0.007);
      can.rotation.z = Math.PI / 2 + sx * 0.12;
      mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.03, 14), M.brass, can, 0, 0.13, 0, 0.004);
      mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.025, 14), M.brass, can, 0, -0.1, 0, 0.004);
      // launcher housing at the hip + barrel
      const lh = group(odm, sx * 0.2, -0.04, 0.035);
      mesh(new THREE.BoxGeometry(0.075, 0.13, 0.15), M.steelDark, lh, 0, 0, 0, 0.007);
      const barrel = mesh(new THREE.CylinderGeometry(0.02, 0.026, 0.12, 10), M.steel, lh, 0, 0.0, 0.1, 0.005);
      barrel.rotation.x = Math.PI / 2;
      mesh(new THREE.BoxGeometry(0.03, 0.03, 0.05), M.brass, lh, 0, 0.07, -0.02, 0.003);
      const tip = new THREE.Object3D(); tip.position.set(0, 0, 0.165); lh.add(tip);
      (sx > 0 ? (this.launcherL = tip) : (this.launcherR = tip));
    }
    // gas nozzle & jet cone
    this.nozzle = new THREE.Object3D(); this.nozzle.position.set(0, -0.06, -0.205); P.add(this.nozzle);
    const jet = new THREE.Mesh(new THREE.ConeGeometry(0.05, 1, 10, 1, true), M.jet);
    jet.userData.keep = true;                    // its own mesh (additive, scaled per frame), not baked
    jet.geometry.translate(0, -0.5, 0);           // apex at the nozzle, opens along -Y
    jet.rotation.x = 0.34;                       // along (0,-1,-0.35)
    jet.frustumCulled = false; jet.visible = false; jet.raycast = () => {};
    this.nozzle.add(jet); this.jet = jet;

    // collider reference points (cape sim)
    const mk = (parent, x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); parent.add(o); return o; };
    this.col = [
      { o: mk(chest, 0, 0.24, -0.015), r: 0.165 }, { o: mk(chest, 0, 0.07, -0.03), r: 0.155 },
      { o: mk(odm, 0, 0.045, -0.15), r: 0.125 },
      { o: mk(odm, 0.2, 0.0, -0.16), r: 0.07 }, { o: mk(odm, -0.2, 0.0, -0.16), r: 0.07 },
      { o: mk(J.legL.hip, 0, -0.17, -0.005), r: 0.1 }, { o: mk(J.legR.hip, 0, -0.17, -0.005), r: 0.1 },
      { o: mk(J.legL.kn, 0, 0.0, -0.005), r: 0.085 }, { o: mk(J.legR.kn, 0, 0.0, -0.005), r: 0.085 },
      { o: mk(pelvis, 0, -0.02, -0.04), r: 0.14 },
    ];
    // cape pin points (left shoulder → right shoulder across the nape)
    this.pins = [];
    for (let c = 0; c < CC; c++) {
      const x = (0.5 - c / (CC - 1)) * 0.46;
      this.pins.push(mk(chest, x, 0.43 + 0.02 * (1 - Math.pow(x / 0.23, 2)) - 0.012 * Math.abs(x / 0.23), -0.02 - 0.085 * (1 - Math.pow(x / 0.23, 2))));
    }
    this.j.blades = [J.armL.blade, J.armR.blade];
    this._bake(J);
    this.root.traverse((o) => { if (o.isMesh && !o.userData.noShadow) o.receiveShadow = false; });
  }

  /** Merge every modelling part into the skinned body / blade meshes (see the header). Joint groups stay as they are. */
  _bake(J) {
    const bones = [this.pivot, J.spine, J.head];
    for (const a of [J.armL, J.armR]) bones.push(a.sh, a.el, a.wr);
    for (const l of [J.legL, J.legR]) bones.push(l.hip, l.kn, l.an);
    const boneIx = new Map(bones.map((b, i) => [b, i]));
    const blades = this.j.blades;
    const body = [], bladeParts = [[], []], meshes = [];
    this.root.updateMatrixWorld(true);
    this.root.traverse((o) => { if (o.isMesh && !o.userData.keep) meshes.push(o); });
    const inv = new THREE.Matrix4();
    for (const m of meshes) {
      let owner = m.parent;
      while (!boneIx.has(owner) && !blades.includes(owner)) owner = owner.parent;
      const rel = new THREE.Matrix4().multiplyMatrices(inv.copy(owner.matrixWorld).invert(), m.matrixWorld);
      const bi = blades.indexOf(owner);
      (bi >= 0 ? bladeParts[bi] : body).push({ m, rel, owner, bone: boneIx.get(owner) ?? 0 });
    }
    // non-mesh helpers hanging off a part (the pelvis cape-collider point) move to the joint, same world transform
    for (const { m, owner } of [...body, ...bladeParts[0], ...bladeParts[1]]) {
      for (const c of [...m.children]) if (!c.isMesh) owner.attach(c);
    }
    for (const m of meshes) { m.removeFromParent(); m.geometry.dispose(); }

    // body: one rigidly skinned mesh + its hull, both driven by the joint groups (identity bind: verts are joint-local)
    const { geo, hull } = bakeParts(body, true);
    this.skeleton = new THREE.Skeleton(bones, bones.map(() => new THREE.Matrix4()));
    const reach = new THREE.Sphere(new THREE.Vector3(), 2.0);    // body-centred bound for frustum culling (any pose)
    const mk = (g, mat) => {
      const sm = new THREE.SkinnedMesh(g, mat);
      sm.bind(this.skeleton, new THREE.Matrix4());
      sm.boundingSphere = reach.clone();
      this.root.add(sm);
      return sm;
    };
    this.body = mk(geo, bodyMaterial()); this.body.castShadow = true;
    this.bodyHull = mk(hull, hullMaterial()); this.bodyHull.raycast = () => {};
    // blades: one mesh + one hull each, inside the blade group (shown / hidden with it); shine = this.bladeMat's uFlash
    this.bladeMat = vcMaterial(0x4d5f72);
    for (let i = 0; i < 2; i++) {
      const b = bakeParts(bladeParts[i], false);
      const bm = new THREE.Mesh(b.geo, this.bladeMat); bm.castShadow = true;
      const bh = new THREE.Mesh(b.hull, hullMaterial()); bh.raycast = () => {};
      blades[i].add(bm, bh);
    }
  }

  _buildCapeMesh() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CN * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(CN * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const uv = new Float32Array(CN * 2);
    for (let r = 0; r < CR; r++) for (let c = 0; c < CC; c++) { uv[(r * CC + c) * 2] = c / (CC - 1); uv[(r * CC + c) * 2 + 1] = 1 - r / (CR - 1); }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const idx = [];
    for (let r = 0; r < CR - 1; r++) for (let c = 0; c < CC - 1; c++) {
      const a = r * CC + c, b = a + 1, cc = a + CC, d = cc + 1;
      idx.push(a, cc, b, b, cc, d);
    }
    g.setIndex(idx);
    this.capeGeo = g;
    const outer = toonMaterial(0xffffff, { map: makeCapeTexture(), side: THREE.FrontSide });
    const inner = toonMaterial(0x23442b, { side: THREE.BackSide });
    // one shadow draw for both faces (before: outer drew its back faces, inner its front faces = the same union)
    outer.shadowSide = THREE.DoubleSide;
    this.capeMat = outer;
    this.capeOuter = new THREE.Mesh(g, outer); this.capeInner = new THREE.Mesh(g, inner);
    for (const m of [this.capeOuter, this.capeInner]) { m.frustumCulled = false; this.root.add(m); }
    this.capeOuter.castShadow = true;
    // thin dark rim along the cape edges (cel outline)
    const lg = new THREE.BufferGeometry();
    const li = [];
    for (let c = 0; c < CC - 1; c++) { li.push(c, c + 1, (CR - 1) * CC + c, (CR - 1) * CC + c + 1); }
    for (let r = 0; r < CR - 1; r++) { li.push(r * CC, (r + 1) * CC, r * CC + CC - 1, (r + 1) * CC + CC - 1); }
    lg.setAttribute('position', g.getAttribute('position')); lg.setIndex(li);
    this.capeRim = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x14241a }));
    this.capeRim.frustumCulled = false; this.root.add(this.capeRim);
  }

  setVisible(v) { this.root.visible = v; }
  dispose() {
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    if (this.skeleton) this.skeleton.dispose();
    if (this.bladeMat) this.bladeMat.dispose();
  }

  // ───────────────────────────── contract helpers ─────────────────────────────
  /** Measure each foot against the surface under it and nudge the pelvis drop / leg lifts (a tiny IK controller). */
  _footIK(w, dt) {
    if (!this.footLift) { this.footLift = [0, 0]; this.footDrop = 0; }
    const col = this.game?.collision;
    if (!col || w < 0.01) {
      this.footDrop *= 0.8; this.footLift[0] *= 0.8; this.footLift[1] *= 0.8;
      return;
    }
    this.root.updateMatrixWorld(true);
    const d = [0, 0];
    const legs = [this.j.legL, this.j.legR];
    for (let i = 0; i < 2; i++) {
      legs[i].an.getWorldPosition(_fa);
      _fa.y += 0.8;
      const hit = col.raycast(_fa, _fdown, 1.9, { dynamic: false });
      const gy = hit ? hit.point.y : _fa.y - 0.8 - SOLE - 0.4;      // nothing under the foot: treat as floating
      d[i] = gy - (_fa.y - 0.8 - SOLE);                              // > 0: the sole is below the surface
    }
    const k = Math.min(1, dt * 12);
    // drop the pelvis until the lower-hanging foot touches; lift (bend) any foot that would sink in
    // the pelvis moves so the lower foot just touches (raising it if both would sink, dropping it if both float);
    // only the difference between the feet bends a leg
    const dm = Math.min(d[0], d[1]);
    this.footDrop = clamp(this.footDrop - dm * k, -0.25, 0.45);
    for (let i = 0; i < 2; i++) this.footLift[i] = clamp(this.footLift[i] + (d[i] - dm - this.footLift[i] * 0.35) * k * 1.2, 0, 0.45);
  }

  hookOrigin(side, out) {
    const tip = side === 0 ? this.launcherL : this.launcherR;
    tip.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(tip.matrixWorld);
  }

  gasNozzle(outPos, outDir) {
    this.nozzle.updateWorldMatrix(true, false);
    outPos.setFromMatrixPosition(this.nozzle.matrixWorld);
    outDir.set(0, -1, -0.35).normalize().transformDirection(this.nozzle.matrixWorld);
  }

  // ───────────────────────────── per-frame ─────────────────────────────
  update(dt, s) {
    dt = clamp(finite(dt), 0, 0.05);
    if (dt <= 0) dt = 1e-4;
    this.time += dt;
    const k = (rate) => 1 - Math.exp(-rate * dt);
    const t = this.time;
    const first = this.first;

    // ── sanitise input
    const p = s.position, v = s.velocity;
    _v1.set(finite(p.x), finite(p.y), finite(p.z));
    const vx = finite(v && v.x), vy = finite(v && v.y), vz = finite(v && v.z);
    let speed = hypot(vx, vy, vz);
    if (Number.isFinite(s.speed)) speed = s.speed;
    this.root.position.copy(_v1);
    this.pos.copy(_v1);
    const grounded = !!s.grounded;
    const running = clamp(finite(s.running), 0, 1);

    // ── weights (exponential smoothing; never snap)
    this.wAir += ((grounded ? 0 : 1) - this.wAir) * (first ? 1 : k(11));
    this.wSpin += ((s.spin ? 1 : 0) - this.wSpin) * (first ? 1 : k(14));
    this.wGrab += ((s.grabbed ? 1 : 0) - this.wGrab) * (first ? 1 : k(9));
    this.wBoost += (clamp(finite(s.boosting), 0, 1) - this.wBoost) * (first ? 1 : k(14));
    this.wRun += (running - this.wRun) * (first ? 1 : k(10));
    this.wRide += (clamp(finite(s.riding), 0, 1) - this.wRide) * (first ? 1 : k(7));
    this.wCrouch += (clamp(finite(s.crouch), 0, 1) - this.wCrouch) * (first ? 1 : k(this.wCrouch < finite(s.crouch) ? 30 : 8));
    const slashing = s.slash !== undefined && s.slash >= 0 && s.slash <= 1.0001;
    if (slashing) this.slashP = s.slash;
    this.wSlash += ((slashing ? 1 : 0) - this.wSlash) * (first ? 1 : k(slashing ? 32 : 11));
    // hooks
    let nHook = 0; _v2.set(0, 0, 0);
    const hooks = s.hooks;
    if (hooks) for (let i = 0; i < 2; i++) {
      const h = hooks[i];
      if (h && h.attached && h.anchor) { nHook++; _v2.add(h.anchor); }
    }
    this.wHook += ((nHook > 0 ? 1 : 0) - this.wHook) * (first ? 1 : k(7));
    const hasBlades = s.blades !== false;
    this.speedS += (speed - this.speedS) * (first ? 1 : k(6));
    const L = sstep(5, 24, this.speedS);                       // flight-lean amount from speed
    const airFlight = this.wAir * L;

    // ── up and forward vectors
    _v3.set(finite(s.up && s.up.x), finite(s.up && s.up.y) || 1, finite(s.up && s.up.z)).normalize();
    if (first) this.up.copy(_v3); else this.up.lerp(_v3, k(12)).normalize();
    const up = this.up;
    _v3.set(finite(s.forward && s.forward.x), finite(s.forward && s.forward.y), finite(s.forward && s.forward.z));
    if (_v3.lengthSq() < 1e-6) _v3.copy(this.fwd);
    _v3.normalize();
    if (first) this.fwd.copy(_v3); else this.fwd.lerp(_v3, k(this.wAir > 0.5 ? 9 : 14)).normalize();
    const fwd = this.fwd;
    const sinE = clamp(fwd.dot(up), -1, 1);
    let eF = Math.asin(sinE);
    // lean towards the anchors when hooked
    let eA = 0, leftness = 0;
    _v4.copy(up).cross(this.heading);                         // soldier's LEFT
    if (nHook > 0) {
      _v2.multiplyScalar(1 / nHook).sub(this.pos);
      const dl = _v2.length();
      if (dl > 0.5) {
        _v2.multiplyScalar(1 / dl);
        eA = Math.asin(clamp(_v2.dot(up), -1, 1));
        leftness = clamp(_v2.dot(_v4), -1, 1);
      }
    }
    const hk = this.wHook * 0.5;
    const eEff = eF * (1 - hk) + eA * hk;

    // ── heading (horizontal facing) with yaw smoothing
    _v2.copy(fwd).addScaledVector(up, -sinE);
    const hl = _v2.length();
    if (hl > 0.12) {
      _v2.multiplyScalar(1 / hl);
      if (first) this.heading.copy(_v2); else this.heading.lerp(_v2, k(this.wAir > 0.5 ? 10 : 16)).normalize();
    }
    this.heading.addScaledVector(up, -this.heading.dot(up)).normalize();
    // yaw rate (for banking into turns)
    _v2.copy(this.heading).cross(this._prevHeading);
    const yr = clamp(-_v2.dot(up) / dt, -8, 8);
    this.yawRate += (finite(yr) - this.yawRate) * k(8);
    this._prevHeading.copy(this.heading);

    // ── body pitch (theta) and bank
    const thetaG = 0.05 + 0.3 * this.wRun * clamp(this.speedS / 10, 0.3, 1);
    const thetaFlight = Math.PI / 2 - clamp(eEff * 0.92, -0.85, 1.25);
    const thetaFall = 0.18 + 0.1 * Math.sin(t * 2.1);
    const thetaAir = lerp(thetaFall, thetaFlight, L);
    let theta = lerp(thetaG, thetaAir, this.wAir);
    theta = lerp(theta, Math.PI / 2 + 0.0, this.wSpin * this.wAir);   // spin: axis = body axis, body horizontal-ish
    theta = lerp(theta, 0.05, this.wGrab);
    // about to touch down: the body comes upright (feet first), whatever the dive angle
    this.wLand = (this.wLand || 0) + (clamp(finite(s.landPrep), 0, 1) - (this.wLand || 0)) * (first ? 1 : k(16));
    theta = lerp(theta, 0.12, this.wLand * this.wAir);
    if (first) this.theta = theta; else this.theta += (theta - this.theta) * k(8.5);
    let roll = -0.55 * leftness * this.wHook + clamp(-this.yawRate * 0.09, -0.5, 0.5) * airFlight + 0.05 * Math.sin(t * 1.7) * this.wAir;
    roll *= 1 - this.wSpin;
    if (first) this.roll = roll; else this.roll += (roll - this.roll) * k(7);
    const flightish = clamp(this.theta / 1.15, 0, 1);

    // ── spin angle: continue to a full turn when released, then rest at 0
    if (s.spin) this.spinAngle += TAU * 3 * dt;
    else if (this.spinAngle > 1e-3) {
      const target = Math.ceil(this.spinAngle / TAU - 1e-4) * TAU;
      this.spinAngle += Math.max((target - this.spinAngle) * k(9), 0) + TAU * 0.8 * dt * (target - this.spinAngle > 0.05 ? 1 : 0);
      if (this.spinAngle >= target - 0.02) this.spinAngle = 0;
    }

    // ── orientation: heading frame * lean(Z) * pitch(X) * roll(Y), spin about the velocity axis in world space
    _v2.copy(up).cross(this.heading);                         // frame X (left)
    _m1.makeBasis(_v2, up, this.heading);
    this.q.setFromRotationMatrix(_m1);
    _q1.setFromAxisAngle(AZ, this.roll * (1 - flightish));
    _q2.setFromAxisAngle(AX, this.theta);
    _q3.setFromAxisAngle(AY, this.roll * flightish);
    this.q.multiply(_q1).multiply(_q2).multiply(_q3);
    if (this.spinAngle > 1e-4) {
      _q1.setFromAxisAngle(fwd, this.spinAngle);
      this.q.premultiply(_q1);
    }
    this.pivot.quaternion.copy(this.q);

    // ── poses ──────────────────────────────────────────────────────────
    const TG = this.TG, TA = this.TA, TS = this.TS, TP = this.TP, TR = this.TR, TC = this.TC, J = this.J;
    TG.fill(0); TA.fill(0);
    // ground: idle / walk / run cycle
    const gs = Math.max(this.speedS, 0);
    const stride = 1.1 + 1.3 * this.wRun;
    this.phase += (grounded ? TAU * gs / stride : 0) * dt + TAU * 0.35 * this.wRun * dt * (gs < 1 ? 1 : 0);
    const ph = this.phase, ra = this.wRun;
    const br = Math.sin(t * 2.2) * (1 - ra);
    TG[SPX] = 0.02 + 0.02 * br + 0.05 * ra; TG[SPY] = 0.16 * ra * Math.sin(ph); TG[SPZ] = 0.02 * Math.sin(ph) * ra;
    TG[HDX] = -0.04 - 0.3 * ra * (thetaG - 0.05) * 0 + 0.02 * br;
    const swing = 0.95 * ra, kneeB = 0.28 * ra + 0.08;
    for (let sd = 0; sd < 2; sd++) {
      const ph2 = ph + sd * Math.PI, s2 = Math.sin(ph2), c2 = Math.cos(ph2);
      const o = sd * 4;
      TG[LHX + o] = -swing * s2 + 0.02; TG[LHZ + o] = 0.045 + 0.02 * ra;
      TG[LKX + o] = kneeB + ra * 1.1 * Math.max(0, c2) * (0.4 + 0.6 * Math.max(0, -s2 + 0.9)) + 0.12 * ra;
      TG[LAX + o] = -0.25 * ra * Math.max(0, c2) + 0.1 * ra * Math.max(0, -c2) + 0.04;
      const oa = sd * 5;
      TG[LSX + oa] = 0.9 * ra * (sd === 0 ? 1 : -1) * Math.sin(ph) - 0.05 + 0.03 * br * (sd ? -1 : 1);
      TG[LSZ + oa] = 0.1 + 0.1 * ra; TG[LSY + oa] = 0;
      TG[LEX + oa] = 0.32 + 0.95 * ra + 0.1 * ra * Math.sin(ph2);
      TG[LWX + oa] = 0.5 + 0.45 * ra;
    }
    TG[BOB] = -0.035 * ra * (0.5 - 0.5 * Math.cos(2 * ph)) - 0.02 * ra;
    // air: flight / swing / fall
    const hookBend = 0.14 + 0.38 * this.wHook;
    const wob = Math.sin(t * 3.1), wob2 = Math.sin(t * 2.3 + 1);
    // fall pose (slow): arms out, legs apart
    const fa = 1 - L;
    TA[SPX] = lerp(0.0, -0.12 - 0.05 * this.wBoost, L); TA[SPY] = 0.05 * wob * L; TA[SPZ] = 0;
    TA[HDX] = 0;
    for (let sd = 0; sd < 2; sd++) {
      const sgn = sd === 0 ? 1 : -1, oa = sd * 5, o = sd * 4;
      const asym = (sd === 0 ? wob : wob2);
      TA[LSX + oa] = lerp(-0.45, 0.16 + 0.1 * this.wBoost, L) + 0.05 * asym * L;
      TA[LSZ + oa] = lerp(0.95, 0.13 + 0.06 * asym, L);
      TA[LEX + oa] = lerp(0.35, 0.26, L);
      TA[LWX + oa] = TA[LEX + oa] + lerp(0.1, 0.16, L);
      const tuck = sd === 0 ? 1 : 0.2;   // anime flight: one knee drawn up, the other leg trailing
      TA[LHX + o] = lerp(-0.18 * sgn, 0.07 - 0.42 * tuck * (0.6 + 0.4 * this.wHook) + 0.05 * asym, L) * 1; TA[LHZ + o] = lerp(0.22, 0.045, L);
      TA[LKX + o] = lerp(0.4, hookBend + 0.75 * tuck + 0.04 * asym, L);
      TA[LAX + o] = lerp(0.1, 0.8, L);
    }
    // grabbed: struggling
    TR.fill(0);
    {
      const f = 13;
      TR[SPX] = 0.12 * Math.sin(t * f); TR[SPY] = 0.35 * Math.sin(t * 9.3); TR[SPZ] = 0.22 * Math.sin(t * 7.1); TR[HDX] = 0.2 * Math.sin(t * 11); TR[HDY] = 0.5 * Math.sin(t * 8);
      for (let sd = 0; sd < 2; sd++) {
        const ph3 = t * f + sd * 2.1, oa = sd * 5, o = sd * 4;
        TR[LSX + oa] = -2.5 + 0.5 * Math.sin(ph3); TR[LSZ + oa] = 0.45 + 0.35 * Math.sin(ph3 * 0.8 + 1);
        TR[LEX + oa] = 0.6 + 0.5 * Math.sin(ph3 * 1.1); TR[LWX + oa] = 0.4;
        TR[LHX + o] = -0.5 * Math.sin(ph3 + 1); TR[LHZ + o] = 0.15 + 0.12 * Math.sin(ph3);
        TR[LKX + o] = 0.7 + 0.6 * Math.sin(ph3 + 1.7); TR[LAX + o] = 0.3;
      }
      TR[BOB] = 0.03 * Math.sin(t * 17);
    }
    // base mixes (about to touch down: the air pose gives way to a braced, feet-first stance)
    const wAirPose = this.wAir * (1 - 0.85 * this.wLand);
    for (let i = 0; i < NCH; i++) TC[i] = lerp(TG[i], TA[i], wAirPose);
    if (this.wLand > 0.01) {
      const L2 = this.wLand * this.wAir;
      TC[SPX] += 0.18 * L2; TC[BOB] += 0;
      for (let sd = 0; sd < 2; sd++) {
        const o = sd * 4, oa = sd * 5;
        TC[LHX + o] -= 0.45 * L2; TC[LKX + o] += 0.75 * L2; TC[LAX + o] -= 0.25 * L2;
        TC[LSZ + oa] += 0.55 * L2; TC[LSX + oa] -= 0.2 * L2;
      }
    }
    // crouch: the knees take a landing (or load a jump); hips back, chest forward, pelvis drops, feet stay planted
    const cr = this.wCrouch * (1 - this.wAir);
    if (cr > 0.001) {
      TC[SPX] += 0.5 * cr; TC[HDX] -= 0.35 * cr; TC[BOB] -= 0.36 * cr;
      for (let sd = 0; sd < 2; sd++) {
        const o = sd * 4, oa = sd * 5;
        TC[LHX + o] -= 1.0 * cr; TC[LKX + o] += 1.75 * cr; TC[LAX + o] -= 0.75 * cr; TC[LHZ + o] += 0.08 * cr;
        TC[LSX + oa] -= 0.45 * cr; TC[LSZ + oa] += 0.25 * cr; TC[LEX + oa] += 0.3 * cr;
      }
    }
    // riding: seated in the saddle, thighs round the barrel, hands on the reins, swaying with the gallop
    const rd = this.wRide;
    if (rd > 0.001) {
      const hg = clamp(finite(s.horseGallop), 0, 1), hp = finite(s.horsePhase) * TAU;
      const sway = Math.sin(hp + 0.6) * (0.06 + 0.1 * hg);
      for (let i = 0; i < NCH; i++) {
        let v;
        switch (i) {
          case SPX: v = 0.12 + 0.18 * hg + sway; break;
          case SPY: case SPZ: v = 0; break;
          case HDX: v = -0.1 - 0.12 * hg - sway * 0.6; break;
          case LSX: case RSX: v = -0.6 - 0.15 * hg; break;
          case LSZ: case RSZ: v = 0.12; break;
          case LEX: case REX: v = 1.15 + 0.15 * Math.sin(hp); break;
          case LWX: case RWX: v = 0.35; break;
          case LHX: case RHX: v = -1.42; break;
          case LHZ: case RHZ: v = 0.58; break;
          case LKX: case RKX: v = 1.6 + 0.1 * hg * Math.sin(hp); break;
          case LAX: case RAX: v = -0.3; break;
          case BOB: v = 0; break;
          default: v = TC[i];
        }
        TC[i] = lerp(TC[i], v, rd);
      }
    }
    // spin pose: arms out wide, blades forward, legs together
    TP.set(TC);
    TP[SPX] = -0.05; TP[SPY] = 0; TP[SPZ] = 0;
    for (let sd = 0; sd < 2; sd++) {
      const oa = sd * 5, o = sd * 4;
      TP[LSX + oa] = -(Math.PI / 2 + this.theta) * 0.92 + 0.0;   // world pitch ≈ forward
      TP[LSZ + oa] = 1.05; TP[LEX + oa] = 0.05; TP[LWX + oa] = 0.0;
      TP[LHX + o] = 0.04; TP[LHZ + o] = 0.04; TP[LKX + o] = 0.25; TP[LAX + o] = 0.7;
    }
    for (let i = 0; i < NCH; i++) TC[i] = lerp(TC[i], TP[i], this.wSpin);
    // slash overlay (arms + torso): windup → fast cross-body sweep → follow-through
    TS.set(TC);
    {
      const pp = clamp(this.slashP, 0, 1);
      const th = this.theta + TC[SPX];
      for (let sd = 0; sd < 2; sd++) {
        const oa = sd * 5;
        const q = clamp(pp - 0.05 * sd, 0, 1);                      // the left blade lags a hair
        TS[LSX + oa] = kf(q, 0.15, 1.05, -1.9, -1.2) - th;           // arm pitch in the world frame → body frame
        TS[LSZ + oa] = kf(q, 0.25, 0.85, -0.2 - 0.3 * sd, 0.2);     // outward on windup, across the body on the cut
        TS[LEX + oa] = kf(q, 0.5, 1.3, 0.1, 0.4);
        TS[LWX + oa] = 0.0;
        TS[LSY + oa] = 0;
      }
      const tw = kf(pp, 0, 0.55, -0.5, -0.15);
      TS[SPY] = tw; TS[SPX] = TC[SPX] + 0.25 * sstep(0.2, 0.5, pp) * (1 - sstep(0.7, 1, pp));
      TS[SPZ] = -0.2 * tw;
      TS[HDY] = -tw * 0.5;
    }
    for (let i = 0; i < NCH; i++) TC[i] = lerp(TC[i], TS[i], this.wSlash);
    for (let i = 0; i < NCH; i++) TC[i] = lerp(TC[i], TR[i], this.wGrab);
    // head compensation: keep the gaze along `forward` (neck takes up the body pitch)
    const thTot = this.theta + J[SPX];
    const gazeE = lerp(eF, 0, this.wGrab);
    TC[HDX] += clamp(-gazeE * 0.95 - thTot + 0.12, -1.15, 0.6) * (this.wAir > 0.01 || thTot > 0.3 ? 1 : 0.0);
    if (this.wSpin > 0.01) TC[HDX] = lerp(TC[HDX], clamp(-thTot + 0.05, -1.1, 0.4), this.wSpin);

    // foot planting (from last frame's measurement): bend the leg whose foot would sink into the slope
    const ikW = (1 - this.wAir) * (1 - this.wRide) * (1 - 0.8 * this.wRun) * (s.footIK === false ? 0 : 1);
    if (this.footLift && ikW > 0.01) {
      for (let sd = 0; sd < 2; sd++) {
        const o = sd * 4, l = this.footLift[sd] * ikW;
        TC[LHX + o] -= 1.25 * l; TC[LKX + o] += 2.5 * l; TC[LAX + o] -= 1.25 * l;
      }
    }
    // ── damped joint values
    const fast = 11 + 26 * this.wSlash;
    for (let i = 0; i < NCH; i++) {
      const isArm = i >= SPX && i <= RWX && i !== HDX && i !== HDY;
      const rate = first ? 1e3 : (isArm ? fast : 11 + 5 * this.wGrab);
      J[i] += (finite(TC[i]) - J[i]) * (1 - Math.exp(-rate * dt));
    }
    // ── apply
    const jt = this.j;
    jt.spine.rotation.set(J[SPX], J[SPY], J[SPZ]);
    jt.head.rotation.set(J[HDX], J[HDY], 0);
    if (this.locks) {
      const wind = clamp(this.speedS / 40, 0, 1);
      for (let i = 0; i < this.locks.length; i++) {
        const l = this.locks[i];
        l.rotation.x = -0.25 * wind + Math.sin(t * (9 + i * 1.7) + i) * (0.05 + 0.22 * wind);
        l.rotation.z = Math.sin(t * (7 + i) + i * 2) * 0.12 * wind;
      }
    }
    jt.armL.sh.rotation.set(J[LSX], J[LSY], J[LSZ]); jt.armR.sh.rotation.set(J[RSX], J[RSY], -J[RSZ]);
    jt.armL.el.rotation.set(-J[LEX], 0, 0); jt.armR.el.rotation.set(-J[REX], 0, 0);
    jt.armL.wr.rotation.set(J[LWX], 0, 0); jt.armR.wr.rotation.set(J[RWX], 0, 0);
    jt.legL.hip.rotation.set(J[LHX], 0, J[LHZ]); jt.legR.hip.rotation.set(J[RHX], 0, -J[RHZ]);
    jt.legL.kn.rotation.set(J[LKX], 0, 0); jt.legR.kn.rotation.set(J[RKX], 0, 0);
    jt.legL.an.rotation.set(J[LAX], 0, 0); jt.legR.an.rotation.set(J[RAX], 0, 0);
    this.pivot.position.y = J[BOB] * (1 - this.wAir) - (this.footDrop || 0) * ikW;
    this._footIK(ikW, dt);
    // blades only when drawn
    for (let i = 0; i < 2; i++) jt.blades[i].visible = hasBlades;
    // blade shine: flash through the sweep
    const flashT = slashing ? Math.sin(clamp(this.slashP, 0, 1) * Math.PI) : 0;
    this.bladeFlash += (Math.max(flashT, this.wSpin) - this.bladeFlash) * k(30);
    const bf = this.bladeFlash;
    this.bladeMat.userData.flash.setRGB(0.30 + 0.65 * bf, 0.37 + 0.6 * bf, 0.45 + 0.55 * bf);

    // ── gas jet
    const boost = this.wBoost;
    this.jet.visible = boost > 0.05;
    if (this.jet.visible) {
      const fl = 0.7 + 0.5 * Math.sin(t * 90) * Math.sin(t * 53);
      this.jet.scale.set(0.7 + boost * 0.5, (0.12 + 0.3 * boost) * fl, 0.7 + boost * 0.5);
      this.mats.jet.opacity = 0.5 * boost;
    }

    // ── matrices, then the cape sim in the root-relative frame
    this.root.updateMatrixWorld(true);
    this.skeleton.update();               // bone matrices now (also right for a shadow pass when the body is off-screen)
    const cp = this.cape, rp = this.root.position;
    for (let c = 0; c < CC; c++) {
      _v1.setFromMatrixPosition(this.pins[c].matrixWorld);
      cp.anchor[c * 3] = _v1.x - rp.x; cp.anchor[c * 3 + 1] = _v1.y - rp.y; cp.anchor[c * 3 + 2] = _v1.z - rp.z;
    }
    cp.nSph = this.col.length;
    for (let i = 0; i < this.col.length; i++) {
      const me = this.col[i].o.matrixWorld.elements;
      cp.spheres[i * 7] = me[12] - rp.x; cp.spheres[i * 7 + 1] = me[13] - rp.y; cp.spheres[i * 7 + 2] = me[14] - rp.z; cp.spheres[i * 7 + 3] = this.col[i].r;
      const bl = hypot(me[8], me[9], me[10]) || 1;
      cp.spheres[i * 7 + 4] = -me[8] / bl; cp.spheres[i * 7 + 5] = -me[9] / bl; cp.spheres[i * 7 + 6] = -me[10] / bl;
    }
    if (!cp.inited) {
      const me = this.col[0].o.matrixWorld.elements;
      cp.reset(-vx * 0.9, -vy * 0.9, -vz * 0.9, -me[8], -me[9], -me[10]);
    }
    // body acceleration (clamped, low-passed) as the pseudo-force
    _v1.set(vx, vy, vz);
    if (cp.hasPrev) {
      _v2.copy(_v1).sub(cp.prevVel).multiplyScalar(1 / dt);
      const am = _v2.length();
      if (am > 60) _v2.multiplyScalar(60 / am);
      cp.accel.lerp(_v2, k(14));
    }
    cp.prevVel.copy(_v1); cp.hasPrev = true;
    const sf = clamp(speed / 60, 0, 1);
    // apparent wind in the frame = -velocity (damped at extreme speed to keep the cloth readable)
    const wm = speed > 1 ? Math.min(1, 30 / speed) : 1;
    { const me = this.col[0].o.matrixWorld.elements, bl = hypot(me[8], me[9], me[10]) || 1;
      cp.step(dt, -vx * wm, -vy * wm, -vz * wm, sf, -me[8] / bl, -me[9] / bl, -me[10] / bl); }
    // NaN guard
    let bad = false;
    for (let i = 0; i < CN * 3; i += 7) if (!Number.isFinite(cp.pos[i])) { bad = true; break; }
    if (bad) { const me = this.col[0].o.matrixWorld.elements; cp.reset(-vx * 0.9, -vy * 0.9, -vz * 0.9, -me[8], -me[9], -me[10]); }
    const pa = this.capeGeo.attributes.position;
    // render copy = simulated cloth + a cheap travelling ripple (always away from the back, so it never cuts into the body)
    {
      const pa2 = pa.array, ps = cp.pos, rip = (0.012 + 0.07 * sf) * (this.wAir > 0.5 ? 1 : 0.6 + 0.4 * this.wRun);
      const me = this.col[0].o.matrixWorld.elements, bl = hypot(me[8], me[9], me[10]) || 1;
      const bx = -me[8] / bl, by = -me[9] / bl, bz = -me[10] / bl;
      for (let r = 0; r < CR; r++) {
        const rw = Math.pow(r / (CR - 1), 1.3) * rip;
        for (let c = 0; c < CC; c++) {
          const i = (r * CC + c) * 3;
          const d = rw * (0.5 + 0.5 * Math.sin(t * 15 - r * 1.15 + c * 0.8)) * (0.6 + 0.4 * Math.abs(c - 4) / 4);
          pa2[i] = ps[i] + bx * d; pa2[i + 1] = ps[i + 1] + by * d; pa2[i + 2] = ps[i + 2] + bz * d;
        }
      }
    }
    pa.needsUpdate = true;
    const na = this.capeGeo.attributes.normal;
    cp.normals(pa.array, na.array);
    na.needsUpdate = true;

    // ── auto gas (optional)
    if (this.autoGas && boost > 0.05 && this.game && this.game.fx) {
      this.gasNozzle(this._gasPos, this._gasDir);
      this.game.fx.gas(this._gasPos, this._gasDir, boost);
    }
    this.first = false;
  }
}
