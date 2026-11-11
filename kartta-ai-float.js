/**
 * KARTTA AI flotante — UNA sola implementación para todo el dashboard.
 * Contrato con el panel: window.KARTTA_CTX ({ sb, rid, toast }) + eventos 'kartta:ready' y 'kartta:view' (detail = id de la sección).
 * Backend: la misma Edge Function `ai-assistant` del chat completo (auth, plan, cuota, aislamiento por restaurante y datos
 * autorizados los decide el servidor). Aquí solo se envía una etiqueta de sección de una lista cerrada; nunca datos ni secretos.
 * Todo texto del usuario o de la IA se inserta con textContent (nunca innerHTML).
 * Acciones: el asistente NO ejecuta cambios. Existe un registro de acciones (KARTTA_AI.registerAction) que SIEMPRE pide confirmación.
 */
(function () {
  'use strict';
  var SECTIONS = {
    inicio: 'Panel principal', productos: 'Productos', menu: 'Editor del menú', personalizar: 'Editor visual', configuracion: 'Configuración', dominio: 'Dominio',
    pedidos: 'Pedidos', metricas: 'Estadísticas', qr: 'Código QR', mesas: 'Mesas', inventario: 'Inventario', clientes: 'Clientes', fidelizacion: 'Fidelización', pagos: 'Pagos', politicas: 'Políticas', soporte: 'Soporte',
  };
  var CHIPS = {
    inicio: ['¿Cómo va mi restaurante este mes?', '¿Qué puedo hacer para vender más?', '¿Qué debería mejorar primero?'],
    productos: ['Escríbeme una descripción para un producto', '¿Cómo organizo mejor mis categorías?', '¿Qué datos debería tener cada producto?'],
    menu: ['¿Cómo hago más atractivo mi menú?', 'Sugiere un orden para mis categorías', '¿Qué información debería agregar?'],
    personalizar: ['¿Cómo hago que mi página se vea más profesional?', '¿Qué colores combinan con mi marca?', '¿Qué debería poner en esta sección?'],
    metricas: ['¿Qué productos se venden más?', '¿Qué días tengo más movimiento?', 'Explícame estas métricas sencillo'],
    pedidos: ['¿Cómo organizo mejor los pedidos en hora pico?', '¿Cómo reduzco el tiempo de entrega?'],
    mesas: ['¿Cómo uso los QR de mesa?', '¿Cómo reparto los QR en el local?'],
    inventario: ['¿Cómo registro una entrada de inventario?', '¿Qué pasa cuando un producto se agota?'],
    clientes: ['¿Cómo fidelizo a mis clientes?', '¿Cómo traigo de vuelta a clientes inactivos?'],
    fidelizacion: ['¿Cuántos puntos por compra me conviene dar?', 'Sugiere recompensas para mi restaurante', '¿Cómo diseño una tarjeta atractiva?'],
    configuracion: ['¿Qué debo configurar primero?', '¿Qué horario conviene mostrar?'],
  };
  var DEFAULT_CHIPS = ['¿Cómo puedo vender más?', 'Explícame cómo funciona esta sección', 'Dame una idea de promoción'];
  var RICON = { up: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 11v9H4v-9zM7 11l4-8a2 2 0 0 1 2 2v4h6a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 17.8 20H7"/></svg>', heart: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7.5-4.6-9-9.5C1.8 7 4 4 7 4c2 0 3.5 1 5 2.8C13.5 5 15 4 17 4c3 0 5.2 3 4 6.5C19.5 15.4 12 20 12 20z"/></svg>', idea: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/></svg>', smile: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 14a5 5 0 0 0 8 0M9 9.5h.01M15 9.5h.01"/></svg>' };
  var RLABEL = { up: 'Me gusta', heart: 'Me encanta', idea: 'Idea', smile: 'Sonrisa' };
  var RLEGACY = { '\uD83D\uDC4D': 'up', '\u2764\uFE0F': 'heart', '\uD83D\uDCA1': 'idea', '\uD83D\uDE02': 'smile', '\uD83D\uDC4B': 'smile' };   // reacciones guardadas antes del cambio a iconos
  var CHECK_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  var REACTIONS = ['up', 'heart', 'idea', 'smile'];
  var S = { sb: null, rid: null, uid: null, cid: null, view: 'inicio', open: false, min: false, busy: false, ctrl: null, loaded: false, actions: {}, react: {}, el: {} };
  var $ = function (t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  var LS = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } },
  };
  var kConv = function () { return 'kartta_aif_conv_' + S.rid + '_' + S.uid; };
  var kReact = function () { return 'kartta_aif_react_' + S.rid + '_' + S.uid; };
  var clock = function (d) { try { return new Date(d || Date.now()).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' }); } catch (e) { return ''; } };
  var svgSend = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  var svgIcons = {
    min: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>',
    x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  };
  function icon(btn, key, label) { btn.innerHTML = svgIcons[key]; btn.setAttribute('aria-label', label); btn.title = label; }

  /* ---------- reacciones ---------- */
  function loadReact() { try { S.react = JSON.parse(LS.get(kReact()) || '{}') || {}; } catch (e) { S.react = {}; } }
  function saveReact() { var k = Object.keys(S.react); if (k.length > 300) k.slice(0, k.length - 300).forEach(function (x) { delete S.react[x]; }); LS.set(kReact(), JSON.stringify(S.react)); }
  /* La IA reacciona SOLO cuando encaja (saludo, gracias, idea); no en cada mensaje. Es una regla local, no una respuesta del modelo. */
  function aiReaction(text) {
    var t = String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (/^(hola|buenas|buenos dias|buen dia|buenas tardes|buenas noches|hey|holi)\b/.test(t) && t.length < 40) return 'smile';
    if (/^(gracias|muchas gracias|mil gracias|genial gracias|perfecto gracias|te agradezco)\b/.test(t) || /\b(me encanto|me sirvio mucho|excelente ayuda)\b/.test(t)) return 'heart';
    if (/^(se me ocurre|tengo una idea|que tal si|y si hacemos|pensaba en)\b/.test(t)) return 'idea';
    return '';
  }

  /* ---------- mensajes ---------- */
  function scrollEnd() { var b = S.el.body; b.scrollTop = b.scrollHeight; }
  function addMsg(role, text, opts) {
    opts = opts || {}; var row = $('div', 'kaf-row ' + role + (opts.error ? ' err' : '')); var bub = $('div', 'kaf-bub', text); row.appendChild(bub);
    var meta = $('div', 'kaf-meta'); var time = $('span', null, clock(opts.at)); meta.appendChild(time);
    var state = null; if (role === 'me') { state = $('span', null, opts.sent === false ? 'Enviando…' : ''); if (opts.sent !== false) state.innerHTML = CHECK_SVG; meta.appendChild(state); }
    var id = opts.id || null;
    var setReaction = function (em) {
      var old = row.querySelector('.kaf-react'); if (old) old.remove();
      em = RLEGACY[em] || em; if (em && RICON[em]) { var r = $('span', 'kaf-react', ''); r.innerHTML = RICON[em]; r.setAttribute('aria-label', 'Reacción: ' + RLABEL[em]); meta.appendChild(r); }
    };
    if (role === 'bot' && !opts.error) {
      var rb = $('button', null, ''); rb.innerHTML = RICON.smile; rb.type = 'button'; rb.setAttribute('aria-label', 'Reaccionar'); rb.title = 'Reaccionar';
      rb.onclick = function (e) {
        e.stopPropagation(); var ex = meta.querySelector('.kaf-picker'); if (ex) return ex.remove();
        var p = $('div', 'kaf-picker'); REACTIONS.forEach(function (em) { var b = $('button', null, ''); b.innerHTML = RICON[em]; b.setAttribute('aria-label', RLABEL[em]); b.type = 'button'; b.onclick = function () { var key = row.dataset.rid; var cur = S.react[key] === em ? '' : em; if (key) { if (cur) S.react[key] = cur; else delete S.react[key]; saveReact(); } setReaction(cur); p.remove(); }; p.appendChild(b); });
        meta.appendChild(p); setTimeout(function () { document.addEventListener('click', function f() { p.remove(); document.removeEventListener('click', f); }, { once: true }); }, 0);
      };
      var cp = $('button', null, 'Copiar'); cp.type = 'button'; cp.onclick = function () { var t = bub.textContent; (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { cp.textContent = 'Copiado'; setTimeout(function () { cp.textContent = 'Copiar'; }, 1500); }, function () { cp.textContent = 'No se pudo'; }); };
      meta.appendChild(rb); meta.appendChild(cp);
    }
    row.appendChild(meta); if (id) row.dataset.rid = id; S.el.body.appendChild(row);
    if (id && S.react[id]) setReaction(S.react[id]);
    scrollEnd();
    return { row: row, bub: bub, state: state, setReaction: setReaction };
  }
  function typing() { var row = $('div', 'kaf-row bot'); var b = $('div', 'kaf-bub kaf-typing'); b.setAttribute('role', 'status'); b.setAttribute('aria-label', 'KARTTA AI está escribiendo'); b.appendChild($('i')); b.appendChild($('i')); b.appendChild($('i')); row.appendChild(b); S.el.body.appendChild(row); scrollEnd(); return row; }
  function chips() {
    var old = S.el.body.querySelector('.kaf-hello-wrap'); if (old) old.remove();
    var w = $('div', 'kaf-hello-wrap'); w.appendChild($('div', 'kaf-hello', 'Hola, soy KARTTA AI. Estás en «' + (SECTIONS[S.view] || 'el panel') + '». Pregúntame lo que necesites.'));
    var c = $('div', 'kaf-chips'); (CHIPS[S.view] || DEFAULT_CHIPS).forEach(function (q) { var b = $('button', 'kaf-chip', q); b.type = 'button'; b.onclick = function () { send(q); }; c.appendChild(b); });
    w.appendChild(c); S.el.body.appendChild(w);
  }

  /* ---------- historial (persistente por restaurante y usuario; la RLS aísla restaurantes) ---------- */
  async function loadHistory() {
    S.el.body.textContent = ''; loadReact(); S.cid = LS.get(kConv()) || null;
    if (S.cid && /^[0-9a-f-]{36}$/i.test(S.cid)) {
      var r = await S.sb.from('ai_messages').select('id,role,content,created_at').eq('conversation_id', S.cid).eq('restaurant_id', S.rid).order('id', { ascending: false }).limit(40);
      if (!r.error && r.data && r.data.length) {
        r.data.slice().reverse().forEach(function (m) { if (m.role === 'user') addMsg('me', m.content, { at: m.created_at, id: 'm' + m.id }); else if (m.role === 'assistant') addMsg('bot', m.content, { at: m.created_at, id: 'm' + m.id }); });
        S.loaded = true; return;
      }
      S.cid = null; LS.set(kConv(), '');
    }
    chips(); S.loaded = true;
  }
  function newChat() { if (S.busy) return; LS.set(kConv(), ''); S.cid = null; S.el.body.textContent = ''; chips(); S.el.text.focus(); }

  /* ---------- envío (SSE de ai-assistant) ---------- */
  async function send(preset) {
    var text = String(preset != null ? preset : S.el.text.value).trim(); if (!text || S.busy) return;
    if (!navigator.onLine) { addMsg('bot', 'Parece que no tienes conexión. Revisa tu internet e intenta de nuevo.', { error: true }); return; }
    var hello = S.el.body.querySelector('.kaf-hello-wrap'); if (hello) hello.remove();
    S.el.text.value = ''; autosize(); setBusy(true);
    var me = addMsg('me', text, { sent: false });
    var react = aiReaction(text); if (react) setTimeout(function () { me.setReaction(react); }, 500);
    var tp = typing(), bot = null, acc = '', failed = false;
    var key = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).replace(/[^A-Za-z0-9_-]/g, '');
    S.ctrl = new AbortController();
    try {
      var ses = await S.sb.auth.getSession(); var tok = ses && ses.data && ses.data.session && ses.data.session.access_token; if (!tok) throw new Error('Tu sesión venció. Vuelve a entrar.');
      var resp = await fetch(S.sb.supabaseUrl + '/functions/v1/ai-assistant', { method: 'POST', signal: S.ctrl.signal,
        headers: { Authorization: 'Bearer ' + tok, apikey: S.sb.supabaseKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurant_id: S.rid, conversation_id: S.cid || undefined, message: text, request_key: key, section: SECTIONS[S.view] ? S.view : undefined }) });
      var ct = resp.headers.get('content-type') || '';
      if (!resp.ok || ct.indexOf('application/json') >= 0) {
        var j = await resp.json().catch(function () { return {}; }); tp.remove();
        if (me.state) me.state.innerHTML = CHECK_SVG;
        if (resp.ok && typeof j.reply === 'string' && j.reply.trim()) {
          if (j.conversation_id) { S.cid = j.conversation_id; LS.set(kConv(), S.cid); }
          bot = addMsg('bot', j.reply.trim()); return;
        }
        if (j.blocked && j.reply) { if (j.conversation_id) { S.cid = j.conversation_id; LS.set(kConv(), S.cid); } addMsg('bot', j.reply); return; }
        addMsg('bot', j.message || (j.error === 'monthly_limit' ? 'Alcanzaste el límite mensual de preguntas de IA de tu plan.' : 'No pude responder ahora. Intenta de nuevo en un momento.'), { error: true }); return;
      }
      if (me.state) me.state.innerHTML = CHECK_SVG;
      var ensureBot = function () { if (!bot) { tp.remove(); bot = addMsg('bot', ''); } return bot; };
      var reader = resp.body.getReader(), dec = new TextDecoder(), pending = '';
      while (true) {
        var chunk = await reader.read(); if (chunk.done) break;
        pending += dec.decode(chunk.value, { stream: true }); var i;
        while ((i = pending.indexOf('\n\n')) >= 0) {
          var raw = pending.slice(0, i); pending = pending.slice(i + 2); var ev = 'message', data = '';
          raw.split('\n').forEach(function (ln) { if (ln.indexOf('event:') === 0) ev = ln.slice(6).trim(); else if (ln.indexOf('data:') === 0) data += ln.slice(5).trim(); });
          var d; try { d = JSON.parse(data || '{}'); } catch (e) { continue; }
          if (ev === 'meta' && d.conversation_id) { S.cid = d.conversation_id; LS.set(kConv(), S.cid); }
          else if (ev === 'delta' && d.t) { acc += d.t; ensureBot().bub.textContent = acc; scrollEnd(); }
          else if (ev === 'replace' && d.text) { acc = d.text; ensureBot().bub.textContent = acc; }
          else if (ev === 'error') { failed = true; ensureBot(); if (!acc) bot.bub.textContent = d.message || 'No pude responder ahora.'; bot.row.classList.add('err'); }
          else if (ev === 'done' && d.message_id && bot) { bot.row.dataset.rid = 'm' + d.message_id; }
        }
      }
      if (!acc && !failed) { ensureBot().bub.textContent = 'No tengo una respuesta ahora. ¿Lo intentamos de nuevo?'; }
    } catch (e) {
      tp.remove(); if (me.state) me.state.textContent = '';
      if (e && e.name === 'AbortError') { if (bot && !acc) bot.row.remove(); }
      else {
        var retry = $('button', null, 'No enviado · Reintentar'); retry.type = 'button'; if (me.state) { me.state.textContent = ''; me.state.appendChild(retry); retry.onclick = function () { me.row.remove(); send(text); }; }
        addMsg('bot', (e && e.message && e.message.length < 140 ? e.message : 'No pude conectarme. Revisa tu internet e intenta de nuevo.'), { error: true });
      }
    } finally { setBusy(false); S.ctrl = null; }
  }

  /* ---------- acciones con confirmación (arquitectura; sin acciones que modifiquen datos por ahora) ---------- */
  function registerAction(def) {
    if (!def || !/^[a-z0-9_.-]{2,40}$/.test(def.id || '') || typeof def.run !== 'function') throw new Error('Acción inválida');
    S.actions[def.id] = { id: def.id, label: String(def.label || def.id).slice(0, 60), describe: def.describe, run: def.run, destructive: !!def.destructive };
  }
  function proposeAction(id, payload) {
    var a = S.actions[id]; if (!a) return false; open();
    var card = $('div', 'kaf-act'); card.appendChild($('div', null, (a.describe ? a.describe(payload) : a.label)));
    var r = $('div', 'r'), ok = $('button', 'ok', 'Confirmar'), no = $('button', 'no', 'Cancelar'); ok.type = no.type = 'button';
    ok.onclick = async function () { ok.disabled = no.disabled = true; try { await a.run(payload); addMsg('bot', 'Listo: ' + a.label + '.'); } catch (e) { addMsg('bot', 'No pude aplicar el cambio.', { error: true }); } card.remove(); };
    no.onclick = function () { card.remove(); addMsg('bot', 'De acuerdo, no hice ningún cambio.'); };
    r.append(ok, no); card.appendChild(r); var row = $('div', 'kaf-row bot'); row.style.maxWidth = '94%'; row.appendChild(card); S.el.body.appendChild(row); scrollEnd(); return true;
  }

  /* ---------- UI ---------- */
  function setBusy(b) { S.busy = b; S.el.sendBtn.disabled = b; S.el.text.setAttribute('aria-busy', b ? 'true' : 'false'); }
  function autosize() { var t = S.el.text; t.style.height = 'auto'; t.style.height = Math.min(110, t.scrollHeight) + 'px'; }
  function clampPos(p) { var w = innerWidth, h = innerHeight; return { x: Math.max(8, Math.min(w - 64, p.x)), y: Math.max(8, Math.min(h - 64, p.y)) }; }
  function placeBtn() {
    var p = null; try { p = JSON.parse(LS.get('kartta_aif_pos') || 'null'); } catch (e) { p = null; }
    var pos = p && isFinite(p.fx) && isFinite(p.fy) ? clampPos({ x: p.fx * innerWidth, y: p.fy * innerHeight }) : { x: innerWidth - 74, y: innerHeight - 82 };
    S.el.btn.style.left = pos.x + 'px'; S.el.btn.style.top = pos.y + 'px'; S.el.btn.style.right = 'auto'; S.el.btn.style.bottom = 'auto'; placeCard();
  }
  function placeCard() {
    if (innerWidth <= 640) { S.el.card.style.left = S.el.card.style.top = ''; return; }
    var b = S.el.btn.getBoundingClientRect(), c = S.el.card, w = Math.min(380, innerWidth - 24), h = Math.min(580, innerHeight - 110);
    var left = b.left + b.width / 2 > innerWidth / 2 ? b.right - w : b.left; left = Math.max(12, Math.min(innerWidth - w - 12, left));
    var above = b.top + b.height / 2 > innerHeight / 2; var top = above ? b.top - (S.min ? 64 : h) - 12 : b.bottom + 12; top = Math.max(12, Math.min(innerHeight - (S.min ? 64 : h) - 12, top));
    c.style.left = left + 'px'; c.style.top = top + 'px'; c.style.right = c.style.bottom = 'auto';
    c.style.setProperty('--kaf-ox', (b.left + b.width / 2 - left) + 'px'); c.style.setProperty('--kaf-oy', above ? '100%' : '0%');
  }
  function open() { if (S.open) return; S.open = true; S.min = false; S.el.card.hidden = false; S.el.card.dataset.min = '0'; S.el.btn.dataset.open = '1'; S.el.btn.setAttribute('aria-expanded', 'true'); placeCard(); if (!S.loaded) loadHistory(); setTimeout(function () { S.el.text.focus(); scrollEnd(); }, 60); }
  function close() { S.open = false; S.el.card.hidden = true; S.el.btn.dataset.open = '0'; S.el.btn.setAttribute('aria-expanded', 'false'); S.el.btn.focus(); }
  function toggleMin() { S.min = !S.min; S.el.card.dataset.min = S.min ? '1' : '0'; placeCard(); }
  function setView(v) { S.view = SECTIONS[v] ? v : S.view; if (S.el.sec) S.el.sec.textContent = SECTIONS[S.view] || ''; var hide = v === 'ia'; if (S.el.btn) { S.el.btn.style.display = hide ? 'none' : ''; if (hide && S.open) { S.el.card.hidden = true; } else if (!hide && S.open) { S.el.card.hidden = false; } }
    var hello = S.el.body && S.el.body.querySelector('.kaf-hello-wrap'); if (hello) chips(); }

  function build() {
    var btn = $('button', 'kaf-btn'); btn.type = 'button'; btn.setAttribute('aria-label', 'Abrir KARTTA AI'); btn.setAttribute('aria-haspopup', 'dialog'); btn.setAttribute('aria-expanded', 'false');
    var mark = $('span', 'kaf-mark'); mark.appendChild(document.createTextNode('K')); var bb = $('b', null, 'a'); mark.appendChild(bb); btn.appendChild(mark); btn.appendChild($('span', 'kaf-dot')); btn.appendChild($('span', 'kaf-tag', 'AI'));
    var card = $('div', 'kaf-card'); card.hidden = true; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'KARTTA AI');
    var head = $('div', 'kaf-head'); var av = $('div', 'kaf-av'); av.appendChild(document.createTextNode('K')); av.appendChild($('b', null, 'a'));
    var tt = $('div', 'kaf-sp'); tt.appendChild($('div', 'kaf-ttl', 'KARTTA AI')); var sub = $('div', 'kaf-sub'); sub.appendChild($('i')); sub.appendChild($('span', null, 'Disponible')); sub.appendChild($('span', null, '·')); var sec = $('span', 'kaf-sec', ''); sub.appendChild(sec); tt.appendChild(sub);
    var bNew = $('button', 'kaf-ib'); bNew.type = 'button'; icon(bNew, 'plus', 'Nueva conversación'); var bMin = $('button', 'kaf-ib'); bMin.type = 'button'; icon(bMin, 'min', 'Minimizar'); var bX = $('button', 'kaf-ib'); bX.type = 'button'; icon(bX, 'x', 'Cerrar');
    head.append(av, tt, bNew, bMin, bX);
    var body = $('div', 'kaf-body'); body.setAttribute('role', 'log'); body.setAttribute('aria-live', 'polite');
    var foot = $('div', 'kaf-foot'); var ta = $('textarea'); ta.rows = 1; ta.maxLength = 2000; ta.placeholder = 'Escribe tu pregunta…'; ta.setAttribute('aria-label', 'Mensaje para KARTTA AI');
    var sb = $('button', 'kaf-send'); sb.type = 'button'; sb.innerHTML = svgSend; sb.setAttribute('aria-label', 'Enviar'); foot.append(ta, sb);
    card.append(head, body, foot); document.body.append(btn, card);
    S.el = { btn: btn, card: card, body: body, text: ta, sendBtn: sb, sec: sec };
    bX.onclick = close; bMin.onclick = toggleMin; bNew.onclick = newChat; sb.onclick = function () { send(); };
    ta.addEventListener('input', autosize); ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
    card.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    /* arrastrar el botón (umbral de 6 px para distinguir clic de arrastre) */
    var drag = null;
    btn.addEventListener('pointerdown', function (e) { if (e.button > 0) return; var r = btn.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY, moved: false }; btn.setPointerCapture(e.pointerId); });
    btn.addEventListener('pointermove', function (e) { if (!drag) return; if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return; drag.moved = true; var p = clampPos({ x: e.clientX - drag.dx, y: e.clientY - drag.dy }); btn.style.left = p.x + 'px'; btn.style.top = p.y + 'px'; if (S.open) placeCard(); });
    btn.addEventListener('pointerup', function (e) { if (!drag) return; var moved = drag.moved; drag = null; try { btn.releasePointerCapture(e.pointerId); } catch (x) { /* ya liberado */ } if (moved) { var r = btn.getBoundingClientRect(); LS.set('kartta_aif_pos', JSON.stringify({ fx: r.left / innerWidth, fy: r.top / innerHeight })); } else { S.open ? close() : open(); } });
    btn.addEventListener('keydown', function (e) { var step = e.shiftKey ? 40 : 14, r = btn.getBoundingClientRect(), m = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]; if (e.altKey && m) { e.preventDefault(); var p = clampPos({ x: r.left + m[0], y: r.top + m[1] }); btn.style.left = p.x + 'px'; btn.style.top = p.y + 'px'; LS.set('kartta_aif_pos', JSON.stringify({ fx: p.x / innerWidth, fy: p.y / innerHeight })); placeCard(); } });
    addEventListener('resize', placeBtn);
    placeBtn();
  }

  async function init(ctx) {
    if (S.el.btn || !ctx || !ctx.sb || !ctx.rid) return;
    S.sb = ctx.sb; S.rid = ctx.rid;
    try { var u = await S.sb.auth.getUser(); S.uid = u && u.data && u.data.user && u.data.user.id; } catch (e) { S.uid = null; }
    if (!S.uid) return;
    build(); setView(S.view);
  }
  window.KARTTA_AI = { registerAction: registerAction, proposeAction: proposeAction, open: open, close: close, setSection: setView };
  window.addEventListener('kartta:view', function (e) { setView(e.detail); });
  window.addEventListener('kartta:ready', function () { init(window.KARTTA_CTX); });
  if (window.KARTTA_CTX) init(window.KARTTA_CTX);
})();
