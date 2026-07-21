# Code-quality review — 2026-07-20

A full-codebase readability/professionalism review (15 parallel reviewers + a merge
pass + two independent verifier agents per finding — one re-reading the code for
accuracy, one checking against the project's documented deliberate decisions).
200 raw findings merged to 32; **30 confirmed**, 2 rejected as deliberate.
Scope: spaghetti, duplication, misplaced logic, dead code, comments, documentation —
NOT bugs, security, or performance. Every file:line below was machine-verified on
2026-07-20; treat line numbers as point-in-time.

The remediation campaign runs in phases (see the checklist at the bottom). Rules of
the road for anyone executing: `npm run build` + `npm run check:fresh` before every
commit; heavy test runners gate their subject phases; oo.js/algs.js have no test
runner, so browser checks are their primary gate; pushes to main deploy the live site.

## High impact

- **A1. README.md is actively false** — README.md:10-13 says the engine/renderer/data
  "are still the Pyraminx originals… the pages function as a Pyraminx clone"; :19 lists
  Pyraminx solver methods (L4E/ML4E/L5E); :20 "V-First trainer"; :25 "the Pyraminx
  engine"; :44-54 describe the retired compiled-sheet data flow (all three surfaces
  fetch `data/skewb_algs.json` at runtime); :49 "v0 seed"; :77 contradicts
  data/sources/README.md's no-hand-edit rule. Missing: test:trainer/test:solver/
  test:space docs, major tools, docs/ links, a window.* surface map. (15/15 reviewers.)
- **A2. Notation traps undocumented at definition sites** — engine.js:555 says "x y z
  rotations as in WCA" (engine x/y/z are the physical INVERSE of WCA — actively teaches
  wrong semantics); XYZ_FP (engine.js:581-585) lacks the inverse note.
  solver-core.js:153-154 documents `physPerm` as handling "both notations", inviting the
  physPerm-vs-physPermNS misuse that mis-indexed 916 finish bodies in July; the warning
  lives only on physPermNS; export line :631 undifferentiated. Fix is comment-only; NO
  convention changes.
- **A3. Second-tier docs drifted** — docs/port-plan.md: no M7 heading (M6 :199 → M8
  :556; :580 references a nonexistent "status entry"; :561 stale title). SETUP.md:8
  presents steps completed 2026-07-06 as outstanding. docs/skewb-ground-truth.md:
  superseded layers presented as current (:286-289, :333), dead scratchpad pointer
  (:363-365). tools/lib/bfs-dist.mjs header lists 2 of 5 importers. sitemap.xml lastmod
  all 2026-07-03. index.html:27 inherited false history. firestore.rules: /meta/ (:96),
  /moderators/ (:101), /moderatorInvites/ (:109) blocks uncommented.
  src/trainer/README.md substrate bullet (:45-52) omits quizAnswer. CLAUDE.md Commands
  block omits test:solver and test:space though its top paragraph names both as gates.
- **A4. SkewbTrainer monolith with a real correctness smell** — one ~1,350-line
  component (skewb-trainer.jsx:78-1425, ~87 hooks; 215-line stage ternary :1027-1242;
  155-line stats ternary :1247-1401). `AlgList` (:755) and `CaseBrowser` (:775) declared
  in-body and used as JSX types → remount every parent render; CaseBrowser's grp/filter
  state (:777-778) genuinely resets when its own chip clicks mutate parent state.
  `caseOfState` (:465-481) is pure model logic, untested, belongs in skewb-core.
  Keyboard effect :613-663 (15 deps) duplicates every mode's button actions.

## Duplication

- **A5. Engine geometry re-derived by consumers** — solver-core.js:105-135 and
  skewb-core.mjs:366-368/405-407/421-422 rebuild FIDX/FNORM/MOVE_AXIS/corner-twist
  tables engine.js defines (:116,:129,:158,:199,:824-841) but doesn't export; third
  MOVE_AXIS copy at verify-space.mjs:136. FREE_SLOT derives from E.FREE (engine.js:21).
  CAVEATS: render.js:27-29 local copy is port-plan accepted debt — LEAVE IT; keep
  solver-core's independent-derivation asserts as tests (port-plan anchor) — move,
  don't delete.
