/* Skewbiks.com — engine unit tests (Skewb fixtures).
 *
 * Asserts the engine invariants: notation round-trips, mirror/inverse symmetry,
 * the facelet model against TNoodle ground-truth vectors (single moves + a real
 * WCA scramble), sym homomorphism + canon stability, indexing, the reachable
 * state count / God's number, and the optimal BFS solver.
 * See docs/skewb-ground-truth.md for sources.
 *
 * Run: node tools/test-engine.mjs   (exit 0 = OK, 1 = a test failed)
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
function rndState(moves = 30) {
  const s = E.solved();
  for (let i = 0; i < moves; i++) E.applyMoveIdx(s, rndInt(8));
  return s;
}
function rndWcaAlg(n) {
  const letters = ['R','U','L','B'], out = [];
  for (let i = 0; i < n; i++) out.push(letters[rndInt(4)] + (rndInt(2) ? "'" : ''));
  return out.join(' ');
}
const SYMS = E.buildSyms();
const ROTBY = E.makeFrames(SYMS);

// ---------------- notation ----------------
t('parseAlg: clean alg parses to one token per move', () => {
  const p = E.parseAlg("R U' L B2");
  return p && p.length === 4 && E.countMoves(p) === 4;
});
t('parseAlg: unparseable / lowercase tokens yield null', () =>
  E.parseAlg('R Q L') === null && E.parseAlg('r u') === null);
t('parseAlg: rotation amounts are order-4', () => {
  const p = E.parseAlg("x y' z2 y2'");
  return p && p.every(k => k.kind === 'rot') &&
    p[0].amt === 1 && p[1].amt === 3 && p[2].amt === 2 && p[3].amt === 2;
});
t('countMoves: ignores rotations, counts moves', () =>
  E.countMoves(E.parseAlg("y R U' y2 B x'")) === 3);
t('normAlg: collapses adjacent identical turns (R R -> R2)', () =>
  E.normAlg('R R U') === 'R2 U' && E.normAlg("L' L' B") === "L2' B");
t('mirrorAlg: R -> L\', U -> U\', B -> B\'; rotations map y->y\', x<->z', () =>
  E.mirrorAlg('R') === "L'" && E.mirrorAlg("U'") === 'U' &&
  E.mirrorAlg('B') === "B'" && E.mirrorAlg('y') === "y'" &&
  E.mirrorAlg('x') === "z'" && E.mirrorAlg('z2') === 'x2');
t('mirrorAlg: applied twice is the identity', () => {
  for (let i = 0; i < 20; i++) {
    const a = rndWcaAlg(8);
    if (E.mirrorAlg(E.mirrorAlg(a)) !== a) return false;
  }
  return true;
});
t('invertAlg: alg then its inverse returns to solved (incl. B and rotations)', () => {
  for (let i = 0; i < 20; i++) {
    const a = 'y ' + rndWcaAlg(6) + " x' " + rndWcaAlg(3);
    const p = E.parseAlg(a + ' ' + E.invertAlg(a));
    if (!E.eq(E.applyParsed(p, E.solved(), SYMS, ROTBY), E.solved())) return false;
  }
  return true;
});

// ---------------- state model ----------------
t('copy/eq: copy is equal but a distinct object/array', () => {
  const s = rndState(); const c = E.copy(s);
  return E.eq(s, c) && s.ctr !== c.ctr && s.fp !== c.fp && s.fo !== c.fo && s.fx !== c.fx;
});
t('move order: X X X == identity, X\' == X X for all generators', () => {
  for (let m = 0; m < 8; m += 2) {
    const s = rndState();
    const a = E.copy(s);
    E.applyMoveIdx(a, m); E.applyMoveIdx(a, m); E.applyMoveIdx(a, m);
    if (!E.eq(a, s)) return false;
    const b = E.copy(s), c = E.copy(s);
    E.applyMoveIdx(b, m); E.applyMoveIdx(b, m);
    E.applyMoveIdx(c, m + 1);
    if (!E.eq(b, c)) return false;
  }
  return true;
});
t('idx/unidx: round-trip preserves the state (10k random states)', () => {
  for (let i = 0; i < 10000; i++) {
    const s = rndState(20);
    if (!E.eq(E.unidx(E.idx(s)), s)) return false;
  }
  return true;
});

// ---------------- facelet model vs TNoodle ground truth ----------------
const FSTR = s => s.replace(/\s+/g, '').split('').map(ch => 'URFDLB'.indexOf(ch)).join();
const VEC = {
  "R":  'UUUUL FFRFF DFDDD RRRDR LLLLB BBBUB',
  "R'": 'UUUUB DDRDD RFRRR FFFDF LLLLU BBBLB',
  "U":  'RRRUR BBBRB FFDFF DDDDL LFLLL UUUUB',
  "U'": 'BBBUB UUURU FFLFF DDDDF LDLLL RRRRB',
  "L":  'URUUU RRRRF FFFUF LLDLL BBLBB DBDDD',
  "L'": 'UFUUU RRRRU FFFRF BBDBB DDLDD LBLLL',
  "B":  'UUFUU DRDDD FFFFL BDBBB LLLUL RRBRR',
  "B'": 'UULUU BRBBB FFFFU RDRRR LLLFL DDBDD',
};
function ffApply(alg, from) {
  let fl = from || E.solvedFacelets();
  for (const tok of alg.trim().split(/\s+/).filter(Boolean)) {
    const perm = E.WCA_FACELET_MOVES[tok[0]];
    const times = tok.endsWith("'") ? 2 : 1;
    for (let i = 0; i < times; i++) fl = E.applyFaceletPerm(fl, perm);
  }
  return fl;
}
t('facelets: all 8 single WCA moves match the TNoodle vectors', () => {
  for (const [tok, want] of Object.entries(VEC))
    if (ffApply(tok).join() !== FSTR(want)) return false;
  return true;
});
t('facelets: real WCA scramble (KPW 2015) reproduces the published state', () =>
  ffApply("L R L U' B R' U' R' L R B").join() ===
  FSTR('UUBUB LDDBL DFRLU BFRRU FRLFD RLFBD'));
t('facelets: structural orders — (R U)=45, (R U\')=30, (R U R\' U\')=6', () => {
  const orderOf = alg => {
    const solvedF = E.solvedFacelets().join();
    let fl = ffApply(alg), n = 1;
    while (fl.join() !== solvedF) { fl = ffApply(alg, fl); n++; if (n > 1000) return -1; }
    return n;
  };
  return orderOf('R U') === 45 && orderOf("R U'") === 30 && orderOf("R U R' U'") === 6;
});
t('facelets: to/fromFacelets round-trip on random states', () => {
  for (let i = 0; i < 200; i++) {
    const s = rndState();
    if (!E.eq(E.fromFacelets(E.toFacelets(s)), s)) return false;
  }
  return true;
});
t('bridge: R/U/L-only algs — facelet path equals applyParsed', () => {
  for (let i = 0; i < 30; i++) {
    const a = rndWcaAlg(10).replace(/B/g, 'R');
    const viaF = E.fromFacelets(ffApply(a));
    const viaP = E.applyParsed(E.parseAlg(a), E.solved(), SYMS, ROTBY);
    if (!E.eq(viaF, viaP)) return false;
  }
  return true;
});
// operational bridge: both worlds must agree on SOLVEDNESS. Fixed-frame
// "solved" = solved up to any of the 24 whole-cube reorientations.
function rot24Fps() { // closure of G4 + y face perms = the 24 rotations
  const Y = { U:'U', D:'D', F:'L', L:'B', B:'R', R:'F' };
  const seen = new Map([[JSON.stringify(E.FACE_ID), E.FACE_ID]]);
  const q = [E.FACE_ID];
  while (q.length) { const fp = q.pop();
    for (const g of [...E.AXIS.map(A => E.G4[A]), Y]) {
      const nf = E.faceCompose(g, fp), k = JSON.stringify(nf);
      if (!seen.has(k)) { seen.set(k, nf); q.push(nf); } } }
  return [...seen.values()];
}
t('bridge: facelet path and applyParsed agree on solvedness (incl. B algs)', () => {
  const FIDX = { U:0, R:1, F:2, D:3, L:4, B:5 };
  const fps = rot24Fps();
  if (fps.length !== 24) return false;
  // "reoriented solved" facelet strings: coloring(pos) = face(rot^-1(pos)),
  // which for the solved coloring is just the per-face constant fp^-1(face).
  const solvedSet = new Set(fps.map(fp => {
    const inv = {}; for (const f in fp) inv[fp[f]] = f;
    const fl = [];
    for (const f of ['U','R','F','D','L','B']) for (let k = 0; k < 5; k++) fl.push(FIDX[inv[f]]);
    return fl.join();
  }));
  for (let i = 0; i < 25; i++) {
    // solving algs: w + invert(w) evaluated as one stream
    const w = rndWcaAlg(6);
    const a = i % 2 ? w + ' ' + E.invertAlg(w) : rndWcaAlg(8);
    const ffSolved = solvedSet.has(ffApply(a).join());
    const stSolved = E.eq(E.applyParsed(E.parseAlg(a), E.solved(), SYMS, ROTBY), E.solved());
    if (ffSolved !== stSolved) return false;
  }
  return true;
});

// ---------------- display frame (toFixedFacelets) ----------------
// The renderer draws E.toFixedFacelets — the WCA-scrambling-hold presentation.
// It must equal the LITERAL fixed-frame facelet result of the alg, so a
// diagram always matches a real cube after the printed scramble, and the
// white/red/green (UFL) corner never appears to move or twist.
t('display: toFixedFacelets matches every single-move TNoodle vector (incl. B/B\')', () => {
  for (const [tok, want] of Object.entries(VEC)) {
    const st = E.applyParsed(E.parseAlg(tok), E.solved(), SYMS, ROTBY);
    if (E.toFixedFacelets(st).join() !== FSTR(want)) return false;
  }
  return true;
});
t('display: KPW 2015 scramble renders the published fixed-frame state', () => {
  const st = E.applyParsed(E.parseAlg("L R L U' B R' U' R' L R B"), E.solved(), SYMS, ROTBY);
  return E.toFixedFacelets(st).join() === FSTR('UUBUB LDDBL DFRLU BFRRU FRLFD RLFBD');
});
t('display: toFixedFacelets == fixed-frame facelet path for random WCA algs', () => {
  for (let i = 0; i < 40; i++) {
    const a = rndWcaAlg(1 + rndInt(12));
    const st = E.applyParsed(E.parseAlg(a), E.solved(), SYMS, ROTBY);
    if (E.toFixedFacelets(st).join() !== ffApply(a).join()) return false;
  }
  return true;
});
t('display: the white/red/green corner reads solved on every displayed state', () => {
  // UFL's three stickers are U3 / F1 / L2 (flat facelet indices 3, 11, 22)
  for (let i = 0; i < 60; i++) {
    const fl = E.toFixedFacelets(rndState());
    if (fl[3] !== 0 || fl[11] !== 2 || fl[22] !== 4) return false;
  }
  return true;
});

// ---------------- symmetries ----------------
t('sym homomorphism: every sym conjugates each move to a single move', () => {
  const states = Array.from({ length: 12 }, () => rndState());
  for (const sym of SYMS.all) {
    for (let m = 0; m < 8; m += 2) {
      let found = -1;
      const s0 = states[0];
      const mv = (st, mm) => { const c = E.copy(st); E.applyMoveIdx(c, mm); return c; };
      const lhs0 = E.applySym(sym, mv(s0, m));
      for (let mm = 0; mm < 8; mm++)
        if (E.eq(lhs0, mv(E.applySym(sym, s0), mm))) { found = mm; break; }
      if (found < 0) return false;
      for (const s of states)
        if (!E.eq(E.applySym(sym, mv(s, m)), mv(E.applySym(sym, s), found))) return false;
    }
  }
  return true;
});
t('canon: invariant under every rotation of the state', () => {
  const canon = E.makeCanon(SYMS);
  for (let i = 0; i < 10; i++) {
    const s = rndState(), c = canon(s);
    for (const sym of SYMS.rots) if (canon(E.applySym(sym, s)) !== c) return false;
  }
  return true;
});
t('mirrorAlg: mirrored solution solves the mirrored state', () => {
  const mSym = E.symFromFacePerm({ U:'U', D:'D', R:'B', B:'R', F:'L', L:'F' }, true);
  for (let i = 0; i < 15; i++) {
    const a = rndWcaAlg(8);
    const cs = E.caseStateOf(a);
    const csM = E.caseStateOf(E.mirrorAlg(a));
    if (!cs || !csM || !E.eq(csM, E.applySym(mSym, cs))) return false;
  }
  return true;
});

// ---------------- CF predicate (centers solved relative to each other) ----------------
// Full-space oracles (104,976 raw states / 4,503 census entries, per-depth
// tables, hold-24 orbit invariance) live in tools/verify-space.mjs.
let cfWitness = null; // a depth-4 CF state, reused by the invariance test
t('centersRelSolved: solved is CF, no depth 1-3 state is, depth 4 reaches CF', () => {
  if (!E.centersRelSolved(E.solved())) return false;
  let frontier = [E.solved()];
  for (let len = 1; len <= 4; len++) {
    const next = [];
    for (const s of frontier) for (let m = 0; m < 8; m++) { const v = E.copy(s); E.applyMoveIdx(v, m); next.push(v); }
    frontier = next;
    const hits = frontier.filter(s => E.centersRelSolved(s) && !E.eq(s, E.solved()));
    if (len < 4 && hits.length) return false;
    if (len === 4) { if (!hits.length) return false; cfWitness = hits[0]; }
  }
  return true;
});
t('centersRelSolved: invariant under all 24 state symmetries (rots + mirrors)', () => {
  const states = Array.from({ length: 30 }, () => rndState());
  if (cfWitness) states.push(cfWitness); // guarantee a CF state is exercised
  for (const s of states) {
    const v = E.centersRelSolved(s);
    for (const sym of SYMS.all) if (E.centersRelSolved(E.applySym(sym, s)) !== v) return false;
  }
  return true;
});

// ---------------- keying + alg->case ----------------
t('caseStateOf: a valid alg yields a self-consistent case state', () => {
  for (let i = 0; i < 20; i++) {
    const a = 'y ' + rndWcaAlg(7);
    const cs = E.caseStateOf(a);
    if (!cs || !E.algSolvesKey(a, E.stateKey(cs))) return false;
  }
  return true;
});
t('algSolvesKey: empty alg solves the solved key; junk does not', () =>
  E.algSolvesKey('', E.stateKey(E.solved())) &&
  !E.algSolvesKey('Q', E.stateKey(E.solved())) &&
  !E.algSolvesKey('R', E.stateKey(E.solved())));
t('stateKey/keyToState: round-trip', () => {
  for (let i = 0; i < 100; i++) {
    const s = rndState();
    if (!E.eq(E.keyToState(E.stateKey(s)), s)) return false;
  }
  return true;
});
t('realCanonKey: deterministic and invariant under the y2 view', () => {
  const y2 = E.symFromFacePerm({ U:'U', D:'D', F:'B', B:'F', L:'R', R:'L' }, false);
  for (let i = 0; i < 50; i++) {
    const s = rndState();
    const k = E.realCanonKey(s);
    if (k !== E.realCanonKey(s)) return false;
    if (E.realCanonKey(E.applySym(y2, s)) !== k) return false;
  }
  return true;
});
t('prependAUF: folds into a leading y token (mod 4)', () =>
  E.prependAUF(1, 'y R') === 'y2 R' &&
  E.prependAUF(3, 'y R') === 'R' &&
  E.prependAUF(2, "y' L") === 'y L' &&
  E.prependAUF(1, 'R U') === 'y R U' &&
  E.prependAUF(0, "y2 B'") === "y2 B'");
t('preprocessAlg: rotation-only setup brackets are stripped ([y2] X == y2 X)', () => {
  for (let i = 0; i < 10; i++) {
    const a = rndWcaAlg(6);
    const cs = E.caseStateOf('[y2] ' + a);
    if (!cs || !E.eq(cs, E.caseStateOf('y2 ' + a))) return false;
  }
  return true;
});
t('preprocessAlg: non-rotation bracket groups are rejected, not misread', () =>
  // "[R, U]" is commutator notation (R U R' U'), NOT the sequence R U — it must
  // fail to parse rather than silently produce the wrong case.
  E.caseStateOf('[R, U]') === null &&
  E.caseStateOf("[R U R' U']") === null &&
  E.caseStateOf('[y2') === null);
t('nsToWCA: accepts bracketed setups like the WCA path does', () => {
  const w = E.nsToWCA('[y2] r b');
  return w !== null && E.eq(E.caseStateOf(w), E.caseStateOf('y2 R B'));
});
t('presentations: y2-prefixed algs share a realCanonKey (p/p+2 fold)', () => {
  // the sheet/algs-page case model: prependAUF(p, A) for p=0..3 gives the four
  // viewing presentations; p and p+2 differ by the y2 view, the only folded one.
  for (let i = 0; i < 15; i++) {
    const a = rndWcaAlg(7);
    const canons = [0, 1, 2, 3].map(p => E.realCanonKey(E.caseStateOf(E.prependAUF(p, a))));
    if (canons[0] !== canons[2] || canons[1] !== canons[3]) return false;
  }
  return true;
});
t('nativeToWCA: converted alg reproduces the native state, same length', () => {
  for (let i = 0; i < 30; i++) {
    const n = 1 + rndInt(12);
    const toks = [];
    const s = E.solved();
    for (let k = 0; k < n; k++) { const m = rndInt(8); toks.push(E.MOVES[m]); E.applyMoveIdx(s, m); }
    const wca = E.nativeToWCA(toks.join(' '), ROTBY);
    if (E.countMoves(E.parseAlg(wca)) !== n) return false;
    if (!E.eq(E.applyParsed(E.parseAlg(wca), E.solved(), SYMS, ROTBY), s)) return false;
  }
  return true;
});

// ---------------- NS notation (parseAlg(str,'ns'), converters, mirror) ----------------
const stOf = (a, nota) => E.applyParsed(E.parseAlg(a, nota), E.solved(), SYMS, ROTBY);
function rndNsAlg(n, rots) {
  const letters = ['F','R','B','L','f','r','b','l'], out = [];
  for (let i = 0; i < n; i++) {
    if (rots && rndInt(4) === 0) out.push('xyz'[rndInt(3)] + ['', "'", '2'][rndInt(3)]);
    else out.push(letters[rndInt(8)] + (rndInt(2) ? "'" : ''));
  }
  return out.join(' ');
}
t('parseAlg NS: WCA R U L B are the NS subset r B l b (same corners)', () => {
  for (const [w, n] of [['R','r'], ['U','B'], ['L','l'], ['B','b']]) {
    if (!E.eq(stOf(w), stOf(n, 'ns'))) return false;
    if (!E.eq(stOf(w + "'"), stOf(n + "'", 'ns'))) return false;
  }
  return true;
});
t('parseAlg NS: F is the native UFL half-twist; U / lone F(wca) unparseable', () => {
  const nat = E.solved(); E.move(nat, 'UFL', false);
  return E.eq(stOf('F', 'ns'), nat) && E.parseAlg('U', 'ns') === null && E.parseAlg('F') === null;
});
t('parseAlg NS: free-corner letters equal rotation conjugates of WCA B', () =>
  E.eq(stOf('R', 'ns'), stOf('x2 B x2')) &&
  E.eq(stOf('f', 'ns'), stOf('y2 B y2')) &&
  E.eq(stOf('L', 'ns'), stOf('z2 B z2')));
t('wcaToNS: pure token rename (official KPW scramble)', () =>
  E.wcaToNS("L R L U' B R' U' R' L R B") === "l r l B' b r' B' r' l r b");
t('wcaToNS -> nsToWCA: state + movecount round-trip on random WCA algs', () => {
  for (let i = 0; i < 30; i++) {
    const a = 'y ' + rndWcaAlg(8) + " z' " + rndWcaAlg(3);
    const back = E.nsToWCA(E.wcaToNS(a));
    if (back === null || !E.eq(stOf(back), stOf(a))) return false;
    if (E.countMoves(E.parseAlg(back)) !== E.countMoves(E.parseAlg(a))) return false;
  }
  return true;
});
t('nsToWCA: full 8-letter NS algs (with rotations) convert to the same state', () => {
  for (let i = 0; i < 30; i++) {
    const a = rndNsAlg(1 + rndInt(10), true);
    const w = E.nsToWCA(a);
    if (w === null || !E.eq(stOf(w), stOf(a, 'ns'))) return false;
    if (E.countMoves(E.parseAlg(w)) !== E.countMoves(E.parseAlg(a, 'ns'))) return false;
  }
  return true;
});
t('mirrorAlg: NS letters (r->l\', F->F\'), involution, mirrored state', () => {
  if (E.mirrorAlg('r') !== "l'" || E.mirrorAlg('F') !== "F'" || E.mirrorAlg("b'") !== 'b') return false;
  const mSym = E.symFromFacePerm({ U:'U', D:'D', R:'B', B:'R', F:'L', L:'F' }, true);
  for (let i = 0; i < 15; i++) {
    const a = rndNsAlg(6, false);
    if (E.mirrorAlg(E.mirrorAlg(a)) !== a) return false;
    if (!E.eq(stOf(E.mirrorAlg(a), 'ns'), E.applySym(mSym, stOf(a, 'ns')))) return false;
  }
  return true;
});
t('makeFullCanon: equals min(rot canon, mirror canon), 24-sym invariant', () => {
  const canon = E.makeCanon(SYMS), mcanon = E.makeMirrorCanon(SYMS), fcanon = E.makeFullCanon(SYMS);
  for (let i = 0; i < 10; i++) {
    const s = rndState(), c = fcanon(s);
    if (c !== Math.min(canon(s), mcanon(s))) return false;
    for (const sym of SYMS.all) if (fcanon(E.applySym(sym, s)) !== c) return false;
  }
  return true;
});

// ---------------- enumFreeSlots ----------------
t('enumFreeSlots: LL-corner pool has the parity-constrained size', () => {
  const pool = E.enumFreeSlots({ corners: [0,1,2,3] });
  // 4 class-0 free perms (V4) x 27 twist combos summing to 0
  return pool.length === 4 * 27;
});

// ---------------- BFS: state count, God's number, optimal solver ----------------
console.log('building full distance table (one-time, ~9.4M slots)…');
const T0 = Date.now();
const dist = buildDist(E);
console.log('  built in ' + ((Date.now() - T0) / 1000).toFixed(1) + 's');
t('BFS: reachable state count is exactly 3,149,280', () => {
  let n = 0;
  for (let i = 0; i < dist.length; i++) if (dist[i] >= 0) n++;
  return n === 3149280;
});
t('BFS: God\'s number is exactly 11', () => {
  let mx = 0;
  for (let i = 0; i < dist.length; i++) if (dist[i] > mx) mx = dist[i];
  return mx === 11;
});
t('enumFreeSlots: every enumerated state is reachable', () => {
  for (const s of E.enumFreeSlots({ corners: [0,1,2,3], fixedTwists: [0,1] }))
    if (dist[E.idx(s)] < 0) return false;
  return true;
});
t('optimalSolution: solves a scramble in exactly its optimal length', () => {
  for (let i = 0; i < 20; i++) {
    const s = rndState();
    const sol = E.optimalSolution(s, dist);
    if (sol === null) return false;
    const p = E.parseAlg(sol);
    if (E.countMoves(p) !== dist[E.idx(s)]) return false;
    if (!E.eq(E.applyParsed(p, s, SYMS, ROTBY), E.solved())) return false;
  }
  return true;
});
t('optimalScramble: inverse of an optimal solution; re-solves to solved', () => {
  for (let i = 0; i < 10; i++) {
    const s = rndState();
    const scr = E.optimalScramble(s, dist, true);
    if (scr === null) return false;
    if (!E.eq(E.applyParsed(E.parseAlg(scr), E.solved(), SYMS, ROTBY), s)) return false;
  }
  return true;
});

// ---------------- hold ("re-hold") symmetry — the hold-24 census fold ----------------
// Full oracle battery (both ι routes, 132,315/66,321/1,956/108/327 counts)
// lives in tools/verify-space.mjs; here the cheap invariants are pinned.
t('makeHoldSym: ι is a depth-preserving state-level involution, identity on solved', () => {
  const hold = E.makeHoldSym(SYMS);
  if (!E.eq(hold.iota(E.solved(), dist), E.solved())) return false;
  for (let i = 0; i < 25; i++) {
    const s = rndState();
    const t2 = hold.iota(s, dist);
    if (dist[E.idx(t2)] !== dist[E.idx(s)]) return false;
    if (!E.eq(hold.iota(t2, dist), s)) return false;
  }
  return true;
});
t('makeHold24Canon/makeFull48Canon: invariant under rotations, ι and (48) mirrors', () => {
  const hold = E.makeHoldSym(SYMS);
  const h24 = E.makeHold24Canon(SYMS, dist), f48 = E.makeFull48Canon(SYMS, dist);
  for (let i = 0; i < 10; i++) {
    const s = rndState();
    const c = h24(s), f = f48(s);
    const sym = SYMS.rots[1 + Math.floor(Math.random() * (SYMS.rots.length - 1))];
    if (h24(sym.apply(s)) !== c) return false;
    if (h24(hold.iota(s, dist)) !== c) return false;
    if (f48(SYMS.mirrors[0].apply(s)) !== f) return false;
    if (f > c) return false;                 // the 48-orbit contains the 24-orbit
  }
  return true;
});

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
