/**
 * KARTTA — Render de la tarjeta de puntos (compartido por el panel, el editor y tarjeta.html).
 * Todo texto entra por textContent y los colores/opciones se validan contra listas cerradas:
 * un diseño guardado nunca puede inyectar HTML ni CSS. Es una tarjeta de MEMBRESÍA: no simula un medio de pago.
 */
(function (root) {
  'use strict';
  var HEX = /^#[0-9a-fA-F]{6}$/;
  var STYLES = ['gradient', 'solid', 'dots', 'lines', 'grid', 'diagonal', 'waves', 'rings'];
  var FONTS = { sans: 'Inter,system-ui,sans-serif', serif: 'Georgia,"Times New Roman",serif', rounded: '"Trebuchet MS","Segoe UI",system-ui,sans-serif', mono: 'ui-monospace,"SF Mono",Menlo,Consolas,monospace', display: '"Mr Dafoe","Brush Script MT",cursive' };
  var SIZES = { s: 0.9, m: 1, l: 1.12 };
  var ICONS = { none: '', star: '★', crown: '♛', heart: '♥', coffee: '☕', flame: '🔥', gem: '◆', leaf: '❦' };
  var DEFAULTS = { bg1: '#141414', bg2: '#2A2A2A', text: '#FFFFFF', accent: '#FF3145', sec: '', pts: '', bar: '', style: 'gradient', template: 'kartta', font: 'sans', size: 'm', weight: '800', align: 'left', icon: 'none', angle: 135, show_logo: true,
    title: '', subtitle: '', membership: '', points_label: '', welcome: '', reward_msg: '', custom: '' };
  /* Plantillas: solo rellenan los campos del diseño; el dueño puede cambiarlos después. */
  var TEMPLATES = {
    kartta:  { label: 'KARTTA', bg1: '#141414', bg2: '#2A2A2A', text: '#FFFFFF', accent: '#FF3145', style: 'gradient', font: 'sans', weight: '800', align: 'left', icon: 'none', angle: 135 },
    minimal: { label: 'Minimalista', bg1: '#FFFFFF', bg2: '#F1F1EE', text: '#111111', accent: '#111111', style: 'solid', font: 'sans', weight: '700', align: 'left', icon: 'none', angle: 135 },
    premium: { label: 'Premium', bg1: '#0B0B0B', bg2: '#1C1A14', text: '#F5E9C8', accent: '#D4AF37', style: 'lines', font: 'serif', weight: '700', align: 'left', icon: 'crown', angle: 160 },
    modern:  { label: 'Moderna', bg1: '#1D2B64', bg2: '#0F172A', text: '#FFFFFF', accent: '#7DD3FC', style: 'grid', font: 'rounded', weight: '800', align: 'left', icon: 'star', angle: 120 },
    elegant: { label: 'Elegante', bg1: '#2B1B26', bg2: '#4A2C3F', text: '#FBEFF3', accent: '#F4B6C8', style: 'waves', font: 'serif', weight: '500', align: 'center', icon: 'heart', angle: 145 },
    light:   { label: 'Clara', bg1: '#FFF7F0', bg2: '#FFE4D2', text: '#3A2418', accent: '#E8553A', style: 'dots', font: 'rounded', weight: '700', align: 'left', icon: 'coffee', angle: 135 },
    cafe:    { label: 'Café', bg1: '#3B2418', bg2: '#6B4630', text: '#FFF3E6', accent: '#F2B66D', style: 'diagonal', font: 'serif', weight: '700', align: 'left', icon: 'coffee', angle: 150 },
    neon:    { label: 'Contraste', bg1: '#050505', bg2: '#101010', text: '#FFFFFF', accent: '#C6FF3D', style: 'rings', font: 'mono', weight: '800', align: 'left', icon: 'flame', angle: 135 }
  };
  function txt(v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').slice(0, n); }
  function design(d) {
    d = d || {}; var o = {};
    ['bg1', 'bg2', 'text', 'accent'].forEach(function (k) { o[k] = HEX.test(d[k] || '') ? d[k] : DEFAULTS[k]; });
    ['sec', 'pts', 'bar'].forEach(function (k) { o[k] = HEX.test(d[k] || '') ? d[k] : ''; });
    o.style = STYLES.indexOf(d.style) >= 0 ? d.style : DEFAULTS.style;
    o.template = TEMPLATES[d.template] ? d.template : 'kartta';
    o.font = FONTS[d.font] ? d.font : 'sans'; o.size = SIZES[d.size] ? d.size : 'm';
    o.weight = ['500', '700', '800'].indexOf(String(d.weight)) >= 0 ? String(d.weight) : '800';
    o.align = d.align === 'center' ? 'center' : 'left';
    o.icon = ICONS.hasOwnProperty(d.icon) ? d.icon : 'none';
    var a = Number(d.angle); o.angle = isFinite(a) ? Math.max(0, Math.min(360, Math.round(a))) : 135;
    o.show_logo = d.show_logo !== false;
    o.title = txt(d.title, 30); o.subtitle = txt(d.subtitle, 40); o.membership = txt(d.membership, 30); o.points_label = txt(d.points_label, 30);
    o.welcome = txt(d.welcome, 80); o.reward_msg = txt(d.reward_msg, 80); o.custom = txt(d.custom, 80);
    return o;
  }
  function el(tag, cls, t) { var e = document.createElement(tag); if (cls) e.className = cls; if (t != null) e.textContent = t; return e; }
  function wavesUri(color) { var c = encodeURIComponent(color); return 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'120\' height=\'24\' viewBox=\'0 0 120 24\'%3E%3Cpath d=\'M0 12 Q15 0 30 12 T60 12 T90 12 T120 12\' fill=\'none\' stroke=\'' + c + '\' stroke-opacity=\'.22\' stroke-width=\'1.5\'/%3E%3C/svg%3E")'; }
  function background(d) {
    var grad = 'linear-gradient(' + d.angle + 'deg,' + d.bg1 + ',' + d.bg2 + ')';
    if (d.style === 'solid') return d.bg1;
    if (d.style === 'dots') return 'radial-gradient(circle at 1px 1px, ' + d.accent + '33 1.5px, transparent 1.6px) 0 0/16px 16px, ' + grad;
    if (d.style === 'lines') return 'repeating-linear-gradient(115deg, transparent 0 14px, ' + d.accent + '1f 14px 16px), ' + grad;
    if (d.style === 'grid') return 'linear-gradient(' + d.accent + '1a 1px, transparent 1px) 0 0/22px 22px, linear-gradient(90deg, ' + d.accent + '1a 1px, transparent 1px) 0 0/22px 22px, ' + grad;
    if (d.style === 'diagonal') return 'repeating-linear-gradient(45deg, ' + d.accent + '14 0 2px, transparent 2px 12px), ' + grad;
    if (d.style === 'waves') return wavesUri(d.accent) + ' 0 0/120px 24px, ' + grad;
    if (d.style === 'rings') return 'radial-gradient(circle at 110% -10%, transparent 0 38px, ' + d.accent + '22 39px 41px, transparent 42px 62px, ' + d.accent + '1a 63px 65px, transparent 66px), ' + grad;
    return grad;
  }
  /* opts: {design, programName, restaurantName, logoUrl, customerName, last4, balance, nextCost, nextName, tier, tierEnabled, nextTier, rewardName, animate} */
  function render(host, o) {
    o = o || {}; var d = design(o.design), sz = SIZES[d.size], ctr = d.align === 'center';
    var sec = d.sec || d.text, ptsC = d.pts || d.text, barC = d.bar || d.accent;
    host.innerHTML = ''; host.classList.add('kcard-host');
    var c = el('div', 'kcard'); c.style.cssText = 'position:relative;aspect-ratio:1.586;width:100%;max-width:380px;border-radius:22px;padding:20px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;gap:12px;box-shadow:0 18px 40px -18px rgba(0,0,0,.6);font-family:' + FONTS[d.font] + ';font-weight:' + (d.weight === '500' ? 500 : 600) + ';color:' + d.text + ';background:' + background(d) + ';text-align:' + (ctr ? 'center' : 'left');
    var top = el('div'); top.style.cssText = 'display:flex;justify-content:' + (ctr ? 'center' : 'space-between') + ';align-items:flex-start;gap:10px;flex-direction:' + (ctr ? 'column' : 'row') + (ctr ? ';align-items:center' : '');
    var brand = el('div'); brand.style.cssText = 'display:flex;align-items:center;gap:10px;min-width:0';
    if (o.logoUrl && d.show_logo) { var im = el('img'); im.alt = ''; im.src = o.logoUrl; im.crossOrigin = 'anonymous'; im.style.cssText = 'width:' + Math.round(36 * sz) + 'px;height:' + Math.round(36 * sz) + 'px;border-radius:10px;object-fit:cover;background:#ffffff22;flex:none'; im.onerror = function () { im.remove(); }; brand.appendChild(im); }
    var nm = el('div', null, o.restaurantName || 'Mi restaurante'); nm.style.cssText = 'font-weight:' + d.weight + ';font-size:' + (15 * sz).toFixed(1) + 'px;line-height:1.2;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical'; brand.appendChild(nm);
    var tagTxt = (ICONS[d.icon] ? ICONS[d.icon] + ' ' : '') + (d.title || o.programName || 'Puntos');
    var tag = el('div', null, tagTxt); tag.style.cssText = 'font-size:' + (11 * sz).toFixed(1) + 'px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:' + d.accent + ';' + (ctr ? '' : 'text-align:right;flex:none;max-width:45%');
    top.appendChild(brand); top.appendChild(tag);
    var mid = el('div'); mid.style.cssText = 'display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;' + (ctr ? 'justify-content:center' : '');
    var bal = el('div', 'kcard-bal', String(Number(o.balance || 0).toLocaleString('es-CO'))); bal.style.cssText = 'font-size:calc(clamp(38px,12vw,54px) * ' + sz + ');font-weight:' + d.weight + ';line-height:1;font-variant-numeric:tabular-nums;color:' + ptsC;
    var unit = el('div', null, d.points_label || d.subtitle || 'puntos'); unit.style.cssText = 'font-size:' + (13 * sz).toFixed(1) + 'px;font-weight:700;opacity:.85;color:' + sec;
    mid.appendChild(bal); mid.appendChild(unit);
    if (d.welcome) { var w = el('div', null, d.welcome); w.style.cssText = 'flex-basis:100%;font-size:' + (12 * sz).toFixed(1) + 'px;font-weight:600;opacity:.85;color:' + sec; mid.appendChild(w); }
    var bot = el('div'); bot.style.cssText = 'display:grid;gap:6px';
    if (o.nextCost > 0) {
      var pct = Math.min(100, Math.round((Number(o.balance || 0) / o.nextCost) * 100));
      var bar = el('div', 'kcard-bar'); bar.style.cssText = 'height:6px;border-radius:99px;background:' + d.text + '26;overflow:hidden'; var fill = el('i'); fill.style.cssText = 'display:block;height:100%;width:' + (o.animate === false ? pct : 0) + '%;background:' + barC + ';border-radius:99px;transition:width .9s cubic-bezier(.16,1,.3,1)'; bar.appendChild(fill);
      if (o.animate !== false) { requestAnimationFrame(function () { requestAnimationFrame(function () { fill.style.width = pct + '%'; }); }); }
      var msg = pct >= 100 ? (d.reward_msg || '¡Ya puedes canjear un premio!') : 'Te faltan ' + Math.max(0, o.nextCost - Number(o.balance || 0)).toLocaleString('es-CO') + ' para tu próximo premio' + (o.nextName ? ': ' + o.nextName : '');
      var hint = el('div', null, msg); hint.style.cssText = 'font-size:' + (11.5 * sz).toFixed(1) + 'px;font-weight:600;opacity:.9;color:' + sec;
      if (pct >= 100) c.classList.add('kcard-ready');
      bot.appendChild(bar); bot.appendChild(hint);
    }
    if (d.custom) { var cu = el('div', null, d.custom); cu.style.cssText = 'font-size:' + (11 * sz).toFixed(1) + 'px;opacity:.8;color:' + sec; bot.appendChild(cu); }
    var who = el('div'); who.style.cssText = 'display:flex;justify-content:' + (ctr ? 'center;gap:12px' : 'space-between') + ';font-size:' + (12 * sz).toFixed(1) + 'px;font-weight:700;opacity:.92;color:' + sec;
    var lvl = o.tierEnabled && o.tier ? ' · ' + o.tier : (d.membership ? ' · ' + d.membership : '');
    who.appendChild(el('span', null, (o.customerName || 'Cliente') + lvl)); who.appendChild(el('span', null, o.last4 ? '•••• ' + o.last4 : ''));
    bot.appendChild(who);
    c.appendChild(top); c.appendChild(mid); c.appendChild(bot); host.appendChild(c);
    if (!root.__kcardCss) { root.__kcardCss = 1; var st = document.createElement('style'); st.textContent = '.kcard-ready{animation:kcardPulse 2.4s ease-in-out infinite}@keyframes kcardPulse{0%,100%{box-shadow:0 18px 40px -18px rgba(0,0,0,.6)}50%{box-shadow:0 18px 44px -14px rgba(255,255,255,.28)}}@media (prefers-reduced-motion:reduce){.kcard-ready{animation:none}.kcard-bar i{transition:none!important}}'; document.head.appendChild(st); }
    return c;
  }
  root.KARTTA_CARD = { render: render, design: design, DEFAULTS: DEFAULTS, STYLES: STYLES, TEMPLATES: TEMPLATES, FONTS: Object.keys(FONTS), ICONS: Object.keys(ICONS) };
})(window);
