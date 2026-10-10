// Procedural canvas textures (painted anime-ish look, tileable). All sizes documented in metres per repeat.
import * as THREE from 'three';
import { Rng } from './rng.js';

function canvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function toTex(c, { repeat = true, aniso = 8, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
function speckle(ctx, rng, w, h, n, amt = 0.07) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = rng.chance(0.5) ? `rgba(0,0,0,${rng.range(0.02, amt)})` : `rgba(255,255,255,${rng.range(0.02, amt)})`;
    const s = rng.range(1, 3);
    ctx.fillRect(rng.range(0, w), rng.range(0, h), s, s);
  }
}
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

/** Masonry courses. W x H px = (W/pxm) x (H/pxm) metres. Block widths wrap so the tile repeats seamlessly. */
function blocks({ seed, W, H, pxm, courseM, minW, maxW, hue, hueVar, sat, lMin, lMax, mortar, wear = 1 }) {
  const rng = new Rng(seed); const [c, ctx] = canvas(W, H);
  ctx.fillStyle = mortar; ctx.fillRect(0, 0, W, H);
  const ch = courseM * pxm, nC = Math.round(H / ch), gap = Math.max(2, pxm * 0.03);
  for (let r = 0; r < nC; r++) {
    // random widths that sum to W
    const ws = []; let sum = 0;
    while (sum < W) { const w = rng.range(minW, maxW) * pxm; ws.push(w); sum += w; }
    const k = W / sum; for (let i = 0; i < ws.length; i++) ws[i] *= k;
    let x = rng.range(0, W);
    for (const w of ws) {
      const y = r * ch;
      for (const ox of [-W, 0, W]) {
        const bx = x + ox; if (bx > W || bx + w < 0) continue;
        const l = rng.range(lMin, lMax), hh = hue + rng.range(-hueVar, hueVar), ss = sat + rng.range(-4, 4);
        const g = ctx.createLinearGradient(0, y, 0, y + ch);
        g.addColorStop(0, hsl(hh, ss, l + 5)); g.addColorStop(0.55, hsl(hh, ss, l)); g.addColorStop(1, hsl(hh, ss + 2, l - 9));
        ctx.fillStyle = g; rr(ctx, bx + gap, y + gap, w - gap * 2, ch - gap * 2, pxm * 0.06); ctx.fill();
        // top highlight + left bevel
        ctx.fillStyle = 'rgba(255,250,235,0.28)'; ctx.fillRect(bx + gap * 1.5, y + gap, w - gap * 3, Math.max(2, pxm * 0.035));
        ctx.fillStyle = 'rgba(40,30,20,0.18)'; ctx.fillRect(bx + gap * 1.5, y + ch - gap - Math.max(2, pxm * 0.05), w - gap * 3, Math.max(2, pxm * 0.05));
        // speckles inside block
        const ns = Math.floor(w * ch / 260 * wear);
        for (let i = 0; i < ns; i++) {
          ctx.fillStyle = rng.chance(0.5) ? 'rgba(30,25,20,0.14)' : 'rgba(255,245,225,0.16)';
          ctx.fillRect(bx + rng.range(gap, w - gap), y + rng.range(gap, ch - gap), rng.range(1, 3.5), rng.range(1, 3));
        }
        // cracks and chips
        if (rng.chance(0.22 * wear)) {
          ctx.strokeStyle = 'rgba(35,28,22,0.55)'; ctx.lineWidth = 1.6; ctx.beginPath();
          let px = bx + rng.range(0.2, 0.8) * w, py = y + gap; ctx.moveTo(px, py);
          for (let i = 0; i < 4; i++) { px += rng.range(-9, 9); py += rng.range(0.1, 0.3) * ch; ctx.lineTo(px, py); }
          ctx.stroke();
        }
        // moss / stain streak
        if (rng.chance(0.2 * wear)) {
          const sx = bx + rng.range(0.1, 0.9) * w, sg = ctx.createLinearGradient(0, y, 0, y + ch);
          sg.addColorStop(0, 'rgba(50,60,35,0.0)'); sg.addColorStop(1, 'rgba(60,72,40,0.35)');
          ctx.fillStyle = sg; ctx.fillRect(sx, y + gap, rng.range(4, 14), ch - gap * 2);
        }
      }
      x += w; if (x > W) x -= W;
    }
  }
  speckle(ctx, rng, W, H, W * H / 120, 0.06);
  return c;
}

