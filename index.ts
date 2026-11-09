// Edge Function admin-billing — desplegar con --no-verify-jwt (la sesión es la del PANEL, otro proyecto; se valida dentro).
// Secretos: PANEL_SUPABASE_URL, PANEL_SUPABASE_KEY (clave publishable del panel), PANEL_ORIGINS (origen del panel, p. ej. https://karttapanel.vercel.app),
// y PANEL_ADMIN_EMAILS (opcional; si no, se usa la tabla public.panel_bridge_admins que ya usan admin-api/admin-support).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handle } from './core.js';

Deno.serve((req: Request) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const env: Record<string, string | undefined> = {};
  for (const k of ['PANEL_SUPABASE_URL', 'PANEL_SUPABASE_KEY', 'PANEL_ORIGINS', 'PANEL_ADMIN_EMAILS']) env[k] = Deno.env.get(k);
  return handle(req, { env, fetchFn: fetch, admin });
});
