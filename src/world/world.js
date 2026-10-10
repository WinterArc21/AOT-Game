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

export function buildWorld(game) {
  const ctx = createContext(game);
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

  buildSky(ctx);
  buildGround(ctx);
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
    stats: Object.assign(ctx.stats, { trees: forest.trees }),
    update(dt, camPos) {
      ctx.time.value += dt;
      for (const u of ctx.updaters) u(dt, camPos);
    },
  };
  return world;
}
