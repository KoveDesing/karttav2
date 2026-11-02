/**
 * KARTTA — Bandeja de soporte (administración). Solo funciona si el usuario es administrador de la plataforma:
 * TODAS las funciones admin_support_* comprueban private.is_platform_admin() en el servidor; si no lo eres, reciben «forbidden».
 * Este archivo no contiene ninguna lista de administradores ni claves. Se monta con KARTTA_SUPPORT_ADMIN.mount(elemento, sb).
 */
(function () {
  'use strict';
  var CAT = { technical: 'Problema técnico', menu: 'Error en el menú digital', orders: 'Problema con pedidos', billing: 'Pagos o suscripción', tables_kitchen: 'Mesas o cocina', images_ai: 'Imágenes o IA', access: 'Acceso o cuenta', help: 'Solicitud de ayuda', suggestion: 'Sugerencia de mejora', other: 'Otro' };
  var PRI = { low: 'Baja', normal: 'Normal', high: 'Alta', urgent: 'Urgente' };
  var ST = { received: 'Recibido', in_review: 'En revisión', in_progress: 'En proceso', waiting_customer: 'Esperando respuesta del restaurante', resolved: 'Resuelto', closed: 'Cerrado' };
  var PLAN = { trial: 'Prueba gratis', free: 'Free', kartta: 'KARTTA', pro: 'KARTTA Pro', custom: 'Personalizado' };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var text = function (s) { return esc(s).replace(/\n/g, '<br>'); };
  var fmt = function (d) { return d ? new Date(d).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; };
  var num = function (n) { return 'KT-' + String(n).padStart(6, '0'); };
  var rid = function () { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : null; };
  var BUCKET = 'support-attachments';

  function mount(root, sb, opts) {
    opts = opts || {};
    var $ = function (id) { return root.querySelector('#' + id); };
    var S = { list: [], ov: null, cur: null, f: { status: '', category: '', priority: '', from: '', to: '', unread: false, needs: false, q: '', restaurant: '' }, mode: 'list', chan: null, busy: false, kind: 'public', denied: false };
    var toast = opts.toast || function (m) { var t = document.getElementById('toast'); if (!t) return; t.textContent = m; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 2800); };
    var errMsg = function (e) { var m = String((e && e.message) || e || ''); if (/forbidden/.test(m)) return 'No tienes permiso de administrador.'; if (/PGRST202|42883|schema cache/.test(m)) return 'Falta aplicar la migración 20261101_soporte_politicas.sql.'; return 'No se pudo completar la acción. Inténtalo de nuevo.'; };

    root.innerHTML = '<div class="ad-top"><div><h1>Centro de soporte</h1><p class="ad-sub">Reportes de todos los restaurantes · datos reales</p></div><button class="btn btn-ghost btn-sm" id="adRefresh">Actualizar</button></div>' +
      '<div class="ad-kpis" id="adKpis"></div><div class="card ad-filters" id="adFilters"></div>' +
      '<div class="ad-grid ad-m-list" id="adGrid"><section class="ad-col ad-c1" aria-label="Lista de reportes"><div id="adList"></div></section><section class="ad-col ad-c2" id="adChat" aria-label="Conversación"></section><aside class="ad-col ad-c3" id="adSide" aria-label="Información del restaurante"></aside></div>';

    /* ---------- datos ---------- */
    async function loadOv() { var r = await sb.rpc('admin_support_overview'); if (r.error) { S.denied = /forbidden/.test(r.error.message); throw r.error; } S.ov = r.data; }
    async function loadList() {
      var f = S.f, r = await sb.rpc('admin_support_list', { p_status: f.status || null, p_category: f.category || null, p_priority: f.priority || null, p_restaurant: f.restaurant || null, p_from: f.from || null, p_to: f.to || null, p_unread_only: f.unread, p_needs_reply: f.needs, p_search: f.q || null, p_limit: 120, p_offset: 0 });
      if (r.error) throw r.error; S.list = r.data || [];
    }
    async function refreshAll() { try { await Promise.all([loadOv(), loadList()]); paintKpis(); paintList(); document.title = (S.ov && S.ov.unread ? '(' + S.ov.unread + ') ' : '') + 'Centro de soporte — KARTTA'; } catch (e) { console.warn(e); paintDenied(e); } }
    function paintDenied(e) { if (S.denied) root.innerHTML = '<div class="card ad-denied"><h2>Acceso restringido</h2><p>Esta sección es solo para administradores de KARTTA.</p></div>'; else $('adList') && ($('adList').innerHTML = '<div class="card"><p class="note warn">' + esc(errMsg(e)) + '</p></div>'); }

    /* ---------- KPIs y filtros ---------- */
    function paintKpis() {
      var o = S.ov || {}, k = [['total', 'Total', '', o.total], ['unread', 'Sin leer', 'unread', o.unread], ['received', 'Nuevos', 'received', o.received], ['in_review', 'En revisión', 'in_review', o.in_review], ['in_progress', 'En proceso', 'in_progress', o.in_progress], ['needs', 'Esperan tu respuesta', 'needs', o.needs_admin_reply], ['waiting_customer', 'Esperan al cliente', 'waiting_customer', o.waiting_customer], ['resolved', 'Resueltos', 'resolved', o.resolved]];
      $('adKpis').innerHTML = k.map(function (x) { return '<button type="button" class="ad-kpi' + (x[0] === 'unread' && o.unread ? ' hot' : '') + '" data-k="' + x[2] + '" aria-label="' + esc(x[1]) + ': ' + (x[3] || 0) + '"><span>' + esc(x[1]) + '</span><b>' + (x[3] == null ? '—' : x[3]) + '</b></button>'; }).join('');
    }
    function opt(map, v) { return Object.keys(map).map(function (k) { return '<option value="' + k + '"' + (v === k ? ' selected' : '') + '>' + esc(map[k]) + '</option>'; }).join(''); }
    function paintFilters() {
      var f = S.f;
      $('adFilters').innerHTML = '<div class="ad-frow"><div class="field grow"><label for="fQ">Buscar</label><input id="fQ" type="search" placeholder="Negocio, ticket (KT-000012) o asunto" value="' + esc(f.q) + '" autocomplete="off"></div>' +
        '<div class="field"><label for="fSt">Estado</label><select id="fSt"><option value="">Todos</option>' + opt(ST, f.status) + '</select></div>' +
        '<div class="field"><label for="fCat">Categoría</label><select id="fCat"><option value="">Todas</option>' + opt(CAT, f.category) + '</select></div>' +
        '<div class="field"><label for="fPr">Prioridad</label><select id="fPr"><option value="">Todas</option>' + opt(PRI, f.priority) + '</select></div>' +
        '<div class="field"><label for="fFrom">Desde</label><input id="fFrom" type="date" value="' + esc(f.from) + '"></div><div class="field"><label for="fTo">Hasta</label><input id="fTo" type="date" value="' + esc(f.to) + '"></div></div>' +
        '<div class="ad-frow chk"><label><input type="checkbox" id="fUn"' + (f.unread ? ' checked' : '') + '> Solo sin leer</label><label><input type="checkbox" id="fNe"' + (f.needs ? ' checked' : '') + '> Necesitan mi respuesta</label>' + (f.restaurant ? '<button class="btn btn-ghost btn-sm" id="fRest">Quitar filtro de restaurante ×</button>' : '') + '<button class="btn btn-ghost btn-sm" id="fClear">Limpiar filtros</button></div>';
    }
    var qT = 0; function applyFilters() { clearTimeout(qT); qT = setTimeout(async function () { try { await loadList(); paintList(); } catch (e) { paintDenied(e); } }, 250); }
    root.addEventListener('input', function (e) {
      var id = e.target.id, f = S.f;
      if (id === 'fQ') f.q = e.target.value.trim(); else if (id === 'fSt') f.status = e.target.value; else if (id === 'fCat') f.category = e.target.value; else if (id === 'fPr') f.priority = e.target.value;
      else if (id === 'fFrom') f.from = e.target.value; else if (id === 'fTo') f.to = e.target.value; else if (id === 'fUn') f.unread = e.target.checked; else if (id === 'fNe') f.needs = e.target.checked; else return;
      applyFilters();
    });

    /* ---------- lista ---------- */
    function paintList() {
      var b = $('adList'); if (!b) return;
      if (!S.list.length) { b.innerHTML = '<div class="card ad-empty"><h3>Sin reportes</h3><p>No hay reportes con estos filtros.</p></div>'; return; }
      b.innerHTML = '<ul class="ad-tl">' + S.list.map(function (t) {
        return '<li><button type="button" class="ad-item' + (S.cur && S.cur.id === t.id ? ' on' : '') + (t.unread ? ' unread' : '') + '" data-t="' + esc(t.id) + '"><span class="ad-r1"><b>' + esc(num(t.ticket_number)) + '</b><span class="ad-pri p-' + esc(t.priority) + '">' + esc(PRI[t.priority]) + '</span><span class="sp-st sp-' + esc(t.status) + '">' + esc(ST[t.status]) + '</span></span>' +
          '<span class="ad-biz">' + esc(t.business_name || 'Negocio eliminado') + '</span><span class="ad-subj">' + esc(t.subject) + '</span><span class="ad-r3">' + esc(CAT[t.category] || '') + ' · ' + esc(fmt(t.last_message_at)) + (t.last_message_by === 'customer' && ['resolved', 'closed', 'waiting_customer'].indexOf(t.status) < 0 ? ' · <b class="ad-need">responder</b>' : '') + (t.unread ? ' <i class="sp-unread">' + t.unread + '</i>' : '') + '</span></button></li>';
      }).join('') + '</ul>';
    }

    /* ---------- ticket ---------- */
    async function open(id) {
      S.mode = 'ticket'; $('adGrid').className = 'ad-grid ad-m-ticket'; S.cur = { id: id };
      $('adChat').innerHTML = '<div class="card"><div class="skel" style="height:20px;width:50%"></div><div class="skel" style="height:14px;width:80%;margin-top:14px"></div></div>'; $('adSide').innerHTML = ''; paintList();
      try { await load(); paint(); await sb.rpc('admin_support_mark_read', { p_ticket: id }); await Promise.all([loadOv(), loadList()]); paintKpis(); paintList(); subscribe(id); }
      catch (e) { console.error(e); $('adChat').innerHTML = '<div class="card"><p class="note warn">' + esc(errMsg(e)) + '</p></div>'; }
    }
    async function load() {
      var id = S.cur.id, r = await Promise.all([sb.rpc('admin_support_get', { p_ticket: id }), sb.from('support_messages').select('id,author_role,author_name,kind,body,created_at').eq('ticket_id', id).order('created_at'), sb.from('support_attachments').select('id,message_id,storage_path,file_name,mime_type,size_bytes').eq('ticket_id', id)]);
      if (r[0].error) throw r[0].error; if (r[1].error) throw r[1].error;
      Object.assign(S.cur, r[0].data, { msgs: r[1].data || [], atts: r[2].data || [], urls: {} });
      if (S.cur.atts.length) { var u = await sb.storage.from(BUCKET).createSignedUrls(S.cur.atts.map(function (a) { return a.storage_path; }), 3600); (u.data || []).forEach(function (x) { if (x.signedUrl) S.cur.urls[x.path] = x.signedUrl; }); }
    }
    function atts(list) { var im = list.filter(function (a) { return S.cur.urls[a.storage_path]; }); return im.length ? '<div class="sp-atts">' + im.map(function (a) { var u = S.cur.urls[a.storage_path]; return '<a class="sp-att" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer" title="' + esc(a.file_name) + '"><img src="' + esc(u) + '" alt="Adjunto: ' + esc(a.file_name) + '" loading="lazy"></a>'; }).join('') + '</div>' : ''; }
    function msg(m) {
      var note = m.kind === 'internal_note', mine = m.author_role === 'admin';
      return '<div class="sp-msg ' + (mine ? 'me' : 'team') + (note ? ' ad-note' : '') + '"><div class="sp-who">' + (note ? '🔒 Nota interna · solo el equipo' : esc(mine ? 'Tú (equipo KARTTA)' : (m.author_name || 'Restaurante'))) + '</div><div class="sp-bub">' + text(m.body) + atts(S.cur.atts.filter(function (a) { return a.message_id === m.id; })) + '</div><time>' + esc(fmt(m.created_at)) + '</time></div>';
    }
    var EVL = { created: 'Reporte creado', status_changed: 'Estado', priority_changed: 'Prioridad', reopened: 'Reabierto', message_public: 'Mensaje enviado', note_internal: 'Nota interna añadida', attachment_added: 'Adjunto añadido' };
    function thread() { return S.cur.msgs.map(msg).join(''); }
    function paint() {
      var c = S.cur, t = c.ticket, r = c.restaurant;
      $('adChat').innerHTML = '<div class="card sp-chat"><div class="sp-head"><button class="sp-back" data-act="back">← Reportes</button><div class="sp-hl"><div><span class="sp-num sm">' + esc(num(t.ticket_number)) + '</span> <span class="sp-st sp-' + esc(t.status) + '" id="adStPill">' + esc(ST[t.status]) + '</span></div><h3>' + esc(t.subject) + '</h3><p class="note">' + esc(CAT[t.category]) + ' · Cliente percibe: ' + esc(PRI[t.perceived_priority]) + ' · ' + esc(fmt(t.created_at)) + '</p></div>' +
        '<div class="ad-acts"><label class="ad-sel">Estado<select id="adSt">' + opt(ST, t.status) + '</select></label><label class="ad-sel">Prioridad<select id="adPr">' + opt(PRI, t.priority) + '</select></label>' +
        (['resolved', 'closed'].indexOf(t.status) >= 0 ? '<button class="btn btn-ghost btn-sm" id="adReopen">Reabrir</button>' : '<button class="btn btn-accent btn-sm" id="adResolve">Marcar como resuelto</button>') + '</div></div>' +
        '<div class="sp-scroll" id="adScroll" role="log" aria-live="polite"><div class="sp-msg team"><div class="sp-who">' + esc(t.creator_name || 'Restaurante') + ' · reporte original</div><div class="sp-bub">' + text(t.description) + atts(c.atts.filter(function (a) { return !a.message_id; })) + '</div><time>' + esc(fmt(t.created_at)) + '</time></div><div id="adThread">' + thread() + '</div></div>' +
        '<form class="sp-compose" id="adReply"><div class="ad-modes" role="tablist"><button type="button" role="tab" class="' + (S.kind === 'public' ? 'on' : '') + '" data-kind="public" aria-selected="' + (S.kind === 'public') + '">Responder al cliente</button><button type="button" role="tab" class="' + (S.kind === 'internal_note' ? 'on' : '') + '" data-kind="internal_note" aria-selected="' + (S.kind === 'internal_note') + '">🔒 Nota interna</button>' +
        (S.kind === 'public' ? '<label class="ad-sel inl">Después de enviar<select id="adAfter"><option value="">Mantener estado</option><option value="in_progress">En proceso</option><option value="waiting_customer">Esperando respuesta del restaurante</option></select></label>' : '') + '</div>' +
        '<div class="sp-cin"><textarea id="adBody" rows="1" maxlength="5000" placeholder="' + (S.kind === 'public' ? 'Escribe tu respuesta…  (Enter envía · Shift+Enter nueva línea)' : 'Nota privada: el restaurante nunca la verá') + '" aria-label="Mensaje"></textarea><button class="btn btn-accent" type="submit" id="adSend" aria-label="Enviar"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/></svg></button></div><p class="sp-fail" id="adFail" role="alert"></p></form></div>';
      var base = location.origin, slug = r.slug, wa = String(r.whatsapp || '').replace(/\D/g, '');
      $('adSide').innerHTML = '<div class="card ad-biz-card"><div class="ad-logo">' + (r.logo_path && window.KARTTA_IMG ? '<img src="' + esc(window.KARTTA_IMG(r.logo_path)) + '" alt="Logo de ' + esc(r.name) + '">' : '<span>' + esc((r.name || '?').charAt(0).toUpperCase()) + '</span>') + '</div><h3>' + esc(r.name || 'Negocio eliminado') + '</h3>' +
        '<dl class="ad-dl"><div><dt>Reporta</dt><dd>' + esc(t.creator_name || '—') + '</dd></div><div><dt>Correo</dt><dd>' + (t.creator_email ? '<a href="mailto:' + esc(t.creator_email) + '">' + esc(t.creator_email) + '</a>' : '—') + '</dd></div>' +
        '<div><dt>WhatsApp</dt><dd>' + (wa ? '<a href="https://wa.me/' + esc(wa) + '" target="_blank" rel="noopener noreferrer">' + esc(r.whatsapp) + '</a>' : '<span class="mut">No configurado</span>') + '</dd></div>' +
        '<div><dt>Plan</dt><dd>' + esc(PLAN[r.plan_id] || r.plan_id || '—') + '</dd></div><div><dt>Suscripción</dt><dd>' + esc(r.subscription_status || '—') + (r.current_period_end ? ' · hasta ' + esc(new Date(r.current_period_end).toLocaleDateString('es-CO')) : '') + '</dd></div>' +
        '<div><dt>ID restaurante</dt><dd class="mono">' + esc(r.id || '—') + '</dd></div><div><dt>Menú público</dt><dd>' + (slug ? '<a href="' + esc(base + '/m/' + encodeURIComponent(slug)) + '" target="_blank" rel="noopener noreferrer">Abrir menú ↗</a>' + (r.is_published ? '' : ' <span class="mut">(no publicado)</span>') : '<span class="mut">Sin identificador</span>') + '</dd></div></dl>' +
        (r.id ? '<button class="btn btn-ghost btn-sm" data-act="rest" data-r="' + esc(r.id) + '">Ver todos sus reportes</button>' : '') + '</div>' +
        '<div class="card"><h4 class="ad-h">Historial de actividad</h4><ul class="ad-ev">' + c.events.map(function (e) { var v = (e.event_type === 'status_changed' || e.event_type === 'reopened') ? ' ' + esc(ST[e.old_value] || e.old_value || '') + ' → <b>' + esc(ST[e.new_value] || e.new_value || '') + '</b>' : e.event_type === 'priority_changed' ? ' ' + esc(PRI[e.old_value]) + ' → <b>' + esc(PRI[e.new_value]) + '</b>' : ''; return '<li><span>' + esc(EVL[e.event_type] || e.event_type) + v + '</span><time>' + esc(fmt(e.created_at)) + '</time></li>'; }).join('') + '</ul></div>';
      var sc = $('adScroll'); sc.scrollTop = sc.scrollHeight;
      var ta = $('adBody'); ta.addEventListener('input', function () { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; });
      ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('adReply').requestSubmit(); } });
      $('adReply').addEventListener('submit', send);
    }
    async function refreshOpen() {
      if (!S.cur || S.mode !== 'ticket') { await refreshAll(); return; }
      var sc = $('adScroll'), stick = sc && sc.scrollHeight - sc.scrollTop - sc.clientHeight < 160, body = $('adBody') && $('adBody').value;
      await load(); var th = $('adThread'); if (th) th.innerHTML = thread(); var p = $('adStPill'); if (p) { p.className = 'sp-st sp-' + S.cur.ticket.status; p.textContent = ST[S.cur.ticket.status]; }
      if (stick && sc) sc.scrollTop = sc.scrollHeight; if (body != null && $('adBody')) $('adBody').value = body;
      await sb.rpc('admin_support_mark_read', { p_ticket: S.cur.id }); await Promise.all([loadOv(), loadList()]); paintKpis(); paintList();
    }
    async function send(e) {
      e.preventDefault(); if (S.busy) return; var ta = $('adBody'), body = ta.value.trim(); if (!body) { ta.focus(); return; }
      S.busy = true; $('adSend').disabled = true; $('adFail').textContent = '';
      try {
        var after = S.kind === 'public' && $('adAfter') ? $('adAfter').value : '';
        var r = await sb.rpc('admin_support_reply', { p_ticket: S.cur.id, p_body: body, p_kind: S.kind, p_set_status: after || null, p_request_id: rid() });
        if (r.error) throw r.error; ta.value = ''; ta.style.height = 'auto';
        await load(); var th = $('adThread'); th.innerHTML = thread(); var sc = $('adScroll'); sc.scrollTop = sc.scrollHeight; $('adSt').value = S.cur.ticket.status; $('adStPill').className = 'sp-st sp-' + S.cur.ticket.status; $('adStPill').textContent = ST[S.cur.ticket.status];
        loadList().then(paintList);
      } catch (er) { $('adFail').textContent = errMsg(er); }
      S.busy = false; $('adSend').disabled = false; ta.focus();
    }
    async function setStatus(v) { try { var r = await sb.rpc('admin_support_set_status', { p_ticket: S.cur.id, p_status: v }); if (r.error) throw r.error; await load(); paint(); await Promise.all([loadOv(), loadList()]); paintKpis(); paintList(); toast('Estado: ' + ST[v]); } catch (e) { toast(errMsg(e)); } }
    async function setPri(v) { try { var r = await sb.rpc('admin_support_set_priority', { p_ticket: S.cur.id, p_priority: v }); if (r.error) throw r.error; await load(); paint(); await loadList(); paintList(); toast('Prioridad: ' + PRI[v]); } catch (e) { toast(errMsg(e)); } }

    /* ---------- tiempo real + notificaciones internas ---------- */
    function subscribe(id) {
      try { if (S.chan) sb.removeChannel(S.chan); } catch (e) { }
      S.chan = sb.channel('kartta-support-admin').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_tickets' }, function (p) { toast('Nuevo reporte: ' + (p.new && p.new.subject || '')); refreshAll(); })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages' }, function (p) {
          var m = p.new || {}; if (m.author_role !== 'customer') return;
          if (S.cur && S.mode === 'ticket' && m.ticket_id === S.cur.id) refreshOpen(); else { toast('Nuevo mensaje de un restaurante'); refreshAll(); }
        }).subscribe();
    }

    /* ---------- eventos ---------- */
    root.addEventListener('click', function (e) {
      var t = e.target.closest('[data-t]'), k = e.target.closest('[data-k]'), a = e.target.closest('[data-act]'), md = e.target.closest('[data-kind]');
      if (t) return open(t.dataset.t);
      if (md) { S.kind = md.dataset.kind; var keep = $('adBody').value; paint(); $('adBody').value = keep; return; }
      if (k) { var v = k.dataset.k; S.f.status = ''; S.f.unread = false; S.f.needs = false; if (v === 'unread') S.f.unread = true; else if (v === 'needs') S.f.needs = true; else if (v) S.f.status = v; paintFilters(); return applyFilters(); }
      if (a && a.dataset.act === 'back') { S.mode = 'list'; $('adGrid').className = 'ad-grid ad-m-list'; return; }
      if (a && a.dataset.act === 'rest') { S.f.restaurant = a.dataset.r; paintFilters(); applyFilters(); return toast('Mostrando los reportes de este restaurante'); }
      if (e.target.id === 'fRest') { S.f.restaurant = ''; paintFilters(); return applyFilters(); }
      if (e.target.id === 'fClear') { S.f = { status: '', category: '', priority: '', from: '', to: '', unread: false, needs: false, q: '', restaurant: '' }; paintFilters(); return applyFilters(); }
      if (e.target.id === 'adRefresh') return refreshAll();
      if (e.target.id === 'adResolve') return setStatus('resolved');
      if (e.target.id === 'adReopen') return setStatus('in_review');
    });
    root.addEventListener('change', function (e) { if (e.target.id === 'adSt') setStatus(e.target.value); if (e.target.id === 'adPr') setPri(e.target.value); });

    paintFilters(); refreshAll(); subscribe();
    return { refresh: refreshAll };
  }
  window.KARTTA_SUPPORT_ADMIN = { mount: mount };
})();
