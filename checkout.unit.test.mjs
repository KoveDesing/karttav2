// Pruebas LOCALES de billing-checkout/core.js con una BD y un Wompi SIMULADOS (sin Postgres ni red).
// Verifican la lógica del servidor (autorización, precio fijado en servidor, firma, verificación). NO sustituyen:
//   - billing.test.mjs (necesita Postgres local: usa las funciones SQL reales)
//   - las pruebas en Sandbox REAL de Wompi (ver LEEME_DESPLIEGUE.md §9)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import * as checkout from '../../supabase/functions/billing-checkout/core.js';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const ENV = { WOMPI_ENVIRONMENT: 'sandbox', WOMPI_PUBLIC_KEY: 'pub_test_AAAA', WOMPI_PRIVATE_KEY: 'prv_test_BBBB', WOMPI_EVENTS_SECRET: 'test_events_CCCC', WOMPI_INTEGRITY_SECRET: 'test_integrity_DDDD', APP_URL: 'https://kartta.food' };
const RA = 'aaaaaaaa-0000-0000-0000-000000000001', RB = 'bbbbbbbb-0000-0000-0000-000000000002';
const PRICES = { kartta: { monthly: 43900, annual: 263400 }, pro: { monthly: 84900, annual: 509400 } };

function fakeDb() {
  const members = [{ restaurant_id: RA, user_id: 'ua', role: 'owner' }, { restaurant_id: RA, user_id: 'us', role: 'staff' }, { restaurant_id: RB, user_id: 'ub', role: 'owner' }];
  const profiles = [{ restaurant_id: RA, legal_name: 'Resto A SAS', document_type: 'NIT', document_number: '900123456-7', billing_email: 'a@a.co', phone: '3001112233' }];
  const payments = [];
  const tables = { restaurant_members: members, billing_profiles: profiles, payments };
  const from = (t) => { const w = []; const b = { select: () => b, eq: (c, v) => (w.push([c, v]), b), maybeSingle: async () => ({ data: tables[t].find((r) => w.every(([c, v]) => r[c] === v)) || null, error: null }) }; return b; };
  const rpc = async (name, a) => {
    if (name === 'billing_prepare_checkout') {
      const mem = members.find((m) => m.restaurant_id === a.p_restaurant && m.user_id === a.p_user && ['owner', 'admin'].includes(m.role));
      if (!mem) return { error: { message: 'forbidden' } };
      const pr = PRICES[a.p_plan]; if (!pr) return { error: { message: 'plan_not_available' } };
      const ref = 'KT-' + randomBytes(10).toString('hex').toUpperCase();
      const amount = pr[a.p_cycle] * 100;
      payments.push({ reference: ref, restaurant_id: a.p_restaurant, status: 'CREATED', amount_in_cents: amount, plan_id: a.p_plan, environment: a.p_environment, applied_at: null });
      return { data: { reference: ref, amount_in_cents: amount, currency: 'COP', plan_id: a.p_plan, plan_name: a.p_plan, billing_cycle: a.p_cycle, expires_at: new Date(Date.now() + 3600e3).toISOString() }, error: null };
    }
    if (name === 'billing_apply_transaction') {
      const p = payments.find((x) => x.reference === a.p_reference); if (!p) return { data: { ok: false, result: 'unknown_reference' } };
      if (p.environment !== a.p_environment) return { data: { ok: false, result: 'environment_mismatch' } };
      if (Number(a.p_amount_in_cents) !== Number(p.amount_in_cents) || a.p_currency !== 'COP') return { data: { ok: false, result: 'amount_mismatch' } };
      if (a.p_status === 'APPROVED') { if (p.applied_at) return { data: { ok: true, result: 'duplicate' } }; p.status = 'APPROVED'; p.applied_at = new Date().toISOString(); return { data: { ok: true, result: 'applied' } }; }
      p.status = a.p_status; return { data: { ok: true, result: a.p_status.toLowerCase() } };
    }
    return { error: { message: 'unknown_rpc' } };
  };
  return { admin: { from, rpc }, payments };
}
const users = { ta: { id: 'ua' }, ts: { id: 'us' }, tb: { id: 'ub' }, tx: { id: 'ux' } };
const call = async (body, token, deps) => { const r = await checkout.handle(new Request('https://fn.test/x', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) }), deps); return { status: r.status, body: await r.json() }; };
const wompiMap = (map, down = false) => async (url) => { if (down) return new Response('x', { status: 503 }); const u = new URL(url);
  if (u.pathname.endsWith('/transactions')) return new Response(JSON.stringify({ data: Object.values(map).filter((t) => t.reference === u.searchParams.get('reference')) }), { status: 200 });
  const t = map[decodeURIComponent(u.pathname.split('/').pop())]; return t ? new Response(JSON.stringify({ data: t }), { status: 200 }) : new Response('{}', { status: 404 }); };
