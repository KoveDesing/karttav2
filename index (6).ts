// Edge Function wompi-webhook — URL de eventos de Wompi. DEBE desplegarse con verify_jwt = false (Wompi no envía JWT de Supabase):
//   supabase functions deploy wompi-webhook --no-verify-jwt
// La autenticidad se garantiza con el checksum de eventos (WOMPI_EVENTS_SECRET) y con la consulta a la API de Wompi.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handle } from './core.js';

Deno.serve((req: Request) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const env: Record<string, string | undefined> = {};
  for (const k of ['WOMPI_ENVIRONMENT', 'WOMPI_PUBLIC_KEY', 'WOMPI_PRIVATE_KEY', 'WOMPI_EVENTS_SECRET', 'WOMPI_INTEGRITY_SECRET']) env[k] = Deno.env.get(k);
  return handle(req, { env, fetchFn: fetch, admin });
});
