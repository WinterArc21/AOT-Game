// Procedural titan body geometry. Every joint's mesh is ONE merged, vertex-coloured BufferGeometry
// (skin, teeth, eyes, hair... all baked), cached per archetype and shared by every titan of that archetype.
// Local units: the model is built ~10 units tall (feet at y = 0, face towards +z, character-left = +x).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMaterial } from '../core/style.js';

const V3 = THREE.Vector3, V2 = THREE.Vector2, M4 = THREE.Matrix4, QT = THREE.Quaternion, EU = THREE.Euler;
const _m = new M4(), _q = new QT(), _e = new EU(), _p = new V3(), _s = new V3(), _c = new THREE.Color();
const UPV = new V3(0, 1, 0);

export const SKINS = {
  pink: 0xe9b9a8, beige: 0xdfbd99, tan: 0xcba27a, pale: 0xeadccb, ruddy: 0xdba48e, grey: 0xc9b9a6,
};
export const HAIRS = [0x1a120d, 0x2a1c12, 0x3b2a18, 0x0e0e12, 0x4a3a22];
const TEETH = 0xece4c9, GUM = 0xa23d3e, MOUTH = 0x24090b, TONGUE = 0xb24c55, SCLERA = 0xf1ead8, IRIS = 0x1d1815;

/** Body proportions per build (multipliers on the base dims). */
export const BUILDS = {
  average:  { legs: 1.00, arms: 1.00, torsoW: 1.00, torsoH: 1.00, belly: 0.35, limb: 1.00, head: 1.00, shoulder: 1.00, neckW: 1.0, faceW: 1.0, faceH: 1.0 },
  lanky:    { legs: 1.14, arms: 1.30, torsoW: 0.78, torsoH: 1.06, belly: 0.0,  limb: 0.70, head: 0.98, shoulder: 0.92, neckW: 0.8, faceW: 0.92, faceH: 1.08 },
  potbelly: { legs: 0.84, arms: 0.95, torsoW: 1.18, torsoH: 0.95, belly: 1.0,  limb: 1.12, head: 1.05, shoulder: 0.95, neckW: 1.2, faceW: 1.08, faceH: 0.95 },
  muscular: { legs: 0.96, arms: 1.06, torsoW: 1.30, torsoH: 1.02, belly: 0.0,  limb: 1.32, head: 0.92, shoulder: 1.22, neckW: 1.35, faceW: 1.0, faceH: 1.0, muscle: 1 },
  gaunt:    { legs: 1.12, arms: 1.22, torsoW: 0.72, torsoH: 1.08, belly: 0.0,  limb: 0.62, head: 1.0, shoulder: 0.9, neckW: 0.75, faceW: 0.9, faceH: 1.12, ribs: 1 },
  colossal: { legs: 1.78, arms: 1.5, torsoW: 1.25, torsoH: 0.9, belly: 0.0,  limb: 1.2, head: 0.82, shoulder: 1.15, neckW: 1.15, faceW: 0.9, faceH: 1.22, muscle: 1, colossal: 1 },
};

/** Facial expression presets. */
const EXPR = {
  grin:  { open: 0.07, smile: 0.30, nT: 11, tooth: 0.2, eye: 0.20, iris: 0.40, lid: 0.30, mouthW: 0.84, brow: 0.55, hairy: 1 },
  wide:  { open: 0.12, smile: 0.46, nT: 13, tooth: 0.22, eye: 0.235, iris: 0.34, lid: 0.10, mouthW: 0.94, brow: 0.0 },
  snarl: { open: 0.28, smile: 0.12, nT: 10, tooth: 0.26, eye: 0.245, iris: 0.30, lid: 0.0, mouthW: 0.82, brow: 0.8 },
  colossal: { open: 0.10, smile: 0.16, nT: 15, tooth: 0.24, eye: 0.11, iris: 0.5, lid: 0.0, mouthW: 0.95, brow: 0.9, noLips: 1 },
};

