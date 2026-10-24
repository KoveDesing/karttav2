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

## Telemetría de Kartta AI

- La migración `supabase/migrations/20261024001000_ai_call_events.sql` crea `public.ai_call_events`, una tabla con RLS habilitado y acceso de servicio únicamente.
- La Edge Function existente `ai-assistant` registra proveedor/modelo, tokens de entrada/salida, latencia y errores sin guardar mensajes del usuario ni bloquear la respuesta si falla la telemetría.
- La tabla ya está creada en el proyecto Supabase y la función `ai-assistant` está desplegada con la versión de telemetría.
- El panel privado consume estos eventos para mostrar tokens, latencia, errores y coste estimado. No se presenta un coste exacto si Groq no lo informa.
