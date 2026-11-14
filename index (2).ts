// wompi-connect — el dueño/administrador conecta (o desconecta) SU PROPIA cuenta Wompi para cobrar los pedidos de su restaurante.
// Los secretos viajan una sola vez por HTTPS y se guardan en Supabase Vault. Nunca vuelven al navegador ni se escriben en logs.
// Esta cuenta es del restaurante: la cuenta comercial de KARTTA (suscripciones) NO se puede conectar aquí.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUB = /^pub_(test|prod)_[A-Za-z0-9]{16,80}$/;
const INTEGRITY = /^(test|prod)_integrity_[A-Za-z0-9]{8,80}$/;
const EVENTS = /^(test|prod)_events_[A-Za-z0-9]{8,80}$/;
const API = { test: { env: 'sandbox', base: 'https://sandbox.wompi.co/v1' }, prod: { env: 'production', base: 'https://production.wompi.co/v1' } };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
export const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** deps: { userClient (con el JWT de quien llama), adminClient (service role), fetchFn, kartta: { public, integrity, events } } */
export async function handle(req, deps) {
  const { userClient, adminClient, fetchFn, kartta = {} } = deps;
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  let body; try { body = JSON.parse(await req.text()); } catch { return json({ error: 'invalid_json' }, 400); }
  const action = body && body.action, rid = String((body && body.restaurant_id) || '');
  if (!['connect', 'disconnect'].includes(action) || !UUID.test(rid)) return json({ error: 'invalid_request' }, 400);

  const who = await userClient.auth.getUser();
  if (!who.data || !who.data.user) return json({ error: 'unauthorized' }, 401);
  const can = await userClient.rpc('payments_can_manage', { p_rid: rid });
  if (can.error || can.data !== true) return json({ error: 'forbidden' }, 403);

  if (action === 'disconnect') {
    const r = await adminClient.rpc('wompi_clear_credentials', { p_rid: rid });
    if (r.error) return json({ error: 'server_error' }, 500);
    return json({ status: 'disconnected' });
  }

  const pub = String(body.public_key || '').trim(), integ = String(body.integrity_secret || '').trim(), ev = String(body.events_secret || '').trim();
  const mp = PUB.exec(pub), mi = INTEGRITY.exec(integ), me = EVENTS.exec(ev);
  if (!mp || !mi || !me) return json({ error: 'invalid_credentials_format' }, 400);
  if (mp[1] !== mi[1] || mp[1] !== me[1]) return json({ error: 'environment_mixed' }, 400);
  if ((kartta.public && pub === kartta.public) || (kartta.integrity && integ === kartta.integrity) || (kartta.events && ev === kartta.events)) {
    return json({ error: 'kartta_account_not_allowed' }, 400);
  }
  const spec = API[mp[1]];
  let res;
  try { res = await fetchFn(`${spec.base}/merchants/${encodeURIComponent(pub)}`, { headers: { Accept: 'application/json' } }); } catch { return json({ error: 'wompi_unreachable' }, 502); }
  if (res.status === 404 || res.status === 422 || res.status === 401 || res.status === 403) {
    return json({ error: 'wompi_rejected' }, 400);
  }
  if (!res.ok) return json({ error: 'wompi_error' }, 502);
  const j = await res.json().catch(() => ({}));
  const d = (j && j.data) || {};
  if (!d.id && !d.name) return json({ error: 'wompi_rejected' }, 400);
  const name = String(d.name || d.legal_name || 'Comercio Wompi').slice(0, 120);
  const saved = await adminClient.rpc('wompi_save_credentials', { p_rid: rid, p_public: pub, p_integrity: integ, p_events: ev, p_env: spec.env, p_name: name, p_merchant: String(d.id || pub.slice(-8)) });
  if (saved.error) return json({ error: 'server_error' }, 500);
  return json({ status: 'connected', name, environment: spec.env });
}

if (typeof Deno !== 'undefined' && Deno.serve) {
  const { createClient } = await import('npm:@supabase/supabase-js@2');
  Deno.serve((req) => {
    const url = Deno.env.get('SUPABASE_URL');
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
    const adminClient = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
    return handle(req, { userClient, adminClient, fetchFn: fetch, kartta: { public: Deno.env.get('WOMPI_PUBLIC_KEY'), integrity: Deno.env.get('WOMPI_INTEGRITY_SECRET'), events: Deno.env.get('WOMPI_EVENTS_SECRET') } });
  });
}
