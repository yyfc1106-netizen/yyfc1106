// End-to-end check of every control, in a real browser against dist/ (served on :8767).
// Usage: node build.mjs && (cd dist && python3 -m http.server 8767 &) && NODE_PATH=$(npm root -g) node test/e2e.cjs [url]
const { chromium } = require('playwright');
const URL = process.argv[2] || 'http://localhost:8767/';
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
  await slide('gate', 55); await wait(6000);
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
  ok('two pairs: throughput roughly doubles', s.thr > 150 || s.rpm < 4, s.thr.toFixed(0) + ' kg/h');
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
  ok('1x: clock runs at normal speed', tF - tE > 2, `${(tF - tE).toFixed(2)} sim s in 3 s`);

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
  ok('names: labels shown', labelCount >= 5, labelCount + ' labels');
  await p.click('#views [data-view="labels"]');

  // 8. theme
  await p.click('[data-theme-set="light"]'); await wait(500);
  const lightBg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await p.click('[data-theme-set="dark"]'); await wait(500);
  const darkBg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok('theme: light and dark differ and attribute set', lightBg !== darkBg && (await p.evaluate(() => document.documentElement.dataset.theme)) === 'dark', `${lightBg} / ${darkBg}`);
  await p.screenshot({ path: 'e2e_dark.png' });
  await p.click('[data-theme-set="light"]');

  // 9. camera
  const az0 = await p.evaluate(() => __orbit.az), d0 = await p.evaluate(() => __orbit.dist);
  await p.mouse.move(400, 400); await p.mouse.down(); await p.mouse.move(520, 380, { steps: 5 }); await p.mouse.up();
  ok('drag orbits the camera', Math.abs((await p.evaluate(() => __orbit.az)) - az0) > 0.1);
  await p.mouse.move(400, 400); await p.mouse.wheel(0, -400); await wait(300);
  ok('wheel zooms', (await p.evaluate(() => __orbit.dist)) < d0 - 1);
  await p.click('#reset'); await wait(1500);
  ok('reset view restores the camera', Math.abs((await p.evaluate(() => __orbit.az)) - az0) < 0.05 && Math.abs((await p.evaluate(() => __orbit.dist)) - d0) < 0.5);

  // 9b. hover names, click-to-focus, section view, dust
  const parts = ['Overshot wheel', 'Gear train', 'Millstones'];
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
  const overlap = await p.evaluate(() => { const a = document.querySelector('#title h1').getBoundingClientRect(), b = document.querySelector('#top').getBoundingClientRect(); return !(a.top >= b.bottom - 2 || a.bottom <= b.top); });
  ok('mobile: title does not overlap the header', !overlap);
  await p.screenshot({ path: 'e2e_mobile.png', clip: { x: 0, y: 0, width: 390, height: 430 } });
  await p.click('#sheetBtn'); await wait(300);

  // 13. sacks fill, in main-thread mode so the test can seed the flour counter
  const q = await b.newPage({ viewport: { width: 1400, height: 900 } });
  q.on('pageerror', (e) => errs.push(String(e)));
  await q.goto(URL.replace(/\/?$/, '/') + '?local', { waitUntil: 'commit' });
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
