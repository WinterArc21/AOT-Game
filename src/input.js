// Keyboard + mouse state with pointer lock. `pressed` holds edges since the last consume().
// If the browser refuses pointer lock (an embedding frame without the permission, or the user declines),
// `freeLook` mode reads raw mouse movement with a visible cursor and keeps turning while the cursor
// is pushed against a screen edge.
export class Input {
  constructor(el) {
    this.el = el;
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0;
    this.locked = false;
    this.lockDenied = false;
    this.freeLook = false;
    this.cx = innerWidth / 2; this.cy = innerHeight / 2; this.inside = false;
    this.enabled = true;
    this.capture = true;   // swallow game keys (arrows, Space, Shift) so the page never scrolls while playing
    const key = (e) => (e.code === 'Space' ? 'Space' : e.code.startsWith('Key') ? e.code.slice(3) : e.code);
    addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      const k = key(e);
      if (this.capture && (['Space', 'Tab', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k) || (this.locked && !e.metaKey && !e.ctrlKey))) e.preventDefault();
      if (!this.down.has(k)) this.pressed.add(k);
      this.down.add(k);
    });
    addEventListener('keyup', (e) => { const k = key(e); this.down.delete(k); this.released.add(k); });
    addEventListener('blur', () => { for (const k of this.down) this.released.add(k); this.down.clear(); });
    el.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      const k = 'Mouse' + e.button;
      if (!this.down.has(k)) this.pressed.add(k);
      this.down.add(k);
      e.preventDefault();
    });
    addEventListener('mouseup', (e) => { const k = 'Mouse' + e.button; this.down.delete(k); this.released.add(k); });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      this.cx = e.clientX; this.cy = e.clientY; this.inside = true;
      if (!this.locked && !this.freeLook) return;
      this.mouseDX += e.movementX || 0; this.mouseDY += e.movementY || 0;
    });
    document.addEventListener('mouseleave', () => { this.inside = false; });
    document.addEventListener('pointerlockerror', () => this._denied());
    addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
      if (!this.locked) { for (const k of this.down) this.released.add(k); this.down.clear(); }
      this.onLockChange?.(this.locked);
    });
  }
  lock() {
    const el = this.el;
    if (!el.requestPointerLock) { this._denied(); return; }
    const plain = () => {
      try { const q = el.requestPointerLock(); if (q && q.catch) q.catch(() => this._denied()); }
      catch { this._denied(); }
    };
    let p;
    try { p = el.requestPointerLock({ unadjustedMovement: true }); }
    catch { plain(); return; }
    // raw input is not supported everywhere (some Linux/macOS setups reject it): fall back to a plain request
    if (p && p.catch) p.catch((err) => { if (err && err.name === 'NotSupportedError') plain(); else this._denied(); });
  }
  _denied() {
    if (this.locked) return;
    const first = !this.lockDenied;
    this.lockDenied = true;
    if (first) this.onLockDenied?.();
  }
  /** Free-cursor fallback: keep turning while the cursor is pushed into a screen edge. */
  edgeTurn(dt) {
    if (this.locked || !this.freeLook || !this.inside) return;
    const w = innerWidth, h = innerHeight, mx = w * 0.07, my = h * 0.07;
    if (this.cx < mx) this.mouseDX -= ((mx - this.cx) / mx) * 900 * dt;
    else if (this.cx > w - mx) this.mouseDX += ((this.cx - (w - mx)) / mx) * 900 * dt;
    if (this.cy < my) this.mouseDY -= ((my - this.cy) / my) * 450 * dt;
    else if (this.cy > h - my) this.mouseDY += ((this.cy - (h - my)) / my) * 450 * dt;
  }
  unlock() { document.exitPointerLock?.(); }
  held(k) { return this.down.has(k); }
  hit(k) { return this.pressed.has(k); }
  up(k) { return this.released.has(k); }
  consume() { this.pressed.clear(); this.released.clear(); this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0; }
}
