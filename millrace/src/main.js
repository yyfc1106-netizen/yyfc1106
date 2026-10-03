import * as THREE from 'three';
import * as M from './mechanics.js';
import { Sim } from './sim.js';
import { WaterSurface } from './surface.js';
import { ScreenSpaceFluid } from './ssf.js';

const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const f = (x, d = 1) => (+x).toFixed(d);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const P = M.P;

/* ---------------- state ---------------- */
const mill = M.create();
let curveKey = '', curveData = [];
const ui = { cutaway: false, timeScale: 1, explode: 0, explodeT: 0, wire: false, labels: false, sacks: 0 };

/* ---------------- scene ---------------- */
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
const ssf = /[?&]nossf/.test(location.search) ? null : ScreenSpaceFluid.create(renderer); // glassy water; null -> mesh fallback
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
const target = new THREE.Vector3(1.2, 3.2, 0);
const orbit = { az: 0.9, el: 0.42, dist: 27 };
const home = { ...orbit }; let userMoved = false;

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
mesh(new THREE.BoxGeometry(3.1, 1.8, 14), mats.stone, gBase, [2.75, -0.5, 0]); // right block
mesh(new THREE.BoxGeometry(2.4, 1.8, 14), mats.stone, gBase, [0, -0.78, 0]); // tail-race floor, top at y = 0.12
mesh(new THREE.BoxGeometry(1.1, 2.2, 14), mats.stone, gBase, [-1.75, 0.6, 0]); // low left wall
mesh(new THREE.BoxGeometry(14, 0.3, 14), mats.grass, gBase, [1.3, -1.5, 0]);
const pit = mesh(new THREE.BoxGeometry(2.4, 0.2, 14), mats.water, gBase, [0.0, 0.2, 4.4]); // tail-race water, top at y = 0.3
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
const RIN = R - 0.5, LEAN = 0.8; // must match fluid.js
const boardAt = (a, r) => { const t = (r - RIN) / (R - RIN), ang = a - LEAN * t; return [Math.cos(ang) * r, Math.sin(ang) * r]; };
for (let i = 0; i < P.NB; i++) {
  const a = (i / P.NB) * Math.PI * 2, [y0, z0] = boardAt(a, RIN), [y1, z1] = boardAt(a, R);
  const len = Math.hypot(y1 - y0, z1 - z0);
  const b = mesh(new THREE.BoxGeometry(W, 0.03, len), mats.pale, wheel, [0, (y0 + y1) / 2, (z0 + z1) / 2]);
  b.rotation.x = Math.atan2(-(y1 - y0), z1 - z0);
}
for (const sx of [-1, 1]) { const sh = mesh(new THREE.TorusGeometry(RIN, 0.04, 6, 64), mats.oak, wheel, [sx * (W / 2), 0, 0]); sh.rotation.y = Math.PI / 2; }
const shroud = mesh(new THREE.CylinderGeometry(RIN, RIN, W, 48, 1, true), mats.oak, wheel); shroud.rotation.z = Math.PI / 2; shroud.material = mats.oak.clone(); shroud.material.side = THREE.DoubleSide;
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
const NP = 1600;
const pPos = new Float32Array(NP * 3); // filled from the simulation snapshot
const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setDrawRange(0, 0);
const dotTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'); const gr = g.createRadialGradient(16, 16, 2, 16, 16, 15); gr.addColorStop(0, '#fff'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
const pts = new THREE.Points(pGeo, new THREE.PointsMaterial({ map: dotTex, alphaTest: 0.05, color: 0x3fd0e8, size: 0.2, transparent: true, opacity: 0.9, depthWrite: false }));
pts.frustumCulled = false; scene.add(pts);
const water = new WaterSurface(scene);
let surfaceDirty = false;
if (ssf) { pts.visible = false; water.mesh.visible = false; }

