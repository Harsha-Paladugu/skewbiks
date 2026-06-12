/* Pyraminx.net — Pyraminx engine: full no-tips state space, moves, rotations, parsing. */
(function(){const module={exports:{}};
// Pyraminx OO engine — full no-tips state space (933,120 states), 12 rotations + LR mirror.
// State: { e:[piece,flip]x6 slots, c:[L,R,B] axial twists, u: U axial twist }
// Slots: 0=UL 1=UR 2=UB 3=DF 4=DL 5=DR  (face pairs in XO below)
// Faces: F, Lf, Rf, D.  Corners (move axes): U,L,R,B — corner X is opposite face OPP[X].

const FACES = ['F', 'Lf', 'Rf', 'D'];
const XO = [['F','Lf'],['F','Rf'],['Lf','Rf'],['F','D'],['Lf','D'],['Rf','D']];
const OPP = { U:'D', L:'Rf', R:'Lf', B:'F' };           // corner -> opposite face
const COPP = { D:'U', Rf:'L', Lf:'R', F:'B' };          // face -> opposite corner

// Move tables (validated against the trainer's engine over 1561 sheet algorithms)
const S4 = {
  U: { cyc: [[0,2,0],[2,1,1],[1,0,1]], center: -1 },
  R: { cyc: [[1,5,0],[5,3,1],[3,1,1]], center: 1 },
  L: { cyc: [[0,3,1],[3,4,1],[4,0,0]], center: 0 },
  B: { cyc: [[2,4,1],[4,5,1],[5,2,0]], center: 2 },
};
// Whole-puzzle rotations about each corner axis: how FACES move (one CW step)
const G4 = {
  U: { F:'Lf', Lf:'Rf', Rf:'F', D:'D' },
  R: { F:'Rf', Rf:'D', D:'F', Lf:'Lf' },
  L: { F:'D', D:'Lf', Lf:'F', Rf:'Rf' },
  B: { Lf:'D', D:'Rf', Rf:'Lf', F:'F' },
};

function solved() { return { e: [0,0,1,0,2,0,3,0,4,0,5,0], c: [0,0,0], u: 0 }; }
function copy(s) { return { e: s.e.slice(), c: s.c.slice(), u: s.u }; }
function eq(a, b) { return a.u === b.u && a.e.join() === b.e.join() && a.c.join() === b.c.join(); }

// prime=false: one CW turn.  U also twists the U axial center (tracked in .u).
function move(s, f, prime) {
  const n = prime ? 2 : 1;
  for (let k = 0; k < n; k++) {
    const r = s.e.slice();
    for (const [i, o, fl] of S4[f].cyc) { s.e[o*2] = r[i*2]; s.e[o*2+1] = r[i*2+1] ^ fl; }
    if (S4[f].center >= 0) s.c[S4[f].center] = (s.c[S4[f].center] + 1) % 3;
    else s.u = (s.u + 1) % 3;
  }
  return s;
}
const MOVES = ['U',"U'",'L',"L'",'R',"R'",'B',"B'"];
function applyMoveIdx(s, m) { return move(s, MOVES[m][0], MOVES[m].length > 1); }

// ---------------- indexing ----------------
// index = ((permRank720 * 64 + flipBits) * 27 + c) * 3 + u   — 3,732,480 slots, 933,120 reachable
const FACT = [1,1,2,6,24,120,720];
function permRank(p) {
  let r = 0; const a = p.slice();
  for (let i = 0; i < 6; i++) {
    let m = 0; for (let j = i+1; j < 6; j++) if (a[j] < a[i]) m++;
    r += m * FACT[5 - i];
  }
  return r;
}
function permUnrank(r) {
  const avail = [0,1,2,3,4,5], p = [];
  for (let i = 5; i >= 0; i--) { const d = Math.floor(r / FACT[i]); r %= FACT[i]; p.push(avail.splice(d,1)[0]); }
  return p;
}
function idx(s) {
  const p = [s.e[0],s.e[2],s.e[4],s.e[6],s.e[8],s.e[10]];
  let fb = 0; for (let i = 0; i < 6; i++) fb |= s.e[i*2+1] << i;
  const c = s.c[0]*9 + s.c[1]*3 + s.c[2];
  return ((permRank(p)*64 + fb)*27 + c)*3 + s.u;
}
function unidx(ix) {
  const u = ix % 3; ix = (ix - u) / 3;
  const c = ix % 27; ix = (ix - c) / 27;
  const fb = ix % 64; const pr = (ix - fb) / 64;
  const p = permUnrank(pr), e = new Array(12);
  for (let i = 0; i < 6; i++) { e[i*2] = p[i]; e[i*2+1] = (fb >> i) & 1; }
  return { e, c: [Math.floor(c/9), Math.floor(c/3)%3, c%3], u };
}
const NSLOTS = 720*64*27*3;

// ---------------- symmetries ----------------
// A face permutation sigma induces: slot map, flip-toggle per slot, corner map.
// flip rule: new flip = old flip ^ rev[slot] ^ rev[pieceHomeSlot]  (validated below by
// the homomorphism test sigma(m·s) == sigma(m)·sigma(s) over all generators).
function faceCompose(a, b) { const r = {}; for (const f of FACES) r[f] = a[b[f]]; return r; }
const FACE_ID = { F:'F', Lf:'Lf', Rf:'Rf', D:'D' };

function slotOf(a, b) {
  for (let i = 0; i < 6; i++) {
    if (XO[i][0] === a && XO[i][1] === b) return [i, 0];
    if (XO[i][0] === b && XO[i][1] === a) return [i, 1];
  }
  throw new Error('bad pair ' + a + ',' + b);
}
function symFromFacePerm(fp, mirror) {
  const slot = new Array(6), rev = new Array(6);
  for (let i = 0; i < 6; i++) {
    const [a, b] = XO[i];
    const [j, r] = slotOf(fp[a], fp[b]);
    slot[i] = j; rev[i] = r;
  }
  // corner map via face opposition: corner X -> COPP[ fp[ OPP[X] ] ]
  const corner = {};
  for (const x of ['U','L','R','B']) corner[x] = COPP[fp[OPP[x]]];
  return { fp, slot, rev, corner, mirror: !!mirror };
}
function applySym(sym, s) {
  const o = { e: new Array(12), c: [0,0,0], u: 0 };
  for (let i = 0; i < 6; i++) {
    const pc = s.e[i*2], fl = s.e[i*2+1];
    o.e[sym.slot[i]*2] = sym.slot[pc];
    o.e[sym.slot[i]*2+1] = fl ^ sym.rev[i] ^ sym.rev[pc];
  }
  const tw = { L: s.c[0], R: s.c[1], B: s.c[2], U: s.u };
  const out = {};
  for (const x of ['U','L','R','B']) {
    let t = tw[x];
    if (sym.mirror) t = (3 - t) % 3;
    out[sym.corner[x]] = t;
  }
  o.c = [out.L, out.R, out.B]; o.u = out.U;
  return o;
}
// move letter mapping under a symmetry: physical axis follows the corner map;
// a mirror also inverts the turn direction.
function symMoveIdx(sym, m) {
  const f = MOVES[m][0], pr = MOVES[m].length > 1;
  const nf = sym.corner[f];
  const npr = sym.mirror ? !pr : pr;
  return MOVES.indexOf(nf + (npr ? "'" : ''));
}

// generate the 12 rotations (A4 on faces) + the LR mirror
function buildSyms() {
  const seen = new Map(); const queue = [FACE_ID];
  seen.set(JSON.stringify(FACE_ID), FACE_ID);
  while (queue.length) {
    const fp = queue.pop();
    for (const g of ['U','R','L','B']) {
      const nf = faceCompose(G4[g], fp);
      const k = JSON.stringify(nf);
      if (!seen.has(k)) { seen.set(k, nf); queue.push(nf); }
    }
  }
  const rots = [...seen.values()].map(fp => symFromFacePerm(fp, false));
  if (rots.length !== 12) throw new Error('expected 12 rotations, got ' + rots.length);
  const mirrorFp = { F:'F', Lf:'Rf', Rf:'Lf', D:'D' };
  const mirrors = rots.map(r => symFromFacePerm(faceCompose(r.fp, mirrorFp), true));
  return { rots, mirrors, all: rots.concat(mirrors) };
}

// ---------------- canonicalization ----------------
function makeCanon(syms) {
  return function canon(s) {
    let best = Infinity;
    for (const sym of syms.rots) { const v = idx(applySym(sym, s)); if (v < best) best = v; }
    return best;
  };
}
function makeMirrorCanon(syms) {
  return function mcanon(s) {
    let best = Infinity;
    for (const sym of syms.mirrors) { const v = idx(applySym(sym, s)); if (v < best) best = v; }
    return best;
  };
}

// ---------------- BFS distance table ----------------
function bfs(progress) {
  const dist = new Int8Array(NSLOTS).fill(-1);
  let frontier = [solved()];
  dist[idx(solved())] = 0;
  let d = 0, total = 1;
  while (frontier.length) {
    const next = [];
    for (const s of frontier) for (let m = 0; m < 8; m++) {
      const t = copy(s); applyMoveIdx(t, m);
      const i = idx(t);
      if (dist[i] === -1) { dist[i] = d + 1; next.push(t); }
    }
    d++; total += next.length;
    if (progress) progress(d, next.length, total);
    frontier = next;
  }
  return dist;
}

// ---------------- solution / scramble parsing ----------------
// Tokens: U L R B (+' or 2), wides Uw Lw Rw Bw (1 move), rotations [u] [l] [r] [b] / y (0 moves),
// lowercase u l r b = tips -> dropped. X2 == X'. Wides follow the sheet convention:
// Rw = L [l'],  Lw = R [r'],  Uw = B [b'],  Bw = U [u'].
const WIDE = { R: ['L','L'], L: ['R','R'], U: ['B','B'], B: ['U','U'] }; // [moveLetter, rotAxis] with inverse rotation
function parseAlg(str) {
  const out = []; // {kind:'move'|'rot', f, amt(1|2), wide}
  const toks = String(str).replace(/[()，,]/g, ' ').trim().split(/\s+/).filter(Boolean);
  for (let t of toks) {
    if (!t) continue;
    let m;
    if ((m = t.match(/^\[([ulrb])(2|')?\]$/))) { // rotation [u] [l'] [r2]...
      out.push({ kind: 'rot', f: m[1].toUpperCase(), amt: m[2] === '2' || m[2] === "'" ? 2 : 1 });
      continue;
    }
    if ((m = t.match(/^(y)(2|')?$/))) { out.push({ kind: 'rot', f: 'U', amt: m[2] ? 2 : 1 }); continue; }
    if ((m = t.match(/^([ULRB])w(2|')?$/))) {
      out.push({ kind: 'move', f: m[1], amt: m[2] ? 2 : 1, wide: true });
      continue;
    }
    if ((m = t.match(/^([ULRB])(2|')?$/))) {
      out.push({ kind: 'move', f: m[1], amt: m[2] ? 2 : 1, wide: false });
      continue;
    }
    if (/^[ulrb](2|')?$/.test(t)) continue; // tip move -> dropped
    return null; // unparseable token
  }
  return out;
}
function countMoves(parsed) { let n = 0; for (const t of parsed) if (t.kind === 'move') n++; return n; }

// Apply parsed tokens to a state, tracking the rotation frame.
// frame: face-perm mapping written letters to physical axes via corner map.
function makeFrames(syms) {
  // Rotation about corner X, one step in the SAME direction as move X, as a sym object.
  // Anchored to the move tables: move X's edge cycle dictates where each adjacent corner
  // travels under the whole-puzzle rotation [x]; we pick the sym whose frame behavior
  // (through the same composeSym path applyParsed uses) matches that geometry.
  const EDGE_CORNER = { U: { 0: 'L', 1: 'R', 2: 'B' }, L: { 0: 'U', 3: 'R', 4: 'B' },
                        R: { 1: 'U', 3: 'L', 5: 'B' }, B: { 2: 'U', 4: 'L', 5: 'R' } };
  const OPP_FACE = { U: 'D', L: 'Rf', R: 'Lf', B: 'F' };
  const ID = symFromFacePerm(FACE_ID, false);
  const rotByCorner = {};
  for (const x of ['U', 'L', 'R', 'B']) {
    const mv = solved(); move(mv, x, false);
    const slots = Object.keys(EDGE_CORNER[x]).map(Number);
    const posHolds = {}; // position W -> physical corner that lands there under [x]
    for (const p of slots) {
      let j = -1;
      for (const q of slots) if (mv.e[q * 2] === p) { j = q; break; }
      posHolds[EDGE_CORNER[x][j]] = EDGE_CORNER[x][p];
    }
    let pick = null;
    for (const sym of syms.rots) {
      if (sym.fp[OPP_FACE[x]] !== OPP_FACE[x]) continue;
      if (FACES.every(f => sym.fp[f] === f)) continue;
      const frame = composeSym(sym, ID); // frame after one [x] token
      if (Object.keys(posHolds).every(W => frame.corner[W] === posHolds[W])) { pick = sym; break; }
    }
    if (!pick) throw new Error('rotation anchor failed for ' + x);
    rotByCorner[x] = pick;
  }
  return rotByCorner;
}
function applyParsed(parsed, state, syms, rotByCorner) {
  let s = copy(state);
  // frame = sym whose corner map sends WRITTEN letters to PHYSICAL axes; starts identity
  let frame = symFromFacePerm(FACE_ID, false);
  for (const t of parsed) {
    if (t.kind === 'rot') {
      // rotating the puzzle about written axis t.f; physical axis = frame.corner[f]
      const phys = frame.corner[t.f];
      for (let k = 0; k < t.amt; k++) frame = composeSym(rotByCorner[phys], frame);
      continue;
    }
    let f = t.f, amt = t.amt, extraRot = null;
    if (t.wide) { const [mv, axis] = WIDE[t.f]; f = mv; extraRot = axis; }
    const phys = frame.corner[f];
    for (let k = 0; k < amt; k++) move(s, phys, false);
    if (extraRot) {
      const physAxis = frame.corner[extraRot];
      // inverse rotation = two CW steps
      const steps = amt === 1 ? 2 : 1; // [x'] for Xw, [x] for Xw' (inverse of inverse)
      for (let k = 0; k < steps; k++) frame = composeSym(rotByCorner[physAxis], frame);
    }
  }
  return s;
}
function composeSym(a, b) { // apply b then a
  const fp = faceCompose(a.fp, b.fp);
  return symFromFacePerm(fp, a.mirror !== b.mirror);
}

// mirror a solution string token-by-token (LR mirror): R<->L, U->U', B->B', primes flip; rotations/wides likewise
function mirrorToken(t) {
  const map = { U:'U', B:'B', R:'L', L:'R', u:'u', b:'b', r:'l', l:'r' };
  let m;
  if ((m = t.match(/^\[([ulrb])(2|')?\]$/))) {
    const f = map[m[1]]; const p = m[2] ? '' : "'";
    return '[' + f + p + ']';
  }
  if ((m = t.match(/^(y)(2|')?$/))) return m[2] ? 'y' : "y'";
  if ((m = t.match(/^([ULRB])(w?)(2|')?$/))) {
    const f = map[m[1]]; const w = m[2]; const p = m[3] ? '' : "'";
    return f + w + p;
  }
  if ((m = t.match(/^([ulrb])(2|')?$/))) { const f = map[m[1]]; const p = m[2] ? '' : "'"; return f + p; }
  return t;
}
function mirrorAlg(str) {
  return String(str).trim().split(/\s+/).filter(Boolean).map(mirrorToken).join(' ');
}

// optimal solution from a state via the distance table (random tie-breaks if rand)
function optimalSolution(state, dist, rand) {
  const s = copy(state); const out = [];
  let d = dist[idx(s)];
  if (d < 0) return null;
  while (d > 0) {
    const opts = [];
    for (let m = 0; m < 8; m++) {
      const t = copy(s); applyMoveIdx(t, m);
      if (dist[idx(t)] === d - 1) opts.push(m);
    }
    const m = rand ? opts[Math.floor(Math.random()*opts.length)] : opts[0];
    applyMoveIdx(s, m); out.push(MOVES[m]); d--;
  }
  return out.join(' ');
}
function invertAlg(str) {
  return str.split(/\s+/).filter(Boolean).reverse()
    .map(t => t.endsWith("'") ? t.slice(0, -1) : t + "'").join(' ');
}
// optimal scramble TO a state = inverse of an optimal solution of that state
function optimalScramble(state, dist, rand) {
  const sol = optimalSolution(state, dist, rand);
  return sol === null ? null : (sol === '' ? '' : invertAlg(sol));
}
function applyScramble(str, base) {
  const s = base ? copy(base) : solved();
  const parsed = parseAlg(str);
  if (!parsed) return null;
  for (const t of parsed) {
    if (t.kind === 'rot' || t.wide) return null; // scrambles: plain moves only
    for (let k = 0; k < t.amt; k++) move(s, t.f, false);
  }
  return s;
}

module.exports = {
  FACES, XO, S4, G4, OPP, COPP, MOVES, NSLOTS,
  solved, copy, eq, move, applyMoveIdx, idx, unidx,
  buildSyms, symFromFacePerm, applySym, symMoveIdx, composeSym, makeCanon, makeMirrorCanon,
  bfs, parseAlg, countMoves, applyParsed, makeFrames, mirrorAlg, mirrorToken,
  optimalSolution, optimalScramble, invertAlg, applyScramble, faceCompose, FACE_ID,
};

window.OOEngine=module.exports;})();
