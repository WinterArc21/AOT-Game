# WINGS OF FREEDOM

A fan-made Attack on Titan game for the browser: Omni-Directional Mobility gear, Wall Rose, Trost District,
the Forest of Giant Trees, titans that want to eat you, and the Colossal Titan. Everything is generated in code
(geometry, textures, sound and music). No assets are downloaded.

**Play:** open [`dist/wings-of-freedom.html`](dist/wings-of-freedom.html) in Chrome, Edge or Firefox. It is a
single file, so double-clicking it works. For development, serve the repo root
(`npx http-server . -p 8080 -c-1`) and open `http://localhost:8080/`.

## Controls

The keyboard is all you need. The mouse is optional.

| Keys | What they do |
|---|---|
| **← →** | turn. On a rope: swing round the anchor |
| **↑ / ↓** | run / brake: **↓** skids you to a stop on foot and bleeds off speed in the air (it never turns you round). On a rope: **↑** pumps the swing, **↓** lets the wire out for a longer swing, and near your anchor it sets you down on the branch or trunk |
| **Z** / **X** (hold) | fire the left / right rope. Each one goes where you face: the anchor nearest the centre of your view, Z in the left half, X in the right, shown by a **Z** / **X** marker before you fire. Let go to release |
| **C** | the marker isn't on the anchor you want? skip both ropes to the next-best anchors |
| **Z + X** | both ropes: zip forward between the two anchors. If either side has a titan in view, both ropes go to the titan |
| **Shift** | gas boost (the reel pulls harder too). Tap it on the ground to jump; clinging to a trunk, it kicks you off |
| **Space** | cut. Hold it while flying fast for Levi's spinning slash. Swooping in on a nape, press it early: the cut fires when you arrive |
| **Esc** / **P** | pause · **M** mute · **H** show or hide the controls card |
| **F** | whistle: your horse (or the nearest free one) gallops over. Run up to its flank to vault into the saddle, or fall toward one with no ropes out and you drift onto its back, legs open, and land astride |

WASD mirror the arrows. Blades swap themselves when they go dull (**R** also swaps). Mouse players can click
the game to look around with the mouse; **Q** / **E** and the right mouse button also fire ropes.

**Fighting a titan:** get within about 100 m and hold **Z + X**. Both ropes lock onto its shoulders and the gear
swoops you round behind the neck. Press **Space** as you come in. A cut that's too slow only scratches the nape,
so add **Shift** for speed.

**Modes:**
* **Expedition:** waves of titans from the field, the forest and the breached gate, and the Colossal Titan on wave 3.
* **Training Grounds:** wooden titan dummies through the forest edge, some sliding on pulleys. Cut every nape
  against the clock; your best time is kept.
* **Free Flight:** no titans, infinite gas. Start at the forest edge and fly.

Supply depots (crates under a Survey Corps flag) refill gas, blades and health. There is one on the wall top
either side of the gate, one on the Garrison HQ roof and one on a platform in the forest.

### Titans fight back
* **Wire grab:** rope a titan from the front and dawdle, and it may snatch your wire and haul you in. Let go of the
  rope key, or press **Space** to cut the wire.
* **Shake-off:** hang against a titan's body on a short rope and it thrashes until your anchors tear out.
* **Abnormals charge riders:** a crouch and a roar, then a sprint straight at your horse. Swerve, or leap off.

### Your squad
Comrades fly in pairs: one calls a titan and cuts its ankles, the other finishes the nape. They call out new
titans by clock bearing, and their kills show in the feed on the right. A titan can catch a comrade: cut the
hand that holds them, or kill the titan, within about five seconds.

## How the ODM gear works (the physics)

`src/player/odm.js` and `src/player/player.js`, stepped at a fixed 120 Hz with render interpolation:

* **Anchors** are projectiles (300 m/s, 115 m range) that ray-march the collision world. They stick to stone,
  bark, roofs, branches and titan flesh. On a titan, the anchor rides that limb.
* **The wire is a one-sided distance constraint.** It can go slack but never stretch. When it is taut, only the
  outward velocity is removed, so the tangential speed survives. A free swing conserves energy (the bench
  measures under 1 % drift over 12 s). A wire that goes taut while you fly away from its anchor (a point-blank
  catch, slack snapping tight) slips through the reel's clutch: the outward speed bleeds off at 85 m/s² while
  the wire runs out, instead of vanishing in one tick.
* **The reel** is a gas-driven winch with a torque curve. It pulls hard from rest and fades as the inward speed
  nears its limit (36 m/s, or 64 m/s with the gas trigger held), and it instantly winds in any slack. A wire
  that shortens while you circle spins you up (angular momentum), which gives the anime's slingshot around a
  trunk.
* **Gas** thrusts where you look, boosts the reel, powers the dash, and is finite. Air drag is quadratic
  (free-fall terminal speed about 75 m/s), and gravity is 14.5 m/s² for snappier, heavier arcs.
* **Rope auto-targeting** (`Player._scan`): candidate anchors come straight from the geometry around you. Each
  nearby trunk contributes the side facing you at a height above you, each branch its nearest stretch, each
  building or wall its nearest face, and each titan its shoulders. Candidates are scored by distance (sweet
  spot about 40 m), height above you, alignment with where you're going, and side, then the best few are
  confirmed by line of sight. The previous pick wins ties, so markers hold still. Small props (cannons, crates)
  are never picked.
