# Tipografías (56 + subida propia) y biblioteca de plantillas (48)

Orden de instalación:
1. En Supabase ejecuta, en este orden y mejor en una rama: `20261117_editor_canva.sql` (si aún no lo hiciste) y `20261118_tipografias.sql`.
2. Sube a GitHub: editor.html, menu.html, menu-design.js, kartta-templates.js (nuevo), vercel.json.

## Tipografías
- 56 tipografías de Google en 5 categorías (Sans, Serif, Display, Manuscritas, Monoespaciadas), con buscador, texto de prueba, 8 combinaciones recomendadas y combinaciones propias guardadas (en este navegador).
- Subida de fuentes propias (.ttf .otf .woff .woff2): máx. 1,5 MB y 5 por restaurante, planes Pro y Elite. Se valida la extensión, la firma del archivo y que el navegador pueda leerla. Se guardan en el bucket público `kartta-fonts` (carpeta = id del restaurante). Solo dueño/admin con Pro puede subir o borrar (RLS). El menú público las carga solas.
- El servidor valida: lista de fuentes, máx. 5 fuentes propias, rutas solo dentro de la carpeta del propio restaurante y plan. En Free el menú público ignora las fuentes propias y al volver a Pro se restauran.
- Al quitar una fuente del diseño NO se borra el archivo (el menú publicado podría seguir usándola hasta publicar).
- vercel.json: `font-src` ahora permite `https://*.supabase.co`.

## Plantillas
- 48 plantillas en 14 categorías, con filtro por categoría, plan (Gratis / Pro / Elite) y buscador. Vista previa antes de aplicar. Aplicar no toca productos, textos, redes ni opciones avanzadas.
- Gratis solo usan opciones que el plan Gratis ya permite; Elite usan degradados (el servidor lo valida).
- Las miniaturas se montan y desmontan al hacer scroll para no sobrecargar.
