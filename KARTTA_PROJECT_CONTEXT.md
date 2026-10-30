# KARTTA — Contexto permanente del proyecto

**Última auditoría:** 29-oct-2026
**Alcance:** lectura estática del zip `karttav2-main` (102 archivos, 8.176 líneas de código/docs). No se ejecutó la app, no se accedió a Supabase, Vercel, DNS ni secretos, y no se modificó ningún archivo del repo.
**Convención:** `[V]` verificado leyendo el código · `[D]` dicho por la documentación del repo, no re-verificado · `[H]` hipótesis · `[X]` no verificable con los accesos disponibles.

---

## 1. Qué es KARTTA

SaaS para restaurantes, cafés y bares en Colombia: carta digital con enlace público y QR por mesa, panel privado, pedidos, estadísticas, editor visual de menú, asistente de IA y generación de imágenes con IA. Plan Pro de referencia: $84.900 COP/mes `[D]`. Objetivo comercial: operar con restaurantes reales.

## 2. Arquitectura verificada `[V]`

- **Sin build ni framework.** HTML + JS plano (módulos ES) servido como estático en Vercel. No hay `package.json`, lint, typecheck ni tests automatizados.
- **Backend:** Supabase (Auth, Postgres con RLS, Storage, Edge Functions, Realtime). Cliente cargado desde CDN (`@supabase/supabase-js@2.45.4` vía jsDelivr) en `supabase-init.js`, con la clave *publishable* (pública por diseño).
- **Hosting:** `vercel.json` reescribe `/m/:slug` → `/menu.html?r=:slug`, añade cabeceras básicas (nosniff, Referrer-Policy, X-Frame-Options SAMEORIGIN, Permissions-Policy) y `noindex` a dashboard/editor/onboarding/consentimiento.
- **Terceros en el navegador:** Google Fonts, `qrcodejs` (cdnjs), supabase-js (jsDelivr).
- **IA:** Groq (texto y visión) y OpenAI (imágenes), siempre desde Edge Functions con secretos del servidor.
- **Firebase:** ya no se usa en el código (la documentación antigua lo menciona).

## 3. Estructura del repositorio

| Archivo | Rol |
|---|---|
| `index.html` (1720 l.) | Landing + registro/login (correo y Google), JSON-LD, animaciones de scroll |
| `consentimiento.html` | Edad 18+ y aceptación de términos/privacidad (decide el servidor) |
| `onboarding.html` (610) | Crea datos del negocio, categorías y primeros productos |
| `dashboard.html` (1441) | Panel: inicio, productos, menú, personalizar, configuración, IA, dominio, pedidos, mesas, clientes |
| `editor.html` (713) | Editor visual tipo Canva (10 herramientas, borrador → publicar) |
| `menu.html` (975) | Menú público (también como vista previa del editor con `?preview=1`) |
| `menu-design.js` | Modelo de diseño compartido por editor y menú (12 plantillas, validación) |
| `supabase-init.js` | Cliente Supabase + `window.KARTTA_AUTH` (signup/login/google/requisitos) |
| `kartta-image-ai.js` | Helper de imágenes IA (generar, aplicar, cuota, visión) |
| `kartta-tour.js` | Guía interactiva del panel (9 pasos) |
| `cookies.js` + `cookies.html`, `terminos.html`, `privacidad.html`, `legal.css` | Legal y consentimiento de cookies |
| `kartta-motion.css` / `kartta-motion.js` | **Nuevo (30-oct-2026):** sistema de motion del panel (ver §14) |
| `kartta-modules.js/.css`, `kartta-metrics.js`, `kartta-qr.js` | **Nuevo (30-oct-2026):** centro de control, métricas, QR, pagos y filtros (ver §15) |
| `tarjeta.html`, `kartta-card.js`, `kartta-loyalty.js`, `kartta-loyalty-public.js`, `20261030_fidelizacion.sql` | **Nuevo (30-oct-2026):** fidelización (ver §16); SQL **NO aplicada** |
| `20261029_panel_fase1.sql` | **Nueva, NO APLICADA** (ver §15) |
| `*.sql` (5) | Migraciones **ya aplicadas** (documentación; algunas son solo comentarios) |
| `index.ts`, `index (1).ts`, `index (2).ts` | Tres Edge Functions distintas con nombre ambiguo (ver §8) |
| `assets/`, `landing-*.{png,jpg,webp}`, `diferencia-*`, `personalizacion-*` | Imágenes |
| `ESTADO*.md`, `ARQUITECTURA*.md`, `CAMBIOS_FASES*.md`, `docs/` | Documentación con muchas copias duplicadas |

