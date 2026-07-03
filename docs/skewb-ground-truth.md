# Skewb engine ground truth

Machine-verified facts the engine (`js/engine.js`), its tests (`tools/test-engine.mjs`), and
`tools/verify-space.mjs` are built against. Sources: WCA Regulations Art. 12h; tnoodle-lib
`SkewbSolver.java`/`SkewbPuzzle.java` (commit `3688c663`, read verbatim); csTimer `skewb.js`;
ksolve+ `skewb.def`; Jaap's Puzzle Page (jaapsch.net/puzzles/skewb.htm); OEIS A079745.
Independently reproduced by a from-scratch geometric BFS (all counts below matched exactly).

## Corners, tetrads, WCA letters

Frame: x=R, y=U, z=F. **Axis ("fixed") tetrad: {UBR, UFL, DFR, DBL}** — these corners never
leave their slots under the native move group; they only twist. **Free tetrad: {UFR, UBL,
DFL, DBR}** — permutes (A4, 12 even perms) and twists. WCA scrambling colors: U=white, R=blue,
F=red, D=yellow, L=green, B=orange; the **UFL corner (white/red/green) is stationary** during
official scrambles.

WCA moves (Regulations 12h, each 120° CW viewed from outside that corner):

| Letter | Corner | Tetrad |
|---|---|---|
| R | DFR | axis |
| U | UBR | axis |
| L | DBL | axis |
| **B** | **DBR** | **free** (antipode of the unused axis corner UFL) |

