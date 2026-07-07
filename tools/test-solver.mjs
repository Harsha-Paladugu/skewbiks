/* Skewbiks.com — solver-core unit tests (M7; physical-model rework 2026-07-07).
 *
 * Asserts the method solver's substrate: the first-step target spaces (counts
 * pinned by the 2026-07-07 machine probe + membership of every imported sheet
 * case), the frame-aware WCA emitter and its physical-execution twin, the
 * PHYSICAL finish index (texts fold their leading rotations into the setup;
 * per text the index holds Φ⁻¹ of the 24 solved orientations; junctions match
 * under 24 rotations from the junction the HUMAN holds), and the search —
 * every emitted solution's method view carries a physical facelet proof, the
 * three USER-validated junction rotations (y' z / y x' / y2 z) are pinned
 * end-to-end, and constructed decompositions must be found.
 *
 * Run: node tools/test-solver.mjs   (exit 0 = OK, 1 = a test failed)
 * Builds the full BFS distance table once (~30 s), like test-trainer.
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
const { makeSolverCore, METHOD_DEFS, METHOD_PRIORITY } = globalThis.window.OOSolverCore;
const algData = JSON.parse(readFileSync(path.join(ROOT, 'data', 'skewb_algs.json'), 'utf8'));

let passed = 0, failed = 0;
function t(name, fn) {
  try {
    const r = fn();
    if (r === false) throw new Error('assertion returned false');
    console.log('✓ ' + name); passed++;
  } catch (e) {
    console.log('✗ ' + name + '\n    ' + (e && e.message)); failed++;
  }
}
const rndInt = n => Math.floor(Math.random() * n);

console.log('building distance table…');
const dist = buildDist(E);
const C = makeSolverCore(E, dist, algData);
const { syms, rotBy } = C;
const IDS = Object.keys(METHOD_DEFS);
const pThen = (P, Q) => Q.map(q => P[q]);           // "apply P, then Q"

/* ---------- target spaces ---------- */
t('method registry: fl/tcll/eg2 with priority order', () => {
  if (JSON.stringify(IDS) !== '["fl","tcll","eg2"]') throw new Error(IDS.join());
  if (JSON.stringify(METHOD_PRIORITY) !== '["fl","tcll","eg2"]') throw new Error('priority');
});
t('D-anchored spaces: 540 fl / 2,160 tcll / 540 eg2, all reachable', () => {
  for (const [id, n] of [['fl', 540], ['tcll', 2160], ['eg2', 540]]) {
    const states = C.dAnchored(id);
    if (states.length !== n) throw new Error(id + ': ' + states.length);
    for (const s of states) if (dist[E.idx(s)] < 0) throw new Error(id + ': unreachable state');
  }
});
t('expanded target maps: 3,110 fl / 11,964 tcll / 3,204 eg2 (12-rotation orbit)', () => {
  for (const [id, n] of [['fl', 3110], ['tcll', 11964], ['eg2', 3204]])
    if (C.targets[id].size !== n) throw new Error(id + ': ' + C.targets[id].size);
});
t('D-anchored predicates: layer pieces as specced per method', () => {
  for (const id of IDS) for (const s of C.dAnchored(id)) {
    if (s.ctr[3] !== 3 || s.fx[2] !== 0 || s.fx[3] !== 0) throw new Error(id + ': layer ctr/axis');
    const twists = [s.fo[2], s.fo[3]].filter(v => v !== 0).length;
    if (id === 'fl' && (s.fp.join('') !== '0123' || twists !== 0)) throw new Error('fl layer dirty');
    if (id === 'tcll' && (s.fp.join('') !== '0123' || twists !== 1)) throw new Error('tcll needs exactly one twist');
    if (id === 'eg2' && (s.fp.join('') !== '1032' || twists !== 0)) throw new Error('eg2 needs the pair swap');
  }
});
t('every imported sheet case sits in its method space (minus 5 known outliers)', () => {
  const subs = { ...(algData.subsets || {}), ...(algData.other_subsets || {}) };
  const expect = { NS: ['fl', 134, 135], EG2: ['eg2', 136, 136], TCLL: ['tcll', 1076, 1080] };
  for (const key of Object.keys(expect)) {
    const [meth, want, total] = expect[key];
    let got = 0, seen = 0;
    for (const c of subs[key].cases) {
      let st = null;
      for (const a of c.algs || []) { st = E.caseStateOf(a.alg); if (st) break; }
      if (!st) continue;
      seen++;
      if (C.targets[meth].has(E.idx(st))) got++;
    }
    if (seen !== total || got !== want) throw new Error(`${key}: ${got}/${seen} (want ${want}/${total})`);
  }
});
t('target faces: solved state carries a face; faces are valid letters', () => {
  const f = C.targets.fl.get(E.idx(E.solved()));
  if (!E.FACES.includes(f)) throw new Error('solved: ' + f);
  for (const id of IDS) for (const face of new Set(C.targets[id].values()))
    if (!E.FACES.includes(face)) throw new Error(id + ': ' + face);
});

