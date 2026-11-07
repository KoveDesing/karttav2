# KARTTA Payments — suscripciones con Wompi Colombia

Estado: **código completo y probado con Wompi simulado. NO probado contra el Sandbox real de Wompi ni aplicado a una base real.**

## 1. Qué hay
| Pieza | Archivo |
|---|---|
| Migración (tablas, RLS, RPC) | `20261106_kartta_payments.sql` |
| Crear pago + verificar | `supabase/functions/billing-checkout` |
| Webhook Wompi (firma, idempotencia) | `supabase/functions/wompi-webhook` |
| Mantenimiento diario + correos | `supabase/functions/billing-cron` |
| Puente del panel privado | `supabase/functions/admin-billing` |
| Utilidades compartidas | `supabase/functions/_shared/` |
| Checkout nativo | `checkout.html`, `checkout.js`, `checkout.css` (rutas `/checkout`, `/checkout/processing/:ref`, `/checkout/{success,pending,failed}/:ref`) |
| Vista "Facturación" del dashboard | `kartta-billing.js` + `dashboard.html` |
| Finanzas del panel admin (repo del panel) | `billing.js`, `app.js`, `config.js`, `styles.css` |
| Pruebas | `tests/sql`, `tests/billing` |

## 2. Reglas de seguridad implementadas
- El importe, la moneda y la referencia los fija el **servidor**; el navegador solo envía plan y modalidad.
- La firma de integridad de Wompi se calcula en el servidor.
- Un plan se activa **solo** en `billing_apply_transaction` (RPC solo-servidor), tras consultar la transacción a la API de Wompi y validar monto, moneda y referencia. El cuerpo del webhook no se toma como verdad.
- Webhook: firma SHA256 con `WOMPI_EVENTS_SECRET`, comparación en tiempo constante, idempotente, eventos inválidos registrados.
- Sandbox y producción separados por `payments.environment`; las llaves de un ambiente se rechazan en el otro.
- No se almacenan datos de tarjeta. RLS: el cliente solo lee lo suyo; las escrituras sensibles son RPC.

## 3. Despliegue (en este orden)
1. **Supabase (proyecto web)** → SQL Editor: ejecutar `20261106_kartta_payments.sql` (primero en un proyecto de pruebas).
2. **Secrets** (Edge Functions → Secrets): ver `env.example`. Empezar con `WOMPI_ENVIRONMENT=sandbox` y llaves de prueba.
3. **Desplegar funciones:**
   ```
   supabase functions deploy billing-checkout
   supabase functions deploy wompi-webhook --no-verify-jwt
   supabase functions deploy billing-cron   --no-verify-jwt
   supabase functions deploy admin-billing  --no-verify-jwt
   ```
4. **Wompi** (comercio, ambiente Sandbox): *Desarrolladores → Programadores*: copiar llave pública, privada, secreto de eventos y de integridad. En *URL de eventos* poner `https://<proyecto>.supabase.co/functions/v1/wompi-webhook`.
5. **Hosting (Vercel):** publicar este repo (ya incluye los rewrites de `/checkout`). Definir `APP_URL` con tu dominio.
6. **Cron:** programar una llamada diaria (pg_cron + pg_net o Supabase Cron) a `billing-cron` con `Authorization: Bearer <CRON_SECRET>`.
7. **Panel privado:** publicar el repo del panel con `config.js` apuntando a `admin-billing`; definir `PANEL_*` en los secrets.
8. **Pago anual:** ejecutar `20261107_activar_pago_anual.sql` (después de la migración principal). Fija 263.400 COP (Standard) y 509.400 COP (Pro) —los importes que ya publica la landing: 12 mensualidades con 50 % de descuento— y habilita el cobro anual. Si cambias el precio, cámbialo allí y en `kartta-plans.js`.

## 4. Pasar a producción
1. Pruebas de Sandbox completas (sección 6) en verde.
2. Cambiar los 4 secretos Wompi a `prod_*`/`pub_prod_*` y `WOMPI_ENVIRONMENT=production` (todos a la vez).
3. Registrar la URL de eventos en el ambiente de producción de Wompi.
4. Un pago real de monto mínimo propio, verificar activación y reembolso manual.

## 5. Depende de Wompi / pendiente
- **Dispersión (payouts):** pendiente de aprobación de Wompi. Wompi no expone comisiones ni liquidaciones por API: en el panel se **registran manualmente** (ingresos ≠ comisiones ≠ pagos recibidos).
- **Renovación automática (tokenización):** NO implementada. El esquema está listo, pero falta el flujo de tokenización, consentimiento y pruebas en Sandbox. Hoy la renovación es manual con aviso previo.
- Endpoints/URLs de Wompi tomados de documentación pública y no verificados en vivo: `https://sandbox.wompi.co/v1`, `https://production.wompi.co/v1`, `widget.js`, y la búsqueda de transacciones por referencia (`/transactions?reference=`). Verificar en Sandbox.
- Proveedor de correo: sin `RESEND_API_KEY` no se envía nada; los avisos quedan en cola.

## 6. Pruebas
Ejecutadas (locales, Postgres 16 con stub de Supabase y Wompi simulado):
- `tests/sql/run.sh` y `tests/sql/30_concurrency.sh`: RLS, RPC, idempotencia y concurrencia.
- `node --test tests/billing/billing.test.mjs`: 12/12 (checkout, webhook, verificación, montos alterados, referencias ajenas, ambientes mezclados).
- Checkout en navegador (Chromium + mocks): elegir plan → datos → widget → confirmación → pantalla de éxito.

**No ejecutadas:** Sandbox real de Wompi, aplicación de la migración en tu Supabase, envío real de correos, panel contra datos reales, dashboard completo con sesión real.

Checklist de Sandbox para ti: pago aprobado, rechazado, pendiente (PSE), webhook duplicado, webhook con firma inválida, pago con monto alterado, cierre del widget sin pagar, cancelar/reanudar renovación, vencimiento (cron), cambio Standard→Pro y bloqueo Pro→Standard.

## 7. Supuestos a verificar en tu entorno
- Esquema real de `payments` y `subscriptions` (se asumió; la migración usa `add column if not exists`).
- Columna de `panel_bridge_admins` y columnas de pagos que devuelve `admin-api` del panel.
- Que `create_restaurant` asigne la prueba gratuita (y su duración); el plan de prueba hoy tiene rank 0, igual que Free.
- Cambio de plan: no se acredita prorrata.

## 8. Panel: recordatorios manuales (Finanzas → Clientes → ficha del cliente)
- **Recordar por WhatsApp:** abre WhatsApp con el mensaje ya redactado según el estado (fin de prueba, renovación próxima, plan vencido) y el enlace a `/checkout`. Usa el teléfono del dueño (`restaurant_private.contact_phone`) o, si falta, el WhatsApp del menú. Funciona hoy, sin proveedor de correo.
- **Enviar por correo:** encola el aviso (`admin_billing_send_reminder`), con límite de 1 cada 10 minutos por cliente y auditoría con tu correo. Solo sale cuando `billing-cron` y `RESEND_API_KEY` estén configurados; mientras tanto queda "pending" en «Avisos».
- Despliegue: `20261108_recordatorios_manuales.sql`, función `admin-billing` (verify_jwt desactivado; valida la sesión del panel y el correo en `panel_bridge_admins`) y secrets `PANEL_SUPABASE_URL`, `PANEL_SUPABASE_KEY`, `PANEL_ORIGINS`.
