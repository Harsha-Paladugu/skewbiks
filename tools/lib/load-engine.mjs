/* Skewbiks.com — shared loader for the classic window-attached browser scripts.
 *
 * The js/*.js files are deliberately NOT modules: each is an IIFE that attaches
 * its API to window (OOEngine, OOSolverCore, …) so the site runs as plain
 * <script> tags with no build step (see CLAUDE.md "Module strategy"). Node
 * tools therefore load them for their SIDE EFFECT: stub globalThis.window,
 * require() the file, read the global back off the stub. This module is the
 * one place that pattern lives — import these helpers instead of repeating the
 * stub/require preamble per tool.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { readFileSync } from 'fs';

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadEngine() {
  globalThis.window = globalThis.window || {};
  if (!globalThis.window.OOEngine) require(path.join(ROOT, 'js', 'engine.js'));
  return globalThis.window.OOEngine;
}

export function loadSolverCore() {
  loadEngine();
  if (!globalThis.window.OOSolverCore) require(path.join(ROOT, 'js', 'solver-core.js'));
  return globalThis.window.OOSolverCore;
}

export function loadTables() {
  loadEngine();
  if (!globalThis.window.OOTables) require(path.join(ROOT, 'js', 'tables.js'));
  return globalThis.window.OOTables;
}

export function loadAlgData() {
  return JSON.parse(readFileSync(path.join(ROOT, 'data', 'skewb_algs.json'), 'utf8'));
}

/* js/sheet.js is generated with real CommonJS exports (unlike the IIFE
 * browser scripts), so it can be required directly. */
export function loadSheet() {
  return require(path.join(ROOT, 'js', 'sheet.js')).SHEET;
}

/* The known-broken-alg allowlist (data/broken-algs.json) is keyed the same way
 * by the compiler and the checker; this is the single definition of that key. */
export const brokenKey = (renderKey, algorithm) => renderKey + ' :: ' + algorithm;
export function loadBrokenAllowlist() {
  const list = JSON.parse(readFileSync(path.join(ROOT, 'data', 'broken-algs.json'), 'utf8'));
  return { list, keys: new Set(list.map(b => brokenKey(b.renderKey, b.algorithm))) };
}
