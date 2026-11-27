import { cp, mkdir, rm } from 'node:fs/promises';
import { build } from 'esbuild';

const url = process.env.PUBLIC_SUPABASE_URL?.trim() ?? '';
const key = process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
const demo = process.env.PUBLIC_DEMO === 'true';
if (!demo && (!url || !key)) {
  throw new Error('Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_PUBLISHABLE_KEY, or explicitly set PUBLIC_DEMO=true.');
}
if (!demo && (new URL(url).protocol !== 'https:' || key.startsWith('sb_secret_'))) {
  throw new Error('Use an HTTPS project URL and a browser-safe Supabase publishable key.');
}
if (!demo && !key.startsWith('sb_publishable_')) {
  let role;
  try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role; } catch {}
  if (role !== 'anon') throw new Error('Only a publishable key or legacy anon key may enter the browser bundle.');
}
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const name of ['index.html', 'styles.css', 'assets']) {
  await cp(`web/${name}`, `dist/${name}`, { recursive: true });
}
await build({
  entryPoints: ['web/app.js'],
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['es2022'],
  outfile: 'dist/app.js',
  define: { __PUBLIC_CONFIG__: JSON.stringify(demo ? { demo } : { url, key, demo }) },
});
