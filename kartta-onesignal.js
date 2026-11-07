import { sb } from './supabase-init.js';
import { createOneSignalIdentitySynchronizer } from './kartta-onesignal-identity.mjs';

const APP_ID = '2211f00d-3641-4a1d-8105-e5d04fbc181b';
const DISMISS_KEY = 'kartta_push_dismissed_until';
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

// OneSignal Web Push está configurado para el origen canónico indicado por KARTTA.
// No inicializar en previews de Vercel ni en subdominios de restaurantes: Web Push es same-origin.
if (location.hostname.toLowerCase() !== 'www.kartta.food') {
  // El panel sigue funcionando normalmente; solo se omite OneSignal fuera del origen oficial.
} else {

let oneSignal = null;
let sdkReadyResolve;
let sdkReadyReject;
let sdkReady = new Promise((resolve, reject) => { sdkReadyResolve = resolve; sdkReadyReject = reject; });
let card = null;
let initError = null;

window.OneSignalDeferred = window.OneSignalDeferred || [];
const APP_ID_VALID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(APP_ID);

window.OneSignalDeferred.push(async (OneSignal) => {
  try {
    if (!APP_ID_VALID) {
      throw new Error('onesignal_invalid_app_id: el App ID debe tener formato 8-4-4-4-12 (36 caracteres). Cópialo de OneSignal > Settings > Keys & IDs.');
    }
    await OneSignal.init({
      appId: APP_ID,
      serviceWorkerPath: '/OneSignalSDKWorker.js',
      serviceWorkerParam: { scope: '/' },
      autoResubscribe: true,
      welcomeNotification: { disable: true },
    });
    oneSignal = OneSignal;
    initError = null;
    OneSignal.User.PushSubscription.addEventListener('change', renderState);
    OneSignal.Notifications.addEventListener('permissionChange', renderState);
    sdkReadyResolve(OneSignal);
    renderState();
  } catch (error) {
    initError = error;
    console.error('[KARTTA] OneSignal initialization failed:', error);
    sdkReadyReject(error);
    renderState();
  }
});

// Show a recoverable state if the SDK script or network never responds.
window.setTimeout(() => {
  if (!oneSignal && !initError) {
    initError = new Error('onesignal_sdk_timeout');
    renderState();
  }
}, 15000);

function getBrowserPermission() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

function getPushState() {
  if (initError) return { kind: 'error' };
  if (!oneSignal) return { kind: 'loading' };
  if (!oneSignal.Notifications.isPushSupported()) return { kind: 'unsupported' };
  const permission = getBrowserPermission();
  const optedIn = oneSignal.User.PushSubscription.optedIn === true;
  const subscriptionId = oneSignal.User.PushSubscription.id || null;
  if (permission === 'denied') return { kind: 'denied', permission, optedIn, subscriptionId };
  if (permission === 'granted' && optedIn && subscriptionId) return { kind: 'subscribed', permission, optedIn, subscriptionId };
  return { kind: 'not-subscribed', permission, optedIn, subscriptionId };
}

function ensureCard() {
  if (card && card.isConnected) return card;
  const home = document.querySelector('[data-panel="inicio"]');
  if (!home) return null;
  card = document.createElement('div');
  card.id = 'karttaPushCard';
  card.className = 'card kartta-push-card';
  card.setAttribute('aria-live', 'polite');
  card.innerHTML = `
    <div class="kartta-push-copy">
      <div class="kartta-push-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg></div>
      <div class="kartta-push-text">
        <h3 id="karttaPushTitle">Activa las notificaciones de KARTTA</h3>
        <p class="sub" id="karttaPushDescription">Recibe avisos importantes sobre tu restaurante, tus pedidos y tu suscripción directamente en tu dispositivo.</p>
        <p class="kartta-push-status" id="karttaPushStatus" role="status"></p>
      </div>
    </div>
    <div class="kartta-push-actions">
      <button type="button" class="btn btn-accent" id="karttaPushActivate">Activar notificaciones</button>
      <button type="button" class="btn btn-ghost btn-sm" id="karttaPushDismiss">Ahora no</button>
      <button type="button" class="btn btn-ghost btn-sm" id="karttaPushTest" hidden>Enviar prueba</button>
    </div>`;
  const tour = home.querySelector('#tourCard');
  if (tour) home.insertBefore(card, tour);
  else home.appendChild(card);

  card.querySelector('#karttaPushActivate').addEventListener('click', activatePush);
  card.querySelector('#karttaPushDismiss').addEventListener('click', dismissCard);
  card.querySelector('#karttaPushTest').addEventListener('click', sendTestPush);
  return card;
}

function dismissedRecently() {
  try { return Number(localStorage.getItem(DISMISS_KEY) || 0) > Date.now(); }
  catch { return false; }
}

function dismissCard() {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_MS)); } catch { /* storage may be unavailable */ }
  if (card) card.hidden = true;
}

