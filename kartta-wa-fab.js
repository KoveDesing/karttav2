/**
 * KARTTA — Botón flotante de WhatsApp del menú público.
 * El servidor entrega `restaurant.wa_button` (indicativo + número, solo dígitos) ÚNICAMENTE si el restaurante lo activó
 * y el número es válido. Aquí solo se vuelve a comprobar el formato y se dibuja el botón.
 * Enlace oficial: https://wa.me/<dígitos>  (sin "+", espacios, guiones ni paréntesis).
 * Se coloca solo: sube por encima de la barra inferior y del carrito para no taparlos.
 */
(function () {
  'use strict';
  var NUM = /^[1-9][0-9]{7,14}$/;
  var PATH = 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z';
  var el = null, preview = false, obs = null, bound = false, num0 = '', look = {};

  function css() {
    if (document.getElementById('waFabCss')) return;
    var s = document.createElement('style'); s.id = 'waFabCss';
    s.textContent =
      '.wa-fab{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:55;min-width:var(--wa-sz,60px);height:var(--wa-sz,60px);padding:0;box-sizing:border-box;border-radius:var(--wa-r,50%);background:var(--wa-bg,#25D366);color:var(--wa-ic,#fff);opacity:var(--wa-op,1);display:flex;align-items:center;justify-content:center;gap:8px;text-decoration:none;box-shadow:var(--wa-sh,0 8px 20px -6px rgba(0,0,0,.35),0 2px 6px rgba(0,0,0,.18));transition:transform .15s ease,box-shadow .15s ease;animation:waIn .35s ease both;-webkit-tap-highlight-color:transparent;}' +
      '.wa-fab svg{width:calc(var(--wa-sz,60px) * .53);height:calc(var(--wa-sz,60px) * .53);display:block;fill:var(--wa-ic,#fff);flex:none;}' +
      '.wa-fab .wa-t{display:none;font:700 14px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--wa-ic,#fff);white-space:nowrap;}' +
      '.wa-fab[data-v=pill]{padding:0 20px 0 16px;border-radius:var(--wa-r,999px);}' +
      '.wa-fab[data-v=pill] .wa-t{display:inline;}' +
      '.wa-fab[data-p=bl]{right:auto;left:16px;}' +
      '.wa-fab[data-p=bc]{right:auto;left:50%;margin-left:calc(var(--wa-sz,60px) / -2);}' +
      '.wa-fab[data-p=bc][data-v=pill]{margin-left:0;transform:translateX(-50%);}' +
      '.wa-fab:active{transform:scale(.94);}' +
      '.wa-fab:focus-visible{outline:3px solid #111;outline-offset:3px;}' +
      '@media (hover:hover){.wa-fab:hover{transform:translateY(-2px) scale(1.05);}.wa-fab[data-p=bc][data-v=pill]:hover{transform:translateX(-50%) translateY(-2px) scale(1.05);}}' +
      '@media (min-width:601px){.wa-fab{right:14px;bottom:14px;}.wa-fab[data-p=bl]{right:auto;left:14px;}.wa-fab[data-p=bc]{right:auto;}}' +
      'html.thumb .wa-fab,html.clean .wa-fab{display:none !important;}' +
      '@keyframes waIn{from{opacity:0;transform:scale(.5) translateY(10px);}to{opacity:var(--wa-op,1);transform:none;}}' +
      '@media (prefers-reduced-motion:reduce){.wa-fab{animation:none;transition:none;}}';
    document.head.appendChild(s);
  }

  function ensure() {
    if (el) return el;
    css();
    el = document.createElement('a'); el.className = 'wa-fab'; el.id = 'waFab';
    el.target = '_blank'; el.rel = 'noopener noreferrer';
    el.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' + PATH + '"/></svg><span class="wa-t"></span>';
    el.addEventListener('click', function (e) { if (preview) e.preventDefault(); });
    // Dentro de #phone: en computador el menú vive dentro del marco de teléfono y el botón queda en su esquina.
    (document.getElementById('phone') || document.body).appendChild(el);
    watch();
    return el;
  }

  // Sube por encima de la barra inferior y del carrito (lo que haya visible) con un margen de 12 px.
  function layout() {
    if (!el) return;
    var ph = document.getElementById('phone');
    var inFrame = ph && getComputedStyle(ph).display !== 'contents';
    var edge = inFrame ? ph.getBoundingClientRect().bottom : window.innerHeight;
    var top = Infinity;
    ['mnav', 'cartBar'].forEach(function (id) {
      var n = document.getElementById(id); if (!n) return;
      var cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return;
      var r = n.getBoundingClientRect(); if (r.height > 0 && r.top < top) top = r.top;
    });
    el.style.bottom = top === Infinity ? '' : Math.max(inFrame ? 14 : 16, edge - top + 12) + 'px';
  }

  function watch() {
    if (!bound) {
      bound = true;
      window.addEventListener('resize', layout);
      window.addEventListener('orientationchange', layout);
      if (window.visualViewport) window.visualViewport.addEventListener('resize', layout);
    }
    if ('MutationObserver' in window) {
      obs = new MutationObserver(function () { requestAnimationFrame(layout); });
      var c = document.getElementById('cartBar'); if (c) obs.observe(c, { attributes: true, attributeFilter: ['class', 'style'] });
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-nv', 'data-nf', 'style'] });
    }
    if ('ResizeObserver' in window) { var ro = new ResizeObserver(layout); ['mnav', 'cartBar'].forEach(function (id) { var n = document.getElementById(id); if (n) ro.observe(n); }); }
  }

  /** num: dígitos listos para wa.me (o null/vacío para ocultar). */
  function set(num, opts) {
    preview = !!(opts && opts.preview);
    num = num == null ? '' : String(num);
    if (!NUM.test(num)) { if (el) { el.remove(); el = null; if (obs) { obs.disconnect(); obs = null; } } return; }
    ensure();
    var nm = (document.getElementById('bizName') || {}).textContent || '';
    num0 = num; el.href = link();
    el.setAttribute('aria-label', nm && nm !== 'Menú' ? 'Escribir por WhatsApp a ' + nm : 'Escribir por WhatsApp');
    paint(); layout();
  }

  function link() { return 'https://wa.me/' + num0 + (look.msg ? '?text=' + encodeURIComponent(look.msg) : ''); }
  /* apariencia elegida en el editor (menu-design.js llama a style(); colores/tamaño/sombra llegan como variables CSS) */
  function paint() {
    if (!el) return;
    el.setAttribute('data-v', look.variant === 'pill' ? 'pill' : 'circle');
    if (look.pos === 'bl' || look.pos === 'bc') el.setAttribute('data-p', look.pos); else el.removeAttribute('data-p');
    var rr = getComputedStyle(document.documentElement).getPropertyValue('--wa-r').trim();
    if (look.variant === 'pill' && (!rr || rr === '50%')) el.style.setProperty('--wa-r', '999px'); else el.style.removeProperty('--wa-r');
    var t = el.querySelector('.wa-t'); if (t) t.textContent = look.label || 'Escríbenos';
    if (num0) el.href = link();
  }
  function style(w) { look = w && typeof w === 'object' ? w : {}; paint(); layout(); }

  window.KARTTA_WA = { set: set, style: style };
})();
