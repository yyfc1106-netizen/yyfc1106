// Builds the mill diorama: a cut-away block of terrain (soil strata under grass), a masonry-lined wheel pit and tail race,
// the overshot wheel, a timber frame carrying two pairs of millstones, the gear train, hoppers, sacks and the sluice.
// Everything is procedural (geometry + canvas textures). main.js drives the moving parts through the returned handles.

import * as THREE from 'three';
import { makeTextures } from './textures.js';

export const LAYOUT = {
  TOP: 4.85, BOT: -2.4, // terrain top (grass) and bottom of the block
  FLOOR: 1.3, // platform (gear floor)
  DECK: 4.1, // stone-floor deck, under the millstones
  WC: new THREE.Vector3(0, 2.6, 0), // wheel centre
  W: 1.3, R: 2.4, RIN: 1.9, LEAN: 0.9, NB: 36,
  FLUME_Y: 5.05, // flume floor (top)
  TAIL_Y: 0.34,
};

export function buildScene(scene, renderer, P) {
  const L = LAYOUT, { TOP, BOT, FLOOR, DECK, WC, W, R, RIN, LEAN, NB } = L;
  const T = makeTextures(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

  /* ---------- materials ---------- */
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...o });
  const mats = {
    grass: std({ map: T.grass, roughness: 1 }),
    masonry: std({ map: T.masonry, roughness: 0.95 }),
    oak: std({ map: T.oak, roughness: 0.8 }),
    oakPale: std({ map: T.oakPale, roughness: 0.85 }),
    floor: std({ map: T.floor, roughness: 0.9 }),
    paving: std({ map: T.paving, roughness: 0.9 }),
    plinth: std({ map: T.plinth, roughness: 0.9 }),
    iron: std({ color: 0xa9b2bd, roughness: 0.45, metalness: 0.45 }),
    ironDark: std({ color: 0x59606b, roughness: 0.5, metalness: 0.5 }),
    burlap: std({ map: T.burlap, roughness: 1, side: THREE.DoubleSide }),
    flour: std({ map: T.flour, roughness: 1 }),
    grain: std({ map: T.grain, roughness: 0.85 }),
    stoneCase: std({ color: 0xcfc4ad, roughness: 0.95 }),
    water: new THREE.MeshStandardMaterial({ color: 0x35b6c6, emissive: 0x0d4a57, roughness: 0.12, transparent: true, opacity: 0.78, depthWrite: false }),
  };
  const strataCache = new Map();
  const strata = (len) => { // vertical strata, repeated along the face
    const k = Math.round(len * 2) / 2; if (!strataCache.has(k)) { const t = T.strata.clone(); t.needsUpdate = true; t.repeat.set(Math.max(1, k / 6), 1); t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; strataCache.set(k, std({ map: t, roughness: 1 })); }
    return strataCache.get(k);
  };
  const millstoneMat = (flip) => std({ map: T.millstone(flip), roughness: 0.95 });
  const allMats = () => [...Object.values(mats), ...strataCache.values()];

  /* ---------- helpers ---------- */
  const groups = [];
  const group = (name, info, offset, labelAt, opts = {}) => {
    const g = new THREE.Group(); g.userData = { name, info, offset: new THREE.Vector3(...offset), labelAt: new THREE.Vector3(...labelAt), label: opts.label !== false };
    scene.add(g); groups.push(g); return g;
  };
  const mesh = (geo, mat, parent, pos = [0, 0, 0], o = {}) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(...pos);
    m.castShadow = o.cast !== false; m.receiveShadow = o.recv !== false; parent.add(m); return m;
  };
  /** Box whose UVs tile with its world size, so textures keep a constant scale (tile metres per repeat). */
  const tiledBox = (w, h, d, tile = 1.6) => {
    const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, (uv.getX(k) * dims[f][0]) / tile, (uv.getY(k) * dims[f][1]) / tile); }
    return g;
  };
  const box = (parent, mat, x0, x1, y0, y1, z0, z1, tile = 1.6) => mesh(tiledBox(x1 - x0, y1 - y0, z1 - z0, tile), mat, parent, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]);
  /** Square-section beam between two points. */
  const beam = (parent, mat, a, b, t = 0.16, t2 = t) => {
    const p = new THREE.Vector3(...a), q = new THREE.Vector3(...b), len = p.distanceTo(q);
    const m = mesh(new THREE.BoxGeometry(t, t2, len), mat, parent); m.position.copy(p).add(q).multiplyScalar(0.5);
    m.lookAt(q); return m;
  };
  const cyl = (parent, mat, r, h, pos, rot = [0, 0, 0], seg = 20) => { const m = mesh(new THREE.CylinderGeometry(r, r, h, seg), mat, parent, pos); m.rotation.set(...rot); return m; };

  /** Flat gear: rim ring, spokes, hub, and instanced teeth. axis 'x': gear plane is y-z (vertical wheel); 'y': horizontal. */
  const toothGeo = new THREE.BoxGeometry(1, 1, 1);
  function gear(parent, r, teeth, thick, axis, mat = mats.iron, spokes = 6) {
    const g = new THREE.Group(); parent.add(g);
    const body = new THREE.Group(); g.add(body); if (axis === 'x') body.rotation.z = Math.PI / 2;
    const ringIn = r * 0.9, shape = new THREE.Shape(); shape.absarc(0, 0, r, 0, 6.2832); const hole = new THREE.Path(); hole.absarc(0, 0, ringIn, 0, 6.2832, true); shape.holes.push(hole);
    const ring = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 48 }), mat); ring.rotation.x = Math.PI / 2; ring.position.y = thick / 2; ring.castShadow = ring.receiveShadow = true; body.add(ring);
    for (let i = 0; i < spokes; i++) { const s = mesh(new THREE.BoxGeometry(r * 0.07, thick * 0.8, ringIn), mat, body); s.position.set(Math.sin((i / spokes) * 6.2832) * ringIn / 2, 0, Math.cos((i / spokes) * 6.2832) * ringIn / 2); s.rotation.y = (i / spokes) * 6.2832; }
    cyl(body, mat, r * 0.16, thick * 1.3, [0, 0, 0], [0, 0, 0], 16);
    const inst = new THREE.InstancedMesh(toothGeo, mat, teeth), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(r * 0.12, thick, (2 * Math.PI * r / teeth) * 0.5);
    for (let i = 0; i < teeth; i++) { const a = (i / teeth) * 6.2832; pos.set(Math.cos(a) * (r + r * 0.05), 0, Math.sin(a) * (r + r * 0.05)); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a); m4.compose(pos, q, sc); inst.setMatrixAt(i, m4); }
    inst.castShadow = true; body.add(inst);
    return g;
  }

  /* ================= TERRAIN ================= */
  const gTerrain = group('Terrain', 'A cut-away block of the valley side: humus, clay, gravel and bedrock under grass.', [0, 0, 0], [-3, TOP, 2], { label: false });
  const H = TOP - BOT, ym = (TOP + BOT) / 2;
  function block(x0, x1, z0, z1, topMat = mats.grass) {
    const sx = x1 - x0, sz = z1 - z0;
    const geo = new THREE.BoxGeometry(sx, H, sz);
    const m = new THREE.Mesh(geo, [strata(sz), strata(sz), topMat, strata(sx), strata(sx), strata(sx)]);
    m.position.set((x0 + x1) / 2, ym, (z0 + z1) / 2); m.castShadow = m.receiveShadow = true; gTerrain.add(m);
    // grass UVs follow world size
    const uv = geo.attributes.uv; for (let i = 8; i < 12; i++) uv.setXY(i, uv.getX(i) * sx / 7, uv.getY(i) * sz / 7);
    return m;
  }
  const XL = -5.5, XR = 6.5, ZB = -7.5, ZF = 4.6, PX = 1.05, PZ0 = -3.0, PZ1 = 3.2, PXE = 5.4;
  block(XL, -PX, ZB, PZ0); // left bank, behind the wheel
  block(PX, XR, ZB, PZ0); // right bank, behind the platform
  block(PX, XR, PZ1, ZF); // right bank, in front
  block(PXE, XR, PZ0, PZ1); // end of the platform
  // shorter blocks under the platform and the headrace: the strata keep their world height (v is measured from the block bottom)
  const lowBlock = (x0, x1, z0, z1, top, topMat, tile = 1.6) => {
    const sx = x1 - x0, sz = z1 - z0, h = top - BOT, geo = new THREE.BoxGeometry(sx, h, sz), uv = geo.attributes.uv;
    for (const f of [0, 1, 4, 5]) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setY(k, uv.getY(k) * (h / H)); }
    for (let i = 8; i < 12; i++) uv.setXY(i, uv.getX(i) * sx / tile, uv.getY(i) * sz / tile);
    const m = new THREE.Mesh(geo, [strata(sz), strata(sz), topMat, strata(sx), strata(sx), strata(sx)]);
    m.position.set((x0 + x1) / 2, (BOT + top) / 2, (z0 + z1) / 2); m.castShadow = m.receiveShadow = true; gTerrain.add(m); return m;
  };
  lowBlock(XL, -PX, PZ0, ZF, 2.5, mats.grass, 7); // left terrace, cut back so the wheel can be seen from the left
  lowBlock(PX, PXE, PZ0, PZ1, FLOOR, mats.floor, 1.2); // platform base
  lowBlock(-PX, PX, ZB, PZ0, 5.05, mats.paving, 1.5); // under the headrace
  const gPit = group('Wheel pit', 'Masonry-lined pit that holds the wheel.', [0, 0, 0], [0, 2, 0], { label: false });
  box(gPit, mats.paving, -PX, PX, BOT, -0.05, PZ0, ZF, 1.5); // pit and tail-race floor
  // the strata on the front face of the floor block
  box(gPit, mats.masonry, -PX, -0.75, -0.05, 2.5, PZ0, ZF); box(gPit, mats.masonry, -PX, -0.75, 2.5, TOP, PZ0, PZ0 + 0.35); // left pit wall, low beside the wheel
  box(gPit, mats.masonry, 0.75, PX, -0.05, TOP, PZ0, ZF); // right pit wall
  box(gPit, mats.masonry, -0.75, 0.75, -0.05, 4.4, PZ0 - 0.3, PZ0); // back wall
  box(gPit, mats.masonry, PX, PXE, FLOOR, TOP, PZ0, PZ0 + 0.18); box(gPit, mats.masonry, PX, PXE, FLOOR, TOP, PZ1 - 0.18, PZ1); box(gPit, mats.masonry, PXE - 0.18, PXE, FLOOR, TOP, PZ0, PZ1); // platform walls
  // coping stones along the pit edge
  box(gPit, mats.masonry, -PX - 0.05, -0.7, 2.5, 2.58, PZ0, ZF, 0.8); box(gPit, mats.masonry, 0.7, PX + 0.05, TOP, TOP + 0.08, PZ0, ZF, 0.8);
  // headrace: raised masonry leat behind the flume
  box(gPit, mats.masonry, -PX, -0.68, 5.05, 5.6, ZB, PZ0, 1.2); box(gPit, mats.masonry, 0.68, PX, 5.05, 5.6, ZB, PZ0, 1.2);
  // plinth under the whole block
  mesh(tiledBox(XR - XL + 0.6, 0.3, ZF - ZB + 0.6, 2), mats.plinth, gTerrain, [(XL + XR) / 2, BOT - 0.15, (ZB + ZF) / 2]);

  /* ================= WATER SURFACES ================= */
  const gFlume = group('Flume', 'Oak trough carrying the head of water from the leat to the wheel.', [0, 1.4, -1.6], [0, 5.8, -2.4]);
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.24, 1, 6.53), mats.water); head.castShadow = false; head.receiveShadow = false; head.position.set(0, 5.1, -4.235); gFlume.add(head);
  box(gFlume, mats.oak, -0.72, 0.72, 4.93, 5.05, -3.4, -0.97, 1.2); // flume floor
  for (const s of [-1, 1]) box(gFlume, mats.oak, s > 0 ? 0.62 : -0.72, s > 0 ? 0.72 : -0.62, 5.05, 5.7, -3.4, -0.97, 1.2);
  for (const z of [-2.7, -1.45]) { box(gFlume, mats.oak, -1.2, 1.2, 4.75, 4.93, z - 0.12, z + 0.12, 1.2); box(gFlume, mats.oak, -0.72, 0.72, 5.7, 5.78, z - 0.06, z + 0.06, 1.2); }
  const tailWater = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.28, ZF - 2.0), mats.water); tailWater.castShadow = false; tailWater.position.set(0, 0.09, (ZF + 2.0) / 2 - 0.0);
  const gTail = group('Tailrace', 'Stone-lined channel returning the water to the stream.', [0, 0, 1.8], [0, 0.6, 3.8]);
  gTail.add(tailWater); tailWater.position.set(0, 0.15, 3.3);

  /* ================= SLUICE GATE ================= */
  const gGate = group('Sluice gate', 'Slide gate and screw. The opening, a, sets the flow.', [0, 1.8, -1.2], [0, 7.4, -1.05]);
  for (const s of [-1, 1]) box(gGate, mats.oak, s * 0.72 - 0.08, s * 0.72 + 0.08, 5.05, 7.0, -1.14, -0.98, 1.2);
  box(gGate, mats.oak, -0.8, 0.8, 6.95, 7.12, -1.18, -0.94, 1.2);
  const gate = mesh(new THREE.BoxGeometry(1.26, 1.1, 0.07), mats.ironDark, gGate, [0, 5.6, -1.06]);
  const gateRod = cyl(gGate, mats.iron, 0.035, 1.6, [0, 6.3, -1.06], [0, 0, 0], 10);
  const gateWheel = new THREE.Group(); gateWheel.position.set(0, 7.2, -1.04); gGate.add(gateWheel);
  const gw = mesh(new THREE.TorusGeometry(0.3, 0.025, 8, 24), mats.iron, gateWheel); gw.rotation.x = Math.PI / 2;
  for (let i = 0; i < 6; i++) { const sp = mesh(new THREE.BoxGeometry(0.05, 0.03, 0.3), mats.iron, gateWheel); sp.rotation.y = (i / 6) * Math.PI * 2 + Math.PI / 2; sp.position.set(Math.cos((i / 6) * Math.PI * 2) * 0.15, 0, Math.sin((i / 6) * Math.PI * 2) * 0.15); sp.rotation.y = -(i / 6) * Math.PI * 2 + Math.PI / 2; }

  /* ================= OVERSHOT WHEEL ================= */
  const gWheel = group('Overshot wheel', '4.8 m wheel with 36 buckets. Water enters at the top; its weight turns the wheel.', [-1.9, 0.5, 0], [0, 5.6, 0]);
  const wheel = new THREE.Group(); wheel.position.copy(WC); gWheel.add(wheel);
  for (const s of [-1, 1]) {
    const rim = mesh(new THREE.TorusGeometry(R, 0.07, 8, 72), mats.oak, wheel, [s * (W / 2), 0, 0]); rim.rotation.y = Math.PI / 2;
    const rim2 = mesh(new THREE.TorusGeometry(RIN - 0.04, 0.06, 8, 56), mats.oak, wheel, [s * (W / 2), 0, 0]); rim2.rotation.y = Math.PI / 2;
    const band = mesh(new THREE.TorusGeometry(RIN - 0.4, 0.035, 6, 48), mats.iron, wheel, [s * (W / 2), 0, 0]); band.rotation.y = Math.PI / 2;
    for (let i = 0; i < 12; i++) { // spokes
      const a = (i / 12) * Math.PI * 2, sp = mesh(new THREE.BoxGeometry(0.1, RIN - 0.25, 0.1), mats.oak, wheel, [s * (W / 2), Math.cos(a) * (RIN / 2 + 0.05), Math.sin(a) * (RIN / 2 + 0.05)]); sp.rotation.x = -a;
    }
  }
  const boardAt = (a, r) => { const t = (r - RIN) / (R - RIN), ang = a - LEAN * t; return [Math.cos(ang) * r, Math.sin(ang) * r]; };
  for (let i = 0; i < NB; i++) { // bucket boards, same geometry as the fluid boundary
    const a = (i / NB) * Math.PI * 2, [y0, z0] = boardAt(a, RIN), [y1, z1] = boardAt(a, R), len = Math.hypot(y1 - y0, z1 - z0);
    const b = mesh(new THREE.BoxGeometry(W, 0.035, len), mats.oakPale, wheel, [0, (y0 + y1) / 2, (z0 + z1) / 2]); b.rotation.x = Math.atan2(-(y1 - y0), z1 - z0);
  }
  const shroud = mesh(new THREE.CylinderGeometry(RIN, RIN, W, 64, 1, true), new THREE.MeshStandardMaterial({ map: T.oak, roughness: 0.85, side: THREE.DoubleSide }), wheel); shroud.rotation.z = Math.PI / 2;

  /* ================= WHEEL SHAFT + BEARINGS ================= */
  const gShaft = group('Wheel shaft', 'Oak shaft with cast-iron gudgeons, carried on stone bearing blocks.', [-1.0, 0.5, 0], [-1.0, 2.6, 0]);
  const shaftMesh = mesh(new THREE.CylinderGeometry(0.17, 0.17, 3.4, 20), mats.oak, gShaft, [0.7, WC.y, 0]); shaftMesh.rotation.z = Math.PI / 2;
  for (const x of [-0.95, 0.95]) {
    box(gShaft, mats.masonry, x - 0.22, x + 0.22, 1.9, 2.25, -0.4, 0.4, 0.8);
    const br = mesh(new THREE.TorusGeometry(0.25, 0.07, 10, 24), mats.iron, gShaft, [x, WC.y, 0]); br.rotation.y = Math.PI / 2;
    box(gShaft, mats.masonry, x - 0.22, x + 0.22, 1.6, 1.95, -0.4, 0.4, 0.8);
  }
  const gudgeon = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 16), mats.iron, gShaft, [2.3, WC.y, 0]); gudgeon.rotation.z = Math.PI / 2;

  /* ================= GEARS ================= */
  const gPit_ = group('Pit wheel, 96 cogs', 'Wooden-cogged wheel fixed on the wheel shaft: 96 cogs.', [0.4, 0, 0], [1.3, 3.9, 0]);
  const pitWheel = new THREE.Group(); pitWheel.position.set(1.3, WC.y, 0); gPit_.add(pitWheel); gear(pitWheel, 1.0, 96, 0.22, 'x', mats.iron, 8);
  const gWall = group('Wallower, 32 teeth', 'Lantern pinion on the upright shaft: 32 teeth.', [0.2, -0.0, 0], [3.0, 2.2, -0.7]);
  const wallowerRot = new THREE.Group(); wallowerRot.position.set(2.5, WC.y, 0); gWall.add(wallowerRot); gear(wallowerRot, 0.4, 32, 0.3, 'y', mats.iron, 4);
  const gUp = group('Upright shaft', 'Vertical shaft carrying the wallower and the great spur wheel.', [0.9, 0.3, 0], [2.5, 6.1, 0.0]);
  const upright = new THREE.Group(); upright.position.set(2.5, 0, 0); gUp.add(upright);
  cyl(upright, mats.oak, 0.14, 4.6, [0, 3.5, 0], [0, 0, 0], 14); cyl(upright, mats.iron, 0.19, 0.12, [0, 5.78, 0], [0, 0, 0], 14);
  const gSpur = group('Great spur wheel, 120 cogs', 'Horizontal wheel with 120 cogs that drives the stone nuts.', [0.5, 1.0, 0], [3.9, 4.0, 0.95]);
  const spurRot = new THREE.Group(); spurRot.position.set(2.5, 3.7, 0); gSpur.add(spurRot); gear(spurRot, 1.15, 120, 0.2, 'y', mats.iron, 8);
  // mount the spur on the same rotating assembly: it turns with the upright, so mirror its rotation in main.js
  const gNut = group('Stone nut, 20 teeth', 'Small pinion on each spindle: 20 teeth. Lift it out of gear to stop that pair of stones.', [0.7, 0.7, 0], [3.7, 3.55, 1.7]);
  const nuts = [-1, 1].map((s) => { const n = new THREE.Group(); n.position.set(2.5, 3.7, s * 1.45); gNut.add(n); gear(n, 0.3, 20, 0.2, 'y', mats.ironDark, 4); cyl(n, mats.iron, 0.06, 1.2, [0, 0.62, 0], [0, 0, 0], 8); return n; });

  /* ================= TIMBER FRAME ================= */
  const gFrame = group('Mill frame', 'Oak frame carrying the stone floor, the hoppers and the bridge trees.', [0, 0, 0], [2.5, 7.4, 0], { label: false });
  for (const s of [-1, 1]) {
    const z0 = s * 1.45;
    for (const dx of [-1.28, 1.28]) for (const dz of [-1.28, 1.28]) box(gFrame, mats.oak, 2.5 + dx - 0.09, 2.5 + dx + 0.09, FLOOR, 7.2, z0 + dz - 0.09, z0 + dz + 0.09, 1.2);
    for (const y of [3.9, 7.2]) { // rails around each bay
      for (const dz of [-1.28, 1.28]) box(gFrame, mats.oak, 2.5 - 1.37, 2.5 + 1.37, y - 0.09, y + 0.09, z0 + dz - 0.08, z0 + dz + 0.08, 1.2);
      for (const dx of [-1.28, 1.28]) box(gFrame, mats.oak, 2.5 + dx - 0.08, 2.5 + dx + 0.08, y - 0.09, y + 0.09, z0 - 1.37, z0 + 1.37, 1.2);
    }
    beam(gFrame, mats.oak, [2.5 - 1.28, 2.2, z0 - 1.28], [2.5 - 1.28, 3.9, z0 + 0.4], 0.1); beam(gFrame, mats.oak, [2.5 + 1.28, 2.2, z0 - 1.28], [2.5 + 1.28, 3.9, z0 + 0.4], 0.1); // braces
    box(gFrame, mats.floor, 2.5 - 1.37, 2.5 + 1.37, DECK - 0.18, DECK, z0 - 1.37, z0 + 1.37, 1.0); // stone-floor deck
  }
  box(gFrame, mats.oak, 2.5 + 1.28 - 0.08, 2.5 + 1.28 + 0.08, 3.9 - 0.09, 3.9 + 0.09, -1.45 - 1.37, 1.45 + 1.37, 1.2);

  /* ================= MILLSTONES (+ tuns) ================= */
  const gStone = group('Runner stone', '1.2 m French burr stones. The runner turns above the fixed bed stone.', [0, 2.0, 0], [3.6, 5.3, -1.45]);
  const runners = [-1, 1].map((s, k) => {
    const z0 = s * 1.45;
    const bed = mesh(new THREE.CylinderGeometry(0.88, 0.88, 0.28, 48), millstoneMat(false), gStone, [2.5, DECK + 0.14, z0]);
    const run = new THREE.Group(); run.position.set(2.5, DECK + 0.46, z0); gStone.add(run);
    const rm = mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.3, 48), [mats.stoneCase, millstoneMat(k === 1), mats.stoneCase], run);
    const tun = mesh(new THREE.CylinderGeometry(1.02, 1.02, 0.62, 40, 1, true), new THREE.MeshStandardMaterial({ map: T.oakPale, roughness: 0.85, side: THREE.DoubleSide }), gStone, [2.5, DECK + 0.4, z0]);
    return run;
  });
  const gBridge = group('Bridge tree and tentering screw', 'The bridge tree carries the spindle; the tentering screw sets the gap between the stones.', [0, -1.0, 0], [3.9, 2.8, -1.2]);
  const levers = [-1, 1].map((s) => {
    const l = new THREE.Group(); l.position.set(2.5, 3.3, s * 1.45); gBridge.add(l);
    box(l, mats.oak, -1.0, 1.35, -0.07, 0.07, -0.08, 0.08, 1.0);
    cyl(gBridge, mats.iron, 0.03, 0.7, [2.5 + 1.28, 3.55, s * 1.45], [0, 0, 0], 8);
    const w = mesh(new THREE.TorusGeometry(0.1, 0.015, 6, 14), mats.iron, gBridge, [2.5 + 1.28, 3.9, s * 1.45]); w.rotation.x = Math.PI / 2; return l;
  });

  /* ================= HOPPERS, SHOES, SPOUTS, SACKS ================= */
  const gHop = group('Hopper', 'Grain hopper and shoe: the feed rate, m, sets how much grain reaches the eye of the stone.', [0, 2.6, 0], [3.3, 7.9, 0]);
  const hoppers = [-1, 1].map((s) => {
    const z0 = s * 1.45, y0 = 5.9;
    for (const dx of [-0.42, 0.42]) for (const dz of [-0.42, 0.42]) box(gHop, mats.oak, 2.5 + dx - 0.04, 2.5 + dx + 0.04, DECK + 0.62, y0 + 0.2, z0 + dz - 0.04, z0 + dz + 0.04, 1.2);
    box(gHop, mats.oak, 2.5 - 0.5, 2.5 + 0.5, y0 + 0.16, y0 + 0.22, z0 - 0.5, z0 + 0.5, 1.2);
    const hop = mesh(new THREE.CylinderGeometry(0.62, 0.2, 0.62, 4, 1, true), new THREE.MeshStandardMaterial({ map: T.oakPale, roughness: 0.85, side: THREE.DoubleSide }), gHop, [2.5, y0 + 0.55, z0]); hop.rotation.y = Math.PI / 4;
    const fill = mesh(new THREE.CylinderGeometry(0.56, 0.18, 0.5, 4), mats.grain, gHop, [2.5, y0 + 0.5, z0]); fill.rotation.y = Math.PI / 4;
    const shoe = mesh(new THREE.BoxGeometry(0.5, 0.05, 0.22), mats.oak, gHop, [2.5 - 0.1, y0 - 0.02, z0]); shoe.rotation.z = 0.35;
    return { fill, baseY: y0, z0 };
  });
  const gSpout = group('Meal spout', 'Chute that delivers the ground meal to the sack.', [1.0, 0.5, 0.8], [4.3, 3.0, 2.3]);
  const spoutOut = [-1, 1].map((s) => { beam(gSpout, mats.oakPale, [2.5 + 1.0, DECK - 0.1, s * 1.45 + s * 0.5], [3.95, FLOOR + 1.05, s * 2.35], 0.2, 0.06); return new THREE.Vector3(3.95, FLOOR + 1.05, s * 2.35); });
  const gSack = group('Meal sack', 'Sack of 50 kg. A new one is filled each time 50 kg of meal has been ground.', [1.2, 0.5, 1.0], [4.4, 1.9, 2.6]);
  const sackProfile = [[0.001, 0], [0.24, 0.01], [0.3, 0.12], [0.31, 0.45], [0.28, 0.78], [0.24, 0.92], [0.22, 0.95]].map(([x, y]) => new THREE.Vector2(x, y));
  const sackGeo = new THREE.LatheGeometry(sackProfile, 28);
  const sacks = [-1, 1].map((s) => {
    const g = new THREE.Group(); g.position.set(3.95, FLOOR, s * 2.45); gSack.add(g);
    const body = mesh(sackGeo, mats.burlap, g); const top = mesh(new THREE.CircleGeometry(0.27, 24), mats.flour, g, [0, 0.05, 0]); top.rotation.x = -Math.PI / 2; top.castShadow = false;
    return { g, body, top };
  });
  const fullSacks = new THREE.Group(); gSack.add(fullSacks);
  const stream = mesh(new THREE.CylinderGeometry(0.03, 0.04, 1, 8), mats.flour, gSpout, [0, 0, 0], { cast: false }); stream.visible = false;

  /* ================= LIGHTS, ENVIRONMENT, FOG ================= */
  const hemi = new THREE.HemisphereLight(0xeef3ff, 0x8c7a5c, 0.8); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3dc, 2.4); sun.position.set(-7, 15, 10); sun.target.position.set(0.5, 1, 0); sun.castShadow = !/[?&]lowfx/.test(location.search);
  sun.shadow.mapSize.setScalar(window.innerWidth <= 820 ? 1024 : 2048); Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 50 }); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.025;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xdce6ff, 0.6); fill.position.set(9, 6, -8); scene.add(fill);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // sky-gradient environment for soft reflections
  const skyScene = new THREE.Scene(), skyGeo = new THREE.SphereGeometry(20, 32, 16), col = [], p = skyGeo.attributes.position, c1 = new THREE.Color(0xbcd0ee), c2 = new THREE.Color(0xf2eadc), c3 = new THREE.Color(0x5b5a46);
  for (let i = 0; i < p.count; i++) { const t = p.getY(i) / 20, c = t > 0 ? c2.clone().lerp(c1, t) : c2.clone().lerp(c3, Math.min(1, -t * 1.6)); col.push(c.r, c.g, c.b); }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); skyScene.add(new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const lamp = new THREE.Mesh(new THREE.PlaneGeometry(10, 6), new THREE.MeshBasicMaterial({ color: 0xfff1d6 })); lamp.position.set(-8, 10, 10); lamp.lookAt(0, 0, 0); skyScene.add(lamp);
  const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(skyScene, 0.04).texture; pmrem.dispose();
  scene.environmentIntensity = 0.55;

  function setTheme(bg, dark) {
    scene.background = new THREE.Color(bg); scene.fog = new THREE.Fog(bg, 48, 120);
    hemi.intensity = dark ? 0.4 : 0.8; hemi.color.set(dark ? 0x8fa0ff : 0xeef3ff); hemi.groundColor.set(dark ? 0x2a2c3a : 0x8c7a5c);
    sun.intensity = dark ? 1.7 : 2.4; sun.color.set(dark ? 0xdfe6ff : 0xfff3dc); fill.intensity = dark ? 1.0 : 0.6; fill.color.set(dark ? 0x4a5cff : 0xdce6ff);
    scene.environmentIntensity = dark ? 0.35 : 0.55; renderer.toneMappingExposure = dark ? 1.0 : 1.05;
  }

  return {
    mats, allMats, groups, T, setTheme,
    wheel, pitWheel, upright, wallowerRot, spurRot, nuts, runners, levers, gate, gateRod, gateWheel, head, tailWater,
    hoppers, spoutOut, sacks, fullSacks, stream, gSack, gSpout,
  };
}
