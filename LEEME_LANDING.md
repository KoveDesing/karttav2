# KARTTA — Actualización del INDEX (motion + conversión)

Sube estos 3 archivos a la raíz del repo (reemplaza `index.html`):
- `index.html` (modificado; parte de tu `index (79).html`, con el script de subdominios incluido)
- `kartta-landing.css` (nuevo)
- `kartta-landing.js` (nuevo)

## Antes de publicar
1. **Duración de la prueba:** la página dice 7 días. Tu migración de pagos deja `billing_settings.trial_days` en **30** por defecto. Ponlo en 7 desde el panel (Finanzas → ajustes) o la web prometerá algo distinto a lo que recibe el cliente.
2. Para cambiar los días en toda la web: `TRIAL_DAYS` al inicio de `kartta-landing.js`.

## Cómo ajustar
- Qué animación usa cada sección: lista `MAP` en `kartta-landing.js`.
- Colores/curvas/distancias: variables al inicio de `kartta-landing.css`.
