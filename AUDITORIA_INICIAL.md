# AUDITORÍA INICIAL — KARTTA

Fecha: 24-oct-2026. Alcance: repositorio (zip `karttav2`) + proyecto Supabase **Kartta** (`ifbvdjvukygvvgiyzgav`), con acceso real de lectura/escritura vía conector. **Sin acceso a Vercel, DNS, secretos ni proveedores de pago/IA** (no verificables aquí).

Etiquetas: FUNCIONA/VERIFICADO · PARCIAL · SOLO UI · BLOQUEADO POR CONFIGURACIÓN · NO IMPLEMENTADO · NO VERIFICABLE.

## Hallazgos y estado

| # | Sev. | Hallazgo (evidencia) | Estado |
|---|---|---|---|
| 1 | P0 | `payment_events`: `anon` y `authenticated` tenían todos los privilegios (incluido TRUNCATE; RLS sin políticas solo protegía lectura/escritura normal). Evidencia: `information_schema.role_table_grants`. | **CORREGIDO** (REVOKE) y verificado: 0 grants. |
| 2 | P1 | `place_order` descartaba en silencio productos agotados/inexistentes y creaba el pedido con menos ítems de los pedidos por el cliente. | **CORREGIDO**: rechaza con `some items unavailable`. Probado. |
| 3 | P1 | Pedido duplicado por doble clic/reintento (sin idempotencia). | **CORREGIDO** (heurística servidor: misma orden en 20 s devuelve la existente). Probado. No sustituye una clave de idempotencia del cliente (pendiente). |
| 4 | P1 | Cuota de imágenes: daba 2/3/5 según plan y permitía a cualquier miembro (contra la regla aprobada: solo Pro+, 5/día, owner/admin). | **CORREGIDO** y probado (ver PRUEBAS). |
| 5 | P2 | `restaurant_domains` aún permitía INSERT desde el navegador aunque el producto retira los dominios propios. | **CORREGIDO** (INSERT revocado; filas existentes y DELETE intactos). `resolve_hostname` sigue sirviendo 2 dominios ya existentes. |
| 6 | P2 | `track_event` anónimo sin tope (abuso/inflado de métricas). | **CORREGIDO**: máx. 600 eventos/min por restaurante. No impide un abuso distribuido. |
| 7 | P2 | «Ventas/pedidos de hoy» usaban medianoche del navegador, no hora de Colombia. | **CORREGIDO** en `dashboard.html`. NO probado en navegador. |
| 8 | P2 | Landing con cifras de ejemplo ($1.284.000, 124 pedidos…) y afirmación de que la IA edita el menú. | **CORREGIDO**: rotuladas «ejemplo»; afirmación ajustada a lo real. |
| 9 | P2 | Precios: landing $43.900/$84.900/$249.000; contexto menciona $44.900; BD tenía todos en NULL. | **PENDIENTE DE DECISIÓN**. Solo `pro=84.900` (decisión del documento maestro 1). Se revirtió a NULL lo que se había guardado para KARTTA y Personalizado. |
| 10 | P2 | Dashboard e onboarding indexables (sin robots/noindex). | **CORREGIDO**: `robots.txt` + `X-Robots-Tag`. Sin sitemap (falta dominio final). |
| 11 | P2 | CORS `*` en todas las Edge Functions. Todas exigen JWT salvo `submit-menu-report` (público por diseño) y `admin-api`/`admin-ai` (validan su propio token de administrador). | **SIN CAMBIO** (decisión pendiente: lista de orígenes cuando el dominio final esté definido). |
| 12 | P2 | Límites de archivo distintos: generación 10 MB (servidor desplegado) · visión 4 MB · bucket de menú 5 MB · el cliente reduce a ≤1536 px JPEG. | **DOCUMENTADO**; unificar requiere decisión (ver DECISIONES). |
| 13 | P2 | Modelos de proveedor: `gpt-image-2.5-sunburst` (imágenes) y `meta-llama/llama-4-scout…` (visión) no verificables sin las claves. | **NO VERIFICABLE**. |
| 14 | P2 | «Clientes» y estadísticas se calculan sobre los últimos 200 pedidos cargados. | **SIN CAMBIO** (aproximación; documentado). No hay estado «cancelado» en pedidos. |
| 15 | P3 | Archivos duplicados en la raíz (`landing-*.png`, `20261022_edad_consentimientos.sql`) y en `docs/`. | Sin cambio. |
| 16 | P3 | Asesor Supabase: «Leaked password protection» desactivado. | **BLOQUEADO**: se activa en Supabase → Authentication (propietario). |
| 17 | — | Funciones SECURITY DEFINER ejecutables por `anon` (`get_public_menu`, `place_order`, `track_event`, `resolve_hostname`, `resolve_slug_alias`). | Intencional (menú público). `search_path` fijado. |
| 18 | — | No hay secretos en el repositorio (solo claves *publishable* de Supabase, públicas por diseño). Escaneo por patrones. | FUNCIONA. |
| 19 | — | Panel del propietario: **existe** como proyecto separado «Kartta Admin» (funciones `admin-api`, `admin-ai`; solo lectura; un único administrador fijado por ID/correo en el código). Su código de interfaz no está en este repo. | NO VERIFICABLE (UI); backend revisado. |
| 20 | — | Pagos: tablas `payments`/`payment_events` existen; sin función de checkout ni webhook. | **NO IMPLEMENTADO** (sin proveedor). |
| 21 | — | Editor visual, chat con historial/memoria, importación de menú con IA, marketing, i18n. | **NO IMPLEMENTADO** (ver ESTADO.md). |
| 22 | — | No hay `package.json`, lint, typecheck ni tests automatizados (sitio estático). | Verificación = `node --check` de scripts + pruebas SQL. |

## Aislamiento multi-restaurante (RLS)
Todas las tablas públicas tienen RLS. Revisadas las políticas SELECT/INSERT/UPDATE/DELETE y los privilegios por columna: las escrituras del navegador están limitadas a columnas concretas, con `has_role(owner/admin)`; `slug`, `plan` y suscripciones no son editables desde el navegador. **No se ejecutó una prueba negativa con dos usuarios reales de restaurantes distintos** (requiere sesiones autenticadas; marcada NO EJECUTADA).