const mk = (extra = {}) => { const db = fakeDb(); const map = {}; return { db, map, deps: { env: ENV, admin: db.admin, getUser: async (t) => users[t] || null, fetchFn: wompiMap(map), ...extra } }; };

test('crear: sin sesión 401; extraño y staff 403; precio solo del servidor; firma correcta; sin secretos', async () => {
  const { deps } = mk();
  assert.equal((await call({ action: 'create', restaurant_id: RA, plan: 'kartta', cycle: 'monthly' }, null, deps)).status, 401);
  assert.equal((await call({ action: 'create', restaurant_id: RA, plan: 'kartta', cycle: 'monthly' }, 'bad', deps)).status, 401, 'token inválido');
  assert.equal((await call({ action: 'create', restaurant_id: RA, plan: 'kartta', cycle: 'monthly' }, 'tb', deps)).status, 403, 'dueño de OTRO restaurante');
  assert.equal((await call({ action: 'create', restaurant_id: RA, plan: 'kartta', cycle: 'monthly' }, 'ts', deps)).status, 403, 'staff');
  assert.equal((await call({ action: 'create', restaurant_id: RB, plan: 'kartta', cycle: 'monthly' }, 'tb', deps)).body.error, 'billing_profile_required');
  const r = await call({ action: 'create', restaurant_id: RA, plan: 'kartta', cycle: 'monthly', amount_in_cents: 100, price: 1 }, 'ta', deps);
  assert.equal(r.status, 200); const w = r.body.widget;
  assert.equal(w.amountInCents, 4390000, 'KARTTA Pro mensual $43.900 (ignora lo que envía el navegador)');
  assert.equal(w.signature.integrity, sha(`${w.reference}${w.amountInCents}COP${w.expirationTime}${ENV.WOMPI_INTEGRITY_SECRET}`));
  assert.equal(w.redirectUrl, `https://kartta.food/checkout/processing/${w.reference}`); assert.equal(w.customerData.legalId, '9001234567'); assert.equal(w.customerData.phoneNumberPrefix, '+57');
  const raw = JSON.stringify(r.body); for (const s of [ENV.WOMPI_PRIVATE_KEY, ENV.WOMPI_EVENTS_SECRET, ENV.WOMPI_INTEGRITY_SECRET]) assert.ok(!raw.includes(s));
});

test('importes oficiales: Pro 43.900/263.400 y Elite 84.900/509.400 (ids kartta y pro)', async () => {
  const { deps } = mk(); const amt = async (plan, cycle) => (await call({ action: 'create', restaurant_id: RA, plan, cycle }, 'ta', deps)).body.widget.amountInCents;
  assert.equal(await amt('kartta', 'monthly'), 4390000); assert.equal(await amt('kartta', 'annual'), 26340000);
  assert.equal(await amt('pro', 'monthly'), 8490000); assert.equal(await amt('pro', 'annual'), 50940000);
  assert.equal((await call({ action: 'create', restaurant_id: RA, plan: 'free', cycle: 'monthly' }, 'ta', deps)).status, 400, 'Free no se cobra');
  assert.equal((await call({ action: 'create', restaurant_id: RA, plan: 'kartta', cycle: 'weekly' }, 'ta', deps)).status, 400);
});

