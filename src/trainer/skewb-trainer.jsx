import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createCore, DIRS, Y_PREFIX, SEP, rateRank, SOL_EXAMPLES } from "./skewb-core.mjs";

// ============================================================
// Skewbiks trainer — three tools over the imported method sheets
//   Algorithm (drill / recap): masked scrambles onto sheet cases
//   Recognition: name the case from the diagram, self-graded
//   One-look: predict the case in inspection — random N-move
//   layers, or scrambles built for your saved layer solutions
// ============================================================

// ---------- shared site layers (loaded by trainer.html before this bundle) ----------
const E = window.OOEngine;
const R = window.OORender;
const T = window.OOTables;
const core = createCore(E);

const STORE_KEY = "skewb-trainer-v1";
const FLDIST_KEY = "trainer-fldist-v1"; // OOTables IndexedDB (never the frozen oo-* keys)
const DATA_URL = "data/skewb_algs.json";

// subset chip colors (arbitrary UI palette, assigned in authored order)
const SUBSET_COLORS = ["#3577cc", "#27975a", "#cf4d44", "#9355bd", "#cd7c20", "#74882b"];

// ---------- notation (shared site-wide pref; NS default like the algs page) ----------
const NOTA_KEY = "skewbiks-notation";
const isRotTok = (t) => /^[xyz](2'|2|')?$/.test(t);

// ---------- helpers ----------
const fmt = (ms) => (ms / 1000).toFixed(2);
const shuffled = (a) => {
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};
const statKey = (uid, d) => uid + SEP + d;
const knownKey = statKey;

// diagram through the shared renderer (default `oonet` class keeps the site's
// polygon stroke CSS — an overridden class would drop it). `mask` = display
// facelet indices to hide (partial recognition).
function Net({ state, w, mask, pinned }) {
  const html = R && state ? R.netSVG(state, w || 240, { thumb: true, mask, pinned }) : "";
  return <div className="skewbnet" dangerouslySetInnerHTML={{ __html: html }} />;
}

// recognition diagrams use the Algorithms page's picture: the community's
// bat-shaped sheet development (render.js caseSVG, D face hidden), drawn from
// the raw pinned facelets. Recognition only shows the d = 0/2 views, and those
// are D-anchored for every sheet case (machine-checked 2026-07-13 against
// solver-core layerDownFacelets; sole exception "TCLL Twoface- U solved",
// whose raw frame was equally off-anchor under the old pinned netSVG), so the
// raw facelets ARE the algs-page picture and mask indices stay display indices.
function CaseNet({ state, w, mask }) {
  const html = R && state ? R.caseSVG(E.toFacelets(state), w || 240, { cls: "skewbsvg", mask }) : "";
  return <div className="skewbnet" dangerouslySetInnerHTML={{ __html: html }} />;
}

// alg text as evenly-spaced tokens, rotations tinted (algs-page convention)
function AlgText({ text }) {
  return (
    <span className="mono alg">
      {String(text).split(/\s+/).filter(Boolean).map((t, i) => (
        <span key={i} className={isRotTok(t) ? "tok rot" : "tok"}>{t}</span>
      ))}
    </span>
  );
}