* **Landing and staying:** hold a rope and come in slowly (or let the wire out near the anchor) and you land on the
  branch or roof it hit, or plant your feet on the trunk or wall. The rope stays in while you hold its key: on a
  trunk it holds you there as long as you like (↓ slides you down it, Shift kicks off, let go and you drop after
  a moment); on a branch it's a slack safety line and you stand, walk and grip the bark.
* **On foot** the run turns with the heading, so the body, the camera and where you're going stay lined up; the
  turn tightens as you slow (a sprint carves a bend instead of pivoting on the spot).
* **Letting the wire out** (↓ on a rope) is a brake-reel: under tension the wire runs out at up to 7 m/s, so the
  swing widens instead of the reel winding the slack back in.
* **The nape swoop:** roped to a titan, the gear flies you in three legs: out beside the head, round behind the
  neck, then through the nape at about 33 m/s (44 with Shift). Ropes on anything else go slack meanwhile.
* **Landing assist:** when you are about to hit a surface head-on while flying on a wire, the front vents bleed
  off the closing speed so you land on the trunk instead of hitting it. They brake with the deceleration it
  actually takes (up to 420 m/s² when a trunk swings into view close up). Sideways passes keep all their speed.
  Held against a wall by a wire, you run up it.
* **Impacts:** anything above 11 m/s gives a shake, dust and a thud. Above 17 m/s into a trunk or wall (30 m/s
  feet first onto a floor) it hurts. A horse that gallops into a wall throws you up and over its head at the
  speed you had, never faster.
* **Collision** is a swept sphere (sub-steps of 0.3 m or less, up to 12 per tick) against analytic shapes:
  oriented boxes, vertical cylinders, capsules, spheres and a height-field. Nothing tunnels at 100 m/s.
* **Damage:** a slash deals `(40 + relative speed × 12.5) × blade sharpness`. Small titans need about 25 m/s at
  the nape, 15 m titans about 45 m/s, and the Colossal takes several fast cuts.

`node tools/physics-bench.mjs` runs the real player code headless through a free swing, zips, an orbit, a
fall, a run, a wall climb, rope auto-targeting, wire payout and keyboard turning, and checks the numbers.
`node tools/keyboard-bench.mjs 40` lets a keyboard-only bot (↑, alternating X and Z, some Shift) fly the
real forest and reports distance, altitude, how often ropes catch and stalls.
`node tools/combat-bench.mjs 90` lets a keyboard-only bot fight the Expedition and reports kills, nape hits,
grabs and deaths.
`node tools/play-bench.mjs "play=free"` drives the real game in headless Chromium and screenshots a flight.
`node tools/motion-bench.mjs` measures the animation and gear in the real game: how fast planted feet and hooves
move over the ground (soldier walk/jog/sprint, 5 m and 15 m titans, horse walk/trot/gallop), step rates, the horse
pitch against the slope, per-frame speed loss on point-blank rope catches and trunk hits, the horse-crash throw,
and the cape angle at rest and on landing. `node tools/filmstrip.mjs run|titan|horse|grab|idle|cape|land out.png`
films a side-on contact sheet of any of those (`weave` films a run steering left and right through the game camera).
The bench also covers `weave` (body vs camera, crossing legs, cape and blades while steering), `stop` (↓ on foot and
in the air) and `perch` (landing on a branch with and without letting the wire out, hanging on a trunk).
**Feet:** soldiers, titans and horses plant their feet. The gait clock runs at the cadence the step length gives
(a sprint is ~2.1 m steps at ~5 a second; titans use the same curve scaled to their leg length). A planted foot is
pinned to the ground while the leg is solved onto it and the pelvis sinks just enough to reach. Horses also pitch
with the slope.
`node tools/forest-bench.mjs 60` flies AI soldiers through the real forest for a minute and reports altitude,
speed, canopy passes and tunnelling (none). URL flags for testing: `?play=free|expedition`, `?notitans`, `?noallies`,
`?allies=N`, `?noaudio`, `?norender`, `?testworld`, `?sens=1.5`, `?invert`.

Your **comrades**: a few AI Survey Corps soldiers fly on exactly the same ODM physics as you. They hop from tree to
tree and harass titans, which you can watch behind the title screen too.

## Layout

```
src/main.js            renderer, fixed-step loop, module loading, title flyover
src/game.js            modes, waves, the Colossal, score and combos
src/config.js          every tunable of the gear
src/core/collision.js  collision world (broadphase grid, raycasts, sphere contacts, dynamic shapes)
src/player/            ODM gear, player physics and camera, the Survey Corps soldier model with a cloth cape
src/titans/            procedural titans, their AI, grabs, nape hitboxes, the Colossal Titan
src/world/             Wall Rose, Trost District, the field, the Forest of Giant Trees, sky
src/fx/                particles (gas, steam, blood, sparks, leaves, lightning), slash arcs, anime speed lines
src/audio/             Web Audio synthesis: gear, blades, titans, wind, a procedural battle score
src/ui/                HUD, menus
ARCHITECTURE.md        the module contract
```

This is a fan project, not affiliated with the creators or publishers of Attack on Titan.
