/* Skewbiks.com — full state-space verification against the literature.
 *
 * Asserts, from a fresh BFS over the real engine:
 *   - reachable count 3,149,280 and the exact depth histogram (OEIS A079745)
 *   - both orientation constraints hold on every reachable state
 *   - symmetry-class counts (canonicalization oracles from the ground-truth
 *     verification BFS): 262,674 classes under the engine's 12 tetrad-
 *     preserving rotations, 131,391 under those 12 + the 12 mirrors (the
 *     pre-2026-07-10 census), 12 antipode classes at depth 11, per-depth
 *     tables, and per-depth rotation-orbit sizes that re-sum to the raw
 *     histogram
 *   - the re-hold map ι (the 12 tetrad-swapping PROPER rotations act on states
 *     as s -> reanchor(ρ0·Φ(s)·ρ0⁻¹) — E.makeHoldSym): built by BOTH routes
 *     (the engine's free-turn/frame-walk route and an independent facelet
 *     conj+reanchor port of the ground-truth construction) with sample
 *     cross-agreement; state-level involution; depth preservation; chirality
 *     preservation (written WCA B lands in the plain/CW one-move class; the
 *     two depth-1 classes are each ι-fixed)
 *   - the CF subset (centers solved relative to each other, 2026-07-13):
 *     E.centersRelSolved — 104,976 raw states, 4,503 hold-24 census entries
 *     with per-depth tables; invariant on every hold-24 orbit and under
 *     mirrors (what the census's CF browse scope in js/oo.js relies on)
 *   - the corrected census folds (all machine-verified 2026-07-10):
 *     hold-24 fold = 132,315 entries (THE CENSUS — 24 proper rotations,
 *     mirrors separate) with its exact per-depth table; ι fixes 1,956 of the
 *     262,674 rotation classes, the mirror involution fixes 108; full
 *     48-group fold = 66,321 pages, of which 327 hold-24 entries are
 *     self-mirror (2·66,321 − 132,315).
 * The class/pair counts printed here feed the census copy (js/oo.js) and the
 * Firestore rules bound. See docs/skewb-ground-truth.md §Symmetry.
 *
 * Run: node tools/verify-space.mjs   (npm run test:space; ~3-6 min)
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

// state-symmetry classes — through the same engine closures as always
// (makeCanon / makeMirrorCanon / makeFullCanon). Since the 2026-07-10 hold-24
// re-fold these are INTERMEDIATE oracles: the census entry key is the hold-24
// fold (below), the page key the full 48-group fold. Kept in full.
t0 = Date.now();
const SYMS = E.buildSyms();
const canon = E.makeCanon(SYMS), mcanon = E.makeMirrorCanon(SYMS), fcanon = E.makeFullCanon(SYMS);
const seen12 = new Uint8Array(E.NSLOTS), seen24 = new Uint8Array(E.NSLOTS);
let n12 = 0, n24 = 0, anti24 = 0, fullMismatch = 0;
const reps12 = [];   // the 262,674 rotation-class reps (= their canon ids), for the ι stage
// per-depth class counts for BOTH folds (dist is symmetry-invariant, so any
// member's depth is the class depth) + per-depth rotation-orbit size sums,
// which must rebuild the raw histogram exactly.
const cnt12 = new Array(12).fill(0), cnt24 = new Array(12).fill(0), orbitSum12 = new Array(12).fill(0);
for (let i = 0; i < dist.length; i++) {
  if (dist[i] < 0) continue;
  const s = E.unidx(i);
  const c12 = canon(s);
  if (!seen12[c12]) {
    seen12[c12] = 1; n12++; cnt12[dist[i]]++; reps12.push(c12);
    const orb = new Set();
    for (const sym of SYMS.rots) orb.add(E.idx(sym.apply(s)));
    orbitSum12[dist[i]] += orb.size;
  }
  const c24 = Math.min(c12, mcanon(s));
  // spot-check the single-closure fold against the min-of-two computation
  if ((i & 65535) === 0 && fcanon(s) !== c24) fullMismatch++;
  if (!seen24[c24]) { seen24[c24] = 1; n24++; cnt24[dist[i]]++; if (dist[i] === 11) anti24++; }
}
check('classes under the 12 tetrad-preserving rotations = 262,674', n12, 262674);
check('classes under 12 rots + 12 mirrors = 131,391 (the pre-2026-07-10 census)', n24, 131391);
check('rotation-fold depth-1 classes = 2 (chirality separates)', cnt12[1], 2);
check('12rot+mirror-fold depth-1 classes = 1 (mirrors merge chirality)', cnt24[1], 1);
check('per-depth rotation-orbit sizes re-sum to the raw histogram', orbitSum12, HIST);
check('makeFullCanon == min(makeCanon, makeMirrorCanon) on the sample', fullMismatch, 0);
check('depth-11 antipode classes (rot+mirror group) = 12', anti24, 12);
console.log(`  classes counted in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

/* ---------------- the re-hold map ι and the corrected census folds ---------------- */
// Route (1), the shipped one: E.makeHoldSym — ι(s) = ONE applyParsed pass over
// the ρ0-conjugated free-corner token stream of a solving word (frame walk
// mandatory: each free-corner turn parks a 240° whole-cube rotation in the
// frame that re-aims all later letters).
console.log('re-hold map ι (hold-24 census fold)…');
t0 = Date.now();
const HOLD = E.makeHoldSym(SYMS);
const iota = s => HOLD.iota(s, dist);

