/* KARTTA — identidad del cliente en el menú público (solo si el restaurante activó el programa de puntos).
 * El cliente se identifica con su teléfono verificado por código (OTP). No hay contraseñas ni enlaces secretos.
 * La sesión del cliente es un token aleatorio que el servidor guarda con hash; aquí solo se guarda en localStorage por restaurante.
 * Todo texto se inserta con textContent. Expone window.KARTTA_CUSTOMER para que el carrito use la identidad. */
import { sb } from "/supabase-init.js";
(async function () {
  const params = new URLSearchParams(location.search);
  if (params.get('preview') === '1') return;
  const slug = await new Promise((res) => {
    if (window.__karttaSlug) return res(window.__karttaSlug);
    window.addEventListener('kartta:menu', () => res(window.__karttaSlug || ''), { once: true });
    setTimeout(() => res(window.__karttaSlug || ''), 15000);
  });
  if (!slug) return;
  let info; try { const r = await sb.rpc('get_loyalty_public', { p_slug: slug }); info = r.data; if (r.error || !info || !info.enabled) return; } catch { return; }

  const KEY = 'kartta_cs_' + slug;
  const getTok = () => { try { const t = localStorage.getItem(KEY); return t && /^[A-Za-z0-9_-]{32,128}$/.test(t) ? t : null; } catch { return null; } };
  const setTok = (t) => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* sin almacenamiento */ } };
  const mk = (t, css, txt) => { const e = document.createElement(t); if (css) e.style.cssText = css; if (txt != null) e.textContent = txt; return e; };
  const ERR = {
    rate_limited: 'Pediste muchos códigos. Espera unos minutos e intenta de nuevo.', invalid_phone: 'Revisa tu número de teléfono.',
    otp_not_configured: 'El envío de códigos aún no está activado. Puedes pedir sin tarjeta.', send_failed: 'No pudimos enviar el código. Intenta con el otro canal o más tarde.',
    expired: 'El código venció. Pide uno nuevo.', too_many_attempts: 'Demasiados intentos. Pide un código nuevo.', invalid_code: 'Código incorrecto.',
    consent_required: 'Necesitamos que aceptes para crear tu tarjeta.', name_required: 'Escribe tu nombre.', disabled: 'El programa de puntos está desactivado.',
  };

  const api = { required: !!info.require_identity, token: getTok, open: () => openDialog(), logout: (silent) => logout(silent), refresh: () => paintBlock() };
  window.KARTTA_CUSTOMER = api;

  /* ---------- píldora «Mi tarjeta» ---------- */
  const pill = mk('a', 'position:fixed;left:14px;bottom:max(14px,env(safe-area-inset-bottom));z-index:55;display:flex;align-items:center;gap:8px;min-height:44px;padding:0 16px;border-radius:99px;background:#111;color:#fff;font:700 13.5px system-ui,sans-serif;cursor:pointer;box-shadow:0 8px 24px -8px rgba(0,0,0,.5);text-decoration:none');
  pill.setAttribute('role', 'button'); pill.tabIndex = 0;
  pill.appendChild(mk('span', null, '★')); pill.appendChild(mk('span', null, 'Mi tarjeta de ' + (info.program_name || 'puntos').toLowerCase()));
  document.body.appendChild(pill);
  const go = () => { if (getTok()) location.href = '/t/' + encodeURIComponent(slug); else openDialog(); };
  pill.onclick = (e) => { e.preventDefault(); go(); };
  pill.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };

  /* ---------- bloque de identidad dentro del carrito ---------- */
  const cartView = document.getElementById('cartView');
  const block = mk('div', 'margin:6px 0 12px;padding:12px 14px;border-radius:14px;background:#f4f4f2;color:#111;font:500 13px/1.45 system-ui,sans-serif;display:grid;gap:8px'); block.id = 'kIdent';
  if (cartView) { const totalRow = cartView.querySelector('.ctotal'); totalRow ? totalRow.after(block) : cartView.prepend(block); }
  function paintBlock() {
    block.textContent = '';
    const fields = ['clienteNombre', 'clienteTelefono'].map((id) => { const f = document.getElementById(id); return f && f.closest('.cfield'); }).filter(Boolean);
    const prog = (info.program_name || 'puntos').toLowerCase();
    if (getTok()) {
      block.appendChild(mk('div', 'font-weight:800', '✓ Pides con tu tarjeta de ' + prog));
      block.appendChild(mk('div', 'color:#444', 'Se usa tu nombre y teléfono verificados. Los puntos se suman cuando el restaurante confirme tu pago.'));
      fields.forEach((f) => { f.style.display = 'none'; });
    } else {
      block.appendChild(mk('div', 'font-weight:800', info.require_identity ? 'Identifícate para pedir' : 'Suma puntos con este pedido'));
      block.appendChild(mk('div', 'color:#444', info.require_identity ? 'Este restaurante pide verificar tu teléfono antes de pedir.' : 'Verifica tu teléfono y tu pedido suma a tu tarjeta. También puedes pedir sin tarjeta.'));
      const b = mk('button', 'min-height:42px;border:0;border-radius:10px;background:#111;color:#fff;font:700 13.5px system-ui,sans-serif;cursor:pointer', 'Identificarme con mi teléfono'); b.type = 'button'; b.onclick = openDialog; block.appendChild(b);
      fields.forEach((f) => { f.style.display = ''; });
    }
  }
  paintBlock();

  function logout(silent) {
    const t = getTok(); setTok(null);
    if (t) sb.rpc('customer_logout', { p_session: t }).then(() => {}, () => {});
    paintBlock(); if (!silent) location.reload();
  }

  async function otp(body) {
    try {
      const r = await fetch(sb.supabaseUrl + '/functions/v1/customer-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: sb.supabaseKey, Authorization: 'Bearer ' + sb.supabaseKey }, body: JSON.stringify(Object.assign({ slug }, body)),
      });
      return await r.json();
    } catch { return { error: 'send_failed' }; }
  }

  /* ---------- diálogo: datos → código ---------- */
  function openDialog() {
    if (document.getElementById('kLoyDlg')) return;
    const bg = mk('div', 'position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.55);display:grid;place-items:end center;padding:0;overflow-y:auto'); bg.id = 'kLoyDlg';
    const box = mk('div', 'width:100%;max-width:440px;background:#fff;color:#111;border-radius:22px 22px 0 0;padding:22px 20px max(22px,env(safe-area-inset-bottom));font:500 14px/1.5 system-ui,sans-serif;display:grid;gap:12px;max-height:94vh;overflow-y:auto;box-sizing:border-box');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Identifícate con tu teléfono');
    const close = () => { bg.remove(); document.removeEventListener('keydown', onEsc); };
    const onEsc = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onEsc); bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
    const inp = (ph, type, auto, mode) => { const i = mk('input', 'min-height:46px;border:1px solid #ccc;border-radius:12px;padding:0 14px;font:inherit;width:100%;box-sizing:border-box'); i.placeholder = ph; i.type = type; i.autocomplete = auto; if (mode) i.inputMode = mode; i.setAttribute('aria-label', ph); return i; };
    const btn = (txt, dark) => { const b = mk('button', 'min-height:48px;border:0;border-radius:12px;font:700 15px system-ui,sans-serif;cursor:pointer;' + (dark ? 'background:#111;color:#fff' : 'background:none;color:#555;min-height:44px;font-weight:600;font-size:14px'), txt); b.type = 'button'; return b; };
    const err = mk('div', 'color:#c0152a;font-size:12.5px;min-height:16px'); err.setAttribute('role', 'alert');
    bg.appendChild(box); document.body.appendChild(bg);
    const st = { name: '', phone: '', channel: 'whatsapp', consent: false, marketing: false };

    function stepData() {
      box.textContent = ''; err.textContent = '';
      box.appendChild(mk('div', 'font-weight:800;font-size:18px', 'Tu tarjeta de ' + (info.program_name || 'puntos')));
      box.appendChild(mk('div', 'color:#555;font-size:13px', info.restaurant + ': suma puntos con cada pedido y cámbialos por premios.' + (info.welcome_points ? ' Te regalamos ' + info.welcome_points + ' puntos al registrarte.' : '')));
      const name = inp('Tu nombre', 'text', 'name'); name.maxLength = 80; name.value = st.name;
      const phone = inp('Tu celular (ej. 300 123 4567)', 'tel', 'tel', 'tel'); phone.value = st.phone;
      const ch = mk('div', 'display:flex;gap:8px');
      [['whatsapp', 'WhatsApp'], ['sms', 'SMS']].forEach(([v, l]) => {
        const on = st.channel === v; const b = mk('button', 'flex:1;min-height:42px;border-radius:10px;font:700 13.5px system-ui,sans-serif;cursor:pointer;border:2px solid ' + (on ? '#111' : '#ddd') + ';background:' + (on ? '#111' : '#fff') + ';color:' + (on ? '#fff' : '#111'), 'Recibir por ' + l);
        b.type = 'button'; b.onclick = () => { st.name = name.value; st.phone = phone.value; st.channel = v; stepData(); }; ch.appendChild(b);
      });
      box.append(name, phone, ch);
      box.appendChild(mk('div', 'background:#f4f4f2;border-radius:12px;padding:12px 14px;font-size:12.5px;color:#333', 'Tu número de teléfono nos permite identificarte en tus próximas compras, guardar tus puntos y mantener tu tarjeta digital de fidelización. Así no tendrás que empezar desde cero cada vez que visites este restaurante. Tus datos se utilizarán para gestionar tus pedidos y tu programa de fidelización.'));
      const lab = (key) => { const l = mk('label', 'display:flex;gap:8px;align-items:flex-start;font-size:12.5px;color:#444'); const cb = mk('input'); cb.type = 'checkbox'; cb.style.marginTop = '3px'; cb.checked = st[key]; cb.onchange = () => { st[key] = cb.checked; }; const sp = mk('span'); l.append(cb, sp); return [l, sp]; };
      const [l1, s1] = lab('consent'); s1.appendChild(document.createTextNode('Acepto que ' + info.restaurant + ' use mi nombre y teléfono para gestionar mis pedidos y mi tarjeta, según la '));
      const pol = mk('a', 'color:#111;font-weight:700', 'política de privacidad'); pol.href = '/privacidad.html'; pol.target = '_blank'; pol.rel = 'noopener'; s1.appendChild(pol);
      s1.appendChild(document.createTextNode('. Puedo ver mis datos y pedir que los borren cuando quiera.'));
      const [l2, s2] = lab('marketing'); s2.textContent = '(Opcional) Quiero recibir promociones de ' + info.restaurant + '. Es independiente de lo anterior y puedo retirarlo cuando quiera.';
      box.append(l1, l2);
      const send = btn('Enviar código', true), cancel = btn('Ahora no', false); cancel.onclick = close;
      send.onclick = async () => {
        st.name = name.value.trim(); st.phone = phone.value; err.textContent = '';
        const digits = st.phone.replace(/\D/g, '');
        if (!st.name) { err.textContent = ERR.name_required; return; }
        if (digits.length < 8 || digits.length > 15) { err.textContent = ERR.invalid_phone; return; }
        if (!st.consent) { err.textContent = ERR.consent_required; return; }
        send.disabled = true; send.textContent = 'Enviando…';
        const r = await otp({ action: 'send', phone: st.phone, channel: st.channel });
        if (!r || !r.ok) { err.textContent = ERR[r && r.error] || ERR.send_failed; send.disabled = false; send.textContent = 'Enviar código'; return; }
        stepCode(r.masked || '');
      };
      box.append(err, send, cancel);
    }

    function stepCode(masked) {
      box.textContent = ''; err.textContent = '';
      box.appendChild(mk('div', 'font-weight:800;font-size:18px', 'Escribe tu código'));
      box.appendChild(mk('div', 'color:#555;font-size:13px', 'Te enviamos un código de 6 dígitos por ' + (st.channel === 'whatsapp' ? 'WhatsApp' : 'SMS') + (masked ? ' al ' + masked : '') + '. Vence en 10 minutos.'));
      const code = inp('000000', 'text', 'one-time-code', 'numeric'); code.maxLength = 6; code.style.cssText += ';letter-spacing:.4em;text-align:center;font-size:22px;font-weight:800';
      code.oninput = () => { code.value = code.value.replace(/\D/g, '').slice(0, 6); };
      const ok = btn('Verificar', true), back = btn('Cambiar número', false), resend = btn('Reenviar código', false); resend.style.minHeight = '36px';
      let wait = 45; resend.disabled = true; resend.textContent = 'Reenviar código (45 s)';
      const tick = setInterval(() => { if (!document.body.contains(bg)) return clearInterval(tick); wait--; resend.disabled = wait > 0; resend.textContent = wait > 0 ? 'Reenviar código (' + wait + ' s)' : 'Reenviar código'; if (wait <= 0) clearInterval(tick); }, 1000);
      resend.onclick = async () => { resend.disabled = true; const r = await otp({ action: 'send', phone: st.phone, channel: st.channel }); err.textContent = r && r.ok ? 'Código reenviado.' : (ERR[r && r.error] || ERR.send_failed); };
      back.onclick = stepData;
      ok.onclick = async () => {
        err.textContent = ''; if (!/^\d{6}$/.test(code.value)) { err.textContent = 'Son 6 dígitos.'; return; }
        ok.disabled = true; ok.textContent = 'Verificando…';
        const r = await otp({ action: 'verify', phone: st.phone, code: code.value, name: st.name, consent: st.consent, marketing: st.marketing });
        if (!r || !r.ok || !r.token) {
          err.textContent = (ERR[r && (r.reason || r.error)] || 'No pudimos verificar el código.') + (r && r.reason === 'invalid_code' && r.attempts_left != null ? ' Te quedan ' + r.attempts_left + ' intentos.' : '');
          ok.disabled = false; ok.textContent = 'Verificar'; return;
        }
        setTok(r.token); close(); paintBlock();
        if (!document.getElementById('sheetBg')?.classList.contains('show')) location.href = '/t/' + encodeURIComponent(slug);
      };
      box.append(code, err, ok, resend, back);
      setTimeout(() => code.focus(), 50);
    }
    stepData();
  }
})();
