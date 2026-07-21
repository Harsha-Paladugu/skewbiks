/* Skewbiks.com — trainer substrate tests (src/trainer/skewb-core.mjs).
 *
 * Asserts the M6 trainer's math against the shared engine: the case model over
 * data/skewb_algs.json (counts, presentation geometry, direction synthesis),
 * masked scrambles (correctness + length window), the first-layer predicate +
 * goal seeds + goal-distance table, and the one-look samplers.
 *
 * Run: node tools/test-trainer.mjs   (exit 0 = OK, 1 = a test failed)
 * Heavier than test-engine: builds TWO full-space BFS tables (dist + FL-dist).
 */
import { buildDist } from './lib/bfs-dist.mjs';
import { loadEngine, loadSolverCore, loadAlgData } from './lib/load-engine.mjs';
import { t, finish, rndInt } from './lib/harness.mjs';

const E = loadEngine();

const { createCore, DIRS, Y_PREFIX, SOL_EXAMPLES } = await import('../src/trainer/skewb-core.mjs');
const core = createCore(E);

const ROTBY = E.makeFrames(null);
const applyWca = (alg, st) => E.applyParsed(E.parseAlg(E.preprocessAlg(alg)), st, null, ROTBY);

// ---------------- case model ----------------
const JSON_DATA = loadAlgData();
const model = core.buildModel(JSON_DATA);

t('model: empty subsets skipped, imported three present', () => {
  const keys = model.subsets.map((s) => s.key);
  return keys.length === 3 && keys.includes('NS') && keys.includes('EG2') && keys.includes('TCLL');
});
t('model: keeps every case and alg the JSON carries', () => {
  const jsonCases = Object.values(JSON_DATA.subsets).reduce((a, s) => a + s.cases.length, 0);
  const jsonAlgs = Object.values(JSON_DATA.subsets).reduce((a, s) => a + s.cases.reduce((b, c) => b + c.algs.length, 0), 0);
  const cases = model.subsets.reduce((a, s) => a + s.cases.length, 0);
  const algs = model.subsets.reduce((a, s) => a + s.cases.reduce((b, c) => b + c.algs.length, 0), 0);
  return jsonCases > 0 && cases === jsonCases && algs === jsonAlgs;
});
t('model: nav groups partition every subset (no strays)', () =>
  model.subsets.every((s) =>
    s.groups.reduce((a, g) => a + g.cases.length, 0) === s.cases.length &&
    !s.groups.some((g) => g.label === 'Other')));
t('model: caseOfState resolves every presentation to (case, dir); solved is a sentinel', () => {
  const sub = model.subsets[0];
  const c = sub.cases.find((x) => core.casePres(x).ok);
  const cp = core.casePres(c);
  const a0 = DIRS.indexOf(cp.anchorDir);
  for (let p = 0; p < 4; p++) {
    const hit = core.caseOfState(model, E.keyToState(cp.pks[p]));
    if (!hit || hit.c !== c || hit.d !== (p + a0) % 4 || hit.subset !== sub.key) return false;
  }
  if (!core.caseOfState(model, E.solved()).solved) return false;
  return core.caseOfState(model, null) === null;
});
t('model: navSorted orders EG2 by the authored id order', () => {
  const eg2 = model.subsets.find((s) => s.key === 'EG2');
  const sorted = core.navSorted(eg2, eg2.groups[0].cases);
  const order = eg2.nav.sort.order; // ['U','FL','FR','BR','BL']
  const ids = sorted.map((c) => order.indexOf(c[eg2.nav.sort.field]));
  return ids.every((v, i) => i === 0 || ids[i - 1] <= v);
});