export function makeWallStone() { return toTex(blocks({ seed: 11, W: 1024, H: 512, pxm: 128, courseM: 1, minW: 1.5, maxW: 2.6, hue: 38, hueVar: 8, sat: 14, lMin: 56, lMax: 72, mortar: '#6b6256' })); }
export function makePaving() { return toTex(blocks({ seed: 12, W: 512, H: 512, pxm: 128, courseM: 1, minW: 1.0, maxW: 2.0, hue: 40, hueVar: 8, sat: 12, lMin: 62, lMax: 76, mortar: '#7d7366', wear: 0.6 })); }
export function makeHQStone() { return toTex(blocks({ seed: 13, W: 512, H: 512, pxm: 128, courseM: 0.5, minW: 0.7, maxW: 1.4, hue: 30, hueVar: 6, sat: 10, lMin: 60, lMax: 74, mortar: '#6f6558', wear: 0.5 })); }

/** Cobblestone street: 4 x 4 m. */
export function makeCobbles() {
  const rng = new Rng(21), W = 512, [c, ctx] = canvas(W, W);
  ctx.fillStyle = '#5a4d41'; ctx.fillRect(0, 0, W, W);
  const n = 20, cell = W / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const cx = (i + 0.5 + rng.range(-0.12, 0.12)) * cell, cy = (j + 0.5 + rng.range(-0.12, 0.12)) * cell;
    const rx = cell * rng.range(0.36, 0.46), ry = cell * rng.range(0.34, 0.44), l = rng.range(46, 66), hh = rng.range(24, 44);
    for (const ox of [-W, 0, W]) for (const oy of [-W, 0, W]) {
      const px = cx + ox, py = cy + oy; if (px < -cell || px > W + cell || py < -cell || py > W + cell) continue;
      const g = ctx.createRadialGradient(px - rx * 0.3, py - ry * 0.4, 1, px, py, rx * 1.1);
      g.addColorStop(0, hsl(hh, 12, l + 8)); g.addColorStop(1, hsl(hh, 14, l - 8));
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(px, py, rx, ry, rng.range(-0.4, 0.4), 0, Math.PI * 2); ctx.fill();
    }
  }
  speckle(ctx, rng, W, W, 3000, 0.08);
  return toTex(c);
}

/** Dirt road: u across (4 m), v along (4 m); wheel ruts at 30% / 70%. */
export function makeDirt() {
  const rng = new Rng(22), W = 256, [c, ctx] = canvas(W, W);
  ctx.fillStyle = '#b79a6b'; ctx.fillRect(0, 0, W, W);
  for (let i = 0; i < 40; i++) { const x = rng.range(0, W), y = rng.range(0, W), rx = rng.range(10, 30), ry = rng.range(6, 16), a = rng.range(0, 3), col = hsl(34, rng.range(22, 34), rng.range(52, 64), 0.28); for (const ox of [-W, 0, W]) for (const oy of [-W, 0, W]) { ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x + ox, y + oy, rx, ry, a, 0, 7); ctx.fill(); } }
  for (const x of [0.28, 0.72]) { const g = ctx.createLinearGradient((x - 0.08) * W, 0, (x + 0.08) * W, 0); g.addColorStop(0, 'rgba(70,50,30,0)'); g.addColorStop(0.5, 'rgba(70,50,30,0.35)'); g.addColorStop(1, 'rgba(70,50,30,0)'); ctx.fillStyle = g; ctx.fillRect((x - 0.08) * W, 0, 0.16 * W, W); }
  for (let i = 0; i < 90; i++) { const x = rng.range(4, W - 4), y = rng.range(4, W - 4); ctx.fillStyle = hsl(30, 12, rng.range(40, 70), 0.7); ctx.beginPath(); ctx.ellipse(x, y, rng.range(1.5, 4), rng.range(1, 3), 0, 0, 7); ctx.fill(); }
  speckle(ctx, rng, W, W, 1500, 0.1);
  return toTex(c);
}

