import * as THREE from 'three';
import * as M from './mechanics.js';

const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const f = (x, d = 1) => (+x).toFixed(d);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const P = M.P;

/* ---------------- state ---------------- */
const mill = M.create();
let curveKey = '', curveData = [];
const ui = { timeScale: 1, explode: 0, explodeT: 0, wire: false, labels: false, sacks: 0 };

/* ---------------- scene ---------------- */
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
const target = new THREE.Vector3(1.2, 3.2, 0);
const orbit = { az: 0.9, el: 0.42, dist: 27 };
const home = { ...orbit };

scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(8, 14, 6); sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 40 });
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);

const mats = {
  oak: new THREE.MeshStandardMaterial({ color: 0xc58b4f, roughness: 0.8 }),
  pale: new THREE.MeshStandardMaterial({ color: 0xe0b97c, roughness: 0.85 }),
  stone: new THREE.MeshStandardMaterial({ color: 0x9a9a92, roughness: 0.95 }),
  iron: new THREE.MeshStandardMaterial({ color: 0x4a4f5c, roughness: 0.5, metalness: 0.6 }),
  grass: new THREE.MeshStandardMaterial({ color: 0x6d8b4a, roughness: 1 }),
  earth: new THREE.MeshStandardMaterial({ color: 0x8a6a46, roughness: 1 }),
  water: new THREE.MeshStandardMaterial({ color: 0x2aa6b8, roughness: 0.2, transparent: true, opacity: 0.75 }),
  burlap: new THREE.MeshStandardMaterial({ color: 0xc9b184, roughness: 1 }),
  flour: new THREE.MeshStandardMaterial({ color: 0xf6f1e6, roughness: 1 }),
};
const allMats = Object.values(mats);
const mesh = (geo, mat, parent, pos = [0, 0, 0]) => {
  const m = new THREE.Mesh(geo, mat); m.position.set(...pos); m.castShadow = m.receiveShadow = true; parent.add(m); return m;
};
const group = (name, offset, labelAt) => { const g = new THREE.Group(); g.userData = { name, offset: new THREE.Vector3(...offset), labelAt: new THREE.Vector3(...labelAt) }; scene.add(g); return g; };

const WC = new THREE.Vector3(0, 2.6, 0); // wheel centre
const gBase = group('Foundation', [0, -1.2, 0], [0, 0.4, 0]);
mesh(new THREE.BoxGeometry(6, 1.8, 14), mats.stone, gBase, [1.3, -0.5, 0]);
mesh(new THREE.BoxGeometry(1.4, 2.2, 14), mats.stone, gBase, [-1.6, 0.6, 0]); // low wall
mesh(new THREE.BoxGeometry(14, 0.3, 14), mats.grass, gBase, [1.3, -1.5, 0]);
const pit = mesh(new THREE.BoxGeometry(3.4, 0.2, 14), mats.water, gBase, [0.0, 0.25, 4.4]); // tailrace
pit.castShadow = false;

const gFlume = group('Flume & gate', [0, 2.0, -1.5], [0, 5.8, -2.8]);
mesh(new THREE.BoxGeometry(2, 0.2, 4.5), mats.oak, gFlume, [0, 4.95, -3.1]);
for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.15, 0.6, 4.5), mats.oak, gFlume, [s * 0.95, 5.3, -3.1]);
const flumeWater = mesh(new THREE.BoxGeometry(1.7, 0.4, 4.2), mats.water, gFlume, [0, 5.15, -3.1]); flumeWater.castShadow = false;
const gate = mesh(new THREE.BoxGeometry(1.8, 1.0, 0.1), mats.iron, gFlume, [0, 5.6, -0.95]);