// ---------------- persistence descriptor ----------------
t('persistence: readStoredState matches the legacy field-by-field reader', () => {
  const blob = JSON.stringify({
    subsetSel: ['NS', 7, 'EG2'], groupSel: { NS: ['x'] }, caseOff: ['a', 1, 'b'],
    caseKnown: ['k0'], scope: 'learning', mode: 'onelook', setupOpen: false,
    caseStats: { u: { n: 2, sum: 9 }, bad: { n: 'x' } },
    recogStats: { r: { n: 1, hit: 1 }, junk: {} },
    centersStats: { c: { n: 3, hit: 2 } },
    onelookStats: { o: { n: 4, hit: 0 } },
    recogView: 'centers', centerSel: ['U', 'Q', 'R', 'F', 'B'], cornersOn: true,
    onelookView: 'sol', onelookLen: 3,
    onelookSol: { raw: "r' b l", nota: 'ns' },       // pre-list legacy field
    stray: 'ignored', dirSel: 'legacy',
  });
  const p = core.readStoredState(blob);
  if (JSON.stringify(p.subsetSel) !== '["NS","EG2"]') return false;
  if (!(p.caseOff instanceof Set) || [...p.caseOff].join() !== 'a,b') return false;
  if (p.scope !== 'learning' || p.mode !== 'onelook' || p.setupOpen !== false) return false;
  if (JSON.stringify(p.caseStats) !== '{"u":{"n":2,"sum":9}}') return false;
  if (JSON.stringify(p.recogStats) !== '{"r":{"n":1,"hit":1}}') return false;
  if (JSON.stringify(p.centersStats) !== '{"c":{"n":3,"hit":2}}') return false;
  if (JSON.stringify(p.onelookStats) !== '{"o":{"n":4,"hit":0}}') return false;
  if (JSON.stringify(p.centerSel) !== '["U","R","F"]') return false;
  if (p.recogView !== 'centers' || p.cornersOn !== true) return false;
  if (p.onelookLen !== 3 || p.onelookView !== 'sol') return false;
  if (JSON.stringify(p.onelookSols) !== JSON.stringify([{ raw: "r' b l", nota: 'ns', on: true }])) return false;
  if ('stray' in p || 'dirSel' in p) return false;
  const junk = core.readStoredState('not json');
  return junk && Object.keys(junk).length === 0;
});
t('persistence: write -> read round-trips every field', () => {
  const vals = { subsetSel: ['NS'], groupSel: {}, caseOff: new Set(['a']), caseKnown: new Set(['b0']),
    scope: 'all', mode: 'drill', setupOpen: true, caseStats: {}, recogStats: {}, centersStats: {},
    recogView: 'full', centerSel: ['U', 'R', 'F'], cornersOn: false, onelookView: 'len', onelookLen: 2,
    onelookSols: [{ raw: 'r', nota: 'ns', on: true }], onelookStats: {} };
  if (core.PERSIST_KEYS.length !== 17 || !core.PERSIST_KEYS.every((k) => k in vals)) return false;
  const p = core.readStoredState(JSON.stringify(core.writeStoredState(vals)));
  return p.caseOff instanceof Set && p.caseOff.has('a') && p.caseKnown.has('b0') &&
    p.mode === 'drill' && p.onelookSols.length === 1 &&
    JSON.stringify(core.STAT_RESET) === '{"caseStats":{},"recogStats":{},"centersStats":{},"onelookStats":{}}';
});

// sample cases spread across the subsets for the geometry tests
const SAMPLE = [];
for (const s of model.subsets) {
  for (let i = 0; i < 10; i++) SAMPLE.push(s.cases[rndInt(s.cases.length)]);
}

t('casePres: anchors parse; 4 states; ≤2 canons; Front/Back + Right/Left pair', () =>
  SAMPLE.every((c) => {
    const cp = core.casePres(c);
    if (!cp.ok) return false;
    return cp.states.length === 4 && cp.canons.length <= 2 &&
      E.realCanonKey(cp.states[0]) === E.realCanonKey(cp.states[2]) &&
      E.realCanonKey(cp.states[1]) === E.realCanonKey(cp.states[3]);
  }));
t('casePres: every case in the sheet has a usable anchor', () =>
  model.subsets.every((s) => s.cases.every((c) => core.casePres(c).ok)));
