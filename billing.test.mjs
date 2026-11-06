// Pruebas de integración: Edge Functions REALES (core.js) + funciones SQL REALES (Postgres local) + Wompi SIMULADO.
// No usa dinero ni credenciales reales. Ejecutar: node --test tests/billing/
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { sqlAsSuper, makeAdmin } from './pg-admin.mjs';
import { KEYS, sha, signedEvent, req, mockWompi } from './helpers.mjs';
import * as checkout from '../../supabase/functions/billing-checkout/core.js';
import * as webhook from '../../supabase/functions/wompi-webhook/core.js';
import * as cron from '../../supabase/functions/billing-cron/core.js';
import * as adminBilling from '../../supabase/functions/admin-billing/core.js';

const A = 'a0000000-0000-0000-0000-00000000000a', B = 'b0000000-0000-0000-0000-00000000000b', STAFF = 'c0000000-0000-0000-0000-00000000000c', STRANGER = 'e0000000-0000-0000-0000-00000000000e';
const RA = 'aaaaaaaa-0000-0000-0000-000000000001', RB = 'bbbbbbbb-0000-0000-0000-000000000002';
const admin = makeAdmin();
const users = { 'tok-a': { id: A }, 'tok-b': { id: B }, 'tok-staff': { id: STAFF }, 'tok-stranger': { id: STRANGER } };
const getUser = async (t) => users[t] || null;
const dep = (extra = {}) => ({ env: KEYS, admin, getUser, ...extra });
const q = (s) => sqlAsSuper(s);
const post = (core, body, token, d) => core.handle(req(body, token ? { authorization: 'Bearer ' + token } : {}), d);
const create = async (plan, cycle = 'monthly', token = 'tok-a', rid = RA, extra = {}) => {
  q(`update public.payments set created_at = created_at - interval '2 hours' where status = 'CREATED' and created_at > now() - interval '1 hour' and reference not like 'KT-LIMIT%'`);   // el tope de cobros abiertos por hora se prueba aparte
  const r = await post(checkout, { action: 'create', restaurant_id: rid, plan, cycle, ...extra }, token, dep()); return { status: r.status, body: await r.json() }; };
const wh = async (ev, d, headers = {}) => { const r = await webhook.handle(req(ev, headers), d); return { status: r.status, body: await r.json() }; };
const sub = (rid = RA) => JSON.parse(q(`select to_jsonb(s)::text from public.subscriptions s where restaurant_id='${rid}'`));
const rank = (rid = RA) => Number(q(`select coalesce((select (p.limits->>'rank')::int from public.subscriptions s join public.plans p on p.id=s.plan_id where s.restaurant_id='${rid}' and s.status in ('active','trialing') and (s.current_period_end is null or s.current_period_end > now()) limit 1),0)`));
const approvedCount = (rid = RA) => Number(q(`select count(*) from public.payments where restaurant_id='${rid}' and status='APPROVED'`));
const txOf = (c, status = 'APPROVED', id = 'wtx-' + c.reference, extra = {}) => ({ id, reference: c.reference, status, amount_in_cents: c.widget.amountInCents, currency: 'COP', payment_method_type: 'NEQUI', ...extra });

before(() => {
  execSync(`su postgres -c "dropdb --if-exists kartta_test; createdb kartta_test"`, { stdio: 'pipe' });
  const root = new URL('../../', import.meta.url).pathname;
  for (const f of ['tests/sql/00_stub_supabase.sql', '20261106_kartta_payments.sql']) execSync(`su postgres -c "psql -q -v ON_ERROR_STOP=1 -d kartta_test" < ${root}${f}`, { stdio: 'pipe' });
  q(`insert into auth.users (id,email) values ('${A}','owner-a@test.co'),('${B}','owner-b@test.co'),('${STAFF}','staff@test.co'),('${STRANGER}','x@test.co');
     insert into public.restaurants (id,name,slug) values ('${RA}','Resto <b>A</b>','resto-a'),('${RB}','Resto B','resto-b');
     insert into public.restaurant_members values ('${RA}','${A}','owner'),('${RA}','${STAFF}','staff'),('${RB}','${B}','owner');
     insert into public.subscriptions (restaurant_id,plan_id,status,current_period_end) values ('${RA}','trial','trialing',now()+interval '10 days'),('${RB}','trial','trialing',now()+interval '10 days');`);
});

