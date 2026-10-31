/**
 * KARTTA — Módulos del panel (fase 1): centro de control, estado de apertura, compartir menú,
 * filtros de pedidos y pagos. Usa el contexto que expone dashboard.html (window.KARTTA_CTX).
 * Todo lee/escribe con el cliente Supabase de la sesión (RLS); nada de claves aquí.
 */
(function () {
  'use strict';
  var C = null, $ = function (id) { return document.getElementById(id); };
  var K = (window.KARTTA_MODS = { views: {} });
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  K.esc = esc;
  var ICON = {
    editor: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    list: '<path d="M4 4h16v4H4zM4 12h16M4 16h10M4 20h6"/>',
    qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v.01M14 21h3M21 17v4"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    users: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1.5-4 4-6 7-6s5.5 2 7 6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>'
  };
  var svg = function (k) { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[k] + '</svg>'; };
  K.svg = svg;
  var shareText = function () { return (C.negocio.nombre ? 'Mira el menú de ' + C.negocio.nombre : 'Mira nuestro menú') + ': '; };

  /* ---------- estado real del restaurante (publicación + apertura) ---------- */
  var status = { loaded: false, suspended: false, open: null, openAvailable: true };
  async function loadStatus() {
    var base = await C.sb.from('restaurants').select('is_published,is_suspended,menu_configured').eq('id', C.rid).maybeSingle();
    if (!base.error && base.data) { status.suspended = !!base.data.is_suspended; status.published = !!base.data.is_published; status.configured = !!base.data.menu_configured; }
    var op = await C.sb.from('restaurants').select('is_open').eq('id', C.rid).maybeSingle();
    if (op.error) { status.openAvailable = false; status.open = null; } else { status.openAvailable = true; status.open = op.data ? op.data.is_open !== false : null; }
    status.loaded = true;
  }
  function publicationState() {
    if (status.suspended) return { k: 'bad', t: 'No disponible', d: 'Tu cuenta está suspendida.' };
    var configured = status.configured != null ? status.configured : !!C.negocio.menuConfigured;
    var published = status.published != null ? status.published : !!C.negocio.publicado;
    if (!configured || !C.productos.length) return { k: 'warn', t: 'Pendiente de configuración', d: C.productos.length ? 'Falta guardar el diseño del menú.' : 'Agrega productos y guarda el diseño.' };
    if (!published) return { k: 'pend', t: 'Borrador', d: 'El menú está listo pero aún no es público.' };
    return { k: 'ok', t: 'Publicado', d: 'Tus clientes ya pueden verlo.' };
  }

  /* ---------- Inicio: centro de control ---------- */
  function renderControl() {
    var head = $('ccHead'); if (!head) return;
    var p = publicationState();
    var openHtml;
    if (!status.openAvailable) openHtml = '<span class="pill pend" title="Aplica la migración 20261029_panel_fase1.sql">Estado de apertura no disponible</span>';
    else openHtml = '<label class="cc-open"><input type="checkbox" id="ccOpen" role="switch"' + (status.open !== false ? ' checked' : '') + ' aria-label="Restaurante abierto"><span id="ccOpenTxt">' + (status.open !== false ? 'Abierto' : 'Cerrado') + '</span></label>';
    head.innerHTML =
      '<div class="cc-head"><div><h1>' + esc(C.negocio.nombre || 'Mi restaurante') + '</h1><div class="cc-pills">' +
      '<span class="pill ' + p.k + '" title="' + esc(p.d) + '">Menú: ' + esc(p.t) + '</span>' +
      (status.openAvailable ? '<span class="pill ' + (status.open !== false ? 'ok' : 'pend') + '">' + (status.open !== false ? 'Recibiendo pedidos' : 'Cerrado temporalmente') + '</span>' : '') +
      '</div></div><div class="row" style="gap:14px;align-items:center">' + openHtml + '<button class="btn btn-ghost btn-sm" data-goto="configuracion" aria-label="Abrir configuración">' + svg('gear') + 'Configuración</button></div></div>';
    var sw = $('ccOpen');
    if (sw) sw.addEventListener('change', async function () {
      var want = sw.checked; sw.disabled = true;
      var r = await C.sb.rpc('set_restaurant_open', { p_restaurant_id: C.rid, p_open: want });
      sw.disabled = false;
      if (r.error) { sw.checked = !want; C.toast('No se pudo cambiar el estado. Intenta de nuevo.'); return; }
      status.open = want; C.toast(want ? 'Ahora recibes pedidos.' : 'Cerrado: no se recibirán pedidos.'); renderControl();
    });
  }
  function onQuick(e) {
    var b = e.target.closest('[data-href],[data-qa]'); if (!b) return;
    if (b.dataset.href) { location.href = b.dataset.href; return; }
    var a = b.dataset.qa;
    if (a === 'open') window.open(C.menuURL(), '_blank', 'noopener');
    else if (a === 'newprod') { C.irA('productos'); C.openProd(); }
    else if (a === 'social') { if (K.openSocial) K.openSocial(); }
    else if (a && a.indexOf('loy:') === 0) { if (K.openLoyalty) K.openLoyalty(a.slice(4)); else C.irA('fidelizacion'); }
    else if (a === 'contact') { C.irA('configuracion'); setTimeout(function () { var el = $('cfgWpp'); if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); } }, 350); }
  }

  /* ---------- Menú: compartir ---------- */
  function addShare() {
    var copy = $('menuCopy'); if (!copy || $('menuShare')) return;
    var row = copy.parentElement;
    var s = document.createElement('button'); s.className = 'btn btn-ghost'; s.id = 'menuShare'; s.type = 'button'; s.innerHTML = svg('share') + 'Compartir';
    var w = document.createElement('a'); w.className = 'btn btn-ghost'; w.id = 'menuWpp'; w.target = '_blank'; w.rel = 'noopener'; w.textContent = 'WhatsApp';
    row.appendChild(s); row.appendChild(w);
    var refresh = function () { w.href = 'https://wa.me/?text=' + encodeURIComponent(shareText() + C.menuURL()); };
    refresh(); w.addEventListener('click', refresh);
    s.addEventListener('click', async function () {
      var url = C.menuURL();
      if (navigator.share) { try { await navigator.share({ title: C.negocio.nombre || 'Menú', text: shareText().trim(), url: url }); } catch (e) { if (e && e.name !== 'AbortError') C.toast('No se pudo compartir.'); } }
      else { try { await navigator.clipboard.writeText(url); C.toast('Enlace copiado.'); } catch (e) { C.toast(url); } }
    });
  }

  /* ---------- Pedidos: filtros y búsqueda ---------- */
  var F = { st: 'todos', d: 'todos', pay: 'todos', q: '' };
  var dayKey = function (d) { return new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }); };
  window.KARTTA_PED_FILTER = function (o) {
    var st = o.status || 'nuevo';
    if (F.st !== 'todos' && st !== F.st) return false;
    if (F.pay === 'pagado' && !o.paid) return false;
    if (F.pay === 'sinpagar' && o.paid) return false;
    if (F.d !== 'todos') {
      var days = F.d === 'hoy' ? 0 : F.d === '7' ? 6 : 29, now = Date.now(), t = new Date(o.created_at).getTime();
      var from = new Date(dayKey(now) + 'T00:00:00-05:00').getTime() - days * 864e5;
      if (t < from) return false;
    }
    if (F.q) {
      var q = F.q.toLowerCase().replace(/^#/, '');
      var hay = [o.code, String(o.id || '').slice(-4), String(o.id || '').slice(0, 8), o.customer_name, o.customer_phone, o.table_label].map(function (x) { return String(x == null ? '' : x).toLowerCase(); });
      if (!hay.some(function (h) { return h.indexOf(q) >= 0; })) return false;
    }
    return true;
  };
  function addPedFilters() {
    var list = $('pedList'); if (!list || $('pedFilters')) return;
    var bar = document.createElement('div'); bar.className = 'fbar'; bar.id = 'pedFilters';
    bar.innerHTML =
      '<div class="field"><label for="pfQ">Buscar</label><input id="pfQ" type="search" placeholder="N.º de pedido, cliente o mesa" autocomplete="off"></div>' +
      '<div class="field"><label for="pfSt">Estado</label><select id="pfSt"><option value="todos">Todos</option><option value="nuevo">Nuevo</option><option value="preparando">Preparando</option><option value="listo">Listo</option><option value="entregado">Entregado</option><option value="cancelado">Cancelado</option></select></div>' +
      '<div class="field"><label for="pfD">Fecha</label><select id="pfD"><option value="todos">Todas</option><option value="hoy">Hoy</option><option value="7">Últimos 7 días</option><option value="30">Últimos 30 días</option></select></div>' +
      '<div class="field"><label for="pfPay">Pago</label><select id="pfPay"><option value="todos">Todos</option><option value="pagado">Pagados</option><option value="sinpagar">Sin pagar</option></select></div>';
    list.parentNode.insertBefore(bar, list);
    var none = document.createElement('p'); none.className = 'note'; none.id = 'pedNoMatch'; none.style.display = 'none'; none.textContent = 'Ningún pedido coincide con estos filtros.';
    list.parentNode.insertBefore(none, list.nextSibling);
    var t; var apply = function () { F.q = $('pfQ').value.trim(); F.st = $('pfSt').value; F.d = $('pfD').value; F.pay = $('pfPay').value; C.renderPedidos(); afterPed(); };
    bar.addEventListener('input', function (e) { if (e.target.id === 'pfQ') { clearTimeout(t); t = setTimeout(apply, 200); } });
    bar.addEventListener('change', apply);
  }
  function afterPed() {
    var n = document.querySelectorAll('#pedList .ped').length, tot = C.pedidos.length;
    var none = $('pedNoMatch'); if (none) none.style.display = tot && !n ? 'block' : 'none';
    var f = $('pedFilters'); if (f) f.style.display = tot ? 'flex' : 'none';
  }
  K.afterPed = function () { if (C) { afterPed(); window.dispatchEvent(new Event('kartta:data')); } };

  /* ---------- Pagos: estado de conexión (sin simular nada) ---------- */
  var PROVIDERS = [{ id: 'wompi', name: 'Wompi' }, { id: 'mercadopago', name: 'Mercado Pago' }];
  var STATE = { connected: ['ok', 'Conectada'], pending: ['warn', 'Pendiente'], error: ['bad', 'Con errores'], none: ['pend', 'Desconectada'] };
  async function renderPagos() {
    var host = $('modPagos'); if (!host) return;
    host.innerHTML = '<div class="card"><div class="skel" style="height:18px;width:40%"></div><div class="skel" style="height:14px;width:70%;margin-top:12px"></div></div>';
    var r = await C.sb.from('payment_accounts').select('provider,status,last_error,connected_at').eq('restaurant_id', C.rid);
    var avail = !r.error, rows = (r.data || []);
    var paid = C.pedidos.filter(function (o) { return o.paid && o.status !== 'cancelado'; });
    var paidTot = paid.reduce(function (s, o) { return s + Number(o.total || 0); }, 0);
    var pend = C.pedidos.filter(function (o) { return !o.paid && o.status !== 'cancelado'; });
    host.innerHTML =
      '<div class="vhead"><h2>Pagos</h2><p>Conexión con proveedores de pago online.</p></div>' +
      (avail ? '' : '<div class="card"><p class="note warn" style="margin:0">La conexión de pagos aún no está habilitada en tu base de datos (falta aplicar la migración <code>20261029_panel_fase1.sql</code>). Mientras tanto no hay ninguna cuenta conectada.</p></div>') +
      '<div class="card"><h3>Proveedores</h3><p class="sub">Un proveedor solo aparece como conectado cuando el servidor verifica la cuenta. Nunca se guardan datos de tarjetas ni claves en el navegador.</p>' +
      PROVIDERS.map(function (p) {
        var a = rows.filter(function (x) { return x.provider === p.id; })[0], st = a ? STATE[a.status] || STATE.none : STATE.none;
        return '<div class="prov"><div><strong style="color:var(--strong)">' + p.name + '</strong><div class="note">' + (a && a.status === 'error' && a.last_error ? esc(a.last_error) : a && a.connected_at ? 'Verificada el ' + new Date(a.connected_at).toLocaleDateString('es-CO') : 'Sin cuenta vinculada.') + '</div></div>' +
          '<div class="row"><span class="pill ' + st[0] + '">' + st[1] + '</span><button class="btn btn-ghost btn-sm" data-pay-help="' + p.id + '">' + (a && a.status === 'connected' ? 'Ver detalles' : 'Cómo vincular') + '</button></div></div>';
      }).join('') + '<div id="payHelp"></div></div>' +
      '<div class="grid-sum"><div class="sum"><div class="l">Pedidos marcados como pagados</div><div class="n">' + paid.length + '</div><div class="s">' + C.money(paidTot) + ' · confirmados manualmente por el restaurante</div></div>' +
      '<div class="sum"><div class="l">Pedidos pendientes de pago</div><div class="n">' + pend.length + '</div><div class="s">Aún sin confirmar</div></div></div>' +
      '<p class="note">Hoy los pagos se confirman a mano desde Pedidos (efectivo o transferencia). Los pagos online verificados por un proveedor aparecerán aquí cuando exista una cuenta conectada; un pedido nunca se marca como pagado solo porque el cliente abrió una página de pago.</p>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-pay-help]'); if (!b) return;
    var name = (PROVIDERS.filter(function (p) { return p.id === b.dataset.payHelp; })[0] || {}).name;
    $('payHelp').innerHTML = '<div class="card" style="margin:14px 0 0;background:var(--panel2)"><h3>Vincular ' + esc(name) + '</h3><p class="sub" style="margin:0">La vinculación automática todavía no está activa: depende de crear la cuenta del proveedor y desplegar su integración en el servidor. Pasos previstos:</p><ol class="steps"><li>Crear y aprobar la cuenta comercial en ' + esc(name) + '.</li><li>Guardar las credenciales solo como secretos del servidor (Edge Functions).</li><li>Registrar la URL del webhook verificado en el proveedor.</li><li>Autorizar la cuenta desde este panel; el estado cambiará a «Conectada» únicamente tras la verificación del servidor.</li></ol></div>';
  });

  /* ---------- ciclo de vida ---------- */
  K.views.pagos = renderPagos;
  async function init() {
    C = window.KARTTA_CTX; K.ctx = C;
    await loadStatus();
    var host = $('ccHost'); if (host) host.innerHTML = '<div id="ccHead"></div><div id="homeBody"></div>';
    renderControl(); if (K.home) K.home.render(); addShare(); addPedFilters(); afterPed();
    document.addEventListener('click', function (e) { if (e.target.closest('#ccHost')) onQuick(e); });
    
  }
  window.addEventListener('kartta:ready', init, { once: true });
  window.addEventListener('kartta:view', function (e) {
    if (!C) return; var v = e.detail;
    if (v === 'inicio') { renderControl(); }
    if (v === 'pedidos') { afterPed(); }
    if (K.views[v]) K.views[v]();
  });
})();
