/* =====================================================================
   KARTTA — Landing: motion graphics + interacción comercial
   Un solo archivo, sin dependencias. Todo se activa con IntersectionObserver.
   - Cambia la duración de la prueba en TRIAL_DAYS (se refleja en toda la página).
   - Para ajustar qué animación usa cada sección, edita MAP más abajo.
   - No toca autenticación, Supabase, Wompi ni precios: lee KARTTA_PLANS.
   ===================================================================== */
(function () {
  'use strict';
  var TRIAL_DAYS = 7;
  window.KARTTA_TRIAL_DAYS = TRIAL_DAYS;

  var doc = document, root = doc.documentElement;
  var motion = root.classList.contains('kx');           // false con prefers-reduced-motion
  var fine = window.matchMedia && matchMedia('(pointer:fine)').matches;
  var $ = function (s, c) { return (c || doc).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); };
  var esc = function (t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  /* ---------- Duración de la prueba (un solo lugar) ---------- */
  function applyTrialDays() { $$('[data-trial-days]').forEach(function (n) { n.textContent = TRIAL_DAYS; }); }

  /* ---------- Cinta superior (marquee sin saltos) ---------- */
  function buildRibbon() {
    var track = $('.kx-ribbon-track'); if (!track) return;
    var group = $('.kx-ribbon-group', track); if (!group) return;
    var base = group.cloneNode(true);
    track.textContent = '';
    var half = doc.createElement('div'); half.style.display = 'flex';
    var vw = Math.max(window.innerWidth, 360);
    track.appendChild(half);
    var guard = 0;
    do { var g = base.cloneNode(true); if (guard) g.setAttribute('aria-hidden', 'true'); half.appendChild(g); guard++; }
    while (half.scrollWidth < vw && guard < 12);
    var dup = half.cloneNode(true); dup.setAttribute('aria-hidden', 'true'); track.appendChild(dup);
    track.style.setProperty('--kx-marquee-d', Math.max(20, Math.round(half.scrollWidth / 55)) + 's');
    track.style.animationName = 'kx-marquee';
    track.removeAttribute('data-static');
  }

  /* ---------- Separar títulos en palabras ---------- */
  function splitWords(el) {
    if (el.__kxSplit) return; el.__kxSplit = true;
    var txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
    var vis = doc.createElement('span'); vis.setAttribute('aria-hidden', 'true');
    var i = 0, last = null, gap = true;
    function unit(node) { var w = doc.createElement('span'); w.className = 'kx-w'; w.style.setProperty('--i', i++); w.appendChild(node); vis.appendChild(w); last = w; gap = false; }
    Array.prototype.slice.call(el.childNodes).forEach(function (n) {
      if (n.nodeType === 3) {
        n.textContent.split(/(\s+)/).forEach(function (p) {
          if (!p) return;
          if (/^\s+$/.test(p)) { if (last) vis.appendChild(doc.createTextNode(' ')); gap = true; }
          else if (!gap && last) last.appendChild(doc.createTextNode(p));      // puntuación pegada a la palabra
          else unit(doc.createTextNode(p));
        });
      } else if (n.nodeName === 'BR') { vis.appendChild(doc.createElement('br')); last = null; gap = true; }
      else if (n.nodeType === 1) { var c = n.cloneNode(true); if (!gap && last) last.appendChild(c); else unit(c); }
    });
    var sr = doc.createElement('span'); sr.className = 'kx-sr'; sr.textContent = txt;
    el.textContent = ''; el.appendChild(sr); el.appendChild(vis);
  }

  /* ---------- Coreografía por sección (selector → animación) ---------- */
  // fx: up · scale · card · pop · left · right · drop · img · scatter · words
  // d: retraso base (ms). stagger: contenedor cuyos hijos entran en cascada (step ms).
  var SCATTER = [[-80, -34], [70, -44], [-56, 40], [90, 24], [-100, 10], [44, 54], [80, -24]];
  var MAP = [
    { s: '.section-head .eyebrow, .kd-copy .eyebrow, #espacio .eyebrow', fx: 'up' },
    { s: '.section-head h2, .kd-copy h2', fx: 'words' },
    { s: '.section-head p, .kd-copy > p', fx: 'up', d: 280 },
    // problema
    { s: '#problema .chaos', stagger: 85, kids: '.chaos-card', fx: 'scatter' },
    { s: '#problema .problem-resolve', fx: 'left', d: 120 },
    // cómo funciona
    { s: '#como-funciona .c3d', fx: 'scale', d: 120 },
    { s: '#como-funciona .c3d-controls', fx: 'up', d: 300 },
    { s: '#como-funciona .kx-row-cta', fx: 'up' },
    { s: '#como-funciona .kx-promo', fx: 'up', strong: true },
    // personalización
    { s: '.kd-list', stagger: 90, kids: 'li', fx: 'left' },
    { s: '.kd-copy .btn', fx: 'pop', d: 120 },
    { s: '.kd-art', fx: 'img' },
    // asistente
    { s: '#asistente .kchat', fx: 'scale', d: 100 },
    // espacio propio
    { s: '.own-url', fx: 'drop', d: 160 },
    { s: '#espacio .kx-row-cta', fx: 'up', d: 120 },
    { s: '.own-tags', stagger: 70, kids: '.own-tag', fx: 'pop' },
    { s: '.own-mock', fx: 'right', d: 120 },
    // analytics
    { s: '.analytics-grid', stagger: 110, kids: '.stat-card', fx: 'card' },
    { s: '.chart-wrap', fx: 'scale' },
    { s: '#analytics .kx-row-cta', fx: 'up', d: 120 },
    // diferenciación
    { s: '.diff-col.before', fx: 'left' },
    { s: '.diff-arrow', fx: 'pop', d: 260 },
    { s: '.diff-col.after', fx: 'right', d: 140 },
    { s: '#diferencia .kx-promo', fx: 'up', strong: true },
    // soluciones
    { s: '.sol-row', stagger: 70, kids: '.sol-pill', fx: 'pop' },
    { s: '.kx-disc', fx: 'scale', d: 200 },
    // precios
    { s: '.kx-trial', fx: 'up', strong: true },
    { s: '.bill-wrap', fx: 'pop' },
    { s: '#pricingGrid', stagger: 120, kids: '.plan-card', fx: 'card', strong: true, live: true },
    { s: '.kx-compare-toggle', fx: 'up' },
    { s: '.kx-proup', fx: 'card' },
    { s: '.plan-note', fx: 'up' },
    // faq
    { s: '#faq .wrap > .faq-item', fx: 'up', each: 80 },
    { s: '#faqMore', stagger: 70, kids: '.faq-item', fx: 'up' },
    { s: '#faqToggle', fx: 'pop' },
    // cta final + kove + footer
    { s: '.kx-final .final-cta', fx: 'up', strong: true },
    { s: '#kove a', fx: 'card' },
    { s: '.footer-top', stagger: 80, kids: ':scope > *', fx: 'up' }
  ];

  var io, pendingHero = [], heroGo = false;

  function tag(el, fx, d, strong) {
    if (!el || el.hasAttribute('data-fx')) return;
    el.setAttribute('data-fx', fx);
    if (strong) el.setAttribute('data-strong', '');
    if (d) el.style.setProperty('--kx-delay', Math.round(d * .5) + 'ms');
    if (fx === 'words') splitWords(el);
  }
  function applyMap() {
    MAP.forEach(function (m) {
      $$(m.s).forEach(function (el, idx) {
        if (m.stagger) {
          if (el.__kxGroup) return;
          el.__kxGroup = { step: m.stagger, base: m.d || 0, kids: [], sel: m.kids, fx: m.fx };
          $$(m.kids, el).forEach(function (k) { tag(k, m.fx, 0, m.strong); el.__kxGroup.kids.push(k); });
          el.setAttribute('data-kx-group', '');
          if (m.fx === 'scatter') el.__kxGroup.kids.forEach(function (k, i) { var p = SCATTER[i % SCATTER.length]; k.style.setProperty('--kx-x', p[0] + 'px'); k.style.setProperty('--kx-y', p[1] + 'px'); });
          io.observe(el);
        } else {
          tag(el, m.fx, (m.d || 0) + (m.each ? idx * m.each : 0), m.strong);
          if (el.hasAttribute('data-fx')) io.observe(el);
        }
      });
    });
    // elementos marcados a mano en el HTML (hero, bloques nuevos)
    $$('[data-fx]').forEach(function (el) {
      if (el.hasAttribute('data-delay')) el.style.setProperty('--kx-delay', el.getAttribute('data-delay') + 'ms');
      if (el.getAttribute('data-fx') === 'words') splitWords(el);
      if (!el.__kxObs && !el.closest('[data-kx-group]')) io.observe(el);
      el.__kxObs = true;
    });
  }

  function show(el, delay) {
    if (el.classList.contains('kx-in')) return;
    if (delay != null) el.style.setProperty('--kx-delay', Math.round(delay * .5) + 'ms');
    el.classList.add('kx-in');
    var total = (parseInt(el.style.getPropertyValue('--kx-delay'), 10) || 0) + (el.getAttribute('data-fx') === 'words' ? 1000 : 900);
    setTimeout(function () { el.classList.add('kx-done'); }, total);
  }
  function trigger(el) {
    if (el.hasAttribute('data-kx-hero') && !heroGo) { pendingHero.push(el); return; }
    var g = el.__kxGroup;
    if (g) { g.kids.forEach(function (k, i) { show(k, g.base + (i % 9) * g.step); }); g.revealed = true; return; }
    show(el);
  }
  function flushHero() { heroGo = true; pendingHero.splice(0).forEach(trigger); }

  function initMotion() {
    if (!('IntersectionObserver' in window)) { root.classList.add('kx-failed'); return; }
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { io.unobserve(en.target); trigger(en.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -7% 0px' });
    applyMap();
    root.classList.add('kx-ready');
    // el hero espera a que la sesión se resuelva (el texto está oculto mientras tanto), máximo 900 ms
    var started = Date.now(), done = false;
    function go() { if (done) return; done = true; flushHero(); }
    if (!doc.body.classList.contains('auth-loading') || !root.classList.contains('kx-maybe')) go();
    else {
      new MutationObserver(function (m, ob) { if (!doc.body.classList.contains('auth-loading')) { ob.disconnect(); go(); } }).observe(doc.body, { attributes: true, attributeFilter: ['class'] });
      setTimeout(go, Math.max(0, 400 - (Date.now() - started)));
    }
    // tarjetas de planes que se vuelven a dibujar (Mensual/Anual)
    var grid = $('#pricingGrid');
    if (grid && grid.__kxGroup) {
      new MutationObserver(function () {
        var g = grid.__kxGroup, cards = $$('.plan-card', grid);
        cards.forEach(function (c) {
          if (c.__kxSeen) return; c.__kxSeen = true;
          if (g.revealed) c.classList.add('kx-swap'); else { tag(c, 'card', 0, true); }
        });
        g.kids = cards.filter(function (c) { return c.hasAttribute('data-fx'); });
      }).observe(grid, { childList: true });
      $$('.plan-card', grid).forEach(function (c) { c.__kxSeen = true; });
    }
  }

  /* ---------- Barra inferior: indicador animado + sección activa ---------- */
  function initBar() {
    var bar = $('.kbar'); if (!bar) return;
    var btns = $$('.kbar > .kbar-btn[data-spy]');
    var ind = doc.createElement('span'); ind.className = 'kbar-ind'; ind.setAttribute('aria-hidden', 'true');
    bar.insertBefore(ind, bar.firstChild);
    var active = null;
    function place() {
      if (!active) { ind.classList.remove('on'); return; }
      ind.style.setProperty('--kx-iw', active.offsetWidth + 'px'); ind.style.setProperty('--kx-ih', active.offsetHeight + 'px');
      ind.style.setProperty('--kx-ix', active.offsetLeft + 'px'); ind.style.setProperty('--kx-iy', active.offsetTop + 'px');
      ind.classList.add('on');
    }
    function setActive(b) {
      if (b === active) return;
      btns.forEach(function (x) { x.classList.toggle('kx-active', x === b); });
      active = b; place();
    }
    if ('ResizeObserver' in window) new ResizeObserver(place).observe(bar); else window.addEventListener('resize', place);
    var spy = [['#producto', btns[0]], ['#como-funciona', btns[1]], ['#precios', btns[2]], ['#faq', null]];
    if ('IntersectionObserver' in window) {
      var sio = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (!en.isIntersecting) return; var t = spy.filter(function (s) { return $(s[0]) === en.target; })[0]; if (t) setActive(t[1]); });
      }, { rootMargin: '-45% 0px -54% 0px' });
      spy.forEach(function (s) { var e = $(s[0]); if (e) sio.observe(e); });
    }
    // al pulsar, el indicador viaja de inmediato (sin esperar al scroll) y el icono hace su pulso (también en móvil)
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        setActive(b);
        if (!motion) return;
        b.classList.remove('kx-pulse'); void b.offsetWidth; b.classList.add('kx-pulse');
        setTimeout(function () { b.classList.remove('kx-pulse'); }, 700);
      });
    });
  }

  /* ---------- Parallax moderado al hacer scroll: un solo listener pasivo + rAF, solo elementos visibles ---------- */
  function initParallax() {
    if (!motion || !('IntersectionObserver' in window) || !matchMedia('(min-width:768px)').matches) return;
    // k < 0: la capa se queda ligeramente atrás respecto al scroll (sensación de profundidad). ref: elemento que mide la posición.
    var items = [
      { el: $('.hero-visual-real'), ref: $('.hero'), k: -0.07 },
      { el: $('.kd-art img'), ref: $('.kd-art'), k: -0.05 }
    ].filter(function (i) { return i.el && i.ref; });
    if (!items.length) return;
    var live = [], ticking = false;
    var vis = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        var it = items.filter(function (i) { return i.el === e.target; })[0];
        it.on = e.isIntersecting; live = items.filter(function (i) { return i.on; });
      });
      update();
    }, { rootMargin: '10% 0px' });
    items.forEach(function (i) { i.el.setAttribute('data-kx-par', ''); vis.observe(i.el); });
    function update() {
      ticking = false;
      var vh = window.innerHeight;
      live.forEach(function (i) {
        var r = i.ref.getBoundingClientRect();
        var d = (r.top + r.height / 2 - vh / 2) * i.k;                 // 0 con el elemento centrado
        i.el.style.setProperty('--kx-par', Math.max(-28, Math.min(28, d)).toFixed(1) + 'px');
      });
    }
    window.addEventListener('scroll', function () { if (!ticking && live.length) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  }

  /* ---------- Hero: parallax suave + CTAs magnéticos ---------- */
  function initPointer() {
    if (!motion || !fine) return;
    var hero = $('.hero'), vis = $('.hero-visual-real img');
    if (hero && vis) {
      var raf = 0, tx = 0, ty = 0;
      hero.addEventListener('pointermove', function (e) {
        var r = hero.getBoundingClientRect();
        tx = ((e.clientX - r.left) / r.width - .5) * -16; ty = ((e.clientY - r.top) / r.height - .5) * -10;
        if (!raf) raf = requestAnimationFrame(function () { raf = 0; vis.style.setProperty('--kx-px', tx.toFixed(1) + 'px'); vis.style.setProperty('--kx-py', ty.toFixed(1) + 'px'); });
      }, { passive: true });
      hero.addEventListener('pointerleave', function () { vis.style.setProperty('--kx-px', '0px'); vis.style.setProperty('--kx-py', '0px'); });
    }
    $$('.hero-ctas .btn-primary, .final-cta .btn-primary').forEach(function (b) {
      b.addEventListener('pointermove', function (e) {
        var r = b.getBoundingClientRect();
        b.style.translate = ((e.clientX - r.left - r.width / 2) * .1).toFixed(1) + 'px ' + ((e.clientY - r.top - r.height / 2) * .16).toFixed(1) + 'px';
      });
      b.addEventListener('pointerleave', function () { b.style.translate = ''; });
    });
    // tarjetas de planes: inclinación leve (delegado, sobrevive a los redibujados)
    var grid = $('#pricingGrid');
    if (grid) {
      grid.addEventListener('pointermove', function (e) {
        var c = e.target.closest('.plan-card'); if (!c) return;
        var r = c.getBoundingClientRect();
        c.style.setProperty('--kx-rx', ((((e.clientY - r.top) / r.height) - .5) * -3).toFixed(2) + 'deg');
        c.style.setProperty('--kx-ry', ((((e.clientX - r.left) / r.width) - .5) * 3).toFixed(2) + 'deg');
      }, { passive: true });
      grid.addEventListener('pointerout', function (e) { var c = e.target.closest('.plan-card'); if (c && !c.contains(e.relatedTarget)) { c.style.removeProperty('--kx-rx'); c.style.removeProperty('--kx-ry'); } });
    }
  }

  /* ---------- Planes: comparar, elegir y subir a Pro (datos de KARTTA_PLANS) ---------- */
  var interval = function () { var b = $('.bill-toggle button[aria-pressed="true"]'); return b ? b.getAttribute('data-int') : 'monthly'; };
  function planHref(code) { return '/checkout?plan=' + encodeURIComponent(code) + '&cycle=' + interval(); }
  function buildCompare() {
    var P = window.KARTTA_PLANS, host = $('#kxCompareBody'); if (!P || !host) return;
    var n = function (v) { return v === 'all' ? 'Todas' : new Intl.NumberFormat('es-CO').format(v); };
    var iv = interval();
    var head = '', price = '', foot = '', lim = { products: '', tables: '', templates: '', users: '', ai_credits: '' }, inc = '';
    P.order.forEach(function (c) {
      var pl = P.plans[c], pr = P.price(c, iv);
      head += '<th scope="col"' + (pl.recommended ? ' class="rec"' : '') + '>' + esc(pl.name) + '</th>';
      price += '<td><b>' + (pl.monthly === 0 ? '$0' : P.fmt(pr.main).replace(' COP', '')) + '</b> <small>COP / mes</small>' + (iv === 'annual' && pl.monthly ? '<br><small>Facturado ' + P.fmt(pr.total) + ' al año</small>' : '') + '</td>';
      Object.keys(lim).forEach(function (k) { lim[k] += '<td>' + n(pl.limits[k]) + '</td>'; });
      inc += '<td><ul>' + pl.features.map(function (f) { return '<li>✓ ' + esc(f) + '</li>'; }).join('') + (pl.locked || []).map(function (f) { return '<li class="no">— Sin ' + esc(f.toLowerCase()) + '</li>'; }).join('') + '</ul></td>';
      foot += '<td><a href="#" data-kx-plan="' + c + '" class="btn ' + (pl.recommended ? 'btn-primary' : 'btn-outline') + '">' + (pl.monthly === 0 ? 'Empezar gratis' : 'Elegir ' + esc(pl.name)) + '</a></td>';
    });
    host.innerHTML = '<table class="kx-table"><caption class="kx-sr">Comparación de planes de KARTTA</caption><thead><tr><th scope="col"><span class="kx-sr">Característica</span></th>' + head + '</tr></thead><tbody>' +
      '<tr><th scope="row">Precio</th>' + price + '</tr>' +
      '<tr><th scope="row">Productos</th>' + lim.products + '</tr><tr><th scope="row">Mesas</th>' + lim.tables + '</tr>' +
      '<tr><th scope="row">Plantillas</th>' + lim.templates + '</tr><tr><th scope="row">Usuarios</th>' + lim.users + '</tr>' +
      '<tr><th scope="row">Créditos de IA</th>' + lim.ai_credits + '</tr><tr><th scope="row">Incluye</th>' + inc + '</tr></tbody>' +
      '<tfoot><tr><th scope="row"><span class="kx-sr">Elegir plan</span></th>' + foot + '</tr></tfoot></table>';
    syncPlanLinks();
  }
  function buildProUp() {
    var P = window.KARTTA_PLANS, el = $('#kxProLimits'); if (!P || !el) return;
    var L = P.plans.pro.limits, n = function (v) { return new Intl.NumberFormat('es-CO').format(v); };
    el.textContent = 'Hasta ' + n(L.products) + ' productos, ' + n(L.tables) + ' mesas, ' + n(L.users) + ' usuarios y ' + n(L.ai_credits) + ' créditos de IA, con la mayor capacidad de personalización.';
  }
  function syncPlanLinks() {
    var logged = !!window.__karttaUser;
    $$('[data-kx-plan]').forEach(function (a) {
      var code = a.getAttribute('data-kx-plan');
      if (logged) a.setAttribute('href', code === 'free' ? 'dashboard.html' : planHref(code)); else a.setAttribute('href', '#');
    });
  }
  function initPlans() {
    var tgl = $('#kxCompareToggle'), box = $('#kxCompare');
    if (tgl && box) tgl.addEventListener('click', function () {
      var open = box.classList.toggle('open'); tgl.setAttribute('aria-expanded', String(open));
      tgl.querySelector('span').textContent = open ? 'Ocultar comparación' : 'Comparar planes';
      if (open) buildCompare();
    });
    $$('.bill-toggle button').forEach(function (b) { b.addEventListener('click', function () { setTimeout(function () { if (box && box.classList.contains('open')) buildCompare(); syncPlanLinks(); }, 0); }); });
    doc.addEventListener('click', function (e) {
      var a = e.target.closest('[data-kx-plan]'); if (!a) return;
      var code = a.getAttribute('data-kx-plan');
      try { sessionStorage.setItem('kartta_plan_choice', JSON.stringify({ plan: code, interval: interval(), t: Date.now() })); } catch (_) {}
      try { if (window.KarttaTrack) KarttaTrack.event('plan_select', { element: code }); } catch (_) {}
      if (window.__karttaUser) return;                           // con sesión: el href ya va al destino real
      e.preventDefault(); if (window.__karttaOpenAuth) window.__karttaOpenAuth('signup');
    });
    buildProUp();
  }

  /* ---------- Soluciones: tarjeta de descubrimiento ---------- */
  var SOL = {
    restaurantes: { n: 'restaurantes', t: 'Tu carta, tus mesas y tu cocina en un mismo sistema.', p: 'Cada mesa tiene su QR. Tus clientes ven la carta, piden desde el celular y el pedido llega directo a cocina y caja.' },
    cafeterias: { n: 'cafeterías', t: 'Una carta siempre al día y pedidos que llegan a quien los prepara.', p: 'Actualiza precios y productos cuando quieras. Tus clientes escanean, piden y siguen el estado de su pedido.' },
    bares: { n: 'bares', t: 'Pedidos por mesa y el total real del día, sin cuadrar a mano.', p: 'El QR de cada mesa lleva a tu carta. Los pedidos y los pagos quedan registrados como ventas en tu panel.' },
    pizzerias: { n: 'pizzerías', t: 'Menú con fotos, pedidos a cocina y estado en vivo para tu cliente.', p: 'Muestra tus productos con imagen, recibe los pedidos en la pantalla de cocina y avisa cuando estén listos.' },
    foodtrucks: { n: 'food trucks', t: 'Tu carta con enlace y QR para compartir donde estés.', p: 'Tu negocio tiene su propio espacio público con menú y marca, y los pedidos quedan organizados en un solo panel.' }
  };
  var ICON = {
    qr: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><path d="M14 14h3v3h-3zM19 19h2"/></svg>',
    fire: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3c1 2-1 3-1 5a2 2 0 0 0 4 0c1 2 2 3 2 5a5 5 0 0 1-10 0c0-3 2-4 5-10z"/></svg>',
    card: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>'
  };
  function initDiscovery() {
    var tabs = $$('#soluciones .sol-pill[data-sol]'), box = $('#kxDisc'); if (!tabs.length || !box) return;
    var copy = $('.kx-disc-copy', box), list = $('.kx-disc-list', box);
    function select(key, scroll) {
      var d = SOL[key]; if (!d) return;
      tabs.forEach(function (t) { var on = t.getAttribute('data-sol') === key; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; });
      $('h3', copy).textContent = 'KARTTA para ' + d.n;
      $('.kx-disc-lead', copy).textContent = d.t + ' ' + d.p;
      list.innerHTML = '<li>' + ICON.qr + '<div><b>Menú digital y QR por mesa</b><span>El cliente escanea, ve la carta y pide desde su celular.</span></div></li>' +
        '<li>' + ICON.fire + '<div><b>Pedidos en tiempo real</b><span>Llegan a cocina y a caja, con el estado visible para el cliente.</span></div></li>' +
        '<li>' + ICON.card + '<div><b>Pagos y ventas registradas</b><span>En línea, efectivo o transferencia, todo en tu panel.</span></div></li>';
      if (motion) { box.classList.remove('swap'); void box.offsetWidth; box.classList.add('swap'); }
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { select(t.getAttribute('data-sol')); });
      t.addEventListener('keydown', function (e) {
        var k = e.key; if (k !== 'ArrowRight' && k !== 'ArrowLeft') return;
        var n = tabs[(i + (k === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; n.focus(); n.click(); e.preventDefault();
      });
    });
    $$('a[data-sol]').forEach(function (a) { a.addEventListener('click', function () { select(a.getAttribute('data-sol')); }); });
    select('restaurantes');
    box.classList.remove('swap');
  }

  /* ---------- Sesión: la cinta y los bloques de prueba son para visitantes ---------- */
  function onAuth(u) {
    root.classList.toggle('kx-authed', !!u); root.classList.remove('kx-maybe');
    syncPlanLinks();
  }

  /* ---------- Arranque ---------- */
  function boot() {
    try {
      applyTrialDays(); buildRibbon(); initBar(); initPlans(); initDiscovery(); initPointer(); initParallax();
      if (motion) initMotion();
      syncPlanLinks();
      window.addEventListener('kartta:auth', function (e) { onAuth(e.detail && e.detail.user); });
      var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(buildRibbon, 250); });
    } catch (err) {
      root.classList.add('kx-failed');
      if (window.console) console.warn('[KARTTA] landing motion:', err);
    }
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})();
