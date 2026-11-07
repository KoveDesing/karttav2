export const APP_ID = '2211f00d-3641-4a1d-8105-e5d4fbc181b';
export const DASHBOARD_BILLING_URL = 'https://www.kartta.food/dashboard.html#facturacion';
export const KARTTA_ICON_URL = 'https://www.kartta.food/favicon.png';

const REMINDER_COPY = {
  renewal_3d: {
    title: '¡Hey! KARTTA te está esperando 👋',
    body: (name) => 'Tu suscripción de ' + name + ' está por terminar. Sigue disfrutando de todas las herramientas de KARTTA para tu restaurante. ¡Renueva antes de que termine!',
  },
  trial_ending_3d: {
    title: '¡Hey! KARTTA te está esperando 👋',
    body: (name) => 'Tu periodo de prueba de ' + name + ' está por terminar. Elige o renueva tu plan para seguir disfrutando de todas las herramientas de KARTTA.',
  },
  renewal_2d: {
    title: '¡Un recordatorio de KARTTA! ❤️',
    body: (name) => '¡La suscripción de ' + name + ' está cerca de finalizar! Renueva tu plan y sigue gestionando tu restaurante con KARTTA.',
  },
  trial_ending_2d: {
    title: '¡Un recordatorio de KARTTA! ❤️',
    body: (name) => '¡Tu periodo de prueba de ' + name + ' está cerca de finalizar! Elige tu plan para seguir gestionando tu restaurante con KARTTA.',
  },
  manual_test: {
    title: '¡KARTTA está conectado! 🔔',
    body: (name) => 'Esta es una notificación de prueba para ' + name + '. Tu dispositivo está vinculado correctamente a tu cuenta.',
  },
};

export function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function bogotaDaysRemaining(nowValue, expiryValue) {
  const partsFor = (value) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(value));
    const get = (type) => Number(parts.find((part) => part.type === type)?.value);
    return Date.UTC(get('year'), get('month') - 1, get('day'));
  };
  const nowDate = partsFor(nowValue);
  const expiryDate = partsFor(expiryValue);
  if (!Number.isFinite(nowDate) || !Number.isFinite(expiryDate)) throw new Error('invalid_expiry_date');
  return Math.round((expiryDate - nowDate) / 86400000);
}

export function reminderTypeForSubscription({ status, planId, daysRemaining }) {
  if (![2, 3].includes(daysRemaining)) return null;
  if (status === 'trialing') return daysRemaining === 3 ? 'trial_ending_3d' : 'trial_ending_2d';
  if (status === 'active' && !['free', 'trial'].includes(planId)) return daysRemaining === 3 ? 'renewal_3d' : 'renewal_2d';
  return null;
}

export function isReminderEligible({ status, planId, hasPendingPayment = false, isSuspended = false }) {
  if (hasPendingPayment || isSuspended) return false;
  return status === 'trialing' || (status === 'active' && !['free', 'trial'].includes(planId));
}

export function buildReminderDedupeKey(subscriptionId, notificationType, cycleEnd) {
  if (!isUuid(subscriptionId) || !REMINDER_COPY[notificationType]) throw new Error('invalid_dedupe_identity');
  const cycle = new Date(cycleEnd);
  if (!Number.isFinite(cycle.getTime())) throw new Error('invalid_expiry_date');
  return 'onesignal:' + subscriptionId + ':' + notificationType + ':' + cycle.toISOString().replace(/[-:.TZ]/g, '');
}

export function buildNotificationCopy(type, restaurantName) {
  const copy = REMINDER_COPY[type];
  if (!copy) throw new Error('unsupported_notification_type');
  const name = String(restaurantName || 'tu restaurante').trim().slice(0, 120) || 'tu restaurante';
  return { title: copy.title, body: copy.body(name) };
}

export function buildOneSignalPayload({ appId = APP_ID, userId, restaurantId, subscriptionId = null, notificationType, restaurantName, eventId = null, cycleEnd = null }) {
  if (!isUuid(userId) || !isUuid(restaurantId) || (subscriptionId !== null && !isUuid(subscriptionId))) {
    throw new Error('invalid_notification_identity');
  }
  const copy = buildNotificationCopy(notificationType, restaurantName);
  return {
    app_id: appId,
    target_channel: 'push',
    include_aliases: { external_id: [userId] },
    headings: { es: copy.title },
    contents: { es: copy.body },
    url: DASHBOARD_BILLING_URL,
    large_icon: KARTTA_ICON_URL,
    chrome_web_image: KARTTA_ICON_URL,
    data: {
      source: 'kartta',
      notification_type: notificationType,
      user_id: userId,
      restaurant_id: restaurantId,
      subscription_id: subscriptionId,
      cycle_end: cycleEnd,
      event_id: eventId,
      destination: DASHBOARD_BILLING_URL,
    },
  };
}

export function classifyOneSignalResponse(httpStatus, responseBody) {
  if (httpStatus < 200 || httpStatus >= 300) {
    return { status: 'failed', providerId: null, error: 'onesignal_http_' + httpStatus };
  }
  const providerId = responseBody && typeof responseBody.id === 'string' && responseBody.id ? responseBody.id : null;
  if (!providerId) {
    return { status: 'skipped', providerId: null, error: 'no_subscribed_devices_for_user' };
  }
  return { status: 'sent', providerId, error: null };
}
