# WINGS OF FREEDOM — architecture contract

Browser game, Three.js r180 (vendored at `aot/vendor/three.module.min.js`, plus `aot/vendor/addons/utils/BufferGeometryUtils.js` and `addons/math/{SimplexNoise,ImprovedNoise}.js`, imported as `three/addons/...`), plain ES modules, no build step for dev.
Every module does `import * as THREE from 'three';` — pages map it with an import map:

```html
<script type="importmap">{ "imports": { "three": "../vendor/three.module.min.js", "three/addons/": "../vendor/addons/" } }</script>
```
(path relative to the page; `aot/index.html` uses `./vendor/three.module.min.js`, pages in `aot/dev/` use `../vendor/...`).

Serve the repo root (`npx http-server . -p 8080 -c-1`) and open `/aot/`.
Headless check: `node aot/tools/shot.mjs aot/dev/<page>.html /path/out.png 6000 1280x720` (prints page errors, saves PNG).

## Units and world layout

Metres, seconds, Y up, right-handed (Three.js default). Player is 1.7 m tall.

```
                       z = +1000  (far edge of the Forest of Giant Trees)
   FOREST OF GIANT TREES   x ∈ [-700, 700], z ∈ [180, 1000]   trunks r 2.5–5 m, 70–110 m tall,
                           big horizontal branches from ~20 m up, canopy clusters at the top
   OPEN FIELD              z ∈ [6, 180]  (gentle hills, ±3 m, a few lone trees, rocks, ruined cart)
 ======================== WALL ROSE: z ∈ [-6, 6], x ∈ [-1200, 1200], top at y = 50 =================
   gate (breached) at x ∈ [-8, 8], open passage y ∈ [0, 20] -> titans walk through into the town
   TROST DISTRICT (town)   x ∈ [-350, 350], z ∈ [-450, -15]: streets, 2–5 storey houses (8–22 m),
                           pitched roofs, a church spire (~45 m), a bell tower, the garrison HQ
                       z = -700
```
Ground height ≈ 0 (`collision.groundHeight(x,z)`), flat in town and within 30 m of the wall.
Playable bounds |x| < 1100, z ∈ [-650, 1050]. Player spawns on the wall top at (0, 50.2, 0) facing +z.

## Timing

`main.js` runs physics at a fixed 120 Hz for the player; everything else gets `update(dt)` once per rendered
frame with variable `dt` (clamped to ≤ 1/20 s). Call order per frame:
`input → player physics (n fixed steps) → titans.update → collision.updateDynamic → fx/model/world update → hud → render`.

## The shared `game` object (built in `src/main.js`)

```js
game = {
  scene, camera, renderer,         // THREE objects
  collision,                       // CollisionWorld   (src/core/collision.js)
  player,                          // Player           (src/player/player.js)
  titans,                          // TitanManager     (src/titans/titans.js)
  fx,                              // Effects          (src/fx/effects.js)
  audio,                           // Audio            (src/audio/audio.js)
  hud,                             // Hud              (src/ui/hud.js)
  world,                           // result of buildWorld(game) (src/world/world.js)
  events,                          // { on(name, fn), off(name, fn), emit(name, payload) }
  time,                            // seconds since start (game time)
  mode,                            // 'menu' | 'expedition' | 'training' | 'free'
  training, trainingActive,        // TrainingCourse (src/titans/dummies.js) and whether it is live
  targetList(),                    // every cuttable thing: live titans + (in training) dummies
  hitTest(center, radius),         // merged hit test over titans and dummies: [{ titan, part, point }]
  allies,                          // AI comrades (src/player/ally.js) on the same ODM physics
  flow,                            // Game (src/game.js): modes, waves, tutorial hints, timers
  hitstop, slowmo,                 // seconds of kill freeze-frame / slow motion
}
```

Controls (keyboard first; `src/player/player.js` `handleInput`): ← → turn (swing on a rope), ↑ / ↓ run / brake
(↓ on a rope pays the wire out), Z / X hold the left / right rope at its auto-target (`player.targets[0|1]`,
rescanned one side per frame by `Player._scan`), Shift gas (tap on the ground = jump), Space cut (primed while
swooping), Esc / P pause, H controls card, M mute. WASD mirror the arrows; the mouse is optional.

Cuttable things share one duck type: `{ kind, alive, height, position, velocity?, root, napeWorld(),
applyHit({ part, damage, point, dir }), anchors?(out[]) -> Vector3[], threat? (0..1) }`. Their colliders carry
`userData.titan` (dummies also `userData.dummy`), which is how ropes know they are on a titan (no arrival
brake, the nape swoop, other ropes go slack).

