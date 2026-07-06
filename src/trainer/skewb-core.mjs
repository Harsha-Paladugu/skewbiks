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
 *   - the first-layer predicate + goal-distance table for full-solve analysis
 *
 * Plain .mjs so Node tests (tools/test-trainer.mjs) can import it with the
 * documented window-stub engine recipe; esbuild bundles it natively.
 */

export const DIRS = ['Front', 'Right', 'Back', 'Left'];
export const Y_PREFIX = ['', 'y', 'y2', "y'"]; // rotation chip for a k-quarter offset
export const SEP = '\u001f';                   // id separator (case names are free-form)

export const RATING_RANK = { best: 0, neutral: 1, poor: 3 };
export const rateRank = (a) => (a && RATING_RANK[a.rating] !== undefined) ? RATING_RANK[a.rating] : 2;

const isRotTok = (t) => /^[xyz](2'|2|')?$/.test(t);
export function stripPostRot(alg) { // trailing whole-cube rotations are cosmetic
  const toks = String(alg).trim().split(/\s+/).filter(Boolean);
  while (toks.length && isRotTok(toks[toks.length - 1])) toks.pop();
  return toks.join(' ');
}

// The sheets' first-move letter convention (see js/algs.js / import-method-sheets.mjs).
export const FM_ORDER = ['r', "r'", 'R', "R'", 'B', "B'", 'b', "b'"];
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

  function firstMoveOf(row) {
    if (row.a && row.a.firstMove) return row.a.firstMove;
    const flat = E.nsToWCA(E.wcaToNS(row.core)) || row.core;
    const m = String(flat).trim().split(/\s+/)[0].match(/^([ULRB])(2'|2|')?$/);
    return m ? SHEET_FM[m[1]] + ((m[2] === "'" || m[2] === '2') ? "'" : '') : '';
  }

  // ---------- moves / scrambles ----------
  const NMOVES = E.MOVES.length; // 8 native moves; mi>>1 = axis, mi^1 = inverse
  const toWCA = (mis) => mis.length ? E.nativeToWCA(mis.map((i) => E.MOVES[i]).join(' ')) : '';

  // randomized optimal descent of a distance-like table (0 = goal). Returns
  // native move indices, plus the goal state it lands on.
  function descend(state, table) {
    let cur = E.copy(state);
    let cd = table[E.idx(cur)];
    if (cd < 0) return null;
    const path = [];
    while (cd > 0) {
      const opts = [];
      for (let mi = 0; mi < NMOVES; mi++) {
        const t = E.copy(cur); E.applyMoveIdx(t, mi);
        if (table[E.idx(t)] === cd - 1) opts.push([mi, t]);
      }
      const pick = opts[Math.floor(Math.random() * opts.length)];
      path.push(pick[0]);
      cur = pick[1];
      cd--;
    }
    return { moves: path, end: cur };
  }

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

  // Full-solve analysis: the direct-optimal picture plus a method-shaped
  // first-layer decomposition (best FL line by total = FL + optimal finish,
  // over up to `cap` optimal-FL descents).
  function analyze(state, dist, fldist, cap = 64) {
    const direct = dist[E.idx(state)];
    if (direct < 0) return null;
    const lines = descentLines(state, dist, 24).map((l) => ({ alg: toWCA(l.moves), moves: l.moves }));
    const out = { direct, lines, method: null };
    if (fldist) {
      const flLen = fldist[E.idx(state)];
      let best = null;
      for (const l of descentLines(state, fldist, cap)) {
        const finish = dist[E.idx(l.end)];
        if (!best || flLen + finish < best.total) {
          best = { flLen, finish, total: flLen + finish, flMoves: l.moves, face: anyLayerSolved(l.end), end: l.end };
        }
      }
      if (best) {
        const fin = descend(best.end, dist);
        out.method = {
          flLen: best.flLen, finish: best.finish, total: best.total, face: best.face,
          flAlg: toWCA(best.flMoves), finishAlg: fin ? toWCA(fin.moves) : '',
        };
      }
    }
    return out;
  }

  // where (if ever) a line (native move indices) first completes a layer,
  // strictly before its end
  function lineLayerSplit(state, moves) {
    const cur = E.copy(state);
    for (let n = 0; n < moves.length - 1; n++) {
      E.applyMoveIdx(cur, moves[n]);
      const f = anyLayerSolved(cur);
      if (f) return { at: n + 1, face: f };
    }
    return null;
  }

  // ---------- partial (3-centers + 2-corners) recognition ----------
  // A case's non-FL pieces: the 5 centers off the solved layer (FL = D in every
  // case state; y presentations keep it there) and the 4 upper corner slots.
  // Machine-checked premise (2026-07-06): WITHIN a corner group (Pi/Peanut/…,
  // TCLL sign+corner — context a solver knows from building FL), any 3 centers
  // + 2 corners identify the case ≥99.9% uniquely (worst collision: one pair);
  // ACROSS groups it is far weaker (TCLL ~1%), so reveals list pool matches.
  const RECOG_CENTERS = ['U', 'R', 'F', 'L', 'B'];
  const RECOG_CORNERS = ['UBR', 'UFL', 'UFR', 'UBL'];
  const AXIS_SLOT = { UBR: 0, UFL: 1 };
  const FREE_SLOT = { UFR: 0, UBL: 1 };

  function pickView() {
    const pick = (arr, k) => {
      const pool = arr.slice(), out = [];
      for (let i = 0; i < k; i++) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      return out.sort();
    };
    return { centers: pick(RECOG_CENTERS, 3), corners: pick(RECOG_CORNERS, 2) };
  }

  // everything the chosen pieces' stickers say about the state — two states
  // look identical through the view iff their signatures match
  function viewSignature(st, view) {
    const parts = [];
    for (const f of view.centers) parts.push('c' + f + st.ctr[FIDX[f]]);
    for (const c of view.corners) {
      if (c in AXIS_SLOT) parts.push('x' + c + st.fx[AXIS_SLOT[c]]);
      else parts.push('f' + c + st.fp[FREE_SLOT[c]] + '.' + st.fo[FREE_SLOT[c]]);
    }
    return parts.join('|');
  }

  // Diagrams render through toFixedFacelets, which re-anchors the display by
  // rotating 240°×fx[UFL] about the UFL–DBR diagonal — so a piece's RAW facelet
  // positions and its DISPLAYED positions differ when fx[UFL] ≠ 0. Rebuild that
  // rotation from exported members (mirrors engine.js ROT240_UFL: the deep-cut
  // identity  written-B = native-UFL-move · rotation) and map positions through
  // it; test-trainer pins this against toFixedFacelets on random states.
  const _rot240 = (() => {
    const inv = new Array(30);
    for (let i = 0; i < 30; i++) inv[E.moveFaceletPerm.UFL[i]] = i;
    const r = new Array(30);
    for (let i = 0; i < 30; i++) r[i] = inv[E.WCA_FACELET_MOVES.B[i]];
    return r;
  })();
  // rawPos -> displayed facelet index, for this state's display anchoring
  function displayPosMap(st) {
    const k = ((st.fx[AXIS_SLOT.UFL] % 3) + 3) % 3;
    let Rk = Array.from({ length: 30 }, (_, i) => i);   // display[i] = raw[Rk[i]]
    for (let t = 0; t < k; t++) Rk = _rot240.map((ri) => Rk[ri]);
    const dmap = new Array(30);
    for (let i = 0; i < 30; i++) dmap[Rk[i]] = i;
    return dmap;
  }

  // display-space indices to HIDE so only the view's pieces stay visible
  function maskForView(st, view) {
    const visible = new Set();
    for (const f of view.centers) visible.add(FIDX[f] * 5);
    for (const c of view.corners) {
      for (const g of E.FACES) {
        const ix = E.STICKER_POS[g].indexOf(c);
        if (ix >= 0) visible.add(FIDX[g] * 5 + 1 + ix);
      }
    }
    const dmap = displayPosMap(st);
    const mask = new Set();
    for (let p = 0; p < 30; p++) if (!visible.has(p)) mask.add(dmap[p]);
    return mask;
  }

  return {
    buildModel, navSorted, casePres, stateForDir, algsForDir, firstMoveOf,
    maskedScramble, randomReachable, descend, descentLines, toWCA,
    layerSolved, anyLayerSolved, layerSeedSpec, flSeedIndices, buildFLDist,
    analyze, lineLayerSplit,
    pickView, viewSignature, maskForView, displayPosMap,
    MASK_MIN, MASK_MAX, RECOG_CENTERS, RECOG_CORNERS,
  };
}