/* sphere centres for the screen-space renderer: the 2D slab is replicated across the wheel width */
const KCOPY = 6, SLAB = 1.15, DENSE = 5; // particles with >= DENSE neighbours are water body, the rest spray
const fluidGeo = new THREE.BufferGeometry(), fluidPos = new Float32Array(NP * KCOPY * 3);
fluidGeo.setAttribute('position', new THREE.BufferAttribute(fluidPos, 3).setUsage(THREE.DynamicDrawUsage)); fluidGeo.setDrawRange(0, 0);
const fluidPts = new THREE.Points(fluidGeo, new THREE.PointsMaterial({ size: 0.05, color: 0x3fd0e8 }));
fluidPts.frustumCulled = false; fluidPts.visible = !!ssf; scene.add(fluidPts);
let fluidCount = 0;

/* spray droplets and tail-race foam, spawned from fast / falling fluid particles */
const FN = 2500, fPos = new Float32Array(FN * 3), fVel = new Float32Array(FN * 3), fLife = new Float32Array(FN), fMax = new Float32Array(FN), fType = new Uint8Array(FN), fAlpha = new Float32Array(FN), fSize = new Float32Array(FN);
let fN = 0;
const foamGeo = new THREE.BufferGeometry();
foamGeo.setAttribute('position', new THREE.BufferAttribute(fPos, 3).setUsage(THREE.DynamicDrawUsage));
foamGeo.setAttribute('aAlpha', new THREE.BufferAttribute(fAlpha, 1).setUsage(THREE.DynamicDrawUsage));
foamGeo.setAttribute('aSize', new THREE.BufferAttribute(fSize, 1).setUsage(THREE.DynamicDrawUsage)); foamGeo.setDrawRange(0, 0);
const foamMat = new THREE.ShaderMaterial({
  uniforms: { uScale: { value: 1 } }, transparent: true, depthWrite: false,
  vertexShader: 'attribute float aAlpha, aSize; uniform float uScale; varying float vA; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); vA = aAlpha; gl_Position = projectionMatrix * mv; gl_PointSize = clamp(aSize * uScale / max(0.05, -mv.z), 1.0, 64.0); }',
  fragmentShader: 'varying float vA; void main(){ float r = length(gl_PointCoord*2.-1.); if (r > 1.) discard; gl_FragColor = vec4(vec3(0.95,0.98,1.0), vA * (1.-r*r)); }',
});
const foam = new THREE.Points(foamGeo, foamMat); foam.frustumCulled = false; foam.renderOrder = 3; scene.add(foam);