## CollisionWorld — `src/core/collision.js` (owner: core)

Shapes. Every `add*` returns a collider object `{ id, type, material, hookable, dynamic, userData, ... }`.
```js
col.addBox({ center: Vector3, halfExtents: Vector3, quaternion?: Quaternion, material, hookable = true, userData })
col.addCylinder({ x, z, y0, y1, radius, material, hookable = true, userData })     // vertical: trunks, towers
col.addCapsule({ a: Vector3, b: Vector3, radius, material, hookable = true, userData }) // branches, beams
col.addSphere({ center: Vector3, radius, material, hookable = true, userData })
col.setGround(fnHeight(x, z) -> y)                 // terrain; collision.groundHeight(x, z) evaluates it
col.remove(collider)
```
`material` ∈ `'stone' | 'wood' | 'bark' | 'roof' | 'flesh' | 'metal' | 'ground'` (drives sparks / sounds).

Dynamic colliders (titan body parts) are defined in the LOCAL space of an `Object3D` and follow its `matrixWorld`:
```js
col.addCapsule({ a: localA, b: localB, radius, object3D: forearmGroup, dynamic: true, material: 'flesh',
                 userData: { titan, part: 'arm' } })
col.addSphere({ center: localC, radius, object3D: headGroup, dynamic: true, ... })
col.addBox({ center: localC, halfExtents, object3D: neckGroup, dynamic: true, ... })
```
Radius / extents are scaled by the object's world scale (assume uniform scale). The core calls
`col.updateDynamic()` every frame after the titans update (it reads `matrixWorld`, so call
`object.updateMatrixWorld(true)` on your titan root at the end of your update).

Queries:
```js
col.raycast(origin, dir /*unit*/, maxDist, { dynamic = true, hookableOnly = false, ignore?: Set<collider> })
   -> { point: Vector3, normal: Vector3, distance, collider } | null       (includes ground)
col.querySphere(center, radius, { dynamic = false }) -> collider[]     // overlapping colliders (broadphase+narrow)
col.collideSphere(center, radius) -> [{ normal, depth, collider }]      // contacts to push a sphere out
col.groundHeight(x, z) -> number
```

## World — `src/world/world.js` (owner: world agent)

```js
export function buildWorld(game) -> {
  playerSpawn: { position: Vector3, yaw: number },        // yaw 0 = facing +z
  supplyDepots: [{ position: Vector3, radius: number }],  // refill gas + blades when the player stands inside
  titanSpawns: [{ center: Vector3, radius: number, area: 'field' | 'forest' | 'town' }],
  sun: DirectionalLight,                                  // casts shadows; core moves it with the player
  update(dt, cameraPosition),                             // flags, clouds, smoke, birds... (cheap)
}
```
Adds meshes to `game.scene`, registers colliders with `game.collision` (static), sets `scene.background/fog`.

## Titans — `src/titans/titans.js` (owner: titan agent)

```js
export class TitanManager {
  constructor(game)
  titans: Titan[]
  spawn({ kind: 'normal' | 'abnormal' | 'colossal', height?: number, position: Vector3, yaw?: number }) -> Titan
  update(dt)
  clear()
  hitTest(center: Vector3, radius: number) -> [{ titan, part: 'nape'|'eye'|'ankle'|'arm'|'hand'|'body', point: Vector3 }]
}
class Titan {
  kind, height, alive, dying, position: Vector3, root: Object3D
  applyHit({ part, damage, point, dir }) -> { killed: boolean, effect: 'kill'|'shallow'|'blind'|'cripple'|'sever'|'none' }
  napeWorld() -> { center: Vector3, normal: Vector3 }   // for aim assist / HUD marker (normal points out of the nape)
}
```
Nape kill threshold: `damage` is computed by the player from relative speed (≈ speed m/s × 10 × blade sharpness).
A nape hit with damage ≥ `titan.napeHp` (≈ 300 for 3–7 m, 600 for 15 m, 2500 for the Colossal) kills.
Player interaction:
* Grab: when a titan hand closes on the player, call `game.player.grab(titan, handObject3D)`. The player
  follows the hand; the player calls `titan.onGrabEscape()` if the player cuts free (mash LMB).
  When the hand reaches the mouth the titan calls `game.player.eaten(titan)`.
* Swat / stomp / steam: `game.player.applyImpulse(velocityChange: Vector3, damage: number)`.
* `game.player.position`, `.velocity`, `.alive`, `.grabbedBy` are public.
Events emitted by titans: `game.events.emit('titan:killed', { titan, point })`, `'titan:step'`, `'colossal:appear'`.
Titans may call `game.fx.*` and `game.audio.*` directly for their own sounds/effects.

