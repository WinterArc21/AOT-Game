// Plug the Gate: the Struggle for Trost's last act, after the anime (season 1, episodes 11–13) and the manga
// (chapters 10–14). Pixis sends the Garrison and the cadets to the far corner of the district as bait while an elite
// squad (Ian, Rico, Mitabi, Mikasa) guards Eren at the boulder. He transforms, loses control (swings at Mikasa, hits
// his own face) and slumps against it: Rico fires a red flare. Ian holds the squad there until Armin reaches the nape
// and wakes him; Eren lifts the boulder and carries it, bent double, to the breach, a titan coming through it at the
// end. He slams it in, Rico fires the yellow flare, and while the cadets cut him out of the nape two titans close in,
// until Captain Levi arrives. Game (src/game.js) owns one of these per 'gate' run.
import * as THREE from 'three';
import { Carrier, Boulder, BOULDER_R } from '../titans/carrier.js';

const V3 = THREE.Vector3;
const BOULDER_AT = new V3(0, 0, -150);       // where the boulder lies, in Trost's main street (the gate is at z = 0)
const EREN_AT = new V3(0, 0, -137);          // he transforms on its gate side, facing the squad on the roofs
const GOAL_Z = -19;                          // he heaves it in from here
const DECOY = new V3(-300, 0, -40);          // the far corner: the main force are bait on the wall above it
const SQUAD = ['Ian', 'Mikasa', 'Rico', 'Mitabi'];
const ARMIN_T = 40;                          // s Eren lies slumped before Armin gets to his nape and wakes him
const RESCUE_T = 22;                         // s they need to cut him out of the nape before Levi arrives
const MAX_HUNTING = 7;                       // titans after Eren (not counting the ones at the decoy)
const col = (c) => new THREE.Color(c);
const SMOKE = [col(0x3d3936), col(0x8d8782)], CANNON = [col(0xd8d4cc), col(0xa9a49c)];
const FIRES = [[-48, -96], [64, -58], [-122, -172], [128, -232], [-34, -262], [96, -128]];

export class GateMission {
  constructor(flow) {
    this.flow = flow; this.g = flow.g;
    this.phase = 'none'; this.t = 0;
    this.done = false;
  }

  // ---------------------------------------------------------------- setup
  /** Where the player starts: on a roof beside the boulder with the elite squad, looking at it. */
  spawn() {
    const g = this.g;
    for (const [x, z] of [[17, -130], [-17, -130], [18, -144], [-18, -144], [20, -120]]) {
      const hit = g.collision.raycast(new V3(x, 80, z), new V3(0, -1, 0), 90, { dynamic: false });
      if (hit && hit.collider.type !== 'ground' && hit.point.y > 6) {
        return { position: hit.point.clone().add(new V3(0, 0.3, 0)), yaw: Math.atan2(EREN_AT.x - x, EREN_AT.z - z) };
      }
    }
    return { position: new V3(0, 50.6, 0), yaw: Math.PI };
  }

  start() {
    const g = this.g, p = g.player;
    this.phase = 'brief'; this.t = 0; this.done = false; this.yellow = false; this.flung = false; this.gateTitan = false;
    this.boulder = new Boulder(g, new V3(BOULDER_AT.x, g.collision.groundHeight(BOULDER_AT.x, BOULDER_AT.z) + BOULDER_R * 0.88, BOULDER_AT.z));
    this.dirT = 6; this.waves = 0; this.cannonT = 2; this.fireT = 0; this.lines = new Set();
    // the elite squad lands on the roofs round you
    (g.allies || []).forEach((a, i) => {
      a._baseName = a._baseName || a.name;
      a.name = SQUAD[i] || a._baseName;
      const ang = (i / Math.max(1, g.allies.length)) * Math.PI * 2;
      const at = this._roofNear(p.pos.x + Math.cos(ang) * 9, p.pos.z + Math.sin(ang) * 9) || p.pos.clone().add(new V3(Math.cos(ang) * 3, 0, Math.sin(ang) * 3));
      a.odm?.releaseAll?.(true); a.land = null; a.rest = null; a.job = null;
      a.pos.copy(at); a.prev.copy(at); a.render.copy(at); a.vel.set(0, 0, 0);
    });
    // the bait: the Garrison and the cadets on the wall at the far corner have most of Trost's titans round them
    for (let i = 0; i < 5; i++) this._spawn(this._around(DECOY, 45), 6 + Math.random() * 8, { lured: true, home: DECOY });
    g.hud?.message?.('THE STRUGGLE FOR TROST', 3.2, 'big');
    g.audio?.setMusic?.(0.4);
  }