## 4. Flujos principales

1. **Entrada:** `index.html` → registro/login (`KARTTA_AUTH`) → `onChange` consulta `my_requirements` → si faltan requisitos redirige a `consentimiento.html` → `ensureBusiness` llama `create_restaurant` (negocio + rol owner + prueba) → `dashboard.html`. `[V]` Sin confirmación por correo (requiere que Supabase tenga "Confirm email" desactivado `[X]`).
2. **Restaurante del usuario:** `restaurant_members` (user_id → restaurant_id, rol owner/admin/staff). `[V]`
3. **Menú:** productos/categorías por CRUD directo desde `dashboard.html` y `editor.html`, filtrando por `restaurant_id`; la seguridad real depende de RLS `[X]`.
4. **Publicación:** editor guarda borrador en `menu_designs` y publica con RPC `publish_design`. Menú público lee solo con `get_public_menu`. `[V]`
5. **QR/enlaces:** URL real `origin/m/<slug>` y `?mesa=N` por mesa; QR con `qrcodejs`. Los enlaces viejos redirigen vía `resolve_slug_alias`. `[V]`
6. **Pedidos:** cliente → RPC `place_order` (precio calculado en servidor) → panel con Realtime (`postgres_changes`) + refresco cada 30 s; estados y "pagado" se marcan a mano. `[V]`
7. **IA:** chat → Edge Function `ai-assistant`; foto → `ai-assistant-vision`; imágenes → `generate-product-image` + `apply-generated-product-image`. `[V]` el cableado del cliente; `[X]` el servidor desplegado.

## 5. Inventario funcional

| Función | Estado | Evidencia / archivos | Falta |
|---|---|---|---|
| Registro, login, Google, edad 18+, términos | PENDIENTE DE VERIFICACIÓN | `supabase-init.js`, `20261022_*.sql` | Probar en producción; Google activo en Supabase `[D]` |
| Creación de negocio | COMPLETA (código) / PENDIENTE DE VERIFICACIÓN | `create_restaurant` | Prueba E2E |
| Onboarding, productos, categorías | PARCIAL | `onboarding.html`, `dashboard.html` | Sin pruebas con sesión real |
| Editor visual y publicar | PARCIAL | `editor.html`, `menu-design.js` | Tipografía/secciones/anuncio bloqueadas a plan rank ≥ 3 (decisión pendiente) |
| Menú público, ficha, búsqueda, favoritos | PARCIAL | `menu.html` | Solo probado con datos simulados `[D]` |
| Enlaces, QR por mesa | PARCIAL | `dashboard.html` | Ver problema P1 (dirección `kartta.X.food`) |
| Pedidos con estados e historial | PARCIAL | `dashboard.html`, `place_order` | Sin pagos reales; sin notificación sonora/WhatsApp |
| Estadísticas (ventas, pedidos, clientes) | PROBLEMÁTICA | `dashboard.html` l.1391–1432 | Solo últimos 200 pedidos; sin filtros de rango |
| Contador "Tokens IA" | SOLO INTERFAZ | l.959–961 | Siempre muestra "—"/"Sin datos de uso" |
| Chat IA texto | PENDIENTE DE VERIFICACIÓN | invoke `ai-assistant` (código no está en el repo) | Función y secreto `[X]` |
| Chat IA con foto | PARCIAL | `index.ts` (visión) | Sin probar con foto real |
| Imágenes IA (Pro, 5/día) | PROBLEMÁTICA | `index (2).ts` vs `kartta-image-ai.js` | Ver P2 |
| Dominios propios | NO IMPLEMENTADA (retirada por decisión) | tabla en desuso | — |
| "Mi página" (web pública del negocio) | SOLO INTERFAZ | tarjeta "Próximamente" | Sin implementación |
| Pagos y suscripciones | NO IMPLEMENTADA | tablas sin checkout ni webhook | Elegir proveedor |
| Marketing, fidelización, correo, WhatsApp | NO IMPLEMENTADA | — | — |
| Panel del propietario | NO VERIFICABLE | vive en otro proyecto | — |
| i18n | NO IMPLEMENTADA | — | — |

