// Position-Based Fluids (Macklin & Müller 2013) in the (y, z) cross-section of the wheel.
// Each particle stands for a slab of water W metres wide, so 2D results scale to the real wheel.
// The wheel buckets are moving boundaries; the corrections they apply to particles are summed
// into a reaction torque on the wheel, which is what drives the mechanics model.

import { P } from './mechanics.js';

const G = 9.81;
const RHO = 1000;
export const H = 0.04; // particle spacing, m
const KR = 2.5 * H; // kernel radius
const KR2 = KR * KR;
export const WIDTH = 1.3; // wheel width, m
export const MASS = RHO * H * H * WIDTH; // kg per particle (~2.1)
const ITER = 4;
const NBMAX = 32;

export const YC = 2.6; // wheel centre height (matches the 3D scene)
export const RIN = P.R - 0.5; // inner shroud radius
const LEAN = 0.8; // boards lean backwards by this angle at the rim, rad
const PITCH = (Math.PI * 2) / P.NB;
const BT = 0.03; // board thickness
export const GATE_Z = -0.88;
export const FLOOR_Y = 5.05;
const KILL_Y = 0.32;

// 2D kernels
const cPoly = 4 / (Math.PI * Math.pow(KR, 8));
const cSpiky = -30 / (Math.PI * Math.pow(KR, 5));
const poly6 = (r2) => { const d = KR2 - r2; return cPoly * d * d * d; };

// Rest density and gradient-sum constant from a perfect lattice
let RHO0 = 0, DEN0 = 0;
{
  let s = 0, gx = 0, gy = 0, g2 = 0;
  for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) {
    const x = i * H, y = j * H, r2 = x * x + y * y;
    if (r2 >= KR2) continue;
    s += poly6(r2);
    if (r2 > 0) { const r = Math.sqrt(r2), c = cSpiky * (KR - r) * (KR - r); gx += c * x / r; gy += c * y / r; g2 += c * c; }
  }
  RHO0 = s;
  DEN0 = (g2 + gx * gx + gy * gy) / (RHO0 * RHO0);
}
const EPS = 0.35 * DEN0;

// grid for neighbour search
const Y0 = -0.2, Z0 = -2.0, GY = Math.ceil(6.4 / KR), GZ = Math.ceil(11 / KR), NCELL = GY * GZ;

export function create(cap = 1600) {
  return {
    cap, n: 0, acc: 0, nextId: 0, torque: 0, tauSmooth: 0, held: 0,
    x: new Float32Array(cap * 2), p: new Float32Array(cap * 2), v: new Float32Array(cap * 2),
    lam: new Float32Array(cap), id: new Uint32Array(cap),
    cell: new Int32Array(cap), start: new Int32Array(NCELL + 1), sorted: new Int32Array(cap), fill: new Int32Array(NCELL),
    nb: new Int32Array(cap * NBMAX), nn: new Uint8Array(cap),
    emitted: 0, drained: 0,
  };
}

function remove(f, i) {
  const l = --f.n;
  if (i !== l) {
    f.x[i * 2] = f.x[l * 2]; f.x[i * 2 + 1] = f.x[l * 2 + 1];
    f.v[i * 2] = f.v[l * 2]; f.v[i * 2 + 1] = f.v[l * 2 + 1];
    f.p[i * 2] = f.p[l * 2]; f.p[i * 2 + 1] = f.p[l * 2 + 1];
    f.id[i] = f.id[l];
  }
}

/** Add particles for the water that passed the sluice during dt. */
export function emit(f, out, dt) {
  if (out.Q <= 0) { f.acc = 0; return; }
  f.acc += (out.Q * dt) / (MASS / RHO);
  while (f.acc >= 1) {
    f.acc -= 1;
    if (f.n >= f.cap) return;
    const i = f.n++;
    f.x[i * 2] = FLOOR_Y + 0.01 + Math.random() * Math.max(out.gateOpen - 0.02, 0.005);
    f.x[i * 2 + 1] = GATE_Z + 0.02;
    f.v[i * 2] = 0; f.v[i * 2 + 1] = out.vJet;
    f.id[i] = f.nextId++;
    f.emitted++;
  }
}

function buildNeighbours(f) {
  const { n, p, cell, start, sorted, fill, nb, nn } = f;
  start.fill(0);
  for (let i = 0; i < n; i++) {
    let a = Math.floor((p[i * 2] - Y0) / KR), b = Math.floor((p[i * 2 + 1] - Z0) / KR);
    a = a < 0 ? 0 : a >= GY ? GY - 1 : a; b = b < 0 ? 0 : b >= GZ ? GZ - 1 : b;
    const c = b * GY + a; cell[i] = c; start[c + 1]++;
  }
  for (let c = 0; c < NCELL; c++) start[c + 1] += start[c];
  fill.set(start.subarray(0, NCELL));
  for (let i = 0; i < n; i++) sorted[fill[cell[i]]++] = i;
  for (let i = 0; i < n; i++) {
    const c = cell[i], a = c % GY, b = (c / GY) | 0, py = p[i * 2], pz = p[i * 2 + 1];
    let k = 0;
    for (let db = -1; db <= 1; db++) {
      const bb = b + db; if (bb < 0 || bb >= GZ) continue;
      for (let da = -1; da <= 1; da++) {
        const aa = a + da; if (aa < 0 || aa >= GY) continue;
        const cc = bb * GY + aa;
        for (let s = start[cc], e = start[cc + 1]; s < e; s++) {
          const j = sorted[s]; if (j === i) continue;
          const dy = p[j * 2] - py, dz = p[j * 2 + 1] - pz;
          if (dy * dy + dz * dz < KR2 && k < NBMAX) nb[i * NBMAX + k++] = j;
        }
      }
    }
    nn[i] = k;
  }
}

