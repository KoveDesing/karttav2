/* KARTTA — vista "Pagos" del restaurante: conecta SU cuenta Wompi, resumen e historial de pagos de pedidos.
 * Las claves se envían una sola vez a la función wompi-connect y se guardan en Supabase Vault; nunca se leen de vuelta.
 * El estado del pago (Wompi) es independiente del estado de preparación del pedido. */
(function () {
  'use strict';
  var K = window.KARTTA_MODS; if (!K) return;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return K.esc(s); };
  var C = null, acct = null, sum = null, rows = null, range = '30d', st = '', denied = false, busy = false;
  var RANGES = [['today', 'Hoy'], ['7d', '7 días'], ['30d', '30 días'], ['12m', '12 meses'], ['all', 'Todos']];
  var ST = { APPROVED: ['ok', 'Aprobado'], PENDING: ['warn', 'Pendiente'], DECLINED: ['bad', 'Rechazado'], ERROR: ['bad', 'Error'], VOIDED: ['bad', 'Anulado'] };
  var METHOD = { CARD: 'Tarjeta', NEQUI: 'Nequi', PSE: 'PSE', BANCOLOMBIA_TRANSFER: 'Bancolombia', BANCOLOMBIA_COLLECT: 'Bancolombia', DAVIPLATA: 'Daviplata' };
  var money = function (n) { return '$' + Math.round(Number(n || 0)).toLocaleString('es-CO'); };
  var fdate = function (iso) { return iso ? new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' }) : '—'; };
  var EVT = 'https://ifbvdjvukygvvgiyzgav.supabase.co/functions/v1/wompi-order-webhook?rid=';
  var ERR = {
    invalid_credentials_format: 'Revisa las claves: la pública empieza con pub_test_ o pub_prod_, la de integridad con test_integrity_ o prod_integrity_ y la de eventos con test_events_ o prod_events_.',
    environment_mixed: 'Las tres claves deben ser del mismo ambiente (todas de pruebas o todas de producción).',
    kartta_account_not_allowed: 'Esa es la cuenta de KARTTA. Usa las claves de TU propia cuenta Wompi.',
    wompi_rejected: 'Wompi no reconoce esa llave pública. Verifica que la copiaste completa.',
    wompi_unreachable: 'No pudimos contactar a Wompi. Intenta de nuevo en un momento.', wompi_error: 'Wompi respondió con un error. Intenta de nuevo.',
    forbidden: 'Solo el propietario o un administrador puede configurar los pagos.', unauthorized: 'Tu sesión venció. Vuelve a entrar.'
  };

  async function load() {
    C = K.ctx || window.KARTTA_CTX; if (!C) return;
    var a = await C.sb.from('payment_accounts').select('provider,status,enabled,environment,display_name,last_error,connected_at').eq('restaurant_id', C.rid).eq('provider', 'wompi').maybeSingle();
    acct = a.error ? null : a.data;
    var s = await C.sb.rpc('restaurant_payments_summary', { p_restaurant: C.rid, p_range: range });
    if (s.error) { denied = true; sum = null; rows = []; return; }
    denied = false; sum = s.data;
    var l = await C.sb.rpc('list_order_payments', { p_restaurant: C.rid, p_range: range, p_status: st || null, p_limit: 100, p_offset: 0 });
    rows = l.error ? [] : (l.data || []);
  }

  function connectCard() {
    var on = acct && acct.status === 'connected';
    var h = '<div class="card"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:10px"><div><h3 style="margin:0 0 4px">Cobros con tu cuenta Wompi</h3><p class="sub" style="margin:0">El dinero de tus pedidos entra directo a <strong>tu</strong> cuenta Wompi. KARTTA no recibe ni toca ese dinero.</p></div>' +
      '<span class="pill ' + (on ? 'ok' : 'pend') + '">' + (on ? 'Conectada' + (acct.environment === 'sandbox' ? ' · Pruebas' : '') : 'Desconectada') + '</span></div>';
    if (on) {
      h += '<p class="note" style="margin:12px 0 0">Comercio: <strong>' + esc(acct.display_name || 'Wompi') + '</strong> · conectado el ' + fdate(acct.connected_at) + '</p>' +
        '<div class="row" style="gap:10px;flex-wrap:wrap;margin-top:12px"><label class="row" style="gap:8px;cursor:pointer"><input type="checkbox" id="pgEnable"' + (acct.enabled ? ' checked' : '') + '> Mostrar «Pagar en línea» a mis clientes</label>' +
        '<button class="btn btn-ghost btn-sm" id="pgDisc">Desconectar</button></div>';
      if (acct.environment === 'sandbox') h += '<p class="note warn" style="margin:10px 0 0">Estás en ambiente de <strong>pruebas</strong>: no se cobra dinero real. Para cobrar de verdad conecta las claves de producción.</p>';
    } else {
      h += '<form id="pgForm" style="display:grid;gap:10px;max-width:520px;margin-top:14px" autocomplete="off">' +
        '<div class="field"><label for="pgPub">Llave pública</label><input id="pgPub" maxlength="120" placeholder="pub_test_… o pub_prod_…" required></div>' +
        '<div class="field"><label for="pgInt">Secreto de integridad</label><input id="pgInt" type="password" maxlength="120" placeholder="test_integrity_… o prod_integrity_…" required></div>' +
        '<div class="field"><label for="pgEv">Secreto de eventos</label><input id="pgEv" type="password" maxlength="120" placeholder="test_events_… o prod_events_…" required></div>' +
        '<button class="btn btn-accent" type="submit">Conectar Wompi</button><p class="note" id="pgMsg" style="margin:0"></p></form>' +
        '<p class="note" style="margin:12px 0 0">Encuéntralas en el panel de Wompi → Desarrolladores. Se guardan cifradas en el servidor y no se vuelven a mostrar. No pedimos tu llave privada.</p>';
    }
    h += '<details style="margin-top:14px"><summary style="cursor:pointer">Configuración en Wompi (una sola vez)</summary><ol class="steps"><li>En Wompi → Desarrolladores → <strong>URL de eventos</strong>, pega esta URL (en Pruebas y en Producción):<br><code style="word-break:break-all;user-select:all">' + esc(EVT + C.rid) + '</code></li><li>Copia la llave pública, el secreto de integridad y el secreto de eventos del mismo ambiente y conéctalos arriba.</li><li>Haz una compra de prueba con una tarjeta de Sandbox antes de pasar a producción.</li></ol></details></div>';
    return h;
  }

  function view() {
    var host = $('modPagos'); if (!host) return;
    if (denied) { host.innerHTML = '<div class="vhead"><h2>Pagos</h2></div><div class="card"><p class="sub" style="margin:0">Solo el propietario o un administrador puede ver y configurar los pagos.</p></div>'; return; }
    if (!sum) { host.innerHTML = '<div class="card"><div class="skel" style="height:18px;width:40%"></div></div>'; return; }
    var rb = RANGES.map(function (r) { return '<button class="btn btn-sm ' + (range === r[0] ? 'btn-accent' : 'btn-ghost') + '" data-pg-range="' + r[0] + '">' + r[1] + '</button>'; }).join('');
    var tbl = rows.length ? '<div style="overflow:auto"><table class="tbl" style="width:100%"><thead><tr><th>Fecha</th><th>Pedido</th><th>Monto</th><th>Pago</th><th>Método</th><th>Referencia</th><th>Preparación</th></tr></thead><tbody>' +
      rows.map(function (p) { var s = ST[p.status] || ['pend', esc(p.status)], o = p.order || {};
        return '<tr><td>' + fdate(p.paid_at || p.created_at) + '</td><td>#' + esc(o.code) + (o.table_label ? ' · Mesa ' + esc(o.table_label) : '') + '<div class="note" style="margin:0">' + esc(o.customer_name || '') + '</div></td><td>' + money(p.amount_cop) + '</td>' +
          '<td><span class="pill ' + s[0] + '">' + s[1] + '</span>' + (p.environment === 'sandbox' ? ' <span class="pill pend">Pruebas</span>' : '') + '</td><td>' + esc(METHOD[p.payment_method] || p.payment_method || '—') + '</td>' +
          '<td><code style="font-size:11px">' + esc(p.reference) + '</code></td><td>' + esc(o.status || '—') + '</td></tr>'; }).join('') + '</tbody></table></div>'
      : '<p class="note" style="margin:0">No hay pagos en este período.</p>';
    host.innerHTML = '<div class="vhead"><h2>Pagos</h2><p>Cobros en línea de tus pedidos con tu propia cuenta Wompi.</p></div>' + connectCard() +
      '<div class="card"><div class="row" style="gap:6px;flex-wrap:wrap">' + rb + '</div></div>' +
      '<div class="grid-sum"><div class="sum"><div class="l">Total cobrado</div><div class="n">' + money(sum.approved_cop) + '</div><div class="s">' + sum.approved_n + ' pagos aprobados</div></div>' +
      '<div class="sum"><div class="l">Pendientes</div><div class="n">' + sum.pending_n + '</div><div class="s">' + money(sum.pending_cop) + ' por confirmar</div></div>' +
      '<div class="sum"><div class="l">Rechazados</div><div class="n">' + sum.declined_n + '</div><div class="s">Rechazados, con error o anulados</div></div>' +
      '<div class="sum"><div class="l">Pedidos sin pagar</div><div class="n">' + sum.orders_unpaid_n + '</div><div class="s">Aún sin pago confirmado</div></div></div>' +
      '<div class="card"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:10px"><h3 style="margin:0">Historial</h3><select id="pgSt"><option value="">Todos</option><option value="APPROVED">Aprobados</option><option value="PENDING">Pendientes</option><option value="DECLINED,ERROR,VOIDED">Rechazados</option></select></div>' + tbl + '</div>' +
      '<p class="note">Un pedido solo se marca como pagado cuando Wompi lo confirma al servidor con firma verificada. El pago en efectivo o transferencia se sigue marcando a mano desde Pedidos.</p>';
    var sel = $('pgSt'); if (sel) sel.value = st;
  }

  async function refresh() { try { await load(); } catch (e) { console.error('[KARTTA] pagos', e); } view(); }
  async function call(body) { var r = await C.sb.functions.invoke('wompi-connect', { body: Object.assign({ restaurant_id: C.rid }, body) });
    if (r.error) { var j = null; try { j = await r.error.context.json(); } catch (e) { } return { error: (j && j.error) || 'server_error' }; } return r.data || {}; }

  document.addEventListener('submit', async function (e) {
    if (e.target.id !== 'pgForm') return; e.preventDefault(); if (busy) return; busy = true;
    var m = $('pgMsg'), b = e.target.querySelector('button'); b.disabled = true; m.textContent = 'Verificando con Wompi…';
    var res = await call({ action: 'connect', public_key: $('pgPub').value, integrity_secret: $('pgInt').value, events_secret: $('pgEv').value });
    busy = false;
    if (res.error) { b.disabled = false; m.textContent = ERR[res.error] || 'No se pudo conectar. Intenta de nuevo.'; m.classList.add('warn'); return; }
    ['pgPub', 'pgInt', 'pgEv'].forEach(function (i) { if ($(i)) $(i).value = ''; });
    refresh();
  });
  document.addEventListener('click', async function (e) {
    var r = e.target.closest('[data-pg-range]'); if (r && $('modPagos') && $('modPagos').contains(r)) { range = r.dataset.pgRange; refresh(); return; }
    if (e.target.id === 'pgDisc') { if (!window.confirm('¿Desconectar Wompi? Tus clientes dejarán de ver «Pagar en línea». El historial se conserva.')) return; var x = await call({ action: 'disconnect' }); if (x.error) window.alert(ERR[x.error] || 'No se pudo desconectar.'); refresh(); }
  });
  document.addEventListener('change', async function (e) {
    if (e.target.id === 'pgSt') { st = e.target.value; refresh(); }
    if (e.target.id === 'pgEnable') { var r = await C.sb.rpc('set_online_payments', { p_rid: C.rid, p_enabled: e.target.checked }); if (r.error) window.alert('No se pudo cambiar. Intenta de nuevo.'); refresh(); }
  });

  var prev = K.views.pagos;
  K.views.pagos = function () { C = K.ctx || window.KARTTA_CTX; if (!C) { if (prev) prev(); return; } sum = null; view(); refresh(); };
})();
