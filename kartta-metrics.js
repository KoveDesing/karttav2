/**
 * KARTTA — Métricas (fase 1). Solo datos reales:
 *  · Pedidos / ventas: tabla orders (+ order_items) del restaurante, por RLS.
 *  · Visitas: tabla menu_events (si el usuario puede leerla; si no, se dice y no se inventa nada).
 * Zona horaria fija: America/Bogota (UTC-5, sin horario de verano).
 * Definiciones: visita = menu_view + qr_scan · venta confirmada = pedido pagado y no cancelado ·
 * completado = entregado · ticket promedio = ventas confirmadas / pedidos pagados.
 */
(function () {
  'use strict';
  var TZ = 'America/Bogota', $ = function (id) { return document.getElementById(id); };
  var M = window.KARTTA_MODS, esc = function (s) { return M.esc(s); };
  var st = { range: '30', from: '', to: '' };
  var dkey = function (d) { return new Date(d).toLocaleDateString('en-CA', { timeZone: TZ }); };
  var hourOf = function (d) { return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: TZ }).format(new Date(d))); };
  var addDays = function (k, n) { var d = new Date(k + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  var startISO = function (k) { return k + 'T00:00:00-05:00'; };
  var fmtDay = function (k) { var p = k.split('-'); return p[2] + '/' + p[1]; };

  function span() {
    var today = dkey(Date.now()), from, to;
    if (st.range === 'custom' && st.from && st.to && st.from <= st.to) { from = st.from; to = st.to; }
    else { var n = Number(st.range) || 30; to = today; from = addDays(today, -(n - 1)); }
    var days = Math.round((new Date(to) - new Date(from)) / 864e5) + 1;
    return { from: from, to: to, days: days, pFrom: addDays(from, -days), pTo: addDays(from, -1) };
  }
  function listDays(from, to) { var a = [], k = from; while (k <= to && a.length < 400) { a.push(k); k = addDays(k, 1); } return a; }

  /* ---------- cálculo (función pura, probada) ---------- */
  function compute(orders, events, from, to) {
    var inR = function (t) { var k = dkey(t); return k >= from && k <= to; };
    var os = orders.filter(function (o) { return inR(o.created_at); });
    events = events.map(function (e) { return Object.assign({}, e, { created_at: e.created_at || e.occurred_at }); });
    var ev = events.filter(function (e) { return inR(e.created_at); });
    var days = listDays(from, to), idx = {}; days.forEach(function (k, i) { idx[k] = i; });
    var z = function () { return days.map(function () { return 0; }); };
    var r = { orders: os.length, done: 0, cancelled: 0, paidN: 0, sales: 0, visits: 0, qr: 0,
      ordersDay: z(), salesDay: z(), visitsDay: z(), ordersHour: new Array(24).fill(0), salesHour: new Array(24).fill(0), visitsHour: new Array(24).fill(0), top: {}, pviews: {}, days: days };
    os.forEach(function (o) {
      var k = idx[dkey(o.created_at)], cancelled = o.status === 'cancelado';
      if (o.status === 'entregado') r.done++; if (cancelled) r.cancelled++;
      r.ordersDay[k]++; r.ordersHour[hourOf(o.created_at)]++;
      if (o.paid && !cancelled) { r.paidN++; var t = Number(o.total || 0); r.sales += t; r.salesDay[k] += t; r.salesHour[hourOf(o.created_at)] += t; }
      if (!cancelled) (o.order_items || []).forEach(function (i) { r.top[i.name] = (r.top[i.name] || 0) + Number(i.quantity || 0); });
    });
    ev.forEach(function (e) {
      var ty = e.event_type || e.type || e.kind || '';
      if (ty === 'menu_view' || ty === 'qr_scan') { r.visits++; if (ty === 'qr_scan') r.qr++; var k = idx[dkey(e.created_at)]; r.visitsDay[k]++; r.visitsHour[hourOf(e.created_at)]++; }
      else if (ty === 'product_view' && e.product_id) r.pviews[e.product_id] = (r.pviews[e.product_id] || 0) + 1;
    });
    r.avg = r.paidN ? r.sales / r.paidN : 0;
    return r;
  }
  M.computeMetrics = compute;

  /* ---------- gráficas SVG interactivas y responsivas ---------- */
  function chart(host, o) { // o: {labels, values, fmt, type:'bar'|'line', color, aria}
    host.classList.add('chart'); host.innerHTML = '<div class="tip" role="status"></div>';
    var tip = host.querySelector('.tip');
    function draw() {
      var W = Math.max(host.clientWidth || 320, 240), H = W < 480 ? 190 : 230, pl = 40, pr = 8, pt = 10, pb = 26;
      var n = o.values.length, max = Math.max.apply(null, o.values.concat([1]));
      var raw = max / 5, mag = Math.pow(10, Math.floor(Math.log10(raw))), step = [1, 2, 5, 10].map(function (k) { return k * mag; }).filter(function (v) { return v >= raw; })[0];
      if (!o.axis) step = Math.max(1, Math.ceil(step));           // conteos: solo marcas enteras
      var gc = Math.max(1, Math.ceil(max / step)), top = gc * step;
      var iw = W - pl - pr, ih = H - pt - pb, bw = iw / n, X = function (i) { return pl + bw * i + bw / 2; }, Y = function (v) { return pt + ih - (v / top) * ih; };
      var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.aria) + '">';
      for (var g = 0; g <= gc; g++) { var gv = step * g, gy = Y(gv); s += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + gy + '" y2="' + gy + '" stroke="var(--border)" stroke-width="1"/><text x="' + (pl - 6) + '" y="' + (gy + 4) + '" text-anchor="end" font-size="10.5" fill="var(--muted)">' + (o.axis ? o.axis(gv) : Math.round(gv)) + '</text>'; }
      var every = Math.ceil(n / Math.max(2, Math.floor(iw / 52)));
      if (o.type === 'line') {
        var pts = o.values.map(function (v, i) { return X(i) + ',' + Y(v); });
        s += '<polygon points="' + pl + ',' + (pt + ih) + ' ' + pts.join(' ') + ' ' + X(n - 1) + ',' + (pt + ih) + '" fill="' + o.color + '" opacity=".12"/><polyline points="' + pts.join(' ') + '" fill="none" stroke="' + o.color + '" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>';
      } else o.values.forEach(function (v, i) { var h = (v / top) * ih; s += '<rect class="b" data-i="' + i + '" x="' + (X(i) - Math.max(bw * .36, 1.5)) + '" y="' + (pt + ih - h) + '" width="' + Math.max(bw * .72, 3) + '" height="' + Math.max(h, v > 0 ? 2 : 0) + '" rx="3" fill="' + o.color + '" opacity=".88"/>'; });
      o.labels.forEach(function (l, i) { if (i % every === 0) s += '<text x="' + X(i) + '" y="' + (H - 7) + '" text-anchor="middle" font-size="10.5" fill="var(--muted)">' + esc(l) + '</text>'; });
      s += '<line class="cur" y1="' + pt + '" y2="' + (pt + ih) + '" stroke="var(--muted)" stroke-dasharray="3 3" opacity="0"/><circle class="dot" r="4.5" fill="' + o.color + '" stroke="var(--panel)" stroke-width="2" opacity="0"/><rect class="hit" x="' + pl + '" y="' + pt + '" width="' + iw + '" height="' + ih + '" fill="transparent"/></svg>';
      host.querySelector('svg') && host.removeChild(host.querySelector('svg')); host.insertAdjacentHTML('afterbegin', s);
      var el = host.querySelector('svg'), hit = el.querySelector('.hit'), cur = el.querySelector('.cur'), dot = el.querySelector('.dot');
      function show(e) {
        var r = el.getBoundingClientRect(), px = (e.clientX - r.left) * (W / r.width), i = Math.min(n - 1, Math.max(0, Math.floor((px - pl) / bw)));
        cur.setAttribute('x1', X(i)); cur.setAttribute('x2', X(i)); cur.setAttribute('opacity', '1'); dot.setAttribute('cx', X(i)); dot.setAttribute('cy', Y(o.values[i])); dot.setAttribute('opacity', o.type === 'line' ? '1' : '0');
        tip.textContent = o.labels[i] + ' · ' + (o.fmt ? o.fmt(o.values[i]) : o.values[i]); tip.style.left = (X(i) * r.width / W) + 'px'; tip.style.top = (Y(o.values[i]) * r.height / H) + 'px'; tip.classList.add('show');
      }
      hit.addEventListener('pointermove', show); hit.addEventListener('pointerdown', show);
      hit.addEventListener('pointerleave', function () { tip.classList.remove('show'); cur.setAttribute('opacity', '0'); dot.setAttribute('opacity', '0'); });
    }
    draw(); if (window.ResizeObserver) { var last = host.clientWidth; new ResizeObserver(function () { if (Math.abs(host.clientWidth - last) > 4) { last = host.clientWidth; draw(); } }).observe(host); }
  }

  /* ---------- vista ---------- */
  var seq = 0;
  async function render() {
    var C = M.ctx, host = $('modMetricas'); if (!host) return; var my = ++seq;
    var R = span(), money = C.money;
    host.innerHTML =
      '<div class="vhead"><h2>Métricas</h2><p>Solo datos reales de tu menú y tus pedidos (hora de Colombia).</p></div>' +
      '<div class="fbar" style="align-items:center"><div class="rng" role="group" aria-label="Período">' +
      [['7', '7 días'], ['30', '30 días'], ['90', '90 días'], ['custom', 'Personalizado']].map(function (b) { return '<button type="button" data-rng="' + b[0] + '" class="' + (st.range === b[0] ? 'on' : '') + '" aria-pressed="' + (st.range === b[0]) + '">' + b[1] + '</button>'; }).join('') + '</div>' +
      (st.range === 'custom' ? '<div class="field"><label for="mFrom">Desde</label><input id="mFrom" type="date" value="' + st.from + '" max="' + dkey(Date.now()) + '"></div><div class="field"><label for="mTo">Hasta</label><input id="mTo" type="date" value="' + st.to + '" max="' + dkey(Date.now()) + '"></div>' : '') + '</div>' +
      '<div id="mBody"><div class="kpis">' + new Array(6).fill('<div class="kpi"><div class="skel" style="height:12px;width:60%"></div><div class="skel" style="height:26px;width:50%;margin-top:10px"></div></div>').join('') + '</div></div>';
    if (st.range === 'custom' && !(st.from && st.to && st.from <= st.to)) { $('mBody').innerHTML = '<div class="card empty"><h3>Elige un rango</h3><p>Selecciona las fechas «Desde» y «Hasta» para ver tus métricas.</p></div>'; return; }
    var sISO = startISO(R.pFrom), eISO = startISO(addDays(R.to, 1));
    var q1 = C.sb.from('orders').select('id,status,total,paid,created_at,order_items(name,quantity)').eq('restaurant_id', C.rid).gte('created_at', sISO).lt('created_at', eISO).order('created_at').limit(3000);
    var q2 = C.sb.from('menu_events').select('id,event_type,product_id,occurred_at').eq('restaurant_id', C.rid).gte('occurred_at', sISO).lt('occurred_at', eISO).order('occurred_at').limit(10000);
    var res = await Promise.all([q1, q2]); if (my !== seq) return;
    var oR = res[0], eR = res[1];
    if (oR.error) { $('mBody').innerHTML = '<div class="card"><p class="note warn" style="margin:0">No se pudieron cargar los pedidos. Intenta de nuevo.</p></div>'; return; }
    var evOK = !eR.error, orders = oR.data || [], events = evOK ? (eR.data || []) : [];
    var cur = compute(orders, events, R.from, R.to), prev = compute(orders, events, R.pFrom, R.pTo);
    var trunc = orders.length >= 3000 || events.length >= 10000;
    var delta = function (a, b) { if (!b) return a ? '<div class="d">Sin período anterior para comparar</div>' : '<div class="d">—</div>'; var p = (a - b) / b * 100; return '<div class="d ' + (p >= 0 ? 'up' : 'dn') + '">' + (p >= 0 ? '▲ ' : '▼ ') + Math.abs(p).toFixed(0) + '% vs. período anterior</div>'; };
    var kpi = function (l, v, d) { return '<div class="kpi"><div class="l">' + l + '</div><div class="n">' + v + '</div>' + d + '</div>'; };
    var anyData = cur.orders || cur.visits || prev.orders || prev.visits;
    var h = '';
    if (!anyData) {
      h = '<div class="card empty"><h3>Aún no hay datos en este período</h3><p>Las métricas se llenan solas cuando tus clientes abren el menú y hacen pedidos. Comparte tu enlace o imprime tu código QR para empezar.</p><div class="row" style="justify-content:center"><button class="btn btn-accent" data-goto="qr">Descargar mi QR</button><button class="btn btn-ghost" id="mCopy">Copiar enlace del menú</button></div></div>';
    } else {
      h += '<div class="kpis">' +
        (evOK ? kpi('Visitas al menú', cur.visits, delta(cur.visits, prev.visits)) : kpi('Visitas al menú', '—', '<div class="d">No disponible</div>')) +
        kpi('Pedidos recibidos', cur.orders, delta(cur.orders, prev.orders)) +
        kpi('Completados', cur.done, delta(cur.done, prev.done)) +
        kpi('Cancelados', cur.cancelled, delta(cur.cancelled, prev.cancelled)) +
        kpi('Ventas confirmadas', money(cur.sales), delta(cur.sales, prev.sales)) +
        kpi('Ticket promedio', cur.paidN ? money(Math.round(cur.avg)) : '—', cur.paidN ? '<div class="d">' + cur.paidN + ' pedido' + (cur.paidN === 1 ? '' : 's') + ' pagado' + (cur.paidN === 1 ? '' : 's') + '</div>' : '<div class="d">Sin pedidos pagados</div>') + '</div>';
      if (!evOK) h += '<div class="card"><p class="note warn" style="margin:0">Las visitas no están disponibles: la tabla de eventos no se puede leer con tu cuenta. Los pedidos y ventas sí son reales. Solo el dueño o un administrador puede ver las visitas.</p></div>';
      h += '<div class="card"><h3>Visitas por día</h3><div id="chV"></div></div>' +
        '<div class="cgrid"><div class="card"><h3>Pedidos por día</h3><div id="chO"></div></div><div class="card"><h3>Ventas confirmadas por día</h3><div id="chS"></div></div></div>' +
        '<div class="cgrid"><div class="card"><h3>Horas de mayor tráfico</h3><p class="sub">Visitas (o pedidos si no hay visitas) por hora.</p><div id="chH"></div></div><div class="card"><h3>Productos con mayor demanda</h3><div id="topP"></div></div></div>' +
        '<div class="card"><h3>Productos más consultados</h3><div id="viewP"></div></div>' +
        '<details class="card"><summary style="cursor:pointer;font-weight:700;color:var(--strong)">Cómo se calcula</summary><p class="note">Visita = apertura del menú o escaneo de QR. Venta confirmada = pedido marcado como pagado y no cancelado (un pedido pendiente no cuenta). Completado = pedido entregado. Ticket promedio = ventas confirmadas ÷ pedidos pagados. Comparación = el mismo número de días inmediatamente anterior. No se calculan visitantes únicos porque no hay un método fiable para identificarlos.' + (trunc ? ' <strong>Aviso:</strong> hay más registros que el límite de lectura; las cifras pueden estar incompletas.' : '') + '</p></details>';
    }
    $('mBody').innerHTML = h;
    if (!anyData) return;
    var labels = cur.days.map(fmtDay), cop = function (v) { return money(v); };
    if (evOK) chart($('chV'), { labels: labels, values: cur.visitsDay, type: 'line', color: 'var(--accent)', aria: 'Visitas por día' });
    else $('chV').parentNode.style.display = 'none';
    chart($('chO'), { labels: labels, values: cur.ordersDay, type: 'bar', color: 'var(--accent)', aria: 'Pedidos por día' });
    chart($('chS'), { labels: labels, values: cur.salesDay, type: 'bar', color: '#22C55E', fmt: cop, axis: function (v) { return v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'k' : Math.round(v); }, aria: 'Ventas confirmadas por día' });
    var hv = cur.visits ? cur.visitsHour : cur.ordersHour;
    chart($('chH'), { labels: hv.map(function (_, i) { return i + 'h'; }), values: hv, type: 'bar', color: 'var(--accent)', fmt: function (v) { return v + (cur.visits ? ' visitas' : ' pedidos'); }, aria: 'Actividad por hora' });
    var top = Object.keys(cur.top).map(function (k) { return [k, cur.top[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 6);
    $('topP').innerHTML = top.length ? '<ul class="rank">' + top.map(function (t) { return '<li><span>' + esc(t[0]) + '</span><strong>' + t[1] + (t[1] === 1 ? ' ud' : ' uds') + '</strong><div class="bar"><i style="width:' + (t[1] / top[0][1] * 100) + '%"></i></div></li>'; }).join('') + '</ul>' : '<p class="note">Aún no hay pedidos con productos en este período.</p>';
    var names = {}; (C.productos || []).forEach(function (p) { names[p.id] = p.nombre || p.name; });
    var pv = Object.keys(cur.pviews).map(function (k) { return [names[k] || 'Producto eliminado', cur.pviews[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 6);
    $('viewP').innerHTML = pv.length ? '<ul class="rank">' + pv.map(function (t) { return '<li><span>' + esc(t[0]) + '</span><strong>' + t[1] + (t[1] === 1 ? ' consulta' : ' consultas') + '</strong><div class="bar"><i style="width:' + (t[1] / pv[0][1] * 100) + '%"></i></div></li>'; }).join('') + '</ul>' : '<p class="note">Todavía no se registran consultas por producto en este período. Empiezan a contarse cuando los clientes abren la ficha de un producto en el menú.</p>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-rng]'); if (b) { st.range = b.dataset.rng; render(); return; }
    if (e.target.id === 'mCopy') { navigator.clipboard && navigator.clipboard.writeText(M.ctx.menuURL()).then(function () { M.ctx.toast('Enlace copiado.'); }); }
  });
  document.addEventListener('change', function (e) { if (e.target.id === 'mFrom' || e.target.id === 'mTo') { st.from = $('mFrom').value; st.to = $('mTo').value; render(); } });
  M.views.metricas = render;
})();
