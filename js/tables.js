/* Skewbiks.com — shared BFS table cache (window.OOTables).
 *
 * The OO census (js/oo.js) and the method solver (js/solver.js) both need the
 * BFS distance table over the full Skewb state space; the census also needs the
 * canonical-class tables (reps + depths). These used to be duplicated in both
 * files AND cached under one IndexedDB key ('oo-tables-v1') with two different
 * value shapes ({dist} vs {dist,reps,depths}). This module is the single owner of
 * that cache, with SEPARATE keys per shape so they can't collide:
 *
 *   oo-dist-v1     -> { dist }                  (built by either page, reused by both)
 *   oo-classes-v4  -> { reps, depths }          (census only; hold-24 fold, 132,315 entries)
 *
 * Loaded as a classic browser script before js/oo.js / js/solver.js. The engine
 * (window.OOEngine) is passed in, so this file has no load-order dep on it beyond
 * being called after the engine exists.
 *
 * report(stage, n, total): optional progress callback; stage is 'cache' | 'bfs' |
 *   'classes'. tick: optional async yield (so the boot UI can paint).
 */
(function () {
  const module = { exports: {} };
  const DB_NAME = 'skewbiks-oo', STORE = 't';
  const KEY_DIST = 'oo-dist-v1';        // { dist: ArrayBuffer }
  // v4 (2026-07-10): classes fold ALL 24 PROPER rotations — the engine's 12
  // tetrad-preserving syms PLUS the 12 tetrad-swapping "re-holds", which act
  // via the ι re-anchoring map (E.makeHoldSym; ground-truth §Symmetry) ->
  // 132,315 entries. A position and its LR mirror stay SEPARATE entries
  // (re-holds preserve handedness, mirrors flip it; community solutions are
  // righty-tuned). Stale keys deleted on sight: v3 folded the 12 rotations
  // only (262,674), v2 folded 12 rotations + mirrors (131,391), v1 was an
  // older rotation-only shape.
  const KEY_CLASSES = 'oo-classes-v4';  // { reps: ArrayBuffer, depths: ArrayBuffer }
  const KEY_CLASSES_V1 = 'oo-classes-v1';
  const KEY_CLASSES_V2 = 'oo-classes-v2';
  const KEY_CLASSES_V3 = 'oo-classes-v3';
  const REACHABLE = 3149280;            // progress denominator (reachable states)

  function openDB() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbGet(key) {
    if (!('indexedDB' in window)) return null;
    try {
      const db = await openDB();
      const v = await new Promise((res, rej) => {
        const tx = db.transaction(STORE).objectStore(STORE).get(key);
        tx.onsuccess = () => res(tx.result); tx.onerror = () => rej(tx.error);
      });
      db.close();
      return v || null;
    } catch (e) { return null; }
  }
  async function idbPut(key, payload) {
    if (!('indexedDB' in window)) return;
    try {
      const db = await openDB();
      await new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(payload, key);
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
      db.close();
    } catch (e) { /* cache is best-effort */ }
  }
  async function idbDel(key) {
    if (!('indexedDB' in window)) return;
    try {
      const db = await openDB();
      await new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
      db.close();
    } catch (e) { /* cache is best-effort */ }
  }

  // BFS over the full state space -> Int8Array distance table. Cached under KEY_DIST.
  // Seed-parameterized full-space BFS: distance from every reachable state to
  // the nearest seed (0 at the seeds). One loop for the optimal-distance table
  // (seed = solved) AND the trainer's first-layer goal table (seeds = every
  // layer-solved state) — the trainer bundle calls this via window.OOTables.
  // (tools/lib/bfs-dist.mjs is the deliberate Node-side twin; if you optimize
  // one, do both.)
  async function bfsFrom(E, seedIndices, report, tick) {
    const dist = new Int8Array(E.NSLOTS).fill(-1);
    let frontier = Uint32Array.from(seedIndices);
    for (const ix of frontier) dist[ix] = 0;
    let d = 0, seen = frontier.length;
    while (frontier.length) {
      const next = [];
      for (let fi = 0; fi < frontier.length; fi++) {
        const s = E.unidx(frontier[fi]);
        for (let m = 0; m < E.MOVES.length; m++) {
          const t2 = E.copy(s); E.applyMoveIdx(t2, m);
          const ix = E.idx(t2);
          if (dist[ix] === -1) { dist[ix] = d + 1; next.push(ix); }
        }
        if ((fi & 8191) === 8191) { if (report) report('bfs', seen + next.length, REACHABLE); if (tick) await tick(); }
      }
      d++; seen += next.length;
      frontier = Uint32Array.from(next);
      if (report) report('bfs', seen, REACHABLE);
      if (tick) await tick();
    }
    return dist;
  }
  async function loadOrBuildDist(E, report, tick) {
    const cached = await idbGet(KEY_DIST);
    if (cached && cached.dist) { if (report) report('cache', 1, 1); return new Int8Array(cached.dist); }
    const dist = await bfsFrom(E, [E.idx(E.solved())], report, tick);
    idbPut(KEY_DIST, { dist: dist.buffer });
    return dist;
  }

  // Canonical-class enumeration (requires dist) -> { reps:Uint32Array, depths:Uint8Array }.
  // Classes fold all 24 PROPER rotations: a hold-24 orbit is the 12 rotation
  // images of s PLUS the 12 rotation images of ι(s) — the re-anchored 90°
  // re-hold image (E.makeHoldSym; ι needs dist for a solving word, which is
  // why the class build takes dist). 132,315 entries; a position and its LR
  // mirror stay separate (oracles: tools/verify-space.mjs, ground-truth
  // §Symmetry, both machine-verified 2026-07-10). Cached under KEY_CLASSES.
  async function loadOrBuildClassTables(E, dist, report, tick) {
    idbDel(KEY_CLASSES_V1); // reclaim the stale v1 rotation-only table (~1.3 MB)
    idbDel(KEY_CLASSES_V2); // reclaim the stale v2 24-sym-fold table (mirror split, 2026-07-10)
    idbDel(KEY_CLASSES_V3); // reclaim the stale v3 12-rotation table (hold-24 re-fold, 2026-07-10)
    const cached = await idbGet(KEY_CLASSES);
    if (cached && cached.reps && cached.depths) {
      if (report) report('cache', 1, 1);
      return { reps: new Uint32Array(cached.reps), depths: new Uint8Array(cached.depths) };
    }
    // Ascending orbit sweep: the first unvisited reachable index is its
    // 24-orbit's minimum, i.e. the class rep (= its makeHold24Canon id).
    // Pinned by tools/verify-space.mjs, which replicates this sweep verbatim
    // and requires it to emit exactly the 132,315 entry reps derived
    // independently from the ι partner map ("tables.js sweep replication"
    // check) — keep the two loops in lockstep when editing either. Identical
    // reps/depths to canonicalizing every state, at a fraction of the work:
    // one ι + 24 symmetry applications per REP (132,315) instead of per state.
    const syms = E.buildSyms();
    const hold = E.makeHoldSym(syms);
    const visited = new Uint8Array(E.NSLOTS);
    const reps = [], depths = [];
    for (let i = 0; i < E.NSLOTS; i++) {
      if ((i & 65535) === 65535) { if (report) report('classes', i, E.NSLOTS); if (tick) await tick(); }
      if (dist[i] < 0 || visited[i]) continue;
      const s = E.unidx(i);
      const t = hold.iota(s, dist);
      for (const sym of syms.rots) { visited[E.idx(sym.apply(s))] = 1; visited[E.idx(sym.apply(t))] = 1; }
      reps.push(i); depths.push(dist[i]);
    }
    const repsArr = Uint32Array.from(reps), depthsArr = Uint8Array.from(depths);
    if (report) report('classes', E.NSLOTS, E.NSLOTS);
    idbPut(KEY_CLASSES, { reps: repsArr.buffer, depths: depthsArr.buffer });
    return { reps: repsArr, depths: depthsArr };
  }

  module.exports = { idbGet, idbPut, idbDel, bfsFrom, loadOrBuildDist, loadOrBuildClassTables, KEY_DIST, KEY_CLASSES };
  window.OOTables = module.exports;
})();