/* ---------- emitters + the physical model ---------- */
t('emitWCA at the identity frame == engine nativeToWCA', () => {
  for (let trial = 0; trial < 200; trial++) {
    const mis = []; for (let i = 0; i < 12; i++) mis.push(rndInt(8));
    const mine = C.emitWCA(mis).tokens.join(' ');
    const eng = E.nativeToWCA(mis.map(m => E.MOVES[m]).join(' '));
    if (mine !== eng) throw new Error(mine + ' vs ' + eng);
  }
});
t('ROT24: 24 distinct orientations, identity first, sheet spellings are rotation tokens', () => {
  if (C.ROT24.length !== 24 || C.ROT24[0].spell !== '') throw new Error(C.ROT24.map(r => r.spell).join(','));
  const seen = new Set();
  for (const r of C.ROT24) {
    for (const tok of r.spell.split(/\s+/).filter(Boolean))
      if (!/^[xyz](2'|2|')?$/.test(tok)) throw new Error('not a rotation token: ' + tok);
    seen.add(r.perm.join(','));
  }
  if (seen.size !== 24) throw new Error('duplicate perms: ' + seen.size);
});
t('physical corpus anchor: every imported text solves its identity pre-state physically', () => {
  // physical execution = fixed hand positions + fixed-axis rotations; must end
  // solved (any orientation) from the engine's identity pre-state — this is
  // the semantic bridge between the corpus-validated engine reading and the
  // facelet model (machine-discriminated: the grip-relative alternative
  // passes only 641 of these)
  const subs = { ...(algData.subsets || {}), ...(algData.other_subsets || {}) };
  let checked = 0;
  for (const key of Object.keys(subs)) for (const c of subs[key].cases || [])
    for (const a of c.algs || []) {
      const toks = E.parseAlg(E.preprocessAlg(a.ns || a.alg), 'ns');
      if (!toks) continue;
      const sT = E.inverseState(E.applyParsed(toks, E.solved(), syms, rotBy));
      const end = C.pApply(E.toFacelets(sT), C.physPerm(toks));
      if (!C.SOLVED24_KEYS.has(C.flKey(end))) throw new Error('not solved physically: ' + (a.ns || a.alg));
      checked++;
    }
  if (checked !== 3082) throw new Error('checked ' + checked + ' texts (want 3082)');
});
t('emitPhysPerm == physical execution of the DISPLAYED step; walkIdxOf factors it', () => {
  const NS_OF_AXIS = { UBR: 'B', DBL: 'l', DFR: 'r', UFL: 'F' };
  const NATIVE_AXIS = ['UBR', 'UBR', 'DBL', 'DBL', 'DFR', 'DFR', 'UFL', 'UFL'];
  for (let trial = 0; trial < 200; trial++) {
    const mis = []; for (let i = 0; i < 1 + rndInt(7); i++) mis.push(rndInt(8));
    const emitted = C.emitPhysPerm(mis);
    // (a) equals physPerm of the parsed displayed NS text
    const nsText = E.wcaToNS(C.emitWCA(mis).tokens.join(' '));
    const viaText = C.physPerm(E.parseAlg(E.preprocessAlg(nsText), 'ns'));
    if (emitted.join(',') !== viaText.join(',')) throw new Error('emitPhysPerm != displayed-text physPerm');
    // (b) equals the native physical perm followed by the walk rotation
    const natText = mis.map(m => NS_OF_AXIS[NATIVE_AXIS[m]] + ((m & 1) ? "'" : '')).join(' ');
    const nat = C.physPerm(E.parseAlg(natText, 'ns'));
    const rhs = pThen(nat, C.ROT24[C.walkIdxOf(mis)].perm);
    if (emitted.join(',') !== rhs.join(',')) throw new Error('walk factorization fails');
  }
});