## 6. Problemas identificados

| # | Sev. | Problema | Evidencia |
|---|---|---|---|
| P1 | Alta | El panel muestra como dirección oficial `kartta.<slug>.food`, pero el enlace real que funciona es `/m/<slug>`; ese dominio no existe (decisión pendiente del dominio). Riesgo de que el cliente comparta una URL inexistente. | `dashboard.html` l.449–455, 945, 963; `DECISIONES_PENDIENTES.md` #2 |
| P2 | Alta | La copia de `generate-product-image` del repo (`index (2).ts`) no coincide con el cliente: ids de estilo con guion bajo (`estudio_blanco`) frente a guion medio (`estudio-blanco`); RPC `reserve_image_generation` frente a `reserve_kartta_image_generation`; códigos de error `quota_exceeded`/`not_configured` frente a `daily_limit`/`openai_not_configured`; límite 5 MB frente a 10 MB; modelo `gpt-image-1` frente a `gpt-image-2.5-sunburst` de la documentación. Si se redespliega esa copia, la generación falla. | `index (2).ts`, `kartta-image-ai.js`, `CONFIGURACION_Y_DESPLIEGUE.md` |
| P3 | Media | Código de Edge Functions `ai-assistant`, `admin-api`, `admin-ai`, `submit-menu-report` y la mayoría de migraciones SQL no están en el repo (no hay fuente de verdad versionada). Tres funciones se llaman `index*.ts`. | listado del repo |
| P4 | Media | Estadísticas basadas en los últimos 200 pedidos; "Clientes" se infiere de teléfono/nombre; ventas dependen de marcar "pagado" a mano. | `dashboard.html` l.1397, 1410–1432 |
| P5 | Media | Sin cabecera CSP; dashboard y editor usan `innerHTML` (32 y 9 usos). Existen pruebas XSS documentadas con datos simulados, pero no se re-ejecutaron. | `vercel.json`; `grep innerHTML` |
| P6 | Media | CORS `*` en Edge Functions; `track_event` anónimo con tope por restaurante pero abusable de forma distribuida. | `index*.ts`; `AUDITORIA_INICIAL.md` |
| P7 | Media | La vista previa del panel descarga `menu.html` y `menu-design.js` y los reensambla por reemplazo de texto; es frágil ante cambios de formato en esos archivos. | `dashboard.html` l.824–832 |
| P8 | — | **Retirado (falso positivo):** `menu-design.js` NO se carga dos veces; la segunda coincidencia es la cadena que usa la vista previa para reensamblar `menu.html`. | `dashboard.html` l.16 y l.828 |
| P9 | Baja | Archivos duplicados y huérfanos: ~20 copias de `landing-*`, 4 `ESTADO*`, 4 `ARQUITECTURA*`, `diferencia-kartta-v2/v3.webp` sin referencia, `docs/` contradictorios (hablan de Gemini y Firebase). | listado, `md5sum` |
| P10 | Baja | Sin `sitemap.xml`; landing con SEO básico presente (JSON-LD, meta). | listado |
| P11 | Baja | Precios sin unificar (landing $43.900/$84.900/$249.000; contexto $44.900; BD solo `pro`). | `DECISIONES_PENDIENTES.md` #1 |

