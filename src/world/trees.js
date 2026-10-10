// Procedural trees: tapered ribbed trunks with buttress roots, near-horizontal capsule-collided branches,
// visual-only twigs and collider-free foliage blobs (instanced). Shared by the giant forest and the lone field trees.
import * as THREE from 'three';
import { Builder, smoothOutlineGeometry } from './geo.js';
import { clamp, lerp } from './rng.js';
import { groundHeight } from './terrain.js';
import { toonMaterial } from '../core/style.js';
import { addOutlineGeo } from './outline.js';

const V3 = THREE.Vector3;
const BARK_TINTS = [0xffffff, 0xf2e2cf, 0xe4d2bb, 0xf6ead9, 0xd9c7b0];
const LEAF_DARK = [0x1c5f38, 0x226b3a, 0x2a7a3c, 0x1f6a42];
const LEAF_MID = [0x2f8a3e, 0x3a9a44, 0x2e8a4a, 0x47a248];
const LEAF_LIGHT = [0x5cb84e, 0x6cc653, 0x4fae52];

const _blobs = {};
export function blobGeometry(detail = 1) {
  if (_blobs[detail]) return _blobs[detail];
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeV(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const h = Math.sin(x * 7.1 + y * 3.3) * Math.cos(z * 6.3 - y * 2.1) * 0.16 + 1;
    p.setXYZ(i, x * h, (y < 0 ? y * 0.55 : y) * h, z * h);
  }
  g.computeVertexNormals();
  return (_blobs[detail] = g);
}
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
function mergeV(g) { return mergeVertices(g, 1e-4); }

export class TreeBatch {
  constructor() { this.wood = new Builder(); this.blobs = []; }
}

/**
 * Add a tree. spec: { H, r0, lod (0 full,1 mid,2 far), branches:[min,max], branchMin (m above ground), len:[a,b], rb:[a,b],
 * avoidY?:[lo,hi], blobR:[a,b], canopyN, canopySpread, small? }. Returns { gy, H, r0 }.
 */