- **A6. Rotation-token regex ~8 copies** — algs.js:69 `isRotTok` vs :220 `isRotTok2`
  byte-identical in the same closure (:224 uses the copy); skewb-core.mjs:28
  (unexported); skewb-trainer.jsx:27 (duplicates despite importing from skewb-core);
  solver-core.js:182/:234; import-method-sheets.mjs:99; engine.js :570/:697/:769
  (identical rotation regexes; the differing letter classes are the adjacent MOVE
  regexes); test-solver.mjs:361 plus a shadowing `t` param in the .every() callback
  at :234.
- **A7. Test harness triplicated + intra-file drift** — t()+counters byte-identical
  across test-engine/test-trainer/test-solver (trainer's rndInt trivially differs);
  fourth variant in firestore.rules.test.mjs. Drift: test-engine inlines stOf's
  expression 6× before defining it (:372) + 1× after (:479); test-solver re-merges
  subsets 4× (:79/:138/:223/:358); test-trainer makeFrames per-call (:37), mid-file
  require (:208), seedPending (:114-119) diverges from validSolution (:53); trainer:212
  local duplicate of solver-core's exported flKey.
- **A8. Engine-loading shim ×8 tools** — createRequire + ROOT + `globalThis.window =
  {}` + require block in compile-sheet.mjs:26-32, check-sheet.mjs:15-19,
  import-method-sheets.mjs:57-63, test-engine, test-trainer, test-solver, verify-space,
  solver-lab. Also: ' :: ' broken-key join + unexpected/stale split duplicated
  (compile-sheet:47,168-169 vs check-sheet:29,59-60); check-fresh:27-29 hand-mirrors
  package.json scripts; SKIP_ALLOW code-side (compile-sheet:186); subset order declared
  twice (adapters :191/:207/:221 vs array :294).
- **A9. Notation-pref plumbing ×4, drifted** — oo.js:15-23, algs.js:52-63,
  solver.js:45-69, skewb-trainer.jsx:88-97; toggle markup ×4 (oo.js:458-462,
  algs.js:691-694, solver.js:217-220, jsx:848-852). algs.js:54 and jsx:89 validate both
  values; oo.js:17/solver.js:47 only 'ns'; aria-pressed missing in solver (partly
  deliberate — comment solver.js:215-216) and trainer. dispAlg exists only in
  oo/algs/trainer (solver always RubiksSkewb by design).
- **A10. oo.js side-integrity chain ×3** — pairOf → verifySolution → solvedId ternary →
  sideIdOf at oo.js:243-246 (demoDB), :370-373 (liveDB), :875-887 (pageMod), each
  re-inlining notaOf's ternary (helper at :24); cap logic repeats :248-249 vs :374-378;
  fourth partial variant in submit form (:758/:771). Extraction must preserve the
  UI-gate + backend-recheck defense-in-depth.
- **A11. Engine internals hand-copied** — frame-walk ×3 (applyParsed :613-616,
  nativeToWCA :635-636, parsedToNative :657-660); dist-descent ×3 (scrambleMovesTo
  :499-510, nativeSolution :709-723, skewb-core descend :170-187); letter↔axis map ×3
  (MOVES/MOVE_AXIS :198-199, inline inverse at :627, NATIVE_LETTER :646); join/re-split
  churn :679/:726/:739 + skewb-core:166.
- **A12. BFS frontier loop ×3** — skewb-core.mjs:303-326 (buildFLDist) repeats
  tables.js:84-109 line-for-line (same `fi & 8191` cadence; REACHABLE=3149280 hardcoded
  both: skewb-core:308, tables.js:36). tools/lib/bfs-dist.mjs:10-28 third copy is
  documented-deliberate — LEAVE IT.
- **A13. oo.js small dups** — bitmap encode ×2 (:396/:437) despite named decodeBitmap;
  demo stats/doneMap duplicate fold; literal 15 move-cap ×3 (MAX_SOLUTIONS precedent
  exists); nav() hand-rebuilds the auth box, drifted from OOAccount.authBox (toast vs
  console.error; uncaught signOut; demobadge title); window.OOApp (oo.js:1016) /
  window.OOSolver (solver.js:311) debug exports unreferenced + unexplained (ANNOTATE,
  don't drop); T's late-attached fields documented at attach sites but not the
  initializer (:41); browseFilter ephemeral-by-design undocumented.
- **A14. solver-core internal scaffolding** — 24-orientation enumeration ×2 (:186-196
  vs :239-245); preimage/rotation scan across 3 sites (algIndex :377-387, methodView
  :566-567, sheetLineFor :623-627); rotBetween ×2 (:516/:541). First-seen
  dedupe/spelling order is load-bearing — must survive factoring.
- **A15. Trainer JSX patterns** — case-reveal header ×4 (1086/1104/1188/1218);
  segmented control ×6-7 (849-973); grade rows ×2 (1111/1201); verdict back-scan ×2
  (409/536); Known-toggle ×3 (652/700/1222, Set-toggle ×4); pct/mean + case-card grid
  dup in stats (1263-1399); drill||recap ×5; one-look stats key built :528,
  string-parsed :1277-1292.
- **A16. CSS widget twins** — modal ×2 identical values (oo.css:25-28 vs
  trainer.css:137-150); #7fb0ff ×3 with identical comment (algs.css:83,
  trainer.css:161); .scopetab (oo.css:5-10) vs .filterbtn (:17-22) near-identical;
  rgba(35,28,5,.66) recurring. .algrow/.fmkey/.warntag differ per page — consolidation
  partial.
- **A17. HTML page chrome (LOW)** — ~22-line head ×5 pages; config.js placement
  inconsistent (head only oo.html:26); boot-status ×2 (oo.html:29-34 /
  solver.html:28-33); progress reporter + error card duplicated oo.js vs solver.js.
  ANTI-FIX (verified): do NOT extract trainer.html's inline boot script — its
  `js/trainer.js?v=` ref IS stamped in place; extraction breaks cache-busting.

## Structure & complexity

- **A18. Trainer regeneration scattered** — four exhaustive-deps-suppressed effects
  (562/669/675/683) coordinated via genMode ref + flBoot one-shot; generators
  inconsistent about phase/last resets (nextRecog/nextOnelook self-reset :341/:484,
  nextDrill relies on effect :566); advance() calls setCurrent(makeDrill(...)) inside
  the setRecap updater (548-554) — React may invoke updaters twice; startRecap
  (317-321) shows the correct sibling pattern.
- **A19. 17 persisted trainer fields hand-enumerated ×4** — reader :161-203, writer
  :248-252, dep array :254, resetStats :751 (4 stats fields); reader untestable from
  Node; OOAccount.user peek :858 vs storage-bridge contract.
- **A20. makeSolverCore mixes three concerns; null contract undocumented** — physical
  model (:97-257) + search/methodView (:259-581) + algs display (:583-629) in one
  factory (:74); algs.js:38 passes nulls, contract documented only at the call site
  (algs.js:35-38); dist unguarded :409/:448, algData guarded :346; 22-name export blob
  :631-633 mixes page API (flKey/pApply/SOLVED24_KEYS used by algs.js:306-308) with
  test plumbing; exported pInv has zero external consumers.
- **A21. algs.js cleanups** — mergedGroups (:251) uncached, 4 call sites incl.
  keystroke validate (:307); async-over-localStorage Store (:328-379) with stale "cloud
  may differ" comment at :755-756; unread canons (:165/:174); display:'core' alias
  (:193); hoisted-function typeof guard (:375); querySelector('.export') (:736) vs
  module refs; duplicated .bad-draft block (:351/:362); missing res.ok (:742)
  (solver.js:22 and jsx:214 check it).

## Dead code

- **A22. Dead CSS ~45% of solver.css** — scoring UI :21-26/:28, :39-40, :46, :57-69
  (deferred fingertrick feature); dead dupes of live site.css rules :9,:29-35,:42;
  .alglist (algs.css:68), phantom .btn.sm (algs.css:109), .ghost.big (site.css:32),
  trainer.css:5 --text/--faint/--bg remaps. All grep-verified unreferenced.
- **A23. Engine dead code** — composeSym (:383) zero callers (M7 un-exported, body
  left); S4 (:825) / WCA_CORNER (:838) exports unconsumed; _syms param never read while
  _keyEnsure (:781-785) builds 24 sym tables to pass it (test-trainer.mjs:37 passes
  null); makeFrames(null) vs makeFrames(syms) caller inconsistency (:623/:648 vs
  :497/:784).
- **A24. Trainer substrate dead bits** — FM_ORDER (skewb-core.mjs:42) dead export;
  rateRank import unused (jsx:2); RATING_RANK (:25) / stripPostRot (:29) exported but
  internal-only; dead !sub guard jsx:779 (deref at :777); knownKey alias (jsx:40)
  uncommented (retired digit documented at :106).
- **A25. Shared-layer vestiges** — render.js:21-23 three-way engine resolution,
  branches 2/3 unreachable (→ `const E = window.OOEngine`); dcap attrs (:129-130)
  always lose to site.css:102 (pick one caption owner); tables.js:46-81 idb boilerplate
  (extract withStore()); account.js onChange (:166) no unsubscribe; config.js:16
  adminEmails comment omits the documented UI-only/rules-don't-trust-it gotcha
  (highest-value single line in the group); navbar.js:62/:69 el.apply/concat
  modernization; demo keys 'pyraminx-account-*' — ANNOTATE, don't rename (cherry-pick
  rationale extends).

