// KARTTA Payments — utilidades Wompi (sin dependencias de Deno: se prueban en Node).
// Fuente: documentación oficial de Wompi Colombia (docs.wompi.co): Widget & Checkout Web, Eventos, Transacciones, Fuentes de pago.
//  - Firma de integridad: SHA256( reference + amount_in_cents + currency [+ expiration-time] + integrity_secret ), en hexadecimal.
//  - Eventos: SHA256( valores de signature.properties (en orden) + timestamp + events_secret ) == signature.checksum (== cabecera X-Event-Checksum).
//  - Acceptance tokens / fuentes de pago: ver docs/KARTTA_PAYMENTS.md (renovación automática: pendiente).

export const ENVIRONMENTS = {
  sandbox: { api: 'https://sandbox.wompi.co/v1', pub: 'pub_test_', prv: 'prv_test_', events: 'test_events_', integrity: 'test_integrity_', eventEnv: 'test' },
  production: { api: 'https://production.wompi.co/v1', pub: 'pub_prod_', prv: 'prv_prod_', events: 'prod_events_', integrity: 'prod_integrity_', eventEnv: 'prod' },
};
export const WIDGET_SCRIPT = 'https://checkout.wompi.co/widget.js';

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export async function sha256Hex(text) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))); }

/** Comparación en tiempo constante (evita filtrar el checksum por tiempos de respuesta). */
export function timingSafeEqual(a, b) {
  const x = String(a ?? ''), y = String(b ?? '');
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

/**
 * Lee y valida la configuración. NUNCA mezcla ambientes: cada llave debe corresponder al ambiente declarado
 * (pub_test_/prv_test_/test_events_/test_integrity_ en Sandbox; pub_prod_/… en Producción).
 * `env` es un objeto simple (p. ej. { WOMPI_ENVIRONMENT: 'sandbox', … }) — nunca se devuelve el valor de un secreto en errores.
 */
export function loadConfig(env) {
  const name = String(env.WOMPI_ENVIRONMENT || '').trim().toLowerCase();
  const spec = ENVIRONMENTS[name];
  if (!spec) return { ok: false, error: 'wompi_environment_invalid', detail: 'WOMPI_ENVIRONMENT debe ser "sandbox" o "production".' };
  const keys = { publicKey: env.WOMPI_PUBLIC_KEY, privateKey: env.WOMPI_PRIVATE_KEY, eventsSecret: env.WOMPI_EVENTS_SECRET, integritySecret: env.WOMPI_INTEGRITY_SECRET };
  const missing = Object.entries({ WOMPI_PUBLIC_KEY: keys.publicKey, WOMPI_PRIVATE_KEY: keys.privateKey, WOMPI_EVENTS_SECRET: keys.eventsSecret, WOMPI_INTEGRITY_SECRET: keys.integritySecret })
    .filter(([, v]) => !v || !String(v).trim()).map(([k]) => k);
  if (missing.length) return { ok: false, error: 'wompi_not_configured', missing };
  const prefixes = { WOMPI_PUBLIC_KEY: spec.pub, WOMPI_PRIVATE_KEY: spec.prv, WOMPI_EVENTS_SECRET: spec.events, WOMPI_INTEGRITY_SECRET: spec.integrity };
  const vals = { WOMPI_PUBLIC_KEY: keys.publicKey, WOMPI_PRIVATE_KEY: keys.privateKey, WOMPI_EVENTS_SECRET: keys.eventsSecret, WOMPI_INTEGRITY_SECRET: keys.integritySecret };
  const wrong = Object.keys(prefixes).filter((k) => !String(vals[k]).trim().startsWith(prefixes[k]));
  if (wrong.length) return { ok: false, error: 'wompi_environment_mixed', detail: `Estas variables no corresponden a ${name}: ${wrong.join(', ')}`, wrong };
  return {
    ok: true, environment: name, eventEnvironment: spec.eventEnv, apiBase: spec.api,
    publicKey: keys.publicKey.trim(), privateKey: keys.privateKey.trim(), eventsSecret: keys.eventsSecret.trim(), integritySecret: keys.integritySecret.trim(),
  };
}

/** Firma de integridad del Widget / Web Checkout (se calcula SOLO en el servidor). */
export function integritySignature({ reference, amountInCents, currency, expirationTime, secret }) {
  return sha256Hex(`${reference}${amountInCents}${currency}${expirationTime || ''}${secret}`);
}

const getPath = (obj, path) => String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

/**
 * Verifica el checksum de un evento. Exige que las propiedades firmadas incluyan transaction.id, status y amount_in_cents,
 * para que ningún dato que usemos pueda ir sin firmar.
 * @returns {Promise<{ok:boolean, reason?:string}>}
 */
export async function verifyEventSignature(body, headerChecksum, eventsSecret) {
  const sig = body && body.signature;
  if (!sig || !Array.isArray(sig.properties) || !sig.properties.length || typeof sig.checksum !== 'string') return { ok: false, reason: 'missing_signature' };
  const props = sig.properties.map(String);
  for (const need of ['transaction.id', 'transaction.status', 'transaction.amount_in_cents']) {
    if (!props.includes(need)) return { ok: false, reason: 'unsigned_fields' };
  }
  const ts = body.timestamp ?? sig.timestamp;                     // la documentación lo ubica en `timestamp` o en `signature.timestamp`
  if (ts == null || ts === '') return { ok: false, reason: 'missing_timestamp' };
  const data = body.data || {};
  const concat = props.map((p) => { const v = getPath(data, p); return v == null ? '' : String(v); }).join('') + String(ts) + eventsSecret;
  const expected = await sha256Hex(concat);
  if (!timingSafeEqual(expected, sig.checksum)) return { ok: false, reason: 'bad_checksum' };
  if (headerChecksum && !timingSafeEqual(expected, headerChecksum)) return { ok: false, reason: 'header_mismatch' };
  return { ok: true };
}

/** Fecha ISO UTC con milisegundos, como exige `expiration-time`. */
export const isoMs = (d) => new Date(d).toISOString();

async function wompiGet(fetchFn, url, key, timeoutMs = 8000) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const r = await fetchFn(url, { method: 'GET', headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: ctl ? ctl.signal : undefined });
    let json = null; try { json = await r.json(); } catch { /* cuerpo no JSON */ }
    return { status: r.status, json };
  } finally { if (timer) clearTimeout(timer); }
}

