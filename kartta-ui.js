/* KARTTA UI — comportamiento del rediseño (solo presentación, sin tocar lógica de negocio).
   Sin librerías. Todo respeta prefers-reduced-motion. Si algo falla, la página sigue igual. */
(function () {
  'use strict';
  var d = document, root = d.documentElement;
  var kind = root.getAttribute('data-kui') || '';
  var RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var FINE = window.matchMedia && matchMedia('(hover:hover) and (pointer:fine)').matches;
  function $$(s, c) { return Array.prototype.slice.call((c || d).querySelectorAll(s)); }
  function safe(fn) { try { fn(); } catch (e) { /* nunca romper la página */ } }

  /* 1. Pantalla de carga tipo app: primera visita de la sesión, ~1.3 s, sale con wipe */
  function loader() {
    if (RM || (kind !== 'landing' && kind !== 'dash')) return;
    var seen = false;
    try { seen = sessionStorage.getItem('k_ui_loader') === '1'; sessionStorage.setItem('k_ui_loader', '1'); } catch (e) {}
    if (seen) return;
    var el = d.createElement('div');
    el.className = 'k-loader'; el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<div class="k-loader__logo k-logo">Kar<b>tt</b>a</div><div class="k-loader__bar"></div>';
    d.body.appendChild(el);
    setTimeout(function () { el.classList.add('is-done'); }, 1300);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 2300);
  }

  /* 2. Reveal al entrar en vista + titulares palabra por palabra */
  function reveal() {
    var els = $$('.k-reveal, .k-words, .k-show__phones');
    $$('.k-words').forEach(function (h) {
      if (h.getAttribute('data-split')) return;
      h.setAttribute('data-split', '1');
      var i = 0;
      h.innerHTML = h.textContent.trim().split(/\s+/).map(function (w) {
        return '<span class="k-w" style="--i:' + (i++) + '">' + w.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</span>';
      }).join(' ');
    });
    if (!('IntersectionObserver' in window) || RM) { els.forEach(function (e) { e.classList.add('is-in', 'k-in'); }); return; }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-in', 'k-in'); io.unobserve(e.target); countUp(e.target); }
      });
    }, { threshold: 0.18 });
    els.forEach(function (e) { io.observe(e); });
  }

  /* 3. Contadores [data-k-count] */
  function countUp(scope) {
    $$('[data-k-count]', scope).forEach(function (n) {
      var to = parseFloat(n.getAttribute('data-k-count')) || 0, pre = n.getAttribute('data-k-pre') || '';
      if (RM) { n.textContent = pre + to.toLocaleString('es-CO'); return; }
      var t0 = null, dur = 1400;
      function step(t) {
        if (t0 === null) t0 = t;
        var p = Math.min((t - t0) / dur, 1), e = 1 - Math.pow(1 - p, 3);
        n.textContent = pre + Math.round(to * e).toLocaleString('es-CO');
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }

  /* 4. Dock con burbuja deslizante (dashboard #tabbar y landing .kbar) */
  function dock(host, itemSel, activeSel, bubbleClass) {
    if (!host || host.getAttribute('data-k-dock')) return;
    host.setAttribute('data-k-dock', '1');
    var b = d.createElement('span'); b.className = 'k-dock-bubble'; b.setAttribute('aria-hidden', 'true');
    host.insertBefore(b, host.firstChild);
    function place() {
      var a = host.querySelector(activeSel);
      if (!a || a.offsetWidth === 0) { b.style.opacity = '0'; host.classList.remove('has-bubble'); return; }
      var hr = host.getBoundingClientRect(), ar = a.getBoundingClientRect();
      b.style.setProperty('--k-bx', (ar.left - hr.left) + 'px');
      b.style.setProperty('--k-bw', ar.width + 'px');
      b.style.top = (ar.top - hr.top) + 'px';
      b.style.height = ar.height + 'px';
      b.style.opacity = '1'; host.classList.add('has-bubble');
    }
    var raf; function sched() { cancelAnimationFrame(raf); raf = requestAnimationFrame(place); }
    if ('MutationObserver' in window) {
      new MutationObserver(sched).observe(host, { attributes: true, subtree: true, attributeFilter: ['class', 'aria-current'] });
    }
    window.addEventListener('resize', sched);
    window.addEventListener('load', sched);
    sched(); setTimeout(sched, 400);
  }

  /* 5. Botones principales con atracción magnética leve (solo escritorio con ratón) */
  function magnetic() {
    if (RM || !FINE) return;
    d.addEventListener('pointermove', function (e) {
      var t = e.target && e.target.closest && e.target.closest('.btn-primary, .btn-accent, .k-btn, .kbar-cta');
      $$('[data-k-mag]').forEach(function (m) { if (m !== t) { m.style.translate = ''; m.removeAttribute('data-k-mag'); } });
      if (!t || t.disabled) return;
      var r = t.getBoundingClientRect(), x = (e.clientX - (r.left + r.width / 2)) / r.width, y = (e.clientY - (r.top + r.height / 2)) / r.height;
      t.setAttribute('data-k-mag', '1');
      t.style.translate = (x * 8).toFixed(1) + 'px ' + (y * 6).toFixed(1) + 'px';
    }, { passive: true });
  }

  /* 6. Celulares flotantes: parallax con cursor y scroll */
  function phones() {
    var ps = $$('.k-show__phones .k-phone');
    if (!ps.length || RM) return;
    var wrap = ps[0].parentNode, mx = 0, my = 0, sy = 0, raf;
    function paint() {
      raf = 0;
      ps.forEach(function (p, i) {
        var depth = (i === 1 ? 1 : 0.55);
        p.style.setProperty('--k-px', (mx * 14 * depth).toFixed(1) + 'px');
        p.style.setProperty('--k-py', (my * 10 * depth + sy * 26 * (i - 1) * 0.4).toFixed(1) + 'px');
      });
    }
    function sched() { if (!raf) raf = requestAnimationFrame(paint); }
    if (FINE) wrap.addEventListener('pointermove', function (e) {
      var r = wrap.getBoundingClientRect(); mx = (e.clientX - r.left) / r.width - .5; my = (e.clientY - r.top) / r.height - .5; sched();
    }, { passive: true });
    window.addEventListener('scroll', function () {
      var r = wrap.getBoundingClientRect(); sy = Math.max(-1, Math.min(1, (r.top + r.height / 2 - innerHeight / 2) / innerHeight)); sched();
    }, { passive: true });
  }

  /* 7. Carrusel "Rise": marca la card más cercana al centro */
  function rise() {
    $$('.k-rise').forEach(function (r) {
      var kids = Array.prototype.slice.call(r.children);
      function mark() {
        var c = r.getBoundingClientRect(), mid = c.left + c.width / 2, best = null, bd = 1e9;
        kids.forEach(function (k) { var b = k.getBoundingClientRect(), dd = Math.abs(b.left + b.width / 2 - mid); if (dd < bd) { bd = dd; best = k; } });
        kids.forEach(function (k) { k.classList.toggle('is-active', k === best); });
      }
      var raf; r.addEventListener('scroll', function () { cancelAnimationFrame(raf); raf = requestAnimationFrame(mark); }, { passive: true });
      window.addEventListener('resize', mark); mark();
      // arrastre con ratón + inercia sencilla
      if (!FINE) return;
      var down = false, sx = 0, sl = 0, v = 0, last = 0, lt = 0;
      r.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') return; down = true; sx = e.clientX; sl = r.scrollLeft; r.style.scrollSnapType = 'none'; r.style.cursor = 'grabbing'; last = e.clientX; lt = e.timeStamp; });
      window.addEventListener('pointermove', function (e) {
        if (!down) return; r.scrollLeft = sl - (e.clientX - sx);
        var dt = e.timeStamp - lt; if (dt > 0) v = (e.clientX - last) / dt; last = e.clientX; lt = e.timeStamp;
      });
      window.addEventListener('pointerup', function () {
        if (!down) return; down = false; r.style.cursor = '';
        var target = r.scrollLeft - v * 260;
        r.scrollTo({ left: target, behavior: RM ? 'auto' : 'smooth' });
        setTimeout(function () { r.style.scrollSnapType = ''; }, 500);
      });
    });
  }

  /* 8. Isla negra expandible */
  function island() {
    $$('.k-island[data-k-toggle]').forEach(function (el) {
      el.addEventListener('click', function (e) { if (e.target.closest('a')) return; el.classList.toggle('is-open'); });
    });
  }

  /* 9. Bottom sheet y modales del dashboard en celular: arrastrar hacia abajo para cerrar */
  function sheets() {
    function bind(sheet, closer) {
      var y0 = 0, dy = 0, drag = false;
      sheet.addEventListener('touchstart', function (e) {
        var r = sheet.getBoundingClientRect(), t = e.touches[0];
        if (innerWidth > 900 || t.clientY - r.top > 44 || sheet.scrollTop > 0) return;
        drag = true; y0 = t.clientY; dy = 0; sheet.classList.add('is-dragging'); sheet.style.transition = 'none';
      }, { passive: true });
      sheet.addEventListener('touchmove', function (e) {
        if (!drag) return; dy = Math.max(0, e.touches[0].clientY - y0); sheet.style.transform = 'translateY(' + dy + 'px)';
      }, { passive: true });
      sheet.addEventListener('touchend', function () {
        if (!drag) return; drag = false; sheet.classList.remove('is-dragging'); sheet.style.transition = ''; sheet.style.transform = '';
        if (dy > 90) closer();
      });
    }
    $$('.modal-bg .modal').forEach(function (m) {
      bind(m, function () { var bg = m.closest('.modal-bg'); if (bg) bg.classList.remove('show'); });
    });
    $$('.k-sheet').forEach(function (s) {
      bind(s, function () { s.classList.remove('is-open'); var sc = d.querySelector('.k-sheet-scrim'); if (sc) sc.classList.remove('is-open'); });
    });
  }


  /* 10. Hero: celular animado que explica KARTTA (motion graphics, sin video) */
  function heroPhone() {
    var h = d.getElementById('kHero'); if (!h) return;
    var scs = $$('.k-sc', h), steps = $$('.k-hero__steps button', h), cap = h.querySelector('.k-hero__cap');
    var slots = { tl: h.querySelector('.k-hcard--tl'), tr: h.querySelector('.k-hcard--tr'), bl: h.querySelector('.k-hcard--bl'), br: h.querySelector('.k-hcard--br') };
    var IC = {
      qr: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 14v7h-3"/>',
      menu: '<path d="M4 6h16M4 12h16M4 18h10"/>',
      edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
      bag: '<path d="M6 2l-2 5v13a2 2 0 002 2h12a2 2 0 002-2V7l-2-5zM4 7h16M16 11a4 4 0 01-8 0"/>',
      card: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20"/>',
      bell: '<path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0"/>',
      table: '<path d="M3 9h18M5 9v11M19 9v11M7 5h10l2 4H5z"/>',
      check: '<path d="M20 6L9 17l-5-5"/>',
      chart: '<path d="M3 3v18h18M7 14l4-4 3 3 5-6"/>',
      users: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M23 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8"/>',
      gift: '<path d="M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 110-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 100-5C13 2 12 7 12 7z"/>'
    };
    var S = [
      { ms: 5000, t: 'Tu cliente escanea y explora', s: 'Menú digital con QR por mesa: categorías, fotos y precios siempre al día.',
        c: { tl: ['qr', 'Mesa 4 escaneó el QR', 'Menú digital|Hace 1 min'], br: ['menu', 'Menú siempre al día', 'Precios y fotos|Cambios en vivo'] } },
      { ms: 5200, t: 'Personaliza cada producto', s: 'Extras, punto de cocción y notas antes de agregar al pedido.',
        c: { tr: ['edit', 'Personalización', 'Extras y notas|Por cada producto'], bl: ['gift', 'Más por pedido', 'Sugiere adicionales|Al cliente'] } },
      { ms: 5000, t: 'Carrito y pedido en un toque', s: 'Resumen claro, método de pago y envío directo a cocina.',
        c: { tl: ['bag', 'Tu pedido', 'Mesa 4 • 2 productos|Total $ 34.400'], br: ['card', 'Pago en línea', '$ 34.400 • Nequi|Listo para cobrar'] } },
      { ms: 5000, t: 'El pedido llega a tu panel', s: 'Lo ves en tiempo real y cambias su estado: nuevo, en preparación, listo.',
        c: { tl: ['bell', 'Nuevo pedido', 'Mesa 4 • Hamburguesa|Hace 2 min'], bl: ['card', 'Pago recibido', '$ 34.400 • Nequi|Hace 1 min'], tr: ['table', 'Mesa 4', 'En preparación|Hace 5 min'], br: ['check', 'Pedido listo', 'Mesa 7 • 3 productos|Hace 12 min'] } },
      { ms: 4800, t: 'Dashboard con tus números', s: 'Ventas, pedidos, mesas y clientes en un solo lugar.',
        c: { tl: ['chart', 'Ventas de hoy', '$ 1.284.500|▲ 12% vs ayer'], tr: ['table', 'Mesas activas', '12 con QR|Pedidos en vivo'], br: ['users', 'Clientes frecuentes', 'Tarjeta de puntos|Premios y canjes'] } }
    ];
    var i = -1, timer = null, visible = true;
    function card(el, v) {
      if (!el) return;
      if (!v) { el.classList.add('off'); return; }
      el.classList.remove('off');
      el.innerHTML = '<span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + IC[v[0]] + '</svg></span><span class="tx"><b>' + v[1] + '</b><small>' + v[2].replace('|', '<br>') + '</small></span><i class="chev"></i>';
      el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    }
    function counters(sc) {
      $$('[data-c]', sc).forEach(function (n) {
        var to = parseFloat(n.getAttribute('data-c')), t0 = null;
        if (RM) { n.textContent = '$ ' + to.toLocaleString('es-CO'); return; }
        function st(t) { if (t0 === null) t0 = t; var p = Math.min((t - t0 - 300) / 1500, 1); if (p < 0) p = 0; var e = 1 - Math.pow(1 - p, 3); n.textContent = '$ ' + Math.round(to * e).toLocaleString('es-CO'); if (p < 1) requestAnimationFrame(st); }
        requestAnimationFrame(st);
      });
    }
    function show(n) {
      i = n;
      scs.forEach(function (s) { s.classList.remove('on'); });
      void h.offsetWidth;
      scs[n].classList.add('on'); counters(scs[n]);
      steps.forEach(function (b, k) {
        b.classList.toggle('done', k < n); b.classList.remove('on');
        if (k === n) { b.style.setProperty('--dur', S[n].ms + 'ms'); void b.offsetWidth; b.classList.add('on'); b.setAttribute('aria-current', 'step'); } else b.removeAttribute('aria-current');
      });
      cap.innerHTML = '<b>' + S[n].t + '</b><span>' + S[n].s + '</span>';
      ['tl', 'tr', 'bl', 'br'].forEach(function (k) { card(slots[k], S[n].c[k]); });
    }
    function loop() { clearTimeout(timer); if (RM || !visible) return; timer = setTimeout(function () { show((i + 1) % S.length); loop(); }, S[i].ms); }
    steps.forEach(function (b, k) { b.addEventListener('click', function () { show(k); loop(); }); });
    show(0);
    if (RM) return;
    loop();
    if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; if (visible) { show(i); loop(); } else clearTimeout(timer); }, { threshold: 0.15 }).observe(h);
    d.addEventListener('visibilitychange', function () { if (d.hidden) { visible = false; clearTimeout(timer); } else { visible = true; show(i); loop(); } });
  }

  function init() {
    safe(loader); safe(heroPhone); safe(reveal); safe(magnetic); safe(phones); safe(rise); safe(island); safe(sheets);
    safe(function () { dock(d.getElementById('tabbar'), 'button', 'button.active'); });
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init); else init();
})();
