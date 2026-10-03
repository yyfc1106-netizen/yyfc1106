// Lets node tests resolve `import 'three'` to the vendored copy (the browser uses an importmap).
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: new URL('../vendor/three.module.js', ${JSON.stringify(import.meta.url)}).href, shortCircuit: true };
  return next(spec, ctx);
}`));
