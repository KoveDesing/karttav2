# KARTTA — Reporte de cambios (prompt maestro)

Qué se hizo en el código, qué NO, y qué pasos manuales faltan. Nada de esto está desplegado ni probado contra Supabase real todavía.

## Hecho en el repositorio (implementado, sin desplegar)
- **Fase 0**: inventario (ver ARQUITECTURA.md). Hallazgo: las funciones Edge no estaban en el repo; se añadió `supabase/functions/`.
- **Fase 2**: panel Dominio → editor `kartta.[ identificador ].food` (prefijo y sufijo fijos), validación en pantalla y en base de datos (formato, 3–30 caracteres, reservados, duplicados, máx. 3 cambios/día, solo owner/admin). Eliminado el formulario de dominios propios. `menu.html` redirige los enlaces viejos al identificador nuevo.
- **Fase 4**: 6 estilos, subida de referencia, indicaciones, cuota real "X de 5", bloqueo no-Pro con CTA, vista previa, Generar otra / Descargar / Usar en producto / Cancelar, confirmación antes de aplicar, imagen anterior conservada. Servidor: reserva atómica, fallos no consumen cupo, bucket privado, URL firmada de 10 min.
- **Fase 3 (parcial)**: botón de adjuntar foto en el chat, miniatura, quitar, validación tipo/tamaño, análisis con visión real (Gemini) y límite diario.
- **Fase 1 (parcial)**: se limpia el acento/tema guardado en el navegador al cerrar sesión y ya no se reutiliza el de otro usuario.
- **Fase 5/6/7 (parcial)**: botón "volver arriba", microestados de botones, estilos skeleton listos, `prefers-reduced-motion` (ya existía), texto de la landing actualizado a `.food`.

## NO hecho (pendiente real)
- Acciones del chat (cambiar precio, agotar, asociar imagen) y confirmaciones: requiere ver el código de `ai-assistant` desplegado.
- i18n ES/EN/DE, magnificación de barra, shared-element, blur de cifras, error boundaries, auditoría RLS completa (necesita acceso a Supabase).
- Miniaturas de ejemplo reales de los 6 estilos: faltan imágenes reales; no se usaron ejemplos falsos.
- Máscara/composición para conservar logos y textos del producto.
- La landing (`index.html`) muestra cifras de ejemplo en la maqueta del panel ($1.284.000): revisar que estén claramente marcadas como ejemplo.

## ⚠️ Decisión que necesito de ti: el formato `kartta.IDENTIFICADOR.food`
`IDENTIFICADOR.food` es un dominio completo (laesquina.food) que habría que comprar por cada restaurante: un comodín DNS no lo resuelve. Para que el subdominio funcione de verdad lo normal sería `identificador.kartta.food` (un solo dominio tuyo, con comodín `*.kartta.food` en Vercel). Hoy el enlace que funciona es `/m/<identificador>`; el panel lo muestra como "Enlace activo".

## Pasos manuales
1. Supabase → SQL Editor: ejecutar `supabase/migrations/20261024_subdominio_e_imagenes_ia.sql`.
2. Secretos en Supabase (Edge Functions → Secrets): `OPENAI_API_KEY`, `GEMINI_API_KEY` (nunca en el repo).
3. Desplegar las 3 funciones de `supabase/functions/` (en cada una, activar "Verify JWT").
4. Confirmar en OpenAI que el proyecto tiene acceso al modelo `gpt-image-1` y facturación.
5. Confirmar que existe un plan `pro` activo en `subscriptions` y su precio en la tabla `plans`.
6. Probar: Pro genera; no-Pro bloqueado; 6.ª imagen del día bloqueada; dos usuarios comparten cupo; aplicar a producto y ver el menú público.

## Rollback
Los cambios del frontend se revierten volviendo al commit anterior. La migración solo añade tablas/funciones; no modifica ni borra datos existentes.
