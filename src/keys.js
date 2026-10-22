// Key bindings: every game action maps to up to two keys, which the player can change on the KEYS screen.
// Key names are the ones Input uses: 'Z', 'Space', 'ArrowUp', 'ShiftLeft', 'Digit1', 'Comma', ...
// Bindings persist in localStorage. The mouse buttons are fixed extras (see Player.handleInput); Esc always pauses.

export const ACTIONS = [
  { id: 'forward', name: 'Run / pump', group: 'MOVE', keys: ['ArrowUp', 'W'] },
  { id: 'back', name: 'Brake / slacken', group: 'MOVE', keys: ['ArrowDown', 'S'] },
  { id: 'left', name: 'Turn left', group: 'MOVE', keys: ['ArrowLeft', 'A'] },
  { id: 'right', name: 'Turn right', group: 'MOVE', keys: ['ArrowRight', 'D'] },
  { id: 'ropeL', name: 'Left rope', group: 'ROPES', keys: ['Z', 'Q'] },
  { id: 'ropeR', name: 'Right rope', group: 'ROPES', keys: ['X', 'E'] },
  { id: 'land', name: 'Land on rope', group: 'ROPES', keys: ['V'] },
  { id: 'skip', name: 'Next anchor', group: 'ROPES', keys: ['C', 'Tab'] },
  { id: 'gas', name: 'Gas / jump', group: 'GAS', keys: ['ShiftLeft', 'ShiftRight'] },
  { id: 'cut', name: 'Cut / spin', group: 'CUT', keys: ['Space'] },
  { id: 'blades', name: 'Swap blades', group: 'CUT', keys: ['R'] },
  { id: 'whistle', name: 'Whistle horse', group: 'OTHER', keys: ['F'] },
  { id: 'flare', name: 'Fire a signal flare', group: 'OTHER', keys: ['T'] },
  { id: 'pause', name: 'Pause', group: 'OTHER', keys: ['P'] },
  { id: 'mute', name: 'Mute', group: 'OTHER', keys: ['M'] },
  { id: 'card', name: 'Controls card', group: 'OTHER', keys: ['H'] },
  { id: 'quality', name: 'Graphics', group: 'OTHER', keys: ['G'] },
];
export const SLOTS = 2;
const STORE = 'wof.keys';
const DEFAULTS = Object.fromEntries(ACTIONS.map((a) => [a.id, [...a.keys, null, null].slice(0, SLOTS)]));

let map = load();
let byKey = index();
let listeners = [];
/** Bumps on every change, so displays can tell when to redraw. */
export let version = 0;

function load() {
  const m = structuredClone(DEFAULTS);
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved && typeof saved === 'object') for (const id in m) {
      const s = saved[id];
      if (Array.isArray(s)) m[id] = [...s, null, null].slice(0, SLOTS).map((k) => (typeof k === 'string' && k ? k : null));
    }
  } catch { /* storage blocked or bad JSON: defaults */ }
  return m;
}
function index() {
  const ix = new Map();
  for (const id in map) for (const k of map[id]) if (k) ix.set(k, id);
  return ix;
}
function changed() {
  byKey = index(); version++;
  try { localStorage.setItem(STORE, JSON.stringify(map)); } catch { /* not kept */ }
  for (const f of listeners) f();
}

/** The key name Input uses for a KeyboardEvent: 'KeyZ' -> 'Z', everything else is e.code. */
export const keyName = (e) => (e.code && e.code.startsWith('Key') ? e.code.slice(3) : e.code || e.key);
/** Keys bound to an action (slot order, empty slots dropped). */
export const keysFor = (id) => (map[id] || []).filter(Boolean);
/** Key in one slot, or null. */
export const slotKey = (id, slot) => (map[id] && map[id][slot]) || null;
/** The action a key is bound to, or undefined. */
export const actionOf = (k) => byKey.get(k);
export const onChange = (f) => { listeners.push(f); return () => { listeners = listeners.filter((x) => x !== f); }; };

/** Bind key k to an action slot (null clears it). A key belongs to one action only: it leaves its old place. */
export function bind(id, slot, k) {
  if (!map[id]) return;
  if (k) for (const a in map) map[a] = map[a].map((x) => (x === k ? null : x));
  map[id][slot] = k || null;
  changed();
}
export function reset() { map = structuredClone(DEFAULTS); changed(); }

const LABEL = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  ShiftLeft: 'Shift', ShiftRight: 'R Shift', ControlLeft: 'Ctrl', ControlRight: 'R Ctrl', AltLeft: 'Alt', AltRight: 'R Alt',
  MetaLeft: 'Meta', MetaRight: 'R Meta', Escape: 'Esc', Enter: 'Enter', NumpadEnter: 'Num Enter', Backspace: 'Bksp',
  CapsLock: 'Caps', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`', IntlBackslash: '\\', PageUp: 'PgUp', PageDown: 'PgDn',
  Delete: 'Del', Insert: 'Ins', NumpadAdd: 'Num +', NumpadSubtract: 'Num -', NumpadMultiply: 'Num *', NumpadDivide: 'Num /',
  NumpadDecimal: 'Num .', ContextMenu: 'Menu',
};
/** Short keycap text for a key name: 'ArrowUp' -> '↑', 'Digit4' -> '4', 'Numpad4' -> 'Num 4'. */
export function keyLabel(k) {
  if (!k) return '';
  if (LABEL[k]) return LABEL[k];
  if (k.startsWith('Digit')) return k.slice(5);
  if (k.startsWith('Numpad')) return 'Num ' + k.slice(6);
  return k;
}
/** Keycap text for an action's first key ('—' when it has none). */
export const label = (id) => keyLabel(keysFor(id)[0]) || '—';
/** Text with {action} tokens replaced by key labels: 'Hold {ropeR}' -> 'Hold X'. */
export const fill = (s) => String(s).replace(/\{(\w+)\}/g, (m, id) => (map[id] ? label(id) : m));