/* flour dust around the running stones */
const DN = 400, dPos = new Float32Array(DN * 3), dVel = new Float32Array(DN * 3), dLife = new Float32Array(DN);
let dN = 0;
const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3).setUsage(THREE.DynamicDrawUsage)); dustGeo.setDrawRange(0, 0);
const dustPts = new THREE.Points(dustGeo, new THREE.PointsMaterial({ map: dotTex, alphaTest: 0.02, color: 0xf3e9d2, size: 0.16, transparent: true, opacity: 0.45, depthWrite: false }));
dustPts.frustumCulled = false; scene.add(dustPts);
let dustAcc = 0;
function stepDust(dt, o) {
  dustAcc += dt * o.throughput / 120 * 28;
  while (dustAcc >= 1 && dN < DN) {
    dustAcc -= 1; const s = Math.random() < 0.5 ? -1 : 1; if (!mill.stones[s < 0 ? 0 : 1].engaged) continue;
    const a = Math.random() * 6.283, r = 0.78 + Math.random() * 0.1, i = dN++ * 3;
    dPos[i] = 2.5 + Math.cos(a) * r; dPos[i + 1] = 4.85 + Math.random() * 0.1; dPos[i + 2] = s * 1.45 + Math.sin(a) * r;
    dVel[i] = Math.cos(a) * 0.25 + (Math.random() - 0.5) * 0.1; dVel[i + 1] = 0.12 + Math.random() * 0.15; dVel[i + 2] = Math.sin(a) * 0.25 + (Math.random() - 0.5) * 0.1; dLife[i / 3] = 1 + Math.random() * 1.2;
  }
  dustAcc = Math.min(dustAcc, 3);
  for (let n = 0; n < dN; ) {
    const i = n * 3; dLife[n] -= dt;
    if (dLife[n] <= 0) { const l = --dN * 3; for (let k = 0; k < 3; k++) { dPos[i + k] = dPos[l + k]; dVel[i + k] = dVel[l + k]; } dLife[n] = dLife[dN]; continue; }
    dPos[i] += dVel[i] * dt; dPos[i + 1] += dVel[i + 1] * dt; dPos[i + 2] += dVel[i + 2] * dt; n++;
  }
  dustGeo.setDrawRange(0, dN); dustGeo.attributes.position.needsUpdate = true;
}
const TAIL_Y = 0.34;
function spawnFoam(x, y, z, vx, vy, vz, life, type, size) {
  if (fN >= FN) return; const i = fN++, a = i * 3;
  fPos[a] = x; fPos[a + 1] = y; fPos[a + 2] = z; fVel[a] = vx; fVel[a + 1] = vy; fVel[a + 2] = vz; fLife[i] = fMax[i] = life; fType[i] = type; fSize[i] = size;
}
function spawnFromSnapshot(snap, dt) {
  if (dt <= 0) return; const { pos, vel, n } = snap, rnd = Math.random;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2], vy = vel[i * 2], vz = vel[i * 2 + 1], sp = Math.hypot(vy, vz);
    if (y < 1.0 && vy < -1.0) { // plunging into the tail race
      if (rnd() < dt * -vy * 1.0) spawnFoam(x + (rnd() - 0.5) * 0.3, TAIL_Y, z + (rnd() - 0.5) * 0.2, 0, 0, 0, 2.5 + rnd() * 2.5, 1, 0.24);
      if (rnd() < dt * -vy * 2.0) spawnFoam(x, TAIL_Y + 0.05, z, (rnd() - 0.5) * 1.4, 0.6 + rnd() * 1.6, vz * 0.3 + (rnd() - 0.5) * 1.2, 0.5 + rnd() * 0.5, 0, 0.05);
    } else if (sp > 2.3 && rnd() < dt * (sp - 2.3) * 1.4) {
      spawnFoam(x + (rnd() - 0.5) * 0.4, y, z + (rnd() - 0.5) * 0.04, (rnd() - 0.5) * 0.5, vy * 0.9 + (rnd() - 0.3) * 0.5, vz * 0.9 + (rnd() - 0.5) * 0.5, 0.35 + rnd() * 0.5, 0, 0.045);
    }
  }
}
function stepFoam(dt, Q) {
  for (let i = 0; i < fN; ) {
    const a = i * 3;
    if (fType[i] === 0) { // droplet
      fVel[a + 1] -= 9.81 * dt; const k = Math.exp(-0.9 * dt); fVel[a] *= k; fVel[a + 1] *= k; fVel[a + 2] *= k;
      fPos[a] += fVel[a] * dt; fPos[a + 1] += fVel[a + 1] * dt; fPos[a + 2] += fVel[a + 2] * dt;
      if (fPos[a + 1] < TAIL_Y) { fType[i] = 1; fPos[a + 1] = TAIL_Y; fLife[i] = fMax[i] = 1.5 + Math.random() * 2; fSize[i] = 0.22; }
    } else { // foam drifting down the tail race
      fPos[a + 2] += (0.35 + Q * 2.5 + Math.sin(fPos[a] * 7 + performance.now() * 0.0013) * 0.08) * dt;
      fPos[a] = Math.max(-1.05, Math.min(1.05, fPos[a] + Math.sin(fPos[a + 2] * 5 + performance.now() * 0.0017) * 0.05 * dt));
    }
    fLife[i] -= dt;
    if (fLife[i] <= 0 || fPos[a + 2] > 9) { const l = --fN, b = l * 3; for (let k = 0; k < 3; k++) { fPos[a + k] = fPos[b + k]; fVel[a + k] = fVel[b + k]; } fLife[i] = fLife[l]; fMax[i] = fMax[l]; fType[i] = fType[l]; fSize[i] = fSize[l]; continue; }
    const u = fLife[i] / fMax[i]; fAlpha[i] = (fType[i] === 1 ? 0.55 : 0.9) * Math.min(1, u * 3) * (fType[i] === 1 ? Math.min(1, (1 - u) * 6 + 0.2) : 1);
    i++;
  }
  foamGeo.setDrawRange(0, fN); foamGeo.attributes.position.needsUpdate = foamGeo.attributes.aAlpha.needsUpdate = foamGeo.attributes.aSize.needsUpdate = true;
}


