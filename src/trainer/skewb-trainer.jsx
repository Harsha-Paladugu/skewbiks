import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createCore, DIRS, Y_PREFIX, SEP, rateRank } from "./skewb-core.mjs";

// ============================================================
// Skewbiks trainer — three tools over the imported method sheets
//   Algorithm (drill / recap): masked scrambles onto sheet cases
//   Full solve: timer + optimal-line / first-layer analysis
//   Recognition: name the case from the diagram, self-graded
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
// polygon stroke CSS — an overridden class would drop it)
function Net({ state, w }) {
  const html = R && state ? R.netSVG(state, w || 240, { thumb: true }) : "";
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
  const [dirSel, setDirSel] = useState({});           // subset -> enabled dir indices (missing = [0] Front)
  const [caseOff, setCaseOff] = useState(() => new Set());   // DISABLED case uids
  const [caseKnown, setCaseKnown] = useState(() => new Set()); // KNOWN uid␟dir
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
  const dirsOf = useCallback((key) => dirSel[key] === undefined ? [0] : dirSel[key], [dirSel]);

  // ---------- run state ----------
  const [current, setCurrent] = useState(null);
  const [phase, setPhase] = useState("ready");
  const [elapsed, setElapsed] = useState(0);
  const [last, setLast] = useState(null);
  const [caseStats, setCaseStats] = useState({});
  const [recogStats, setRecogStats] = useState({}); // uid -> {n, hit, sum(ms), subset, name}
  const [solveStats, setSolveStats] = useState({ n: 0, best: Infinity, sum: 0 });
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
            if (d.dirSel && typeof d.dirSel === "object") {
              const v = {};
              for (const [k, arr] of Object.entries(d.dirSel)) if (Array.isArray(arr)) v[k] = arr.filter((x) => x >= 0 && x <= 3);
              setDirSel(v);
            }
            if (Array.isArray(d.caseOff)) setCaseOff(new Set(d.caseOff.filter((x) => typeof x === "string")));
            if (Array.isArray(d.caseKnown)) setCaseKnown(new Set(d.caseKnown.filter((x) => typeof x === "string")));
            if (["all", "learning", "known"].includes(d.scope)) setScope(d.scope);
            if (["drill", "recap", "solve", "recog"].includes(d.mode)) setMode(d.mode);
            if (typeof d.setupOpen === "boolean") setSetupOpen(d.setupOpen);
            if (d.caseStats && typeof d.caseStats === "object") {
              const cs = {};
              for (const [k, st] of Object.entries(d.caseStats)) {
                if (st && typeof st.n === "number" && typeof st.sum === "number") cs[k] = st;
              }
              setCaseStats(cs);
            }
            if (d.solveStats && typeof d.solveStats.n === "number") {
              setSolveStats({ n: d.solveStats.n, best: d.solveStats.best ?? Infinity, sum: d.solveStats.sum || 0 });
            }
            if (d.recogStats && typeof d.recogStats === "object") {
              const rs = {};
              for (const [k, st] of Object.entries(d.recogStats)) {
                if (st && typeof st.n === "number" && typeof st.hit === "number") rs[k] = st;
              }
              setRecogStats(rs);
            }
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

  // ---------- first-layer table (lazy: built/loaded when Full solve is opened) ----------
  useEffect(() => {
    if (mode !== "solve" || !ready || fldistRef.current || flBuilding.current) return;
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
        subsetSel, groupSel, dirSel, caseOff: [...caseOff], caseKnown: [...caseKnown],
        scope, mode, setupOpen, caseStats, solveStats, recogStats, ...over,
      })).catch(() => {});
    } catch (e) {}
  }, [subsetSel, groupSel, dirSel, caseOff, caseKnown, scope, mode, setupOpen, caseStats, solveStats, recogStats]);
  useEffect(() => {
    if (!loadedStore.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persist, 400);
  }, [persist]);

  // ---------- the practice pool: enabled (case × direction) entries ----------
  const entries = useMemo(() => {
    if (!ready) return [];
    const out = [];
    for (const sub of model().subsets) {
      if (!subsetOn(sub.key)) continue;
      const dirs = dirsOf(sub.key);
      if (!dirs.length) continue;
      const on = new Set(groupsOf(sub));
      for (const g of sub.groups) {
        if (!on.has(g.value)) continue;
        for (const c of g.cases) {
          if (caseOff.has(c.uid)) continue;
          for (const d of dirs) {
            const kn = caseKnown.has(knownKey(c.uid, d));
            if (scope === "learning" && kn) continue;
            if (scope === "known" && !kn) continue;
            out.push({ c, d, subset: sub.key });
          }
        }
      }
    }
    return out;
  }, [ready, subsetOn, groupsOf, dirsOf, caseOff, caseKnown, scope]);

  // ---------- problem generation ----------
  const makeDrill = useCallback((entry) => {
    const target = core.stateForDir(entry.c, entry.d);
    if (!target) return null;
    const scramble = core.maskedScramble(target, distRef.current);
    if (!scramble) return null;
    return { kind: "drill", c: entry.c, d: entry.d, subset: entry.subset, state: target, scramble };
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

  const nextSolve = useCallback(() => {
    const st = core.randomReachable(distRef.current);
    const scramble = core.maskedScramble(st, distRef.current);
    setCurrent(scramble ? { kind: "solve", state: st, scramble } : null);
  }, []);

  const nextRecog = useCallback(() => {
    setPhase("ready"); setLast(null);
    if (!entries.length) { setCurrent(null); return; }
    const e2 = entries[Math.floor(Math.random() * entries.length)];
    const d = (e2.d + (Math.random() < 0.5 ? 2 : 0)) % 4; // coin-flip y² view (same canon)
    const state = core.stateForDir(e2.c, d);
    if (!state) { setCurrent(null); return; }
    shownAt.current = performance.now();
    setCurrent({ kind: "recog", c: e2.c, d, subset: e2.subset, state });
  }, [entries]);

  const revealRecog = useCallback(() => {
    if (!current || current.kind !== "recog" || phase === "stopped") return;
    const ms = performance.now() - shownAt.current;
    setLast({ kind: "recog", ms, c: current.c, d: current.d, subset: current.subset, state: current.state });
    setSession((s) => [...s.slice(-49), { kind: "recog", ms }]);
    setPhase("stopped");
  }, [current, phase]);

  // self-grade the revealed case (1 = recognized, 2 = missed); grading advances
  const gradeRecog = useCallback((hit) => {
    if (phase !== "stopped" || !last || last.kind !== "recog") return;
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

  const advance = useCallback(() => {
    if (mode === "solve") { nextSolve(); return; }
    if (mode === "recog") { nextRecog(); return; }
    if (mode === "drill") { nextDrill(); return; }
    setRecap((r) => {
      if (!r) return r;
      const idx = r.idx + 1;
      if (idx >= r.queue.length) { setCurrent(null); return { ...r, idx }; }
      setCurrent(makeDrill(r.queue[idx]));
      return { ...r, idx };
    });
  }, [mode, nextDrill, nextSolve, nextRecog, makeDrill]);

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
    if (mode === "solve") { if (modeSwitch) nextSolve(); return; } // solve ignores the pool
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
    } else if (current && current.kind === "solve") {
      const analysis = core.analyze(current.state, distRef.current, fldistRef.current);
      const split = analysis && analysis.lines.length ? core.lineLayerSplit(current.state, analysis.lines[0].moves) : null;
      setLast({ kind: "solve", ms, scramble: current.scramble, state: current.state, analysis, split });
      setSession((s) => [...s.slice(-49), { kind: "solve", ms }]);
      setSolveStats((v) => ({ n: v.n + 1, best: Math.min(v.best, ms), sum: v.sum + ms }));
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
        if (e.code === "Space" || e.code === "Enter" || e.code === "NumpadEnter") {
          e.preventDefault();
          if (phase === "stopped") nextRecog(); else revealRecog(); // space on a reveal = skip ungraded
        } else if (phase === "stopped" && (e.code === "Digit1" || e.code === "Numpad1")) {
          e.preventDefault(); gradeRecog(true);
        } else if (phase === "stopped" && (e.code === "Digit2" || e.code === "Numpad2")) {
          e.preventDefault(); gradeRecog(false);
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
  }, [phase, trigger, stopTimer, mode, nextRecog, revealRecog, gradeRecog, last, caseBrowser]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  useEffect(() => { if (phase !== "running") cancelAnimationFrame(raf.current); }, [phase]);
  useEffect(() => { if (mode === "drill" || mode === "recap") lastAlgoMode.current = mode; }, [mode]);

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
  const toggleDir = (key, d) => {
    const cur = dirsOf(key);
    setDirSel((s) => ({ ...s, [key]: cur.includes(d) ? cur.filter((v) => v !== d) : [...cur, d].sort() }));
  };
  const toggleCase = (uid) =>
    setCaseOff((s) => { const n = new Set(s); if (n.has(uid)) n.delete(uid); else n.add(uid); return n; });
  const toggleKnownAt = (uid, dirs) =>
    setCaseKnown((s) => {
      const n = new Set(s);
      const all = dirs.every((d) => n.has(knownKey(uid, d)));
      for (const d of dirs) { const k = knownKey(uid, d); if (all) n.delete(k); else n.add(k); }
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
  const knownCount = (sub) => {
    const dirs = dirsOf(sub.key);
    if (!dirs.length) return 0;
    return sub.cases.filter((c) => dirs.every((d) => caseKnown.has(knownKey(c.uid, d)))).length;
  };

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
  const sessionAo5 = useMemo(() => {
    const times = session.filter((s) => s.kind === "solve").slice(-5).map((s) => s.ms);
    if (times.length < 5) return null;
    const sorted = times.slice().sort((a, b) => a - b);
    return (sorted[1] + sorted[2] + sorted[3]) / 3;
  }, [session]);

  const resetStats = () => {
    setCaseStats({});
    setRecogStats({});
    setSolveStats({ n: 0, best: Infinity, sum: 0 });
    setSession([]);
    setLast(null);
    persist({ caseStats: {}, recogStats: {}, solveStats: { n: 0, best: Infinity, sum: 0 } });
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
    const dirs = dirsOf(sub.key);
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
          <div className="hint" style={{ textAlign: "left", margin: "0 0 8px" }}>
            known is per direction · editing: {dirs.length ? dirs.map((d) => DIRS[d]).join(", ") : "(no direction selected)"}
          </div>
          <div className="presets" style={{ margin: "0 0 10px" }}>
            <button className="preset" onClick={() => setCaseOff((s) => { const n = new Set(s); for (const c of list) n.delete(c.uid); return n; })}>enable shown</button>
            <button className="preset" onClick={() => setCaseOff((s) => { const n = new Set(s); for (const c of list) n.add(c.uid); return n; })}>disable shown</button>
            <button className="preset" onClick={() => setCaseKnown((s) => { const n = new Set(s); for (const c of list) for (const d of dirs) n.add(knownKey(c.uid, d)); return n; })}>mark shown known</button>
            <button className="preset" onClick={() => setCaseKnown((s) => { const n = new Set(s); for (const c of list) for (const d of dirs) n.delete(knownKey(c.uid, d)); return n; })}>mark shown unknown</button>
          </div>
          <div className="chips">
            {list.map((c) => {
              const kn = dirs.length > 0 && dirs.every((d) => caseKnown.has(knownKey(c.uid, d)));
              return (
                <span key={c.uid} className="markwrap">
                  <button className={"chip" + (caseOff.has(c.uid) ? "" : " on")}
                    style={{ "--cdot": subColor(sub.key) }} onClick={() => toggleCase(c.uid)}>
                    <span className="dot" />{c.name}{kn ? " ✓" : ""}
                  </button>
                  <button className={"markbtn ok" + (kn ? " sel" : "")} title="mark known"
                    onClick={() => toggleKnownAt(c.uid, dirs)}>K</button>
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
          <button className={"mode" + (mode === "solve" ? " on" : "")} onClick={() => setMode("solve")}>Full solve</button>
          <button className={"mode" + (mode === "recog" ? " on" : "")} onClick={() => setMode("recog")}>Recognition</button>
        </div>

        {/* ---------- setup (Algorithm + Recognition share the pool) ---------- */}
        {(mode === "drill" || mode === "recap" || mode === "recog") && (
          <>
            {(mode === "drill" || mode === "recap") && (
              <div className="chips" style={{ alignItems: "center" }}>
                <div className="modes">
                  {[["drill", "Drill"], ["recap", "Recap"]].map(([v, l]) => (
                    <button key={v} className={"mode" + (mode === v ? " on" : "")} onClick={() => setMode(v)}>{l}</button>
                  ))}
                </div>
                <span className="grouplabel">practice</span>
                <div className="modes">
                  {[["all", "All"], ["learning", "Learning"], ["known", "Known"]].map(([v, l]) => (
                    <button key={v} className={"mode" + (scope === v ? " on" : "")} onClick={() => setScope(v)}>{l}</button>
                  ))}
                </div>
              </div>
            )}

            <div className="card setupcard">
              <button className="setuphead" onClick={() => setSetupOpen((o) => !o)}>
                <strong>Setup</strong>
                <span className="setupsum">
                  {ready ? `${entries.length} case view${entries.length === 1 ? "" : "s"} in the pool` : "loading…"}
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
                        <span className="grouplabel">view</span>
                        <div className="modes">
                          {DIRS.map((label, d) => (
                            <button key={d} className={"mode" + (dirsOf(sub.key).includes(d) ? " on" : "")}
                              onClick={() => toggleDir(sub.key, d)}>{label}</button>
                          ))}
                        </div>
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
            <div className="hint" style={{ marginTop: 10 }}>{recap.queue.length} case views covered</div>
            <button className="restart" onClick={startRecap}>Run it again</button>
          </div>
        ) : !current ? (
          <div className="stage" style={{ cursor: "default" }}>
            <div className="empty" style={{ padding: "40px 0", textAlign: "center" }}>
              {entries.length === 0
                ? (scope === "learning" ? "Nothing left to learn in this selection — every enabled case view is marked known."
                  : scope === "known" ? "No case views marked known yet in this selection."
                  : "Pick at least one subset, group and view in Setup to start.")
                : "Couldn’t generate a scramble — try other cases."}
            </div>
          </div>
        ) : current.kind === "recog" ? (
          <div className="stage" style={{ cursor: "default" }}>
            <div className="stagegrid recogstage">
              <Net state={current.state} w={300} />
            </div>
            {phase === "stopped" && last ? (
              <>
                <div className="reveal">
                  <span className="tag" style={{ "--cdot": subColor(last.subset) }}>
                    <span className="dot" />{last.subset}
                  </span>
                  <span className="casename">{last.c.name}</span>
                  <span className="bartag">{DIRS[last.d]} view</span>
                  <span className="mono">{fmt(last.ms)}s</span>
                </div>
                <div className="graderow">
                  <button className="gradebtn hit" onClick={() => gradeRecog(true)}>Recognized ✓ (1)</button>
                  <button className="gradebtn miss" onClick={() => gradeRecog(false)}>Missed ✗ (2)</button>
                  <button className="preset" onClick={nextRecog}>skip (space)</button>
                </div>
                <AlgList c={last.c} d={last.d} />
              </>
            ) : (
              <>
                <div className="hint" style={{ marginTop: 14 }}>Which case is this?</div>
                <button className="restart" style={{ marginTop: 8 }} onClick={revealRecog}>Reveal (space)</button>
              </>
            )}
          </div>
        ) : current.kind === "solve" ? (
          <div className="stage" onPointerDown={(e) => { e.preventDefault(); trigger(); }}>
            <div className="stagegrid">
              <div className="scramble">{dispAlg(current.scramble)}</div>
              <Net state={current.state} w={240} />
            </div>
            <div className={"timer" + (phase === "running" ? " running" : "")}>{fmt(elapsed)}</div>
            {phase === "stopped" && last && last.kind === "solve" ? (
              <div className="analysis" onPointerDown={(e) => e.stopPropagation()}>
                {last.analysis ? (
                  <>
                    <div className="solhead">
                      optimal {last.analysis.direct} moves
                      {last.split ? ` — a layer falls out after ${last.split.at}` : ""}
                    </div>
                    <div className="sollist">
                      {last.analysis.lines.slice(0, 6).map((l, i) => (
                        <span key={i} className="mono solpill">{dispAlg(l.alg)}</span>
                      ))}
                      {last.analysis.lines.length > 6 ? <span className="hint">+{last.analysis.lines.length - 6} more</span> : null}
                    </div>
                    {last.analysis.method ? (
                      <div className="methodrow">
                        <div className="solhead">via first layer ({last.analysis.method.face}): {last.analysis.method.flLen} + {last.analysis.method.finish} = {last.analysis.method.total} moves</div>
                        <div className="sollist">
                          {last.analysis.method.flAlg ? <span className="mono solpill fl">{dispAlg(last.analysis.method.flAlg)}</span> : <span className="hint">layer already done</span>}
                          {last.analysis.method.finishAlg ? <span className="mono solpill">{dispAlg(last.analysis.method.finishAlg)}</span> : null}
                        </div>
                      </div>
                    ) : (
                      <div className="hint">
                        {flBoot && flBoot !== "ready" && flBoot !== "error" ? `first-layer table building… ${flBoot.pct || 0}%` : null}
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            ) : (
              <div className="hint">{phase === "running" ? "tap or any key to stop" : "tap or space to start"}</div>
            )}
          </div>
        ) : (
          <div className="stage" onPointerDown={(e) => { e.preventDefault(); trigger(); }}>
            <div className="stagegrid">
              <div className="scramble">{dispAlg(current.scramble)}</div>
              <Net state={current.state} w={240} />
            </div>
            <div className={"timer" + (phase === "running" ? " running" : "")}>{fmt(elapsed)}</div>
            {phase === "stopped" && last && last.kind === "drill" ? (
              <div className="reveal" onPointerDown={(e) => e.stopPropagation()}>
                <span className="tag" style={{ "--cdot": subColor(last.subset) }}>
                  <span className="dot" />{last.subset}
                </span>
                <span className="casename">{last.c.name}</span>
                <span className="bartag">{DIRS[last.d]}</span>
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
            {mode === "solve" ? (
              <>
                <h3>Full-solve stats</h3>
                {solveStats.n === 0 ? (
                  <div className="empty">No solves yet. Times land here.</div>
                ) : (
                  <table>
                    <thead><tr><th>Solves</th><th>Best</th><th>Mean</th><th>ao5 (session)</th></tr></thead>
                    <tbody>
                      <tr>
                        <td className="mono">{solveStats.n}</td>
                        <td className="mono">{fmt(solveStats.best)}</td>
                        <td className="mono">{fmt(solveStats.sum / solveStats.n)}</td>
                        <td className="mono">{sessionAo5 ? fmt(sessionAo5) : "—"}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
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
                                {c ? <Net state={core.stateForDir(c, 0)} w={120} /> : null}
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
                <h3>Stats by variant</h3>
                {Object.keys(variantAgg).length === 0 ? (
                  <div className="empty">No solves yet. Times land here, grouped by subset and view.</div>
                ) : (
                  <table>
                    <thead><tr><th>Variant</th><th>Solves</th><th>Cases seen</th><th>Best</th><th>Mean</th></tr></thead>
                    <tbody>
                      {Object.keys(variantAgg).sort().map((vk) => {
                        const a = variantAgg[vk];
                        return (
                          <tr key={vk} className="setrow" onClick={() => setExpandedVariant(expandedVariant === vk ? null : vk)}>
                            <td className="name">
                              <span className="dot" style={{ background: subColor(a.subset) }} />
                              {a.subset} · {DIRS[a.d]}
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
                            {c ? <Net state={core.stateForDir(c, st.d)} w={120} /> : null}
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
            {session.length === 0 ? (
              <div className="empty">Recent times show up here.</div>
            ) : (
              <div className="times">
                {session.slice(-24).map((t, i) => (
                  <span key={i} className="timepill"
                    style={{ "--cdot": t.kind === "drill" ? subColor(t.subset)
                      : t.hit === true ? "var(--green)" : t.hit === false ? "var(--red)" : "var(--accent)" }}>
                    {t.hit === true ? "✓ " : t.hit === false ? "✗ " : ""}{fmt(t.ms)}
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
