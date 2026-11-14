/* KARTTA — tarjeta de puntos del cliente en el menú público (solo si el restaurante activó el programa).
 * SIN códigos por SMS ni WhatsApp: el cliente se registra con su nombre y el teléfono con el que pide.
 * Tras la compra recibe su ticket y el enlace de su tarjeta. El enlace lleva una sesión aleatoria (en la base solo queda su hash).
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
  const fmt = (n) => Number(n || 0).toLocaleString('es-CO');
  const prog = (info.program_name || 'puntos').toLowerCase();
  const phoneOk = (v) => { const d = String(v || '').replace(/\D/g, ''); return (d.length === 10 && d[0] === '3') || (d.length >= 8 && d.length <= 15); };
  const cardLink = (tok) => location.origin + '/t/' + encodeURIComponent(slug) + (tok ? '?k=' + encodeURIComponent(tok) : '');
  const ERR = {
    invalid_phone: 'Revisa tu número de WhatsApp.', name_required: 'Escribe tu nombre.', rate_limited: 'Hay muchos registros ahora mismo. Intenta en un minuto.',
    disabled: 'El programa de puntos está desactivado.', invalid_customer_session: 'Tu tarjeta guardada en este celular venció. Escribe tu nombre y número para recuperarla.',
    order_expired: 'Este pedido ya es muy antiguo para sumarlo a una tarjeta.',
  };
  const errText = (e) => { const m = String((e && e.message) || ''); for (const k in ERR) if (m.includes(k)) return ERR[k]; return 'No pudimos crear tu tarjeta. Intenta de nuevo.'; };

  let want = true;   // casilla «Sumar puntos» del carrito
  const api = {
    required: !!info.require_identity, token: getTok, open: () => openDialog(), logout: (silent) => logout(silent), refresh: () => paintBlock(),
    phoneOk, wantsCard: () => !getTok() && want, afterOrder,
  };
  window.KARTTA_CUSTOMER = api;

  /* ---------- píldora «Mi tarjeta» ---------- */
  const pill = mk('a', 'position:fixed;left:14px;bottom:max(14px,env(safe-area-inset-bottom));z-index:55;display:flex;align-items:center;gap:8px;min-height:44px;padding:0 16px;border-radius:99px;background:#111;color:#fff;font:700 13.5px system-ui,sans-serif;cursor:pointer;text-decoration:none;box-shadow:0 6px 18px -6px rgba(0,0,0,.45)');
  pill.setAttribute('role', 'button'); pill.tabIndex = 0;
  pill.appendChild(mk('span', null, '★')); pill.appendChild(mk('span', null, 'Mi tarjeta de ' + prog));
  document.body.appendChild(pill);
  const go = () => { if (getTok()) location.href = '/t/' + encodeURIComponent(slug); else openDialog(); };
  pill.onclick = (e) => { e.preventDefault(); go(); };
  pill.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };

  /* ---------- bloque dentro del carrito ---------- */
  const cartView = document.getElementById('cartView');
  const BOX = 'margin:6px 0 12px;padding:12px 14px;border-radius:14px;background:var(--surface,#f4f4f2);color:var(--tx,#111);font:500 13px/1.45 system-ui,sans-serif;display:grid;gap:8px;border:1px solid var(--border,transparent)';
  const block = mk('div', BOX); block.id = 'kIdent';
  if (cartView) { const totalRow = cartView.querySelector('.ctotal'); totalRow ? totalRow.after(block) : cartView.prepend(block); }
  function setPhoneLabel(txt) { const f = document.getElementById('clienteTelefono'); const l = f && f.closest('.cfield') && f.closest('.cfield').querySelector('label'); if (l) l.textContent = txt; }
  function paintBlock() {
    block.textContent = '';
    const fields = ['clienteNombre', 'clienteTelefono'].map((id) => { const f = document.getElementById(id); return f && f.closest('.cfield'); }).filter(Boolean);
    if (getTok()) {
      block.appendChild(mk('div', 'font-weight:800', '✓ Pides con tu tarjeta de ' + prog));
      block.appendChild(mk('div', 'opacity:.8', 'Se usa tu nombre y teléfono ya registrados. Los puntos se suman cuando el restaurante confirme tu pago.'));
      fields.forEach((f) => { f.style.display = 'none'; });
    } else {
      const lab = mk('label', 'display:flex;gap:10px;align-items:flex-start;cursor:pointer');
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = want; cb.style.marginTop = '1px'; cb.onchange = () => { want = cb.checked; setPhoneLabel(labelPhone()); };
      const tx = mk('span', null); tx.appendChild(mk('b', null, 'Sumar puntos con este pedido'));
      tx.appendChild(mk('span', 'display:block;opacity:.8;margin-top:2px', 'Escribe tu nombre y tu número de WhatsApp aquí abajo: tu pedido queda guardado en tu tarjeta de ' + prog + ' y al final te mostramos el enlace para verla.' + (info.welcome_points > 0 ? ' Bono de bienvenida: ' + fmt(info.welcome_points) + ' puntos.' : '')));
      lab.append(cb, tx); block.appendChild(lab);
      fields.forEach((f) => { f.style.display = ''; }); setPhoneLabel(labelPhone());
    }
  }
  const labelPhone = () => (want || info.require_identity) ? 'Tu WhatsApp (para tu tarjeta de puntos)' : 'Teléfono (opcional)';
  paintBlock();

  function logout(silent) { setTok(null); paintBlock(); if (!silent) location.reload(); }

  /* ---------- tras el pedido: ticket + enlace de la tarjeta ---------- */
  async function afterOrder(order, name, phone) {
    const host = document.getElementById('successView'); if (!host) return;
    const old = document.getElementById('kTicket'); if (old) old.remove();
    const t = mk('div', 'margin:14px 0;padding:14px 16px;border-radius:14px;background:var(--surface,#f4f4f2);color:var(--tx,#111);border:1px dashed var(--border,#999);text-align:left;font:500 13px/1.5 system-ui,sans-serif;display:grid;gap:6px'); t.id = 'kTicket';
    const row = (a, b, bold) => { const r = mk('div', 'display:flex;justify-content:space-between;gap:10px' + (bold ? ';font-weight:800' : '')); r.append(mk('span', 'opacity:.75', a), mk('span', null, b)); t.appendChild(r); };
    t.appendChild(mk('div', 'font-weight:800;letter-spacing:.06em;font-size:12px;opacity:.7', 'TICKET'));
    row('Pedido', '#' + order.code); if (order.table) row('Mesa', String(order.table)); row('Total', '$' + fmt(order.total), true);
    row('Fecha', new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' }));
    const ref = document.getElementById('payErr'); ref ? ref.before(t) : host.querySelector('.csuccess').appendChild(t);
    if (!order.id) return;
    const wantNow = !!getTok() || (want && phoneOk(phone));
    if (!wantNow) return;
    const sec = mk('div', 'border-top:1px dashed var(--border,#999);margin-top:6px;padding-top:10px;display:grid;gap:8px'); t.appendChild(sec);
    sec.appendChild(mk('div', 'opacity:.8', 'Guardando tu tarjeta…'));
    let res, error;
    try { const r = await sb.rpc('loyalty_register', { p_slug: slug, p_name: name || null, p_phone: phone || null, p_order: order.id, p_session: getTok() }); res = r.data; error = r.error; } catch (e) { error = e; }
    sec.textContent = '';
    if (error || !res) {
      if (error && String(error.message || '').includes('invalid_customer_session')) setTok(null);
      sec.appendChild(mk('div', 'opacity:.85', errText(error) + ' Tu pedido sí quedó enviado.')); return;
    }
    if (res.token) setTok(res.token);
    const tok = getTok();
    sec.appendChild(mk('div', 'font-weight:800', '★ Tu tarjeta de ' + prog));
    if (res.status === 'exists' && !tok) {
      sec.appendChild(mk('div', 'opacity:.85', 'Este número ya tenía tarjeta en este restaurante: tu pedido se sumará a ella cuando el restaurante confirme el pago. Para verla, abre el enlace que guardaste en tu primera compra.'));
      return;
    }
    const rate = Number(info.points_per_1000 || 0), est = rate > 0 && Number(order.total) >= Number(info.min_order_total || 0) ? Math.floor(Number(order.total) * rate / 1000) : 0;
    sec.appendChild(mk('div', 'opacity:.85', 'Hola ' + (res.name || '') + '. Tienes ' + fmt(res.balance) + ' puntos' + (est > 0 ? ' y con este pedido sumarás ' + fmt(est) + ' más cuando el restaurante confirme el pago.' : '.')));
    const open = mk('a', 'display:block;text-align:center;text-decoration:none;min-height:44px;line-height:44px;border-radius:12px;background:var(--red,#FF3145);color:#fff;font-weight:800', 'Abrir mi tarjeta'); open.href = cardLink(tok);
    const copy = mk('button', 'min-height:40px;border-radius:12px;border:1px solid var(--border,#999);background:transparent;color:inherit;font:700 13px system-ui,sans-serif;cursor:pointer', 'Copiar enlace de mi tarjeta'); copy.type = 'button';
    copy.onclick = async () => { try { await navigator.clipboard.writeText(cardLink(tok)); copy.textContent = '✓ Enlace copiado'; } catch { copy.textContent = 'Mantén presionado “Abrir mi tarjeta” para copiar'; } };
    sec.append(open, copy, mk('div', 'font-size:11.5px;opacity:.7', 'Guarda este enlace: es tu tarjeta. Quien lo tenga puede verla, así que no lo compartas.'));
    paintBlock();
  }

  /* ---------- «Mi tarjeta» sin pedido: registro con nombre + teléfono ---------- */
  function openDialog() {
    const bg = mk('div', 'position:fixed;inset:0;z-index:400;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center;padding:0');
    const box = mk('div', 'width:100%;max-width:480px;background:var(--bg,#fff);color:var(--tx,#111);border-radius:22px 22px 0 0;padding:22px 20px calc(22px + env(safe-area-inset-bottom));display:grid;gap:12px;font:500 14px/1.45 system-ui,sans-serif;max-height:90vh;overflow:auto');
    bg.appendChild(box); document.body.appendChild(bg);
    const close = () => bg.remove(); bg.onclick = (e) => { if (e.target === bg) close(); };
    const INP = 'width:100%;box-sizing:border-box;min-height:46px;border-radius:12px;border:1px solid var(--border,#ccc);background:var(--surface,#f4f4f2);color:var(--tx,#111);padding:0 14px;font:inherit;font-size:15px';
    box.appendChild(mk('div', 'font-weight:800;font-size:18px', 'Crea tu tarjeta de ' + prog));
    box.appendChild(mk('div', 'opacity:.8', 'Solo tu nombre y tu número de WhatsApp. Sin códigos ni contraseñas.' + (info.welcome_points > 0 ? ' Te regalamos ' + fmt(info.welcome_points) + ' puntos de bienvenida.' : '')));
    const name = mk('input', INP); name.placeholder = '¿Cómo te llamas?'; name.maxLength = 80; name.autocomplete = 'name';
    const ph = mk('input', INP); ph.type = 'tel'; ph.placeholder = 'Tu WhatsApp'; ph.maxLength = 20; ph.autocomplete = 'tel';
    const err = mk('div', 'color:#d33;font-size:13px;min-height:18px');
    const ok = mk('button', 'min-height:48px;border:0;border-radius:12px;background:var(--red,#FF3145);color:#fff;font:800 15px system-ui,sans-serif;cursor:pointer', 'Crear mi tarjeta'); ok.type = 'button';
    const cancel = mk('button', 'min-height:40px;border:0;background:transparent;color:inherit;opacity:.7;font:600 13.5px system-ui,sans-serif;cursor:pointer', 'Ahora no'); cancel.type = 'button'; cancel.onclick = close;
    box.append(name, ph, mk('div', 'font-size:12px;opacity:.7', 'Guardamos tu nombre y teléfono solo para tu tarjeta en este restaurante.'), err, ok, cancel);
    ok.onclick = async () => {
      err.textContent = '';
      if (!name.value.trim()) { err.textContent = ERR.name_required; return; } if (!phoneOk(ph.value)) { err.textContent = ERR.invalid_phone; return; }
      ok.disabled = true; ok.textContent = 'Creando…';
      let r; try { r = await sb.rpc('loyalty_register', { p_slug: slug, p_name: name.value.trim(), p_phone: ph.value.trim(), p_order: null, p_session: null }); } catch (e) { r = { error: e }; }
      ok.disabled = false; ok.textContent = 'Crear mi tarjeta';
      if (r.error || !r.data) { err.textContent = errText(r.error); return; }
      if (r.data.token) { setTok(r.data.token); close(); paintBlock(); location.href = cardLink(r.data.token); return; }
      err.textContent = 'Este número ya tiene tarjeta en este restaurante. Ábrela con el enlace que guardaste en tu primera compra.';
    };
    setTimeout(() => name.focus(), 50);
  }
})();
