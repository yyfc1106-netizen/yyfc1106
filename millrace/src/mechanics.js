// Lumped mechanical model of an overshot water-wheel gristmill.
// Pure functions + one state object, no DOM / three.js, so it can be tested in node.

const TAU = Math.PI * 2;
const G = 9.81;

export const P = {
  R: 2.4, // wheel radius, m
  NB: 36, // buckets
  Cd: 0.6, Cv: 0.97,
  gateW: 0.85, gateMax: 0.15, // m
  fallExtra: 5.07, // head-water surface to tailrace = head + fallExtra
  pit: 96, wallower: 32, spur: 120, nut: 20,
  etaBevel: 0.93, etaSpur: 0.95,
  Iwheel: 16000, Iupright: 3200, Istone: 170, // kg m^2
  mMax: 250 / 3600, // kg/s grain at full feed
  wRef: (120 * TAU) / 60, // reference stone speed, rad/s
  capacity: 700, // kg water the loaded arc can hold
};
P.r1 = P.pit / P.wallower;
P.r2 = P.spur / P.nut;
P.N = P.r1 * P.r2; // overall wheel -> stone ratio (18)

const th = (x, m) => Math.tanh(x / m);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export function defaults() {
  return { gate: 0.55, head: 0.6, feed: 0.48, gap: 0.6, brake: false };
}

export function create() {
  return {
    theta: 0, omega: 0.7, time: 0, tauWater: 0,
    stones: [0, 1].map((i) => ({ engaged: i === 0, omega: 0, theta: 0, flour: 0 })),
    ctl: defaults(),
    out: {},
  };
}

/** Sluice outflow. gate 0..1, head in m. */
export function outflow(ctl) {
  const a = ctl.gate * P.gateMax;
  const v = P.Cv * Math.sqrt(2 * G * ctl.head);
  const Q = ctl.gate <= 5e-4 ? 0 : P.Cd * P.gateW * a * Math.sqrt(2 * G * ctl.head);
  return { a, v, Q };
}

/** Stone fineness 0 (coarse) .. 1 (fine) from gap in mm. */
export const fineness = (gapMm) => clamp(1 - (gapMm - 0.1) / 1.4, 0, 1);

/** Load torque of one stone pair at stone speed w (rad/s). */
export function stoneLoad(w, ctl) {
  const fine = fineness(ctl.gap);
  const E = (40 + 90 * Math.pow(fine, 1.4)) * 1e3; // J/kg
  const mdot = ctl.feed * P.mMax; // kg/s offered
  const grind = ((E * mdot) / P.wRef) * th(w, 1.5);
  const idle = (10 + 0.6 * Math.abs(w)) * th(w, 0.3);
  const touching = clamp((0.3 - ctl.gap) / 0.2, 0, 1);
  const starved = 1 - Math.min(1, ctl.feed / 0.25);
  const rub = 160 * touching * starved * th(w, 0.5);
  return { total: grind + idle + rub, grind, idle, rub, mdot: (mdot * Math.abs(w)) / P.wRef, E };
}

/**
 * Bucket model: torque the water exerts on the wheel at wheel speed omega (rad/s).
 * Held water ~ Q * time a bucket stays on the loaded arc, capped by capacity and
 * reduced by spilling as the rim speeds up; plus an impulse term from the jet.
 */
export function waterTorque(omega, ctl) {
  const { Q, v } = outflow(ctl);
  if (Q <= 0) return { tau: 0, held: 0 };
  const w = Math.max(omega, 0.02);
  const u = w * P.R;
  const held = Math.min(1000 * Q * (2.2 / w), P.capacity);
  const spill = 1 / (1 + (u / 2.2) ** 2);
  const weight = held * G * P.R * 0.85 * spill;
  const jet = 1000 * Q * Math.max(v - u, 0) * P.R * 0.8;
  return { tau: weight + jet, held: held * spill };
}

function inertia(s) {
  let I = P.Iwheel + P.Iupright * P.r1 * P.r1;
  for (const st of s.stones) if (st.engaged) I += P.Istone * P.N * P.N;
  return I;
}

/** Engage / disengage a pair, conserving angular momentum. */
export function engage(s, i, on) {
  const st = s.stones[i];
  if (st.engaged === on) return;
  if (on) {
    const I = inertia(s);
    const Is = P.Istone * P.N * P.N;
    s.omega = (I * s.omega + Is * (st.omega / P.N)) / (I + Is);
    st.engaged = true;
  } else {
    st.engaged = false;
    st.omega = s.omega * P.N;
  }
}

