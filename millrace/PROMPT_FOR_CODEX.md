# Prompt: rebuild "Millrace Lite" (interactive overshot gristmill) from scratch

Paste everything below the line into the coding agent. It is written to be model-agnostic. Work in phases and commit after each one.

---

## Goal

Build a static, client-only web app (no backend) that teaches how an **overshot water-wheel gristmill** works. It is a 3D diorama on the left and a live measurement/controls panel on the right. A real fluid simulation drives the wheel, and the wheel drives the gears and millstones.

Reference for the *look and feature set* (observe it in a browser, do not copy its code or assets): https://watermill.wasmer.app . Study it from several camera angles, close-ups, "Names", "Explode" and "Section" views, and its right-hand panel.

## Stack and layout

- Vanilla ES modules + three.js (npm `three`, vendored or bundled). Bundle with esbuild (minified, tree-shaken, target ~600 KB). No framework.
- Files: `src/mechanics.js` (pure model), `src/fluid.js` (PBF), `src/sim.js` (couples both), `src/physics.worker.js`, `src/textures.js` (procedural canvases), `src/scene.js` (builds the diorama), `src/ssf.js` (screen-space fluid renderer), `src/surface.js` (mesh fallback for the water), `src/main.js` (UI, camera, charts, loop), `index.html`, `style.css`, `build.mjs`, `test/e2e.cjs`, node unit tests.
- Startup must be **instant**: solve the mechanics analytically for ~30 s of simulated time at start (milliseconds), show the page at once, and let the water fill the buckets live. No loading bar that waits for a warm-up. Run the simulation in a Web Worker; if it does not answer in 2.5 s, or with `?local`, run it on the main thread. Show any startup error in the loading text.

## 1. Mechanics (pure functions, state object, fixed step 1/120 s)

Constants: wheel R = 2.4 m, width 1.3 m, 36 buckets; sluice width 1.0·0.85 m, max opening 0.15 m, Cd 0.6, Cv 0.97; fall H = head + 5.07 m; gear teeth pit 96 / wallower 32 / great spur 120 / stone nut 20, so wheel→stone ratio 18; efficiencies bevel 0.93, spur 0.95; inertias wheel 16000, upright 3200, each stone 170 kg·m²; max feed 250 kg/h; reference stone speed 120 rpm.
Controls and defaults: gate 0.62 (0–1 → 0–150 mm), head 0.6 m (0.2–1.0), grain feed 0.48 (0–250 kg/h), stone gap 0.6 mm (0.1–1.5), brake off, near stone pair engaged, far pair out of gear.
Formulas: `v = Cv·√(2gh)`, `Q = Cd·b·a·√(2gh)` (0 if gate ≤ 0.0005), `Pin = ρgQH`.
Stone load per pair at stone speed w: grinding torque ∝ E·ṁ·feedFactor(w)/wRef·tanh(w/1.5) with specific energy E = (40 + 90·fineness^1.4) kJ/kg and fineness = 1 − (gap−0.1)/1.4; idle friction; "rub" torque when the gap is below 0.3 mm and grain is starved. **feedFactor(w) = smoothstep((|w| − 0.25 wRef)/(0.45 wRef))**: grain only reaches the stones once the runner is up to speed. This is essential so the mill can restart after the gate has been closed.
Outputs: wheel rpm/rim speed/torque/shaft power/efficiency/water held, stone rpm, throughput, grinding power, energy per kg, meal d50 = 130 + 770·(1−fineness)^1.1 µm, meal temperature, product name, flour per stone (50 kg sacks), warnings (gate shut, wheel stalled, stones touching with no grain, no load in gear/runaway above 11 rpm, meal above 42 °C, runner above 150 or below 90 rpm).
Also an analytic bucket-model torque curve (used for Fig. 1 and for the first seconds) and engage/disengage of a stone pair with angular-momentum conservation.

## 2. Fluid (the part that makes it real)

