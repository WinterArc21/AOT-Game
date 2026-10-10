// Bootstrap: renderer, the shared `game` object, module loading (each subsystem is optional so a failure in one
// never takes the game down), the fixed-step loop with render interpolation, and the title flyover.
import * as THREE from 'three';
import { CFG } from './config.js';
import { Input } from './input.js';
import { CollisionWorld } from './core/collision.js';
import { Player } from './player/player.js';
import { Game } from './game.js';
import { toonMaterial } from './core/style.js';

const params = new URLSearchParams(location.search);

class Events {
  constructor() { this.map = new Map(); }
  on(n, f) { (this.map.get(n) || this.map.set(n, []).get(n)).push(f); }
  off(n, f) { const a = this.map.get(n); if (a) { const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); } }
  emit(n, p) { const a = this.map.get(n); if (a) for (const f of a.slice()) { try { f(p); } catch (e) { console.error(n, e); } } }
}

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, params.has('lowres') ? 1 : 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = !params.has('noshadow');
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc4e4);
scene.fog = new THREE.Fog(0xa9c6dc, 200, 1500);
const camera = new THREE.PerspectiveCamera(CFG.cam.fov, innerWidth / innerHeight, 0.1, 4000);
scene.add(camera);

const game = {
  scene, camera, renderer, events: new Events(), time: 0, mode: 'menu', hitstop: 0,
  collision: new CollisionWorld(), settings: { sens: +(params.get('sens') || 1), invertY: params.has('invert') },
};
game.noRender = params.has('norender');
window.game = game; // handy for debugging and the headless test bench
game.input = new Input(renderer.domElement);
{
  const fl = document.createElement('div');
  fl.style.cssText = 'position:fixed;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:3;mix-blend-mode:screen';
  document.body.appendChild(fl);
  let a = 0, raf = 0;
  const fade = () => { a *= 0.82; fl.style.opacity = a.toFixed(3); if (a > 0.01) raf = requestAnimationFrame(fade); else { fl.style.opacity = '0'; raf = 0; } };
  game.flash = (k = 0.5) => { a = Math.max(a, k); fl.style.opacity = a.toFixed(3); if (!raf) raf = requestAnimationFrame(fade); };
}

async function load(imp, fn) {
  try { const m = await imp(); return await fn(m); }
  catch (e) { console.error('[module failed]', imp.toString(), e); return null; }
}

// ---------------------------------------------------------------- fallback pieces (used only if a module is missing)
function fallbackWorld() {
  const g = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), toonMaterial(0x6f9a4a));
  g.receiveShadow = true; scene.add(g);
  game.collision.setGround(() => 0);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(2400, 50, 12), toonMaterial(0xb8ab92));
  wall.position.set(0, 25, 0); scene.add(wall);
  game.collision.addBox({ center: new THREE.Vector3(0, 25, 0), halfExtents: new THREE.Vector3(1200, 25, 6), material: 'stone' });
  const trunkM = toonMaterial(0x6b4a33);
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    const x = (rnd() - 0.5) * 300, z = 60 + rnd() * 600, r = 2.5 + rnd() * 2, h = 70 + rnd() * 40;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, h, 12), trunkM);
    m.position.set(x, h / 2, z); m.castShadow = true; scene.add(m);
    game.collision.addCylinder({ x, z, y0: 0, y1: h, radius: r, material: 'bark' });
  }
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
  sun.position.set(-200, 400, 150); sun.castShadow = true;
  scene.add(sun, sun.target, new THREE.HemisphereLight(0xcfe6ff, 0x5a6b3a, 1.2));
  return { playerSpawn: { position: new THREE.Vector3(0, 50.5, 0), yaw: 0 }, supplyDepots: [{ position: new THREE.Vector3(40, 51, 0), radius: 4 }], titanSpawns: [], sun, update() {} };
}
function fallbackModel() {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.0, 4, 8), toonMaterial(0x7a5a3a));
  root.add(body); scene.add(root);
  return { root, update(dt, s) { root.position.copy(s.position); root.lookAt(root.position.clone().add(s.forward)); }, hookOrigin: null };
}

