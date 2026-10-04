// Bundles and minifies the app (tree-shaken three.js included) into dist/. Open dist/index.html through any static server.
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
await build({
  entryPoints: { main: 'src/main.js', 'physics.worker': 'src/physics.worker.js' },
  outdir: 'dist', bundle: true, minify: true, format: 'esm', target: 'es2020', legalComments: 'none',
  alias: { three: './vendor/three.module.js' }, logLevel: 'info',
});
// dist/index.html: same page, pointing at the bundle (no importmap needed)
let h = readFileSync('index.html', 'utf8');
h = h.replace(/<script type="importmap">.*?<\/script>\n?/s, '').replace('src="src/main.js"', 'src="main.js"').replace('href="style.css"', 'href="style.css"');
writeFileSync('dist/index.html', h);
cpSync('style.css', 'dist/style.css');
