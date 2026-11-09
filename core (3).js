// billing-cron — tarea diaria (sin depender de que el cliente abra la página):
//   1) concilia pagos CREATED/PENDING contra Wompi (webhook perdido)  2) mantenimiento de suscripciones y avisos  3) envío de correos.
import { json } from '../_shared/http.js';
import { loadConfig, timingSafeEqual, fetchTransaction, fetchTransactionByReference } from '../_shared/wompi.js';
import { renderEmail } from '../_shared/email-templates.js';
import { sendEmail, mailerConfigured } from '../_shared/mailer.js';

/** deps: { env, fetchFn, admin } — admin: cliente service_role (incluye admin.auth.admin.getUserById). */
export async function handle(req, deps) {
  const { env, fetchFn, admin } = deps, cors = {};
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);
  const secret = env.CRON_SECRET || '';
  const given = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') || req.headers.get('x-cron-secret') || '';
  if (secret.length < 24 || !timingSafeEqual(given, secret)) return json({ error: 'unauthorized' }, 401, cors);

  const out = { reconciled: 0, reconcile_errors: 0, maintenance: null, emails: { sent: 0, failed: 0, deferred: 0, skipped: 0 } };
  const cfg = loadConfig(env);

  // 1) conciliación
  if (cfg.ok) {
    const list = await admin.rpc('billing_list_reconcilable', { p_environment: cfg.environment });
    for (const p of (list.data || [])) {
      try {
        const tx = p.wompi_transaction_id ? await fetchTransaction(fetchFn, cfg, p.wompi_transaction_id) : await fetchTransactionByReference(fetchFn, cfg, p.reference);
        if (!tx || tx.reference !== p.reference) continue;
        const r = await admin.rpc('billing_apply_transaction', { p_reference: p.reference, p_wompi_tx_id: tx.id, p_status: tx.status, p_amount_in_cents: tx.amount_in_cents,
          p_currency: tx.currency, p_payment_method: tx.payment_method_type, p_environment: cfg.environment });
        if (!r.error && r.data && r.data.ok && r.data.result !== 'pending') out.reconciled++;
      } catch { out.reconcile_errors++; }
    }
  } else { out.reconcile_skipped = cfg.error; }

  // 2) mantenimiento (vencimientos + avisos programados, idempotente)
  const m = await admin.rpc('billing_run_maintenance');
  if (m.error) return json({ error: 'maintenance_failed' }, 500, cors);
  out.maintenance = m.data;

  // 3) correos
  if (!mailerConfigured(env)) { out.emails.deferred = (m.data && m.data.notifications_pending) || 0; out.emails.note = 'email_not_configured'; return json({ ok: true, ...out }, 200, cors); }
  const appUrl = String(env.APP_URL || '').replace(/\/$/, '');
  const claimed = await admin.rpc('billing_claim_notifications', { p_limit: 40 });
  for (const n of (claimed.data || [])) {
    const mark = (status, error, pid) => admin.rpc('billing_mark_notification', { p_id: n.id, p_status: status, p_error: error || null, p_provider_id: pid || null });
    try {
      const u = n.owner_id ? await admin.auth.admin.getUserById(n.owner_id) : null;
      const to = u && u.data && u.data.user && u.data.user.email;
      const mail = to ? renderEmail(n.notification_type, n.context, { appUrl, restaurant: n.restaurant_name }) : null;
      if (!to || !mail) { await mark('skipped', to ? 'unknown_template' : 'no_recipient'); out.emails.skipped++; continue; }
      const s = await sendEmail(fetchFn, env, { to, ...mail, idempotencyKey: `kartta-notif-${n.id}` });
      if (s.ok) { await mark('sent', null, s.id); out.emails.sent++; }
      else if (s.notConfigured) { await mark('pending', s.error); out.emails.deferred++; }
      else { await mark('failed', s.error); out.emails.failed++; }
    } catch (e) { await mark('failed', 'exception'); out.emails.failed++; }
  }
  return json({ ok: true, ...out }, 200, cors);
}