// -------------------------------------------------------------------------------------------------------------
function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/** Collects coloured primitives and merges them. `outline:false` parts are excluded from the outline hull. */
class Parts {
  constructor(plainUV = false) { this.list = []; this.ol = []; this.plainUV = plainUV; }
  add(geom, color, o = {}) {
    if (o.matrix) _m.copy(o.matrix);
    else {
      const r = o.rot || [0, 0, 0], p = o.pos || [0, 0, 0], s = o.scl || [1, 1, 1];
      _q.setFromEuler(_e.set(r[0], r[1], r[2], 'YXZ'));
      _m.compose(_p.set(p[0], p[1], p[2]), _q, _s.set(s[0], s[1], s[2]));
    }
    geom.applyMatrix4(_m);
    if (o.fix) o.fix(geom);
    const n = geom.attributes.position.count;
    const nor = geom.attributes.normal;
    const col = new Float32Array(n * 3);
    _c.set(color);
    const ao = o.ao === undefined ? 0.22 : o.ao;
    for (let i = 0; i < n; i++) {
      const k = 1 - ao * 0.6 * (0.5 - 0.5 * nor.getY(i));
      col[i * 3] = _c.r * k; col[i * 3 + 1] = _c.g * k; col[i * 3 + 2] = _c.b * k;
    }
    geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (this.plainUV && o.outline === false) { // detail parts sample a plain white strip of the texture (colossal)
      const uv = geom.attributes.uv; for (let i = 0; i < n; i++) uv.setXY(i, 0.5, 0.997);
    }
    this.list.push(geom);
    if (o.outline !== false) this.ol.push(geom);
    return this;
  }
  build() {
    const full = mergeGeometries(this.list, false);
    const outline = this.ol.length === this.list.length ? full : mergeGeometries(this.ol, false);
    for (const g of this.list) g.dispose();
    full.computeBoundingSphere(); full.computeBoundingBox();
    if (outline !== full) outline.computeBoundingSphere();
    return { full, outline };
  }
}

const sphere = (r = 1, ws = 14, hs = 10) => new THREE.SphereGeometry(r, ws, hs);
function ell(P, color, c, r, o = {}) { // ellipsoid at c with radii r
  return P.add(sphere(1, o.ws || 14, o.hs || 10), color, { ...o, pos: c, scl: r });
}
function segMatrix(a, b, out = new M4()) {
  const dir = _p.copy(b).sub(a); const len = dir.length();
  _q.setFromUnitVectors(UPV, dir.divideScalar(Math.max(len, 1e-6)));
  return out.compose(new V3().addVectors(a, b).multiplyScalar(0.5), _q, _s.set(1, 1, 1));
}
function capsule(P, color, a, b, r, o = {}) {
  const A = new V3(...a), B = new V3(...b);
  const len = Math.max(A.distanceTo(B) - 2 * r, 0.001);
  return P.add(new THREE.CapsuleGeometry(r, len, o.cs || 3, o.rs || 8), color, { ...o, matrix: segMatrix(A, B) });
}
/** Lathe limb hanging along -y from the origin: cap radius r0 at y=0, cap radius r1 at y=-len, optional bulge. */
function limbGeo(len, r0, r1, bulge = 0.1, bulgeAt = 0.3, seg = 12) {
  const pts = [], capN = 4, N = 8;
  for (let i = 0; i <= capN; i++) { const a = (i / capN) * Math.PI / 2; pts.push(new V2(Math.max(0.0001, Math.sin(a) * r0), Math.cos(a) * r0)); }
  for (let i = 1; i < N; i++) {
    const t = i / N;
    const r = r0 + (r1 - r0) * t + bulge * r0 * Math.exp(-((t - bulgeAt) ** 2) / 0.05);
    pts.push(new V2(r, -t * len));
  }
  for (let i = 0; i <= capN; i++) { const a = (i / capN) * Math.PI / 2; pts.push(new V2(Math.max(0.0001, Math.cos(a) * r1), -len - Math.sin(a) * r1)); }
  pts.reverse();
  return new THREE.LatheGeometry(pts, seg);
}

// -------------------------------------------------------------------------------------------------------------
export function sizeClass(h) { return h < 6 ? 'S' : h < 10 ? 'M' : h < 25 ? 'L' : 'XL'; }

