// Inverted-hull outline from a pre-smoothed geometry (hard-edged merged meshes need averaged normals).
import * as THREE from 'three';
import { outlineMaterial } from '../core/style.js';

export function addOutlineGeo(mesh, smoothGeo, thickness = 0.12, color = 0x1a1410) {
  const o = new THREE.Mesh(smoothGeo, outlineMaterial(thickness, color));
  o.castShadow = false; o.receiveShadow = false; o.raycast = () => {};
  mesh.add(o);
  return o;
}
