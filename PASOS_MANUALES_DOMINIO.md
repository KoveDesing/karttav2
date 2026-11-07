# KARTTA — Migración a kartta.food: lo que debes hacer tú

## 1. Supabase (Authentication → URL Configuration)  ← causa del salto a karttafood.vercel.app
- Site URL: `https://kartta.food`
- Redirect URLs (agregar):
  - `https://kartta.food/**`
  - `https://www.kartta.food/**`
  - `https://*.kartta.food/**`
  - (opcional, pruebas) `http://localhost:3000/**`
- Quitar `https://karttafood.vercel.app/**` cuando termines de probar.
- Si usas Google: en Google Cloud Console → Credenciales → tu cliente OAuth, deja como URI de redirección SOLO la de Supabase (`https://ifbvdjvukygvvgiyzgav.supabase.co/auth/v1/callback`); los dominios van en "Orígenes autorizados": `https://kartta.food`.

## 2. Supabase (Edge Functions → Secrets)
- `APP_URL` = `https://kartta.food` (sin barra final)
- `ALLOWED_ORIGINS` = `https://kartta.food,https://www.kartta.food` (los subdominios de restaurantes hay que permitirlos en el código de la función si pagan desde ahí; avísame y lo hago)

## 3. Vercel (proyecto karttav2)
- Domains: agregar `*.kartta.food` (Vercel exige usar sus nameservers para el wildcard).
- Antes de cambiar nameservers en Hostinger: exporta y copia TODOS los registros (MX, TXT/SPF, DKIM, DMARC) a Vercel DNS. Los valores exactos de nameservers los muestra Vercel; no los inventes.
- Cuando `https://cualquiera.kartta.food` cargue con HTTPS, cambia `SUBDOMAINS_LIVE` a `true` en `supabase-init.js`.

## 4. Pendiente de tu decisión
Tu documento maestro decía `kartta.IDENTIFICADOR.food`, pero ese dominio (`*.food`) no es tuyo y no se puede cubrir con wildcard. Implementé `IDENTIFICADOR.kartta.food`, que sí funciona con `*.kartta.food`.
