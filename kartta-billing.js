/* KARTTA Payments — vista "Facturación" del dashboard del restaurante.
 * Solo LEE (billing_my_overview) y pide acciones a RPC con RLS (cancelar/reanudar renovación). Nunca activa planes:
 * el plan lo activa únicamente el servidor tras confirmar el pago con Wompi. No guarda datos de tarjeta. */
(function () {
  'use strict';
  var K = window.KARTTA_MODS; if (!K) return;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return K.esc(s); };
  var C = null, data = null, busy = false;

  var fmtMoney = function (n) { return '$' + new Intl.NumberFormat('es-CO').format(Number(n) || 0) + ' COP'; };
  var fmtDate = function (iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' });
  };
  var STATUS = {
    active: ['ok', 'Activo'], trialing: ['ok', 'Prueba gratuita'], pending_payment: ['pend', 'Pago pendiente'], past_due: ['warn', 'Pago vencido'],
    expired: ['bad', 'Vencido'], canceled: ['bad', 'Cancelado'], suspended: ['bad', 'Suspendido']
  };
  var PAY = { APPROVED: ['ok', 'Aprobado'], PENDING: ['pend', 'Pendiente'], DECLINED: ['bad', 'Rechazado'], ERROR: ['bad', 'Error'], VOIDED: ['bad', 'Anulado'], EXPIRED: ['bad', 'Expirado'] };
  var CYCLE = { monthly: 'Mensual', annual: 'Anual' };
  var pill = function (m, k) { var s = m[k] || ['pend', k || '—']; return '<span class="pill ' + s[0] + '">' + esc(s[1]) + '</span>'; };

  function daysLeft(iso) { return iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)) : 0; }

  function view() {
    var host = $('modBilling'); if (!host) return;
    if (!data) { host.innerHTML = '<div class="card"><p class="sub" style="margin:0">Cargando tu facturación…</p></div>'; return; }
    var s = data.subscription, eff = s ? s.effective_status : 'expired';
    var paid = s && s.plan_id !== 'free' && s.plan_id !== 'trial';
    var html = '<div class="card"><div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px"><div>' +
      '<h2 style="margin:0 0 4px">Facturación</h2><p class="sub" style="margin:0">Tu plan, tus pagos y la renovación.</p></div>' +
      '<a class="btn btn-accent" href="/checkout">' + (paid && eff === 'active' ? 'Cambiar o renovar plan' : 'Elegir un plan') + '</a></div></div>';

    if (!s) {
      html += '<div class="card"><p class="sub" style="margin:0">Todavía no hay una suscripción asociada a este restaurante.</p></div>';
    } else {
      var rows = [['Plan', esc(s.plan_name || s.plan_id)], ['Estado', pill(STATUS, eff)]];
      if (paid) rows.push(['Modalidad', esc(CYCLE[s.billing_cycle] || '—')]);
      if (eff === 'trialing') rows.push(['Prueba termina', fmtDate(s.trial_end || s.current_period_end) + ' · quedan ' + daysLeft(s.trial_end || s.current_period_end) + ' días']);
      else if (s.current_period_end) rows.push([s.cancel_at_period_end ? 'Acceso hasta' : (eff === 'active' ? 'Vigente hasta' : 'Venció el'), fmtDate(s.current_period_end)]);
      if (paid && eff === 'active') rows.push(['Renovación', s.cancel_at_period_end ? 'Cancelada (conservas el acceso hasta la fecha indicada)' : 'Manual: te avisaremos antes de que venza para que renueves']);
      html += '<div class="card"><dl class="kv" style="display:grid;grid-template-columns:max-content 1fr;gap:8px 18px;margin:0">' +
        rows.map(function (r) { return '<dt style="color:var(--muted)">' + r[0] + '</dt><dd style="margin:0">' + r[1] + '</dd>'; }).join('') + '</dl>';
      if (data.has_pending_payment) html += '<p class="note" style="margin-top:12px">Tienes un pago en proceso. Si ya pagaste, tu plan se activará en cuanto Wompi lo confirme.</p>';
      if (eff === 'past_due' || eff === 'expired') html += '<p class="note warn" style="margin-top:12px">Tu plan no está vigente, por eso algunas funciones están limitadas. Renueva para recuperarlas.</p>';
      html += '<div class="row" style="margin-top:14px;gap:8px;flex-wrap:wrap">';
      if (paid && eff === 'active' && !s.cancel_at_period_end) html += '<button class="btn btn-ghost btn-sm" data-bill="cancel">Cancelar renovación</button>';
      if (paid && eff === 'active' && s.cancel_at_period_end) html += '<button class="btn btn-ghost btn-sm" data-bill="resume">Reanudar renovación</button>';
      html += '</div></div>';
    }

    html += '<div class="card"><h3 style="margin-top:0">Historial de pagos</h3>';
    var pays = data.payments || [];
    if (!pays.length) html += '<p class="sub" style="margin:0">Aún no tienes pagos registrados.</p>';
    else html += '<div style="overflow:auto"><table class="tbl" style="width:100%"><thead><tr><th>Fecha</th><th>Plan</th><th>Modalidad</th><th>Importe</th><th>Estado</th><th>Referencia</th></tr></thead><tbody>' +
      pays.map(function (p) {
        return '<tr><td>' + fmtDate(p.confirmed_at || p.created_at) + '</td><td>' + esc(p.plan_id) + '</td><td>' + esc(CYCLE[p.billing_cycle] || '—') + '</td><td>' +
          fmtMoney(Number(p.amount_in_cents) / 100) + '</td><td>' + pill(PAY, p.status) + (p.environment === 'sandbox' ? ' <span class="pill pend">Prueba</span>' : '') +
          '</td><td><code>' + esc(p.reference) + '</code></td></tr>';
      }).join('') + '</tbody></table></div>';
    html += '</div>';
    html += '<p class="note" style="margin:8px 0 0">Los pagos los procesa Wompi. KARTTA no guarda datos de tu tarjeta.</p>';
    host.innerHTML = html;
  }

  async function load() {
    try {
      var r = await C.sb.rpc('billing_my_overview', { p_restaurant: C.rid });
      if (r.error) throw r.error;
      data = r.data; view();
    } catch (e) {
      var host = $('modBilling');
      if (host) host.innerHTML = '<div class="card"><p class="note warn" style="margin:0">No pudimos cargar tu facturación. Si el problema continúa, escribe a soporte.</p></div>';
      console.error('[KARTTA billing]', e && e.message);
    }
  }

  async function act(kind) {
    if (busy) return; busy = true;
    try {
      if (kind === 'cancel' && !window.confirm('¿Cancelar la renovación? Conservarás tu plan hasta el final del periodo pagado.')) return;
      var r = await C.sb.rpc(kind === 'cancel' ? 'billing_cancel_subscription' : 'billing_resume_subscription', { p_restaurant: C.rid });
      if (r.error) throw r.error;
      C.toast(kind === 'cancel' ? 'Renovación cancelada. Conservas el acceso hasta el final del periodo.' : 'Renovación reanudada.');
      await load();
    } catch (e) { C.toast('No se pudo completar la acción. Intenta de nuevo.'); console.error('[KARTTA billing]', e && e.message); }
    finally { busy = false; }
  }

  document.addEventListener('click', function (e) { var b = e.target.closest('[data-bill]'); if (b) act(b.dataset.bill); });
  K.views.facturacion = function () { C = K.ctx || window.KARTTA_CTX; if (!C) return; data = null; view(); load(); };
})();
