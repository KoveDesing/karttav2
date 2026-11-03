# Despliegue — QR de mesa, identidad OTP, fidelización y KARTTA AI flotante

Orden recomendado (no saltes pasos; el frontend nuevo necesita la migración aplicada):

1. **Rama de Supabase / copia de seguridad.** Aplica `20261102_qr_identidad_fidelizacion.sql` (idempotente). Se probó en una transacción revertida contra el esquema real.
2. **Imprime los QR nuevos.** Cada mesa ya tiene `qr_token`. En Dashboard → Mesas descarga el QR de cada mesa (apunta a `/q/<token>`). Los QR antiguos (`?mesa=`) dejan de permitir pedidos.
3. **Edge Function `customer-otp`** (`supabase/functions/customer-otp/index.ts` + `core.js`), `verify_jwt = true`. Secretos:
   `OTP_PEPPER` (≥32 caracteres aleatorios), `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
   SMS: `TWILIO_SMS_FROM` (o `TWILIO_MESSAGING_SERVICE_SID`),
   WhatsApp: `TWILIO_WHATSAPP_FROM` y `TWILIO_WA_CONTENT_SID` (plantilla de autenticación aprobada por Meta con `{{1}}` = código).
   Sin estos secretos la función responde `otp_not_configured` y el cliente puede pedir sin tarjeta.
4. **Edge Function `ai-assistant`:** vuelve a desplegar `index.ts` y `core.js` (añaden el campo opcional `section`).
5. **Sube a GitHub/Vercel** los archivos de este zip (conservando rutas). `vercel.json` añade la ruta `/q/:token`.
6. Revisa que `privacidad.html` describa el uso del teléfono (el diálogo enlaza a esa página).

## Comportamiento que cambia
- El enlace general del menú es solo de consulta: el botón de pedir queda desactivado sin sesión de mesa (restaurantes sin mesas configuradas no podrán recibir pedidos hasta crear sus mesas).
- `place_order`, `loyalty_join`, `get_loyalty_card`, `loyalty_request_redemption` y `loyalty_play_spin` ya no son invocables por `anon`/`authenticated`.
- Puntos solo para pedidos con cliente verificado. "Exigir teléfono verificado" (Programa de puntos) es opcional y por defecto desactivado.

## Pruebas manuales recomendadas tras desplegar
Escanear QR → pedir → marcar pagado → ver puntos; QR de mesa desactivada; QR regenerado; sesión de mesa vencida (6 h); OTP correcto/incorrecto/reenvío; marcar y desmarcar pago; canje con límite; borrar mis datos; KARTTA AI en cada sección (móvil y escritorio).