/* ---------------- hover names and click-to-focus ---------------- */
const INFO = {
  'Foundation': 'Stone-lined wheel pit and tail race.',
  'Flume & gate': 'Oak flume and sluice gate: the gate opening sets the flow.',
  'Overshot wheel': '4.8 m wheel with 36 buckets. Water enters at the top and its weight turns the wheel.',
  'Gear train': 'Pit wheel, wallower, great spur wheel and stone nuts: 18 : 1 speed-up.',
  'Millstones': '1.2 m runner and bed stones. Lift the stone nut out of gear to stop a pair.',
  'Hopper & sack': 'Grain hopper feeds the stones; flour falls into the sack (50 kg).',
};
const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2(), pickMeshes = [];
groups.forEach((g) => g.traverse((o) => { if (o.isMesh) { o.userData.group = g; pickMeshes.push(o); } }));
let hoverAt = null, hoverGroup = null;
function pick(x, y) {
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1); raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(pickMeshes, false).find((h) => h.object.visible && h.object.userData.group);
  return hit ? hit.object.userData.group : null;
}
function updateHover() {
  const tag = $('hover');
  if (!hoverAt || drag) { tag.style.display = 'none'; canvas.style.cursor = ''; return; }
  const g = pick(hoverAt.x, hoverAt.y); hoverGroup = g;
  canvas.style.cursor = g ? 'pointer' : '';
  if (!g) { tag.style.display = 'none'; return; }
  tag.innerHTML = `<b>${g.userData.name}</b>${INFO[g.userData.name] || ''}`;
  tag.style.display = 'block'; tag.style.left = Math.min(innerWidth - 250, hoverAt.x + 14) + 'px'; tag.style.top = hoverAt.y + 14 + 'px';
}
function clickAt(x, y) {
  const g = pick(x, y);
  if (!g) { if (focused) unfocus(); return; }
  focused = g;
  const box = new THREE.Box3().setFromObject(g), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
  goTo({ az: orbit.az, el: orbit.el, dist: clamp(Math.max(sz.x, sz.y, sz.z) * 1.9 + 3, 7, 30), t: c });
}
function unfocus() { if (!focused) return; focused = null; goTo({ az: orbit.az, el: orbit.el, dist: home.dist, t: homeTarget.clone() }); }
function stepCamera(real) {
  if (!goal) return;
  const k = reduced ? 1 : 1 - Math.exp(-7 * Math.min(real, 0.25)); let d = 0;
  orbit.az += (goal.az - orbit.az) * k; orbit.el += (goal.el - orbit.el) * k; orbit.dist += (goal.dist - orbit.dist) * k;
  target.lerp(goal.t, k);
  d = Math.abs(goal.az - orbit.az) + Math.abs(goal.el - orbit.el) + Math.abs(goal.dist - orbit.dist) + target.distanceTo(goal.t);
  if (d < 0.01) goal = null;
}

