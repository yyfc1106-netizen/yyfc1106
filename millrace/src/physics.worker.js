// Runs the coupled mechanics + PBF fluid simulation off the main thread.
import { Sim } from './sim.js';

const sim = new Sim();
let scale = 1, last = 0;

function tick() {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (scale > 0) sim.advance(dt * scale);
  const s = sim.snapshot();
  postMessage({ type: 'state', s }, [s.pos.buffer]);
}

onmessage = (e) => {
  const d = e.data;
  if (d.type === 'init') {
    sim.setCtl(d.ctl);
    sim.warm(40, (p) => postMessage({ type: 'progress', p }));
    postMessage({ type: 'ready' });
    last = performance.now();
    setInterval(tick, 16);
  } else if (d.type === 'ctl') sim.setCtl(d.ctl);
  else if (d.type === 'engage') sim.engage(d.i, d.on);
  else if (d.type === 'scale') scale = d.s;
};
