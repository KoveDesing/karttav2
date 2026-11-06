// billing-checkout — crea el cobro (precio SIEMPRE desde la BD) y verifica activamente una transacción.
// Nunca activa un plan por una petición del navegador: solo `billing_apply_transaction` (RPC solo-servidor) lo hace, con datos
// traídos desde la API de Wompi. Lógica sin dependencias de Deno para probarla en Node.
import { json, readBody, dbCode, UUID, REFERENCE } from '../_shared/http.js';
import { loadConfig, integritySignature, isoMs, fetchTransaction, fetchTransactionByReference } from '../_shared/wompi.js';

const PLAN = /^[a-z0-9_-]{2,30}$/;
const TX_ID = /^[A-Za-z0-9_-]{3,80}$/;

export function corsFor(req, env) {
  const allowed = String(env.ALLOWED_ORIGINS || env.APP_URL || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  const origin = req.headers.get('origin') || '';
  const base = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' };
  return allowed.includes(origin) ? { ...base, 'Access-Control-Allow-Origin': origin } : base;
}

const phoneParts = (raw) => {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10) return { prefix: '+57', number: d };
  if (d.length === 12 && d.startsWith('57')) return { prefix: '+57', number: d.slice(2) };
  return null;
};

async function isManager(admin, restaurantId, userId) {
  const { data } = await admin.from('restaurant_members').select('role').eq('restaurant_id', restaurantId).eq('user_id', userId).maybeSingle();
  return !!data && ['owner', 'admin'].includes(data.role);
}

const uiStatus = { APPROVED: 'approved', PENDING: 'pending', DECLINED: 'declined', ERROR: 'declined', VOIDED: 'declined' };

/** deps: { env, fetchFn, admin, getUser(token) -> {id}|null, cors } */
export async function handle(req, deps) {
  const { env, fetchFn, admin, getUser } = deps;
  const cors = deps.cors || corsFor(req, env);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const user = token ? await getUser(token) : null;
  if (!user || !user.id) return json({ error: 'unauthorized' }, 401, cors);

  let b; try { b = JSON.parse(await readBody(req, 8 * 1024)); } catch { return json({ error: 'invalid_json' }, 400, cors); }
  if (!b || typeof b !== 'object') return json({ error: 'invalid_request' }, 400, cors);

  const cfg = loadConfig(env);
  if (!cfg.ok) { console.error('[billing-checkout] configuración Wompi:', cfg.error, cfg.missing || cfg.wrong || ''); return json({ error: 'payments_not_configured' }, 503, cors); }

  // ------------------------------------------------------------------ create
  if (b.action === 'create') {
    // Los campos de precio/importe que envíe el navegador se IGNORAN: solo se leen restaurante, plan y modalidad.
    const rid = String(b.restaurant_id || ''), plan = String(b.plan || ''), cycle = String(b.cycle || '');
    if (!UUID.test(rid) || !PLAN.test(plan) || !['monthly', 'annual'].includes(cycle)) return json({ error: 'invalid_request' }, 400, cors);
    if (!(await isManager(admin, rid, user.id))) return json({ error: 'forbidden' }, 403, cors);
    if (!env.APP_URL || !/^https:\/\/|^http:\/\/localhost/.test(env.APP_URL)) return json({ error: 'app_url_not_configured' }, 503, cors);

    const prof = await admin.from('billing_profiles').select('legal_name,document_type,document_number,billing_email,phone').eq('restaurant_id', rid).maybeSingle();
    if (!prof.data) return json({ error: 'billing_profile_required' }, 422, cors);

    const prep = await admin.rpc('billing_prepare_checkout', { p_user: user.id, p_restaurant: rid, p_plan: plan, p_cycle: cycle, p_environment: cfg.environment });
    if (prep.error) { const code = dbCode(prep.error); return json({ error: code }, code === 'db_error' ? 500 : code === 'forbidden' ? 403 : 409, cors); }
    const pay = prep.data;
    const expirationTime = isoMs(pay.expires_at);
    const signature = await integritySignature({ reference: pay.reference, amountInCents: pay.amount_in_cents, currency: pay.currency, expirationTime, secret: cfg.integritySecret });

    const p = prof.data, ph = phoneParts(p.phone);
    const customerData = { email: p.billing_email, fullName: p.legal_name, legalId: String(p.document_number).replace(/[^A-Za-z0-9]/g, ''), legalIdType: p.document_type,
      ...(ph ? { phoneNumber: ph.number, phoneNumberPrefix: ph.prefix } : {}) };
    return json({
      reference: pay.reference, plan_id: pay.plan_id, plan_name: pay.plan_name, billing_cycle: pay.billing_cycle, environment: cfg.environment,
      widget: { currency: pay.currency, amountInCents: Number(pay.amount_in_cents), reference: pay.reference, publicKey: cfg.publicKey, signature: { integrity: signature },
        redirectUrl: `${env.APP_URL.replace(/\/$/, '')}/checkout/processing/${pay.reference}`, expirationTime, customerData },
    }, 200, cors);
  }

  // ------------------------------------------------------------------ verify
  if (b.action === 'verify') {
    const ref = String(b.reference || ''), wid = b.id == null || b.id === '' ? null : String(b.id);
    if (!REFERENCE.test(ref) || (wid && !TX_ID.test(wid))) return json({ error: 'invalid_request' }, 400, cors);
    const { data: pay } = await admin.from('payments').select('id,restaurant_id,reference,status,applied_at,wompi_transaction_id,environment').eq('reference', ref).maybeSingle();
    if (!pay || !(await isManager(admin, pay.restaurant_id, user.id))) return json({ error: 'not_found' }, 404, cors);   // misma respuesta: no se revela si existe
    if (pay.environment !== cfg.environment) return json({ error: 'environment_mismatch' }, 409, cors);
    if (pay.status === 'APPROVED' && pay.applied_at) return json({ status: 'approved', result: 'already_applied' }, 200, cors);

    let tx;
    try {
      const txId = wid || pay.wompi_transaction_id;
      tx = txId ? await fetchTransaction(fetchFn, cfg, txId) : await fetchTransactionByReference(fetchFn, cfg, ref);
    } catch (e) { return json({ error: 'wompi_unavailable' }, 503, cors); }
    if (!tx) return json({ status: 'pending', result: 'not_found_yet' }, 200, cors);            // el cliente puede seguir pagando
    if (tx.reference !== ref) { console.warn('[billing-checkout] id de transacción de otra referencia'); return json({ error: 'reference_mismatch' }, 409, cors); }

    const r = await admin.rpc('billing_apply_transaction', { p_reference: ref, p_wompi_tx_id: tx.id, p_status: tx.status, p_amount_in_cents: tx.amount_in_cents,
      p_currency: tx.currency, p_payment_method: tx.payment_method_type, p_environment: cfg.environment });
    if (r.error) return json({ error: 'db_error' }, 500, cors);
    const res = r.data || {};
    if (!res.ok) return json({ status: 'error', result: res.result }, 200, cors);
    const status = res.result === 'applied' || res.result === 'duplicate' ? 'approved' : (uiStatus[tx.status] || 'pending');
    return json({ status, result: res.result, period_end: res.period_end || null }, 200, cors);
  }
  return json({ error: 'invalid_action' }, 400, cors);
}