test('0. prueba gratuita: permisos de prueba = rank 0 (sin ingresos ficticios)', () => {
  assert.equal(rank(), 0); assert.ok(sub().trial_end);
  assert.equal(q(`select count(*) from public.payments`), '0');
});

test('1-2. checkout: precio SOLO del servidor, firma de integridad correcta, sin secretos en la respuesta', async () => {
  assert.equal((await post(checkout, { action: 'create', restaurant_id: RA, plan: 'kartta', cycle: 'monthly' }, null, dep())).status, 401, 'sin sesión');
  assert.equal((await create('kartta', 'monthly', 'tok-stranger')).status, 403, 'extraño');
  assert.equal((await create('kartta', 'monthly', 'tok-staff')).status, 403, 'staff');
  assert.equal((await create('kartta')).body.error, 'billing_profile_required', 'exige datos de facturación');
  q(`select public.billing_save_profile('${RA}','Resto A SAS','NIT','900123456-7','fact@resto-a.co','3001112233','Medellín','Calle 1') ` .replace('select', 'set request.jwt.claim.sub=\'' + A + '\'; set role authenticated; select'));
  const std = await create('kartta', 'monthly', 'tok-a', RA, { amount_in_cents: 100, price: 1, amount: 1, amountInCents: 1 });   // el navegador intenta fijar el precio
  assert.equal(std.status, 200); assert.equal(std.body.widget.amountInCents, 4390000, 'Standard mensual = $43.900 (BD), ignora lo que envía el navegador');
  const w = std.body.widget;
  assert.equal(w.signature.integrity, sha(`${w.reference}${w.amountInCents}COP${w.expirationTime}${KEYS.WOMPI_INTEGRITY_SECRET}`), 'SHA256 reference+monto+moneda+expiración+secreto');
  assert.match(w.reference, /^KT-[A-F0-9]{20}$/); assert.equal(w.redirectUrl, `https://app.kartta.test/checkout/processing/${w.reference}`); assert.equal(w.publicKey, KEYS.WOMPI_PUBLIC_KEY);
  assert.equal(w.customerData.legalId, '9001234567'); assert.equal(w.customerData.phoneNumberPrefix, '+57');
  const raw = JSON.stringify(std.body); for (const s of [KEYS.WOMPI_PRIVATE_KEY, KEYS.WOMPI_EVENTS_SECRET, KEYS.WOMPI_INTEGRITY_SECRET]) assert.ok(!raw.includes(s), 'no filtra secretos');
  const pro = await create('pro'); assert.equal(pro.body.widget.amountInCents, 8490000, 'Pro mensual = $84.900');
  assert.equal(q(`select count(*) from public.payments where status='CREATED'`), '2');
  assert.equal(rank(), 0, 'crear un cobro NO concede nada');
});

test('3. anual bloqueado hasta confirmar precio; con precio+ajuste funciona (valor de PRUEBA)', async () => {
  assert.equal((await create('pro', 'annual')).body.error, 'annual_not_available');
  q(`update public.plans set annual_price_cop = 999000 where id='pro'; update public.billing_settings set annual_sales_enabled = true;`);
  const r = await create('pro', 'annual'); assert.equal(r.status, 200); assert.equal(r.body.widget.amountInCents, 99900000);
  q(`update public.billing_settings set annual_sales_enabled = false; update public.plans set annual_price_cop = null where id='pro';`);
});

test('configuración: llaves de otro ambiente se rechazan (no se mezclan)', async () => {
  const bad = { ...KEYS, WOMPI_PUBLIC_KEY: 'pub_prod_ZZZ' };
  const r = await post(checkout, { action: 'create', restaurant_id: RA, plan: 'kartta', cycle: 'monthly' }, 'tok-a', dep({ env: bad }));
  assert.equal(r.status, 503); assert.equal((await r.json()).error, 'payments_not_configured');
  const w = await webhook.handle(req({ data: {} }), { env: { ...KEYS, WOMPI_EVENTS_SECRET: 'prod_events_x' }, admin, fetchFn: async () => { throw new Error('no debe llamar'); } }); assert.equal(w.status, 503);
});

