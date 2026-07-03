/* Skewbiks.com — full state-space verification against the literature.
 *
 * Asserts, from a fresh BFS over the real engine:
 *   - reachable count 3,149,280 and the exact depth histogram (OEIS A079745)
 *   - both orientation constraints hold on every reachable state
 *   - symmetry-class counts (canonicalization oracles from the ground-truth
 *     verification BFS): 262,674 classes under the 12 rotations, 131,391 under
 *     all 24 (rotations + mirrors), and 12 antipode classes at depth 11.
 * The class/pair counts printed here feed the census copy (js/oo.js) and the
 * Firestore rules bound. See docs/skewb-ground-truth.md.
 *
 * Run: node tools/verify-space.mjs   (npm run test:space; ~2-4 min)
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { buildDist } from './lib/bfs-dist.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = {};
require(path.join(ROOT, 'js', 'engine.js'));
const E = globalThis.window.OOEngine;

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '✓ ' : '✗ ') + name + (ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
  if (!ok) failed++;
};

console.log('BFS over ' + E.NSLOTS.toLocaleString() + ' slots…');
let t0 = Date.now();
const dist = buildDist(E);
console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// depth histogram vs Jaap / OEIS A079745
const HIST = [1, 8, 48, 288, 1728, 10248, 59304, 315198, 1225483, 1455856, 81028, 90];
const hist = new Array(12).fill(0);
let reach = 0;
for (let i = 0; i < dist.length; i++) if (dist[i] >= 0) { reach++; hist[dist[i]]++; }
check('reachable states = 3,149,280', reach, 3149280);
check('depth histogram = OEIS A079745', hist, HIST);

// orientation constraints on every reachable state
t0 = Date.now();
let badFree = 0, badLink = 0;
for (let i = 0; i < dist.length; i++) {
  if (dist[i] < 0) continue;
  const s = E.unidx(i);
  if ((s.fo[0] + s.fo[1] + s.fo[2] + s.fo[3]) % 3 !== 0) badFree++;
  const pr = (() => { let m0 = 0; for (let j = 1; j < 4; j++) if (s.fp[j] < s.fp[0]) m0++;
    let m1 = 0; for (let j = 2; j < 4; j++) if (s.fp[j] < s.fp[1]) m1++; return m0 * 3 + m1; })();
  if ((s.fx[0] + s.fx[1] + s.fx[2] + s.fx[3]) % 3 !== E.CLASS[pr]) badLink++;
}
check('free-tetrad twist sum ≡ 0 everywhere', badFree, 0);
check('fixed-twist sum ≡ free-perm class everywhere', badLink, 0);
console.log(`  constraints checked in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// symmetry classes
t0 = Date.now();
const SYMS = E.buildSyms();
const canon = E.makeCanon(SYMS);
const seen12 = new Uint8Array(E.NSLOTS), seen24 = new Uint8Array(E.NSLOTS);
let n12 = 0, n24 = 0, anti24 = 0;
for (let i = 0; i < dist.length; i++) {
  if (dist[i] < 0) continue;
  const s = E.unidx(i);
  const c12 = canon(s);
  if (!seen12[c12]) { seen12[c12] = 1; n12++; }
  let c24 = c12;
  for (const sym of SYMS.mirrors) { const v = E.idx(sym.apply(s)); if (v < c24) c24 = v; }
  if (!seen24[c24]) { seen24[c24] = 1; n24++; if (dist[i] === 11) anti24++; }
}
check('classes under 12 rotations = 262,674', n12, 262674);
check('classes under 24 (rot+mirror) = 131,391', n24, 131391);
check('depth-11 antipode classes (24-group) = 12', anti24, 12);
console.log(`  classes counted in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

console.log('');
console.log('RECORD for downstream milestones:');
console.log('  index bound (firestore.rules classId/partnerId/pairId): < ' + E.NSLOTS.toLocaleString());
console.log('  census classes (oo.js copy): 262,674 rotation classes / 131,391 mirror pairs');
console.log(failed ? 'FAILED' : 'ALL CHECKS PASS');
process.exitCode = failed ? 1 : 0;
