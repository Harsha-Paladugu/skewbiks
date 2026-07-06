/* Skewbiks.com — trainer substrate tests (src/trainer/skewb-core.mjs).
 *
 * Asserts the M6 trainer's math against the shared engine: the case model over
 * data/skewb_algs.json (counts, presentation geometry, direction synthesis),
 * masked scrambles (correctness + length window), the first-layer predicate +
 * goal seeds + goal-distance table, and the full-solve analysis.
 *
 * Run: node tools/test-trainer.mjs   (exit 0 = OK, 1 = a test failed)
 * Heavier than test-engine: builds TWO full-space BFS tables (dist + FL-dist).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { buildDist } from './lib/bfs-dist.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = {};
require(path.join(ROOT, 'js', 'engine.js'));
const E = globalThis.window.OOEngine;

const { createCore, DIRS, Y_PREFIX } = await import('../src/trainer/skewb-core.mjs');
const core = createCore(E);

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
const rndInt = (n) => Math.floor(Math.random() * n);
const applyWca = (alg, st) => E.applyParsed(E.parseAlg(E.preprocessAlg(alg)), st, null, E.makeFrames());

// ---------------- case model ----------------
const JSON_DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'skewb_algs.json'), 'utf8'));
const model = core.buildModel(JSON_DATA);

t('model: empty subsets skipped, imported three present', () => {
  const keys = model.subsets.map((s) => s.key);
  return keys.length === 3 && keys.includes('NS') && keys.includes('EG2') && keys.includes('TCLL');
});
t('model: 1,349 cases / 3,114 algs, matching the JSON', () => {
  const cases = model.subsets.reduce((a, s) => a + s.cases.length, 0);
  const algs = model.subsets.reduce((a, s) => a + s.cases.reduce((b, c) => b + c.algs.length, 0), 0);
  return cases === 1349 && algs === 3114;
});
t('model: nav groups partition every subset (no strays)', () =>
  model.subsets.every((s) =>
    s.groups.reduce((a, g) => a + g.cases.length, 0) === s.cases.length &&
    !s.groups.some((g) => g.label === 'Other')));
t('model: navSorted orders EG2 by the authored id order', () => {
  const eg2 = model.subsets.find((s) => s.key === 'EG2');
  const sorted = core.navSorted(eg2, eg2.groups[0].cases);
  const order = eg2.nav.sort.order; // ['U','FL','FR','BR','BL']
  const ids = sorted.map((c) => order.indexOf(c[eg2.nav.sort.field]));
  return ids.every((v, i) => i === 0 || ids[i - 1] <= v);
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

// ---------------- analysis ----------------
t('analyze: direct lines solve; method = FL then finish, total ≥ direct', () => {
  for (let i = 0; i < 6; i++) {
    const st = core.randomReachable(dist);
    const a = core.analyze(st, dist, fldist);
    if (!a || a.direct !== dist[E.idx(st)]) return false;
    if (!a.lines.length || a.lines.some((l) => l.moves.length !== a.direct)) return false;
    const viaLine = applyWca(a.lines[0].alg || "R R'", E.copy(st));
    if (a.lines[0].alg && E.stateKey(viaLine) !== E.stateKey(E.solved())) return false;
    if (!a.method || a.method.total < a.direct) return false;
    if (a.method.flLen !== fldist[E.idx(st)]) return false;
    let cur = E.copy(st);
    if (a.method.flAlg) cur = applyWca(a.method.flAlg, cur);
    if (!core.anyLayerSolved(cur)) return false;
    if (a.method.finishAlg) cur = applyWca(a.method.finishAlg, cur);
    if (E.stateKey(cur) !== E.stateKey(E.solved())) return false;
  }
  return true;
});
t('lineLayerSplit: split point really has a solved layer (when found)', () => {
  for (let i = 0; i < 40; i++) {
    const st = core.randomReachable(dist);
    const a = core.analyze(st, dist, null);
    if (!a || !a.lines.length) continue;
    const split = core.lineLayerSplit(st, a.lines[0].moves);
    if (!split) continue;
    const cur = E.copy(st);
    for (let n = 0; n < split.at; n++) E.applyMoveIdx(cur, a.lines[0].moves[n]);
    if (!core.layerSolved(cur, split.face)) return false;
  }
  return true;
});
t('exports: DIRS/Y_PREFIX shapes', () =>
  DIRS.length === 4 && Y_PREFIX.length === 4 && Y_PREFIX[0] === '' && Y_PREFIX[2] === 'y2');

// ---------------- partial (3+2) recognition ----------------
t('displayPosMap: raw piece positions land where toFixedFacelets displays them', () => {
  for (let i = 0; i < 50; i++) {
    const st = core.randomReachable(dist);
    const raw = E.toFacelets(st), disp = E.toFixedFacelets(st);
    const dmap = core.displayPosMap(st);
    for (let p = 0; p < 30; p++) if (disp[dmap[p]] !== raw[p]) return false;
    if (new Set(dmap).size !== 30) return false;
  }
  return true;
});
t('pickView: 3 distinct non-FL centers + 2 distinct upper corners', () => {
  for (let i = 0; i < 50; i++) {
    const v = core.pickView();
    if (v.centers.length !== 3 || new Set(v.centers).size !== 3) return false;
    if (v.corners.length !== 2 || new Set(v.corners).size !== 2) return false;
    if (!v.centers.every((f) => core.RECOG_CENTERS.includes(f))) return false;
    if (!v.corners.every((c) => core.RECOG_CORNERS.includes(c))) return false;
  }
  return true;
});
t('maskForView: hides exactly 21 stickers (9 visible), incl. on twisted-UFL states', () => {
  const cases = model.subsets.flatMap((s) => s.cases);
  let sawTwisted = false;
  for (let i = 0; i < 40; i++) {
    const st = core.stateForDir(cases[rndInt(cases.length)], rndInt(4));
    if (st.fx[1] !== 0) sawTwisted = true;
    const mask = core.maskForView(st, core.pickView());
    if (mask.size !== 21) return false;
  }
  return sawTwisted; // the display-rotation path must actually get exercised
});
t('maskForView: the visible stickers are exactly the chosen pieces’ stickers', () => {
  const FIDX = Object.fromEntries(E.FACES.map((f, i) => [f, i]));
  for (let i = 0; i < 30; i++) {
    const c = SAMPLE[rndInt(SAMPLE.length)];
    const st = core.stateForDir(c, rndInt(4));
    const view = core.pickView();
    const mask = core.maskForView(st, view);
    const dmap = core.displayPosMap(st);
    const rawVisible = new Set();
    for (const f of view.centers) rawVisible.add(FIDX[f] * 5);
    for (const k of view.corners) for (const g of E.FACES) {
      const ix = E.STICKER_POS[g].indexOf(k);
      if (ix >= 0) rawVisible.add(FIDX[g] * 5 + 1 + ix);
    }
    for (let p = 0; p < 30; p++) {
      if (rawVisible.has(p) === mask.has(dmap[p])) return false; // visible <-> not masked
    }
  }
  return true;
});
t('viewSignature: equal on same state, differs when a visible piece changes', () => {
  const view = { centers: ['U', 'R', 'F'], corners: ['UFR', 'UBL'] };
  const a = E.solved();
  if (core.viewSignature(a, view) !== core.viewSignature(E.solved(), view)) return false;
  const b = E.copy(a); b.fo[0] = 1; b.fo[3] = 2; // twist UFR (visible)
  if (core.viewSignature(a, view) === core.viewSignature(b, view)) return false;
  const c = E.copy(a); c.fx[2] = 1; // twist DFR (not in view)
  return core.viewSignature(a, view) === core.viewSignature(c, view);
});
t('premise: within NS corner groups, a 3+2 view is ≥99% unique (machine check)', () => {
  const ns = model.subsets.find((s) => s.key === 'NS');
  const CENTERS = core.RECOG_CENTERS, CORNERS = core.RECOG_CORNERS;
  const views = [];
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 4; b++) for (let c = b + 1; c < 5; c++)
    for (let x = 0; x < 3; x++) for (let y = x + 1; y < 4; y++)
      views.push({ centers: [CENTERS[a], CENTERS[b], CENTERS[c]], corners: [CORNERS[x], CORNERS[y]] });
  let uniqSum = 0, n = 0;
  for (const g of ns.groups) {
    const states = g.cases.map((c) => core.stateForDir(c, 0));
    for (const v of views) {
      const bySig = new Map();
      for (const st of states) { const s = core.viewSignature(st, v); bySig.set(s, (bySig.get(s) || 0) + 1); }
      let uniq = 0;
      for (const st of states) if (bySig.get(core.viewSignature(st, v)) === 1) uniq++;
      uniqSum += uniq / states.length; n++;
    }
  }
  const avg = uniqSum / n;
  console.log('    (NS within-group uniqueness = ' + (100 * avg).toFixed(2) + '%)');
  return avg >= 0.99;
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
