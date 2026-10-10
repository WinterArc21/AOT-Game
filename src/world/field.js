// OPEN FIELD (z in [6,180]): lone trees, rocks, a broken cart, a small stone ruin, titan spawn zones.
import * as THREE from 'three';
import { Builder } from './geo.js';
import { Rng } from './rng.js';
import { groundHeight, roadX } from './terrain.js';
import { TreeBatch, addTree, finishBatch } from './trees.js';
import { addRock } from './props.js';

const V3 = THREE.Vector3, Q = THREE.Quaternion, UP = new V3(0, 1, 0);

export function buildField(ctx) {
  const rng = new Rng(4004);
  // lone trees (normal 15-25 m)
  const tb = new TreeBatch();
  const spots = [[-140, 60], [-70, 120], [95, 80], [150, 140], [-210, 150], [40, 160], [250, 90], [-300, 70], [-30, 170], [190, 40]];
  for (const [x, z] of spots) {
    if (Math.abs(x - roadX(z)) < 12) continue;
    const H = rng.range(15, 25);
    addTree(ctx, tb, rng, x, z, { H, r0: rng.range(0.6, 0.95), lod: 0, small: true, branches: [3, 4], branchMin: H * 0.35, len: [4, 7.5], rb: [0.2, 0.34], blobR: [3.6, 5.6], canopyN: 5, canopySpread: 3 });
  }
  finishBatch(ctx, tb, 'fieldTree', { outline: true, outlineThickness: 0.08 });

  // rocks
  const RB = new Builder();
  for (let i = 0; i < 34; i++) {
    const x = rng.range(-420, 420), z = rng.range(30, 175);
    if (Math.abs(x - roadX(z)) < 8) continue;
    const r = rng.range(0.8, i % 7 === 0 ? 3.6 : 2.2), gy = groundHeight(x, z), squash = 0.78;
    addRock(RB, x, gy + r * 0.1, z, r, rng, { squash });
    ctx.col.sph(x, gy + r * 0.1, z, r * 0.8, 'stone');
  }

  // broken cart beside the road
  const WD = new Builder(), cx = roadX(95) + 9, cz = 95, gy = groundHeight(cx, cz), yaw = 0.5;
  const M = new THREE.Matrix4().compose(new V3(cx, gy, cz), new Q().setFromAxisAngle(UP, yaw), new V3(1, 1, 1));
  const qY = new Q().setFromAxisAngle(UP, yaw);
  WD.setTransform(M);
  WD.box(0, 1.15, 0, 3.6, 0.25, 1.9, { color: 0x8a5a30, uTile: 1, vTile: 1, vBase: 0, faces: 'xXzZyY' });
  for (const sz of [-1, 1]) WD.box(0, 1.65, sz * 0.9, 3.6, 0.8, 0.12, { color: 0x7a4c28, uTile: 1, vTile: 1, vBase: 0, faces: 'xXzZy' });
  WD.box(-1.8, 1.65, 0, 0.12, 0.8, 1.9, { color: 0x7a4c28, uTile: 1, vTile: 1, faces: 'xXzZy' });
  WD.tube([new V3(1.8, 1.0, 0), new V3(3.4, 0.9, 0.2), new V3(5.4, 0.6, 0.5)], () => 0.12, { seg: 6, color: new THREE.Color(0x6b4526), uTile: 2, vTile: 2 });
  WD.tube([new V3(0, 0.62, -1.2), new V3(0, 0.62, -1.05), new V3(0, 0.62, -0.9), new V3(0, 0.62, -0.88)], (i) => [0.01, 0.62, 0.62, 0.01][i], { seg: 12, color: new THREE.Color(0x5b3a20), uTile: 2, vTile: 2 });
  WD.setTransform(null);
  ctx.col.box(cx, gy + 1.4, cz, 1.8, 0.45, 0.95, 'wood', qY);
  const cw = new V3(0, 0.62, -1.05).applyMatrix4(M);
  ctx.col.sph(cw.x, cw.y, cw.z, 0.6, 'wood');
  const hb = new V3(1.8, 1.0, 0).applyMatrix4(M), he = new V3(5.4, 0.6, 0.5).applyMatrix4(M);
  ctx.col.cap(hb.x, hb.y, hb.z, he.x, he.y, he.z, 0.14, 'wood');

  // stone ruin: broken walls and pillars
  const ST = new Builder(), rx = -150, rz = 100;
  const piece = (dx, dz, w, h, d, ry = 0) => {
    const x = rx + dx, z = rz + dz, g = groundHeight(x, z), q = new Q().setFromAxisAngle(UP, ry);
    ST.setTransform(new THREE.Matrix4().compose(new V3(x, g, z), q, new V3(1, 1, 1)));
    ST.box(0, h / 2 - 0.3, 0, w, h, d, { uTile: 8, vTile: 4, vBase: -0.3, grad: [0.75, 1], faces: 'xXzZy' });
    ST.setTransform(null);
    ctx.col.box(x, g + h / 2 - 0.3, z, w / 2, h / 2, d / 2, 'stone', q);
  };
  piece(0, 0, 14, 7, 1.6); piece(-7, 5, 1.6, 5, 10); piece(7, 6, 1.6, 9, 8); piece(0, 11, 5, 2.5, 1.6, 0.1); piece(-3, 11.6, 3, 4.5, 1.6, -0.2);
  for (const [px, pz, ph] of [[-5, 3, 9], [5, 3, 6], [0, 7, 11]]) {
    const x = rx + px, z = rz + pz, g = groundHeight(x, z);
    ST.tube([new V3(x, g - 0.3, z), new V3(x, g + ph * 0.5, z), new V3(x, g + ph, z)], (i) => [0.95, 0.85, 0.8][i], { seg: 10, uTile: 3, vTile: 3, color: new THREE.Color(0xd7cdb8) });
    ctx.col.cyl(x, z, g - 0.3, g + ph, 0.87, 'stone');
  }

  const addMesh = (B, mat, name) => { const m = new THREE.Mesh(B.toGeometry(), mat); m.name = name; ctx.add(m); };
  addMesh(RB, ctx.mat.plain, 'fieldRocks'); addMesh(WD, ctx.mat.planks, 'fieldCart'); addMesh(ST, ctx.mat.stone, 'fieldRuin');

  // titan spawn zones
  for (const [x, z, r] of [[-150, 55, 25], [0, 70, 25], [140, 60, 25], [-80, 130, 25], [90, 140, 25], [-220, 110, 25], [230, 120, 25], [20, 170, 20]])
    ctx.titanSpawns.push({ center: new V3(x, groundHeight(x, z), z), radius: r, area: 'field' });
}