// Route (2), independent cross-check: the facelet-level construction —
// conjugate the scramble's 30-sticker permutation by a tetrad-swapping
// rotation ρ0 and re-anchor by searching the 12 tetrad-preserving rotations
// for the one that puts every axis piece back on its own slot. Built from
// exported geometry only (no engine sym/frame machinery).
const FACES = ['U','R','F','D','L','B'];
const FIDX = { U:0, R:1, F:2, D:3, L:4, B:5 };
const ALLC = Object.keys(E.CPOS);
const MOVE_AXIS = ['UBR','UBR','DBL','DBL','DFR','DFR','UFL','UFL'];
const stickerIdx = (f, c) => FIDX[f]*5 + 1 + E.STICKER_POS[f].indexOf(c);
const cornerByFaces = new Map(ALLC.map(c => [E.CFACES[c].slice().sort().join(''), c]));
const cornerMapOf = fp => { const m = {};
  for (const c of ALLC) m[c] = cornerByFaces.get(E.CFACES[c].map(f => fp[f]).sort().join(''));
  return m; };
const pApply = (fl, P) => P.map(src => fl[src]);
const pThen = (P, Q) => Q.map(q => P[q]);
const pInv = P => { const r = new Array(30); for (let i = 0; i < 30; i++) r[P[i]] = i; return r; };
const rotPosPerm = fp => { const cmap = cornerMapOf(fp), map = new Array(30);
  for (const f of FACES) map[FIDX[fp[f]]*5] = FIDX[f]*5;
  for (const c of ALLC) for (const f of E.CFACES[c]) map[stickerIdx(fp[f], cmap[c])] = stickerIdx(f, c);
  return map; };
const SOLVED_FL = E.solvedFacelets();
const RHO0 = rotPosPerm(HOLD.fp);                     // same ρ0 as the engine's
const EVENPOS = SYMS.rots.map(r => rotPosPerm(r.fp)); // the 12 re-anchoring candidates
const CSTK = {}; for (const c of ALLC) CSTK[c] = E.CFACES[c].map(f => stickerIdx(f, c));
const HOMES = {}; for (const c of E.AXIS) HOMES[c] = E.CFACES[c].map(f => FIDX[f]).sort().join('');
const anchoredFl = fl => E.AXIS.every(c => CSTK[c].map(i => fl[i]).sort().join('') === HOMES[c]);
const FPERM = MOVE_AXIS.map((A, m) => { let P = Array.from({ length: 30 }, (_, i) => i);
  for (let k = 0; k <= (m % 2); k++) P = pThen(P, E.moveFaceletPerm[A]); return P; });
function iotaFacelet(state) {
  const w = HOLD.scrambleMovesTo(state, dist);
  let P = Array.from({ length: 30 }, (_, i) => i);
  for (const m of w) P = pThen(P, FPERM[m]);
  const C = pThen(pThen(RHO0, P), pInv(RHO0));        // rotate, scramble, rotate back
  for (const g of EVENPOS) { const fl = pApply(pApply(SOLVED_FL, C), g); if (anchoredFl(fl)) return E.fromFacelets(fl); }
  return null;
}

