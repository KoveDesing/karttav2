/* KARTTA Payments — checkout nativo. El navegador NUNCA decide importes ni activa planes:
 * pide al servidor (billing-checkout) que cree el pago y firme la transacción; el plan solo se activa cuando el
 * servidor confirma con Wompi. Aquí no se manejan ni se guardan datos de tarjeta (los captura el widget de Wompi). */
import { sb } from '/supabase-init.js';

const $app = document.getElementById('app');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '$' + new Intl.NumberFormat('es-CO').format(Number(n) || 0) + ' COP';
const date = (iso) => (iso ? new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' }) : '—');
const ERR = {
  unauthorized: 'Tu sesión expiró. Inicia sesión de nuevo.', forbidden: 'Solo el propietario o administrador puede gestionar el plan.',
  payments_not_configured: 'Los pagos aún no están habilitados. Escríbenos y te ayudamos.', annual_not_available: 'El plan anual todavía no está disponible.',
  plan_not_available: 'Ese plan no está disponible.', price_not_configured: 'Ese plan aún no tiene precio configurado.',
  downgrade_not_allowed_until_period_end: 'Podrás cambiar a un plan menor cuando termine tu periodo actual.',
  too_many_open_payments: 'Tienes varios pagos sin completar. Espera unos minutos e inténtalo de nuevo.', restaurant_suspended: 'Tu cuenta está suspendida. Contacta a soporte.',
  billing_profile_required: 'Completa tus datos de facturación.', wompi_unavailable: 'Wompi no responde en este momento. Inténtalo en unos minutos.',
  app_url_not_configured: 'Pagos en configuración. Contacta a soporte.'
};
const errText = (c) => ERR[c] || 'No pudimos completar la operación. Inténtalo de nuevo.';

let session = null, rid = null, ov = null;
const st = { plan: null, cycle: 'monthly', busy: false, error: '', method: 'card', utype: 'natural', bank: '', bankQ: '', phone: '', terms: false, banks: null, banksErr: false, acc: null };
const WOMPI_DEFAULT = { env: 'production', key: 'pub_prod_uu4XXPZRyMVlajaTlHBY66Lz7haBPZyF' };   // llave PÚBLICA (segura en el navegador): solo para mostrar bancos antes de crear el pago
const apiBase = (env) => (env === 'sandbox' ? 'https://sandbox.wompi.co/v1' : 'https://production.wompi.co/v1');
/* Logos: coloca los archivos oficiales en /img/pagos/<id>.png (o .svg). Si falta alguno se muestra el nombre. */
const LOGO = { card: 'tarjetas', nequi: 'nequi', pse: 'pse', bancolombia: 'bancolombia', visa: 'visa', mastercard: 'mastercard', amex: 'amex' };
const logo = (id, name, cls) => '<span class="ck-logo ' + (cls || '') + '"><img src="/img/pagos/' + esc(LOGO[id] || id) + '.png" alt="' + esc(name) + '" loading="lazy" onerror="this.parentNode.classList.add(\'nolg\');this.remove()"><em>' + esc(name) + '</em></span>';
const METHODS = [
  { id: 'card', name: 'Tarjeta', d: 'Crédito o débito', ic: 'card', brands: ['visa', 'mastercard', 'amex'] },
  { id: 'nequi', name: 'Nequi', d: 'Aprueba desde tu app', ic: 'phone' },
  { id: 'pse', name: 'PSE', d: 'Elige tu banco', ic: 'bank' },
  { id: 'bancolombia', name: 'Bancolombia', d: 'Botón de transferencia', ic: 'bank' },
];
async function wGet(path, key) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), 9000);
  try { const r = await fetch(path, { headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' }, signal: c.signal }); const j = await r.json().catch(() => null); return { status: r.status, json: j }; } finally { clearTimeout(t); }
}
async function loadBanks() {
  if (st.banks || st.banksLoading) return; st.banksLoading = true;
  try {
    const r = await wGet(apiBase(WOMPI_DEFAULT.env) + '/pse/financial_institutions', WOMPI_DEFAULT.key);
    const l = r.json && Array.isArray(r.json.data) ? r.json.data : [];
    st.banks = l.filter((b) => b && String(b.financial_institution_code) !== '0').map((b) => ({ code: String(b.financial_institution_code), name: String(b.financial_institution_name || '').trim() })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
    st.banksErr = !st.banks.length;
  } catch { st.banksErr = true; }
  st.banksLoading = false; if (st.method === 'pse') draw();
}

async function api(body) {
  const r = await fetch(sb.supabaseUrl + '/functions/v1/billing-checkout', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token, apikey: sb.supabaseKey }, body: JSON.stringify(body)
  });
  let j = null; try { j = await r.json(); } catch { /* sin cuerpo */ }
  if (!r.ok) { const e = new Error((j && j.error) || 'error'); e.code = (j && j.error) || 'error'; throw e; }
  return j;
}

async function boot() {
  const { data } = await sb.auth.getSession(); session = data && data.session;
  if (!session) { location.href = '/index.html'; return; }
  const m = await sb.from('restaurant_members').select('restaurant_id').eq('user_id', session.user.id).order('created_at').limit(1);
  rid = m.data && m.data[0] && m.data[0].restaurant_id;
  if (!rid) { $app.innerHTML = '<div class="ck-card"><p>Tu cuenta no tiene un restaurante asociado todavía.</p></div>'; return; }
  const parts = location.pathname.replace(/^\/+|\/+$/g, '').split('/'); // checkout[/estado[/ref]]
  const state = parts[1] || '';
  if (state === 'processing') return processing(parts[2] || '');
  if (['success', 'pending', 'failed'].includes(state)) return result(state, parts[2] || '');
  return chooser();
}

/* ---------------- elección de plan + datos + pago ---------------- */
async function chooser() {
  const r = await sb.rpc('billing_my_overview', { p_restaurant: rid });
  if (r.error) {
    const m = String(r.error.message || ''), code = r.error.code || '';
    const why = /forbidden/.test(m) ? ERR.forbidden
      : (code === 'PGRST202' || code === '42883' || /could not find the function|does not exist/i.test(m)) ? 'Falta instalar la base de datos de pagos: ejecuta INSTALAR_PAGOS.sql en Supabase (SQL Editor).'
      : 'No pudimos cargar los planes.';
    console.error('[checkout] billing_my_overview', code, m);
    $app.innerHTML = '<div class="ck-card"><p class="ck-err">' + esc(why) + '</p><p class="ck-note">Detalle técnico: ' + esc(code || 'error') + ' — ' + esc(m.slice(0, 160)) + '</p></div>'; return;
  }
  ov = r.data;
  const q = new URLSearchParams(location.search);
  let want = q.get('plan'), cyc = q.get('cycle');
  try { const j = JSON.parse(sessionStorage.getItem('kartta_plan_choice') || 'null'); if (j && Date.now() - (j.t || 0) < 6 * 3600e3) { want = want || j.plan; cyc = cyc || j.interval; } } catch { /* ignorar */ }
  const cur = ov.subscription && ov.subscription.plan_id;
  st.plan = (ov.plans.find((p) => p.id === want) || ov.plans.find((p) => p.id !== cur) || ov.plans[0] || {}).id || null;
  const chosen = planOf(st.plan);
  st.cycle = cyc === 'annual' && chosen && chosen.annual_available ? 'annual' : 'monthly';   // anual solo si está habilitado
  draw();
  loadAcc();
}
async function loadAcc() { try { const r = await wGet(apiBase(WOMPI_DEFAULT.env) + '/merchants/' + WOMPI_DEFAULT.key, WOMPI_DEFAULT.key); const p = r.json && r.json.data && r.json.data.presigned_acceptance; if (p && /^https:\/\/[^ ]+$/.test(p.permalink || '')) { st.acc = { permalink: p.permalink }; } } catch { /* opcional */ } }

const planOf = (id) => ov.plans.find((p) => p.id === id);
const priceOf = (p, cycle) => (cycle === 'annual' ? Number(p.annual_price_cop) : Number(p.monthly_price_cop));
const feats = (p) => {
  const l = p.limits || {}, f = [];
  const prod = l.products || l.max_products; if (prod) f.push(prod + ' productos'); if (l.tables) f.push(l.tables + ' mesas'); if (l.users) f.push(l.users + ' usuarios'); const ai = l.ai_credits || l.ai_monthly_questions; if (ai) f.push(ai + ' consultas de IA al mes');
  return f;
};

const setStep = (n) => document.querySelectorAll('#steps li').forEach((li) => { const k = +li.dataset.s; li.className = k < n ? 'done' : k === n ? 'on' : ''; });
const payable = () => { const p = st.plan ? planOf(st.plan) : null; return !!p && !(st.cycle === 'annual' && !p.annual_available) && priceOf(p, st.cycle) > 0; };
const LOCK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const MIC = {
  card: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/></svg>',
  phone: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18h2"/></svg>',
  bank: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10 12 4l9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/></svg>'
};

function draw() {
  setStep(st.busy ? 2 : 1);
  const anyAnnual = ov.plans.some((p) => p.annual_available);
  const sel = st.plan ? planOf(st.plan) : null;
  const prof = ov.profile || {};
  const s = ov.subscription;
  const ok = payable();
  const pr = ok ? priceOf(sel, st.cycle) : 0;
  const monthly = sel ? Number(sel.monthly_price_cop) : 0;
  const old = ok && st.cycle === 'annual' && monthly * 12 > pr ? monthly * 12 : 0;      // solo si el ahorro es real (precios del servidor)
  const save = old ? Math.round((1 - pr / old) * 100) : 0;

  let h = '<div class="ck-grid"><div>';
  h += '<section class="ck-card"><h1>Mejora tu <span class="ck-hl">plan</span></h1><p class="ck-sub" style="margin-bottom:0">Elige tu plan, confirma tus datos y paga con el método que prefieras.' +
    (s && s.effective_status === 'trialing' ? ' Tu prueba gratuita termina el ' + esc(date(s.trial_end || s.current_period_end)) + '.' : '') + '</p>';
  if (st.error) h += '<p class="ck-err" role="alert" style="margin-top:16px">' + esc(st.error) + '</p>';
  h += '<div class="ck-lab">Periodo de facturación</div><div class="ck-toggle" role="group" aria-label="Modalidad de pago"><button type="button" data-cycle="monthly" aria-pressed="' + (st.cycle === 'monthly') + '">Mensual</button>' +
    '<button type="button" data-cycle="annual" aria-pressed="' + (st.cycle === 'annual') + '"' + (anyAnnual ? '' : ' disabled title="Disponible próximamente"') + '>Anual' + (anyAnnual ? '' : ' · próximamente') + '</button></div>';
  h += '<div class="ck-lab">Plan</div><div class="ck-opts" role="group" aria-label="Plan">' + ov.plans.map((p) => {
    const unavailable = st.cycle === 'annual' && !p.annual_available;
    const v = priceOf(p, st.cycle);
    return '<button type="button" class="ck-opt" data-plan="' + esc(p.id) + '" aria-pressed="' + (st.plan === p.id) + '"' + (unavailable ? ' disabled' : '') + '><span class="ck-radio" aria-hidden="true"></span>' +
      '<span><span class="nm">' + esc(p.name) + (p.id === 'kartta' ? '<span class="ck-tag">Recomendado</span>' : '') + '</span><span class="ds" style="display:block">' + esc(p.description || '') + '</span></span>' +
      '<span class="pr">' + (unavailable ? '—' : money(v)) + '<small>/ ' + (st.cycle === 'annual' ? 'año' : 'mes') + '</small></span></button>';
  }).join('') + '</div></section>';

  h += '<section class="ck-card"><h2>Datos de facturación</h2><p class="ck-sub" style="margin-bottom:16px">Se usan para tu recibo. Puedes editarlos luego.</p><form id="pf" class="ck-form" novalidate>' +
    fld('legal_name', 'Nombre o razón social', prof.legal_name, 'text', 'name', 'Como aparece en tu documento') +
    '<label>Tipo de documento<select name="document_type">' + ['CC', 'CE', 'NIT', 'PP', 'TI', 'DNI', 'RG', 'OTHER'].map((t) => '<option' + ((prof.document_type || 'CC') === t ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></label>' +
    fld('document_number', 'Número de documento', prof.document_number, 'text', 'off', '1234567890') + fld('billing_email', 'Correo de facturación', prof.billing_email || session.user.email, 'email', 'email', 'tu@correo.com') +
    fld('phone', 'Celular', prof.phone, 'tel', 'tel', '300 000 0000') + fld('city', 'Ciudad', prof.city, 'text', 'address-level2', 'Bogotá') + fld('address', 'Dirección (opcional)', prof.address, 'text', 'street-address', '') + '</form></section>';

  h += '<section class="ck-card"><h2>¿Cómo quieres <span class="ck-hl">pagar</span>?</h2><p class="ck-sub" style="margin-bottom:16px">Elige tu método. Todo el proceso es seguro y lo procesa Wompi.</p>' +
    '<div class="ck-mgrid" role="radiogroup" aria-label="Método de pago">' + METHODS.map((m) => '<button type="button" role="radio" class="ck-mtile" data-method="' + m.id + '" aria-checked="' + (st.method === m.id) + '">' +
      '<span class="ck-mlogo">' + (m.id === 'card' ? '' : logo(m.id, m.name)) + '<span class="ic">' + MIC[m.ic] + '</span></span><span class="t">' + esc(m.name) + '</span><span class="d">' + esc(m.d) + '</span>' +
      (m.brands ? '<span class="ck-brands2">' + m.brands.map((x) => logo(x, { visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex' }[x], 'sm')).join('') + '</span>' : '') + '<span class="ck-tick" aria-hidden="true"></span></button>').join('') + '</div>';
  if (st.method === 'card') h += '<div class="ck-mpanel"><p class="ck-sub" style="margin:0">Se abre la ventana segura de Wompi para escribir los datos de tu tarjeta. KARTTA nunca ve ni guarda tu tarjeta. También verás allí otros métodos habilitados.</p></div>';
  if (st.method === 'nequi' && !st.phone) st.phone = String(prof.phone || '').replace(/\D/g, '').replace(/^57(?=\d{10}$)/, '');
  if (st.method === 'nequi') h += '<div class="ck-mpanel"><label class="ck-f">Número de celular de tu cuenta Nequi<input id="nqPhone" inputmode="numeric" autocomplete="tel-national" maxlength="12" placeholder="300 000 0000" value="' + esc(st.phone || String(prof.phone || '').replace(/\D/g, '').replace(/^57(?=\d{10}$)/, '')) + '"></label><p class="ck-hint">Te llegará una notificación a la app de Nequi para aprobar el pago. Tienes unos minutos para hacerlo.</p></div>';
  if (st.method === 'bancolombia') h += '<div class="ck-mpanel"><div class="ck-seg" role="radiogroup" aria-label="Tipo de persona"><button type="button" role="radio" data-ut="natural" aria-checked="' + (st.utype === 'natural') + '">Persona natural</button><button type="button" role="radio" data-ut="juridica" aria-checked="' + (st.utype === 'juridica') + '">Persona jurídica</button></div><p class="ck-hint">Te llevamos al botón de transferencia Bancolombia para autorizar el pago con tu cuenta.</p></div>';
  if (st.method === 'pse') {
    h += '<div class="ck-mpanel"><div class="ck-seg" role="radiogroup" aria-label="Tipo de persona"><button type="button" role="radio" data-ut="natural" aria-checked="' + (st.utype === 'natural') + '">Persona natural</button><button type="button" role="radio" data-ut="juridica" aria-checked="' + (st.utype === 'juridica') + '">Persona jurídica</button></div><div class="ck-lab" style="margin-top:16px">Tu banco</div>';
    if (st.banksErr) h += '<p class="ck-err">No pudimos cargar la lista de bancos. Revisa tu conexión o usa “Tarjeta” para ver todos los métodos.</p>';
    else if (!st.banks) h += '<div class="ck-bankload"><span class="ck-spin sm"></span> Cargando bancos…</div>';
    else {
      const q = st.bankQ.trim().toLowerCase(), list = st.banks.filter((b) => !q || b.name.toLowerCase().includes(q));
      h += '<input class="ck-search" id="bankQ" type="search" placeholder="Buscar banco…" autocomplete="off" value="' + esc(st.bankQ) + '"><div class="ck-banks" role="radiogroup" aria-label="Bancos">' +
        (list.length ? list.map((b) => '<button type="button" role="radio" class="ck-bank" data-bank="' + esc(b.code) + '" aria-checked="' + (st.bank === b.code) + '"><span class="bk">' + esc(b.name.replace(/^banco\s+(de\s+)?/i, '').trim().charAt(0).toUpperCase() || 'B') + '</span><span class="bn">' + esc(b.name) + '</span></button>').join('') : '<p class="ck-hint" style="padding:12px">No hay bancos con ese nombre.</p>') + '</div>';
    }
    h += '</div>';
  }
  if (st.method !== 'card') h += '<label class="ck-terms"><input type="checkbox" id="ckTerms"' + (st.terms ? ' checked' : '') + '><span>Acepto los <a href="' + esc((st.acc && st.acc.permalink) || 'https://wompi.com/es/co/') + '" target="_blank" rel="noopener">términos y condiciones</a> y la autorización de datos personales de Wompi.</span></label>';
  h += '<div class="ck-info"><span aria-hidden="true">🔒</span><span>Pago procesado por Wompi (Bancolombia). KARTTA no almacena datos de tu tarjeta ni de tu cuenta.</span></div></section>';
  h += '</div>';

  h += '<aside class="ck-aside" aria-label="Resumen del pedido"><section class="ck-card"><div class="ck-sumhead"><h2 style="margin:0">Resumen de tu pedido</h2></div>';
  if (ok) {
    h += '<div class="ck-sumplan"><div><div class="nm">Plan ' + esc(sel.name) + '</div><div class="ds">Suscripción ' + (st.cycle === 'annual' ? 'anual' : 'mensual') + '</div></div>' +
      '<div style="text-align:right">' + (old ? '<div class="ck-old">' + money(old) + '</div>' : '') + '<div style="font-weight:800;color:var(--strong)">' + money(pr) + '</div><div class="ds" style="font-size:12px;color:var(--muted)">/ ' + (st.cycle === 'annual' ? 'año' : 'mes') + '</div></div></div>';
    if (save > 0) h += '<p class="ck-best">🎉 ¡Estás obteniendo el mejor precio! Ahorras ' + save + '% frente a pagar mes a mes.</p>';
    const f = feats(sel); if (f.length) h += '<ul class="ck-ben">' + f.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>';
    h += '<dl class="ck-sum"><dt>Periodo</dt><dd>' + (st.cycle === 'annual' ? '12 meses' : '1 mes') + '</dd>' + (old ? '<dt>Descuento</dt><dd style="color:var(--ok)">− ' + money(old - pr) + '</dd>' : '') +
      '<dt class="tot">Total a pagar</dt><dd class="tot">' + money(pr) + '</dd></dl>' +
      '<p class="ck-renew">Es un pago único por el periodo elegido: no se renueva solo. Te avisaremos antes de que venza. El plan se activa cuando Wompi confirma el pago, y el importe final lo calcula nuestro servidor.</p>' +
      '<button class="ck-btn block" id="pay" type="button"' + (st.busy ? ' disabled' : '') + '>' + (st.busy ? 'Preparando pago…' : LOCK + ' ' + payLabel() + ' →') + '</button><p class="ck-note">Pago seguro procesado por Wompi.</p>';
  } else h += '<p class="ck-muted">Elige un plan disponible para continuar.</p>';
  h += '</section></aside></div>';
  $app.innerHTML = h;
  setTimeout(syncPay, 0);
}
const payLabel = () => ({ card: 'Pagar con tarjeta', nequi: 'Pagar con Nequi', pse: 'Pagar con PSE', bancolombia: 'Pagar con Bancolombia' }[st.method] || 'Pagar ahora');
function methodReady() {
  if (st.method === 'nequi') { const d = String(st.phone || '').replace(/\D/g, '').replace(/^57(?=\d{10}$)/, ''); return /^3\d{9}$/.test(d) && st.terms; }
  if (st.method === 'pse') return !!st.bank && st.terms;
  if (st.method === 'bancolombia') return st.terms;
  return true;
}
function syncPay() {
  const b = document.getElementById('pay'), f = document.getElementById('pf'); if (!b || !f) return;
  const v = (k) => String((f.elements[k] || {}).value || '').trim();
  b.disabled = st.busy || !payable() || !methodReady() || !v('legal_name') || !v('document_number') || !v('billing_email');   // deshabilitado si faltan datos obligatorios
}
$app.addEventListener('input', (e) => { if (e.target.closest && e.target.closest('#pf')) syncPay(); });
const fld = (n, l, v, t, ac, ph) => '<label>' + l + '<input name="' + n + '" type="' + t + '" autocomplete="' + ac + '" placeholder="' + esc(ph || '') + '" value="' + esc(v || '') + '"' + (n === 'address' || n === 'city' || n === 'phone' ? '' : ' required') + ' maxlength="120"></label>';

$app.addEventListener('click', (e) => {
  const c = e.target.closest('[data-cycle]'); if (c && !c.disabled) { st.cycle = c.dataset.cycle; st.error = ''; draw(); return; }
  const p = e.target.closest('[data-plan]'); if (p && !p.disabled) { st.plan = p.dataset.plan; st.error = ''; try { if (window.KarttaTrack) KarttaTrack.event('plan_select', { element: st.plan }); } catch { /* analítica opcional */ } draw(); return; }
  const mt = e.target.closest('[data-method]'); if (mt) { keepForm(); st.method = mt.dataset.method; st.error = ''; if (st.method === 'pse') loadBanks(); draw(); return; }
  const ut = e.target.closest('[data-ut]'); if (ut) { keepForm(); st.utype = ut.dataset.ut; draw(); return; }
  const bk = e.target.closest('[data-bank]'); if (bk) { keepForm(); st.bank = bk.dataset.bank; draw(); return; }
  if (e.target.closest('#pay')) pay();
});
function keepForm() { const f = document.getElementById('pf'); if (!f) return; ov.profile = { ...(ov.profile || {}), ...Object.fromEntries(['legal_name', 'document_type', 'document_number', 'phone', 'city', 'address'].map((k) => [k, f.elements[k] ? f.elements[k].value : ''])), billing_email: f.elements.billing_email ? f.elements.billing_email.value : '' }; }
$app.addEventListener('input', (e) => {
  if (e.target.id === 'nqPhone') { st.phone = e.target.value; syncPay(); }
  if (e.target.id === 'bankQ') { st.bankQ = e.target.value; const pos = e.target.selectionStart; keepForm(); draw(); const i = document.getElementById('bankQ'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch { /* ignorar */ } } }
});
$app.addEventListener('change', (e) => { if (e.target.id === 'ckTerms') { st.terms = e.target.checked; syncPay(); } });

function readProfile() {
  const f = new FormData(document.getElementById('pf')), v = (k) => String(f.get(k) || '').trim();
  const o = { legal_name: v('legal_name'), document_type: v('document_type'), document_number: v('document_number'), email: v('billing_email'), phone: v('phone'), city: v('city'), address: v('address') };
  if (o.legal_name.length < 3) return { err: 'Escribe tu nombre o razón social.' };
  if (!/^[A-Za-z0-9.\-\s]{4,20}$/.test(o.document_number)) return { err: 'Revisa el número de documento.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(o.email)) return { err: 'Escribe un correo válido.' };
  if (o.phone && !/^[+\d\s()-]{7,16}$/.test(o.phone)) return { err: 'Revisa el número de celular.' };
  return { o };
}

async function pay() {
  if (st.busy) return;
  const pr = readProfile(); if (pr.err) { st.error = pr.err; draw(); return; }
  st.busy = true; st.error = ''; const keep = pr.o; draw(); fill(keep);
  try {
    const o = keep;
    const sp = await sb.rpc('billing_save_profile', { p_restaurant: rid, p_legal_name: o.legal_name, p_document_type: o.document_type, p_document_number: o.document_number, p_email: o.email, p_phone: o.phone, p_city: o.city, p_address: o.address });
    if (sp.error) { const e = new Error(sp.error.message); e.code = /forbidden/.test(sp.error.message) ? 'forbidden' : 'profile'; throw e; }
    const res = await api({ action: 'create', restaurant_id: rid, plan: st.plan, cycle: st.cycle });   // solo ids: el servidor fija el importe
    try { sessionStorage.removeItem('kartta_plan_choice'); } catch { /* ignorar */ }
    try { if (window.KarttaTrack) KarttaTrack.event('checkout_start', { element: st.plan }); } catch { /* analítica opcional */ }
    if (st.method === 'card') await openWidget(res); else await directPay(res, o);
  } catch (e) {
    st.error = e.code === 'profile' ? 'No pudimos guardar tus datos de facturación. Revísalos.' : (e.msg || errText(e.code));
    st.busy = false; draw(); fill(keep);
  }
}
function fill(o) { const f = document.getElementById('pf'); if (!f) return; for (const k of ['legal_name', 'document_type', 'document_number', 'phone', 'city', 'address']) if (f.elements[k]) f.elements[k].value = o[k]; if (f.elements.billing_email) f.elements.billing_email.value = o.email; syncPay(); }

function loadWidget() {
  return new Promise((ok, no) => {
    if (window.WidgetCheckout) return ok();
    const s = document.createElement('script'); s.src = 'https://checkout.wompi.co/widget.js'; s.onload = ok; s.onerror = () => no(Object.assign(new Error('widget'), { code: 'widget' }));
    document.head.appendChild(s);
  });
}
async function openWidget(res) {
  await loadWidget();
  const w = new window.WidgetCheckout(res.widget);
  w.open((result) => {
    const tx = result && result.transaction;
    const q = tx && tx.id ? '?id=' + encodeURIComponent(tx.id) : '';
    location.href = '/checkout/processing/' + res.reference + q;   // el estado real lo confirma el servidor
  });
  st.busy = false; draw();
}


/* ---------------- pago directo con Nequi / PSE / Bancolombia (API de Wompi con la llave pública) ---------------- */
const PSE_ID = ['CC', 'CE', 'NIT', 'TI', 'PP', 'RC', 'DE'];
const fail = (msg) => Object.assign(new Error(msg), { code: 'direct', msg });
async function directPay(res, o) {
  const w = res.widget, base = apiBase(res.environment), key = w.publicKey;
  let m; try { m = await wGet(base + '/merchants/' + encodeURIComponent(key), key); } catch { throw fail('No pudimos conectar con Wompi. Inténtalo de nuevo.'); }
  const d = m.json && m.json.data, tok = d && d.presigned_acceptance && d.presigned_acceptance.acceptance_token, per = d && d.presigned_personal_data_auth && d.presigned_personal_data_auth.acceptance_token;
  if (!tok) throw fail('Wompi no pudo iniciar el pago. Inténtalo de nuevo o usa “Tarjeta”.');
  const cd = w.customerData || {}, phoneDigits = String(st.phone || '').replace(/\D/g, '').replace(/^57(?=\d{10}$)/, '');
  let pm;
  if (st.method === 'nequi') pm = { type: 'NEQUI', phone_number: phoneDigits };
  else if (st.method === 'pse') {
    if (!PSE_ID.includes(o.document_type)) throw fail('Para PSE usa un documento tipo CC, CE, NIT, TI o PP.');
    if (st.banks && !st.banks.some((b) => b.code === st.bank)) throw fail('Elige tu banco.');
    pm = { type: 'PSE', user_type: st.utype === 'juridica' ? 1 : 0, user_legal_id_type: o.document_type, user_legal_id: String(o.document_number).replace(/[^A-Za-z0-9]/g, ''), financial_institution_code: st.bank, payment_description: ('KARTTA ' + (res.plan_name || 'plan')).slice(0, 60) };
  } else pm = { type: 'BANCOLOMBIA_TRANSFER', user_type: st.utype === 'juridica' ? 'COMPANY' : 'PERSON', payment_description: ('KARTTA ' + (res.plan_name || 'plan')).slice(0, 60), ecommerce_url: w.redirectUrl };
  const body = { acceptance_token: tok, ...(per ? { accept_personal_auth: per } : {}), amount_in_cents: w.amountInCents, currency: w.currency, signature: w.signature.integrity, customer_email: cd.email || o.email,
    reference: w.reference, expiration_time: w.expirationTime, redirect_url: w.redirectUrl, payment_method: pm,
    customer_data: { phone_number: cd.phoneNumber ? cd.phoneNumber : (phoneDigits || undefined), full_name: cd.fullName || o.legal_name, legal_id: cd.legalId, legal_id_type: cd.legalIdType } };
  let r, j; try { r = await fetch(base + '/transactions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(body) }); j = await r.json().catch(() => null); } catch { throw fail('No pudimos conectar con Wompi. Inténtalo de nuevo.'); }
  const tx = j && j.data;
  if (!r.ok || !tx || !tx.id) {
    const msgs = j && j.error && j.error.messages ? JSON.stringify(j.error.messages) : '';
    console.warn('[checkout] wompi', r.status, msgs.slice(0, 200));
    throw fail(/phone/i.test(msgs) ? 'Revisa el número de Nequi.' : 'Wompi no pudo crear el pago con ese método. Revisa los datos o prueba con otro método.');
  }
  try { sessionStorage.removeItem('kartta_plan_choice'); } catch { /* ignorar */ }
  try { if (window.KarttaTrack) KarttaTrack.event('checkout_start', { element: st.plan, method: st.method }); } catch { /* analítica opcional */ }
  const q = '?id=' + encodeURIComponent(tx.id);
  if (st.method === 'nequi') { location.href = '/checkout/processing/' + res.reference + q + '&m=nequi'; return; }
  // PSE / Bancolombia: Wompi entrega la URL del banco unos segundos después de crear la transacción
  $app.innerHTML = '<div class="ck-state"><div class="ck-spin" role="status"></div><h1>Conectando con tu banco…</h1><p class="ck-sub">Te estamos redirigiendo de forma segura.</p></div>';
  const t0 = Date.now();
  for (;;) {
    const u = tx.payment_method && tx.payment_method.extra && tx.payment_method.extra.async_payment_url;
    if (u && /^https:\/\//.test(u)) { location.href = u; return; }
    if (Date.now() - t0 > 25000) { location.href = '/checkout/processing/' + res.reference + q; return; }
    await new Promise((ok) => setTimeout(ok, 1500));
    try { const g = await wGet(base + '/transactions/' + encodeURIComponent(tx.id), key); if (g.json && g.json.data) Object.assign(tx, g.json.data); if (tx.status && tx.status !== 'PENDING') { location.href = '/checkout/processing/' + res.reference + q; return; } } catch { /* reintenta */ }
  }
}

/* ---------------- confirmación (servidor ↔ Wompi) ---------------- */
async function processing(ref) {
  if (!/^KT-[A-F0-9]{20}$/.test(ref)) { location.replace('/checkout'); return; }
  setStep(2);
  const id = new URLSearchParams(location.search).get('id');
  const nq = new URLSearchParams(location.search).get('m') === 'nequi';
  $app.innerHTML = '<div class="ck-state"><div class="ck-spin" role="status"></div><h1>' + (nq ? 'Aprueba el pago en tu app Nequi' : 'Estamos verificando tu pago') + '</h1><p class="ck-sub">' + (nq ? 'Abre Nequi, toca la notificación de KARTTA y aprueba el pago. Esta página se actualiza sola.' : 'No cierres esta ventana. Puede tardar unos segundos.') + '</p></div>';
  const t0 = Date.now();
  for (;;) {
    let r = null;
    try { r = await api({ action: 'verify', reference: ref, ...(id ? { id } : {}) }); } catch (e) { if (e.code === 'unauthorized' || e.code === 'not_found') { r = { status: 'error' }; } }
    if (r && r.status === 'approved') return go('success', ref);
    if (r && r.status === 'declined') return go('failed', ref);
    if (r && r.status === 'error') return go('pending', ref);
    if (Date.now() - t0 > (nq ? 300000 : 120000)) return go('pending', ref);
    await new Promise((res) => setTimeout(res, 3000));
  }
}
function go(state, ref) { location.replace('/checkout/' + state + '/' + ref); }

async function result(state, ref) {
  if (!/^KT-[A-F0-9]{20}$/.test(ref)) { location.replace('/checkout'); return; }
  const brand = '<a class="ck-brand" href="/index.html" aria-label="KARTTA">Kar<span>tt</span>a</a>';
  if (state === 'success') {
    // La URL no prueba nada: el servidor confirma con Wompi (operación idempotente) antes de mostrar el éxito.
    setStep(2); $app.innerHTML = '<div class="ck-state"><div class="ck-spin" role="status"></div><h1>Confirmando…</h1></div>';
    let r = null; try { r = await api({ action: 'verify', reference: ref }); } catch { /* se trata como pendiente */ }
    if (!r || r.status !== 'approved') return go('pending', ref);
    let d = null;
    try { const q = await sb.from('payments').select('plan_id,amount_in_cents,paid_at,confirmed_at,applied_at').eq('reference', ref).maybeSingle(); d = q.data || null; } catch { /* sin detalle: se muestra la referencia */ }
    setStep(4);
    const planName = d && d.plan_id ? ((planOf(d.plan_id) && planOf(d.plan_id).name) || d.plan_id) : null;
    const rows = [planName ? ['Plan', esc(planName)] : null, d && d.amount_in_cents ? ['Importe pagado', money(Number(d.amount_in_cents) / 100)] : null, ['Referencia', esc(ref)], ['Fecha de pago', esc(date((d && (d.paid_at || d.confirmed_at || d.applied_at)) || new Date().toISOString()))]].filter(Boolean);
    $app.innerHTML = '<div class="ck-state">' + brand + '<div class="ck-ico ok" aria-hidden="true">✓</div><h1>¡Bienvenido a KARTTA!</h1><p class="ck-sub" style="margin:8px 0 0">Tu pago se ha procesado correctamente. Tu suscripción ya está lista.</p>' +
      '<div class="ck-det">' + rows.map((x) => '<div><span>' + x[0] + '</span><b>' + x[1] + '</b></div>').join('') + '</div><a class="ck-btn block" style="margin-top:0" href="/dashboard.html">Ir a mi dashboard →</a></div>';
    return;
  }
  const V = {
    pending: { s: 3, c: 'wait', i: '…', t: 'Estamos verificando tu pago', d: 'Tu banco aún no confirma la transacción. Cuando Wompi la apruebe, activaremos tu plan automáticamente. No necesitas pagar de nuevo.', a: ['/dashboard.html', 'Ir a mi dashboard'] },
    failed: { s: 2, c: 'bad', i: '×', t: 'El pago no se completó', d: 'No se hizo ningún cobro o fue rechazado. Puedes intentarlo de nuevo con otro medio de pago.', a: ['/checkout', 'Intentar de nuevo'] }
  }[state];
  if (!V) { location.replace('/checkout'); return; }
  setStep(V.s);
  $app.innerHTML = '<div class="ck-state">' + brand + '<div class="ck-ico ' + V.c + '" aria-hidden="true">' + V.i + '</div><h1>' + V.t + '</h1><p class="ck-sub" style="margin:8px 0 22px">' + V.d + '</p>' +
    '<div class="ck-det"><div><span>Referencia</span><b>' + esc(ref) + '</b></div></div><a class="ck-btn block" style="margin-top:0" href="' + V.a[0] + '">' + V.a[1] + '</a></div>';
}

boot().catch((e) => { console.error('[checkout]', e && e.message); $app.innerHTML = '<div class="ck-card"><p class="ck-err">No pudimos cargar el checkout. Recarga la página.</p></div>'; });
