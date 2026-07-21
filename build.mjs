/* Build the trainer bundle from src/trainer into the live artifact js/trainer.js.
 *
 * src/trainer is the source of truth for the deployed trainer; trainer.html
 * loads js/engine.js + js/render.js + js/tables.js, then this bundle.
 *
 *   node build.mjs           one-off build
 *   node build.mjs --watch   rebuild on change
 */
import esbuild from 'esbuild';

const options = {
  entryPoints: ['src/trainer/index.jsx'],
  bundle: true,
  minify: true,
  format: 'iife',                 // self-executing classic script — the page has no module system
  target: 'es2018',
  jsx: 'transform',               // classic runtime: source imports React and uses JSX
  outfile: 'js/trainer.js',
  banner: { js: '/* Skewbiks.com — Skewb trainer (bundled React app). Styles: css/trainer.css */' },
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('watching src/trainer for changes…');
} else {
  await esbuild.build(options);
  console.log('built js/trainer.js');
}
