// Edge Function mp-connect — conecta/desconecta Mercado Pago de un restaurante.
// El token viaja una sola vez (HTTPS) y se guarda en Supabase Vault; nunca vuelve al navegador.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handle } from './core.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve((req: Request) => {
  const url = Deno.env.get('SUPABASE_URL')!;
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  const adminClient = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  return handle(req, { userClient, adminClient, fetchFn: fetch, cors: CORS });
});