  dispose() {
    const g = this.g;
    if (g.escort) g.escort.dispose();
    g.escort = null;
    this.boulder?.dispose();
    this.boulder = null;
    if (this.seal) g.collision.remove(this.seal);
    this.seal = null;
    g.gateSealed = false;
    for (const a of g.allies || []) if (a._baseName) a.name = a._baseName;
    this.phase = 'none';
  }

  // ---------------------------------------------------------------- helpers
  _roofNear(x, z) {
    const hit = this.g.collision.raycast(new V3(x, 80, z), new V3(0, -1, 0), 90, { dynamic: false });
    return hit && hit.collider.type !== 'ground' && hit.point.y > 6 ? hit.point.add(new V3(0, 1, 0)) : null;
  }
  _around(c, r) { const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r; return new V3(c.x + Math.cos(a) * d, 0, c.z + Math.sin(a) * d); }
  _say(who, text, key = text) {
    if (this.lines.has(key)) return;
    this.lines.add(key);
    const ally = (this.g.allies || []).find((a) => a.name === who);
    if (ally && !ally.alive) return;     // the dead don't call it
    this.g.hud?.feed?.(text, 'radio', who);
  }
  _spawn(pos, height, { lured = false, home = null, kind = 'normal', yaw } = {}) {
    const g = this.g;
    pos.y = g.collision.groundHeight(pos.x, pos.z);
    this.flow._spawnQ.push({
      kind, height, position: pos, yaw: yaw ?? Math.random() * Math.PI * 2,
      then: (t) => { if (!t) return; t.lured = lured; if (home) t.home.copy(home); },
    });
  }
  hunting() { return (this.g.titans?.titans || []).filter((t) => t.alive && !t.lured); }

  // ---------------------------------------------------------------- the operation
  update(dt) {
    const g = this.g;
    if (this.phase === 'none') return;
    this.t += dt;
    this._atmosphere(dt);
    const esc = g.escort;
    switch (this.phase) {
      case 'brief':
        if (this.t > 1) this._say('Pixis', 'Soldiers! We take Trost back today. Eren will carry the boulder and seal the breach.');
        if (this.t > 4) this._say('Pixis', 'The main force draws the titans to the far corner. Elite squad: protect Eren with your lives.');
        if (this.t > 6.5) this._say('Ian', 'Positions! Eren, now!');
        if (this.t > 8) this._transform();
        break;
      case 'transform':
        if (esc.phase === 'berserk' && esc.phaseT > 0.9 && !this.flung) {
          this.flung = true;
          const m = this.mikasa;
          if (m && m.alive && m.pos.distanceTo(esc.punchAt) < 12) { m.odm?.releaseAll?.(true); m.vel.set((m.pos.x - esc.position.x) * 0.6, 9, (m.pos.z - esc.position.z) * 0.6).clampLength(0, 18); }
          g.player.cam.trauma = Math.min(1, g.player.cam.trauma + 0.5);
          this._say('Mikasa', 'Eren! It\'s me, Mikasa!');
        }
        break;
      case 'defend':
        this.arminT -= dt;
        if (this.arminT < ARMIN_T - 4) this._say('Ian', 'We don\'t pull back. Hold them off him until he comes round!');
        if (this.arminT < 15) this._say('Armin', 'I\'m going in! I\'ll wake him from the nape!');
        if (this.arminT < 2.5) this._say('Armin', 'Eren! Why did you want to see the world outside the walls?');
        if (this.arminT <= 0) {
          esc.roar(); esc.setPhase('lift');
          g.hud?.message?.('EREN LIFTS THE BOULDER', 2.5, 'big');
          this._say('Ian', 'He\'s carrying it! Protect Eren, whatever it costs us!');
          this.phase = 'carry'; this.dirT = 5;
          g.audio?.setMusic?.(1);
        }
        this._director(dt);
        break;
      case 'carry':
        if (esc.progress > 0.3) this._say('Mitabi', 'My squad, down to the streets! Draw them off him!');
        if (esc.progress > 0.55) this._say('Rico', 'Keep going, Eren! Almost there!');
        if (!this.gateTitan && esc.position.z > GOAL_Z - 42) {
          // as he reaches the breach, one comes in through it, straight at him
          this.gateTitan = true;
          this._spawn(new V3(2, 0, 34), 12.5, { yaw: Math.PI });
          this._say('Rico', 'One\'s coming through the breach! Take it before it reaches him!');
        }
        this._director(dt);
        break;
      case 'rescue':
        this.rescueT -= dt;
        if (!this.yellow && this.rescueT < RESCUE_T - 1.4) {
          this.yellow = true;
          const rico = (g.allies || []).find((a) => a.name === 'Rico' && a.alive);
          g.fx?.flare?.(rico ? rico.pos : new V3(10, 52, -2), 'yellow');
          g.audio?.hookFire?.(1);
          g.hud?.message?.('YELLOW FLARE · THE BREACH IS SEALED', 3.5, 'big');
        }
        if (this.rescueT < RESCUE_T - 3) this._say('Mikasa', 'He\'s fused into the nape! Hold them off while we cut him out!');
        if (this.rescueT <= 0) this._levi();
        break;
      case 'levi':
        if (this.t - this.leviAt > 4.5) this._win();
        break;
      default: break;
    }
  }

