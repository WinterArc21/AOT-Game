// Shared world-building context: textures, toon materials, collider helper, flag registry, noise.
import * as THREE from 'three';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { toonMaterial } from '../core/style.js';
import * as T from './tex.js';

const V3 = THREE.Vector3, Q = THREE.Quaternion;
const _qy = new Q();
export const UP = new V3(0, 1, 0);

export const SUN_DIR = new V3(-0.55, 0.62, 0.35).normalize();   // direction from the scene towards the sun
export const FOG_COLOR = 0xbcd7ee;

const _noise = new ImprovedNoise();
/** Smooth deterministic noise in [-1,1]. */
export const noise2 = (x, y) => _noise.noise(x, y, 3.7);
export const noise3 = (x, y, z) => _noise.noise(x, y, z);

export function createContext(game) {
  const timeU = { value: 0 };
  const ctx = {
    game, scene: game.scene, time: timeU, flags: [], updaters: [],
    depots: [], titanSpawns: [], stats: { box: 0, cyl: 0, cap: 0, sph: 0 },
  };

  // ---------- textures & materials (lazy) ----------
  const cache = {};
  const lazy = (k, fn) => () => (cache[k] ??= fn());
  const tex = {
    stone: lazy('stone', T.makeWallStone), paving: lazy('paving', T.makePaving), hq: lazy('hq', T.makeHQStone),
    cobbles: lazy('cobbles', T.makeCobbles), dirt: lazy('dirt', T.makeDirt), grass: lazy('grass', T.makeGrass),
    bark: lazy('bark', T.makeBark), clay: lazy('clay', () => T.makeRoof('clay')), slate: lazy('slate', () => T.makeRoof('slate')),
    plaster0: lazy('p0', () => T.makePlaster(0, '#3f7a52')), plaster1: lazy('p1', () => T.makePlaster(1, '#3d6aa8')),
    planks: lazy('planks', T.makePlanks), hqwall: lazy('hqwall', T.makeHQWall), rock: lazy('rock', T.makeRockTex),
    flagSurvey: lazy('fs', () => T.makeFlag('survey')), flagGarrison: lazy('fg', () => T.makeFlag('garrison')),
  };
  const mcache = {};
  const mat = (k, fn) => (mcache[k] ??= fn());
  ctx.mat = {
    get stone() { return mat('stone', () => toonMaterial(0xffffff, { map: tex.stone(), vertexColors: true })); },
    get paving() { return mat('paving', () => toonMaterial(0xffffff, { map: tex.paving(), vertexColors: true })); },
    get hq() { return mat('hq', () => toonMaterial(0xffffff, { map: tex.hq(), vertexColors: true })); },
    get hqwall() { return mat('hqwall', () => toonMaterial(0xffffff, { map: tex.hqwall(), vertexColors: true })); },
    get cobbles() { return mat('cobbles', () => toonMaterial(0xffffff, { map: tex.cobbles(), vertexColors: true })); },
    get dirt() { return mat('dirt', () => toonMaterial(0xffffff, { map: tex.dirt(), vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); },
    get grass() { return mat('grass', () => toonMaterial(0xffffff, { map: tex.grass(), vertexColors: true })); },
    get bark() { return mat('bark', () => toonMaterial(0xffffff, { map: tex.bark(), vertexColors: true })); },
    get clay() { return mat('clay', () => toonMaterial(0xffffff, { map: tex.clay(), vertexColors: true, side: THREE.DoubleSide })); },
    get slate() { return mat('slate', () => toonMaterial(0xffffff, { map: tex.slate(), vertexColors: true, side: THREE.DoubleSide })); },
    get plaster0() { return mat('p0', () => toonMaterial(0xffffff, { map: tex.plaster0(), vertexColors: true })); },
    get plaster1() { return mat('p1', () => toonMaterial(0xffffff, { map: tex.plaster1(), vertexColors: true })); },
    get planks() { return mat('planks', () => toonMaterial(0xffffff, { map: tex.planks(), vertexColors: true })); },
    get plain() { return mat('plain', () => toonMaterial(0xffffff, { vertexColors: true })); },
    get rock() { return mat('rock', () => toonMaterial(0xffffff, { map: tex.rock(), vertexColors: true })); },
    get foliage() { return mat('foliage', () => toonMaterial(0xffffff)); },
    flag(kind) {
      return mat('flag' + kind, () => {
        const m = toonMaterial(0xffffff, { map: kind === 'survey' ? tex.flagSurvey() : tex.flagGarrison(), side: THREE.DoubleSide });
        m.onBeforeCompile = (sh) => {
          sh.uniforms.uTime = timeU;
          sh.vertexShader = 'uniform float uTime;\nvarying float vShade;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
            vec3 transformed = vec3( position );
            #ifdef USE_INSTANCING
              float ph = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.17;
            #else
              float ph = 0.0;
            #endif
            float k = clamp( position.x / 3.0, 0.0, 1.0 );
            float a = position.x * 2.4 - uTime * 5.5 + ph;
            transformed.z += ( sin( a ) * 0.34 + sin( position.x * 4.7 - uTime * 9.0 + ph * 1.7 + position.y * 1.9 ) * 0.1 ) * k;
            transformed.y += sin( position.x * 1.7 - uTime * 4.0 + ph ) * 0.07 * k;
            vShade = 0.86 + cos( a ) * 0.2 * k;`);
          sh.fragmentShader = 'varying float vShade;\n' + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb *= vShade;');
        };
        m.customProgramCacheKey = () => 'flagwave';
        return m;
      });
    },
    plainColor(hex, opts = {}) { return mat('pc' + hex + JSON.stringify(opts), () => toonMaterial(hex, opts)); },
  };

  // ---------- colliders ----------
  const col = game.collision;
  const S = ctx.stats;
  ctx.col = {
    /** axis-aligned or rotated box, centre + half extents. */
    box(cx, cy, cz, hx, hy, hz, material = 'stone', quaternion = null, hookable = true) {
      S.box++;
      return col.addBox({ center: new V3(cx, cy, cz), halfExtents: new V3(hx, hy, hz), quaternion: quaternion || undefined, material, hookable });
    },
    cyl(x, z, y0, y1, radius, material = 'bark', hookable = true) {
      S.cyl++;
      return col.addCylinder({ x, z, y0, y1, radius, material, hookable });
    },
    cap(ax, ay, az, bx, by, bz, radius, material = 'bark', hookable = true) {
      S.cap++;
      return col.addCapsule({ a: new V3(ax, ay, az), b: new V3(bx, by, bz), radius, material, hookable });
    },
    sph(cx, cy, cz, radius, material = 'stone', hookable = true) {
      S.sph++;
      return col.addSphere({ center: new V3(cx, cy, cz), radius, material, hookable });
    },
  };

  // ---------- foliage index (canopy blobs are collider-free; the core asks inFoliage(pos) to spawn leaves) ----------
  const FC = 24, fmap = new Map();
  ctx.foliage = {
    add(x, y, z, rx, ry, rz) {
      const b = { x, y, z, ix: 1 / (rx * 0.92), iy: 1 / (ry * 0.92), iz: 1 / (rz * 0.92) };
      const r = Math.max(rx, rz);
      for (let i = Math.floor((x - r) / FC); i <= Math.floor((x + r) / FC); i++) for (let k = Math.floor((z - r) / FC); k <= Math.floor((z + r) / FC); k++) {
        const key = i * 73856093 ^ k * 19349663; let a = fmap.get(key); if (!a) fmap.set(key, a = []); a.push(b);
      }
    },
    test(p) {
      const a = fmap.get(Math.floor(p.x / FC) * 73856093 ^ Math.floor(p.z / FC) * 19349663);
      if (!a) return false;
      for (const b of a) { const dx = (p.x - b.x) * b.ix, dy = (p.y - b.y) * b.iy, dz = (p.z - b.z) * b.iz; if (dx * dx + dy * dy + dz * dz < 1) return true; }
      return false;
    },
  };

  /** Add a mesh to the scene with shadow flags. */
  ctx.add = (obj, cast = true, receive = true) => {
    obj.castShadow = cast; obj.receiveShadow = receive;
    ctx.scene.add(obj);
    return obj;
  };
  ctx.flag = (kind, x, y, z, o = {}) => ctx.flags.push({ kind, x, y, z, yaw: o.yaw ?? 0, h: o.h ?? 7, s: o.s ?? 1, pole: o.pole ?? true });
  return ctx;
}

/** Yaw (about Y) quaternion helper. */
export function qYaw(a, out = new Q()) { return out.setFromAxisAngle(UP, a); }
export function qAxis(ax, ay, az, ang, out = new Q()) { return out.setFromAxisAngle(_tmpAx.set(ax, ay, az), ang); }
const _tmpAx = new V3();
