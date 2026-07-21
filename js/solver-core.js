/* Skewbiks.com — Method solver core: first-step targets, sheet-alg finishes. */
(function(){const module={exports:{}};
/* Skewb OO — method solver core (no DOM; testable in node).
   Methods = first-step target spaces derived from the imported method sheets
   (machine-probed against data/skewb_algs.json, 2026-07-07 — every NS/EG2/TCLL
   case state sits in its method's space, minus 5 known sheet outliers):
   - fl:   a first layer solved on some face (the NS / Sarah's first step).
           540 states per face, 3,110 distinct; max distance 6 from anywhere.
   - tcll: a layer built with exactly ONE of its two free corners twisted in
           place (the TCLL pre-state; layer axis corners and center clean).
           2,160 per face, 11,964 distinct; max distance 6.
   - eg2:  a layer built with the free-corner pairs swapped (EG2 pre-state:
           the layer face reads solved, its free corners exchanged — which
           forces the opposite pair swapped too). 540 per face, 3,204; max 7.
   A solution = a first step P that reaches an enabled target within its cap,
   then one of the sheet's algorithms with its LEADING rotation tokens folded
   into the printed setup rotation (USER revision 2026-07-07: the one printed
   rotation must be exactly what brings the cube to where the alg's first
   turn starts; from the first turn on the text is verbatim, mid-alg
   rotations included). Score = MOVECOUNT as listed (first step + algorithm;
   rotations are free, no junction-cancellation bookkeeping).
   Fingertrick/ergonomic metrics are deliberately absent for now.

   PHYSICAL MODEL (the load-bearing part — reworked 2026-07-07 after the
   USER's junctions falsified the engine-frame derivation): the finish index
   and the printed setup rotation live in PHYSICAL facelet space, not in the
   engine's frame machinery. The engine reads letters correctly from
   identity starts only (corpus-validated over all imported texts); behind a
   rotation prefix its frame-walk resolution is NOT what a human does, so
   "which states this text solves from a rotated hold" and "which rotation
   sets it up" must be computed physically: letters twist the corner at a
   FIXED hand position, rotation tokens turn the cube about fixed spatial
   axes (this reading solves 3,082/3,082 imported texts from their identity
   pre-states; the grip-relative alternative solves 641). A body T with
   physical perm Φ solves, from setup rotation R, exactly the junctions J
   with Φ(R(J)) solved in ANY orientation — so the index stores Φ⁻¹ of the
   24 solved orientations per text, a junction is matched by looking up its
   24 rotations, and the printed rotation IS the matching R, spelled in the
   sheets' letters (sheet x/y/z = physical z/y/x′ — the letters this
   community actually reads; engine x/y/z are physically inverted and are
   never shown). USER-validated on three junctions: y′ z, y x′, y2 z.

   DISPLAY (methodView): the whole line reads in RubiksSkewb notation —
   [lead rotation] [first layer in the sheet vocabulary {R,B,r,b}]
   [setup rotation] [finish alg]. The first layer never uses L/l/F/f (each
   space diagonal has a right-side name), the lead rotation puts the built
   layer on the bottom (like the sheets/trainer), and the whole line is
   re-proved by the facelet check in methodView (USER requirement 2026-07-10).

   THE HOLD (USER bug report 2026-07-10, scramble B' R L U' L' B' R' U'): the
   line must be derived from the facelets the human ACTUALLY HOLDS after
   executing the scramble TEXT — physPerm of the parsed scramble — not from
   the pinned state's raw facelets. Every written free-corner letter (WCA B,
   NS R/L/f/b) leaves a 240° whole-cube rotation that the engine absorbs into
   its parsing frame (see engine.js ROT240_UFL), so the real cube in hand is
   G-rotated relative to toFacelets(state), G = the text's accumulated
   leftover rotation. methodView therefore takes the held facelets and emits
   the layer from the orientation G∘lead while printing just the lead — the
   USER's physically-executed counterexample (printed y′ failed, x worked) is
   pinned in test:solver. State-only callers default to the raw facelets
   (G = identity), which reproduces the pre-fix behaviour exactly. */
/* ---------- method registry (module-level: no E/dist dependency) ---------- */
// Names are the display labels used by the solver page and the tuning lab;
// METHOD_PRIORITY is the display tie-break order. Caps default to the
// machine-measured max distance (+1 for fl, the primary method, so slightly
// indirect layers are still found).
const METHOD_DEFS = {
  fl:   { name: 'Layer', cap: 7 },
  tcll: { name: 'TCLL',  cap: 6 },
  eg2:  { name: 'EG2',   cap: 7 },
};
const METHOD_PRIORITY = ['fl', 'tcll', 'eg2'];

function makeSolverCore(E, dist, algData) {
  const NMOVES = E.MOVES.length;              // 8 native moves; m>>1 = axis, m^1 = inverse
  const syms = E.buildSyms();
  const rotBy = E.makeFrames(syms);

  /* ---------- frames (display only — written letters resolve through them) ---------- */
  const FACES = E.FACES;
  const ALLC = Object.keys(E.CPOS);
  const faceSetOf = {}; for (const c of ALLC) faceSetOf[c] = E.CFACES[c].slice().sort().join('');
  function cornerMapOf(fp) {
    const m = {};
    for (const c of ALLC) {
      const set = E.CFACES[c].map(f => fp[f]).sort().join('');
      m[c] = ALLC.find(d => faceSetOf[d] === set);
    }
    return m;
  }
  const frameOf = fp => ({ fp, corner: cornerMapOf(fp) });
  const ID_FRAME = frameOf(E.FACE_ID);
  const BYC_FP = {}; for (const A of Object.keys(rotBy.byCorner)) BYC_FP[A] = rotBy.byCorner[A].fp;
  // native move index -> the axis corner it twists (mirrors engine MOVE_AXIS)
  const NATIVE_AXIS = ['UBR', 'UBR', 'DBL', 'DBL', 'DFR', 'DFR', 'UFL', 'UFL'];

  /* ---------- the physical model (facelet space; TNoodle-anchored) ---------- */
  // Letters twist the corner at a FIXED hand position; rotation tokens turn
  // the cube about fixed spatial axes. Machine-discriminated 2026-07-07:
  // this fixed-axes reading solves all 3,082 imported texts from their
  // identity pre-states (the grip-relative alternative solves 641), and it
  // reproduced the USER's three physically-executed junction rotations.
  // Corner twists and rotations are facelet perms; the construction is
  // anchored to the TNoodle-validated engine perms (asserted below).
  const FIDX = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };
  const FNORM = { U: [0,1,0], R: [1,0,0], F: [0,0,1], D: [0,-1,0], L: [-1,0,0], B: [0,0,-1] };
  const vkey = v => v.map(Math.round).join(',');
  const FACE_BY_N = {}; for (const f of FACES) FACE_BY_N[vkey(FNORM[f])] = f;
  const CORNER_BY_P = {}; for (const c of ALLC) CORNER_BY_P[vkey(E.CPOS[c])] = c;
  const dot3 = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  const cross3 = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const cornerFacesOf = c => FACES.filter(f => dot3(FNORM[f], E.CPOS[c]) > 0);
  const stickerAt = (face, corner) => FIDX[face]*5 + 1 + E.STICKER_POS[face].indexOf(corner);
  const ID30 = Array.from({ length: 30 }, (_, i) => i);
  const pThen = (P, Q) => Q.map(q => P[q]);       // "apply P, then Q" (dst<-src maps)
  const pInv = P => { const r = new Array(30); for (let i = 0; i < 30; i++) r[P[i]] = i; return r; };
  const pPow = (P, n) => { let r = ID30; for (let i = 0; i < n; i++) r = pThen(r, P); return r; };
  const pApply = (fl, P) => P.map(src => fl[src]);
  const flKey = fl => fl.join('');                // facelet colors 0..5 -> 30 chars
  const permKey = p => p.join(',');
  // all 8 corner-twist perms (the engine ships only the 4 native axis ones)
  function twistPerm(A) {
    const p = E.CPOS[A], n = Math.sqrt(3), k = [p[0]/n, p[1]/n, p[2]/n];
    const ct = -0.5, st = -Math.sqrt(3)/2;        // native direction (TNoodle-pinned)
    const rot = v => { const kxv = cross3(k, v), kv = dot3(k, v);
      return [0, 1, 2].map(i => ct*v[i] + st*kxv[i] + (1-ct)*k[i]*kv); };
    const half = ALLC.filter(c => c === A || E.CPOS[c].filter((v, i) => v === p[i]).length === 2);
    const map = ID30.slice();
    for (const f of cornerFacesOf(A)) map[FIDX[FACE_BY_N[vkey(rot(FNORM[f]))]]*5] = FIDX[f]*5;
    for (const c of half) { const c2 = CORNER_BY_P[vkey(rot(E.CPOS[c]))];
      for (const f of cornerFacesOf(c)) map[stickerAt(FACE_BY_N[vkey(rot(FNORM[f]))], c2)] = stickerAt(f, c);
    }
    return map;
  }
  const TWIST = {}; for (const c of ALLC) TWIST[c] = twistPerm(c);
  for (const A of E.AXIS) if (permKey(TWIST[A]) !== permKey(E.moveFaceletPerm[A])) throw new Error('twist perm mismatch: ' + A);
  if (permKey(TWIST.DBR) !== permKey(E.WCA_FACELET_MOVES.B)) throw new Error('twist perm mismatch: DBR');
  // physical whole-cube quarter rotations (WCA sticker movement: x F->U, y F->L, z U->R)
  const rotPermOf = map3 => {
    const m = ID30.slice();
    for (const f of FACES) m[FIDX[FACE_BY_N[vkey(map3(FNORM[f]))]]*5] = FIDX[f]*5;
    for (const c of ALLC) for (const f of cornerFacesOf(c))
      m[stickerAt(FACE_BY_N[vkey(map3(FNORM[f]))], CORNER_BY_P[vkey(map3(E.CPOS[c]))])] = stickerAt(f, c);
    return m;
  };
  const PHYS_XYZ = {
    x: rotPermOf(v => [v[0], v[2], -v[1]]),
    y: rotPermOf(v => [-v[2], v[1], v[0]]),
    z: rotPermOf(v => [v[1], -v[0], v[2]]),
  };
  // engine rot letters denote the physical INVERSE of the same-name rotation
  const ENG_ROT_PHYS = { x: pInv(PHYS_XYZ.x), y: pInv(PHYS_XYZ.y), z: pInv(PHYS_XYZ.z) };
  // physical execution perm of a parsed token list from an identity start,
  // reading rotation tokens as ENGINE letters (tokens carry .c = the corner a
  // move letter names). NEVER use this on authored `ns` sheet texts — their
  // rotation letters are SHEET letters; use physPermNS below, or you repeat
  // the 2026-07-10 bug that silently mis-indexed all 916 mid-rotation finish
  // bodies. physPerm is only for engine-letter strings the core writes itself
  // (e.g. LEAD engStr) and for WCA-field scramble texts.
  function physPerm(toks) {
    let C = ID30;
    for (const t of toks)
      C = pThen(C, t.kind === 'rot' ? pPow(ENG_ROT_PHYS[t.f], t.amt) : pPow(TWIST[t.c], t.amt));
    return C;
  }
  // The 24 orientations with their SHEET-letter spellings, nicest first
  // (identity, y-family singles, then pairs — the letters the sheets and
  // their solvers actually read: sheet x/y/z = physical z/y/x').
  const SHEET_PHYS = { x: PHYS_XYZ.z, y: PHYS_XYZ.y, z: pInv(PHYS_XYZ.x) };
  // physical execution perm of a parsed SHEET text (the authored `ns` fields
  // are VERBATIM sheet strings — import-method-sheets keeps the source
  // untouched): move letters twist fixed hand positions exactly like
  // physPerm, but rotation tokens are the sheets' letters, not the engine's.
  // Machine-established 2026-07-10: of the imported texts with MID-alg
  // rotation tokens, 916 solve their WCA-field case state ONLY under this
  // reading and ZERO under the engine reading (the remaining 12 are the
  // unparseable slash-alternative texts) — so every machine consumer of an
  // ns text must use THIS perm; physPerm is for engine-letter strings the
  // core writes itself (LEAD engStr).
  function physPermNS(toks) {
    let C = ID30;
    for (const t of toks)
      C = pThen(C, t.kind === 'rot' ? pPow(SHEET_PHYS[t.f], t.amt) : pPow(TWIST[t.c], t.amt));
    return C;
  }
  const sheetStrPerm = str => String(str).split(/\s+/).filter(Boolean).reduce((C, tok) => {
    const m = tok.match(/^([xyz])(2'|2|')?$/);
    if (!m) throw new Error('not a rotation token: ' + tok);
    return pThen(C, pPow(SHEET_PHYS[m[1]], m[2] === "'" ? 3 : m[2] ? 2 : 1));
  }, ID30);
  const SHEET_SINGLES = [];
  for (const a of ['y', 'x', 'z']) for (const suf of ['', "'", '2']) SHEET_SINGLES.push(a + suf);
  const ROT24 = [{ perm: ID30.slice(), spell: '' }];
  const seenRot = new Set([permKey(ID30)]);
  const addRot = spell => {
    const p = sheetStrPerm(spell), k = permKey(p);
    if (!seenRot.has(k)) { seenRot.add(k); ROT24.push({ perm: p, spell }); }
  };
  for (const t of SHEET_SINGLES) addRot(t);
  for (const a of SHEET_SINGLES) for (const b of SHEET_SINGLES) addRot(a + ' ' + b);
  if (ROT24.length !== 24) throw new Error('expected 24 orientations, got ' + ROT24.length);
  const SOLVED_FL = E.solvedFacelets();
  const SOLVED24 = ROT24.map(r => pApply(SOLVED_FL, r.perm));
  const SOLVED24_KEYS = new Set(SOLVED24.map(flKey));
  /* ---------- the first-step (layer) emitter, RubiksSkewb notation ---------- */
  // The layer is written the way the sheets write algorithms: NS notation, and
  // ONLY the four right-side corner letters {R, B, r, b} — one name per space
  // diagonal, so every skewb move is expressible without ever needing L/l/F/f
  // (USER requirement 2026-07-10). For each native move: the direct axis
  // letter if an allowed corner sits on it, else the opposite corner + a
  // frame walk (the same resolution applyParsed uses). `frame` is the hold the
  // writing is relative to, so a non-identity start frame is spelled as a
  // leading rotation.
  const NS_RIGHT = { R: 'UFR', B: 'UBR', r: 'DFR', b: 'DBR' };   // NS letter -> corner
  const NS_RIGHT_L = Object.keys(NS_RIGHT);
  function emitNS(mis, frame) {
    frame = frame || ID_FRAME;
    const out = [];
    for (const mi of mis) {
      const axis = NATIVE_AXIS[mi], amt = (mi & 1) ? 2 : 1;
      let w = NS_RIGHT_L.find(l => frame.corner[NS_RIGHT[l]] === axis);        // direct axis letter
      if (w) { out.push(w + (amt === 2 ? "'" : '')); continue; }
      w = NS_RIGHT_L.find(l => E.OPP[frame.corner[NS_RIGHT[l]]] === axis);     // opposite corner + walk
      if (!w) throw new Error('frame resolution failed');
      out.push(w + (amt === 2 ? "'" : ''));
      for (let k = 0; k < amt % 3; k++) frame = frameOf(E.faceCompose(BYC_FP[axis], frame.fp));
    }
    return { tokens: out, frame };
  }

  // Leading-rotation candidates for the layer, nicest sheet spelling first
  // (methodView picks the first that lands the built layer on the bottom).
  // Each carries the engine frame the moves are emitted from + verified in,
  // and the sheet spelling shown to the human — engine rotations are internal,
  // sheet rotations are read at the table (both denote the same orientation).
  const engFrameOf = engStr => {
    let fp = E.FACE_ID;
    for (const t of String(engStr).split(/\s+/).filter(Boolean)) {
      const m = t.match(/^([xyz])(2'|2|')?$/), n = m[2] === "'" ? 3 : m[2] ? 2 : 1;
      for (let i = 0; i < n; i++) fp = E.faceCompose(fp, rotBy.xyz[m[1]].fp);
    }
    return frameOf(fp);
  };
  const ENG_SINGLES = [];
  for (const a of ['y', 'x', 'z']) for (const suf of ['', "'", '2']) ENG_SINGLES.push(a + suf);
  const engByPhys = new Map([[permKey(physPerm([])), '']]);
  const addEng = engStr => { const k = permKey(physPerm(E.parseAlg(engStr, 'ns'))); if (!engByPhys.has(k)) engByPhys.set(k, engStr); };
  for (const t of ENG_SINGLES) addEng(t);
  for (const a of ENG_SINGLES) for (const b of ENG_SINGLES) addEng(a + ' ' + b);
  if (engByPhys.size !== 24) throw new Error('expected 24 engine rotations, got ' + engByPhys.size);
  const LEAD = ROT24.map(r => {
    const engStr = engByPhys.get(permKey(r.perm));
    return { sheet: r.spell, engStr, frame: engFrameOf(engStr) };
  });
  const LEAD_BY_KEY = new Map(ROT24.map((r, i) => [permKey(r.perm), LEAD[i]]));

  // The facelets a human holds after physically executing a parsed scramble —
  // methodView's `heldFl`. Differs from toFacelets(state) by the scramble
  // text's accumulated leftover rotation (a property of the TEXT, not the
  // state: written free-corner letters each leave a 240° whole-cube rotation
  // the engine absorbs into its parsing frame).
  const heldFacelets = parsed => pApply(SOLVED_FL, physPerm(parsed));

  /* ---------- first-step target spaces ---------- */
  // D-anchored states per method (the complement of the built layer is free,
  // subject to the two reachability constraints — see the engine header), then
  // expanded over the 12 proper rotations into Map(stateIdx -> layer face).
  function dAnchored(kind) {
    const out = [];
    const others = [0, 1, 2, 4, 5];                     // non-D center positions
    // free perm + layer free-corner twist options per kind (slots 2=DFL, 3=DBR)
    const fp = kind === 'eg2' ? [1, 0, 3, 2] : [0, 1, 2, 3];
    const foDs = kind === 'tcll' ? [[1, 0], [2, 0], [0, 1], [0, 2]] : [[0, 0]];
    for (const perm of E.permsOf(others)) {
      const ctr = [0, 0, 0, 3, 0, 0];
      others.forEach((pos, i) => { ctr[pos] = perm[i]; });
      if (E.permParity(ctr) !== 0) continue;            // centers reach A6 only
      for (const [fo2, fo3] of foDs) {
        for (let fo0 = 0; fo0 < 3; fo0++) {
          const fo1 = (3 - (fo0 + fo2 + fo3) % 3) % 3;  // free twists sum to 0 (mod 3)
          for (let fx0 = 0; fx0 < 3; fx0++) {
            // linking: sum(fx) === class(fp) === 0 for both id and the V4 swap
            const fx1 = (3 - fx0 % 3) % 3;
            out.push({ ctr: ctr.slice(), fx: [fx0, fx1, 0, 0], fp: fp.slice(), fo: [fo0, fo1, fo2, fo3] });
          }
        }
      }
    }
    return out;
  }
  function buildTargets() {
    const maps = {};
    for (const id of Object.keys(METHOD_DEFS)) {
      const m = new Map();
      const states = dAnchored(id);
      for (const rot of syms.rots) {
        const face = rot.fp.D;                          // where the built layer sits
        for (const s of states) {
          const ix = E.idx(rot.apply(s));
          if (!m.has(ix)) m.set(ix, face);
        }
      }
      maps[id] = m;
    }
    return maps;
  }
  const targets = buildTargets();

  /* ---------- the sheet-alg finish index ---------- */
  // stateKey -> [entry] over EVERY alg's text evaluated from all 24 whole-
  // cube holds: each entry records the exact state "hold-rotation + text"
  // solves and that hold's frame. A junction is then matched by plain state
  // lookup and the display rotation derived exactly — WHICH hold executes a
  // text is a property of the TEXT (mid-alg rotations and free-corner
  // letters make the frame machinery non-conjugation-equivariant), so it
  // cannot be guessed from the layer position. The indexed and displayed
  // text is the authored `ns` field with its LEADING rotation tokens folded
  // away: they are the author's setup, not execution, so the derived display
  // rotation absorbs them and lands directly on the alg's first turn.
  // Folding is exact — dropping a leading rotation only shifts WHICH hold
  // matches, and all 24 are swept, so the solved-state set is unchanged.
  // From the first turn on the text is what the Algorithms page lists; the
  // rotationless `alg` conversion only counts moves. Built lazily (~1–2 s).
  const RATE_RANK = { best: 0, neutral: 1, poor: 3 };
  const rateRank = r => (r.rating in RATE_RANK ? RATE_RANK[r.rating] : 2) + (r.suspect ? 10 : 0);
  // Cut the leading rotation tokens out of a text. Texts containing any
  // grouping/comma character never fold (a cleanup there could eat a paren
  // that belongs to the BODY and ship an unbalanced text — post-review
  // finding 2026-07-07; the shipped data has zero such texts). For plain
  // space-separated texts raw tokens map 1:1 onto parsed tokens, so the cut
  // is a token slice — and the remainder must still re-parse to exactly the
  // un-cut token tail, else the authored text stands untouched.
  function foldLeadRots(text, toks) {
    let lead = 0;
    while (lead < toks.length && toks[lead].kind === 'rot') lead++;
    if (lead && lead < toks.length && !/[()[\]，,]/.test(text)) {
      const parts = String(text).trim().split(/\s+/);
      if (parts.length === toks.length) {
        const s = parts.slice(lead).join(' ');
        const chk = E.parseAlg(E.preprocessAlg(s), 'ns');
        if (chk && JSON.stringify(chk) === JSON.stringify(toks.slice(lead)))
          return { ns: s, nsToks: chk };
      }
    }
    return { ns: text, nsToks: toks };
  }
  let _algIndex = null;
  function algIndex() {
    if (_algIndex) return _algIndex;
    _algIndex = new Map();
    const conts = algData ? [algData.subsets || {}, algData.other_subsets || {}] : [];
    for (const cont of conts) {
      for (const key of Object.keys(cont)) {
        const sub = cont[key];
        for (const c of sub.cases || []) {
          (c.algs || []).forEach((a, ai) => {
            const authored = a.ns || a.alg;             // the text as the algs page lists it
            // 34 slash-alternate texts ("r'/r2") don't parse and are skipped —
            // their cases carry other algs. Movecount = the text's own move
            // tokens (the sheets sometimes write R R where the conversion
            // says R2); rotations never count, so folding doesn't change it.
            const toks = E.parseAlg(E.preprocessAlg(authored), 'ns');
            if (!toks) return;
            const { ns, nsToks } = foldLeadRots(authored, toks);
            const phi = physPermNS(nsToks);             // the body's physical action
            // (physPermNS, not physPerm: ns texts are verbatim sheet strings,
            // so mid-alg rotation tokens are SHEET letters — reading them as
            // engine letters mis-indexed all 916 mid-rotation bodies and
            // printed physically wrong setup rotations for them, found
            // 2026-07-10 while reworking the Algorithms page display)
            const row = {
              uid: key + '::' + c.name + '::' + ai,
              ns, moves: E.countMoves(nsToks), phi,
              name: key === c.name ? c.name : key + ' · ' + c.name,
              rating: a.rating || '', suspect: !!a.suspect,
            };
            // the text physically solves (before any setup rotation) exactly
            // Φ⁻¹ of the 24 solved orientations — a finish may leave the cube
            // solved in ANY orientation; leading rotations changed nothing
            // here (they only permute SOLVED24), which is why the fold above
            // is exact
            const inv = pInv(phi);
            const seenStates = new Set();
            for (const S of SOLVED24) {
              const k = flKey(pApply(S, inv));
              if (seenStates.has(k)) continue;          // symmetric texts repeat states
              seenStates.add(k);
              let list = _algIndex.get(k);
              if (!list) { list = []; _algIndex.set(k, list); }
              list.push(row);
            }
            row.preKeys = seenStates;                   // per-row set, for rotation choice
          });
        }
      }
    }
    for (const list of _algIndex.values())
      list.sort((a, b) => rateRank(a) - rateRank(b) || a.moves - b.moves || (a.uid < b.uid ? -1 : 1));
    return _algIndex;
  }

  /* ---------- the search ---------- */
  // search(scrambleState, opts) -> { byLength: {total: [items]}, dopt, truncated, work }
  // opts: { methods:{id:bool}, caps:{id:int}, budget }
  // item: { pmoves:[ints], id, face, v, fin, total, row|null }
  //   row = the finishing sheet alg (null when the first step already solves);
  //   the display rotations are derived per solution in methodView.
  function search(scr, opts) {
    const caps = {};
    for (const id of Object.keys(METHOD_DEFS))
      caps[id] = Number.isFinite(opts.caps && opts.caps[id]) ? opts.caps[id] : METHOD_DEFS[id].cap;
    const ids = Object.keys(METHOD_DEFS).filter(id => opts.methods[id]);
    const budget = opts.budget || 8e6;
    const dopt = dist[E.idx(scr)];
    const capMax = Math.max(0, ...ids.map(id => caps[id]));
    let work = 0, truncated = false;

    // phase 1: DFS enumerating first-step prefixes; junctions by state idx
    const junctions = new Map();              // ix -> { state, paths: [{seq, hits:[id]}] }
    const dfs1 = (s, seq, lastAxis) => {
      if (++work > budget) { truncated = true; return; }
      const ix = E.idx(s);
      const hits = [];
      for (const id of ids) if (seq.length <= caps[id] && targets[id].has(ix)) hits.push(id);
      if (hits.length) {
        let j = junctions.get(ix);
        if (!j) { j = { state: E.copy(s), paths: [] }; junctions.set(ix, j); }
        j.paths.push({ seq: seq.slice(), hits });
      }
      if (seq.length >= capMax) return;
      for (let m = 0; m < NMOVES; m++) {
        if ((m >> 1) === lastAxis) continue;
        const t = E.copy(s); E.applyMoveIdx(t, m);
        seq.push(m);
        dfs1(t, seq, m >> 1);
        seq.pop();
        if (truncated) return;
      }
    };
    dfs1(scr, [], -1);

    // phase 2: match each junction against the sheet algs that solve it — a
    // junction J is solved by alg Φ from SOME setup rotation iff one of the 24
    // rotations of J is in Φ's physical pre-state set. Membership is
    // rotation-closed, so this is a property of the junction alone; the actual
    // display rotations (the leading rotation that builds the layer on the
    // bottom, and the finish setup rotation) are derived per solution in
    // methodView, which physically re-proves the whole line.
    const index = algIndex();
    const byLength = {};
    const seen = new Set();
    if (!truncated) for (const [ti, j] of junctions) {
      const solvedJ = dist[ti] === 0;
      let matches = null;
      if (!solvedJ) {
        matches = [];
        const jArr = E.toFacelets(j.state);
        const seenRow = new Set();
        for (const r of ROT24) {
          const list = index.get(flKey(pApply(jArr, r.perm)));
          if (!list) continue;
          for (const row of list) { if (!seenRow.has(row.uid)) { seenRow.add(row.uid); matches.push(row); } }
        }
      }
      for (const p of j.paths) for (const id of p.hits) {
        const face = targets[id].get(ti);
        const pkey = p.seq.join(',') + '|' + id + '|';
        if (solvedJ) {
          if (p.seq.length && !seen.has(pkey)) {
            seen.add(pkey);
            const item = { pmoves: p.seq.slice(), id, face, v: p.seq.length, fin: 0, total: p.seq.length, row: null };
            (byLength[item.total] = byLength[item.total] || []).push(item);
          }
          continue;
        }
        for (const row of matches) {
          const kk = pkey + row.uid;
          if (seen.has(kk)) continue;
          seen.add(kk);
          const item = { pmoves: p.seq.slice(), id, face, v: p.seq.length, fin: row.moves,
                         total: p.seq.length + row.moves, row };
          (byLength[item.total] = byLength[item.total] || []).push(item);
        }
      }
    }
    // organize by movecount; within a bucket: shortest first step, then the
    // sheet's own ranking (rating; suspects last), then stable order
    for (const L of Object.keys(byLength))
      byLength[L].sort((a, b) => a.v - b.v
        || (a.row ? rateRank(a.row) : -1) - (b.row ? rateRank(b.row) : -1)
        || METHOD_PRIORITY.indexOf(a.id) - METHOD_PRIORITY.indexOf(b.id)
        || (a.row && b.row ? (a.row.uid < b.row.uid ? -1 : 1) : 0)
        || (a.pmoves.join() < b.pmoves.join() ? -1 : 1));
    return { byLength, dopt, truncated, work };
  }

  /* ---------- method view (the staged reconstruction) ---------- */
  // Builds the whole line the way a solver reads it, all in RubiksSkewb
  // notation:  [lead rotation]  [first layer in R/B/r/b]  [setup rotation]
  //            [finish alg].
  // `heldFl` is the facelets the human actually holds after scrambling — the
  // site passes heldFacelets(parsed scramble); state-only callers default to
  // the raw pinned facelets (identical when the scramble text has no written
  // free-corner letters). The two differ by a whole-cube rotation G, so the
  // display and the engine bookkeeping split: the layer tokens are emitted
  // (and engine-verified against the junction) from the orientation G∘lead,
  // while the printed lead is what the human turns from their real hold.
  // The lead rotation is chosen so the built layer ends on the bottom (like
  // the sheets and the trainer); the layer is emitted in the sheet vocabulary
  // {R,B,r,b}; the setup rotation then turns to the finish alg's hold. Every
  // displayed line is physically re-proved end to end from the held facelets:
  //  - the emitted layer engine-lands exactly on the junction state, and
  //  - the facelets a human holds after physically executing [lead][layer]
  //    from heldFl, turned by the setup rotation and pushed through the
  //    finish's physical perm, are a solved cube (in any orientation).
  function methodView(scr, item, heldFl) {
    const rawFl = E.toFacelets(scr);
    heldFl = heldFl || rawFl;
    // G: raw pinned facelets -> the hold in hand (exists for every hold that
    // really is this state; a mismatched heldFl just fails every proof below)
    const G = ROT24.find(r => flKey(pApply(rawFl, r.perm)) === flKey(heldFl)) || null;
    const emitFrom = rhoD => G && LEAD_BY_KEY.get(permKey(pThen(G.perm, rhoD.perm)));
    const jState = E.copy(scr);
    for (const m of item.pmoves) E.applyMoveIdx(jState, m);

    if (!item.row) {   // the first step already solves the puzzle — no layer/finish
      // no lead needed: a solved cube is solved in any orientation, so the
      // emission from G's own orientation always physically solves from heldFl
      const cand = emitFrom(ROT24[0]);
      let first = '', endFl = null, parsed = null;
      if (cand) {
        try { first = emitNS(item.pmoves, cand.frame).tokens.join(' '); } catch (e) { first = ''; }
        parsed = first ? E.parseAlg(E.preprocessAlg((cand.engStr ? cand.engStr + ' ' : '') + first), 'ns') : null;
        // physical result from heldFl of executing `first` == raw ∘ [engStr][first]
        if (parsed) endFl = pApply(rawFl, physPerm(parsed));
      }
      const ok = !!(parsed && E.eq(E.applyParsed(parsed, E.copy(scr), syms, rotBy), E.solved())
                    && endFl && SOLVED24_KEYS.has(flKey(endFl)));
      const q = ok ? FACES.find(f => endFl[FIDX[f] * 5] === FIDX[item.face]) : item.face;
      return { first, lead: '', rot: '', alg: '', name: null, rating: '', suspect: false, face: q, text: first, ok };
    }

    const jFl = E.toFacelets(jState);
    // ROT24 rotation ρ relating the pinned junction facelets to what the human
    // physically holds after [lead][layer]; the built layer then sits on ρ(item.face)
    const rotBetween = jPhys => ROT24.find(r => flKey(pApply(jFl, r.perm)) === flKey(jPhys)) || null;
    const layerFaceUnder = rho => FACES.find(f => rho.perm[FIDX[f] * 5] === FIDX[item.face] * 5);

    // pick the leading rotation: nicest that lands the layer on the bottom
    // (fall back to the nicest valid emission if — never observed — none does)
    let best = null;
    if (G) for (const rhoD of ROT24) {
      const cand = emitFrom(rhoD);
      let tokens;
      try { tokens = emitNS(item.pmoves, cand.frame).tokens; } catch (e) { continue; }
      const engLine = (cand.engStr ? cand.engStr + ' ' : '') + tokens.join(' ');
      const parsed = E.parseAlg(E.preprocessAlg(engLine), 'ns');
      if (!parsed || !E.eq(E.applyParsed(parsed, E.copy(scr), syms, rotBy), jState)) continue;
      // physical hold after executing [rhoD][tokens] from heldFl — equals the
      // raw-side evaluation because physPerm(engStr) is exactly G∘rhoD
      const jPhys = pApply(rawFl, physPerm(parsed));
      const rho = rotBetween(jPhys);
      if (!rho) continue;
      const entry = { rhoD, first: tokens.join(' '), jPhys, face: layerFaceUnder(rho) };
      if (!best) best = entry;                 // fallback = first valid emission
      if (entry.face === 'D') { best = entry; break; }
    }

    // finish setup rotation: nicest R with R(held junction) in the alg's pre-state set
    let R = null, rot = '';
    if (best) for (const r of ROT24)
      if (item.row.preKeys.has(flKey(pApply(best.jPhys, r.perm)))) { R = r.perm; rot = r.spell; break; }
    const okBody = !!(best && R) && SOLVED24_KEYS.has(flKey(pApply(pApply(best.jPhys, R), item.row.phi)));
    const first = best ? best.first : '';
    const lead = best ? best.rhoD.spell : '';
    const text = [lead, first, rot, item.row.ns].filter(Boolean).join(' ');
    return { first, lead, rot, alg: item.row.ns, name: item.row.name, rating: item.row.rating,
             suspect: item.row.suspect, face: best ? best.face : item.face, text, ok: okBody };
  }

  /* ---------- sheet-text display helpers (the Algorithms page) ---------- */
  // The pictured hold of a case group: the raw pinned facelets — the hold the
  // authored texts physically execute from — rotated by the nicest sheet
  // rotation so the built layer sits on D when the state lies in one of the
  // method spaces (fl/tcll/eg2). `rotated: false` means the picture IS the
  // raw pinned frame; states outside every method space (odd-position alg
  // groups + the 5 sheet outliers) fall back to it.
  let _dSets = null;   // per method: the D-anchored state idx set (layer ON D)
  const dSets = () => _dSets || (_dSets = Object.keys(METHOD_DEFS).map(id => {
    const s = new Set();
    for (const st of dAnchored(id)) s.add(E.idx(st));
    return s;
  }));
  function layerDownFacelets(state) {
    const raw = E.toFacelets(state);
    const ix = E.idx(state);
    // already layer-down? check D-anchored membership directly — the targets
    // map keeps only ONE face per state, so a multi-layer state near solved
    // can report a non-D face even though a built layer sits on D
    if (dSets().some(s => s.has(ix))) return { fl: raw, rotated: false };
    let face = null;
    for (const id of Object.keys(METHOD_DEFS)) {
      const f = targets[id].get(ix);
      if (f) { face = f; break; }
    }
    if (!face) return { fl: raw, rotated: false };
    for (const r of ROT24)                    // picture's D shows the layer face
      if (r.perm[FIDX.D * 5] === FIDX[face] * 5) return { fl: pApply(raw, r.perm), rotated: true };
    return { fl: raw, rotated: false };       // unreachable: some rotation always maps face->D
  }

  // Display line for one authored text from the pictured hold `heldFl`:
  //   1. the text verbatim when it physically solves from the picture (always
  //      true when the picture is the raw pinned frame — the sheets' own
  //      leading rotations are the correct start there);
  //   2. else the folded body behind the nicest re-derived lead rotation
  //      (`rederived: true`) — the picture was rotated, so the start changes;
  //   3. else ok:false (unparseable slash-alternative texts; the caller shows
  //      the authored text and flags it).
  // `notation` is passed to parseAlg ('ns' for authored sheet texts — the
  // default — 'wca' for rotationless admin-added algs).
  function sheetLineFor(heldFl, text, notation) {
    const toks = E.parseAlg(E.preprocessAlg(text), notation === 'wca' ? undefined : 'ns');
    if (!toks) return { text: String(text), ok: false };
    if (SOLVED24_KEYS.has(flKey(pApply(heldFl, physPermNS(toks)))))
      return { text: String(text), ok: true };
    const { ns, nsToks } = foldLeadRots(String(text), toks);
    const phi = physPermNS(nsToks), inv = pInv(phi);
    const pre = new Set(SOLVED24.map(S => flKey(pApply(S, inv))));
    for (const r of ROT24)
      if (pre.has(flKey(pApply(heldFl, r.perm))))
        return { text: [r.spell, ns].filter(Boolean).join(' '), ok: true, rederived: true };
    return { text: String(text), ok: false };
  }

  // physPerm reads ENGINE rotation letters, physPermNS reads SHEET letters —
  // authored `ns` texts MUST go through physPermNS (see their doc comments).
  return { emitNS, LEAD, ROT24, physPerm, physPermNS, sheetStrPerm, heldFacelets, SOLVED24_KEYS, flKey, pApply, pInv,
           foldLeadRots, targets, dAnchored, algIndex, search, methodView, METHOD_DEFS, syms, rotBy,
           layerDownFacelets, sheetLineFor };
}
if (typeof module !== 'undefined') module.exports = { makeSolverCore, METHOD_DEFS, METHOD_PRIORITY };
window.OOSolverCore=module.exports;})();
