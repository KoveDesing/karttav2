// Edge Function customer-otp — verificación de teléfono del cliente (código por WhatsApp o SMS).
// Despliegue: verify_jwt = true (el navegador llama con la clave anon). Archivos: index.ts + core.js.
// Secretos (solo servidor):
//   OTP_PEPPER                 cadena aleatoria larga (≥32 caracteres); firma los hashes de códigos e IPs
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
//   SMS:       TWILIO_SMS_FROM  (o TWILIO_MESSAGING_SERVICE_SID)
//   WhatsApp:  TWILIO_WHATSAPP_FROM (ej. whatsapp:+57...) y TWILIO_WA_CONTENT_SID (plantilla de autenticación aprobada, variable {{1}} = código)
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handle } from './core.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve((req: Request) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const env = Object.fromEntries(['OTP_PEPPER', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_SMS_FROM', 'TWILIO_MESSAGING_SERVICE_SID', 'TWILIO_WHATSAPP_FROM', 'TWILIO_WA_CONTENT_SID'].map((k) => [k, Deno.env.get(k) ?? '']));
  return handle(req, { admin, fetchFn: fetch, env, cors: CORS });
});