  _transform() {
    const g = this.g;
    this.phase = 'transform';
    const y = g.collision.groundHeight(EREN_AT.x, EREN_AT.z);
    const toSquad = Math.atan2(g.player.pos.x - EREN_AT.x, g.player.pos.z - EREN_AT.z);
    // the lightning strike, and his titan comes out of it
    g.fx?.lightning?.(new V3(EREN_AT.x, y, EREN_AT.z), 70);
    g.fx?.steam?.(new V3(EREN_AT.x, y + 6, EREN_AT.z), 16, 4);
    g.events.emit('titan:step', { position: new V3(EREN_AT.x, y, EREN_AT.z), size: 60 });
    g.player.cam.trauma = 1;
    const esc = g.escort = new Carrier(g.titans, { position: new V3(EREN_AT.x, y, EREN_AT.z), yaw: toSquad, boulder: this.boulder, goalZ: GOAL_Z });
    // he swings at the nearest of the squad: Mikasa, standing in front of him
    this.mikasa = (g.allies || []).find((a) => a.name === 'Mikasa' && a.alive);
    if (this.mikasa) {
      const at = this._roofNear(EREN_AT.x + Math.sin(toSquad) * 13, EREN_AT.z + Math.cos(toSquad) * 13);
      if (at) { this.mikasa.pos.copy(at); this.mikasa.prev.copy(at); this.mikasa.render.copy(at); this.mikasa.vel.set(0, 0, 0); }
    }
    esc.punchAt.copy(this.mikasa ? this.mikasa.pos : g.player.pos);
    g.hud?.message?.('EREN TRANSFORMS', 2, 'big');
    g.audio?.setMusic?.(0.6);
  }

  // events from the carrier (Game forwards them)
  onDown() {
    const g = this.g;
    if (this.phase !== 'transform') return;
    this.phase = 'defend'; this.arminT = ARMIN_T; this.dirT = 4;
    const rico = (g.allies || []).find((a) => a.name === 'Rico' && a.alive);
    g.fx?.flare?.(rico ? rico.pos : g.player.pos.clone().add(new V3(4, 0, 0)), 'red');
    g.audio?.hookFire?.(1);
    g.hud?.message?.('RED FLARE · THE OPERATION HAS FAILED', 3.5, 'big');
    this._say('Rico', 'He\'s lost control! It\'s over, I\'m calling it!');
    // while they argue, the nearest titans in the town are already coming for him, and some of the bait breaks off
    this._fromTown(2);
    this._breakAway(1);
    g.audio?.setMusic?.(0.8);
  }