export function addTree(ctx, batch, rng, x, z, spec) {
  const gy = groundHeight(x, z), { H, r0, lod } = spec;
  const W = batch.wood;
  const nL = rng.int(5, 7), ph = rng.range(0, 6.28), ph2 = rng.range(0, 6.28), A = spec.small ? 0.5 : rng.range(0.8, 1.25), hr = spec.small ? 1.4 : rng.range(4.5, 7);
  const tint = new THREE.Color(rng.pick(BARK_TINTS));
  const seg = lod === 0 ? (spec.small ? 12 : 18) : lod === 1 ? 12 : 8;
  // ring heights
  const ys = [-1.2, 0];
  const dense = spec.small ? [0.6, 1.4, 2.6, 4.5, 8] : lod === 0 ? [1, 2.3, 4, 6.5, 10, 16, 24] : lod === 1 ? [2.5, 6, 13, 24] : [4, 14];
  for (const y of dense) if (y < H * 0.6) ys.push(y);
  const stepY = lod === 0 ? 17 : lod === 1 ? 26 : 40;
  for (let y = ys[ys.length - 1] + stepY; y < H - 2; y += stepY) ys.push(y);
  ys.push(H, H + 3.5);
  const pts = ys.map((y) => new V3(x, gy + y, z));
  const trunkR = (y, th) => {
    const yy = Math.max(0, y), t = clamp(yy / H, 0, 1.05);
    const taper = 1 - 0.36 * Math.pow(Math.min(t, 1), 0.9);
    const lobe = Math.pow(Math.max(0, Math.cos(nL * th + ph)), 3);
    const flare = 1 + (A * lobe + 0.28 * A) * Math.exp(-yy / hr);
    const ribs = 1 + 0.035 * Math.sin(9 * th + ph2 + yy * 0.04) + 0.02 * Math.sin(17 * th + yy * 0.11);
    return r0 * taper * flare * ribs;
  };
  W.tube(pts, (i, th) => (i === ys.length - 1 ? 0.06 * r0 : trunkR(ys[i], th)), {
    seg, uTile: 4, vTile: 8,
    colFn: (i) => { const t = clamp(ys[i] / H, 0, 1); return tint.clone().multiplyScalar(0.7 + 0.35 * Math.min(1, t * 3)); },
  });
  // trunk colliders (two stacked cylinders + a squat base for the roots)
  const rAt = (y0, y1) => { let s = 0, n = 0; for (let k = 0; k <= 4; k++) { const y = lerp(y0, y1, k / 4); for (let a = 0; a < 6; a++) { s += trunkR(y, a); n++; } } return s / n; };
  if (!spec.small) {
    ctx.col.cyl(x, z, gy - 2, gy + 5, rAt(0.5, 5) * 0.97, 'bark');
    if (lod < 2) { ctx.col.cyl(x, z, gy + 5, gy + H * 0.5, rAt(5, H * 0.5) * 0.97, 'bark'); ctx.col.cyl(x, z, gy + H * 0.5, gy + H, rAt(H * 0.5, H) * 0.97, 'bark'); }
    else ctx.col.cyl(x, z, gy + 5, gy + H, rAt(5, H) * 0.97, 'bark');
  } else {
    ctx.col.cyl(x, z, gy - 2, gy + H, rAt(0.5, H) * 0.97, 'bark');
  }

  // branches
  const nb = rng.int(spec.branches[0], spec.branches[1]);
  const y0 = spec.branchMin, y1 = H * (spec.small ? 0.8 : 0.84);
  const a0 = rng.range(0, 6.28);
  let made = 0;
  const tips = [];
  for (let k = 0; k < nb * 3 && made < nb; k++) {
    const f = (made + rng.range(0.1, 0.9)) / nb;
    const by = lerp(y0, y1, Math.pow(f, 0.9));
    if (spec.avoidY && by > spec.avoidY[0] && by < spec.avoidY[1]) continue;
    made++;
    const az = a0 + made * 2.399 + rng.range(-0.35, 0.35);
    const lenScale = lerp(1.0, 0.62, (by - y0) / Math.max(1, y1 - y0));
    const L = rng.range(spec.len[0], spec.len[1]) * lenScale;
    const rt = trunkR(by, az) , rb = clamp(rng.range(spec.rb[0], spec.rb[1]) * (spec.small ? 1 : lerp(1.15, 0.8, (by - y0) / Math.max(1, y1 - y0))), spec.rb[0] * 0.7, spec.rb[1]);
    const slope = rng.range(0.08, 0.34);
    const d = new V3(Math.cos(az), slope, Math.sin(az)).normalize();
    const start = new V3(x + Math.cos(az) * rt * 0.45, gy + by, z + Math.sin(az) * rt * 0.45);
    const end = start.clone().addScaledVector(d, L + rt * 0.5);
    const mid = start.clone().lerp(end, 0.5);
    const radii = [rb * 1.2, rb * 0.9, rb * 0.62];
    const m3 = lod === 0 || spec.small ? [start, mid, end] : [start, end];
    const rr = lod === 0 || spec.small ? radii : [rb * 1.1, rb * 0.62];
    W.tube(m3, (i) => rr[i], { seg: lod === 0 ? 7 : 5, uTile: 4, vTile: 6, colFn: (i) => tint.clone().multiplyScalar(0.85 + i * 0.05) });
    const sa = start.clone().addScaledVector(d, rt * 0.75);
    ctx.col.cap(sa.x, sa.y, sa.z, end.x, end.y, end.z, rb * 0.9, 'bark');
    tips.push({ start, end, d, rb, L });
    // twigs (visual only)
    if (lod < 2) {
      const nt = lod === 0 ? rng.int(2, 3) : 1;
      for (let t = 0; t < nt; t++) {
        const u = rng.range(0.45, 0.95), p0 = start.clone().lerp(end, u);
        const td = d.clone().multiplyScalar(0.6).add(new V3(rng.range(-1, 1), rng.range(0.1, 0.8), rng.range(-1, 1))).normalize();
        const tl = rng.range(3, 6.5) * (spec.small ? 0.5 : 1);
        const p1 = p0.clone().addScaledVector(td, tl);
        W.tube([p0, p1], (i) => [0.2 * rb + 0.06, 0.05][i], { seg: 4, uTile: 2, vTile: 3, color: tint.clone().multiplyScalar(0.9) });
        if ((lod === 0 && rng.chance(0.3)) || spec.small) batch.blobs.push({ x: p1.x, y: p1.y + 0.5, z: p1.z, r: rng.range(2.4, 4.0) * (spec.small ? 0.6 : 1), c: pickLeaf(rng, 0.55 + rng.range(-0.2, 0.2)) });
      }
    }
  }
  // blobs at branch tips
  for (const t of tips) batch.blobs.push({ x: t.end.x + t.d.x * 1.2, y: t.end.y + 1.2, z: t.end.z + t.d.z * 1.2, r: rng.range(spec.blobR[0] * 0.5, spec.blobR[1] * 0.55) * (spec.small ? 1 : 0.9), c: pickLeaf(rng, rng.range(0.3, 0.8)) });
  // top canopy cluster
  const n = spec.canopyN;
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, 6.28), rad = Math.abs(rng.gauss()) * spec.canopySpread * (i === 0 ? 0 : 1);
    const yy = gy + H * (spec.small ? rng.range(0.78, 1.02) : rng.range(0.8, 1.04)) + (i === 0 ? 2 : rng.range(-3, 3));
    const hgt = clamp((yy - gy) / H, 0, 1.05);
    batch.blobs.push({ x: x + Math.cos(a) * rad, y: yy, z: z + Math.sin(a) * rad, r: rng.range(spec.blobR[0], spec.blobR[1]), c: pickLeaf(rng, 0.45 + (hgt - 0.8) * 1.4 + rng.range(-0.2, 0.25)) });
  }
  return { gy, H, r0 };
}