/** Board angle offset (rad) at radius r, relative to the bucket base angle. */
const lean = (r) => -LEAN * Math.min(1, Math.max(0, (r - RIN) / (P.R - RIN)));

/** Collide particle i with the wheel at angle theta. Returns torque contribution (N m, unscaled). */
function collide(f, i, theta, inv) {
  const py = f.p[i * 2] - YC, pz = f.p[i * 2 + 1];
  let r = Math.hypot(py, pz);
  if (r >= P.R || r < 1e-6) return 0;
  let r2 = r, ang = Math.atan2(pz, py);
  if (r2 < RIN + 0.012) r2 = RIN + 0.012;
  let u = ang - theta - lean(r2);
  u = u - Math.floor(u / (Math.PI * 2)) * Math.PI * 2;
  const k = Math.floor(u / PITCH);
  let fr = u - k * PITCH;
  const mg = (BT / 2 + 0.012) / r2;
  if (fr < mg) fr = mg; else if (fr > PITCH - mg) fr = PITCH - mg;
  const na = theta + lean(r2) + k * PITCH + fr;
  const ny = Math.cos(na) * r2, nz = Math.sin(na) * r2;
  const dy = ny - py, dz = nz - pz;
  if (dy === 0 && dz === 0) return 0;
  f.p[i * 2] = ny + YC; f.p[i * 2 + 1] = nz;
  // reaction on the wheel = -(m * d / dt^2); torque about +x = y*Fz - z*Fy
  const fy = -MASS * dy * inv, fz = -MASS * dz * inv;
  return py * fz - pz * fy;
}

/** Advance the fluid by dt with the wheel at theta + omega*dt. Returns smoothed water torque on the wheel. */
export function step(f, dt, theta, omega) {
  const th = theta + omega * dt, inv = 1 / (dt * dt);
  const { x, p, v, lam, nb, nn } = f;
  for (let i = 0; i < f.n; i++) {
    const a = i * 2;
    v[a] -= G * dt;
    p[a] = x[a] + v[a] * dt; p[a + 1] = x[a + 1] + v[a + 1] * dt;
  }
  buildNeighbours(f);
  let tq = 0;
  const dp = f._dp || (f._dp = new Float32Array(f.cap * 2));
  for (let it = 0; it < ITER; it++) {
    for (let i = 0; i < f.n; i++) {
      let rho = poly6(0), gix = 0, giy = 0, g2 = 0;
      const k = nn[i], py = p[i * 2], pz = p[i * 2 + 1];
      for (let q = 0; q < k; q++) {
        const j = nb[i * NBMAX + q], dy = py - p[j * 2], dz = pz - p[j * 2 + 1], r2 = dy * dy + dz * dz;
        rho += poly6(r2);
        if (r2 > 1e-12) {
          const r = Math.sqrt(r2), c = (cSpiky * (KR - r) * (KR - r)) / (RHO0 * r);
          const gy = c * dy, gz = c * dz;
          gix += gy; giy += gz; g2 += gy * gy + gz * gz;
        }
      }
      const C = rho / RHO0 - 1;
      lam[i] = C > 0 ? -C / (g2 + gix * gix + giy * giy + EPS) : 0;
    }
    for (let i = 0; i < f.n; i++) {
      let sy = 0, sz = 0;
      const k = nn[i], py = p[i * 2], pz = p[i * 2 + 1];
      for (let q = 0; q < k; q++) {
        const j = nb[i * NBMAX + q], dy = py - p[j * 2], dz = pz - p[j * 2 + 1], r2 = dy * dy + dz * dz;
        if (r2 < 1e-12) continue;
        const r = Math.sqrt(r2), c = ((lam[i] + lam[j]) * cSpiky * (KR - r) * (KR - r)) / (RHO0 * r);
        sy += c * dy; sz += c * dz;
      }
      dp[i * 2] = sy; dp[i * 2 + 1] = sz;
    }
    for (let i = 0; i < f.n; i++) {
      p[i * 2] += dp[i * 2]; p[i * 2 + 1] += dp[i * 2 + 1];
      tq += collide(f, i, th, inv);
    }
  }
  let held = 0;
  for (let i = 0; i < f.n; ) {
    const a = i * 2;
    let vy = (p[a] - x[a]) / dt, vz = (p[a + 1] - x[a + 1]) / dt;
    const sp = Math.hypot(vy, vz);
    if (sp > 14) { vy *= 14 / sp; vz *= 14 / sp; }
    v[a] = vy; v[a + 1] = vz; x[a] = p[a]; x[a + 1] = p[a + 1];
    if (x[a] < KILL_Y || x[a + 1] > 9 || x[a + 1] < -2 || x[a] > 9) { remove(f, i); f.drained++; continue; }
    const r = Math.hypot(x[a] - YC, x[a + 1]);
    if (r < P.R && r > RIN - 0.05) held++;
    i++;
  }
  f.held = held * MASS;
  f.torque = tq;
  f.tauSmooth += (tq - f.tauSmooth) * (1 - Math.exp(-dt / 0.3));
  return f.tauSmooth;
}

export const hashX = (id) => { const s = Math.sin(id * 12.9898) * 43758.5453; return (s - Math.floor(s) - 0.5) * 0.9; };
