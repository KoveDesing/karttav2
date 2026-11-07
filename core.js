// admin-billing — puente entre el PANEL privado (otro proyecto Supabase) y las finanzas de KARTTA.
// 1) Valida la sesión del panel contra el Auth del proyecto del panel.  2) Exige que el correo esté autorizado
// (PANEL_ADMIN_EMAILS o public.panel_bridge_admins).  3) Llama a las RPC admin_billing_* con service_role (que además exigen el claim verificado).
// Solo operaciones de una lista cerrada, con argumentos validados. Los cambios quedan auditados con el correo del administrador.
import { json, readBody, UUID } from '../_shared/http.js';

const ENVS = ['sandbox', 'production'];
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
const str = (v, max) => (v == null || v === '' ? null : String(v).slice(0, max));

export function corsFor(req, env) {
  const allowed = String(env.PANEL_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  const origin = req.headers.get('origin') || '';
  const base = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' };
  return allowed.includes(origin) ? { ...base, 'Access-Control-Allow-Origin': origin } : base;
}

async function panelUser(fetchFn, env, token) {
  if (!env.PANEL_SUPABASE_URL || !env.PANEL_SUPABASE_KEY) return { error: 'panel_not_configured' };
  let r; try { r = await fetchFn(`${env.PANEL_SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, { headers: { apikey: env.PANEL_SUPABASE_KEY, Authorization: `Bearer ${token}` } }); } catch { return { error: 'panel_unreachable' }; }
  if (!r.ok) return { error: 'unauthorized' };
  const u = await r.json().catch(() => null);
  if (!u || !u.email || !u.email_confirmed_at && !u.confirmed_at) return { error: 'unauthorized' };
  return { email: String(u.email).toLowerCase() };
}

async function isAuthorized(admin, env, email) {
  const fixed = String(env.PANEL_ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  if (fixed.includes(email)) return true;
  const { data, error } = await admin.from('panel_bridge_admins').select('email').eq('email', email).limit(1);
  return !error && Array.isArray(data) && data.length > 0;            // si la tabla/columna no existe => se niega (falla cerrado)
}

const OPS = {
  overview: (a) => ['admin_billing_overview', { p_environment: ENVS.includes(a.environment) ? a.environment : 'production' }],
  series: (a) => {
    const days = num(a.days, 1, 730) || 30, g = ['day', 'week', 'month'].includes(a.granularity) ? a.granularity : 'day';
    return ['admin_billing_series', { p_environment: ENVS.includes(a.environment) ? a.environment : 'production', p_granularity: g,
      p_from: new Date(Date.now() - days * 864e5).toISOString(), p_to: new Date(Date.now() + 864e5).toISOString() }];
  },
  transactions: (a) => ['admin_billing_transactions', { p_environment: ENVS.includes(a.environment) ? a.environment : 'production', p_q: str(a.q, 80),
    p_status: ['PENDING', 'APPROVED', 'DECLINED', 'VOIDED', 'ERROR', 'EXPIRED'].includes(a.status) ? a.status : null,
    p_plan: /^[a-z0-9_-]{2,30}$/.test(a.plan || '') ? a.plan : null, p_cycle: ['monthly', 'annual'].includes(a.cycle) ? a.cycle : null,
    p_from: null, p_to: null, p_limit: num(a.limit, 1, 200) || 50, p_offset: num(a.offset, 0, 100000) || 0 }],
  customers: (a) => ['admin_billing_customers', { p_q: str(a.q, 80), p_limit: 40 }],
  customer: (a) => (UUID.test(a.restaurant_id || '') ? ['admin_billing_customer_detail', { p_restaurant: a.restaurant_id }] : null),
  set_fee: (a, who) => (UUID.test(a.payment_id || '') && num(a.fee_cop, 0, 1e9) != null ? ['admin_billing_set_fee', { p_payment: a.payment_id, p_fee_cop: num(a.fee_cop, 0, 1e9), p_actor: who }] : null),
  payout_add: (a, who) => (num(a.amount_cop, 1, 1e11) != null && /^\d{4}-\d{2}-\d{2}$/.test(a.paid_on || '')
    ? ['admin_billing_register_payout', { p_amount_cop: num(a.amount_cop, 1, 1e11), p_paid_on: a.paid_on, p_environment: ENVS.includes(a.environment) ? a.environment : 'production', p_reference: str(a.reference, 120), p_note: str(a.note, 300), p_actor: who }] : null),
  reminder: (a, who) => (UUID.test(a.restaurant_id || '') && ['trial_ending', 'renewal', 'expired'].includes(a.kind) ? ['admin_billing_send_reminder', { p_restaurant: a.restaurant_id, p_kind: a.kind, p_actor: who }] : null),
  payouts: (a) => ['admin_billing_list_payouts', { p_environment: ENVS.includes(a.environment) ? a.environment : 'production' }],
  settings_get: () => ['admin_billing_get_settings', {}],
  settings_update: (a, who) => (num(a.trial_days, 0, 365) != null && typeof a.annual_enabled === 'boolean' ? ['admin_billing_update_settings', { p_trial_days: num(a.trial_days, 0, 365), p_annual_enabled: a.annual_enabled, p_actor: who }] : null),
};

/** deps: { env, fetchFn, admin } */
export async function handle(req, deps) {
  const { env, fetchFn, admin } = deps, cors = corsFor(req, env);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'unauthorized' }, 401, cors);
  const u = await panelUser(fetchFn, env, token);
  if (u.error) return json({ error: u.error }, u.error === 'unauthorized' ? 401 : 503, cors);
  if (!(await isAuthorized(admin, env, u.email))) return json({ error: 'forbidden', email: u.email }, 403, cors);

  let b; try { b = JSON.parse(await readBody(req, 8 * 1024)); } catch { return json({ error: 'invalid_json' }, 400, cors); }
  const build = OPS[b && b.op];
  if (!build) return json({ error: 'invalid_op' }, 400, cors);
  const call = build(b.args || {}, u.email);
  if (!call) return json({ error: 'invalid_args' }, 400, cors);
  const r = await admin.rpc(call[0], call[1]);
  if (r.error) {
    const m = String(r.error.message || '');
    const known = ['invalid_fee', 'payment_not_approved', 'invalid_payout', 'annual_price_missing', 'invalid_trial_days', 'invalid_environment', 'range_too_large', 'reminder_rate_limited', 'no_subscription', 'restaurant_not_found', 'invalid_kind'].find((k) => m.includes(k));
    return json({ error: known || 'db_error' }, known ? 422 : 500, cors);
  }
  return json({ data: r.data }, 200, cors);
}
