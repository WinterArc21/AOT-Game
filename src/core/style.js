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

/**
 * Cel-shaded material. opts are passed to MeshToonMaterial (map, emissive, side, transparent...).
 * opts.rim = true adds the character rim light (see addRim): use it for soldiers and titans only, never for
 * terrain / walls / buildings / trees.
 */
export function toonMaterial(color, opts = {}) {
  const { rim, ...o } = opts;
  const m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...o });
  return rim ? addRim(m) : m;
}

/** Global rim controls (shared by every rim material): strength 0 turns the rim off. */
export const rimUniforms = { uRimStrength: { value: 1 } };

// Anime character rim: a crisp stepped edge band (view-grazing normals). On the side facing the sun it is a warm,
// bright sunlit edge (wider when the sun is behind the character, the classic back-lit anime outline); on the shade
// side a thinner, cool sky-blue edge. Runs after the lighting (and after any other onBeforeCompile edits).
const RIM_GLSL = `
  #if NUM_DIR_LIGHTS > 0
  {
    vec3 rimN = normalize( geometryNormal ), rimV = normalize( geometryViewDir ), rimL = directionalLights[ 0 ].direction;
    float rimF = 1.0 - clamp( dot( rimN, rimV ), 0.0, 1.0 );
    float rimNL = dot( rimN, rimL );
    float rimBack = clamp( -dot( rimV, rimL ), 0.0, 1.0 );          // sun behind the subject
    float rimSun = smoothstep( -0.05, 0.12, rimNL );
    float rimW = mix( 0.2, 0.3, rimSun ) + 0.14 * rimBack * rimSun;  // band width (in 1 - N.V)
    float rimBand = smoothstep( 1.0 - rimW - 0.025, 1.0 - rimW + 0.025, rimF );
    vec3 rimWarm = vec3( 1.0, 0.88, 0.68 ) * ( 0.75 + 0.45 * rimBack );
    vec3 rimCool = vec3( 0.5, 0.68, 1.0 ) * 0.3;
    vec3 rimCol = mix( rimCool, rimWarm, rimSun ) * ( 0.55 + 0.45 * diffuseColor.rgb );
    outgoingLight += rimCol * rimBand * uRimStrength;
  }
  #endif
  #include <opaque_fragment>`;
function rimCompile(sh) {
  sh.uniforms.uRimStrength = rimUniforms.uRimStrength;
  sh.fragmentShader = 'uniform float uRimStrength;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', RIM_GLSL);
}

/**
 * Adds the character rim light to a MeshToonMaterial. Composes with onBeforeCompile / customProgramCacheKey that
 * are assigned later (the rim edit runs after them), so a material can opt in at creation time and still be
 * customised by its owner afterwards.
 */
export function addRim(m) {
  let userCompile = m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile ? m.onBeforeCompile : null;
  let userKey = null;
  const compile = function (sh, r) { if (userCompile) userCompile.call(this, sh, r); rimCompile(sh); };
  const key = function () { return (userKey ? userKey.call(this) : userCompile ? userCompile.toString() : '') + '|rim-v1'; };
  Object.defineProperty(m, 'onBeforeCompile', { get: () => compile, set: (f) => { userCompile = f; }, configurable: true });
  Object.defineProperty(m, 'customProgramCacheKey', { get: () => key, set: (f) => { userKey = f; }, configurable: true });
  m.userData.rim = true;
  return m;
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
