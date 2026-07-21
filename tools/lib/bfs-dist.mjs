/* Pyraminx.net — shared Node-side BFS distance-table builder.
 *
 * One source for the full-state-space optimal-distance table used by the dev
 * tools (tools/test-engine.mjs, tools/test-solver.mjs, tools/test-trainer.mjs,
 * tools/verify-space.mjs, tools/solver-lab.mjs) — the same table the
 * browser builds in js/tables.js (which stays separate: it adds progress
 * reporting and IndexedDB caching that the tools don't want).
 *
 * Usage: pass the loaded engine (globalThis.window.OOEngine).
 */
export function buildDist(E) {
  const dist = new Int8Array(E.NSLOTS).fill(-1);
  let frontier = new Uint32Array([E.idx(E.solved())]);
  dist[frontier[0]] = 0;
  let d = 0;
  while (frontier.length) {
    const next = [];
    for (let fi = 0; fi < frontier.length; fi++) {
      const s = E.unidx(frontier[fi]);
      for (let m = 0; m < E.MOVES.length; m++) {
        const t = E.copy(s); E.applyMoveIdx(t, m);
        const ix = E.idx(t);
        if (dist[ix] === -1) { dist[ix] = d + 1; next.push(ix); }
      }
    }
    d++; frontier = Uint32Array.from(next);
  }
  return dist;
}
