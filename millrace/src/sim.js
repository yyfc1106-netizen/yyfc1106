// Couples the mechanics model with the PBF fluid. Runs identically in a Web Worker or on the main thread.
import * as M from './mechanics.js';
import * as F from './fluid.js';

export const DT = 1 / 120;

export class Sim {
  constructor() {
    this.mill = M.create();
    this.fluid = F.create();
    this.blendStart = 6; this.blendLen = 4; // seconds of sim time: analytic torque while the buckets fill, then fluid torque
    this.t = 0;
    this.acc = 0;
  }
  setCtl(ctl) { Object.assign(this.mill.ctl, ctl); }
  engage(i, on) { M.engage(this.mill, i, on); }
  step() {
    const m = this.mill, f = this.fluid;
    F.emit(f, m.out.Q === undefined ? M.outflow(m.ctl) && { ...M.outflow(m.ctl), gateOpen: M.outflow(m.ctl).a, vJet: M.outflow(m.ctl).v } : m.out, DT);
    const tau = F.step(f, DT, m.theta, m.omega);
    const w = Math.min(1, Math.max(0, (this.t - this.blendStart) / this.blendLen)); this.t += DT;
    const ana = M.waterTorque(m.omega, m.ctl);
    m.extTau = (1 - w) * ana.tau + w * tau; m.extHeld = (1 - w) * ana.held + w * f.held;
    M.step(m, DT);
  }
  /** Instant start: solve the mechanics to steady state with the analytic torque (cheap), no fluid yet. */
  prime(seconds = 30) {
    const n = Math.round(seconds / DT), m = this.mill;
    for (let i = 0; i < n; i++) M.step(m, DT);
    m.time = 0;
  }
  /** Test helper: run the whole thing (fluid included) for a while. */
  warm(seconds) { this.prime(10); for (let i = 0, n = Math.round(seconds / DT); i < n; i++) this.step(); this.mill.time = 0; }
  advance(span, maxSteps = 12) {
    this.acc += span; let k = 0;
    while (this.acc >= DT && k < maxSteps) { this.step(); this.acc -= DT; k++; }
    if (k === maxSteps) this.acc = 0;
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
