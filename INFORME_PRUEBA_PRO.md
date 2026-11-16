# KARTTA — Prueba Pro, conservación del diseño y pantalla de recuperación

## Orden para desplegar
1. Ejecuta `20261116_prueba_pro_y_preservacion_diseno.sql` en Supabase (SQL Editor). Es idempotente. Haz primero copia de seguridad / pruébalo en una rama.
2. Sube `editor.html`, `dashboard.html` y `kartta-trial-end.js` a la raíz del repo.

## Error encontrado (causa raíz)
En la base de datos el plan `trial` tenía `limits.rank = 0` (igual que Free), aunque el panel lo trataba como Pro.
El editor y el trigger `validate_menu_design` leen el rank de `plans.limits`, así que durante los 7 días de prueba bloqueaban todo lo Pro.

## Qué se hizo
- **Prueba = Pro:** `plans['trial'].limits` ahora es exactamente el de KARTTA Pro (`kartta`). Editor, panel, trigger e IA usan la misma matriz.
- **Conservación:** columna `menu_designs.pro_backup` + trigger. Mientras la cuenta tiene rank >= 1 la copia refleja lo guardado; en Free no se sobrescribe ni se puede falsificar. No se borra ningún dato.
- **Al vencer:** el menú público muestra una representación gratuita (`private.design_free_view`: sin tipografías, anuncio, pie, orden, elementos, botones/WhatsApp Premium, degradados). La configuración original sigue en `config` / `pro_backup`.
- **Editor en Free con diseño Pro previo:** trabaja con la versión gratuita (ya no se bloquea al guardar) y el original queda en `pro_backup`.
- **Al volver a Pro:** el editor restaura automáticamente el diseño anterior (se puede deshacer con Ctrl+Z) y avisa.
- **Pantalla de recuperación** (`kartta-trial-end.js`, usada en el editor): mitad izquierda con mensaje, precio real leído de `plans`, botón "Volver a tener Pro" a `/checkout?plan=kartta&cycle=monthly`, aviso de que el diseño sigue guardado; mitad derecha con las funciones que sí usó (plantillas, tipografías, diseño avanzado, WhatsApp, herramientas) con candado; botón pequeño "Seguir con Free". Responsive. Aparece una vez por prueba (localStorage) y se reabre con el botón "Recuperar Pro" del editor o desde el aviso del panel.
- **WhatsApp:** el botón del menú público solo se muestra con rank >= 1; número y configuración quedan guardados.

## Pruebas ejecutadas (Postgres 16 local con el stub del repo)
- Prueba activa -> rank 1; guardar diseño Pro -> `pro_backup` creado; menú público con diseño completo y WhatsApp.
- Prueba vencida -> rank 0; menú público sin tipografía/anuncio/elementos y sin WhatsApp.
- Edición en Free -> `config` cambia, `pro_backup` intacto; intento de forjar `pro_backup` en Free -> ignorado.
- Recompra Pro -> rank 1; restauración devuelve tipografía y anuncio originales.
- Migración idempotente (se puede ejecutar dos veces).
- Pantalla de recuperación en escritorio y móvil; el editor carga sin errores de JavaScript.

## Pendiente / límites (sin inventar)
- NO probé contra tu Supabase real ni con una sesión real; `design_rank` en el stub es simplificado. Pruébalo primero en una rama.
- Expiración automática: ya existía (cron `billing` marca `expired`; además la vigencia se comprueba por fecha en cada consulta). No se cambió.
- Decisión de negocio a confirmar: el botón de WhatsApp del menú público ahora exige Pro (según tu documento). Restaurantes Free con el botón activo dejarán de mostrarlo hasta pagar.
- No implementado de tu documento (cada punto es un proyecto grande por sí mismo): rediseño del editor tipo Canva (mover/redimensionar/copiar/pegar/agrupar), simuladores iPhone/iPad/MacBook, 50+ tipografías y subida de fuentes, biblioteca ampliada de plantillas, guardado con versionado. El editor actual ya tiene deshacer/rehacer, capas y elementos.
