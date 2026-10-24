# KARTTA

Plataforma SaaS para restaurantes, cafés y bares: carta digital con QR, página propia, panel de gestión, pedidos, estadísticas e IA.

- **Frontend:** páginas HTML estáticas en Vercel (`index`, `onboarding`, `dashboard`, `menu`, `terminos`).
- **Backend:** Supabase (Auth, Postgres con RLS, Storage, Edge Functions). Proyecto `ifbvdjvukygvvgiyzgav`.
- **Documentación:** `docs/ARQUITECTURA.md` y `docs/ESTADO.md`.

Nunca subas claves secretas (`service_role`, `GEMINI_API_KEY`, `.env`) a este repositorio.


## Reportes públicos del menú

- La tabla privada `public.menu_reports` y la función de rate limit `consume_menu_report_rate_limit` se crearon con la migración `supabase/migrations/20261024000000_menu_reports.sql`.
- La Edge Function `submit-menu-report` está desplegada en Supabase con `verify_jwt=false`; valida el restaurante publicado, el producto relacionado, categoría y longitud del mensaje. Tiene CORS para el dominio principal y subdominios `.food`, y limita 3 envíos por IP seudonimizada cada 15 minutos.
- El formulario visible del menú está en el PR [Public menu: add secure report issue flow](https://github.com/KoveDesing/karttav2/pull/1). Debe pasar revisión/merge para que los visitantes vean el botón.
- No se concede acceso directo a la tabla a `anon` ni `authenticated`; los envíos se procesan desde la función.