const normalize = (d) => ({
  id: String(d.id), reference: String(d.reference ?? ''), status: String(d.status || '').toUpperCase(),
  amount_in_cents: Number(d.amount_in_cents), currency: String(d.currency || '').toUpperCase(),
  payment_method_type: d.payment_method_type ? String(d.payment_method_type) : null,
});

/** Consulta la transacción en Wompi (fuente de verdad). Devuelve null si no existe; lanza Error('wompi_unavailable') si falla. */
export async function fetchTransaction(fetchFn, cfg, id) {
  let res;
  try { res = await wompiGet(fetchFn, `${cfg.apiBase}/transactions/${encodeURIComponent(id)}`, cfg.publicKey); } catch { throw new Error('wompi_unavailable'); }
  if (res.status === 404) return null;
  if (res.status >= 500 || res.status === 429) throw new Error('wompi_unavailable');
  const d = res.json && res.json.data;
  if (res.status !== 200 || !d || d.id == null || !Number.isFinite(Number(d.amount_in_cents))) throw new Error('wompi_bad_response');
  return normalize(d);
}

/** Búsqueda por referencia (conciliación de webhooks perdidos). Endpoint de la API de Wompi; verificar en Sandbox antes de confiar en él. */
export async function fetchTransactionByReference(fetchFn, cfg, reference) {
  let res;
  try { res = await wompiGet(fetchFn, `${cfg.apiBase}/transactions?reference=${encodeURIComponent(reference)}`, cfg.publicKey); } catch { throw new Error('wompi_unavailable'); }
  if (res.status >= 500 || res.status === 429) throw new Error('wompi_unavailable');
  const list = res.json && Array.isArray(res.json.data) ? res.json.data : [];
  const mine = list.filter((d) => d && String(d.reference) === reference && d.id != null && Number.isFinite(Number(d.amount_in_cents)));
  if (!mine.length) return null;
  // Si hubo varios intentos con la misma referencia, se prefiere uno APPROVED, luego el más reciente.
  mine.sort((a, b) => (b.status === 'APPROVED') - (a.status === 'APPROVED') || String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return normalize(mine[0]);
}