/* ---------------- simulation backend (worker, or main-thread fallback) ---------------- */
const net = { worker: null, local: null, ready: false, stamp: 0 };
const fluidDots = []; // Fig. 1: (wheel rpm, fluid torque) samples
let lastDot = -1;
function ingest(snap) {
  Object.assign(mill, { theta: snap.theta, omega: snap.omega, time: snap.time, tauWater: snap.tauWater, out: snap.out, stones: snap.stones });
  pPos.set(snap.pos.subarray(0, Math.min(snap.pos.length, NP * 3)));
  pGeo.setDrawRange(0, Math.min(snap.n, NP)); pGeo.attributes.position.needsUpdate = true;
  const nowMs = performance.now(); spawnFromSnapshot(snap, net.stamp ? Math.min((nowMs - net.stamp) / 1000, 0.05) * ui.timeScale : 0);
  net.stamp = nowMs; surfaceDirty = snap.n;
  if (ssf) {
    const m = Math.min(snap.n, NP); let o = 0;
    for (let i = 0; i < m; i++) {
      const hx = snap.pos[i * 3] / 0.9 + 0.5, y = snap.pos[i * 3 + 1], z = snap.pos[i * 3 + 2];
      if (snap.nn[i] >= DENSE) for (let k = 0; k < KCOPY; k++) { const px = ((k + hx) / KCOPY - 0.5) * SLAB; if (ui.cutaway && px < 0) continue; fluidPos[o++] = px; fluidPos[o++] = y; fluidPos[o++] = z; }
      else if (!ui.cutaway || snap.pos[i * 3] >= 0) { fluidPos[o++] = snap.pos[i * 3] * 1.2; fluidPos[o++] = y; fluidPos[o++] = z; } // spray: a single droplet
    }
    fluidCount = o / 3; fluidGeo.setDrawRange(0, fluidCount); fluidGeo.attributes.position.needsUpdate = true;
  }
  if (snap.time - lastDot > 0.25) {
    lastDot = snap.time; fluidDots.push({ t: snap.time, rpm: snap.out.wheelRpm, tau: snap.fluidTau / 1e3 });
    while (fluidDots.length && fluidDots[0].t < snap.time - 20) fluidDots.shift();
  }
}
function send(msg) { if (net.worker) net.worker.postMessage(msg); else if (net.local) { if (msg.type === 'ctl') net.local.setCtl(msg.ctl); else if (msg.type === 'engage') net.local.engage(msg.i, msg.on); } }
const loadBar = $('loadBar');
function ready() { net.ready = true; $('loading').style.display = 'none'; }
function setStatus(t) { const e = document.querySelector('#loading small'); if (e) e.textContent = t; }
addEventListener('error', (e) => setStatus('error: ' + e.message));
addEventListener('unhandledrejection', (e) => setStatus('error: ' + (e.reason && e.reason.message || e.reason)));
function startLocal() {
  if (net.worker) { try { net.worker.terminate(); } catch {} net.worker = null; }
  const sim = new Sim(); sim.setCtl(mill.ctl); sim.prime(); net.local = sim;
  net.mode = 'main thread'; ingest(sim.snapshot()); ready();
}
function startBackend() {
  if (/[?&]local/.test(location.search) || typeof Worker === 'undefined') return startLocal();
  let alive = false;
  try {
    const w = new Worker(new URL('./physics.worker.js', import.meta.url), { type: 'module' });
    net.worker = w;
    const bail = setTimeout(() => { if (!alive) { setStatus('worker did not answer, running on the main thread'); startLocal(); } }, 2500);
    w.onerror = (e) => { clearTimeout(bail); setStatus('worker failed: ' + (e.message || 'blocked')); if (!net.ready) startLocal(); };
    w.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'progress') { alive = true; loadBar.style.width = d.p * 100 + '%'; }
      else if (d.type === 'ready') { alive = true; clearTimeout(bail); net.mode = 'worker'; ready(); }
      else if (d.type === 'state') ingest(d.s);
    };
    w.postMessage({ type: 'init', ctl: { ...mill.ctl } });
  } catch { startLocal(); }
}

