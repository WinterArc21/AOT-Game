// Anime sky: gradient dome with sun glow, painted cumulus sprites, faceted mountain rings. Everything is rendered at
// the far plane (xyww trick) so it never depends on camera.far and never needs to follow the camera.
import * as THREE from 'three';
import { Rng } from './rng.js';
import { SUN_DIR, FOG_COLOR, noise2 } from './common.js';

const FAR_VS = (extra = '') => `
  ${extra}
  void main() {
    vec4 lp = vec4( position, 1.0 );
    #ifdef USE_INSTANCING
      lp = instanceMatrix * lp;
    #endif
    vec3 vp = mat3( modelViewMatrix ) * lp.xyz;
    gl_Position = ( projectionMatrix * vec4( vp, 1.0 ) ).xyww;
    VARYINGS
  }`;

function domeMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
    uniforms: {
      uSun: { value: SUN_DIR.clone() },
      cHorizon: { value: new THREE.Color(FOG_COLOR) },
      cMid: { value: new THREE.Color(0x6fb4f2) },
      cZenith: { value: new THREE.Color(0x1f63d0) },
    },
    vertexShader: 'varying vec3 vDir;\n' + FAR_VS().replace('VARYINGS', 'vDir = position;'),
    fragmentShader: `
      varying vec3 vDir; uniform vec3 uSun, cHorizon, cMid, cZenith;
      void main() {
        vec3 d = normalize( vDir ); float h = d.y;
        vec3 col = mix( cHorizon, cMid, smoothstep( 0.0, 0.22, h ) );
        col = mix( col, cZenith, smoothstep( 0.18, 0.85, h ) );
        col = mix( col, cHorizon, smoothstep( 0.0, -0.12, h ) );
        float sd = max( dot( d, uSun ), 0.0 );
        col += vec3( 1.0, 0.93, 0.75 ) * ( smoothstep( 0.9993, 0.9997, sd ) * 1.5 + pow( sd, 12.0 ) * 0.28 + pow( sd, 3.0 ) * 0.06 );
        // faint anime horizon band
        col += vec3( 0.06, 0.05, 0.02 ) * exp( -abs( h ) * 14.0 );
        gl_FragColor = vec4( col, 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

function mountainRing(radius, base, peak, hazeCol, topCol, seed, nSeg) {
  const rng = new Rng(seed), pos = [], col = [], idx = [];
  const cBase = new THREE.Color(hazeCol), cTop = new THREE.Color(topCol), c = new THREE.Color();
  const rows = 4;
  for (let i = 0; i <= nSeg; i++) {
    const a = (i / nSeg) * Math.PI * 2;
    const ridge = 0.5 + 0.5 * noise2(Math.cos(a) * 2.3 + seed, Math.sin(a) * 2.3);
    const jag = 0.6 + 0.4 * noise2(i * 0.9 + seed, seed * 3.1) + rng.range(-0.15, 0.15);
    const hPeak = peak * Math.max(0.15, ridge * 0.9 + 0.15) * (0.7 + 0.5 * jag);
    const facet = i % 2 ? 0.93 : 1.04;
    for (let r = 0; r < rows; r++) {
      const t = r / (rows - 1);
      pos.push(Math.cos(a) * radius, base + (hPeak - base) * t, Math.sin(a) * radius);
      c.copy(cBase).lerp(cTop, Math.pow(t, 0.8)).multiplyScalar(facet);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < nSeg; i++) for (let r = 0; r < rows - 1; r++) {
    const a = i * rows + r, b = (i + 1) * rows + r;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

function cloudTexture(seed) {
  const rng = new Rng(seed), W = 1024, H = 400, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  // clump of circles: bigger in the middle, flat base
  const base = H * 0.80, circles = [];
  const n = rng.int(9, 14);
  for (let i = 0; i < n; i++) {
    const u = (i + rng.range(-0.3, 0.3)) / (n - 1), mid = 1 - Math.abs(u - 0.5) * 2;
    const r = (50 + mid * 110) * rng.range(0.75, 1.15);
    circles.push({ x: 80 + u * (W - 160), y: base - r * rng.range(0.55, 1.0) - mid * rng.range(20, 90), r });
  }
  for (let i = 0; i < 5; i++) circles.push({ x: W * rng.range(0.3, 0.7), y: base - rng.range(120, 190), r: rng.range(60, 110) });
  const paint = (fill, dx, dy, k) => { x.fillStyle = fill; for (const cc of circles) { x.beginPath(); x.arc(cc.x + dx, cc.y + dy, cc.r * k, 0, 7); x.fill(); } };
  x.save(); x.beginPath(); x.rect(0, 0, W, base + 6); x.clip();
  paint('#9bb8e0', 0, 6, 1.0);        // shadow body
  paint('#d6e6fb', -6, -8, 0.93);     // mid
  paint('#ffffff', -14, -20, 0.8);    // lit top
  paint('#ffffff', -22, -34, 0.55);
  x.restore();
  // soft anime rim on the underside
  const g = x.createLinearGradient(0, base - 30, 0, base + 6); g.addColorStop(0, 'rgba(120,150,200,0)'); g.addColorStop(1, 'rgba(120,150,200,0.45)');
  x.globalCompositeOperation = 'source-atop'; x.fillStyle = g; x.fillRect(0, base - 30, W, 40);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function buildSky(ctx) {
  const scene = ctx.scene;
  scene.background = new THREE.Color(FOG_COLOR);
  scene.fog = new THREE.Fog(FOG_COLOR, 120, 1400);

  const sky = new THREE.Group(); sky.name = 'sky'; scene.add(sky);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 20), domeMaterial());
  dome.renderOrder = -1000; dome.frustumCulled = false; sky.add(dome);

  // mountains: three faceted rings, hazier with distance
  const mkMat = () => new THREE.ShaderMaterial({
    vertexColors: true, side: THREE.DoubleSide, depthWrite: false, depthTest: true, fog: false,
    vertexShader: 'varying vec3 vC;\n' + FAR_VS().replace('VARYINGS', 'vC = color;'),
    fragmentShader: 'varying vec3 vC;\nvoid main() {\n gl_FragColor = vec4( vC, 1.0 );\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
  });
  const rings = [
    mountainRing(1800, -250, 380, 0xb4d0e8, 0x9fbddb, 7, 120),
    mountainRing(1650, -250, 330, 0xa4c3e0, 0x7fa6cb, 13, 110),
    mountainRing(1500, -250, 240, 0x98b9d8, 0x6a93bd, 21, 100),
  ];
  rings.forEach((g, i) => { const m = new THREE.Mesh(g, mkMat()); m.renderOrder = -900 + i; m.frustumCulled = false; sky.add(m); });

  // painted cumulus sprites on the sky sphere (drift slowly)
  const clouds = new THREE.Group(); clouds.name = 'clouds'; scene.add(clouds);
  const rng = new Rng(77);
  const cmat = (tex) => new THREE.ShaderMaterial({
    transparent: true, side: THREE.DoubleSide, depthWrite: false, depthTest: true, fog: false, uniforms: { map: { value: tex } },
    vertexShader: 'varying vec2 vUv;\n' + FAR_VS().replace('VARYINGS', 'vUv = uv;'),
    fragmentShader: 'varying vec2 vUv;\nuniform sampler2D map;\nvoid main() {\n vec4 t = texture2D( map, vUv );\n if ( t.a < 0.02 ) discard;\n gl_FragColor = vec4( t.rgb, t.a );\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
  });
  const plane = new THREE.PlaneGeometry(1, 0.39);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < 3; k++) {
    const count = 7, im = new THREE.InstancedMesh(plane, cmat(cloudTexture(100 + k * 17)), count);
    for (let i = 0; i < count; i++) {
      const az = ((i + k / 3) / count) * Math.PI * 2 + rng.range(-0.25, 0.25), el = rng.range(0.07, 0.42) + (i % 2) * 0.1;
      p.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).multiplyScalar(1500);
      m4.lookAt(new THREE.Vector3(), p, up); q.setFromRotationMatrix(m4);
      const w = rng.range(520, 1150); s.set(w, w, 1);
      m4.compose(p, q, s); im.setMatrixAt(i, m4);
    }
    im.renderOrder = -800 + k; im.frustumCulled = false; clouds.add(im);
  }
  ctx.updaters.push((dt) => { clouds.rotation.y += dt * 0.0035; });
  return { sky, clouds };
}