## Branding, headers, comments

- **A26. Ten "Pyraminx.net —" headers** — js/account.js:1, js/dom.js:1, js/navbar.js:1,
  css/site.css:1, css/home.css:1, css/oo.css:1, css/solver.css:1,
  tools/stamp-assets.mjs:1, tools/check-fresh.mjs:1, tools/lib/bfs-dist.mjs:1. Plus
  img/logo.svg aria-label="Pyraminx.net logo" (screen-reader-visible); css/site.css:44-45
  V-First mark description; js/tables.js:4 "no-tips state space". Identifiers untouched.
  Note: CSS url() ?v= refs are not stamped — a logo.svg edit needs a hand-bump.
- **A27. Doubled disagreeing headers ×4** — oo.js:1-2 and solver.js:1-2 (Expects lists
  disagree; both omit OODom (destructured oo.js:6/solver.js:5) and OOTables (boot
  throws oo.js:48/solver.js:13)); render.js:1+3 and solver-core.js:1+3 (only the
  redundant title line is vestigial — the doc block beneath is real, keep it).
- **A28. Comments narrate the retired data flow** — algs.js:7 (says trainer/solver read
  the compiled sheet — false); compile-sheet.mjs:152 (nonexistent buildPools);
  build.mjs:15 and src/trainer/index.jsx:5 ("original bundle" deleted).

