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
| `kartta-home.js`, `supabase/functions/mp-connect/`, `20261030_mercadopago_vault.sql` | **Nuevo (30-oct-2026):** Inicio tipo trading, redes, conexión de Mercado Pago (ver §17) |
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

## 17. Aplicado en Supabase y Inicio tipo trading (30-oct-2026)

**Supabase (proyecto Kartta `ifbvdjvukygvvgiyzgav`, el que usa `supabase-init.js`) — esquema real leído y migraciones APLICADAS:**
`panel_fase1_estado_apertura_y_pagos`, `fidelizacion_puntos_tarjetas_premios`, `mercadopago_conexion_vault`; Edge Function nueva `mp-connect` (verify_jwt, versión 1). No se tocaron las funciones existentes (`ai-assistant`, `generate-product-image`, `admin-*`, etc.).

**Correcciones al código por el esquema real:** `menu_events` usa `occurred_at` (no `created_at`) → visitas arregladas; `orders` no tiene columna de código → el n.º de pedido es el final del ID en mayúsculas (igual que `place_order`); `menu_events_select` solo permite owner/admin (staff no ve visitas); `track_event` sí acepta `product_view`.

**Pruebas contra la base REAL (transacciones revertidas, sin datos residuales):** abono automático al pagar (+250 por $25.000), sin doble abono, canje descuenta y cancelar devuelve, saldo insuficiente rechazado, ruleta una vez al día, ajuste negativo/sin motivo rechazados, otro dueño ve 0 clientes/movimientos y no puede ajustar ni configurar, inserciones/updates directos rechazados, restaurante cerrado rechaza pedidos desde el servidor, token de Mercado Pago cifrado en Vault y ilegible para el navegador, desconectar lo borra. Las columnas que consulta el panel existen y son legibles por el dueño.

**Mercado Pago:** el dueño pega su Access Token de producción; `mp-connect` verifica con `GET /users/me` y lo guarda en Vault. Lógica probada con 14 casos simulados (el token nunca se devuelve). **NO probado con un token real de Mercado Pago** y **todavía no cobra**: el pago con Mercado Pago dentro del menú público es la siguiente fase (crear preferencia, webhook verificado, marcar pagado solo por el webhook). Alternativa más segura a futuro: OAuth de Mercado Pago.

**Inicio:** encabezado (nombre, estado del menú, abierto/cerrado), panel de ingresos en vivo (Hoy/7/30/Este mes, cursor con ingresos del día, pedidos y acumulado, comparación con el período anterior, refresco cada 20 s y por Realtime), KPIs con minigráficas (pedidos, ticket, visitas, fidelización) y accesos agrupados (editor, menú público, añadir producto, redes sociales, QR, fidelización, premios, juegos, tarjeta, clientes, Mercado Pago con interruptor, pagos, métricas). Redes sociales: reutiliza el modelo del editor (`menu_designs.config.social`, validado por `KARTTA_DESIGN.parseSocialInput`); **guardar publica el menú completo**, incluidos cambios pendientes del editor.

**Pendiente:** desplegar el zip en Vercel (el cambio no se ve hasta entonces); email marketing; cobro con Mercado Pago/Nequi en el menú; sorteos; reversa de puntos si se cancela un pedido ya pagado (hoy el servidor impide cancelar pedidos pagados); borrado de cliente a solicitud; plan/límites de fidelización.

## 18. Inicio premium (31-oct-2026)

**Migración aplicada `inicio_dashboard_agregaciones`:** RPC `get_home_dashboard` (agrega en la base; exige ser owner/admin/staff; anon y otros restaurantes rechazados). Probada contra la base real con datos sintéticos revertidos: la suma de la serie diaria coincide con la suma directa de `orders`, la hora 23:30 de Bogotá cae en el día correcto, 24 h → 25 puntos, 12 meses → 12 puntos, «todo» elige el agrupamiento solo. Usa el índice existente `orders_restaurant_idx (restaurant_id, created_at desc)`; no se crearon tablas ni índices nuevos.

**Definiciones únicas (tarjetas, gráfica y detalle usan las mismas):** ingresos cobrados = pedidos pagados y no cancelados; valor de pedidos = no cancelados; ticket promedio = ingresos cobrados ÷ pedidos pagados; completados = entregados ÷ no cancelados; pendientes = nuevo + preparando + listo (ahora). **No existen** estados de reembolso, inventario real ni costos: no se calcula ganancia neta; «agotados» usa `products.is_available = false`. Zona horaria fija America/Bogota (no hay columna de zona por restaurante).

