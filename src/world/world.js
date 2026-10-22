// WINGS OF FREEDOM - world builder. buildWorld(game) -> { playerSpawn, supplyDepots, titanSpawns, sun, update }
import * as THREE from 'three';
import { createContext, SUN_DIR, FOG_COLOR } from './common.js';
import { buildSky } from './sky.js';
import { buildGround } from './terrain.js';
import { buildWall } from './wall.js';
import { buildTown } from './town.js';
import { buildField } from './field.js';
import { buildForest } from './forest.js';
import { buildFlags } from './flags.js';
import { foliageFade } from './trees.js';
import { buildGrass, paintGroundMaterial } from './grass.js';

// Atmospheres for the modes and missions (world.setAtmosphere). sky: dome horizon / mid / zenith; fog: colour, near,
// far; sun and hemi: light colours and strengths; tint: multiplies the mountains and clouds; canopy: tints the green
// haze under the forest canopy.
const ATMOS = {
  day: { sky: [FOG_COLOR, 0x6fb4f2, 0x1f63d0], fog: [FOG_COLOR, 120, 1400], sun: [0xfff1d2, 2.6], hemi: [0xcfe6ff, 0x7a9a5a, 1.55], tint: 0xffffff, canopy: 0xffffff },
  // Trost under attack: a smoke-hazed amber afternoon, the light thick and warm, the far town lost in haze
  trost: { sky: [0xd8b08a, 0xb39684, 0x5f6f8c], fog: [0xc8a383, 70, 950], sun: [0xffc58a, 2.25], hemi: [0xf2d2b0, 0x6b5a46, 1.3], tint: 0xd6b496, canopy: 0xd8c0a0 },
  // the 57th Expedition rides out in the early morning: low golden light, a pale sky, a long soft haze
  dawn: { sky: [0xf7c79a, 0xcfc4cf, 0x5b7db5], fog: [0xead0b4, 90, 1200], sun: [0xffc88a, 2.35], hemi: [0xf2dcc6, 0x6d7650, 1.3], tint: 0xf6d8b8, canopy: 0xf2e4cc },
};

export function buildWorld(game) {
  const ctx = createContext(game);
  ctx.atmo = { fog: new THREE.Color(FOG_COLOR), near: 120, far: 1400, canopy: new THREE.Color(1, 1, 1) };
  const scene = game.scene;

  // ---- lights ----
  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x7a9a5a, 1.55);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1d2, 2.6);
  sun.position.copy(SUN_DIR).multiplyScalar(320);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -120; sc.right = 120; sc.top = 120; sc.bottom = -120; sc.near = 20; sc.far = 800;
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.06;
  scene.add(sun, sun.target);

  const skyRefs = buildSky(ctx);
  buildGround(ctx);
  paintGroundMaterial(ctx.mat.grass);
  const grass = buildGrass(ctx);
  buildWall(ctx);
  buildTown(ctx);
  buildField(ctx);
  const forest = buildForest(ctx);
  buildFlags(ctx);

  const world = {
    playerSpawn: { position: new THREE.Vector3(0, 50.6, 0), yaw: 0 },   // wall-top surface (y = 50) + 0.6
    supplyDepots: ctx.depots,
    titanSpawns: ctx.titanSpawns,
    sun, hemi, sunDirection: SUN_DIR.clone(), fogColor: new THREE.Color(FOG_COLOR),
    inFoliage: (pos) => ctx.foliage.test(pos),
    /** Thin out leaves between the camera and `pos` (the soldier); null turns it off (menus). */
    setFoliageFocus(pos) { if (pos) foliageFade.focus.value.copy(pos); foliageFade.fade.value = pos ? 1 : 0; },
    stats: Object.assign(ctx.stats, { trees: forest.trees, grassTufts: grass.instances }),
    grass,
    /** Flatten the grass tufts round pos (world) out to radius m; strength 0..1; lasting = slow to spring back. */
    pressGrass: (pos, radius, strength, lasting) => grass.press(pos, radius, strength, lasting),
    /** Sky, fog and light for a mode or a mission: 'day' (default), 'trost', 'dawn'. */
    setAtmosphere(name) {
      const a = ATMOS[name] || ATMOS.day, d = skyRefs.dome;
      if (this.atmosphere === name) return;
      this.atmosphere = name;
      d.cHorizon.value.set(a.sky[0]); d.cMid.value.set(a.sky[1]); d.cZenith.value.set(a.sky[2]);
      ctx.atmo.fog.set(a.fog[0]); ctx.atmo.near = a.fog[1]; ctx.atmo.far = a.fog[2]; ctx.atmo.canopy.set(a.canopy);
      scene.fog.color.copy(ctx.atmo.fog); scene.fog.near = a.fog[1]; scene.fog.far = a.fog[2];
      scene.background.copy(ctx.atmo.fog);
      this.fogColor.copy(ctx.atmo.fog);
      sun.color.set(a.sun[0]); sun.intensity = a.sun[1];
      hemi.color.set(a.hemi[0]); hemi.groundColor.set(a.hemi[1]); hemi.intensity = a.hemi[2];
      skyRefs.tint.set(a.tint);
    },
    update(dt, camPos) {
      ctx.time.value += dt;
      for (const u of ctx.updaters) u(dt, camPos);
    },
  };
  return world;
}
