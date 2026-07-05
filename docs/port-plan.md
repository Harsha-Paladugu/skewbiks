# Skewbiks.com port plan and status

The approved milestone plan for porting the pyraminx-oo codebase to the Skewb, with live
status. Companion doc: `skewb-ground-truth.md` (machine-verified domain facts + sources).
User-facing decisions already made: fork (not monorepo); v1 = Home + OO census + Algorithms
+ Trainer + Method solver; trainer = three tools (case/alg drill, full-solve timer +
analysis, case recognition) as modes of one bundle; solver method lineup decided at M7;
new Firebase project; domain skewbiks.com (GitHub Pages, CNAME).

## Status

- [x] **M0 — Bootstrap** (`84416fd`): identity fork (titles/OG/wordmark/CNAME/robots/
  sitemap/package.json), demo-mode config, LF-normalized tree, `upstream` remote.
- [x] **M1 — Engine** (`b303ad9`): Skewb `js/engine.js` behind the identical
  `window.OOEngine` surface. State `{ctr[6], fx[4], fp[4], fo[4]}`; native moves = axis
  tetrad {UBR, UFL, DFR, DBL}; written WCA `B` (free corner DBR) + `x/y/z` resolve through
  applyParsed's frame machinery; `nativeToWCA` converts solver output; case keying folds
  the y² view only (90° y swaps tetrads — NOT a state symmetry; the 4 presentations pair at
  data level via the sheet `direction` field). Dense index NSLOTS = 360×12×2187 = 9,447,840.
  Dropped from the contract: `applyMoveK`, `rotateFrame`, `openOfEkey`, `barOfEkey`, `XO`.
  Added: facelet model (`toFacelets`/`fromFacelets`/`WCA_FACELET_MOVES`), `enumFreeSlots`
  spec-object signature, `CLASS` (free-perm A4/V4 classes). `tools/test-engine.mjs` 32/32
  (44 after the M3 notation/display additions);
  `npm run test:space` matches OEIS A079745 + class oracles.
- [x] **M2/M3 — Census slice** (`4f3d057`): `js/render.js` rebuilt on the facelet model
  (net = front/back orthographic corner views; 3D cube; same 5-member contract);
  `js/tables.js` parameterized (IndexedDB `skewbiks-oo`); `js/oo.js`/`oo.html` Skewb copy.
  Verified: in-browser first build ~18 s; census shows 262,674 positions (= oracle);
  mirror pairs, 12 unique views, verified scrambles, instant cached reload.
  - **2026-07-03 update (user request):** census classes now fold the FULL 24-element
    group (`E.makeFullCanon`, cache key `oo-classes-v2`) → **131,391 positions**; a
    position + its mirror are one class/ordinal/done-bit (pairId == classId of the rep;
    old `#/c/<id>` links still resolve). Notation: WCA everywhere by default + a
    **WCA / NS switch** in the nav (`localStorage skewbiks-notation`; engine gained
    `parseAlg(str,'ns')`, `wcaToNS`/`nsToWCA`/`convertAlg`, NS-aware `mirrorAlg` —
    mapping in skewb-ground-truth.md §NS). Solutions store the notation they were typed
    in (`notation: 'wca'|'ns'` doc field; rules + fixtures updated). Net/3D re-anchored
    to the WCA scrambling hold (front = U/F/L, UFL toward viewer; back = D/B/R) so
    scrambles match the in-hand view and mirror pairs render as visual reflections.
  - **2026-07-03 fix 2 (user report: "B looked like an F move"):** two frame bugs —
    `applyParsed`/`nativeToWCA` advanced the B-frame in the WRONG DIRECTION (every move
    after a written B acted on the wrong corner; self-consistent in-engine, wrong vs a
    real cube), and diagrams rendered raw pinned facelets (UFL corner appeared to twist).
    Fixed: frame steps `amt % 3`, and all rendering now goes through `E.toFixedFacelets`
    (WCA-hold presentation; white/red/green corner always reads solved). Display now
    matches the TNoodle fixed-frame vectors + KPW 2015 scramble exactly (4 new tests;
    see ground-truth §"Two frame rules"). Census dist/class tables unaffected (native
    moves only). Old demo-mode solutions verified under the inverted frame may fail
    re-verification — expected.
  - **2026-07-03 Phase-0 cleanup (post-review, commit after `12c5483`):** full OO
    code review found no structural problems; landed fixes: home "random unsolved"
    no longer lands on the solved position (skips depth-0); `pairOf` + the approval
    transaction re-derive the class rep by FULL 24-sym canonicalization (a forged
    non-canonical `classId` could previously verify+approve but never set the
    done-bit); class-table build switched to an ascending orbit sweep — first
    unvisited reachable index is the rep — 1.0s vs 22.6s in Node, reps/depths
    verified byte-identical, cache key unchanged; bitmap bit-twiddling extracted to
    `testBit`/`setBit`; dead exports pruned (engine `mirrorToken`/`parsedToNative`/
    `NS_CORNER`, render `STICKERS`); `render.js` now uses the same shadowed-module
    IIFE as engine.js/tables.js (the old `typeof module` branch silently skipped
    `window.OORender` under the documented Node window-stub recipe).