// ---------------------------------------------------------------- boot
const boot = async () => {
  const loading = document.getElementById('loading');
  const say = (t) => { if (loading) loading.querySelector('.msg').textContent = t; };

  say('Raising the Walls…');
  game.world = params.has('testworld') ? fallbackWorld()
    : (await load(() => import('./world/world.js'), (m) => m.buildWorld(game))) || fallbackWorld();
  if (game.world.sun) { game.world.sun.shadow.camera.updateProjectionMatrix?.(); }

  say('Waking the Titans…');
  game.fx = await load(() => import('./fx/effects.js'), (m) => new m.Effects(game));
  game.speedLines = await load(() => import('./fx/effects.js'), (m) => (m.SpeedLines ? new m.SpeedLines(renderer) : null));
  game.audio = params.has('noaudio') ? null : await load(() => import('./audio/audio.js'), (m) => new m.Audio());
  game.hud = await load(() => import('./ui/hud.js'), (m) => new m.Hud(game));
  game.titans = params.has('notitans') ? null : await load(() => import('./titans/titans.js'), (m) => new m.TitanManager(game));
  game.training = await load(() => import('./titans/dummies.js'), (m) => new m.TrainingCourse(game));
  game.trainingActive = false;
  // everything that can be cut (titans + training dummies), and one hit test over all of it
  const _targets = [];
  game.targetList = () => {
    _targets.length = 0;
    for (const t of game.titans?.titans || []) _targets.push(t);
    if (game.trainingActive) for (const t of game.training?.titans || []) _targets.push(t);
    return _targets;
  };
  game.hitTest = (c, r) => {
    const a = game.titans?.hitTest?.(c, r) || [];
    if (game.trainingActive && game.training?.hitTest) { const b = game.training.hitTest(c, r); if (b?.length) return a.concat(b); }
    return a;
  };

  say('Fitting the ODM gear…');
  game.player = new Player(game);
  game.player.model = (await load(() => import('./player/model.js'), (m) => { const pm = new m.PlayerModel(game); pm.autoGas = false; if (pm.root && !pm.root.parent) scene.add(pm.root); return pm; })) || fallbackModel();
  game.flow = new Game(game);

  // comrades in the air: AI soldiers on the same ODM physics
  game.herd = params.has('nohorses') ? null : await load(() => import('./player/horse.js'), (m) => new m.Herd(game));
  game.allies = [];
  if (!params.has('noallies')) await load(() => import('./player/ally.js'), async (am) => {
    const mm = await import('./player/model.js');
    const starts = [[-40, 55, 150], [30, 70, 230], [-80, 45, 300], [90, 60, 190], [0, 80, 360]];
    starts.slice(0, +(params.get('allies') ?? 5)).forEach(([x, y, z], i) => {
      const model = new mm.PlayerModel(game);
      model.autoGas = false;
      if (model.root && !model.root.parent) scene.add(model.root);
      game.allies.push(new am.Ally(game, model, new THREE.Vector3(x, y, z), i * 1.37 + 0.5));
    });
  });

  // The keyboard is enough; the mouse is optional. Clicking the game captures the mouse for mouse look,
  // and leaving that capture (Esc) pauses, like any keyboard pause.
  const isPlaying = () => game.mode === 'expedition' || game.mode === 'free' || game.mode === 'training';
  const resume = () => { game.paused = false; game.hud?.hidePause?.(); };
  const pause = () => { if (!isPlaying() || !game.player.alive || game.paused) return; game.paused = true; game.hud?.showPause?.(resume); };
  game.pause = pause; game.resume = resume;
  let wasLocked = false;
  game.input.onLockChange = (locked) => { if (!locked && wasLocked) pause(); wasLocked = locked; };
  game.input.onLockDenied = () => game.hud?.message?.('Mouse look is not available here: the arrow keys steer', 3, 'info');
  renderer.domElement.addEventListener('click', () => {
    if (isPlaying() && !game.paused && !game.input.locked && !game.input.lockDenied && game.player.alive) game.input.lock();
  });
  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'KeyM') game.audio?.toggleMute?.();
    if (e.code === 'KeyH') game.showControls = !game.showControls;
    if ((e.code === 'Escape' || e.code === 'KeyP') && isPlaying()) { if (game.paused) resume(); else pause(); }
  });
  addEventListener('blur', () => pause());
  game.showControls = true;
  // quality: 2 high, 1 medium, 0 low. Picked automatically from the frame rate in the first seconds of play