// sample checks: cross-route agreement, involution, depth preservation
{
  let badX = 0, badInv = 0, badDepth = 0, n = 0;
  for (let k = 0; k < 6000 && n < 2000; k++) {
    const ix = Math.floor(Math.random() * E.NSLOTS);
    if (dist[ix] < 0) continue;
    n++;
    const s = E.unidx(ix);
    const t = iota(s);
    if (dist[E.idx(t)] !== dist[ix]) badDepth++;
    if (!E.eq(iota(t), s)) badInv++;
    if (n <= 400) { const t2 = iotaFacelet(s); if (!t2 || !E.eq(t2, t)) badX++; }
  }
  check(`ι(ι(s)) = s on ${n} random reachable states`, badInv, 0);
  check(`dist[ι(s)] = dist[s] on ${n} random reachable states`, badDepth, 0);
  check('free-turn route == independent facelet conj+reanchor route (400 samples)', badX, 0);
}
// chirality: all 24 rotations preserve handedness — written WCA B (a physical
// CW free-corner turn) lands in the PLAIN (CW) one-move class, never the CCW
// one, and both depth-1 classes are ι-fixed (they never merge under rotations;
// only mirrors merge them — see the depth-1 counts above).
{
  const oneMove = m => { const s = E.solved(); E.applyMoveIdx(s, m); return s; };
  const rotBy = E.makeFrames(SYMS);
  const sB = E.applyParsed(E.parseAlg('B', 'wca'), E.solved(), SYMS, rotBy);
  check('written WCA B is rotation-class-equal to a plain (CW) native move', canon(sB), canon(oneMove(0)));
  check("written WCA B' is rotation-class-equal to a prime (CCW) native move", canon(E.applyParsed(E.parseAlg("B'", 'wca'), E.solved(), SYMS, rotBy)), canon(oneMove(1)));
  check('the two one-move classes are distinct and each ι-fixed',
    canon(oneMove(0)) !== canon(oneMove(1))
    && canon(iota(oneMove(0))) === canon(oneMove(0))
    && canon(iota(oneMove(1))) === canon(oneMove(1)), true);
}
// the full partner map over all 262,674 rotation classes -> every fold count
const partner = new Int32Array(E.NSLOTS).fill(-1);
const mpart = new Int32Array(E.NSLOTS).fill(-1);
for (const r of reps12) { const s = E.unidx(r); partner[r] = canon(iota(s)); mpart[r] = mcanon(s); }
let notInv = 0, badDp2 = 0, fixIota = 0, fixMir = 0, nHold24 = 0, selfMirror = 0;
const cntH24 = new Array(12).fill(0);
const entryReps = [];   // ascending hold-24 entry reps (min of r and its ι-partner)
for (const r of reps12) {
  const p = partner[r];
  if (partner[p] !== r) notInv++;
  if (dist[p] !== dist[r]) badDp2++;
  if (p === r) fixIota++;
  if (mpart[r] === r) fixMir++;
  if (p >= r) { // r is its hold-24 orbit's minimum -> a census entry rep
    nHold24++; cntH24[dist[r]]++; entryReps.push(r);
    if (Math.min(mpart[r], mpart[p]) === r) selfMirror++;
  }
}
check('ι partner map is a total involution on the 262,674 classes', notInv, 0);
check('ι partner map preserves depth on every class', badDp2, 0);
check('rotation classes fixed by ι = 1,956', fixIota, 1956);
check('rotation classes fixed by the mirror involution = 108', fixMir, 108);
check('hold-24 fold (24 proper rotations) = 132,315 census entries', nHold24, 132315);
check('hold-24 per-depth table', cntH24, [1, 2, 4, 16, 80, 444, 2514, 13254, 51374, 61115, 3500, 11]);
check('self-mirror hold-24 entries = 327', selfMirror, 327);
// full 48-group fold (24 rotations + 24 mirror images) via union-find
{
  const idxOf = new Map(reps12.map((r, i) => [r, i]));
  const uf = new Int32Array(reps12.length); for (let i = 0; i < uf.length; i++) uf[i] = i;
  const find = x => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) uf[ra] = rb; };
  for (let i = 0; i < reps12.length; i++) { union(i, idxOf.get(partner[reps12[i]])); union(i, idxOf.get(mpart[reps12[i]])); }
  const roots = new Set(); for (let i = 0; i < uf.length; i++) roots.add(find(i));
  check('full 48-group fold = 66,321 pages', roots.size, 66321);
  check('page count consistency: 2·66,321 − 132,315 = 327 self-mirror entries', 2 * roots.size - nHold24, selfMirror);
}
// The tables.js class build, pinned: replicate its ascending orbit sweep
// verbatim (mark the 12 rotation images of s AND of ι(s); first unvisited
// reachable index = rep) and require it to emit EXACTLY the entry reps derived
// independently above from the partner map — this is the "sweep rep = its
// hold-24 orbit minimum = its makeHold24Canon id" claim js/tables.js relies on.
{
  const visited = new Uint8Array(E.NSLOTS);
  const swept = [];
  for (let i = 0; i < E.NSLOTS; i++) {
    if (dist[i] < 0 || visited[i]) continue;
    const s = E.unidx(i), t = iota(s);
    for (const sym of SYMS.rots) { visited[E.idx(sym.apply(s))] = 1; visited[E.idx(sym.apply(t))] = 1; }
    swept.push(i);
  }
  let mismatch = swept.length === entryReps.length ? 0 : -1;
  if (mismatch === 0) for (let i = 0; i < swept.length; i++) if (swept[i] !== entryReps[i]) { mismatch++; }
  check('tables.js sweep replication emits exactly the 132,315 entry reps, ascending', mismatch, 0);
  const h24canon = E.makeHold24Canon(SYMS, dist);
  let badCanon = 0;
  for (let i = 0; i < swept.length; i += 24) if (h24canon(E.unidx(swept[i])) !== swept[i]) badCanon++;
  check('every sampled swept rep equals its own makeHold24Canon id', badCanon, 0);
}
console.log(`  ι stage done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

/* ---------------- the CF subset (centers solved relative to each other) ---------------- */
// E.centersRelSolved: ctr equals one of the 12 tetrad-preserving rotation
// arrangements (the only reachable ones — ctr is always even, re-holds act
// oddly on centers). Feeds the census's CF browse scope (js/oo.js T.cfIdx):
// the predicate must be constant on every hold-24 orbit for rep-testing to
// classify the entry, and mirror-invariant for the badge to agree pair-wide.
t0 = Date.now();
{
  let raw = 0; const rawCF = new Array(12).fill(0);
  for (let i = 0; i < dist.length; i++) {
    if (dist[i] < 0) continue;
    if (E.centersRelSolved(E.unidx(i))) { raw++; rawCF[dist[i]]++; }
  }
  check('raw CF states = 12 × 8,748 = 104,976', raw, 104976);
  check('raw CF per-depth table', rawCF, [1, 0, 0, 0, 72, 360, 2244, 9588, 36103, 53084, 3484, 40]);
  const mir0 = SYMS.mirrors[0];
  let nCF = 0, badOrbit = 0; const cntCF = new Array(12).fill(0);
  for (const r of entryReps) {
    const s = E.unidx(r), t = iota(s);
    const v = E.centersRelSolved(s);
    for (const sym of SYMS.rots) if (E.centersRelSolved(sym.apply(s)) !== v || E.centersRelSolved(sym.apply(t)) !== v) badOrbit++;
    if (E.centersRelSolved(mir0.apply(s)) !== v) badOrbit++;
    if (v) { nCF++; cntCF[dist[r]]++; }
  }
  check('centersRelSolved is invariant across every hold-24 orbit and under mirrors', badOrbit, 0);
  check('CF hold-24 census entries = 4,503', nCF, 4503);
  check('CF per-depth entry table', cntCF, [1, 0, 0, 0, 4, 16, 99, 407, 1533, 2264, 174, 5]);
}
console.log(`  CF stage done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

console.log('');
console.log('RECORD for downstream milestones:');
console.log('  index bound (firestore.rules classId/partnerId/pairId): < ' + E.NSLOTS.toLocaleString());
console.log('  census entries (oo.js copy): 132,315 positions — hold-24 fold (all 24 proper rotations');
console.log('    incl. re-holds); a position and its LR mirror count separately (righty-tuned solutions)');
console.log('  pages (pairId = full 48-group fold, the Firestore query key): 66,321, of which 327 single-side');
console.log('  CF subset (centers relatively solved): 4,503 of the 132,315 entries');
console.log('  fold ladder: 3,149,280 -> 262,674 (12 rots) -> 132,315 (24 rots, THE CENSUS)');
console.log('               vs 131,391 (12 rots + mirrors, pre-2026-07-10) -> 66,321 (all 48, the pages)');
console.log('  RECORD per-depth — depth: hold-24 entries (census) / 12-rot classes / raw states');
for (let d = 0; d < 12; d++)
  console.log('    ' + String(d).padStart(2) + ':  '
    + cntH24[d].toLocaleString().padStart(9) + ' / '
    + cnt12[d].toLocaleString().padStart(9) + ' / '
    + HIST[d].toLocaleString().padStart(11));
console.log(failed ? 'FAILED' : 'ALL CHECKS PASS');
process.exitCode = failed ? 1 : 0;
