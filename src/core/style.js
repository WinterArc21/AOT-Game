// Shared anime look: cel-shading ramp, toon materials and inverted-hull outlines.
import * as THREE from 'three';

let _ramp = null;
/** 4-step light ramp used by every MeshToonMaterial (hard anime shadow terminator). */
export function toonGradient() {
  if (_ramp) return _ramp;
  const data = new Uint8Array([70, 70, 70, 255, 150, 150, 150, 255, 215, 215, 215, 255, 255, 255, 255, 255]);
  _ramp = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  _ramp.minFilter = _ramp.magFilter = THREE.NearestFilter;
  _ramp.generateMipmaps = false;
  _ramp.needsUpdate = true;
  return _ramp;
}

/** Cel-shaded material. opts are passed to MeshToonMaterial (map, emissive, side, transparent...). */
export function toonMaterial(color, opts = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...opts });
}

const _outlineCache = new Map();
/**
 * Inverted-hull outline material: back faces pushed out along normals, flat dark colour.
 * thickness is in world metres (scaled with the object). Works for Mesh and InstancedMesh.
 */
export function outlineMaterial(thickness = 0.03, color = 0x1a1410) {
  const key = thickness + ':' + color;
  if (_outlineCache.has(key)) return _outlineCache.get(key);
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, fog: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uOutline = { value: thickness };
    sh.vertexShader = 'uniform float uOutline;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      'vec3 transformed = vec3( position ) + normalize( normal ) * uOutline;'
    );
  };
  m.customProgramCacheKey = () => 'outline' + thickness;
  _outlineCache.set(key, m);
  return m;
}

/** Adds an outline hull child to a Mesh (shares geometry). Returns the outline mesh. */
export function addOutline(mesh, thickness = 0.03, color = 0x1a1410) {
  let o;
  if (mesh.isInstancedMesh) {
    o = new THREE.InstancedMesh(mesh.geometry, outlineMaterial(thickness, color), mesh.count);
    o.instanceMatrix = mesh.instanceMatrix;
  } else {
    o = new THREE.Mesh(mesh.geometry, outlineMaterial(thickness, color));
  }
  o.castShadow = false;
  o.receiveShadow = false;
  o.raycast = () => {};
  mesh.add(o);
  return o;
}
