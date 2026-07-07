/* Skewbiks.com — solver lab (dev scratch, not shipped).
 *
 * Runs js/solver-core.js on real scrambles exactly as solver.html does (same
 * dist table, same alg data, same defaults) and prints the movecount-organized
 * solutions — first step, setup rotation (the alg's own leading rotations are
 * folded into it; derived in the core's PHYSICAL facelet model and spelled in
 * the sheets' letters, never engine letters), and the sheet's algorithm from
 * its first turn on — every emitted line carries the core's physical facelet
 * proof (mv.ok). Lets us judge caps without a browser.
 *
 *   node tools/solver-lab.mjs                      # default scramble set
 *   node tools/solver-lab.mjs "R U' B L' U R' B'"  # one scramble
 *   node tools/solver-lab.mjs --top 4 --lens 3     # rows per bucket / buckets shown
 *   node tools/solver-lab.mjs --caps fl=6,tcll=5
 *   node tools/solver-lab.mjs --scan 200           # tally stats over random scrambles
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { buildDist } from './lib/bfs-dist.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = {};
require(path.join(ROOT, 'js', 'engine.js'));
const E = globalThis.window.OOEngine;
require(path.join(ROOT, 'js', 'solver-core.js'));
const { makeSolverCore, METHOD_DEFS } = globalThis.window.OOSolverCore;
const algData = JSON.parse(readFileSync(path.join(ROOT, 'data', 'skewb_algs.json'), 'utf8'));

/* ---- tables + core (same inputs as solver.html) ---- */
const dist = buildDist(E);
const C = makeSolverCore(E, dist, algData);
C.algIndex();

/* ---- defaults straight from solver.js UI ---- */
const DEFAULTS = {
  methods: { fl: true, tcll: true, eg2: true },
  caps: Object.fromEntries(Object.keys(METHOD_DEFS).map(id => [id, METHOD_DEFS[id].cap])),
};
const METHOD_LABEL = Object.fromEntries(Object.entries(METHOD_DEFS).map(([id, d]) => [id, d.name]));

function runOne(scramble, tuning, top, lensShown) {
  const parsed = E.parseAlg(scramble);
  if (!parsed) { console.log(`!! could not parse: ${scramble}`); return; }
  const state = E.applyParsed(parsed, E.solved(), C.syms, C.rotBy);
  const dopt = dist[E.idx(state)];
  console.log('\n' + '='.repeat(78));
  console.log(`SCRAMBLE  ${scramble}`);
  console.log(`optimal   ${dopt} moves`);
  if (dopt === 0) { console.log('(already solved)'); return; }

  const t0 = process.hrtime.bigint();
  const res = C.search(state, { methods: tuning.methods, caps: tuning.caps });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const lens = Object.keys(res.byLength).map(Number).sort((a, b) => a - b);
  let bad = 0, n = 0;
  for (const L of lens) for (const it of res.byLength[L]) { n++; if (!C.methodView(state, it).ok) bad++; }

  for (const L of lens.slice(0, lensShown)) {
    const items = res.byLength[L];
    console.log(`\n  ${L} moves${L === dopt ? ' (optimal)' : ''} — ${items.length} solution(s)`);
    items.slice(0, top).forEach((it, i) => {
      const mv = C.methodView(state, it);
      if (!mv.ok) { console.log(`    #${i + 1}  !! VERIFY FAILED`); return; }
      console.log(`    #${i + 1}  [${METHOD_LABEL[it.id]} ${it.v}+${it.fin}]  ${mv.vmoves || '—'}${mv.rot ? '  | ' + mv.rot : ''}  |  ${mv.alg || '—'}${mv.name ? '   (' + mv.name + (mv.rating ? ' · ' + mv.rating : '') + ')' : ''}`);
    });
  }
  if (lens.length > lensShown) console.log(`  … ${lens.length - lensShown} more move counts`);
  console.log(`\n  search ${ms.toFixed(0)}ms  work=${res.work}${res.truncated ? '  TRUNCATED' : ''}  ${n} solutions, ${bad ? 'BAD=' + bad : 'all verified'}`);
}