function makeDims(build, size) {
  const B = BUILDS[build];
  const headR = { S: 1.32, M: 1.2, L: 1.08, XL: 1.0 }[size] * B.head;
  const d = { B, build, size, headR };
  d.thighLen = 2.15 * B.legs; d.shinLen = 1.75 * B.legs; d.ankleH = 0.34;
  d.hipY = d.thighLen + d.shinLen + d.ankleH;
  d.hipX = 0.62 * B.torsoW;
  d.spineY = 0.45;
  d.shoulderX = 1.38 * B.torsoW * B.shoulder; d.shoulderY = 2.4 * B.torsoH;
  d.neckY = 2.75 * B.torsoH; d.neckLen = B.colossal ? 0.35 : 0.55;
  d.upperLen = 2.15 * B.arms; d.foreLen = 2.05 * B.arms;
  d.limb = B.limb;
  d.handS = Math.sqrt(B.limb) * (B.colossal ? 1.1 : 1.0);
  d.cy = 0.9 * headR * B.faceH; d.cz = 0.12 * headR;
  d.rx = headR * B.faceW; d.ry = headR * 1.12 * B.faceH; d.rz = headR * 1.04;
  d.headTop = d.cy + d.ry;
  d.total = d.hipY + d.spineY + d.neckY + d.neckLen + d.headTop;
  // jaw hinge (head-local)
  d.jawPivot = new V3(0, d.cy - 0.3 * d.ry, d.cz - 0.42 * headR);
  d.mouthLocal = new V3(0, d.cy - 0.42 * d.ry, d.cz + 0.82 * headR);
  // nape (head-local), generous
  d.napeC = new V3(0, 0.06, -0.58 * headR * Math.max(0.7, B.neckW));
  d.napeHalf = new V3(0.36, 0.46, 0.27);
  return d;
}

// -------------------------------------------------------------------------------------------------------------
function buildPelvis(d, skin) {
  const P = new Parts(), B = d.B, tw = B.torsoW;
  ell(P, skin, [0, 0.05, 0], [0.86 * tw, 0.62, 0.64]);                 // hips
  ell(P, skin, [-0.4 * tw, -0.08, -0.38], [0.5, 0.52, 0.5]);           // glutes
  ell(P, skin, [0.4 * tw, -0.08, -0.38], [0.5, 0.52, 0.5]);
  ell(P, skin, [0, 0.42, 0], [0.76 * tw, 0.6, 0.56]);                  // waist
  const belly = B.belly;
  if (belly > 0.05) ell(P, skin, [0, 0.42, 0.18 + 0.28 * belly], [(0.7 + 0.45 * belly) * tw, 0.62 + 0.32 * belly, 0.55 + 0.7 * belly], { ao: 0.35, hs: 12 });
  return P.build();
}
function buildSpine(d, skin, muscleCol) {
  const P = new Parts(d.B.colossal), B = d.B, tw = B.torsoW, th = B.torsoH;
  ell(P, skin, [0, 0.35, 0], [0.8 * tw, 0.6, 0.6]);
  ell(P, skin, [0, 1.5 * th, 0], [1.2 * tw, 1.45 * th, 0.86], { ws: 18, hs: 12 });             // rib cage
  for (const s of [-1, 1]) ell(P, skin, [s * d.shoulderX, d.shoulderY, 0], [0.5 * d.limb * B.shoulder + 0.1, 0.55 * d.limb * B.shoulder + 0.05, 0.5 * d.limb * B.shoulder + 0.05]);
  ell(P, skin, [0, d.neckY - 0.45, -0.12], [0.95 * tw, 0.42, 0.58]);                                // traps
  if (B.muscle) {
    for (const s of [-1, 1]) {
      ell(P, muscleCol || skin, [s * 0.5 * tw, 2.0 * th, 0.42], [0.56 * tw, 0.48, 0.42], { ao: 0.3 });
      ell(P, muscleCol || skin, [s * 0.62 * tw, 1.1 * th, 0.55], [0.5 * tw, 0.34, 0.3], { ao: 0.4 });
      ell(P, muscleCol || skin, [s * 0.35 * tw, 0.55 * th, 0.5], [0.38 * tw, 0.3, 0.26], { ao: 0.4 });
    }
  }
  if (B.ribs) {                          // gaunt: visible ribs
    for (let i = 0; i < 5; i++) {
      const y = (0.9 + i * 0.34) * th;
      const k = Math.sqrt(Math.max(0.05, 1 - ((y - 1.5 * th) / (1.45 * th)) ** 2));
      P.add(new THREE.TorusGeometry(1, 0.07, 6, 18, Math.PI * 0.9), skin, { pos: [0, y, 0], rot: [Math.PI / 2, 0, 0], scl: [1.2 * tw * k + 0.03, 0.86 * k + 0.03, 1], ao: 0.6 });
    }
  }
  return P.build();
}

