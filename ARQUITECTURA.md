# Arquitectura de KARTTA

## Servicios
| Servicio | Uso |
|---|---|
| Vercel | Hosting de las páginas estáticas. `vercel.json` define `/m/<slug>` → `menu.html?r=<slug>`. |
| Supabase Auth | Cuentas (correo/contraseña y Google cuando se active). |
| Supabase Postgres | Todos los datos, protegidos con RLS. |
| Supabase Storage | Bucket `kartta-media` (público para leer; escritura solo del dueño). Ruta: `{restaurant_id}/{logo\|cover\|products\|categories\|design}/{archivo}.jpg`. |
| Edge Function `ai-assistant` | Asistente de IA. Usa el secreto `GEMINI_API_KEY` (solo servidor). |
| Firebase | **Ya no se usa en el código.** Pendiente: poner reglas "denegar todo" y luego cerrar el proyecto. |

## Modelo de datos (schema `public`)
- `profiles` — perfil del usuario (nombre, preferencias del panel, términos aceptados).
- `restaurants` — solo datos aptos para publicarse. `restaurant_private` — contacto/NIT/objetivos (solo dueño y admin).
- `restaurant_members` — roles `owner | admin | staff`. Nadie puede escribirla desde el navegador.
- `categories`, `products` — carta. `menu_designs` — borrador y versión publicada del editor visual.
- `restaurant_tables`, `orders`, `order_items` — mesas y pedidos.
- `restaurant_domains` — dominios (estado `pending/verified/failed`; solo el servidor verifica).
- `plans`, `subscriptions`, `coupons`, `payments`, `ai_usage` — planes y facturación (escritura solo con `service_role` en el servidor).
- `menu_events` — visitas medidas del menú público.
- `platform_admins` — administradores de la plataforma (solo servidor).

## Funciones (RPC)
`create_restaurant`, `publish_design`, `get_public_menu`, `resolve_hostname`, `track_event`, `place_order` (el precio lo calcula el servidor), `accept_terms`.

## Reglas de seguridad
1. Cada tabla tiene RLS; además hay privilegios por columna (p. ej. nadie cambia `slug`, `is_suspended` ni su plan desde el navegador).
2. Los límites del plan (productos, descuentos, personalización) se aplican con triggers en la base de datos.
3. Las claves del navegador son solo la clave pública (`sb_publishable_…`). La `service_role` y la clave de Gemini jamás van en el frontend.
4. Roles: `owner/admin` gestionan carta y configuración; `staff` solo ve y avanza pedidos.
