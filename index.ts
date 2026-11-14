// order-checkout — pago en línea de un PEDIDO con la cuenta Wompi del propio restaurante.
//  create : crea (o reutiliza) un pago, calcula el monto SOLO desde la base de datos y firma la integridad en el servidor.
//  verify : consulta la transacción en Wompi y aplica el resultado (nunca se confía en lo que diga el navegador).
// Quien llama prueba que es dueño del pedido con el id del pedido (UUID aleatorio que solo recibe quien lo creó).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF = /^KO-[A-F0-9]{20}$/;
const TX_ID = /^[A-Za-z0-9_-]{3,80}$/;
const API = { sandbox: 'https://sandbox.wompi.co/v1', production: 'https://production.wompi.co/v1' };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
export const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export async function sha256Hex(t) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))); }
export const integritySignature = (reference, amountInCents, currency, expirationTime, secret) => sha256Hex(`${reference}${amountInCents}${currency}${expirationTime || ''}${secret}`);

const KNOWN = { order_not_found: 404, order_cancelled: 409, already_paid: 409, restaurant_unavailable: 409, online_payments_disabled: 409, invalid_amount: 409, too_many_attempts: 429 };
const dbCode = (e) => { const m = String((e && e.message) || ''); return Object.keys(KNOWN).find((k) => m.includes(k)) || null; };

const norm = (d) => ({ id: String(d.id), reference: String(d.reference ?? ''), status: String(d.status || '').toUpperCase(), amount_in_cents: Number(d.amount_in_cents), currency: String(d.currency || '').toUpperCase(), payment_method_type: d.payment_method_type ? String(d.payment_method_type) : null });
async function wompiGet(fetchFn, url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
  try { const r = await fetchFn(url, { headers: { Accept: 'application/json' }, signal: ctl.signal }); let j = null; try { j = await r.json(); } catch { } return { status: r.status, json: j }; } finally { clearTimeout(t); }
}
export async function fetchTx(fetchFn, env, id, reference) {
  const base = API[env];
  let res;
  try { res = id ? await wompiGet(fetchFn, `${base}/transactions/${encodeURIComponent(id)}`) : await wompiGet(fetchFn, `${base}/transactions?reference=${encodeURIComponent(reference)}`); } catch { throw new Error('wompi_unavailable'); }
  if (res.status >= 500 || res.status === 429) throw new Error('wompi_unavailable');
  if (id) {
    if (res.status === 404) return null;
    const d = res.json && res.json.data; if (res.status !== 200 || !d || d.id == null || !Number.isFinite(Number(d.amount_in_cents))) throw new Error('wompi_bad_response');
    return norm(d);
  }
  const list = res.json && Array.isArray(res.json.data) ? res.json.data : [];
  const mine = list.filter((d) => d && String(d.reference) === reference && d.id != null && Number.isFinite(Number(d.amount_in_cents)));
  if (!mine.length) return null;
  mine.sort((a, b) => (b.status === 'APPROVED') - (a.status === 'APPROVED') || String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return norm(mine[0]);
}

/** deps: { admin (service role), fetchFn, appUrl } */
export async function handle(req, deps) {
  const { admin, fetchFn } = deps; const appUrl = String(deps.appUrl || 'https://kartta.food').replace(/\/$/, '');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  let b; try { const t = await req.text(); if (t.length > 4096) return json({ error: 'payload_too_large' }, 413); b = JSON.parse(t); } catch { return json({ error: 'invalid_json' }, 400); }
  if (!b || typeof b !== 'object') return json({ error: 'invalid_request' }, 400);

  if (b.action === 'create') {
    const orderId = String(b.order_id || '');
    if (!UUID.test(orderId)) return json({ error: 'invalid_request' }, 400);
    const prep = await admin.rpc('order_payment_prepare', { p_order: orderId });
    if (prep.error) { const c = dbCode(prep.error); if (!c) console.error('[order-checkout] prepare', String(prep.error.message || '').slice(0, 120)); return json({ error: c || 'server_error' }, c ? KNOWN[c] : 500); }
    const pay = prep.data;
    if (pay.state === 'pending') return json({ state: 'pending', reference: pay.reference, slug: pay.slug });
    const cr = await admin.rpc('wompi_get_credentials', { p_rid: pay.restaurant_id });
    const creds = cr.data;
    if (cr.error || !creds || creds.environment !== pay.environment) return json({ error: 'online_payments_disabled' }, 409);
    const expirationTime = new Date(pay.expires_at).toISOString();
    const integrity = await integritySignature(pay.reference, pay.amount_in_cents, pay.currency, expirationTime, creds.integrity);
    return json({
      state: 'ready', reference: pay.reference, environment: pay.environment, slug: pay.slug, order_code: pay.order_code,
      widget: { currency: pay.currency, amountInCents: Number(pay.amount_in_cents), reference: pay.reference, publicKey: creds.public, signature: { integrity }, redirectUrl: `${appUrl}/pago/${pay.reference}`, expirationTime },
    });
  }

  if (b.action === 'verify') {
    const ref = String(b.reference || ''), wid = b.id == null || b.id === '' ? null : String(b.id);
    if (!REF.test(ref) || (wid && !TX_ID.test(wid))) return json({ error: 'invalid_request' }, 400);
    const lk = await admin.rpc('order_payment_lookup', { p_reference: ref });
    const info = lk.data;
    if (lk.error || !info) return json({ error: 'not_found' }, 404);
    const base = { slug: info.slug, order_code: info.order_code, amount_in_cents: Number(info.amount_in_cents) };
    if (info.status === 'APPROVED') return json({ ...base, status: 'approved', result: 'already_applied' });
    const cr = await admin.rpc('wompi_get_credentials', { p_rid: info.restaurant_id });
    const creds = cr.data;
    if (cr.error || !creds) return json({ ...base, status: 'error', result: 'not_configured' }, 200);
    if (creds.environment !== info.environment) return json({ error: 'environment_mismatch' }, 409);
    let tx;
    try { tx = await fetchTx(fetchFn, info.environment, wid || info.wompi_transaction_id, ref); } catch { return json({ error: 'wompi_unavailable' }, 503); }
    if (!tx) return json({ ...base, status: 'pending', result: 'not_found_yet' });
    if (tx.reference !== ref) return json({ error: 'reference_mismatch' }, 409);
    const r = await admin.rpc('order_payment_apply', { p_restaurant: info.restaurant_id, p_reference: ref, p_tx_id: tx.id, p_status: tx.status, p_amount_in_cents: tx.amount_in_cents, p_currency: tx.currency, p_method: tx.payment_method_type, p_env: info.environment });
    if (r.error) return json({ error: 'server_error' }, 500);
    const res = r.data || {};
    if (!res.ok) return json({ ...base, status: 'error', result: res.result });
    const ui = { APPROVED: 'approved', PENDING: 'pending', DECLINED: 'declined', ERROR: 'declined', VOIDED: 'declined' };
    const status = res.result === 'applied' || res.result === 'duplicate' || res.result === 'approved_order_cancelled' ? 'approved' : (ui[tx.status] || 'pending');
    return json({ ...base, status, result: res.result });
  }
  return json({ error: 'invalid_action' }, 400);
}

if (typeof Deno !== 'undefined' && Deno.serve) {
  const { createClient } = await import('npm:@supabase/supabase-js@2');
  const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  Deno.serve((req) => handle(req, { admin, fetchFn: fetch, appUrl: Deno.env.get('APP_URL') || 'https://kartta.food' }));
}
