/* Skewb trainer substrate — no React, no DOM.
 *
 * Everything here runs on the shared engine (window.OOEngine, passed in as E)
 * plus a caller-supplied distance table (Int8Array over E.NSLOTS, from
 * OOTables.loadOrBuildDist). The component (skewb-trainer.jsx) owns UI and
 * persistence; this module owns the math:
 *
 *   - the case model over data/skewb_algs.json (fetched at runtime — the JSON
 *     is the single authority; the compiled js/sheet.js lacks the ns/rating/
 *     firstMove/nav fields the trainer displays)
 *   - presentation geometry: all alg data is Front-authored, so the Right/
 *     Back/Left drill targets are synthesized as caseStateOf(prependAUF(p, alg))
 *     per the site convention (p = 0 Front / 1 Right / 2 Back / 3 Left)
 *   - masked scrambles (length decorrelated from case difficulty)
 *   - the first-layer predicate + goal-distance table for one-look problems
 *
 * Plain .mjs so Node tests (tools/test-trainer.mjs) can import it with the
 * documented window-stub engine recipe; esbuild bundles it natively.
 */

export const DIRS = ['Front', 'Right', 'Back', 'Left'];
export const Y_PREFIX = ['', 'y', 'y2', "y'"]; // rotation chip for a k-quarter offset
export const SEP = '\u001f';                   // id separator (case names are free-form)

const RATING_RANK = { best: 0, neutral: 1, poor: 3 };
export const rateRank = (a) => (a && RATING_RANK[a.rating] !== undefined) ? RATING_RANK[a.rating] : 2;

const isRotTok = (t) => /^[xyz](2'|2|')?$/.test(t);
function stripPostRot(alg) { // trailing whole-cube rotations are cosmetic
  const toks = String(alg).trim().split(/\s+/).filter(Boolean);
  while (toks.length && isRotTok(toks[toks.length - 1])) toks.pop();
  return toks.join(' ');
}

// One-look "My solution" placeholder examples, per notation. Every letter must
// pass the input's own physPermOf guard (no rotations, no fixed-corner letters
// — NS capital R/L/F/f move the fixed white/red/green corner); pinned in
// test:trainer so the UI never suggests a solution it would reject.
export const SOL_EXAMPLES = { ns: "r' b l", wca: "R' B L" };

// The sheets' first-move letter convention (see js/algs.js / import-method-sheets.mjs).
const SHEET_FM = { R: 'B', U: 'b', L: 'r', B: 'R' };

