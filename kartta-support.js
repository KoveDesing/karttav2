/**
 * KARTTA — «Soporte y reportes» y «Políticas y privacidad» (panel del restaurante).
 * - La identidad (usuario, restaurante, correo, plan) NO viaja desde el navegador: la fija el servidor con auth.uid()
 *   dentro de support_create_ticket / support_reply. Aquí solo se envían asunto, categoría, texto y archivos.
 * - Lectura por RLS (cada negocio ve solo sus tickets; las notas internas no llegan nunca a este cliente).
 * - Los textos legales vienen de la tabla central legal_document_versions (no hay copias por restaurante).
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var M = window.KARTTA_MODS; if (!M) { console.error('[KARTTA] kartta-modules.js no cargó: soporte no disponible'); return; }
  var esc = function (s) { return M.esc(s); };
  var C = null, BUCKET = 'support-attachments';
  var CAT = { technical: 'Problema técnico', menu: 'Error en el menú digital', orders: 'Problema con pedidos', billing: 'Problema con pagos o suscripción', tables_kitchen: 'Problema con mesas o cocina', images_ai: 'Problema con imágenes o inteligencia artificial', access: 'Problema de acceso o cuenta', help: 'Solicitud de ayuda', suggestion: 'Sugerencia de mejora', other: 'Otro' };
  var PRI = { low: 'Baja', normal: 'Normal', high: 'Alta', urgent: 'Urgente' };
  var ST = { received: 'Recibido', in_review: 'En revisión', in_progress: 'En proceso', waiting_customer: 'Esperando tu respuesta', resolved: 'Resuelto', closed: 'Cerrado' };
  var ERR = { forbidden: 'No tienes permiso para hacer esto.', not_authenticated: 'Tu sesión expiró. Vuelve a iniciar sesión.', rate_limited: 'Estás enviando demasiado rápido. Espera unos minutos e inténtalo de nuevo.', invalid_subject: 'El asunto debe tener entre 3 y 140 caracteres.', invalid_description: 'Describe el problema con al menos 10 caracteres (máximo 5.000).', invalid_body: 'Escribe un mensaje (máximo 5.000 caracteres).', ticket_closed: 'Este reporte está cerrado. Crea uno nuevo si necesitas ayuda.', file_too_large: 'Cada imagen debe pesar máximo 5 MB.', invalid_type: 'Solo se permiten imágenes PNG, JPG o WEBP.', too_many_files: 'Este reporte ya tiene demasiados archivos.' };
  var fmtDT = function (d) { return d ? new Date(d).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; };
  var fmtD = function (d) { return d ? new Date(d + (String(d).length === 10 ? 'T12:00:00' : '')).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'long', year: 'numeric' }) : '—'; };
  var num = function (n) { return 'KT-' + String(n).padStart(6, '0'); };
  var rid = function () { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : null; };
  function errMsg(e) {
    var m = String((e && (e.message || e.error_description)) || e || '');
    for (var k in ERR) if (m.indexOf(k) >= 0) return ERR[k];
    if (/PGRST202|42883|does not exist|schema cache/i.test(m)) return 'El centro de soporte aún no está habilitado en la base de datos (falta aplicar la migración 20261101_soporte_politicas.sql).';
    return 'No se pudo completar la acción. Inténtalo de nuevo.';
  }
  var text = function (s) { return esc(s).replace(/\n/g, '<br>'); };

  /* ---------- imágenes: validación local (tipo real por cabecera, no solo por extensión) ---------- */
  var MAX_FILES = 5, MAX_BYTES = 5 * 1024 * 1024;
  async function sniff(file) {
    var b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return { mime: 'image/png', ext: 'png' };
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return { mime: 'image/jpeg', ext: 'jpg' };
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { mime: 'image/webp', ext: 'webp' };
    return null;
  }
  async function checkFiles(files, already) {
    var ok = [], bad = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (already + ok.length >= MAX_FILES) { bad.push(f.name + ': máximo ' + MAX_FILES + ' imágenes'); continue; }
      if (f.size > MAX_BYTES) { bad.push(f.name + ': pesa más de 5 MB'); continue; }
      if (f.size === 0) { bad.push(f.name + ': está vacío'); continue; }
      var t = await sniff(f); if (!t) { bad.push(f.name + ': solo PNG, JPG o WEBP'); continue; }
      ok.push({ file: f, mime: t.mime, ext: t.ext });
    }
    return { ok: ok, bad: bad };
  }
  async function uploadAll(ticketId, messageId, items) {
    var failed = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i], path = C.rid + '/' + ticketId + '/' + (rid() || (Date.now() + '-' + i)) + '.' + it.ext;
      try {
        var up = await C.sb.storage.from(BUCKET).upload(path, it.file, { contentType: it.mime, cacheControl: '3600', upsert: false });
        if (up.error) throw up.error;
        var rec = await C.sb.rpc('support_add_attachment', { p_ticket: ticketId, p_message: messageId, p_path: path, p_name: it.file.name, p_mime: it.mime, p_size: it.file.size });
        if (rec.error) throw rec.error;
      } catch (e) { console.warn('[KARTTA] adjunto', e); failed.push(it.file.name); }
    }
    return failed;
  }
  async function signed(paths) {
    var map = {}; if (!paths.length) return map;
    var r = await C.sb.storage.from(BUCKET).createSignedUrls(paths, 3600);
    (r.data || []).forEach(function (x) { if (x.signedUrl) map[x.path] = x.signedUrl; });
    return map;
  }
  function pickerHtml(id) {
    return '<div class="sp-files"><input type="file" id="' + id + '" accept="image/png,image/jpeg,image/webp" multiple hidden><button type="button" class="btn btn-ghost btn-sm" data-pick="' + id + '"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l9-9a3.7 3.7 0 0 1 5.2 5.2l-9 9a1.8 1.8 0 0 1-2.6-2.6l8.3-8.3"/></svg>Adjuntar imagen</button><span class="note">PNG, JPG o WEBP · hasta ' + MAX_FILES + ' · 5 MB cada una</span><ul class="sp-chips" id="' + id + 'List" aria-live="polite"></ul></div>';
  }
  function bindPicker(id, store) {
    var inp = $(id), list = $(id + 'List'); if (!inp) return;
    function paint() { list.innerHTML = store.items.map(function (it, i) { return '<li><span>' + esc(it.file.name) + '</span><button type="button" data-rm="' + i + '" aria-label="Quitar ' + esc(it.file.name) + '">×</button></li>'; }).join(''); }
    inp.addEventListener('change', async function () {
      var r = await checkFiles(Array.prototype.slice.call(inp.files), store.items.length); inp.value = '';
      store.items = store.items.concat(r.ok); paint();
      if (r.bad.length) C.toast(r.bad[0] + (r.bad.length > 1 ? ' (y ' + (r.bad.length - 1) + ' más)' : ''));
    });
    list.addEventListener('click', function (e) { var b = e.target.closest('[data-rm]'); if (b) { store.items.splice(+b.dataset.rm, 1); paint(); } });
    inp.parentNode.querySelector('[data-pick]').addEventListener('click', function () { inp.click(); });
    store.paint = paint;
  }

  /* =====================================================================================
   * SOPORTE Y REPORTES
   * ===================================================================================== */
  var S = { list: [], mode: 'list', cur: null, loaded: false, unavailable: false, chan: null, chanT: null, draft: { rid: null }, files: { items: [] }, replyFiles: { items: [] }, sending: false };
  var host = function () { return $('modSupport'); };

  async function loadList() {
    var r = await C.sb.rpc('support_my_tickets', { p_restaurant: C.rid });
    if (r.error) { S.unavailable = /PGRST202|42883|does not exist|schema cache/i.test(r.error.message || ''); throw r.error; }
    S.list = r.data || []; S.loaded = true; S.unavailable = false; setBadge();
  }
  function setBadge() {
    var n = S.list.reduce(function (a, t) { return a + (t.unread || 0); }, 0), b = $('lkSupport'); if (!b) return;
    b.hidden = !n; b.textContent = n > 99 ? '99+' : n; b.classList.toggle('sp-badge', !!n);
    b.setAttribute('aria-label', n + ' mensajes sin leer del equipo de KARTTA');
  }
  function pill(st) { return '<span class="sp-st sp-' + st + '">' + esc(ST[st] || st) + '</span>'; }

  function renderShell() {
    var h = host(); if (!h) return;
    h.innerHTML = '<div class="vhead row between"><div><h2>Soporte y reportes</h2><p>Cuéntanos qué pasó y el equipo de KARTTA te responde aquí mismo. Tus reportes y sus respuestas quedan guardados.</p></div>' +
      '<button class="btn btn-accent" id="spNew">+ Nuevo reporte</button></div>' +
      '<div class="sp-wrap sp-' + S.mode + '"><aside class="sp-list card" aria-label="Mis reportes"><div id="spListBody"></div></aside><section class="sp-main" id="spMain" aria-live="polite"></section></div>';
    $('spNew').onclick = function () { openNew(); };
    paintList(); paintMain();
  }
  function paintList() {
    var b = $('spListBody'); if (!b) return;
    if (S.unavailable) { b.innerHTML = '<p class="note warn">El centro de soporte aún no está habilitado en la base de datos.</p>'; return; }
    if (!S.loaded) { b.innerHTML = '<div class="skel" style="height:16px;width:60%"></div><div class="skel" style="height:14px;width:80%;margin-top:12px"></div><div class="skel" style="height:14px;width:70%;margin-top:12px"></div>'; return; }
    if (!S.list.length) { b.innerHTML = '<div class="sp-empty"><div class="ic" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg></div><h3>Aún no tienes reportes</h3><p>Cuando algo no funcione o tengas una idea, crea un reporte y lo verás aquí.</p></div>'; return; }
    b.innerHTML = '<h3 class="sp-h">Mis reportes</h3><ul class="sp-tl">' + S.list.map(function (t) {
      return '<li><button type="button" class="sp-item' + (S.cur && S.cur.id === t.id ? ' on' : '') + '" data-t="' + esc(t.id) + '"><span class="sp-r1"><b>' + esc(num(t.ticket_number)) + '</b>' + pill(t.status) + '</span><span class="sp-subj">' + esc(t.subject) + '</span><span class="sp-r3">' + esc(CAT[t.category] || '') + ' · ' + esc(fmtDT(t.last_message_at)) + (t.unread ? ' <i class="sp-unread" aria-label="' + t.unread + ' sin leer">' + t.unread + '</i>' : '') + '</span></button></li>';
    }).join('') + '</ul>';
  }
  function paintMain() {
    var m = $('spMain'); if (!m) return;
    if (S.mode === 'new') return paintForm(m);
    if (S.mode === 'done') return;
    if (S.mode === 'ticket' && S.cur) return;
    m.innerHTML = '<div class="card sp-empty big"><div class="ic" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v4M12 16v.01"/><circle cx="12" cy="12" r="9"/></svg></div><h3>¿Algo no funciona como esperabas?</h3><p>Crea un reporte con el detalle y, si puedes, una captura de pantalla. Te contestamos por este mismo chat.</p><button class="btn btn-accent" data-act="new">Reportar un problema</button></div>';
  }

  function openNew() {
    S.mode = 'new'; S.cur = null; S.files.items = []; unsub();
    var w = host().querySelector('.sp-wrap'); if (w) w.className = 'sp-wrap sp-new';
    paintList(); paintMain(); var s = $('spSubject'); if (s) s.focus();
  }
  function paintForm(m) {
    if (!S.draft.rid) S.draft.rid = rid();
    m.innerHTML = '<form class="card sp-form" id="spForm" novalidate><button type="button" class="sp-back" data-act="back">← Mis reportes</button><h3>Nuevo reporte</h3><p class="sub">Cuanto más claro, más rápido podemos ayudarte.</p>' +
      '<div class="field"><label for="spSubject">Asunto *</label><input id="spSubject" maxlength="140" autocomplete="off" required><small class="sp-err" id="eSubject"></small></div>' +
      '<div class="sp-two"><div class="field"><label for="spCat">Categoría *</label><select id="spCat">' + Object.keys(CAT).map(function (k) { return '<option value="' + k + '">' + esc(CAT[k]) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="spPri">Prioridad percibida</label><select id="spPri">' + ['low', 'normal', 'high', 'urgent'].map(function (k) { return '<option value="' + k + '"' + (k === 'normal' ? ' selected' : '') + '>' + PRI[k] + '</option>'; }).join('') + '</select><small class="note">Es tu referencia; el equipo confirma la prioridad real.</small></div></div>' +
      '<div class="field"><label for="spDesc">Descripción detallada *</label><textarea id="spDesc" rows="6" maxlength="5000" required placeholder="¿Qué intentabas hacer? ¿Qué pasó? ¿Desde cuándo?"></textarea><div class="sp-cnt"><small class="sp-err" id="eDesc"></small><small class="note" id="spCnt">0 / 5000</small></div></div>' +
      '<div class="field"><label>Capturas (opcional)</label>' + pickerHtml('spFile') + '</div>' +
      '<p class="note">Se enviará con tu usuario y tu negocio. No incluyas contraseñas ni datos de tarjetas.</p>' +
      '<div class="row"><button type="submit" class="btn btn-accent" id="spSend">Enviar reporte</button><button type="button" class="btn btn-ghost" data-act="back">Cancelar</button></div><p class="sp-fail" id="spFail" role="alert"></p></form>';
    bindPicker('spFile', S.files);
    $('spDesc').addEventListener('input', function () { $('spCnt').textContent = $('spDesc').value.length + ' / 5000'; });
    $('spForm').addEventListener('submit', submitNew);
  }
  async function submitNew(e) {
    e.preventDefault(); if (S.sending) return;
    var subj = $('spSubject').value.trim(), desc = $('spDesc').value.trim(), ok = true;
    $('eSubject').textContent = subj.length < 3 ? 'Escribe un asunto de al menos 3 caracteres.' : ''; if (subj.length < 3) ok = false;
    $('eDesc').textContent = desc.length < 10 ? 'Cuéntanos un poco más (mínimo 10 caracteres).' : ''; if (desc.length < 10) ok = false;
    if (!ok) { (subj.length < 3 ? $('spSubject') : $('spDesc')).focus(); return; }
    var btn = $('spSend'); S.sending = true; btn.disabled = true; btn.textContent = 'Enviando…'; $('spFail').textContent = '';
    try {
      var r = await C.sb.rpc('support_create_ticket', { p_restaurant: C.rid, p_subject: subj, p_category: $('spCat').value, p_priority: $('spPri').value, p_description: desc, p_request_id: S.draft.rid });
      if (r.error) throw r.error;
      var t = r.data, failed = [];
      if (S.files.items.length && !t.duplicate) failed = await uploadAll(t.id, null, S.files.items);
      S.draft.rid = null; S.files.items = [];
      await loadList().catch(function () { });
      S.mode = 'done'; showDone(t, failed);
    } catch (er) { console.error(er); $('spFail').textContent = errMsg(er); btn.disabled = false; btn.textContent = 'Enviar reporte'; }
    S.sending = false;
  }
  function showDone(t, failed) {
    paintList();
    $('spMain').innerHTML = '<div class="card sp-done"><div class="sp-check" aria-hidden="true"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div><h3>¡Reporte recibido!</h3><p class="sub">Tu número de ticket es</p><div class="sp-num" id="spNum">' + esc(num(t.ticket_number)) + '</div><p>Estado actual: ' + pill(t.status) + '</p>' +
      (failed.length ? '<p class="note warn">No se pudieron subir: ' + esc(failed.join(', ')) + '. Puedes volver a adjuntarlas desde la conversación.</p>' : '') +
      '<p class="note">Te avisaremos aquí mismo cuando el equipo responda.</p><div class="row" style="justify-content:center"><button class="btn btn-accent" data-open="' + esc(t.id) + '">Ver conversación</button><button class="btn btn-ghost" data-act="new">Crear otro reporte</button></div></div>';
    var n = $('spNum'); if (n) n.focus && n.setAttribute('tabindex', '-1');
  }

  /* ---------- conversación ---------- */
  async function openTicket(id) {
    S.mode = 'ticket'; S.replyFiles.items = []; S.cur = { id: id, msgs: [], atts: [], events: [], urls: {} };
    var w = host().querySelector('.sp-wrap'); if (w) w.className = 'sp-wrap sp-ticket';
    paintList(); $('spMain').innerHTML = '<div class="card"><div class="skel" style="height:20px;width:50%"></div><div class="skel" style="height:14px;width:80%;margin-top:14px"></div><div class="skel" style="height:14px;width:65%;margin-top:10px"></div></div>';
    try { await loadTicket(); paintTicket(); await markRead(); subscribe(id); }
    catch (e) { console.error(e); $('spMain').innerHTML = '<div class="card"><p class="note warn">' + esc(errMsg(e)) + '</p><button class="btn btn-ghost" data-act="back">Volver</button></div>'; }
  }
  async function loadTicket() {
    var id = S.cur.id, q = C.sb;
    var r = await Promise.all([
      q.from('support_tickets').select('id,ticket_number,subject,category,perceived_priority,status,description,created_at,last_message_at,business_name').eq('id', id).single(),
      q.from('support_messages').select('id,author_role,author_name,body,created_at,kind').eq('ticket_id', id).order('created_at'),
      q.from('support_attachments').select('id,message_id,storage_path,file_name,mime_type,size_bytes,created_at').eq('ticket_id', id).order('created_at'),
      q.from('support_ticket_events').select('id,event_type,old_value,new_value,created_at').eq('ticket_id', id).order('created_at')
    ]);
    if (r[0].error) throw r[0].error; if (r[1].error) throw r[1].error;
    S.cur.t = r[0].data; S.cur.msgs = (r[1].data || []).filter(function (m) { return m.kind === 'public'; });
    S.cur.atts = r[2].data || []; S.cur.events = r[3].data || [];
    S.cur.urls = await signed(S.cur.atts.map(function (a) { return a.storage_path; })).catch(function () { return {}; });
  }
  function attsHtml(list) {
    var imgs = list.filter(function (a) { return S.cur.urls[a.storage_path]; });
    if (!imgs.length) return list.length ? '<p class="note">Adjuntos no disponibles por ahora.</p>' : '';
    return '<div class="sp-atts">' + imgs.map(function (a) { var u = S.cur.urls[a.storage_path]; return '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer" class="sp-att" title="' + esc(a.file_name) + '"><img src="' + esc(u) + '" alt="Adjunto: ' + esc(a.file_name) + '" loading="lazy"></a>'; }).join('') + '</div>';
  }
  function bubble(m, mine) {
    var as = S.cur.atts.filter(function (a) { return a.message_id === m.id; });
    return '<div class="sp-msg ' + (mine ? 'me' : 'team') + '" data-id="' + esc(m.id) + '"><div class="sp-who">' + esc(mine ? 'Tú' : (m.author_name || 'Equipo KARTTA')) + '</div><div class="sp-bub">' + text(m.body) + attsHtml(as) + '</div><time datetime="' + esc(m.created_at) + '">' + esc(fmtDT(m.created_at)) + '</time></div>';
  }
  function thread() {
    var c = S.cur, items = [];
    c.events.filter(function (e) { return e.event_type === 'status_changed' || e.event_type === 'reopened'; }).forEach(function (e) { items.push({ at: e.created_at, html: '<div class="sp-ev"><span>' + (e.event_type === 'reopened' ? 'Reporte reabierto' : 'Estado: ' + esc(ST[e.old_value] || e.old_value) + ' → <b>' + esc(ST[e.new_value] || e.new_value) + '</b>') + ' · ' + esc(fmtDT(e.created_at)) + '</span></div>' }); });
    c.msgs.forEach(function (m) { items.push({ at: m.created_at, html: bubble(m, m.author_role === 'customer') }); });
    items.sort(function (a, b) { return a.at < b.at ? -1 : 1; });
    return items.map(function (i) { return i.html; }).join('');
  }
  function paintTicket() {
    var c = S.cur, t = c.t, closed = t.status === 'closed', first = c.atts.filter(function (a) { return !a.message_id; });
    $('spMain').innerHTML = '<div class="card sp-chat"><div class="sp-head"><button type="button" class="sp-back" data-act="back">← Mis reportes</button><div class="sp-hl"><div><span class="sp-num sm">' + esc(num(t.ticket_number)) + '</span> ' + pill(t.status) + '</div><h3>' + esc(t.subject) + '</h3><p class="note">' + esc(CAT[t.category] || '') + ' · Prioridad percibida: ' + esc(PRI[t.perceived_priority] || '') + ' · Creado ' + esc(fmtDT(t.created_at)) + '</p></div></div>' +
      '<div class="sp-scroll" id="spScroll" role="log" aria-live="polite" aria-label="Conversación del reporte"><div class="sp-msg me"><div class="sp-who">Tú · reporte original</div><div class="sp-bub">' + text(t.description) + attsHtml(first) + '</div><time datetime="' + esc(t.created_at) + '">' + esc(fmtDT(t.created_at)) + '</time></div><div id="spThread">' + thread() + '</div></div>' +
      (t.status === 'waiting_customer' ? '<p class="sp-wait">El equipo está esperando tu respuesta.</p>' : '') +
      (closed ? '<p class="sp-wait">Este reporte está cerrado. Si el problema continúa, crea uno nuevo.</p>' :
        '<form class="sp-compose" id="spReply"><div class="sp-cin"><textarea id="spBody" rows="1" maxlength="5000" placeholder="Escribe tu mensaje…  (Enter envía · Shift+Enter nueva línea)" aria-label="Mensaje"></textarea><button type="submit" class="btn btn-accent" id="spSendR" aria-label="Enviar mensaje"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/></svg></button></div>' + pickerHtml('spFileR') + '<p class="sp-fail" id="spFailR" role="alert"></p></form>') + '</div>';
    toBottom(true);
    if (!closed) {
      bindPicker('spFileR', S.replyFiles);
      var ta = $('spBody');
      ta.addEventListener('input', function () { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; });
      ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('spReply').requestSubmit(); } });
      $('spReply').addEventListener('submit', sendReply);
    }
  }
  function toBottom(force) { var s = $('spScroll'); if (!s) return; if (force || s.scrollHeight - s.scrollTop - s.clientHeight < 160) s.scrollTop = s.scrollHeight; }
  async function sendReply(e) {
    e.preventDefault(); if (S.sending) return;
    var ta = $('spBody'), body = ta.value.trim(); if (!body) { ta.focus(); return; }
    var btn = $('spSendR'), reqId = rid(); S.sending = true; btn.disabled = true; $('spFailR').textContent = '';
    try {
      var r = await C.sb.rpc('support_reply', { p_ticket: S.cur.id, p_body: body, p_request_id: reqId });
      if (r.error) throw r.error;
      var failed = S.replyFiles.items.length ? await uploadAll(S.cur.id, r.data.id, S.replyFiles.items) : [];
      ta.value = ''; ta.style.height = 'auto'; S.replyFiles.items = []; if (S.replyFiles.paint) S.replyFiles.paint();
      if (failed.length) $('spFailR').textContent = 'Mensaje enviado, pero no se pudieron subir: ' + failed.join(', ');
      await refreshOpen();
    } catch (er) { console.error(er); $('spFailR').textContent = errMsg(er); }
    S.sending = false; btn.disabled = false; ta.focus();
  }
  async function refreshOpen() {
    if (S.mode !== 'ticket' || !S.cur) return;
    var th = $('spThread'); if (!th) return;
    await loadTicket(); S.cur.t && (document.querySelector('.sp-hl .sp-st') && (document.querySelector('.sp-hl .sp-st').outerHTML = pill(S.cur.t.status)));
    var s = $('spScroll'), stick = s && (s.scrollHeight - s.scrollTop - s.clientHeight < 160);
    th.innerHTML = thread(); if (stick) toBottom(true);
    await markRead(); loadList().then(paintList).catch(function () { });
  }
  async function markRead() { if (!S.cur) return; try { var r = await C.sb.rpc('support_mark_read', { p_ticket: S.cur.id }); if (!r.error && r.data) { await loadList(); paintList(); } } catch (e) { } }

  /* ---------- tiempo real ---------- */
  function unsub() { if (S.chan) { try { C.sb.removeChannel(S.chan); } catch (e) { } S.chan = null; } clearInterval(S.chanT); }
  function subscribe(id) {
    unsub();
    try {
      S.chan = C.sb.channel('kartta-support-' + id).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages', filter: 'ticket_id=eq.' + id }, function (p) { if (p.new && p.new.kind === 'public') refreshOpen().catch(function () { }); })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'support_tickets', filter: 'id=eq.' + id }, function () { refreshOpen().catch(function () { }); }).subscribe();
    } catch (e) { console.warn('[KARTTA] realtime soporte', e); }
    S.chanT = setInterval(function () { if (document.visibilityState === 'visible' && S.mode === 'ticket') refreshOpen().catch(function () { }); }, 30000);   // respaldo si el tiempo real falla
  }
  var globalChan = null;
  function watchGlobal() {
    try {
      globalChan = C.sb.channel('kartta-support-all-' + C.rid).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'support_tickets', filter: 'restaurant_id=eq.' + C.rid }, async function (p) {
        var was = S.list.reduce(function (a, t) { return a + (t.unread || 0); }, 0);
        await loadList().catch(function () { }); paintList();
        var now = S.list.reduce(function (a, t) { return a + (t.unread || 0); }, 0);
        if (now > was && !(S.mode === 'ticket' && document.querySelector('[data-panel="soporte"].active'))) C.toast('El equipo de KARTTA respondió tu reporte.');
      }).subscribe();
    } catch (e) { console.warn(e); }
  }

  function bindSupport() {
    var h = host(); if (!h || h._bound) return; h._bound = true;
    h.addEventListener('click', function (e) {
      var o = e.target.closest('[data-open]'), t = e.target.closest('[data-t]'), a = e.target.closest('[data-act]');
      if (o) return openTicket(o.dataset.open);
      if (t) return openTicket(t.dataset.t);
      if (a && a.dataset.act === 'new') return openNew();
      if (a && a.dataset.act === 'back') { S.mode = 'list'; S.cur = null; unsub(); var w = h.querySelector('.sp-wrap'); if (w) w.className = 'sp-wrap sp-list'; paintList(); paintMain(); }
    });
  }
  async function renderSupport() {
    if (!C) return;
    if (!host().firstChild) { bindSupport(); renderShell(); }
    try { await loadList(); } catch (e) { console.warn('[KARTTA] soporte', e); }
    paintList(); if (S.mode === 'list') paintMain();
  }

  /* =====================================================================================
   * POLÍTICAS Y PRIVACIDAD
   * ===================================================================================== */
  var L = { docs: {}, contact: null, tab: 'privacy', loaded: false, err: false };
  var TABS = [['privacy', 'Política de privacidad'], ['data_processing', 'Tratamiento de datos personales'], ['terms', 'Términos y condiciones'], ['cookies', 'Cookies y tecnologías similares'], ['security', 'Seguridad y protección'], ['rights', 'Derechos y solicitudes'], ['contact', 'Contacto legal y privacidad']];
  var LINKS = { 'Contacto legal y privacidad': 'contact', 'Derechos y solicitudes': 'rights', 'Soporte y reportes': 'soporte', 'política de privacidad': 'privacy' };
  function linkify(s) {
    var h = esc(s);
    Object.keys(LINKS).forEach(function (k) {
      var ek = esc(k); h = h.split('«' + ek + '»').join('<a href="#" class="lg-a" data-lg="' + LINKS[k] + '">«' + ek + '»</a>');
      if (k === 'política de privacidad') h = h.split(ek).join('<a href="#" class="lg-a" data-lg="privacy">' + ek + '</a>');
    });
    return h;
  }
  async function loadLegal() {
    var r = await Promise.all([
      C.sb.from('legal_document_versions').select('doc_type,version,title,summary,content,legal_review,effective_date,published_at').eq('status', 'published'),
      C.sb.from('legal_contact').select('legal_name,nit,address,privacy_email,phone,updated_at').eq('id', true).maybeSingle()
    ]);
    if (r[0].error) { L.err = true; throw r[0].error; }
    L.docs = {}; (r[0].data || []).forEach(function (d) { L.docs[d.doc_type] = d; });
    L.contact = r[1].error ? null : r[1].data; L.loaded = true; L.err = false;
  }
  function seenMap() { return ((C.perfil && C.perfil.prefs && C.perfil.prefs.legalSeen) || {}); }
  function isNew(dt) { var s = seenMap(), d = L.docs[dt]; return !!(d && s[dt] && s[dt] !== d.version); }
  async function markSeen(dt) {
    var d = L.docs[dt]; if (!d) return; var s = seenMap(); if (s[dt] === d.version) return;
    try { await C.savePrefs({ legalSeen: Object.assign({}, s, (function (o) { o[dt] = d.version; return o; })({})) }); } catch (e) { }
  }
  function contactHtml() {
    var c = L.contact || {}, row = function (l, v, mail) { return '<div class="lg-row"><dt>' + l + '</dt><dd>' + (v ? (mail ? '<a href="mailto:' + esc(v) + '">' + esc(v) + '</a>' : esc(v)) : '<span class="lg-pend">Pendiente de configuración</span>') + '</dd></div>'; };
    var any = c.legal_name || c.nit || c.address || c.privacy_email || c.phone;
    return '<h3>Contacto legal y privacidad</h3><p class="lg-sum">Canal para consultas sobre datos personales y asuntos legales.</p>' + (any ? '' : '<div class="lg-banner">Los datos del responsable aún no se han configurado. Mientras tanto, puedes escribirnos desde <a href="#" class="lg-a" data-lg="soporte">Soporte y reportes</a>.</div>') +
      '<dl class="lg-dl">' + row('Responsable', c.legal_name) + row('NIT', c.nit) + row('Dirección', c.address) + row('Correo de privacidad', c.privacy_email, true) + row('Teléfono', c.phone) + '</dl>' +
      '<div class="row" style="margin-top:16px"><button class="btn btn-accent" data-lg="soporte">Enviar una solicitud desde Soporte</button></div>';
  }
  function docHtml(dt) {
    if (dt === 'contact') return contactHtml();
    var d = L.docs[dt]; if (!d) return '<h3>' + esc((TABS.filter(function (t) { return t[0] === dt; })[0] || [])[1] || '') + '</h3><div class="lg-banner">Este documento todavía no está publicado.</div>';
    var secs = Array.isArray(d.content) ? d.content : [];
    var rel = TABS.filter(function (t) { return t[0] !== dt && t[0] !== 'contact' && L.docs[t[0]]; }).slice(0, 4);
    return '<h3>' + esc(d.title) + '</h3>' + (d.summary ? '<p class="lg-sum">' + esc(d.summary) + '</p>' : '') +
      '<div class="lg-meta"><span>Versión <b>' + esc(d.version) + '</b></span><span>Vigente desde <b>' + esc(fmtD(d.effective_date)) + '</b></span><span>Última publicación <b>' + esc(fmtD((d.published_at || '').slice(0, 10))) + '</b></span></div>' +
      secs.map(function (s) {
        var ps = Array.isArray(s.p) ? s.p : [s.p];
        return '<section class="lg-sec"><h4>' + esc(s.h) + '</h4>' + (ps.length > 1 ? '<ul>' + ps.map(function (x) { return '<li>' + linkify(x) + '</li>'; }).join('') + '</ul>' : ps.map(function (x) { return '<p>' + linkify(x) + '</p>'; }).join('')) + '</section>';
      }).join('') +
      '<div class="lg-rel"><span>Relacionados:</span>' + rel.map(function (t) { return '<a href="#" class="lg-a" data-lg="' + t[0] + '">' + esc(t[1]) + '</a>'; }).join('') + '<a href="#" class="lg-a" data-lg="contact">Contacto legal</a></div>';
  }
  function paintLegal() {
    var h = $('modLegal'); if (!h) return;
    h.innerHTML = '<div class="vhead"><h2>Políticas y privacidad</h2><p>Cómo tratamos la información de tu cuenta y de tu restaurante, y qué puedes hacer con ella.</p></div>' +
      '<div class="lg-wrap"><nav class="lg-nav card" aria-label="Documentos legales"><div role="tablist" aria-orientation="vertical" id="lgTabs">' + TABS.map(function (t) {
        return '<button type="button" role="tab" id="lgt-' + t[0] + '" aria-selected="' + (L.tab === t[0]) + '" aria-controls="lgPanel" tabindex="' + (L.tab === t[0] ? 0 : -1) + '" data-lg="' + t[0] + '">' + esc(t[1]) + (isNew(t[0]) ? '<i class="lg-new">Nueva versión</i>' : '') + '</button>';
      }).join('') + '</div></nav><article class="lg-doc card" id="lgPanel" role="tabpanel" tabindex="0" aria-labelledby="lgt-' + L.tab + '">' + docHtml(L.tab) + '</article></div>';
  }
  async function renderLegal() {
    var h = $('modLegal'); if (!h) return;
    if (!h._bound) {
      h._bound = true;
      h.addEventListener('click', function (e) { var b = e.target.closest('[data-lg]'); if (!b) return; e.preventDefault(); goLegal(b.dataset.lg); });
      h.addEventListener('keydown', function (e) {
        var t = e.target.closest('[role=tab]'); if (!t) return; var ids = TABS.map(function (x) { return x[0]; }), i = ids.indexOf(t.dataset.lg), n = null;
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') n = (i + 1) % ids.length; else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') n = (i - 1 + ids.length) % ids.length; else if (e.key === 'Home') n = 0; else if (e.key === 'End') n = ids.length - 1;
        if (n !== null) { e.preventDefault(); goLegal(ids[n]); var nb = $('lgt-' + ids[n]); if (nb) nb.focus(); }
      });
    }
    if (!L.loaded) { h.innerHTML = '<div class="card"><div class="skel" style="height:18px;width:40%"></div><div class="skel" style="height:14px;width:80%;margin-top:12px"></div><div class="skel" style="height:14px;width:70%;margin-top:10px"></div></div>'; try { await loadLegal(); } catch (e) { console.warn('[KARTTA] legal', e); h.innerHTML = '<div class="vhead"><h2>Políticas y privacidad</h2></div><div class="card"><p class="note warn" style="margin:0">No pudimos cargar los documentos ahora mismo. Inténtalo de nuevo en unos minutos' + (/PGRST205|does not exist|schema cache/i.test(String(e && e.message)) ? ' (falta aplicar la migración 20261101_soporte_politicas.sql).' : '.') + '</p></div>'; return; } }
    paintLegal(); markSeen(L.tab);
  }
  function goLegal(k) {
    if (k === 'soporte') { C.irA('soporte'); return; }
    L.tab = k; paintLegal(); markSeen(k); var p = $('lgPanel'); if (p && window.innerWidth < 900) p.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- ciclo de vida ---------- */
  M.views.soporte = renderSupport; M.views.politicas = renderLegal;
  window.addEventListener('kartta:ready', function () {
    C = window.KARTTA_CTX;
    loadList().then(function () { setBadge(); }).catch(function () { });
    watchGlobal();
  }, { once: true });
})();