/* ---------------- camera & input ---------------- */
function placeCamera() {
  const { az, el, dist } = orbit;
  camera.position.set(target.x + dist * Math.cos(el) * Math.sin(az), target.y + dist * Math.sin(el), target.z + dist * Math.cos(el) * Math.cos(az));
  camera.lookAt(target);
}
/* smooth camera moves: section view, click-to-focus, reset */
let goal = null, focused = null;
const homeTarget = target.clone();
function goTo(g) { goal = g; }
let drag = null, downAt = null;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; downAt = { x: e.clientX, y: e.clientY }; goal = null; userMoved = true; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  orbit.az -= (e.clientX - drag.x) * 0.006; orbit.el = clamp(orbit.el + (e.clientY - drag.y) * 0.005, 0.05, 1.45);
  drag = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointerup', (e) => {
  const click = downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 5; drag = null; downAt = null;
  if (click) clickAt(e.clientX, e.clientY);
});
canvas.addEventListener('pointermove', (e) => { hoverAt = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerleave', () => { hoverAt = null; $('hover').style.display = 'none'; });
addEventListener('keydown', (e) => { if (e.key === 'Escape') unfocus(); });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); goal = null; userMoved = true; orbit.dist = clamp(orbit.dist * Math.exp(e.deltaY * 0.001), 6, 40); }, { passive: false });
$('reset').onclick = () => { focused = null; userMoved = false; goTo({ az: home.az, el: home.el, dist: home.dist, t: homeTarget.clone() }); };

