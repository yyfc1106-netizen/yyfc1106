# Millrace Lite

A minimal re-creation of an interactive overshot-gristmill simulator (3D model + live physics panel).

Run (dev, no build): `cd millrace && python3 -m http.server 8000` and open http://localhost:8000 (three.js is vendored).
Run (fast, bundled ~565 KB / 151 KB gzip): `npm install && npm run build`, then serve `dist/`.
Startup is instant: the mechanics are solved analytically, the page opens at once, and the water fills the buckets live; the wheel torque cross-fades from the analytic bucket model to the fluid between 6 s and 10 s of simulated time.
Test the mechanics: `node src/mechanics.test.mjs`.

- `src/mechanics.js`: pure lumped model: sluice flow, bucket-model wheel torque, 18:1 gear train, millstone load, meal fineness and temperature, warnings.
- `src/fluid.js`: 2D Position-Based Fluids in the wheel's cross-section (poly6/spiky kernels, spatial hash). The 36 slanted buckets are moving boundaries; the corrections they apply to the water are summed into a reaction torque on the wheel.
- `src/sim.js` + `src/physics.worker.js`: couple fluid torque -> mechanics -> wheel angle -> fluid, in a Web Worker (falls back to the main thread after 6 s or with `?local`). The first 60% of the 40 s warm-up uses the analytic bucket torque while the buckets fill.
- `src/ssf.js`: screen-space fluid rendering like the reference app: particles drawn as sphere impostors into a float depth target, bilateral blur, normals from depth, thickness-based absorption, refraction, Fresnel reflection and specular. Dense water is replicated across the wheel width; isolated spray stays a single droplet. Falls back to the mesh below when float render targets are unavailable (or with `?nossf`).
- `src/surface.js` (fallback): turns the particles into a continuous water mesh: density splat on a (y,z) grid, marching squares on the iso-region, extruded across the wheel width with smooth side normals. Dense water becomes a surface; sparse spray stays as point sprites.
- `src/main.js`: three.js scene (procedural geometry), renders the worker's particles, five-card panel, canvas charts (torque curves, runner-speed strip, energy balance).

Tests: `node src/mechanics.test.mjs`, `node --import ./src/three-loader.mjs src/surface.test.mjs`, `node src/fluid.test.mjs` (mass conservation, settles near 6.8 rpm with ~350 kg held in the wheel).

Spray droplets and tail-race foam are spawned in `main.js` from fast / plunging fluid particles.

Not yet implemented: section view, click-to-focus, procedural textures, dust and grain particles. The fluid is a 2D slab model, so the water mesh is an extrusion of the cross-section: no splashes across the wheel width, and thin jets are drawn as point sprites rather than a surface.
