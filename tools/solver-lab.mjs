/* Pyraminx.net — solver tuning lab (dev scratch, not shipped).
 *
 * Runs js/solver-core.js on real scrambles exactly as solver.html does (same
 * dist table, rotations, defaults) and prints the ranked solutions so we can
 * judge whether the #1 result is actually the best solve. Lets us A/B ergonomic
 * weights / slack / caps without a browser.
 *
 *   node tools/solver-lab.mjs                      # default scramble set, default tuning
 *   node tools/solver-lab.mjs "R U' B L' U R' B'"  # one scramble
 *   node tools/solver-lab.mjs --top 6              # show more per length
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = {};
require(path.join(ROOT, 'js', 'engine.js'));
const E = globalThis.window.OOEngine;
require(path.join(ROOT, 'js', 'sheet.js'));
const S = globalThis.window.OOSheet || null;
require(path.join(ROOT, 'js', 'solver-core.js'));
const { makeSolverCore } = globalThis.window.OOSolverCore;

/* ---- build the optimal-distance table (mirrors solver.js boot()) ---- */
function buildDist() {
  const d = new Int8Array(E.NSLOTS).fill(-1);
  let frontier = new Uint32Array([E.idx(E.solved())]);
  d[frontier[0]] = 0;
  let dd = 0;
  while (frontier.length) {
    const next = [];
    for (let fi = 0; fi < frontier.length; fi++) {
      const s = E.unidx(frontier[fi]);
      for (let m = 0; m < 8; m++) {
        const t = E.copy(s); E.applyMoveIdx(t, m);
        const ix = E.idx(t);
        if (d[ix] === -1) { d[ix] = dd + 1; next.push(ix); }
      }
    }
    dd++; frontier = Uint32Array.from(next);
  }
  return d;
}

const dist = buildDist();
const C = makeSolverCore(E, dist);
const syms = E.buildSyms();
const rotBy = E.makeFrames(syms);
const rotations = C.buildRotations();

/* ---- defaults straight from solver.js UI ---- */
const DEFAULTS = {
  methods: { l4e: true, ml4e: true, l5e: true, tl4eb: true, psl4e: false, psml4e: false },
  caps: { l4e: 7, ml4e: 7, tl4eb: 6, l5e: 4, psl4e: 5, psml4e: 5 },
  offsetsText: 'L, R',
  slack: 0,
  maxCancel: 2,
  weights: {},
};

const METHOD_LABEL = { l4e: 'L4E', ml4e: 'ML4E', l5e: 'L5E', tl4eb: 'TL4E-B', psl4e: 'PsL4E', psml4e: 'PsML4E' };

function caseNameOf(jstate) {
  if (!S || !jstate) return null;
  try { return S.nameForState(jstate); } catch (e) { return null; }
}

function runOne(scramble, tuning, top) {
  const parsed = E.parseAlg(scramble);
  if (!parsed) { console.log(`!! could not parse: ${scramble}`); return; }
  const state = E.applyParsed(parsed, E.solved(), syms, rotBy);
  const dopt = dist[E.idx(state)];
  console.log('\n' + '='.repeat(78));
  console.log(`SCRAMBLE  ${scramble}`);
  console.log(`optimal   ${dopt} moves`);
  if (dopt === 0) { console.log('(already solved)'); return; }

  const offsets = (tuning.methods.psl4e || tuning.methods.psml4e)
    ? tuning.offsetsText.split(',').map(x => x.trim()).filter(Boolean).map(C.parseOffset).filter(Boolean)
    : [];
  const lengths = [dopt, dopt + 1].filter(L => L <= 11);
  const t0 = process.hrtime.bigint();
  const res = C.search(state, {
    methods: tuning.methods, caps: tuning.caps, offsets,
    slack: tuning.slack, maxCancel: tuning.maxCancel,
    lengths, rotations,
    budget: Math.max(...lengths) >= 10 ? 2.5e7 : 8e6,
    weights: tuning.weights,
  });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;

  // overall best across all requested lengths (the "single best" the UI will surface)
  let best = null;
  for (const L of lengths) for (const it of (res.byLength[L] || [])) if (!best || it.score < best.score) best = { ...it, L };
  if (best) {
    const blen = best.L === dopt ? 'optimal' : 'optimal+1';
    console.log(`\n  >> OVERALL BEST  score ${best.score}  (${best.L} moves, ${blen})  ${best.display}`);
  }

  for (const L of lengths) {
    const items = res.byLength[L] || [];
    const tag = L === dopt ? ' (optimal)' : ' (optimal+1)';
    console.log(`\n  ${L} moves${tag} — ${items.length} solution(s)`);
    items.slice(0, top).forEach((it, i) => {
      const badges = Object.entries(it.methods)
        .map(([id, m]) => `${METHOD_LABEL[id]} ${m.v}+${m.fin}${m.cancel ? '−' + m.cancel : ''}`)
        .join(', ');
      // representative decomposition (mirrors solver.js primaryMethod: shortest V, then priority)
      const PRIO = ['l4e', 'ml4e', 'tl4eb', 'l5e', 'psl4e', 'psml4e'];
      const [pid, pm] = Object.entries(it.methods).sort(
        (a, b) => a[1].v - b[1].v || PRIO.indexOf(a[0]) - PRIO.indexOf(b[0]))[0];
      const cname = caseNameOf(pm.jstate);
      const recon = `${pm.vmoves || '—'}  |  ${pm.amoves || '—'}${cname ? '  (' + cname + ')' : ''}`;
      console.log(`    #${i + 1}  score ${String(it.score).padEnd(6)} ${it.display}`);
      console.log(`         [${badges}]`);
      console.log(`         V: ${recon}`);
    });
    if (!items.length) console.log('    (none)');
  }
  console.log(`\n  search ${ms.toFixed(0)}ms  work=${res.work}${res.truncated ? '  TRUNCATED' : ''}`);
}

