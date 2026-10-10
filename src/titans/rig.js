// Builds the joint hierarchy + meshes for one titan from a shared archetype, and describes its hit/collider shapes.
import * as THREE from 'three';
import { outlineMaterial } from '../core/style.js';

const V3 = THREE.Vector3;

/** world outline thickness is thickness*scale, so tune per size class (local units). */
const OUTLINE = { S: 0.075, M: 0.06, L: 0.052, XL: 0.045 };

/**
 * @returns { root, J (joints by name), meshes: [{mesh, outline, joint, key}], shapes: [...], scale }
 * shapes: { part, joint, type: 'capsule'|'sphere'|'box', a, b, r, c, h, collide: bool, group }
 */
export function buildRig(arch, height) {
  const d = arch.dims, geo = arch.geo, mat = arch.material;
  const root = new THREE.Group();
  root.name = 'titan';
  const J = {};
  const mk = (name, parent, x, y, z) => {
    const g = new THREE.Object3D(); g.name = name; g.position.set(x, y, z); parent.add(g); J[name] = g; return g;
  };
  mk('pelvis', root, 0, d.hipY, 0);
  mk('spine', J.pelvis, 0, d.spineY, 0);
  mk('neck', J.spine, 0, d.neckY, 0.05);
  mk('head', J.neck, 0, d.neckLen, 0.05);
  mk('jaw', J.head, d.jawPivot.x, d.jawPivot.y, d.jawPivot.z);
  for (const [n, s] of [['L', 1], ['R', -1]]) {
    mk('arm' + n, J.spine, s * d.shoulderX, d.shoulderY, 0);
    mk('fore' + n, J['arm' + n], 0, -d.upperLen, 0);
    mk('hand' + n, J['fore' + n], 0, -d.foreLen, 0);
    mk('thigh' + n, J.pelvis, s * d.hipX, -0.05, 0);
    mk('shin' + n, J['thigh' + n], 0, -d.thighLen, 0);
    mk('foot' + n, J['shin' + n], 0, -d.shinLen, 0);
  }
  const ot = OUTLINE[d.size];
  const olMat = outlineMaterial(ot);
  const meshes = [];
  const attach = (joint, g, key, pos) => {
    const m = new THREE.Mesh(g.full, mat);
    m.castShadow = true; m.receiveShadow = true; m.name = key;
    if (pos) m.position.copy(pos);
    joint.add(m);
    const o = new THREE.Mesh(g.outline, olMat);
    o.castShadow = false; o.receiveShadow = false; o.raycast = () => {};
    m.add(o);
    meshes.push({ mesh: m, outline: o, joint, key });
    return m;
  };
  attach(J.pelvis, geo.pelvis, 'pelvis');
  attach(J.spine, geo.spine, 'spine');
  attach(J.head, geo.head, 'head');
  attach(J.jaw, geo.jaw, 'jaw');
  attach(J.armL, geo.arm, 'armL'); attach(J.armR, geo.arm, 'armR');
  attach(J.foreL, geo.foreL, 'foreL'); attach(J.foreR, geo.foreR, 'foreR');
  attach(J.thighL, geo.thigh, 'thighL'); attach(J.thighR, geo.thigh, 'thighR');
  attach(J.shinL, geo.shin, 'shinL'); attach(J.shinR, geo.shin, 'shinR');
  attach(J.footL, geo.foot, 'footL'); attach(J.footR, geo.foot, 'footR');
  // jaw hinge: geometry is built in jaw-local space already (origin = hinge)

  const scale = height / d.total;
  root.scale.setScalar(scale);

  // ------------------------------------------------------------------ hit / collider shapes (joint-local, unscaled units)
  const lm = d.limb, tw = d.B.torsoW, th = d.B.torsoH, R = d.headR;
  const shapes = [];
  const cap = (part, joint, a, b, r, group, collide = true) => shapes.push({ part, joint, type: 'capsule', a: new V3(...a), b: new V3(...b), r, collide, group });
  const sph = (part, joint, c, r, group, collide = true) => shapes.push({ part, joint, type: 'sphere', c: new V3(...c), r, collide, group });
  const box = (part, joint, c, h, group, collide = true) => shapes.push({ part, joint, type: 'box', c: new V3(...c), h: new V3(...h), collide, group });

  // body
  sph('head', J.head, [0, d.cy, d.cz + 0.02], R * 0.98 * Math.max(d.B.faceW, 0.9), 'body');
  box('torso', J.spine, [0, 1.45 * th, 0], [1.15 * tw, 1.5 * th, 0.82], 'body');
  box('pelvis', J.pelvis, [0, 0.2, 0], [0.88 * tw, 0.62, 0.66 + 0.4 * d.B.belly], 'body');
  for (const n of ['L', 'R']) {
    cap('arm', J['arm' + n], [0, 0, 0], [0, -d.upperLen, 0], 0.5 * lm + 0.05, 'arm');
    cap('arm', J['fore' + n], [0, 0, 0], [0, -d.foreLen + 0.5 * d.handS, 0], 0.4 * lm + 0.05, 'arm');
    sph('hand', J['hand' + n], [0, -0.05, 0], 0.5 * d.handS + 0.1, 'hand');
    cap('leg', J['thigh' + n], [0, 0, 0], [0, -d.thighLen, 0], 0.62 * lm + 0.04, 'body');
    cap('leg', J['shin' + n], [0, 0, 0], [0, -d.shinLen, 0], 0.4 * lm + 0.03, 'body');
    cap('foot', J['foot' + n], [0, -0.1, 0.12], [0, -0.1, 0.9], 0.27 * Math.sqrt(lm) + 0.1, 'body');
    // hit-test-only extras
    sph('ankle', J['foot' + n], [0, 0.1, -0.05], 0.4 + 0.1 * lm, 'ankle', false);
  }
  // eyes (hit-test only)
  const eyeX = 0.43 * d.rx, eyeY = d.cy + 0.1 * R * d.B.faceH;
  const eyeZ = d.cz + d.rz * Math.sqrt(Math.max(0.04, 1 - (eyeX / d.rx) ** 2 - ((eyeY - d.cy) / d.ry) ** 2));
  for (const s of [-1, 1]) sph('eye', J.head, [s * eyeX, eyeY, eyeZ], Math.max(0.3, arch.st.eye * R * 1.5), 'eye', false);
  // nape (hit-test only): scale generosity for small titans
  const gen = 1 + 0.6 * (1 - Math.min(1, height / 10));
  const nh = d.napeHalf.clone().multiplyScalar(gen * (d.size === 'XL' ? 1.15 : 1));
  shapes.push({ part: 'nape', joint: J.head, type: 'box', c: d.napeC.clone(), h: nh, collide: false, group: 'nape' });

  return { root, J, meshes, shapes, scale, outlineThickness: ot };
}
