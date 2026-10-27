# PRUEBAS Y RESULTADOS

Todas las pruebas SQL se ejecutaron en el proyecto real dentro de un bloque `DO` que termina en excepción, para que **nada quede guardado** (se comprobó después: 0 productos/pedidos/generaciones de prueba).

| # | Prueba | Resultado | Evidencia |
|---|---|---|---|
| 1 | Reserva de imagen con restaurante en prueba gratis | **PASS** (`plan_required`) | `reserve_kartta_image_generation` |
| 2 | Plan Pro: 5 reservas permitidas, la 6.ª bloqueada | **PASS** (1..6 → ok, contador 4,4,3,2,1,0 tras liberar el fallo) | DO-block revertido |
| 3 | Un intento fallido libera cupo | **PASS** | idem |
| 4 | Usuario ajeno/no miembro reserva | **PASS** (`forbidden`) | idem |
| 5 | Validación de identificador (`_slug_reason`): válido, corto, reservado, doble guion, mayúsculas | **PASS** | SELECT |
| 6 | `place_order`: total calculado en servidor (2×12.000=24.000) | **PASS** | DO-block revertido |
| 7 | `place_order`: mismo pedido en 20 s → mismo id, `duplicate:true` | **PASS** | idem |
| 8 | `place_order`: producto inexistente → rechazado | **PASS** (`some items unavailable`) | idem |
| 9 | `place_order`: producto agotado → rechazado | **PASS** | idem |
| 10 | `place_order`: product_id no UUID → rechazado | **PASS** (`invalid items`) | idem |
| 11 | Privilegios `payment_events` / `restaurant_domains` tras migración | **PASS** (0 grants / SELECT,DELETE) | information_schema |
| 12 | Validación de slug en el navegador (13 casos) | **PASS** | `node` |
| 13 | Sintaxis de `dashboard.html`, `index.html`, helper JS, JSON-LD, `vercel.json` | **PASS** | `node --check`, `json.load` |
| 14 | Concurrencia real de reservas (2+ conexiones simultáneas) | **NO EJECUTADA** (el conector usa una sola sesión; la protección es `pg_advisory_xact_lock`) | — |
| 15 | Aislamiento: usuario A lee/edita/borra datos del restaurante B | **NO EJECUTADA** (requiere dos sesiones reales) | — |
| 16 | Generación real con OpenAI / análisis real con Groq / aplicar imagen a producto | **NO EJECUTADA** (sin claves ni restaurante Pro) | — |
| 17 | Cambio de identificador (`change_restaurant_slug`) con usuario real | **NO EJECUTADA** (requiere sesión autenticada; `auth.uid()` es nulo en el conector) | — |
| 18 | Redirección de enlace viejo de menú en navegador | **NO EJECUTADA** | — |
| 19 | Responsive móvil/tablet/escritorio, accesibilidad por teclado | **NO EJECUTADA** (sin navegador) | — |
| 20 | Pagos, webhooks, panel administrativo, marketing | **NO EJECUTADA / NO IMPLEMENTADO** | — |

Reproducir 1–4: restaurante con suscripción `pro/active`, llamar `select public.reserve_kartta_image_generation(<restaurant_id>, <user_id>)` seis veces.

## Editor visual (navegador real Chromium, Supabase simulado en memoria)
| # | Prueba | Resultado |
|---|---|---|
| E1 | La vista previa es el menú real (`menu.html?preview=1`) y muestra productos/diseño del borrador | PASS |
| E2 | Plantilla, deshacer y rehacer cambian y restauran el menú | PASS |
| E3 | Disposición «cuadrícula» se refleja en la vista previa | PASS |
| E4 | Autoguardado envía solo el borrador compacto (sin claves avanzadas en plan básico); estado «Borrador guardado» | PASS |
| E5 | Clic en una parte del menú abre su grupo en el panel | PASS |
| E6 | Tipografía/secciones bloqueadas en plan básico | PASS |
| E7 | Publicar llama `publish_design` y el estado pasa a «publicado» | PASS |
| E8 | Plan Personalizado: anuncio, pie, reordenar secciones y tipografía se ven en la vista y se guardan | PASS |
| E9 | Error del servidor al guardar muestra mensaje claro y botón Reintentar | PASS |
| E10 | Sin errores JS en escritorio y móvil | PASS |
| E11 | Inyección: HTML en tagline/anuncio/pie/nombre de producto y CSS en colores/fuente NO se ejecutan ni rompen la página | PASS |
| E12 | Validación en BD (trigger) con 12 casos: válidos, color inválido, clave desconocida, radio fuera de rango, enum inválido, premium requerido, bloques sin header | PASS (transacción revertida) |
| E13 | Con sesión real de Supabase (RLS, plan real), en Vercel, con fuentes de Google y fotos reales | **NO EJECUTADA** |
| E14 | Safari/Firefox, lector de pantalla, arrastrar y soltar con ratón real, tablet | **NO EJECUTADA** |