**Comprobaciones superadas `[V]`:** todos los scripts inline y `.js` pasan `node --check` (el único aviso en `index.html` es un bloque JSON-LD, no JavaScript); ningún manejador `onclick=` inline (se usa delegación de eventos); no hay secretos en el repo (solo la clave publishable); `.env` ausente; `env.example` sin valores.

## 7. Seguridad

- Cada tabla tiene RLS y privilegios por columna `[D]`; funciones SECURITY DEFINER con `search_path` fijado `[D]`. La edad mínima y la aceptación legal se imponen en BD con un trigger al crear restaurantes `[V]`.
- **No se ejecutó prueba negativa entre dos restaurantes con sesiones reales** (ni este audit ni la documentación previa). Es el riesgo abierto de mayor prioridad `[X]`.
- Pendientes: *Leaked password protection* (Supabase Auth), lista de orígenes CORS, CSP, rotación/verificación de secretos (`OPENAI_API_KEY`, `GROQ_API_KEY`).

## 8. Decisiones que deben respetarse

- Marca KARTTA: blanco/negro/rojo `#FF3145`, tipografía tipo Inter, bordes redondeados. El **panel arranca en modo oscuro** (`data-theme="dark"`, fondo `#0A0A0A`) con alternativa clara; menú público y landing son claros.
- Sitio estático sin build; no introducir frameworks sin acordarlo.
- Precios de pedidos calculados en el servidor; el navegador nunca fija el total.
- Imágenes IA solo plan Pro, 5 exitosas/día por restaurante, solo owner/admin, hora America/Bogota; los fallos no consumen cupo.
- Dominios propios retirados; el identificador (slug) editable conserva los enlaces viejos.
- Tipografías/orden de secciones/anuncio/pie: solo plan `rank >= 3` (decisión pendiente de confirmar).
- No se ofrece "CSS libre".

## 9. Áreas que requieren cuidado

`supabase-init.js` (todo el acceso pasa por él), `menu-design.js` (contrato compartido con la validación en BD `validate_menu_design`), `menu.html` (se reutiliza como vista previa), la reconstrucción de vista previa en `dashboard.html`, RPC `place_order`/`publish_design`/`get_public_menu`, y el cálculo de plan (`PLAN_RANK` en el cliente debe coincidir con `plans.limits.rank` en BD).

## 10. Animaciones: estado actual (para el próximo prompt)

- Ya existen: reveal con `IntersectionObserver` en landing y menú, `@keyframes` (landing 10, dashboard 3, menú 3), clases `.skel` de skeleton en el dashboard y reglas `prefers-reduced-motion` en todas las páginas (en el editor solo desactiva transiciones).
- No hay librería de animación; `editor.html` no tiene `@keyframes`. (Antes de §14; `.skel` existía pero no se usaba en ningún HTML/JS.)
- Cambio de vistas del dashboard: `irA(view)` alterna la clase `.view.active` (candidato natural para crossfade). Navegación móvil: `#tabbar` con 4 botones.
- Zonas de riesgo para animar: reensamblado de vista previa, listas de pedidos (se re-renderizan por Realtime cada cambio y cada 30 s), `innerHTML` masivo.

## 11. Hoja de ruta propuesta (no iniciada)

1. **Seguridad y datos (bloquea clientes reales):** prueba de aislamiento con dos cuentas; activar leaked-password protection; versionar en el repo todas las Edge Functions y migraciones; decidir CORS y CSP.
2. **Corregir P1 y P2:** decidir formato de URL (`/m/slug` hoy) y mostrarlo tal cual en el panel; sincronizar la función de imágenes del repo con la desplegada.
3. **Pedidos y pagos:** elegir proveedor (Wompi/Mercado Pago), checkout, webhook, planes y precios; estadísticas con rango y sin límite de 200.
4. **Probar de extremo a extremo en producción:** registro → onboarding → menú → QR → pedido → panel, en móvil real.
5. **IA:** verificar secretos y modelos; contador real de tokens/cuota.
6. **Operación:** notificaciones de pedido, WhatsApp, marketing.
7. **Pulido:** limpieza de duplicados, sitemap, y **motion design** (sistema de variables + crossfade, skeletons, blur reveal, microinteracciones, siempre con `prefers-reduced-motion`).

