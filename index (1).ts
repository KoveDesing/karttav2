// wompi-order-webhook — eventos de Wompi de la cuenta de CADA restaurante.
// URL que cada restaurante configura en su Wompi (Sandbox y Producción): .../functions/v1/wompi-order-webhook?rid=<id del restaurante>
// La firma se valida con el secreto de eventos DE ESE restaurante; el monto, la moneda y la referencia se comparan con lo guardado.
// El estado real se consulta a la API de Wompi (el cuerpo del evento no se usa para aprobar nada).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const API = { sandbox: 'https://sandbox.wompi.co/v1', production: 'https://production.wompi.co/v1' };
const EVENT_ENV = { sandbox: 'test', production: 'prod' };
export const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export async function sha256Hex(t) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))); }
export function timingSafeEqual(a, b) { const x = String(a ?? ''), y = String(b ?? ''); let d = x.length ^ y.length; const n = Math.max(x.length, y.length); for (let i = 0; i < n; i++) d |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0); return d === 0; }
const getPath = (o, p) => String(p).split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);

export async function verifyEventSignature(body, headerChecksum, eventsSecret) {
  const sig = body && body.signature;
  if (!sig || !Array.isArray(sig.properties) || !sig.properties.length || typeof sig.checksum !== 'string') return { ok: false, reason: 'missing_signature' };
  const props = sig.properties.map(String);
  for (const need of ['transaction.id', 'transaction.status', 'transaction.amount_in_cents']) if (!props.includes(need)) return { ok: false, reason: 'unsigned_fields' };
  const ts = body.timestamp ?? sig.timestamp;
  if (ts == null || ts === '') return { ok: false, reason: 'missing_timestamp' };
  const data = body.data || {};
  const expected = await sha256Hex(props.map((p) => { const v = getPath(data, p); return v == null ? '' : String(v); }).join('') + String(ts) + eventsSecret);
  if (!timingSafeEqual(expected, sig.checksum)) return { ok: false, reason: 'bad_checksum' };
  if (headerChecksum && !timingSafeEqual(expected, headerChecksum)) return { ok: false, reason: 'header_mismatch' };
  return { ok: true };
}

const norm = (d) => ({ id: String(d.id), reference: String(d.reference ?? ''), status: String(d.status || '').toUpperCase(), amount_in_cents: Number(d.amount_in_cents), currency: String(d.currency || '').toUpperCase(), payment_method_type: d.payment_method_type ? String(d.payment_method_type) : null });
async function fetchTransaction(fetchFn, env, id) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
  let r; try { r = await fetchFn(`${API[env]}/transactions/${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' }, signal: ctl.signal }); } catch { throw new Error('wompi_unavailable'); } finally { clearTimeout(t); }
  if (r.status === 404) return null;
  if (r.status >= 500 || r.status === 429) throw new Error('wompi_unavailable');
  let j = null; try { j = await r.json(); } catch { }
  const d = j && j.data; if (r.status !== 200 || !d || d.id == null || !Number.isFinite(Number(d.amount_in_cents))) throw new Error('wompi_bad_response');
  return norm(d);
}

/** deps: { admin (service role), fetchFn } */
export async function handle(req, deps) {
  const { admin, fetchFn } = deps;
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const rid = new URL(req.url).searchParams.get('rid') || '';
  if (!UUID.test(rid)) return json({ error: 'not_found' }, 404);
  let raw; try { raw = await req.text(); if (raw.length > 64 * 1024) return json({ error: 'payload_too_large' }, 413); } catch { return json({ error: 'invalid_request' }, 400); }
  let ev; try { ev = JSON.parse(raw); } catch { return json({ error: 'invalid_json' }, 400); }
  if (!ev || typeof ev !== 'object' || !ev.data || typeof ev.data !== 'object') return json({ error: 'invalid_event' }, 400);

  const cr = await admin.rpc('wompi_get_credentials', { p_rid: rid });
  const creds = cr.data;
  if (cr.error || !creds) return json({ error: 'not_found' }, 404);

  const sig = await verifyEventSignature(ev, req.headers.get('x-event-checksum'), creds.events);
  if (!sig.ok) { console.warn('[wompi-order-webhook] evento rechazado:', sig.reason, rid); return json({ error: 'invalid_signature' }, 401); }
  if (ev.environment && ev.environment !== EVENT_ENV[creds.environment]) return json({ ok: true, ignored: 'other_environment' });
  if (ev.event !== 'transaction.updated') return json({ ok: true, ignored: 'event_type' });
  const txIn = (ev.data && ev.data.transaction) || {};
  const txId = String(txIn.id || ''), reference = String(txIn.reference || '');
  if (!txId) return json({ error: 'invalid_event' }, 400);
  if (!/^KO-[A-F0-9]{20}$/.test(reference)) return json({ ok: true, ignored: 'not_kartta_order_reference' });

  const rec = await admin.rpc('order_payment_record_event', { p_restaurant: rid, p_checksum: ev.signature.checksum, p_tx: txId, p_ref: reference, p_env: creds.environment });
  if (rec.error || !rec.data) return json({ error: 'temporary_error' }, 500);
  if (rec.data.done) return json({ ok: true, result: 'duplicate_event' });
  const finish = (result) => admin.rpc('order_payment_finish_event', { p_id: rec.data.id, p_result: result });

  let tx;
  try { tx = await fetchTransaction(fetchFn, creds.environment, txId); } catch (e) { return json({ error: 'wompi_unavailable' }, 503); }
  if (!tx) { await finish('transaction_not_found'); return json({ ok: true, ignored: 'transaction_not_found' }); }
  if (tx.id !== txId || tx.reference !== reference) { await finish('reference_mismatch'); return json({ ok: true, ignored: 'reference_mismatch' }); }

  const r = await admin.rpc('order_payment_apply', { p_restaurant: rid, p_reference: tx.reference, p_tx_id: tx.id, p_status: tx.status, p_amount_in_cents: tx.amount_in_cents, p_currency: tx.currency, p_method: tx.payment_method_type, p_env: creds.environment });
  if (r.error) return json({ error: 'temporary_error' }, 500);
  const result = (r.data && r.data.result) || 'unknown';
  await finish(result);
  if (['amount_mismatch', 'environment_mismatch', 'restaurant_mismatch', 'approved_duplicate_needs_refund', 'approved_order_cancelled'].includes(result)) console.error('[wompi-order-webhook] ALERTA:', result, tx.reference);
  return json({ ok: true, result });
}

if (typeof Deno !== 'undefined' && Deno.serve) {
  const { createClient } = await import('npm:@supabase/supabase-js@2');
  const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  Deno.serve((req) => handle(req, { admin, fetchFn: fetch }));
}
