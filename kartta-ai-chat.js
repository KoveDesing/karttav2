/**
 * KARTTA AI — chat completo del dashboard.
 * Contrato con el panel: window.KARTTA_CTX ({ sb, rid, toast }) + eventos 'kartta:ready' y 'kartta:view'.
 * Toda la seguridad (plan, cuota, permisos, aislamiento) la decide el servidor; este archivo solo muestra y llama.
 * Todo texto del usuario o de la IA se inserta con textContent (nunca innerHTML).
 */
(function () {
  'use strict';
  const PRICING = 'index.html#precios';
  const ADVISOR = 'https://wa.me/573152507850?text=' + encodeURIComponent('Hola KARTTA, quiero hablar con un asesor sobre mi plan.');
  const ICON = {
    plus: '<path d="M12 5v14M5 12h14"/>', menu: '<path d="M4 7h16M4 12h16M4 17h16"/>', send: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>', clip: '<path d="M21 12l-8.5 8.5a5 5 0 0 1-7-7L14 5a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 8"/>',
    edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>', trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
  };
  const svg = (k, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const num = (n) => Number(n || 0).toLocaleString('es-CO');
  const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion:reduce)').matches;
  const PRICE = { trial: '$0 COP / mes', free: '$0 COP / mes', kartta: '$43.900 COP / mes', pro: '$84.900 COP / mes', custom: '' };

  const S = { sb: null, rid: null, convs: [], cid: null, usage: null, busy: false, ctrl: null, img: null, imgUrl: null, built: false, loaded: false, limitDismissed: false, lastMsg: null };
  let el = {};

  /* ---------------- construcción de la interfaz ---------------- */
  function build() {
    const mount = document.getElementById('aiMount'); if (!mount || S.built) return;
    S.built = true;
    const root = h('div', 'kai'); root.id = 'kai'; el.root = root;
    root.innerHTML = `
      <aside class="kai-side" id="kaiSide" aria-label="Conversaciones">
        <button type="button" class="kai-new" id="kaiNew">${svg('plus')}Nueva conversación</button>
        <div class="kai-list" id="kaiList" role="list"></div>
        <div class="kai-usage" id="kaiUsage" aria-live="polite"></div>
        <button type="button" class="kai-mem" id="kaiMemBtn">Memoria del restaurante</button>
      </aside>
      <div class="kai-scrim" id="kaiScrim"></div>
      <section class="kai-main">
        <header class="kai-head">
          <button type="button" class="tg" id="kaiToggle" aria-label="Mostrar u ocultar conversaciones">${svg('menu', 20)}</button>
          <h3 id="kaiTitle">Nueva conversación</h3>
          <span class="kai-chip plan" id="kaiPlanChip"></span>
          <span class="kai-chip" id="kaiStatus" hidden></span>
        </header>
        <div class="kai-msgs" id="kaiMsgs" aria-live="polite"></div>
        <div class="kai-note" id="kaiNote" role="status"></div>
        <div class="kai-attach" id="kaiAttach" hidden><img id="kaiAttachImg" alt="Foto adjunta"><span id="kaiAttachName"></span><button type="button" class="btn btn-ghost btn-sm" id="kaiAttachDel">Quitar</button></div>
        <form class="kai-form" id="kaiForm" autocomplete="off">
          <button type="button" class="ib2" id="kaiClip" aria-label="Adjuntar foto" title="Adjuntar foto">${svg('clip')}</button>
          <input type="file" id="kaiFile" accept="image/jpeg,image/png,image/webp" hidden>
          <textarea id="kaiText" rows="1" maxlength="1500" placeholder="Pregunta lo que quieras…" aria-label="Mensaje"></textarea>
          <button type="submit" class="ib2 send" id="kaiSend" aria-label="Enviar">${svg('send')}</button>
        </form>
      </section>`;
    mount.appendChild(root);
    ['kaiList', 'kaiUsage', 'kaiMsgs', 'kaiNote', 'kaiTitle', 'kaiStatus', 'kaiPlanChip', 'kaiText', 'kaiSend', 'kaiForm', 'kaiAttach', 'kaiAttachImg', 'kaiAttachName', 'kaiFile'].forEach((id) => (el[id] = document.getElementById(id)));
    document.getElementById('kaiNew').onclick = () => { newChat(); closeSide(); };
    document.getElementById('kaiToggle').onclick = toggleSide;
    document.getElementById('kaiScrim').onclick = closeSide;
    document.getElementById('kaiMemBtn').onclick = openMemory;
    document.getElementById('kaiClip').onclick = () => el.kaiFile.click();
    document.getElementById('kaiAttachDel').onclick = clearImg;
    el.kaiFile.onchange = pickImg;
    el.kaiForm.addEventListener('submit', (e) => { e.preventDefault(); if (S.busy) return; send(); });
    el.kaiSend.addEventListener('click', (e) => { if (S.busy) { e.preventDefault(); stop(); } });
    el.kaiText.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!S.busy) send(); } });
    el.kaiText.addEventListener('input', autosize);
    el.kaiText.addEventListener('focus', () => { if (innerWidth <= 900) document.body.classList.add('kai-typing'); setTimeout(scrollEnd, 250); });
    el.kaiText.addEventListener('blur', () => document.body.classList.remove('kai-typing'));
    if (innerWidth <= 900) el.root.classList.add('collapsed');
    renderWelcome();
  }
  const autosize = () => { el.kaiText.style.height = 'auto'; el.kaiText.style.height = Math.min(140, el.kaiText.scrollHeight) + 'px'; };
  const toggleSide = () => { if (innerWidth <= 900) el.root.classList.toggle('side-open'); else el.root.classList.toggle('collapsed'); };
  const closeSide = () => el.root.classList.remove('side-open');
  const scrollEnd = () => { const m = el.kaiMsgs; if (m) m.scrollTop = m.scrollHeight; };

  /* ---------------- uso y plan ---------------- */
  async function loadUsage() {
    if (!S.sb || !S.rid) return null;
    try {
      const { data, error } = await S.sb.rpc('ai_usage_summary', { p_restaurant_id: S.rid });
      if (error) throw error; S.usage = data; renderUsage(); return data;
    } catch (e) { console.warn('uso IA', e); el.kaiUsage && (el.kaiUsage.textContent = 'No pude cargar tu consumo ahora.'); return null; }
  }
  function tween(node, to) {
    const from = Number(node.dataset.v || 0); node.dataset.v = to;
    if (reduce() || from === to) { node.textContent = num(to); return; }
    const t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / 450); node.textContent = num(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  function renderUsage() {
    const u = S.usage; if (!u || !el.kaiUsage) return;
    const box = el.kaiUsage; box.textContent = '';
    const adv = u.contact_advisor, pct = adv || !u.quota ? 0 : Math.min(100, Math.round((u.used / u.quota) * 100));
    const head = h('h4'); head.append(h('span', null, 'Tu uso de IA'), h('span', null, u.plan_name || '')); box.appendChild(head);
    if (adv) {
      const b = h('div', 'big'); b.append(h('span', null, num(u.used)), h('small', null, ' preguntas este mes')); box.appendChild(b);
      box.appendChild(h('div', null, 'Tu plan se gestiona con un asesor.'));
      const a = h('a', null, 'Hablar con un asesor'); a.href = ADVISOR; a.target = '_blank'; a.rel = 'noopener'; box.appendChild(a);
    } else {
      const big = h('div', 'big'); const n = h('span'); n.dataset.v = '0'; big.append(n, h('small', null, ' / ' + num(u.quota) + ' preguntas')); box.appendChild(big); tween(n, u.used);
      const bar = h('div', 'kai-bar' + (u.limit_reached ? ' full' : u.warn ? ' warn' : '')); bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', String(u.quota)); bar.setAttribute('aria-valuenow', String(u.used));
      const i = h('i'); bar.appendChild(i); box.appendChild(bar); requestAnimationFrame(() => (i.style.width = pct + '%'));
      const r = h('div', 'row2'); r.append(h('span', null, u.remaining + (u.remaining === 1 ? ' pregunta disponible' : ' preguntas disponibles'))); box.appendChild(r);
      if (u.warn) box.appendChild(h('div', 'warnmsg', 'Te quedan pocas preguntas este mes.'));
      const lnk = upgradeLink(u); if (lnk) { const wrap = h('div'); wrap.style.marginTop = '6px'; wrap.appendChild(lnk); box.appendChild(wrap); }
    }
    const tk = h('div', 'tok');
    tk.append(h('div', null, `Tokens de entrada: ${num(u.tokens_in)}`), h('div', null, `Tokens de salida: ${num(u.tokens_out)}`), h('div', null, `Consumo total: ${num(u.tokens_total)}`));
    if (u.tokens_unsplit > 0) tk.appendChild(h('div', null, `(incluye ${num(u.tokens_unsplit)} de uso anterior sin desglose)`));
    box.appendChild(tk);
    el.kaiPlanChip.textContent = (u.plan_name || '') + (adv || !u.quota ? '' : ` · ${num(u.quota)}/mes`);
    // tarjetas del Inicio
    const st = document.getElementById('sumTokens'), ss = document.getElementById('sumTokensSub');
    if (st) st.textContent = num(u.tokens_total); if (ss) ss.textContent = adv ? 'Plan con asesor' : `${num(u.used)} / ${num(u.quota)} preguntas`;
    const note = el.kaiNote;
    if (u.warn) { note.className = 'kai-note show warn'; note.textContent = `Has usado el ${pct}% de tus preguntas de IA este mes. Te quedan ${u.remaining}.`; }
    else if (!u.limit_reached && !adv) note.className = 'kai-note';
    lockComposer();
  }
  /** Enlace de mejora SOLO cuando corresponde (no se ofrece a quien ya tiene cuota de sobra). */
  function upgradeLink(u) {
    const id = u.plan_id, left = u.quota ? u.remaining / u.quota : 1;
    const link = (txt, href, ext) => { const a = h('a', null, txt); a.href = href; if (ext) { a.target = '_blank'; a.rel = 'noopener'; } return a; };
    if (id === 'free' || id === 'trial') return link('Ver planes', PRICING);
    if (id === 'kartta' && left <= 0.2) return link('Ver planes', PRICING);
    if (id === 'pro' && u.limit_reached) return link('Hablar con un asesor', ADVISOR, true);
    return null;
  }
  function lockComposer() {
    const u = S.usage, blocked = !!u && (u.limit_reached || u.contact_advisor) && S.limitDismissed;
    el.kaiText.disabled = blocked || S.busy; el.kaiSend.disabled = blocked && !S.busy;
    el.kaiText.placeholder = blocked ? (u.contact_advisor ? 'Tu plan se gestiona con un asesor' : 'Sin preguntas disponibles este mes') : 'Pregunta lo que quieras…';
    if (blocked) { el.kaiNote.className = 'kai-note show warn'; el.kaiNote.textContent = ''; const b = h('button', 'lnk', u.contact_advisor ? 'Hablar con un asesor' : 'Ver opciones de plan'); b.type = 'button'; b.style.cssText = 'color:var(--accent);font-weight:700'; b.onclick = () => showLimit(S.usage); el.kaiNote.append(u.contact_advisor ? 'Necesitas un asesor para definir tu cuota de IA. ' : 'Alcanzaste el límite mensual de tu plan. ', b); }
  }

  /* ---------------- ventana de límite alcanzado ---------------- */
  function modal(build) {
    const bg = h('div', 'modal-bg show'); bg.setAttribute('role', 'dialog'); bg.setAttribute('aria-modal', 'true');
    const m = h('div', 'modal kai-modal'); bg.appendChild(m);
    const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey); bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
    build(m, close); document.body.appendChild(bg); return close;
  }
  function showLimit(u) {
    u = u || S.usage || {};
    const adv = !!u.contact_advisor;
    modal((m, close) => {
      m.setAttribute('aria-labelledby', 'kaiLimT');
      const t = h('h3', null, adv ? 'Tu plan de IA se gestiona con un asesor' : 'Has utilizado todas tus preguntas de IA'); t.id = 'kaiLimT'; m.appendChild(t);
      m.appendChild(h('p', 'sub', adv
        ? 'Tu plan Personalizado no tiene una cuota fija: un asesor define contigo las condiciones del servicio de IA.'
        : 'Has alcanzado el límite mensual de tu plan actual. Mejora tu plan para obtener más preguntas y seguir utilizando las herramientas de inteligencia artificial de KARTTA.'));
      if (!adv) m.appendChild(h('div', 'planline', `Plan actual: ${u.plan_name || 'Free'} · ${num(u.quota)} preguntas al mes (usadas: ${num(u.used)})`));
      const row = h('div', 'row');
      const main = h('a', 'btn btn-accent', adv ? 'Hablar con un asesor' : 'Ver planes y mejorar'); main.href = adv ? ADVISOR : PRICING; if (adv) { main.target = '_blank'; main.rel = 'noopener'; }
      row.appendChild(main);
      if (!adv && u.plan_id === 'pro') { const a2 = h('a', 'btn btn-ghost', 'Hablar con un asesor'); a2.href = ADVISOR; a2.target = '_blank'; a2.rel = 'noopener'; row.appendChild(a2); }
      const later = h('button', 'btn btn-ghost', 'Más tarde'); later.type = 'button'; later.onclick = () => { S.limitDismissed = true; close(); lockComposer(); };
      row.appendChild(later); m.appendChild(row);
      setTimeout(() => main.focus(), 30);
    });
  }

  /* ---------------- conversaciones ---------------- */
  async function loadConvs() {
    try {
      const { data, error } = await S.sb.from('ai_conversations').select('id,title,last_message_at').eq('restaurant_id', S.rid).order('last_message_at', { ascending: false }).limit(100);
      if (error) throw error; S.convs = data || [];
    } catch (e) { console.warn('chats', e); S.convs = []; }
    renderList();
  }
  function renderList() {
    const L = el.kaiList; L.textContent = '';
    if (!S.convs.length) { L.appendChild(h('div', 'kai-empty-list', 'Aún no tienes conversaciones. Escribe tu primera pregunta y se guardará aquí.')); return; }
    for (const c of S.convs) {
      const it = h('div', 'kai-item' + (c.id === S.cid ? ' active' : '')); it.setAttribute('role', 'listitem'); it.tabIndex = 0;
      it.appendChild(h('span', 't', c.title));
      const ed = h('button', 'ib'); ed.type = 'button'; ed.innerHTML = svg('edit', 15); ed.setAttribute('aria-label', 'Renombrar'); ed.onclick = (e) => { e.stopPropagation(); rename(it, c); };
      const del = h('button', 'ib'); del.type = 'button'; del.innerHTML = svg('trash', 15); del.setAttribute('aria-label', 'Eliminar'); del.onclick = (e) => { e.stopPropagation(); confirmDelete(c); };
      it.append(ed, del);
      it.onclick = () => { openConv(c.id); closeSide(); };
      it.onkeydown = (e) => { if (e.key === 'Enter' && e.target === it) openConv(c.id); };
      L.appendChild(it);
    }
  }
  function rename(it, c) {
    const t = it.querySelector('.t'), inp = h('input'); inp.value = c.title; inp.maxLength = 120; inp.setAttribute('aria-label', 'Nuevo título');
    t.replaceWith(inp); inp.focus(); inp.select();
    let done = false;
    const commit = async (save) => {
      if (done) return; done = true; const v = inp.value.trim();
      if (save && v && v !== c.title) { try { const { error } = await S.sb.rpc('ai_conversation_rename', { p_id: c.id, p_title: v }); if (error) throw error; c.title = v.slice(0, 120); if (c.id === S.cid) el.kaiTitle.textContent = c.title; } catch { toast('No pude renombrar la conversación.'); } }
      renderList();
    };
    inp.onkeydown = (e) => { if (e.key === 'Enter') commit(true); if (e.key === 'Escape') commit(false); };
    inp.onblur = () => commit(true); inp.onclick = (e) => e.stopPropagation();
  }
  function confirmDelete(c) {
    modal((m, close) => {
      m.appendChild(h('h3', null, '¿Eliminar esta conversación?'));
      m.appendChild(h('p', 'sub', `“${c.title}” se borrará con todos sus mensajes. Esto no devuelve preguntas a tu cuota del mes.`));
      const row = h('div', 'row'); const ok = h('button', 'btn btn-accent', 'Eliminar'); ok.type = 'button'; const no = h('button', 'btn btn-ghost', 'Cancelar'); no.type = 'button';
      no.onclick = close;
      ok.onclick = async () => {
        ok.disabled = true;
        try { const { error } = await S.sb.rpc('ai_conversation_delete', { p_id: c.id }); if (error) throw error; S.convs = S.convs.filter((x) => x.id !== c.id); if (S.cid === c.id) newChat(); renderList(); loadUsage(); close(); }
        catch { toast('No pude eliminar la conversación.'); ok.disabled = false; }
      };
      row.append(ok, no); m.appendChild(row);
    });
  }
  function newChat() { if (S.busy) return; S.cid = null; el.kaiTitle.textContent = 'Nueva conversación'; renderWelcome(); renderList(); setStatus(null); el.kaiText.focus(); }
  async function openConv(id) {
    if (S.busy) return; S.cid = id; const c = S.convs.find((x) => x.id === id); el.kaiTitle.textContent = c ? c.title : 'Conversación'; renderList(); setStatus(null);
    el.kaiMsgs.textContent = ''; el.kaiMsgs.appendChild(h('div', 'kai-welcome')).appendChild(h('p', null, 'Cargando conversación…'));
    try {
      const { data, error } = await S.sb.from('ai_messages').select('id,role,content,status').eq('conversation_id', id).order('id').limit(400);
      if (error) throw error; el.kaiMsgs.textContent = '';
      (data || []).forEach((m) => addBubble(m.role === 'user' ? 'me' : 'bot', m.content, m.status === 'stopped' ? 'Respuesta detenida' : ''));
      scrollEnd(); loadUsage();
    } catch { el.kaiMsgs.textContent = ''; addBubble('bot', 'No pude cargar esta conversación. Intenta de nuevo.', '', true); }
  }

  /* ---------------- mensajes ---------------- */
  function renderWelcome() {
    const m = el.kaiMsgs; m.textContent = '';
    const w = h('div', 'kai-welcome'); w.appendChild(h('h2', null, 'Hola 👋 ¿En qué te ayudo hoy?'));
    w.appendChild(h('p', null, 'Pregunta sobre tu menú, productos, promociones o cómo vender más. También puedes adjuntar una foto de un producto.'));
    const sug = h('div', 'kai-sug');
    ['Escribe una descripción para mi producto estrella', 'Dame ideas de promociones para esta semana', '¿Cómo van mis pedidos de los últimos 30 días?'].forEach((t) => { const b = h('button', null, t); b.type = 'button'; b.onclick = () => { el.kaiText.value = t; autosize(); el.kaiText.focus(); }; sug.appendChild(b); });
    w.appendChild(sug); m.appendChild(w);
  }
  function addBubble(who, text, meta, isErr) {
    const w = el.kaiMsgs.querySelector('.kai-welcome'); if (w) w.remove();
    const row = h('div', 'kai-row ' + who + (isErr ? ' err' : '')); if (who === 'bot') row.appendChild(h('div', 'kai-av', 'K'));
    const b = h('div', 'kai-b'); b.appendChild(document.createTextNode(text || '')); if (meta) b.appendChild(h('span', 'meta', meta));
    row.appendChild(b); el.kaiMsgs.appendChild(row); scrollEnd(); return { row, b };
  }
  function typingBubble() { const row = h('div', 'kai-row bot'); row.appendChild(h('div', 'kai-av', 'K')); const b = h('div', 'kai-b typing'); b.innerHTML = '<i></i><i></i><i></i>'; row.appendChild(b); el.kaiMsgs.appendChild(row); scrollEnd(); return row; }
  function setStatus(kind) {
    const s = el.kaiStatus; if (!kind) { s.hidden = true; return; }
    s.hidden = false; s.className = 'kai-chip ' + ({ run: 'run', ok: 'ok', err: 'err' }[kind]); s.textContent = { run: 'Procesando…', ok: 'Completada', err: 'Error' }[kind];
  }

  /* ---------------- foto adjunta ---------------- */
  async function pickImg() {
    const f = el.kaiFile.files[0]; if (!f) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) { toast('Usa una imagen JPG, PNG o WEBP.'); el.kaiFile.value = ''; return; }
    try { S.img = new File([await shrink(f, 1280, 0.85)], 'foto.jpg', { type: 'image/jpeg' }); if (S.imgUrl) URL.revokeObjectURL(S.imgUrl); S.imgUrl = URL.createObjectURL(S.img); el.kaiAttachImg.src = S.imgUrl; el.kaiAttachName.textContent = f.name; el.kaiAttach.hidden = false; }
    catch { toast('No se pudo leer esa imagen.'); el.kaiFile.value = ''; }
  }
  function clearImg() { S.img = null; if (S.imgUrl) URL.revokeObjectURL(S.imgUrl); S.imgUrl = null; el.kaiAttach.hidden = true; el.kaiFile.value = ''; }
  function shrink(file, max, q) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); c.toBlob((b) => (b ? res(b) : rej(new Error('blob'))), 'image/jpeg', q); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('img')); }; img.src = url;
    });
  }

  /* ---------------- envío con streaming ---------------- */
  const toast = (m) => (window.KARTTA_CTX && window.KARTTA_CTX.toast ? window.KARTTA_CTX.toast(m) : console.log(m));
  function setBusy(b) {
    S.busy = b; el.kaiText.disabled = b; const btn = el.kaiSend; btn.classList.toggle('stop', b); btn.innerHTML = svg(b ? 'stop' : 'send'); btn.setAttribute('aria-label', b ? 'Detener respuesta' : 'Enviar'); btn.disabled = false;
    if (!b) lockComposer();
  }
  async function stop() { if (S.ctrl) S.ctrl.abort(); }
  async function send(retryText) {
    const text = (retryText != null ? retryText : el.kaiText.value).trim(); const foto = retryText != null ? null : S.img;
    if (!text && !foto) return;
    const prompt = text || (foto ? 'Analiza esta foto de mi producto y dime cómo mejorarla.' : '');
    if (S.usage && (S.usage.limit_reached || S.usage.contact_advisor)) { S.limitDismissed = false; return showLimit(S.usage); }
    if (!navigator.onLine) { addBubble('bot', 'Parece que no tienes conexión. Revisa tu internet e intenta de nuevo.', '', true); return; }
    S.lastMsg = prompt;
    if (retryText == null) { addBubble('me', (foto ? '📷 ' : '') + prompt); el.kaiText.value = ''; autosize(); }
    const typing = typingBubble(); setBusy(true); setStatus('run');
    const key = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).replace(/[^A-Za-z0-9_-]/g, '');
    S.ctrl = new AbortController(); let bubble = null, buf = '', gotDone = false, failed = false;
    try {
      const { data: ses } = await S.sb.auth.getSession(); const tok = ses && ses.session && ses.session.access_token; if (!tok) throw Object.assign(new Error('auth'), { code: 'auth' });
      const headers = { Authorization: 'Bearer ' + tok, apikey: S.sb.supabaseKey }; let body;
      if (foto) { const fd = new FormData(); fd.append('restaurant_id', S.rid); fd.append('message', prompt); fd.append('image', foto); body = fd; }
      else { headers['Content-Type'] = 'application/json'; body = JSON.stringify({ restaurant_id: S.rid, conversation_id: S.cid || undefined, message: prompt, request_key: key }); }
      // Texto y análisis de imágenes usan funciones separadas en Supabase.
      const endpoint = foto ? 'ai-assistant-vision' : 'ai-assistant';
      const resp = await fetch(S.sb.supabaseUrl + '/functions/v1/' + endpoint, { method: 'POST', headers, body, signal: S.ctrl.signal });
      const ct = resp.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const j = await resp.json().catch(() => ({})); typing.remove();
        if (!resp.ok) {
          if (j.error === 'monthly_limit' || j.error === 'contact_advisor') { await loadUsage(); S.limitDismissed = false; setStatus(null); setBusy(false); showLimit(S.usage || {}); return; }
          if (j.blocked && j.reply) { adoptConv(j.conversation_id, j.title, true); addBubble('bot', j.reply); setStatus('ok'); setBusy(false); return; }
          throw Object.assign(new Error(j.message || 'No pude responder ahora.'), { code: j.error || 'http_' + resp.status });
        }
        // ai-assistant y ai-assistant-vision devuelven { reply } en JSON.
        if (typeof j.reply === 'string' && j.reply.trim()) { const r = addBubble('bot', j.reply.trim()); bubble = r.b; setStatus('ok'); if (foto) clearImg(); return; }
        throw Object.assign(new Error(j.message || 'La IA respondió sin contenido.'), { code: j.error || 'empty_reply' });
      }
      if (!resp.ok) throw Object.assign(new Error('No pude responder ahora. Intenta de nuevo.'), { code: 'http_' + resp.status });
      typing.remove(); const r = addBubble('bot', ''); bubble = r.b; const textNode = bubble.firstChild;
      const reader = resp.body.getReader(), dec = new TextDecoder(); let pending = '';
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        pending += dec.decode(value, { stream: true }); let i;
        while ((i = pending.indexOf('\n\n')) >= 0) {
          const block = pending.slice(0, i); pending = pending.slice(i + 2);
          const ev = (block.match(/^event: (.+)$/m) || [])[1], dl = (block.match(/^data: (.+)$/m) || [])[1]; if (!ev || !dl) continue; let d; try { d = JSON.parse(dl); } catch { continue; }
          if (ev === 'meta') adoptConv(d.conversation_id, d.title, d.is_new);
          else if (ev === 'delta') { buf += d.t; textNode.nodeValue = buf; scrollEnd(); }
          else if (ev === 'replace') { buf = d.text; textNode.nodeValue = buf; }
          else if (ev === 'error') { failed = true; if (!buf) { r.row.classList.add('err'); textNode.nodeValue = d.message || 'No pude responder ahora.'; addRetry(bubble, prompt); } }
          else if (ev === 'done') { gotDone = true; if (d.usage) { S.usage = d.usage; renderUsage(); } if (d.status === 'stopped') bubble.appendChild(h('span', 'meta', 'Respuesta detenida')); if (d.memory_saved) bubble.appendChild(h('span', 'meta', '✓ Guardado en la memoria del restaurante')); }
        }
      }
      setStatus(failed ? 'err' : 'ok'); if (foto) clearImg();
    } catch (e) {
      typing.remove();
      if (e && e.name === 'AbortError') { if (bubble && !buf) bubble.parentElement.remove(); else if (bubble) bubble.appendChild(h('span', 'meta', 'Respuesta detenida')); setStatus(buf ? 'ok' : null); }
      else {
        const msg = e && e.code === 'auth' ? 'Tu sesión expiró. Vuelve a iniciar sesión.' : e && e.code === 'busy' ? 'Aún se está procesando otra pregunta. Espera un momento.' : (e && e.message && !/Failed to fetch|NetworkError|Load failed/i.test(e.message) ? e.message : 'Se perdió la conexión con la IA. No se descontó ninguna pregunta si no llegó respuesta.');
        const r = addBubble('bot', msg, '', true); addRetry(r.b, prompt); setStatus('err');
      }
    } finally {
      S.ctrl = null; setBusy(false);
      if (!gotDone) await loadUsage(); await loadConvs();
      if (!S.busy && el.kaiText && !el.kaiText.disabled) el.kaiText.focus({ preventScroll: true });
    }
  }
  function addRetry(b, text) { const r = h('button', 'retry', 'Reintentar'); r.type = 'button'; r.onclick = () => { r.closest('.kai-row').remove(); send(text); }; b.appendChild(document.createElement('br')); b.appendChild(r); }
  function adoptConv(id, title, isNew) { if (!id) return; S.cid = id; if (title) el.kaiTitle.textContent = title; if (isNew && !S.convs.find((c) => c.id === id)) { S.convs.unshift({ id, title: title || 'Nueva conversación' }); renderList(); } }

  /* ---------------- memoria ---------------- */
  function openMemory() {
    modal((m, close) => {
      m.setAttribute('aria-labelledby', 'kaiMemT'); const t = h('h3', null, 'Memoria del restaurante'); t.id = 'kaiMemT'; m.appendChild(t);
      m.appendChild(h('p', 'sub', 'Guarda preferencias y reglas que la IA debe recordar siempre (tono, horarios, cosas que no quieres que diga). Solo las ve tu restaurante. También puedes escribir en el chat: “Recuerda que…”.'));
      const list = h('div', 'kai-mlist'); m.appendChild(list); const count = h('div', 'sub'); count.style.cssText = 'font-size:12px;margin:0 0 8px'; m.appendChild(count);
      const add = h('div', 'kai-madd'); const inp = h('input'); inp.maxLength = 400; inp.placeholder = 'Ej.: Responde siempre en tono cercano y sin emojis'; inp.setAttribute('aria-label', 'Nueva nota de memoria');
      const ab = h('button', 'btn btn-accent', 'Guardar'); ab.type = 'button'; add.append(inp, ab); m.appendChild(add);
      const row = h('div', 'row'); const cl = h('button', 'btn btn-ghost', 'Cerrar'); cl.type = 'button'; cl.onclick = close; row.appendChild(cl); m.appendChild(row);
      const draw = async () => {
        list.textContent = '';
        try {
          const { data, error } = await S.sb.from('ai_memory').select('id,content').eq('restaurant_id', S.rid).order('created_at'); if (error) throw error;
          count.textContent = `${(data || []).length} de 30 notas`;
          if (!(data || []).length) list.appendChild(h('div', 'kai-empty-list', 'Todavía no hay nada guardado.'));
          (data || []).forEach((x) => { const it = h('div', 'kai-mi'); it.appendChild(h('span', null, x.content)); const d = h('button'); d.type = 'button'; d.innerHTML = svg('x', 14); d.setAttribute('aria-label', 'Olvidar'); d.onclick = async () => { try { const { error: e2 } = await S.sb.rpc('ai_memory_delete', { p_id: x.id }); if (e2) throw e2; draw(); } catch { toast('No pude borrar la nota.'); } }; it.appendChild(d); list.appendChild(it); });
        } catch { list.appendChild(h('div', 'kai-empty-list', 'No pude cargar la memoria.')); }
      };
      ab.onclick = async () => {
        const v = inp.value.trim(); if (v.length < 3) return; ab.disabled = true;
        try { const { data, error } = await S.sb.rpc('ai_memory_add', { p_restaurant_id: S.rid, p_content: v }); if (error) throw error; if (!data || !data.ok) toast(data && data.error === 'memory_full' ? 'La memoria está llena (30 notas). Borra alguna.' : 'No se pudo guardar la nota.'); else { inp.value = ''; draw(); } }
        catch { toast('No se pudo guardar la nota.'); } ab.disabled = false;
      };
      inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); ab.click(); } };
      draw(); setTimeout(() => inp.focus(), 30);
    });
  }

  /* ---------------- arranque ---------------- */
  async function show() {
    const c = window.KARTTA_CTX; if (!c) return; S.sb = c.sb; S.rid = c.rid; build();
    if (!S.loaded) { S.loaded = true; await Promise.all([loadUsage(), loadConvs()]); } else loadUsage();
  }
  window.addEventListener('kartta:ready', () => { const c = window.KARTTA_CTX; S.sb = c.sb; S.rid = c.rid; build(); loadUsage(); });
  window.addEventListener('kartta:view', (e) => { if (e.detail === 'ia') show(); });
  window.KARTTA_AI = { refresh: loadUsage, show };
})();
