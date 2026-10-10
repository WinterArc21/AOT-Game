// Ground: gentle hills in the field/forest (flat near the wall and in town), painted grass, dirt road, cobbled town floor.
import * as THREE from 'three';
import { Builder } from './geo.js';
import { noise2 } from './common.js';
import { smoothstep, clamp } from './rng.js';

/** Terrain height. Flat for z < 30 (wall, gate yard, town); rolling hills (+-3 m) beyond. */
export function groundHeight(x, z) {
  const t = smoothstep(30, 75, z);
  if (t <= 0) return 0;
  const h = noise2(x * 0.011, z * 0.011) * 2.1 + noise2(x * 0.027 + 11.3, z * 0.027) * 0.8 + noise2(x * 0.07, z * 0.07 + 5.1) * 0.25;
  return h * t;
}

export const roadX = (z) => 20 * Math.sin(z / 62) * smoothstep(18, 70, z);

const cB = new THREE.Color();
const FIELD = new THREE.Color(0xe8ffd0), FIELD_DRY = new THREE.Color(0xfff2b0), FOREST = new THREE.Color(0x4d9a5a), FOREST_DARK = new THREE.Color(0x2f7a4a), TOWNOUT = new THREE.Color(0xdff5b8);
export function groundTint(x, z, out = new THREE.Color()) {
  const n = noise2(x * 0.02 + 3, z * 0.02 - 4), n2 = noise2(x * 0.06, z * 0.06);
  const forest = smoothstep(150, 250, z) * (1 - smoothstep(700, 860, Math.abs(x))) * (1 - smoothstep(1050, 1250, z));
  if (z < 0) out.copy(TOWNOUT).multiplyScalar(0.92 + n * 0.1);
  else {
    out.copy(FIELD).lerp(FIELD_DRY, clamp(n * 0.9 + 0.1, 0, 1) * 0.55);
    out.multiplyScalar(0.92 + n2 * 0.08);
    cB.copy(FOREST).lerp(FOREST_DARK, clamp(0.5 + n * 0.9, 0, 1)).multiplyScalar(0.92 + n2 * 0.1);
    out.lerp(cB, forest);
  }
  return out;
}

export function buildGround(ctx) {
  ctx.game.collision.setGround(groundHeight);

  // irregular grid: fine where the hills are
  const xs = [-1700, -1400, -1250];
  for (let x = -1100; x <= 1100; x += 11) xs.push(x);
  xs.push(1250, 1400, 1700);
  const zs = [-1000, -520, -200, -40, 0, 30];
  for (let z = 40; z <= 1100; z += 10) zs.push(z);
  zs.push(1250, 1500, 1800);
  const nx = xs.length, nz = zs.length;
  const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
  const c = new THREE.Color();
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const k = i * nz + j, x = xs[i], z = zs[j];
    pos[k * 3] = x; pos[k * 3 + 1] = groundHeight(x, z); pos[k * 3 + 2] = z;
    groundTint(x, z, c); col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    uv[k * 2] = x / 8; uv[k * 2 + 1] = z / 8;
  }
  const idx = [];
  for (let i = 0; i < nx - 1; i++) for (let j = 0; j < nz - 1; j++) {
    const a = i * nz + j, b = (i + 1) * nz + j, d = i * nz + j + 1, e = (i + 1) * nz + j + 1;
    idx.push(a, d, b, b, d, e);   // normal +y
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const ground = new THREE.Mesh(g, ctx.mat.grass);
  ground.name = 'ground'; ctx.add(ground, false, true);

  // dirt road from the gate across the field to the forest
  const b = new Builder();
  const rc = new THREE.Color(1, 1, 1);
  for (let z0 = 6; z0 < 215; z0 += 3) {
    const z1 = z0 + 3, x0 = roadX(z0), x1 = roadX(z1);
    const w0 = 4.6 + noise2(z0 * 0.1, 1) * 0.6, w1 = 4.6 + noise2(z1 * 0.1, 1) * 0.6;
    const y = (x, z) => groundHeight(x, z) + 0.07;
    const L0 = [x0 - w0, y(x0 - w0, z0), z0], R0 = [x0 + w0, y(x0 + w0, z0), z0], R1 = [x1 + w1, y(x1 + w1, z1), z1], L1 = [x1 - w1, y(x1 - w1, z1), z1];
    b.quad([L0, L1, R1, R0], [[0, z0 / 4], [0, z1 / 4], [2.3, z1 / 4], [2.3, z0 / 4]], rc);
  }
  const rm = new THREE.Mesh(b.toGeometry(), ctx.mat.dirt);
  rm.name = 'road'; ctx.add(rm, false, true);

  // cobbled floor of the whole Trost district (plus the gate yard)
  const f = new Builder();
  const x0 = -372, x1 = 372, z0 = -468, z1 = -6;
  f.quad([[x0, 0.04, z1], [x1, 0.04, z1], [x1, 0.04, z0], [x0, 0.04, z0]], [[x0 / 4, -z1 / 4], [x1 / 4, -z1 / 4], [x1 / 4, -z0 / 4], [x0 / 4, -z0 / 4]], new THREE.Color(1, 1, 1));
  const floor = new THREE.Mesh(f.toGeometry(), ctx.mat.cobbles);
  floor.name = 'townFloor'; ctx.add(floor, false, true);
  return { ground };
}
