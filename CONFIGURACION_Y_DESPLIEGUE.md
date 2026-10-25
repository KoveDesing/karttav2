# CONFIGURACIÓN Y DESPLIEGUE (sin secretos)

## Estado del despliegue
- Base de datos (Supabase `ifbvdjvukygvvgiyzgav`): migraciones `subdominio_oficial_y_cuota_imagenes_pro` y `endurecimiento_pagos_pedidos_eventos` **aplicadas**.
- Edge Functions desplegadas: `ai-assistant` (v16), `generate-product-image` (v2), `apply-generated-product-image` (v1), `ai-assistant-vision` (v1, nueva), `submit-menu-report`, `admin-api`, `admin-ai`.
- **Frontend: NO desplegado.** Hasta subir el zip a GitHub/Vercel, el sitio público sigue con la versión anterior (sin el editor de identificador, sin el panel de imágenes IA nuevo).

## Pasos
1. Descomprime el zip y sube el contenido al repositorio conectado a Vercel (rama de producción). Vercel despliega solo (sitio estático, sin build).
2. Supabase → Edge Functions → Secrets: verifica que existan `OPENAI_API_KEY` y `GROQ_API_KEY` (solo comprueba que estén; no pegues valores en chats).
3. Supabase → Authentication → activar *Leaked password protection*.
4. Prueba: plan Pro de un restaurante de prueba → generar imagen → aplicar a producto → abrir `/m/<slug>`.

## Servicios externos
| Servicio | Lo usa | Variable | Dónde | Si falta |
|---|---|---|---|---|
| OpenAI Images | generate-product-image | OPENAI_API_KEY | Supabase Secrets | responde 503 `openai_not_configured` |
| Groq (texto) | ai-assistant, admin-ai | GROQ_API_KEY | Supabase Secrets | 503 `ai_not_configured` |
| Groq (visión) | ai-assistant-vision | GROQ_API_KEY, GROQ_VISION_MODEL (opcional) | Supabase Secrets | 503 / error de proveedor |
| Pagos | — | — | — | no implementado |
| Correo/marketing | — | — | — | no implementado |

Comandos: no hay `npm`/build. Validación local: `node --check` sobre los scripts y pruebas SQL de PRUEBAS_Y_RESULTADOS.md.
Rollback: volver al commit anterior en Git. Las migraciones son aditivas; para revertir privilegios: `grant ... on public.payment_events to ...` (no recomendado).
