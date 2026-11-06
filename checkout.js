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
const st = { plan: null, cycle: 'monthly', busy: false, error: '' };

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
  if (r.error) { $app.innerHTML = '<div class="ck-card"><p class="ck-err">' + esc(r.error.message === 'forbidden' ? ERR.forbidden : 'No pudimos cargar los planes.') + '</p></div>'; return; }
  ov = r.data;
  const q = new URLSearchParams(location.search);
  let want = q.get('plan'), cyc = q.get('cycle');
  try { const j = JSON.parse(sessionStorage.getItem('kartta_plan_choice') || 'null'); if (j && Date.now() - (j.t || 0) < 6 * 3600e3) { want = want || j.plan; cyc = cyc || j.interval; } } catch { /* ignorar */ }
  const cur = ov.subscription && ov.subscription.plan_id;
  st.plan = (ov.plans.find((p) => p.id === want) || ov.plans.find((p) => p.id !== cur) || ov.plans[0] || {}).id || null;
  const chosen = planOf(st.plan);
  st.cycle = cyc === 'annual' && chosen && chosen.annual_available ? 'annual' : 'monthly';   // anual solo si está habilitado
  draw();
}

const planOf = (id) => ov.plans.find((p) => p.id === id);
const priceOf = (p, cycle) => (cycle === 'annual' ? Number(p.annual_price_cop) : Number(p.monthly_price_cop));
const feats = (p) => {
  const l = p.limits || {}, f = [];
  if (l.products) f.push(l.products + ' productos'); if (l.tables) f.push(l.tables + ' mesas'); if (l.users) f.push(l.users + ' usuarios'); if (l.ai_credits) f.push(l.ai_credits + ' créditos de IA');
  return f;
};

function draw() {
  const anyAnnual = ov.plans.some((p) => p.annual_available);
  const sel = st.plan ? planOf(st.plan) : null;
  const prof = ov.profile || {};
  const s = ov.subscription;
  let h = '<h1>Elige tu plan</h1><p class="ck-sub">Pagas con Wompi. No guardamos los datos de tu tarjeta.' +
    (s && s.effective_status === 'trialing' ? ' Tu prueba gratuita termina el ' + esc(date(s.trial_end || s.current_period_end)) + '.' : '') + '</p>';
  if (st.error) h += '<p class="ck-err" role="alert">' + esc(st.error) + '</p>';
  h += '<div class="ck-toggle" role="group" aria-label="Modalidad de pago"><button type="button" data-cycle="monthly" aria-pressed="' + (st.cycle === 'monthly') + '">Mensual</button>' +
    '<button type="button" data-cycle="annual" aria-pressed="' + (st.cycle === 'annual') + '"' + (anyAnnual ? '' : ' disabled title="Disponible próximamente"') + '>Anual' + (anyAnnual ? '' : ' · próximamente') + '</button></div>';
  h += '<div class="ck-plans">' + ov.plans.map((p) => {
    const unavailable = st.cycle === 'annual' && !p.annual_available;
    const pr = priceOf(p, st.cycle);
    return '<button type="button" class="ck-plan" data-plan="' + esc(p.id) + '" aria-pressed="' + (st.plan === p.id) + '"' + (unavailable ? ' disabled style="opacity:.5"' : '') + '>' +
      '<div class="nm">' + esc(p.name) + (p.id === 'kartta' ? '<span class="ck-tag">Recomendado</span>' : '') + '</div>' +
      '<div class="pr">' + (unavailable ? '—' : money(pr)) + ' <small>/ ' + (st.cycle === 'annual' ? 'año' : 'mes') + '</small></div>' +
      '<div class="ck-muted" style="font-size:13px">' + esc(p.description || '') + '</div><ul>' + feats(p).map((f) => '<li>' + esc(f) + '</li>').join('') + '</ul></button>';
  }).join('') + '</div>';

  h += '<section class="ck-card" style="margin-top:18px"><h2>Datos de facturación</h2><p class="ck-sub" style="margin-bottom:14px">Se usan para tu recibo. Puedes editarlos luego.</p><form id="pf" class="ck-form" novalidate>' +
    fld('legal_name', 'Nombre o razón social', prof.legal_name, 'text', 'name') +
    '<label>Tipo de documento<select name="document_type">' + ['CC', 'CE', 'NIT', 'PP', 'TI', 'DNI', 'RG', 'OTHER'].map((t) => '<option' + ((prof.document_type || 'CC') === t ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></label>' +
    fld('document_number', 'Número de documento', prof.document_number, 'text', 'off') + fld('billing_email', 'Correo de facturación', prof.billing_email || session.user.email, 'email', 'email') +
    fld('phone', 'Celular', prof.phone, 'tel', 'tel') + fld('city', 'Ciudad', prof.city, 'text', 'address-level2') + fld('address', 'Dirección (opcional)', prof.address, 'text', 'street-address') + '</form></section>';

  const ok = sel && !(st.cycle === 'annual' && !sel.annual_available);
  h += '<section class="ck-card"><h2>Resumen</h2>' + (ok ? '<dl class="ck-sum"><dt>Plan</dt><dd>' + esc(sel.name) + '</dd><dt>Modalidad</dt><dd>' + (st.cycle === 'annual' ? 'Anual (12 meses)' : 'Mensual (1 mes)') + '</dd>' +
    '<dt class="tot">Total a pagar</dt><dd class="tot">' + money(priceOf(sel, st.cycle)) + '</dd></dl>' +
    '<p class="ck-note">Pago único por el periodo elegido; no se renueva solo. Te avisaremos antes de que venza. El plan se activa cuando Wompi confirma el pago. El importe final lo calcula nuestro servidor.</p>' +
    '<p style="margin:16px 0 0"><button class="ck-btn" id="pay" type="button"' + (st.busy ? ' disabled' : '') + '>' + (st.busy ? 'Preparando pago…' : 'Pagar con Wompi') + '</button></p>'
    : '<p class="ck-muted">Elige un plan disponible para continuar.</p>') + '</section>';
  $app.innerHTML = h;
}
const fld = (n, l, v, t, ac) => '<label>' + l + '<input name="' + n + '" type="' + t + '" autocomplete="' + ac + '" value="' + esc(v || '') + '"' + (n === 'address' || n === 'city' || n === 'phone' ? '' : ' required') + ' maxlength="120"></label>';

$app.addEventListener('click', (e) => {
  const c = e.target.closest('[data-cycle]'); if (c && !c.disabled) { st.cycle = c.dataset.cycle; st.error = ''; draw(); return; }
  const p = e.target.closest('[data-plan]'); if (p && !p.disabled) { st.plan = p.dataset.plan; st.error = ''; draw(); return; }
  if (e.target.closest('#pay')) pay();
});

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
    await openWidget(res);
  } catch (e) {
    st.error = e.code === 'profile' ? 'No pudimos guardar tus datos de facturación. Revísalos.' : errText(e.code);
    st.busy = false; draw(); fill(keep);
  }
}
function fill(o) { const f = document.getElementById('pf'); if (!f) return; for (const k of ['legal_name', 'document_type', 'document_number', 'phone', 'city', 'address']) if (f.elements[k]) f.elements[k].value = o[k]; if (f.elements.billing_email) f.elements.billing_email.value = o.email; }

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

