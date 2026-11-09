# KARTTA — Landing + Tracker + Pagos Wompi (entrega)

## 0. Por qué no veías nada
Tu `index.html` real **nunca fue reemplazado**: las versiones nuevas quedaron subidas como `index (80).html … index (84).html` y `landing (1).html` (nombres con "(n)" de las descargas). Vercel solo sirve `index.html`. Pasó igual con los archivos de pagos: `core (2).js`, `index (1).ts`… sueltos en la raíz y **sin carpetas**, así que ninguna función se podía desplegar. Además **faltaba por completo** la función `billing-checkout` (la que crea el cobro): sin ella el checkout nunca podía funcionar. Está reescrita en esta entrega.

**Regla**: sube estos archivos con EXACTAMENTE estos nombres y rutas (sin "(n)"). Lista de duplicados a borrar: `LIMPIEZA_REPO.txt`.

## 1. Archivos de esta entrega (raíz del repo, mismas rutas)
Modificados/nuevos: `index.html`, `kartta-landing.css`, `kartta-landing.js`, `kartta-tracker.js`, `kartta-plans.js`, `dashboard.html`, `checkout.html`, `checkout.js`,
`supabase/functions/{_shared,billing-checkout,wompi-webhook,billing-cron,admin-billing}/…`, `supabase/migrations/…`, `tests/…`.
Sin cambios (ya están en tu repo): `kartta-billing.js`, `checkout.css`, `vercel.json`, `supabase-init.js`.

## 2. Qué se hizo
- **Landing**: cinta roja, motion global, barra inferior animada, CTAs/promos, comparador de planes, tarjeta de descubrimiento y CTA final (versión más reciente, con la cinta crítica en CSS inline y sin cache viejo: `?v=20261109`).
- **Nombres**: Free · **KARTTA Pro** · **KARTTA Elite** en landing, planes, dashboard, correos y BD. IDs internos conservados: `kartta` = Pro, `pro` = Elite.
- **Precios** (servidor): Pro 43.900 /mes · 263.400 /año; Elite 84.900 /mes · 509.400 /año. La migración nueva los fija y reemplaza a las dos de `20261105_*` (obsoletas: no ejecutarlas).
- **Tracker** (`kartta-tracker.js`): sitio (`index.html`, `checkout.html`) y dashboard (`dashboard.html`: contexto del restaurante, sección vista y uso de IA/estadísticas/pedidos/QR…). Eventos de embudo: `signup_open/start/complete`, `login_view/success`, `plan_select`, `checkout_start`.
- **Pagos**: `billing-checkout` nueva (crear cobro con firma de integridad en servidor, verificar contra la API de Wompi, 401/403/404 según permisos, importe solo desde la BD); webhook, cron y panel admin colocados en su carpeta real.
- Corregido: botones de plan muertos tras cambiar Mensual/Anual; enlaces `#` del footer; botón de WhatsApp tapado en móvil; el modal "1 mes gratis" ahora dice 7 días.

## 3. SQL (en este orden, primero en Sandbox/proyecto de pruebas) — Supabase → SQL Editor
1. `supabase/migrations/20261106_kartta_payments.sql` (si ya la aplicaste antes, no la repitas: comprueba con `select to_regclass('public.payments'), to_regclass('public.billing_settings');`)
2. `supabase/migrations/20261108_recordatorios_manuales.sql`
3. `supabase/migrations/20261109_catalogo_planes_final.sql` (nombres, precios, pago anual habilitado, prueba de 7 días para nuevos registros)
Verifica: `select id,name,monthly_price_cop,annual_price_cop,is_purchasable,limits->>'rank' from plans where id in ('free','kartta','pro');`
⚠️ La prueba de 7 días solo se aplica si tu función `create_restaurant` no fija el fin de prueba por su cuenta. Haz un registro de prueba y mira `subscriptions.trial_end`; si sale a 30 días, hay que ajustar `create_restaurant` (no está en el repo).

