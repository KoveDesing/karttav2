// wompi-webhook — recibe eventos de Wompi. Flujo (docs §7): firma -> evento transaction.updated -> consulta REAL a la API de Wompi ->
// importe/moneda/referencia/ambiente contra nuestra BD -> aplicación atómica e idempotente (RPC). Nada del cuerpo del evento
// (salvo el id y la firma) se usa para decidir: el estado y el importe salen de la API.
import { json, readBody } from '../_shared/http.js';
import { loadConfig, verifyEventSignature, fetchTransaction } from '../_shared/wompi.js';

const FINAL_FOR_EVENT = { applied: 'verified', duplicate: 'duplicate', pending: 'verified', declined: 'verified', error: 'verified', voided: 'verified', voided_revoked: 'verified',
  ignored_other_transaction: 'duplicate', amount_mismatch: 'mismatch', environment_mismatch: 'mismatch', unknown_reference: 'unknown_reference' };

/** deps: { env, fetchFn, admin } */
export async function handle(req, deps) {
  const { env, fetchFn, admin } = deps, cors = {};
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);

  let raw; try { raw = await readBody(req); } catch { return json({ error: 'payload_too_large' }, 413, cors); }
  let ev; try { ev = JSON.parse(raw); } catch { return json({ error: 'invalid_json' }, 400, cors); }
  if (!ev || typeof ev !== 'object' || !ev.data || typeof ev.data !== 'object') return json({ error: 'invalid_event' }, 400, cors);

  const cfg = loadConfig(env);
  if (!cfg.ok) { console.error('[wompi-webhook] configuración:', cfg.error, cfg.missing || cfg.wrong || ''); return json({ error: 'not_configured' }, 503, cors); }   // 5xx: Wompi reintenta

  // 1) firma (con el secreto de eventos del ambiente configurado)
  const sig = await verifyEventSignature(ev, req.headers.get('x-event-checksum'), cfg.eventsSecret);
  const txIn = (ev.data && ev.data.transaction) || {};
  if (!sig.ok) {
    await admin.rpc('billing_log_rejected_event', { p_reason: sig.reason, p_environment: String(ev.environment || ''), p_transaction_id: String(txIn.id || '') });
    return json({ error: 'invalid_signature' }, 401, cors);
  }
  // 2) ambiente del evento (test|prod) debe ser el configurado
  if (ev.environment && ev.environment !== cfg.eventEnvironment) return json({ ok: true, ignored: 'other_environment' }, 200, cors);
  if (ev.event !== 'transaction.updated') return json({ ok: true, ignored: 'event_type' }, 200, cors);
  const txId = String(txIn.id || ''), reference = String(txIn.reference || '');
  if (!txId) return json({ error: 'invalid_event' }, 400, cors);
  if (reference && !reference.startsWith('KT-')) return json({ ok: true, ignored: 'not_kartta_reference' }, 200, cors);   // el comercio puede cobrar otras cosas

  // 3) registro del evento (idempotente por checksum). Los reenvíos incrementan `attempts`, no crean filas.
  const rec = await admin.rpc('billing_record_event', { p_event_reference: ev.signature.checksum, p_event_type: ev.event, p_transaction_id: txId, p_reference: reference || null,
    p_environment: cfg.environment, p_payload: { transaction: { id: txId, reference, status: txIn.status, amount_in_cents: txIn.amount_in_cents, currency: txIn.currency, payment_method_type: txIn.payment_method_type } } });
  if (rec.error) return json({ error: 'temporary_error' }, 500, cors);
  const evId = rec.data && rec.data.id;

  // 4) estado REAL desde la API de Wompi
  let tx;
  try { tx = await fetchTransaction(fetchFn, cfg, txId); } catch (e) {
    if (evId) await admin.rpc('billing_finish_event', { p_id: evId, p_verification: 'error', p_result: String(e.message || 'wompi_error').slice(0, 80) });
    return json({ error: 'wompi_unavailable' }, 503, cors);        // Wompi reintenta
  }
  if (!tx) { if (evId) await admin.rpc('billing_finish_event', { p_id: evId, p_verification: 'mismatch', p_result: 'transaction_not_found' }); return json({ ok: true, ignored: 'transaction_not_found' }, 200, cors); }
  if (tx.id !== txId || (reference && tx.reference !== reference) || !tx.reference.startsWith('KT-')) {
    if (evId) await admin.rpc('billing_finish_event', { p_id: evId, p_verification: 'mismatch', p_result: 'reference_mismatch' });
    return json({ ok: true, ignored: 'reference_mismatch' }, 200, cors);
  }

  // 5) aplicar con los datos de la API (no los del evento)
  const r = await admin.rpc('billing_apply_transaction', { p_reference: tx.reference, p_wompi_tx_id: tx.id, p_status: tx.status, p_amount_in_cents: tx.amount_in_cents,
    p_currency: tx.currency, p_payment_method: tx.payment_method_type, p_environment: cfg.environment });
  if (r.error) {
    if (evId) await admin.rpc('billing_finish_event', { p_id: evId, p_verification: 'error', p_result: 'db_error' });
    return json({ error: 'temporary_error' }, 500, cors);
  }
  const result = (r.data && r.data.result) || 'unknown';
  if (evId) await admin.rpc('billing_finish_event', { p_id: evId, p_verification: FINAL_FOR_EVENT[result] || 'verified', p_result: result });
  if (result === 'amount_mismatch' || result === 'environment_mismatch') console.error('[wompi-webhook] ALERTA de integridad:', result, tx.reference);
  return json({ ok: true, result }, 200, cors);
}
