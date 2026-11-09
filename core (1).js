// billing-checkout — (1) crea el cobro y firma la transacción en el SERVIDOR; (2) verifica el resultado contra la API de Wompi.
// El navegador solo envía ids (restaurante, plan, ciclo). Importe, moneda, referencia y firma de integridad salen de la BD y del servidor.
// Un plan NUNCA se activa aquí por "haber llegado" a una página de éxito: solo billing_apply_transaction (RPC solo-servidor)
// activa, y únicamente con los datos que devuelve la API de Wompi (estado, importe, moneda, referencia).
import { json, readBody, UUID, REFERENCE, dbCode } from '../_shared/http.js';
import { loadConfig, integritySignature, isoMs, fetchTransaction, fetchTransactionByReference } from '../_shared/wompi.js';

const PLAN_ID = /^[a-z0-9_]{2,30}$/;
const DB_STATUS = { forbidden: 403, restaurant_suspended: 403, plan_not_available: 400, annual_not_available: 400, price_not_configured: 400, invalid_cycle: 400,
  downgrade_not_allowed_until_period_end: 409, too_many_open_payments: 429, invalid_environment: 500, db_error: 500 };
const MANAGER_ROLES = ['owner', 'admin'];

function corsFor(req, env) {
  const origins = new Set();
  const app = String(env.APP_URL || '').trim().replace(/\/+$/, ''); if (app) origins.add(app);
  String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean).forEach((o) => origins.add(o));
  const o = req.headers.get('origin') || '';
  const base = { Vary: 'Origin', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  return origins.has(o) ? { ...base, 'Access-Control-Allow-Origin': o } : base;
}
const digits = (s) => String(s || '').replace(/[^0-9A-Za-z]/g, '');

/** deps: { env, admin, getUser(token) -> {id}|null, fetchFn } */
export async function handle(req, deps) {
  const { env, admin, getUser, fetchFn } = deps, cors = corsFor(req, env);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);

  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') || '');
  if (!m) return json({ error: 'unauthorized' }, 401, cors);
  let user = null; try { user = await getUser(m[1].trim()); } catch { user = null; }
  if (!user || !user.id) return json({ error: 'unauthorized' }, 401, cors);

  let body; try { body = JSON.parse(await readBody(req)); } catch (e) { return json({ error: e && e.code === 'payload_too_large' ? 'payload_too_large' : 'invalid_json' }, e && e.code === 'payload_too_large' ? 413 : 400, cors); }
  if (!body || typeof body !== 'object') return json({ error: 'invalid_request' }, 400, cors);

  const cfg = loadConfig(env);
  const appUrl = String(env.APP_URL || '').trim().replace(/\/+$/, '');
  if (!cfg.ok || !/^https:\/\/[^\s/?#]+$/i.test(appUrl)) {
    console.error('[billing-checkout] configuración:', cfg.ok ? 'APP_URL inválida (debe ser https://dominio, sin barra final)' : cfg.error, cfg.missing || cfg.wrong || '');
    return json({ error: 'payments_not_configured' }, 503, cors);
  }

  if (body.action === 'create') return create(body, user, cfg, appUrl, deps, cors);
  if (body.action === 'verify') return verify(body, user, cfg, deps, cors);
  return json({ error: 'invalid_action' }, 400, cors);
}