**WCA B is NOT an axis move.** Machine-verified identity: `B = (native CW move about UFL)
followed by (240° whole-cube rotation about the UFL–DBR diagonal)`; the factors commute.
TNoodle solves in the native tetrad metric and converts at the notation boundary ("convert F
to B by rotation [F' B]; when an F is emitted, replace by B and cycle the other three
letters"). Our engine does the same: **native moves = half-twists about the four axis-tetrad
corners; written `B` (and `x/y/z` rotations) are handled by `applyParsed`'s frame machinery**,
exactly like Pyraminx wide moves. 1 written move = 1 native move, so the depth metric is
unchanged.

## Native move tables (CW; `a→b` = piece at slot a moves to slot b)

| Native axis | corner 3-cycle (free tetrad) | center 3-cycle (faces) |
|---|---|---|
| DFR (written R) | UFR→DBR→DFL→UFR | F→R→D→F |
| UBR (written U) | UFR→UBL→DBR→UFR | U→B→R→U |
| DBL (written L) | DFL→DBR→UBL→DFL | L→D→B→L |
| UFL (no letter; = written B via frame) | UFR→DFL→UBL→UFR | U→F→L→U |

Twist convention (TNoodle/csTimer): the axis corner gets **+1** (mod 3), each of the three
cycled free corners gets **+2** (mod 3). `X X X = identity`; `X2 ≡ X'`.

Fixed-frame WCA B (for facelet-level tests only): centers R→B→D→R, axis corners
UBR→DBL→DFR→UBR, DBR twists in place.

## State space

Reachable states: **3,149,280** = 360 (centers reach all of A6) × 12 (free tetrad reaches all
of A4) × 3⁶. Eight twist digits lose exactly **two** degrees of freedom:

1. **Free-tetrad sum:** `sum(fo) ≡ 0 (mod 3)` — always. Reconstruct the 4th free digit as
   `(3 − fo0 − fo1 − fo2) % 3` (TNoodle uses `(6 − …) % 3`).
2. **Linking constraint:** `sum(fx) ≡ class(freePerm) (mod 3)` where `class` is the A4/V4 ≅ Z3
   coset of the free-tetrad permutation. TNoodle: `ori[perm % 12] == (sum of fixed digits) % 3`
   with `ori = {0,1,2,0,2,1,1,2,0,2,1,0}` over its 12 perm indices. Every native move adds +1
   to one fixed twist AND advances the free-perm class by +1 — locked together.

Dense index (TNoodle/csTimer layout): `perm = centerEvenRank(360) * 12 + freeEvenRank(12)`,
`twst ∈ 3⁷ = 2187` (four fixed digits + three free digits), `NSLOTS = 4320 × 2187 =`
**9,447,840**; exactly 1/3 of slots are reachable (constraint 2 is the filter). Even-perm
ranking uses `fact[x] = x!/2`: `{1,1,1,3,12,60,360}` for 6, `{1,1,1,3}` for 4 — the last two
Lehmer digits are forced by parity.

## God's number and depth histogram (test oracle)

Metric: 8 native moves (= WCA metric, conversion is length-preserving). **Diameter 11**,
average 8.3636. Full histogram (Jaap / OEIS A079745, reproduced exactly):

```
depth:     0  1   2    3     4      5      6       7        8        9       10  11
positions: 1  8  48  288  1728  10248  59304  315198  1225483  1455856  81028  90
```

## Symmetry (test oracles)

The relevant group is the **tetrad-preserving** subgroup T_d, order 24 = 12 proper rotations
(≅ A4: identity, eight 120°/240° corner-diagonal rotations, three 180° face rotations) + 12
improper (mirror ∘ rotation) — structurally identical to the Pyraminx engine's
{rots:12, mirrors:12}. 90° cube rotations (single `y` etc.) swap the tetrads and are NOT
state symmetries; they appear only in the notation frame. Case keying (`realCanonKey`)
therefore folds only the **y² view** (180° about U, tetrad-preserving); the four viewing
presentations of a case are paired at the DATA level via the alg sheet's `direction` field,
like the Pyraminx sheet's bar directions.

Mirror for `mirrorAlg`: reflection across the plane x+z=0 (contains UFL, UBR, U, D). Face map
{U:U, D:D, R:B, B:R, F:L, L:F}; corner action: fixes UFL, UBR, DFL, DBR; swaps DFR↔DBL and
UFR↔UBL; twists negate. Written-letter map: **{R↔L, U→U′, B→B′}** with prime flips — same map
as the Pyraminx engine.

Computed class counts (from the verification BFS; use as oracles): canon over 12 proper
rotations → **262,674** classes; over all 24 → **131,391**; the 90 depth-11 antipodes form 12
classes under the 24-group.

## Test vectors

Facelet convention (TNoodle net): faces 0=U 1=R 2=F 3=D 4=L 5=B; per face sticker 0 = square
center, 1–4 = corner triangles at NW,NE,SW,SE of the face's net square. Sticker→corner map:

| Face | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| U | UBL | UBR | UFL | UFR |
| R | UFR | UBR | DFR | DBR |
| F | UFL | UFR | DFL | DFR |
| D | DFL | DFR | DBL | DBR |
| L | UBL | UFL | DBL | DFL |
| B | UBR | UBL | DBR | DBL |

Solved: `UUUUU RRRRR FFFFF DDDDD LLLLL BBBBB`. Single WCA moves from solved (fixed frame):

```
R  : UUUUL FFRFF DFDDD RRRDR LLLLB BBBUB
R' : UUUUB DDRDD RFRRR FFFDF LLLLU BBBLB
U  : RRRUR BBBRB FFDFF DDDDL LFLLL UUUUB
U' : BBBUB UUURU FFLFF DDDDF LDLLL RRRRB
L  : URUUU RRRRF FFFUF LLDLL BBLBB DBDDD
L' : UFUUU RRRRU FFFRF BBDBB DDLDD LBLLL
B  : UUFUU DRDDD FFFFL BDBBB LLLUL RRBRR
B' : UULUU BRBBB FFFFU RDRRR LLLFL DDBDD
```

Official WCA scramble (KPW 2015 final, delegate-confirmed; TNoodle always emits exactly 11
moves, min distance 7 per reg 4b3c):

```
scramble : L R L U' B R' U' R' L R B
state    : UUBUB LDDBL DFRLU BFRRU FRLFD RLFBD
```

Discriminating mis-scramble (10th move R′ instead of R):
`L R L U' B R' U' R' L R' B → UUDUD RLLBD LFFLU BBRRB FRLFU DBFRD`.

Structural invariants: order(R U) = 45; order(R U′) = 30; order(R U R′ U′) = 6;
order(R′ L R L′) = 6; UFL's stickers (U3, F1, L2) fixed by every move; every move changes
exactly 15 facelets.

## Notation notes

Rotations `x y z` are 90° whole-cube rotations (order 4); cubing.js maps x→Rv, y→Uv, z→Fv.
No wide moves exist (opposite-corner move ≡ inverse move + rotation). Community algs freely
mix rotations into solutions. Local reference copies of the TNoodle sources and the two
verification scripts live outside the repo (GPL; do not commit): see the session scratchpad
(`SkewbSolver.java`, `SkewbPuzzle.java`, `skewb-vectors.mjs`, `skewb-verify.mjs`).