**Pantalla:** saludo + fecha + contexto del periodo; selector 24 h / 7 d / 30 d / 12 meses / Todo; 5 tarjetas (clic = detalle con pedidos incluidos paginados); gráfica de ingresos con línea suave, área, puntos, tooltip (fecha, ingresos, pedidos, ticket, valor de pedidos, % vs intervalo anterior) y resumen superior que sigue al cursor/dedo; 8 accesos rápidos (Mejorar mi plan → `index.html#precios`, el flujo de planes existente); analítica (productos más vendidos, evolución de pedidos, distribución por estado, actividad reciente, horas pico, agotados); herramientas (menú público, redes, fidelización, premios, juegos, tarjeta, clientes, Mercado Pago, pagos). Estados de carga (skeleton), vacío y error con reintento. El saludo antiguo quedó oculto; el resto de los bloques originales del Inicio se conserva debajo.

**Pruebas (Chromium, Supabase simulado; valores esperados calculados aparte en Python):** 7 d → $115.000 / 7 pedidos / ticket $23.000 / 3 pendientes / 50 % entregados; 24 h, 30 d, 12 m y todo coinciden; listas de detalle = filas esperadas; tooltip y resumen con ratón y táctil (se mantiene al levantar el dedo y se cierra al tocar fuera); vacío, error+reintento, móvil 390 px sin desborde, movimiento reducido, sin errores de consola. Bugs hallados y corregidos durante la prueba: tooltip suelto (clase CSS), ejes de conteo repetidos, tooltip táctil que desaparecía, error si la librería QR no carga.

**Límites:** la función SQL se probó contra la base real, la interfaz solo con datos simulados; no se probó con sesión real ni con Safari/Firefox/teléfonos reales; el emulador de la RPC en la prueba es JavaScript, no la función real.

## 19. IA del dashboard: chat, memoria, cuotas y seguridad (1-nov-2026)

**Archivos nuevos:** `20261031_ia_chat_cuotas.sql`, `supabase/functions/ai-assistant/{index.ts,core.js}`, `kartta-ai-chat.js`, `kartta-ai-chat.css`. **Modificados:** `dashboard.html` (vista IA reducida a un punto de montaje, chat antiguo eliminado, tarjeta de perfil/plan arriba de la barra lateral, tarjeta «Tu plan» en Configuración), `index.ts` de la raíz (ahora es solo un aviso 410 para `ai-assistant-vision`), este documento.

**Cuotas (fuente de verdad: `plans.limits.ai_monthly_questions`, calculadas en la base, nunca por el navegador):** Free/Prueba 20, KARTTA 200, Pro 500. Personalizado = sin cuota fija (`ai_contact_advisor`): se muestra «Hablar con un asesor» (WhatsApp 573152507850, el que ya usa `index.html`) y no se permite preguntar hasta que un administrador fije una cuota con `admin_ai_set_quota_override`. Los precios mostrados ($43.900 / $84.900) son solo etiquetas del panel (`PLAN_PRICE`); `plans.monthly_price_cop` sigue sin tocar. Las variables `AI_MONTHLY_LIMIT` y `AI_FREE_MONTHLY_LIMIT` ya no se usan.

**Regla única de conteo:** 1 pregunta = 1 fila en `ai_usage_events`, sin importar cuántas llamadas haga por dentro; los tokens se suman. Cuenta (`ai_usage.requests + 1`) solo cuando el evento pasa a `completed` (hubo respuesta, aunque el usuario la detenga). Un fallo antes de responder queda `failed` y no descuenta; si el proveedor reportó tokens, esos sí se suman. Mientras se genera, el evento queda `reserved` y ocupa un cupo (reserva atómica con `pg_advisory_xact_lock` por restaurante+mes, idempotencia por `request_key`, máximo 3 en curso); una reserva de más de 5 min deja de ocupar cupo. Si el proveedor no devuelve `usage`, se cuenta la pregunta con tokens 0 y `usage_reported=false` (no se inventan cifras). Borrar chats no reinicia nada (`conversation_id` pasa a NULL). Período: mes calendario America/Bogota (`private.ai_period_start()`); cuando haya cobro con ciclo real, se cambia solo esa función.

**Seguridad:** RLS en todas las tablas nuevas (el navegador solo lee lo suyo; nadie escribe directo). Chats solo visibles para su autor; memoria para owner/admin del restaurante. Funciones de reserva/cierre solo `service_role`. El modelo no tiene herramientas ni acceso a tablas; solo recibe datos del propio restaurante, su memoria y el historial de ese chat. Peticiones de información interna de KARTTA se detienen en el servidor **antes** de llamar al modelo (`core.js`, lista de patrones, sin consumir cupo y registradas como `blocked/confidential_request`); la salida del modelo se escanea en vivo (claves, JWT, nombres de variables, canario del prompt). Es una defensa por capas, **no infalible**: el filtro por patrones no cubre todas las paráfrasis; la barrera real es que el modelo nunca recibe secretos ni datos de otros restaurantes.