function buildHead(d, st, skinC, hairC, rnd, withHair) {
  const P = new Parts(d.B.colossal);
  const PJ = new Parts(d.B.colossal);
  const B = d.B, R = d.headR, cy = d.cy, cz = d.cz, rx = d.rx, ry = d.ry, rz = d.rz;
  const skin = skinC, faceH = B.faceH;
  const surf = (x, y) => { const a = (x / rx) ** 2 + ((y - cy) / ry) ** 2; return cz + rz * Math.sqrt(Math.max(0.04, 1 - a)); };
  const normalAt = (x, y, z, out = new V3()) => out.set(x / (rx * rx), (y - cy) / (ry * ry), (z - cz) / (rz * rz)).normalize();
  const orient = (pos, n) => new M4().lookAt(n, new V3(), UPV).setPosition(pos);
  const toothH = st.tooth * R;
  const smile = (x) => st.smile * R * 0.55 * (x / rx) ** 2;            // rim rise towards the mouth corners
  const yU = cy - 0.12 * ry;                                      // upper rim (centre)
  const yL = yU - 2 * toothH;                                            // lower rim (centre), jaw closed
  const jawP = d.jawPivot;
  const mw = st.mouthW * rx;
  const N = st.nT;

  // ---- neck, cranium shell (cut at the upper rim), back-of-head underside, ears
  P.add(new THREE.CylinderGeometry(0.55 * R * B.neckW, 0.68 * R * B.neckW, 1.5 * R, 14), skin, { pos: [0, -0.4 * R, 0.0], ao: 0.3 });
  const thU = Math.acos(THREE.MathUtils.clamp((yU - cy) / ry, -1, 1));
  P.add(new THREE.SphereGeometry(1, 30, 20, 0, Math.PI * 2, 0, thU), skin, {
    pos: [0, cy, cz], scl: [rx, ry, rz], ao: 0.25,
    fix: (g) => { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = Math.max(p.getY(i), yU + smile(p.getX(i))); p.setY(i, y); } },
  });
  const yLmax = yL + smile(rx);
  const thL = Math.acos(THREE.MathUtils.clamp((yLmax - cy) / ry, -1, 1));
  const phiHalf = 1.75;
  // back part of the lower head (static): phi range behind the jaw
  P.add(new THREE.SphereGeometry(1, 20, 10, Math.PI / 2 + phiHalf, Math.PI * 2 - 2 * phiHalf, thL, Math.PI - thL), skin, { pos: [0, cy, cz], scl: [rx, ry, rz], ao: 0.4 });
  for (const s of [-1, 1]) ell(P, skin, [s * (rx * 0.97), cy - 0.12 * R, cz - 0.1 * R], [0.07 * R, 0.27 * R, 0.16 * R], { ao: 0.2, rot: [0, 0, s * 0.12] });

  // ---- jaw shell (front part of the lower ellipsoid), built in head space then moved to hinge space
  PJ.add(new THREE.SphereGeometry(1, 22, 10, Math.PI / 2 - phiHalf, 2 * phiHalf, thL, Math.PI - thL), skin, {
    pos: [0, cy, cz], scl: [rx, ry, rz], ao: 0.25,
    fix: (g) => { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { p.setXYZ(i, p.getX(i) - jawP.x, Math.min(p.getY(i), yL + smile(p.getX(i))) - jawP.y, p.getZ(i) - jawP.z); } },
  });

  // ---- mouth interior (dark, recessed ellipsoid) + tongue
  P.add(sphere(1, 18, 12), MOUTH, { pos: [0, cy - 0.1 * R, cz], scl: [rx * 0.93, ry * 0.9, rz * 0.9], outline: false, ao: 0 });
  PJ.add(sphere(1, 12, 8), TONGUE, { pos: new V3(0, yL + 0.04 * R, cz + 0.32 * R).sub(jawP).toArray(), scl: [0.5 * R, 0.1 * R, 0.4 * R], outline: false, ao: 0.1 });
  PJ.add(sphere(1, 12, 8), MOUTH, { pos: new V3(0, yL - 0.02 * R, cz - 0.1 * R).sub(jawP).toArray(), scl: [rx * 0.8, 0.14 * R, rz * 0.6], outline: false, ao: 0 });

  // ---- eyes (sclera + iris + pupil), lids, brows
  const eR = st.eye * R, eyeX = 0.42 * rx, eyeY = cy + 0.26 * ry;
  for (const s of [-1, 1]) {
    const ez = surf(s * eyeX, eyeY);
    const n = normalAt(s * eyeX, eyeY, ez);
    const ec = new V3(s * eyeX, eyeY, ez).addScaledVector(n, -0.3 * eR);
    P.add(sphere(1, 12, 8), skin, { pos: ec.toArray(), scl: [eR * 1.3, eR * 1.22, eR * 1.1], ao: 0.6 });         // socket shadow
    P.add(sphere(1, 14, 10), SCLERA, { pos: ec.toArray(), scl: [eR, eR * 1.04, eR], outline: false, ao: 0.1 });
    const dir = new V3(-s * 0.05, -0.02, 1).normalize();
    const ip = ec.clone().addScaledVector(dir, eR * 0.88);
    P.add(sphere(1, 12, 8), B.colossal ? 0xe8e0c8 : IRIS, { matrix: orient(ip, dir).scale(new V3(eR * st.iris * 1.2, eR * st.iris * 1.2, eR * st.iris * 0.6)), outline: false, ao: 0 });
    const pp = ec.clone().addScaledVector(dir, eR * 1.0);
    P.add(sphere(1, 8, 6), 0x000000, { matrix: orient(pp, dir).scale(new V3(eR * st.iris * 0.55, eR * st.iris * 0.55, eR * 0.25)), outline: false, ao: 0 });
    if (st.lid > 0.02) {
      P.add(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, (38 + st.lid * 40) * Math.PI / 180), skin,
        { matrix: orient(ec, dir).scale(new V3(eR * 1.14, eR * 1.14, eR * 1.14)).multiply(new M4().makeRotationX(50 * Math.PI / 180)), ao: 0.3 });
    }
    if (st.brow > 0.05 && !B.colossal) {
      const yb = eyeY + eR * 1.45;
      const x0 = s * (eyeX - 0.30 * R), x1 = s * (eyeX + 0.34 * R);
      const inner = yb - 0.02 * R * st.brow, outer = yb + 0.06 * R;
      capsule(P, hairC, [x0, inner, surf(x0, inner) + 0.01 * R], [x1, outer, surf(x1, outer) + 0.01 * R], 0.05 * R, { outline: false, ao: 0 });
    }
    // cheek bulge under the eye, pushed up by the grin + smile crease
    const cxm = s * (mw * 0.95), cyy = yU + smile(mw) + 0.12 * R;
    if (!B.colossal) ell(P, skin, [cxm, cyy, surf(cxm, cyy) - 0.04 * R], [0.3 * R, 0.2 * R, 0.22 * R], { ao: 0.35 });
    const c0 = new V3(s * (mw + 0.02 * R), (yU + yL) / 2 + smile(mw), 0), c1 = new V3(s * (mw + 0.12 * R), (yU + yL) / 2 + smile(mw) + 0.34 * R, 0);
    c0.z = surf(c0.x, c0.y) + 0.02 * R; c1.z = surf(c1.x, c1.y) + 0.04 * R;
    if (!B.colossal) capsule(P, 0x6a342f, c0.toArray(), c1.toArray(), 0.03 * R, { outline: false, ao: 0 });
  }
  // ---- nose
  if (!B.colossal) {
    const ny = cy + 0.06 * ry, nz = surf(0, ny);
    ell(P, skin, [0, ny, nz + 0.0 * R], [0.12 * R, 0.16 * R, 0.14 * R], { ao: 0.3 });
    for (const s of [-1, 1]) P.add(sphere(1, 6, 5), 0x3a1a18, { pos: [s * 0.06 * R, ny - 0.12 * R, nz + 0.05 * R], scl: [0.045 * R, 0.035 * R, 0.045 * R], outline: false, ao: 0 });
  } else {
    for (const s of [-1, 1]) P.add(sphere(1, 6, 5), 0x1a0606, { pos: [s * 0.06 * R, cy + 0.04 * ry, surf(0, cy + 0.04 * ry) + 0.03 * R], scl: [0.035 * R, 0.1 * R, 0.04 * R], outline: false, ao: 0 });
    for (const s of [-1, 1]) ell(P, skin, [s * 0.55 * rx, cy - 0.12 * R * faceH, surf(s * 0.55 * rx, cy - 0.12 * R * faceH) - 0.06 * R], [0.28 * R, 0.16 * R, 0.2 * R], { ao: 0.4 });
  }

  // ---- hair: top cap + back cap + a few locks
  if (withHair) {
    P.add(new THREE.SphereGeometry(1, 22, 10, 0, Math.PI * 2, 0, 62 * Math.PI / 180), hairC, { pos: [0, cy + 0.03 * R, cz - 0.08 * R], scl: [rx * 1.06, ry * 1.07, rz * 1.08], ao: 0.15, rot: [-0.15, 0, 0] });
    P.add(new THREE.SphereGeometry(1, 22, 10, 0, Math.PI * 2, 0, 80 * Math.PI / 180), hairC, { pos: [0, cy - 0.05 * R, cz - 0.07 * R], scl: [rx * 1.06, ry * 1.05, rz * 1.07], ao: 0.15, rot: [-Math.PI / 2 - 0.2, 0, 0] });
    for (let i = 0; i < 9; i++) {                              // fringe: spiky tufts along the hairline
      const a = -0.95 + (i / 8) * 1.9;
      const hx = Math.sin(a) * rx * 0.86, hy = cy + 0.62 * ry - 0.08 * R * Math.abs(a), hz = surf(hx, hy) - 0.03 * R;
      P.add(new THREE.ConeGeometry(0.15 * R, (0.34 + rnd() * 0.16) * R, 5), hairC, { pos: [hx, hy - 0.1 * R, hz], rot: [Math.PI + 0.25, a * 0.5, 0], outline: true, ao: 0.1 });
    }
  }

  // ---- teeth rows: upper (head) + lower (jaw) + gums
  const jawMat = (mat) => { const m = mat.clone(); m.elements[12] -= jawP.x; m.elements[13] -= jawP.y; m.elements[14] -= jawP.z; return m; };
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N * 2 - 1, x = t * mw;
    const w = (2 * mw / N) * 0.94 * (1 - 0.2 * Math.abs(t));
    for (const upper of [true, false]) {
      const hh = toothH * (1 - 0.3 * Math.abs(t) ** 1.6) * (0.88 + rnd() * 0.24);
      const yEdge = (upper ? yU : yL) + smile(x);                       // rim line at this x
      const yc = upper ? yEdge - hh / 2 + 0.02 * R : yEdge + hh / 2 - 0.02 * R;
      const z = surf(x, yc);
      const n = normalAt(x, yc, z);
      const tilt = (rnd() - 0.5) * 0.12;
      let mat = orient(new V3(x, yc, z), n).scale(new V3(w * 0.5, hh * 0.5, 0.075 * R * (B.colossal ? 1.3 : 1)));
      mat.multiply(new M4().makeRotationZ(tilt));
      const gc = B.colossal ? 0x7a2220 : GUM;
      const gy = upper ? yEdge + 0.02 * R : yEdge - 0.02 * R;
      const gp = new V3(x, gy, surf(x, gy) - 0.01 * R);
      if (upper) {
        P.add(new THREE.BoxGeometry(2, 2, 2), TEETH, { matrix: mat, outline: false, ao: 0.25 });
        P.add(sphere(1, 6, 5), gc, { pos: gp.toArray(), scl: [w * 0.6, 0.06 * R, 0.07 * R], outline: false, ao: 0.2 });
      } else {
        PJ.add(new THREE.BoxGeometry(2, 2, 2), TEETH, { matrix: jawMat(mat), outline: false, ao: 0.25 });
        PJ.add(sphere(1, 6, 5), gc, { pos: gp.sub(jawP).toArray(), scl: [w * 0.6, 0.06 * R, 0.07 * R], outline: false, ao: 0.2 });
      }
    }
  }
  return { head: P.build(), jaw: PJ.build() };
}

