# Trainer source

Editable source for the Skewbiks.com trainer — **the source of truth for the
deployed trainer**. It builds to `js/trainer.js`, which `trainer.html` serves in
production. Edit here, rebuild, commit the regenerated `js/trainer.js`.

## Files
- `skewb-trainer.jsx` — the trainer React component (UI + persistence). Three
  modes, described below.
  - **Diagrams:** every case diagram is drawn in the Algorithms page's
    bat-shaped sheet picture (`caseSVG` on the raw pinned facelets, D hidden,
    solved layer on the bottom; D-anchoring of every shown view is pinned in
    test-trainer against the solver-core picture oracle — the drill stats grid
    pins d = 0 because legacy d = 1/3 rows aren't all D-anchored raw). Only the
    one-look PROBLEM diagram keeps the two-view net: a scrambled state's D face
    carries information the sheet picture hides. (USER requests 2026-07-13 —
    recognition first, which also removed the Full solve mode, then the drill
    stage/stats grid and the one-look reveal.)
  - **Algorithm (drill/recap):** group-based case picker from the subsets'
    `nav` blocks; reveal shows the authored NS text verbatim with first-move
    chips and rating tags; per-case stats with a recap queue.
  - **Recognition:** *Full view* — y²-coin-flipped diagram, reveal + self-grade
    with per-case accuracy. *Center-cases view* — first layer + a chosen
    3-center combo shown at the anchor view, optional 2 random corners,
    multiple-choice + Don't know, auto-graded per-center-case accuracy. Answers
    come from `core.quizAnswer`, which resolves the sheets' center-case names
    from the centers the diagram actually shows: EG2's and NS's labels are a
    pure function of the center perm (machine-verified, pinned in test-trainer;
    EG2's direction-less L5C labels fold into the Pi/Peanut vocabulary, its
    eight directional U-perm labels condense into a single "U" answer, and its
    numbered pairs (O1/O2 … ZC1/ZC2) fold into their stems — 10 quiz options;
    NS's lumped "H or Z Perm" rows split into H Perm / Z Perm / Solved and its
    unlabeled L4C/L5C cases resolve through the same map), while TCLL's labels
    encode twist/pseudo context and stay authored verbatim.
  - **One-look:** self-graded case prediction in inspection. *Random* —
    scrambles whose nearest layer is exactly N moves away; the reveal lists the
    optimal layer lines. *My solution* — enter a fixed layer solution and get
    scrambles from which PHYSICALLY executing it on the cube in hand solves the
    bottom layer: preimages are computed in the facelet model against the held
    frame (`core.preimageOfLayer` — the scramble text's absorbed free-corner
    rotations mean raw state facelets are NOT what's in hand; USER-falsified
    2026-07-13 with solution "U" needing a physical L, repro + fix pinned in
    test-trainer against the solver-core physical oracle). Rotation tokens and
    the NS letters F/R/L/f (they move the fixed white/red/green corner, whose
    preimages no scramble text can deliver) are rejected at input. The reveal
    shows the exact post-layer state — its raw frame IS the cube in hand
    (`fx[UFL] = 0` draws), drawn as the sheet picture — plus a best-effort
    case name.
- `skewb-core.mjs` — the substrate, no React/DOM: case model over
  `data/skewb_algs.json` (fetched at runtime — NOT bundled), presentation
  geometry (`prependAUF` presentation synthesis — backs recognition's y²
  flip and the one-look reverse lookup; the drill's user-facing view toggles
  were removed), masked scrambles, the
  first-layer predicate + goal-distance BFS, the centers-quiz answer resolver
  (`quizAnswer` — the sig-pure label folding described above), and one-look
  sampling (FL-distance fibers, D-layer states, fixed-solution preimages).
  Unit-tested from Node (`npm run test:trainer`), which is why it is a plain
  `.mjs` module.
- `index.jsx` — entry point: mounts `<SkewbTrainer/>` at `#root`, provides a
  localStorage fallback for `window.storage`.

## Workflow
```
npm install            # once
npm run build:trainer  # -> js/trainer.js
npm run watch:trainer  # rebuild on change
npm run test:trainer   # substrate tests (builds two full-space BFS tables — slow-ish)
```
Then serve the site over HTTP (e.g. `npx serve`) and open
http://localhost:3000/trainer.html — the trainer `fetch`es `data/skewb_algs.json`,
so `file://` won't work. Signed out, progress is in localStorage; to test
without touching real progress, use a private window. Commit the regenerated
`js/trainer.js` with your source change.

## Integration contract (must stay true for a drop-in build)
- Mounts at `#root` (React 18 `createRoot`).
- Reads/writes its whole state via `window.storage` (async `get`/`set`) under
  the single key `skewb-trainer-v1`; unknown/legacy blobs are ignored, never
  migrated. The host page bridges `window.storage` to the shared account
  (`window.OOAccount`, cloud doc field `'trainer'`), falling back to
  localStorage when signed out.
- The host page must load `js/engine.js` → `js/render.js` → `js/tables.js`
  before the bundle: diagrams render through `window.OORender` and the
  scramble distance table comes from `window.OOTables.loadOrBuildDist`
  (IndexedDB `skewbiks-oo`/`oo-dist-v1`, shared with the census — first-ever
  build ~18 s, instant thereafter). The first-layer table (One-look) is built
  lazily on first use and cached under `trainer-fldist-v1`.
- Styling comes from `css/site.css` + `css/trainer.css` (the same files the
  live page loads); the component carries no inline `<style>`. New
  trainer-only classes live in `css/trainer.css`.

## Status
`trainer.html` serves the build of this source (`js/trainer.js`, loaded with a
content-hash `?v=` that `npm run stamp` maintains). The Pyraminx-era
`l5e-trainer.jsx` was deleted in M6 (git history retains it).