test('9-11. webhook: inválido (firma / manipulado) NO activa; válido activa Pro; duplicado x5 no repite', async () => {
  const c = (await create('pro')).body; const w = mockWompi({});
  const d = { env: KEYS, admin, fetchFn: w.fetchFn };
  const good = signedEvent(txOf(c));
  // firma falsa (atacante sin el secreto)
  let r = await wh(signedEvent(txOf(c), { secret: 'test_events_ATACANTE' }), d); assert.equal(r.status, 401);
  // evento manipulado: cambia el importe pero conserva el checksum original
  const tampered = structuredClone(good); tampered.data.transaction.amount_in_cents = 100; r = await wh(tampered, d); assert.equal(r.status, 401);
  // propiedades sin firmar (no cubre el status)
  const partial = structuredClone(good); partial.signature.properties = ['transaction.id']; r = await wh(partial, d); assert.equal(r.status, 401);
  // cabecera con checksum distinto
  r = await wh(good, d, { 'x-event-checksum': 'deadbeef' }); assert.equal(r.status, 401);
  assert.equal(w.st.calls.length, 0, 'ante firma inválida ni siquiera se consulta a Wompi'); assert.equal(rank(), 0, 'Pro NO activado');
  assert.ok(Number(q(`select count(*) from public.payment_events where verification_status='invalid_signature'`)) >= 4, 'rechazos auditados');
  // válido
  const map = { [`wtx-${c.reference}`]: txOf(c) }; const w2 = mockWompi(map); const d2 = { env: KEYS, admin, fetchFn: w2.fetchFn };
  r = await wh(good, d2, { 'x-event-checksum': good.signature.checksum }); assert.deepEqual([r.status, r.body.result], [200, 'applied']);
  assert.equal(sub().plan_id, 'pro'); assert.equal(sub().status, 'active'); assert.equal(rank(), 2, 'permisos reales (rank del plan) actualizados');
  const end = sub().current_period_end;
  for (let i = 0; i < 5; i++) { r = await wh(good, d2); assert.equal(r.status, 200); assert.equal(r.body.result, 'duplicate'); }
  assert.equal(sub().current_period_end, end, 'reenvíos no extienden el periodo'); assert.equal(approvedCount(), 1, 'un solo ingreso');
  assert.equal(q(`select count(*) from public.payment_events where event_reference='${good.signature.checksum}'`), '1'); assert.equal(q(`select attempts from public.payment_events where event_reference='${good.signature.checksum}'`), '6');
  assert.equal(q(`select count(*) from public.billing_notifications where payment_id=(select id from public.payments where reference='${c.reference}') and notification_type in ('payment_approved','plan_updated','subscription_welcome')`), '2');
});

test('12-13. el evento NO es la fuente de verdad: importe/estado salen de la API de Wompi', async () => {
  q(`update public.subscriptions set plan_id='trial', status='trialing', current_period_end=now()+interval '5 days', billing_cycle=null where restaurant_id='${RA}'`);
  // a) el evento dice APPROVED pero la API dice PENDING => no activa
  let c = (await create('pro')).body; let ev = signedEvent(txOf(c)); let w = mockWompi({ [`wtx-${c.reference}`]: txOf(c, 'PENDING') });
  let r = await wh(ev, { env: KEYS, admin, fetchFn: w.fetchFn }); assert.equal(r.body.result, 'pending'); assert.equal(rank(), 0, 'intento de activar Pro sin pagar');
  // b) la API informa un importe distinto al cobrado => alerta, no activa
  c = (await create('pro')).body; ev = signedEvent(txOf(c)); w = mockWompi({ [`wtx-${c.reference}`]: txOf(c, 'APPROVED', undefined, { amount_in_cents: 100 }) });
  r = await wh(ev, { env: KEYS, admin, fetchFn: w.fetchFn }); assert.equal(r.body.result, 'amount_mismatch'); assert.equal(rank(), 0);
  assert.ok(Number(q(`select count(*) from public.billing_audit_log where action='amount_mismatch'`)) >= 1);
  // c) moneda distinta
  c = (await create('pro')).body; ev = signedEvent(txOf(c)); w = mockWompi({ [`wtx-${c.reference}`]: txOf(c, 'APPROVED', undefined, { currency: 'USD' }) });
  r = await wh(ev, { env: KEYS, admin, fetchFn: w.fetchFn }); assert.equal(r.body.result, 'amount_mismatch'); assert.equal(rank(), 0);
  // d) la API devuelve otra referencia que la del evento
  c = (await create('pro')).body; ev = signedEvent(txOf(c)); w = mockWompi({ [`wtx-${c.reference}`]: txOf(c, 'APPROVED', undefined, { reference: 'KT-FFFFFFFFFFFFFFFFFFFF' }) });
  r = await wh(ev, { env: KEYS, admin, fetchFn: w.fetchFn }); assert.equal(r.body.ignored, 'reference_mismatch'); assert.equal(rank(), 0);
  // e) evento de otro ambiente (prod) con firma válida => ignorado; referencia ajena (no KT-) => ignorada
  c = (await create('pro')).body; w = mockWompi({ [`wtx-${c.reference}`]: txOf(c) });
  r = await wh(signedEvent(txOf(c), { environment: 'prod' }), { env: KEYS, admin, fetchFn: w.fetchFn }); assert.equal(r.body.ignored, 'other_environment'); assert.equal(w.st.calls.length, 0);
  r = await wh(signedEvent({ id: 'x1', reference: 'OTRO-123', status: 'APPROVED', amount_in_cents: 5 }), { env: KEYS, admin, fetchFn: w.fetchFn }); assert.equal(r.body.ignored, 'not_kartta_reference');
  // f) referencia desconocida con formato KT-
  const ghost = { id: 'g1', reference: 'KT-0000000000000000000A', status: 'APPROVED', amount_in_cents: 4390000, currency: 'COP' };
  r = await wh(signedEvent(ghost), { env: KEYS, admin, fetchFn: mockWompi({ g1: ghost }).fetchFn }); assert.equal(r.body.result, 'unknown_reference'); assert.equal(rank(), 0);
});

