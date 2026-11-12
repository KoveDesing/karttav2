# Auditoría y aplicación de límites por plan — 2026-11-11

## Qué existía
- `plans.limits` con valores antiguos: Pro 60 productos / 200 IA, Elite 200 / 500. No existían límites de mesas ni usuarios.
- Productos: trigger `trg_products_plan` (límite + descuentos rank≥2 + personalización rank≥3), sin bloqueo ante altas simultáneas.
- Mesas (`restaurant_tables`) y miembros (`restaurant_members`): sin ningún control en servidor.
- Diseño: `validate_menu_design` validaba formato y opciones avanzadas (ahora desde Pro), pero no las plantillas.
- IA: `ai_plan_info` / `ai_reserve_question` leen `limits.ai_monthly_questions` (lógica de consumo intacta).

## Migración aplicada: `limites_planes_servidor_20261111`
| | Free/Prueba | Pro (`kartta`) | Elite (`pro`) |
|---|---|---|---|
| Productos | 20 | 500 | 2.000 |
| Mesas | 5 | 30 | 100 |
| Usuarios | 1 | 5 | 15 |
| Créditos IA/mes | 20 | 300 | 1.000 |
| Plantillas | 2 (`clasico`, `oscuro`) | todas | todas |
- Triggers con `pg_advisory_xact_lock` por restaurante (sin carreras) en productos, mesas y miembros. Solo bloquean ALTAS; no editan ni borran nada.
- Plantillas: Free no puede cambiar a una plantilla/estilo avanzado. Solo se valida lo que CAMBIA, así los diseños ya guardados siguen guardándose.

## Pruebas en la base (con rollback)
Mesas permitidas: Free 5 · Pro 30 · Elite 100. Segundo usuario: Free bloqueado, Pro permitido. Productos en Free: la alta 21 se bloquea. Plantillas: Free→minimalista bloqueada, Free→oscuro permitida, Free→estilo neo bloqueado, guardar diseño existente sin cambios OK, Pro→minimalista permitida.

## Segunda ronda (decisiones del dueño)
Migraciones aplicadas directamente en Supabase (quedan en su historial de migraciones): `prueba_incluye_pro_descuentos_desde_pro_20261111`, `equipo_y_uso_plan_20261111` (archivo `20261111_equipo_y_uso_plan.sql`), `branding_y_analitica_por_plan_20261111`.
- La prueba de 7 días incluye todo lo de Pro (rank 1). Descuentos y personalización de producto: Pro y Elite.
- Invitaciones: RPC `invite_member`, `revoke_invite`, `remove_member`, `list_team`, `accept_my_invites` (se ejecuta al iniciar sesión). Respeta el límite de usuarios contando invitaciones pendientes. No envía correo: la persona entra con ese correo.
- Panel "Mi plan" (Facturación): barras de productos/mesas/usuarios/IA, avisos al 80 % y al 100 %. RPC `my_plan_usage`.
- Logo/portada, analítica y QR personalizado: Free ve la versión básica con tarjeta "KARTTA Pro".
- Bajar de plan: no se borra nada; solo se bloquean ALTAS por encima del límite (probado en la base).

## Lo que NO está verificado
- Navegador real con cuentas de los tres planes (se probó con roles simulados en SQL con rollback).
- El gating del QR personalizado es solo de interfaz (el QR se dibuja en el navegador).
- Pasarela Wompi en sandbox.

## Fase 1 del editor (2026-11-12): Botones y WhatsApp dentro del editor
- Nuevas herramientas «Botones» y «WhatsApp». Apariencia en `config.wa` / `config.btn` (borrador y publicado como todo el diseño); número e interruptor siguen en `restaurants` vía `set_whatsapp_button` (se guardan al instante).
- Matriz: Free = solo número/activar. Pro = colores, tamaño, posición, sombra, opacidad, mensaje inicial, redondeo/tamaño de botones. Elite = WhatsApp «con texto» y redondeo exacto, borde, peso, efecto hover.
- Aplicado en servidor: `validate_menu_design` + `private.design_obj_check/design_obj_rank` (migración `20261112_editor_wa_botones.sql`). Probado con rollback: Free bloqueado, Pro básico ok, Pro→Elite bloqueado, Elite ok, claves/valores inválidos rechazados.
- Probado en navegador de prueba: paneles por rango (0/1/2), mejora por plan, guardado de número, menú público con variables y FAB (sin cambios si no hay configuración).

## Fase 2 del editor (2026-11-13)
Nuevas herramientas: **Fondo**, **Texto por elemento**, **Elementos**, **Capas**. Todo vive en `config` (borrador/publicado) y el menú público solo lee lo PUBLICADO (`get_public_menu`).
| Función | Pro | Elite |
|---|---|---|
| Fondo con degradado (página y encabezado) | Lineal, 2 colores, ángulo | Radial y 3 colores |
| Estilo por texto (9 textos independientes) | Cursiva, MAYÚSCULAS, espaciado, alineación | Sombra y tipografía propias |
| Elementos (título, párrafo, cita, botón con enlace, separador, espacio) | Hasta 6 | Hasta 20 + tarjeta promo |
| Edición palabra por palabra (subtítulo, título del banner, elementos) | — | Color, negrita, cursiva y tamaño por palabra |
| Posición libre | — | Arrastrar en la vista previa o sliders (±40 % horizontal, ±80 px vertical respecto a su lugar) |
| Capas | Ver, reordenar secciones (Pro, ya existía), mover elementos entre secciones, ocultar, duplicar, eliminar | igual |
Servidor: `validate_menu_design` + `private.design_check/design_rank/design_runs_ok` (migración `20261113_editor_fase2.sql`, ya aplicada). Probado con rollback: Free bloqueado; Pro básico ok; Pro radial/sombra/promo/palabras bloqueados; URL `javascript:` e ids repetidos rechazados; Elite todo ok.
Probado en navegador de prueba (editor real + vista previa real): gating por rango, añadir elementos, degradados, estilo por texto, capas, edición palabra por palabra, arrastre real en la vista previa (Elite guarda; Pro muestra la tarjeta y revierte).
Decisión de diseño: «posición libre» es un desplazamiento relativo al lugar del elemento (en % del ancho y px), no coordenadas absolutas, para que el menú se vea igual en cualquier teléfono.

## Pendiente
- Pruebas con cuentas reales de los tres planes en navegador real; imágenes como elementos; edición palabra por palabra del anuncio y del pie.
