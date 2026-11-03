// Lógica de customer-otp (sin dependencias de Deno para poder probarla en Node).
// Envía un código de 6 dígitos por WhatsApp/SMS (Twilio) y lo verifica. El código NUNCA se guarda en claro:
// solo su hash con un secreto del servidor (OTP_PEPPER). La sesión del cliente es un token aleatorio; la base solo guarda su hash.
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const json = (obj, status, cors) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export async function sha256Hex(text) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))); }
export function randomCode() {                       // 6 dígitos uniformes (muestreo con rechazo, sin sesgo de módulo)
  const max = Math.floor(0x100000000 / 1000000) * 1000000; const a = new Uint32Array(1);
  do { crypto.getRandomValues(a); } while (a[0] >= max);
  return String(a[0] % 1000000).padStart(6, '0');
}
export function randomToken() {                      // 256 bits, base64url
  const b = crypto.getRandomValues(new Uint8Array(32)); let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const mask = (p) => '+' + p.slice(0, p.length - 10 > 0 ? p.length - 10 : 0) + ' ••• ••• ' + p.slice(-4);

function providerConfig(env, channel) {
  const sid = env.TWILIO_ACCOUNT_SID, tok = env.TWILIO_AUTH_TOKEN;
  if (!env.OTP_PEPPER || !sid || !tok) return null;
  if (channel === 'whatsapp') return env.TWILIO_WHATSAPP_FROM && env.TWILIO_WA_CONTENT_SID ? { sid, tok, from: env.TWILIO_WHATSAPP_FROM, content: env.TWILIO_WA_CONTENT_SID } : null;
  return env.TWILIO_SMS_FROM || env.TWILIO_MESSAGING_SERVICE_SID ? { sid, tok, from: env.TWILIO_SMS_FROM, service: env.TWILIO_MESSAGING_SERVICE_SID } : null;
}
async function sendTwilio(fetchFn, cfg, channel, phone, code, restaurant) {
  const form = new URLSearchParams();
  if (channel === 'whatsapp') {
    form.set('To', 'whatsapp:+' + phone); form.set('From', cfg.from.startsWith('whatsapp:') ? cfg.from : 'whatsapp:' + cfg.from);
    form.set('ContentSid', cfg.content); form.set('ContentVariables', JSON.stringify({ 1: code }));
  } else {
    form.set('To', '+' + phone); if (cfg.service) form.set('MessagingServiceSid', cfg.service); else form.set('From', cfg.from);
    form.set('Body', `Tu código de ${String(restaurant || 'KARTTA').slice(0, 40)} es ${code}. Vence en 10 minutos. No lo compartas con nadie.`);
  }
  const r = await fetchFn(`https://api.twilio.com/2010-04-01/Accounts/${cfg.sid}/Messages.json`, {
    method: 'POST', headers: { Authorization: 'Basic ' + btoa(cfg.sid + ':' + cfg.tok), 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(),
  });
  return r.ok;
}

/** deps: { admin, fetchFn, env, cors } — admin es el cliente con service_role. */
export async function handle(req, deps) {
  const { admin, fetchFn, env, cors } = deps;
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);
  let b; try { b = await req.json(); } catch { return json({ error: 'invalid_json' }, 400, cors); }
  const action = b && b.action, slug = String((b && b.slug) || '').trim().toLowerCase();
  const digits = String((b && b.phone) || '').replace(/\D/g, '');
  if (!['send', 'verify'].includes(action) || !SLUG.test(slug) || digits.length < 8 || digits.length > 15) return json({ error: 'invalid_request' }, 400, cors);
  const pepper = env.OTP_PEPPER || '';

  if (action === 'send') {
    const channel = b.channel === 'sms' ? 'sms' : 'whatsapp';
    const cfg = providerConfig(env, channel);
    if (!cfg) return json({ ok: false, error: 'otp_not_configured' }, 200, cors);            // se avisa ANTES de gastar cupo de intentos
    const code = randomCode();
    const ip = String(req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
    const issued = await admin.rpc('otp_issue', { p_slug: slug, p_phone: digits, p_channel: channel, p_code_hash: await sha256Hex(`${pepper}:${slug}:${code}`), p_ip_hash: ip ? await sha256Hex(`${pepper}:ip:${ip}`) : null });
    if (issued.error) {
      const m = String(issued.error.message || '');
      const e = m.includes('rate_limited') ? 'rate_limited' : m.includes('invalid_phone') ? 'invalid_phone' : m.includes('disabled') || m.includes('not_found') ? 'disabled' : 'send_failed';
      return json({ ok: false, error: e }, e === 'rate_limited' ? 429 : 200, cors);
    }
    let sent = false; try { sent = await sendTwilio(fetchFn, cfg, channel, issued.data.phone, code, issued.data.restaurant); } catch { sent = false; }
    if (!sent) return json({ ok: false, error: 'send_failed' }, 200, cors);
    return json({ ok: true, masked: mask(issued.data.phone) }, 200, cors);
  }

  // verify
  const code = String(b.code || '');
  if (!/^\d{6}$/.test(code)) return json({ ok: false, reason: 'invalid_code' }, 400, cors);
  const token = randomToken();
  const v = await admin.rpc('otp_verify', {
    p_slug: slug, p_phone: digits, p_code_hash: await sha256Hex(`${pepper}:${slug}:${code}`), p_name: String(b.name || '').slice(0, 80),
    p_consent: b.consent === true, p_marketing: b.marketing === true, p_session_hash: await sha256Hex(token),
  });
  if (v.error || !v.data) return json({ ok: false, reason: 'server_error' }, 500, cors);
  if (!v.data.ok) return json({ ok: false, reason: v.data.reason, attempts_left: v.data.attempts_left }, 200, cors);
  return json({ ok: true, token, name: v.data.name, is_new: v.data.is_new }, 200, cors);
}
