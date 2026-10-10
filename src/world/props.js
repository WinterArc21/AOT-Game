// Small reusable props: rocks, crates, barrels, gas canisters, supply depots.
import * as THREE from 'three';
import { noise3 } from './common.js';

const _ico = new THREE.IcosahedronGeometry(1, 1);
const _icoPos = _ico.attributes.position;
const _tmpC = new THREE.Color();

/** Flat-shaded lumpy rock into Builder B (vertex colours). Returns nothing. */
export function addRock(B, cx, cy, cz, r, rng, o = {}) {
  const squash = o.squash ?? rng.range(0.6, 0.9), yaw = rng.range(0, 6.28), sx = rng.range(0.85, 1.2), sz = rng.range(0.85, 1.2);
  const base = new THREE.Color(o.color ?? 0x9b968b).multiplyScalar(rng.range(0.85, 1.12));
  const moss = new THREE.Color(o.moss ?? 0x6f8f4a);
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const P = [];
  for (let i = 0; i < _icoPos.count; i++) {
    const x = _icoPos.getX(i), y = _icoPos.getY(i), z = _icoPos.getZ(i);
    const d = 1 + noise3(x * 1.7 + cx * 0.3, y * 1.7, z * 1.7 + cz * 0.3) * 0.3;
    let px = x * d * r * sx, py = y * d * r * squash, pz = z * d * r * sz;
    if (py < -r * squash * 0.55) py = -r * squash * 0.55;   // flat bottom, buried in ground
    P.push([cx + px * cs - pz * sn, cy + py, cz + px * sn + pz * cs]);
  }
  for (let i = 0; i < P.length; i += 3) {
    const ny = ((P[i + 1][1] - P[i][1]) * (P[i + 2][0] - P[i][0]) * 0 + 0);
    // face up-ness for moss
    const a = new THREE.Vector3(...P[i]), b = new THREE.Vector3(...P[i + 1]), c = new THREE.Vector3(...P[i + 2]);
    const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    _tmpC.copy(base).multiplyScalar(0.8 + 0.3 * Math.max(0, n.y));
    if (o.mossy !== false && n.y > 0.55 && (cy + 1) > 0) _tmpC.lerp(moss, 0.45 * (n.y - 0.4));
    B.tri(P[i], P[i + 1], P[i + 2], [0, 0], [1, 0], [0, 1], _tmpC.clone());
  }
}

/** Depot props into per-material builders: B.planks (wood), B.iron (plain vertex colour). Colliders via ctx.col. */
export function addCrate(ctx, B, x, y, z, sx, sy, sz, yaw = 0, color = 0xc99a5b) {
  const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y + sy / 2, z);
  B.setTransform(m);
  B.box(0, 0, 0, sx, sy, sz, { color, uTile: 1, vTile: 1, vBase: -sy / 2, faces: 'xXzZy', grad: [0.8, 1] });
  B.setTransform(null);
  // darker corner battens
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  ctx.col.box(x, y + sy / 2, z, sx / 2, sy / 2, sz / 2, 'wood', q);
}

export function addBarrel(ctx, B, x, y, z, r = 0.45, h = 1.0, color = 0x9a6b3d) {
  const pts = [], rad = [];
  const n = 6;
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push(new THREE.Vector3(x, y + t * h, z)); rad.push(i === 0 || i === n ? 0.01 : r * (0.82 + 0.18 * Math.sin(t * Math.PI))); }
  B.tube(pts, (i) => rad[i], { seg: 10, uTile: 1.5, vTile: 1.5, colFn: (i) => (i === 2 || i === 4 ? new THREE.Color(0x30302c) : new THREE.Color(color)) });
  ctx.col.cyl(x, z, y, y + h, r * 0.92, 'wood');
}

export function addCanister(ctx, B, x, y, z, h = 0.95, r = 0.2) {
  const pts = [], rad = [], cols = [];
  const spec = [[0, 0.01, 0x8d9aa8], [0.03, 0.8, 0x8d9aa8], [0.12, 1, 0xaab6c4], [0.5, 1, 0xaab6c4], [0.56, 1, 0xf0f0f0], [0.66, 1, 0xf0f0f0], [0.72, 1, 0x4f78c8], [0.9, 0.9, 0x4f78c8], [0.97, 0.45, 0x6e7a86], [1, 0.12, 0x6e7a86]];
  for (const [t, rr, c] of spec) { pts.push(new THREE.Vector3(x, y + t * h, z)); rad.push(r * rr); cols.push(c); }
  B.tube(pts, (i) => rad[i], { seg: 10, uTile: 4, vTile: 4, colFn: (i) => new THREE.Color(cols[i]) });
  ctx.col.cyl(x, z, y, y + h, r, 'metal');
}

/**
 * Survey Corps supply depot: crates, barrels, gas canisters and a Wings of Freedom flag.
 * (x,y,z) = centre of the standing area at deck height. yaw rotates the layout. Registers into ctx.depots.
 */
export function makeDepot(ctx, B, x, y, z, yaw = 0, o = {}) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  const crate = (lx, lz, w, h, d, dy = 0, ry = 0, color) => { const [px, pz] = at(lx, lz); addCrate(ctx, B.planks, px, y + dy, pz, w, h, d, yaw + ry, color); };
  const R = o.back ?? -3.6;
  crate(-3.4, R, 1.3, 1.1, 1.3, 0, 0.05, 0xc99a5b); crate(-3.3, R + 0.1, 0.9, 0.8, 0.9, 1.1, 0.5, 0xb88450);
  crate(-1.9, R, 1.0, 0.9, 1.4, 0, -0.04, 0xa87343); crate(-0.2, R - 0.1, 1.2, 1.0, 1.2, 0, 0.1, 0xc99a5b);
  const bx = at(1.4, R - 0.1); addBarrel(ctx, B.planks, bx[0], y, bx[1]);
  const bx2 = at(2.4, R); addBarrel(ctx, B.planks, bx2[0], y, bx2[1], 0.42, 0.95, 0x8d5f35);
  for (let i = 0; i < 6; i++) { const [px, pz] = at(3.5 + (i % 3) * 0.5, R + 0.1 - Math.floor(i / 3) * 0.55); addCanister(ctx, B.iron, px, y, pz); }
  const [fx, fz] = at(o.flagX ?? 5.4, R + 0.2);
  ctx.flag('survey', fx, y, fz, { yaw: yaw + Math.PI * 0.5 * 0, h: o.flagH ?? 7.5, s: 1.0 });
  const [dx, dz] = at(0, 0);
  ctx.depots.push({ position: new THREE.Vector3(dx, y, dz), radius: o.radius ?? 7 });
}