t('algsForDir: prependAUF(k, core) solves the shown state, all 4 directions', () =>
  SAMPLE.slice(0, 12).every((c) => [0, 1, 2, 3].every((d) => {
    const st = core.stateForDir(c, d);
    const rows = core.algsForDir(c, d);
    if (!st || !rows.length) return false;
    const r = rows[0];
    const alg = r.k ? E.prependAUF(r.k, r.core) : r.core;
    return E.algSolvesKey(alg, E.stateKey(st));
  })));
t('y² view: stateForDir(d+2) is the y²-sym image of stateForDir(d)', () => {
  const y2 = E.symFromFacePerm({ U: 'U', D: 'D', F: 'B', B: 'F', R: 'L', L: 'R' }, false);
  return SAMPLE.slice(0, 12).every((c) => {
    const a = core.stateForDir(c, 0), b = core.stateForDir(c, 2);
    return E.stateKey(y2.apply(a)) === E.stateKey(b);
  });
});
t('firstMoveOf: agrees with the imported firstMove field on a sample', () =>
  SAMPLE.every((c) => {
    const rows = core.algsForDir(c, 0).filter((r) => r.a.firstMove && !r.a.suspect);
    return rows.every((r) => core.firstMoveOf({ ...r, a: { ...r.a, firstMove: null } }) === r.a.firstMove
      || r.a.firstMoveSheet !== undefined); // known import disagreements carry firstMoveSheet
  }));

// ---------------- distance table + scrambles ----------------
console.log('building dist table (full-space BFS)…');
const dist = buildDist(E);

t('randomReachable: samples land on reachable states', () => {
  for (let i = 0; i < 20; i++) if (dist[E.idx(core.randomReachable(dist))] < 0) return false;
  return true;
});
t('masked scramble: solves to the exact target state (30 case×dir samples)', () => {
  for (let i = 0; i < 30; i++) {
    const c = SAMPLE[rndInt(SAMPLE.length)];
    const st = core.stateForDir(c, rndInt(4));
    const scr = core.maskedScramble(st, dist);
    if (!scr) return false;
    const got = applyWca(scr, E.solved());
    if (E.stateKey(got) !== E.stateKey(st)) return false;
  }
  return true;
});
t('masked scramble: length window [9,12] hit on ≥80% of 60 samples, never >12', () => {
  let inWin = 0;
  for (let i = 0; i < 60; i++) {
    const c = SAMPLE[rndInt(SAMPLE.length)];
    const scr = core.maskedScramble(core.stateForDir(c, rndInt(4)), dist);
    const n = scr.split(/\s+/).length;
    if (n > core.MASK_MAX) return false;
    if (n >= core.MASK_MIN) inWin++;
  }
  return inWin >= 48;
});
t('masked scramble: solved target falls back to a valid (possibly short) scramble', () => {
  const scr = core.maskedScramble(E.solved(), dist);
  return scr !== null && E.stateKey(applyWca(scr || 'R R\'', E.solved())) === E.stateKey(E.solved());
});

// ---------------- first layer ----------------
t('layer predicate: solved state has all 6 layers', () =>
  E.FACES.every((f) => core.layerSolved(E.solved(), f)));
t('layer predicate: any single native move breaks every layer', () => {
  for (let mi = 0; mi < 8; mi++) {
    const s = E.solved(); E.applyMoveIdx(s, mi);
    if (core.anyLayerSolved(s)) return false;
  }
  return true;
});
t('layer seeds: 540 per face, each satisfying its own predicate', () =>
  E.FACES.every((f) => {
    const pool = E.enumFreeSlots(core.layerSeedSpec(f));
    return pool.length === 540 && pool.every((st) => core.layerSolved(st, f));
  }));
t('layer seeds: union is deduped, reachable, and contains solved', () => {
  const seeds = core.flSeedIndices();
  return new Set(seeds).size === seeds.length &&
    seeds.every((ix) => dist[ix] >= 0) &&
    seeds.includes(E.idx(E.solved()));
});

console.log('building FL goal-distance table (multi-source BFS)…');
const fldist = await core.buildFLDist();