/* ---- scramble set (fixed for reproducible comparisons) ---- */
const SAMPLES = [
  "L R L U' B R' U' R' L R B",   // KPW 2015 official final
  "R U' B L' U R' B'",
  "U L' R B U' L B'",
  "L R' U B' L' U' R B",
  "R' L U' B R B' U L'",
  "B U L R' U' B' L R",
  "U' R B L U R' B' L'",
  "R B U L' B' R' U' L",
  "B' R U' L R' B U L'",
  "U L R B U' R' B' L'",
];

/* ---- args ---- */
const argv = process.argv.slice(2);
const numFlag = (name, i) => {   // NaN would silently disable the core's pruning — refuse it
  const v = Number(argv[i + 1]);
  if (!Number.isFinite(v)) { console.error(`${name} needs a number`); process.exit(1); }
  return v;
};
let top = 3, lensShown = 3, tuned = false;
const ti = argv.indexOf('--top');
if (ti >= 0) { top = numFlag('--top', ti); argv.splice(ti, 2); }
const li = argv.indexOf('--lens');
if (li >= 0) { lensShown = numFlag('--lens', li); argv.splice(li, 2); }
const parseKVs = (str, valid, what) => {
  const out = {};
  for (const kv of String(str).split(',')) {
    const [k, v] = kv.split('=');
    if (!(k in valid)) { console.error(`unknown ${what} '${k}' (valid: ${Object.keys(valid).join(' ')})`); process.exit(1); }
    if (!Number.isFinite(+v)) { console.error(`${what} '${k}' needs a number`); process.exit(1); }
    out[k] = +v;
  }
  return out;
};
const ci = argv.indexOf('--caps');
if (ci >= 0) { Object.assign(DEFAULTS.caps, parseKVs(argv[ci + 1], DEFAULTS.caps, 'cap')); argv.splice(ci, 2); tuned = true; }

// --scan N: random scrambles; verify everything; tally best-total vs optimal,
// method mix, no-solution scrambles, truncation, slowest search.
const si = argv.indexOf('--scan');
if (si >= 0) {
  const N = +argv[si + 1] || 200;
  let noSol = 0, trunc = 0, badVerify = 0, maxMs = 0, sols = 0;
  const mix = { fl: 0, tcll: 0, eg2: 0 };
  const above = [0, 0, 0, 0, 0];   // best bucket at dopt+k (k>=4 pooled)
  let seed = 12345;   // Math.imul keeps the LCG in 32-bit — the float product loses low bits past 2^53
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let n = 0; n < N; n++) {
    const st = E.solved();
    for (let k = 0; k < 12; k++) E.applyMoveIdx(st, Math.floor(rnd() * 8));
    const dopt = dist[E.idx(st)];
    if (dopt === 0) continue;
    const t0 = process.hrtime.bigint();
    const res = C.search(st, { methods: DEFAULTS.methods, caps: DEFAULTS.caps });
    maxMs = Math.max(maxMs, Number(process.hrtime.bigint() - t0) / 1e6);
    if (res.truncated) trunc++;
    const lens = Object.keys(res.byLength).map(Number).sort((a, b) => a - b);
    let best = null;
    for (const L of lens) for (const it of res.byLength[L]) {
      sols++;
      if (!C.methodView(st, it).ok) { badVerify++; continue; }
      if (!best) best = { it, L };
    }
    if (!best) { noSol++; continue; }
    above[Math.min(4, best.L - dopt)]++;
    mix[best.it.id]++;
  }
  console.log(`\nscan ${N} random scrambles (${sols} solutions verified):`);
  console.log(`  no verbatim-alg solution at all:  ${noSol}`);
  console.log(`  best at optimal+k (k=0..3,4+):    ${above.join(' / ')}`);
  console.log(`  best solution's method:           fl ${mix.fl} / tcll ${mix.tcll} / eg2 ${mix.eg2}`);
  console.log(`  verify failures:                  ${badVerify}`);
  console.log(`  truncated searches:               ${trunc}`);
  console.log(`  slowest search:                   ${maxMs.toFixed(0)}ms`);
  // gate: verify failures always fail; at DEFAULT tuning, truncation or an
  // unsolvable scramble is a regression too (experimental tunings may starve)
  process.exit(badVerify || (!tuned && (trunc || noSol)) ? 1 : 0);
}
const scrambles = argv.length ? argv : SAMPLES;

console.log(`tuning: caps=${JSON.stringify(DEFAULTS.caps)}`);
for (const scr of scrambles) runOne(scr, DEFAULTS, top, lensShown);