## 12. Pruebas a ejecutar tras cualquier cambio

- Registro/login con correo y Google; bloqueo por edad; redirección a consentimiento.
- Onboarding → dashboard con restaurante nuevo; crear/editar/eliminar producto y categoría con imagen.
- Editor: cambiar plantilla, deshacer/rehacer, autoguardado, publicar; ver `/m/<slug>` en 390 px y 320 px.
- Pedido real desde `/m/<slug>?mesa=1`; avance de estados en el panel; "pagado".
- Aislamiento: usuario A no lee ni edita datos del restaurante B (todas las tablas y Storage).
- Límites de plan (productos, personalización, IA) tanto en UI como en BD.
- `node --check` de todos los scripts; consola sin errores; navegación por teclado; `prefers-reduced-motion`.

## 13. Limitaciones de esta auditoría

No ejecuté la app ni un navegador; no inspeccioné Supabase (políticas RLS, funciones desplegadas, secretos), Vercel, DNS ni cuentas de OpenAI/Groq; el estado "probado" de la documentación del repo proviene de pruebas anteriores con datos simulados y no fue reproducido aquí. Las migraciones del repo son en parte solo comentarios, por lo que el esquema completo no se puede reconstruir desde el zip.

## 14. Cambios realizados el 30-oct-2026 (motion design del panel)

**Archivos nuevos:** `kartta-motion.css`, `kartta-motion.js`. **Modificado:** `dashboard.html` (3 cambios: enlace al CSS/JS al final del `<head>`; `irA()` llama a `KARTTA_MOTION.switchView` con respaldo al comportamiento original; barra `.skel` en el gate de carga). No se tocó lógica de negocio, Supabase, auth, formularios, rutas, SQL ni Edge Functions.

| Requisito del prompt | Qué se hizo |
|---|---|
| Sistema global | Variables `--m-*` (duraciones fast/base/slow, curvas out/spring/inout, distancias, escala de compresión, blur, elevaciones) |
| Crossfade | Vistas del panel: la saliente se desvanece (140 ms) mientras entra la nueva; sin retrasos; cambios rápidos consecutivos probados |
| Shared element | **Aproximación:** los modales nacen desde la posición del botón que los abrió (traslación parcial + escala con resorte) y salen con un fantasma animado. No es una morfología exacta tarjeta→guía |
| Magnification | Barra móvil `#tabbar`: proximidad del cursor (vecinos crecen, lejanos se reducen), toque con respuesta inmediata, estado activo permanente |
| Blur de cifras | Blur reveal con el valor real cuando cambia (sin contar números intermedios, para no mostrar datos falsos); `tabular-nums` |
| Skeleton / carga | Barra shimmer en el gate; fundido de salida del gate y entrada de la app. Las listas ya se cargan antes de mostrar el panel, por lo que no se añadieron skeletons que no se verían |
| Hover / clic / botones | Elevación, borde y sombra solo en tarjetas interactivas y con `hover:hover`; compresión en `:active`; iconos de botón con micro-desplazamiento |
| Texto | Blur reveal de títulos/subtítulos y entrada en cascada de tarjetas **solo la primera vez** que se visita cada vista |
| Spring | Curva `cubic-bezier(.34,1.32,.64,1)` (rebote mínimo) en toast, modales y dock |
| Reduced motion | Todo desactivado con `prefers-reduced-motion` (CSS y JS) |

**No aplicado (y por qué):** `editor.html`, `menu.html` e `index.html` no se modificaron: el menú y la landing ya tienen su propio sistema de reveal y `prefers-reduced-motion`, y el editor se comparte con la vista previa del cliente; tocarlos requiere una fase propia. El cierre del panel lateral móvil (`#sidebar`) ya tenía transición; el fondo (`.scrim`) solo anima la entrada.