const gWheel = group('Overshot wheel', [0, 0.6, 0], [0, 5.3, 0]);
const wheel = new THREE.Group(); wheel.position.copy(WC); gWheel.add(wheel);
const W = 1.3, R = P.R;
for (const s of [-1, 1]) {
  const ring = mesh(new THREE.TorusGeometry(R, 0.07, 8, 64), mats.oak, wheel, [s * (W / 2), 0, 0]); ring.rotation.y = Math.PI / 2;
  const ring2 = mesh(new THREE.TorusGeometry(R - 0.5, 0.05, 8, 48), mats.oak, wheel, [s * (W / 2), 0, 0]); ring2.rotation.y = Math.PI / 2;
}
const spokeGeo = new THREE.BoxGeometry(0.1, R - 0.1, 0.1);
for (let i = 0; i < 8; i++) for (const s of [-1, 1]) {
  const a = (i / 8) * Math.PI * 2;
  const sp = mesh(spokeGeo, mats.oak, wheel, [s * (W / 2), Math.cos(a) * (R / 2), Math.sin(a) * (R / 2)]); sp.rotation.x = -a;
}
const bucketGeo = new THREE.BoxGeometry(W, 0.55, 0.06);
for (let i = 0; i < P.NB; i++) {
  const a = (i / P.NB) * Math.PI * 2;
  const b = mesh(bucketGeo, mats.pale, wheel, [0, Math.cos(a) * (R - 0.2), Math.sin(a) * (R - 0.2)]);
  b.rotation.x = -a - 0.5; // slanted bucket floor
}
const shaft = mesh(new THREE.CylinderGeometry(0.16, 0.16, 3.8, 14), mats.iron, wheel); shaft.rotation.z = Math.PI / 2; shaft.position.x = 0.8;

const gGear = group('Gear train', [1.8, 1.0, 0], [2.3, 4.0, 0]);
const pitWheel = new THREE.Group(); pitWheel.position.set(1.3, WC.y, 0); gGear.add(pitWheel);
function gear(parent, r, teeth, h, axis) {
  const g = new THREE.Group(); parent.add(g);
  const disc = mesh(new THREE.CylinderGeometry(r, r, h, 36), mats.oak, g); disc.rotation.z = axis === 'x' ? Math.PI / 2 : 0;
  const tg = new THREE.BoxGeometry(r * 0.22, h, r * 0.2);
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const t = mesh(tg, mats.iron, g);
    if (axis === 'x') { t.position.set(0, Math.cos(a) * r, Math.sin(a) * r); t.rotation.x = -a; t.scale.set(1, 1, 1); t.geometry = new THREE.BoxGeometry(h, r * 0.2, r * 0.22); }
    else { t.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); t.rotation.y = -a; }
  }
  return g;
}
gear(pitWheel, 1.0, 24, 0.22, 'x');
const upright = new THREE.Group(); upright.position.set(2.5, 0, 0); gGear.add(upright);
mesh(new THREE.CylinderGeometry(0.14, 0.14, 4.3, 12), mats.iron, upright, [0, 3.4, 0]);
const wallower = gear(upright, 0.4, 12, 0.3, 'y'); wallower.position.y = WC.y;
const spur = gear(upright, 1.15, 28, 0.2, 'y'); spur.position.y = 3.7;
const nuts = [];
for (const s of [-1, 1]) {
  const nut = new THREE.Group(); nut.position.set(2.5, 3.7, s * 1.45); gGear.add(nut);
  gear(nut, 0.3, 10, 0.2, 'y');
  mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.2, 8), mats.iron, nut, [0, 0.6, 0]);
  nuts.push(nut);
}

const gStone = group('Millstones', [1.0, 2.6, 0], [2.5, 5.3, 0]);
const runners = [];
for (const s of [-1, 1]) {
  const base = mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.25, 36), mats.stone, gStone, [2.5, 4.55, s * 1.45]);
  const run = new THREE.Group(); run.position.set(2.5, 4.85, s * 1.45); gStone.add(run);
  mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.3, 36), new THREE.MeshStandardMaterial({ color: 0xb4a894, roughness: 1 }), run);
  for (let i = 0; i < 6; i++) { const m = mesh(new THREE.BoxGeometry(1.5, 0.04, 0.05), mats.iron, run, [0, 0.16, 0]); m.rotation.y = (i / 6) * Math.PI; }
  runners.push(run);
}
const gHop = group('Hopper & sack', [0, 1.8, 0], [3.0, 7.2, 0]);
const hopper = mesh(new THREE.CylinderGeometry(0.9, 0.35, 0.8, 4, 1, true), mats.oak, gHop, [2.5, 6.5, 0]); hopper.rotation.y = Math.PI / 4; hopper.material = mats.oak.clone(); hopper.material.side = THREE.DoubleSide;
const grain = mesh(new THREE.CylinderGeometry(0.8, 0.3, 0.7, 4), new THREE.MeshStandardMaterial({ color: 0xd9b24a }), gHop, [2.5, 6.5, 0]); grain.rotation.y = Math.PI / 4;
const sack = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 20), mats.burlap, gHop, [3.9, -0.45 + 0.45, 3.2]);
const sackTop = mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.04, 20), mats.flour, gHop, [3.9, 0.1, 3.2]);
const fullSacks = new THREE.Group(); gHop.add(fullSacks);
const stream = mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 8), mats.flour, gHop, [3.3, 3, 2.2]); stream.castShadow = false;