function buildArm(d, skin, mus) {
  const P = new Parts(d.B.colossal);
  const lm = d.limb;
  P.add(limbGeo(d.upperLen, 0.52 * lm, 0.4 * lm, 0.12, 0.3), skin, { ao: 0.3 });
  if (d.B.muscle) ell(P, mus || skin, [0, -d.upperLen * 0.32, 0.12 * lm], [0.46 * lm, 0.5 * lm, 0.46 * lm], { ao: 0.4 });
  return P.build();
}
function handParts(P, d, skin, side, fist) {
  const hs = d.handS;
  const dir = -side;                         // palm faces the body centre
  // wrist -> palm
  P.add(limbGeo(0.4 * hs, 0.31 * d.limb + 0.04, 0.26 * hs, 0.0), skin, { pos: [0, -d.foreLen + 0.55 * hs, 0], ao: 0.3 });
  const y0 = -d.foreLen;                      // palm centre
  ell(P, skin, [0, y0 + 0.02, 0], [0.19 * hs, 0.36 * hs, 0.36 * hs], { ao: 0.3 });
  if (!fist) {
    for (let i = 0; i < 4; i++) {
      const z = (-0.25 + i * 0.165) * hs * 1.1;
      const l1 = (0.32 + (i === 1 || i === 2 ? 0.06 : 0)) * hs;
      const a = new V3(0, y0 - 0.24 * hs, z), b = new V3(dir * 0.06 * hs, y0 - 0.24 * hs - l1, z);
      const c = new V3(dir * 0.2 * hs, b.y - 0.26 * hs, z);
      capsule(P, skin, a.toArray(), b.toArray(), 0.075 * hs, { rs: 6, cs: 2, ao: 0.3 });
      capsule(P, skin, b.toArray(), c.toArray(), 0.065 * hs, { rs: 6, cs: 2, ao: 0.3 });
    }
    capsule(P, skin, [dir * 0.02, y0 + 0.08 * hs, 0.28 * hs], [dir * 0.1 * hs, y0 - 0.2 * hs, 0.5 * hs], 0.085 * hs, { rs: 6, cs: 2, ao: 0.3 }); // thumb (front)
  } else {
    // closed fist
    ell(P, skin, [dir * 0.14 * hs, y0 - 0.26 * hs, 0], [0.26 * hs, 0.26 * hs, 0.4 * hs], { ao: 0.35 });
    for (let i = 0; i < 4; i++) {
      const z = (-0.27 + i * 0.18) * hs;
      ell(P, skin, [dir * 0.22 * hs, y0 - 0.1 * hs, z], [0.1 * hs, 0.12 * hs, 0.1 * hs], { ao: 0.3, ws: 8, hs: 6 });
      capsule(P, skin, [dir * 0.2 * hs, y0 - 0.2 * hs, z], [dir * 0.1 * hs, y0 - 0.38 * hs, z], 0.075 * hs, { rs: 6, cs: 2, ao: 0.35 });
    }
    capsule(P, skin, [dir * 0.1 * hs, y0 + 0.06 * hs, 0.26 * hs], [dir * 0.27 * hs, y0 - 0.12 * hs, 0.14 * hs], 0.085 * hs, { rs: 6, cs: 2, ao: 0.3 });
  }
}
function buildFore(d, skin, side, fist) {
  const P = new Parts(d.B.colossal);
  const lm = d.limb;
  P.add(limbGeo(d.foreLen - 0.55 * d.handS, 0.4 * lm, 0.3 * lm + 0.02, 0.1, 0.25), skin, { ao: 0.3 });
  handParts(P, d, skin, side, fist);
  return P.build();
}
function buildThigh(d, skin) {
  const P = new Parts(d.B.colossal), lm = d.limb;
  P.add(limbGeo(d.thighLen, 0.64 * lm, 0.46 * lm, 0.14, 0.3, 14), skin, { ao: 0.3 });
  if (d.B.muscle) ell(P, skin, [0, -d.thighLen * 0.4, 0.15 * lm], [0.6 * lm, 0.8 * lm, 0.58 * lm], { ao: 0.4 });
  return P.build();
}
function buildShin(d, skin) {
  const P = new Parts(d.B.colossal), lm = d.limb;
  P.add(limbGeo(d.shinLen, 0.46 * lm, 0.28 * lm + 0.02, 0.2, 0.25, 12), skin, { ao: 0.3 });
  ell(P, skin, [0, -d.shinLen * 0.3, -0.14 * lm], [0.38 * lm, 0.46 * lm, 0.36 * lm], { ao: 0.35 });                  // calf
  return P.build();
}
function buildFoot(d, skin) {
  const P = new Parts(d.B.colossal), lm = d.limb;
  const w = 0.3 * Math.sqrt(lm) + 0.1;
  ell(P, skin, [0, -0.02, 0.0], [0.3 * lm + 0.02, 0.3 * lm + 0.02, 0.34 * lm + 0.02], { ao: 0.3 });                   // ankle
  ell(P, skin, [0, -d.ankleH + 0.15 * lm + 0.07, 0.42], [w, 0.17 * lm + 0.1, 0.78], { ao: 0.35 });                      // sole + midfoot
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * 0.62 * w * 0.5;
    ell(P, skin, [x, -d.ankleH + 0.14, 1.04 - Math.abs(i - 2) * 0.05], [0.12 * Math.sqrt(lm) + 0.04, 0.1 * lm + 0.06, 0.15], { ao: 0.3, ws: 8, hs: 6 });
  }
  return P.build();
}