/* ---------------- confirmación (servidor ↔ Wompi) ---------------- */
async function processing(ref) {
  if (!/^KT-[A-F0-9]{20}$/.test(ref)) { location.replace('/checkout'); return; }
  const id = new URLSearchParams(location.search).get('id');
  $app.innerHTML = '<div class="ck-state"><div class="ck-spin" role="status"></div><h1>Confirmando tu pago…</h1><p class="ck-sub">No cierres esta ventana. Puede tardar unos segundos.</p></div>';
  const t0 = Date.now();
  for (;;) {
    let r = null;
    try { r = await api({ action: 'verify', reference: ref, ...(id ? { id } : {}) }); } catch (e) { if (e.code === 'unauthorized' || e.code === 'not_found') { r = { status: 'error' }; } }
    if (r && r.status === 'approved') return go('success', ref);
    if (r && r.status === 'declined') return go('failed', ref);
    if (r && r.status === 'error') return go('pending', ref);
    if (Date.now() - t0 > 120000) return go('pending', ref);
    await new Promise((res) => setTimeout(res, 3000));
  }
}
function go(state, ref) { location.replace('/checkout/' + state + '/' + ref); }

function result(state, ref) {
  const V = {
    success: { c: 'ok', i: '✓', t: '¡Pago confirmado!', d: 'Tu plan ya está activo. Gracias por confiar en KARTTA.', a: ['/dashboard.html', 'Ir a mi panel'] },
    pending: { c: 'wait', i: '…', t: 'Tu pago sigue en proceso', d: 'Tu banco aún no confirma la transacción. Cuando Wompi la apruebe, activaremos tu plan automáticamente y te avisaremos por correo. No necesitas pagar de nuevo.', a: ['/dashboard.html#facturacion', 'Ver mi facturación'] },
    failed: { c: 'bad', i: '×', t: 'El pago no se completó', d: 'No se hizo ningún cobro o fue rechazado. Puedes intentarlo de nuevo con otro medio de pago.', a: ['/checkout', 'Intentar de nuevo'] }
  }[state];
  $app.innerHTML = '<div class="ck-state"><div class="ck-ico ' + V.c + '" aria-hidden="true">' + V.i + '</div><h1>' + V.t + '</h1><p class="ck-sub" style="max-width:480px;margin:8px auto 22px">' + V.d + '</p>' +
    (ref ? '<p class="ck-note" style="margin:0 0 20px">Referencia: <code>' + esc(ref) + '</code></p>' : '') + '<a class="ck-btn" href="' + V.a[0] + '">' + V.a[1] + '</a></div>';
}

boot().catch((e) => { console.error('[checkout]', e && e.message); $app.innerHTML = '<div class="ck-card"><p class="ck-err">No pudimos cargar el checkout. Recarga la página.</p></div>'; });