test('5-8. rechazado, pendiente→aprobado, cancelado (VOIDED), y Wompi caído (503 y reintento)', async () => {
  q(`update public.subscriptions set plan_id='trial', status='trialing', current_period_end=now()+interval '5 days' where restaurant_id='${RA}'`);
  const c = (await create('kartta')).body; const map = {}; const mk = (st) => { map[`wtx-${c.reference}`] = txOf(c, st); return signedEvent(map[`wtx-${c.reference}`]); };
  const w = mockWompi(map), d = { env: KEYS, admin, fetchFn: w.fetchFn };
  let r = await wh(mk('PENDING'), d); assert.equal(r.body.result, 'pending'); assert.equal(rank(), 0);
  assert.equal(q(`select status from public.payments where reference='${c.reference}'`), 'PENDING');
  w.st.down = true; r = await wh(mk('APPROVED'), d); assert.equal(r.status, 503, 'Wompi caído => 5xx para que Wompi reintente'); assert.equal(rank(), 0);
  w.st.down = false; r = await wh(mk('APPROVED'), d); assert.equal(r.body.result, 'applied'); assert.equal(rank(), 1, 'Standard => rank 1');
  r = await wh(mk('VOIDED'), d); assert.equal(r.body.result, 'voided_revoked'); assert.equal(rank(), 0, 'anulación revoca permisos'); assert.equal(sub().status, 'canceled');
  const c2 = (await create('kartta')).body; map[`wtx-${c2.reference}`] = txOf(c2, 'DECLINED'); r = await wh(signedEvent(map[`wtx-${c2.reference}`]), d);
  assert.equal(r.body.result, 'declined'); assert.equal(q(`select status from public.payments where reference='${c2.reference}'`), 'DECLINED'); assert.equal(rank(), 0);
});

test('13-16. verify (página de éxito): no activa por llegar a /success; verifica contra Wompi; aislamiento entre restaurantes', async () => {
  q(`update public.subscriptions set plan_id='trial', status='trialing', current_period_end=now()+interval '5 days' where restaurant_id='${RA}'`);
  const c = (await create('pro')).body, map = {}, w = mockWompi(map), d = dep({ fetchFn: w.fetchFn });
  const v = async (body, tok = 'tok-a') => { const r = await post(checkout, { action: 'verify', ...body }, tok, d); return { status: r.status, body: await r.json() }; };
  let r = await v({ reference: c.reference }); assert.equal(r.body.status, 'pending', 'sin transacción en Wompi: sigue pendiente'); assert.equal(rank(), 0);
  r = await v({ reference: c.reference, id: 'inventado-123' }); assert.equal(r.body.status, 'pending'); assert.equal(rank(), 0, 'un id inventado no activa nada');
  const other = (await create('kartta')).body; map['wtx-other'] = txOf(other, 'APPROVED', 'wtx-other');
  r = await v({ reference: c.reference, id: 'wtx-other' }); assert.equal(r.status, 409); assert.equal(r.body.error, 'reference_mismatch'); assert.equal(rank(), 0, 'usar la transacción aprobada de OTRA referencia no sirve');
  r = await v({ reference: c.reference }, 'tok-b'); assert.equal(r.status, 404, 'otro restaurante no puede consultar'); r = await v({ reference: c.reference }, 'tok-stranger'); assert.equal(r.status, 404);
  map[`wtx-${c.reference}`] = txOf(c, 'PENDING'); r = await v({ reference: c.reference, id: `wtx-${c.reference}` }); assert.equal(r.body.status, 'pending'); assert.equal(rank(), 0);
  map[`wtx-${c.reference}`] = txOf(c, 'APPROVED'); r = await v({ reference: c.reference, id: `wtx-${c.reference}` }); assert.equal(r.body.status, 'approved'); assert.equal(rank(), 2);
  const end = sub().current_period_end; r = await v({ reference: c.reference }); assert.equal(r.body.status, 'approved'); assert.equal(sub().current_period_end, end, 'verify repetido es idempotente');
  assert.equal(q(`select count(*) from public.payments where reference='${c.reference}' and status='APPROVED'`), '1');
});