const groups = scene.children.filter((o) => o.userData && o.userData.name);
groups.forEach((g) => (g.userData.base = g.position.clone()));

/* --- water particles --- */
const NP = 2400;
const pPos = new Float32Array(NP * 3), pVel = new Float32Array(NP * 3), pAng = new Float32Array(NP), pRad = new Float32Array(NP), pMode = new Uint8Array(NP); // 0 dead 1 air 2 riding
const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setDrawRange(0, NP);
for (let i = 0; i < NP; i++) pPos[i * 3 + 1] = -100;
const pts = new THREE.Points(pGeo, new THREE.PointsMaterial({ color: 0x66e0ee, size: 0.14, transparent: true, opacity: 0.9, depthWrite: false }));
pts.frustumCulled = false; scene.add(pts);
let emitAcc = 0, cursor = 0;
const LITRES = 0.4; // each particle stands for this many litres
function emit(n, v) {
  for (let k = 0; k < n && k < NP; k++) {
    const i = cursor; cursor = (cursor + 1) % NP;
    pMode[i] = 1;
    pPos.set([(Math.random() - 0.5) * 1.3, 5.1 + Math.random() * 0.2, -0.9 + Math.random() * 0.1], i * 3);
    pVel.set([0, 0, v], i * 3);
  }
}
function stepParticles(dt, o) {
  const omega = mill.omega;
  emitAcc += (o.Q * 1000 / LITRES) * dt;
  const n = Math.floor(emitAcc); emitAcc -= n; emit(n, o.vJet);
  for (let i = 0; i < NP; i++) {
    const m = pMode[i]; if (!m) continue;
    const j = i * 3;
    if (m === 1) {
      pVel[j + 1] -= 9.81 * dt;
      pPos[j] += pVel[j] * dt; pPos[j + 1] += pVel[j + 1] * dt; pPos[j + 2] += pVel[j + 2] * dt;
      const dy = pPos[j + 1] - WC.y, dz = pPos[j + 2];
      const r = Math.hypot(dy, dz);
      if (r < R - 0.1 && r > R - 0.6 && dy > -0.5 && pVel[j + 2] * dz + pVel[j + 1] * dy < 1e3 && pPos[j + 2] > -0.5) { // lands in a bucket
        pMode[i] = 2; pAng[i] = Math.atan2(dz, dy); pRad[i] = R - 0.25 - Math.random() * 0.25;
      } else if (pPos[j + 1] < 0.5) { pMode[i] = 0; pPos[j + 1] = -100; }
    } else {
      pAng[i] += omega * dt;
      pPos[j] = (Math.random() - 0.5) * 0.002 + (pPos[j] || 0) * 0.99;
      pPos[j + 1] = WC.y + Math.cos(pAng[i]) * pRad[i];
      pPos[j + 2] = Math.sin(pAng[i]) * pRad[i];
      if (pAng[i] > 2.4) { // spilled out at the bottom
        pMode[i] = 1; const u = omega * pRad[i];
        pVel[j] = 0; pVel[j + 1] = -Math.sin(pAng[i]) * u; pVel[j + 2] = Math.cos(pAng[i]) * u;
      }
    }
  }
  pGeo.attributes.position.needsUpdate = true;
}

/* ---------------- camera & input ---------------- */
function placeCamera() {
  const { az, el, dist } = orbit;
  camera.position.set(target.x + dist * Math.cos(el) * Math.sin(az), target.y + dist * Math.sin(el), target.z + dist * Math.cos(el) * Math.cos(az));
  camera.lookAt(target);
}
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  orbit.az -= (e.clientX - drag.x) * 0.006; orbit.el = clamp(orbit.el + (e.clientY - drag.y) * 0.005, 0.05, 1.45);
  drag = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointerup', () => (drag = null));