// (only ever stepping down), and G cycles it by hand.
const QUALITY = [
  { name: 'LOW', ratio: 0.75, shadows: false, shadowMap: 1024, allyRange: 120 },
  { name: 'MEDIUM', ratio: 1, shadows: true, shadowMap: 1024, allyRange: 180 },
  { name: 'HIGH', ratio: Math.min(devicePixelRatio, 1.75), shadows: true, shadowMap: 2048, allyRange: 260 },
];
game.quality = params.has('lowres') ? 1 : 2;
game.setQuality = (q, say = true) => {
  q = Math.max(0, Math.min(2, q)); game.quality = q;
  const Q = QUALITY[q];
  renderer.setPixelRatio(Q.ratio); renderer.setSize(innerWidth, innerHeight);
  const sun = game.world?.sun;
  if (sun) {
    sun.castShadow = Q.shadows && !params.has('noshadow');
    if (sun.shadow.mapSize.x !== Q.shadowMap) { sun.shadow.mapSize.set(Q.shadowMap, Q.shadowMap); sun.shadow.map?.dispose(); sun.shadow.map = null; }
  }
  game.allyRange = Q.allyRange;
  if (say) game.hud?.message?.(`GRAPHICS: ${Q.name}${say === 'auto' ? ' (auto, G to change)' : ''}`, 2, 'info');
};
let autoT = 0, autoN = 0, autoSum = 0;
game.autoQuality = (dt, playing) => {
  if (!playing || game.paused || game._qualityLocked || autoT > 12) return;
  autoT += dt;
  if (autoT < 2) return;                 // let shaders and the first wave settle
  autoSum += dt; autoN++;
  if (autoN >= 120) {
    const fps = autoN / autoSum;
    autoN = 0; autoSum = 0;
    if (fps < 42 && game.quality > 0) game.setQuality(game.quality - 1, 'auto');
  }
};
addEventListener('keydown', (e) => {
  if (e.code === 'KeyG' && !e.repeat) { game._qualityLocked = true; game.setQuality((game.quality + 2) % 3); }
});
addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    game.speedLines?.setSize?.(innerWidth, innerHeight);
  });

  if (loading) loading.remove();
  if (params.has('play')) game.flow.start(params.get('play') || 'free');
  else game.flow.toMenu();
  // compile every shader now (world, titans, horses, soldiers, effects) so the first cut, flash or steam burst
  // never stalls a frame mid-flight
  if (!game.noRender) { try { renderer.compile(scene, camera); } catch (e) { console.warn('warm-up', e); } }
  window.READY = true;
  requestAnimationFrame(frame);
};

// ---------------------------------------------------------------- loop
const STEP = 1 / CFG.physicsHz;
let last = performance.now(), acc = 0, fpsT = 0, frames = 0;
const _v = new THREE.Vector3(), _n = new THREE.Vector3();

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  step(dt);
}

