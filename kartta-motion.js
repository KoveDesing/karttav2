/**
 * KARTTA — Motion (capa aditiva). No toca datos, red, auth ni lógica del panel.
 * API: window.KARTTA_MOTION.switchView(nombreDeVista)
 * Si algo falla o el navegador no soporta WAAPI, el panel funciona igual (sin animación).
 */
(function () {
  'use strict';
  var RM = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var reduce = function () { return RM.matches; };
  var canAnimate = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var K = (window.KARTTA_MOTION = {});

  /* ---------- 1. Crossfade entre vistas ---------- */
  function markFirst(v) {
    if (!v || v.dataset.mSeen) return;
    v.dataset.mSeen = '1'; v.classList.add('m-first');
    setTimeout(function () { v.classList.remove('m-first'); }, 1100);
  }
  K.switchView = function (name) {
    var views = $$('.view');
    var next = views.filter(function (v) { return v.dataset.panel === name; })[0];
    function clean(v) { v.classList.remove('m-leaving'); v.style.cssText = ''; v.removeAttribute('aria-hidden'); v.inert = false; }
    function plain() { views.forEach(function (s) { clean(s); s.classList.toggle('active', s === next); }); }
    if (!next) return plain();
    // una transición anterior sin terminar se cierra al instante
    views.forEach(function (v) { if (v.classList.contains('m-leaving')) { clean(v); v.classList.remove('active'); } });
    clean(next);
    var prev = views.filter(function (v) { return v.classList.contains('active') && v !== next; })[0];
    if (!prev || !canAnimate || reduce()) { plain(); markFirst(next); return; }
    var host = prev.parentElement; host.classList.add('m-host');
    var box = { top: prev.offsetTop, left: prev.offsetLeft, width: prev.offsetWidth };
    prev.classList.add('m-leaving');
    prev.style.top = box.top + 'px'; prev.style.left = box.left + 'px'; prev.style.width = box.width + 'px';
    prev.setAttribute('aria-hidden', 'true'); prev.inert = true;
    next.classList.add('active'); markFirst(next);
    var done = false;
    function end() {
      if (done) return; done = true;
      if (!prev.classList.contains('m-leaving')) return;   // ya se limpió (o volvió a ser la vista activa)
      clean(prev); prev.classList.remove('active');
    }
    try {
      prev.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: 'ease-out', fill: 'forwards' }).onfinish = end;
    } catch (e) { end(); }
    setTimeout(end, 260);
  };

  /* ---------- 2. Cifras: blur reveal cuando el dato REAL cambia ---------- */
  function watchNumber(el) {
    var last = el.textContent;
    new MutationObserver(function () {
      var t = el.textContent; if (t === last) return; last = t;
      if (reduce()) return;
      el.classList.remove('m-blur'); void el.offsetWidth; el.classList.add('m-blur');
    }).observe(el, { childList: true, characterData: true, subtree: true });
  }

  /* ---------- 3. Salida animada de modales / gate (se clona un "fantasma" visual) ---------- */
  function ghostOut(el, opts) {
    if (!canAnimate || reduce() || !document.body) return;
    try {
      var g = el.cloneNode(true);
      g.removeAttribute('id'); $$('[id]', g).forEach(function (n) { n.removeAttribute('id'); });
      (opts.remove || []).forEach(function (c) { g.classList.remove(c); });
      (opts.add || []).forEach(function (c) { g.classList.add(c); });
      g.setAttribute('aria-hidden', 'true'); g.inert = true; g.style.pointerEvents = 'none';
      document.body.appendChild(g);
      var inner = g.querySelector('.modal');
      var fin = function () { if (g.parentNode) g.parentNode.removeChild(g); };
      g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: opts.ms || 150, easing: 'ease-in', fill: 'forwards' }).onfinish = fin;
      if (inner) inner.animate([{ transform: 'none' }, { transform: 'translateY(6px) scale(.97)' }], { duration: opts.ms || 150, easing: 'ease-in', fill: 'forwards' });
      setTimeout(fin, 400);
    } catch (e) { /* sin animación de salida */ }
  }

  /* ---------- 4. Modales con origen en el elemento que los abre ---------- */
  var lastTrigger = { rect: null, t: 0 };
  document.addEventListener('pointerdown', function (e) {
    var el = e.target.closest && e.target.closest('button,a,[role=button],.sum,.pcard,.mcard');
    if (el) lastTrigger = { rect: el.getBoundingClientRect(), t: Date.now() };
  }, true);
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var el = document.activeElement; if (el && el.getBoundingClientRect) lastTrigger = { rect: el.getBoundingClientRect(), t: Date.now() };
  }, true);

  function modalIn(bg) {
    var m = bg.querySelector('.modal'); if (!m || !canAnimate || reduce()) return;
    var from = { transform: 'translateY(10px) scale(.96)', opacity: 0 };
    var tr = lastTrigger.rect && Date.now() - lastTrigger.t < 1500 ? lastTrigger.rect : null;
    if (tr) {
      var mr = m.getBoundingClientRect();
      var dx = (tr.left + tr.width / 2) - (mr.left + mr.width / 2), dy = (tr.top + tr.height / 2) - (mr.top + mr.height / 2);
      from = { transform: 'translate(' + (dx * 0.3).toFixed(1) + 'px,' + (dy * 0.3).toFixed(1) + 'px) scale(.86)', opacity: 0 };
    }
    try { m.animate([from, { transform: 'none', opacity: 1 }], { duration: 300, easing: 'cubic-bezier(.34,1.32,.64,1)' }); } catch (e) {}
  }
  function watchModal(bg) {
    var was = bg.classList.contains('show');
    new MutationObserver(function () {
      var now = bg.classList.contains('show'); if (now === was) return; was = now;
      if (now) modalIn(bg); else ghostOut(bg, { add: ['show', 'm-ghost'] });
    }).observe(bg, { attributes: true, attributeFilter: ['class'] });
  }

  /* ---------- 5. Barra móvil: magnificación tipo dock ---------- */
  function initDock() {
    var tb = document.getElementById('tabbar'); if (!tb) return;
    var btns = $$('button', tb), raf = 0, x = 0;
    function apply() {
      raf = 0;
      btns.forEach(function (b) {
        var r = b.getBoundingClientRect(), c = r.left + r.width / 2;
        var f = Math.max(0, 1 - Math.abs(x - c) / 120);        // 1 bajo el cursor → 0 lejos
        b.style.setProperty('--mag', (0.94 + 0.38 * f).toFixed(3)); // cercanos crecen, lejanos se reducen un poco
      });
    }
    function reset() { btns.forEach(function (b) { b.style.removeProperty('--mag'); }); }
    tb.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse' || reduce()) return;
      x = e.clientX; if (!raf) raf = requestAnimationFrame(apply);
    });
    tb.addEventListener('pointerleave', function () { if (raf) cancelAnimationFrame(raf); raf = 0; reset(); });
    tb.addEventListener('pointerdown', function (e) {                // táctil: respuesta inmediata, sin doble toque
      var b = e.target.closest('button'); if (!b || e.pointerType === 'mouse' || reduce()) return;
      b.classList.add('m-press');
    });
    function release() { btns.forEach(function (b) { b.classList.remove('m-press'); }); }
    tb.addEventListener('pointerup', release); tb.addEventListener('pointercancel', release); tb.addEventListener('pointerleave', release);
    tb.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b || reduce()) return;
      b.classList.remove('m-pop'); void b.offsetWidth; b.classList.add('m-pop');
      setTimeout(function () { b.classList.remove('m-pop'); }, 420);
    });
  }

  /* ---------- 6. Gate de carga → fundido de salida ---------- */
  function initGate() {
    var g = document.getElementById('gate'); if (!g) return;
    var was = g.classList.contains('hidden');
    new MutationObserver(function () {
      var now = g.classList.contains('hidden'); if (now === was) return; was = now;
      if (now) ghostOut(g, { remove: ['hidden'], ms: 220 });
    }).observe(g, { attributes: true, attributeFilter: ['class'] });
  }

  function init() {
    try {
      $$('.sum .n, .sum .s, #aiTokens').forEach(watchNumber);
      $$('.modal-bg').forEach(watchModal);
      initDock(); initGate();
    } catch (e) { console.warn('[KARTTA_MOTION]', e); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