t('fldist: zero exactly on layer-solved states (sampled)', () => {
  if (fldist[E.idx(E.solved())] !== 0) return false;
  for (let i = 0; i < 200; i++) {
    const st = core.randomReachable(dist);
    const z = fldist[E.idx(st)] === 0;
    if (z !== !!core.anyLayerSolved(st)) return false;
  }
  return true;
});
t('fldist: covers the reachable space, max depth sane (≤ 11)', () => {
  let max = 0;
  for (let i = 0; i < E.NSLOTS; i++) {
    if ((dist[i] >= 0) !== (fldist[i] >= 0)) return false;
    if (fldist[i] > max) max = fldist[i];
  }
  console.log('    (max FL distance = ' + max + ')');
  return max > 0 && max <= 11;
});
t('descend(fldist) reaches a layer-solved state in exactly fldist moves', () => {
  for (let i = 0; i < 10; i++) {
    const st = core.randomReachable(dist);
    const r = core.descend(st, fldist);
    if (!r || r.moves.length !== fldist[E.idx(st)] || !core.anyLayerSolved(r.end)) return false;
  }
  return true;
});

// ---------------- one-look ----------------
t('one-look: randomAtFLDist lands on the exact FL distance for every n 0..6', () => {
  for (let n = 0; n <= 6; n++) {
    const st = core.randomAtFLDist(fldist, n);
    if (!st || fldist[E.idx(st)] !== n || dist[E.idx(st)] < 0) return false;
  }
  return true;
});
// The one-look 'sol' claims are PHYSICAL ("run your sequence on the cube in
// hand, the layer lands on the bottom"), so they are asserted against the
// solver-core facelet oracle (TNoodle-anchored physPerm/physPermNS +
// heldFacelets — the cube in hand after a scramble TEXT differs from raw
// toFacelets by the text's absorbed free-corner rotations). USER-falsified
// 2026-07-13: the old engine-frame preimage made the solution "U" need a
// physical L with the layer landing off-bottom whenever the draw carried a
// UFL walk digit — these tests fail against that construction.
const SC = loadSolverCore().makeSolverCore(E, dist, JSON_DATA);
const parseWca = (s) => E.parseAlg(E.preprocessAlg(s));
const parseNs = (s) => E.parseAlg(E.preprocessAlg(s), 'ns');
const flKey = SC.flKey; // the oracle's own facelet key — one definition

t('one-look: randomDLayerState samples reachable D-solved states, UFL pristine', () => {
  const ufl = E.AXIS.indexOf('UFL');
  for (let i = 0; i < 40; i++) {
    const st = core.randomDLayerState();
    if (!core.layerSolved(st, 'D') || dist[E.idx(st)] < 0 || st.fx[ufl] !== 0) return false;
  }
  return true;
});
t('one-look: physPermOf rejects rotation tokens and UFL-side NS letters', () => {
  const CASES = [
    ['wca', 'x U', 'rot'], ['wca', 'U y2', 'rot'],
    ['ns', 'F', 'ufl'], ['ns', 'R', 'ufl'], ['ns', 'L', 'ufl'], ['ns', "f' b", 'ufl'],
  ];
  return CASES.every(([nota, s, err]) => {
    const p = nota === 'ns' ? parseNs(s) : parseWca(s);
    return p && core.physPermOf(p).err === err;
  });
});
t('one-look: the SOL_EXAMPLES placeholders pass their own input guard', () => {
  return ['ns', 'wca'].every((nota) => {
    const p = nota === 'ns' ? parseNs(SOL_EXAMPLES[nota]) : parseWca(SOL_EXAMPLES[nota]);
    return p && p.some((tk) => tk.kind === 'move') && !core.physPermOf(p).err;
  });
});
t('one-look: PHYSICAL execution from the held scramble lands raw(Y), D layer on the bottom', () => {
  const SEQS = [
    ['wca', 'U'], ['wca', 'B'], ['wca', "B' U"], ['wca', "U B U'"], ['wca', 'R U B'],
    ['ns', 'b'], ['ns', 'r'], ['ns', 'B r b'], ['ns', "b' r B'"],
  ];
  for (const [nota, s] of SEQS) {
    const parsed = nota === 'ns' ? parseNs(s) : parseWca(s);
    const { phi } = core.physPermOf(parsed);
    if (!phi) return false;
    const oracle = nota === 'ns' ? SC.physPermNS(parsed) : SC.physPerm(parsed);
    if (flKey(phi) !== flKey(oracle)) return false; // trainer perm == solver-core reading
    for (let i = 0; i < 12; i++) {
      const Y = core.randomDLayerState();
      const X = core.preimageOfLayer(phi, Y, dist);
      if (!X) return false;
      const scr = core.maskedScramble(X, dist);
      if (scr == null) return false;
      const held = SC.heldFacelets(parseWca(scr || "R R'")); // '' only if X = solved
      if (flKey(held) !== flKey(E.toFixedFacelets(X))) return false; // held-frame bridge
      const end = SC.pApply(held, oracle);
      if (flKey(end) !== flKey(E.toFacelets(Y))) return false; // exactly raw(Y) in hand
      if (!core.layerSolved(E.fromFacelets(end), 'D')) return false;
    }
  }
  return true;
});