/* ---------- the physical finish index (leading rotations folded) ---------- */
t('foldLeadRots: cuts plain leading rotations; grouped/odd texts fall back untouched', () => {
  const cases = [
    ["x z' R B r'", "R B r'"],
    ["y B2' F r", "B2' F r"],       // preprocess rewrite kept authored in the body
    ["R B r'", "R B r'"],           // no leading rotations
    ["z x y2 y", "z x y2 y"],       // all rotations
    ["y (r b' r')", "y (r b' r')"], // grouping chars: never cut (post-review guard)
    ["[y2] r b' r'", "[y2] r b' r'"],
  ];
  for (const [inp, want] of cases) {
    const toks = E.parseAlg(E.preprocessAlg(inp), 'ns');
    if (!toks) throw new Error('fixture does not parse: ' + inp);
    const got = C.foldLeadRots(inp, toks).ns;
    if (got !== want) throw new Error(`"${inp}" -> "${got}" (want "${want}")`);
  }
});
t('alg index: 65,640 pre-states / 73,968 entries; texts lead with a turn; entries re-prove physically', () => {
  const idx = C.algIndex();
  if (idx.size !== 65640) throw new Error('size ' + idx.size);
  let entries = 0; for (const l of idx.values()) entries += l.length;
  if (entries !== 73968) throw new Error('entries ' + entries);
  const keys = [...idx.keys()];
  for (let trial = 0; trial < 200; trial++) {
    const k = keys[rndInt(keys.length)];
    const arr = k.split('').map(Number);
    for (const row of idx.get(k)) {
      // by construction: the body's physical perm solves this pre-state
      if (!C.SOLVED24_KEYS.has(C.flKey(C.pApply(arr, row.phi)))) throw new Error('entry does not solve: ' + row.ns);
      const toks = E.parseAlg(E.preprocessAlg(row.ns), 'ns');
      if (row.moves > 0 && (!toks || toks[0].kind === 'rot')) throw new Error('indexed text leads with a rotation: ' + row.ns);
      if (!row.preKeys.has(k)) throw new Error('row.preKeys misses its own key');
    }
  }
});
t('physical-finish coverage over the method spaces: 2733/3110 fl, 10392/11964 tcll, 3180/3204 eg2', () => {
  // measured under the physical model 2026-07-07 (identical counts to the old
  // engine-frame index — the match RELATION agreed; the printed rotations did
  // not). Update deliberately when the alg data changes.
  const idx = C.algIndex();
  for (const [id, want, total] of [['fl', 2733, 3110], ['tcll', 10392, 11964], ['eg2', 3180, 3204]]) {
    let cov = 0;
    const seen = new Set();
    for (const st of C.dAnchored(id)) for (const rot of syms.rots) {
      const s = rot.apply(st);
      const k = E.stateKey(s);
      if (seen.has(k)) continue;
      seen.add(k);
      const jArr = E.toFacelets(s);
      for (const r of C.ROT24) if (idx.has(C.flKey(C.pApply(jArr, r.perm)))) { cov++; break; }
    }
    if (seen.size !== total || cov !== want) throw new Error(`${id}: ${cov}/${seen.size}`);
  }
});

