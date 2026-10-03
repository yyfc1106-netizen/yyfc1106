// Couples the mechanics model with the PBF fluid. Runs identically in a Web Worker or on the main thread.
import * as M from './mechanics.js';
import * as F from './fluid.js';

export const DT = 1 / 120;

export class Sim {
  constructor() {
    this.mill = M.create();
    this.fluid = F.create();
    this.coupled = false; // false: analytic bucket torque drives the wheel (used while the buckets fill)
    this.acc = 0;
  }
  setCtl(ctl) { Object.assign(this.mill.ctl, ctl); }
  engage(i, on) { M.engage(this.mill, i, on); }
  step() {
    const m = this.mill, f = this.fluid;
    F.emit(f, m.out.Q === undefined ? M.outflow(m.ctl) && { ...M.outflow(m.ctl), gateOpen: M.outflow(m.ctl).a, vJet: M.outflow(m.ctl).v } : m.out, DT);
    const tau = F.step(f, DT, m.theta, m.omega);
    if (this.coupled) { m.extTau = tau; m.extHeld = f.held; }
    M.step(m, DT);
  }
  /** Warm the mill up: first with the analytic torque while the fluid fills the buckets, then coupled. */
  warm(seconds, onProgress) {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) {
      if (i === Math.round(n * 0.6)) { this.coupled = true; }
      this.step();
      if (onProgress && i % 120 === 0) onProgress(i / n);
    }
    this.mill.time = 0;
  }
  advance(span) {
    this.acc += span; let k = 0;
    while (this.acc >= DT && k < 12) { this.step(); this.acc -= DT; k++; }
    if (k === 12) this.acc = 0;
    return k;
  }
  snapshot() {
    const m = this.mill, f = this.fluid, n = f.n, pos = new Float32Array(n * 3), vel = new Float32Array(n * 2), nn = new Uint8Array(f.nn.subarray(0, n));
    for (let i = 0; i < n; i++) { pos[i * 3] = F.hashX(f.id[i]); pos[i * 3 + 1] = f.x[i * 2]; pos[i * 3 + 2] = f.x[i * 2 + 1]; vel[i * 2] = f.v[i * 2]; vel[i * 2 + 1] = f.v[i * 2 + 1]; }
    return {
      theta: m.theta, omega: m.omega, time: m.time, tauWater: m.tauWater,
      out: { ...m.out }, stones: m.stones.map((s) => ({ ...s })), n, pos, vel, nn,
      fluidTau: f.tauSmooth, held: f.held, emitted: f.emitted, drained: f.drained,
    };
  }
}