test('ambientes mezclados o APP_URL insegura => 503 y no se crea ningún cobro', async () => {
  const { deps, db } = mk(); const bad = { ...deps, env: { ...ENV, WOMPI_PUBLIC_KEY: 'pub_prod_ZZZ' } };
  const r = await call({ action: 'create', restaurant_id: RA, plan: 'kartta', cycle: 'monthly' }, 'ta', bad); assert.equal(r.status, 503); assert.equal(r.body.error, 'payments_not_configured');
  const http = { ...deps, env: { ...ENV, APP_URL: 'http://kartta.food' } }; assert.equal((await call({ action: 'create', restaurant_id: RA, plan: 'kartta', cycle: 'monthly' }, 'ta', http)).status, 503);
  assert.equal(db.payments.length, 0);
});

test('verificar: no activa por llegar a /success; id ajeno/inventado no sirve; importe distinto no activa; idempotente', async () => {
  const { deps, db, map } = mk();
  const c = (await call({ action: 'create', restaurant_id: RA, plan: 'pro', cycle: 'monthly' }, 'ta', deps)).body, tx = (status, id = 'w1', extra = {}) => ({ id, reference: c.reference, status, amount_in_cents: c.widget.amountInCents, currency: 'COP', payment_method_type: 'NEQUI', ...extra });
  const v = (body, t = 'ta') => call({ action: 'verify', ...body }, t, deps);
  assert.equal((await v({ reference: c.reference })).body.status, 'pending');
  assert.equal((await v({ reference: c.reference, id: 'inventado' })).body.status, 'pending');
  assert.equal(db.payments[0].applied_at, null, 'nada activado');
  const other = (await call({ action: 'create', restaurant_id: RA, plan: 'kartta', cycle: 'monthly' }, 'ta', deps)).body; map.wo = { id: 'wo', reference: other.reference, status: 'APPROVED', amount_in_cents: other.widget.amountInCents, currency: 'COP' };
  const mm = await v({ reference: c.reference, id: 'wo' }); assert.equal(mm.status, 409); assert.equal(mm.body.error, 'reference_mismatch'); assert.equal(db.payments[0].applied_at, null);
  assert.equal((await v({ reference: c.reference }, 'tb')).status, 404, 'otro restaurante no puede consultar'); assert.equal((await v({ reference: c.reference }, 'bad')).status, 401);
  map.w1 = tx('PENDING'); assert.equal((await v({ reference: c.reference, id: 'w1' })).body.status, 'pending'); assert.equal(db.payments[0].applied_at, null);
  map.w1 = tx('APPROVED', 'w1', { amount_in_cents: 100 }); assert.equal((await v({ reference: c.reference, id: 'w1' })).body.status, 'error', 'importe manipulado'); assert.equal(db.payments[0].applied_at, null);
  map.w1 = tx('DECLINED'); assert.equal((await v({ reference: c.reference, id: 'w1' })).body.status, 'declined'); assert.equal(db.payments[0].applied_at, null);
  map.w1 = tx('APPROVED'); assert.equal((await v({ reference: c.reference, id: 'w1' })).body.status, 'approved'); const at = db.payments[0].applied_at; assert.ok(at);
  assert.equal((await v({ reference: c.reference })).body.status, 'approved'); assert.equal(db.payments[0].applied_at, at, 'idempotente');
});

test('Wompi caído: respuesta "error" (la pantalla lo muestra como pendiente), nada se activa', async () => {
  const { deps, db } = mk(); const c = (await call({ action: 'create', restaurant_id: RA, plan: 'kartta', cycle: 'monthly' }, 'ta', deps)).body;
  const down = { ...deps, fetchFn: wompiMap({}, true) }; const r = await call({ action: 'verify', reference: c.reference }, 'ta', down);
  assert.equal(r.body.status, 'error'); assert.equal(db.payments[0].applied_at, null);
  assert.equal((await call({ action: 'verify', reference: 'KT-nope' }, 'ta', deps)).status, 400);
});
