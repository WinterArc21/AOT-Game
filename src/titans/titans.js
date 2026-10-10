// TitanManager: owns every Titan, spawns / updates / removes them and answers blade hit tests.
// See aot/ARCHITECTURE.md ("Titans"). Model: builder.js + rig.js, behaviour: titan.js.
import * as THREE from 'three';
import { Titan, TITAN_TUNING } from './titan.js';

export { Titan, TITAN_TUNING };

export class TitanManager {
  constructor(game) {
    this.game = game;
    this.titans = [];
    /** s left during which no titan may grab (set when the player gets free of a hand) */
    this.grabBlockT = 0;
    this._grabbedPrev = null;
    this.group = new THREE.Group();
    this.group.name = 'titans';
    game.scene?.add(this.group);
  }

  /** spawn({ kind: 'normal'|'abnormal'|'colossal', height?, position: Vector3, yaw?, crawler?: bool (abnormals) }) -> Titan */
  spawn({ kind = 'normal', height, position, yaw, crawler } = {}) {
    if (height === undefined) height = kind === 'colossal' ? 60 : kind === 'abnormal' ? 7 : 3 + Math.random() * 9;
    const t = new Titan(this, { kind, height, position: position || new THREE.Vector3(), yaw, crawler });
    this.titans.push(t);
    this.group.add(t.root);
    if (kind === 'colossal') this._colossalAppear(t);
    return t;
  }

  _colossalAppear(t) {
    const g = this.game, p = t.position;
    g.fx?.lightning?.(p.clone(), 60);
    for (let i = 0; i < 7; i++) {
      g.fx?.steam?.(new THREE.Vector3(p.x + (Math.random() - 0.5) * 30, p.y + Math.random() * 55, p.z + (Math.random() - 0.5) * 20), 22 + Math.random() * 14, 5);
    }
    g.events?.emit?.('colossal:appear', { titan: t });
    g.audio?.colossalAppear?.();
  }

  update(dt) {
    // the player just got out of a hand (cut free, or the titan let go): give them a moment before the next grab
    const pl = this.game.player, held = (pl && pl.grabbedBy) || null;
    if (this._grabbedPrev && !held && pl?.alive) this.grabBlockT = Math.max(this.grabBlockT, TITAN_TUNING.GRAB_BLOCK_AFTER_ESCAPE);
    this._grabbedPrev = held;
    if (this.grabBlockT > 0) this.grabBlockT = Math.max(0, this.grabBlockT - dt);
    const list = this.titans;
    for (let i = 0; i < list.length; i++) list[i].update(dt);
    for (let i = list.length - 1; i >= 0; i--) if (list[i].dead) list.splice(i, 1);
  }

  clear() {
    for (const t of this.titans) t.dispose();
    this.titans.length = 0;
    this.grabBlockT = 0; this._grabbedPrev = null;
  }

  remove(t) {
    const i = this.titans.indexOf(t);
    if (i >= 0) this.titans.splice(i, 1);
    t.dispose();
  }

  /** sphere vs titan parts -> [{ titan, part: 'nape'|'eye'|'ankle'|'arm'|'hand'|'body', point }] (per titan, most specific first) */
  hitTest(center, radius) {
    const out = [];
    for (const t of this.titans) if (t.alive) t.hitTest(center, radius, out);
    return out;
  }

  /** living titans only */
  get alive() { return this.titans.filter((t) => t.alive); }
}

export default TitanManager;