## 4. Secrets (Supabase → Edge Functions → Secrets). Nunca en el repo ni en el navegador
`WOMPI_ENVIRONMENT=sandbox`, `WOMPI_PUBLIC_KEY=pub_test_…`, `WOMPI_PRIVATE_KEY=prv_test_…`, `WOMPI_EVENTS_SECRET=test_events_…`, `WOMPI_INTEGRITY_SECRET=test_integrity_…`, `APP_URL=https://kartta.food`, `CRON_SECRET=<aleatorio largo>`, `RESEND_API_KEY`, `BILLING_FROM_EMAIL` (sin Resend no se envía ningún correo; quedan en cola), y para el panel: `PANEL_SUPABASE_URL`, `PANEL_SUPABASE_KEY`, `PANEL_ORIGINS`.
Mezclar llaves de otro ambiente se rechaza (503).

## 5. Desplegar funciones
```
supabase functions deploy billing-checkout
supabase functions deploy wompi-webhook --no-verify-jwt
supabase functions deploy billing-cron   --no-verify-jwt
supabase functions deploy admin-billing  --no-verify-jwt
```
## 6. Wompi (comercio en Sandbox)
Desarrolladores → copia las 4 llaves de pruebas. **URL de eventos** (Sandbox): `https://<tu-proyecto>.supabase.co/functions/v1/wompi-webhook`. Los métodos (tarjetas, Nequi, PSE, Bancolombia, Daviplata…) los decide Wompi según tu comercio; no se fuerza ninguno.
## 7. Vercel
Solo publicar el repo (ya trae los rewrites `/checkout…`). No hay variables que poner en Vercel.
## 8. Cron diario
Programa una llamada a `…/functions/v1/billing-cron` con `Authorization: Bearer <CRON_SECRET>` (Supabase Cron o pg_cron + pg_net). Concilia pagos perdidos, vence suscripciones y envía avisos.

## 9. Pruebas
**Hechas aquí (locales, BD y Wompi SIMULADOS — no son pruebas reales):** `node --test tests/billing/checkout.unit.test.mjs` → 5/5: sin sesión 401, dueño ajeno/staff 403, precio solo del servidor, firma de integridad, no filtra secretos, importes oficiales (mensual/anual), ambientes mezclados y APP_URL insegura → 503, verificar (no activa por llegar a success, id ajeno 409, importe manipulado no activa, rechazado, idempotente, Wompi caído). Landing: navegador real (Chromium) sin errores, eventos del tracker generados.
**NO ejecutadas (no hay Postgres ni Wompi aquí):** `tests/billing/billing.test.mjs` (SQL real; necesita Postgres 16, `tests/sql/run.sh`), Sandbox real de Wompi, correos reales, dashboard con sesión real, el endpoint real `analytics-collect`.
**Checklist Sandbox (tú):** aprobado (tarjeta/Nequi de prueba de docs.wompi.co) · rechazado · PSE pendiente · cerrar el widget sin pagar · volver a /checkout sin pagar · webhook duplicado (reenviar desde Wompi) · Pro→Elite · Elite→Pro (debe bloquearse hasta fin de periodo) · anual · tras pagar, el dashboard muestra el plan y el panel admin el pago.

## 10. Pendiente / depende de Wompi
- Aprobación del comercio (desembolsos inactivos): hasta entonces solo Sandbox. Producción permanece bloqueada.
- **Renovación automática**: NO implementada (falta tokenización + consentimiento). Hoy: renovación manual con avisos (7/3/1 días) y cancelar/reanudar. No se simulan cobros.
- Endpoints de Wompi (sandbox/production, `widget.js`, búsqueda por referencia) vienen de documentación pública y deben comprobarse en tu primer pago Sandbox.
- Correos: requieren Resend configurado.
- Tracker: `editor('save')` aún no está enganchado al guardado del editor; añadir `KarttaTrack.editor('save')` donde se guarde. Menciona la analítica en tu política de privacidad (Ley 1581).

## 11. Pasar a producción (solo cuando Wompi apruebe y Sandbox esté en verde)
1. Cambiar los 4 secrets Wompi a `pub_prod_/prv_prod_/prod_events_/prod_integrity_` y `WOMPI_ENVIRONMENT=production` **a la vez**.
2. Registrar la URL de eventos en el ambiente de producción de Wompi.
3. Un pago real de monto mínimo propio; verificar activación y reembolso manual.
4. Revisa que `select count(*) from payments where environment='sandbox'` no se mezcle en ingresos (el panel ya los separa).