export function step(s, dt) {
  const c = s.ctl;
  const w = s.omega;
  const { tau, held } = waterTorque(w, c);
  const bearing = 300 * th(w, 0.02) + 1500 * w;
  const brake = c.brake ? 4e4 * th(w, 0.005) : 0;
  const eta = P.etaBevel * P.etaSpur;
  const ws = w * P.N;

  let load = 0, grindW = 0, rubW = 0, mdot = 0;
  const per = [];
  for (const st of s.stones) {
    if (st.engaged) {
      st.omega = ws;
      const l = stoneLoad(ws, c);
      load += (l.total * P.N) / eta;
      grindW += l.grind * ws;
      rubW += l.rub * ws;
      mdot += l.mdot;
      st.flour += l.mdot * dt;
      per.push(l);
    } else {
      const l = stoneLoad(st.omega, { ...c, feed: 0 });
      const prev = st.omega;
      st.omega -= (l.total / P.Istone) * dt;
      if (Math.sign(st.omega) !== Math.sign(prev)) st.omega = 0;
      per.push(null);
    }
    st.theta += st.omega * dt;
  }

  const net = tau - bearing - brake - load;
  let nw = w + (net / inertia(s)) * dt;
  if (w !== 0 && Math.sign(nw) !== Math.sign(w) && Math.abs(tau) < Math.abs(bearing + brake + load)) nw = 0;
  s.omega = Math.max(nw, 0);
  s.theta += s.omega * dt;
  s.time += dt;
  s.tauWater += (tau - s.tauWater) * Math.min(1, dt * 1.5);

  const f = outflow(c);
  const H = c.head + P.fallExtra;
  const o = s.out;
  o.Q = f.Q; o.vJet = f.v; o.gateOpen = f.a;
  o.pHyd = 1000 * G * f.Q * H;
  o.H = H;
  o.tau = s.tauWater;
  o.held = held;
  o.wheelRpm = (s.omega * 60) / TAU;
  o.rim = s.omega * P.R;
  o.uprightRpm = o.wheelRpm * P.r1;
  o.stoneRpm = o.wheelRpm * P.N;
  o.pShaft = (tau - bearing) * s.omega;
  o.eff = o.pHyd > 0 ? clamp(o.pShaft / o.pHyd, 0, 1) : 0;
  o.pBearing = bearing * s.omega;
  o.pGear = Math.max(0, load * s.omega * (1 - eta)); // approx. loss in bevel+spur
  o.pGrind = grindW;
  o.pRub = rubW;
  o.throughput = mdot * 3600;
  o.engaged = s.stones.filter((x) => x.engaged).length;
  const fine = fineness(c.gap);
  const E = (40 + 90 * Math.pow(fine, 1.4)) * 1e3;
  o.Espec = E;
  o.mealTemp = 18 + (0.33 * E) / 1800 * Math.sqrt(Math.max(0, ws) / P.wRef);
  o.d50 = 130 + 770 * Math.pow(1 - fine, 1.1);
  o.tauAtStone = o.wheelRpm > 0 ? o.pGrind / Math.max(ws, 1e-6) : 0;
  return o;
}

export function warning(s) {
  const o = s.out, c = s.ctl;
  if (o.Q === undefined) return '';
  if (c.brake) return 'Brake on';
  if (c.gate < 0.01) return 'Gate shut, no water reaching the wheel';
  if (o.wheelRpm < 0.6 && s.time > 10) return 'Wheel stalled: load torque exceeds water torque';
  if (o.engaged > 0 && o.pRub > 200) return 'Stones touching with no grain between them';
  if (o.engaged === 0 && o.wheelRpm > 11) return 'No load in gear, the wheel is running away';
  if (o.engaged > 0 && o.mealTemp > 42) return 'Meal above 42 °C, the flour is being scorched';
  if (o.engaged > 0 && o.stoneRpm > 150) return 'Runner above 150 rpm';
  if (o.engaged > 0 && o.stoneRpm < 90 && c.feed > 0.05 && s.time > 15) return 'Runner below 90 rpm, meal will be uneven';
  return '';
}

export function productName(d50) {
  if (d50 > 700) return 'Cracked grain, grits';
  if (d50 > 450) return 'Coarse meal';
  if (d50 > 300) return 'Wholemeal flour';
  if (d50 > 200) return 'Fine flour';
  return 'Very fine flour';
}

/** Sample the two torque curves of Fig. 1 on the wheel side. */
export function curves(ctl, nPts = 80, maxRpm = 16) {
  const eta = P.etaBevel * P.etaSpur;
  const pts = [];
  for (let i = 0; i <= nPts; i++) {
    const rpm = (i / nPts) * maxRpm;
    const w = (rpm * TAU) / 60;
    const water = waterTorque(w, ctl).tau;
    const bearing = 300 * th(w, 0.02) + 1500 * w;
    pts.push({ rpm, water: water / 1e3, load: (bearing + (stoneLoad(w * P.N, ctl).total * P.N) / eta) / 1e3 });
  }
  return pts;
}