canvas.addEventListener('wheel', (e) => { e.preventDefault(); orbit.dist = clamp(orbit.dist * Math.exp(e.deltaY * 0.001), 6, 40); }, { passive: false });
$('reset').onclick = () => Object.assign(orbit, home);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h;
  camera.setViewOffset(w, h, innerWidth > 820 ? 230 : 0, 0, w, h); // shift the model left of the panel
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

/* ---------------- UI wiring ---------------- */
const sliders = {
  gate: { scale: 1 / 100, out: (v) => `${f(v * P.gateMax * 1000, 0)}<small>mm</small>` },
  head: { scale: 1 / 100, out: (v) => `${f(v, 2)}<small>m</small>` },
  feed: { scale: 1 / 100, out: (v) => `${f(v * 250, 0)}<small>kg/h</small>` },
  gap: { scale: 1 / 100, out: (v) => `${f(v, 2)}<small>mm</small>` },
};
for (const k in sliders) {
  const el = $(k);
  el.value = mill.ctl[k] * 100;
  const upd = () => { mill.ctl[k] = el.value / 100; $(k + 'Out').innerHTML = sliders[k].out(mill.ctl[k]); curveKey = ''; };
  el.addEventListener('input', upd); upd();
}
$('brake').onclick = () => { mill.ctl.brake = !mill.ctl.brake; $('brake').setAttribute('aria-pressed', mill.ctl.brake); $('brakeS').textContent = mill.ctl.brake ? 'On' : 'Off'; };
for (const i of [0, 1]) $('pair' + i).onclick = () => {
  const on = !mill.stones[i].engaged; M.engage(mill, i, on);
  $('pair' + i).setAttribute('aria-pressed', on); $('pair' + i + 's').textContent = on ? 'In gear' : 'Out of gear'; curveKey = '';
};
document.querySelectorAll('#speed button').forEach((b) => (b.onclick = () => {
  ui.timeScale = +b.dataset.s; document.querySelectorAll('#speed button').forEach((x) => x.setAttribute('aria-pressed', x === b));
}));
document.querySelectorAll('#views button').forEach((b) => (b.onclick = () => {
  const k = b.dataset.view; ui[k] = !ui[k]; b.setAttribute('aria-pressed', ui[k]);
  if (k === 'explode') ui.explodeT = ui.explode ? 1 : 0;
  if (k === 'wire') allMats.forEach((m) => (m.wireframe = ui.wire));
  if (k === 'labels') $('labels').style.display = ui.labels ? '' : 'none';
}));
$('labels').style.display = 'none';
groups.forEach((g) => { const s = document.createElement('span'); s.textContent = g.userData.name; g.userData.el = s; $('labels').appendChild(s); });
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  document.querySelectorAll('[data-theme-set]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.themeSet === t));
  scene.background = new THREE.Color(css('--bg'));
}
document.querySelectorAll('[data-theme-set]').forEach((b) => (b.onclick = () => setTheme(b.dataset.themeSet)));
setTheme(matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
$('sheetBtn').onclick = () => { const c = $('panel').classList.toggle('closed'); $('sheetBtn').setAttribute('aria-expanded', !c); };

/* ---------------- charts ---------------- */
function prep(cv) {
  const r = cv.getBoundingClientRect(), d = devicePixelRatio || 1;
  const w = Math.max(10, r.width), h = Math.max(10, r.height);
  if (cv.width !== Math.round(w * d)) { cv.width = Math.round(w * d); cv.height = Math.round(h * d); }
  const c = cv.getContext('2d'); c.setTransform(d, 0, 0, d, 0, 0); c.clearRect(0, 0, w, h); c.font = '10px "IBM Plex Mono", monospace';
  return { c, w, h };
}
function drawOperating(o) {
  const { c, w, h } = prep($('opCv'));
  const key = JSON.stringify(mill.ctl) + mill.stones.map((s) => s.engaged);
  if (key !== curveKey) { curveKey = key; curveData = M.curves(mill.ctl); }
  const L = 34, B = 20, T = 8, Rr = 8, maxX = 16, maxY = 20;
  const X = (v) => L + (v / maxX) * (w - L - Rr), Y = (v) => h - B - (clamp(v, 0, maxY) / maxY) * (h - B - T);
  c.strokeStyle = css('--line'); c.fillStyle = css('--mut'); c.lineWidth = 1;
  for (let v = 0; v <= maxY; v += 5) { c.beginPath(); c.moveTo(L, Y(v)); c.lineTo(w - Rr, Y(v)); c.stroke(); c.fillText(v, 6, Y(v) + 3); }
  for (let v = 0; v <= maxX; v += 4) c.fillText(v, X(v) - 3, h - 6);
  c.fillText('torque kN·m / wheel rpm', L + 4, T + 8);
  c.lineWidth = 1.6; c.strokeStyle = css('--acc'); c.setLineDash([5, 4]); c.beginPath();
  curveData.forEach((p, i) => (i ? c.lineTo(X(p.rpm), Y(p.water)) : c.moveTo(X(p.rpm), Y(p.water)))); c.stroke();
  c.setLineDash([]); c.strokeStyle = css('--ink'); c.beginPath();
  curveData.forEach((p, i) => (i ? c.lineTo(X(p.rpm), Y(p.load)) : c.moveTo(X(p.rpm), Y(p.load)))); c.stroke();
  c.fillStyle = css('--warn'); c.beginPath(); c.arc(X(o.wheelRpm), Y(o.tau / 1e3), 4, 0, 7); c.fill();
}
const hist = []; let histT = 0;
function drawStrip(o) {
  const { c, w, h } = prep($('stripCv'));
  const lo = 0, hi = 180, Y = (v) => h - (clamp(v, lo, hi) / hi) * h;
  c.fillStyle = css('--acc'); c.globalAlpha = 0.12; c.fillRect(0, Y(130), w, Y(110) - Y(130)); c.globalAlpha = 1;
  c.strokeStyle = css('--mut'); c.setLineDash([3, 3]); [110, 130].forEach((v) => { c.beginPath(); c.moveTo(0, Y(v)); c.lineTo(w, Y(v)); c.stroke(); }); c.setLineDash([]);
  c.fillStyle = css('--mut'); c.fillText('110', 2, Y(110) - 2); c.fillText('130', 2, Y(130) - 2);
  c.strokeStyle = css('--ink'); c.lineWidth = 1.6; c.beginPath();
  hist.forEach((v, i) => { const x = (i / 119) * w; i ? c.lineTo(x, Y(v)) : c.moveTo(x, Y(v)); }); c.stroke();
}
function drawSankey(o) {
  const { c, w, h } = prep($('sankeyCv'));
  const pin = o.pHyd / 1e3;
  const shaft = Math.max(0, o.pShaft) / 1e3, bear = o.pBearing / 1e3, gear = o.pGear / 1e3, rub = o.pRub / 1e3, grind = o.pGrind / 1e3;
  const wheelLoss = Math.max(0, pin - shaft - bear);
  const idle = Math.max(0, shaft - gear - rub - grind);
  const segs = [['wheel', wheelLoss, '--mut'], ['bearings', bear, '--mut'], ['gears', gear, '--warn'], ['idle', idle, '--mut'], ['rub', rub, '--warn'], ['grinding', grind, '--ok']];
  const scale = pin > 0 ? (h - 20) / pin : 0, x0 = 70, x1 = w - 110;
  c.fillStyle = css('--acc'); c.fillRect(x0 - 20, 10, 20, pin * scale);
  c.fillStyle = css('--ink'); c.fillText(`water ${f(pin)} kW`, 4, h - 4);
  let y = 10;
  segs.forEach(([name, v, col]) => {
    const hh = v * scale; if (hh < 0.5) return;
    c.globalAlpha = 0.28; c.fillStyle = css(col); c.beginPath(); c.moveTo(x0, 10 + (y - 10)); c.lineTo(x1, y); c.lineTo(x1, y + hh); c.lineTo(x0, y - 10 + 10 + hh); c.closePath(); c.fill();
    c.globalAlpha = 1; c.fillRect(x1, y, 14, hh); c.fillStyle = css('--ink');
    c.fillText(`${name} ${f(v, 2)}`, x1 + 20, y + Math.max(8, hh / 2 + 3)); y += hh + 2;
  });
}

/* ---------------- readouts ---------------- */
const set = (id, html) => { const e = $(id); if (e.innerHTML !== html) e.innerHTML = html; };
const u = (v, unit) => `${v}<small>${unit}</small>`;
function landing(ctl, o) { // angle where the jet meets the wheel rim, degrees past top
  let t = 0.002, y = 0, z = -0.9; const dt = 0.002;
  for (t = 0; t < 2; t += dt) { y = -4.905 * t * t; z = -0.9 + o.vJet * t; if (Math.hypot(y + 5.15 - WC.y, z) <= R - 0.05) break; }
  return (Math.atan2(z, y + 5.15 - WC.y) * 180) / Math.PI;
}
let lastText = 0;
function readouts() {
  const o = mill.out, c = mill.ctl;
  set('clock', `t = ${f(mill.time)} s`);
  set('lWheel', `${f(o.wheelRpm)} rpm`); set('lStone', `${f(o.engaged ? o.stoneRpm : Math.max(mill.stones[0].omega, mill.stones[1].omega) * 60 / (2 * Math.PI), 0)} rpm`); set('lFlour', `${f(o.throughput, 0)} kg/h`);
  $('warn').textContent = M.warning(mill);
  set('wQ', u(f(o.Q * 1000, 0), 'L/s')); set('wV', u(f(o.vJet), 'm/s'));
  set('wL', o.Q > 0 ? (() => { const a = landing(c, o); return u(f(Math.abs(a), 0), a < 0 ? '° before top' : '° past top'); })() : '<small>no jet</small>');
  const hh = c.head;
  set('eqV', u(f(o.vJet, 2), 'm/s')); set('eqVs', `= ${P.Cv} × √(2 × 9.81 × ${f(hh, 2)})`);
  set('eqQ', u(f(o.Q, 3), 'm³/s')); set('eqQs', `= ${P.Cd} × ${P.gateW} × ${f(o.gateOpen, 3)} × ${f(Math.sqrt(2 * 9.81 * hh), 2)}, that is ${f(o.Q * 1000, 0)} L/s`);
  set('eqP', u(f(o.pHyd / 1e3, 1), 'kW')); set('eqPs', `= 1000 × 9.81 × ${f(o.Q, 3)} × ${f(o.H, 2)}, fall to the tailrace`);
  set('mN', u(f(o.wheelRpm), 'rpm')); set('mR', u(f(o.rim), 'm/s')); set('mT', u(f(o.tau / 1e3), 'kN m'));
  set('mP', u(f(o.pShaft / 1e3), 'kW')); set('mE', u(f(o.eff * 100, 0), '%')); set('mM', u(f(o.held, 0), 'kg'));
  const ratio = o.vJet > 0 ? o.rim / o.vJet : 0;
  $('rimNote').textContent = o.Q <= 0 ? 'No water on the wheel.' : ratio < 0.3 ? `Rim at ${f(ratio * 100, 0)}% of jet speed: the wheel is being held back by its load.` : ratio > 0.75 ? `Rim at ${f(ratio * 100, 0)}% of jet speed: the buckets outrun the water and catch less of it.` : `Rim at ${f(ratio * 100, 0)}% of jet speed. Overshot wheels work best around a half.`;
  const tw = o.tau, eta = P.etaBevel, es = P.etaSpur;
  set('g1n', u(f(o.wheelRpm), 'rpm')); set('g1t', u(f(tw / 1e3), 'kN m'));
  set('g2n', u(f(o.uprightRpm), 'rpm')); set('g2t', u(f(tw / P.r1 * eta / 1e3), 'kN m'));
  const stoneT = tw / P.N * eta * es;
  set('g3n', u(f(o.stoneRpm, 0), 'rpm')); set('g3t', u(f(stoneT, 0), 'N m'.replace('N m', 'N m')));
  set('gL', `${f((o.pBearing + o.pGear) / 1e3)} kW`);
  set('sN', u(f(o.stoneRpm, 0), 'rpm')); set('sM', u(f(o.throughput, 0), 'kg/h')); set('sP', u(f(o.pGrind / 1e3), 'kW'));
  set('sE', u(f(o.Espec / 1e3, 0), 'kJ/kg')); set('sD', u(f(o.d50, 0), 'µm')); set('sT', u(f(o.mealTemp, 0), '°C'));
  const flour = mill.stones.reduce((a, s) => a + s.flour, 0);
  set('sProd', M.productName(o.d50)); set('sSacks', String(Math.floor(flour / 50)));
  ui.sacks = flour / 50;
}

/* ---------------- animate ---------------- */
const clock = new THREE.Clock();
let acc = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05) * ui.timeScale;
  acc += dt; const h = 1 / 120;
  while (acc >= h) { M.step(mill, h); acc -= h; }
  const o = mill.out;
  if (dt > 0) stepParticles(dt, o);
  wheel.rotation.x = mill.theta; pitWheel.rotation.x = mill.theta;
  const pi = mill.theta * P.r1; upright.rotation.y = pi;
  nuts.forEach((n, i) => (n.rotation.y = -mill.stones[i].theta + 0)); // nut spindle follows stone speed
  runners.forEach((r, i) => (r.rotation.y = mill.stones[i].theta));
  nuts.forEach((n, i) => (n.position.y += ((mill.stones[i].engaged ? 3.7 : 3.35) - n.position.y) * 0.15));
  runners.forEach((r, i) => (r.position.y += ((mill.stones[i].engaged ? 4.85 : 4.85) - r.position.y) * 0.15));
  gate.position.y = 5.1 + 0.15 + mill.ctl.gate * 0.9;
  flumeWater.scale.y = 0.4 + mill.ctl.head * 1.2; flumeWater.position.y = 5.05 + flumeWater.scale.y * 0.2;
  // hopper, flour sack
  const flour = mill.stones.reduce((a, s) => a + s.flour, 0), frac = (flour / 50) % 1;
  grain.scale.y = 0.4 + 0.6 * (1 - ((flour / 400) % 1)); grain.position.y = 6.2 + 0.35 * grain.scale.y;
  const active = o.throughput > 5;
  stream.visible = active; stream.scale.set(1, 1.1, 1); stream.position.set(3.7, 1.0, 3.0); stream.rotation.x = 0.0;
  sack.scale.set(0.8 + 0.22 * Math.sqrt(frac), 0.92 + 0.08 * frac, 0.8 + 0.22 * Math.sqrt(frac));
  sackTop.position.y = 0.05 + 0.82 * frac + 0.02 - 0.2 + 0.2; sackTop.position.y = 0.05 + 0.82 * frac;
  while (fullSacks.children.length < Math.min(4, Math.floor(ui.sacks))) {
    const k = fullSacks.children.length; const s = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 20), mats.burlap, fullSacks, [4.9 + (k % 2) * 0.7, 0.45, 3.2 - Math.floor(k / 2) * 0.7]);
    s.scale.set(1, 1, 1);
  }
  // explode / labels
  ui.explode += (ui.explodeT - ui.explode) * (reduced ? 1 : 0.1);
  const v = new THREE.Vector3();
  groups.forEach((g) => {
    g.position.copy(g.userData.base).addScaledVector(g.userData.offset, ui.explode);
    const el = g.userData.el;
    if (ui.labels) { v.copy(g.userData.labelAt).add(g.position).sub(g.userData.base).project(camera); el.style.left = ((v.x + 1) / 2) * innerWidth + 'px'; el.style.top = ((1 - v.y) / 2) * innerHeight + 'px'; el.style.display = v.z < 1 ? '' : 'none'; }
  });
  histT += dt; if (histT > 0.5) { histT = 0; hist.push(o.engaged ? o.stoneRpm : 0); if (hist.length > 120) hist.shift(); }
  const now = performance.now();
  if (now - lastText > 120) {
    lastText = now; readouts(); drawOperating(o); drawStrip(o); drawSankey(o);
  }
  placeCamera(); renderer.render(scene, camera);
}
for (let i = 0; i < 120 * 40; i++) M.step(mill, 1 / 120); // warm start close to steady state
mill.time = 0;
for (let i = 0; i < 120; i++) hist.push(mill.out.stoneRpm);
frame();
window.__mill = mill; // handy for experimenting from the console