// Every trainer case diagram is caseSVG on the RAW pinned facelets — the
// algs-page picture, no solver-core in the bundle. Valid because every state
// the trainer shows through it is D-anchored in the raw frame, pinned here
// against the solver-core picture oracle (layerDownFacelets): the drill stage
// and both stats grids draw d = 0, recognition coin-flips d = 0/2 — sole
// exception "TCLL Twoface- U solved", off-anchor in every frame — and
// one-look end states are D-solved raw by construction. The d = 1/3 views
// are NOT all D-anchored (143 TCLL cases rotate): the drill stats grid must
// keep pinning d = 0 for its legacy directional rows.
t('diagrams: d=0/2 case states D-anchored raw (sole exception Twoface- U solved); d=1/3 are not all', () => {
  const rotated = [[], [], [], []];
  for (const s of model.subsets) for (const c of s.cases) for (let d = 0; d < 4; d++) {
    const st = core.stateForDir(c, d);
    if (!st) return false;
    const pic = SC.layerDownFacelets(st);
    if (pic.rotated) rotated[d].push(c.name);
    else if (flKey(pic.fl) !== flKey(E.toFacelets(st))) return false;
  }
  return rotated[0].length === 1 && rotated[0][0] === 'Twoface- U solved' &&
    rotated[2].length === 1 && rotated[2][0] === 'Twoface- U solved' &&
    rotated[1].length === 143 && rotated[3].length === 143;
});
t('diagrams: one-look end states are D-anchored raw (sheet picture = cube in hand)', () => {
  for (let i = 0; i < 60; i++) {
    const Y = core.randomDLayerState();
    const pic = SC.layerDownFacelets(Y);
    if (pic.rotated || flKey(pic.fl) !== flKey(E.toFacelets(Y))) return false;
  }
  return true;
});

t('exports: DIRS/Y_PREFIX shapes', () =>
  DIRS.length === 4 && Y_PREFIX.length === 4 && Y_PREFIX[0] === '' && Y_PREFIX[2] === 'y2');