**Admin:** RPC `admin_ai_overview`, `admin_ai_restaurant_usage`, `admin_ai_set_quota_override`, `admin_ai_set_price` (exigen `private.is_platform_admin()` en el servidor). El coste real solo se calcula con precios cargados en `ai_model_prices` (vacía a propósito). `platform_admins` está vacía en este proyecto: el panel externo debe leer con service role o registrar su usuario ahí.

**Pruebas ejecutadas:** SQL contra la base real en transacciones revertidas (planes 20/200/500/asesor, plan cancelado→Free, idempotencia, fallo sin descuento, tokens de fallo, 19/20 + simultánea→`busy`, reserva caducada, límite, borrar chat, override, antirruido de bloqueos, memoria con tope 30 y limpieza, aislamiento entre dos restaurantes, anon sin acceso, escrituras directas denegadas, RPC internas denegadas al usuario, admin permitido/denegado). `core.js`: 34 casos (20 bloqueos y 14 consultas legítimas que NO deben bloquearse). Edge Function con Deno/Supabase simulados: stream normal con tokens reales, bloqueo sin modelo, límite 429, fuga filtrada, error del proveedor sin descuento, sin `usage`, comando «recuerda que…», validaciones, detener con texto parcial. Chat en Chromium (escritorio y 390 px, Supabase/función simulados): uso 7/20, tokens, streaming, estado Procesando/Completada, bloqueo, ventana de límite (título y botones exactos), «Más tarde» bloquea el envío, asesor en Personalizado, memoria, borrar chat, sin desborde ni errores de consola.

**NO probado:** la Edge Function desplegada contra Groq real (`stream_options.include_usage` y el campo de uso del último fragmento dependen del modelo; si no llega, se registra `usage_missing`); `dashboard.html` completo con sesión real (la tarjeta del plan en la barra lateral y en Configuración solo se verificó estáticamente); Safari/Firefox y teclado móvil real; carga concurrente real (la concurrencia se prueba por el diseño del bloqueo, no con dos conexiones simultáneas); cobro/mejora de plan (no existe checkout: «Mejorar plan» lleva a `index.html#precios`).

**Pendiente de despliegue:** aplicar la migración (idempotente); desplegar `ai-assistant` (carpeta con `index.ts` + `core.js`, verify_jwt = true) y re-desplegar `ai-assistant-vision` con el aviso 410 (o desactivarla); subir `dashboard.html`, `kartta-ai-chat.js/.css`. Si más adelante se define el límite de CORS (`*` hoy), ajustar `CORS` en la función.

---

## 18. Actualización 1-nov-2026 — acento libre, soporte y políticas

**Alcance:** lectura + cambios en el zip `karttav2-main`. Probado en Chromium (Playwright) con un Supabase **simulado**; **no** se ejecutó contra tu Supabase real ni se aplicó ninguna migración.

### 18.1 Color de acento (dashboard.html + módulos)
- `--accent` sigue siendo la única variable de acento; se añadió `--on-accent` (negro o blanco según contraste; coral conserva texto blanco) y `--ok` ahora **es** el acento. Ya no hay verdes/amarillos/morados/azules fijos en iconos, barras, KPIs, indicador «en vivo», estados de pedido, chat IA ni guía.
- Estados de pedido (Nuevo / Preparando / Listo / Entregado / Cancelado) usan tonos del acento; los errores y acciones destructivas siguen en rojo (semántica). Las etiquetas de producto (`TAG_PAL`) son contenido del restaurante y no se tocaron.
- Selector libre: color visual + HEX + sliders R/G/B + restablecer coral. Aplica al instante y se guarda en `profiles.prefs.accent` (Supabase). Se valida `#RRGGBB` al leer y escribir.
- **Bug corregido:** `savePrefs` y la guía (`ktSave`) escribían `profiles.prefs` completo desde copias distintas y podían borrarse entre sí (p. ej. perder el acento). Ahora ambos fusionan sobre `perfil.prefs`.