- [~] **M4 — Firebase** (2026-07-03, agent side done — USER console steps remain).
  Project **`skewbiks`** + web app created via MCP; creds in `js/config.js` (demo mode
  off); `.firebaserc` pins the project; rules deployed (verified byte-identical via
  `firebase_get_security_rules`). Rules tests: 25/25 green against the emulator
  (`npm i --no-save @firebase/rules-unit-testing firebase`, then
  `npx -y firebase-tools@13 emulators:exec --only firestore "node test/firestore.rules.test.mjs"`
  — firebase-tools 14+ needs Java 21, machine has 17; recipe in the test header), incl.
  2 new delete tests. Review carry-items landed: (a) solutions delete stays admin-only
  (it's the cap-race recovery path) + new admin **Recompute solved bitmap** action
  (`liveDB.recompute()`: rebuilds meta/doneMap + meta/stats from approved docs' classId
  — state indexes, enumeration-independent — so it doubles as the KEY_CLASSES migration
  tool); (b) persistence formats FROZEN in skewb-ground-truth.md §"OO census persistence
  formats"; (c) pageMod scramble/solution now display through the WCA/NS switch
  (verification still runs on stored text + notation).
  **Firestore DB creation is console-only on Spark** (API/CLI CreateDatabase requires
  billing — confirmed against Firebase docs), so it's a USER step.
  **DEFERRED 2026-07-05 (user decision): the console steps wait; M5 proceeds first.**
  Until they're done, oo.html's backend is intentionally dead — census shows 0 solved
  and sign-in fails. That is NOT a bug; do not debug or revert `js/config.js` to demo
  mode. Checklist when resuming (details in SETUP.md §1–4): ① create the (default) DB
  in the console (nam5, production mode); ② REDEPLOY the rules — the create wizard
  overwrites them (`firebase deploy --only firestore:rules` or Firebase MCP); ③ enable
  the Google sign-in provider; ④ sign in on oo.html, read the uid from the About tab,
  create `admins/{uid}` (console/MCP write bypasses rules); ⑤ run the remaining gate:
  live submit → moderate → done-bitmap round-trip (+ try the admin "Recompute solved
  bitmap" button once).
- [ ] **M5 — Sheet pipeline + Algorithms page + alg data v0.** USER authors
  `data/skewb_algs.json` (same schema; subsets proposal: Sarah-Intermediate/Sarah-Advanced/
  NS/FL — user confirms; `direction` = Front/Right/Back/Left y-presentations; `setup` =
  `[y]`-family). Re-key `tools/compile-sheet.mjs`/`check-sheet.mjs` through engine helpers
  only (renderKey = `stateKey`, canon = `realCanonKey` y²-fold, `prependAUF` mod-4 string
  fold); delete the L4E-merge/TL4E-split Pyraminx special cases; `data/prior-sheet.json`
  starts `{}`, `broken-algs.json` `[]`; GENERATE `data/classmap.json` from subset membership
  (stop hand-maintaining it). algs.js: keep editor machinery, replace taxonomy (SECTIONS,
  side labels, `aufAmount`→`yAmount`). Gate: `npm run build` fully green again (check-sheet
  validates every alg), grep-gate `%\s*3` only in engine internals, export round-trip.
- [ ] **M6 — Trainer.** Fork `src/trainer/l5e-trainer.jsx` → `skewb-trainer.jsx` (new
  build.mjs entry). Keep the chassis (timer, storage bridge under new key
  `skewb-trainer-v1` with legacy migrations deleted, session/recap, stats, case-picker);
  rewrite the substrate against engine coords (drop the private BFS coordinate copy —
  use `E.idx/unidx`; pools via `enumFreeSlots`; scrambles via masked BFS / `optimalScramble`).
  Three modes: drill, full-solve timer + post-solve analysis (optimal line + movecount
  stage splits via first-layer detection), case recognition (timed multiple choice at a
  random y² presentation). Gate: `build:trainer` green; each mode loops in the browser.
- [ ] **M7 — Solver.** New `METHOD_DEFS`/`METHOD_PRIORITY` in solver-core (proposal to
  confirm with user: `fl` first layer cap 7, `flm1` FL−1 cap 5, `psfl` pseudo-FL; targets
  from `enumFreeSlots` pools; frames go 12→24? NO — frames stay the engine's `makeFrames`;
  buildRotations enumerates the 12 rotation frames as before). Rebuild `ergoScore` for
  Skewb grips: keep frame machinery/alternation/min-per-state; replace thumb-dial state
  with `(frameIdx, lastHand, sameAxisRun)`; add rotation-conjugate renders (write `B` as
  `y'+R`-family). solver.js deltas: VLABEL, reconstruction wording, `SLIDER_KEYS →
  ['uCost','bCost','sameHand','altBonus','rotCost']`, delete `migrateWeights`. Solver ships
  before alg data (`caseNameOf` degrades to null). Gate: `tools/solver-lab.mjs` re-fixtured;
  every emitted solution machine-checked; sliders persist via OOAccount.
- [ ] **M8 — Launch polish.** Home copy/cards final, Skewb logo + og image + touch icon
  (headless-Edge render recipe), robots/sitemap already point at skewbiks.com, SETUP/README
  final, pre-announce checklist (deployed-rules diff, Firebase authorized domains incl.
  skewbiks.com, OG cards).

## Remaining plan + review carry-items (2026-07-03 — read before starting M5)

Standing goals for the rest of the port: (1) main is always committed and green at
its own milestone's bar; (2) each milestone deletes its own Pyraminx leftovers
rather than deferring to a big-bang cleanup; (3) data formats that hold live user
data (done-bitmap, solution docs) are frozen and documented before M4 goes live;
(4) first boot stays fast enough to not need an apology in the boot hint.

Items the 2026-07-03 OO code review adds to the milestones above:

- **M4:** carry-items (a)/(b)/(c) all landed (see the M4 status entry above);
  the USER console steps + live round-trip gate are deferred until after M5
  starts — follow the numbered checklist in the M4 entry when resuming them.
- **M5:** as specced. Also kills the known-dead algs.js destructuring of dropped
  contract members (`applyMoveK`/`openOfEkey`/`barOfEkey`) and turns
  `npm run build`/`check:fresh` green — after M5, run `check:fresh` before every
  commit (stamps are manual discipline until then; `npm run stamp` before commits).
- **M6:** as specced. Decide whether the trainer imports `R.COLORS` (kept exported
  for exactly this) or inlines its own palette — un-export if unused.
- **M7:** as specced. Engine exports `composeSym`/`FACE_ID`/`faceCompose`/
  `optimalSolution` exist for Pyraminx-era solver-core + tests only — if the M7
  rewrite doesn't use them, un-export.
- **M8:** as specced.

Known-acceptable, deliberately NOT fixed (don't re-litigate without new evidence):
the BFS builder exists twice on purpose (js/tables.js browser + tools/lib/
bfs-dist.mjs Node — documented in the latter's header; if you optimize one, do
both); the BFS allocates a fresh state per move probe (~25M short-lived objects on
first boot — a scratch-state `applyMoveIdx` variant is the fix if boot time ever
matters again); `enumFreeSlots` recomputes `twistDigits` in its inner loops
(trivial cost); pageBrowse re-fetches doneMap per navigation (candidate for a
session cache); render.js re-declares FACES/FIDX/FNORM locally; the moderator
approval cap check is best-effort/racy by design (documented at the call site).

## Recorded numbers (from M1 verification — use these, don't recompute by hand)

3,149,280 reachable states; depth histogram = OEIS A079745 (max 11, 90 antipodes);
262,674 rotation classes; **131,391 census positions (24-sym fold — what oo.html counts)**,
of which 108 are self-mirror; NSLOTS/rules bound 9,447,840;
per-depth ROTATION-class counts 1/2/4/24/144/854/4,943/26,272/102,155/121,404/6,852/19
(the census's per-depth counts are the 24-fold ones shown on the Browse tab).