/* ---- scramble set (fixed for reproducible A/B) ---- */
const SAMPLES = [
  "R U' B L' U R' B'",
  "U L' R B U' L B'",
  "L R' U B' L' U' R B",
  "R' L U' B R B' U L'",
  "B U L R' U' B' L R",
  "U' R B L U R' B' L'",
  "L U B' R' U' L' B R'",
  "R B U L' B' R' U' L",
  "B' R U' L R' B U L'",
  "U L R B U' R' B' L'",
];

/* ---- args ---- */
const argv = process.argv.slice(2);
let top = 5;
const ti = argv.indexOf('--top');
if (ti >= 0) { top = +argv[ti + 1]; argv.splice(ti, 2); }
// --w wide=1.75,rotCost=0  -> override ergonomic weights for A/B testing
const wi = argv.indexOf('--w');
if (wi >= 0) {
  for (const kv of argv[wi + 1].split(',')) { const [k, v] = kv.split('='); DEFAULTS.weights[k] = +v; }
  argv.splice(wi, 2);
}
// --scan N: generate N random scrambles, tally how often +1 wins / wides appear in #1 / truncation
const si = argv.indexOf('--scan');
if (si >= 0) {
  const N = +argv[si + 1] || 200;
  let plus1 = 0, wideTop = 0, trunc = 0, noSol = 0, maxMs = 0;
  const MOVES = E.MOVES;
  const plus1ex = [];
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let n = 0; n < N; n++) {
    const st = E.solved();
    const moves = [];
    for (let k = 0; k < 12; k++) { const m = Math.floor(rnd() * 8); moves.push(MOVES[m]); E.applyMoveIdx(st, m); }
    const dopt = dist[E.idx(st)];
    if (dopt === 0) continue;
    const lengths = [dopt, dopt + 1].filter(L => L <= 11);
    const t0 = process.hrtime.bigint();
    const res = C.search(st, { methods: DEFAULTS.methods, caps: DEFAULTS.caps, offsets: [],
      slack: DEFAULTS.slack, maxCancel: DEFAULTS.maxCancel, lengths, rotations,
      budget: Math.max(...lengths) >= 10 ? 2.5e7 : 8e6, weights: DEFAULTS.weights });
    maxMs = Math.max(maxMs, Number(process.hrtime.bigint() - t0) / 1e6);
    if (res.truncated) trunc++;
    let best = null, bestL = null;
    for (const L of lengths) for (const it of (res.byLength[L] || [])) if (!best || it.score < best.score) { best = it; bestL = L; }
    if (!best) { noSol++; continue; }
    if (bestL === dopt + 1) {
      plus1++;
      if (plus1ex.length < 3) {
        const bestOpt = (res.byLength[dopt] || [])[0];
        plus1ex.push({ scr: moves.join(' '), dopt, best, bestOpt });
      }
    }
    if (/[RL]w/.test(best.display)) wideTop++;
  }
  console.log(`\nscan ${N} random scrambles:`);
  console.log(`  best is optimal+1:  ${plus1} (${(100 * plus1 / N).toFixed(1)}%)`);
  console.log(`  wide move in best:  ${wideTop} (${(100 * wideTop / N).toFixed(1)}%)`);
  console.log(`  truncated:          ${trunc}`);
  console.log(`  no solution found:  ${noSol}`);
  console.log(`  slowest search:     ${maxMs.toFixed(0)}ms`);
  for (const ex of plus1ex) {
    console.log(`\n  optimal+1 wins:  ${ex.scr}  (optimal ${ex.dopt})`);
    if (ex.bestOpt) console.log(`    best optimal:    score ${ex.bestOpt.score}  ${ex.bestOpt.display}`);
    console.log(`    best overall:    score ${ex.best.score}  ${ex.best.display}  (+1)`);
  }
  process.exit(0);
}
const scrambles = argv.length ? argv : SAMPLES;

const effW = Object.assign({}, C.ERGO_DEFAULTS, DEFAULTS.weights);
console.log(`tuning: slack=${DEFAULTS.slack} maxCancel=${DEFAULTS.maxCancel} caps=${JSON.stringify(DEFAULTS.caps)}`);
console.log(`weights: ${Object.entries(effW).map(([k, v]) => k + '=' + v).join(' ')}`);
if (Object.keys(DEFAULTS.weights).length) console.log(`  overrides: ${JSON.stringify(DEFAULTS.weights)}`);
for (const scr of scrambles) runOne(scr, DEFAULTS, top);