2D Position-Based Fluids in the wheel's (y, z) cross-section, each particle a 1.3 m wide slab: spacing h = 0.04, kernel radius 2.5h, poly6 density + spiky gradient, density constraint clamped to C ≥ 0 (no tension), 4 iterations, spatial hash, cap 1600 particles, velocity clamp 14 m/s. Emit at the sluice outlet at z = −1.0, y = flume floor 5.05 + random within the opening, with the jet speed v; rate from Q.
Wheel boundary: 36 boards from inner radius 1.9 to rim 2.4, **leaning back by 0.9 rad** at the rim, 0.03 m thick, plus the inner shroud. Clamp particles into their bucket sector each iteration. The sum of the clamp corrections (−m·Δ/dt², torque about the axis) is the water torque on the wheel; smooth it with a 0.3 s time constant. Kill particles below y = 0.32 (tail race).
Coupling: torque = analytic bucket torque for the first 6 s of sim time, cross-faded to the fluid torque over the next 4 s.
**Tuning pitfalls found the hard way, test them:** (a) with the jet landing before the wheel top the trailing buckets fill and a stopped wheel deadlocks; (b) torque must rise monotonically with head (a faster jet must not splash over the boards); verify with a sweep (head 0.3 / 0.6 / 1.0 at 6 rpm gave ≈ 4.6 / 6.8 / 7.9 kN·m); (c) default operating point ≈ 6.5 rpm wheel, ≈ 118 rpm stones, ≈ 118 kg/h, ≈ 350 kg of water held, efficiency 40–50 %; (d) closing the gate for 15 s and reopening must restart the wheel by itself; (e) particle mass must be conserved (emitted = drained + in flight).

## 3. Scene (procedural, no image files)

Coordinates: wheel axis along x, wheel centre (0, 2.6, 0), water flows toward +z. Terrain top 4.85, bottom −2.4.
- **Terrain block** with grass top and side faces showing strata from top to bottom: dark humus with wavy boundary and roots, orange clay, grey gravel with pastel pebbles, grey cracked bedrock; wooden plinth underneath. Strata fractions from the top ≈ 0.04 / 0.15 / 0.32 / 0.47.
- **Masonry-lined wheel pit** 1.5 m wide (walls x = ±0.75…1.05, paving floor), tail race toward +z (shorter, ends at z = 4.6), left bank cut back to y = 2.5 so the wheel is visible from the front-left, raised masonry headrace behind the flume, flume trough over the pit with timber supports, sluice gate between two posts with a threaded rod and a hand-wheel (gate plate rises with the opening).
- **Overshot wheel**: oak rims and 12 spokes per side, iron band, 36 pale-oak boards matching the fluid geometry, inner shroud, wooden shaft with iron bearings on stone blocks.
- **Mill platform** (floor y = 1.3) right of the pit in a masonry-walled recess: pit wheel (96 cogs, vertical), wallower (32), upright shaft at x = 2.5, great spur wheel (120) at y = 3.7, two stone nuts (20) at z = ±1.45, oak timber frame with posts, rails and braces, a plank deck at y = 4.1, two bed+runner stone pairs inside pale-oak tuns (runner top has 8 harps of furrows), hoppers with grain fill and shoes, bridge trees with tentering screws, meal spouts, two burlap sacks that fill and stack when full. Gears: extruded ring + spokes + instanced teeth, light steel-grey.
- 15 **named parts** (also used for hover tags, click-to-focus, explode offsets and "Names" markers with dashed rings): Hopper, Sluice gate, Flume, Upright shaft, Runner stone, Great spur wheel (120 cogs), Stone nut (20 teeth), Meal spout, Bridge tree and tentering screw, Wallower (32 teeth), Meal sack, Wheel shaft, Pit wheel (96 cogs), Overshot wheel, Tailrace.
- Textures drawn on canvases with value-noise fbm: grass, strata, masonry courses, oak (warped grain, knots), floor planks, paving, millstone furrows, burlap, grain, flour. Keep them 128–256 px so start-up stays fast.
- Look: ACES tone mapping, sRGB, hemisphere + warm sun with soft shadows (2048, 1024 on mobile) + cool fill, sky-gradient environment map (PMREM), pastel palette. Light and dark themes (the page background colour must be exactly the UI colour, not tone-mapped).

