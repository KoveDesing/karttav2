# Actualización 14-nov-2026 (prevalece sobre ARQUITECTURA / ESTADO / CAMBIOS_FASES / KARTTA_PROJECT_CONTEXT)
- **Eliminado:** generación de imágenes con IA (dashboard, `kartta-image-ai.js`, funciones `generate-product-image` y `apply-generated-product-image`, bucket `kartta-ai-images`, tabla `image_generations`). `OPENAI_API_KEY` ya no se usa.
- **Pagos de pedidos:** cada restaurante conecta SU cuenta Wompi en Dashboard → Pagos (claves en Supabase Vault). Funciones: `wompi-connect`, `order-checkout`, `wompi-order-webhook?rid=<restaurante>`. Tablas `order_payments`, `order_payment_events`.
- **Suscripciones KARTTA:** `billing-checkout` + `wompi-webhook` (cuenta Wompi de KARTTA, secretos `WOMPI_*`).
- **Planes (ids internos):** free · kartta = "KARTTA Pro" ($43.900) · pro = "KARTTA Elite" ($84.900) · trial · custom. Límites en `plans.limits`.
- **Diálogos:** `kartta-dialogs.js` (KDialog) reemplaza alert/confirm/prompt; `kartta-checks.css` estiliza casillas.
- `landing.html` es una copia antigua: redirige a `/`. Los archivos con sufijo "(1)", "(2)"… son duplicados (ver `limpiar_duplicados.sh`).
