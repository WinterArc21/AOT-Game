// WALL ROSE: 50 m tall, 12 m thick cut-stone wall with a breached gate, parapet, buttresses, cannons, Garrison flags.
import * as THREE from 'three';
import { Builder } from './geo.js';
import { Rng, smoothstep, clamp } from './rng.js';
import { noise2, qYaw } from './common.js';
import { addRock, makeDepot } from './props.js';

const V3 = THREE.Vector3;
const HALF = 1200, TOP = 50, THICK = 6, GATE_W = 8, GATE_H = 20;

export function buildWall(ctx) {
  const rng = new Rng(1001);
  const S = new Builder(), PV = new Builder(), WD = new Builder(), IR = new Builder(), RB = new Builder();
  const tc = new THREE.Color();

  // ---- faces ----
  const wallColor = (u, v, x, y) => {
    const grime = smoothstep(0, 10, y);
    let l = 0.74 + 0.26 * grime;
    l *= 1 + noise2(x * 0.035, y * 0.12) * 0.07 + noise2(x * 0.25, y * 0.015) * 0.06;
    l *= 1 + smoothstep(42, 50, y) * 0.07;
    tc.setRGB(l, l, l);
    const moss = (1 - grime) * clamp(0.5 + noise2(x * 0.09, 3.3) * 0.8, 0, 1);
    tc.r *= 1 - moss * 0.22; tc.b *= 1 - moss * 0.32; tc.g *= 1 + moss * 0.02;
    return tc;
  };
  const UVS = (p) => [p[0] / 8, p[1] / 4];
  const UVZ = (p) => [p[2] / 8, p[1] / 4];
  const nx = (len) => Math.max(1, Math.ceil(len / 20));
  const face = (x0, x1, front) => {   // long faces
    const len = x1 - x0;
    if (front) S.patch(new V3(x0, 0, THICK), new V3(len, 0, 0), new V3(0, TOP, 0), nx(len), 10, UVS, wallColor);
    else S.patch(new V3(x1, 0, -THICK), new V3(-len, 0, 0), new V3(0, TOP, 0), nx(len), 10, UVS, wallColor);
  };
  face(-HALF, -GATE_W, true); face(GATE_W, HALF, true); face(-HALF, -GATE_W, false); face(GATE_W, HALF, false);
  // lintel faces above the opening
  S.patch(new V3(-GATE_W, GATE_H, THICK), new V3(16, 0, 0), new V3(0, TOP - GATE_H, 0), 2, 6, UVS, wallColor);
  S.patch(new V3(GATE_W, GATE_H, -THICK), new V3(-16, 0, 0), new V3(0, TOP - GATE_H, 0), 2, 6, UVS, wallColor);
  // end caps
  S.patch(new V3(-HALF, 0, -THICK), new V3(0, 0, 12), new V3(0, TOP, 0), 2, 8, UVZ, wallColor);
  S.patch(new V3(HALF, 0, THICK), new V3(0, 0, -12), new V3(0, TOP, 0), 2, 8, UVZ, wallColor);
  // tunnel walls and ceiling
  const tunnelC = (u, v, x, y) => { const l = 0.62 + 0.3 * smoothstep(0, 18, y); tc.setRGB(l, l * 0.98, l * 0.94); return tc; };
  S.patch(new V3(-GATE_W, 0, THICK), new V3(0, 0, -12), new V3(0, GATE_H, 0), 4, 6, UVZ, tunnelC);
  S.patch(new V3(GATE_W, 0, -THICK), new V3(0, 0, 12), new V3(0, GATE_H, 0), 4, 6, UVZ, tunnelC);
  S.patch(new V3(-GATE_W, GATE_H, -THICK), new V3(16, 0, 0), new V3(0, 0, 12), 4, 4, (p) => [p[0] / 8, p[2] / 4], () => tc.setRGB(0.55, 0.54, 0.52));
  // walkway paving
  PV.patch(new V3(-HALF, TOP, -THICK), new V3(0, 0, 12), new V3(2 * HALF, 0, 0), 6, 120, (p) => [p[0] / 4, p[2] / 4], (u, v, x, y, z) => { const l = (0.92 + noise2(x * 0.05, z * 0.3) * 0.06) * (z > 4.6 ? 0.82 : 1) * (z < -5 ? 0.9 : 1); return tc.setRGB(l, l, l); });

  // ---- parapet (outer edge, +z) ----
  S.box(0, TOP + 0.65, 5.55, 2 * HALF, 1.3, 0.9, { uTile: 8, vTile: 4, vBase: 0, faces: 'Zzy', topTile: 4 });
  ctx.col.box(0, TOP + 0.65, 5.55, HALF, 0.65, 0.45, 'stone');

  // ---- solid wall bodies: left part, right part, lintel above the gate (top surface exactly y = 50) ----
  ctx.col.box(-(HALF + GATE_W) / 2, TOP / 2, 0, (HALF - GATE_W) / 2, TOP / 2, THICK, 'stone');
  ctx.col.box((HALF + GATE_W) / 2, TOP / 2, 0, (HALF - GATE_W) / 2, TOP / 2, THICK, 'stone');
  ctx.col.box(0, (GATE_H + TOP) / 2, 0, GATE_W, (TOP - GATE_H) / 2, THICK, 'stone');

  // ---- buttresses (both faces, away from the gate) ----
  for (let k = 0; k < 17; k++) for (const sx of [-1, 1]) {
    const bx = sx * (70 + k * 68 + rng.range(-3, 3));
    for (const side of [-1, 1]) {
      const bz = side * (THICK + 1.4);
      const bw = 5, bh = 46, bd = 2.8;
      S.box(bx, bh / 2, bz, bw, bh, bd, { uTile: 8, vTile: 4, vBase: 0, grad: [0.78, 1], faces: side > 0 ? 'xXZy' : 'xXzy' });
      ctx.col.box(bx, bh / 2, bz, bw / 2, bh / 2, bd / 2, 'stone');
    }
  }

  // ---- cannons on the walkway near the gate ----
  const cannonXs = [20, 60, 100, 140, 180, 225].flatMap((x) => [-x, x]);
  for (const cx of cannonXs) {
    const lx = cx + rng.range(-1.5, 1.5);
    WD.box(lx, TOP + 0.55, 3.3, 1.6, 1.1, 3.0, { color: 0x7a4f2c, uTile: 1.5, vTile: 1.5, vBase: TOP, grad: [0.75, 1] });
    ctx.col.box(lx, TOP + 0.55, 3.3, 0.8, 0.55, 1.5, 'wood');
    for (const sx of [-1, 1]) {
      const wp = [new V3(lx + sx * 0.8 + 0.0, TOP + 0.6, 3.3 - 1.0), new V3(lx + sx * 0.8 + sx * 0.22, TOP + 0.6, 3.3 - 1.0)];
      WD.tube([new V3(lx + sx * 0.76, TOP + 0.6, 2.55), new V3(lx + sx * 0.82, TOP + 0.6, 2.55), new V3(lx + sx * 0.95, TOP + 0.6, 2.55), new V3(lx + sx * 1.05, TOP + 0.6, 2.55)], (i) => [0.01, 0.62, 0.62, 0.01][i], { seg: 12, color: new THREE.Color(0x5b3a20), uTile: 2, vTile: 2 });
    }
    const z0 = 1.8, z1 = 6.9, ys = TOP + 1.95;
    const zs = [z0, z0 + 0.12, z0 + 0.5, z0 + 1.6, z0 + 3.4, z1 - 0.5, z1 - 0.15, z1 - 0.02, z1];
    const rr = [0.01, 0.34, 0.4, 0.38, 0.33, 0.3, 0.38, 0.38, 0.01];
    IR.tube(zs.map((z) => new V3(lx, ys, z)), (i) => rr[i], { seg: 12, colFn: (i) => new THREE.Color(i === 6 || i === 7 ? 0x555b66 : 0x30343c), uTile: 4, vTile: 4 });
    ctx.col.cap(lx, ys, z0 + 0.3, lx, ys, z1 - 0.1, 0.34, 'metal');
  }

  // ---- gate: broken door leaves and rubble ----
  const leaf = (px, py, pz, sx, sy, sz, rotAxis, ang, color) => {
    const m = new THREE.Matrix4().compose(new V3(px, py, pz), new THREE.Quaternion().setFromAxisAngle(rotAxis, ang), new V3(1, 1, 1));
    WD.setTransform(m);
    WD.box(0, 0, 0, sx, sy, sz, { color, uTile: 1.4, vTile: 1.4, vBase: -sy / 2, grad: [0.8, 1], faces: 'xXzZyY' });
    // iron straps
    for (const yy of [-sy * 0.3, sy * 0.3]) IR.setTransform(m), IR.box(0, yy, 0, sx + 0.06, 0.45, sz + 0.12, { color: 0x2f3238, faces: 'xXzZy' });
    WD.setTransform(null); IR.setTransform(null);
    const q = new THREE.Quaternion().setFromAxisAngle(rotAxis, ang);
    ctx.col.box(px, py, pz, sx / 2, sy / 2, sz / 2, 'wood', q);
  };
  // fallen door lying outside the gate and a broken one leaning on the jamb
  leaf(-3.2, 0.32, 17, 6.2, 0.55, 11.5, new V3(0, 1, 0), 0.25, 0x6b4526);
  leaf(-7.2, 5.6, 4.3, 0.55, 11, 1.7, new V3(0, 0, 1), -0.16, 0x5f3e22);

  const rocks = [];
  for (let i = 0; i < 26; i++) {
    const side = rng.sign(), edge = rng.chance(0.7);
    const x = edge ? side * rng.range(GATE_W - 1, GATE_W + 9) : rng.range(-GATE_W + 1.5, GATE_W - 1.5);
    const z = edge ? rng.range(-16, 22) : rng.range(-5, 18);
    const r = rng.range(0.6, edge ? 2.0 : 1.1);
    rocks.push([x, z, r]);
  }
  for (const [x, z, r] of rocks) {
    addRock(RB, x, r * 0.35, z, r, rng, { color: 0xa39b8c, mossy: false });
    ctx.col.sph(x, r * 0.35 + 0.0, z, r * 0.78, 'stone');
  }

  // ---- flags on the wall top ----
  ctx.flag('garrison', -GATE_W + 1.5, TOP, 0, { h: 11, s: 1.5, yaw: 0 });
  ctx.flag('garrison', GATE_W - 1.5, TOP, 0, { h: 11, s: 1.5, yaw: Math.PI * 0.0 });
  for (let k = 1; k <= 14; k++) for (const sx of [-1, 1]) ctx.flag('garrison', sx * (80 + (k - 1) * 80), TOP, -3.8, { h: 8, s: 1.0, yaw: 0 });

  // ---- supply depots on the wall top ----
  const depotB = { planks: new Builder(), iron: IR };
  makeDepot(ctx, depotB, -40, TOP, 0, 0, { radius: 7.5 });
  makeDepot(ctx, depotB, 40, TOP, 0, 0, { radius: 7.5 });

  // ---- meshes ----
  const stoneMesh = ctx.add(new THREE.Mesh(S.toGeometry(), ctx.mat.stone)); stoneMesh.name = 'wall';
  const pavMesh = ctx.add(new THREE.Mesh(PV.toGeometry(), ctx.mat.paving), false, true); pavMesh.name = 'wallTop';
  const wd = new Builder(); wd.pos = WD.pos; wd.nor = WD.nor; wd.uv = WD.uv; wd.col = WD.col;
  const wdMesh = ctx.add(new THREE.Mesh(WD.toGeometry(), ctx.mat.planks)); wdMesh.name = 'wallWood';
  const dpMesh = ctx.add(new THREE.Mesh(depotB.planks.toGeometry(), ctx.mat.planks)); dpMesh.name = 'wallDepotWood';
  const irMesh = ctx.add(new THREE.Mesh(IR.toGeometry(), ctx.mat.plain)); irMesh.name = 'wallIron';
  const rbMesh = ctx.add(new THREE.Mesh(RB.toGeometry(), ctx.mat.plain)); rbMesh.name = 'gateRubble';
  return { stoneMesh };
}