// ---------------- partial (3+2) recognition ----------------
// (masks are raw sticker indices: every case diagram renders the raw pinned
// facelets — caseSVG(E.toFacelets(st)), the algs-page picture — so raw
// position == display position)
t('pickCorners: 2 distinct upper corners', () => {
  for (let i = 0; i < 50; i++) {
    const v = core.pickCorners();
    if (v.length !== 2 || new Set(v).size !== 2) return false;
    if (!v.every((c) => core.RECOG_CORNERS.includes(c))) return false;
  }
  return true;
});
t('maskForView: FL + 3 centers hides 14; +2 corners hides 8', () => {
  const cases = model.subsets.flatMap((s) => s.cases);
  for (let i = 0; i < 40; i++) {
    const st = core.stateForDir(cases[rndInt(cases.length)], rndInt(4));
    const v3 = { centers: ['U', 'F', 'L'], corners: [], fl: true };
    if (core.maskForView(st, v3).size !== 14) return false;
    const v5 = { centers: ['U', 'F', 'L'], corners: core.pickCorners(), fl: true };
    if (core.maskForView(st, v5).size !== 8) return false;
  }
  return true;
});
t('maskForView: the visible stickers are exactly the view’s pieces’ raw stickers', () => {
  const FIDX = Object.fromEntries(E.FACES.map((f, i) => [f, i]));
  const FL_CORNERS = ['DFR', 'DBL', 'DFL', 'DBR'];
  for (let i = 0; i < 30; i++) {
    const c = SAMPLE[rndInt(SAMPLE.length)];
    const st = core.stateForDir(c, rndInt(4));
    const view = { centers: ['R', 'B', 'U'], corners: core.pickCorners(), fl: true };
    const mask = core.maskForView(st, view);
    const rawVisible = new Set([FIDX.D * 5]);
    for (const f of view.centers) rawVisible.add(FIDX[f] * 5);
    for (const k of [...view.corners, ...FL_CORNERS]) for (const g of E.FACES) {
      const ix = E.STICKER_POS[g].indexOf(k);
      if (ix >= 0) rawVisible.add(FIDX[g] * 5 + 1 + ix);
    }
    for (let p = 0; p < 30; p++) {
      if (rawVisible.has(p) === mask.has(p)) return false; // visible <-> not masked
    }
  }
  return true;
});
t('viewSignature: reads the FL residue iff fl is set; visible centers matter', () => {
  const flView = { centers: ['U', 'R', 'F'], corners: [], fl: true };
  const noFl = { centers: ['U', 'R', 'F'], corners: [], fl: false };
  const a = E.solved();
  const b = E.copy(a); b.fx[2] = 1; // twist DFR (an FL corner)
  if (core.viewSignature(a, flView) === core.viewSignature(b, flView)) return false;
  if (core.viewSignature(a, noFl) !== core.viewSignature(b, noFl)) return false;
  const c = E.copy(a); [c.ctr[1], c.ctr[4]] = [c.ctr[4], c.ctr[1]]; // swap R and L centers
  if (core.viewSignature(a, flView) === core.viewSignature(c, flView)) return false; // R visible
  const d2 = E.copy(a); [d2.ctr[4], d2.ctr[5]] = [d2.ctr[5], d2.ctr[4]]; // swap L and B (both hidden)
  return core.viewSignature(a, flView) === core.viewSignature(d2, flView);
});
t('centers quiz premise: NS center case is determined by FL + any 3 centers', () => {
  const ns = model.subsets.find((s) => s.key === 'NS');
  const quiz = ns.cases.filter((c) => c.centerPattern);
  const combos = [];
  const C = core.RECOG_CENTERS;
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 4; b++) for (let c = b + 1; c < 5; c++)
    combos.push([C[a], C[b], C[c]]);
  let worst = 1;
  for (const centers of combos) {
    const view = { centers, corners: [], fl: true };
    const bySig = new Map();
    for (const c of quiz) {
      for (const d of [0, 1, 2, 3]) {
        const s = core.viewSignature(core.stateForDir(c, d), view);
        if (!bySig.has(s)) bySig.set(s, new Set());
        bySig.get(s).add(c.centerPattern);
      }
    }
    let pure = 0, total = 0;
    for (const pats of bySig.values()) { total++; if (pats.size === 1) pure++; }
    worst = Math.min(worst, pure / total);
  }
  console.log('    (worst 3-center combo: ' + (100 * worst).toFixed(1) + '% of views pattern-pure)');
  return worst >= 0.5; // informational floor — ambiguity is reported in-app per round
});

// ---------------- center-case quiz answers ----------------
// (machine-verified 2026-07-13: the sheets' center labels are a pure function
// of the center perm for EG2 and NS — after splitting NS's lumped H-or-Z rows
// — but NOT for TCLL, whose labels also encode twist/pseudo context)
const subEG2 = model.subsets.find((s) => s.key === 'EG2');
const subNS = model.subsets.find((s) => s.key === 'NS');
const subTC = model.subsets.find((s) => s.key === 'TCLL');
const byName = (sub, name) => sub.cases.find((c) => c.name === name);