export function createCore(E) {
  const NSLOTS = E.NSLOTS;

  // ---------- case model ----------
  // buildModel is pure JSON shaping (no engine calls); all state derivation is
  // lazy per case via casePres(), so trainer boot stays instant.
  function buildModel(json) {
    const subsets = [];
    for (const cont of [json.subsets || {}, json.other_subsets || {}]) {
      for (const key of Object.keys(cont)) {
        const src = cont[key];
        if (!src.cases || !src.cases.length) continue; // FL / Sarah-* shells wait for data
        const nav = src.nav || null;
        const cases = src.cases.map((c) => ({ subset: key, uid: key + SEP + c.name, ...c }));
        // group structure: authored nav groups, else one flat group
        let groups;
        if (nav && nav.group && nav.group.values && nav.group.values.length) {
          groups = nav.group.values.map((v) => ({
            value: v.value, label: v.label || v.value,
            cases: cases.filter((c) => c[nav.group.field] === v.value),
          }));
          const claimed = new Set(groups.flatMap((g) => g.cases.map((c) => c.uid)));
          const stray = cases.filter((c) => !claimed.has(c.uid));
          if (stray.length) groups.push({ value: SEP + 'other', label: 'Other', cases: stray });
        } else {
          groups = [{ value: '', label: 'All', cases }];
        }
        subsets.push({ key, name: src.name || key, nav, cases, groups });
      }
    }
    return { subsets };
  }

  // nav-ordered case list (the algs-page comparator): explicit `order` list or
  // natural numeric sort on the sort field; authored order breaks ties.
  function navSorted(sub, cases) {
    const ix = new Map(sub.cases.map((c, i) => [c.uid, i]));
    const spec = sub.nav && sub.nav.sort;
    if (!spec) return cases.slice().sort((a, b) => ix.get(a.uid) - ix.get(b.uid));
    const rank = (c) => {
      const v = c[spec.field];
      if (spec.order) { const i = spec.order.indexOf(v); return [i < 0 ? 1e9 : i, '']; }
      const m = spec.natural && String(v == null ? '' : v).match(/^(\d+)(.*)$/);
      return m ? [parseInt(m[1], 10), m[2]] : [1e9, String(v == null ? '' : v)];
    };
    return cases.slice().sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      return (ra[0] - rb[0]) || (ra[1] < rb[1] ? -1 : ra[1] > rb[1] ? 1 : 0) || (ix.get(a.uid) - ix.get(b.uid));
    });
  }

  // Presentation geometry per case, memoized (the algs.js casePres pattern).
  // rows: every authored alg with its exact solved state; anchor = the first
  // alg that parses to a clean state; states[p]/pks[p] = the case at p
  // y-quarters from the anchor's own view. All v1 data is Front-authored, but
  // we honor an authored non-Front anchor the same way algs.js does.
  const presCache = new Map();
  function casePres(c) {
    let out = presCache.get(c.uid);
    if (out) return out;
    const rows = [];
    for (const a of c.algs || []) {
      const core = stripPostRot(E.normAlg(a.alg));
      const state = E.caseStateOf(core);
      rows.push({ a, core, state, key: state ? E.stateKey(state) : null, p: -1 });
    }
    const anchor = rows.find((r) => r.state);
    out = { rows, ok: false, states: null, pks: null, canons: [], anchorDir: 'Front' };
    if (anchor) {
      const states = [], pks = [], canons = new Set();
      let ok = true;
      for (let p = 0; p < 4; p++) {
        const st = p === 0 ? anchor.state : E.caseStateOf(E.prependAUF(p, anchor.core));
        if (!st) { ok = false; break; }
        states.push(st);
        pks.push(E.stateKey(st));
        canons.add(E.realCanonKey(st));
      }
      if (ok) {
        const dir = anchor.a.side || anchor.a.direction;
        out = { rows, ok: true, states, pks, canons: [...canons], anchorDir: DIRS.includes(dir) ? dir : 'Front' };
        for (const r of rows) if (r.key) r.p = pks.indexOf(r.key);
      }
    }
    presCache.set(c.uid, out);
    return out;
  }

  // The case as seen at absolute direction d (0 Front … 3 Left) — the state a
  // drill scramble must land on, and the recognition diagram. null if the case
  // has no usable anchor.
  function stateForDir(c, d) {
    const cp = casePres(c);
    if (!cp.ok) return null;
    return cp.states[(d - DIRS.indexOf(cp.anchorDir) + 4) % 4];
  }

  // Display rows for the case at absolute direction d: each solving alg with
  // the y-offset k it needs from this view ("do y, then the alg"). Sorted
  // exact-view first, then rating (suspects trail via authored order + flag).
  function algsForDir(c, d) {
    const cp = casePres(c);
    if (!cp.ok) return [];
    const q = (d - DIRS.indexOf(cp.anchorDir) + 4) % 4;
    const out = [];
    cp.rows.forEach((r, i) => {
      if (r.p < 0) return;
      out.push({ ...r, k: (q - r.p + 4) % 4, ix: i });
    });
    return out.sort((x, y) => (x.k - y.k) || (!!x.a.suspect - !!y.a.suspect) || (rateRank(x.a) - rateRank(y.a)) || (x.ix - y.ix));
  }

  // Reverse lookup: which (case, absolute direction, subset) a state shows,
  // across the whole model — the one-look reveal's best-effort case name.
  // First case wins per render key (model order); the index builds lazily once
  // per model object. The solved state gets a sentinel.
  let _caseIndex = null;
  function caseOfState(model, st) {
    if (!st) return null;
    if (E.eq(st, E.solved())) return { solved: true };
    if (!_caseIndex || _caseIndex.model !== model) {
      const map = new Map();
      for (const sub of model.subsets) {
        for (const c of sub.cases) {
          const cp = casePres(c);
          if (!cp.ok) continue;
          const a0 = DIRS.indexOf(cp.anchorDir);
          cp.pks.forEach((pk, p) => { if (!map.has(pk)) map.set(pk, { c, d: (p + a0) % 4, subset: sub.key }); });
        }
      }
      _caseIndex = { model, map };
    }
    return _caseIndex.map.get(E.stateKey(st)) || null;
  }

  function firstMoveOf(row) {
    if (row.a && row.a.firstMove) return row.a.firstMove;
    const flat = E.nsToWCA(E.wcaToNS(row.core)) || row.core;
    const m = String(flat).trim().split(/\s+/)[0].match(/^([ULRB])(2'|2|')?$/);
    return m ? SHEET_FM[m[1]] + ((m[2] === "'" || m[2] === '2') ? "'" : '') : '';
  }

  // ---------- moves / scrambles ----------
  const NMOVES = E.MOVES.length; // 8 native moves; mi>>1 = axis, mi^1 = inverse
  const toWCA = (mis) => mis.length ? E.nativeToWCA(mis.map((i) => E.MOVES[i])) : '';

  // randomized optimal descent of a distance-like table (0 = goal). Returns
  // native move indices, plus the goal state it lands on. The loop itself is
  // the engine's shared descend primitive.
  const descend = (state, table) => E.descend(state, table, true);

  // every optimal descent (capped): [{moves, end}]
  function descentLines(state, table, cap) {
    const out = [];
    const d0 = table[E.idx(state)];
    if (d0 < 0) return out;
    const dfs = (cur, cd, path) => {
      if (out.length >= cap) return;
      if (cd === 0) { out.push({ moves: path.slice(), end: E.copy(cur) }); return; }
      for (let mi = 0; mi < NMOVES; mi++) {
        const t = E.copy(cur); E.applyMoveIdx(t, mi);
        if (table[E.idx(t)] === cd - 1) { path.push(mi); dfs(t, cd - 1, path); path.pop(); }
      }
    };
    dfs(E.copy(state), d0, []);
    return out;
  }

  // merge/cancel adjacent same-axis moves (each move has order 3)
  function pushMove(out, mi) {
    while (out.length && (out[out.length - 1] >> 1) === (mi >> 1)) {
      const a = out.pop();
      const sum = ((a & 1 ? 2 : 1) + (mi & 1 ? 2 : 1)) % 3;
      if (sum === 0) return;
      mi = (mi & ~1) | (sum === 2 ? 1 : 0);
    }
    out.push(mi);
  }

  // Masked scramble: a fresh random sequence every call, length decorrelated
  // from case difficulty so the scramble never identifies the case.
  // M = A · B with B a random walk and A a randomized-optimal solve to
  // B⁻¹(target). Window [9,12] tuned to the Skewb histogram (avg 8.36, max 11).
  const MASK_MIN = 9, MASK_MAX = 12;
  function maskedScramble(target, dist) {
    const d0 = dist[E.idx(target)];
    if (d0 < 0) return null;
    for (let attempt = 0; attempt < 40; attempt++) {
      const k = Math.max(2, 10 - d0) + Math.floor(Math.random() * 2);
      const B = [];
      let lastAxis = -1;
      for (let i = 0; i < k; i++) {
        let mi;
        do { mi = Math.floor(Math.random() * NMOVES); } while ((mi >> 1) === lastAxis);
        lastAxis = mi >> 1;
        B.push(mi);
      }
      const T2 = E.copy(target);
      for (let i = B.length - 1; i >= 0; i--) E.applyMoveIdx(T2, B[i] ^ 1);
      const sol = descend(T2, dist);
      if (!sol) continue;
      const out = [];
      for (let i = sol.moves.length - 1; i >= 0; i--) pushMove(out, sol.moves[i] ^ 1);
      for (const mi of B) pushMove(out, mi);
      if (out.length >= MASK_MIN && out.length <= MASK_MAX) return toWCA(out);
    }
    // fallback: plain inverted randomized-optimal (length = d0)
    const sol = descend(target, dist);
    if (!sol) return null;
    const out = [];
    for (let i = sol.moves.length - 1; i >= 0; i--) pushMove(out, sol.moves[i] ^ 1);
    return toWCA(out);
  }

  // uniform random reachable state (~1/3 of slots are reachable)
  function randomReachable(dist) {
    let ix;
    do { ix = Math.floor(Math.random() * NSLOTS); } while (dist[ix] < 0);
    return E.unidx(ix);
  }

  // ---------- first layer ----------
  // A face's layer = its center + its 2 axis corners + its 2 free corners.
  // Axis corners never move, so "solved relative to each other" has no extra
  // freedom: the predicate is exact per face. Slot table (validated against
  // AXIS=['UBR','UFL','DFR','DBL'], FREE=['UFR','UBL','DFL','DBR']):
  const FACE_LAYER = {
    U: { free: [0, 1], axis: [0, 1] },
    D: { free: [2, 3], axis: [2, 3] },
    F: { free: [0, 2], axis: [1, 2] },
    B: { free: [1, 3], axis: [0, 3] },
    R: { free: [0, 3], axis: [0, 2] },
    L: { free: [1, 2], axis: [1, 3] },
  };
  const FIDX = Object.fromEntries(E.FACES.map((f, i) => [f, i]));

  function layerSolved(s, f) {
    const L = FACE_LAYER[f];
    if (s.ctr[FIDX[f]] !== FIDX[f]) return false;
    for (const i of L.axis) if (s.fx[i] !== 0) return false;
    for (const i of L.free) if (s.fp[i] !== i || s.fo[i] !== 0) return false;
    return true;
  }
  const anyLayerSolved = (s) => E.FACES.find((f) => layerSolved(s, f)) || null;

  // goal seeds: every reachable state with face f's layer solved = scramble the
  // complement (other 2 free slots, other 5 centers, other 2 axis twists)
  function layerSeedSpec(f) {
    const L = FACE_LAYER[f];
    return {
      corners: [0, 1, 2, 3].filter((i) => !L.free.includes(i)),
      centers: [0, 1, 2, 3, 4, 5].filter((i) => i !== FIDX[f]),
      fixedTwists: [0, 1, 2, 3].filter((i) => !L.axis.includes(i)),
    };
  }
  function flSeedIndices() {
    const seen = new Set();
    for (const f of E.FACES) {
      for (const st of E.enumFreeSlots(layerSeedSpec(f))) seen.add(E.idx(st));
    }
    return [...seen];
  }

  // multi-source BFS: distance from every reachable state to the nearest
  // any-layer-solved state. Same shape as OOTables.loadOrBuildDist's BFS.
  async function buildFLDist(report, tick) {
    const g = new Int8Array(NSLOTS).fill(-1);
    let frontier = Uint32Array.from(flSeedIndices());
    for (const ix of frontier) g[ix] = 0;
    let d = 0, seen = frontier.length;
    const REACHABLE = 3149280;
    while (frontier.length) {
      const next = [];
      for (let fi = 0; fi < frontier.length; fi++) {
        const s = E.unidx(frontier[fi]);
        for (let mi = 0; mi < NMOVES; mi++) {
          const t = E.copy(s); E.applyMoveIdx(t, mi);
          const ix = E.idx(t);
          if (g[ix] === -1) { g[ix] = d + 1; next.push(ix); }
        }
        if ((fi & 8191) === 8191) { if (report) report('bfs', seen + next.length, REACHABLE); if (tick) await tick(); }
      }
      d++; seen += next.length;
      frontier = Uint32Array.from(next);
      if (report) report('bfs', seen, REACHABLE);
      if (tick) await tick();
    }
    return g;
  }

  // ---------- one-look ----------
  // "Layer length" problems: a uniform state whose nearest layer (any face)
  // is exactly n moves away — rejection over the slot range. The thinnest
  // fibers (n=0 and n=6) are still ~1 in 2100 slots, so the cap is generous.
  function randomAtFLDist(fldist, n) {
    for (let t = 0; t < 4000000; t++) {
      const ix = Math.floor(Math.random() * NSLOTS);
      if (fldist[ix] === n) return E.unidx(ix);
    }
    return null;
  }

  // "Fixed layer solution" problems — solved PHYSICALLY, at the facelet level.
  //
  // The old state-level construction (X = β(Y) with β a native realization of
  // A⁻¹) is engine-true but physically wrong: the cube a human holds after
  // executing the scramble TEXT is toFixedFacelets(X), not raw toFacelets(X) —
  // every written free-corner letter (WCA B / NS b) parks a 240° whole-cube
  // rotation in the parsing frame — so with a net walk the user's sequence hit
  // a rotated cube (USER report 2026-07-13: solution "U" needed a physical L,
  // layer landed off-bottom; machine repro pinned in test-trainer).
  //
  // Correct spec: after the scramble text T and then the user's sequence S the
  // HAND must show a D-solved pattern. held(T) = toFixedFacelets(state(T)) for
  // every rotation-free WCA text (engine-guaranteed), so with Φ = the physical
  // facelet perm of S we need toFixedFacelets(X) = Φ⁻¹(raw(Y)) — and the end
  // pattern in hand is EXACTLY raw(Y), the drawn case, layer on the bottom.
  //
  // Two vocabulary limits keep that equation solvable (enforced by physPermOf):
  //  - no whole-cube rotation tokens (their letters differ physically between
  //    WCA / engine / sheet conventions — ground truth §Notation notes);
  //  - no NS F/R/L/f: those twist the half CONTAINING the fixed white/red/
  //    green (UFL) corner, and no rotation-free scramble text can deliver the
  //    UFL-displaced preimages they need. WCA R/U/L/B and NS r/B/l/b all stay
  //    inside the UFL-pristine orbit. Machine-verified 2026-07-13.
  //
  // Y is drawn from the D-solved states with fx[UFL] = 0 — the ones whose raw
  // pattern is physically reachable in hand (raw = fixed frame there).
  // facelet perm algebra comes from the engine (single source)
  const pApplyFl = E.applyFaceletPerm;
  const pThenFl = E.permThen;
  const pInvFl = E.permInv;
  const flEq = (a, b) => a.every((v, i) => v === b[i]);
  const UFL_AX = E.AXIS.indexOf('UFL');
  // physical half-twist perms of the letters the layer vocabulary allows
  // (TNoodle-anchored engine perms; every other corner is rejected above)
  const TWISTS = {
    UBR: E.moveFaceletPerm.UBR, DFR: E.moveFaceletPerm.DFR,
    DBL: E.moveFaceletPerm.DBL, DBR: E.WCA_FACELET_MOVES.B,
  };
  // the physical facelet perm of a parsed sequence, or an error tag:
  // 'rot' (rotation token) / 'ufl' (a letter that moves the UFL corner)
  function physPermOf(parsed) {
    let P = null;
    for (const t of parsed) {
      if (t.kind === 'rot') return { err: 'rot' };
      if (t.kind !== 'move') continue;
      const tw = TWISTS[t.c];
      if (!tw) return { err: 'ufl' };
      for (let k = 0; k < t.amt; k++) P = P ? pThenFl(P, tw) : tw.slice();
    }
    return P ? { phi: P } : { err: 'empty' };
  }

  let dSeedIdx = null;
  function randomDLayerState() {
    if (!dSeedIdx) {
      dSeedIdx = [];
      for (const st of E.enumFreeSlots(layerSeedSpec('D'))) {
        if (st.fx[UFL_AX] === 0) dSeedIdx.push(E.idx(st));
      }
    }
    return E.unidx(dSeedIdx[Math.floor(Math.random() * dSeedIdx.length)]);
  }
  // X such that a human who executes any scramble text reaching X and then the
  // sequence with physical perm phi holds raw(Y): scan the ≤3 pinned readings
  // of the required hand pattern for the reachable one whose fixed frame is it.
  function preimageOfLayer(phi, Y, dist) {
    const H = pApplyFl(E.toFacelets(Y), pInvFl(phi));
    let fl = H;
    for (let k = 0; k < 3; k++, fl = E.applyFaceletPerm(fl, E.ROT240_UFL)) {
      let X; try { X = E.fromFacelets(fl); } catch (e) { continue; }
      if (dist[E.idx(X)] >= 0 && flEq(E.toFixedFacelets(X), H)) return X;
    }
    return null;
  }

  // ---------- partial-view recognition (center-case quiz) ----------
  // A case's non-FL pieces: the 5 centers off the solved layer (FL = D in every
  // case state; y presentations keep it there) and the 4 upper corner slots.
  // The quiz view shows the WHOLE first layer ("assume a layer is solved") plus
  // a user-chosen 3-center combo, optionally plus 2 random upper corners.
  const RECOG_CENTERS = ['U', 'R', 'F', 'L', 'B'];
  const RECOG_CORNERS = ['UBR', 'UFL', 'UFR', 'UBL'];
  // slot indices derived from the engine's tetrad orders, not hand-copied
  const AXIS_SLOT = { UBR: E.AXIS.indexOf('UBR'), UFL: E.AXIS.indexOf('UFL') };
  const FREE_SLOT = { UFR: E.FREE.indexOf('UFR'), UBL: E.FREE.indexOf('UBL') };
  const FL_CORNERS = ['DFR', 'DBL', 'DFL', 'DBR']; // + the D center

  function pickCorners() {
    const pool = RECOG_CORNERS.slice(), out = [];
    for (let i = 0; i < 2; i++) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    return out.sort();
  }

  // everything the view's visible pieces say about the state — two states look
  // identical through the view iff their signatures match. view = { centers,
  // corners, fl } (fl: the whole D layer is visible).
  function viewSignature(st, view) {
    const parts = [];
    if (view.fl) {
      parts.push('flc' + st.ctr[FIDX.D]);
      parts.push('flx' + st.fx[2] + st.fx[3]);
      parts.push('flf' + st.fp[2] + '.' + st.fo[2] + ',' + st.fp[3] + '.' + st.fo[3]);
    }
    for (const f of view.centers) parts.push('c' + f + st.ctr[FIDX[f]]);
    for (const c of view.corners) {
      if (c in AXIS_SLOT) parts.push('x' + c + st.fx[AXIS_SLOT[c]]);
      else parts.push('f' + c + st.fp[FREE_SLOT[c]] + '.' + st.fo[FREE_SLOT[c]]);
    }
    return parts.join('|');
  }

  // ---------- center-case quiz answers ----------
  // The quiz answers with the sheets' center-case names, but resolves each
  // case's answer from the centers its diagram actually SHOWS (the anchor
  // view — the quiz pins d = 0) wherever the subset's labels are a pure
  // function of the center permutation. Machine-verified 2026-07-13, pinned
  // in test-trainer:
  //   EG2 — Pi/Peanut labels <-> the 60 D-anchored center perms is a
  //         bijection at the anchor view; the sheet's L5C column drops the
  //         direction letter (U1/U2/Z) and labels the centers-solved case
  //         'H', so L5C answers resolve through the Pi/Peanut map (adding
  //         no options beyond the 24 Pi/Peanut labels). The quiz then folds
  //         the eight directional U labels (U1/U2 x l/f/r/b) into one 'U'
  //         answer and each numbered pair (O1/O2, S1/S2, TS1/TS2, W1/W2,
  //         X1/X2, Z1/Z2, ZC1/ZC2) into its stem (USER decisions 2026-07-13:
  //         side/direction is not a recognition distinction) — 10 quiz
  //         options.
  //   NS  — class labels are sig-pure once the sheet's lumped "H or Z Perm
  //         (and Pure Peanut)" rows are split into the three patterns they
  //         actually contain (H Perm / Z Perm / Solved); the map then covers
  //         all 60 perms, so L4C/L5C cases (authored with no centerPattern)
  //         get real answers too. 'L5C 137a' has twisted corners and
  //         off-anchor centers — not a centers case, stays unquizzable.
  //   TCLL — center labels also encode twist/pseudo context (the same
  //         center perm reads 'Z1' or 'FRl' by corner situation), so
  //         authored labels are used verbatim.
  const answerFieldOf = (c) => c.centerPattern || c.center || null;
  // seed cases: those whose authored label is authoritative for its center perm
  const CENTER_SEEDS = { EG2: (c) => c.corner !== 'L5C', NS: (c) => !!c.centerPattern };
  // quiz-only label merges: sheet labels that name ONE recognition class.
  // EG2's U-perm family (U1/U2 x l/f/r/b, plus L5C's bare U1/U2) all answer
  // 'U', and each numbered pair (O1/O2 … ZC1/ZC2) answers its stem.
  const CENTER_FOLDS = {
    EG2: (l) => {
      if (/^U[12][lfrb]?$/.test(l)) return 'U';
      const m = /^(ZC|TS|[OSWXZ])[12]$/.exec(l);
      return m ? m[1] : l;
    },
  };
  const foldLabel = (sub, l) => (l && CENTER_FOLDS[sub.key] ? CENTER_FOLDS[sub.key](l) : l);

  // structural names for the patterns inside NS's lumped H-or-Z rows
  function hzsName(ctr) {
    const moved = [];
    for (let i = 0; i < 6; i++) if (ctr[i] !== i) moved.push(i);
    if (!moved.length) return 'Solved';
    if (moved.length === 4 && moved.every((i) => ctr[ctr[i]] === i))
      return moved.every((i) => ctr[i] === (i + 3) % 6) ? 'H Perm' : 'Z Perm'; // FACES pairs U/D R/L F/B sit 3 apart
    return null;
  }

  // per-subset center-perm -> label map; pure=false means labels are not
  // sig-determined (or seeds conflicted) and authored labels must be trusted
  const vocabCache = new Map();
  function centerVocab(sub) {
    let v = vocabCache.get(sub.key);
    if (v) return v;
    const seedOk = CENTER_SEEDS[sub.key];
    const map = new Map();
    let pure = !!seedOk;
    if (seedOk) {
      for (const c of sub.cases) {
        const raw = answerFieldOf(c);
        if (!raw || !seedOk(c)) continue;
        const st = stateForDir(c, 0);
        if (!st) continue;
        const key = st.ctr.join(',');
        const label = foldLabel(sub, /^H or Z\b/.test(raw) ? (hzsName(st.ctr) || raw) : raw);
        if (map.has(key) && map.get(key) !== label) { pure = false; break; }
        map.set(key, label);
      }
    }
    v = { pure, map };
    vocabCache.set(sub.key, v);
    return v;
  }

  // the case's quiz answer, or null if it has none (not a centers case)
  function quizAnswer(sub, c) {
    const v = centerVocab(sub);
    if (!v.pure) return foldLabel(sub, answerFieldOf(c));
    const st = stateForDir(c, 0);
    return (st && v.map.get(st.ctr.join(','))) || null;
  }

  // facelet indices to HIDE so only the view's pieces stay visible. Trainer
  // diagrams render in the engine's pinned frame (netSVG opts.pinned — solved
  // layer stays visually on the bottom), so raw sticker positions ARE display
  // positions and no re-anchor compensation is needed.
  function maskForView(st, view) {
    const visible = new Set();
    const addCorner = (c) => {
      for (const g of E.FACES) {
        const ix = E.STICKER_POS[g].indexOf(c);
        if (ix >= 0) visible.add(FIDX[g] * 5 + 1 + ix);
      }
    };
    if (view.fl) { visible.add(FIDX.D * 5); for (const c of FL_CORNERS) addCorner(c); }
    for (const f of view.centers) visible.add(FIDX[f] * 5);
    for (const c of view.corners) addCorner(c);
    const mask = new Set();
    for (let p = 0; p < 30; p++) if (!visible.has(p)) mask.add(p);
    return mask;
  }

  // ---------- persisted-state descriptor (storage key skewb-trainer-v1) ----------
  // ONE table describes every persisted field: how to validate/coerce it on
  // read and how to serialize it on write. The component derives its reader
  // patch, its persist payload, and its stats-reset override from this —
  // adding a field means adding one row here + one binding in the component.
  // A read returning undefined SKIPS the field (unknown/legacy blobs keep
  // being ignored field-by-field, never migrated).
  const readTimeStats = (v) => {
    if (!v || typeof v !== "object") return undefined;
    const out = {};
    for (const [k, st] of Object.entries(v)) if (st && typeof st.n === "number" && typeof st.sum === "number") out[k] = st;
    return out;
  };
  const readGradeStats = (v) => {
    if (!v || typeof v !== "object") return undefined;
    const out = {};
    for (const [k, st] of Object.entries(v)) if (st && typeof st.n === "number" && typeof st.hit === "number") out[k] = st;
    return out;
  };
  const okSol = (s) => s && typeof s.raw === "string" && s.raw.length <= 200 && (s.nota === "wca" || s.nota === "ns");
  const PERSIST_FIELDS = {
    subsetSel:    { read: (v) => Array.isArray(v) ? v.filter((k) => typeof k === "string") : undefined },
    groupSel:     { read: (v) => (v && typeof v === "object") ? v : undefined },
    caseOff:      { read: (v) => Array.isArray(v) ? new Set(v.filter((x) => typeof x === "string")) : undefined, write: (v) => [...v] },
    caseKnown:    { read: (v) => Array.isArray(v) ? new Set(v.filter((x) => typeof x === "string")) : undefined, write: (v) => [...v] },
    scope:        { read: (v) => ["all", "learning", "known"].includes(v) ? v : undefined },
    mode:         { read: (v) => ["drill", "recap", "recog", "onelook"].includes(v) ? v : undefined },
    setupOpen:    { read: (v) => typeof v === "boolean" ? v : undefined },
    caseStats:    { read: readTimeStats, stat: true },
    recogStats:   { read: readGradeStats, stat: true },
    centersStats: { read: readGradeStats, stat: true },
    recogView:    { read: (v) => (v === "full" || v === "centers") ? v : undefined },
    centerSel:    { read: (v) => { if (!Array.isArray(v)) return undefined; const cs = v.filter((f) => RECOG_CENTERS.includes(f)).slice(0, 3); return cs.length ? cs : undefined; } },
    cornersOn:    { read: (v) => typeof v === "boolean" ? v : undefined },
    onelookView:  { read: (v) => (v === "len" || v === "sol") ? v : undefined },
    onelookLen:   { read: (v) => (Number.isInteger(v) && v >= 0 && v <= 6) ? v : undefined },
    onelookSols:  { read: (v, d) => {
        if (Array.isArray(v)) return v.filter(okSol).slice(0, 24).map((s) => ({ raw: s.raw, nota: s.nota, on: s.on !== false }));
        if (okSol(d.onelookSol)) return [{ raw: d.onelookSol.raw, nota: d.onelookSol.nota, on: true }]; // pre-list blobs stored one solution
        return undefined;
      } },
    onelookStats: { read: readGradeStats, stat: true },
  };
  // stored JSON string -> patch of validated field values ({} for a foreign blob)
  function readStoredState(raw) {
    let d = null;
    try { d = JSON.parse(raw); } catch (e) { return {}; }
    if (!d || typeof d !== "object") return {};
    const patch = {};
    for (const [k, f] of Object.entries(PERSIST_FIELDS)) {
      const v = f.read(d[k], d);
      if (v !== undefined) patch[k] = v;
    }
    return patch;
  }
  // current field values -> the JSON-ready storage object
  function writeStoredState(values) {
    const out = {};
    for (const [k, f] of Object.entries(PERSIST_FIELDS)) out[k] = f.write ? f.write(values[k]) : values[k];
    return out;
  }
  // the persist override that clears every stat field (Reset all stats)
  const STAT_RESET = {};
  for (const [k, f] of Object.entries(PERSIST_FIELDS)) if (f.stat) STAT_RESET[k] = {};

  return {
    buildModel, navSorted, casePres, stateForDir, algsForDir, firstMoveOf, caseOfState,
    maskedScramble, randomReachable, descend, descentLines, toWCA,
    layerSolved, anyLayerSolved, layerSeedSpec, flSeedIndices, buildFLDist,
    randomAtFLDist, randomDLayerState, preimageOfLayer, physPermOf,
    centerVocab, quizAnswer,
    pickCorners, viewSignature, maskForView,
    readStoredState, writeStoredState, STAT_RESET, PERSIST_KEYS: Object.keys(PERSIST_FIELDS),
    MASK_MIN, MASK_MAX, RECOG_CENTERS, RECOG_CORNERS,
  };
}