test('17. cron: autenticación, correos solo tras verificación, sin duplicados, escape de HTML', async () => {
  const sent = []; const fetchFn = async (url, init) => { const b = JSON.parse(init.body); sent.push({ ...b, idem: init.headers['Idempotency-Key'] }); return new Response(JSON.stringify({ id: 'em_' + sent.length }), { status: 200 }); };
  const cenv = { ...KEYS, CRON_SECRET: 'x'.repeat(32) };
  assert.equal((await cron.handle(req({}, {}), { env: cenv, admin, fetchFn })).status, 401);
  assert.equal((await cron.handle(req({}, { authorization: 'Bearer nope' }), { env: cenv, admin, fetchFn })).status, 401);
  // sin proveedor de correo: no envía ni marca como enviado
  let r = await (await cron.handle(req({}, { authorization: 'Bearer ' + cenv.CRON_SECRET }), { env: cenv, admin, fetchFn: mockWompi({}).fetchFn })).json();
  assert.equal(r.emails.note, 'email_not_configured'); assert.equal(q(`select count(*) from public.billing_notifications where delivery_status='sent'`), '0');
  // con proveedor
  const env2 = { ...cenv, RESEND_API_KEY: 're_test', BILLING_FROM_EMAIL: 'KARTTA <pagos@kartta.test>' };
  const run = async () => (await (await cron.handle(req({}, { authorization: 'Bearer ' + cenv.CRON_SECRET }), { env: env2, admin, fetchFn: async (u, i) => (String(u).includes('resend') ? fetchFn(u, i) : mockWompi({}).fetchFn(u, i)) })).json());
  r = await run(); assert.ok(r.emails.sent > 0, 'envía'); const n1 = sent.length;
  const approved = sent.filter((m) => /Pago aprobado|Bienvenido|Tu plan ahora es/.test(m.subject)); assert.ok(approved.length >= 1, 'hay correos de pago aprobado (de pagos realmente verificados)');
  assert.equal(q(`select count(*) from public.billing_notifications n join public.payments p on p.id=n.payment_id where n.notification_type in ('payment_approved','subscription_welcome','plan_updated') and p.applied_at is null`), '0', 'jamás se encola "aprobado" sin pago verificado');
  assert.ok(sent.every((m) => m.to[0] === 'owner-a@test.co' || m.to[0] === 'owner-b@test.co'));
  assert.ok(sent.every((m) => !m.html.includes('<b>A</b>')) && sent.some((m) => m.html.includes('&lt;b&gt;A&lt;/b&gt;')), 'nombre del restaurante escapado');
  assert.ok(sent.every((m) => m.idem && m.html.includes('Kartta')), 'idempotency-key y marca');
  r = await run(); assert.equal(sent.length, n1, 'segunda ejecución no reenvía'); assert.equal(q(`select count(*) from public.billing_notifications where delivery_status='sending'`), '0');
});