function renderState() {
  const host = ensureCard();
  if (!host) return;
  const state = getPushState();
  const title = host.querySelector('#karttaPushTitle');
  const description = host.querySelector('#karttaPushDescription');
  const status = host.querySelector('#karttaPushStatus');
  const activate = host.querySelector('#karttaPushActivate');
  const dismiss = host.querySelector('#karttaPushDismiss');
  const test = host.querySelector('#karttaPushTest');

  host.hidden = false;
  activate.hidden = false;
  dismiss.hidden = false;
  test.hidden = true;
  status.textContent = '';

  if (state.kind === 'loading') {
    title.textContent = 'Preparando las notificaciones de KARTTA';
    description.textContent = 'Estamos preparando este navegador para que puedas recibir avisos importantes.';
    activate.disabled = true;
  } else if (state.kind === 'error') {
    title.textContent = 'No pudimos iniciar las notificaciones';
    description.textContent = 'Comprueba tu conexión y vuelve a cargar el panel. Tus pedidos y tu cuenta siguen funcionando normalmente.';
    activate.textContent = 'Volver a intentar';
    activate.disabled = false;
  } else if (state.kind === 'unsupported') {
    title.textContent = 'Notificaciones no disponibles en este navegador';
    description.textContent = 'Abre KARTTA en una versión actualizada de Chrome, Edge, Firefox o Safari para activar las notificaciones compatibles.';
    activate.hidden = true;
    dismiss.textContent = 'Entendido';
  } else if (state.kind === 'denied') {
    title.textContent = 'Las notificaciones están bloqueadas';
    description.textContent = 'El navegador bloqueó los avisos de KARTTA. Para activarlos, abre los permisos del sitio en la configuración del navegador y cambia Notificaciones a Permitir.';
    activate.hidden = true;
    dismiss.textContent = 'Entendido';
  } else if (state.kind === 'subscribed') {
    title.textContent = 'Notificaciones activadas en este dispositivo';
    description.textContent = 'Recibirás avisos importantes de KARTTA sobre tu restaurante, tus pedidos y la renovación de tu suscripción.';
    activate.hidden = true;
    dismiss.hidden = true;
    test.hidden = false;
    status.textContent = 'Este dispositivo está vinculado a tu cuenta de KARTTA.';
  } else {
    title.textContent = 'Activa las notificaciones de KARTTA';
    description.textContent = 'Recibe avisos importantes sobre tu restaurante, tus pedidos y tu suscripción directamente en tu dispositivo.';
    activate.textContent = 'Activar notificaciones';
    activate.disabled = false;
  }

  if (state.kind !== 'subscribed' && dismissedRecently()) host.hidden = true;
}

async function activatePush() {
  const host = ensureCard();
  const button = host?.querySelector('#karttaPushActivate');
  const status = host?.querySelector('#karttaPushStatus');
  if (!button) return;
  if (!oneSignal && initError) {
    window.location.reload();
    return;
  }
  if (!oneSignal) return;
  button.disabled = true;
  if (status) status.textContent = 'Solicitando permiso al navegador…';
  try {
    if (getBrowserPermission() === 'denied') {
      if (status) status.textContent = 'El permiso está bloqueado. Actívalo desde la configuración del sitio en tu navegador.';
      return;
    }
    await oneSignal.User.PushSubscription.optIn();
    await new Promise((resolve) => window.setTimeout(resolve, 400));
    try { localStorage.removeItem(DISMISS_KEY); } catch { /* ignore */ }
    renderState();
    if (getPushState().kind !== 'subscribed' && status) {
      status.textContent = 'El navegador aún no confirmó la suscripción. Revisa el permiso y vuelve a intentarlo.';
    }
  } catch (error) {
    if (status) status.textContent = 'No se pudo registrar este dispositivo. Comprueba el permiso y vuelve a intentarlo.';
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

async function sendTestPush() {
  const host = ensureCard();
  const button = host?.querySelector('#karttaPushTest');
  const status = host?.querySelector('#karttaPushStatus');
  if (!button) return;
  button.disabled = true;
  if (status) status.textContent = 'Enviando una prueba únicamente a tu cuenta…';
  try {
    const { data, error } = await sb.functions.invoke('onesignal-push', { body: { action: 'test' } });
    if (error) throw error;
    if (data?.status === 'sent') {
      if (status) status.textContent = 'Prueba aceptada por OneSignal. Revisa las notificaciones de este dispositivo.';
    } else if (data?.status === 'no_subscriptions') {
      if (status) status.textContent = 'No encontramos un dispositivo suscrito para esta cuenta. Activa primero las notificaciones.';
    } else {
      if (status) status.textContent = 'No se pudo completar la prueba. Inténtalo de nuevo más tarde.';
    }
  } catch (error) {
    if (status) status.textContent = 'No se pudo enviar la prueba. Comprueba tu sesión y vuelve a intentarlo.';
  } finally {
    button.disabled = false;
  }
}

const syncIdentity = createOneSignalIdentitySynchronizer(async () => await sdkReady);

sb.auth.onAuthStateChange((_event, session) => {
  const userId = session?.user?.id || null;
  window.setTimeout(() => { syncIdentity(userId); }, 0);
});

window.addEventListener('kartta:ready', () => {
  ensureCard();
  renderState();
});

if (window.KARTTA_CTX) {
  ensureCard();
  renderState();
}

// A late SDK initialization or permission event can arrive after the dashboard is ready.
sdkReady.then(renderState).catch(renderState);
}