/* ---------- search: soundness (every emitted view proves physically) ---------- */
const FIXTURES = [
  "L R L U' B R' U' R' L R B",   // KPW 2015 official final
  "R U' B L' U R' B'",
  "B U L R' U' B' L R",
  "U L R B U' R' B' L'",
];
const NS_BODIES = (() => {  // display-membership oracle: every shipped text's token
  const s = new Set();      // stream AFTER its leading rotations (independent fold)
  const subs = { ...(algData.subsets || {}), ...(algData.other_subsets || {}) };
  for (const key of Object.keys(subs)) for (const c of subs[key].cases || [])
    for (const a of c.algs || []) {
      const p = E.parseAlg(E.preprocessAlg(a.ns || a.alg), 'ns');
      if (!p) continue;
      let i = 0;
      while (i < p.length && p[i].kind === 'rot') i++;
      s.add(JSON.stringify(i < p.length ? p.slice(i) : p));
    }
  return s;
})();
const runFixture = (scr) => {
  const state = E.applyParsed(E.parseAlg(scr), E.solved(), syms, rotBy);
  const res = C.search(state, { methods: { fl: true, tcll: true, eg2: true }, caps: {} });
  return { state, dopt: dist[E.idx(state)], res };
};
t('fixtures: solutions exist, none truncated', () => {
  for (const scr of FIXTURES) {
    const { res } = runFixture(scr);
    if (res.truncated) throw new Error(scr + ': truncated');
    if (!Object.values(res.byLength).some(items => items.length)) throw new Error(scr + ': no solutions');
  }
});
t('fixtures: every solution proves physically; algebra holds; alg text is a sheet body', () => {
  for (const scr of FIXTURES) {
    const { state, res } = runFixture(scr);
    for (const [L, items] of Object.entries(res.byLength)) for (const it of items) {
      if (it.total !== +L || it.v + it.fin !== it.total) throw new Error('bucket algebra');
      if (it.v !== it.pmoves.length) throw new Error('v vs pmoves');
      if (it.v > METHOD_DEFS[it.id].cap) throw new Error('over cap ' + it.id);
      const mv = C.methodView(state, it);
      if (!mv || !mv.ok) throw new Error('method view fails: ' + it.id + ' total ' + L);
      if (it.row) {
        if (mv.alg !== it.row.ns) throw new Error('alg text differs from the indexed row');
        const p = E.parseAlg(E.preprocessAlg(mv.alg), 'ns');
        if (!p || p[0].kind === 'rot') throw new Error('alg text still leads with a rotation: ' + mv.alg);
        if (!NS_BODIES.has(JSON.stringify(p))) throw new Error('alg text is not a sheet body: ' + mv.alg);
        if (E.countMoves(E.parseAlg(E.preprocessAlg(mv.text), 'ns')) !== it.total) throw new Error('text movecount');
        if (mv.rot !== C.ROT24[it.rotIdx].spell) throw new Error('rot spelling mismatch');
      } else {
        if (it.fin !== 0 || mv.rot || mv.alg) throw new Error('solved junction shape');
      }
    }
  }
});

