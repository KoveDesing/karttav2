import { sb } from './supabase-init.js';
import { createOneSignalIdentitySynchronizer } from './kartta-onesignal-identity.mjs';

const APP_ID = '2211f00d-3641-4a1d-8105-e5d04fbc181b';
const APP_ID_VALID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(APP_ID);
const DISMISS_KEY = 'kartta_push_dismissed_until';
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;
const SHOW_DELAY_MS = 2500;

// Web Push es same-origin: solo el origen canónico. En previews y subdominios el panel sigue normal.
if (location.hostname.toLowerCase() === 'www.kartta.food') {

let oneSignal = null;
let signedIn = false;
let toast = null;
let showTimer = null;
let sdkReadyResolve;
let sdkReadyReject;
const sdkReady = new Promise((resolve, reject) => { sdkReadyResolve = resolve; sdkReadyReject = reject; });
sdkReady.catch(() => {}); // el error ya se registra abajo; evita "unhandled rejection"

window.OneSignalDeferred = window.OneSignalDeferred || [];
window.OneSignalDeferred.push(async (OneSignal) => {
  try {
    if (!APP_ID_VALID) throw new Error('onesignal_invalid_app_id');
    await OneSignal.init({
      appId: APP_ID,
      serviceWorkerPath: '/OneSignalSDKWorker.js',
      serviceWorkerParam: { scope: '/' },
      autoResubscribe: true,
      welcomeNotification: { disable: true },
      notifyButton: { enable: false },
      // Sin prompts automáticos de OneSignal: el único aviso es la tarjeta de KARTTA.
      promptOptions: { slidedown: { prompts: [{ type: 'push', autoPrompt: false }] } },
    });
    oneSignal = OneSignal;
    OneSignal.User.PushSubscription.addEventListener('change', evaluate);
    OneSignal.Notifications.addEventListener('permissionChange', evaluate);
    try { OneSignal.Slidedown.addEventListener('slidedownShown', () => OneSignal.Slidedown.close?.()); } catch { /* opcional */ }
    sdkReadyResolve(OneSignal);
    evaluate();
  } catch (error) {
    console.error('[KARTTA] OneSignal initialization failed:', error);
    sdkReadyReject(error);
  }
});

function permission() {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

function dismissedRecently() {
  try { return Number(localStorage.getItem(DISMISS_KEY) || 0) > Date.now(); }
  catch { return false; }
}

function build() {
  if (toast && toast.isConnected) return toast;
  toast = document.createElement('div');
  toast.id = 'karttaPushToast';
  toast.hidden = true;
  toast.setAttribute('role', 'dialog');
  toast.setAttribute('aria-live', 'polite');
  toast.setAttribute('aria-labelledby', 'kpTitle');
  toast.innerHTML = `
    <div class="kp-head">
      <img class="kp-logo" src="/favicon.png" alt="KARTTA" width="42" height="42">
      <div>
        <p class="kp-title" id="kpTitle">¿Activar notificaciones?</p>
        <p class="kp-text">Te avisamos de pedidos, pagos y novedades importantes de tu restaurante.</p>
      </div>
    </div>
    <div class="kp-actions">
      <button type="button" class="kp-btn kp-no" id="kpNo">Ahora no</button>
      <button type="button" class="kp-btn kp-yes" id="kpYes">Activar</button>
    </div>
    <p class="kp-note" id="kpNote" role="status"></p>`;
  document.body.appendChild(toast);
  toast.querySelector('#kpYes').addEventListener('click', activate);
  toast.querySelector('#kpNo').addEventListener('click', () => { remember(); close(); });
  return toast;
}

function open() {
  const el = build();
  if (!el.hidden) return;
  el.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-open')));
}

function close(delay = 0) {
  window.clearTimeout(showTimer);
  if (!toast || toast.hidden) return;
  window.setTimeout(() => {
    toast.classList.remove('is-open');
    window.setTimeout(() => { if (toast) toast.hidden = true; }, 360);
  }, delay);
}

function remember() {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_MS)); } catch { /* sin storage */ }
}

// Decide si la tarjeta debe verse. Solo aparece si hay sesión y el permiso aún no se decidió.
function evaluate() {
  if (!oneSignal || !signedIn) return;
  if (!oneSignal.Notifications.isPushSupported()) return close();
  const perm = permission();

  if (perm === 'granted') {
    close();
    // Permiso ya concedido pero suscripción inactiva: se reactiva sin mostrar nada.
    if (oneSignal.User.PushSubscription.optedIn !== true) oneSignal.User.PushSubscription.optIn().catch(() => {});
    return;
  }
  if (perm !== 'default' || dismissedRecently()) return close();

  window.clearTimeout(showTimer);
  showTimer = window.setTimeout(() => { if (signedIn && permission() === 'default') open(); }, SHOW_DELAY_MS);
}

async function activate() {
  const el = build();
  const yes = el.querySelector('#kpYes');
  const no = el.querySelector('#kpNo');
  const note = el.querySelector('#kpNote');
  if (!oneSignal) { note.textContent = 'Aún se están cargando las notificaciones. Inténtalo en unos segundos.'; return; }
  yes.disabled = no.disabled = true;
  note.textContent = '';
  try {
    await oneSignal.User.PushSubscription.optIn(); // abre el permiso nativo del navegador
    const perm = permission();
    if (perm === 'granted') {
      el.querySelector('#kpTitle').textContent = '¡Listo! Notificaciones activadas';
      el.querySelector('.kp-text').textContent = 'Ya recibirás los avisos de KARTTA en este dispositivo.';
      el.querySelector('.kp-actions').hidden = true;
      close(2200);
    } else if (perm === 'denied') {
      remember();
      note.textContent = 'Las notificaciones quedaron bloqueadas. Puedes activarlas desde los permisos del sitio.';
      el.querySelector('.kp-actions').hidden = true;
      close(3500);
    } else {
      yes.disabled = no.disabled = false; // cerró el permiso sin decidir
    }
  } catch {
    note.textContent = 'No se pudo activar. Inténtalo de nuevo.';
    yes.disabled = no.disabled = false;
  }
}

const syncIdentity = createOneSignalIdentitySynchronizer(async () => await sdkReady);

sb.auth.onAuthStateChange((_event, session) => {
  const userId = session?.user?.id || null;
  signedIn = !!userId;
  if (!signedIn) close();
  window.setTimeout(() => { syncIdentity(userId); evaluate(); }, 0);
});

sb.auth.getSession().then(({ data }) => {
  signedIn = !!data?.session?.user?.id;
  evaluate();
}).catch(() => {});

}