// -------------------------------------------------------------------------------------------------------------
function colossalTexture() {
  const W = 512, H = 256;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#7d1d15'; g.fillRect(0, 0, W, H);
  const rnd = mulberry(77);
  // broad darker/lighter muscle bands
  for (let i = 0; i < 40; i++) {
    const x = rnd() * W, w = 6 + rnd() * 26;
    g.fillStyle = rnd() < 0.5 ? 'rgba(60,8,6,0.35)' : 'rgba(170,48,34,0.3)';
    g.fillRect(x, 0, w, H);
  }
  // pale fibre striations (vertical, wavy)
  for (let i = 0; i < 190; i++) {
    const x0 = rnd() * W, lw = 0.7 + rnd() * 2.6;
    g.strokeStyle = rnd() < 0.7 ? `rgba(238,210,184,${0.35 + rnd() * 0.5})` : `rgba(40,6,5,${0.4 + rnd() * 0.4})`;
    g.lineWidth = lw; g.beginPath();
    let x = x0; g.moveTo(x, 0);
    for (let y = 0; y <= H - 8; y += 16) { x += (rnd() - 0.5) * 4; g.lineTo(x, y); }
    g.stroke();
  }
  // flecks
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '255,220,200' : '30,0,0'},${rnd() * 0.25})`; g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1 + rnd() * 4); }
  // plain strip at the top (v ~ 1) used by detail parts (teeth, eyes)
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, 4);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(3, 1);
  tex.anisotropy = 4;
  return tex;
}

let _matPlain = null, _matColossal = null;
export function bodyMaterial(colossal) {
  if (colossal) {
    if (!_matColossal) _matColossal = toonMaterial(0xffffff, { vertexColors: true, map: colossalTexture() });
    return _matColossal;
  }
  if (!_matPlain) _matPlain = toonMaterial(0xffffff, { vertexColors: true });
  return _matPlain;
}

const _cache = new Map();
/**
 * spec: { build, size: 'S'|'M'|'L'|'XL', skin: key of SKINS, hair: bool|index, expr: key of EXPR }
 * returns { key, dims, st, geo: { pelvis, spine, head, jaw, arm, foreL, foreR, foreLFist, foreRFist, thigh, shin, foot }, material, colossal }
 */
export function getArchetype(spec) {
  const key = [spec.build, spec.size, spec.skin, spec.hair === false ? 'x' : spec.hair, spec.expr].join('|');
  if (_cache.has(key)) return _cache.get(key);
  const rnd = mulberry(hashStr(key));
  const d = makeDims(spec.build, spec.size);
  const colossal = !!d.B.colossal;
  const st = EXPR[spec.expr] || EXPR.grin;
  const skin = colossal ? 0xffffff : (SKINS[spec.skin] ?? SKINS.beige);
  const hairIdx = typeof spec.hair === 'number' ? spec.hair : 0;
  const hairC = HAIRS[hairIdx % HAIRS.length];
  const muscleCol = colossal ? 0xe8d8c8 : null;
  const { head, jaw } = buildHead(d, st, skin, hairC, rnd, spec.hair !== false && !colossal);
  const geo = {
    pelvis: buildPelvis(d, skin),
    spine: buildSpine(d, skin, muscleCol),
    head, jaw,
    arm: buildArm(d, skin, muscleCol),
    foreL: buildFore(d, skin, 1, false), foreR: buildFore(d, skin, -1, false),
    foreLFist: buildFore(d, skin, 1, true), foreRFist: buildFore(d, skin, -1, true),
    thigh: buildThigh(d, skin), shin: buildShin(d, skin), foot: buildFoot(d, skin),
  };
  const arch = { key, dims: d, st, geo, material: bodyMaterial(colossal), colossal, jawRest: st.open };
  _cache.set(key, arch);
  return arch;
}
