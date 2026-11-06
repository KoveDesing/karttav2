// Envío de correo modular. Hoy: Resend (https://resend.com/docs/api-reference/emails/send-email). Para cambiar de proveedor,
// reemplaza solo esta función. NO se contrata ni se inventa ninguna credencial: sin RESEND_API_KEY y BILLING_FROM_EMAIL no se envía nada.
export function mailerConfigured(env) { return !!(env.RESEND_API_KEY && env.BILLING_FROM_EMAIL); }

/** @returns {Promise<{ok:true,id:string}|{ok:false,notConfigured?:boolean,retry?:boolean,error:string}>} */
export async function sendEmail(fetchFn, env, { to, subject, html, text, idempotencyKey }) {
  if (!mailerConfigured(env)) return { ok: false, notConfigured: true, error: 'email_not_configured' };
  let r;
  try {
    r = await fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': String(idempotencyKey) } : {}) },
      body: JSON.stringify({ from: env.BILLING_FROM_EMAIL, to: [to], subject, html, text, ...(env.BILLING_REPLY_TO ? { reply_to: env.BILLING_REPLY_TO } : {}) }),
    });
  } catch { return { ok: false, retry: true, error: 'email_network_error' }; }
  let j = null; try { j = await r.json(); } catch { /* sin cuerpo */ }
  if (r.ok && j && j.id) return { ok: true, id: String(j.id) };
  return { ok: false, retry: r.status >= 500 || r.status === 429, error: `email_provider_${r.status}` };
}
