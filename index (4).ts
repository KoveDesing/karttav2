// Edge Function billing-cron — la invoca el programador (pg_cron + pg_net, o Supabase Cron) una vez al día con
// Authorization: Bearer <CRON_SECRET>. Desplegar con --no-verify-jwt (se autentica con CRON_SECRET).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handle } from './core.js';

Deno.serve((req: Request) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const env: Record<string, string | undefined> = {};
  for (const k of ['CRON_SECRET', 'APP_URL', 'WOMPI_ENVIRONMENT', 'WOMPI_PUBLIC_KEY', 'WOMPI_PRIVATE_KEY', 'WOMPI_EVENTS_SECRET', 'WOMPI_INTEGRITY_SECRET', 'RESEND_API_KEY', 'BILLING_FROM_EMAIL', 'BILLING_REPLY_TO']) env[k] = Deno.env.get(k);
  return handle(req, { env, fetchFn: fetch, admin });
});
