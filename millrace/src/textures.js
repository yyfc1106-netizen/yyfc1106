// Procedural textures for the mill scene: everything is drawn on canvases at start-up, no image files.
// Value-noise fbm drives the soft, painterly look (grass, soil, rock, wood grain); masonry and pebbles are drawn explicitly.

import * as THREE from 'three';

export function rng(seed) {
  let s = seed | 0;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Tileable value-noise fbm: returns f(u, v, freq = 8, octaves = 4) in 0..1. */
export function noiseField(seed) {
  const r = rng(seed), N = 128, lat = new Float32Array(N * N);
  for (let i = 0; i < lat.length; i++) lat[i] = r();
  const wrap = (a) => ((a % N) + N) % N;
  const sample = (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = lat[wrap(y0) * N + wrap(x0)], b = lat[wrap(y0) * N + wrap(x0 + 1)], c = lat[wrap(y0 + 1) * N + wrap(x0)], d = lat[wrap(y0 + 1) * N + wrap(x0 + 1)];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  return (u, v, freq = 8, oct = 4) => {
    let sum = 0, amp = 0.5, norm = 0, f = freq;
    for (let o = 0; o < oct; o++) { sum += sample(u * f, v * f) * amp; norm += amp; amp *= 0.5; f *= 2; }
    return sum / norm;
  };
}

const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const clamp01 = (x) => Math.min(1, Math.max(0, x));

function canvasTex(w, h, draw, { srgb = true, aniso = 4, repeat = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso; if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Fill a canvas pixel by pixel from f(u, v) -> [r, g, b]. */
function pixels(g, w, h, f) {
  const img = g.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4, p = f(x / w, y / h, x, y);
    d[o] = p[0]; d[o + 1] = p[1]; d[o + 2] = p[2]; d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

export function makeTextures(aniso = 4) {
  const n1 = noiseField(11), n2 = noiseField(29), n3 = noiseField(47), n4 = noiseField(83);
  const T = {};
  const opt = { aniso };

  // --- grass: soft sage-green mottling
  T.grass = canvasTex(256, 256, (g, w, h) => pixels(g, w, h, (u, v) => {
    const a = n1(u, v, 5, 4), b = n2(u, v, 24, 3), c = n3(u, v, 3, 2);
    const base = mix3([150, 176, 108], [190, 205, 148], a);
    const k = 0.88 + b * 0.22 + (c - 0.5) * 0.2;
    return [base[0] * k, base[1] * k, base[2] * k];
  }), opt);

  // --- strata: topsoil, clay, gravel with pastel pebbles, bedrock (v: 0 bottom .. 1 top)
  T.strata = canvasTex(256, 512, (g, w, h) => {
    const wob = (u) => (n1(u, 0.31, 7, 3) - 0.5) * 0.03;
    const edges = [0.04, 0.15, 0.32, 0.47]; // distances from the top, as fractions of the height
    pixels(g, w, h, (u, v) => {
      const d = v; // canvas y runs top to bottom, so d = 0 is the top of the strata
      const e = edges.map((x, i) => x + wob(u + i * 0.37));
      const fine = n2(u, v, 40, 3), streak = n3(u * 3, v * 0.4, 14, 3);
      let col;
      if (d < e[0]) col = mix3([52, 38, 26], [66, 48, 32], fine); // dark humus
      else if (d < e[1]) col = mix3([108, 76, 48], [136, 98, 62], fine * 0.7 + streak * 0.5); // topsoil
      else if (d < e[2]) col = mix3([190, 138, 88], [214, 164, 108], streak * 0.8 + fine * 0.3); // clay
      else if (d < e[3]) col = mix3([150, 140, 118], [168, 158, 134], fine); // gravel bed
      else { const rock = n4(u * 2.5, v * 0.5, 18, 4); col = mix3([108, 106, 104], [138, 136, 132], rock * 0.8 + fine * 0.3); }
      const edgeDark = [0, 1, 2, 3].some((i) => Math.abs(d - e[i]) < 0.003) ? 0.82 : 1;
      return [col[0] * edgeDark, col[1] * edgeDark, col[2] * edgeDark];
    });
    const r = rng(5), pebble = ['#dcb9a8', '#e8e1c6', '#b7b09c', '#cdb892', '#e9c9c0', '#a9a69a'];
    const y0 = (edges[2] + 0.01) * h, y1 = (edges[3] - 0.01) * h;
    for (let i = 0; i < 650; i++) {
      g.fillStyle = pebble[(r() * pebble.length) | 0]; g.globalAlpha = 0.65 + r() * 0.3;
      g.beginPath(); g.ellipse(r() * w, y0 + r() * (y1 - y0), 1.4 + r() * 2.6, 1.0 + r() * 1.8, r() * 3, 0, 6.3); g.fill();
    }
    g.globalAlpha = 0.45; g.strokeStyle = '#3d362d'; g.lineWidth = 1;
    for (let i = 0; i < 200; i++) { // bedrock cracks
      let x = r() * w, y = (edges[3] + 0.03 + r() * 0.5) * h; g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 4; k++) { x += (r() - 0.5) * 7; y += 4 + r() * 12; g.lineTo(x, y); }
      g.stroke();
    }
    g.globalAlpha = 0.35; g.strokeStyle = '#4b3524'; g.lineWidth = 1.2;
    for (let i = 0; i < 80; i++) { // roots and grit in the topsoil
      const x = r() * w, y = (edges[0] + r() * (edges[1] - edges[0])) * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 8, y + 6 + r() * 14); g.stroke();
    }
    g.globalAlpha = 1;
  }, { aniso });

  // --- masonry: courses of beige and grey blocks with dark mortar
  T.masonry = canvasTex(256, 256, (g, w, h) => {
    const r = rng(5); g.fillStyle = '#7d7666'; g.fillRect(0, 0, w, h);
    const rows = 8, rh = h / rows;
    for (let row = 0; row < rows; row++) {
      let x = -r() * 55;
      while (x < w) {
        const bw = 36 + r() * 40, tone = 176 + r() * 36, warm = r() * 14 - 4;
        g.fillStyle = `rgb(${tone + warm},${tone + warm * 0.4 - 2},${tone - 12})`;
        const blk = (xx) => g.fillRect(xx + 1.5, row * rh + 1.5, bw - 3, rh - 3);
        blk(x); if (x + bw > w) blk(x - w);
        x += bw;
      }
    }
    const img = g.getImageData(0, 0, w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, k = 0.82 + n1(x / w, y / h, 16, 4) * 0.34 + (n2(x / w, y / h, 64, 2) - 0.5) * 0.12;
      d[o] *= k; d[o + 1] *= k; d[o + 2] *= k;
    }
    g.putImageData(img, 0, 0);
    g.fillStyle = 'rgba(70,60,45,0.5)';
    for (let i = 0; i < 260; i++) { g.beginPath(); g.ellipse(r() * w, r() * h, 0.5 + r() * 1.1, 0.5 + r() * 1.1, r() * 3, 0, 6.3); g.fill(); }
  }, opt);

  // --- wood: warm tan boards with wavy grain, plank seams and knots
  const wood = (seed, lo, hi, boards) => canvasTex(128, 128, (g, w, h) => {
    const r = rng(seed), tone = Array.from({ length: boards }, () => 0.9 + r() * 0.2);
    pixels(g, w, h, (u, v) => {
      const b = Math.floor(v * boards), bv = v * boards - b;
      const warp = n1(u, v * 0.3, 5, 3) * 5 + n2(u * 2, b, 9, 2) * 2;
      const line = 0.5 + 0.5 * Math.sin(6.283 * (bv * 7 + warp));
      const t = Math.pow(line, 2.2) * 0.65 + n3(u, v, 40, 2) * 0.35;
      const c = mix3(lo, hi, t), k = tone[b] * (bv < 0.03 || bv > 0.97 ? 0.62 : 1);
      return [c[0] * k, c[1] * k, c[2] * k];
    });
    g.fillStyle = 'rgba(95,60,30,0.5)';
    for (let i = 0; i < 5; i++) { g.beginPath(); g.ellipse(r() * w, r() * h, 3 + r() * 3, 1.5 + r() * 1.6, 0, 0, 6.3); g.fill(); }
  }, opt);
  T.oak = wood(3, [196, 142, 84], [226, 176, 112], 3);
  T.oakPale = wood(9, [226, 188, 130], [244, 214, 160], 4);
  T.floor = wood(13, [214, 176, 120], [240, 208, 156], 6);

  // --- paving slabs for the tail race
  T.paving = canvasTex(128, 128, (g, w, h) => {
    const r = rng(21); g.fillStyle = '#8c8b86'; g.fillRect(0, 0, w, h);
    for (let row = 0; row < 4; row++) { let x = -r() * 20; while (x < w) { const bw = 20 + r() * 26, t = 150 + r() * 40; g.fillStyle = `rgb(${t},${t - 2},${t - 8})`; g.fillRect(x + 1, row * 32 + 1, bw - 2, 30); x += bw; } }
    const img = g.getImageData(0, 0, w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4, k = 0.86 + n2(x / w, y / h, 20, 3) * 0.28; d[o] *= k; d[o + 1] *= k; d[o + 2] *= k; }
    g.putImageData(img, 0, 0);
  }, opt);

  // --- millstone face: eight harps of parallel furrows between lands
  T.millstone = (flip) => canvasTex(256, 256, (g, w, h) => {
    pixels(g, w, h, (u, v) => { const k = 0.86 + n1(u, v, 28, 3) * 0.3; return [207 * k, 196 * k, 173 * k]; });
    g.save(); g.translate(w / 2, h / 2); if (flip) g.scale(-1, 1);
    const R = w * 0.5;
    for (let i = 0; i < 8; i++) {
      g.save(); g.rotate((i * Math.PI) / 4);
      g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R, 0, Math.PI / 4); g.closePath(); g.clip();
      g.strokeStyle = 'rgba(96,86,70,0.75)'; g.lineWidth = 1;
      for (let k = 1; k < 10; k++) { const off = k * R * 0.085 + R * 0.04; g.beginPath(); g.moveTo(off * 0.5, -R * 0.1); g.lineTo(off * 0.5 + R * 0.95, off - R * 0.05); g.stroke(); }
      g.restore();
    }
    g.fillStyle = '#cfc4ad'; g.beginPath(); g.arc(0, 0, R * 0.18, 0, 6.3); g.fill();
    g.strokeStyle = 'rgba(96,86,70,0.8)'; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, R * 0.18, 0, 6.3); g.stroke(); g.restore();
  }, { aniso, repeat: false });

  T.burlap = canvasTex(128, 128, (g, w, h) => pixels(g, w, h, (u, v, x, y) => { const k = 0.86 + ((x + y) % 4 < 2 ? 0.08 : 0) + n1(u, v, 30, 2) * 0.2; return [205 * k, 178 * k, 128 * k]; }), opt);
  T.grain = canvasTex(128, 128, (g, w, h) => { const r = rng(2); g.fillStyle = '#d8b25a'; g.fillRect(0, 0, w, h); for (let i = 0; i < 700; i++) { g.fillStyle = r() < 0.5 ? '#b98f3a' : '#ecd08a'; g.beginPath(); g.ellipse(r() * w, r() * h, 2.2, 1.1, r() * 3, 0, 6.3); g.fill(); } }, opt);
  T.flour = canvasTex(128, 128, (g, w, h) => pixels(g, w, h, (u, v) => { const k = 0.92 + n2(u, v, 24, 3) * 0.1; return [248 * k, 244 * k, 232 * k]; }), opt);
  T.plinth = canvasTex(256, 64, (g, w, h) => { pixels(g, w, h, (u, v) => { const k = 0.85 + n1(u, v, 20, 3) * 0.3; return [186 * k, 160 * k, 118 * k]; }); g.fillStyle = 'rgba(90,70,45,0.6)'; for (let i = 0; i < 16; i++) g.fillRect(i * 16, 0, 1.5, h); }, opt);
  return T;
}
