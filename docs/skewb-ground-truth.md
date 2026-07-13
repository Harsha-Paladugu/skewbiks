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

Two frame rules the identity forces (both caught 2026-07-03 against the fixed-frame vectors;
the solvedness-level bridge test CANNOT catch them — only exact facelet comparison can):

1. **Frame direction:** the parsing frame resolves written letters through the INVERSE of the
   accumulated leftover rotation, so each written free-corner quarter turn advances the frame
   by **+amt powers of the native-direction 120° rotation** (`steps = amt % 3`, not `2·amt`).
   With the direction inverted, every move written AFTER a `B` acts on the wrong corner —
   states stay self-consistent in-engine but disagree with a physically executed scramble.
2. **Display frame:** the pinned model absorbs each `B`'s rotation, so raw `toFacelets` can
   show the UFL corner twisted — impossible on a real cube (no WCA move touches the
   white/red/green corner's half). All rendering goes through **`toFixedFacelets`**: rotate by
   `240° × fx[UFL]` about the UFL–DBR diagonal so UFL reads solved. For every rotation-free
   WCA alg, `toFixedFacelets(applyParsed(A))` equals the literal fixed-frame facelet result of
   `A` (the pristine-UFL representative of a position is unique, so matching UFL forces exact
   equality) — diagrams therefore match a real cube after the printed scramble, token for
   token against the TNoodle vectors and the KPW 2015 scramble.

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

The **state-symmetry** group (acting on states without re-anchoring) is the
**tetrad-preserving** subgroup, order 24 = 12 proper rotations (≅ A4: identity, eight
120°/240° corner-diagonal rotations, three 180° face rotations) + 12 improper
(mirror ∘ rotation) — structurally identical to the Pyraminx engine's {rots:12, mirrors:12}.
Case keying (`realCanonKey`) folds only the **y² view** (180° about U, tetrad-preserving);
the four viewing presentations of a case are paired at the DATA level via the alg sheet's
`direction` field, like the Pyraminx sheet's bar directions.

**The hold symmetry (machine-verified 2026-07-10).** The other 12 PROPER rotations of the
cube — the 90°-type "re-holds" (six 90° face rotations + six 180° edge rotations) — swap
the corner tetrads, so they are NOT raw state symmetries: conjugating a state by one
displaces the axis tetrad. But they DO act on states via **re-anchoring**:

```
ι(s) = reanchor( ρ0 · Φ(s) · ρ0⁻¹ )        ρ0 = one fixed tetrad-swapping rotation
```

(Φ(s) = the physical sticker permutation of any word reaching s — ι is word-independent
because the state determines Φ; reanchor = the unique tetrad-preserving rotation putting
every axis piece back on its own slot.) Physically: the same scramble performed, gesture
for gesture, on a solved cube held 90° differently. Every turn keeps its handedness, so a
right-handed solution transfers move for move — which is why the census MUST fold these 12
along with the engine's 12 (a "24 proper rotations" fold), while mirrors must NOT fold.
**Chirality (CW vs CCW) is invariant under all 24 rotations and only mirrors flip it**:
the two depth-1 one-move classes ({U L R F} plain = CW, primes = CCW) stay distinct under
every rotation and are each ι-fixed; written WCA `B` from solved is rotation-class-equal to
a plain (CW) native move, `B'` to a prime (CCW) one — pinned in tools/verify-space.mjs.

Engine implementation (`makeHoldSym` / `makeHold24Canon` / `makeFull48Canon`, engine.js):
ι is computed by the **free-turn route** — conjugating a native move about axis corner A by
ρ0 gives the physical free-corner hemisphere turn at ρ0(A), same handedness, so ι(s) is ONE
`applyParsed` pass over the ρ0-conjugated free-corner token stream of any word reaching s,
from the identity start. It must be one stream: every free-corner turn parks a 240°
whole-cube rotation in the parse frame that re-aims all LATER letters (applying the turns
one at a time with fresh frames is physically wrong — machine-falsified 2026-07-10). ρ0 is
pinned at init (proper: det +1; involution — that makes ι(ι(s)) = s at the STATE level;
tetrad-swapping); tools/verify-space.mjs re-proves ι against an independent facelet-level
conj+reanchor construction on samples, plus involution/depth/chirality preservation.

Mirror for `mirrorAlg`: reflection across the plane x+z=0 (contains UFL, UBR, U, D). Face map
{U:U, D:D, R:B, B:R, F:L, L:F}; corner action: fixes UFL, UBR, DFL, DBR; swaps DFR↔DBL and
UFR↔UBL; twists negate. Written-letter map: **{R↔L, U→U′, B→B′}** with prime flips — same map
as the Pyraminx engine.

**Fold ladder** (from the verification BFS; all machine-verified 2026-07-10; use as oracles):

```
3,149,280 raw reachable states
   → 262,674   12 tetrad-preserving rotations              (intermediate oracle)
   → 132,315   24 proper rotations (12 + ι)                ← THE CENSUS entry fold
   vs 131,391  12 rotations + 12 mirrors                   (the pre-2026-07-10 census)
   → 66,321    all 48 (24 rotations + 24 mirror images)    ← the census PAGE pairing
```

Fixed-point counts over the 262,674 rotation classes: the ι involution fixes **1,956**
(⇒ (262,674+1,956)/2 = 132,315), the mirror involution fixes **108**. Of the 132,315
hold-24 entries, **327** are self-mirror (2·66,321 − 132,315 = 327 single-side pages).
The 90 depth-11 antipodes form 12 classes under the 12rot+mirror group. Per-depth hold-24
entry counts (depth 0..11) — note depth 1 = 2, the CW and CCW classes:

```
depth:    0  1  2   3   4    5     6      7      8      9     10  11
entries:  1  2  4  16  80  444  2514  13254  51374  61115  3500  11
```

**The OO census counts hold-24 entries** (`makeHold24Canon`, IndexedDB key `oo-classes-v4`,
132,315 entries; community solutions are righty-tuned, so a position and its LR mirror are
separate entries, each with its own ordinal, done-bit, solutions and cap). The census page
key / Firestore `pairSolutions` query key is `makeFull48Canon` (66,321 pages) — the two
mirror sides share one page, shown side by side. `makeCanon`/`makeMirrorCanon`/
`makeFullCanon` survive as oracles/intermediates. The sheet/trainer case keying
(`realCanonKey`, y²-fold) is unaffected.

## The CF subset (centers solved relative to each other) — machine-verified 2026-07-13

A state is **CF** when some whole-cube rotation would make every center match its face —
i.e. `ctr[ρ(f)] = f` for a rotation ρ. Only the 12 tetrad-preserving rotations can match:
`ctr` is always an even permutation, and the 12 tetrad-swapping re-holds act as odd
permutations on the six centers. So the test set is 12 center arrangements
(`E.centersRelSolved`; the arrangements come from `properRotFps()`, the same face-perm
enumeration `buildSyms` uses). NOTE the arrangements are what a physically rotated solved
cube LOOKS like — symmetries act on states by conjugation, so `sym.apply(solved)` is solved
and useless for building them (falsified 2026-07-13, first construction attempt).

Counts (oracles in tools/verify-space.mjs): **104,976 raw states** (= 12 × 8,748, the
per-arrangement fiber) → **4,503 hold-24 census entries**. Per-depth:

```
depth:        0  1  2  3   4    5     6     7      8      9    10  11
raw CF:       1  0  0  0  72  360  2244  9588  36103  53084  3484  40
CF entries:   1  0  0  0   4   16    99   407   1533   2264   174   5
```

The predicate is constant on every hold-24 orbit (all 24 rotation images of s and ι(s))
AND under mirrors — verified exhaustively over all 132,315 entries — so the census
classifies an entry by testing its rep alone (js/oo.js `T.cfIdx`), and both sides of a
mirror pair always agree on the CF badge. The census UI: a "CF · centers solved" scope
on Browse by depth (`#/browse/cf/<depth>`), a CF chip on position pages, a home-page
link. Fast gates: two `centersRelSolved` tests in tools/test-engine.mjs (depth ≤ 4
witness sweep + 24-sym invariance).

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
mix rotations into solutions.

**Engine rotation-token direction (machine-verified 2026-07-07):** the engine's `x y z`
tokens each denote the PHYSICAL INVERSE of the WCA/cubing.js rotation of the same name
(engine x = physical x′, engine y = physical y′, engine z = physical z′). Verified by a
facelet-conjugation probe (`engine "rot T rot'"` vs the physical rotation applied to the
TNoodle-validated fixed-frame facelet moves, compared up to a whole-cube rotation; T long
and asymmetric, exactly one of the six 90° hypotheses matches per letter). Every earlier
oracle — the y² canon fold, the NS identities `x2 B x2`/`y2 B y2`/`z2 B z2` — uses 180°
rotations and is direction-blind, which is why this was invisible until the solver started
printing quarter rotations. All engine surfaces are mutually consistent (parseAlg,
nativeToWCA, prependAUF y-chips, the solver's mid-solve rotations), but a WCA-literate
human reading a printed engine `x` will physically rotate the wrong way. Consequently the
sheet mapping (§ data/sources/README.md) composes to: sheet x/y/z = engine z′/y′/x =
**physical z/y/x′** — the sheets' own `y` IS the physical WCA y. Flipping the engine to
the WCA convention is a pending decision: rotations never touch states so no tables/keys
change, but typed solutions containing rotations re-verify differently, the importer's
rotation-mapping constants must flip in lockstep (re-import `data/skewb_algs.json`), and
the site's Right/Left presentation labels swap which physical view they denote.

**Physical execution vs the engine's hold reading (2026-07-07, machine-verified against
three junction rotations the USER executed physically — sheet letters `y′ z`, `y x′`,
`y2 z`):** the correct model of how a human executes a text is: move letters twist the
corner at a FIXED hand position; rotation letters turn the cube about fixed spatial axes,
in reading order. Machine-discriminated: this model solves **3,082/3,082** imported texts
from their engine identity pre-states (a grip-relative rotation reading solves 641) — so
ENGINE evaluation from IDENTITY starts is physically faithful, walks included. Behind a
rotation prefix it is NOT: the engine's frame-walk reading of "hold + text" makes claims
that are false as physical statements (USER junction 2: the engine-derived setup rotation
was a quarter turn off the physically-working `y x′`). Physically the match relation is
rotation-CLOSED conjugation — a junction J is solved by body Φ from setup rotation R iff
Φ(R(J)) is solved in ANY orientation. A second subtlety: the DISPLAYED first step
substitutes WCA `B` / NS `b` for native-UFL-axis moves, and executing the substituted
letter leaves the cube walk-rotated relative to the native bookkeeping — the junction the
human holds is W(J), and the printed rotation must be derived from W(J), not J (USER
junction 1: `y′ z` from W(J) vs the spurious `x2` from J). The solver (js/solver-core.js)
therefore runs all hold/rotation logic in a PHYSICAL facelet model anchored to the
TNoodle-validated perms: per text it indexes Φ⁻¹ of the 24 solved orientations, matches
junctions under 24 rotations, and derives every display rotation there — spelled in SHEET
letters (sheet x/y/z = physical z/y/x′ — the letters this community reads; engine letters
are INTERNAL and never displayed) — re-proving every displayed line by a facelet check.
Coverage under the physical model measured count-identical to the old engine-frame index
at the time (2,733 / 10,392 / 3,180 on 2026-07-07 — the match relation agreed, the printed
rotations did not); BOTH of those measurements were under the engine-letter misread of
mid-alg rotation tokens and are superseded — the true coverage under the sheet-letter
reading is 3,109 / 11,964 / 3,204 (see the Flip note below, 2026-07-10).
As of 2026-07-10 the WHOLE reconstruction is displayed physically: `[lead rotation]
[first layer in the sheet vocabulary {R,B,r,b}] [setup rotation] [finish alg]`. The layer
uses only the four right-side corner names (one per space diagonal — L/l/F/f never appear,
matching the sheets' own alg vocabulary), and the lead rotation is picked so the built
layer lands on the bottom (a leading rotation genuinely reorients the build — it is NOT
compensated by the renamed moves, machine-checked — so methodView derives lead + setup
together and physically re-proves the line). A third subtlety, USER-falsified the same day
(scramble `B' R L U' L' B' R' U'`: the printed lead `y′` failed at the table, `x` worked):
the reconstruction must start from the facelets the human ACTUALLY HOLDS after executing
the scramble TEXT — physPerm of the parsed scramble (`heldFacelets`) — not from the pinned
state's raw facelets. Every written free-corner letter (WCA `B`, NS `R L f b`) leaves a
240° whole-cube rotation that the engine absorbs into its parsing frame (`ROT240_UFL`;
same mechanism `toFixedFacelets` corrects for rendering), so the real cube in hand is
G-rotated relative to `toFacelets(state)` — G a property of the TEXT, not the state, and
unrecoverable from the state alone for NS texts. methodView takes the held facelets,
emits the layer from the orientation G∘lead while printing just the lead, and re-proves
the whole line from the held facelets; the counterexample (corrected line, the USER's
hand-verified variant, and the refuted pre-fix line) is pinned in test:solver. Flip note: the community sheets are NOT WCA
(x/z differ), and the USER demonstrably thinks in SHEET letters — flipping the engine to
plain WCA would still leave x/z sight-read wrong; pick the flip target deliberately.
Mid-alg rotation letters in displayed alg bodies were NOT actually a sight-read hazard:
machine-established 2026-07-10, the stored `ns` fields are VERBATIM sheet strings (916 of
the 928 mid-rotation texts solve their WCA-field case state only under the sheet-letter
reading; zero under the engine reading; the other 12 are the unparseable slash texts) —
so what humans read on screen was always right, and the hazard was in the MACHINE: the
solver's finish index was reading those tokens as engine letters (`physPerm`), silently
mis-indexing every mid-rotation body and printing physically wrong setup rotations for
them. Fixed 2026-07-10 with `physPermNS` (sheet-letter physical reading); with it the
finish coverage is essentially complete — 3,109/3,110 fl, 11,964/11,964 tcll,
3,204/3,204 eg2 — falsifying the earlier "≈12 % gap is a property of the sheets"
conclusion below. The trainer's y-chips still assume the engine spelling of `y`; that
and any machine parse of authored texts must route rotations through the sheet map.

Related (found by the M7 solver, 2026-07-07): **the frame machinery is not
conjugation-equivariant** — evaluating the same token text behind different rotation
prefixes does NOT produce rotation-conjugate resolutions, because a letter's resolution
branch (direct axis move vs free-corner move + frame walk) depends on the current frame's
tetrad parity, and walks compose on the LEFT (globally) while rotation tokens compose on
the RIGHT (locally). Under the engine's reading the set of states a text solves "from some
hold" is a property of that text (≤ 24 states, not a view-orbit). **Resolved same day
(see the physical-execution block above): physical execution does NOT agree with the
engine behind rotation prefixes** — physically the solvable set IS rotation-closed, and
the solver no longer uses the engine's hold reading at all (physical facelet model).
CORRECTION 2026-07-10: the "~12 % of fl/tcll junction states without a sheet finish"
measured here WAS an artifact after all — of reading the ns texts' mid-alg rotation
tokens as engine letters (see the Flip note above); under the correct sheet-letter
reading the coverage is essentially complete. The engine's frame machinery remains
corpus-faithful for identity-start evaluation, which is all the rest of the site uses
it for.

### NS ("Rubik'skewb") notation

The system the Sarah's-method / NS 2.0 alg sheets use. Primary source:
`rubikskewb.web.fc2.com/skewb/notation.html` (Japanese; both Ranzha's notation page and the
NS 2.0 speedsolving thread point to it). All EIGHT corners get letters: **uppercase F R B L =
the four top corners, lowercase f r b l = the four bottom corners**, named front/right/back/
left as held. Plain = 120° CW seen from outside that corner, `'` = CCW; `x y z` as in WCA.
Anchored to the WCA scrambling hold (white top, green left, red right — UFL corner toward
you), the engine binding (`NS_CORNER`, machine-verified in tools/test-engine.mjs) is:

| NS | corner | | NS | corner |
|---|---|---|---|---|
| F | UFL (axis; = native F) | | f | DFL (free) |
| R | UFR (free) | | r | DFR (axis; = WCA R) |
| B | UBR (axis; = WCA U) | | b | DBR (free; = WCA B) |
| L | UBL (free) | | l | DBL (axis; = WCA L) |

**WCA → NS is a pure token rename** (R→r, U→B, L→l, B→b; primes/rotations unchanged) — every
WCA letter's corner keeps its letter geometry under interleaved rotations. NS F f R L have no
WCA letter (free-corner/UFL twists; verified: NS `R` = WCA `x2 B x2`, `f` = `y2 B y2`, `L` =
`z2 B z2`, `F` = the native UFL half-twist). NS → WCA therefore converts through the native
stream (`parsedToNative` + `nativeToWCA`): same state, same movecount, input rotations
absorbed. The x+z=0 mirror uses ONE letter map for both systems: U→U′, B→B′, F→F′, f→f′,
b→b′, R↔L and r↔l with prime flips. Local reference copies of the TNoodle sources and the two
verification scripts live outside the repo (GPL; do not commit): see the session scratchpad
(`SkewbSolver.java`, `SkewbPuzzle.java`, `skewb-vectors.mjs`, `skewb-verify.mjs`).

## OO census persistence formats (FROZEN 2026-07-03, M4)

These formats hold live user data in Firestore. Changing any of them after launch
requires an explicit migration; nothing may change silently.

**`solutions/{id}`** (auto-id) — the SOURCE OF TRUTH for everything derived:
`uid`, `status` (`pending|approved|rejected`), `createdAt` (server timestamp),
`pairId`/`classId`/`partnerId` (ints in `[0, 9447840)` = engine state indexes,
`E.idx` over NSLOTS 360×12×2187 — enumeration-independent, NOT class ordinals;
`pairId` = the page-grouping canonical id = `classId` of the rep side — full
48-group canon since 2026-07-10, previously the 24-sym canon; consumers never
trust a stored `pairId` beyond querying, everything is re-derived from
`classId`), `scramble`
(engine WCA string), `solution` (text as typed), `notation` (`'wca'|'ns'` — the
system `solution` is written in; `scramble` is always WCA), `moves` (int 1–15),
`name`, `showName`, and after review `reviewedBy` (email). Field set enforced by
`firestore.rules` `hasOnly`.

**`meta/doneMap`** — `{ b64 }`: base64 of a `Uint8Array(⌈132315/8⌉)`; bit `o`
(byte `o>>3`, mask `1<<(o&7)`) = "class ordinal `o` has an approved solution".
**Ordinals index the sorted `oo-classes-v4` reps array** (ascending state-index
order, 132,315 hold-24 entries — js/tables.js `KEY_CLASSES`; one entry per
mirror SIDE, and a bit is derived from a doc's `classId` via the HOLD-24 entry
canon (`makeHold24Canon`) — an approved solution marks only the side it
solves). The bitmap is therefore coupled to the class enumeration: if the class
key/enumeration ever changes, bump `KEY_CLASSES` AND rebuild the bitmap in the
same release — the Moderation tab's admin "Recompute solved bitmap" rebuilds it
from the solution docs' `classId` (state indexes survive any re-enumeration).
That recompute is the required migration step after the v3→v4 re-key (as it was
for v2→v3): an older bitmap indexes a different enumeration and is discarded by
a size guard rather than misread.

**`meta/stats`** — `{ done, total }`: `done` = popcount of doneMap (distinct
solved SIDES; depth-0 is *not* in the bitmap — the UI counts it as solved by
definition), `total` = 132,315. Both meta docs are derived caches; the admin
recompute action regenerates them from the approved solutions at any time (and
they self-heal at the next approve — page code never writes them).