  onSealed() {
    const g = this.g, p = g.player;
    if (this.done) return;
    g.gateSealed = true;
    // the boulder fills the tunnel: nothing walks or flies through it again
    this.seal = g.collision.addBox({ center: new V3(0, 10, 0), halfExtents: new V3(8, 10, 6), material: 'stone' });
    for (const t of g.titans?.titans || []) {
      if (Math.abs(t.position.z) < 6 + t.footR && Math.abs(t.position.x) < 8) t.position.z = t.position.z >= 0 ? 6 + t.footR + 2 : -(6 + t.footR + 2);
    }
    for (let i = 0; i < 12; i++) g.fx?.impact?.(new V3((Math.random() - 0.5) * 20, Math.random() * 6, -10 + Math.random() * 6), new V3(0, 1, 0), 'stone');
    g.fx?.steam?.(new V3(0, 6, -12), 18, 4, [col(0xd9d0c0), col(0xa59d90)]);   // the dust of it
    g.events.emit('titan:step', { position: new V3(0, 0, -6), size: 80 });
    g.audio?.titanFall?.(new V3(0, 5, -6), 40);
    p.cam.trauma = 1; g.hitstop = 0.35;
    this.flow.score += 5000 + Math.round(g.escort.hp) * 40;
    // Pixis sends the reinforcements in: the titans not already on him turn back toward the main force, but two come
    // at him while he lies there
    for (const t of this.hunting()) if (t.position.distanceTo(g.escort.position) > 30) { t.lured = true; t.home.copy(DECOY); if (t.state === 'maul') t._enter('idle'); }
    this.phase = 'rescue'; this.rescueT = RESCUE_T;
    for (const sx of [-1, 1]) this._spawn(new V3(sx * (8 + Math.random() * 6), 0, -95 - Math.random() * 20), 9 + Math.random() * 4, { yaw: 0 });
    g.audio?.setMusic?.(0.7);
  }

  _levi() {
    const g = this.g, esc = g.escort;
    this.phase = 'levi'; this.leviAt = this.t;
    const levi = { name: 'Levi' };
    for (const t of g.titans?.titans || []) {
      if (!t.alive || t.position.distanceTo(esc.position) > 160) continue;
      const nw = t.napeWorld();
      g.fx?.slashArc?.(nw.center, t.root.quaternion, t.height * 0.25);
      g.fx?.blood?.(nw.center, nw.normal, 2);
      t.killedBy = levi;
      t.applyHit({ part: 'nape', damage: 1e5, point: nw.center });
    }
    g.hud?.message?.('CAPTAIN LEVI · THE SURVEY CORPS HAS RETURNED', 3.5, 'big');
    g.hud?.feed?.('Oi, brats. Want to tell me what\'s going on here?', 'radio', 'Levi');
    g.audio?.setMusic?.(0.35);
  }

  _win() {
    const g = this.g, p = g.player, flow = this.flow;
    if (this.done) return;
    this.done = true; this.phase = 'won';
    g.hud?.feed?.('Humanity has won its first victory against the titans.', 'radio', 'Pixis');
    const run = flow.run;
    setTimeout(() => {
      if (flow.run !== run) return;
      g.input.unlock?.();
      g.hud?.showDeath?.({ cause: 'HUMANITY\'S FIRST VICTORY', win: true, kills: p.stats.kills, score: flow.score, time: Math.round(g.time - (flow.startTime || 0)) },
        () => flow.start('gate'), () => flow.toMenu());
    }, 2500);
  }

  onFallen() {
    const g = this.g, flow = this.flow;
    if (this.done) return;
    this.done = true; this.phase = 'lost';
    g.hud?.message?.(g.gateSealed ? 'THEY GOT TO EREN' : 'EREN IS DOWN. THE BOULDER HAS FALLEN', 3.5, 'big');
    g.audio?.setMusic?.(0.1);
    const run = flow.run;
    setTimeout(() => {
      if (flow.run !== run) return;
      g.input.unlock?.();
      g.hud?.showDeath?.({ cause: g.gateSealed ? 'EREN WAS EATEN' : 'TROST IS LOST', kills: g.player.stats.kills, score: flow.score, time: Math.round(g.time - (flow.startTime || 0)) },
        () => flow.start('gate'), () => flow.toMenu());
    }, 3800);
  }

  // ---------------------------------------------------------------- titans
  /** More come at him: some of the bait breaks off, more come out of the town, and through the breach while it's open. */
  _director(dt) {
    const g = this.g, esc = g.escort;
    if ((this.dirT -= dt) > 0) return;
    const carry = this.phase === 'carry';
    this.dirT = carry ? 13 - 3 * esc.progress + Math.random() * 3 : 11 + Math.random() * 3;
    if (this.hunting().length + this.flow._spawnQ.length >= MAX_HUNTING) { this.dirT = 2; return; }
    this.waves++;
    this._breakAway(1);
    this._fromTown(1 + (this.waves % 2));
    // and in from the field through the breach
    if (this.waves % 2 === 0 && !(carry && esc.position.z > GOAL_Z - 40)) this._spawn(new V3((Math.random() - 0.5) * 50, 0, 30 + Math.random() * 30), 6 + Math.random() * 8, { kind: this.waves % 3 === 2 ? 'abnormal' : 'normal' });
    // keep the bait round the decoy
    const bait = (g.titans?.titans || []).filter((t) => t.alive && t.lured).length;
    if (bait < 3) this._spawn(this._around(DECOY, 45), 6 + Math.random() * 8, { lured: true, home: DECOY });
  }

