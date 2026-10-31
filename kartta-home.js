/**
 * KARTTA — Inicio tipo «panel de trading»: ingresos en vivo con cursor interactivo, KPIs con minigráficas,
 * accesos agrupados, redes sociales y conexión de Mercado Pago. Solo datos reales (orders, menu_events, payment_accounts, loyalty_*).
 * Zona horaria fija America/Bogota. «Ingresos» = pedidos pagados y no cancelados.
 */
(function () {
  'use strict';
  var TZ = 'America/Bogota', $ = function (id) { return document.getElementById(id); };
  var M = window.KARTTA_MODS, esc = M.esc, svg = M.svg;
  var st = { range: '7', timer: 0, busy: false, mp: null, loy: undefined, last: null };
  var dkey = function (d) { return new Date(d).toLocaleDateString('en-CA', { timeZone: TZ }); };
  var addDays = function (k, n) { var d = new Date(k + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  var startISO = function (k) { return k + 'T00:00:00-05:00'; };
  var RANGES = [['hoy', 'Hoy'], ['7', '7 días'], ['30', '30 días'], ['mes', 'Este mes']];

  function span(r) {
    var today = dkey(Date.now()), from, n;
    if (r === 'hoy') { from = today; n = 1; }
    else if (r === 'mes') { from = today.slice(0, 8) + '01'; n = Math.round((new Date(today) - new Date(from)) / 864e5) + 1; }
    else { n = Number(r); from = addDays(today, -(n - 1)); }
    return { from: from, to: today, n: n, pFrom: addDays(from, -n), pTo: addDays(from, -1) };
  }
  var pct = function (a, b) { return b ? (a - b) / b * 100 : null; };
  var deltaHtml = function (a, b, label) { var p = pct(a, b); if (p === null) return '<span class="dl">' + (a ? 'Sin período anterior' : 'Sin datos aún') + '</span>'; return '<span class="dl ' + (p >= 0 ? 'up' : 'dn') + '">' + (p >= 0 ? '▲' : '▼') + ' ' + Math.abs(p).toFixed(0) + '% ' + (label || 'vs. período anterior') + '</span>'; };

  /* ---------- gráfica tipo trading ---------- */
  var gid = 0;
  function trading(host, o) { // o: {labels, tips, values, color, fmt, aria, empty}
    host.classList.add('chart'); var id = 'tg' + (++gid);
    function draw() {
      var W = Math.max(host.clientWidth || 320, 260), H = W < 520 ? 210 : 270, pl = 8, pr = 8, pt = 14, pb = 26, n = o.values.length;
      var max = Math.max.apply(null, o.values.concat([1])), iw = W - pl - pr, ih = H - pt - pb;
      var X = function (i) { return n === 1 ? pl + iw / 2 : pl + iw * i / (n - 1); }, Y = function (v) { return pt + ih - (v / (max * 1.12)) * ih; };
      var pts = o.values.map(function (v, i) { return X(i).toFixed(1) + ',' + Y(v).toFixed(1); });
      var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.aria) + '"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + o.color + '" stop-opacity=".32"/><stop offset="1" stop-color="' + o.color + '" stop-opacity="0"/></linearGradient></defs>';
      for (var g = 1; g <= 3; g++) { var gy = pt + ih * g / 4; s += '<line x1="0" x2="' + W + '" y1="' + gy + '" y2="' + gy + '" stroke="var(--border)" stroke-dasharray="2 5" opacity=".7"/>'; }
      if (n > 1) s += '<polygon points="' + X(0) + ',' + (pt + ih) + ' ' + pts.join(' ') + ' ' + X(n - 1) + ',' + (pt + ih) + '" fill="url(#' + id + ')"/>';
      s += '<polyline points="' + (n === 1 ? X(0) - 30 + ',' + Y(o.values[0]) + ' ' + X(0) + ',' + Y(o.values[0]) + ' ' + (X(0) + 30) + ',' + Y(o.values[0]) : pts.join(' ')) + '" fill="none" stroke="' + o.color + '" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>';
      var every = Math.ceil(n / Math.max(2, Math.floor(iw / 58)));
      o.labels.forEach(function (l, i) { if (i % every === 0 || i === n - 1 && n < 8) s += '<text x="' + Math.min(Math.max(X(i), 14), W - 14) + '" y="' + (H - 7) + '" text-anchor="middle" font-size="10.5" fill="var(--muted)">' + esc(l) + '</text>'; });
      var lx = X(n - 1), ly = Y(o.values[n - 1]);
      s += '<circle cx="' + lx + '" cy="' + ly + '" r="9" fill="' + o.color + '" opacity=".18" class="pulse"/><circle cx="' + lx + '" cy="' + ly + '" r="4" fill="' + o.color + '" stroke="var(--panel)" stroke-width="2"/>';
      s += '<line class="cur" y1="' + pt + '" y2="' + (pt + ih) + '" stroke="var(--muted)" stroke-dasharray="3 3" opacity="0"/><circle class="dot" r="5.5" fill="' + o.color + '" stroke="var(--panel)" stroke-width="2.5" opacity="0"/><rect class="hit" x="0" y="0" width="' + W + '" height="' + H + '" fill="transparent"/></svg><div class="tip" role="status"></div>';
      host.innerHTML = s;
      var el = host.querySelector('svg'), tip = host.querySelector('.tip'), cur = el.querySelector('.cur'), dot = el.querySelector('.dot');
      function show(e) {
        var r = el.getBoundingClientRect(), px = (e.clientX - r.left) * (W / r.width), i = n === 1 ? 0 : Math.min(n - 1, Math.max(0, Math.round((px - pl) / iw * (n - 1))));
        cur.setAttribute('x1', X(i)); cur.setAttribute('x2', X(i)); cur.setAttribute('opacity', '1'); dot.setAttribute('cx', X(i)); dot.setAttribute('cy', Y(o.values[i])); dot.setAttribute('opacity', '1');
        tip.innerHTML = o.tips[i]; tip.classList.add('show');
        var tx = X(i) * r.width / W, half = tip.offsetWidth / 2; tip.style.left = Math.min(Math.max(tx, half + 4), r.width - half - 4) + 'px'; tip.style.top = (Y(o.values[i]) * r.height / H) + 'px';
      }
      var hit = el.querySelector('.hit'); hit.addEventListener('pointermove', show); hit.addEventListener('pointerdown', show);
      hit.addEventListener('pointerleave', function () { tip.classList.remove('show'); cur.setAttribute('opacity', '0'); dot.setAttribute('opacity', '0'); });
    }
    draw(); var last = host.clientWidth;
    if (window.ResizeObserver) new ResizeObserver(function () { if (Math.abs(host.clientWidth - last) > 4) { last = host.clientWidth; draw(); } }).observe(host);
  }
  function spark(vals, color) {
    var n = vals.length, W = 96, H = 28, max = Math.max.apply(null, vals.concat([1]));
    if (n < 2) return '';
    var p = vals.map(function (v, i) { return (i / (n - 1) * W).toFixed(1) + ',' + (H - 3 - v / max * (H - 6)).toFixed(1); }).join(' ');
    return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true"><polyline points="' + p + '" fill="none" stroke="' + color + '" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  }

  /* ---------- datos ---------- */
  async function fetchMetrics() {
    var C = M.ctx, R = span(st.range), sISO = startISO(R.pFrom), eISO = startISO(addDays(R.to, 1));
    var r = await Promise.all([
      C.sb.from('orders').select('id,status,total,paid,created_at,order_items(name,quantity)').eq('restaurant_id', C.rid).gte('created_at', sISO).lt('created_at', eISO).order('created_at').limit(3000),
      C.sb.from('menu_events').select('id,event_type,product_id,occurred_at').eq('restaurant_id', C.rid).gte('occurred_at', sISO).lt('occurred_at', eISO).order('occurred_at').limit(10000)
    ]);
    if (r[0].error) return null;
    var evOK = !r[1].error, o = r[0].data || [], e = evOK ? (r[1].data || []) : [];
    return { R: R, cur: M.computeMetrics(o, e, R.from, R.to), prev: M.computeMetrics(o, e, R.pFrom, R.pTo), evOK: evOK };
  }
  async function fetchExtras() {
    var C = M.ctx;
    var a = await C.sb.from('payment_accounts').select('provider,status,display_name,last_error,connected_at').eq('restaurant_id', C.rid).eq('provider', 'mercadopago').maybeSingle();
    st.mp = a.error ? { unavailable: true } : (a.data || { status: 'none' });
    var l = await Promise.all([C.sb.from('loyalty_settings').select('enabled').eq('restaurant_id', C.rid).maybeSingle(), C.sb.from('loyalty_customers').select('balance').eq('restaurant_id', C.rid).limit(5000)]);
    st.loy = (l[0].error || l[1].error) ? null : { enabled: !!(l[0].data && l[0].data.enabled), customers: (l[1].data || []).length, points: (l[1].data || []).reduce(function (s, c) { return s + c.balance; }, 0) };
  }

  /* ---------- pintado ---------- */
  function paint(D) {
    var C = M.ctx, money = C.money, cur = D.cur, prev = D.prev, hourly = st.range === 'hoy';
    var up = pct(cur.sales, prev.sales); var color = up === null || up >= 0 ? '#22C55E' : '#FF5468';
    var labels, vals, tips, cum = 0;
    if (hourly) { labels = cur.salesHour.map(function (_, i) { return i + 'h'; }); vals = cur.salesHour; }
    else { labels = cur.days.map(function (k) { var p = k.split('-'); return p[2] + '/' + p[1]; }); vals = cur.salesDay; }
    var ords = hourly ? cur.ordersHour : cur.ordersDay;
    tips = vals.map(function (v, i) {
      cum += v; var when = hourly ? 'Hoy, ' + i + ':00 – ' + i + ':59' : new Date(cur.days[i] + 'T12:00:00-05:00').toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
      return '<b>' + esc(when) + '</b><br>Ingresos: <b>' + money(v) + '</b><br>Pedidos: ' + ords[i] + '<br><span class="mut">Acumulado: ' + money(cum) + '</span>';
    });
    $('hRange').innerHTML = RANGES.map(function (r) { return '<button type="button" data-hr="' + r[0] + '" class="' + (st.range === r[0] ? 'on' : '') + '" aria-pressed="' + (st.range === r[0]) + '">' + r[1] + '</button>'; }).join('');
    $('hBig').textContent = money(cur.sales); $('hBig').className = 'big';
    $('hDelta').innerHTML = deltaHtml(cur.sales, prev.sales) + '<span class="dl mut"> · ' + cur.paidN + ' pedido' + (cur.paidN === 1 ? '' : 's') + ' pagado' + (cur.paidN === 1 ? '' : 's') + '</span>';
    $('hLive').textContent = 'EN VIVO · ' + new Date().toLocaleTimeString('es-CO', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    trading($('hChart'), { labels: labels, tips: tips, values: vals, color: color, aria: 'Ingresos ' + (hourly ? 'por hora' : 'por día') });
    $('hEmpty').style.display = cur.sales || cur.orders ? 'none' : 'block';
    var tile = function (l, v, d, sp) { return '<div class="tile"><div class="l">' + l + '</div><div class="v">' + v + '</div><div class="r">' + d + sp + '</div></div>'; };
    var loy = st.loy, loyTile = loy && loy.enabled ? tile('Fidelización', loy.customers + ' cliente' + (loy.customers === 1 ? '' : 's'), '<span class="dl mut">' + loy.points.toLocaleString('es-CO') + ' pts en circulación</span>', '') : '<button type="button" class="tile tilebtn" data-qa="loy:resumen"><div class="l">Fidelización</div><div class="v" style="font-size:16px">Aún sin activar</div><div class="r"><span class="dl up">Activar puntos y tarjeta →</span></div></button>';
    $('hTiles').innerHTML =
      tile('Pedidos', cur.orders, deltaHtml(cur.orders, prev.orders), spark(hourly ? cur.ordersHour : cur.ordersDay, 'var(--accent)')) +
      tile('Ticket promedio', cur.paidN ? money(Math.round(cur.avg)) : '—', cur.paidN ? deltaHtml(cur.avg, prev.avg) : '<span class="dl">Sin pedidos pagados</span>', '') +
      tile('Visitas al menú', D.evOK ? cur.visits : '—', D.evOK ? deltaHtml(cur.visits, prev.visits) : '<span class="dl">Solo dueño/admin</span>', D.evOK ? spark(hourly ? cur.visitsHour : cur.visitsDay, '#60A5FA') : '') + loyTile;
    $('hStamp').textContent = 'Datos reales de tus pedidos · pagados y no cancelados · hora de Colombia';
  }
  async function refresh(force) {
    if (!M.ctx || !$('hChart') || st.busy) return; if (!force && (document.hidden || !document.querySelector('[data-panel=inicio].active'))) return;
    st.busy = true; try { var D = await fetchMetrics(); if (!D) { $('hStamp').textContent = 'No se pudieron cargar los datos. Reintentando…'; return; } st.last = D; paint(D); } finally { st.busy = false; }
  }
  var deb = 0; window.addEventListener('kartta:data', function () { clearTimeout(deb); deb = setTimeout(function () { refresh(false); }, 900); });

  /* ---------- estructura ---------- */
  var btn = function (icon, title, sub, attr) { return '<button type="button" class="qa" ' + attr + '><span class="qi">' + svg(icon) + '</span><span>' + title + '<small>' + sub + '</small></span></button>'; };
  function mpCard() {
    var a = st.mp || { status: 'none' }, on = a.status === 'connected';
    var sub = a.unavailable ? 'No disponible por ahora' : on ? 'Conectado como ' + esc(a.display_name || 'tu cuenta') : a.status === 'error' ? esc(a.last_error || 'Error de conexión') : 'Conecta tu cuenta para cobrar online';
    return '<div class="qa wide mp"><span class="qi mpi">' + svg('card') + '</span><span style="flex:1;min-width:0">Mercado Pago<small>' + sub + '</small></span><label class="cc-open" title="' + (on ? 'Desconectar' : 'Conectar') + '"><input type="checkbox" id="mpSwitch" role="switch" ' + (on ? 'checked ' : '') + (a.unavailable ? 'disabled ' : '') + 'aria-label="Mercado Pago ' + (on ? 'conectado' : 'desconectado') + '"><span>' + (on ? 'Conectado' : 'Apagado') + '</span></label></div>';
  }
  function body() {
    return '<section class="hero" aria-label="Ingresos"><div class="hero-top"><div><div class="hl">Ingresos <span class="live" id="hLive">EN VIVO</span></div><div class="big" id="hBig">—</div><div id="hDelta" class="dls"></div></div><div class="rng" id="hRange" role="group" aria-label="Período"></div></div>' +
      '<div id="hChart" style="min-height:210px"><div class="skel" style="height:210px"></div></div><div class="note" id="hEmpty" style="display:none;margin-top:8px">Aún no hay ingresos en este período. Aparecen cuando marcas un pedido como <b>pagado</b>. Comparte tu menú o tu QR para recibir pedidos.</div><div class="note" id="hStamp" style="margin-top:8px"></div></section>' +
      '<div class="tiles" id="hTiles">' + new Array(4).fill('<div class="tile"><div class="skel" style="height:12px;width:50%"></div><div class="skel" style="height:24px;width:60%;margin-top:10px"></div></div>').join('') + '</div>' +
      '<h3 class="gh">Tu negocio</h3><div class="qa-grid">' + btn('editor', 'Editor del menú', 'Diseño y publicación', 'data-href="editor.html"') + btn('eye', 'Menú público', 'Abrir en otra pestaña', 'data-qa="open"') + btn('plus', 'Añadir producto', 'Crear uno nuevo', 'data-qa="newprod"') + btn('share', 'Redes sociales', 'Instagram, WhatsApp, Maps…', 'data-qa="social"') + btn('list', 'Pedidos', 'Gestiona los recibidos', 'data-goto="pedidos"') + btn('qr', 'Código QR', 'Descargar y personalizar', 'data-goto="qr"') + '</div>' +
      '<h3 class="gh">Clientes y fidelización</h3><div class="qa-grid">' + btn('users', 'Fidelización', 'Puntos y clientes', 'data-qa="loy:resumen"') + btn('card', 'Premios', 'Qué canjean por sus puntos', 'data-qa="loy:premios"') + btn('chart', 'Juegos', 'Ruleta diaria con puntos', 'data-qa="loy:juegos"') + btn('qr', 'Tarjeta de puntos', 'Diseña la que verá el cliente', 'data-qa="loy:tarjeta"') + btn('users', 'Clientes', 'Quiénes te compran', 'data-goto="clientes"') + '</div>' +
      '<h3 class="gh">Cobros y análisis</h3><div class="qa-grid" id="hPay">' + mpCard() + btn('card', 'Pagos', 'Estado de conexión', 'data-goto="pagos"') + btn('chart', 'Métricas', 'Visitas, pedidos y ventas', 'data-goto="metricas"') + '</div>';
  }
  M.home = {
    async render() {
      var host = $('homeBody'); if (!host) return; host.innerHTML = body();
      await Promise.all([refresh(true), fetchExtras().then(function () { var p = $('hPay'); if (p) p.firstElementChild.outerHTML = mpCard(); if (st.last) paint(st.last); })]);
      clearInterval(st.timer); st.timer = setInterval(function () { refresh(false); }, 20000);
    }
  };

  /* ---------- modales ---------- */
  function openModal(html) { var m = $('kModal'); if (!m) return; $('kModalBox').innerHTML = html; m.classList.add('show'); var f = $('kModalBox').querySelector('input,button.btn-accent'); if (f) setTimeout(function () { f.focus(); }, 60); }
  function closeModal() { var m = $('kModal'); if (m) m.classList.remove('show'); }
  M.openModal = openModal; M.closeModal = closeModal;
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $('kModal') && $('kModal').classList.contains('show')) closeModal(); });
  document.addEventListener('click', function (e) { if (e.target.id === 'kModal' || e.target.closest('[data-kclose]')) closeModal(); });

  var SOC = ['instagram', 'facebook', 'tiktok', 'youtube', 'whatsapp', 'maps', 'web'];
  var SOC_PH = { instagram: '@tu_usuario o enlace', facebook: 'tu página o enlace', tiktok: '@tu_usuario', youtube: '@tu_canal o enlace', whatsapp: '573001234567', maps: 'Enlace de Google Maps o dirección', web: 'https://tusitio.com' };
  async function openSocial() {
    var C = M.ctx, D = window.KARTTA_DESIGN; if (!D) return C.toast('No se pudo cargar el modelo de redes.');
    var r = await C.sb.from('menu_designs').select('status,config').eq('restaurant_id', C.rid);
    if (r.error) return C.toast('No se pudieron cargar tus redes.');
    var draft = (r.data || []).filter(function (x) { return x.status === 'draft'; })[0], pub = (r.data || []).filter(function (x) { return x.status === 'published'; })[0];
    var cfg = (draft || pub || {}).config || {}, cur = {}; (Array.isArray(cfg.social) ? cfg.social : []).forEach(function (x) { if (x && x.t) cur[x.t] = x; });
    if (!cur.whatsapp && C.negocio.whatsapp) { var d = String(C.negocio.whatsapp).replace(/\D/g, ''); if (d) cur.whatsapp = { t: 'whatsapp', u: d.length === 10 ? '57' + d : d }; }
    window.__socCfg = { cfg: cfg, hasDraft: !!draft, cur: cur };
    openModal('<h3 id="kModalTitle">Redes sociales</h3><p class="sub">Aparecen en tu menú público. Escribe tu usuario o pega el enlace; deja vacío lo que no uses.</p><div style="display:grid;gap:12px;margin:14px 0">' +
      SOC.map(function (t) { var v = cur[t] ? (t === 'whatsapp' ? cur[t].u : cur[t].u) : ''; return '<div class="field"><label for="soc_' + t + '">' + esc(D.SOCIAL_LABEL[t]) + '</label><input id="soc_' + t + '" data-soc="' + t + '" value="' + esc(v) + '" placeholder="' + esc(SOC_PH[t]) + '" autocomplete="off" inputmode="' + (t === 'whatsapp' ? 'tel' : 'url') + '"><div class="fmsg" id="socerr_' + t + '" style="min-height:14px"></div></div>'; }).join('') + '</div>' +
      '<p class="note">Al guardar se publica el menú, incluyendo cualquier cambio pendiente del editor.</p><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn btn-ghost" data-kclose>Cancelar</button><button class="btn btn-accent" id="socSave">Guardar y publicar</button></div>');
  }
  async function saveSocial() {
    var C = M.ctx, D = window.KARTTA_DESIGN, S = window.__socCfg, list = [], bad = false;
    SOC.forEach(function (t) {
      var inp = $('soc_' + t), err = $('socerr_' + t), v = inp.value.trim(); err.textContent = ''; if (!v) return;
      var prev = S.cur[t] && S.cur[t].u, p = (v === prev) ? { u: prev } : D.parseSocialInput(t, v);
      if (p.error) { err.textContent = p.error; err.style.color = '#FF5468'; bad = true; return; }
      var it = { t: t, u: p.u }; if (S.cur[t] && S.cur[t].m) it.m = S.cur[t].m; if (S.cur[t] && S.cur[t].on === false) it.on = false; list.push(it);
    });
    if (bad) return; var b = $('socSave'); b.disabled = true; b.textContent = 'Guardando…';
    var config = Object.assign({}, S.cfg, { social: list });
    var w = S.hasDraft ? await C.sb.from('menu_designs').update({ config: config }).eq('restaurant_id', C.rid).eq('status', 'draft').select('id') : await C.sb.from('menu_designs').insert({ restaurant_id: C.rid, status: 'draft', config: config }).select('id');
    if (w.error) { b.disabled = false; b.textContent = 'Guardar y publicar'; return C.toast('No se pudo guardar: revisa los enlaces.'); }
    var pu = await C.sb.rpc('publish_design', { p_restaurant: C.rid });
    if (pu.error) { b.disabled = false; b.textContent = 'Guardar y publicar'; return C.toast('Se guardó, pero no se pudo publicar. Publica desde el editor.'); }
    closeModal(); C.toast('Redes guardadas y publicadas.');
  }

  /* ---------- Mercado Pago ---------- */
  function openMp() {
    openModal('<h3 id="kModalTitle">Conectar Mercado Pago</h3><p class="sub">Pega tu <b>Access Token de producción</b>. Lo encuentras en Mercado Pago → <i>Tu negocio → Configuración → Credenciales</i> (o en developers.mercadopago.com → Tus integraciones).</p>' +
      '<div class="field" style="margin:14px 0 6px"><label for="mpToken">Access Token</label><input id="mpToken" type="password" autocomplete="off" spellcheck="false" placeholder="APP_USR-…"><div class="fmsg" id="mpErr" style="min-height:16px"></div></div>' +
      '<p class="note">Se verifica con Mercado Pago y se guarda cifrado en el servidor (Vault). Nunca vuelve a mostrarse ni queda en tu navegador. Puedes desconectarlo cuando quieras.<br><b>Importante:</b> esto vincula y verifica tu cuenta; el cobro con Mercado Pago dentro del menú público se activa en la siguiente fase.</p>' +
      '<div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn btn-ghost" data-kclose>Cancelar</button><button class="btn btn-accent" id="mpGo">Verificar y conectar</button></div>');
  }
  var MP_ERR = { token_rejected: 'Mercado Pago no aceptó ese token. Revisa que sea el de producción y que esté completo.', invalid_token_format: 'Ese token no tiene el formato correcto (empieza con APP_USR-).', mp_unreachable: 'No se pudo contactar a Mercado Pago. Intenta en un minuto.', mp_error: 'Mercado Pago respondió con un error. Intenta de nuevo.', forbidden: 'Solo el dueño o un administrador puede conectar pagos.' };
  async function mpCall(action, token) {
    var C = M.ctx, r = await C.sb.functions.invoke('mp-connect', { body: { action: action, restaurant_id: C.rid, access_token: token } });
    if (r.error) { var code = ''; try { var j = await r.error.context.json(); code = j.error; } catch (e) {} return { error: MP_ERR[code] || 'No se pudo completar. Intenta de nuevo.' }; }
    return r.data || {};
  }
  async function reloadMp() { await fetchExtras(); var p = $('hPay'); if (p) p.firstElementChild.outerHTML = mpCard(); if (M.views.pagos && document.querySelector('[data-panel=pagos].active')) M.views.pagos(); }
  document.addEventListener('change', async function (e) {
    if (e.target.id !== 'mpSwitch') return; var sw = e.target, want = sw.checked;
    if (want) { sw.checked = false; openMp(); return; }
    if (!confirm('¿Desconectar Mercado Pago? Se borrará el token guardado.')) { sw.checked = true; return; }
    sw.disabled = true; var r = await mpCall('disconnect'); if (r.error) { M.ctx.toast(r.error); sw.checked = true; sw.disabled = false; return; } M.ctx.toast('Mercado Pago desconectado.'); await reloadMp();
  });
  document.addEventListener('click', async function (e) {
    if (e.target.closest('#socSave')) return saveSocial();
    var h = e.target.closest('[data-hr]'); if (h) { st.range = h.dataset.hr; $('hChart').innerHTML = '<div class="skel" style="height:210px"></div>'; refresh(true); return; }
    if (e.target.closest('#mpGo')) {
      var t = $('mpToken').value.trim(), err = $('mpErr'), b = $('mpGo'); err.textContent = ''; if (!t) { err.textContent = 'Pega tu Access Token.'; err.style.color = '#FF5468'; return; }
      b.disabled = true; b.textContent = 'Verificando…'; var r = await mpCall('connect', t); $('mpToken').value = '';
      if (r.error) { b.disabled = false; b.textContent = 'Verificar y conectar'; err.textContent = r.error; err.style.color = '#FF5468'; return; }
      closeModal(); M.ctx.toast('Mercado Pago conectado: ' + r.name); await reloadMp();
    }
  });
  M.openSocial = openSocial;
  window.addEventListener('kartta:view', function (e) { if (e.detail !== 'inicio') clearInterval(st.timer); else if (M.ctx && $('homeBody')) { clearInterval(st.timer); st.timer = setInterval(function () { refresh(false); }, 20000); refresh(true); } });
})();
