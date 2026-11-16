/* KARTTA — Pantalla "no te vayas" cuando termina la prueba de KARTTA Pro.
 * API: KARTTA_TRIAL_END.open({ price, used, onClose, href })
 *   price  : precio mensual de KARTTA Pro en COP (número) — si no llega, no se muestra precio (nunca se inventa).
 *   used   : lista de ids de funciones que el restaurante usó en la prueba (ver FEATS); si va vacía se muestran todas.
 *   onClose: se llama cuando la persona cierra la pantalla para seguir con Free.
 *   href   : destino del botón (por defecto el flujo real de contratación: /checkout?plan=kartta&cycle=monthly).
 * Solo presenta información y lleva al checkout; los permisos los decide siempre el servidor. */
(function (w, d) {
  'use strict';
  var root = null, lastFocus = null, closeCb = null;

  var FEATS = {
    templates: { t: 'Plantillas Pro', s: 'Diseños profesionales', i: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>' },
    fonts: { t: 'Tipografías Premium', s: 'Títulos y textos a tu estilo', i: '<path d="M4 7V5h16v2M12 5v14M9 19h6"/>' },
    layout: { t: 'Diseño avanzado', s: 'Secciones, anuncio y pie', i: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 21V9"/>' },
    whatsapp: { t: 'WhatsApp Premium', s: 'Botón personalizado', i: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/>' },
    tools: { t: 'Herramientas del editor', s: 'Elementos, textos y degradados', i: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5M3 17l9 5 9-5" opacity=".6"/>' }
  };
  var ORDER = ['templates', 'fonts', 'layout', 'whatsapp', 'tools'];

  function css() {
    if (d.getElementById('ktCss')) return;
    var s = d.createElement('style'); s.id = 'ktCss';
    s.textContent =
      '#ktBack{position:fixed;inset:0;z-index:99998;background:rgba(10,10,10,.72);display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto;animation:ktFade .25s ease-out}' +
      '#ktBack[hidden]{display:none}@keyframes ktFade{from{opacity:0}to{opacity:1}}@keyframes ktRise{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:none}}' +
      '.kt{position:relative;width:100%;max-width:980px;margin:auto;display:grid;grid-template-columns:1.05fr .95fr;border-radius:28px;overflow:hidden;color:#fff;font-family:inherit;' +
        'background:linear-gradient(145deg,#262626,#151515);box-shadow:18px 18px 40px rgba(0,0,0,.55),-8px -8px 24px rgba(255,255,255,.05),inset 1px 1px 0 rgba(255,255,255,.08);animation:ktRise .4s cubic-bezier(.16,1,.3,1)}' +
      '.kt-l{padding:clamp(26px,4vw,48px);display:flex;flex-direction:column;justify-content:center;gap:16px}' +
      '.kt-eb{font-size:11.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#FF3145}' +
      '.kt h2{margin:0;font-size:clamp(24px,3.2vw,34px);line-height:1.12;font-weight:800;letter-spacing:-.02em}' +
      '.kt h2 .hl{background:#FF3145;color:#fff;padding:0 .2em;box-decoration-break:clone;-webkit-box-decoration-break:clone}' +
      '.kt p{margin:0;color:#BDBDBD;font-size:14.5px;line-height:1.65}' +
      '.kt-ul{list-style:none;margin:2px 0 0;padding:0;display:grid;gap:8px}' +
      '.kt-ul li{display:flex;gap:10px;align-items:flex-start;font-size:13.5px;color:#E4E4E4;line-height:1.45}' +
      '.kt-ul svg{flex:none;margin-top:2px;color:#FF3145;width:18px;height:18px}.kt-lock svg{width:15px;height:15px}' +
      '.kt-price{display:flex;align-items:baseline;gap:8px;color:#fff}.kt-price b{font-size:30px;font-weight:800;letter-spacing:-.02em}.kt-price span{font-size:13px;color:#9A9A9A}' +
      '.kt-cta{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:52px;padding:0 26px;border-radius:16px;background:#FF3145;color:#fff;font-weight:800;font-size:15.5px;text-decoration:none;border:0;cursor:pointer;' +
        'box-shadow:6px 6px 16px rgba(0,0,0,.45),-4px -4px 12px rgba(255,255,255,.05);transition:transform .2s cubic-bezier(.16,1,.3,1),filter .2s;align-self:flex-start}' +
      '.kt-cta:hover{transform:translateY(-2px);filter:brightness(1.06)}.kt-cta:active{transform:scale(.97)}' +
      '.kt-safe{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-radius:14px;background:#1B1B1B;box-shadow:inset 3px 3px 8px rgba(0,0,0,.5),inset -2px -2px 6px rgba(255,255,255,.04);font-size:12.5px;color:#BDBDBD;line-height:1.5}' +
      '.kt-safe svg{flex:none;color:#7DD3A0;margin-top:1px;width:20px;height:20px}.kt-safe span{flex:1;min-width:0}' +
      '.kt-r{position:relative;padding:clamp(22px,3vw,38px);background:linear-gradient(160deg,#1C1C1C,#101010);display:flex;flex-direction:column;justify-content:center;gap:12px;min-height:340px;overflow:hidden}' +
      '.kt-rt{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#8F8F8F;margin-bottom:2px}' +
      '.kt-stage{position:relative;display:grid;gap:10px}' +
      '.kt-chip{position:relative;display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:16px;background:linear-gradient(145deg,#2A2A2A,#1D1D1D);' +
        'box-shadow:6px 6px 14px rgba(0,0,0,.5),-4px -4px 10px rgba(255,255,255,.04),inset 1px 1px 0 rgba(255,255,255,.06);animation:ktRise .5s cubic-bezier(.16,1,.3,1) both}' +
      '.kt-chip:nth-child(odd){margin-right:clamp(0px,3vw,28px)}.kt-chip:nth-child(even){margin-left:clamp(0px,3vw,28px)}' +
      '.kt-ic{flex:none;width:40px;height:40px;border-radius:12px;display:grid;place-items:center;color:#fff;background:#151515;box-shadow:inset 3px 3px 7px rgba(0,0,0,.55),inset -2px -2px 5px rgba(255,255,255,.05)}' +
      '.kt-ic svg{width:20px;height:20px;opacity:.55}' +
      '.kt-tx{min-width:0;flex:1}.kt-tx b{display:block;font-size:13.5px;color:#C9C9C9;text-decoration:line-through;text-decoration-color:rgba(255,49,69,.7);text-decoration-thickness:2px}.kt-tx span{display:block;font-size:11.5px;color:#7C7C7C;margin-top:1px}' +
      '.kt-lock{flex:none;width:28px;height:28px;border-radius:9px;display:grid;place-items:center;background:#FF3145;color:#fff}' +
      '.kt-x{position:absolute;top:14px;right:14px;z-index:3;border:0;cursor:pointer;color:#BDBDBD;background:#1D1D1D;border-radius:12px;padding:8px 12px;font:700 12px/1 inherit;font-family:inherit;' +
        'box-shadow:4px 4px 10px rgba(0,0,0,.45),-3px -3px 8px rgba(255,255,255,.04);transition:color .2s,transform .2s}.kt-x:hover{color:#fff}.kt-x:active{transform:scale(.96)}' +
      '.kt a:focus-visible,.kt button:focus-visible{outline:2px solid #FF3145;outline-offset:3px}' +
      '@media (max-width:820px){.kt{grid-template-columns:1fr}.kt-r{min-height:0;order:2}.kt-l{padding-top:58px}.kt-cta{align-self:stretch}.kt-chip:nth-child(n){margin-left:0;margin-right:0}}' +
      '@media (prefers-reduced-motion:reduce){#ktBack,.kt,.kt-chip{animation:none}}';
    d.head.appendChild(s);
  }
  var svg = function (p, sw) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 1.9) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>'; };
  var CHECK = svg('<path d="M20 6L9 17l-5-5"/>', 2.6);
  var LOCK = svg('<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', 2.2);
  var SHIELD = svg('<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/>', 2);

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function money(n) { return '$' + Number(n).toLocaleString('es-CO'); }

  function build(o) {
    css();
    if (root) root.remove();
    var ids = (o.used || []).filter(function (k) { return FEATS[k]; });
    if (!ids.length) ids = ORDER.slice();
    var chips = ids.map(function (k, i) {
      var f = FEATS[k];
      return '<div class="kt-chip" style="animation-delay:' + (120 + i * 70) + 'ms"><div class="kt-ic">' + svg(f.i) + '</div><div class="kt-tx"><b>' + esc(f.t) + '</b><span>' + esc(f.s) + '</span></div><div class="kt-lock" title="Se bloquea en Free">' + LOCK + '</div></div>';
    }).join('');
    var price = Number(o.price) > 0 ? '<div class="kt-price"><b>' + money(o.price) + '</b><span>/ mes · KARTTA Pro</span></div>' : '';
    root = d.createElement('div'); root.id = 'ktBack'; root.hidden = true;
    root.innerHTML =
      '<div class="kt" role="dialog" aria-modal="true" aria-labelledby="ktT">' +
        '<button type="button" class="kt-x" id="ktX" aria-label="Cerrar y seguir con el plan Free">Seguir con Free ✕</button>' +
        '<div class="kt-l">' +
          '<span class="kt-eb">Tu prueba de KARTTA Pro terminó</span>' +
          '<h2 id="ktT">¡Hey! No queremos que <span class="hl">pierdas</span> todo lo que creaste.</h2>' +
          '<p>Tu prueba Pro ha terminado, pero tu menú sigue aquí. Recupera todas tus herramientas avanzadas y continúa personalizando tu restaurante sin límites.</p>' +
          '<ul class="kt-ul"><li>' + CHECK + 'Plantillas y diseño avanzado del menú</li><li>' + CHECK + 'Tipografías premium, anuncio y pie de página</li><li>' + CHECK + 'Botón de WhatsApp Premium y herramientas extra del editor</li></ul>' +
          price +
          '<a class="kt-cta" id="ktGo" href="' + esc(o.href || '/checkout?plan=kartta&cycle=monthly') + '">Volver a tener Pro →</a>' +
          '<div class="kt-safe">' + SHIELD + '<span>Tu diseño original sigue guardado. Si vuelves a Pro, lo recuperas exactamente como lo dejaste.</span></div>' +
        '</div>' +
        '<div class="kt-r"><div class="kt-rt">Lo que dejarás de disfrutar</div><div class="kt-stage">' + chips + '</div></div>' +
      '</div>';
    d.body.appendChild(root);
    root.addEventListener('click', function (e) { if (e.target === root) close(); });
    d.getElementById('ktX').addEventListener('click', close);
    return root;
  }
  function onKey(e) { if (e.key === 'Escape' && root && !root.hidden) close(); }
  function open(o) {
    o = o || {}; closeCb = typeof o.onClose === 'function' ? o.onClose : null;
    build(o); lastFocus = d.activeElement; root.hidden = false;
    d.addEventListener('keydown', onKey);
    var go = d.getElementById('ktGo'); if (go) go.focus();
  }
  function close() {
    if (!root || root.hidden) return;
    root.hidden = true; d.removeEventListener('keydown', onKey);
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
    if (closeCb) { try { closeCb(); } catch (e) {} closeCb = null; }
  }
  w.KARTTA_TRIAL_END = { open: open, close: close, FEATS: FEATS };
})(window, document);
