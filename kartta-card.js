/**
 * KARTTA — Render de la tarjeta de puntos (compartido por el panel y tarjeta.html).
 * Todo texto entra por textContent y los colores se validan: un diseño guardado nunca puede inyectar HTML/CSS.
 */
(function (root) {
  'use strict';
  var HEX = /^#[0-9a-fA-F]{6}$/;
  var DEFAULTS = { bg1: '#141414', bg2: '#2A2A2A', text: '#FFFFFF', accent: '#FF3145', style: 'gradient', title: '', subtitle: '' };
  var STYLES = ['gradient', 'solid', 'dots', 'lines'];
  function design(d) {
    d = d || {}; var o = {};
    ['bg1', 'bg2', 'text', 'accent'].forEach(function (k) { o[k] = HEX.test(d[k] || '') ? d[k] : DEFAULTS[k]; });
    o.style = STYLES.indexOf(d.style) >= 0 ? d.style : DEFAULTS.style;
    o.title = String(d.title || '').slice(0, 30); o.subtitle = String(d.subtitle || '').slice(0, 40);
    return o;
  }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function background(d) {
    if (d.style === 'solid') return d.bg1;
    if (d.style === 'dots') return 'radial-gradient(circle at 1px 1px, ' + d.accent + '33 1.5px, transparent 1.6px) 0 0/16px 16px, linear-gradient(135deg,' + d.bg1 + ',' + d.bg2 + ')';
    if (d.style === 'lines') return 'repeating-linear-gradient(115deg, transparent 0 14px, ' + d.accent + '1f 14px 16px), linear-gradient(135deg,' + d.bg1 + ',' + d.bg2 + ')';
    return 'linear-gradient(135deg,' + d.bg1 + ',' + d.bg2 + ')';
  }
  /* opts: {design, programName, restaurantName, logoUrl, customerName, last4, balance, nextCost} */
  function render(host, o) {
    o = o || {}; var d = design(o.design);
    host.innerHTML = ''; host.classList.add('kcard-host');
    var c = el('div', 'kcard'); c.style.cssText = 'position:relative;aspect-ratio:1.586;width:100%;max-width:380px;border-radius:22px;padding:20px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;box-shadow:0 18px 40px -18px rgba(0,0,0,.6);font-family:Inter,system-ui,sans-serif;color:' + d.text + ';background:' + background(d);
    var top = el('div'); top.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-start;gap:10px';
    var brand = el('div'); brand.style.cssText = 'display:flex;align-items:center;gap:10px;min-width:0';
    if (o.logoUrl) { var im = el('img'); im.alt = ''; im.src = o.logoUrl; im.crossOrigin = 'anonymous'; im.style.cssText = 'width:36px;height:36px;border-radius:10px;object-fit:cover;background:#ffffff22;flex:none'; im.onerror = function () { im.remove(); }; brand.appendChild(im); }
    var nm = el('div', null, o.restaurantName || 'Mi restaurante'); nm.style.cssText = 'font-weight:800;font-size:15px;line-height:1.2;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical'; brand.appendChild(nm);
    var tag = el('div', null, d.title || o.programName || 'Puntos'); tag.style.cssText = 'font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:' + d.accent + ';text-align:right;flex:none;max-width:45%';
    top.appendChild(brand); top.appendChild(tag);
    var mid = el('div'); mid.style.cssText = 'display:flex;align-items:baseline;gap:8px';
    var bal = el('div', 'kcard-bal', String(Number(o.balance || 0).toLocaleString('es-CO'))); bal.style.cssText = 'font-size:clamp(38px,12vw,54px);font-weight:800;line-height:1;font-variant-numeric:tabular-nums';
    var unit = el('div', null, d.subtitle || 'puntos'); unit.style.cssText = 'font-size:13px;font-weight:700;opacity:.8';
    mid.appendChild(bal); mid.appendChild(unit);
    var bot = el('div'); bot.style.cssText = 'display:grid;gap:8px';
    if (o.nextCost > 0) {
      var pct = Math.min(100, Math.round((Number(o.balance || 0) / o.nextCost) * 100));
      var bar = el('div'); bar.style.cssText = 'height:6px;border-radius:99px;background:' + d.text + '26;overflow:hidden'; var fill = el('i'); fill.style.cssText = 'display:block;height:100%;width:' + pct + '%;background:' + d.accent + ';border-radius:99px'; bar.appendChild(fill);
      var hint = el('div', null, pct >= 100 ? '¡Ya puedes canjear un premio!' : 'Te faltan ' + Math.max(0, o.nextCost - Number(o.balance || 0)).toLocaleString('es-CO') + ' para tu próximo premio'); hint.style.cssText = 'font-size:11.5px;font-weight:600;opacity:.85';
      bot.appendChild(bar); bot.appendChild(hint);
    }
    var who = el('div'); who.style.cssText = 'display:flex;justify-content:space-between;font-size:12px;font-weight:700;opacity:.9';
    who.appendChild(el('span', null, o.customerName || 'Cliente')); who.appendChild(el('span', null, o.last4 ? '•••• ' + o.last4 : ''));
    bot.appendChild(who);
    c.appendChild(top); c.appendChild(mid); c.appendChild(bot); host.appendChild(c);
    return c;
  }
  root.KARTTA_CARD = { render: render, design: design, DEFAULTS: DEFAULTS, STYLES: STYLES };
})(window);
