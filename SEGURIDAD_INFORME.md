# Informe de seguridad KARTTA (rama security/hardening-v1)
Fecha: 2026-11-15. Producción https://kartta.food NO verificable desde las herramientas (acceso rechazado): todo lo de cabeceras/HTTPS/DNS es "solo código".

## Verificado en BD real (pruebas controladas, sin escritura persistente)
Aislamiento entre restaurantes OK; RPC admin y de aplicar pagos/credenciales no ejecutables por usuarios; pedidos exigen sesión QR y precios del servidor; webhook Wompi con checksum + re-consulta a la API + idempotencia; sin secretos en el repo.

## Hallazgos
| Riesgo | Hallazgo | Estado |
|---|---|---|
| Alto | Sin CSP; archivos internos (.md, .sql, código de Edge Functions) servidos públicamente | Corregido en rama (vercel.json, .vercelignore) — sin desplegar |
| Medio | Fidelización: pedido se asocia a la tarjeta de un teléfono existente sin verificar titularidad | Pendiente: requiere decisión (el usuario eliminó los códigos SMS/WhatsApp); propuesta: vincular solo con token de sesión de cliente |
| Medio | Límite de pedidos 30/min por restaurante permite DoS | Pendiente: límite por sesión QR/IP |
| Medio | kartta-mailer set_outreach/preview con token compartido KARTTA_INTERNAL_TOKEN; cron_token en texto plano en BD | Pendiente: tokens separados por función, rotación |
| Medio | admin-ai envía datos de dueños a Groq sin límite | Pendiente |
| Medio-bajo | analytics-collect confía en el primer x-forwarded-for; submit-menu-report acepta kartta.*.food | Pendiente |
| Bajo | SSRF ciego en kartta-outreach/leadgen; CORS * en admin-*; localhost en CORS de onesignal-push | Pendiente |
| Bajo | search_path mutable en 3 funciones | Migración preparada (no aplicada) |
| Config | Protección de contraseñas filtradas desactivada; sin MFA admin | Activar en panel de Supabase |
| Limpieza | Funciones/bucket sobrantes (mp-connect, IA antiguas, kartta-ai-images) | Pendiente, requiere autorización |

## Cambios en la rama
vercel.json (CSP con unsafe-inline porque hay scripts/handlers inline, frame-ancestors, HSTS 2 años sin preload, COOP, Permissions-Policy), .vercelignore.
Migración preparada: supabase/migrations_pendientes/20261115_hardening_search_path.sql.

## Aviso
Esto no es una certificación legal; Ley 1581 requiere revisión jurídica. Probar la CSP en un preview de Vercel antes de producción (pagos Wompi, login, OneSignal).