  /** Out of the town's streets nearest him (not right on top of him or of you). */
  _fromTown(n) {
    const g = this.g, at = g.escort.position;
    const zones = (g.world?.titanSpawns || []).filter((z) => z.area === 'town' && Math.hypot(z.center.x - at.x, z.center.z - at.z) > 30 && z.center.distanceTo(g.player.pos) > 25)
      .sort((a, b) => a.center.distanceTo(at) - b.center.distanceTo(at)).slice(0, 4);
    for (let i = 0; i < n && zones.length; i++) {
      const z = zones[(Math.random() * zones.length) | 0];
      this._spawn(this._around(z.center, z.radius), 5 + Math.random() * 9);
    }
  }

  _breakAway(n) {
    const g = this.g;
    // the ones nearest him break off first
    const at = g.escort?.position || DECOY;
    const bait = (g.titans?.titans || []).filter((t) => t.alive && t.lured).sort((a, b) => a.position.distanceTo(at) - b.position.distanceTo(at));
    for (let i = 0; i < n && bait.length; i++) {
      const t = bait.shift();
      t.lured = false;
      if (i === 0) this._say(Math.random() < 0.5 ? 'Rico' : 'Ian', 'One\'s broken away from the decoy! Coming this way!', 'break' + this.waves + '-' + Math.round(this.t));
    }
  }

  // ---------------------------------------------------------------- atmosphere
  /** Trost burning, and the cannons of the main force booming at the far corner. */
  _atmosphere(dt) {
    const g = this.g, fx = g.fx;
    if (!fx) return;
    if ((this.fireT -= dt) <= 0) {
      this.fireT = 0.9;
      for (const [x, z] of FIRES) fx.steam(new V3(x + (Math.random() - 0.5) * 3, 14, z + (Math.random() - 0.5) * 3), 5.5, 9, SMOKE);
    }
    if ((this.cannonT -= dt) <= 0 && this.phase !== 'won') {
      this.cannonT = 1.6 + Math.random() * 2.6;
      const at = new V3(DECOY.x + (Math.random() - 0.5) * 90, 52, -3.5);
      fx.steam(at, 3, 3, CANNON);
      g.audio?.titanStep?.(at, 18);
      const bait = (g.titans?.titans || []).filter((t) => t.alive && t.lured);
      const tgt = bait[(Math.random() * bait.length) | 0];
      if (tgt) { const hp = tgt._headWorld(new V3()); fx.impact(hp, new V3(0, 1, 0), 'stone'); fx.steam(hp, 2.5, 2, SMOKE); }
    }
  }

  // ---------------------------------------------------------------- HUD
  objective() {
    const g = this.g, esc = g.escort;
    const hp = esc ? ` · Eren ${Math.round(esc.hp)}%` : '';
    const on = this.hunting().filter((t) => t.state === 'maul' && t.mauling).length;
    const onTxt = on ? ` · ${on} titan${on > 1 ? 's' : ''} on him!` : '';
    switch (this.phase) {
      case 'brief': return 'THE STRUGGLE FOR TROST · Eren is about to transform';
      case 'transform': return 'EREN HAS LOST CONTROL · stay clear';
      case 'defend': return `HOLD THEM OFF EREN · Armin is coming: ${Math.max(0, Math.ceil(this.arminT))} s${hp}${onTxt}`;
      case 'carry': return `PROTECT EREN · ${Math.max(0, Math.round(esc.goalZ - esc.position.z))} m to the breach${hp}${onTxt || (esc.blocked ? ' · a titan is in his way!' : '')}`;
      case 'rescue': return `THEY'RE CUTTING EREN OUT · hold on ${Math.max(0, Math.ceil(this.rescueT))} s${hp}${onTxt}`;
      case 'levi': case 'won': return 'THE BREACH IS SEALED';
      case 'lost': return 'TROST IS LOST';
      default: return '';
    }
  }
}