/** Grass: 8 x 8 m painted tufts (tinted per vertex). */
export function makeGrass() {
  const rng = new Rng(23), W = 512, [c, ctx] = canvas(W, W);
  ctx.fillStyle = '#7ec850'; ctx.fillRect(0, 0, W, W);
  const wrapDraw = (x, y, r, fn) => { for (const ox of [-W, 0, W]) for (const oy of [-W, 0, W]) if (x + ox > -r && x + ox < W + r && y + oy > -r && y + oy < W + r) fn(x + ox, y + oy); };
  for (let i = 0; i < 70; i++) { const x = rng.range(0, W), y = rng.range(0, W), r = rng.range(30, 80), d = rng.chance(0.5); wrapDraw(x, y, r, (px, py) => { const g = ctx.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, d ? 'rgba(40,110,40,0.22)' : 'rgba(190,240,110,0.22)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(px - r, py - r, r * 2, r * 2); }); }
  for (let i = 0; i < 1100; i++) {
    const x = rng.range(0, W), y = rng.range(0, W), h = rng.range(5, 12), lean = rng.range(-3, 3), dark = rng.chance(0.55);
    wrapDraw(x, y, 14, (px, py) => {
      ctx.strokeStyle = dark ? hsl(rng.range(98, 120), 48, rng.range(28, 38), 0.8) : hsl(rng.range(75, 95), 60, rng.range(55, 68), 0.8);
      ctx.lineWidth = rng.range(1.2, 2.2); ctx.beginPath();
      for (const dx of [-3, 0, 3]) { ctx.moveTo(px + dx * 0.6, py); ctx.quadraticCurveTo(px + dx * 0.6 + lean * 0.3, py - h * 0.6, px + dx + lean, py - h * (dx === 0 ? 1 : 0.7)); }
      ctx.stroke();
    });
  }
  for (let i = 0; i < 26; i++) { const x = rng.range(0, W), y = rng.range(0, W), col = rng.pick(['#fff6d8', '#ffe27a', '#ffffff', '#f7a8c8']); wrapDraw(x, y, 6, (px, py) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(px, py, rng.range(1.6, 2.6), 0, 7); ctx.fill(); }); }
  return toTex(c);
}

/** Tree bark: u around (4 m), v along (8 m); long wavy fissures (periodic in v). */
export function makeBark() {
  const rng = new Rng(24), W = 512, H = 1024, [c, ctx] = canvas(W, H);
  ctx.fillStyle = '#8b6a4d'; ctx.fillRect(0, 0, W, H);
  // broad vertical bands of tone
  for (let i = 0; i < 16; i++) { const x = (i / 16) * W + rng.range(-10, 10), g = ctx.createLinearGradient(x, 0, x + W / 16, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, `rgba(${rng.chance(0.5) ? '255,235,200' : '30,20,10'},${rng.range(0.06, 0.16)})`); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(x, 0, W / 16, H); }
  const fissure = (x0, k, amp, phase, w, col, dx = 0) => {
    for (const ox of [-W, 0, W]) {
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath();
      for (let y = -8; y <= H + 8; y += 8) { const x = x0 + ox + dx + Math.sin((y / H) * Math.PI * 2 * k + phase) * amp; if (y === -8) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
    }
  };
  for (let i = 0; i < 46; i++) {
    const x0 = rng.range(0, W), k = rng.int(1, 4), amp = rng.range(2, 12), ph = rng.range(0, 6.28), w = rng.range(3, 9);
    fissure(x0, k, amp, ph, w + 4, 'rgba(50,34,22,0.30)');
    fissure(x0, k, amp, ph, w, 'rgba(34,22,14,0.82)');
    fissure(x0, k, amp, ph, w * 0.35, 'rgba(255,230,190,0.30)', -w * 0.9);
  }
  for (let i = 0; i < 260; i++) { const x = rng.range(0, W), y = rng.range(0, H); ctx.fillStyle = 'rgba(30,20,12,0.4)'; ctx.fillRect(x, y, rng.range(6, 20), rng.range(1.5, 3)); }
  for (let i = 0; i < 40; i++) { const x = rng.range(0, W), y = rng.range(0, H), r = rng.range(8, 26); for (const ox of [-W, 0, W]) { ctx.fillStyle = `hsla(${rng.range(85, 110)},45%,40%,${rng.range(0.18, 0.32)})`; ctx.beginPath(); ctx.ellipse(x + ox, y, r * 0.7, r * 1.5, 0, 0, 7); ctx.fill(); } }
  speckle(ctx, rng, W, H, 9000, 0.08);
  return toTex(c);
}

/** Roof tiles: 3 x 3 m. kind 'clay' (orange, scalloped) or 'slate'. */
export function makeRoof(kind = 'clay') {
  const rng = new Rng(kind === 'clay' ? 31 : 32), W = 512, H = 512, [c, ctx] = canvas(W, H);
  const rows = 12, rh = H / rows, nt = kind === 'clay' ? 8 : 10, tw = W / nt;
  ctx.fillStyle = kind === 'clay' ? '#6a2a18' : '#2c3948'; ctx.fillRect(0, 0, W, H);
  for (let r = 0; r < rows; r++) {
    const y = H - (r + 1) * rh;           // bottom row first (canvas bottom = eave side)
    const off = (r % 2) * tw / 2;
    for (let i = -1; i <= nt; i++) {
      const x = i * tw + off, hh = kind === 'clay' ? rng.range(10, 20) : rng.range(205, 215), ss = kind === 'clay' ? rng.range(62, 72) : 14, ll = kind === 'clay' ? rng.range(42, 54) : rng.range(36, 48);
      const g = ctx.createLinearGradient(0, y, 0, y + rh * 1.6);
      g.addColorStop(0, hsl(hh, ss, ll + 9)); g.addColorStop(1, hsl(hh, ss, ll - 8));
      ctx.fillStyle = g; ctx.beginPath();
      if (kind === 'clay') { ctx.moveTo(x + 1.5, y - rh * 0.6); ctx.lineTo(x + tw - 1.5, y - rh * 0.6); ctx.lineTo(x + tw - 1.5, y + rh * 0.5); ctx.arc(x + tw / 2, y + rh * 0.5, tw / 2 - 1.5, 0, Math.PI); ctx.closePath(); }
      else { ctx.rect(x + 1.5, y - rh * 0.6, tw - 3, rh * 1.6 - 1); }
      ctx.fill();
      ctx.strokeStyle = kind === 'clay' ? 'rgba(60,20,10,0.75)' : 'rgba(10,16,24,0.7)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = 'rgba(255,230,200,0.18)'; ctx.fillRect(x + 4, y - rh * 0.5, tw - 8, 3);
    }
  }
  speckle(ctx, rng, W, H, 5000, 0.07);
  return toTex(c);
}

/** Half-timbered plaster wall: 6 m wide x 3.8 m (one storey). variant 0 = braced+shutters, 1 = plain with arched windows. */
export function makePlaster(variant = 0, shutter = '#3f7a52') {
  const rng = new Rng(40 + variant), W = 768, H = 512, [c, ctx] = canvas(W, H);
  const pxx = W / 6, pxy = H / 3.8;
  ctx.fillStyle = '#fbf6ea'; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 40; i++) { const x = rng.range(0, W), y = rng.range(0, H), r = rng.range(20, 60); const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(${rng.chance(0.5) ? '120,100,70' : '255,255,255'},0.10)`); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
  const g2 = ctx.createLinearGradient(0, H * 0.78, 0, H); g2.addColorStop(0, 'rgba(90,70,50,0)'); g2.addColorStop(1, 'rgba(90,70,50,0.16)'); ctx.fillStyle = g2; ctx.fillRect(0, H * 0.78, W, H * 0.22);
  speckle(ctx, rng, W, H, 3000, 0.05);
  const timber = (x, y, w, h) => {
    ctx.fillStyle = '#4b2f1d'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,220,170,0.15)'; if (w > h) ctx.fillRect(x, y + 1, w, 2); else ctx.fillRect(x + 1, y, 2, h);
    ctx.strokeStyle = 'rgba(20,10,5,0.4)'; ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) { ctx.beginPath(); if (w > h) { const yy = y + rng.range(2, h - 2); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy + rng.range(-1.5, 1.5)); } else { const xx = x + rng.range(2, w - 2); ctx.moveTo(xx, y); ctx.lineTo(xx + rng.range(-1.5, 1.5), y + h); } ctx.stroke(); }
  };
  const beam = variant === 0 ? 0.2 : 0.13, bx = beam * pxy, post = beam * pxx;
  // window
  const win = (cx, wM, hM, yTopM, arched) => {
    const w = wM * pxx, h = hM * pxy, x = cx - w / 2, y = yTopM * pxy;
    // shutters
    for (const s of [-1, 1]) {
      const sw = w * 0.5, sx = s < 0 ? x - sw - 3 : x + w + 3;
      ctx.fillStyle = shutter; ctx.fillRect(sx, y, sw, h);
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1.5; for (let k = 1; k < 7; k++) { ctx.beginPath(); ctx.moveTo(sx, y + (k / 7) * h); ctx.lineTo(sx + sw, y + (k / 7) * h); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.strokeRect(sx + 1, y + 1, sw - 2, h - 2);
    }
    ctx.fillStyle = '#f3ead2'; ctx.beginPath();
    if (arched) { ctx.moveTo(x - 5, y + h + 5); ctx.lineTo(x - 5, y + w / 2); ctx.arc(cx, y + w / 2, w / 2 + 5, Math.PI, 0); ctx.lineTo(x + w + 5, y + h + 5); } else ctx.rect(x - 5, y - 5, w + 10, h + 10);
    ctx.fill();
    const gg = ctx.createLinearGradient(x, y, x + w, y + h); gg.addColorStop(0, '#9cc3dc'); gg.addColorStop(0.45, '#3b5878'); gg.addColorStop(1, '#22344f');
    ctx.fillStyle = gg; ctx.beginPath();
    if (arched) { ctx.moveTo(x, y + h); ctx.lineTo(x, y + w / 2); ctx.arc(cx, y + w / 2, w / 2, Math.PI, 0); ctx.lineTo(x + w, y + h); } else ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.fillStyle = '#f3ead2'; ctx.fillRect(cx - 2, y, 4, h); ctx.fillRect(x, y + h * 0.42, w, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.moveTo(x + 4, y + h * 0.4); ctx.lineTo(x + w * 0.4, y + 4); ctx.lineTo(x + w * 0.55, y + 4); ctx.lineTo(x + 4, y + h * 0.65); ctx.fill();
    ctx.fillStyle = '#5a3a24'; ctx.fillRect(x - 9, y + h + 5, w + 18, 9);
    if (rng.chance(0.55)) { for (let k = 0; k < 7; k++) { ctx.fillStyle = rng.pick(['#e24a5a', '#f4c542', '#f08fb0', '#ffffff']); ctx.beginPath(); ctx.arc(x + 4 + k * (w / 6.5), y + h + 2, 4, 0, 7); ctx.fill(); } ctx.fillStyle = '#3f8a3a'; ctx.fillRect(x - 6, y + h + 6, w + 12, 3); }
  };
  if (variant === 0) {
    // braces in each panel corner, X pattern
    ctx.save();
    for (const px of [0, 3, 6]) { /* posts drawn later */ }
    for (const [x0, x1] of [[0, 3], [3, 6]]) {
      for (const dir of [1, -1]) {
        const ax = (dir > 0 ? x0 : x1) * pxx + dir * post / 2, bx2 = ax + dir * 1.1 * pxx;
        timber(0, 0, 0, 0);
        ctx.strokeStyle = '#4b2f1d'; ctx.lineWidth = 0.17 * pxx; ctx.lineCap = 'butt';
        ctx.beginPath(); ctx.moveTo(ax, H - bx); ctx.lineTo(bx2, H - bx - 1.1 * pxx); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ax, bx); ctx.lineTo(bx2, bx + 1.1 * pxx); ctx.stroke();
      }
    }
    ctx.restore();
  }
  // frame
  timber(0, 0, W, bx / 2); timber(0, H - bx / 2, W, bx / 2);
  timber(0, 0, post / 2, H); timber(W - post / 2, 0, post / 2, H); timber(W / 2 - post / 2, 0, post, H);
  if (variant === 0) { win(W * 0.25, 0.95, 1.35, 0.95, false); win(W * 0.75, 0.95, 1.35, 0.95, false); }
  else { win(W * 0.25, 0.9, 1.6, 0.85, true); win(W * 0.75, 0.9, 1.6, 0.85, true); timber(0, H * 0.47, W, bx * 0.5); }
  return toTex(c);
}

/** Wooden planks: 1 x 1 m, planks run along v. */
export function makePlanks() {
  const rng = new Rng(50), W = 256, [c, ctx] = canvas(W, W);
  const n = 5, pw = W / n;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = hsl(rng.range(26, 34), rng.range(40, 52), rng.range(42, 54)); ctx.fillRect(i * pw, 0, pw, W);
    ctx.strokeStyle = 'rgba(60,35,15,0.35)'; ctx.lineWidth = 1.5;
    for (let k = 0; k < 7; k++) { const x = i * pw + rng.range(3, pw - 3); ctx.beginPath(); ctx.moveTo(x, 0); ctx.bezierCurveTo(x + rng.range(-4, 4), W * 0.3, x + rng.range(-4, 4), W * 0.7, x, W); ctx.stroke(); }
    ctx.fillStyle = 'rgba(25,12,5,0.7)'; ctx.fillRect(i * pw, 0, 3, W);
    ctx.fillStyle = '#3a2a20'; for (const y of [18, W - 18]) { ctx.beginPath(); ctx.arc(i * pw + pw / 2, y, 2.4, 0, 7); ctx.fill(); }
  }
  speckle(ctx, rng, W, W, 1200, 0.07);
  return toTex(c);
}

/** Rocky / mossy ground detail for rocks (uses vertex colours mostly). */
export function makeRockTex() {
  const rng = new Rng(60), W = 256, [c, ctx] = canvas(W, W);
  ctx.fillStyle = '#9a968c'; ctx.fillRect(0, 0, W, W);
  for (let i = 0; i < 60; i++) { ctx.strokeStyle = `rgba(30,28,25,${rng.range(0.1, 0.35)})`; ctx.lineWidth = rng.range(1, 3); ctx.beginPath(); let x = rng.range(0, W), y = rng.range(0, W); ctx.moveTo(x, y); for (let k = 0; k < 4; k++) { x += rng.range(-30, 30); y += rng.range(-30, 30); ctx.lineTo(x, y); } ctx.stroke(); }
  for (let i = 0; i < 20; i++) { ctx.fillStyle = `hsla(${rng.range(80, 110)},40%,42%,0.25)`; ctx.beginPath(); ctx.ellipse(rng.range(0, W), rng.range(0, W), rng.range(10, 30), rng.range(8, 20), 0, 0, 7); ctx.fill(); }
  speckle(ctx, rng, W, W, 2500, 0.1);
  return toTex(c);
}

/** Flags. kind: 'survey' (Wings of Freedom) | 'garrison' (rose). 3:2 cloth. */
export function makeFlag(kind) {
  const W = 512, H = 340, [c, ctx] = canvas(W, H);
  if (kind === 'survey') {
    ctx.fillStyle = '#f2ecda'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#2e6b45'; ctx.lineWidth = 16; ctx.strokeRect(8, 8, W - 16, H - 16);
    // shield
    const cx = W / 2, cy = H / 2 + 6;
    ctx.fillStyle = '#d9d2bd'; ctx.strokeStyle = '#1f1a16'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(cx - 92, cy - 120); ctx.lineTo(cx + 92, cy - 120); ctx.lineTo(cx + 92, cy + 20); ctx.quadraticCurveTo(cx + 92, cy + 100, cx, cy + 130); ctx.quadraticCurveTo(cx - 92, cy + 100, cx - 92, cy + 20); ctx.closePath(); ctx.fill(); ctx.stroke();
    const wing = (dir, col) => {
      ctx.save(); ctx.translate(cx + dir * 4, cy + 4); ctx.scale(dir, 1);
      ctx.fillStyle = col; ctx.strokeStyle = '#1f1a16'; ctx.lineWidth = 5; ctx.beginPath();
      ctx.moveTo(-6, 70); ctx.bezierCurveTo(-4, 20, -26, -50, -96 + 10, -100); ctx.bezierCurveTo(-60, -100, -34, -92, -14, -78);
      ctx.bezierCurveTo(-66, -68, -52, -30, -22, 0);                       // feather steps
      ctx.bezierCurveTo(-60, -10, -52, 24, -16, 38);
      ctx.bezierCurveTo(-46, 36, -40, 62, -6, 70); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    };
    ctx.save(); ctx.translate(-26, 0); wing(-1, '#ffffff'); ctx.restore();
    ctx.save(); ctx.translate(26, 0); ctx.translate(cx, cy); ctx.rotate(0); ctx.translate(-cx, -cy); wing(1, '#2f66c8'); ctx.restore();
  } else {
    ctx.fillStyle = '#9d2a2e'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#e7c35a'; ctx.fillRect(0, 0, W, 18); ctx.fillRect(0, H - 18, W, 18);
    const cx = W / 2, cy = H / 2;
    ctx.fillStyle = '#e9e1cf'; ctx.beginPath(); ctx.arc(cx, cy, 108, 0, 7); ctx.fill(); ctx.strokeStyle = '#2a1a14'; ctx.lineWidth = 7; ctx.stroke();
    for (let k = 0; k < 6; k++) { ctx.save(); ctx.translate(cx, cy); ctx.rotate(k * 1.0472); ctx.fillStyle = k % 2 ? '#c63a46' : '#a82b3a'; ctx.beginPath(); ctx.ellipse(0, -48, 34, 52, 0, 0, 7); ctx.fill(); ctx.stroke(); ctx.restore(); }
    ctx.fillStyle = '#7a1a26'; ctx.beginPath(); ctx.arc(cx, cy, 28, 0, 7); ctx.fill(); ctx.stroke();
  }
  return toTex(c, { aniso: 4 });
}

/** Garrison / church stone wall with arched windows: 6 m wide x 5 m tall tile. */
export function makeHQWall() {
  const W = 768, H = 640, pxm = 128;
  const c = blocks({ seed: 14, W, H, pxm, courseM: 0.5, minW: 0.7, maxW: 1.5, hue: 36, hueVar: 6, sat: 12, lMin: 62, lMax: 76, mortar: '#756b5d', wear: 0.5 });
  const ctx = c.getContext('2d');
  const win = (cx, wM, hM, yTopM) => {
    const w = wM * pxm, h = hM * pxm, x = cx - w / 2, y = yTopM * pxm;
    ctx.fillStyle = '#e9e0cc'; ctx.beginPath(); ctx.moveTo(x - 10, y + h + 10); ctx.lineTo(x - 10, y + w / 2); ctx.arc(cx, y + w / 2, w / 2 + 10, Math.PI, 0); ctx.lineTo(x + w + 10, y + h + 10); ctx.fill();
    ctx.strokeStyle = '#4a4034'; ctx.lineWidth = 3; ctx.stroke();
    const g = ctx.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, '#7fa6c8'); g.addColorStop(0.5, '#2f4764'); g.addColorStop(1, '#1b2a40');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x, y + w / 2); ctx.arc(cx, y + w / 2, w / 2, Math.PI, 0); ctx.lineTo(x + w, y + h); ctx.fill();
    ctx.fillStyle = '#e9e0cc'; ctx.fillRect(cx - 3, y, 6, h); ctx.fillRect(x, y + h * 0.5, w, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.beginPath(); ctx.moveTo(x + 6, y + h * 0.45); ctx.lineTo(x + w * 0.5, y + 6); ctx.lineTo(x + w * 0.7, y + 6); ctx.lineTo(x + 6, y + h * 0.7); ctx.fill();
    ctx.fillStyle = '#c9bfa8'; ctx.fillRect(x - 14, y + h + 10, w + 28, 10);
  };
  win(W * 0.25, 1.0, 2.3, 1.2); win(W * 0.75, 1.0, 2.3, 1.2);
  ctx.fillStyle = 'rgba(40,30,20,0.35)'; ctx.fillRect(0, 0, W, 5); ctx.fillStyle = 'rgba(255,245,225,0.25)'; ctx.fillRect(0, 5, W, 4);
  return toTex(c);
}
