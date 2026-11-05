/**
 * KARTTA — Panel: «Botón de WhatsApp» (botón flotante del menú público).
 * Guarda con la RPC set_whatsapp_button (valida indicativo y número en el servidor y exige owner/admin).
 * La validación de aquí es solo para dar respuesta inmediata; es la MISMA regla que private.wa_national en SQL.
 */
(function () {
  'use strict';
  var M = window.KARTTA_MODS, $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return M.esc(s); };

  // [indicativo, país, bandera, largo mínimo, largo máximo]  — igual que private.wa_rules
  var COUNTRIES = [
    ['57', 'Colombia', '🇨🇴', 10, 10], ['52', 'México', '🇲🇽', 10, 10], ['1', 'EE. UU. / Canadá', '🇺🇸', 10, 10],
    ['34', 'España', '🇪🇸', 9, 9], ['51', 'Perú', '🇵🇪', 9, 9], ['56', 'Chile', '🇨🇱', 9, 9], ['593', 'Ecuador', '🇪🇨', 9, 9],
    ['58', 'Venezuela', '🇻🇪', 10, 10], ['507', 'Panamá', '🇵🇦', 8, 8], ['506', 'Costa Rica', '🇨🇷', 8, 8], ['502', 'Guatemala', '🇬🇹', 8, 8],
    ['598', 'Uruguay', '🇺🇾', 8, 8], ['591', 'Bolivia', '🇧🇴', 8, 8], ['595', 'Paraguay', '🇵🇾', 9, 9], ['55', 'Brasil', '🇧🇷', 10, 11],
    ['44', 'Reino Unido', '🇬🇧', 10, 10], ['351', 'Portugal', '🇵🇹', 9, 9]
  ];
  var rule = function (cc) { for (var i = 0; i < COUNTRIES.length; i++) if (COUNTRIES[i][0] === cc) return COUNTRIES[i]; return null; };

  /** Número nacional (solo dígitos) o null. No duplica el indicativo. */
  function national(cc, raw) {
    var r = rule(cc); if (!r) return null;
    var d = String(raw == null ? '' : raw).replace(/[^0-9]/g, '').replace(/^0+/, '');
    if (d.length > r[4] && d.indexOf(cc) === 0 && d.length - cc.length >= r[3] && d.length - cc.length <= r[4]) d = d.slice(cc.length);
    if (d.length < r[3] || d.length > r[4]) return null;
    if (cc === '57' && d.charAt(0) !== '3') return null;
    return d;
  }
  var ERR = {
    invalid_whatsapp_number: 'Ese número no es válido para el país elegido.',
    number_required: 'Escribe tu número de WhatsApp para activar el botón.',
    invalid_country_code: 'Ese indicativo no está disponible.',
    forbidden: 'Solo el propietario o un administrador puede cambiar esto.',
    not_authenticated: 'Tu sesión expiró. Vuelve a iniciar sesión.'
  };
  var st = { loaded: false, missing: false, enabled: false, cc: '57', number: '' };

  function hint(cc, raw, enabled) {
    var t = String(raw || '').trim();
    if (!t) return enabled ? { ok: false, msg: 'Escribe tu número de WhatsApp para activar el botón.' } : { ok: true, msg: 'Sin número: el botón no se mostrará.' };
    var n = national(cc, t), r = rule(cc);
    if (!n) return { ok: false, msg: r ? 'Número no válido para ' + r[1] + (cc === '57' ? ': debe ser un celular de 10 dígitos que empiece por 3.' : ': deben ser ' + (r[3] === r[4] ? r[3] : r[3] + ' u ' + r[4]) + ' dígitos.') : 'Elige un indicativo.' };
    return { ok: true, msg: 'Tus clientes abrirán: https://wa.me/' + cc + n, link: cc + n };
  }

  async function load() {
    var C = M.ctx;
    var q = await C.sb.from('restaurants').select('whatsapp,whatsapp_enabled,whatsapp_country_code').eq('id', C.rid).maybeSingle();
    if (q.error) { st.missing = true; st.loaded = true; return; }
    var d = q.data || {};
    st.missing = false; st.enabled = !!d.whatsapp_enabled; st.cc = rule(d.whatsapp_country_code) ? d.whatsapp_country_code : '57';
    st.number = national(st.cc, d.whatsapp) || String(d.whatsapp || '').trim();   // lo ya guardado se muestra limpio si es válido
    st.loaded = true;
  }

  function render() {
    var host = $('modWhatsapp'); if (!host) return;
    var head = '<div class="vhead"><h2>Botón de WhatsApp</h2><p>Permite que tus clientes se comuniquen directamente contigo desde tu menú digital mediante WhatsApp.</p></div>';
    if (!st.loaded) { host.innerHTML = head + '<div class="card"><p class="note">Cargando…</p></div>'; return; }
    if (st.missing) { host.innerHTML = head + '<div class="card"><p class="note warn">Esta función todavía no está disponible en tu cuenta. Intenta de nuevo en unos minutos.</p></div>'; return; }
    var opts = COUNTRIES.map(function (c) { return '<option value="' + c[0] + '"' + (c[0] === st.cc ? ' selected' : '') + '>' + c[2] + ' ' + esc(c[1]) + ' (+' + c[0] + ')</option>'; }).join('');
    host.innerHTML = head +
      '<div class="wa-grid"><div class="card wa-form">' +
        '<div class="row between"><div><h3 style="margin:0">Mostrar el botón en mi menú</h3><p class="sub" style="margin:4px 0 0">Aparece en la esquina inferior derecha de tu menú público.</p></div>' +
        '<label class="cc-open"><input type="checkbox" id="waOn" role="switch" aria-label="Activar el botón de WhatsApp"' + (st.enabled ? ' checked' : '') + '><span id="waOnTxt">' + (st.enabled ? 'Activado' : 'Desactivado') + '</span></label></div>' +
        '<div class="field" style="margin-top:18px"><label for="waNum">Número de WhatsApp del restaurante</label>' +
        '<div class="wa-phone"><select id="waCc" aria-label="Indicativo del país">' + opts + '</select>' +
        '<input type="tel" id="waNum" inputmode="tel" autocomplete="tel-national" maxlength="24" placeholder="300 123 4567" value="' + esc(st.number) + '" aria-describedby="waHint"></div>' +
        '<p class="note" id="waHint" style="margin:8px 0 0;word-break:break-all" role="status"></p></div>' +
        '<button class="btn btn-accent" id="waSave" type="button" style="margin-top:6px">Guardar cambios</button>' +
        '<p class="note" style="margin:14px 0 0">Es el mismo número de WhatsApp de <a href="#configuracion" data-goto="configuracion" style="color:var(--accent);font-weight:700">Configuración</a>. Si lo cambias aquí, se actualiza allá también.</p>' +
      '</div>' +
      '<div class="card wa-prev"><h3 style="margin:0 0 4px">Así se verá</h3><p class="sub" style="margin:0 0 14px">Un círculo verde con el icono de WhatsApp, siempre visible mientras tu cliente navega.</p>' +
        '<div class="wa-mock" aria-hidden="true"><div class="wa-mock-l"></div><div class="wa-mock-l s"></div><div class="wa-mock-l"></div><div class="wa-mock-l s"></div><span class="wa-mock-fab" id="waMockFab"><svg viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg></span></div>' +
        '<p class="note" id="waState" style="margin:12px 0 0"></p></div></div>';
    refresh();
  }

  function refresh() {
    var on = $('waOn'), cc = $('waCc'), num = $('waNum'); if (!on || !cc || !num) return;
    var h = hint(cc.value, num.value, on.checked);
    var el = $('waHint'); el.textContent = h.msg; el.className = 'note' + (h.ok ? '' : ' warn');
    $('waOnTxt').textContent = on.checked ? 'Activado' : 'Desactivado';
    $('waSave').disabled = !h.ok;
    var live = on.checked && !!h.link && h.ok;
    $('waMockFab').style.display = live ? 'flex' : 'none';
    $('waState').textContent = live ? 'Se mostrará en tu menú público cuando guardes.' : (on.checked ? 'Todavía no se mostrará: falta un número válido.' : 'Desactivado: tu menú no mostrará el botón.');
  }

  async function save() {
    var C = M.ctx, on = $('waOn').checked, cc = $('waCc').value, raw = $('waNum').value.trim(), btn = $('waSave');
    var h = hint(cc, raw, on); if (!h.ok) { C.toast(h.msg); return; }
    btn.disabled = true;
    try {
      var r = await C.sb.rpc('set_whatsapp_button', { p_restaurant_id: C.rid, p_enabled: on, p_country_code: cc, p_number: raw });
      if (r.error) throw r.error;
      var d = r.data || {};
      st.enabled = !!d.enabled; st.cc = d.country_code || cc; st.number = d.number || '';
      try { C.negocio.whatsapp = st.number; } catch (e) { /* solo reflejo local */ }
      var cfg = $('cfgWpp'); if (cfg) cfg.value = st.number;
      $('waNum').value = st.number;
      C.toast(st.enabled ? 'Botón de WhatsApp activado.' : 'Cambios guardados. El botón está desactivado.');
    } catch (e) {
      console.error(e);
      var m = String((e && e.message) || ''), k = Object.keys(ERR).filter(function (x) { return m.indexOf(x) >= 0; })[0];
      C.toast(k ? ERR[k] : 'No se pudo guardar. Revisa tu conexión e intenta de nuevo.');
    } finally { refresh(); }
  }

  document.addEventListener('input', function (e) { if (['waOn', 'waCc', 'waNum'].indexOf(e.target.id) >= 0) refresh(); });
  document.addEventListener('change', function (e) { if (e.target.id === 'waCc' || e.target.id === 'waOn') refresh(); });
  document.addEventListener('click', function (e) { if (e.target.closest('#waSave')) save(); });

  M.views.whatsapp = async function () { st.loaded = false; render(); try { await load(); } catch (e) { console.error(e); st.missing = true; st.loaded = true; } render(); };
})();