/** One rendered frame. Exposed for the headless bench (window.stepGame) to drive time deterministically. */
function step(dt) {
  const { player, input } = game;
  game._frameDt = dt;
  frames++; fpsT += dt; if (fpsT > 1) { game.fps = frames / fpsT; frames = 0; fpsT = 0; }
  if (game.paused) { input.consume(); renderer.render(scene, camera); return; }

  // hit-stop on kills: time slows for a few frames (the anime's freeze-frame on a nape cut)
  // kill moment: a freeze-frame, then a short slow-motion that eases back to full speed
  let simDt = dt;
  if (game.hitstop > 0) { game.hitstop -= dt; simDt = dt * 0.1; }
  else if (game.slowmo > 0) { game.slowmo -= dt; const d = game.slowmoDur || 0.4; simDt = dt * (0.22 + 0.78 * Math.pow(1 - Math.max(0, game.slowmo) / d, 2)); }
  if (game.killCam) { game.killCam.t += dt; if (game.killCam.t >= game.killCam.dur) game.killCam = null; }
  game.time += simDt;

  const playing = game.mode === 'expedition' || game.mode === 'free' || game.mode === 'training';
  game.autoQuality(dt, playing);
  input.freeLook = playing && !input.locked && input.lockDenied && player.alive;
  input.edgeTurn(dt);
  if (playing) player.handleInput(input, dt);
  acc += simDt;
  let n = 0;
  while (acc >= STEP && n < 12) {
    if (playing) player.fixedUpdate(STEP);
    for (const a of game.allies) a.fixedUpdate(STEP);
    game.herd?.fixedUpdate(STEP);
    acc -= STEP; n++;
  }
  if (n === 12) acc = 0;
  try { game.titans?.update(simDt); } catch (e) { console.error('titans.update', e); game._titanErr = (game._titanErr || 0) + 1; if (game._titanErr > 5) game.titans = null; }
  if (game.trainingActive) { try { game.training?.update(simDt); } catch (e) { console.error('training.update', e); } }
  game.collision.updateDynamic();
  if (playing) player.update(simDt, acc / STEP);
  else menuCamera(dt);
  for (const a of game.allies) a.update(simDt, acc / STEP);
  game.herd?.update(simDt);
  game.flow.update(simDt);
  try { game.fx?.update(simDt); } catch (e) { console.error('fx.update', e); }
  try { game.world?.update?.(simDt, camera.position); } catch (e) { console.error('world.update', e); }
  // the forest breathes: leaves drift down around you under the canopy
  if (game.fx?.leaves && camera.position.z > 190 && camera.position.y < 110 && Math.random() < simDt * 2.2) {
    _n.set(camera.position.x + (Math.random() - 0.5) * 40, camera.position.y + 8 + Math.random() * 14, camera.position.z + (Math.random() - 0.3) * 40);
    game.fx.leaves(_n, 2);
  }

  // keep the shadow frustum centred on the action
  const sun = game.world?.sun;
  if (sun) {
    const c = playing ? player.render : camera.position;
    if (!game._sunOff) game._sunOff = sun.position.clone().sub(sun.target.position).normalize().multiplyScalar(300);
    sun.target.position.set(Math.round(c.x / 4) * 4, Math.round(c.y / 4) * 4, Math.round(c.z / 4) * 4);
    sun.position.copy(sun.target.position).add(game._sunOff);
    sun.target.updateMatrixWorld();
  }

  if (game.hud?.update) game.hud.update(hudState(playing));
  input.consume();

  if (game.noRender) return;
  renderer.render(scene, camera);
  if (game.speedLines) {
    const s = playing ? player.speed : 0;
    game.speedLines.setIntensity(THREE.MathUtils.clamp((s - 32) / 50, 0, 1) * (player.alive ? 1 : 0));
    game.speedLines.render();
  }
}
window.stepGame = step;

