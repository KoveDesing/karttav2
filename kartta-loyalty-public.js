/* KARTTA — botón «Mi tarjeta de puntos» en el menú público (solo si el restaurante activó el programa). */
import { sb } from "/supabase-init.js";
(async function () {
  const params = new URLSearchParams(location.search);
  if (params.get('preview') === '1') return;                       // no en la vista previa del editor
  const m = location.pathname.match(/^\/m\/([^/?#]+)/);
  const slug = (params.get('r') || (m && decodeURIComponent(m[1])) || '').trim().toLowerCase(); if (!slug) return;
  let info; try { const r = await sb.rpc('get_loyalty_public', { p_slug: slug }); info = r.data; if (r.error || !info || !info.enabled) return; } catch { return; }
  const KEY = 'kartta_card_' + slug; let saved = null; try { saved = localStorage.getItem(KEY); } catch {}
  const mk = (t, css, txt) => { const e = document.createElement(t); if (css) e.style.cssText = css; if (txt != null) e.textContent = txt; return e; };
  const pill = mk('a', 'position:fixed;left:14px;bottom:max(14px,env(safe-area-inset-bottom));z-index:55;display:flex;align-items:center;gap:8px;min-height:44px;padding:0 16px;border-radius:99px;background:#111;color:#fff;font:700 13.5px/1 system-ui,sans-serif;text-decoration:none;box-shadow:0 8px 24px -8px rgba(0,0,0,.5);cursor:pointer;border:0', '⭐ ' + (saved ? 'Mi tarjeta' : 'Mi tarjeta de puntos'));
  pill.setAttribute('role', 'button'); pill.tabIndex = 0;
  if (saved && /^[0-9a-f-]{36}$/i.test(saved)) { pill.href = '/t/' + saved; document.body.appendChild(pill); return; }
  document.body.appendChild(pill);
  const open = () => {
    if (document.getElementById('kLoyDlg')) return;
    const bg = mk('div', 'position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.55);display:grid;place-items:end center;padding:0'); bg.id = 'kLoyDlg';
    const box = mk('div', 'width:100%;max-width:440px;background:#fff;color:#111;border-radius:22px 22px 0 0;padding:22px 20px max(22px,env(safe-area-inset-bottom));font:500 14px/1.5 system-ui,sans-serif;display:grid;gap:12px');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Crear mi tarjeta de puntos');
    box.appendChild(mk('div', 'font-weight:800;font-size:18px', 'Crea tu tarjeta de ' + (info.program_name || 'puntos')));
    box.appendChild(mk('div', 'color:#555;font-size:13px', info.restaurant + ': suma puntos con cada pedido y cámbialos por premios.' + (info.welcome_points ? ' Te regalamos ' + info.welcome_points + ' puntos al registrarte.' : '')));
    const inp = (ph, type, auto) => { const i = mk('input', 'min-height:46px;border:1px solid #ccc;border-radius:12px;padding:0 14px;font:inherit;width:100%;box-sizing:border-box'); i.placeholder = ph; i.type = type; i.autocomplete = auto; return i; };
    const name = inp('Tu nombre', 'text', 'name'), phone = inp('Tu WhatsApp (ej. 300 123 4567)', 'tel', 'tel'); phone.inputMode = 'tel'; name.maxLength = 80;
    const lab = mk('label', 'display:flex;gap:8px;align-items:flex-start;font-size:12.5px;color:#444'); const cb = mk('input'); cb.type = 'checkbox'; cb.style.marginTop = '3px';
    lab.append(cb, document.createTextNode('Acepto participar en el programa de puntos y que ' + info.restaurant + ' use mi nombre y WhatsApp para gestionar mi tarjeta. Puedo pedir que me borren cuando quiera.'));
    const err = mk('div', 'color:#c0152a;font-size:12.5px;min-height:16px'); err.setAttribute('role', 'alert');
    const go = mk('button', 'min-height:48px;border:0;border-radius:12px;background:#111;color:#fff;font:700 15px system-ui,sans-serif;cursor:pointer', 'Crear mi tarjeta');
    const cancel = mk('button', 'min-height:44px;border:0;background:none;color:#555;font:600 14px system-ui,sans-serif;cursor:pointer', 'Ahora no');
    cancel.onclick = () => bg.remove(); bg.addEventListener('click', (e) => { if (e.target === bg) bg.remove(); });
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { bg.remove(); document.removeEventListener('keydown', esc); } });
    go.onclick = async () => {
      err.textContent = ''; const digits = phone.value.replace(/\D/g, '');
      if (digits.length < 8 || digits.length > 15) { err.textContent = 'Revisa tu número de WhatsApp.'; return; }
      if (!cb.checked) { err.textContent = 'Necesitamos que aceptes para crear tu tarjeta.'; return; }
      go.disabled = true; go.textContent = 'Creando…';
      const { data, error } = await sb.rpc('loyalty_join', { p_slug: slug, p_name: name.value, p_phone: phone.value, p_consent: true });
      go.disabled = false; go.textContent = 'Crear mi tarjeta';
      if (error) { err.textContent = String(error.message).includes('rate_limited') ? 'Hay muchos registros ahora, intenta en un minuto.' : String(error.message).includes('invalid_phone') ? 'Revisa tu número de WhatsApp.' : 'No pudimos crear tu tarjeta. Intenta de nuevo.'; return; }
      if (data.status === 'exists') { err.textContent = 'Ese número ya tiene tarjeta. Pídele a ' + info.restaurant + ' que te reenvíe tu enlace por WhatsApp.'; return; }
      try { localStorage.setItem(KEY, data.token); } catch {}
      location.href = '/t/' + data.token;
    };
    box.append(name, phone, lab, err, go, cancel); bg.appendChild(box); document.body.appendChild(bg); name.focus();
  };
  pill.addEventListener('click', open); pill.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
})();