/* ---------- the USER-validated junction rotations (2026-07-07) ---------- */
// Three physically-executed data points from the site owner; the old
// engine-frame derivation got #2 wrong ("y x") and pre-fix #1 read "y x".
t('USER fixture 1: "B\' l r l\' b r l" + Pi Triple Sledge 135 prints rotation "y\' z"', () => {
  const L1 = "B' l r l' b r l y x r' R r R'";        // the engine-letter line of the original report
  const scr = E.inverseState(E.applyParsed(E.parseAlg(E.preprocessAlg(L1), 'ns'), E.solved(), syms, rotBy));
  const res = C.search(scr, { methods: { fl: true, tcll: true, eg2: true }, caps: {} });
  for (const items of Object.values(res.byLength)) for (const it of items) {
    if (!it.row) continue;
    const mv = C.methodView(scr, it);
    if (E.wcaToNS(mv.vmoves) === "B' l r l' b r l" && mv.alg === "r' R r R'") {
      if (mv.rot !== "y' z") throw new Error('rot "' + mv.rot + '" (want "y\' z")');
      if (!mv.ok) throw new Error('does not verify');
      return;
    }
  }
  throw new Error('solution not found');
});
t('USER fixture 2: "l r" + TCLL BST- BL S1 prints rotation "y x\'"', () => {
  const scr = E.keyToState('015432|30212220|0022');  // machine-derived from the user's junction
  const res = C.search(scr, { methods: { fl: true, tcll: true, eg2: true }, caps: {} });
  for (const items of Object.values(res.byLength)) for (const it of items) {
    if (!it.row || it.pmoves.join(',') !== '2,4' || it.row.ns !== "R' B' r' R r R B R'") continue;
    const mv = C.methodView(scr, it);
    if (mv.rot !== "y x'") throw new Error('rot "' + mv.rot + '" (want "y x\'")');
    if (!mv.ok) throw new Error('does not verify');
    return;
  }
  throw new Error('solution not found');
});
t('USER fixture 3: Pi Triple Sledge 136 junction prints rotation "y2 z"', () => {
  const J3 = E.keyToState('415302|01230210|0201');   // machine-derived fl junction
  const scr = E.copy(J3);
  E.applyMoveIdx(scr, 3); E.applyMoveIdx(scr, 1);    // scr = J3 minus the path [0, 2]
  const res = C.search(scr, { methods: { fl: true, tcll: true, eg2: true }, caps: {} });
  for (const items of Object.values(res.byLength)) for (const it of items) {
    if (!it.row || it.pmoves.join(',') !== '0,2' || it.row.ns !== "R r' R' r") continue;
    const mv = C.methodView(scr, it);
    if (mv.rot !== 'y2 z') throw new Error('rot "' + mv.rot + '" (want "y2 z")');
    if (!mv.ok) throw new Error('does not verify');
    return;
  }
  throw new Error('solution not found');
});

/* ---------- search: completeness (constructed decompositions are found) ---------- */
t('constructed first-step + sheet-alg decompositions are found (50 randomized)', () => {
  const idx = C.algIndex();
  // per method: target states with at least one physical finish, + a matching row
  const perMethod = {};
  for (const id of IDS) {
    perMethod[id] = [];
    for (const ix of C.targets[id].keys()) {
      const jArr = E.toFacelets(E.unidx(ix));
      for (const r of C.ROT24) {
        const list = idx.get(C.flKey(C.pApply(jArr, r.perm)));
        if (list) { perMethod[id].push({ ix, row: list[0] }); break; }
      }
      if (perMethod[id].length >= 400) break;
    }
  }
  let done = 0, tries = 0;
  while (done < 50 && ++tries < 600) {
    const id = IDS[rndInt(3)];
    const pool = perMethod[id];
    const pick = pool[rndInt(pool.length)];
    const j = E.unidx(pick.ix);
    // P = a short reversed random walk (no same-axis neighbours) ending at j
    const n = 1 + rndInt(3);
    const P = [];
    let last = -1;
    for (let i = 0; i < n; i++) { let m; do { m = rndInt(8); } while ((m >> 1) === last); last = m >> 1; P.push(m); }
    const scr = E.copy(j);
    for (let i = P.length - 1; i >= 0; i--) E.applyMoveIdx(scr, P[i] ^ 1);
    if (dist[E.idx(scr)] === 0 || P.length > METHOD_DEFS[id].cap) continue;
    const total = P.length + pick.row.moves;
    const res = C.search(scr, { methods: { [id]: true }, caps: {} });
    const hit = (res.byLength[total] || []).some(it =>
      it.pmoves.join(',') === P.join(',') && it.row && it.row.uid === pick.row.uid);
    if (!hit) throw new Error(`${id}: missing P=${P.join(',')} + ${pick.row.ns}`);
    done++;
  }
  if (done < 50) throw new Error('only ' + done + ' constructions in ' + tries + ' tries');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
