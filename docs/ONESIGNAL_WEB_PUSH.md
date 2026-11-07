# KARTTA — OneSignal Web Push

## Arquitectura

- El SDK web v16 se carga únicamente en \`dashboard.html\` y se configura para el origen canónico \`https://kartta.food\`.
- Supabase Auth es la fuente de identidad. El SDK recibe el UUID real mediante \`OneSignal.login(user.id)\` y ejecuta \`OneSignal.logout()\` al cerrar sesión. \`kartta-onesignal-identity.mjs\` serializa cambios de cuenta y también limpia identidades persistidas tras una recarga.
- OneSignal administra las suscripciones push de cada navegador/dispositivo. Al iniciar sesión con el mismo UUID desde otro dispositivo, OneSignal asocia esa suscripción al mismo usuario.
- \`OneSignalSDKWorker.js\` se sirve desde la raíz del dominio. La tarjeta de activación se muestra dentro de Inicio y su opción “Ahora no” se recuerda durante siete días. No había un Service Worker previo en el repositorio al momento de la auditoría.
- La cola \`onesignal_push_notifications\` es independiente de \`billing_notifications\`; no cambia la cola ni los procesos existentes de facturación.
- Los recordatorios se calculan por suscripción y por ciclo, usando la fecha local de \`America/Bogota\`. Se encolan a 3 y 2 días de la fecha de vencimiento.
- Los avisos se envían al \`owner_id\` de la suscripción mediante \`include_aliases.external_id\`. El frontend nunca puede elegir el destinatario de un envío de prueba.

## Configuración de OneSignal Dashboard

En OneSignal → Settings → Push & In-App → Web:

1. Habilitar Web Push.
2. Configurar el Site URL con el origen canónico exacto: \`https://kartta.food\`.
3. Configurar el nombre del sitio como \`KARTTA\`.
4. Configurar el icono predeterminado con \`https://kartta.food/favicon.png\`.
5. Mantener el Service Worker en la raíz con el nombre \`OneSignalSDKWorker.js\` (configuración predeterminada).
6. No configurar prompts automáticos: KARTTA solicita permiso únicamente cuando el usuario pulsa “Activar notificaciones”.

**Importante:** Web Push está limitado por el mismo origen. No se debe usar esta misma app de OneSignal desde \`www.kartta.food\`, previews \`*.vercel.app\` ni subdominios de restaurantes a menos que se unifique el origen o se cree otra app de OneSignal. El panel debe operar en \`https://kartta.food\`.

En iPhone/iPad, Web Push requiere iOS/iPadOS 16.4 o posterior y que el usuario añada el sitio a la pantalla de inicio. El manifiesto se enlaza desde el dashboard.

## Secretos

La Edge Function lee únicamente desde Supabase Edge Function Secrets:

- \`ONESIGNAL_APP_ID\`
- \`ONESIGNAL_REST_API_KEY\`

La REST API Key no está en el repositorio ni se expone al navegador. El App ID es público y también aparece en el inicializador del SDK web.

La migración crea un token interno aleatorio directamente en Supabase Vault para autenticar la invocación programada. El token no se devuelve ni se escribe en GitHub. También guarda en Vault la URL del proyecto y la publishable key pública necesaria para invocar la Edge Function desde \`pg_net\`.

## Cron

La migración habilita \`pg_cron\` y \`pg_net\` y registra el job \`kartta-onesignal-renewal-reminders\` cada hora entre las 08:00 y las 17:00 de \`America/Bogota\` (13:00–22:00 UTC). La fecha local se comprueba en cada ejecución y la clave única evita duplicar eventos; las ejecuciones adicionales permiten drenar lotes y reintentar fallos. El endpoint \`onesignal-push\` usa \`verify_jwt = false\` porque el job se autentica con el token interno de Vault; las acciones manuales, en cambio, validan el JWT real de Supabase Auth con \`auth.getUser()\`.

## Estados y reintentos

\`onesignal_push_notifications.status\` admite \`pending\`, \`processing\`, \`sent\`, \`failed\`, \`cancelled\` y \`skipped\`.

- El \`dedupe_key\` único evita duplicados por suscripción, tipo de recordatorio y ciclo.
- \`FOR UPDATE SKIP LOCKED\` impide que dos ejecuciones reclamen el mismo evento.
- Los errores se pueden reintentar tras 30 minutos, hasta cinco intentos.
- La comprobación se ejecuta cada hora entre las 08:00 y las 17:00 de Bogotá; solo crea eventos cuando faltan exactamente 3 o 2 días.
- Una suscripción renovada, expirada o con un ciclo cambiado cancela los eventos anteriores.
- Una renovación con pago \`PENDING\` no genera recordatorios.
- Un usuario sin dispositivos suscritos queda como \`skipped\`, no como \`sent\`.
- Solo se marca \`sent\` cuando OneSignal devuelve un ID de mensaje.

## Pruebas

Ejecutar localmente:

\`\`\`bash
node --test onesignal-push.test.mjs
\`\`\`

La prueba manual del dashboard queda registrada en \`onesignal_push_test_limits\` y tiene un límite de una prueba cada dos minutos por usuario. Envía una notificación exclusivamente al UUID autenticado que pulsa “Enviar prueba”. No acepta \`user_id\` desde el navegador y requiere que ese usuario tenga un restaurante con rol \`owner\` o \`admin\`.

## Despliegue controlado

1. Revisar el branch \`feat/onesignal-web-push\`.
2. Desplegar la Edge Function \`onesignal-push\` con \`verify_jwt = false\`.
3. Aplicar \`20261106_onesignal_web_push.sql\` después de desplegar la Edge Function, porque la migración registra el Cron que la invoca.
4. Verificar que el job aparezca en \`cron.job\` y que el Service Worker responda como JavaScript en \`https://kartta.food/OneSignalSDKWorker.js\`.
5. Fusionar el branch a \`main\` cuando se autorice el despliegue del frontend a producción.

No se deben enviar pruebas a segmentos, listas globales ni usuarios ajenos. La prueba manual está restringida al usuario autenticado.
