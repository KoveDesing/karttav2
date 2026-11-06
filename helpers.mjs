import { createHash } from 'node:crypto';
export const sha = (s) => createHash('sha256').update(s).digest('hex');
export const KEYS = { WOMPI_ENVIRONMENT: 'sandbox', WOMPI_PUBLIC_KEY: 'pub_test_AAAA', WOMPI_PRIVATE_KEY: 'prv_test_BBBB', WOMPI_EVENTS_SECRET: 'test_events_CCCC', WOMPI_INTEGRITY_SECRET: 'test_integrity_DDDD', APP_URL: 'https://app.kartta.test' };
/** Evento transaction.updated firmado con una implementación independiente del módulo bajo prueba. */
export function signedEvent(tx, { secret = KEYS.WOMPI_EVENTS_SECRET, environment = 'test', ts = 1730000000 } = {}) {
  const props = ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'];
  const checksum = sha(`${tx.id}${tx.status}${tx.amount_in_cents}${ts}${secret}`);
  return { event: 'transaction.updated', data: { transaction: { currency: 'COP', payment_method_type: 'NEQUI', ...tx } }, environment, signature: { properties: props, checksum }, timestamp: ts, sent_at: new Date().toISOString() };
}
export const req = (body, headers = {}, method = 'POST') => new Request('https://fn.test/x', { method, headers: { 'content-type': 'application/json', ...headers }, body: method === 'GET' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
/** Wompi simulado: GET /transactions/:id desde un mapa mutable; cuenta llamadas; puede "caerse". */
export function mockWompi(map) {
  const st = { calls: [], down: false };
  const fetchFn = async (url) => {
    st.calls.push(String(url));
    if (st.down) return new Response('boom', { status: 503 });
    const u = new URL(url);
    if (u.pathname.endsWith('/transactions') && u.searchParams.get('reference')) {
      const ref = u.searchParams.get('reference'); const hit = Object.values(map).filter((t) => t.reference === ref);
      return new Response(JSON.stringify({ data: hit }), { status: 200 });
    }
    const id = decodeURIComponent(u.pathname.split('/').pop()); const t = map[id];
    return t ? new Response(JSON.stringify({ data: t }), { status: 200 }) : new Response(JSON.stringify({ error: {} }), { status: 404 });
  };
  return { fetchFn, st };
}