const _c = new THREE.Color();
function pickLeaf(rng, t) {
  t = clamp(t, 0, 1);
  const a = t < 0.5 ? LEAF_DARK : LEAF_MID, b = t < 0.5 ? LEAF_MID : LEAF_LIGHT, k = (t < 0.5 ? t : t - 0.5) * 2;
  const c = new THREE.Color(rng.pick(a)).lerp(_c.set(rng.pick(b)), k);
  return c;
}

/** Turn a batch into scene meshes: wood (+ outline) and instanced foliage. */
export function finishBatch(ctx, batch, name, { outline = true, outlineThickness = 0.14, cast = true, blobDetail = 1 } = {}) {
  const out = {};
  if (batch.wood.pos.length) {
    const g = batch.wood.toGeometry();
    const m = new THREE.Mesh(g, ctx.mat.bark); m.name = name + 'Wood'; ctx.add(m, cast, true);
    if (outline) addOutlineGeo(m, g, outlineThickness);
    out.wood = m;
  }
  if (batch.blobs.length) {
    const mat = toonMaterial(0xffffff);
    const im = new THREE.InstancedMesh(blobGeometry(blobDetail), mat, batch.blobs.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    batch.blobs.forEach((b, i) => {
      e.set(0, (i * 1.7) % 6.28, 0); q.setFromEuler(e);
      s.set(b.r * (0.95 + (i % 3) * 0.08), b.r * (0.78 + (i % 4) * 0.05), b.r * (1.05 - (i % 5) * 0.04));
      m4.compose(p.set(b.x, b.y, b.z), q, s); im.setMatrixAt(i, m4); im.setColorAt(i, b.c);
      ctx.foliage.add(b.x, b.y, b.z, s.x, s.y, s.z);
    });
    im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    im.name = name + 'Foliage'; ctx.add(im, cast, true);
    out.foliage = im;
  }
  return out;
}
