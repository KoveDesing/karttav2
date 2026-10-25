# KARTTA — Reporte de cambios (prompt maestro)

Qué se hizo en el código, qué NO, y qué pasos manuales faltan. Nada de esto está desplegado ni probado contra Supabase real todavía.

## Hecho en el repositorio (implementado, sin desplegar)
- **Fase 0**: inventario (ver ARQUITECTURA.md). Hallazgo: las funciones Edge no estaban en el repo; se añadió `supabase/functions/`.
- **Fase 2**: panel Dominio → editor `kartta.[ identificador ].food` (prefijo y sufijo fijos), validación en pantalla y en base de datos (formato, 3–30 caracteres, reservados, duplicados, máx. 3 cambios/día, solo owner/admin). Eliminado el formulario de dominios propios. `menu.html` redirige los enlaces viejos al identificador nuevo.
- **Fase 4**: 6 estilos, subida de referencia, indicaciones, cuota real "X de 5", bloqueo no-Pro con CTA, vista previa, Generar otra / Descargar / Usar en producto / Cancelar, confirmación antes de aplicar, imagen anterior conservada. Servidor: reserva atómica, fallos no consumen cupo, bucket privado, URL firmada de 10 min.
- **Fase 3 (parcial)**: botón de adjuntar foto en el chat, miniatura, quitar, validación tipo/tamaño, análisis con visión real (Gemini) y límite diario.
- **Fase 1 (parcial)**: se limpia el acento/tema guardado en el navegador al cerrar sesión y ya no se reutiliza el de otro usuario.
- **Fase 5/6/7 (parcial)**: botón "volver arriba", microestados de botones, estilos skeleton listos, `prefers-reduced-motion` (ya existía), texto de la landing actualizado a `.food`.

## Landing (index.html)
- Reemplazado por tu versión nueva (modo oscuro en «Cómo funciona», favicons, ejemplo `kartta.mirestaurante.food`). Se verificó que todos los archivos que referencia existen en el repo.
- Ajustes: las cifras de la maqueta del panel ahora dicen «ejemplo»; la respuesta sobre la IA ya no promete editar el menú por chat (hoy responde y analiza fotos).
- Precios: solo `pro = 84.900` está en la tabla `plans`; KARTTA y Personalizado quedan sin precio hasta que decidas (ver DECISIONES_PENDIENTES.md).

## NO hecho (pendiente real)
- Acciones del chat (cambiar precio, agotar, asociar imagen) y confirmaciones: requiere ver el código de `ai-assistant` desplegado.
- i18n ES/EN/DE, magnificación de barra, shared-element, blur de cifras, error boundaries, auditoría RLS completa (necesita acceso a Supabase).
- Miniaturas de ejemplo reales de los 6 estilos: faltan imágenes reales; no se usaron ejemplos falsos.
- Máscara/composición para conservar logos y textos del producto.
- La landing (`index.html`) muestra cifras de ejemplo en la maqueta del panel ($1.284.000): revisar que estén claramente marcadas como ejemplo.

## ⚠️ Decisión que necesito de ti: el formato `kartta.IDENTIFICADOR.food`
`IDENTIFICADOR.food` es un dominio completo (laesquina.food) que habría que comprar por cada restaurante: un comodín DNS no lo resuelve. Para que el subdominio funcione de verdad lo normal sería `identificador.kartta.food` (un solo dominio tuyo, con comodín `*.kartta.food` en Vercel). Hoy el enlace que funciona es `/m/<identificador>`; el panel lo muestra como "Enlace activo".

## Ya aplicado en Supabase (proyecto Kartta)
- Migración `subdominio_oficial_y_cuota_imagenes_pro`: tablas/funciones de identificador, `image_quota`, y regla final de imágenes (solo Pro, 5/día, solo owner/admin). Probada con transacciones revertidas: plan de prueba bloqueado, Pro permite 5, el 6.º se bloquea, un fallo libera cupo, un usuario ajeno recibe `forbidden`.
- Precio del plan Pro en la tabla `plans`: 84.900 COP.
- Función `ai-assistant-vision` desplegada (Groq con visión, usa el `GROQ_API_KEY` que ya tienes).
- NO se tocaron `generate-product-image` ni `apply-generated-product-image`: ya estaban desplegadas y bien hechas; el panel ahora usa su contrato real.

## Pasos manuales que quedan
1. Subir este repo a GitHub/Vercel (el panel nuevo aún no está publicado).
2. Confirmar que el secreto `OPENAI_API_KEY` existe y que el modelo usado en `generate-product-image` (`gpt-image-2.5-sunburst`) está disponible en tu cuenta de OpenAI.
3. Confirmar que el modelo de visión de Groq (`meta-llama/llama-4-scout-17b-16e-instruct`, cambiable con el secreto `GROQ_VISION_MODEL`) sigue vigente.
4. Supabase → Authentication → activar «Leaked password protection» (aviso del asesor de seguridad).
5. Prueba real: poner un restaurante en plan Pro y generar una imagen; ver que el 6.º intento del día se bloquea.

## Rollback
Los cambios del frontend se revierten volviendo al commit anterior. La migración solo añade tablas/funciones; no modifica ni borra datos existentes.

## Editor visual (nuevo)
- `editor.html`: panel de opciones + vista previa real (iframe del propio `menu.html`), plantillas, colores con avisos de contraste, encabezado, categorías, productos, tipografía y secciones (plan Personalizado), deshacer/rehacer (Ctrl+Z / Ctrl+Shift+Z), autoguardado de borrador, Publicar y Descartar cambios, pantalla móvil/tablet/PC, clic en el menú para editar esa parte.
- `menu-design.js`: modelo de diseño único y sanitizado (compartido por editor y menú público).
- `menu.html` ahora obedece el diseño completo (antes ignoraba estilo de tarjetas, botón y tamaño aunque la vista previa los mostraba).
- Validación en servidor: trigger `validate_menu_design`.
- El editor antiguo del panel quedó retirado (se pisaba con el nuevo); el panel enlaza a `editor.html`.
- No incluido todavía: arrastrar elementos libremente por un lienzo (el menú sigue una estructura fija por secciones, por diseño: garantiza que funcione en todos los celulares), subir banner/logo desde el editor, historial de versiones publicadas, programar publicación.

## Editor visual v2 — estilo Canva (más fácil)
- Barra lateral de iconos: **Diseño · Colores · Texto · Imágenes · Productos · Secciones**. Cada una abre su panel; en celular la barra va abajo y el panel sube como hoja.
- Opciones **visuales** (tarjetas con dibujo) en vez de listas técnicas; plantillas con muestra de colores; 12 colores rápidos y 8 paletas completas.
- **Imágenes:** sube/cambia/quita el logo y el banner desde el editor (misma carpeta de Storage y compresión que el panel).
- **Productos:** lista tus productos reales; si no hay, invita a agregarlos; «＋ Agregar productos» guarda el diseño y te lleva al panel de productos; al volver al editor se actualizan solos.
- **Vista del cliente:** casilla que oculta los recuadros azules para ver el menú exactamente igual que el público (es el mismo `menu.html`, no una copia).
- Clic en el menú abre la herramienta correspondiente.