## Consistency

- **A29. solver.css redefines seven site.css classes + token bypass** — solver.css
  :9,:29,:30-35,:37,:43,:72,:73 vs site.css :105,:132,:133-137,:116,:123,:87,:31
  (incl. the .ghost.sm utility override); 27 font literals vs var(--body/--mono/--disp);
  --paper defined site.css:6, consumed only by solver.css; bare .subnav collision
  (site.css:38 padding leaks into algs.js:708's div.subnav) → rename the algs pills
  (.algsubnav) in js/algs.js + css (page-local, no cherry-pick cost).
- **A30. METHOD_ORDER hardcoded under a "single source" comment** — solver.js:85
  re-declares ['fl','tcll','eg2']; solver-core.js:72 exports identical METHOD_PRIORITY
  (window.OOSolverCore :635-636, consumed by test-solver.mjs:32/56); VLABEL (:88-92)
  and UI.methods (:74) are further id tables — add tracking notes.

## Repo hygiene

- **A31. No CI** — `.github/` doesn't exist; CLAUDE.md asks check:fresh be wired into
  CI; the committed-build-output design depends on it.
- **A32. No .gitattributes** — the core.autocrlf=false pin is LOCAL git config only and
  doesn't survive a fresh clone; stamp-assets hashes raw bytes → a CRLF checkout churns
  every ?v= stamp.
- **A33. No LICENSE** — no file, no package.json field; public GitHub Pages site;
  data/sources/ provenance worth one statement. (USER decision 2026-07-20: MIT.)

## Rejected as deliberate — do NOT implement

- **R1. algs.js vs skewb-core case-model duplication** — CLAUDE.md rules the case model
  "legitimately stays local to the trainer… substrate, not keying". Residual fix only:
  reciprocal keep-in-sync comment in algs.js (skewb-core already cites algs.js one-way).
- **R2. Splitting oo.js (1,017 lines)** — shares its exact skeleton with upstream;
  cherry-pick strategy + port-plan's prior "no structural problems" review. Only the
  small in-file dups (A10, A13) get fixed; no restructuring, minimal diff churn.

---

## Remediation checklist

Tick with the landing commit SHA. Phases per the campaign plan (docs pass → hygiene
rails → comment sweep → dead code → plumbing clusters → trainer branch → CSS branch →
final sweep).

- [ ] A1 README rewrite (phase 1)
- [ ] A2 notation-trap comments (phase 3)
- [ ] A3 second-tier docs drift (phase 1)
- [ ] A4 trainer monolith split (phase 6)
- [ ] A5 engine geometry exports (phase 5b)
- [ ] A6 rotation-regex dedup (phases 4/5a/5b/5d/6 by module)
- [ ] A7 test-harness consolidation (phase 5a)
- [ ] A8 tools shim consolidation (phase 5a)
- [ ] A9 notation-pref helpers in OODom (phase 5c)
- [ ] A10 side-integrity helper (phase 5c)
- [ ] A11 engine internal dedups (phase 5b)
- [ ] A12 bfsFrom in tables.js (phase 6)
- [ ] A13 oo.js small dups — annotations (phase 3) + code (phase 5c)
- [ ] A14 solver-core scaffolding (phase 5d)
- [ ] A15 trainer JSX extraction (phase 6)
- [ ] A16 CSS widget consolidation (phase 7)
- [ ] A17 page-chrome worthwhile parts (phase 7); head-block ×5 dedup = WONTFIX (no
      templating seam on a no-build static site); trainer.html boot script = ANTI-FIX
- [ ] A18 trainer regeneration consolidation (phase 6)
- [ ] A19 trainer persistence descriptor (phase 6)
- [ ] A20 makeSolverCore contract docs + guards (phase 5d)
- [ ] A21 algs.js cleanups — dead slices (phase 4) + rest (phase 5e)
- [ ] A22 dead CSS deletion (phase 4)
- [ ] A23 engine dead code (phase 4)
- [ ] A24 trainer substrate dead bits (phase 4 + phase 6 leftovers)
- [ ] A25 shared-layer vestiges — comments (phase 3) + dead (phase 4) + code (phase 5c)
- [ ] A26 Pyraminx.net header sweep (phase 3)
- [ ] A27 doubled headers (phase 3)
- [ ] A28 retired-data-flow comments (phase 3)
- [ ] A29 solver.css scoping + tokens + .algsubnav (phase 7)
- [ ] A30 METHOD_ORDER one-liner (phase 5d) + tracking notes (phase 3)
- [ ] A31 GitHub Actions CI (phase 2)
- [ ] A32 .gitattributes (phase 2)
- [ ] A33 MIT LICENSE + data provenance note (phase 2)
- SKIPPED by decision: firestore.rules.test.mjs harness swap (unverifiable without the
  emulator); tools/lib/bfs-dist.mjs BFS copy (documented deliberate); render.js
  geometry copy (port-plan accepted debt).