## Effects — `src/fx/effects.js` (owner: fx agent)

```js
export class Effects {
  constructor(game)
  gas(position, direction, intensity)        // ODM gas jet puff, call every frame while boosting
  steam(position, size, duration?)           // titan steam (white, rising), big
  blood(position, direction, size)           // titan blood: red spray that evaporates to steam
  impact(position, normal, material)         // hook strike / landing dust / stone chips / bark
  sparks(position, normal)                   // blade on metal / stone
  leaves(position, count)                    // flying through canopy
  lightning(position, height)                // titan transformation flash + shockwave
  slashArc(position, quaternion, radius)     // white blade trail arc (anime slash)
  update(dt)
}
export class SpeedLines { constructor(renderer); setIntensity(0..1); render() }  // anime radial lines overlay
```

## Player model — `src/player/model.js` (owner: fx agent)

```js
export class PlayerModel {
  constructor(game)           // Survey Corps soldier: cape with Wings of Freedom, ODM gear, two blades
  root: Group                 // core sets nothing on it; model positions itself from state
  update(dt, s)               // s: { position, velocity, forward (unit, where the body should face), up,
                              //      grounded, running (0..1), hooks: [{ attached, anchor: Vector3|null }, {..}],
                              //      boosting (0..1), slash (0..1 progress or -1), spin (bool), grabbed (bool),
                              //      blades (bool: has blades drawn), speed }
  hookOrigin(side /*0 left,1 right*/, out: Vector3) -> Vector3   // world position of the anchor launcher
  gasNozzle(outPos, outDir)
}
```

## Audio — `src/audio/audio.js` (owner: audio agent)

```js
export class Audio {
  init()                                       // call on first user gesture
  setListener(position, forward, up)
  hookFire(side), hookHit(material), hookRetract(side), hookMiss()
  setReel(level), setGas(level), setWind(speedMetresPerSecond)   // continuous loops, 0..1 / m/s
  slash(hit), napeKill(), bladeBreak(), bladeSwap(), refill(), impact(strength 0..1), land(strength)
  grabbed(), eaten(), hurt()
  titanStep(position, size), titanGroan(position, size), titanFall(position, size), steamHiss(position, size)
  colossalAppear()
  setMusic(intensity 0..1), toggleMute()
}
```

## HUD — `src/ui/hud.js` (owner: hud agent)

```js
export class Hud {
  constructor(game)                // DOM overlay above the canvas
  update(s)  // s: { gas 0..1, blade 0..1, bladesSpare int (pairs), hp 0..1, kills, score, speed m/s, combo,
             //      hooks: [{ state: 'idle'|'flying'|'attached' }, {..}], aim: { valid: bool, distance, lockTitan: bool },
             //      napeMarkers: [{ x, y, visible }] (screen px), objective: string,
             //      hookTargets: [{ x, y, visible, valid, attached }] ×2 (Z, X markers),
             //      hint: null | { keys: [...], text }, threats: [{ x, y, angle, danger }],
             //      timer: seconds | null, targets: null | { left, total }, controlsCard: bool,
             //      grabbed: bool, struggle: 0..1 }
  damageNumber(value, screenX, screenY, kill)   // big AoTTG style numbers
  message(text, seconds = 2.5, style = 'info'|'warn'|'big')
  showMenu(onStart(mode)), hideMenu(), showDeath(stats, onRetry, onMenu?), hideDeath(),
  showPause(onResume), hidePause(), showTrainingResult(stats, onRetry, onMenu), hideTrainingResult()
}
```

## Training Grounds — `src/titans/dummies.js`

```js
export class TrainingCourse {
  constructor(game); start(); stop(); update(dt)
  titans: Dummy[]                  // cuttable duck type (kind 'dummy'); pulley dummies have dynamic colliders
  hitTest(center, radius) -> [{ titan: dummy, part: 'nape' | 'body', point }]
  remaining, total, spawn: { position, yaw }
}
// emits 'training:cut' { dummy, damage, point }
```

## Ownership

| Path | Owner |
|---|---|
| `src/main.js`, `src/game.js`, `src/config.js`, `src/input.js`, `src/core/*`, `src/player/player.js`, `src/player/odm.js`, `index.html` | core |
| `src/world/*` | world agent |
| `src/titans/*` | titan agent |
| `src/fx/*`, `src/player/model.js` | fx agent |
| `src/audio/*` | audio agent |
| `src/ui/*` | hud agent |

Each agent may add dev pages under `aot/dev/<owner>-*.html`. Never edit files you don't own; never run git
commands that change state (commit, checkout, stash, reset) — the core owner commits.
