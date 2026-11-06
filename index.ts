// Edge Function billing-checkout (verify_jwt = true: requiere sesión de Supabase).
// Secretos (Supabase → Edge Functions → Secrets): WOMPI_ENVIRONMENT, WOMPI_PUBLIC_KEY, WOMPI_PRIVATE_KEY, WOMPI_EVENTS_SECRET,
// WOMPI_INTEGRITY_SECRET, APP_URL (y opcional ALLOWED_ORIGINS). SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handle } from './core.js';

Deno.serve((req: Request) => {
  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const env: Record<string, string | undefined> = {};
  for (const k of ['WOMPI_ENVIRONMENT', 'WOMPI_PUBLIC_KEY', 'WOMPI_PRIVATE_KEY', 'WOMPI_EVENTS_SECRET', 'WOMPI_INTEGRITY_SECRET', 'APP_URL', 'ALLOWED_ORIGINS']) env[k] = Deno.env.get(k);
  return handle(req, {
    env, fetchFn: fetch, admin,
    getUser: async (token: string) => { const { data, error } = await admin.auth.getUser(token); return error || !data?.user ? null : { id: data.user.id, email: data.user.email }; },
  });
});
