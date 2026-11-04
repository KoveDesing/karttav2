/**
 * KARTTA — Inicio premium (centro de control). Datos 100 % reales del restaurante autenticado:
 *  · RPC get_home_dashboard (agregación en la base; valida membresía; zona horaria America/Bogota)
 *  · orders (listas de detalle y actividad reciente, protegidas por RLS)
 * Definiciones (una sola lógica para tarjetas, gráfica y detalle):
 *  Ingresos cobrados = pedidos marcados como pagados y NO cancelados · Valor de pedidos = no cancelados (cobrados o no)
 *  Ticket promedio = ingresos cobrados ÷ pedidos pagados · Completados = entregados ÷ pedidos no cancelados
 *  Pendientes = nuevo + preparando + listo (ahora, sin importar el periodo). No existen estados de reembolso ni costos: no se calcula ganancia neta.
 */
(function () {
  'use strict';
  var TZ = 'America/Bogota', $ = function (id) { return document.getElementById(id); };
  var M = window.KARTTA_MODS, esc = M.esc, svg = M.svg;
  var PERIODS = [['24h', '24 horas'], ['7', '7 días'], ['30', '30 días'], ['12m', '12 meses'], ['all', 'Todo']];
  var STL = { nuevo: 'Nuevo', preparando: 'Preparando', listo: 'Listo', entregado: 'Entregado', cancelado: 'Cancelado' };
  /* Estados de pedido: solo tonos del color de acento del usuario (sin colores fijos) */
  var STC = { nuevo: 'var(--accent)', preparando: 'color-mix(in srgb,var(--accent) 72%,var(--panel))', listo: 'color-mix(in srgb,var(--accent) 50%,var(--panel))', entregado: 'color-mix(in srgb,var(--accent) 30%,var(--panel))', cancelado: 'var(--muted)' };
  var st = { period: '7', timer: 0, busy: false, seq: 0, mp: null, loy: undefined, data: null, recent: null, err: null, gid: 0 };
  var RM = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  /* ---------- fechas (Bogotá, UTC-5 sin horario de verano) ---------- */
  var dkey = function (d) { return new Date(d).toLocaleDateString('en-CA', { timeZone: TZ }); };
  var addDays = function (k, n) { var d = new Date(k + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  var startISO = function (k) { return k + 'T00:00:00-05:00'; };
  var dt = function (t) { return new Date(t + ':00-05:00'); };
  var fmt = function (d, o) { return d.toLocaleDateString('es-CO', Object.assign({ timeZone: TZ }, o)); };
  function params(p) {
    var now = new Date(), today = dkey(now), y = +today.slice(0, 4), m = +today.slice(5, 7);
    var monthKey = function (off) { var d = new Date(Date.UTC(y, m - 1 + off, 1)); return d.toISOString().slice(0, 10); };
    if (p === '24h') return { from: new Date(now - 864e5).toISOString(), prev: new Date(now - 2 * 864e5).toISOString(), bucket: 'hour' };
    if (p === '7') return { from: startISO(addDays(today, -6)), prev: startISO(addDays(today, -13)), bucket: 'day' };
    if (p === '30') return { from: startISO(addDays(today, -29)), prev: startISO(addDays(today, -59)), bucket: 'day' };
    if (p === '12m') return { from: startISO(monthKey(-11)), prev: startISO(monthKey(-23)), bucket: 'month' };
    return { from: null, prev: null, bucket: null };
  }
  var pct = function (a, b) { return b ? (a - b) / b * 100 : null; };
  var money = function (v) { return M.ctx.money(Math.round(Number(v) || 0)); };
  var compact = function (v) { return v >= 1e6 ? (v / 1e6).toFixed(v % 1e6 ? 1 : 0) + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'k' : String(Math.round(v)); };
  var deltaHtml = function (a, b, suffix) { var p = pct(a, b); if (p === null) return '<span class="dl">' + (b === undefined ? '' : a ? 'Sin periodo anterior' : 'Sin datos aún') + '</span>'; return '<span class="dl ' + (p >= 0 ? 'up' : 'dn') + '">' + (p >= 0 ? '▲' : '▼') + ' ' + Math.abs(p).toFixed(0) + '% ' + (suffix || 'vs. periodo anterior') + '</span>'; };

  /* ---------- números con transición breve (termina SIEMPRE en el valor real) ---------- */
  function setNum(el, target, f, instant) {
    if (!el) return; var from = el._v, f2 = f || String;
    el._v = target; cancelAnimationFrame(el._r);
    if (instant || RM.matches || from == null || from === target || !isFinite(from)) { el.textContent = f2(target); return; }
    var t0 = performance.now(), D = 420; cancelAnimationFrame(el._r);
    (function step(t) { var k = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - k, 3); el.textContent = f2(k < 1 ? from + (target - from) * e : target); if (k < 1) el._r = requestAnimationFrame(step); })(t0);
  }

  /* ---------- gráfica premium (línea suave + área + puntos + tooltip) ---------- */
  function mono(P) {
    var n = P.length; if (n < 2) return ''; var dx = [], m = [], t = [];
    for (var i = 0; i < n - 1; i++) { dx[i] = P[i + 1][0] - P[i][0]; m[i] = (P[i + 1][1] - P[i][1]) / dx[i]; }
    t[0] = m[0]; t[n - 1] = m[n - 2]; for (i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    for (i = 0; i < n - 1; i++) { if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; } else { var a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b; if (s > 9) { var k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; } } }
    var d = 'M' + P[0][0].toFixed(1) + ' ' + P[0][1].toFixed(1);
    for (i = 0; i < n - 1; i++) d += 'C' + (P[i][0] + dx[i] / 3).toFixed(1) + ' ' + (P[i][1] + t[i] * dx[i] / 3).toFixed(1) + ' ' + (P[i + 1][0] - dx[i] / 3).toFixed(1) + ' ' + (P[i + 1][1] - t[i + 1] * dx[i] / 3).toFixed(1) + ' ' + P[i + 1][0].toFixed(1) + ' ' + P[i + 1][1].toFixed(1);
    return d;
  }
  function niceMax(max) { var raw = max / 4, mag = Math.pow(10, Math.floor(Math.log10(raw || 1))), step = [1, 2, 2.5, 5, 10].map(function (k) { return k * mag; }).filter(function (v) { return v >= raw; })[0]; return { step: step, top: Math.max(step * Math.ceil(max / step), step) }; }
  function lineChart(host, o) { // o: {labels, values, tip(i), color, aria, onHover, live, bars}
    var id = 'g' + (++st.gid); host.classList.add('chart');
    function draw() {
      var W = Math.max(host.clientWidth || 320, 260), H = W < 520 ? 220 : 300, pl = 44, pr = 12, pt = 14, pb = 28, n = o.values.length, max = Math.max.apply(null, o.values.concat([0]));
      var sc = niceMax(max || 1), iw = W - pl - pr, ih = H - pt - pb;
      var X = function (i) { return n === 1 ? pl + iw / 2 : pl + iw * i / (n - 1); }, Y = function (v) { return pt + ih - (v / sc.top) * ih; };
      var P = o.values.map(function (v, i) { return [X(i), Y(v)]; });
      var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.aria) + '"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + o.color + '" stop-opacity=".30"/><stop offset="1" stop-color="' + o.color + '" stop-opacity="0"/></linearGradient></defs>';
      for (var g = 0; g <= 4; g++) { var gv = sc.top * g / 4, gy = Y(gv); s += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + gy + '" y2="' + gy + '" stroke="var(--border)" opacity="' + (g ? '.55' : '.9') + '" ' + (g ? 'stroke-dasharray="2 6"' : '') + '/><text x="' + (pl - 8) + '" y="' + (gy + 3.5) + '" text-anchor="end" font-size="10.5" fill="var(--muted)">' + (o.axis ? o.axis(gv) : compact(gv)) + '</text>'; }
      if (n > 1) s += '<path d="' + mono(P) + 'L' + X(n - 1) + ' ' + (pt + ih) + 'L' + X(0) + ' ' + (pt + ih) + 'Z" fill="url(#' + id + ')"/><path class="ln" d="' + mono(P) + '" fill="none" stroke="' + o.color + '" stroke-width="2.4" stroke-linecap="round"/>';
      else s += '<line x1="' + (X(0) - 30) + '" x2="' + (X(0) + 30) + '" y1="' + P[0][1] + '" y2="' + P[0][1] + '" stroke="' + o.color + '" stroke-width="2.4" stroke-linecap="round"/>';
      var every = Math.ceil(n / Math.max(2, Math.floor(iw / 56)));
      o.labels.forEach(function (l, i) { if (i % every === 0) s += '<text x="' + Math.min(Math.max(X(i), pl + 4), W - pr - 4) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10.5" fill="var(--muted)">' + esc(l) + '</text>'; });
      if (n <= 45) o.values.forEach(function (v, i) { s += '<circle cx="' + P[i][0] + '" cy="' + P[i][1] + '" r="2.6" fill="var(--panel)" stroke="' + o.color + '" stroke-width="1.6" opacity=".9"/>'; });
      if (o.live) s += '<circle cx="' + P[n - 1][0] + '" cy="' + P[n - 1][1] + '" r="9" fill="' + o.color + '" opacity=".2" class="pulse"/>';
      s += '<line class="cur" y1="' + pt + '" y2="' + (pt + ih) + '" stroke="var(--muted)" stroke-dasharray="3 4" opacity="0"/><circle class="dot" r="6" fill="' + o.color + '" stroke="var(--panel)" stroke-width="3" opacity="0"/><rect class="hit" x="' + pl + '" y="0" width="' + iw + '" height="' + H + '" fill="transparent" style="touch-action:pan-y"/></svg><div class="tip" role="status"></div>';
      host.innerHTML = s;
      var el = host.querySelector('svg'), tip = host.querySelector('.tip'), cur = el.querySelector('.cur'), dot = el.querySelector('.dot'), hit = el.querySelector('.hit'), ln = el.querySelector('.ln');
      if (ln && !RM.matches && !host._drawn) { var L = ln.getTotalLength ? ln.getTotalLength() : 0; if (L) { ln.style.strokeDasharray = L; ln.style.strokeDashoffset = L; ln.getBoundingClientRect(); ln.style.transition = 'stroke-dashoffset .8s cubic-bezier(.16,1,.3,1)'; ln.style.strokeDashoffset = 0; setTimeout(function () { ln.style.strokeDasharray = ''; }, 900); } host._drawn = true; }
      function at(e) { var r = el.getBoundingClientRect(), px = (e.clientX - r.left) * (W / r.width); return n === 1 ? 0 : Math.min(n - 1, Math.max(0, Math.round((px - pl) / iw * (n - 1)))); }
      function show(e) {
        var i = at(e), r = el.getBoundingClientRect(); cur.setAttribute('x1', P[i][0]); cur.setAttribute('x2', P[i][0]); cur.setAttribute('opacity', '1'); dot.setAttribute('cx', P[i][0]); dot.setAttribute('cy', P[i][1]); dot.setAttribute('opacity', '1');
        tip.innerHTML = o.tip(i); tip.classList.add('show'); var half = tip.offsetWidth / 2, tx = P[i][0] * r.width / W;
        tip.style.left = Math.min(Math.max(tx, half + 4), r.width - half - 4) + 'px'; tip.style.top = Math.max(P[i][1] * r.height / H, tip.offsetHeight + 12) + 'px';
        if (o.onHover) o.onHover(i);
      }
      function leave(e) { if (e && e.pointerType && e.pointerType !== 'mouse') return; hide(); }
      function hide() { tip.classList.remove('show'); cur.setAttribute('opacity', '0'); dot.setAttribute('opacity', '0'); if (o.onHover) o.onHover(null); }
      hit.addEventListener('pointermove', show); hit.addEventListener('pointerdown', show); hit.addEventListener('pointerleave', leave); hit.addEventListener('pointercancel', leave);
      if (host._out) document.removeEventListener('pointerdown', host._out, true);
      host._out = function (e) { if (!host.contains(e.target)) hide(); }; document.addEventListener('pointerdown', host._out, true);
    }
    host._drawn = false; draw(); var last = host.clientWidth;
    if (host._ro) host._ro.disconnect();
    if (window.ResizeObserver) { host._ro = new ResizeObserver(function () { if (Math.abs(host.clientWidth - last) > 4) { last = host.clientWidth; draw(); } }); host._ro.observe(host); }
  }
  function barChart(host, o) { // o: {labels, values, tip(i), color, aria}
    var W = Math.max(host.clientWidth || 300, 240), H = 150, pl = 30, pr = 6, pt = 8, pb = 22, n = o.values.length, max = Math.max.apply(null, o.values.concat([1])), sc = { top: Math.max(2, Math.ceil(max / 2) * 2) }, iw = W - pl - pr, ih = H - pt - pb, bw = iw / n;
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.aria) + '">';
    for (var g = 0; g <= 2; g++) { var gy = pt + ih - ih * g / 2; s += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + gy + '" y2="' + gy + '" stroke="var(--border)" opacity=".6" stroke-dasharray="2 6"/><text x="' + (pl - 6) + '" y="' + (gy + 3) + '" text-anchor="end" font-size="10" fill="var(--muted)">' + compact(sc.top * g / 2) + '</text>'; }
    var every = Math.ceil(n / Math.max(2, Math.floor(iw / 44)));
    o.values.forEach(function (v, i) { var h = v / sc.top * ih, x = pl + bw * i; s += '<rect class="b" data-i="' + i + '" x="' + (x + bw * .14) + '" y="' + (pt + ih - h) + '" width="' + Math.max(bw * .72, 2) + '" height="' + Math.max(h, v > 0 ? 2 : 0) + '" rx="3" fill="' + o.color + '" opacity=".85"/>'; if (i % every === 0) s += '<text x="' + (x + bw / 2) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="10" fill="var(--muted)">' + esc(o.labels[i]) + '</text>'; });
    host.classList.add('chart'); host.innerHTML = s + '<rect class="hit" x="' + pl + '" y="0" width="' + iw + '" height="' + H + '" fill="transparent" style="touch-action:pan-y"/></svg><div class="tip" role="status"></div>';
    var el = host.querySelector('svg'), tip = host.querySelector('.tip'), hit = el.querySelector('.hit');
    function show(e) { var r = el.getBoundingClientRect(), px = (e.clientX - r.left) * (W / r.width), i = Math.min(n - 1, Math.max(0, Math.floor((px - pl) / bw))); el.querySelectorAll('.b').forEach(function (b) { b.setAttribute('opacity', +b.dataset.i === i ? '1' : '.5'); }); tip.innerHTML = o.tip(i); tip.classList.add('show'); var half = tip.offsetWidth / 2, tx = (pl + bw * (i + .5)) * r.width / W; tip.style.left = Math.min(Math.max(tx, half + 4), r.width - half - 4) + 'px'; tip.style.top = Math.max((pt + ih - o.values[i] / sc.top * ih) * r.height / H, tip.offsetHeight + 8) + 'px'; }
    hit.addEventListener('pointermove', show); hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointerleave', function (e) { if (e.pointerType && e.pointerType !== 'mouse') return; tip.classList.remove('show'); el.querySelectorAll('.b').forEach(function (b) { b.setAttribute('opacity', '.85'); }); });
  }
  function spark(vals, color) {
    var n = vals.length, W = 110, H = 34, max = Math.max.apply(null, vals.concat([1])); if (n < 2) return '';
    var P = vals.map(function (v, i) { return [i / (n - 1) * W, H - 4 - v / max * (H - 8)]; });
    return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true"><path d="' + mono(P) + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round"/></svg>';
  }

  /* ---------- datos ---------- */
  async function load() {
    var C = M.ctx, p = params(st.period);
    var r = await C.sb.rpc('get_home_dashboard', { p_restaurant: C.rid, p_from: p.from, p_to: null, p_prev_from: p.prev, p_bucket: p.bucket, p_tz: TZ });
    if (r.error || !r.data) return { error: r.error || { message: 'sin datos' } };
    return { data: r.data };
  }
  async function loadRecent() {
    var C = M.ctx, r = await C.sb.from('orders').select('id,table_label,customer_name,status,total,paid,created_at').eq('restaurant_id', C.rid).order('created_at', { ascending: false }).limit(8);
    return r.error ? null : (r.data || []);
  }
  async function fetchExtras() {
    var C = M.ctx;
    var a = await C.sb.from('payment_accounts').select('provider,status,display_name,last_error,connected_at').eq('restaurant_id', C.rid).eq('provider', 'mercadopago').maybeSingle();
    st.mp = a.error ? { unavailable: true } : (a.data || { status: 'none' });
    var l = await Promise.all([C.sb.from('loyalty_settings').select('enabled').eq('restaurant_id', C.rid).maybeSingle(), C.sb.from('loyalty_customers').select('balance').eq('restaurant_id', C.rid).limit(5000)]);
    st.loy = (l[0].error || l[1].error) ? null : { enabled: !!(l[0].data && l[0].data.enabled), customers: (l[1].data || []).length, points: (l[1].data || []).reduce(function (s, c) { return s + c.balance; }, 0) };
  }
  async function refresh(force) {
    if (!M.ctx || !$('kCards') || st.busy) return;
    if (!force && (document.hidden || !document.querySelector('[data-panel=inicio].active'))) return;
    st.busy = true; var my = ++st.seq, body = $('homeBody'); body.classList.add('loading');
    try {
      var r = await Promise.all([load(), loadRecent()]); if (my !== st.seq) return;
      if (r[0].error) { st.err = r[0].error; paintError(); return; }
      st.err = null; st.data = r[0].data; st.recent = r[1]; paint();
    } catch (e) { st.err = e; paintError(); } finally { st.busy = false; body.classList.remove('loading'); }
  }
  var deb = 0; window.addEventListener('kartta:data', function () { clearTimeout(deb); deb = setTimeout(function () { refresh(false); }, 900); });

  /* ---------- pintado ---------- */
  var ctxLabel = function (D) {
    if (st.period === '24h') return 'Últimas 24 horas';
    var a = new Date(D.from), b = new Date(D.to), f = function (d) { return fmt(d, { day: 'numeric', month: 'short' }); };
    var name = { '7': 'Últimos 7 días', '30': 'Últimos 30 días', '12m': 'Últimos 12 meses', all: 'Todo el tiempo' }[st.period];
    if (st.period === '12m' || st.period === 'all') { var g = function (d) { return fmt(d, { month: 'short', year: 'numeric' }); }; return name + ' · ' + g(a) + ' – ' + g(b); }
    return name + ' · ' + f(a) + ' – ' + f(b) + '';
  };
  var prevName = function () { return { '24h': 'las 24 h anteriores', '7': 'los 7 días anteriores', '30': 'los 30 días anteriores', '12m': 'los 12 meses anteriores' }[st.period]; };
  function axisLabel(t, bucket) { var d = dt(t); if (bucket === 'hour') return fmt(d, { hour: '2-digit', hour12: false }).replace(/\D/g, '') + 'h'; if (bucket === 'month') return fmt(d, { month: 'short' }) + ' ' + fmt(d, { year: '2-digit' }); return fmt(d, { day: '2-digit', month: '2-digit' }); }
  function fullLabel(t, bucket) { var d = dt(t); if (bucket === 'hour') { var h = fmt(d, { hour: '2-digit', hour12: false }).replace(/\D/g, ''); return fmt(d, { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + h + ':00–' + h + ':59'; } if (bucket === 'month') return fmt(d, { month: 'long', year: 'numeric' }); if (bucket === 'week') return 'Semana del ' + fmt(d, { day: 'numeric', month: 'short' }); return fmt(d, { weekday: 'long', day: 'numeric', month: 'long' }); }
  var ticket = function (c) { return c && c.paid_orders ? c.sales / c.paid_orders : 0; };

  function card(key, label, big, sub, extra, attrs) { return '<button type="button" class="kc" data-kc="' + key + '" aria-label="' + esc(label) + ': ver detalle"><div class="kcl">' + label + '<span class="kcgo" aria-hidden="true">›</span></div><div class="kcv" id="kv_' + key + '">' + big + '</div><div class="kcs">' + sub + '</div>' + (extra || '') + '</button>'; }
  function paint() {
    var D = st.data, C = M.ctx, cur = D.cur, prev = D.prev, S = D.series, live = st.period !== 'all';
    var empty = !cur.orders && !(prev && prev.orders) && !S.some(function (x) { return x.orders; });
    var ip = D.in_progress || {}, pend = (ip.nuevo || 0) + (ip.preparando || 0) + (ip.listo || 0);
    var valid = cur.valid_orders, comp = valid ? cur.delivered / valid * 100 : null;
    $('hCtx').textContent = ctxLabel(D); $('hStamp').innerHTML = '<span class="livedot"></span>Actualizado ' + new Date().toLocaleTimeString('es-CO', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' · hora de Colombia';
    $('hPer').innerHTML = PERIODS.map(function (r) { return '<button type="button" role="radio" aria-checked="' + (st.period === r[0]) + '" data-hr="' + r[0] + '" class="' + (st.period === r[0] ? 'on' : '') + '">' + r[1] + '</button>'; }).join('');

    var K = $('kCards'), first = !K.firstChild || K.querySelector('.skel');
    var html =
      card('ingresos', 'Ingresos cobrados', '', (prev ? deltaHtml(cur.sales, prev.sales, 'vs. ' + prevName()) : '<span class="dl">Sin comparación (todo el historial)</span>'), '<div class="kcx"><span>Valor de pedidos <b>' + money(cur.value) + '</b></span><span>Por cobrar <b>' + money(cur.value - cur.sales) + '</b></span></div>' + spark(S.map(function (x) { return x.sales; }), cur.sales >= (prev ? prev.sales : 0) ? 'var(--accent)' : 'var(--muted)')) +
      card('pedidos', 'Pedidos recibidos', '', prev ? deltaHtml(cur.orders, prev.orders, 'vs. ' + prevName()) : '', '<div class="kcx"><span>' + valid + ' válidos · ' + cur.cancelled + ' cancelados</span>' + (valid ? '<span>Promedio <b>' + money(cur.value / valid) + '</b></span>' : '') + '</div>' + spark(S.map(function (x) { return x.orders; }), 'var(--accent)')) +
      card('ticket', 'Ticket promedio', '', cur.paid_orders ? (prev && prev.paid_orders ? deltaHtml(ticket(cur), ticket(prev), 'vs. ' + prevName()) : '<span class="dl">Sobre ' + cur.paid_orders + ' pedido' + (cur.paid_orders === 1 ? '' : 's') + ' pagado' + (cur.paid_orders === 1 ? '' : 's') + '</span>') : '<span class="dl">Aún sin pedidos pagados</span>', '') +
      card('pendientes', 'Pedidos pendientes', '', '<span class="dl">Ahora mismo, requieren atención</span>', '<div class="kcx"><span style="color:' + STC.nuevo + '">' + (ip.nuevo || 0) + ' nuevos</span><span style="color:' + STC.preparando + '">' + (ip.preparando || 0) + ' en preparación</span><span style="color:' + STC.listo + '">' + (ip.listo || 0) + ' listos</span></div>') +
      card('rendimiento', 'Rendimiento', '', valid ? '<span class="dl">' + cur.delivered + ' de ' + valid + ' pedidos entregados</span>' : '<span class="dl">Aún sin pedidos válidos</span>', '<div class="kcx"><span>Cancelación <b>' + (cur.orders ? (cur.cancelled / cur.orders * 100).toFixed(0) : 0) + '%</b></span></div>');
    if (first) { K.innerHTML = html; } else { var tmp = document.createElement('div'); tmp.innerHTML = html; [].slice.call(K.children).forEach(function (old, i) { old.querySelector('.kcs').innerHTML = tmp.children[i].querySelector('.kcs').innerHTML; var x = old.querySelector('.kcx'), nx = tmp.children[i].querySelector('.kcx'); if (x && nx) x.innerHTML = nx.innerHTML; var sp = old.querySelector('.spark'), nsp = tmp.children[i].querySelector('.spark'); if (sp && nsp) sp.outerHTML = nsp.outerHTML; }); }
    setNum($('kv_ingresos'), cur.sales, money); setNum($('kv_pedidos'), cur.orders, function (v) { return String(Math.round(v)); });
    setNum($('kv_ticket'), cur.paid_orders ? Math.round(ticket(cur)) : 0, function (v) { return cur.paid_orders ? money(v) : '—'; });
    setNum($('kv_pendientes'), pend, function (v) { return String(Math.round(v)); });
    setNum($('kv_rendimiento'), comp == null ? 0 : comp, function (v) { return comp == null ? '—' : Math.round(v) + '%'; });
    $('kv_pendientes').style.color = pend ? STC.nuevo : '';

    /* hero: resumen que sigue al cursor */
    var up = !prev || cur.sales >= prev.sales, color = up ? 'var(--accent)' : 'var(--muted)';
    var summary = function (i) {
      var x = i == null ? null : S[i], v = x ? x.sales : cur.sales;
      setNum($('hBig'), v, money, i != null || st.hov);
      st.hov = i != null;
      $('hLbl').textContent = x ? fullLabel(x.t, D.bucket) : 'Ingresos cobrados · ' + ctxLabel(D).split(' · ')[0];
      if (x) { var pv = i > 0 ? S[i - 1].sales : null; $('hDelta').innerHTML = '<span class="dl">' + x.orders + ' pedido' + (x.orders === 1 ? '' : 's') + ' · ticket ' + (x.paid_orders ? money(x.sales / x.paid_orders) : '—') + '</span> ' + (pv == null ? '' : deltaHtml(x.sales, pv, 'vs. intervalo anterior')); }
      else $('hDelta').innerHTML = prev ? deltaHtml(cur.sales, prev.sales, 'vs. ' + prevName()) : '<span class="dl">Todo el historial</span>';
    };
    summary(null);
    $('hEmpty').style.display = empty ? 'flex' : 'none'; $('hChart').style.opacity = empty ? '.35' : '1';
    lineChart($('hChart'), {
      labels: S.map(function (x) { return axisLabel(x.t, D.bucket); }), values: S.map(function (x) { return x.sales; }), color: color, live: live, aria: 'Ingresos cobrados por ' + { hour: 'hora', day: 'día', week: 'semana', month: 'mes' }[D.bucket],
      onHover: summary,
      tip: function (i) { var x = S[i], pv = i > 0 ? S[i - 1] : null; return '<b>' + esc(fullLabel(x.t, D.bucket)) + '</b><br>Ingresos: <b>' + money(x.sales) + '</b><br>Pedidos: ' + x.orders + (x.cancelled ? ' <span class="mut">(' + x.cancelled + ' cancelado' + (x.cancelled === 1 ? '' : 's') + ')</span>' : '') + '<br>Ticket promedio: ' + (x.paid_orders ? money(x.sales / x.paid_orders) : '—') + '<br>Valor de pedidos: ' + money(x.value) + '<br><span class="mut">' + (pv && pv.sales ? ((x.sales - pv.sales) / pv.sales * 100 >= 0 ? '▲ ' : '▼ ') + Math.abs((x.sales - pv.sales) / pv.sales * 100).toFixed(0) + '% vs. intervalo anterior' : 'Sin intervalo anterior comparable') + '</span>'; }
    });

    /* analítica */
    var top = D.top || [], tmax = top.length ? top[0].qty : 1;
    $('anTop').innerHTML = top.length ? '<ul class="rank">' + top.slice(0, 5).map(function (t) { return '<li><span>' + esc(t.name) + '</span><strong>' + t.qty + (t.qty === 1 ? ' ud' : ' uds') + ' · ' + money(t.revenue) + '</strong><div class="bar"><i style="width:' + (t.qty / tmax * 100) + '%"></i></div></li>'; }).join('') + '</ul>' + '<button class="btn btn-ghost btn-sm" data-kc="productos" style="margin-top:10px">Ver detalle' + (top.length > 5 ? ' (' + top.length + ' productos)' : '') + '</button>' : '<p class="note">Aún no hay productos vendidos en este periodo.</p>';
    barChart($('anOrd'), { labels: S.map(function (x) { return axisLabel(x.t, D.bucket); }), values: S.map(function (x) { return x.orders; }), color: 'var(--accent)', aria: 'Pedidos por intervalo', tip: function (i) { var x = S[i]; return '<b>' + esc(fullLabel(x.t, D.bucket)) + '</b><br>' + x.orders + ' pedido' + (x.orders === 1 ? '' : 's') + (x.cancelled ? '<br><span class="mut">' + x.cancelled + ' cancelado' + (x.cancelled === 1 ? '' : 's') + '</span>' : ''); } });
    var stt = D.status || {}, tot = Object.keys(stt).reduce(function (s, k) { return s + stt[k]; }, 0);
    $('anSt').innerHTML = tot ? '<div class="stack" role="img" aria-label="Distribución de pedidos por estado">' + Object.keys(STL).filter(function (k) { return stt[k]; }).map(function (k) { return '<i style="width:' + stt[k] / tot * 100 + '%;background:' + STC[k] + '" title="' + STL[k] + ': ' + stt[k] + '"></i>'; }).join('') + '</div><ul class="legend">' + Object.keys(STL).filter(function (k) { return stt[k]; }).map(function (k) { return '<li><span class="sw" style="background:' + STC[k] + '"></span>' + STL[k] + '<b>' + stt[k] + ' · ' + (stt[k] / tot * 100).toFixed(0) + '%</b></li>'; }).join('') + '</ul>' : '<p class="note">Sin pedidos en este periodo.</p>';
    var hrs = D.hours || [], htot = hrs.reduce(function (s, v) { return s + v; }, 0), best = -1, bsum = 0; for (var h = 0; h < 24; h++) { var sm = hrs[h] + hrs[(h + 1) % 24]; if (sm > bsum) { bsum = sm; best = h; } }
    barChart($('anHr'), { labels: hrs.map(function (_, i) { return i + 'h'; }), values: hrs, color: 'var(--accent)', aria: 'Pedidos por hora del día', tip: function (i) { return '<b>' + i + ':00–' + i + ':59</b><br>' + hrs[i] + ' pedido' + (hrs[i] === 1 ? '' : 's'); } });
    $('anHrNote').textContent = htot >= 5 ? 'Franja de mayor actividad: ' + best + ':00 a ' + ((best + 2) % 24) + ':00 (' + bsum + ' pedidos).' : 'Aún no hay suficiente historial para señalar una franja (mínimo 5 pedidos).';
    var rc = st.recent;
    $('anRec').innerHTML = rc === null ? '<p class="note warn">No se pudo cargar la actividad reciente.</p>' : rc.length ? '<ul class="act">' + rc.map(function (o) { return '<li><span class="ac">#' + esc(String(o.id).slice(-4).toUpperCase()) + '</span><span class="am">' + esc(o.customer_name || 'Cliente') + (o.table_label ? ' · Mesa ' + esc(o.table_label) : '') + '<small>' + fmt(new Date(o.created_at), { day: 'numeric', month: 'short' }) + ' ' + new Date(o.created_at).toLocaleTimeString('es-CO', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) + '</small></span><span class="at"><b>' + money(o.total) + '</b><span class="st ' + esc(o.status) + '">' + esc(STL[o.status] || o.status) + '</span></span></li>'; }).join('') + '</ul><button class="btn btn-ghost btn-sm" data-goto="pedidos" style="margin-top:10px">Ver todos los pedidos</button>' : '<p class="note">Todavía no hay pedidos.</p>';
    var un = D.unavailable || { count: 0, names: [] };
    $('anAttCard').style.display = un.count ? '' : 'none';
    if (un.count) $('anAtt').innerHTML = '<p class="note" style="margin:0 0 8px">' + un.count + ' producto' + (un.count === 1 ? '' : 's') + ' marcado' + (un.count === 1 ? '' : 's') + ' como agotado' + (un.count === 1 ? '' : 's') + ':</p><ul class="act">' + un.names.map(function (n) { return '<li><span class="am">' + esc(n) + '</span></li>'; }).join('') + '</ul><button class="btn btn-ghost btn-sm" data-goto="productos" style="margin-top:10px">Gestionar productos</button>';
    $('hSections').style.display = '';
  }
  function paintError() {
    $('hCtx').textContent = 'No se pudieron cargar las métricas'; $('hChart').style.opacity = '1';
    $('hChart').innerHTML = '<div class="empty-in"><p class="note warn" style="margin:0">No pudimos obtener tus métricas ahora mismo. Tus pedidos y datos siguen intactos.</p><button class="btn btn-accent btn-sm" data-hretry>Reintentar</button></div>';
    $('hEmpty').style.display = 'none';
  }

  /* ---------- estructura ---------- */
  var btn = function (icon, title, sub, attr) { return '<button type="button" class="qa" ' + attr + '><span class="qi">' + svg(icon) + '</span><span>' + title + '<small>' + sub + '</small></span></button>'; };
  function mpCard() {
    var a = st.mp || { status: 'none' }, on = a.status === 'connected';
    var sub = a.unavailable ? 'No disponible por ahora' : on ? 'Conectado como ' + esc(a.display_name || 'tu cuenta') : a.status === 'error' ? esc(a.last_error || 'Error de conexión') : 'Conecta tu cuenta para cobrar online';
    return '<div class="qa wide mp"><span class="qi mpi">' + svg('card') + '</span><span style="flex:1;min-width:0">Mercado Pago<small>' + sub + '</small></span><label class="cc-open" title="' + (on ? 'Desconectar' : 'Conectar') + '"><input type="checkbox" id="mpSwitch" role="switch" ' + (on ? 'checked ' : '') + (a.unavailable ? 'disabled ' : '') + 'aria-label="Mercado Pago ' + (on ? 'conectado' : 'desconectado') + '"><span>' + (on ? 'Conectado' : 'Apagado') + '</span></label></div>';
  }
  function body() {
    var C = M.ctx, nombre = ((C.perfil && (C.perfil.panel_name || C.perfil.full_name)) || C.negocio.nombre || '').split(' ')[0];
    var plan = C.negocio.plan === 'free' || !C.negocio.plan ? 'Plan gratuito' : 'Plan ' + String(C.negocio.plan).toUpperCase();
    var skel = new Array(5).fill('<div class="kc"><div class="skel" style="height:12px;width:55%"></div><div class="skel" style="height:30px;width:70%;margin-top:12px"></div><div class="skel" style="height:11px;width:80%;margin-top:12px"></div></div>').join('');
    return '<div class="h2-top"><div><h2 class="h2-hi">Hola' + (nombre ? ', ' + esc(nombre) : '') + '</h2><div class="h2-date">' + esc((function (t) { return t.charAt(0).toUpperCase() + t.slice(1); })(fmt(new Date(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))) + ' · <span id="hCtx">Cargando…</span></div></div><div class="rng" id="hPer" role="radiogroup" aria-label="Periodo de las métricas"></div></div>' +
      '<div class="home-grid"><div class="home-main"><div class="kcards" id="kCards">' + skel + '</div>' +
      '<section class="hero" aria-label="Evolución de ingresos"><div class="hero-top"><div><div class="hl" id="hLbl">Ingresos cobrados</div><div class="big" id="hBig">—</div><div id="hDelta" class="dls"></div></div><div class="hstamp" id="hStamp"></div></div><div id="hChart" style="min-height:220px"><div class="skel" style="height:220px"></div></div>' +
      '<div class="h-empty" id="hEmpty" style="display:none"><div><b>Aún no hay pedidos en este periodo</b><p class="note" style="margin:6px 0 12px">Tus clientes harán su primer pedido cuando abran tu menú. Comparte tu QR o tu enlace para empezar; los ingresos aparecen aquí cuando marcas un pedido como pagado.</p><div class="row"><button class="btn btn-accent btn-sm" data-goto="qr">Compartir mi QR</button><button class="btn btn-ghost btn-sm" data-href="editor.html">Personalizar mi menú</button><button class="btn btn-ghost btn-sm" data-qa="newprod">Agregar producto</button></div></div></div></section></div>' +
      '<aside class="home-side" aria-label="Accesos rápidos"><h3 class="gh" style="margin-top:0">Accesos rápidos</h3><div class="side-grid">' +
      btn('brush', 'Personalizar mi menú', 'Editor visual', 'data-href="editor.html"') + btn('plus', 'Agregar producto', 'Crear uno nuevo', 'data-qa="newprod"') + btn('list', 'Ver mis pedidos', 'Gestiona los recibidos', 'data-goto="pedidos"') + btn('up', 'Mejorar mi plan', esc(plan) + ' · ver planes', 'data-href="index.html#precios"') +
      btn('editor', 'Mi página pública', 'Diseño y vista previa', 'data-goto="personalizar"') + btn('qr', 'Mi código QR', 'Descargar o compartir', 'data-goto="qr"') + btn('chart', 'Estadísticas completas', 'Visitas, pedidos y ventas', 'data-goto="metricas"') + btn('gear', 'Configurar restaurante', 'Datos y contacto', 'data-goto="configuracion"') + '</div></aside></div>' +
      '<div id="hSections" style="display:none"><div class="an-grid">' +
      '<section class="card"><h3>Productos más vendidos</h3><div id="anTop"></div></section>' +
      '<section class="card"><h3>Evolución de pedidos</h3><div id="anOrd"></div></section>' +
      '<section class="card"><h3>Distribución de pedidos</h3><div id="anSt"></div></section>' +
      '<section class="card"><h3>Actividad reciente</h3><div id="anRec"></div></section>' +
      '<section class="card"><h3>Horas de mayor actividad</h3><div id="anHr"></div><p class="note" id="anHrNote" style="margin:8px 0 0"></p></section>' +
      '<section class="card" id="anAttCard" style="display:none"><h3>Productos que requieren atención</h3><div id="anAtt"></div></section></div></div>' +
      '<h3 class="gh">Más herramientas</h3><div class="qa-grid" id="hTools">' + btn('eye', 'Menú público', 'Abrir en otra pestaña', 'data-qa="open"') + btn('share', 'Redes sociales', 'Instagram, WhatsApp, Maps…', 'data-qa="social"') + btn('users', 'Fidelización', 'Puntos y clientes', 'data-qa="loy:resumen"') + btn('card', 'Premios', 'Qué canjean con sus puntos', 'data-qa="loy:premios"') + btn('chart', 'Juegos', 'Ruleta diaria con puntos', 'data-qa="loy:juegos"') + btn('qr', 'Tarjeta de puntos', 'Diseña la del cliente', 'data-qa="loy:tarjeta"') + btn('users', 'Clientes', 'Quiénes te compran', 'data-goto="clientes"') + btn('card', 'Pagos', 'Estado de conexión', 'data-goto="pagos"') + '<span id="hMp" style="display:contents">' + mpCard() + '</span></div>';
  }
  M.home = {
    async render() {
      var host = $('homeBody'); if (!host) return; host.innerHTML = body();
      await Promise.all([refresh(true), fetchExtras().then(function () { var p = $('hMp'); if (p) p.innerHTML = mpCard(); })]);
      clearInterval(st.timer); st.timer = setInterval(function () { refresh(false); }, 20000);
    }
  };

  /* ---------- detalle por tarjeta ---------- */
  var detail = { kind: null, off: 0, rows: [] };
  function filterFor(kind, D) {
    return function (q) {
      if (kind === 'pendientes') return q.in('status', ['nuevo', 'preparando', 'listo']);
      q = q.gte('created_at', D.from).lt('created_at', D.to);
      if (kind === 'ingresos' || kind === 'ticket') return q.eq('paid', true).neq('status', 'cancelado');
      if (kind === 'rendimiento') return q.in('status', ['entregado', 'cancelado']);
      return q;
    };
  }
  var orderRow = function (o) { return '<li><span class="ac">#' + esc(String(o.id).slice(-4).toUpperCase()) + '</span><span class="am">' + esc(o.customer_name || 'Cliente') + (o.table_label ? ' · Mesa ' + esc(o.table_label) : '') + '<small>' + fmt(new Date(o.created_at), { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' + new Date(o.created_at).toLocaleTimeString('es-CO', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) + (o.paid ? ' · pagado' : ' · sin pagar') + '</small></span><span class="at"><b>' + money(o.total) + '</b><span class="st ' + esc(o.status) + '">' + esc(STL[o.status] || o.status) + '</span></span></li>'; };
  async function loadMore() {
    var C = M.ctx, D = st.data, box = $('dList'), more = $('dMore'); if (!box) return; more && (more.disabled = true);
    var q = C.sb.from('orders').select('id,table_label,customer_name,status,total,paid,created_at').eq('restaurant_id', C.rid); q = filterFor(detail.kind, D)(q);
    var r = await q.order('created_at', { ascending: false }).range(detail.off, detail.off + 19);
    if (r.error) { box.insertAdjacentHTML('beforeend', '<li class="note warn">No se pudo cargar la lista.</li>'); return; }
    var rows = r.data || []; if (!detail.off) box.innerHTML = ''; box.insertAdjacentHTML('beforeend', rows.map(orderRow).join('') || (detail.off ? '' : '<li class="note">No hay pedidos para mostrar.</li>'));
    detail.off += rows.length; if (more) { more.style.display = rows.length === 20 ? '' : 'none'; more.disabled = false; }
  }
  function openDetail(kind) {
    var D = st.data; if (!D) return M.ctx.toast('Aún se están cargando las métricas.');
    var cur = D.cur, prev = D.prev, row = function (l, v) { return '<div class="drow"><span>' + l + '</span><b>' + v + '</b></div>'; }, ip = D.in_progress || {};
    var T = { ingresos: 'Ingresos cobrados', pedidos: 'Pedidos recibidos', ticket: 'Ticket promedio', pendientes: 'Pedidos pendientes', rendimiento: 'Rendimiento', productos: 'Productos más vendidos' }[kind], h = '';
    if (kind === 'ingresos') h = row('Ingresos cobrados', money(cur.sales)) + row('Valor de pedidos (no cancelados)', money(cur.value)) + row('Por cobrar', money(cur.value - cur.sales)) + row('Pedidos pagados', cur.paid_orders) + (prev ? row('Periodo anterior', money(prev.sales) + ' ' + deltaHtml(cur.sales, prev.sales, '')) : '') + '<p class="note">Solo suma pedidos marcados como pagados y no cancelados. No es ganancia neta: no hay costos registrados.</p>';
    else if (kind === 'pedidos') h = row('Recibidos', cur.orders) + row('Válidos (no cancelados)', cur.valid_orders) + row('Cancelados', cur.cancelled) + row('Entregados', cur.delivered) + (prev ? row('Periodo anterior', prev.orders + ' ' + deltaHtml(cur.orders, prev.orders, '')) : '');
    else if (kind === 'ticket') h = row('Ticket promedio', cur.paid_orders ? money(ticket(cur)) : '—') + row('Ingresos cobrados', money(cur.sales)) + row('Pedidos pagados', cur.paid_orders) + (prev && prev.paid_orders ? row('Periodo anterior', money(ticket(prev))) : '') + '<p class="note">Ingresos cobrados ÷ pedidos pagados del periodo.</p>';
    else if (kind === 'pendientes') h = row('Nuevos', ip.nuevo || 0) + row('En preparación', ip.preparando || 0) + row('Listos para entregar', ip.listo || 0) + '<p class="note">Pedidos abiertos ahora, sin importar el periodo elegido.</p>';
    else if (kind === 'rendimiento') h = row('Entregados', cur.delivered + ' de ' + cur.valid_orders) + row('Tasa de entrega', cur.valid_orders ? (cur.delivered / cur.valid_orders * 100).toFixed(1) + '%' : '—') + row('Cancelados', cur.cancelled + (cur.orders ? ' (' + (cur.cancelled / cur.orders * 100).toFixed(1) + '%)' : '')) + '<p class="note">No existen estados de reembolso en KARTTA; las cancelaciones no suman a los ingresos.</p>';
    if (kind === 'productos') { var t = D.top || []; M.openModal('<div class="dh"><h3 id="kModalTitle">' + T + '</h3><button class="btn btn-ghost btn-sm" data-kclose aria-label="Cerrar">✕</button></div><p class="sub">' + esc(ctxLabel(D)) + '</p>' + (t.length ? '<ul class="act">' + t.map(function (x, i) { return '<li><span class="ac">' + (i + 1) + '</span><span class="am">' + esc(x.name) + '<small>' + x.qty + ' unidades</small></span><span class="at"><b>' + money(x.revenue) + '</b></span></li>'; }).join('') + '</ul>' : '<p class="note">Sin ventas en este periodo.</p>')); return; }
    detail = { kind: kind, off: 0, rows: [] };
    M.openModal('<div class="dh"><h3 id="kModalTitle">' + T + '</h3><button class="btn btn-ghost btn-sm" data-kclose aria-label="Cerrar">✕</button></div><p class="sub">' + (kind === 'pendientes' ? 'En este momento' : esc(ctxLabel(D))) + '</p><div class="dsum">' + h + '</div><h4 class="dsub">Pedidos incluidos</h4><ul class="act" id="dList"><li><div class="skel" style="height:44px;width:100%"></div></li></ul><button class="btn btn-ghost btn-sm" id="dMore" style="margin-top:10px;display:none">Cargar más</button>');
    loadMore();
  }

  /* ---------- modales: redes sociales y Mercado Pago ---------- */
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
      SOC.map(function (t) { var v = cur[t] ? cur[t].u : ''; return '<div class="field"><label for="soc_' + t + '">' + esc(D.SOCIAL_LABEL[t]) + '</label><input id="soc_' + t + '" data-soc="' + t + '" value="' + esc(v) + '" placeholder="' + esc(SOC_PH[t]) + '" autocomplete="off" inputmode="' + (t === 'whatsapp' ? 'tel' : 'url') + '"><div class="fmsg" id="socerr_' + t + '" style="min-height:14px"></div></div>'; }).join('') + '</div>' +
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
  async function reloadMp() { await fetchExtras(); var p = $('hMp'); if (p) p.innerHTML = mpCard(); if (M.views.pagos && document.querySelector('[data-panel=pagos].active')) M.views.pagos(); }
  document.addEventListener('change', async function (e) {
    if (e.target.id !== 'mpSwitch') return; var sw = e.target, want = sw.checked;
    if (want) { sw.checked = false; openMp(); return; }
    if (!await KDialog.confirm({ title: 'Desconectar Mercado Pago', message: '¿Desconectar Mercado Pago? Se borrará el token guardado.', ok: 'Desconectar', danger: true })) { sw.checked = true; return; }
    sw.disabled = true; var r = await mpCall('disconnect'); if (r.error) { M.ctx.toast(r.error); sw.checked = true; sw.disabled = false; return; } M.ctx.toast('Mercado Pago desconectado.'); await reloadMp();
  });
  document.addEventListener('click', async function (e) {
    if (e.target.closest('#socSave')) return saveSocial();
    if (e.target.closest('#dMore')) return loadMore();
    if (e.target.closest('[data-hretry]')) { $('hChart').innerHTML = '<div class="skel" style="height:220px"></div>'; return refresh(true); }
    var kc = e.target.closest('[data-kc]'); if (kc && $('homeBody') && $('homeBody').contains(kc)) return openDetail(kc.dataset.kc);
    var h = e.target.closest('[data-hr]'); if (h && h.dataset.hr !== st.period) { st.period = h.dataset.hr; $('hChart')._drawn = false; $('hChart').innerHTML = '<div class="skel" style="height:220px"></div>'; refresh(true); return; }
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
