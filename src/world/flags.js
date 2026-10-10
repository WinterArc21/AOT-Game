// Instanced flag poles + waving flags (vertex-shader animation) for everything registered through ctx.flag().
import * as THREE from 'three';
import { toonMaterial } from '../core/style.js';

export function buildFlags(ctx) {
  const list = ctx.flags;
  if (!list.length) return;
  // poles
  const pg = new THREE.CylinderGeometry(0.07, 0.11, 1, 6); pg.translate(0, 0.5, 0);
  const poleList = list.filter((f) => f.pole);
  const poles = new THREE.InstancedMesh(pg, toonMaterial(0x4a3422), poleList.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  poleList.forEach((f, i) => {
    m.compose(p.set(f.x, f.y, f.z), q.identity(), s.set(1, f.h, 1)); poles.setMatrixAt(i, m);
    ctx.col.cap(f.x, f.y, f.z, f.x, f.y + f.h, f.z, 0.1, 'wood');
  });
  poles.instanceMatrix.needsUpdate = true; poles.name = 'flagPoles';
  ctx.add(poles, true, false);

  for (const kind of ['survey', 'garrison']) {
    const fl = list.filter((f) => f.kind === kind);
    if (!fl.length) continue;
    const g = new THREE.PlaneGeometry(3, 2, 14, 6); g.translate(1.5, -1.05, 0);
    const mesh = new THREE.InstancedMesh(g, ctx.mat.flag(kind), fl.length);
    fl.forEach((f, i) => { q.setFromAxisAngle(up, f.yaw); m.compose(p.set(f.x + 0.1, f.y + f.h - 0.1, f.z), q, s.set(f.s, f.s, f.s)); mesh.setMatrixAt(i, m); });
    mesh.instanceMatrix.needsUpdate = true; mesh.frustumCulled = false; mesh.name = 'flags_' + kind;
    ctx.add(mesh, false, false);
  }
}