test('18. conciliación: webhook perdido => el cron consulta a Wompi y activa', async () => {
  q(`update public.subscriptions set plan_id='trial', status='trialing', current_period_end=now()+interval '5 days' where restaurant_id='${RB}'`);
  const c = (await create('kartta', 'monthly', 'tok-b', RB)).body.widget ?? null; assert.equal(c, null, 'RB aún sin datos de facturación');
  q(`insert into public.billing_profiles values ('${RB}','Resto B','CC','1234567','b@b.co',null,null,null)`);
  const cr = (await create('kartta', 'monthly', 'tok-b', RB)).body; q(`update public.payments set created_at = now() - interval '10 minutes' where reference='${cr.reference}'`);
  const w = mockWompi({ 'wtx-lost': { id: 'wtx-lost', reference: cr.reference, status: 'APPROVED', amount_in_cents: cr.widget.amountInCents, currency: 'COP', payment_method_type: 'PSE' } });
  const cenv = { ...KEYS, CRON_SECRET: 'y'.repeat(32) };
  const r = await (await cron.handle(req({}, { authorization: 'Bearer ' + cenv.CRON_SECRET }), { env: cenv, admin, fetchFn: w.fetchFn })).json();
  assert.ok(r.reconciled >= 1); assert.equal(rank(RB), 1);
});

test('19-20. vencimientos y cancelación: sin pago, los beneficios terminan', async () => {
  q(`update public.subscriptions set current_period_end = now() - interval '1 hour' where restaurant_id='${RB}'`); assert.equal(rank(RB), 0, 'periodo vencido => sin beneficios aunque el cron no haya corrido');
  const m = await admin.rpc('billing_run_maintenance'); assert.equal(sub(RB).status, 'past_due'); assert.ok(m.data.past_due >= 1);
});

test('admin-billing (puente del panel): sesión del panel + correo autorizado + auditoría', async () => {
  const panelFetch = async (url, init) => { const t = init.headers.Authorization.replace('Bearer ', ''); const u = { 'p-ok': 'erick@kartta.test', 'p-other': 'otro@x.co' }[t];
    return u ? new Response(JSON.stringify({ email: u, email_confirmed_at: '2026-01-01' }), { status: 200 }) : new Response('{}', { status: 401 }); };
  const env = { PANEL_SUPABASE_URL: 'https://panel.test', PANEL_SUPABASE_KEY: 'k', PANEL_ADMIN_EMAILS: 'erick@kartta.test', PANEL_ORIGINS: 'https://panel.kartta.test' };
  const call = async (op, args, tok) => { const r = await adminBilling.handle(req({ op, args }, tok ? { authorization: 'Bearer ' + tok } : {}), { env, admin, fetchFn: panelFetch }); return { status: r.status, body: await r.json() }; };
  assert.equal((await call('overview', {}, null)).status, 401); assert.equal((await call('overview', {}, 'malo')).status, 401);
  assert.equal((await call('overview', {}, 'p-other')).status, 403, 'sesión válida pero correo NO autorizado');
  let r = await call('overview', { environment: 'sandbox' }, 'p-ok'); assert.equal(r.status, 200); assert.ok(r.body.data.approved_count >= 1); assert.equal(r.body.data.revenue_all_cop >= 0, true);
  assert.equal((await call('overview', { environment: 'production' }, 'p-ok')).body.data.revenue_all_cop, 0, 'sandbox no cuenta como ingreso real');
  assert.equal((await call('borrar_todo', {}, 'p-ok')).status, 400); assert.equal((await call('customer', { restaurant_id: 'x; drop table payments' }, 'p-ok')).status, 400);
  r = await call('transactions', { environment: 'sandbox', q: "'; drop table payments;--" }, 'p-ok'); assert.equal(r.status, 200, 'búsqueda con SQL injection es texto inocuo');
  const pid = q(`select id from public.payments where status='APPROVED' and environment='sandbox' limit 1`);
  assert.equal((await call('set_fee', { payment_id: pid, fee_cop: 99999999 }, 'p-ok')).body.error, 'invalid_fee');
  assert.equal((await call('set_fee', { payment_id: pid, fee_cop: 1200 }, 'p-ok')).status, 200);
  assert.equal(q(`select count(*) from public.billing_audit_log where action='fee_registered' and detail->>'actor'='erick@kartta.test'`), '1', 'auditado con el correo del admin');
  assert.equal((await call('payout_add', { amount_cop: 5000, paid_on: '2999-01-01', environment: 'sandbox' }, 'p-ok')).body.error, 'invalid_payout');
  assert.equal((await call('settings_update', { trial_days: 30, annual_enabled: true }, 'p-ok')).body.error, 'annual_price_missing');
  r = await call('customer', { restaurant_id: RA }, 'p-ok'); assert.ok(r.body.data.payments.length >= 5 && r.body.data.audit.length > 0);
  assert.ok(!JSON.stringify(r.body).includes('payment_source_id'));
});
