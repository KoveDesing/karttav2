/**
 * KARTTA — Fidelización (panel). La lectura va por RLS (solo tu restaurante); TODA escritura
 * pasa por funciones del servidor (loyalty_*): el navegador nunca modifica saldos.
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var M = window.KARTTA_MODS, esc = function (s) { return M.esc(s); };
  var S = null, customers = [], rewards = [], reds = [], movs = [], stats = null, tab = 'resumen', q = '', loaded = false;
  var DEF = { enabled: false, program_name: 'Puntos', points_per_1000: 10, min_order_total: 0, welcome_points: 0, spin_enabled: false, spin_prizes: [], card: {}, terms: '', tiers_enabled: false, tiers: [], require_identity: false };
  var TABS = [['resumen', 'Resumen'], ['puntos', 'Programa de puntos'], ['premios', 'Recompensas'], ['tarjeta', 'Diseño de tarjeta'], ['clientes', 'Clientes'], ['historial', 'Historial'], ['canjes', 'Canjes'], ['juegos', 'Juegos']];
  var ERR = { forbidden: 'Solo el dueño o administrador puede hacer esto.', invalid_phone: 'Revisa el número de teléfono.', consent_required: 'Confirma que el cliente aceptó participar.', insufficient_points: 'El cliente no tiene puntos suficientes.', note_required: 'Escribe un motivo (mínimo 3 letras).', invalid_points: 'Cantidad de puntos no válida.', already_resolved: 'Este canje ya fue resuelto.', rate_limited: 'Demasiados registros seguidos, espera un momento.', reward_limit_reached: 'Ese cliente ya usó este premio el máximo de veces.', reward_sold_out: 'Este premio ya se agotó.', invalid_reward_dates: 'La fecha de fin debe ser posterior a la de inicio.', invalid_tier: 'Cada nivel necesita un nombre y un mínimo de puntos válido.' };
  var errMsg = function (e) { var m = String((e && e.message) || ''); for (var k in ERR) if (m.indexOf(k) >= 0) return ERR[k]; if (/invalid_/.test(m)) return 'Hay un dato no válido: ' + m.replace(/^.*invalid_/, 'invalid_'); return 'No se pudo completar. Intenta de nuevo.'; };
  var fmt = function (n) { return Number(n || 0).toLocaleString('es-CO'); };
  var when = function (d) { return d ? new Date(d).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short' }) : '—'; };

  async function loadAll() {
    var C = M.ctx, host = $('modLoyalty');
    host.innerHTML = '<div class="card"><div class="skel" style="height:18px;width:40%"></div><div class="skel" style="height:14px;width:70%;margin-top:12px"></div></div>';
    var r = await Promise.all([
      C.sb.from('loyalty_settings').select('*').eq('restaurant_id', C.rid).maybeSingle(),
      C.sb.from('loyalty_customers').select('id,name,phone,balance,lifetime,created_at,last_visit_at,consent_source,phone_verified_at,marketing_consent').eq('restaurant_id', C.rid).order('created_at', { ascending: false }).limit(2000),
      C.sb.from('loyalty_rewards').select('*').eq('restaurant_id', C.rid).order('cost_points'),
      C.sb.from('loyalty_redemptions').select('id,customer_id,reward_name,points,code,status,created_at,resolved_at').eq('restaurant_id', C.rid).order('created_at', { ascending: false }).limit(200),
      C.sb.rpc('loyalty_customer_stats', { p_restaurant: C.rid }),
      C.sb.from('loyalty_movements').select('id,customer_id,kind,points,balance_after,note,order_id,created_at').eq('restaurant_id', C.rid).order('created_at', { ascending: false }).limit(150)
    ]);
    if (r[0].error || r[1].error) { host.innerHTML = '<div class="vhead"><h2>Fidelización</h2></div><div class="card"><p class="note warn" style="margin:0">El módulo de fidelización aún no está habilitado en tu base de datos (falta aplicar la migración <code>20261030_fidelizacion.sql</code>).</p></div>'; loaded = false; return false; }
    S = Object.assign({}, DEF, r[0].data || {}); S.card = S.card || {}; S.spin_prizes = S.spin_prizes || []; S.tiers = S.tiers || []; stats = r[4] && !r[4].error ? r[4].data : null; movs = r[5] && !r[5].error ? (r[5].data || []) : [];
    customers = r[1].data || []; rewards = r[2].data || []; reds = r[3].data || []; loaded = true; return true;
  }
  async function saveSettings(patch, okMsg) {
    var C = M.ctx, next = Object.assign({}, S, patch);
    var payload = { enabled: !!next.enabled, program_name: next.program_name, points_per_1000: Number(next.points_per_1000), min_order_total: Number(next.min_order_total), welcome_points: Number(next.welcome_points), spin_enabled: !!next.spin_enabled, spin_prizes: next.spin_prizes, card: next.card, terms: next.terms || '', tiers_enabled: !!next.tiers_enabled, tiers: next.tiers || [], require_identity: !!next.require_identity };
    var res = await C.sb.rpc('loyalty_save_settings', { p_restaurant: C.rid, p_settings: payload });
    if (res.error) { C.toast(errMsg(res.error)); return false; }
    S = next; C.toast(okMsg || 'Guardado.'); return true;
  }
  var nameOf = function (id) { var c = customers.filter(function (x) { return x.id === id; })[0]; return c ? (c.name || c.phone) : 'Cliente'; };
  var pending = function () { return reds.filter(function (x) { return x.status === 'pending'; }); };

  function shell(inner) {
    var host = $('modLoyalty');
    host.innerHTML = '<div class="vhead"><h2>Fidelización</h2><p>Clientes verificados, puntos, recompensas y la tarjeta digital de cada cliente.</p></div>' +
      '<div class="rng" role="tablist" style="margin-bottom:16px;max-width:100%;overflow-x:auto">' + TABS.map(function (t) { return '<button type="button" role="tab" data-ltab="' + t[0] + '" aria-selected="' + (tab === t[0]) + '" class="' + (tab === t[0] ? 'on' : '') + '">' + t[1] + (t[0] === 'canjes' && pending().length ? ' (' + pending().length + ')' : '') + '</button>'; }).join('') + '</div>' + inner;
  }
  function render() {
    var map = { resumen: tResumen, clientes: tClientes, puntos: tPuntos, premios: tPremios, canjes: tCanjes, juegos: tJuegos, tarjeta: tTarjeta, historial: tHistorial };
    shell(map[tab]()); if (tab === 'tarjeta') drawPreview();
  }

  function tResumen() {
    var bal = customers.reduce(function (s, c) { return s + c.balance; }, 0), given = customers.reduce(function (s, c) { return s + c.lifetime; }, 0);
    var delivered = reds.filter(function (x) { return x.status === 'delivered'; }).length;
    if (!S.enabled) return '<div class="card empty"><h3>Activa tu programa de puntos</h3><p>Tus clientes verifican su teléfono con un código, reciben su tarjeta digital y acumulan puntos cada vez que un pedido suyo queda pagado.</p><button class="btn btn-accent" data-lact="enable">Activar programa</button></div>';
    var kp = function (l, n, d) { return '<div class="kpi"><div class="l">' + l + '</div><div class="n">' + n + '</div><div class="d">' + d + '</div></div>'; };
    var empty = customers.length ? '' : '<div class="card empty"><h3>Aún no hay clientes</h3><p>Tus clientes se registran al escanear el QR de su mesa y tocar «Mi tarjeta». También puedes crear uno tú.</p><div class="row" style="justify-content:center"><button class="btn btn-accent" data-ltab="clientes">Crear cliente</button><button class="btn btn-ghost" data-lact="copymenu">Copiar enlace del menú</button></div></div>';
    return '<div class="kpis">' + kp('Clientes', fmt(stats ? stats.total : customers.length), stats ? fmt(stats.verified) + ' con teléfono verificado' : 'con consentimiento registrado') + kp('Puntos en circulación', fmt(bal), 'saldo actual de todos') + kp('Puntos otorgados', fmt(given), 'histórico') + kp('Canjes pendientes', pending().length, 'por entregar') + kp('Canjes entregados', delivered, 'últimos 200') + '</div>' + empty +
      '<div class="card"><div class="row between"><div><h3>Programa activo</h3><p class="sub" style="margin:0">' + esc(S.program_name) + ' · ' + S.points_per_1000 + ' pts por cada $1.000 · bienvenida ' + S.welcome_points + ' pts</p></div><button class="btn btn-ghost btn-sm" data-lact="disable">Pausar programa</button></div></div>';
  }

  function tClientes() {
    var list = customers.filter(function (c) { var s = q.toLowerCase(); return !s || (c.name || '').toLowerCase().indexOf(s) >= 0 || c.phone.indexOf(s.replace(/\D/g, '') || '§') >= 0; });
    var kp = function (l, n, d) { return '<div class="kpi"><div class="l">' + l + '</div><div class="n">' + n + '</div><div class="d">' + d + '</div></div>'; };
    var st = stats ? '<div class="kpis" style="margin-bottom:14px">' + kp('Clientes', fmt(stats.total), fmt(stats.verified) + ' verificados') + kp('Nuevos (30 días)', fmt(stats.new_30d), 'registrados') + kp('Recurrentes', fmt(stats.recurring), '2 o más pedidos') + kp('Con premio disponible', fmt(stats.with_rewards), 'ya pueden canjear') + '</div>' +
      ((stats.top || []).length ? '<div class="card" style="margin-bottom:14px"><h3>Más puntos</h3>' + stats.top.map(function (t) { return '<div class="row between" style="padding:4px 0"><span>' + esc(t.name || t.phone) + '</span><strong>' + fmt(t.balance) + ' pts</strong></div>'; }).join('') + '</div>' : '') : '';
    return st + '<div class="fbar"><div class="field"><label for="lq">Buscar</label><input id="lq" type="search" value="' + esc(q) + '" placeholder="Nombre o teléfono" autocomplete="off"></div><div class="row"><button class="btn btn-accent" data-lact="newcust">+ Nuevo cliente</button><button class="btn btn-ghost" data-lact="export">Exportar CSV</button></div></div>' +
      '<div id="lnew"></div>' +
      (list.length ? list.map(function (c) {
        return '<div class="ped"><div class="top"><div><div class="mesa">' + esc(c.name || 'Sin nombre') + ' ' + (c.phone_verified_at ? '<span class="pill ok">Verificado</span>' : '<span class="pill pend">Sin verificar</span>') + '</div><div class="cli">' + esc(c.phone) + ' · última compra ' + when(c.last_visit_at) + '</div></div><span class="st entregado">' + fmt(c.balance) + ' pts</span></div>' +
          '<div class="bot"><span class="note">Registrado el ' + when(c.created_at) + ' · ' + (c.consent_source === 'self' ? 'se registró solo' : 'registrado por el local') + (c.marketing_consent ? ' · acepta promociones' : '') + '</span><div class="row"><button class="btn btn-ghost btn-sm" data-lprof="' + c.id + '">Perfil y tarjeta</button><a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://wa.me/' + c.phone + '">WhatsApp</a><button class="btn btn-ghost btn-sm" data-lhist="' + c.id + '">Historial</button><button class="btn btn-ghost btn-sm" data-ladj="' + c.id + '">Ajustar</button></div></div><div class="lhist"></div></div>';
      }).join('') : '<p class="note">' + (customers.length ? 'Ningún cliente coincide con la búsqueda.' : 'Aún no hay clientes registrados.') + '</p>');
  }
  var KIND = { earn: 'Compra', welcome: 'Bienvenida', redeem: 'Canje', refund: 'Devolución', adjust: 'Ajuste', game: 'Ruleta' };
  function tHistorial() {
    if (!movs.length) return '<div class="card empty"><h3>Sin movimientos todavía</h3><p>Aquí verás cada punto que se suma, se canjea o se ajusta.</p></div>';
    return '<div class="card"><h3>Últimos movimientos</h3><div style="display:grid;gap:2px">' + movs.map(function (m) {
      return '<div class="row between" style="padding:8px 0;border-bottom:1px solid var(--border);gap:10px"><div><strong style="color:var(--strong)">' + esc(nameOf(m.customer_id)) + '</strong><div class="note">' + when(m.created_at) + ' · ' + (KIND[m.kind] || m.kind) + (m.note && m.kind !== 'earn' ? ' · ' + esc(m.note) : '') + '</div></div><div style="text-align:right"><strong style="color:' + (m.points > 0 ? 'var(--ok,#1EA35A)' : 'var(--accent)') + '">' + (m.points > 0 ? '+' : '') + fmt(m.points) + '</strong><div class="note">saldo ' + fmt(m.balance_after) + '</div></div></div>';
    }).join('') + '</div><p class="note" style="margin-top:10px">Se muestran los últimos 150 movimientos. El historial completo de cada cliente está en su perfil.</p></div>';
  }
  var num = function (id, label, val, min, max, hint) { return '<div class="field"><label for="' + id + '">' + label + '</label><input id="' + id + '" type="number" inputmode="numeric" min="' + min + '" max="' + max + '" value="' + val + '">' + (hint ? '<div class="note">' + hint + '</div>' : '') + '</div>'; };
  function tPuntos() {
    var tiers = S.tiers || [], trow = function (i) { var t = tiers[i] || {}; return '<div class="fbar" style="margin:0;align-items:flex-end"><div class="field" style="flex:2 1 140px"><label>Nombre del nivel ' + (i + 1) + '</label><input id="tN' + i + '" maxlength="20" value="' + esc(t.name || '') + '" placeholder="' + ['Plata', 'Oro', 'Platino'][i] + '"></div><div class="field" style="flex:1 1 120px"><label>Puntos históricos desde</label><input id="tM' + i + '" type="number" inputmode="numeric" min="0" value="' + (t.min_lifetime != null ? t.min_lifetime : '') + '"></div></div>'; };
    return '<div class="card" style="display:grid;gap:14px;max-width:560px"><h3>Reglas de acumulación</h3>' +
      '<div class="field"><label for="pName">Nombre del programa</label><input id="pName" maxlength="40" value="' + esc(S.program_name) + '"></div>' +
      num('pPer', 'Puntos por cada $1.000 COP', S.points_per_1000, 0, 1000, 'Ej.: 10 → un pedido de $25.000 da 250 puntos.') + num('pMin', 'Pedido mínimo para sumar ($)', S.min_order_total, 0, 10000000) + num('pWel', 'Bono de bienvenida (puntos)', S.welcome_points, 0, 10000, 'Se da una sola vez al registrarse.') +
      '<div class="field"><label for="pTerms">Condiciones (opcional)</label><textarea id="pTerms" maxlength="600" rows="3">' + esc(S.terms || '') + '</textarea></div>' +
      '<label class="row" style="gap:8px;font-size:13px;align-items:flex-start"><input type="checkbox" id="pReq"' + (S.require_identity ? ' checked' : '') + ' style="margin-top:3px"> Exigir teléfono verificado para pedir (si no lo marcas, el cliente puede pedir sin tarjeta y no suma puntos).</label>' +
      '<label class="row" style="gap:8px;font-size:13px;align-items:flex-start"><input type="checkbox" id="pTierOn"' + (S.tiers_enabled ? ' checked' : '') + ' style="margin-top:3px"> Habilitar niveles de cliente (se calculan con los puntos históricos).</label>' +
      '<div style="display:grid;gap:8px">' + trow(0) + trow(1) + trow(2) + '<p class="note">Deja vacío el nombre de un nivel para no usarlo. El primero suele empezar en 0.</p></div>' +
      '<p class="note">Los puntos se suman automáticamente cuando un pedido de un cliente <strong>verificado</strong> queda <strong>pagado</strong> (en efectivo, cuando tú marcas el pago). Si el pago se desmarca o el pedido se cancela, los puntos se revierten sin borrar el historial. Un pedido nunca suma dos veces.</p>' +
      '<div><button class="btn btn-accent" data-lact="saverules">Guardar reglas</button></div></div>';
  }
  function tPremios() {
    var dt = function (v) { return v ? new Date(v).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short' }) : ''; };
    return '<div class="card" style="display:grid;gap:12px;max-width:620px"><h3>Recompensas</h3>' + (rewards.length ? rewards.map(function (r) {
      var ex = [r.valid_until ? 'hasta ' + dt(r.valid_until) : '', r.max_per_customer ? 'máx. ' + r.max_per_customer + ' por cliente' : '', r.max_total ? 'límite total ' + r.max_total : ''].filter(Boolean).join(' · ');
      return '<div class="prov"><div><strong style="color:var(--strong)">' + esc(r.name) + '</strong><div class="note">' + fmt(r.cost_points) + ' puntos' + (r.description ? ' · ' + esc(r.description) : '') + (ex ? ' · ' + ex : '') + '</div></div><div class="row"><span class="pill ' + (r.active ? 'ok' : 'pend') + '">' + (r.active ? 'Activo' : 'Oculto') + '</span><button class="btn btn-ghost btn-sm" data-redit="' + r.id + '">Editar</button></div></div>';
    }).join('') : '<p class="note">Todavía no tienes recompensas. Crea la primera (por ejemplo «Café gratis» a 500 puntos).</p>') +
      '<div id="rform"></div><div><button class="btn btn-accent" data-lact="newreward">+ Nueva recompensa</button></div></div>';
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
  var STYLE_LBL = { gradient: 'Degradado', solid: 'Sólido', dots: 'Puntos', lines: 'Líneas', grid: 'Cuadrícula', diagonal: 'Diagonal', waves: 'Ondas', rings: 'Anillos' };
  var FONT_LBL = { sans: 'Moderna (Inter)', serif: 'Serif elegante', rounded: 'Redondeada', mono: 'Monoespaciada', display: 'Manuscrita (Mr Dafoe)' };
  var ICON_LBL = { none: 'Sin icono', star: '★ Estrella', crown: '♛ Corona', heart: '♥ Corazón', coffee: '☕ Café', flame: '🔥 Llama', gem: '◆ Gema', leaf: '❦ Hoja' };
  function tTarjeta() {
    var d = KARTTA_CARD.design(S.card); curTpl = d.template; var T = KARTTA_CARD.TEMPLATES;
    var col = function (id, l, v) { return '<div class="field"><label for="' + id + '">' + l + '</label><input id="' + id + '" data-cd type="color" value="' + v + '"></div>'; };
    var txt = function (id, l, v, max, ph) { return '<div class="field"><label for="' + id + '">' + l + '</label><input id="' + id + '" data-cd maxlength="' + max + '" value="' + esc(v) + '" placeholder="' + esc(ph || '') + '"></div>'; };
    var sel = function (id, l, opts, cur) { return '<div class="field"><label for="' + id + '">' + l + '</label><select id="' + id + '" data-cd>' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === cur ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>'; };
    var sec = function (t) { return '<h4 style="margin:14px 0 2px;font-size:13px;color:var(--strong)">' + t + '</h4>'; };
    return '<div class="qrwrap"><div class="qrprev"><div style="width:100%;max-width:300px;margin:0 auto;border:8px solid #111;border-radius:36px;padding:26px 12px 22px;background:#F3F3F1;box-sizing:border-box"><div style="text-align:center;font:700 11px system-ui,sans-serif;color:#777;margin-bottom:12px">Mi tarjeta · vista en celular</div><div id="cardPrev" style="width:100%"></div><div style="margin-top:12px;font:600 11px/1.4 system-ui,sans-serif;color:#777;text-align:center">Tarjeta de membresía: no es un medio de pago.</div></div><p class="note" style="margin-top:12px;text-align:center">La vista previa cambia en vivo. Al guardar, se actualiza la tarjeta de todos tus clientes sin tocar sus puntos.</p></div>' +
      '<div class="card qrctl">' + sec('Plantillas') + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:8px">' + Object.keys(T).map(function (k) { var t = T[k]; return '<button type="button" data-ltpl="' + k + '" style="border:2px solid ' + (d.template === k ? 'var(--accent)' : 'var(--border)') + ';border-radius:12px;padding:0;overflow:hidden;background:none;cursor:pointer;text-align:center"><span style="display:block;height:44px;background:linear-gradient(135deg,' + t.bg1 + ',' + t.bg2 + ');position:relative"><i style="position:absolute;left:8px;bottom:8px;width:26px;height:5px;border-radius:9px;background:' + t.accent + '"></i></span><span style="display:block;padding:5px 2px;font-size:11.5px;font-weight:700;color:var(--strong)">' + t.label + '</span></button>'; }).join('') + '</div>' +
      sec('Colores') + '<div class="two">' + col('cBg1', 'Fondo', d.bg1) + col('cBg2', 'Fondo 2 (degradado)', d.bg2) + col('cTx', 'Texto', d.text) + col('cAc', 'Acento', d.accent) + col('cSec', 'Texto secundario', d.sec || d.text) + col('cPts', 'Color de los puntos', d.pts || d.text) + col('cBar', 'Barra de progreso', d.bar || d.accent) + '</div>' +
      '<div class="field"><label for="cAng">Ángulo del degradado: <span id="cAngV">' + d.angle + '</span>°</label><input id="cAng" data-cd type="range" min="0" max="360" step="5" value="' + d.angle + '"></div>' +
      sec('Fondo y elementos') + sel('cSt', 'Patrón / estilo', Object.keys(STYLE_LBL).map(function (k) { return [k, STYLE_LBL[k]]; }), d.style) + sel('cIc', 'Icono', Object.keys(ICON_LBL).map(function (k) { return [k, ICON_LBL[k]]; }), d.icon) +
      '<label class="row" style="gap:8px;font-size:13px"><input type="checkbox" id="cLogo" data-cd' + (d.show_logo ? ' checked' : '') + '> Mostrar el logo del restaurante</label>' +
      sec('Tipografía') + sel('cFo', 'Tipografía', Object.keys(FONT_LBL).map(function (k) { return [k, FONT_LBL[k]]; }), d.font) + '<div class="two">' + sel('cSz', 'Tamaño', [['s', 'Pequeño'], ['m', 'Normal'], ['l', 'Grande']], d.size) + sel('cWe', 'Peso', [['500', 'Normal'], ['700', 'Seminegrita'], ['800', 'Negrita']], d.weight) + '</div>' + sel('cAl', 'Alineación', [['left', 'Izquierda'], ['center', 'Centrada']], d.align) +
      sec('Textos') + txt('cTi', 'Nombre de la tarjeta (arriba)', d.title, 30, S.program_name) + txt('cMe', 'Nombre de la membresía', d.membership, 30, 'Ej.: Miembro Casa') + txt('cSu', 'Texto de los puntos', d.points_label || d.subtitle, 30, 'puntos') + txt('cWl', 'Texto de bienvenida', d.welcome, 80, 'Ej.: Gracias por ser parte de la casa') + txt('cRm', 'Mensaje cuando hay premio', d.reward_msg, 80, '¡Ya puedes canjear un premio!') + txt('cCu', 'Texto personalizado', d.custom, 80, 'Ej.: Válida en todas nuestras sedes') +
      '<p class="note" id="cMsg"></p><div class="row"><button class="btn btn-accent" data-lact="savecard">Guardar diseño</button><button class="btn btn-ghost" data-lact="resetcard">Restablecer</button></div></div></div>';
  }
  function cardDesign() {
    var o = { template: curTpl, bg1: $('cBg1').value, bg2: $('cBg2').value, text: $('cTx').value, accent: $('cAc').value, style: $('cSt').value, icon: $('cIc').value, font: $('cFo').value, size: $('cSz').value, weight: $('cWe').value, align: $('cAl').value, angle: Number($('cAng').value), show_logo: $('cLogo').checked,
      title: $('cTi').value.trim(), membership: $('cMe').value.trim(), points_label: $('cSu').value.trim(), welcome: $('cWl').value.trim(), reward_msg: $('cRm').value.trim(), custom: $('cCu').value.trim() };
    if ($('cSec').value !== o.text) o.sec = $('cSec').value; if ($('cPts').value !== o.text) o.pts = $('cPts').value; if ($('cBar').value !== o.accent) o.bar = $('cBar').value;
    return o;
  }
  var curTpl = 'kartta';
  function applyTemplate(k) {
    var t = KARTTA_CARD.TEMPLATES[k]; if (!t) return; curTpl = k;
    var set = function (id, v) { $(id).value = v; }; set('cBg1', t.bg1); set('cBg2', t.bg2); set('cTx', t.text); set('cAc', t.accent); set('cSec', t.text); set('cPts', t.text); set('cBar', t.accent);
    set('cSt', t.style); set('cFo', t.font); set('cWe', t.weight); set('cAl', t.align); set('cIc', t.icon); set('cAng', t.angle);
    document.querySelectorAll('[data-ltpl]').forEach(function (b) { b.style.borderColor = b.dataset.ltpl === k ? 'var(--accent)' : 'var(--border)'; });
    drawPreview();
  }
  function lumOf(h) { var c = [1, 3, 5].map(function (i) { var v = parseInt(h.substr(i, 2), 16) / 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; }
  function ratio(a, b) { var x = lumOf(a), y = lumOf(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
  function drawPreview() {
    var C = M.ctx, d = cardDesign(), el = $('cardPrev'); if (!el) return; $('cAngV').textContent = d.angle;
    var worst = Math.min(ratio(d.text, d.bg1), ratio(d.text, d.bg2));
    $('cMsg').textContent = worst < 4.5 ? 'Contraste del texto bajo (' + worst.toFixed(1) + ':1): cuesta leerlo. Prueba un texto más claro u oscuro.' : 'Contraste del texto ' + worst.toFixed(1) + ':1 — correcto.'; $('cMsg').className = 'note' + (worst < 4.5 ? ' warn' : '');
    var act = rewards.filter(function (r) { return r.active; }).sort(function (a, b) { return a.cost_points - b.cost_points; });
    var nxt = (act[0] && act[0].cost_points) || 500, tier = S.tiers_enabled && (S.tiers || [])[0] ? S.tiers[0].name : '';
    KARTTA_CARD.render(el, { design: d, programName: S.program_name, restaurantName: C.negocio.nombre, logoUrl: C.negocio.logo, customerName: 'Nombre del cliente', last4: '1234', balance: Math.round(nxt * .6), nextCost: nxt, nextName: act[0] ? act[0].name : '', tier: tier, tierEnabled: !!tier, animate: false });
  }

  /* ---------- acciones ---------- */
  document.addEventListener('input', function (e) {
    var id = e.target.id; if (!document.querySelector('[data-panel=fidelizacion].active')) return;
    if (e.target.hasAttribute && e.target.hasAttribute('data-cd')) drawPreview();
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
    if (d.lprof) { await openProfile(d.lprof, b.closest('.ped').querySelector('.lhist')); return; }
    if (d.ltpl) { applyTemplate(d.ltpl); return; }
    if (d.lhist) {
      var box = b.closest('.ped').querySelector('.lhist'); if (box.innerHTML) { box.innerHTML = ''; return; }
      var r = await C.sb.from('loyalty_movements').select('kind,points,balance_after,note,created_at').eq('customer_id', d.lhist).order('created_at', { ascending: false }).limit(30);
      if (r.error) return C.toast('No se pudo cargar el historial.');
      var K = KIND;
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
      case 'saverules': {
        var tiers = []; for (var ti = 0; ti < 3; ti++) { var tn = $('tN' + ti).value.trim(), tm = $('tM' + ti).value; if (tn) tiers.push({ name: tn, min_lifetime: Math.max(0, parseInt(tm || '0', 10) || 0) }); }
        tiers.sort(function (a, b) { return a.min_lifetime - b.min_lifetime; });
        if (await saveSettings({ program_name: $('pName').value.trim() || 'Puntos', points_per_1000: $('pPer').value, min_order_total: $('pMin').value, welcome_points: $('pWel').value, terms: $('pTerms').value, require_identity: $('pReq').checked, tiers_enabled: $('pTierOn').checked && tiers.length > 0, tiers: tiers })) render(); break;
      }
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
        var iso = function (v) { return v ? new Date(v).toISOString() : null; };
        var rv = await C.sb.rpc('loyalty_upsert_reward_v2', { p_restaurant: C.rid, p_id: d.id || null, p: { name: name, description: $('rwDesc').value, cost_points: cost, active: $('rwOn').checked, conditions: $('rwCond').value, valid_from: iso($('rwFrom').value), valid_until: iso($('rwUntil').value), max_per_customer: $('rwMpc').value || null, max_total: $('rwMt').value || null } });
        if (rv.error) return C.toast(errMsg(rv.error)); C.toast('Recompensa guardada.'); await loadAll(); render(); break;
      }
      case 'export': exportCsv(); break;
    }
  });
  function rewardForm(r) {
    var h = $('rform'); if (!h) return; r = r || null;
    var loc = function (v) { if (!v) return ''; var d = new Date(v); var o = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return o.toISOString().slice(0, 16); };
    h.innerHTML = '<div class="card" style="background:var(--panel2);display:grid;gap:12px"><h3>' + (r ? 'Editar recompensa' : 'Nueva recompensa') + '</h3><div class="field"><label for="rwName">Nombre</label><input id="rwName" maxlength="80" value="' + esc(r ? r.name : '') + '" placeholder="Café gratis"></div><div class="field"><label for="rwDesc">Descripción (opcional)</label><input id="rwDesc" maxlength="200" value="' + esc(r ? r.description || '' : '') + '"></div>' + num('rwCost', 'Costo en puntos', r ? r.cost_points : 500, 1, 1000000) +
      '<div class="field"><label for="rwCond">Condiciones especiales (opcional)</label><input id="rwCond" maxlength="200" value="' + esc(r ? r.conditions || '' : '') + '" placeholder="Ej.: no acumulable con otras promociones"></div>' +
      '<div class="two"><div class="field"><label for="rwFrom">Disponible desde</label><input id="rwFrom" type="datetime-local" value="' + loc(r && r.valid_from) + '"></div><div class="field"><label for="rwUntil">Disponible hasta</label><input id="rwUntil" type="datetime-local" value="' + loc(r && r.valid_until) + '"></div></div>' +
      '<div class="two"><div class="field"><label for="rwMpc">Máximo por cliente</label><input id="rwMpc" type="number" min="1" max="1000" value="' + (r && r.max_per_customer ? r.max_per_customer : '') + '" placeholder="Sin límite"></div><div class="field"><label for="rwMt">Límite total de canjes</label><input id="rwMt" type="number" min="1" max="1000000" value="' + (r && r.max_total ? r.max_total : '') + '" placeholder="Sin límite"></div></div>' +
      '<label class="row" style="gap:8px;font-size:13px"><input type="checkbox" id="rwOn"' + (!r || r.active ? ' checked' : '') + '> Visible para los clientes</label><div><button class="btn btn-accent" data-lact="saverw" data-id="' + (r ? r.id : '') + '">Guardar recompensa</button></div></div>'; $('rwName').focus();
  }
  async function openProfile(id, box) {
    var C = M.ctx, c = customers.filter(function (x) { return x.id === id; })[0]; if (!c || !box) return;
    if (box.dataset.open) { box.innerHTML = ''; delete box.dataset.open; return; }
    box.dataset.open = '1'; box.innerHTML = '<div class="note" style="margin-top:10px">Cargando…</div>';
    var res = await Promise.all([C.sb.rpc('loyalty_customer_orders', { p_customer: id }), C.sb.from('loyalty_movements').select('kind,points,balance_after,note,created_at').eq('customer_id', id).order('created_at', { ascending: false }).limit(15)]);
    var o = res[0].data || { orders: [] }, mv = res[1].data || [], nxt = rewards.filter(function (r) { return r.active; }).map(function (r) { return r.cost_points; }).sort(function (a, b) { return a - b; });
    var next = (nxt.filter(function (n) { return n > c.balance; })[0]) || nxt[nxt.length - 1] || 0;
    var ST = { nuevo: 'Recibido', preparando: 'En preparación', listo: 'Listo', entregado: 'Entregado', cancelado: 'Cancelado' };
    box.innerHTML = '<div style="border-top:1px solid var(--border);margin-top:10px;padding-top:12px;display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))"><div><div id="pc-' + id + '" style="max-width:340px"></div></div><div class="note"><strong style="color:var(--strong)">Pedidos (' + (o.orders_count || 0) + ')</strong><br>' +
      ((o.orders || []).slice(0, 8).map(function (x) { return when(x.at) + ' · #' + esc(x.code) + ' · $' + fmt(x.total) + ' · ' + (ST[x.status] || esc(x.status)) + (x.paid ? ' · pagado' : ''); }).join('<br>') || 'Sin pedidos asociados todavía.') +
      '<br><br><strong style="color:var(--strong)">Movimientos de puntos</strong><br>' + (mv.map(function (m) { return when(m.created_at) + ' · ' + (KIND[m.kind] || m.kind) + ' · <strong>' + (m.points > 0 ? '+' : '') + m.points + '</strong>' + (m.note && m.kind !== 'earn' ? ' · ' + esc(m.note) : ''); }).join('<br>') || 'Sin movimientos.') + '</div></div>';
    var tier = null; if (S.tiers_enabled) (S.tiers || []).forEach(function (t) { if (c.lifetime >= t.min_lifetime) tier = t.name; });
    KARTTA_CARD.render($('pc-' + id), { design: S.card, programName: S.program_name, restaurantName: C.negocio.nombre, logoUrl: C.negocio.logo, customerName: c.name || 'Cliente', last4: c.phone.slice(-4), balance: c.balance, nextCost: next, tier: tier, tierEnabled: !!S.tiers_enabled, animate: false });
  }
  function newCustForm() {
    $('lnew').innerHTML = '<div class="card" style="background:var(--panel2);display:grid;gap:12px;max-width:520px"><h3>Nuevo cliente</h3><div class="field"><label for="ncName">Nombre</label><input id="ncName" maxlength="80"></div><div class="field"><label for="ncPhone">WhatsApp / teléfono</label><input id="ncPhone" type="tel" inputmode="tel" placeholder="300 123 4567"></div><label class="row" style="gap:8px;font-size:13px;align-items:flex-start"><input type="checkbox" id="ncConsent" style="margin-top:3px"> El cliente aceptó participar en el programa de puntos y recibir su tarjeta por WhatsApp.</label><div><button class="btn btn-accent" data-lact="savecust">Guardar cliente</button></div></div>'; $('ncName').focus();
  }
  function exportCsv() {
    var cell = function (v) { v = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };   // evita inyección de fórmulas en Excel
    var rows = [['Nombre', 'Teléfono', 'Puntos', 'Puntos históricos', 'Registrado', 'Verificado', 'Acepta promociones']].concat(customers.map(function (c) { return [c.name || '', c.phone, c.balance, c.lifetime, (c.created_at || '').slice(0, 10), c.phone_verified_at ? 'sí' : 'no', c.marketing_consent ? 'sí' : 'no']; }));
    var blob = new Blob(['\ufeff' + rows.map(function (r) { return r.map(cell).join(','); }).join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'clientes-fidelizacion.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
  }

  M.views.fidelizacion = async function () { if (await loadAll()) render(); };
  M.openLoyalty = function (t) { if (TABS.some(function (x) { return x[0] === t; })) tab = t; M.ctx.irA('fidelizacion'); };
})();