## Editor visual v2 (Canva) — 28 comprobaciones en Chromium real, Supabase simulado
Barra lateral (6 herramientas) · vista previa real · plantillas · deshacer/rehacer · tarjetas visuales · color rápido y paleta · candado de tipografía en plan básico · frase en vivo · tamaño de letra · **subir logo (Storage + ruta guardada)** · lista de productos · «Agregar productos» navega al panel · estado sin productos · autoguardado · vista del cliente · clic en menú abre herramienta · publicar · premium (tipografía, anuncio, reordenar, guardado) · error de guardado con Reintentar · móvil (barra inferior y panel) · inyección de código → **28/28 PASS**.
No ejecutado: sesión real de Supabase (permisos/RLS reales), Safari/Firefox, arrastrar con ratón real, subida con foto real grande, fuentes de Google en producción.

## Bloque 1 — marco de teléfono, ficha de producto y guía (Chromium real, Supabase simulado)
- Marco de teléfono: 1366×768, 1920×1080 y 1366×500 → ancho ≤430, centrado, alto ≤ ventana, sin scroll de página, scroll interno; móvil 390 → sin marco y ficha a pantalla completa. Ficha: nombre/precio, cantidad×total, agregar → carrito dentro del marco, Esc, agotado deshabilitado. **20/20 PASS**.
- Guía del panel: bienvenida con nombre real, 0 de 9 con restaurante vacío, spotlight + 4 bloqueadores, tarjeta dentro de pantalla (escritorio y móvil), navegación entre pasos, acción real abre el formulario de producto y pausa la guía, **no marca completo un paso sin producto guardado**, vuelve sola al cerrar el formulario, guardar progreso por restaurante en el perfil, retomar en el primer pendiente, Esc, dueño avanzado no recibe el recorrido forzado. **17/17 PASS**.
- Editor (28/28) y XSS (PASS) se repitieron tras los cambios.
- Hallazgo corregido durante la prueba visual: en el marco, la barra de categorías se aplastaba (flex-shrink); ya no.
- NO ejecutado: sesión real de Supabase, Safari/Firefox, lector de pantalla, dispositivos táctiles reales.

## Bloque 2 (Chromium real con Supabase simulado + pruebas SQL revertidas en tu base real)
- SQL real (transacción revertida): 10 predefinidas idempotentes; asignar/reemplazar; etiqueta inactiva no sale en el menú público; **etiqueta de otro restaurante rechazada; usuario ajeno rechazado**; contraste insuficiente rechazado; nombre duplicado (sin importar mayúsculas) rechazado; icono con HTML rechazado; diseño con showTags/tagPosition/showSearch/showNav/showHighlights válido y valores/claves raras rechazados; pedidos: no se salta, no retrocede, no se cancela pagado, no se paga cancelado, historial = 4 eventos. **Todo PASS.**
- Panel (20/20): gestor de etiquetas, categoría, asignación atómica, eliminar propia, predefinidas no eliminables, mover producto guarda `sort_order`, IA pregunta antes y no se ejecuta sola, «No» no llama a la IA, comparación y cupo, nada se aplica hasta guardar, se aplica la mejorada y se guarda la original, plan sin IA no la ofrece, exportación sin claves y que se ve sin conexión.
- Menú (18/18): barra inferior, etiquetas en tarjetas/categorías/sobre la foto, buscador (nombre y etiqueta), sin resultados, favoritos (persisten y filtran), carrito desde la barra, todo se oculta desde el diseño, barra dentro del marco en PC.
- Pedidos (6/6) y regresión: guía 17/17, editor 28/28, marco de teléfono 20/20, seguridad XSS PASS.
- Nota: en la simulación el `insert` no devuelve el id del producto nuevo (en tu base real sí), por eso la prueba de «aplicar IA» muestra `product_id: None`.
- NO ejecutado: generación real con OpenAI (sin plan Pro activo ni clave verificada), sesión real de Supabase en el navegador, Safari/Firefox, lector de pantalla, arrastrar con ratón real.