### 18.2 Soporte y reportes + Políticas y privacidad
- Migración `20261101_soporte_politicas.sql` (**NO APLICADA**): `legal_document_versions`, `legal_contact`, `support_tickets/messages/attachments/ticket_events`, bucket privado `support-attachments`, RLS de solo lectura, escritura solo vía funciones `security definer` (`support_*`, `admin_support_*`, `admin_legal_*`), tiempo real.
- Cliente: `kartta-support.js/.css` (vistas `soporte` y `politicas` del panel). Admin: `kartta-support-admin.js` + `soporte-admin.html` (usa la misma sesión; el servidor exige `private.is_platform_admin()`).
- Pendiente: integrar la bandeja en «Kartta Prime/Admin» (su código no está en este repo); revisión jurídica de los textos; datos de `legal_contact`; las páginas estáticas `privacidad/terminos/cookies.html` aún duplican el texto (se necesitan antes del login).
- Pruebas a ejecutar tras aplicar la migración: ver la lista de aceptación del prompt (ticket → admin → respuesta → lectura, aislamiento entre restaurantes, notas internas ocultas, adjuntos).


---

## Actualización 2026-11-03 — QR de mesa, identidad por OTP, fidelización ampliada y KARTTA AI flotante

**Verificado (migración probada en transacción revertida contra la base real, ver `DESPLIEGUE_QR_FIDELIZACION_AI.md`):**
- Pedidos en mesa SOLO con sesión de mesa válida: `start_table_session(qr_token)` → `place_table_order(session, …)`. `place_order` ya no es invocable desde el navegador. QR único por mesa (`restaurant_tables.qr_token`, uuid), mesas activables/desactivables y QR regenerable.
- Identidad del cliente por teléfono verificado (OTP): Edge Function `customer-otp` + RPC `otp_issue`/`otp_verify` (solo service_role). Sesión de cliente con hash en `customer_sessions`; el enlace secreto `/t/<token>` fue retirado (`/t/<slug>` abre la tarjeta con la sesión).
- Puntos: solo clientes verificados (`orders.customer_id`), idempotentes por saldo neto del pedido; reverso automático si se desmarca el pago o se cancela; re-abono si se vuelve a pagar.
- Recompensas con vigencia, límite por cliente y límite total (canje serializado). Niveles opcionales por puntos históricos. Derecho de supresión (`customer_delete_my_data`) y consentimiento de promociones separado.
- Editor visual de tarjeta ampliado (8 plantillas, colores, degradado, 8 patrones, 5 tipografías, tamaño/peso/alineación, iconos, textos) con vista previa en celular. Pestañas: Resumen, Programa de puntos, Recompensas, Diseño de tarjeta, Clientes, Historial, Canjes, Juegos.
- KARTTA AI flotante (`kartta-ai-float.js/.css`): componente global que reutiliza la Edge Function `ai-assistant` (se añadió el campo opcional `section`, lista cerrada, con datos extra de mesas/clientes calculados en el servidor). Acciones: solo la arquitectura (registro + confirmación); ninguna acción modifica datos todavía.

**Pendiente / no verificado:** envío real de códigos (requiere cuenta Twilio y secretos), despliegue de las Edge Functions, prueba end-to-end en producción con un restaurante real, KARTTA AI dentro de `editor.html` (página separada), imagen en recompensas.

---

## Actualización 2026-11-04 — Botón flotante de WhatsApp

**Decisión de arquitectura:** no se creó tabla nueva. Se reutiliza `public.restaurants` (ya guardaba `whatsapp` y es lo que lee `get_public_menu`): columnas nuevas `whatsapp_enabled` (default false) y `whatsapp_country_code` (default `57`); `whatsapp` pasa a guardar el número nacional solo con dígitos. Por eso el número de «Configuración» y el del botón son **el mismo**.

**Seguridad:** las 2 columnas nuevas no tienen UPDATE para `authenticated`; solo se escriben con `set_whatsapp_button` (owner/admin, valida indicativo y número en el servidor, no duplica el indicativo). `get_public_menu` devuelve `restaurant.wa_button` (dígitos listos para wa.me) solo si está activo y es válido; `get_public_whatsapp(slug)` permite refrescar el botón sin recargar el menú.

**Archivos:** `20261104_whatsapp_boton.sql` (**NO aplicada** al escribir esto), `kartta-whatsapp.js` (sección «Botón de WhatsApp» del panel), `kartta-wa-fab.js` (botón del menú), cambios mínimos en `menu.html` (script + 2 llamadas) y `dashboard.html` (vista, menú lateral, script), estilos al final de `kartta-modules.css`.

**Pruebas:** SQL probado contra la base real dentro de una transacción revertida (18 vectores de normalización, A no puede editar B, anon sin acceso, escritura directa bloqueada, activar sin número rechazado, desactivar/borrar oculta el botón). Interfaz probada en Chromium con Supabase simulado (móvil 390 y escritorio 1280: posición, 60×60, sin solapes con carrito ni barra inferior, aparece/desaparece, vista previa sin navegación). **No probado:** Safari/iPhone y Android reales, sesión real, apertura real de WhatsApp.