t('quiz answers: EG2 + NS vocabularies are sig-pure over all 60 center perms', () => {
  const e = core.centerVocab(subEG2), n = core.centerVocab(subNS);
  return e.pure && e.map.size === 60 && n.pure && n.map.size === 60;
});
const foldEG2 = (l) => {
  if (/^U[12][lfrb]?$/.test(l)) return 'U';
  const m = /^(ZC|TS|[OSWXZ])[12]$/.exec(l);
  return m ? m[1] : l;
};
t('quiz answers: EG2 answers are the authored labels with the U family and numbered pairs folded', () =>
  subEG2.cases.filter((c) => c.corner !== 'L5C')
    .every((c) => core.quizAnswer(subEG2, c) === foldEG2(c.center)));
t('quiz answers: EG2 vocabulary is exactly the 10 folded options', () => {
  const opts = new Set(core.centerVocab(subEG2).map.values());
  const want = ['H', 'O', 'S', 'skip', 'TS', 'U', 'W', 'X', 'Z', 'ZC'];
  return opts.size === want.length && want.every((l) => opts.has(l));
});
t('quiz answers: EG2 L5C resolves into the Pi/Peanut vocabulary (no new options)', () => {
  const l5c = subEG2.cases.filter((c) => c.corner === 'L5C');
  const vocab = new Set(subEG2.cases.filter((c) => c.corner !== 'L5C').map((c) => core.quizAnswer(subEG2, c)));
  if (!l5c.every((c) => vocab.has(core.quizAnswer(subEG2, c)))) return false;
  const want = { 'L5C U1': 'U', 'L5C U2': 'U', 'L5C Z': 'Z', 'L5C H': 'skip', 'L5C O1': 'O' };
  return Object.entries(want).every(([n, a]) => core.quizAnswer(subEG2, byName(subEG2, n)) === a);
});
t('quiz answers: NS lumped H-or-Z rows split into H Perm / Z Perm / Solved', () => {
  const want = {
    'Pi H or Z Perm 16': 'H Perm', 'Pi H or Z Perm 17a': 'Z Perm',
    'Pi H or Z Perm 17b': 'Z Perm', 'Pi H or Z Perm 17d': 'Solved',
    'Peanut H or Z Perm and Pure Peanut 27': 'Solved',
    'Peanut H or Z Perm and Pure Peanut 28': 'H Perm',
    'Peanut H or Z Perm and Pure Peanut 29a': 'Z Perm',
    'Peanut H or Z Perm and Pure Peanut 29b': 'Z Perm',
  };
  return Object.entries(want).every(([n, a]) => core.quizAnswer(subNS, byName(subNS, n)) === a);
});
t('quiz answers: NS L4C/L5C get class answers; only "L5C 137a" stays out', () => {
  const cs = subNS.cases.filter((c) => c.corner === 'L4C' || c.corner === 'L5C');
  const want = {
    'L4C U perm': 'Horizontal U Perm', 'L4C 33': 'H Perm', 'L4C 32': 'Z Perm',
    'L5C 35a': 'Wat Perm', 'L5C 36a': 'X Perm', 'L5C 37a': 'Swirl Perm',
  };
  if (!Object.entries(want).every(([n, a]) => core.quizAnswer(subNS, byName(subNS, n)) === a)) return false;
  return cs.every((c) => (c.caseId === '137a') === (core.quizAnswer(subNS, c) === null));
});
t('quiz answers: every NS answer is one of the 11 class labels', () => {
  const LABELS = new Set(['Swirl Perm', 'Wat Perm', 'X Perm', 'Horizontal U Perm', 'Vertical U Perm',
    'O Perm', 'Z Perm Conjugates', 'Triple Sledge', 'H Perm', 'Z Perm', 'Solved']);
  return subNS.cases.every((c) => { const a = core.quizAnswer(subNS, c); return a === null || LABELS.has(a); });
});
t('quiz answers: TCLL labels are context-dependent — authored verbatim', () => {
  if (core.centerVocab(subTC).pure) return false; // if this flips, sig-resolution may be enabled
  return subTC.cases.every((c) => core.quizAnswer(subTC, c) === c.center);
});

finish();
