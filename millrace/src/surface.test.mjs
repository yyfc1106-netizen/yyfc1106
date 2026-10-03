import { WaterSurface } from './surface.js';
const holder = { add() {} };
const w = new WaterSurface(holder);
// 20 x 10 lattice of particles, spacing 0.04, in the (y,z) plane
const pts = []; for (let i = 0; i < 20; i++) for (let j = 0; j < 10; j++) pts.push(0, 3 + i * 0.04, 0.5 + j * 0.04);
const f = Float32Array.from(pts), t0 = performance.now();
const nv = w.update(f, pts.length / 3);
console.log('block: verts', nv, 'ms', (performance.now() - t0).toFixed(1));
if (nv < 300) throw new Error('block should produce a surface');
let ymin = 1e9, ymax = -1e9; for (let i = 0; i < nv; i++) { const y = w.pos[i * 3 + 1]; ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
console.log('y range', ymin.toFixed(2), ymax.toFixed(2));
if (ymin > 3.0 || ymax < 3.7 || ymin < 2.7 || ymax > 4.0) throw new Error('surface should hug the particle block (3.0..3.76)');
if (w.update(new Float32Array(3), 1) !== 0) throw new Error('a lone particle should not produce a surface');
if (w.update(new Float32Array(0), 0) !== 0) throw new Error('empty -> no mesh');
console.log('ok');
