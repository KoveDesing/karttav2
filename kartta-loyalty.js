/**
 * KARTTA — Fidelización (panel). La lectura va por RLS (solo tu restaurante); TODA escritura
 * pasa por funciones del servidor (loyalty_*): el navegador nunca modifica saldos.
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var M = window.KARTTA_MODS, esc = function (s) { return M.esc(s); };
  var S = null, customers = [], rewards = [], reds = [], tab = 'resumen', q = '', loaded = false;
  var DEF = { enabled: false, program_name: 'Puntos', points_per_1000: 10, min_order_total: 0, welcome_points: 0, spin_enabled: false, spin_prizes: [], card: {}, terms: '' };
  var TABS = [['resumen', 'Resumen'], ['clientes', 'Clientes'], ['puntos', 'Puntos'], ['premios', 'Premios'], ['canjes', 'Canjes'], ['juegos', 'Juegos'], ['tarjeta', 'Tarjeta']];
  var ERR = { forbidden: 'Solo el dueño o administrador puede hacer esto.', invalid_phone: 'Revisa el número de teléfono.', consent_required: 'Confirma que el cliente aceptó participar.', insufficient_points: 'El cliente no tiene puntos suficientes.', note_required: 'Escribe un motivo (mínimo 3 letras).', invalid_points: 'Cantidad de puntos no válida.', already_resolved: 'Este canje ya fue resuelto.', rate_limited: 'Demasiados registros seguidos, espera un momento.' };
  var errMsg = function (e) { var m = String((e && e.message) || ''); for (var k in ERR) if (m.indexOf(k) >= 0) return ERR[k]; if (/invalid_/.test(m)) return 'Hay un dato no válido: ' + m.replace(/^.*invalid_/, 'invalid_'); return 'No se pudo completar. Intenta de nuevo.'; };
  var fmt = function (n) { return Number(n || 0).toLocaleString('es-CO'); };
  var cardUrl = function (t) { return location.origin + '/t/' + t; };
  var when = function (d) { return d ? new Date(d).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short' }) : '—'; };

  async function loadAll() {
    var C = M.ctx, host = $('modLoyalty');
    host.innerHTML = '<div class="card"><div class="skel" style="height:18px;width:40%"></div><div class="skel" style="height:14px;width:70%;margin-top:12px"></div></div>';
    var r = await Promise.all([
      C.sb.from('loyalty_settings').select('*').eq('restaurant_id', C.rid).maybeSingle(),
      C.sb.from('loyalty_customers').select('id,name,phone,balance,lifetime,card_token,created_at,last_visit_at,consent_source').eq('restaurant_id', C.rid).order('created_at', { ascending: false }).limit(2000),
      C.sb.from('loyalty_rewards').select('*').eq('restaurant_id', C.rid).order('cost_points'),
      C.sb.from('loyalty_redemptions').select('id,customer_id,reward_name,points,code,status,created_at,resolved_at').eq('restaurant_id', C.rid).order('created_at', { ascending: false }).limit(200)
    ]);
    if (r[0].error || r[1].error) { host.innerHTML = '<div class="vhead"><h2>Fidelización</h2></div><div class="card"><p class="note warn" style="margin:0">El módulo de fidelización aún no está habilitado en tu base de datos (falta aplicar la migración <code>20261030_fidelizacion.sql</code>).</p></div>'; loaded = false; return false; }
    S = Object.assign({}, DEF, r[0].data || {}); S.card = S.card || {}; S.spin_prizes = S.spin_prizes || [];
    customers = r[1].data || []; rewards = r[2].data || []; reds = r[3].data || []; loaded = true; return true;
  }
  async function saveSettings(patch, okMsg) {
    var C = M.ctx, next = Object.assign({}, S, patch);
    var payload = { enabled: !!next.enabled, program_name: next.program_name, points_per_1000: Number(next.points_per_1000), min_order_total: Number(next.min_order_total), welcome_points: Number(next.welcome_points), spin_enabled: !!next.spin_enabled, spin_prizes: next.spin_prizes, card: next.card, terms: next.terms || '' };
    var res = await C.sb.rpc('loyalty_save_settings', { p_restaurant: C.rid, p_settings: payload });
    if (res.error) { C.toast(errMsg(res.error)); return false; }
    S = next; C.toast(okMsg || 'Guardado.'); return true;
  }
  var nameOf = function (id) { var c = customers.filter(function (x) { return x.id === id; })[0]; return c ? (c.name || c.phone) : 'Cliente'; };
  var pending = function () { return reds.filter(function (x) { return x.status === 'pending'; }); };

  function shell(inner) {
    var host = $('modLoyalty');
    host.innerHTML = '<div class="vhead"><h2>Fidelización</h2><p>Puntos, premios, juegos y la tarjeta que cada cliente guarda en su celular.</p></div>' +
      '<div class="rng" role="tablist" style="margin-bottom:16px;max-width:100%;overflow-x:auto">' + TABS.map(function (t) { return '<button type="button" role="tab" data-ltab="' + t[0] + '" aria-selected="' + (tab === t[0]) + '" class="' + (tab === t[0] ? 'on' : '') + '">' + t[1] + (t[0] === 'canjes' && pending().length ? ' (' + pending().length + ')' : '') + '</button>'; }).join('') + '</div>' + inner;
  }
  function render() {
    var map = { resumen: tResumen, clientes: tClientes, puntos: tPuntos, premios: tPremios, canjes: tCanjes, juegos: tJuegos, tarjeta: tTarjeta };
    shell(map[tab]()); if (tab === 'tarjeta') drawPreview();
  }

  function tResumen() {
    var bal = customers.reduce(function (s, c) { return s + c.balance; }, 0), given = customers.reduce(function (s, c) { return s + c.lifetime; }, 0);
    var delivered = reds.filter(function (x) { return x.status === 'delivered'; }).length;
    if (!S.enabled) return '<div class="card empty"><h3>Activa tu programa de puntos</h3><p>Tus clientes se registran desde el menú con su WhatsApp, reciben su tarjeta en el celular y acumulan puntos cada vez que un pedido queda pagado.</p><button class="btn btn-accent" data-lact="enable">Activar programa</button></div>';
    var kp = function (l, n, d) { return '<div class="kpi"><div class="l">' + l + '</div><div class="n">' + n + '</div><div class="d">' + d + '</div></div>'; };
    var empty = customers.length ? '' : '<div class="card empty"><h3>Aún no hay clientes</h3><p>Crea el primero tú mismo o comparte tu menú: ahí verán el botón «Mi tarjeta de puntos».</p><div class="row" style="justify-content:center"><button class="btn btn-accent" data-ltab="clientes">Crear cliente</button><button class="btn btn-ghost" data-lact="copymenu">Copiar enlace del menú</button></div></div>';
    return '<div class="kpis">' + kp('Clientes', fmt(customers.length), 'con consentimiento registrado') + kp('Puntos en circulación', fmt(bal), 'saldo actual de todos') + kp('Puntos otorgados', fmt(given), 'histórico') + kp('Canjes pendientes', pending().length, 'por entregar') + kp('Canjes entregados', delivered, 'últimos 200') + '</div>' + empty +
      '<div class="card"><div class="row between"><div><h3>Programa activo</h3><p class="sub" style="margin:0">' + esc(S.program_name) + ' · ' + S.points_per_1000 + ' pts por cada $1.000 · bienvenida ' + S.welcome_points + ' pts</p></div><button class="btn btn-ghost btn-sm" data-lact="disable">Pausar programa</button></div></div>';
  }

  function tClientes() {
    var list = customers.filter(function (c) { var s = q.toLowerCase(); return !s || (c.name || '').toLowerCase().indexOf(s) >= 0 || c.phone.indexOf(s.replace(/\D/g, '') || '§') >= 0; });
    return '<div class="fbar"><div class="field"><label for="lq">Buscar</label><input id="lq" type="search" value="' + esc(q) + '" placeholder="Nombre o teléfono" autocomplete="off"></div><div class="row"><button class="btn btn-accent" data-lact="newcust">+ Nuevo cliente</button><button class="btn btn-ghost" data-lact="export">Exportar CSV</button></div></div>' +
      '<div id="lnew"></div>' +
      (list.length ? list.map(function (c) {
        return '<div class="ped"><div class="top"><div><div class="mesa">' + esc(c.name || 'Sin nombre') + '</div><div class="cli">' + esc(c.phone) + ' · última compra ' + when(c.last_visit_at) + '</div></div><span class="st entregado">' + fmt(c.balance) + ' pts</span></div>' +
          '<div class="bot"><span class="note">Desde ' + when(c.created_at) + ' · ' + (c.consent_source === 'self' ? 'se registró solo' : 'registrado por el local') + '</span><div class="row"><button class="btn btn-ghost btn-sm" data-lcopy="' + c.id + '">Copiar enlace</button><a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://wa.me/' + c.phone + '?text=' + encodeURIComponent('Hola' + (c.name ? ' ' + c.name : '') + ', esta es tu tarjeta de puntos de ' + M.ctx.negocio.nombre + ': ' + cardUrl(c.card_token)) + '">Enviar por WhatsApp</a><button class="btn btn-ghost btn-sm" data-lhist="' + c.id + '">Historial</button><button class="btn btn-ghost btn-sm" data-ladj="' + c.id + '">Ajustar</button></div></div><div class="lhist"></div></div>';
      }).join('') : '<p class="note">' + (customers.length ? 'Ningún cliente coincide con la búsqueda.' : 'Aún no hay clientes registrados.') + '</p>');
  }
  var num = function (id, label, val, min, max, hint) { return '<div class="field"><label for="' + id + '">' + label + '</label><input id="' + id + '" type="number" inputmode="numeric" min="' + min + '" max="' + max + '" value="' + val + '">' + (hint ? '<div class="note">' + hint + '</div>' : '') + '</div>'; };
  function tPuntos() {
    return '<div class="card" style="display:grid;gap:14px;max-width:560px"><h3>Reglas de acumulación</h3>' +
      '<div class="field"><label for="pName">Nombre del programa</label><input id="pName" maxlength="40" value="' + esc(S.program_name) + '"></div>' +
      num('pPer', 'Puntos por cada $1.000 COP', S.points_per_1000, 0, 1000, 'Ej.: 10 → un pedido de $25.000 da 250 puntos.') + num('pMin', 'Pedido mínimo para sumar ($)', S.min_order_total, 0, 10000000) + num('pWel', 'Bono de bienvenida (puntos)', S.welcome_points, 0, 10000, 'Se da una sola vez al registrarse.') +
      '<div class="field"><label for="pTerms">Condiciones (opcional)</label><textarea id="pTerms" maxlength="600" rows="3">' + esc(S.terms || '') + '</textarea></div>' +
      '<p class="note">Los puntos se suman automáticamente cuando un pedido queda <strong>pagado</strong> y el teléfono del pedido coincide con el de un cliente registrado. Un pedido nunca suma dos veces.</p>' +
      '<div><button class="btn btn-accent" data-lact="saverules">Guardar reglas</button></div></div>';
  }
  function tPremios() {
    return '<div class="card" style="display:grid;gap:12px;max-width:620px"><h3>Premios</h3>' + (rewards.length ? rewards.map(function (r) {
      return '<div class="prov"><div><strong style="color:var(--strong)">' + esc(r.name) + '</strong><div class="note">' + fmt(r.cost_points) + ' puntos' + (r.description ? ' · ' + esc(r.description) : '') + '</div></div><div class="row"><span class="pill ' + (r.active ? 'ok' : 'pend') + '">' + (r.active ? 'Activo' : 'Oculto') + '</span><button class="btn btn-ghost btn-sm" data-redit="' + r.id + '">Editar</button></div></div>';
    }).join('') : '<p class="note">Todavía no tienes premios. Crea el primero (por ejemplo «Café gratis» a 500 puntos).</p>') +
      '<div id="rform"></div><div><button class="btn btn-accent" data-lact="newreward">+ Nuevo premio</button></div></div>';
  }
  function tCanjes() {
    var p = pending(), h = reds.filter(function (x) { return x.status !== 'pending'; }).slice(0, 30);
    var row = function (x, acts) { return '<div class="ped"><div class="top"><div><div class="mesa">' + esc(x.reward_name) + ' <span style="color:var(--accent);letter-spacing:.1em">' + esc(x.code) + '</span></div><div class="cli">' + esc(nameOf(x.customer_id)) + ' · ' + fmt(x.points) + ' pts · ' + when(x.created_at) + '</div></div><span class="st ' + (x.status === 'delivered' ? 'entregado' : x.status === 'cancelled' ? 'cancelado' : 'nuevo') + '">' + ({ pending: 'Pendiente', delivered: 'Entregado', cancelled: 'Cancelado' })[x.status] + '</span></div>' + (acts ? '<div class="bot"><span class="note">Pide el código al cliente antes de entregar.</span><div class="row"><button class="btn btn-accent btn-sm" data-lres="delivered:' + x.id + '">Entregar</button><button class="btn btn-ghost btn-sm" data-lres="cancelled:' + x.id + '">Cancelar y devolver puntos</button></div></div>' : '') + '</div>'; };
    return '<div class="fbar"><div class="field"><label for="lcode">Buscar por código</label><input id="lcode" placeholder="Ej.: A1B2C3" autocomplete="off" style="text-transform:uppercase"></div></div><h3 style="margin:0 0 10px">Por entregar</h3><div id="lpend">' + (p.length ? p.map(function (x) { return row(x, true); }).join('') : '<p class="note">No hay canjes pendientes.</p>') + '</div><h3 style="margin:18px 0 10px">Historial</h3>' + (h.length ? h.map(function (x) { return row(x, false); }).join('') : '<p class="note">Aún no hay canjes resueltos.</p>');
  }
  function tJuegos() {
    var total = S.spin_prizes.reduce(function (s, p) { return s + Number(p.weight || 0); }, 0);
    return '<div class="card" style="display:grid;gap:14px;max-width:620px"><div class="row between"><div><h3>Ruleta diaria</h3><p class="sub" style="margin:0">Cada cliente gira una vez al día y gana puntos. El azar y el límite diario los decide el servidor.</p></div><label class="cc-open"><input type="checkbox" id="jOn" role="switch"' + (S.spin_enabled ? ' checked' : '') + ' aria-label="Activar ruleta"></label></div>' +
      '<div id="jlist">' + S.spin_prizes.map(function (p, i) { return '<div class="fbar" style="margin:0;align-items:flex-end"><div class="field" style="flex:2 1 140px"><label>Premio</label><input data-jp="label:' + i + '" maxlength="30" value="' + esc(p.label) + '"></div><div class="field"><label>Puntos</label><input data-jp="points:' + i + '" type="number" min="1" max="1000" value="' + Number(p.points) + '"></div><div class="field"><label>Peso</label><input data-jp="weight:' + i + '" type="number" min="1" max="100" value="' + Number(p.weight) + '"></div><span class="note" style="min-width:56px">' + (total ? Math.round(p.weight / total * 100) : 0) + '%</span><button class="btn btn-ghost btn-sm" data-jdel="' + i + '" aria-label="Quitar premio">✕</button></div>'; }).join('') + '</div>' +
      '<div class="row"><button class="btn btn-ghost" data-lact="addprize"' + (S.spin_prizes.length >= 8 ? ' disabled' : '') + '>+ Añadir premio</button><button class="btn btn-accent" data-lact="savespin">Guardar juego</button></div><p class="note">Máximo 8 premios. El «peso» define la probabilidad: más peso, más frecuente.</p></div>';
  }
  function tTarjeta() {
    var d = KARTTA_CARD.design(S.card), col = function (id, l, v) { return '<div class="field"><label for="' + id + '">' + l + '</label><input id="' + id + '" type="color" value="' + v + '"></div>'; };
    return '<div class="qrwrap"><div class="qrprev"><div id="cardPrev" style="width:100%"></div><p class="note" style="margin-top:12px;text-align:center">Así verá tu cliente su tarjeta. Se actualiza al guardar.</p></div>' +
      '<div class="card qrctl"><div class="two">' + col('cBg1', 'Color 1', d.bg1) + col('cBg2', 'Color 2', d.bg2) + col('cTx', 'Texto', d.text) + col('cAc', 'Acento', d.accent) + '</div>' +
      '<div class="field"><label for="cSt">Estilo</label><select id="cSt"><option value="gradient">Degradado</option><option value="solid">Sólido</option><option value="dots">Puntos</option><option value="lines">Líneas</option></select></div>' +
      '<div class="field"><label for="cTi">Título (arriba a la derecha)</label><input id="cTi" maxlength="30" value="' + esc(d.title) + '" placeholder="' + esc(S.program_name) + '"></div>' +
      '<div class="field"><label for="cSu">Texto junto al saldo</label><input id="cSu" maxlength="40" value="' + esc(d.subtitle) + '" placeholder="puntos"></div>' +
      '<p class="note" id="cMsg"></p><div class="row"><button class="btn btn-accent" data-lact="savecard">Guardar diseño</button><button class="btn btn-ghost" data-lact="resetcard">Restablecer</button></div></div></div>';
  }
  function cardDesign() { return { bg1: $('cBg1').value, bg2: $('cBg2').value, text: $('cTx').value, accent: $('cAc').value, style: $('cSt').value, title: $('cTi').value.trim(), subtitle: $('cSu').value.trim() }; }
  function lumOf(h) { var c = [1, 3, 5].map(function (i) { var v = parseInt(h.substr(i, 2), 16) / 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; }
  function ratio(a, b) { var x = lumOf(a), y = lumOf(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
  function drawPreview() {
    var C = M.ctx, d = cardDesign(), el = $('cardPrev'); if (!el) return; $('cSt').value = d.style;
    var worst = Math.min(ratio(d.text, d.bg1), ratio(d.text, d.bg2));
    $('cMsg').textContent = worst < 4.5 ? 'Contraste del texto bajo (' + worst.toFixed(1) + ':1): cuesta leerlo. Prueba un texto más claro u oscuro.' : 'Contraste del texto ' + worst.toFixed(1) + ':1 — correcto.'; $('cMsg').className = 'note' + (worst < 4.5 ? ' warn' : '');
    var nxt = rewards.filter(function (r) { return r.active; }).map(function (r) { return r.cost_points; }).sort(function (a, b) { return a - b; })[0] || 500;
    KARTTA_CARD.render(el, { design: d, programName: S.program_name, restaurantName: C.negocio.nombre, logoUrl: C.negocio.logo, customerName: 'Nombre del cliente', last4: '1234', balance: Math.round(nxt * .6), nextCost: nxt });
  }

  /* ---------- acciones ---------- */
  document.addEventListener('input', function (e) {
    var id = e.target.id; if (!document.querySelector('[data-panel=fidelizacion].active')) return;
    if (['cBg1', 'cBg2', 'cTx', 'cAc', 'cSt', 'cTi', 'cSu'].indexOf(id) >= 0) drawPreview();
    if (id === 'lq') { q = e.target.value; var pos = e.target.selectionStart; shell(tClientes()); var n = $('lq'); n.focus(); n.setSelectionRange(pos, pos); }
    if (id === 'lcode') { var s = e.target.value.trim().toUpperCase(); document.querySelectorAll('#lpend .ped').forEach(function (p) { p.style.display = !s || p.textContent.toUpperCase().indexOf(s) >= 0 ? '' : 'none'; }); }
  });
  document.addEventListener('change', async function (e) {
    if (e.target.id === 'jOn') { S.spin_enabled = e.target.checked; }
    var jp = e.target.dataset && e.target.dataset.jp; if (jp) { var a = jp.split(':'); S.spin_prizes[+a[1]][a[0]] = a[0] === 'label' ? e.target.value : Number(e.target.value); render(); }
  });
  document.addEventListener('click', async function (e) {
    var C = M.ctx, b = e.target.closest('button,a'); if (!b || !document.querySelector('[data-panel=fidelizacion].active')) return;
    var d = b.dataset;
    if (d.ltab) { tab = d.ltab; render(); return; }
    if (d.lcopy) { var c = customers.filter(function (x) { return x.id === d.lcopy; })[0]; try { await navigator.clipboard.writeText(cardUrl(c.card_token)); C.toast('Enlace de la tarjeta copiado.'); } catch (x) { C.toast(cardUrl(c.card_token)); } return; }
    if (d.lhist) {
      var box = b.closest('.ped').querySelector('.lhist'); if (box.innerHTML) { box.innerHTML = ''; return; }
      var r = await C.sb.from('loyalty_movements').select('kind,points,balance_after,note,created_at').eq('customer_id', d.lhist).order('created_at', { ascending: false }).limit(30);
      if (r.error) return C.toast('No se pudo cargar el historial.');
      var K = { earn: 'Compra', welcome: 'Bienvenida', redeem: 'Canje', refund: 'Devolución', adjust: 'Ajuste', game: 'Ruleta' };
      box.innerHTML = '<div class="note" style="border-top:1px solid var(--border);margin-top:10px;padding-top:8px">' + ((r.data || []).map(function (m) { return when(m.created_at) + ' · ' + (K[m.kind] || m.kind) + ' · <strong>' + (m.points > 0 ? '+' : '') + m.points + '</strong> → ' + m.balance_after + (m.note && m.kind !== 'earn' ? ' · ' + esc(m.note) : ''); }).join('<br>') || 'Sin movimientos.') + '</div>'; return;
    }
    if (d.ladj) {
      var cu = customers.filter(function (x) { return x.id === d.ladj; })[0], v = prompt('Puntos a sumar (o restar con -). Cliente: ' + (cu.name || cu.phone) + ' (saldo ' + cu.balance + ')'); if (v == null) return;
      var delta = parseInt(v, 10); if (!delta) return C.toast('Cantidad no válida.'); var note = prompt('Motivo del ajuste (obligatorio):'); if (note == null) return;
      var rr = await C.sb.rpc('loyalty_adjust', { p_customer: cu.id, p_delta: delta, p_note: note }); if (rr.error) return C.toast(errMsg(rr.error)); C.toast('Saldo actualizado.'); await loadAll(); render(); return;
    }
    if (d.lres) {
      var p = d.lres.split(':'), msg = p[0] === 'delivered' ? '¿Confirmas que ya entregaste este premio?' : '¿Cancelar el canje y devolver los puntos al cliente?'; if (!confirm(msg)) return;
      var rs = await C.sb.rpc('loyalty_resolve_redemption', { p_redemption: p[1], p_status: p[0] }); if (rs.error) return C.toast(errMsg(rs.error)); C.toast(p[0] === 'delivered' ? 'Entregado.' : 'Canje cancelado; puntos devueltos.'); await loadAll(); render(); return;
    }
    if (d.redit) { var rw = rewards.filter(function (x) { return x.id === d.redit; })[0]; rewardForm(rw); return; }
    if (d.jdel) { S.spin_prizes.splice(+d.jdel, 1); render(); return; }
    switch (d.lact) {
      case 'enable': if (await saveSettings({ enabled: true }, 'Programa activado.')) { tab = 'puntos'; render(); } break;
      case 'disable': if (confirm('¿Pausar el programa? Los clientes conservan sus puntos pero no verán su tarjeta hasta que lo reactives.') && await saveSettings({ enabled: false }, 'Programa pausado.')) render(); break;
      case 'copymenu': try { await navigator.clipboard.writeText(C.menuURL()); C.toast('Enlace copiado.'); } catch (x) { C.toast(C.menuURL()); } break;
      case 'saverules': if (await saveSettings({ program_name: $('pName').value.trim() || 'Puntos', points_per_1000: $('pPer').value, min_order_total: $('pMin').value, welcome_points: $('pWel').value, terms: $('pTerms').value })) render(); break;
      case 'savecard': if (await saveSettings({ card: cardDesign() }, 'Diseño guardado.')) render(); break;
      case 'resetcard': if (await saveSettings({ card: {} }, 'Diseño restablecido.')) render(); break;
      case 'addprize': if (S.spin_prizes.length < 8) { S.spin_prizes.push({ label: '+10 puntos', points: 10, weight: 10 }); render(); } break;
      case 'savespin': S.spin_enabled = $('jOn').checked; if (S.spin_enabled && !S.spin_prizes.length) return C.toast('Añade al menos un premio para activar la ruleta.'); if (await saveSettings({ spin_enabled: S.spin_enabled, spin_prizes: S.spin_prizes }, 'Juego guardado.')) render(); break;
      case 'newreward': rewardForm(null); break;
      case 'newcust': newCustForm(); break;
      case 'savecust': {
        var res = await C.sb.rpc('loyalty_staff_create_customer', { p_restaurant: C.rid, p_name: $('ncName').value, p_phone: $('ncPhone').value, p_consent_confirmed: $('ncConsent').checked });
        if (res.error) return C.toast(errMsg(res.error)); C.toast(res.data.created ? 'Cliente creado.' : 'Ese cliente ya existía.'); await loadAll(); render(); break;
      }
      case 'saverw': {
        var cost = parseInt($('rwCost').value, 10), name = $('rwName').value.trim(); if (!name || !(cost >= 1)) return C.toast('Escribe el nombre y un costo en puntos.');
        var rv = await C.sb.rpc('loyalty_upsert_reward', { p_restaurant: C.rid, p_id: d.id || null, p_name: name, p_description: $('rwDesc').value, p_cost: cost, p_active: $('rwOn').checked });
        if (rv.error) return C.toast(errMsg(rv.error)); C.toast('Premio guardado.'); await loadAll(); render(); break;
      }
      case 'export': exportCsv(); break;
    }
  });
  function rewardForm(r) {
    var h = $('rform'); if (!h) return;
    h.innerHTML = '<div class="card" style="background:var(--panel2);display:grid;gap:12px"><h3>' + (r ? 'Editar premio' : 'Nuevo premio') + '</h3><div class="field"><label for="rwName">Nombre</label><input id="rwName" maxlength="80" value="' + esc(r ? r.name : '') + '" placeholder="Café gratis"></div><div class="field"><label for="rwDesc">Descripción (opcional)</label><input id="rwDesc" maxlength="200" value="' + esc(r ? r.description || '' : '') + '"></div>' + num('rwCost', 'Costo en puntos', r ? r.cost_points : 500, 1, 1000000) + '<label class="row" style="gap:8px;font-size:13px"><input type="checkbox" id="rwOn"' + (!r || r.active ? ' checked' : '') + '> Visible para los clientes</label><div><button class="btn btn-accent" data-lact="saverw" data-id="' + (r ? r.id : '') + '">Guardar premio</button></div></div>'; $('rwName').focus();
  }
  function newCustForm() {
    $('lnew').innerHTML = '<div class="card" style="background:var(--panel2);display:grid;gap:12px;max-width:520px"><h3>Nuevo cliente</h3><div class="field"><label for="ncName">Nombre</label><input id="ncName" maxlength="80"></div><div class="field"><label for="ncPhone">WhatsApp / teléfono</label><input id="ncPhone" type="tel" inputmode="tel" placeholder="300 123 4567"></div><label class="row" style="gap:8px;font-size:13px;align-items:flex-start"><input type="checkbox" id="ncConsent" style="margin-top:3px"> El cliente aceptó participar en el programa de puntos y recibir su tarjeta por WhatsApp.</label><div><button class="btn btn-accent" data-lact="savecust">Guardar cliente</button></div></div>'; $('ncName').focus();
  }
  function exportCsv() {
    var cell = function (v) { v = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };   // evita inyección de fórmulas en Excel
    var rows = [['Nombre', 'Teléfono', 'Puntos', 'Puntos históricos', 'Registrado']].concat(customers.map(function (c) { return [c.name || '', c.phone, c.balance, c.lifetime, (c.created_at || '').slice(0, 10)]; }));
    var blob = new Blob(['\ufeff' + rows.map(function (r) { return r.map(cell).join(','); }).join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'clientes-fidelizacion.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
  }

  M.views.fidelizacion = async function () { if (await loadAll()) render(); };
})();
