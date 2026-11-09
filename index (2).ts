// Edge Function billing-checkout — crea el cobro de Wompi (firma en servidor) y verifica el resultado.
// Despliegue: verify_jwt = true (requiere sesión de Supabase):  supabase functions deploy billing-checkout
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handle } from './core.js';

Deno.serve((req: Request) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const env: Record<string, string | undefined> = {};
  for (const k of ['WOMPI_ENVIRONMENT', 'WOMPI_PUBLIC_KEY', 'WOMPI_PRIVATE_KEY', 'WOMPI_EVENTS_SECRET', 'WOMPI_INTEGRITY_SECRET', 'APP_URL', 'ALLOWED_ORIGINS']) env[k] = Deno.env.get(k);
  const getUser = async (token: string) => { const { data, error } = await admin.auth.getUser(token); return error || !data?.user ? null : { id: data.user.id }; };
  return handle(req, { env, admin, getUser, fetchFn: fetch });
});
