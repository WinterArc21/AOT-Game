// The MISSIONS screen: every mission in story order, its chapters, and which chapters the player has opened.
// A mission is a mode ('gate', 'scout') that Game (src/game.js) starts at a chapter; finishing a chapter opens the
// next (Game.chapterDone). Progress is kept in the browser (wof.progress: { [mission]: chapters open }).
import { CHAPTERS as SCOUT } from './scout.js';

export const MISSIONS = [
  {
    id: 'gate', title: 'The Struggle for Trost', place: 'Trost District', eps: 'Season 1, episodes 11–13',
    chapters: [{ title: 'Plug the Gate', desc: 'Guard Eren while he carries the boulder to the breach' }],
  },
  { id: 'scout', title: 'The 57th Expedition', place: 'Beyond Wall Rose', eps: 'Season 1, episodes 17–22', chapters: SCOUT },
];

const KEY = 'wof.progress';
function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } }

/** Chapters open in a mission (the first is always open). */
export const opened = (id) => Math.max(1, load()[id] || 1);
/** Open chapter `ch` (0-based) of a mission, and every chapter before it. */
export function unlock(id, ch) {
  const p = load();
  p[id] = Math.max(p[id] || 1, ch + 1);
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* not kept */ }
}
/** For the HUD: the missions with each chapter's title, episodes, line and whether it's still locked. */
export function missionList() {
  return MISSIONS.map((m) => {
    const n = opened(m.id);
    return { id: m.id, title: m.title, place: m.place, eps: m.eps, chapters: m.chapters.map((c, i) => ({ title: c.title, eps: c.eps, desc: c.desc, locked: i >= n })) };
  });
}