## 4. Water rendering

Screen-space fluid: scene → half-float target with depth texture; particles as sphere impostors into a float depth target (radius 0.095); additive thickness pass; bilateral blur (3× horizontal+vertical); composite with normals from depth, Beer–Lambert absorption (≈ 2.0, 0.55, 0.32), refraction, Fresnel reflection of the sky colour, specular, tone mapping. Replicate each dense particle 6× across the wheel width; isolated spray stays a single droplet. Add spray droplets and tail-race foam sprites spawned from fast/plunging particles. If float render targets are unavailable (or `?nossf`), fall back to a marching-squares extruded water mesh.

## 5. UI

Right panel (bottom sheet on phones) with five cards: 01 Water supply (gate, head sliders, Q / v / landing angle, three formulas with the numbers substituted), 02 Overshot wheel (speed, rim speed, torque, shaft power, efficiency, water held, a one-line comment on rim/jet speed ratio, Fig. 1 torque–speed chart with the bucket-model curve, the load curve, grey fluid-simulation dots for the last 20 s and the current point, brake toggle), 03 Gear train (table of teeth, speed, torque per shaft, loss per stage), 04 Millstones (two pair toggles, feed and gap sliders, runner rpm, throughput, grinding kW, kJ/kg, d50, temperature, product name, sacks), 05 Energy balance (Fig. 2 flow chart: water → wheel loss, bearings, gears, idle, rub, grinding). Left: title, clock, wheel/stone/flour readout, warning line, runner-speed history strip with the 110–130 rpm band. Top bar: Section (clipping plane + camera swing, cut face visible), Explode, Wireframe, Names, speed Pause/¼×/1×, Light/Dark. All charts are hand-drawn canvas 2D.
**Camera** (3D must be freely movable): drag to turn over any angle including full circles, elevation −0.3…1.5 rad, right-drag or two-finger drag to pan, wheel and pinch to zoom (4…60), turn dial with degree read-out, arrow keys, +/−, `R`, double-click on empty space; short inertia; `touch-action: none`. A visible **Reset view** button (also on phones) animates back to the default view (azimuth ≈ −0.62 rad, elevation 0.5, distance 27, target (0.9, 2.2, 0.2); camera fov 38, near 0.5, far 140). Hover shows a tag with the part's name and a one-line description; click focuses the part, Esc leaves.
Phone layout: model framed above the sheet, header/title not overlapping, no horizontal scroll, sheet collapsible, Reset button and dial above the sheet.

## 6. Verification (do not skip; the first versions "passed" but were wrong)

Write node unit tests (mechanics, fluid conservation and steady state, water-mesh builder) and a Playwright e2e suite that drives **every control** in a real browser and asserts the outcome: gate 0 → flow 0, warning and water drains; reopen → water returns and the wheel restarts and speeds up; head changes jet speed per formula; brake stops and releases; each stone pair toggle; feed 0 → no flour; gap changes d50 and temperature; pause/¼×/1× clock; explode, wireframe, names (15 labels), section, theme; every camera gesture above; hover tags; click-focus; sack counting (use a `?local` page and seed the flour counter); mobile layout; charts drawn; no console errors. Also look at screenshots: strata orientation (dark soil on top), wheel visible from the default view, textures not stretched.
Test-environment notes: headless software GL is slow and starves the simulation, so add a `?lowfx` flag (no shadows, ~1 fps rendering) for tests; full-viewport screenshots can come back blank, so use `clip`; do not `pkill` by pattern in your own shell.

## Process

1. Mechanics + tests → 2. fluid + coupling + tests → 3. scene without textures, camera, UI → 4. textures and lighting → 5. screen-space water, foam, dust → 6. e2e suite and fixes → 7. bundle, measure start-up (page interactive in about a second on a normal machine). Commit after each phase and report what you verified and what you could not.