export default function SkewbTrainer() {
  const distRef = useRef(null);
  const fldistRef = useRef(null);
  const flBuilding = useRef(false);
  const modelRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [boot, setBoot] = useState({ stage: "load", pct: 0, msg: "" });
  const [flBoot, setFlBoot] = useState(null); // null | {pct} | 'ready' | 'error'

  // ---------- notation ----------
  const [nota, setNotaState] = useState(() => {
    try { const v = localStorage.getItem(NOTA_KEY); if (v === "wca" || v === "ns") return v; } catch (e) {}
    return "ns";
  });
  const setNota = (v) => {
    const n = v === "ns" ? "ns" : "wca";
    setNotaState(n);
    try { localStorage.setItem(NOTA_KEY, n); } catch (e) {}
  };
  const dispAlg = useCallback((s) => (s && nota === "ns") ? E.wcaToNS(s) : s, [nota]);
  // sheet algs show their authored executable form in BOTH modes (WCA's four
  // letters can't express the free-corner moves); engine strings follow the toggle
  const rowText = (row) => (row.a && row.a.ns) ? row.a.ns : dispAlg(row.core);

  // ---------- selection (defaults resolve lazily against the model) ----------
  const [subsetSel, setSubsetSel] = useState(null);   // null = default (first subset)
  const [groupSel, setGroupSel] = useState({});       // subset -> enabled group values (missing = all)
  const [caseOff, setCaseOff] = useState(() => new Set());   // DISABLED case uids
  const [caseKnown, setCaseKnown] = useState(() => new Set()); // KNOWN uid␟0 (dir dimension retired)
  const [scope, setScope] = useState("all");
  const [mode, setMode] = useState("drill");
  const [setupOpen, setSetupOpen] = useState(true);
  const lastAlgoMode = useRef("drill");

  const model = () => modelRef.current;
  const subsetOn = useCallback((key) => {
    if (subsetSel === null) { const m = model(); return !!m && m.subsets.length > 0 && m.subsets[0].key === key; }
    return subsetSel.includes(key);
  }, [subsetSel]);
  const groupsOf = useCallback((sub) => {
    const sel = groupSel[sub.key];
    return sel === undefined ? sub.groups.map((g) => g.value) : sel;
  }, [groupSel]);

  // ---------- run state ----------
  const [current, setCurrent] = useState(null);
  const [phase, setPhase] = useState("ready");
  const [elapsed, setElapsed] = useState(0);
  const [last, setLast] = useState(null);
  const [caseStats, setCaseStats] = useState({});
  const [recogStats, setRecogStats] = useState({});     // full view: uid -> {n, hit, sum(ms), subset, name}
  const [centersStats, setCentersStats] = useState({}); // centers quiz: answer -> {n, hit, dk, sum(ms)}
  const [recogView, setRecogView] = useState("full");   // 'full' | 'centers'
  const [centerSel, setCenterSel] = useState(["U", "F", "L"]); // the chosen 3-center combo (in pick order)
  const [cornersOn, setCornersOn] = useState(false);    // also show 2 random U-layer corners
  const [onelookView, setOnelookView] = useState("len"); // 'len' (random N-move layer) | 'sol' (fixed layer solution)
  const [onelookLen, setOnelookLen] = useState(3);       // moves to the nearest layer (0..6)
  const [onelookSols, setOnelookSols] = useState([]);    // [{raw, nota, on}] — saved layer solutions, verbatim
  const [onelookStats, setOnelookStats] = useState({});  // key -> {label, n, hit, sum(ms)}
  const [solDraft, setSolDraft] = useState("");          // solution input draft (not persisted)
  const [solError, setSolError] = useState("");
  const [solsOpen, setSolsOpen] = useState(false);       // saved-solutions dropdown (not persisted)
  const [session, setSession] = useState([]);
  const [recap, setRecap] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expandedVariant, setExpandedVariant] = useState(null);
  const [caseBrowser, setCaseBrowser] = useState(null); // subset key whose browser is open

  const t0 = useRef(0);
  const raf = useRef(0);
  const stoppedAt = useRef(-Infinity); // NOT 0: a warm-cache boot beats the 350ms tap guard
  const shownAt = useRef(0);      // recognition: when the diagram appeared
  const loadedStore = useRef(false);

  // ---------- boot: stored state, alg data, shared dist table ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await window.storage.get(STORE_KEY);
        if (res && res.value && !cancelled) {
          const d = JSON.parse(res.value);
          // strict shape validation — unknown/legacy blobs are simply ignored
          if (d && typeof d === "object") {
            if (Array.isArray(d.subsetSel)) setSubsetSel(d.subsetSel.filter((k) => typeof k === "string"));
            if (d.groupSel && typeof d.groupSel === "object") setGroupSel(d.groupSel);
            if (Array.isArray(d.caseOff)) setCaseOff(new Set(d.caseOff.filter((x) => typeof x === "string")));
            if (Array.isArray(d.caseKnown)) setCaseKnown(new Set(d.caseKnown.filter((x) => typeof x === "string")));
            if (["all", "learning", "known"].includes(d.scope)) setScope(d.scope);
            if (["drill", "recap", "recog", "onelook"].includes(d.mode)) setMode(d.mode);
            if (typeof d.setupOpen === "boolean") setSetupOpen(d.setupOpen);
            if (d.caseStats && typeof d.caseStats === "object") {
              const cs = {};
              for (const [k, st] of Object.entries(d.caseStats)) {
                if (st && typeof st.n === "number" && typeof st.sum === "number") cs[k] = st;
              }
              setCaseStats(cs);
            }
            const readGrades = (src, set) => {
              if (!src || typeof src !== "object") return;
              const rs = {};
              for (const [k, st] of Object.entries(src)) {
                if (st && typeof st.n === "number" && typeof st.hit === "number") rs[k] = st;
              }
              set(rs);
            };
            readGrades(d.recogStats, setRecogStats);
            readGrades(d.centersStats, setCentersStats);
            readGrades(d.onelookStats, setOnelookStats);
            if (d.recogView === "full" || d.recogView === "centers") setRecogView(d.recogView);
            if (d.onelookView === "len" || d.onelookView === "sol") setOnelookView(d.onelookView);
            if (Number.isInteger(d.onelookLen) && d.onelookLen >= 0 && d.onelookLen <= 6) setOnelookLen(d.onelookLen);
            const okSol = (s) => s && typeof s.raw === "string" && s.raw.length <= 200 &&
              (s.nota === "wca" || s.nota === "ns");
            if (Array.isArray(d.onelookSols)) {
              setOnelookSols(d.onelookSols.filter(okSol).slice(0, 24)
                .map((s) => ({ raw: s.raw, nota: s.nota, on: s.on !== false })));
            } else if (okSol(d.onelookSol)) { // pre-list blobs stored a single solution
              setOnelookSols([{ raw: d.onelookSol.raw, nota: d.onelookSol.nota, on: true }]);
            }
            if (Array.isArray(d.centerSel)) {
              const cs = d.centerSel.filter((f) => core.RECOG_CENTERS.includes(f)).slice(0, 3);
              if (cs.length) setCenterSel(cs);
            }
            if (typeof d.cornersOn === "boolean") setCornersOn(d.cornersOn);
          }
        }
      } catch (e) { /* first run / foreign blob */ }
      loadedStore.current = true;

      const tick = () => new Promise((r) => setTimeout(r, 0));
      const report = (stage, n, total) => {
        if (!cancelled) setBoot({ stage, pct: total ? Math.round((n / total) * 100) : 0, msg: "" });
      };
      try {
        const [json, dist] = await Promise.all([
          fetch(DATA_URL).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status + " loading alg data"); return r.json(); }),
          T ? T.loadOrBuildDist(E, report, tick) : Promise.reject(new Error("js/tables.js missing")),
        ]);
        if (cancelled) return;
        modelRef.current = core.buildModel(json);
        distRef.current = dist;
        setReady(true);
      } catch (e) {
        if (!cancelled) setBoot({ stage: "error", pct: 0, msg: String((e && e.message) || e) });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ---------- first-layer table (lazy: built/loaded when One-look is opened) ----------
  useEffect(() => {
    if (mode !== "onelook" || !ready || fldistRef.current || flBuilding.current) return;
    flBuilding.current = true;
    (async () => {
      const cached = T && await T.idbGet(FLDIST_KEY);
      if (cached && cached.dist) { fldistRef.current = new Int8Array(cached.dist); setFlBoot("ready"); return; }
      setFlBoot({ pct: 0 });
      const tick = () => new Promise((r) => setTimeout(r, 0));
      const g = await core.buildFLDist((st, n, total) => setFlBoot({ pct: Math.round((n / total) * 100) }), tick);
      fldistRef.current = g;
      if (T) T.idbPut(FLDIST_KEY, { dist: g.buffer });
      setFlBoot("ready");
    })().catch(() => setFlBoot("error"));
  }, [mode, ready]);

  // ---------- persistence ----------
  const saveTimer = useRef(0);
  const persist = useCallback((over) => {
    try {
      window.storage.set(STORE_KEY, JSON.stringify({
        subsetSel, groupSel, caseOff: [...caseOff], caseKnown: [...caseKnown],
        scope, mode, setupOpen, caseStats, recogStats, centersStats, recogView, centerSel, cornersOn,
        onelookView, onelookLen, onelookSols, onelookStats, ...over,
      })).catch(() => {});
    } catch (e) {}
  }, [subsetSel, groupSel, caseOff, caseKnown, scope, mode, setupOpen, caseStats, recogStats, centersStats, recogView, centerSel, cornersOn, onelookView, onelookLen, onelookSols, onelookStats]);
  useEffect(() => {
    if (!loadedStore.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persist, 400);
  }, [persist]);
  // the debounce loses the last ≤400ms of changes if the tab closes/reloads
  // right after an action — flush the pending save the moment the page hides
  // (the host bridge sends cloud writes immediately once hidden)
  useEffect(() => {
    const flush = () => {
      if (!loadedStore.current) return;
      clearTimeout(saveTimer.current);
      persist();
    };
    const onVis = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [persist]);

  // ---------- the practice pool: enabled cases (authored presentation only) ----------
  const entries = useMemo(() => {
    if (!ready) return [];
    const out = [];
    for (const sub of model().subsets) {
      if (!subsetOn(sub.key)) continue;
      const on = new Set(groupsOf(sub));
      for (const g of sub.groups) {
        if (!on.has(g.value)) continue;
        for (const c of g.cases) {
          if (caseOff.has(c.uid)) continue;
          const kn = caseKnown.has(knownKey(c.uid, 0));
          if (scope === "learning" && kn) continue;
          if (scope === "known" && !kn) continue;
          out.push({ c, subset: sub.key });
        }
      }
    }
    return out;
  }, [ready, subsetOn, groupsOf, caseOff, caseKnown, scope]);

  // ---------- problem generation ----------
  const makeDrill = useCallback((entry) => {
    const target = core.stateForDir(entry.c, 0);
    if (!target) return null;
    const scramble = core.maskedScramble(target, distRef.current);
    if (!scramble) return null;
    return { kind: "drill", c: entry.c, d: 0, subset: entry.subset, state: target, scramble };
  }, []);

  const nextDrill = useCallback(() => {
    if (!entries.length) { setCurrent(null); return; }
    for (let i = 0; i < 10; i++) {
      const cur = makeDrill(entries[Math.floor(Math.random() * entries.length)]);
      if (cur) { setCurrent(cur); return; }
    }
    setCurrent(null);
  }, [entries, makeDrill]);

  const startRecap = useCallback(() => {
    const queue = shuffled(entries);
    setRecap({ queue, idx: 0 });
    setCurrent(queue.length ? makeDrill(queue[0]) : null);
  }, [entries, makeDrill]);

  // the centers quiz answers with the case's center-case name, resolved from
  // the centers the diagram actually shows (core.quizAnswer — the sheets'
  // vocabulary, machine-normalized where a sheet's own labels are degenerate);
  // cases without an answer can't be quizzed
  const quizEntries = useMemo(() => {
    if (!ready) return [];
    const subs = new Map(model().subsets.map((s) => [s.key, s]));
    return entries
      .map((en) => ({ ...en, answer: core.quizAnswer(subs.get(en.subset), en.c) }))
      .filter((en) => en.answer);
  }, [ready, entries]);
  const quizOptions = useMemo(() => {
    const seen = new Set(), out = [];
    for (const en of quizEntries) if (!seen.has(en.answer)) { seen.add(en.answer); out.push(en.answer); }
    return out;
  }, [quizEntries]);

  const nextRecog = useCallback(() => {
    setPhase("ready"); setLast(null);
    const pool = recogView === "centers" ? quizEntries : entries;
    if (!pool.length || (recogView === "centers" && centerSel.length !== 3)) { setCurrent(null); return; }
    const e2 = pool[Math.floor(Math.random() * pool.length)];
    // full view coin-flips the y² look (same canon, tagged on reveal); the
    // quiz pins the anchor view — its answers name the exact shown centers
    const d = recogView === "centers" ? 0 : Math.random() < 0.5 ? 2 : 0;
    const state = core.stateForDir(e2.c, d);
    if (!state) { setCurrent(null); return; }
    const cur = { kind: "recog", c: e2.c, d, subset: e2.subset, state };
    if (recogView === "centers") {
      cur.view = { centers: centerSel.slice().sort(), corners: cornersOn ? core.pickCorners() : [], fl: true };
      cur.mask = core.maskForView(state, cur.view);
      cur.answerKey = e2.answer;
    }
    shownAt.current = performance.now();
    setCurrent(cur);
  }, [entries, quizEntries, recogView, centerSel, cornersOn]);

  // other center-case answers the shown view is ALSO consistent with (pool-wide
  // scan; states are memoized, so only the first wide scan does real work —
  // the quiz always shows the anchor view, so only d = 0 can collide)
  const quizAmbiguity = useCallback((shown) => {
    const target = core.viewSignature(shown.state, shown.view);
    const others = new Set();
    for (const en of quizEntries) {
      if (en.answer === shown.answerKey) continue;
      const st = core.stateForDir(en.c, 0);
      if (st && core.viewSignature(st, shown.view) === target) others.add(en.answer);
    }
    return [...others];
  }, [quizEntries]);

  const revealRecog = useCallback(() => {
    if (!current || current.kind !== "recog" || phase === "stopped" || current.view) return;
    const ms = performance.now() - shownAt.current;
    setLast({ kind: "recog", ms, c: current.c, d: current.d, subset: current.subset, state: current.state, view: null });
    setSession((s) => [...s.slice(-49), { kind: "recog", ms }]);
    setPhase("stopped");
  }, [current, phase]);

  // centers quiz: answer with a center-case name (or null = "don't know")
  const answerCenters = useCallback((picked) => {
    if (!current || !current.view || phase === "stopped") return;
    const ms = performance.now() - shownAt.current;
    const dk = picked === null;
    const hit = !dk && picked === current.answerKey;
    setLast({
      kind: "recog", quiz: true, ms, c: current.c, d: current.d, subset: current.subset,
      state: current.state, view: current.view, answerKey: current.answerKey, picked, dk, hit,
      others: quizAmbiguity(current),
    });
    setCentersStats((cs) => {
      const prev = cs[current.answerKey] || { n: 0, hit: 0, dk: 0, sum: 0 };
      return { ...cs, [current.answerKey]: { n: prev.n + 1, hit: prev.hit + (hit ? 1 : 0), dk: prev.dk + (dk ? 1 : 0), sum: prev.sum + ms } };
    });
    setSession((s) => [...s.slice(-49), { kind: "recog", ms, hit: dk ? undefined : hit, dk }]);
    setPhase("stopped");
  }, [current, phase, quizAmbiguity]);

  // full view only: self-grade the revealed case (1 = recognized, 2 = missed)
  const gradeRecog = useCallback((hit) => {
    if (phase !== "stopped" || !last || last.kind !== "recog" || last.view) return;
    const { c, ms, subset } = last;
    setRecogStats((rs) => {
      const prev = rs[c.uid] || { n: 0, hit: 0, sum: 0 };
      return { ...rs, [c.uid]: { subset, name: c.name, n: prev.n + 1, hit: prev.hit + (hit ? 1 : 0), sum: prev.sum + ms } };
    });
    setSession((s) => { // stamp the verdict onto the reveal's pill
      const n = s.slice();
      for (let i = n.length - 1; i >= 0; i--) if (n[i].kind === "recog") { n[i] = { ...n[i], hit }; break; }
      return n;
    });
    nextRecog();
  }, [phase, last, nextRecog]);

  // ---------- one-look ----------
  // The saved layer solutions, parsed once (index-aligned with onelookSols;
  // null = a stored entry that no longer passes the guards — shown so it can
  // be removed). phi = the solution's PHYSICAL facelet perm — every problem X
  // is chosen so the cube actually IN HAND after the scramble text, run
  // through the solution, shows the drawn D-solved Y layer-down
  // (core.preimageOfLayer; the physical story lives in skewb-core). Each
  // scramble draws one ENABLED solution at random.
  const solPlans = useMemo(() => onelookSols.map((s) => {
    const p = E.parseAlg(E.preprocessAlg(s.raw), s.nota === "ns" ? "ns" : undefined);
    if (!p || !p.some((t) => t.kind === "move")) return null;
    const pp = core.physPermOf(p);
    if (!pp.phi) return null;
    return { raw: s.raw, nota: s.nota, phi: pp.phi, moves: E.countMoves(p) };
  }), [onelookSols]);
  const activePlans = useMemo(
    () => solPlans.filter((pl, i) => pl && onelookSols[i].on),
    [solPlans, onelookSols]);

  const addSolution = () => {
    const raw = solDraft.replace(/\s+/g, " ").trim();
    if (!raw) { setSolError("enter a layer solution first"); return; }
    if (raw.length > 120) { setSolError("that’s too long for a layer solution"); return; }
    if (onelookSols.length >= 24 && !onelookSols.some((s) => s.raw === raw && s.nota === nota)) {
      setSolError("24 saved solutions is the cap — remove one first"); return;
    }
    const p = E.parseAlg(E.preprocessAlg(raw), nota === "ns" ? "ns" : undefined);
    if (!p) { setSolError("doesn’t parse as " + nota.toUpperCase() + " — check the notation switch"); return; }
    if (!p.some((t) => t.kind === "move")) { setSolError("needs at least one move"); return; }
    const pp = core.physPermOf(p);
    if (pp.err === "rot") { setSolError("whole-cube rotations aren’t supported here — moves only"); return; }
    if (pp.err === "ufl") { setSolError("F, R, L and f move the fixed white/red/green corner — write the layer with r, b, B, l (right-side letters)"); return; }
    setSolError("");
    setSolDraft("");
    setSolsOpen(true); // show the list so the new solution visibly lands
    setOnelookSols((list) => { // re-adding a saved solution just re-enables it
      const i = list.findIndex((s) => s.raw === raw && s.nota === nota);
      if (i >= 0) return list.map((s, j) => (j === i ? { ...s, on: true } : s));
      return [...list, { raw, nota, on: true }];
    });
  };
  const toggleSol = (i) =>
    setOnelookSols((l) => l.map((s, j) => (j === i ? { ...s, on: !s.on } : s)));
  const removeSol = (i) => setOnelookSols((l) => l.filter((_, j) => j !== i));

  // best-effort name for the state left after the user's layer: exact stateKey
  // match over every sheet case's 4 presentation states (built lazily once)
  const caseIndexRef = useRef(null);
  const caseOfState = useCallback((st) => {
    if (!st || !ready) return null;
    if (E.eq(st, E.solved())) return { solved: true };
    if (!caseIndexRef.current) {
      const map = new Map();
      for (const sub of model().subsets) {
        for (const c of sub.cases) {
          const cp = core.casePres(c);
          if (!cp.ok) continue;
          const a0 = DIRS.indexOf(cp.anchorDir);
          cp.pks.forEach((pk, p) => { if (!map.has(pk)) map.set(pk, { c, d: (p + a0) % 4, subset: sub.key }); });
        }
      }
      caseIndexRef.current = map;
    }
    return caseIndexRef.current.get(E.stateKey(st)) || null;
  }, [ready]);

  const nextOnelook = useCallback(() => {
    setPhase("ready"); setLast(null);
    let cur = null;
    for (let tries = 0; tries < 5 && !cur; tries++) { // re-draw if the target lands on solved (empty scramble)
      if (onelookView === "len") {
        const st = fldistRef.current ? core.randomAtFLDist(fldistRef.current, onelookLen) : null;
        if (st) cur = { kind: "onelook", sub: "len", n: onelookLen, state: st };
      } else if (activePlans.length) {
        const plan = activePlans[Math.floor(Math.random() * activePlans.length)];
        const Y = core.randomDLayerState();
        const st = core.preimageOfLayer(plan.phi, Y, distRef.current);
        if (st) cur = { kind: "onelook", sub: "sol", sol: { raw: plan.raw, nota: plan.nota }, state: st, end: Y };
      }
      if (cur) {
        cur.scramble = core.maskedScramble(cur.state, distRef.current);
        if (!cur.scramble) cur = null;
      }
    }
    shownAt.current = performance.now();
    setCurrent(cur);
  }, [onelookView, onelookLen, activePlans]);

  const revealOnelook = useCallback(() => {
    if (!current || current.kind !== "onelook" || phase === "stopped") return;
    const ms = performance.now() - shownAt.current;
    const rec = { kind: "onelook", ms, sub: current.sub, state: current.state };
    if (current.sub === "len") {
      rec.n = current.n;
      const lines = fldistRef.current ? core.descentLines(current.state, fldistRef.current, 128) : [];
      rec.lines = lines.map((l) => ({ alg: core.toWCA(l.moves), face: core.anyLayerSolved(l.end) }));
      rec.capped = lines.length >= 128; // deepest states top out at ~88 lines, but stay honest
    } else {
      rec.sol = current.sol;
      rec.end = current.end;
      rec.match = caseOfState(current.end);
    }
    setLast(rec);
    setSession((s) => [...s.slice(-49), { kind: "onelook", ms }]);
    setPhase("stopped");
  }, [current, phase, caseOfState]);

  // self-grade the one-look attempt (1 = got it, 2 = missed)
  const gradeOnelook = useCallback((hit) => {
    if (phase !== "stopped" || !last || last.kind !== "onelook") return;
    // sol keys carry the notation: the same letters mean different moves in WCA vs NS
    const key = last.sub === "len" ? "len" + SEP + last.n : "sol" + SEP + last.sol.nota + SEP + last.sol.raw;
    const label = last.sub === "len" ? last.n + " move" + (last.n === 1 ? "" : "s") : last.sol.raw;
    setOnelookStats((os) => {
      const prev = os[key] || { n: 0, hit: 0, sum: 0 };
      const rec = { label, n: prev.n + 1, hit: prev.hit + (hit ? 1 : 0), sum: prev.sum + last.ms };
      if (last.sub === "sol") rec.nota = last.sol.nota;
      return { ...os, [key]: rec };
    });
    setSession((s) => { // stamp the verdict onto the reveal's pill
      const n = s.slice();
      for (let i = n.length - 1; i >= 0; i--) if (n[i].kind === "onelook") { n[i] = { ...n[i], hit }; break; }
      return n;
    });
    nextOnelook();
  }, [phase, last, nextOnelook]);

  const advance = useCallback(() => {
    if (mode === "recog") { nextRecog(); return; }
    if (mode === "onelook") { nextOnelook(); return; }
    if (mode === "drill") { nextDrill(); return; }
    setRecap((r) => {
      if (!r) return r;
      const idx = r.idx + 1;
      if (idx >= r.queue.length) { setCurrent(null); return { ...r, idx }; }
      setCurrent(makeDrill(r.queue[idx]));
      return { ...r, idx };
    });
  }, [mode, nextDrill, nextRecog, nextOnelook, makeDrill]);

  // Regenerate on boot/mode switch (stage reset) and on pool edits (groups/
  // dirs/cases/known/scope). A pool edit only swaps the PENDING problem — it
  // must not clear a stop-screen reveal (e.g. marking the just-solved case
  // known), so phase/last are reset only on mode switches or mid-run edits.
  const genMode = useRef(null);
  useEffect(() => {
    if (!ready) return;
    const modeSwitch = genMode.current !== mode;
    genMode.current = mode;
    if (modeSwitch || phase === "running") { setPhase("ready"); setLast(null); }
    if (mode === "onelook") { if (modeSwitch) nextOnelook(); return; } // one-look ignores the pool
    if (mode === "drill") nextDrill();
    else if (mode === "recap") startRecap();
    else if (modeSwitch || phase !== "stopped") nextRecog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, mode, entries]);

  // ---------- timer ----------
  const tick = useCallback(() => {
    setElapsed(performance.now() - t0.current);
    raf.current = requestAnimationFrame(tick);
  }, []);
  const startTimer = useCallback(() => {
    if (!current || !current.scramble) return;
    cancelAnimationFrame(raf.current);
    t0.current = performance.now();
    setElapsed(0);
    setPhase("running");
    raf.current = requestAnimationFrame(tick);
  }, [current, tick]);
  const stopTimer = useCallback(() => {
    cancelAnimationFrame(raf.current);
    const ms = performance.now() - t0.current;
    stoppedAt.current = performance.now();
    setElapsed(ms);
    setPhase("stopped");
    if (current && current.kind === "drill") {
      const rec = { kind: "drill", ms, c: current.c, d: current.d, subset: current.subset, state: current.state };
      setLast(rec);
      setSession((s) => [...s.slice(-49), { kind: "drill", ms, subset: current.subset }]);
      const sk = statKey(current.c.uid, current.d);
      setCaseStats((cs) => {
        const prev = cs[sk] || { n: 0, best: Infinity, sum: 0 };
        return { ...cs, [sk]: { subset: current.subset, name: current.c.name, d: current.d, n: prev.n + 1, best: Math.min(prev.best, ms), sum: prev.sum + ms } };
      });
    }
    advance();
  }, [current, advance]);
  const trigger = useCallback(() => {
    if (!ready) return;
    if (phase === "running") { stopTimer(); return; }
    if (performance.now() - stoppedAt.current < 350) return;
    startTimer();
  }, [ready, phase, startTimer, stopTimer]);

  // ---------- keyboard ----------
  useEffect(() => {
    const down = (e) => {
      if (e.repeat) return;
      const tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (caseBrowser) { if (e.code === "Escape") setCaseBrowser(null); return; }
      if (mode === "recog") {
        const quiz = current && current.view;
        if (e.code === "Space" || e.code === "Enter" || e.code === "NumpadEnter") {
          e.preventDefault();
          if (phase === "stopped") nextRecog();
          else if (!quiz) revealRecog(); // quiz answers by choice, not reveal
        } else if (quiz && phase !== "stopped") {
          const m = e.code.match(/^(?:Digit|Numpad)(\d)$/); // 1..9, 0 = 10th option
          if (m) {
            e.preventDefault();
            const i = m[1] === "0" ? 9 : +m[1] - 1;
            const opts = quizOptions;
            if (i < opts.length) answerCenters(opts[i]);
          }
        } else if (!quiz && phase === "stopped" && (e.code === "Digit1" || e.code === "Numpad1")) {
          e.preventDefault(); gradeRecog(true);
        } else if (!quiz && phase === "stopped" && (e.code === "Digit2" || e.code === "Numpad2")) {
          e.preventDefault(); gradeRecog(false);
        }
        return;
      }
      if (mode === "onelook") {
        if (e.code === "Space" || e.code === "Enter" || e.code === "NumpadEnter") {
          e.preventDefault();
          if (phase === "stopped") nextOnelook();
          else revealOnelook();
        } else if (phase === "stopped" && (e.code === "Digit1" || e.code === "Numpad1")) {
          e.preventDefault(); gradeOnelook(true);
        } else if (phase === "stopped" && (e.code === "Digit2" || e.code === "Numpad2")) {
          e.preventDefault(); gradeOnelook(false);
        }
        return;
      }
      if (phase === "stopped" && e.code === "KeyK" && last && last.kind === "drill") {
        e.preventDefault();
        const k = knownKey(last.c.uid, last.d);
        setCaseKnown((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
        return;
      }
      if (phase === "running") { e.preventDefault(); stopTimer(); return; }
      if (e.code === "Space") { e.preventDefault(); trigger(); }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [phase, trigger, stopTimer, mode, nextRecog, revealRecog, gradeRecog, answerCenters, quizOptions, nextOnelook, revealOnelook, gradeOnelook, current, last, caseBrowser]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  useEffect(() => { if (phase !== "running") cancelAnimationFrame(raf.current); }, [phase]);
  useEffect(() => { if (mode === "drill" || mode === "recap") lastAlgoMode.current = mode; }, [mode]);
  // switching the recognition view or its quiz settings regenerates the problem
  useEffect(() => {
    if (ready && mode === "recog") nextRecog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recogView, centerSel, cornersOn]);
  // ditto for one-look settings; a 'len' request without the table clears the
  // stage so the building notice shows instead of a stale problem
  useEffect(() => {
    if (!ready || mode !== "onelook") return;
    if (onelookView === "len" && !fldistRef.current) { setPhase("ready"); setLast(null); setCurrent(null); return; }
    nextOnelook();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onelookView, onelookLen, activePlans]);
  // the lazy fldist table landing fulfils a waiting 'len' request, exactly once
  // (progress ticks and the 'sol' sub-view must NOT regenerate — build churn)
  useEffect(() => {
    if (ready && mode === "onelook" && onelookView === "len" && flBoot === "ready" && !current) nextOnelook();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flBoot]);

  // ---------- selection toggles ----------
  const toggleSubset = (key) => {
    const m = model();
    const cur = subsetSel === null ? (m.subsets.length ? [m.subsets[0].key] : []) : subsetSel;
    setSubsetSel(cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]);
  };
  const toggleGroup = (sub, value) => {
    const cur = groupsOf(sub);
    setGroupSel((s) => ({ ...s, [sub.key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] }));
  };
  const toggleCase = (uid) =>
    setCaseOff((s) => { const n = new Set(s); if (n.has(uid)) n.delete(uid); else n.add(uid); return n; });
  const toggleKnown = (uid) =>
    setCaseKnown((s) => {
      const n = new Set(s);
      const k = knownKey(uid, 0);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });

  const subColor = (key) => {
    const m = model();
    const i = m ? m.subsets.findIndex((s) => s.key === key) : -1;
    return SUBSET_COLORS[(i + SUBSET_COLORS.length) % SUBSET_COLORS.length];
  };
  const enabledCount = (sub) => {
    const on = new Set(groupsOf(sub));
    let total = 0, off = 0;
    for (const g of sub.groups) if (on.has(g.value)) for (const c of g.cases) { total++; if (caseOff.has(c.uid)) off++; }
    return { on: total - off, total };
  };
  const knownCount = (sub) => sub.cases.filter((c) => caseKnown.has(knownKey(c.uid, 0))).length;

  // ---------- stats aggregation ----------
  const uidIndex = useMemo(() => {
    if (!ready) return new Map();
    const m = new Map();
    for (const sub of model().subsets) for (const c of sub.cases) m.set(c.uid, c);
    return m;
  }, [ready]);
  const variantAgg = useMemo(() => {
    const agg = {};
    for (const [k, st] of Object.entries(caseStats)) {
      const vk = st.subset + "@" + st.d;
      const a = agg[vk] || { subset: st.subset, d: st.d, n: 0, best: Infinity, sum: 0, cases: 0, keys: [] };
      a.n += st.n; a.best = Math.min(a.best, st.best); a.sum += st.sum; a.cases += 1; a.keys.push(k);
      agg[vk] = a;
    }
    return agg;
  }, [caseStats]);
  // the Session card shows only the current trainer's times (entries are
  // tagged by kind; drill and recap both record "drill" — same activity)
  const sessionShown = useMemo(
    () => session.filter((t) => t.kind === (mode === "recap" ? "drill" : mode)),
    [session, mode]);

  const resetStats = () => {
    setCaseStats({});
    setRecogStats({});
    setCentersStats({});
    setOnelookStats({});
    setSession([]);
    setLast(null);
    persist({ caseStats: {}, recogStats: {}, centersStats: {}, onelookStats: {} });
  };

  // ---------- alg list for a shown (case, dir) ----------
  function AlgList({ c, d }) {
    const rows = core.algsForDir(c, d);
    if (!rows.length) return <div className="empty">No algorithms for this view yet.</div>;
    return (
      <div className="alglist">
        {rows.map((row, i) => (
          <div key={i} className={"algrow" + (row.a.suspect ? " suspectrow" : "")}>
            <span className={"ychip mono" + (row.k ? "" : " blank")}>{row.k ? Y_PREFIX[row.k] : ""}</span>
            <span className={"fmkey mono" + (core.firstMoveOf(row) ? "" : " blank")}>{core.firstMoveOf(row) || "—"}</span>
            <AlgText text={rowText(row)} />
            {row.a.rating === "best" ? <span className="ratetag best">best</span> : null}
            {row.a.rating === "poor" ? <span className="ratetag poor">poor</span> : null}
            {row.a.suspect ? <span className="warntag" title="flagged suspect at import (off its case's rotation class)">⚠</span> : null}
          </div>
        ))}
      </div>
    );
  }

  // ---------- case browser modal ----------
  function CaseBrowser({ subKey }) {
    const sub = model().subsets.find((s) => s.key === subKey);
    const [grp, setGrp] = useState(sub.groups[0] ? sub.groups[0].value : "");
    const [filter, setFilter] = useState("");
    if (!sub) return null;
    const g = sub.groups.find((x) => x.value === grp) || sub.groups[0];
    const filterField = sub.nav && sub.nav.filter && sub.nav.filter.field;
    const filterVals = filterField ? [...new Set(g.cases.map((c) => c[filterField]).filter((v) => v != null))] : [];
    let list = core.navSorted(sub, g.cases);
    if (filter && filterField) list = list.filter((c) => c[filterField] === filter);
    return (
      <div className="overlay" onPointerDown={(e) => { if (e.target === e.currentTarget) setCaseBrowser(null); }}>
        <div className="modal">
          <div className="modalhead">
            <div>
              <div className="modaltitle">{sub.name} cases</div>
              <span className="tag" style={{ "--cdot": subColor(sub.key) }}>
                <span className="dot" />{enabledCount(sub).on}/{enabledCount(sub).total} on · {knownCount(sub)} known
              </span>
            </div>
            <button className="closebtn" onClick={() => setCaseBrowser(null)}>{"×"}</button>
          </div>
          <div className="chips" style={{ marginBottom: 8 }}>
            {sub.groups.map((x) => (
              <button key={x.value} className={"mode" + (x.value === g.value ? " on" : "")}
                onClick={() => { setGrp(x.value); setFilter(""); }}>{x.label}</button>
            ))}
            {filterVals.length > 1 && (
              <select className="filtersel" value={filter} onChange={(e) => setFilter(e.target.value)}
                aria-label={sub.nav.filter.label}>
                <option value="">{sub.nav.filter.label}: all</option>
                {filterVals.map((v) => <option key={v} value={v}>{String(v)}</option>)}
              </select>
            )}
          </div>
          <div className="presets" style={{ margin: "0 0 10px" }}>
            <button className="preset" onClick={() => setCaseOff((s) => { const n = new Set(s); for (const c of list) n.delete(c.uid); return n; })}>enable shown</button>
            <button className="preset" onClick={() => setCaseOff((s) => { const n = new Set(s); for (const c of list) n.add(c.uid); return n; })}>disable shown</button>
            <button className="preset" onClick={() => setCaseKnown((s) => { const n = new Set(s); for (const c of list) n.add(knownKey(c.uid, 0)); return n; })}>mark shown known</button>
            <button className="preset" onClick={() => setCaseKnown((s) => { const n = new Set(s); for (const c of list) n.delete(knownKey(c.uid, 0)); return n; })}>mark shown unknown</button>
          </div>
          <div className="chips">
            {list.map((c) => {
              const kn = caseKnown.has(knownKey(c.uid, 0));
              return (
                <span key={c.uid} className="markwrap">
                  <button className={"chip" + (caseOff.has(c.uid) ? "" : " on")}
                    style={{ "--cdot": subColor(sub.key) }} onClick={() => toggleCase(c.uid)}>
                    <span className="dot" />{c.name}{kn ? " ✓" : ""}
                  </button>
                  <button className={"markbtn ok" + (kn ? " sel" : "")} title="mark known"
                    onClick={() => toggleKnown(c.uid)}>K</button>
                </span>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ---------- render ----------
  const recapDone = mode === "recap" && recap && recap.idx >= recap.queue.length;
  const m = model();

  return (
    <div className="app">
      <div className="frame">
        <header>
          <div className="brandrow">
            <div className="brand">Skewb <span>Trainer</span></div>
          </div>
          <div className="spacer" />
          <div className="notaswitch" role="group" aria-label="notation">
            {[["wca", "WCA"], ["ns", "NS"]].map(([v, l]) => (
              <button key={v} className={"notabtn" + (nota === v ? " on" : "")} onClick={() => setNota(v)}>{l}</button>
            ))}
          </div>
          <button className="gear" onClick={() => setSettingsOpen((o) => !o)}>Settings</button>
        </header>

        {settingsOpen && (
          <div className="settings">
            <span>Stats persist between sessions{window.OOAccount && window.OOAccount.user ? " (synced to your account)" : ""}.</span>
            <button className="danger" onClick={resetStats}>Reset all stats</button>
          </div>
        )}

        <div className="modes modetabs">
          <button className={"mode" + (mode === "drill" || mode === "recap" ? " on" : "")}
            onClick={() => { if (mode !== "drill" && mode !== "recap") setMode(lastAlgoMode.current); }}>Algorithm</button>
          <button className={"mode" + (mode === "recog" ? " on" : "")} onClick={() => setMode("recog")}>Recognition</button>
          <button className={"mode" + (mode === "onelook" ? " on" : "")} onClick={() => setMode("onelook")}>One-look</button>
        </div>

        {/* ---------- one-look settings (pool-independent) ---------- */}
        {mode === "onelook" && (
          <>
            <div className="chips" style={{ alignItems: "center" }}>
              <span className="grouplabel">layer</span>
              <div className="modes">
                {[["len", "Random"], ["sol", "My solutions"]].map(([v, l]) => (
                  <button key={v} className={"mode" + (onelookView === v ? " on" : "")} onClick={() => setOnelookView(v)}>{l}</button>
                ))}
              </div>
              {onelookView === "len" ? (
                <>
                  <span className="grouplabel">moves to a layer</span>
                  <div className="modes">
                    {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                      <button key={n} className={"mode" + (onelookLen === n ? " on" : "")} onClick={() => setOnelookLen(n)}>{n}</button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <input className="solinput mono" value={solDraft}
                    placeholder={"layer solution, e.g. " + SOL_EXAMPLES[nota === "ns" ? "ns" : "wca"]}
                    onChange={(e) => { setSolDraft(e.target.value); setSolError(""); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSolution(); e.target.blur(); } }}
                    aria-label="layer solution" />
                  <button className="preset" onClick={addSolution}>add</button>
                  {solError ? <span className="solerr">{solError}</span>
                    : onelookSols.length ? <span className="grouplabel">each scramble draws one</span>
                    : null}
                </>
              )}
            </div>
            {onelookView === "sol" && onelookSols.length > 0 && (
              <details className="setgrp" open={solsOpen}
                onToggle={(e) => setSolsOpen(e.currentTarget.open)}>
                <summary>
                  <span className="grouplabel">solutions</span>
                  <span className="ct">{activePlans.length}/{onelookSols.length} enabled</span>
                </summary>
                <div className="chips" style={{ alignItems: "center", marginTop: 8 }}>
                  {onelookSols.map((s, i) => (
                    <span key={s.nota + SEP + s.raw} className="markwrap">
                      <button className={"chip" + (s.on && solPlans[i] ? " on" : "")}
                        style={{ "--cdot": "var(--accent)" }}
                        title={!solPlans[i] ? "doesn’t parse anymore — remove it" : s.on ? "click to disable" : "click to enable"}
                        onClick={() => toggleSol(i)}>
                        <span className="dot" /><AlgText text={s.raw} />
                        <span className="ct">{solPlans[i] ? solPlans[i].moves + "m" : "?"} · {s.nota.toUpperCase()}</span>
                      </button>
                      <button className="markbtn" title="remove this solution" onClick={() => removeSol(i)}>×</button>
                    </span>
                  ))}
                </div>
              </details>
            )}
          </>
        )}

        {/* ---------- setup (Algorithm + Recognition share the pool) ---------- */}
        {(mode === "drill" || mode === "recap" || mode === "recog") && (
          <>
            {mode === "recog" && (
              <div className="chips" style={{ alignItems: "center" }}>
                <span className="grouplabel">view</span>
                <div className="modes">
                  {[["full", "Full"], ["centers", "Center cases"]].map(([v, l]) => (
                    <button key={v} className={"mode" + (recogView === v ? " on" : "")} onClick={() => setRecogView(v)}>{l}</button>
                  ))}
                </div>
                {recogView === "centers" && (
                  <>
                    <span className="grouplabel">centers</span>
                    <div className="modes">
                      {["L", "F", "R", "B", "U"].map((f) => (
                        <button key={f} className={"mode" + (centerSel.includes(f) ? " on" : "")}
                          onClick={() => setCenterSel((cs) => {
                            if (cs.includes(f)) return cs.filter((x) => x !== f);
                            if (cs.length < 3) return [...cs, f];
                            return [...cs.slice(1), f]; // swap out the oldest pick
                          })}>{f}</button>
                      ))}
                    </div>
                    <button className={"chip" + (cornersOn ? " on" : "")} style={{ "--cdot": "var(--accent)" }}
                      onClick={() => setCornersOn((v) => !v)} title="also show 2 random U-layer corners">
                      <span className="dot" />+2 corners
                    </button>
                  </>
                )}
              </div>
            )}
            <div className="chips" style={{ alignItems: "center" }}>
              {(mode === "drill" || mode === "recap") && (
                <div className="modes">
                  {[["drill", "Drill"], ["recap", "Recap"]].map(([v, l]) => (
                    <button key={v} className={"mode" + (mode === v ? " on" : "")} onClick={() => setMode(v)}>{l}</button>
                  ))}
                </div>
              )}
              <span className="grouplabel">practice</span>
              <div className="modes">
                {[["all", "All"], ["learning", "Learning"], ["known", "Known"]].map(([v, l]) => (
                  <button key={v} className={"mode" + (scope === v ? " on" : "")} onClick={() => setScope(v)}>{l}</button>
                ))}
              </div>
            </div>

            <div className="card setupcard">
              <button className="setuphead" onClick={() => setSetupOpen((o) => !o)}>
                <strong>Setup</strong>
                <span className="setupsum">
                  {ready ? `${entries.length} case${entries.length === 1 ? "" : "s"} in the pool` : "loading…"}
                </span>
                <span className="chev">{setupOpen ? "▾" : "▸"}</span>
              </button>
              {setupOpen && ready && (
                <div className="setupbody">
                  {m.subsets.map((sub) => (
                    <details key={sub.key} className="setgrp" open={subsetOn(sub.key)}>
                      <summary>
                        <button className={"chip" + (subsetOn(sub.key) ? " on" : "")}
                          style={{ "--cdot": subColor(sub.key) }}
                          onClick={(e) => { e.preventDefault(); toggleSubset(sub.key); }}>
                          <span className="dot" />{sub.name}
                          <span className="ct">{sub.cases.length}</span>
                        </button>
                        <span className="ct">{enabledCount(sub).on} on · {knownCount(sub)} known</span>
                      </summary>
                      <div className="chips" style={{ marginTop: 8 }}>
                        <span className="grouplabel">groups</span>
                        {sub.groups.map((g) => (
                          <button key={g.value} className={"chip" + (groupsOf(sub).includes(g.value) ? " on" : "")}
                            style={{ "--cdot": subColor(sub.key) }} onClick={() => toggleGroup(sub, g.value)}>
                            <span className="dot" />{g.label}<span className="ct">{g.cases.length}</span>
                          </button>
                        ))}
                      </div>
                      <div className="chips">
                        <button className="preset" onClick={() => setCaseBrowser(sub.key)}>cases…</button>
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {mode === "recap" && recap && recap.queue.length > 0 && (
          <div className="recapbar">
            <span className="mono">{Math.min(recap.idx, recap.queue.length)}/{recap.queue.length}</span>
            <div className="rtrack"><div className="rfill" style={{ width: `${(Math.min(recap.idx, recap.queue.length) / recap.queue.length) * 100}%` }} /></div>
            <button className="preset" onClick={startRecap}>restart</button>
          </div>
        )}

        {/* ---------- stage ---------- */}
        {!ready ? (
          <div className="stage" style={{ cursor: "default" }}>
            <div className="loading">
              {boot.stage === "error" ? "Couldn’t start the trainer: " + boot.msg
                : boot.stage === "bfs" ? `Building scramble tables… ${boot.pct}% (first visit only)`
                : "Loading…"}
            </div>
          </div>
        ) : recapDone ? (
          <div className="stage" style={{ cursor: "default", textAlign: "center" }}>
            <div className="scramble" style={{ textAlign: "center" }}>Recap complete</div>
            <div className="hint" style={{ marginTop: 10 }}>{recap.queue.length} cases covered</div>
            <button className="restart" onClick={startRecap}>Run it again</button>
          </div>
        ) : mode === "onelook" && !current ? (
          <div className="stage" style={{ cursor: "default" }}>
            <div className="empty" style={{ padding: "40px 0", textAlign: "center" }}>
              {onelookView === "len"
                ? (flBoot === "error" ? "Couldn’t build the first-layer table — reload to retry."
                  : !fldistRef.current ? "Building the first-layer table… " + (flBoot && flBoot.pct !== undefined ? flBoot.pct + "% " : "") + "(first visit only)"
                  : "Couldn’t generate a scramble — try another length.")
                : (activePlans.length ? "Couldn’t generate a scramble — try again."
                  : onelookSols.length ? "Enable at least one saved layer solution above."
                  : "Add a layer solution above — save as many as you use. Every scramble is built for one of your enabled solutions: inspect, predict the case it leaves, then execute and grade yourself.")}
            </div>
          </div>
        ) : !current ? (
          <div className="stage" style={{ cursor: "default" }}>
            <div className="empty" style={{ padding: "40px 0", textAlign: "center" }}>
              {entries.length === 0
                ? (scope === "learning" ? "Nothing left to learn in this selection — every enabled case is marked known."
                  : scope === "known" ? "No cases marked known yet in this selection."
                  : "Pick at least one subset and group in Setup to start.")
                : mode === "recog" && recogView === "centers" && centerSel.length !== 3
                ? "Pick 3 centers above to start the quiz."
                : mode === "recog" && recogView === "centers" && quizEntries.length === 0
                ? "The selected cases have no center-case classification — pick EG2, NS or TCLL cases for this quiz."
                : "Couldn’t generate a scramble — try other cases."}
            </div>
          </div>
        ) : current.kind === "recog" ? (
          <div className="stage" style={{ cursor: "default" }}>
            <div className="stagegrid recogstage">
              <CaseNet state={phase === "stopped" && last ? last.state : current.state} w={300}
                mask={phase === "stopped" ? null : current.mask} />
            </div>
            {current.view && phase !== "stopped" && (
              <div className="hint" style={{ marginTop: 6 }}>
                first layer + {current.view.centers.join(" ")} centers{current.view.corners.length ? " + " + current.view.corners.join(" ") + " corners" : ""}
              </div>
            )}
            {phase === "stopped" && last && last.quiz ? (
              <>
                <div className={"quizverdict" + (last.hit ? " good" : last.dk ? "" : " bad")}>
                  {last.hit ? "Correct — " + last.answerKey
                    : last.dk ? "It was " + last.answerKey
                    : "Not quite — " + last.answerKey + " (you picked " + last.picked + ")"}
                </div>
                <div className="reveal">
                  <span className="tag" style={{ "--cdot": subColor(last.subset) }}>
                    <span className="dot" />{last.subset}
                  </span>
                  <span className="casename">{last.c.name}</span>
                  {last.d ? <span className="bartag">{DIRS[last.d]} view</span> : null}
                  <span className="mono">{fmt(last.ms)}s</span>
                  <button className="restart" style={{ marginTop: 0 }} onClick={nextRecog}>Next (space)</button>
                </div>
                {last.others && last.others.length > 0 && (
                  <div className="hint" style={{ marginTop: 6 }}>
                    ⚠ with these centers this view is also consistent with: {last.others.join(", ")}
                  </div>
                )}
                <AlgList c={last.c} d={last.d} />
              </>
            ) : phase === "stopped" && last ? (
              <>
                <div className="reveal">
                  <span className="tag" style={{ "--cdot": subColor(last.subset) }}>
                    <span className="dot" />{last.subset}
                  </span>
                  <span className="casename">{last.c.name}</span>
                  {last.d ? <span className="bartag">{DIRS[last.d]} view</span> : null}
                  <span className="mono">{fmt(last.ms)}s</span>
                </div>
                <div className="graderow">
                  <button className="gradebtn hit" onClick={() => gradeRecog(true)}>Recognized ✓ (1)</button>
                  <button className="gradebtn miss" onClick={() => gradeRecog(false)}>Missed ✗ (2)</button>
                  <button className="preset" onClick={nextRecog}>skip (space)</button>
                </div>
                <AlgList c={last.c} d={last.d} />
              </>
            ) : current.view ? (
              <>
                <div className="hint" style={{ marginTop: 14 }}>Which center case?</div>
                <div className="quizrow">
                  {quizOptions.map((opt, i) => (
                    <button key={opt} className="quizbtn" onClick={() => answerCenters(opt)}>
                      {i < 10 ? <span className="quizkey mono">{(i + 1) % 10}</span> : null}{opt}
                    </button>
                  ))}
                  <button className="quizbtn dk" onClick={() => answerCenters(null)}>Don’t know</button>
                </div>
              </>
            ) : (
              <>
                <div className="hint" style={{ marginTop: 14 }}>Which case is this?</div>
                <button className="restart" style={{ marginTop: 8 }} onClick={revealRecog}>Reveal (space)</button>
              </>
            )}
          </div>
        ) : current.kind === "onelook" ? (
          <div className="stage" style={{ cursor: "default" }}>
            <div className="stagegrid">
              <div>
                <div className="scramble">{dispAlg(current.scramble)}</div>
                {current.sub === "sol" && (
                  <div className="hint" style={{ textAlign: "left", marginTop: 8 }}>
                    your layer: <AlgText text={current.sol.raw} />
                  </div>
                )}
              </div>
              <Net state={current.state} w={240} />
            </div>
            {phase !== "stopped" ? (
              <>
                <div className="hint" style={{ marginTop: 14 }}>
                  {current.sub === "len"
                    ? (current.n === 0 ? "a layer is already done — one-look the case, then reveal"
                      : "one-look it: find the " + current.n + "-move layer and predict the case, then reveal")
                    : "predict the case your solution leaves, then reveal to check"}
                </div>
                <button className="restart" style={{ marginTop: 8 }} onClick={revealOnelook}>Reveal (space)</button>
              </>
            ) : last && last.kind === "onelook" ? (
              <>
                {last.sub === "len" ? (
                  <div className="analysis">
                    <div className="solhead">
                      {last.n === 0 ? "a layer is already solved" : "optimal layer" + ((last.lines || []).length === 1 ? "" : "s") + " in " + last.n}
                      <span className="mono" style={{ marginLeft: 10 }}>· {fmt(last.ms)}s look</span>
                    </div>
                    <div className="sollist">
                      {(last.lines || []).slice(0, 8).map((l, i) => (
                        <span key={i} className="mono solpill fl">{l.alg ? dispAlg(l.alg) : "done"}{l.face ? " → " + l.face : ""}</span>
                      ))}
                      {(last.lines || []).length > 8 ? <span className="hint">+{last.lines.length - 8}{last.capped ? "+" : ""} more</span> : null}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="hint" style={{ marginTop: 14 }}>after your layer:</div>
                    <div className="stagegrid recogstage">
                      {/* end states have fx[UFL] = 0 (core.randomDLayerState), so the
                          pinned frame IS the cube in hand, solved layer on the bottom */}
                      <Net state={last.end} w={240} pinned />
                    </div>
                    <div className="reveal">
                      {last.match && last.match.solved ? (
                        <span className="casename">solved — nothing left</span>
                      ) : last.match ? (
                        <>
                          <span className="tag" style={{ "--cdot": subColor(last.match.subset) }}>
                            <span className="dot" />{last.match.subset}
                          </span>
                          <span className="casename">{last.match.c.name}</span>
                          {last.match.d ? <span className="bartag">{DIRS[last.match.d]} view</span> : null}
                        </>
                      ) : (
                        <span className="casename">not in your sheets</span>
                      )}
                      <span className="mono">{fmt(last.ms)}s look</span>
                    </div>
                  </>
                )}
                <div className="graderow">
                  <button className="gradebtn hit" onClick={() => gradeOnelook(true)}>Got it ✓ (1)</button>
                  <button className="gradebtn miss" onClick={() => gradeOnelook(false)}>Missed ✗ (2)</button>
                  <button className="preset" onClick={nextOnelook}>skip (space)</button>
                </div>
              </>
            ) : null}
          </div>
        ) : (
          <div className="stage" onPointerDown={(e) => { e.preventDefault(); trigger(); }}>
            <div className="stagegrid">
              <div className="scramble">{dispAlg(current.scramble)}</div>
              {/* the case diagram renders layer-down (pinned frame) */}
              <Net state={current.state} w={240} pinned />
            </div>
            <div className={"timer" + (phase === "running" ? " running" : "")}>{fmt(elapsed)}</div>
            {phase === "stopped" && last && last.kind === "drill" ? (
              <div className="reveal" onPointerDown={(e) => e.stopPropagation()}>
                <span className="tag" style={{ "--cdot": subColor(last.subset) }}>
                  <span className="dot" />{last.subset}
                </span>
                <span className="casename">{last.c.name}</span>
                {(() => {
                  const k = knownKey(last.c.uid, last.d);
                  const isK = caseKnown.has(k);
                  return (
                    <button className={"markbtn ok" + (isK ? " sel" : "")} title="mark known (K)"
                      onClick={() => setCaseKnown((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })}>
                      {isK ? "Known ✓" : "Mark known"}
                    </button>
                  );
                })()}
              </div>
            ) : (
              <div className="hint">{phase === "running" ? "tap or any key to stop" : "tap or space to start"}</div>
            )}
            {phase === "stopped" && last && last.kind === "drill" ? (
              <div className="analysis" onPointerDown={(e) => e.stopPropagation()}>
                <AlgList c={last.c} d={last.d} />
              </div>
            ) : null}
          </div>
        )}

        {/* ---------- stats + session ---------- */}
        <div className="panelrow">
          <div className="card">
            {mode === "recog" && recogView === "centers" ? (
              <>
                <h3>Center cases · {centerSel.length === 3 ? centerSel.slice().sort().join(" ") : "pick 3 centers"}{cornersOn ? " + 2 corners" : ""}</h3>
                {(() => {
                  const rows = quizOptions.map((a) => [a, centersStats[a]]).filter(([, s]) => s);
                  if (!rows.length) return <div className="empty">Answer which center case the visible centers imply (or Don’t know) — accuracy lands here per center case.</div>;
                  return (
                    <table>
                      <thead><tr><th>Center case</th><th>Seen</th><th>Correct</th><th>Don’t know</th><th>Accuracy</th></tr></thead>
                      <tbody>
                        {rows.map(([a, s]) => (
                          <tr key={a}>
                            <td className="name">{a}</td>
                            <td className="mono">{s.n}</td>
                            <td className="mono">{s.hit}</td>
                            <td className="mono">{s.dk || 0}</td>
                            <td className="mono">{Math.round((s.hit / s.n) * 100)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                })()}
              </>
            ) : mode === "onelook" ? (
              <>
                <h3>One-look</h3>
                {(() => {
                  const rows = Object.entries(onelookStats);
                  if (!rows.length) return <div className="empty">Reveal, then grade yourself (1 got it · 2 missed) — accuracy lands here per layer setting.</div>;
                  const rank = (k) => {
                    const i = k.indexOf(SEP);
                    const sub = k.slice(0, i), rest = k.slice(i + 1);
                    return sub === "len" ? [0, +rest, ""] : [1, 0, rest];
                  };
                  rows.sort(([a], [b]) => {
                    const ra = rank(a), rb = rank(b);
                    return (ra[0] - rb[0]) || (ra[1] - rb[1]) || (ra[2] < rb[2] ? -1 : ra[2] > rb[2] ? 1 : 0);
                  });
                  return (
                    <table>
                      <thead><tr><th>Layer</th><th>Tries</th><th>Got it</th><th>Accuracy</th><th>Mean look</th></tr></thead>
                      <tbody>
                        {rows.map(([k, s]) => (
                          <tr key={k}>
                            <td className="name">{k.startsWith("sol" + SEP)
                              ? <><AlgText text={s.label} />{s.nota ? <span className="casesub" style={{ marginLeft: 6 }}>{s.nota.toUpperCase()}</span> : null}</>
                              : s.label}</td>
                            <td className="mono">{s.n}</td>
                            <td className="mono">{s.hit}</td>
                            <td className="mono">{Math.round((s.hit / s.n) * 100)}%</td>
                            <td className="mono">{fmt(s.sum / s.n)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                })()}
              </>
            ) : mode === "recog" ? (
              <>
                <h3>Recognition</h3>
                {(() => {
                  const rows = Object.entries(recogStats);
                  if (!rows.length) return <div className="empty">Reveal, then grade yourself (1 recognized · 2 missed) — accuracy lands here per case.</div>;
                  const tot = rows.reduce((a, [, s]) => ({ n: a.n + s.n, hit: a.hit + s.hit, sum: a.sum + s.sum }), { n: 0, hit: 0, sum: 0 });
                  const missed = rows.filter(([, s]) => s.hit < s.n)
                    .sort((a, b) => (b[1].n - b[1].hit) - (a[1].n - a[1].hit));
                  return (
                    <>
                      <table>
                        <thead><tr><th>Graded</th><th>Recognized</th><th>Accuracy</th><th>Mean reveal</th></tr></thead>
                        <tbody>
                          <tr>
                            <td className="mono">{tot.n}</td>
                            <td className="mono">{tot.hit}</td>
                            <td className="mono">{Math.round((tot.hit / tot.n) * 100)}%</td>
                            <td className="mono">{fmt(tot.sum / tot.n)}</td>
                          </tr>
                        </tbody>
                      </table>
                      {missed.length > 0 && (
                        <div className="casegrid">
                          {missed.slice(0, 24).map(([uid, s]) => {
                            const c = uidIndex.get(uid);
                            return (
                              <div key={uid} className="casecard">
                                {c ? <CaseNet state={core.stateForDir(c, 0)} w={120} /> : null}
                                <div className="casenums">
                                  <span className="mono" style={{ color: "var(--red)" }}>{s.n - s.hit}✗</span>
                                  <span className="casesub">{s.name}</span>
                                  <span className="casesub">{s.hit}/{s.n} · {fmt(s.sum / s.n)}s</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  );
                })()}
              </>
            ) : (
              <>
                <h3>Drill stats</h3>
                {Object.keys(variantAgg).length === 0 ? (
                  <div className="empty">No solves yet. Times land here, grouped by subset.</div>
                ) : (
                  <table>
                    <thead><tr><th>Subset</th><th>Solves</th><th>Cases seen</th><th>Best</th><th>Mean</th></tr></thead>
                    <tbody>
                      {Object.keys(variantAgg).sort().map((vk) => {
                        const a = variantAgg[vk];
                        return (
                          <tr key={vk} className="setrow" onClick={() => setExpandedVariant(expandedVariant === vk ? null : vk)}>
                            <td className="name">
                              <span className="dot" style={{ background: subColor(a.subset) }} />
                              {a.subset}{a.d ? " · " + DIRS[a.d] : ""}
                              <span className="chev">{expandedVariant === vk ? "▾" : "▸"}</span>
                            </td>
                            <td className="mono">{a.n}</td>
                            <td className="mono">{a.cases}</td>
                            <td className="mono">{fmt(a.best)}</td>
                            <td className="mono">{fmt(a.sum / a.n)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                {expandedVariant && variantAgg[expandedVariant] && (
                  <div className="casegrid">
                    {variantAgg[expandedVariant].keys
                      .map((k) => [k, caseStats[k]])
                      .sort((a, b) => b[1].sum / b[1].n - a[1].sum / a[1].n)
                      .map(([k, st]) => {
                        const uid = k.slice(0, k.lastIndexOf(SEP));
                        const c = uidIndex.get(uid);
                        return (
                          <div key={k} className="casecard">
                            {c ? <Net state={core.stateForDir(c, st.d)} w={120} pinned /> : null}
                            <div className="casenums">
                              <span className="mono">{fmt(st.sum / st.n)}</span>
                              <span className="casesub">{st.name}</span>
                              <span className="casesub">best {fmt(st.best)} · {st.n}×</span>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="card">
            <h3>Session</h3>
            {sessionShown.length === 0 ? (
              <div className="empty">Recent times show up here.</div>
            ) : (
              <div className="times">
                {sessionShown.slice(-24).map((t, i) => (
                  <span key={i} className="timepill"
                    style={{ "--cdot": t.kind === "drill" ? subColor(t.subset)
                      : t.dk ? "var(--dim)" : t.hit === true ? "var(--green)" : t.hit === false ? "var(--red)" : "var(--accent)" }}>
                    {t.dk ? "? " : t.hit === true ? "✓ " : t.hit === false ? "✗ " : ""}{fmt(t.ms)}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {caseBrowser && <CaseBrowser subKey={caseBrowser} />}
      </div>
    </div>
  );
}
