/* KARTTA — ventana de mejora de plan (upsell).
 * API: KARTTA_UPSELL.open({ plan, feature, title, text, href })
 * Solo informa y lleva al checkout/precios; el plan y los límites los decide siempre el servidor. */
(function (w, d) {
  'use strict';
  var root = null, lastFocus = null;
  function css() {
    if (d.getElementById('kuCss')) return;
    var s = d.createElement('style'); s.id = 'kuCss';
    s.textContent = '#kuBack{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px}' +
      '#kuBack[hidden]{display:none}.ku{background:#141414;color:#fff;border:1px solid #2a2a2a;border-radius:20px;max-width:380px;width:100%;padding:26px 22px;text-align:center;font-family:inherit;box-shadow:0 20px 60px rgba(0,0,0,.5)}' +
      '.ku .kuI{width:46px;height:46px;border-radius:14px;background:#FF3145;display:flex;align-items:center;justify-content:center;margin:0 auto 14px}' +
      '.ku h3{margin:0 0 8px;font-size:19px}.ku p{margin:0 0 18px;color:#b7b7b7;font-size:14px;line-height:1.55}' +
      '.ku a,.ku button{display:block;width:100%;box-sizing:border-box;border-radius:12px;padding:12px 14px;font-size:14.5px;font-weight:700;cursor:pointer;text-decoration:none;font-family:inherit}' +
      '.ku a{background:#FF3145;color:#fff;border:0;margin-bottom:8px}.ku button{background:transparent;color:#b7b7b7;border:1px solid #2a2a2a}';
    d.head.appendChild(s);
  }
  function build() {
    if (root) return root;
    css();
    root = d.createElement('div'); root.id = 'kuBack'; root.hidden = true;
    root.innerHTML = '<div class="ku" role="dialog" aria-modal="true" aria-labelledby="kuT"><div class="kuI"><svg width="22" height="22" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M3 7l4.5 4L12 4l4.5 7L21 7l-1.5 11h-15zM5 20h14v2H5z"/></svg></div>' +
      '<h3 id="kuT"></h3><p id="kuP"></p><a id="kuGo" href="/checkout">Ver planes</a><button type="button" id="kuNo">Ahora no</button></div>';
    d.body.appendChild(root);
    root.addEventListener('click', function (e) { if (e.target === root) close(); });
    d.getElementById('kuNo').addEventListener('click', close);
    d.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !root.hidden) close(); });
    return root;
  }
  function close() { if (!root) return; root.hidden = true; if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} } }
  function open(o) {
    o = o || {}; build();
    var plan = o.plan || 'KARTTA Pro';
    d.getElementById('kuT').textContent = o.title || ('Disponible en ' + plan);
    d.getElementById('kuP').textContent = o.text || ((o.feature ? o.feature + ' está incluida en ' : 'Esta herramienta está incluida en ') + plan + '. Mejora tu plan para usarla.');
    var a = d.getElementById('kuGo'); a.setAttribute('href', o.href || '/checkout');
    lastFocus = d.activeElement; root.hidden = false; a.focus();
  }
  w.KARTTA_UPSELL = { open: open, close: close };
})(window, document);
