// Lógica de mp-connect (sin dependencias de Deno para poder probarla en Node).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^(APP_USR|TEST)-[A-Za-z0-9_-]{20,200}$/;
export const json = (obj, status, cors) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** deps: { userClient, adminClient, fetchFn, cors } — userClient lleva el JWT de quien llama. */
export async function handle(req, deps) {
  const { userClient, adminClient, fetchFn, cors } = deps;
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);
  let body; try { body = await req.json(); } catch { return json({ error: 'invalid_json' }, 400, cors); }
  const action = body && body.action, rid = body && body.restaurant_id;
  if (!['connect', 'disconnect'].includes(action) || !UUID.test(String(rid || ''))) return json({ error: 'invalid_request' }, 400, cors);

  // 1) quien llama debe ser dueño/administrador DE ESE restaurante (se comprueba con su propio JWT, no con el body)
  const who = await userClient.auth.getUser();
  if (!who.data || !who.data.user) return json({ error: 'unauthorized' }, 401, cors);
  const can = await userClient.rpc('payments_can_manage', { p_rid: rid });
  if (can.error || can.data !== true) return json({ error: 'forbidden' }, 403, cors);

  if (action === 'disconnect') {
    const r = await adminClient.rpc('mp_clear_token', { p_rid: rid });
    if (r.error) return json({ error: 'server_error' }, 500, cors);
    return json({ status: 'disconnected' }, 200, cors);
  }

  // 2) connect: validar el token contra Mercado Pago ANTES de guardarlo
  const token = String(body.access_token || '').trim();
  if (!TOKEN.test(token)) return json({ error: 'invalid_token_format' }, 400, cors);
  let mp;
  try { mp = await fetchFn('https://api.mercadopago.com/users/me', { headers: { Authorization: 'Bearer ' + token } }); }
  catch { return json({ error: 'mp_unreachable' }, 502, cors); }
  if (mp.status === 401 || mp.status === 403) { await adminClient.rpc('mp_record_error', { p_rid: rid, p_msg: 'Mercado Pago rechazó el token.' }); return json({ error: 'token_rejected' }, 400, cors); }
  if (!mp.ok) return json({ error: 'mp_error' }, 502, cors);
  const me = await mp.json().catch(() => ({}));
  if (!me || !me.id) return json({ error: 'mp_error' }, 502, cors);
  const name = [me.first_name, me.last_name].filter(Boolean).join(' ') || me.nickname || me.email || 'Cuenta Mercado Pago';
  const saved = await adminClient.rpc('mp_save_token', { p_rid: rid, p_token: token, p_external: String(me.id), p_name: name });
  if (saved.error) return json({ error: 'server_error' }, 500, cors);
  return json({ status: 'connected', name, account_id: String(me.id) }, 200, cors);
}