**Pruebas ejecutadas (Chromium real, Supabase simulado en memoria; NO con sesión real):** panel carga sin errores de consola en escritorio, con movimiento reducido y en móvil 390 px; crossfade (vista saliente marcada y limpiada, sin estilos residuales), 3 cambios consecutivos sin vistas duplicadas, sin desborde horizontal, sin IDs duplicados, cifra cambia con blur y mantiene su texto real, modal abre/cierra con fantasma que se elimina, dock con valores 1.32/1.09/0.94 y tap que activa la vista a la primera. **No probado:** Safari/Firefox, dispositivos táctiles reales, lector de pantalla, sesión real de Supabase, rendimiento en móviles de gama baja.

## 15. Fase 1 del panel integral (30-oct-2026)

**Alcance de esta fase:** centro de control de Inicio, estado abierto/cerrado, compartir menú, filtros de pedidos, Métricas, Código QR y Pagos (estados). **No implementado todavía:** Fidelización (puntos, premios, canjes), Email marketing, importación/exportación de contactos, impresión de pedidos, variantes/adicionales de productos, duplicar/archivar productos, edición de contacto/redes dentro del panel (ya existe en el editor visual, herramienta «Redes», y WhatsApp en Configuración; no se duplicó).

| Módulo | Archivos | Estado |
|---|---|---|
| Inicio: nombre, estado de publicación real (Publicado / Borrador / Pendiente / No disponible), 9 accesos rápidos, interruptor abierto/cerrado | `kartta-modules.js`, `dashboard.html` | Probado con Supabase simulado |
| Abierto/cerrado (separado de la publicación) | RPC `set_restaurant_open`, trigger que rechaza pedidos si está cerrado, `get_restaurant_status`; aviso en `menu.html` | **Requiere aplicar la migración**; sin ella el panel dice «no disponible» |
| Compartir menú (nativo, WhatsApp, copiar) | `kartta-modules.js` | Probado (enlace real `/m/<slug>`) |
| Pedidos: búsqueda (n.º, cliente, mesa), estado, fecha, pago | `kartta-modules.js`, `dashboard.html` | Probado. Método de pago y tipo de entrega: **no existen en el modelo actual** |
| Métricas: visitas, pedidos, completados, cancelados, ventas confirmadas, ticket promedio, comparación con período anterior, por día y por hora, top productos; 7/30/90 días y rango personalizado; gráficas interactivas | `kartta-metrics.js` | Pedidos/ventas: verificado con datos de prueba (cálculo y zona horaria Bogotá). **Visitas dependen de poder leer `menu_events` (esquema no está en el repo)**; si no se puede, se muestra «no disponible» |
| «Productos más consultados» | `menu.html` envía `track_event(... 'product_view')` | **[X]** Depende de que `track_event` acepte ese tipo; si lo rechaza no se registra nada (falla en silencio) |
| Código QR: colores, estilo (cuadrado/redondeado/puntos), logo, PNG, SVG, compartir, restablecer, bloqueo por contraste | `kartta-qr.js` | PNG y SVG decodificados con OpenCV → apuntan a `/m/<slug>`. Probado con un núcleo QR equivalente (el sandbox no accede al CDN de qrcodejs). **Logo no probado** (no hay logo en los datos de prueba). Diseño guardado en `profiles.prefs.qr[restaurante]` |
| Pagos: estado por proveedor (Wompi, Mercado Pago), pasos de vinculación, pagos confirmados a mano | `kartta-modules.js`, tabla `payment_accounts` (solo lectura) | Sin integración real: ningún proveedor se muestra conectado |