async function create(body, user, cfg, appUrl, { env, admin }, cors) {
  const rid = String(body.restaurant_id || ''), plan = String(body.plan || ''), cycle = body.cycle;
  if (!UUID.test(rid) || !PLAN_ID.test(plan) || !['monthly', 'annual'].includes(cycle)) return json({ error: 'invalid_request' }, 400, cors);

  // Solo dueño/administrador del restaurante (la RPC lo vuelve a comprobar).
  const mem = await admin.from('restaurant_members').select('role').eq('restaurant_id', rid).eq('user_id', user.id).maybeSingle();
  if (mem.error) return json({ error: 'db_error' }, 500, cors);
  if (!mem.data || !MANAGER_ROLES.includes(mem.data.role)) return json({ error: 'forbidden' }, 403, cors);

  const pf = await admin.from('billing_profiles').select('legal_name,document_type,document_number,billing_email,phone').eq('restaurant_id', rid).maybeSingle();
  if (pf.error) return json({ error: 'db_error' }, 500, cors);
  if (!pf.data) return json({ error: 'billing_profile_required' }, 400, cors);

  const prep = await admin.rpc('billing_prepare_checkout', { p_user: user.id, p_restaurant: rid, p_plan: plan, p_cycle: cycle, p_environment: cfg.environment });
  if (prep.error) { const code = dbCode(prep.error); return json({ error: code }, DB_STATUS[code] || 500, cors); }
  const p = prep.data || {};
  const amount = Number(p.amount_in_cents);
  if (!Number.isInteger(amount) || amount <= 0 || p.currency !== 'COP' || !REFERENCE.test(String(p.reference))) return json({ error: 'db_error' }, 500, cors);

  const expirationTime = isoMs(p.expires_at);
  const integrity = await integritySignature({ reference: p.reference, amountInCents: amount, currency: 'COP', expirationTime, secret: cfg.integritySecret });
  const prof = pf.data;
  const phone = String(prof.phone || '').replace(/[^0-9]/g, '').replace(/^57(?=\d{10}$)/, '');
  const widget = {
    currency: 'COP', amountInCents: amount, reference: p.reference, publicKey: cfg.publicKey, expirationTime,
    signature: { integrity },
    redirectUrl: `${appUrl}/checkout/processing/${p.reference}`,
    customerData: { email: prof.billing_email, fullName: prof.legal_name, legalId: digits(prof.document_number).replace(/[^0-9]/g, '') || digits(prof.document_number), legalIdType: prof.document_type === 'OTHER' ? 'CC' : prof.document_type,
      ...(phone.length >= 7 ? { phoneNumber: phone, phoneNumberPrefix: '+57' } : {}) },
  };
  return json({ ok: true, reference: p.reference, plan_id: p.plan_id, plan_name: p.plan_name, billing_cycle: p.billing_cycle, amount_in_cents: amount, widget }, 200, cors);
}

const APPROVED_RESULTS = new Set(['applied', 'duplicate']);
const DECLINED_RESULTS = new Set(['declined', 'error', 'voided', 'voided_revoked']);

async function verify(body, user, cfg, { admin, fetchFn }, cors) {
  const ref = String(body.reference || ''), txId = body.id == null ? '' : String(body.id);
  if (!REFERENCE.test(ref) || txId.length > 80) return json({ error: 'invalid_request' }, 400, cors);

  // El pago debe existir y pertenecer a un restaurante que este usuario administra; si no, 404 (no se revela nada).
  const pay = await admin.from('payments').select('restaurant_id,status,applied_at').eq('reference', ref).maybeSingle();
  if (pay.error) return json({ error: 'db_error' }, 500, cors);
  const mem = pay.data ? await admin.from('restaurant_members').select('role').eq('restaurant_id', pay.data.restaurant_id).eq('user_id', user.id).maybeSingle() : { data: null };
  if (!pay.data || mem.error || !mem.data || !MANAGER_ROLES.includes(mem.data.role)) return json({ error: 'not_found' }, 404, cors);
  if (String(pay.data.status).toUpperCase() === 'APPROVED' && pay.data.applied_at) return json({ ok: true, status: 'approved', reference: ref }, 200, cors);   // ya verificado y aplicado

  // La API de Wompi es la fuente de verdad. Un id que envía el navegador solo sirve si la API confirma que es de ESTA referencia.
  let tx = null;
  try {
    if (txId) { tx = await fetchTransaction(fetchFn, cfg, txId); if (tx && tx.reference !== ref) return json({ error: 'reference_mismatch' }, 409, cors); }
    if (!tx) tx = await fetchTransactionByReference(fetchFn, cfg, ref);
  } catch { return json({ ok: true, status: 'error', reference: ref }, 200, cors); }       // Wompi no responde: se trata como pendiente en pantalla
  if (!tx) return json({ ok: true, status: 'pending', reference: ref }, 200, cors);
  if (tx.reference !== ref) return json({ error: 'reference_mismatch' }, 409, cors);

  const r = await admin.rpc('billing_apply_transaction', { p_reference: ref, p_wompi_tx_id: tx.id, p_status: tx.status, p_amount_in_cents: tx.amount_in_cents, p_currency: tx.currency, p_payment_method: tx.payment_method_type, p_environment: cfg.environment });
  if (r.error) return json({ ok: true, status: 'error', reference: ref }, 200, cors);
  const result = (r.data && r.data.result) || 'unknown';
  if (result === 'amount_mismatch' || result === 'environment_mismatch') { console.error('[billing-checkout] ALERTA de integridad:', result, ref); return json({ ok: true, status: 'error', reference: ref }, 200, cors); }
  const status = APPROVED_RESULTS.has(result) ? 'approved' : DECLINED_RESULTS.has(result) ? 'declined' : 'pending';
  return json({ ok: true, status, reference: ref }, 200, cors);
}