const _tp = new THREE.Vector3(), _cf = new THREE.Vector3(), _cr = new THREE.Vector3(), _cu = new THREE.Vector3();
const _hookTargets = [{ x: 0, y: 0, visible: false, valid: false, attached: false }, { x: 0, y: 0, visible: false, valid: false, attached: false }];
const _threats = [];
const _markers = [];
function toScreen(v, out) {
  _tp.copy(v).project(camera);
  out.x = (_tp.x * 0.5 + 0.5) * innerWidth; out.y = (-_tp.y * 0.5 + 0.5) * innerHeight;
  return _tp.z < 1 && Math.abs(_tp.x) < 1.05 && Math.abs(_tp.y) < 1.05;
}
function hudState(playing) {
  const p = game.player;
  _markers.length = 0; _threats.length = 0;
  if (playing) {
    camera.getWorldDirection(_cf); _cr.crossVectors(_cf, camera.up).normalize(); _cu.crossVectors(_cr, _cf).normalize();
    for (const t of game.targetList()) {
      if (!t.alive || !t.napeWorld) continue;
      const nw = t.napeWorld();
      if (!nw?.center) continue;
      const d = nw.center.distanceTo(p.render);
      if (d > 110) continue;
      const m = { x: 0, y: 0, visible: false, distance: d };
      m.visible = toScreen(nw.center, m);
      _markers.push(m);
      // off-screen titans within 90 m: a chevron pointing at them (danger when it is reaching for you)
      if (!m.visible && t.kind !== 'dummy' && d < 90) {
        // radar mapping: straight ahead is up, behind you is down
        _tp.subVectors(t.position, camera.position);
        const angle = Math.atan2(_tp.dot(_cr), _tp.x * _cf.x + _tp.z * _cf.z);
        _threats.push({ angle, danger: (t.threat || 0) > 0.5 || d < 25, distance: d });
      }
    }
    for (let i = 0; i < 2; i++) {
      const h = p.odm.hooks[i], T = p.targets[i], o = _hookTargets[i];
      o.attached = h.attached;
      o.valid = h.attached || T.valid;
      // markers glide to a new anchor instead of jumping (and snap when they first appear)
      const wasVis = o.visible, px = o.x, py = o.y;
      o.visible = !game.killCam && o.valid && toScreen(h.attached ? h.anchor : T.point, o);
      if (o.visible && wasVis) { const k = 1 - Math.exp(-22 * (game._frameDt || 0.016)); o.x = px + (o.x - px) * k; o.y = py + (o.y - py) * k; }
    }
  }
  return {
    playing, mode: game.mode,
    gas: p.infiniteGas ? 1 : p.odm.gas, blade: p.blade, bladesSpare: p.spares, hp: Math.max(0, p.hp),
    kills: p.stats.kills, score: game.flow.score, speed: playing ? p.speed : 0, combo: game.flow.combo,
    hooks: p.odm.hooks.map((h) => ({ state: h.state === 'retracting' ? 'idle' : h.state })),
    aim: { valid: p.aim.valid, distance: p.aim.distance, lockTitan: p.aim.lockTitan },
    napeMarkers: _markers, hookTargets: _hookTargets, threats: _threats,
    objective: playing ? game.flow.objective() : '', fps: game.fps,
    grabbed: !!p.grabbedBy, struggle: p.struggle, swapping: p.swapT > 0, wave: game.flow.wave,
    timer: game.flow.timer(), targets: game.flow.trainingTargets(), hint: playing && !game.killCam ? game.flow.hint : null,
    controlsCard: playing && game.showControls && !game.killCam,
  };
}

// cinematic title flyover: drift along the wall, looking out over the field toward the giant forest
function menuCamera(dt) {
  const t = game.time * 0.05;
  const x = Math.sin(t) * 160;
  camera.position.set(x, 64 + Math.sin(t * 1.7) * 6, -18 + Math.cos(t * 0.8) * 8);
  _n.set(x * 0.4 + Math.sin(t * 0.6) * 60, 30, 260);
  camera.up.set(0, 1, 0);
  camera.lookAt(_n);
  if (Math.abs(camera.fov - 62) > 0.01) { camera.fov = 62; camera.updateProjectionMatrix(); }
  game.audio?.setWind?.(6);
  game.audio?.setReel?.(0); game.audio?.setGas?.(0);
  if (game.player?.model?.root) game.player.model.root.visible = false;
}

boot();