**Migración `20261029_panel_fase1.sql` (NO aplicada ni probada contra Postgres):** `restaurants.is_open`, RPC `set_restaurant_open` (owner/admin/staff), RPC pública `get_restaurant_status`, trigger `trg_orders_block_closed` sobre `orders`, tabla `payment_accounts` con RLS (select owner/admin, sin escritura desde el navegador). No redefine `get_public_menu` ni `place_order`. Aplicar primero en una rama de Supabase. El trigger supone que `orders.restaurant_id` y `restaurants.is_suspended` existen (los usa el código actual).

**Variables de entorno nuevas:** ninguna. **Pendiente de configuración externa:** cuenta y credenciales de Wompi/Mercado Pago (secretos de Edge Functions + webhook verificado), proveedor de correo para la fase de Email marketing.

**Pruebas pendientes (no ejecutadas):** aislamiento entre dos restaurantes con sesiones reales; migración en una base real; Safari/Firefox; escaneo con celulares reales; rendimiento con miles de pedidos (la consulta de métricas lee hasta 3.000 pedidos y 10.000 eventos del rango y avisa si se trunca).

## 16. Fase 2 — Fidelización (30-oct-2026)

**Qué hay:** panel «Fidelización» con 7 pestañas (Resumen, Clientes, Puntos, Premios, Canjes, Juegos, Tarjeta); página pública `tarjeta.html` (ruta `/t/<token>`); botón «Mi tarjeta de puntos» en el menú público (`kartta-loyalty-public.js`, solo si el programa está activo y fuera de la vista previa del editor).

**Modelo (migración `20261030_fidelizacion.sql`, NO aplicada ni probada en Postgres):** `loyalty_settings`, `loyalty_customers` (único por restaurante+teléfono normalizado, `card_token` privado, consentimiento obligatorio), `loyalty_rewards`, `loyalty_movements` (libro auditable; índices únicos: un abono por pedido, un bono de bienvenida, un juego por día), `loyalty_redemptions` (código de 6 caracteres).

**Seguridad (diseño):** RLS solo de lectura para owner/admin/staff del restaurante; ninguna escritura directa; todo saldo se mueve en `_loyalty_move` (bloqueo de fila, saldo ≥ 0, registro del movimiento). El cliente no puede asignarse puntos: solo pide canjes (se descuentan al pedir y quedan «pendientes» hasta que el local entrega o cancela y devuelve) y juega la ruleta (azar y límite diario en el servidor). Abono automático por trigger en `orders` cuando el pedido queda **pagado** y no cancelado, con el teléfono del pedido = teléfono del cliente. El registro público **no devuelve el enlace de un teléfono ya registrado** (un teléfono no es una contraseña); el local puede reenviarlo por WhatsApp.

**Tarjeta del cliente:** diseño personalizable (4 colores, estilo, título, texto del saldo) validado en SQL (hex, longitudes) y renderizado con `textContent` (sin inyección). El cliente guarda el enlace en su celular (localStorage + «Añadir a pantalla de inicio»). **No es una tarjeta de Apple Wallet/Google Wallet** (requiere certificados y emisor propios).

**Pruebas (Chromium, Supabase simulado en JavaScript; NO prueban el SQL):** activar programa, reglas, crear cliente (bloqueado sin consentimiento), búsqueda, historial, ajuste con motivo, exportar CSV (neutraliza fórmulas), premios, entregar canje, ruleta con probabilidades, editor de tarjeta con aviso de contraste y texto sin HTML, tarjeta pública en móvil sin desborde, canje y giro, token inválido, registro desde el menú (consentimiento, teléfono ya existente, redirección a `/t/<token>`). Hallazgo corregido durante la prueba: los scripts con ruta relativa fallaban bajo `/t/…` y `/m/…`; ahora son absolutos.

**No implementado / pendiente:** conexión de Mercado Pago/Nequi (Nequi se integra normalmente a través de Wompi; requiere cuenta y credenciales reales), Email marketing, sorteos, reversa de puntos si un pedido se cancela después de pagado, límites por plan, borrado de cliente a solicitud (hoy solo desde SQL), prueba del SQL y del aislamiento entre restaurantes con sesiones reales.
