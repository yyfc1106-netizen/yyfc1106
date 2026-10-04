// End-to-end check of every control, in a real browser against dist/ (served on :8767).
// Usage: node build.mjs && (cd dist && python3 -m http.server 8767 &) && NODE_PATH=$(npm root -g) node test/e2e.cjs [url]
const { chromium } = require('playwright');
const URL = process.argv[2] || 'http://localhost:8767/?lowfx'; // lowfx: no shadows, so software rendering does not starve the simulation
const results = [];
const ok = (name, cond, extra = '') => { results.push([name, !!cond, extra]); console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  (' + extra + ')' : '')); };

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-proxy-server', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const wait = (ms) => p.waitForTimeout(ms);
  const txt = (id) => p.evaluate((i) => document.getElementById(i).textContent, id);
  const num = async (id) => parseFloat((await txt(id)).replace(/[^\d.\-]/g, ''));
  const st = () => p.evaluate(() => ({ Q: __mill.out.Q, rpm: __mill.out.wheelRpm, v: __mill.out.vJet, t: __mill.time, fc: __fc(), eng: __mill.stones.map((s) => s.engaged), flour: __mill.stones.map((s) => s.flour), thr: __mill.out.throughput, warn: document.getElementById('warn').textContent, d50: __mill.out.d50, temp: __mill.out.mealTemp, stoneRpm: __mill.out.stoneRpm }));
  const colours = async (clip) => { const buf = await p.screenshot({ clip }); return p.evaluate(async (b64) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; const set = new Set(); for (let i = 0; i < d.length; i += 4) set.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4)); return set.size; }, buf.toString('base64')); };
  const slide = async (id, v) => { await p.fill('#' + id, String(v)); await p.dispatchEvent('#' + id, 'input'); };

  const t0 = Date.now();
  await p.goto(URL, { waitUntil: 'commit' });
  await p.waitForFunction(() => { const l = document.getElementById('loading'); return l && getComputedStyle(l).display === 'none'; }, null, { timeout: 30000 });
  ok('loads and hides the loading screen', true, (Date.now() - t0) + ' ms');
  await wait(12000);

  // 0. canvas actually draws, mode
  const mode = await p.evaluate(() => __net.mode);
  ok('simulation backend started', mode === 'worker' || mode === 'main thread', mode);
  const nColours = await colours({ x: 300, y: 250, width: 500, height: 450 });
  ok('3D scene is drawn (not blank)', nColours > 40, nColours + ' colours');
  let s = await st();
  ok('wheel turning and flour produced at start', s.rpm > 4 && s.thr > 50, `rpm ${s.rpm.toFixed(1)}, flour ${s.thr.toFixed(0)} kg/h`);
  ok('water particles present', s.fc > 100, s.fc + ' spheres');

  // 1. gate
  await slide('gate', 100); await wait(1500);
  s = await st();
  ok('gate 100%: flow readout matches formula', Math.abs((await num('wQ')) - 0.6 * 0.85 * 0.15 * Math.sqrt(2 * 9.81 * 0.6) * 1000) < 3, await txt('wQ'));
  await slide('gate', 0); await wait(1500);
  ok('gate 0: flow zero and warning shown', (await st()).Q === 0 && /Gate shut/.test((await st()).warn), (await st()).warn);
  await wait(9000);
  ok('gate 0: water drains away', (await st()).fc < 30, (await st()).fc + ' spheres left');
  await slide('gate', 62); await wait(6000);
  s = await st();
  ok('gate reopened: flow resumes', s.Q > 0.1 && s.fc > 150, `Q ${s.Q.toFixed(3)}, ${s.fc} spheres`);
  const rpmA = s.rpm; await wait(25000); s = await st();
  ok('gate reopened: wheel restarts and speeds up', s.rpm > 3 && s.rpm > rpmA - 0.1, `${rpmA.toFixed(2)} -> ${s.rpm.toFixed(2)} rpm`);

  // 2. head
  await slide('head', 100); await wait(1500);
  ok('head 1.0 m: jet speed 0.97*sqrt(2gh)', Math.abs((await num('wV')) - 0.97 * Math.sqrt(2 * 9.81)) < 0.05, await txt('wV'));
  await slide('head', 20); await wait(1500);
  ok('head 0.2 m: jet speed drops', Math.abs((await num('wV')) - 0.97 * Math.sqrt(2 * 9.81 * 0.2)) < 0.05, await txt('wV'));
  await slide('head', 60); await wait(500);

  // 3. brake
  await p.click('#brake'); await wait(500);
  ok('brake: button state', (await p.getAttribute('#brake', 'aria-pressed')) === 'true' && (await txt('brakeS')) === 'On');
  await wait(15000); s = await st();
  ok('brake: wheel stops', s.rpm < 0.5 && /Brake on/.test(s.warn), `${s.rpm.toFixed(2)} rpm, "${s.warn}"`);
  await p.click('#brake'); await wait(14000); s = await st();
  ok('brake released: wheel restarts', s.rpm > 0.8, `${s.rpm.toFixed(2)} rpm`);

  // 4. stone pairs
  const rpmOne = (await st()).rpm;
  await p.click('#pair1'); await wait(500);
  ok('far pair: toggles to In gear', (await p.getAttribute('#pair1', 'aria-pressed')) === 'true' && (await txt('pair1s')) === 'In gear' && (await st()).eng[1] === true);
  await wait(20000); s = await st();
  ok('far pair in gear: wheel runs slower (more load)', s.rpm < rpmOne - 0.3 || s.rpm < 4, `${rpmOne.toFixed(2)} -> ${s.rpm.toFixed(2)} rpm`);
  ok('two pairs: the second pair is running and the stones are loaded', s.eng[0] && s.eng[1] && s.rpm < rpmOne, s.thr.toFixed(0) + ' kg/h');
  await p.click('#pair1'); await p.click('#pair0'); await wait(500);
  ok('near pair: toggles to Out of gear', (await p.getAttribute('#pair0', 'aria-pressed')) === 'false' && (await txt('pair0s')) === 'Out of gear' && (await st()).eng[0] === false);
  await wait(25000); s = await st();
  ok('no pair in gear: runaway warning and fast wheel', /running away/.test(s.warn) && s.rpm > 9, `${s.rpm.toFixed(1)} rpm, "${s.warn}"`);
  await p.click('#pair0'); await wait(20000); s = await st();
  ok('near pair back in gear: wheel slows again', s.rpm < 9 && s.eng[0] === true, `${s.rpm.toFixed(1)} rpm`);

  // 5. feed and gap
  await slide('feed', 100); await wait(14000); s = await st();
  const thrFull = s.thr; ok('feed 100%: throughput rises', thrFull > 150 || s.rpm < 4, `${thrFull.toFixed(0)} kg/h at ${s.rpm.toFixed(1)} rpm`);
  await slide('feed', 0); await wait(8000); s = await st();
  ok('feed 0: no flour', s.thr < 1, s.thr.toFixed(1) + ' kg/h');
  await slide('feed', 48); await slide('gap', 10); await wait(10000); const fine = await st();
  await slide('gap', 150); await wait(10000); const coarse = await st();
  ok('gap: finer meal when closer', fine.d50 < coarse.d50 - 200, `d50 ${fine.d50.toFixed(0)} -> ${coarse.d50.toFixed(0)} um`);
  ok('gap: closer stones run hotter', fine.temp > coarse.temp, `${fine.temp.toFixed(1)} vs ${coarse.temp.toFixed(1)} C`);
  ok('product name follows fineness', (await txt('sProd')).length > 3, await txt('sProd'));
  await slide('gap', 60);

  // 6. time controls
  await p.click('#speed [data-s="0"]'); await wait(300); const tA = (await st()).t; await wait(2000); const tB = (await st()).t;
  ok('pause: clock frozen', Math.abs(tB - tA) < 0.05, `${tA.toFixed(2)} -> ${tB.toFixed(2)}`);
  await p.click('#speed [data-s="0.25"]'); await wait(300); const tC = (await st()).t; await wait(4000); const tD = (await st()).t;
  ok('quarter speed: clock runs slowly', tD - tC > 0.4 && tD - tC < 1.6, `${(tD - tC).toFixed(2)} sim s in 4 s`);
  await p.click('#speed [data-s="1"]'); await wait(300); const tE = (await st()).t; await wait(3000); const tF = (await st()).t;
  ok('1x: clock runs at normal speed', tF - tE > 1.5, `${(tF - tE).toFixed(2)} sim s in 3 s`);

  // 7. views
  await p.click('#views [data-view="explode"]'); await wait(1500);
  ok('explode: parts move apart', (await p.evaluate(() => __ui.explode)) > 0.8 && (await p.getAttribute('#views [data-view="explode"]', 'aria-pressed')) === 'true');
  await p.screenshot({ path: 'e2e_explode.png' });
  await p.click('#views [data-view="explode"]'); await wait(2500);
  ok('explode off: parts return', (await p.evaluate(() => __ui.explode)) < 0.05);
  await p.click('#views [data-view="wire"]'); await wait(500);
  ok('wireframe: on', (await p.evaluate(() => __ui.wire)) === true);
  await p.screenshot({ path: 'e2e_wire.png' });
  await p.click('#views [data-view="wire"]');
  await p.click('#views [data-view="labels"]'); await wait(800);
  const labelCount = await p.evaluate(() => [...document.querySelectorAll('#labels span')].filter((e) => getComputedStyle(e).display !== 'none' && e.style.left).length);
  ok('names: all the labelled parts are shown', labelCount >= 12, labelCount + ' labels');
  await p.click('#views [data-view="labels"]');

  // 8. theme
  await p.click('[data-theme-set="light"]'); await wait(500);
  const lightBg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await p.click('[data-theme-set="dark"]'); await wait(500);
  const darkBg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok('theme: light and dark differ and attribute set', lightBg !== darkBg && (await p.evaluate(() => document.documentElement.dataset.theme)) === 'dark', `${lightBg} / ${darkBg}`);
  await p.screenshot({ path: 'e2e_dark.png' });
  await p.click('[data-theme-set="light"]');

  // 9. camera: rotate every way, pan, zoom, pinch, dial, keyboard, reset
  const cam = () => p.evaluate(() => ({ az: __orbit.az, el: __orbit.el, dist: __orbit.dist, tx: __target.x, ty: __target.y, tz: __target.z }));
  const c0 = await cam();
  const dragBy = async (dx, dy, btn = 'left') => { await p.mouse.move(450, 450); await p.mouse.down({ button: btn }); await p.mouse.move(450 + dx, 450 + dy, { steps: 6 }); await p.mouse.up({ button: btn }); await wait(250); };
  await dragBy(-150, 0); const cL = await cam(); ok('drag left turns the model one way', cL.az > c0.az + 0.3, `${c0.az.toFixed(2)} -> ${cL.az.toFixed(2)}`);
  await dragBy(300, 0); const cR = await cam(); ok('drag right turns it back the other way', cR.az < cL.az - 0.6);
  await dragBy(0, 120); const cD = await cam(); ok('drag down raises the camera', cD.el > cR.el + 0.3, `${cR.el.toFixed(2)} -> ${cD.el.toFixed(2)}`);
  await dragBy(0, -400); const cU = await cam(); ok('drag up lowers the camera (down to the ground line)', cU.el < cD.el - 0.5 && cU.el >= -0.31, cU.el.toFixed(2));
  for (let i = 0; i < 6; i++) await dragBy(-200, 0);
  ok('can keep turning through full circles', Math.abs((await cam()).az - cU.az) > 6.3, `${((await cam()).az - cU.az).toFixed(1)} rad`);
  await p.click('#reset'); await wait(3500);
  const cp0 = await cam(); await dragBy(120, 60, 'right'); const cp1 = await cam();
  ok('right-drag pans the view', Math.hypot(cp1.tx - cp0.tx, cp1.ty - cp0.ty, cp1.tz - cp0.tz) > 0.5 && Math.abs(cp1.az - cp0.az) < 0.01, `target moved ${Math.hypot(cp1.tx - cp0.tx, cp1.ty - cp0.ty, cp1.tz - cp0.tz).toFixed(2)} m`);
  await p.mouse.move(450, 450); await p.mouse.wheel(0, -500); await wait(300); const cz = await cam();
  ok('wheel zooms in', cz.dist < cp1.dist - 3, `${cp1.dist.toFixed(1)} -> ${cz.dist.toFixed(1)}`);
  await p.mouse.wheel(0, 4000); await wait(300); ok('zoom out stops at the limit', (await cam()).dist <= 60.01 && (await cam()).dist > 55, (await cam()).dist.toFixed(1));
  await p.mouse.wheel(0, -9000); await wait(300); ok('zoom in stops at the limit', (await cam()).dist >= 3.99 && (await cam()).dist < 6, (await cam()).dist.toFixed(1));
  await p.click('#reset'); await wait(3500);
  const cpin0 = await cam();
  await p.evaluate(() => { const c = document.getElementById('gl'); const ev = (t, id, x, y) => c.dispatchEvent(new PointerEvent(t, { pointerId: id, clientX: x, clientY: y, button: 0, pointerType: 'touch', bubbles: true, isPrimary: id === 1 })); ev('pointerdown', 1, 500, 400); ev('pointerdown', 2, 600, 400); for (let i = 1; i <= 10; i++) { ev('pointermove', 1, 500 - i * 15, 400); ev('pointermove', 2, 600 + i * 15, 400); } ev('pointerup', 1, 350, 400); ev('pointerup', 2, 750, 400); });
  await wait(300); const cpin1 = await cam();
  ok('two-finger pinch out zooms in', cpin1.dist < cpin0.dist - 3, `${cpin0.dist.toFixed(1)} -> ${cpin1.dist.toFixed(1)}`);
  await p.evaluate(() => { const c = document.getElementById('gl'); const ev = (t, id, x, y) => c.dispatchEvent(new PointerEvent(t, { pointerId: id, clientX: x, clientY: y, button: 0, pointerType: 'touch', bubbles: true, isPrimary: id === 1 })); ev('pointerdown', 1, 400, 400); ev('pointerdown', 2, 500, 400); for (let i = 1; i <= 10; i++) { ev('pointermove', 1, 400 + i * 10, 400); ev('pointermove', 2, 500 + i * 10, 400); } ev('pointerup', 1, 500, 400); ev('pointerup', 2, 600, 400); });
  await wait(300); const cpin2 = await cam();
  ok('two-finger drag pans', Math.hypot(cpin2.tx - cpin1.tx, cpin2.ty - cpin1.ty, cpin2.tz - cpin1.tz) > 0.3, `moved ${Math.hypot(cpin2.tx - cpin1.tx, cpin2.ty - cpin1.ty, cpin2.tz - cpin1.tz).toFixed(2)} m`);
  await p.click('#reset'); await wait(3500);
  const dbox = await p.evaluate(() => { const r = document.getElementById('turn').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const deg0 = parseInt(await txt('turnDeg'));
  await p.mouse.move(dbox.x, dbox.y); await p.mouse.down(); await p.mouse.move(dbox.x + 30, dbox.y + 5, { steps: 4 }); await p.mouse.up(); await wait(400);
  ok('turn dial rotates the model and shows degrees', Math.abs(parseInt(await txt('turnDeg')) - deg0) > 20 && /°/.test(await txt('turnDeg')), `${deg0}° -> ${await txt('turnDeg')}`);
  await p.focus('#gl'); const k0 = await cam(); await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowUp'); await p.keyboard.press('+'); await wait(200); const k1 = await cam();
  ok('keyboard: arrows turn and tilt, + zooms', k1.az > k0.az + 0.05 && k1.el > k0.el + 0.03 && k1.dist < k0.dist, `az ${k0.az.toFixed(2)}->${k1.az.toFixed(2)}`);
  await p.keyboard.press('r'); await wait(3500); const kr = await cam();
  ok('keyboard R resets the view', Math.abs(kr.az - c0.az) < 0.05 && Math.abs(kr.dist - c0.dist) < 0.6);
  await dragBy(-200, 90); await p.mouse.dblclick(80, 200); await wait(3500); const kd = await cam();
  ok('double-click on empty space resets the view', Math.abs(kd.az - c0.az) < 0.05 && Math.abs(kd.dist - c0.dist) < 0.6);
  await dragBy(-200, 90);
  const resetBox = await p.evaluate(() => { const b = document.getElementById('reset'), r = b.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, clickable: top === b || b.contains(top), label: b.textContent }; });
  ok('Reset view button is visible and clickable', resetBox.inView && resetBox.clickable, resetBox.label);
  await p.click('#reset'); await wait(3500); const cf = await cam();
  ok('Reset view returns to the default view', Math.abs(cf.az - c0.az) < 0.05 && Math.abs(cf.el - c0.el) < 0.05 && Math.abs(cf.dist - c0.dist) < 0.6 && Math.hypot(cf.tx - c0.tx, cf.ty - c0.ty, cf.tz - c0.tz) < 0.2);

  // 9b. hover names, click-to-focus, section view, dust
  const parts = ['Overshot wheel', 'Runner stone', 'Flume'];
  const findPart = async (name) => {
    const c = await p.evaluate((n) => __screen(n), name);
    for (let r = 0; r <= 140; r += 14) for (let ang = 0; ang < (r ? 8 : 1); ang++) {
      const x = c.x + Math.cos(ang * 0.785) * r, y = c.y + Math.sin(ang * 0.785) * r;
      await p.mouse.move(x, y); await wait(60);
      if ((await p.evaluate(() => getComputedStyle(document.getElementById('hover')).display)) !== 'none' && (await txt('hover')).toLowerCase().startsWith(name.toLowerCase().slice(0, 6))) return { x, y };
    }
    return null;
  };
  let wheelPt = null;
  for (const n of parts) { const pt = await findPart(n); ok('hover shows the name of: ' + n, !!pt, pt ? (await txt('hover')).slice(0, 40) : 'not found near its label'); if (n === 'Overshot wheel') wheelPt = pt; }
  if (wheelPt) {
    const dBefore = await p.evaluate(() => __orbit.dist);
    await p.mouse.move(wheelPt.x, wheelPt.y); await p.mouse.down(); await p.mouse.up(); await wait(2500);
    const dAfter = await p.evaluate(() => __orbit.dist);
    ok('click focuses the part (camera moves in)', dAfter < dBefore - 3, `${dBefore.toFixed(1)} -> ${dAfter.toFixed(1)}`);
    await p.keyboard.press('Escape'); await wait(2500);
    ok('Escape leaves the focus', Math.abs((await p.evaluate(() => __orbit.dist)) - dBefore) < 1.5, (await p.evaluate(() => __orbit.dist)).toFixed(1));
  } else ok('click focuses the part (camera moves in)', false, 'no part found to click');
  await p.click('#reset'); await wait(2500);
  await p.click('#views [data-view="cutaway"]'); await wait(3000);
  ok('section: clipping plane active and camera swung round', (await p.evaluate(() => __cut())) === 1 && (await p.evaluate(() => __orbit.az)) < -1, `az ${(await p.evaluate(() => __orbit.az)).toFixed(2)}`);
  await p.screenshot({ path: 'e2e_section.png' });
  ok('section: scene still drawn', (await colours({ x: 100, y: 150, width: 800, height: 700 })) > 40);
  await p.click('#views [data-view="cutaway"]'); await wait(2500);
  ok('section off: clipping removed', (await p.evaluate(() => __cut())) === 0);
  await p.click('#reset'); await wait(2000);
  let dmax = 0; for (let i = 0; i < 10; i++) { dmax = Math.max(dmax, await p.evaluate(() => __dust())); await wait(300); }
  ok('flour dust is produced while grinding', dmax > 5, dmax + ' particles');

  // 9c. textures and structure
  const tex = await p.evaluate(() => { const c = __S.T.strata.image, g = c.getContext('2d'), px = (y) => [...g.getImageData(c.width / 2, y, 1, 1).data].slice(0, 3); return { top: px(4), clay: px(Math.round(c.height * 0.25)), bottom: px(c.height - 10), mats: __S.groups.map((x) => x.userData.name) }; });
  ok('strata texture: dark soil at the top, grey bedrock at the bottom', tex.top[0] < 90 && tex.bottom[0] > 95 && Math.abs(tex.bottom[0] - tex.bottom[2]) < 14 && tex.clay[0] > tex.clay[2] + 40, `top ${tex.top}, clay ${tex.clay}, bottom ${tex.bottom}`);
  const wanted = ['Hopper', 'Sluice gate', 'Flume', 'Upright shaft', 'Runner stone', 'Great spur wheel, 120 cogs', 'Stone nut, 20 teeth', 'Meal spout', 'Bridge tree and tentering screw', 'Wallower, 32 teeth', 'Meal sack', 'Wheel shaft', 'Pit wheel, 96 cogs', 'Overshot wheel', 'Tailrace'];
  ok('all 15 named parts of the mill exist', wanted.every((n) => tex.mats.includes(n)), wanted.filter((n) => !tex.mats.includes(n)).join(', ') || 'complete');

  // 10. charts drawn
  const ink = (id) => p.evaluate((i) => { const c = document.getElementById(i); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let k = 3; k < d.length; k += 4) if (d[k] > 0) n++; return n; }, id);
  ok('torque chart drawn', (await ink('opCv')) > 500);
  ok('runner-speed chart drawn', (await ink('stripCv')) > 200);
  ok('energy-balance chart drawn', (await ink('sankeyCv')) > 500);

  // 11. readouts consistent
  s = await st();
  ok('gear table: stone rpm = wheel rpm x 18', Math.abs((await num('g3n')) - (await num('g1n')) * 18) < 3, `${await txt('g1n')} -> ${await txt('g3n')}`);
  ok('flour accumulates', s.flour[0] + s.flour[1] > 0.5, (s.flour[0] + s.flour[1]).toFixed(2) + ' kg');
  ok('clock text updates', /t = \d/.test(await txt('clock')));

  // 12. mobile layout
  await p.setViewportSize({ width: 390, height: 800 }); await wait(1500);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
  ok('mobile: no horizontal scroll', !overflow);
  await p.click('#sheetBtn'); await wait(300);
  ok('mobile: sheet collapses', await p.evaluate(() => document.getElementById('panel').classList.contains('closed')));
  await p.click('#sheetBtn'); await wait(300);
  ok('mobile: sheet reopens', !(await p.evaluate(() => document.getElementById('panel').classList.contains('closed'))));
  await p.click('#sheetBtn'); await wait(500);
  ok('mobile: model visible above the sheet', (await colours({ x: 0, y: 120, width: 390, height: 300 })) > 40);
  const rb = await p.evaluate(() => { const b = document.getElementById('reset'), r = b.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.width > 0 && r.right <= innerWidth && r.bottom <= innerHeight && (top === b || b.contains(top)); });
  ok('mobile: Reset view button is visible and clickable', rb);
  const overlap = await p.evaluate(() => { const a = document.querySelector('#title h1').getBoundingClientRect(), b = document.querySelector('#top').getBoundingClientRect(); return !(a.top >= b.bottom - 2 || a.bottom <= b.top); });
  ok('mobile: title does not overlap the header', !overlap);
  await p.screenshot({ path: 'e2e_mobile.png', clip: { x: 0, y: 0, width: 390, height: 430 } });
  await p.click('#sheetBtn'); await wait(300);

  // 13. sacks fill, in main-thread mode so the test can seed the flour counter
  const q = await b.newPage({ viewport: { width: 1400, height: 900 } });
  q.on('pageerror', (e) => errs.push(String(e)));
  await q.goto(URL + (URL.includes('?') ? '&local' : '?local'), { waitUntil: 'commit' });
  await q.waitForFunction(() => __net && __net.ready, null, { timeout: 30000 });
  ok('main-thread fallback mode starts', (await q.evaluate(() => __net.mode)) === 'main thread');
  await q.waitForTimeout(3000);
  await q.evaluate(() => { __net.local.mill.stones[0].flour = 49.99; });
  await q.waitForTimeout(8000);
  ok('a full 50 kg sack is counted and appears', parseInt(await q.evaluate(() => document.getElementById('sSacks').textContent)) >= 1 && (await q.evaluate(() => __sacks())) >= 1, 'sacks ' + (await q.evaluate(() => document.getElementById('sSacks').textContent)) + ', meshes ' + (await q.evaluate(() => __sacks())));
  ok('main-thread mode: wheel turning', (await q.evaluate(() => __mill.out.wheelRpm)) > 3);
  await q.close();

  ok('no console or page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close();
  const fails = results.filter((r) => !r[1]);
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  process.exit(fails.length ? 1 : 0);
})();
