# Millrace Lite

A minimal re-creation of an interactive overshot-gristmill simulator (3D model + live physics panel).

Run: `cd millrace && python3 -m http.server 8000` and open http://localhost:8000 (three.js is vendored, no build step).
Test the mechanics: `node src/mechanics.test.mjs`.

- `src/mechanics.js`: pure lumped model: sluice flow, bucket-model wheel torque, 18:1 gear train, millstone load, meal fineness and temperature, warnings.
- `src/main.js`: three.js scene (procedural geometry), ballistic water particles that ride the wheel, five-card panel, canvas charts (torque curves, runner-speed strip, energy balance).

Not yet implemented: the position-based-fluids solver in a Web Worker (particle water here is ballistic and only visual), section view, click-to-focus, procedural textures.
