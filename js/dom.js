/* Skewbiks.com — shared DOM micro-kit (window.OODom = { h, $, toast, tick, copyBtn, installErrorToast }).
   One source for the tiny hyperscript helpers used by oo.js, algs.js, solver.js.
   Plain browser global; no bundler. The `html` attr is a trusted-markup-only
   escape hatch (innerHTML) — never pass user-supplied strings to it. */
(function () {
  'use strict';
  const $ = (q, el) => (el || document).querySelector(q);
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const k in (attrs || {})) {
      if (k === 'class') el.className = attrs[k];
      else if (k === 'html') el.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') el.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) el.setAttribute(k, attrs[k]);
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
    }
    return el;
  };
  function toast(msg, duration) {
    if (duration === undefined) duration = 3500;
    const t = h('div', { class: 'toast' }, msg);
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('show'), 16);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 350); }, duration);
  }
  const tick = () => new Promise(r => setTimeout(r, 0));
  // clipboard copy button with an execCommand fallback for older browsers
  function copyBtn(text) {
    return h('button', { class: 'copy', title: 'Copy', 'aria-label': 'Copy', onclick: () => {
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
        .then(() => toast('Copied'))
        .catch(() => { const ta = h('textarea', null, text); document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('Copied'); });
    } }, '⎘');
  }
  // last-resort toast for uncaught errors (does not suppress console logging)
  function installErrorToast() {
    window.addEventListener('error', () => { try { toast('Something went wrong. Try reloading the page.'); } catch (e) {} });
  }

  /* ---- shared WCA/NS notation preference (one localStorage key site-wide,
     so an explicit choice on any page sticks everywhere). The trainer keeps
     its own React copy of this plumbing (js/dom.js is not loaded on
     trainer.html) — KEEP the key + validation in sync with the bundle. ---- */
  const NOTA_KEY = 'skewbiks-notation';
  function getNota(dflt) {
    try { const v = localStorage.getItem(NOTA_KEY); if (v === 'wca' || v === 'ns') return v; } catch (e) {}
    return dflt === 'ns' ? 'ns' : 'wca';
  }
  function setNota(v) {
    const n = v === 'ns' ? 'ns' : 'wca';
    try { localStorage.setItem(NOTA_KEY, n); } catch (e) {}
    return n;
  }
  // engine WCA string -> the given notation, for display
  const dispAlg = (s, nota) => (s && nota === 'ns') ? window.OOEngine.wcaToNS(s) : s;
  // the two-button WCA/NS switch — one markup + aria treatment for every page.
  // opts: { titles: {wca, ns} per-button tooltips (null suppresses), groupTitle,
  // ariaLabel } — pages whose toggle SEMANTICS differ (the solver's governs how
  // the scramble is READ) override these rather than re-rolling the markup.
  function notaSwitch(current, onChange, opts) {
    const o = opts || {};
    const tt = o.titles || {
      wca: 'WCA notation — R U L B turn the fixed corners (official scrambles)',
      ns: 'NS notation — top corners F R B L, bottom corners f r b l (Sarah / NS alg sheets)',
    };
    const btn = (val, label) => h('button', {
      class: 'notabtn' + (current === val ? ' on' : ''),
      'aria-pressed': current === val ? 'true' : 'false',
      title: tt[val], onclick: () => onChange(val),
    }, label);
    return h('div', { class: 'notaswitch', role: 'group',
      'aria-label': o.ariaLabel || 'move notation', title: o.groupTitle || null },
      btn('wca', 'WCA'), btn('ns', 'NS'));
  }

  window.OODom = { h, $, toast, tick, copyBtn, installErrorToast, getNota, setNota, dispAlg, notaSwitch };
})();
