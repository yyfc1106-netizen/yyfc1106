import { Sim, DT } from './sim.js';
import * as M from './mechanics.js';
const t0 = Date.now();
const sim = new Sim();
sim.warm(40);
const ms = Date.now() - t0;
const m = sim.mill, f = sim.fluid;
const rows = [];
for (let s = 0; s < 20; s++) { for (let i = 0; i < 120 * 3; i++) sim.step(); rows.push([m.out.wheelRpm.toFixed(2), (f.tauSmooth / 1e3).toFixed(2), (M.waterTorque(m.omega, m.ctl).tau / 1e3).toFixed(2), f.n, f.held.toFixed(0)]); }
console.log('warm ms', ms, 'rpm | fluid kNm | bucket-model kNm | n | held kg'); console.log(rows.filter((_, i) => i % 3 === 0).map((r) => r.join('  ')).join('\n'));
console.log('emitted', f.emitted, 'drained', f.drained, 'inflight', f.n, 'total ms', Date.now() - t0);
