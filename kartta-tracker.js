/*! KARTTA tracker v1 — analítica propia, sin cookies, sin IP, sin datos personales.
 *
 * SITIO (kartta.food):
 *   <script defer src="/kartta-tracker.js" data-scope="site"></script>
 *
 * DASHBOARD de restaurantes (tras iniciar sesión):
 *   <script defer src="/kartta-tracker.js" data-scope="dashboard"></script>
 *   KarttaTrack.setContext({ restaurantId: '<uuid>', getToken: () => session.access_token });
 *   KarttaTrack.view('menu-editor');            // cada vez que cambia la sección del panel
 *   KarttaTrack.feature('ai');                  // al usar IA, estadísticas, pedidos, etc.
 *   KarttaTrack.editor('open') / editor('save');
 *
 * Eventos de embudo (llámalos desde el flujo real): signup_open, signup_start, signup_complete,
 *   login_view, login_success, plan_select, checkout_start  →  KarttaTrack.event('signup_complete')
 *
 * Respeta Do-Not-Track y Global Privacy Control. KarttaTrack.optOut() desactiva y recuerda la decisión.
 */
(function () {
  'use strict';
  var script = document.currentScript;
  var attr = function (n, d) { return (script && script.getAttribute(n)) || d; };
  var ENDPOINT = attr('data-endpoint', 'https://ifbvdjvukygvvgiyzgav.supabase.co/functions/v1/analytics-collect');
  var SCOPE = attr('data-scope', 'site') === 'dashboard' ? 'dashboard' : 'site';
  var AUTO_FUNNEL = attr('data-auto-funnel', 'true') !== 'false';
  var SESSION_MS = 30 * 60 * 1000;

  var noop = function () {};
  var api = { event: noop, view: noop, feature: noop, editor: noop, setContext: noop, optOut: noop, optIn: noop, enabled: false };
  window.KarttaTrack = api;

  var store = {
    get: function (s, k) { try { return s.getItem(k); } catch (e) { return null; } },
    set: function (s, k, v) { try { s.setItem(k, v); } catch (e) { /* almacenamiento bloqueado */ } }
  };
  var LS = window.localStorage, SS = window.sessionStorage;

  function optedOut() {
    return store.get(LS, 'kt_optout') === '1' || navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true;
  }
  api.optOut = function () { store.set(LS, 'kt_optout', '1'); api.enabled = false; };
  api.optIn = function () { try { LS.removeItem('kt_optout'); } catch (e) {} };
  if (optedOut()) return;
  api.enabled = true;

  // ---------- utilidades ----------
  function rid(len) {
    var a = new Uint8Array(len), s = '';
    (window.crypto || window.msCrypto).getRandomValues(a);
    for (var i = 0; i < len; i++) s += (a[i] % 36).toString(36);
    return s;
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var h = [], a = new Uint8Array(16); crypto.getRandomValues(a);
    a[6] = (a[6] & 15) | 64; a[8] = (a[8] & 63) | 128;
    for (var i = 0; i < 16; i++) h.push((a[i] + 256).toString(16).slice(1));
    return h.slice(0, 4).join('') + '-' + h.slice(4, 6).join('') + '-' + h.slice(6, 8).join('') + '-' + h.slice(8, 10).join('') + '-' + h.slice(10).join('');
  }
  function sectionName(raw) {
    var s = String(raw || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (!s) return null;
    if (/feature|funcional|caracter/.test(s)) return 'features';
    if (/pric|precio|plan/.test(s)) return 'pricing';
    if (/faq|pregunta/.test(s)) return 'faq';
    if (/contact|contacto/.test(s)) return 'contact';
    if (/hero|inicio|home/.test(s)) return 'hero';
    return s.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || null;
  }

  // ---------- identidad: visitante (local) y sesión (30 min sin actividad) ----------
  var vid = store.get(LS, 'kt_v');
  if (!vid || !/^[a-z0-9]{16,64}$/.test(vid)) { vid = rid(24); store.set(LS, 'kt_v', vid); }
  var sid = store.get(SS, 'kt_s'), last = parseInt(store.get(SS, 'kt_t') || '0', 10);
  var attrib = null;
  function touchSession() {
    var now = Date.now();
    if (!sid || !last || now - last > SESSION_MS) {
      sid = rid(20); store.set(SS, 'kt_s', sid); attrib = null; store.set(SS, 'kt_a', '');
    }
    last = now; store.set(SS, 'kt_t', String(now));
  }
  function ownHost(h) { return !h || h === location.hostname || /(^|\.)kartta\.food$/.test(h) || /^karttafood[a-z0-9-]*\.vercel\.app$/.test(h); }
  function readAttribution() {
    if (attrib) return attrib;
    try { var saved = store.get(SS, 'kt_a'); if (saved) { attrib = JSON.parse(saved); return attrib; } } catch (e) {}
    var q = new URLSearchParams(location.search), refHost = '';
    try { refHost = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) {}
    attrib = {
      ref: ownHost(refHost) ? '' : refHost,
      us: (q.get('utm_source') || '').slice(0, 60), um: (q.get('utm_medium') || '').slice(0, 30), uc: (q.get('utm_campaign') || '').slice(0, 80),
      ck: q.get('gclid') ? 'g' : q.get('ttclid') ? 't' : q.get('msclkid') ? 'm' : q.get('fbclid') ? 'f' : ''
    };
    store.set(SS, 'kt_a', JSON.stringify(attrib));
    return attrib;
  }
  function screenBucket() {
    var w = window.innerWidth || 0;
    return w < 480 ? '<480' : w < 768 ? '480-767' : w < 1024 ? '768-1023' : w < 1440 ? '1024-1439' : '1440+';
  }

  // ---------- cola y envío ----------
  var ctx = { restaurantId: null, getToken: null };
  var queue = [], timer = null, pendingDash = [];
  function enqueue(type, o) {
    if (!api.enabled) return;
    touchSession();
    var e = { id: uuid(), type: type, scope: SCOPE, vid: vid, sid: sid, path: location.pathname, sw: screenBucket() };
    if (SCOPE === 'site') { var a = readAttribution(); e.ref = a.ref; e.us = a.us; e.um = a.um; e.uc = a.uc; e.ck = a.ck; }
    if (o) for (var k in o) if (o[k] !== undefined && o[k] !== null && o[k] !== '') e[k] = o[k];
    if (SCOPE === 'dashboard') {
      if (!ctx.restaurantId) { if (pendingDash.length < 50) pendingDash.push(e); return; }
      e.rid = ctx.restaurantId;
    }
    queue.push(e);
    if (queue.length >= 8) flush(false); else if (!timer) timer = setTimeout(function () { flush(false); }, 4000);
  }
  function flush(unloading) {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!queue.length) return;
    var batch = queue.splice(0, 25), body = JSON.stringify({ events: batch });
    var token = SCOPE === 'dashboard' && ctx.getToken ? safeToken() : null;
    try {
      if (!token && unloading && navigator.sendBeacon) { navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain' })); }
      else {
        var h = { 'Content-Type': token ? 'application/json' : 'text/plain' };
        if (token) h.Authorization = 'Bearer ' + token;
        fetch(ENDPOINT, { method: 'POST', body: body, headers: h, keepalive: true, credentials: 'omit' }).catch(noop);
      }
    } catch (e) { /* nunca romper la página */ }
    if (queue.length) flush(unloading);
  }
  function safeToken() { try { return ctx.getToken(); } catch (e) { return null; } }

  // ---------- tiempo visible ----------
  var visibleMs = 0, visibleSince = document.visibilityState === 'visible' ? Date.now() : 0;
  function pauseVisible() { if (visibleSince) { visibleMs += Date.now() - visibleSince; visibleSince = 0; } }
  function resumeVisible() { if (!visibleSince) visibleSince = Date.now(); }
  function takeVisible() { pauseVisible(); var v = visibleMs; visibleMs = 0; if (document.visibilityState === 'visible') visibleSince = Date.now(); return v; }

  // ---------- secciones visibles (sitio) ----------
  var seen = {}, io = null, pricingSent = false;
  function sectionStart(el, name) { seen[name] = { since: Date.now(), el: el }; if (name === 'pricing' && !pricingSent) { pricingSent = true; enqueue('pricing_view', { section: 'pricing' }); } }
  function sectionEnd(name) {
    var s = seen[name]; if (!s) return; delete seen[name];
    var d = Date.now() - s.since;
    if (d >= 1000) enqueue('section_view', { section: name, dur: d });
  }
  function observeSections() {
    if (SCOPE !== 'site' || !('IntersectionObserver' in window)) return;
    if (io) io.disconnect();
    for (var n in seen) delete seen[n];
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var name = en.target.__kt;
        if (!name) return;
        if (en.isIntersecting) { if (!seen[name]) sectionStart(en.target, name); } else sectionEnd(name);
      });
    }, { threshold: 0.5 });
    var nodes = document.querySelectorAll('[data-kt-section], section[id]');
    for (var i = 0; i < nodes.length; i++) {
      var nm = sectionName(nodes[i].getAttribute('data-kt-section') || nodes[i].id);
      if (nm) { nodes[i].__kt = nm; io.observe(nodes[i]); }
    }
  }
  function endAllSections() { for (var n in seen) sectionEnd(n); }

  // ---------- páginas ----------
  var pageStart = 0, curPath = null, curView = null, viewStart = 0;
  function pageView() {
    curPath = location.pathname; pageStart = Date.now();
    if (SCOPE === 'site') {
      enqueue('page_view', { path: location.pathname });
      if (AUTO_FUNNEL) {
        if (/\/(registro|registrarse|signup|sign-up|register)(\/|$)/i.test(location.pathname)) enqueue('signup_open');
        else if (/\/(login|iniciar-sesion|ingresar|signin|sign-in)(\/|$)/i.test(location.pathname)) enqueue('login_view');
      }
      setTimeout(observeSections, 300);
    }
  }
  function pageEnd() {
    endAllSections();
    var v = takeVisible();
    if (v > 500) enqueue('time_on_page', { dur: v, path: curPath || location.pathname, section: SCOPE === 'dashboard' ? curView : undefined });
  }

  if (SCOPE === 'site') {
    ['pushState', 'replaceState'].forEach(function (m) {
      var orig = history[m];
      history[m] = function () {
        var before = location.pathname, r = orig.apply(this, arguments);
        if (location.pathname !== before) { pageEnd(); pageView(); }
        return r;
      };
    });
    window.addEventListener('popstate', function () { if (location.pathname !== curPath) { pageEnd(); pageView(); } });

    // clics: etiqueta corta de botones y enlaces; jamás texto de campos de formulario.
    var clicks = 0;
    document.addEventListener('click', function (ev) {
      if (clicks >= 60) return;
      var t = ev.target && ev.target.closest ? ev.target.closest('[data-kt],a,button,[role="button"]') : null;
      if (!t) return;
      var label = t.getAttribute('data-kt') || t.getAttribute('aria-label') || (t.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!label && t.tagName === 'A') { try { label = new URL(t.href, location.href).pathname; } catch (e) {} }
      if (!label) return;
      var sec = t.closest ? t.closest('[data-kt-section], section[id]') : null;
      clicks++;
      enqueue('click', { element: label.slice(0, 80), section: sec ? sectionName(sec.getAttribute('data-kt-section') || sec.id) : undefined });
    }, true);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { pauseVisible(); if (SCOPE === 'site') { endAllSections(); } flush(true); }
    else { resumeVisible(); if (SCOPE === 'site') observeSections(); }
  });
  window.addEventListener('pagehide', function () { pageEnd(); if (SCOPE === 'dashboard') closeView(); flush(true); });

  // ---------- API pública ----------
  var FUNNEL = { signup_open: 1, signup_start: 1, signup_complete: 1, login_view: 1, login_success: 1, plan_select: 1, checkout_start: 1, pricing_view: 1, editor_open: 1, editor_save: 1, custom: 1 };
  api.event = function (type, o) {
    if (!FUNNEL[type]) return;
    var p = {};
    if (o && typeof o === 'object') { if (o.element) p.element = String(o.element).slice(0, 80); if (o.section) p.section = sectionName(o.section); if (o.props) p.props = o.props; }
    enqueue(type, p);
  };
  api.setContext = function (c) {
    if (!c) return;
    ctx.restaurantId = c.restaurantId || null; ctx.getToken = typeof c.getToken === 'function' ? c.getToken : null;
    if (ctx.restaurantId && pendingDash.length) { var p = pendingDash.splice(0); p.forEach(function (e) { e.rid = ctx.restaurantId; queue.push(e); }); flush(false); }
  };
  function closeView() {
    if (curView && viewStart) { var d = Date.now() - viewStart; if (d >= 500) enqueue('dash_view', { section: curView, dur: d }); }
    viewStart = 0;
  }
  api.view = function (name) {
    if (SCOPE !== 'dashboard') return;
    var n = sectionName(name); if (!n || n === curView) return;
    closeView(); curView = n; viewStart = Date.now();
  };
  api.feature = function (name) { var n = sectionName(name); if (n) enqueue('feature_use', { element: n, section: curView || undefined }); };
  api.editor = function (action) { enqueue(action === 'save' ? 'editor_save' : 'editor_open', { section: curView || undefined }); };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pageView); else pageView();
})();
