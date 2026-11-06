// Utilidades HTTP compartidas por las funciones de KARTTA Payments.
export const json = (obj, status, cors) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const REFERENCE = /^KT-[A-F0-9]{20}$/;

/** Lee el cuerpo con tope de tamaño. */
export async function readBody(req, max = 64 * 1024) {
  const text = await req.text();
  if (text.length > max) throw Object.assign(new Error('payload_too_large'), { code: 'payload_too_large' });
  return text;
}
/** Traduce un error de Postgres/PostgREST a un código estable (los mensajes de las RPC son códigos como 'forbidden'). */
export function dbCode(err) {
  const m = String((err && err.message) || err || '');
  const known = ['forbidden', 'annual_not_available', 'plan_not_available', 'price_not_configured', 'downgrade_not_allowed_until_period_end', 'too_many_open_payments',
    'restaurant_suspended', 'invalid_cycle', 'invalid_environment'];
  return known.find((k) => m.includes(k)) || 'db_error';
}