function resize() {
  const w = innerWidth, h = innerHeight, narrow = w <= 820;
  renderer.setSize(w, h, false); camera.aspect = w / h;
  camera.setViewOffset(w, h, narrow ? 0 : 230, narrow ? Math.round(h * 0.2) : 0, w, h); // keep the model clear of the panel
  home.dist = narrow ? Math.min(60, 27 / Math.min(1, w / h) * 0.75) : 27;
  if (!userMoved && !goal) orbit.dist = home.dist;
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
  const upd = () => { mill.ctl[k] = el.value / 100; $(k + 'Out').innerHTML = sliders[k].out(mill.ctl[k]); curveKey = ''; send({ type: 'ctl', ctl: { [k]: mill.ctl[k] } }); };
  el.addEventListener('input', upd); upd();
}
$('brake').onclick = () => { mill.ctl.brake = !mill.ctl.brake; send({ type: 'ctl', ctl: { brake: mill.ctl.brake } }); $('brake').setAttribute('aria-pressed', mill.ctl.brake); $('brakeS').textContent = mill.ctl.brake ? 'On' : 'Off'; };
for (const i of [0, 1]) $('pair' + i).onclick = () => {
  const on = !mill.stones[i].engaged; send({ type: 'engage', i, on }); mill.stones[i].engaged = on;
  $('pair' + i).setAttribute('aria-pressed', on); $('pair' + i + 's').textContent = on ? 'In gear' : 'Out of gear'; curveKey = '';
};
document.querySelectorAll('#speed button').forEach((b) => (b.onclick = () => {
  ui.timeScale = +b.dataset.s; send({ type: 'scale', s: ui.timeScale }); document.querySelectorAll('#speed button').forEach((x) => x.setAttribute('aria-pressed', x === b));
}));
document.querySelectorAll('#views button').forEach((b) => (b.onclick = () => {
  const k = b.dataset.view; ui[k] = !ui[k]; b.setAttribute('aria-pressed', ui[k]);
  if (k === 'explode') ui.explodeT = ui.explode ? 1 : 0;
  if (k === 'cutaway') setCutaway(ui.cutaway);
  if (k === 'wire') allMats.forEach((m) => (m.wireframe = ui.wire));
  if (k === 'labels') $('labels').style.display = ui.labels ? '' : 'none';
}));
$('labels').style.display = 'none';
const cutPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0); // keeps x >= 0; the camera swings round to look at the cut face
function setCutaway(on) {
  renderer.clippingPlanes = on ? [cutPlane] : [];
  for (const m of [mats.stone, mats.earth, mats.grass, mats.water]) { m.side = on ? THREE.DoubleSide : THREE.FrontSide; m.needsUpdate = true; }
  goTo(on ? { az: -1.25, el: 0.3, dist: Math.min(orbit.dist, 24), t: target.clone() } : { az: home.az, el: home.el, dist: orbit.dist, t: target.clone() });
}
groups.forEach((g) => { const s = document.createElement('span'); s.textContent = g.userData.name; g.userData.el = s; $('labels').appendChild(s); });
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  document.querySelectorAll('[data-theme-set]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.themeSet === t));
  scene.background = new THREE.Color(css('--bg')); if (ssf) ssf.setSky(css('--bg'));
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
  c.fillStyle = css('--ink'); c.globalAlpha = 0.45; fluidDots.forEach((d) => { c.beginPath(); c.arc(X(d.rpm), Y(d.tau), 2, 0, 7); c.fill(); }); c.globalAlpha = 1;
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
  let y = 10, lastLy = -99;
  segs.forEach(([name, v, col]) => {
    const hh = v * scale; if (hh < 0.5) return;
    c.globalAlpha = 0.28; c.fillStyle = css(col); c.beginPath(); c.moveTo(x0, 10 + (y - 10)); c.lineTo(x1, y); c.lineTo(x1, y + hh); c.lineTo(x0, y - 10 + 10 + hh); c.closePath(); c.fill();
    c.globalAlpha = 1; c.fillRect(x1, y, 14, hh); c.fillStyle = css('--ink');
    const ly = Math.max(y + Math.max(8, hh / 2 + 3), lastLy + 11); lastLy = ly;
    c.fillText(`${name} ${f(v, 2)}`, x1 + 20, ly); y += hh + 2;
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
  const real = Math.min(clock.getDelta(), 0.25), dt = Math.min(real, 0.05) * ui.timeScale;
  if (net.local && net.ready) { net.local.advance(dt); ingest(net.local.snapshot()); }
  if (!net.ready) { placeCamera(); renderer.render(scene, camera); return; }
  if (surfaceDirty !== false) { if (!ssf) water.update(pPos, surfaceDirty); surfaceDirty = false; }
  if (dt > 0) { stepFoam(dt, mill.out.Q || 0); stepDust(dt, mill.out); }
  stepCamera(real);
  if (hoverAt) updateHover();
  const o = mill.out;
  const ahead = net.local ? 0 : clamp(((performance.now() - net.stamp) / 1000) * ui.timeScale, 0, 0.05); // smooth between worker snapshots
  const th = mill.theta + mill.omega * ahead;
  wheel.rotation.x = th; pitWheel.rotation.x = th;
  const pi = th * P.r1; upright.rotation.y = pi;
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
  if (net.ready && now - lastText > 120) {
    lastText = now; readouts(); drawOperating(o); drawStrip(o); drawSankey(o);
  }
  placeCamera();
  foamMat.uniforms.uScale.value = renderer.domElement.height * 0.5 * camera.projectionMatrix.elements[5];
  if (ssf) ssf.render(scene, camera, fluidPts, fluidCount); else renderer.render(scene, camera);
}
startBackend();
frame();
window.__mill = mill; window.__orbit = orbit; window.__ssf = ssf; window.__r = renderer; window.__fc = () => fluidCount; window.__dust = () => dN; window.__sacks = () => fullSacks.children.length; window.__screen = (name) => { const g = groups.find((x) => x.userData.name === name); const v = g.userData.labelAt.clone().add(g.position).sub(g.userData.base).project(camera); return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight }; }; window.__cut = () => renderer.clippingPlanes.length; window.__cam = camera; window.__goal = () => goal && { dist: goal.dist }; window.__focused = () => focused && focused.userData.name; window.__ui = ui; window.__net = net; // handy for experimenting from the console
