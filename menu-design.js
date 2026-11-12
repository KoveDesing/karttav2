/**
 * KARTTA — Modelo de diseño del menú v3 (compartido por menu.html y editor.html). v3 es retrocompatible con v2: sin claves nuevas el menú se ve igual.
 * Una sola fuente de verdad: lo que ves en el editor ES el menú público (se renderiza con el mismo código).
 * Seguridad: el diseño es SOLO datos (colores #RRGGBB, opciones de listas cerradas, textos). Nunca HTML ni CSS libre.
 * Las mismas reglas las valida el servidor (trigger public.validate_menu_design).
 */
(function () {
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const FONTS = ['Inter', 'Poppins', 'DM Sans', 'Playfair Display', 'Lora', 'Space Grotesk'];
  const BLOCKS = ['header', 'announcement', 'categories', 'items', 'footer'];
  const ENUM = {
    cardStyle: ['round', 'soft', 'square'], buttonStyle: ['solid', 'outline'], size: ['s', 'm', 'l'],
    headerStyle: ['banner', 'compact', 'centered', 'minimal'], navStyle: ['pills', 'underline'],
    itemLayout: ['list', 'cards', 'grid'], imageShape: ['square', 'rounded', 'circle'],
    imagePosition: ['left', 'right'], tagPosition: ['inline', 'overlay'], density: ['compact', 'normal', 'airy'],
    // v3
    style: ['flat', 'minimal', 'soft', 'neo', 'glass', 'editorial', 'food'], anim: ['none', 'subtle', 'dynamic'],
    hAlign: ['auto', 'left', 'center', 'right'], hVert: ['top', 'center', 'bottom'], bannerH: ['auto', 's', 'm', 'l'],
    imgRatio: ['auto', 'square', 'portrait', 'landscape'], imgFit: ['cover', 'contain'], imgPos: ['center', 'top', 'bottom'],
    shadow: ['auto', 'none', 'soft', 'medium'], navBar: ['solid', 'translucent', 'glass'],
    socialPlace: ['header', 'footer'], socialShape: ['circle', 'rounded', 'none'], socialDir: ['row', 'column'],
  };
  /* v3 — enteros con rango [min,max]; null = automático (el valor lo decide la plantilla/estilo). Mismos límites que el validador SQL. */
  const INTS = {
    nameSize: [18, 56], titleSize: [20, 64], subSize: [11, 22], hGap: [0, 24], bannerOverlay: [0, 80], catSize: [12, 28],
    prodNameSize: [13, 22], prodDescSize: [11, 16], priceSize: [12, 24], navH: [52, 84], navIconSize: [18, 30], navRadius: [0, 32],
    socialSize: [28, 52], socialGap: [4, 24], cardGap: [6, 24], thumb: [48, 96], imgH: [80, 180],
  };
  const INT_DEF = { hGap: 4, bannerOverlay: 55 };
  const WEIGHTS = ['nameWeight', 'titleWeight', 'catWeight', 'prodNameWeight', 'priceWeight'];
  const HEXOPT = ['nameColor', 'bTitleColor', 'bSubColor', 'titleColor', 'descColor', 'priceColor', 'cardBorder', 'navBg', 'navIcon', 'navActive', 'socialColor', 'socialBg'];
  const SOCIAL_TYPES = ['instagram', 'facebook', 'whatsapp', 'tiktok', 'youtube', 'maps', 'web'];
  const SOCIAL_LABEL = { instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp', tiktok: 'TikTok', youtube: 'YouTube', maps: 'Google Maps', web: 'Sitio web' };
  const ALLERGENS = [['gluten', 'Gluten'], ['lacteos', 'Lácteos'], ['huevo', 'Huevo'], ['frutos_secos', 'Frutos secos'], ['mani', 'Maní'], ['soya', 'Soya'], ['pescado', 'Pescado'], ['mariscos', 'Mariscos'], ['sesamo', 'Sésamo']];
  const DEFAULTS = {
    v: 2, primary: '#FF3145', secondary: '#0A0A0A', background: '#FFFFFF', textColor: '#0A0A0A', surface: '#F5F5F3',
    tagline: '', showImages: true, showDescriptions: true, showPrices: true, showCategoriesNav: true, showAddress: true, showTags: true, showSearch: true, showNav: true, showHighlights: true,
    cardStyle: 'round', buttonStyle: 'solid', size: 'm', headerStyle: 'banner', navStyle: 'pills',
    itemLayout: 'list', imageShape: 'rounded', imagePosition: 'left', tagPosition: 'inline', density: 'normal', radius: null,
    fontHeading: 'Inter', fontBody: 'Inter', blocks: BLOCKS.slice(), announcement: '', footerText: '',
    // v3 (todo opcional; los valores por defecto reproducen exactamente el diseño anterior)
    template: '', style: 'flat', anim: 'subtle', bannerTitle: '', showAbout: false,
    hAlign: 'auto', hVert: 'center', bannerH: 'auto', imgRatio: 'auto', imgFit: 'cover', imgPos: 'center', shadow: 'auto',
    navBar: 'solid', navFloating: false, navLabels: true, socialPlace: 'footer', socialShape: 'circle', socialDir: 'row', social: [], wa: {}, btn: {}, bgx: {}, hbgx: {}, tx: {}, rt: {}, els: [],
  };
  Object.keys(INTS).forEach(k => { DEFAULTS[k] = k in INT_DEF ? INT_DEF[k] : null; });
  WEIGHTS.forEach(k => { DEFAULTS[k] = null; });
  HEXOPT.forEach(k => { DEFAULTS[k] = ''; });
  const ADVANCED = ['fontHeading', 'fontBody', 'blocks', 'announcement', 'footerText'];

  const bool = (v, d) => (typeof v === 'boolean' ? v : d);
  const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : '');
  const hex = (v, d) => (HEX.test(String(v || '')) ? String(v) : (/^#[0-9a-fA-F]{3}$/.test(String(v || '')) ? '#' + [...String(v).slice(1)].map(c => c + c).join('') : d));

  /** Convierte cualquier config (vieja v1, vacía o manipulada) en una config completa y SEGURA. */
  function normalize(raw) {
    const c = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const o = { ...DEFAULTS, blocks: BLOCKS.slice() };
    o.primary = hex(c.primary, DEFAULTS.primary); o.secondary = hex(c.secondary, DEFAULTS.secondary);
    o.background = hex(c.background, DEFAULTS.background); o.textColor = hex(c.textColor, DEFAULTS.textColor); o.surface = hex(c.surface, DEFAULTS.surface);
    o.tagline = str(c.tagline, 140); o.announcement = str(c.announcement, 160); o.footerText = str(c.footerText, 160);
    ['showImages', 'showDescriptions', 'showPrices', 'showCategoriesNav', 'showAddress', 'showTags', 'showSearch', 'showNav', 'showHighlights'].forEach(k => { o[k] = bool(c[k], DEFAULTS[k]); });
    Object.keys(ENUM).forEach(k => { o[k] = ENUM[k].includes(c[k]) ? c[k] : DEFAULTS[k]; });
    o.radius = Number.isInteger(c.radius) && c.radius >= 0 && c.radius <= 28 ? c.radius : null;
    o.fontHeading = FONTS.includes(c.fontHeading) ? c.fontHeading : 'Inter';
    o.fontBody = FONTS.includes(c.fontBody) ? c.fontBody : 'Inter';
    if (Array.isArray(c.blocks)) {
      const seen = c.blocks.filter((b, i, a) => BLOCKS.includes(b) && a.indexOf(b) === i);
      if (seen.includes('header') && seen.includes('items') && seen.length >= 2) o.blocks = seen;
    }
    // v3
    o.template = str(c.template, 30).replace(/[^a-z0-9_-]/gi, '');
    o.bannerTitle = str(c.bannerTitle, 60);
    ['showAbout', 'navFloating', 'navLabels'].forEach(k => { o[k] = bool(c[k], DEFAULTS[k]); });
    Object.keys(INTS).forEach(k => { const r = INTS[k]; o[k] = Number.isInteger(c[k]) && c[k] >= r[0] && c[k] <= r[1] ? c[k] : DEFAULTS[k]; });
    WEIGHTS.forEach(k => { o[k] = Number.isInteger(c[k]) && c[k] >= 400 && c[k] <= 900 && c[k] % 100 === 0 ? c[k] : null; });
    HEXOPT.forEach(k => { o[k] = c[k] === '' || c[k] == null ? '' : hex(c[k], ''); });
    o.social = normSocial(c.social);
    o.wa = normWa(c.wa); o.btn = normBtn(c.btn);
    o.bgx = normGrad(c.bgx); o.hbgx = normGrad(c.hbgx); o.tx = normTx(c.tx); o.rt = normRt(c.rt); o.els = normEls(c.els);
    o.v = 2;
    return o;
  }

  /* ---------- Apariencia del botón de WhatsApp (wa) y de los botones del menú (btn) ----------
   * Solo APARIENCIA. El número y el interruptor viven en restaurants (set_whatsapp_button). Todo es opcional: sin claves = diseño de siempre. */
  const inEnum = (v, a) => a.includes(v);
  const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  function normWa(r) {
    const c = r && typeof r === 'object' && !Array.isArray(r) ? r : {}, o = {};
    if (HEX.test(c.bg || '')) o.bg = c.bg; if (HEX.test(c.ic || '')) o.ic = c.ic;
    if (intIn(c.sz, 44, 72)) o.sz = c.sz; if (inEnum(c.pos, ['br', 'bl', 'bc'])) o.pos = c.pos;
    if (intIn(c.r, 0, 36)) o.r = c.r; if (inEnum(c.sh, ['none', 'soft', 'strong'])) o.sh = c.sh;
    if (intIn(c.op, 60, 100)) o.op = c.op; if (inEnum(c.variant, ['circle', 'pill'])) o.variant = c.variant;
    const lb = str(c.label, 24).trim(); if (lb) o.label = lb; const m = str(c.msg, 200).trim(); if (m) o.msg = m;
    return o;
  }
  function normBtn(r) {
    const c = r && typeof r === 'object' && !Array.isArray(r) ? r : {}, o = {};
    if (HEX.test(c.bg || '')) o.bg = c.bg; if (HEX.test(c.fg || '')) o.fg = c.fg; if (HEX.test(c.bdc || '')) o.bdc = c.bdc;
    if (intIn(c.r, 0, 32)) o.r = c.r; if (inEnum(c.sh, ['none', 'soft', 'strong'])) o.sh = c.sh; if (inEnum(c.sz, ['s', 'm', 'l'])) o.sz = c.sz;
    if (intIn(c.bd, 0, 3)) o.bd = c.bd; if (intIn(c.wt, 400, 900) && c.wt % 100 === 0) o.wt = c.wt; if (inEnum(c.hov, ['none', 'lift', 'dark', 'scale'])) o.hov = c.hov;
    return o;
  }
  const BSH = { none: 'none', soft: '0 4px 12px -4px rgba(0,0,0,.28)', strong: '0 10px 22px -6px rgba(0,0,0,.45)' };
  /** Variables y marcas del diseño para botones. Cada propiedad solo se activa si el dueño la definió. */
  function applyButtons(c, root) {
    const s = root.style, d = root.dataset, b = c.btn || {};
    ['--b-bg', '--b-fg', '--b-r', '--b-sh', '--b-bd', '--b-bdc', '--b-wt'].forEach(k => s.removeProperty(k));
    ['bbg', 'bfg', 'br', 'bsh', 'bbd', 'bwt', 'bsz', 'bh'].forEach(k => delete d[k]);
    if (b.bg) { s.setProperty('--b-bg', b.bg); d.bbg = '1'; } if (b.fg) { s.setProperty('--b-fg', b.fg); d.bfg = '1'; }
    if (b.r != null) { s.setProperty('--b-r', b.r + 'px'); d.br = '1'; } if (b.sh) { s.setProperty('--b-sh', BSH[b.sh]); d.bsh = '1'; }
    if (b.bd != null) { s.setProperty('--b-bd', b.bd + 'px'); s.setProperty('--b-bdc', b.bdc || b.bg || c.primary); d.bbd = '1'; }
    if (b.wt) { s.setProperty('--b-wt', b.wt); d.bwt = '1'; } if (b.sz && b.sz !== 'm') d.bsz = b.sz; if (b.hov && b.hov !== 'none') d.bh = b.hov;
    const w = c.wa || {};
    ['--wa-bg', '--wa-ic', '--wa-sz', '--wa-r', '--wa-sh', '--wa-op'].forEach(k => s.removeProperty(k));
    if (w.bg) s.setProperty('--wa-bg', w.bg); if (w.ic) s.setProperty('--wa-ic', w.ic); if (w.sz) s.setProperty('--wa-sz', w.sz + 'px');
    if (w.r != null) s.setProperty('--wa-r', w.r === 36 ? '50%' : w.r + 'px'); if (w.sh) s.setProperty('--wa-sh', BSH[w.sh]); if (w.op) s.setProperty('--wa-op', (w.op / 100).toFixed(2));
    if (window.KARTTA_WA && window.KARTTA_WA.style) window.KARTTA_WA.style(w);
  }

  /* ---------- Fase 2: degradados (bgx/hbgx), estilo por texto (tx), texto por palabras (rt) y elementos (els) ---------- */
  const TX_SLOTS = ['name', 'tag', 'btitle', 'cat', 'pname', 'pdesc', 'price', 'ann', 'foot'];
  const TX_LABEL = { name: 'Nombre del negocio', tag: 'Subtítulo del encabezado', btitle: 'Título del banner', cat: 'Títulos de categoría', pname: 'Nombre del producto', pdesc: 'Descripción del producto', price: 'Precio', ann: 'Anuncio', foot: 'Texto del pie' };
  const TX_SEL = { name: '.mheader h1', tag: '.mheader .tag', btitle: '.mheader .btitle', cat: '.mcat-title', pname: '.mitem .name', pdesc: '.mi-desc', price: '.mitem .price', ann: '#announce', foot: '#footText' };
  const EL_KINDS = ['h', 'p', 'btn', 'div', 'sp', 'promo', 'quote'];
  const EL_ANCHORS = ['header', 'announcement', 'categories', 'items', 'footer'];
  const EL_MAX = 20;
  function normGrad(r) {
    const c = r && typeof r === 'object' && !Array.isArray(r) ? r : {};
    if (!HEX.test(c.c1 || '') || !HEX.test(c.c2 || '')) return {};
    const o = { t: c.t === 'radial' ? 'radial' : 'linear', a: intIn(c.a, 0, 360) ? c.a : 180, c1: c.c1, c2: c.c2 };
    if (HEX.test(c.c3 || '')) o.c3 = c.c3; return o;
  }
  const gradCss = (g) => !g || !g.c1 ? '' : (g.t === 'radial' ? 'radial-gradient(circle at 50% 25%,' : 'linear-gradient(' + g.a + 'deg,') + g.c1 + ',' + g.c2 + (g.c3 ? ',' + g.c3 : '') + ')';
  function normTx(r) {
    const c = r && typeof r === 'object' && !Array.isArray(r) ? r : {}, out = {};
    TX_SLOTS.forEach(k => {
      const e = c[k]; if (!e || typeof e !== 'object') return; const o = {};
      if (e.it === true) o.it = true; if (e.up === true) o.up = true; if (intIn(e.ls, 1, 8)) o.ls = e.ls;
      if (inEnum(e.al, ['left', 'center', 'right'])) o.al = e.al; if (inEnum(e.ts, ['soft', 'strong'])) o.ts = e.ts; if (FONTS.includes(e.ff)) o.ff = e.ff;
      if (Object.keys(o).length) out[k] = o;
    });
    return out;
  }
  function normRuns(v) {
    if (!Array.isArray(v)) return [];
    const out = [];
    v.forEach(e => {
      if (out.length >= 40 || !e || typeof e !== 'object' || typeof e.t !== 'string') return;
      const t = str(e.t, 40); if (!t) return; const o = { t };
      if (HEX.test(e.c || '')) o.c = e.c; if (e.b === true) o.b = true; if (e.i === true) o.i = true; if (intIn(e.s, 70, 220)) o.s = e.s;
      out.push(o);
    });
    return out;
  }
  function normRt(r) {
    const c = r && typeof r === 'object' && !Array.isArray(r) ? r : {}, out = {};
    ['tag', 'bt'].forEach(k => { const a = normRuns(c[k]); if (a.length) out[k] = a; });
    return out;
  }
  function normEls(arr) {
    const out = [], ids = new Set(); if (!Array.isArray(arr)) return out;
    arr.forEach(e => {
      if (out.length >= EL_MAX || !e || typeof e !== 'object' || !EL_KINDS.includes(e.k) || typeof e.id !== 'string' || !/^[a-z0-9]{3,8}$/.test(e.id) || ids.has(e.id)) return;
      ids.add(e.id); const o = { id: e.id, k: e.k };
      const t = str(e.t, 200); if (t) o.t = t; const x = str(e.x, 300); if (x) o.x = x;
      const u = typeof e.u === 'string' ? e.u.trim() : ''; if (URL_OK.test(u) || /^wa:[0-9]{7,15}$/.test(u)) o.u = u;
      ['c', 'bg', 'bg2'].forEach(k => { if (HEX.test(e[k] || '')) o[k] = e[k]; });
      if (inEnum(e.al, ['l', 'c', 'r'])) o.al = e.al; if (intIn(e.sz, 12, 40)) o.sz = e.sz; if (intIn(e.h, 8, 80)) o.h = e.h;
      if (intIn(e.dx, -40, 40) && e.dx) o.dx = e.dx; if (intIn(e.dy, -80, 80) && e.dy) o.dy = e.dy;
      o.af = EL_ANCHORS.includes(e.af) ? e.af : 'items'; o.n = intIn(e.n, 0, 30) ? e.n : 0;
      if (e.off === true) o.off = true;
      const r = normRuns(e.r); if (r.length && r.map(z => z.t).join('') === (o.t || '')) o.r = r;
      out.push(o);
    });
    return out;
  }
  /** Rellena un nodo con texto; si hay "runs" (palabras con estilo) y coinciden con el texto, las dibuja como <span>. Siempre textContent (nada de HTML). */
  function renderRuns(node, text, runs) {
    node.textContent = '';
    if (Array.isArray(runs) && runs.length && runs.map(r => r.t).join('') === text) {
      runs.forEach(r => {
        if (!r.c && !r.b && !r.i && !r.s) { node.appendChild(document.createTextNode(r.t)); return; }
        const sp = document.createElement('span'); sp.textContent = r.t;
        if (r.c) sp.style.color = r.c; if (r.b) sp.style.fontWeight = '800'; if (r.i) sp.style.fontStyle = 'italic'; if (r.s) sp.style.fontSize = r.s + '%';
        node.appendChild(sp);
      });
    } else node.textContent = text;
  }
  const elHref = (u) => (typeof u === 'string' && /^wa:[0-9]{7,15}$/.test(u) ? 'https://wa.me/' + u.slice(3) : URL_OK.test(u || '') ? u : '');
  /** Construye el nodo de un elemento (solo DOM seguro). */
  function renderEl(e) {
    const box = document.createElement('div'); box.className = 'kel'; box.dataset.id = e.id; box.dataset.k = e.k; box.dataset.el = 'el:' + e.id;
    if (e.al) box.style.textAlign = { l: 'left', c: 'center', r: 'right' }[e.al];
    if (e.dx || e.dy) box.style.transform = 'translate(' + (e.dx || 0) + '%,' + (e.dy || 0) + 'px)';
    const col = (n) => { if (e.c) n.style.color = e.c; if (e.sz) n.style.fontSize = e.sz + 'px'; return n; };
    const href = elHref(e.u);
    if (e.k === 'h' || e.k === 'p' || e.k === 'quote') {
      const n = col(document.createElement(e.k === 'h' ? 'h2' : e.k === 'p' ? 'p' : 'blockquote')); n.className = 'kel-' + e.k; renderRuns(n, e.t || '', e.r); box.appendChild(n);
    } else if (e.k === 'btn') {
      const a = document.createElement(href ? 'a' : 'span'); a.className = 'kel-btn'; a.textContent = e.t || 'Ver más';
      if (href) { a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      if (e.bg) a.style.background = e.bg; if (e.c) a.style.color = e.c; if (e.sz) a.style.fontSize = e.sz + 'px'; box.appendChild(a);
    } else if (e.k === 'div') {
      const hr = document.createElement('hr'); hr.className = 'kel-hr'; if (e.c) hr.style.borderColor = e.c; box.appendChild(hr);
    } else if (e.k === 'sp') {
      box.style.height = (e.h || 24) + 'px'; box.setAttribute('aria-hidden', 'true');
    } else if (e.k === 'promo') {
      const c = document.createElement(href ? 'a' : 'div'); c.className = 'kel-promo';
      if (href) { c.href = href; c.target = '_blank'; c.rel = 'noopener noreferrer'; }
      c.style.background = 'linear-gradient(135deg,' + (e.bg || '#FF3145') + ',' + (e.bg2 || e.bg || '#0A0A0A') + ')'; if (e.c) c.style.color = e.c;
      const t = document.createElement('b'); renderRuns(t, e.t || '', e.r); if (e.sz) t.style.fontSize = e.sz + 'px'; c.appendChild(t);
      if (e.x) { const x = document.createElement('span'); x.textContent = e.x; c.appendChild(x); }
      box.appendChild(c);
    }
    return box;
  }
  /** Reglas CSS de "estilo por texto" (solo valores ya normalizados: enums, enteros y fuentes de la lista). */
  function txCss(tx) {
    let css = '';
    TX_SLOTS.forEach(k => {
      const e = tx && tx[k]; if (!e) return; const r = [];
      if (e.it) r.push('font-style:italic'); if (e.up) r.push('text-transform:uppercase'); if (e.ls) r.push('letter-spacing:' + (e.ls * 0.5) + 'px');
      if (e.al) r.push('text-align:' + e.al); if (e.ts) r.push('text-shadow:' + (e.ts === 'soft' ? '0 1px 3px rgba(0,0,0,.35)' : '0 2px 8px rgba(0,0,0,.6)'));
      if (e.ff) r.push("font-family:'" + e.ff + "',-apple-system,sans-serif"); if (r.length) css += 'html ' + TX_SEL[k] + '{' + r.join(';') + '}';
    });
    return css;
  }
  function applyExtras(c, root) {
    const s = root.style, d = root.dataset;
    const bg = gradCss(c.bgx), hb = gradCss(c.hbgx);
    if (bg) { s.setProperty('--bgx', bg); d.bgx = '1'; } else { s.removeProperty('--bgx'); delete d.bgx; }
    if (hb) { s.setProperty('--hbgx', hb); d.hbgx = '1'; } else { s.removeProperty('--hbgx'); delete d.hbgx; }
    let st = document.getElementById('kdTx'); const css = txCss(c.tx);
    if (!css) { if (st) st.remove(); } else { if (!st) { st = document.createElement('style'); st.id = 'kdTx'; document.head.appendChild(st); } if (st.textContent !== css) st.textContent = css; }
  }

  /* ---------- Redes sociales (se guardan como [{t, u, m?, on?}]; u = https o, en WhatsApp, solo dígitos) ---------- */
  const URL_OK = /^https:\/\/[^\s"'<>\\]{4,255}$/;
  function cleanSocial(t, u) { u = String(u == null ? '' : u).trim(); return t === 'whatsapp' ? (/^[0-9]{7,15}$/.test(u) ? u : '') : (URL_OK.test(u) ? u : ''); }
  function normSocial(arr) {
    const out = [], seen = new Set(); if (!Array.isArray(arr)) return out;
    arr.forEach(e => {
      if (out.length >= 8 || !e || typeof e !== 'object' || !SOCIAL_TYPES.includes(e.t) || seen.has(e.t)) return;
      const u = cleanSocial(e.t, e.u); if (!u) return; seen.add(e.t);
      const it = { t: e.t, u }; if (typeof e.m === 'string' && e.m.trim()) it.m = str(e.m, 200).trim(); if (e.on === false) it.on = false; out.push(it);
    });
    return out;
  }
  /** Convierte lo que escribe el dueño (@usuario, enlace, número…) en el valor seguro que se guarda. Devuelve {u} o {error}. */
  function parseSocialInput(type, raw) {
    let v = String(raw == null ? '' : raw).trim(); if (!v) return { error: 'Escribe el enlace o usuario.' };
    const bad = () => ({ error: 'Ese enlace no parece válido.' });
    if (/^(javascript|data|vbscript|file):/i.test(v)) return bad();
    if (type === 'whatsapp') { const d = v.replace(/[\s()+\-.]/g, ''); if (/^https?:\/\/(wa\.me|api\.whatsapp\.com)\//i.test(v)) { const m = v.match(/(?:wa\.me\/|phone=)\+?([0-9]{7,15})/i); return m ? { u: m[1] } : bad(); } return /^[0-9]{7,15}$/.test(d) ? { u: d } : { error: 'Escribe el número con indicativo, ej: 573001234567.' }; }
    const handle = v.replace(/^@/, '');
    const hasProto = /^https?:\/\//i.test(v), looksDomain = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(v);
    const make = (h) => ({ instagram: 'https://instagram.com/' + h, facebook: 'https://facebook.com/' + h, tiktok: 'https://www.tiktok.com/@' + h, youtube: 'https://www.youtube.com/@' + h }[type]);
    if (['instagram', 'facebook', 'tiktok', 'youtube'].includes(type) && !hasProto && !looksDomain) { if (!/^[A-Za-z0-9._-]{2,60}$/.test(handle)) return { error: 'Usa solo letras, números, punto o guion.' }; return { u: make(handle) }; }
    if (type === 'maps' && !hasProto && !looksDomain) return v.length >= 4 ? { u: ('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(v)).slice(0, 263) } : bad();
    if (!hasProto) v = 'https://' + v; v = v.replace(/^http:\/\//i, 'https://');
    try { const u = new URL(v); if (u.protocol !== 'https:' || !u.hostname.includes('.')) return bad(); v = u.href; } catch { return bad(); }
    if (v.endsWith('/') && !/[?#]/.test(v) && v.split('/').length <= 4) v = v.slice(0, -1);
    const dom = { instagram: /(^|\.)instagram\.com$/, facebook: /(^|\.)(facebook|fb)\.com$|(^|\.)fb\.me$/, tiktok: /(^|\.)tiktok\.com$/, youtube: /(^|\.)(youtube\.com|youtu\.be)$/ }[type];
    if (dom && !dom.test(new URL(v).hostname)) return { error: 'Ese enlace no es de ' + SOCIAL_LABEL[type] + '.' };
    return URL_OK.test(v) ? { u: v } : { error: 'El enlace es demasiado largo o tiene caracteres no permitidos.' };
  }
  function socialHref(it) {
    if (!it) return ''; if (it.t === 'whatsapp') { if (!/^[0-9]{7,15}$/.test(it.u)) return ''; return 'https://wa.me/' + it.u + (it.m ? '?text=' + encodeURIComponent(it.m) : ''); }
    return URL_OK.test(it.u || '') ? it.u : '';
  }
  const socialVisible = (list) => (Array.isArray(list) ? list : []).filter(i => i && i.on !== false && socialHref(i));
  const SI = (b) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + b + '</svg>';
  const SOCIAL_ICON = {
    instagram: SI('<rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><path d="M17.5 6.5h.01"/>'),
    facebook: SI('<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>'),
    whatsapp: SI('<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/><path d="M9 9.5c.3 2 2.5 4.2 4.5 4.5l1.3-1.2-1.8-1-.8.6c-.7-.3-1.5-1.1-1.8-1.8l.6-.8-1-1.8z"/>'),
    tiktok: SI('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
    youtube: SI('<path d="M22.5 6.4a2.8 2.8 0 0 0-2-2C18.9 4 12 4 12 4s-6.9 0-8.6.5a2.8 2.8 0 0 0-2 2A29 29 0 0 0 1 11.8a29 29 0 0 0 .4 5.3 2.8 2.8 0 0 0 2 2c1.7.5 8.6.5 8.6.5s6.9 0 8.6-.5a2.8 2.8 0 0 0 2-2 29 29 0 0 0 .4-5.3 29 29 0 0 0-.5-5.4z"/><path d="M9.75 15 15.5 11.75 9.75 8.5z"/>'),
    maps: SI('<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>'),
    web: SI('<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'),
    contact: SI('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  };
  /** Rellena un contenedor con los iconos de redes visibles. Solo enlaces https validados; target/rel seguros. Devuelve cuántos puso. */
  function renderSocial(host, list) {
    host.textContent = ''; const items = socialVisible(list);
    items.forEach(it => { const a = document.createElement('a'); a.href = socialHref(it); a.target = '_blank'; a.rel = 'noopener noreferrer'; a.dataset.soc = it.t; a.setAttribute('aria-label', SOCIAL_LABEL[it.t]); a.title = SOCIAL_LABEL[it.t]; a.innerHTML = SOCIAL_ICON[it.t]; host.appendChild(a); });
    host.hidden = !items.length; return items.length;
  }

  /** Lo que se guarda: solo valores distintos del defecto (el JSON queda pequeño y sin claves avanzadas innecesarias). */
  function compact(cfg) {
    const n = normalize(cfg), out = { v: 2 };
    Object.keys(DEFAULTS).forEach(k => {
      if (k === 'v') return;
      if (JSON.stringify(n[k]) !== JSON.stringify(DEFAULTS[k])) out[k] = n[k];
    });
    return out;
  }
  const radiusOf = (c) => (c.radius != null ? c.radius : { round: 18, soft: 12, square: 4 }[c.cardStyle]);

  const setVar = (st, k, v) => { if (v == null || v === '') st.removeProperty(k); else st.setProperty(k, v); };
  /** Tamaño que se encoge en pantallas estrechas (nunca desborda en un teléfono de 320 px). */
  const fluid = (n) => 'min(' + n + 'px,' + (n / 3.9).toFixed(2) + 'vw)';
  const SHADOWS = { none: 'none', soft: '0 6px 18px -8px rgba(0,0,0,.22)', medium: '0 12px 28px -10px rgba(0,0,0,.38)' };
  const RATIOS = { square: '1 / 1', portrait: '4 / 5', landscape: '4 / 3' };
  /** Aplica el diseño a un elemento raíz (html): variables CSS + atributos data-*. */
  function apply(cfg, root) {
    const c = normalize(cfg), s = root.style;
    s.setProperty('--red', c.primary); s.setProperty('--black', c.secondary); s.setProperty('--bg', c.background);
    s.setProperty('--tx', c.textColor); s.setProperty('--surface', c.surface);
    s.setProperty('--rad', radiusOf(c) + 'px'); s.setProperty('--fs', { s: .9, m: 1, l: 1.12 }[c.size]);
    s.setProperty('--backdrop', lum(c.background) < .25 ? '#08080A' : 'color-mix(in srgb, ' + c.primary + ' 9%, #E9E9EC)');
    s.setProperty('--dn', { compact: .7, normal: 1, airy: 1.4 }[c.density]);
    const headFont = c.style === 'editorial' && c.fontHeading === 'Inter' ? "Georgia, 'Times New Roman', serif" : `'${c.fontHeading}', -apple-system, sans-serif`;
    s.setProperty('--fh', headFont); s.setProperty('--fb', `'${c.fontBody}', -apple-system, sans-serif`);
    // v3 — cada variable solo existe si el dueño la definió; si no, el CSS usa su valor de siempre
    const px = (k) => (c[k] == null ? null : c[k] + 'px');
    setVar(s, '--nm-sz', c.nameSize == null ? null : fluid(c.nameSize)); setVar(s, '--bt-sz', c.titleSize == null ? null : fluid(c.titleSize)); setVar(s, '--sb-sz', c.subSize == null ? null : fluid(c.subSize));
    setVar(s, '--logo-sz', c.nameSize == null ? null : Math.max(44, Math.min(72, Math.round(c.nameSize * 1.25))) + 'px');
    setVar(s, '--nm-wt', c.nameWeight); setVar(s, '--bt-wt', c.titleWeight); setVar(s, '--cat-wt', c.catWeight); setVar(s, '--pn-wt', c.prodNameWeight); setVar(s, '--pr-wt', c.priceWeight);
    setVar(s, '--hgap', px('hGap')); setVar(s, '--ov', (c.bannerOverlay / 100).toFixed(2));
    setVar(s, '--cat-sz', px('catSize')); setVar(s, '--pn-sz', px('prodNameSize')); setVar(s, '--pd-sz', px('prodDescSize')); setVar(s, '--pr-sz', px('priceSize'));
    setVar(s, '--nm-col', c.nameColor); setVar(s, '--bt-col', c.bTitleColor); setVar(s, '--sb-col', c.bSubColor);
    setVar(s, '--title-col', c.titleColor); setVar(s, '--desc-col', c.descColor); setVar(s, '--price-col', c.priceColor); setVar(s, '--card-bd', c.cardBorder);
    setVar(s, '--nav-bg', c.navBg); setVar(s, '--nav-ic', c.navIcon); setVar(s, '--nav-act', c.navActive);
    setVar(s, '--nav-h', px('navH')); setVar(s, '--nav-is', px('navIconSize')); setVar(s, '--nav-r', px('navRadius'));
    setVar(s, '--soc-col', c.socialColor); setVar(s, '--soc-bg', c.socialBg); setVar(s, '--soc-sz', px('socialSize')); setVar(s, '--soc-gap', px('socialGap'));
    setVar(s, '--gap', px('cardGap')); setVar(s, '--thumb', px('thumb')); setVar(s, '--imgh', px('imgH'));
    setVar(s, '--ar', RATIOS[c.imgRatio] || null); setVar(s, '--fit', c.imgFit === 'contain' ? 'contain' : null); setVar(s, '--pos', c.imgPos === 'center' ? null : c.imgPos);
    setVar(s, '--shadow', SHADOWS[c.shadow] || null);
    const d = root.dataset;
    d.hs = c.headerStyle; d.nav = c.navStyle; d.il = c.itemLayout; d.is = c.imageShape; d.ip = c.imagePosition; d.bs = c.buttonStyle;
    d.st = c.style; d.an = c.anim; d.ha = c.hAlign; d.hv = c.hVert; d.bh = c.bannerH; d.ir = c.imgRatio;
    d.nb = c.navBar; d.nf = c.navFloating ? '1' : '0'; d.nl = c.navLabels ? '1' : '0'; d.ss = c.socialShape; d.sd = c.socialDir;
    d.dk = lum(c.background) < .25 ? '1' : '0'; d.big = (c.nameSize || 0) >= 32 || (c.titleSize || 0) >= 32 ? '1' : '0';
    // Un banner alto no debe quedarse fijo arriba tapando el menú
    d.hsticky = c.blocks[0] === 'header' && c.bannerH === 'auto' ? '1' : '0';
    applyButtons(c, root); applyExtras(c, root);
    loadFonts(c);
    return c;
  }
  function loadFonts(c) {
    const need = [...new Set([c.fontHeading, c.fontBody].concat(Object.values(c.tx || {}).map(e => e.ff).filter(Boolean)))].filter(f => f !== 'Inter');
    let el = document.getElementById('kdFonts');
    if (!need.length) { if (el) el.remove(); return; }
    const href = 'https://fonts.googleapis.com/css2?' + need.map(f => 'family=' + encodeURIComponent(f).replace(/%20/g, '+') + ':wght@400;600;700;800').join('&') + '&display=swap';
    if (!el) { el = document.createElement('link'); el.id = 'kdFonts'; el.rel = 'stylesheet'; document.head.appendChild(el); }
    if (el.href !== href) el.href = href;
  }


  /* ---- Etiquetas (chips) — se usan igual en el menú público, el editor y el panel ---- */
  const TAG_STYLES = ['solid', 'soft', 'outline'];
  function validTag(t) { return t && typeof t.name === 'string' && t.name.length && HEX.test(t.bg || '') && HEX.test(t.fg || ''); }
  function ensureTagCss() {
    if (document.getElementById('kTagCss')) return;
    const st = document.createElement('style'); st.id = 'kTagCss';
    st.textContent = '.k-tag{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:800;line-height:1;padding:5px 9px;border-radius:99px;white-space:nowrap;border:1.5px solid var(--tb);font-family:inherit;max-width:100%}' +
      '.k-tag.solid{background:var(--tb);color:var(--tf)}.k-tag.soft{background:color-mix(in srgb,var(--tb) 22%,transparent);border-color:transparent;color:inherit}.k-tag.outline{background:transparent;color:inherit}' +
      '.k-tags{display:flex;flex-wrap:wrap;gap:5px}';
    document.head.appendChild(st);
  }
  /** Crea el chip de una etiqueta. Todo el texto entra como textContent (nunca HTML) y los colores se validan. */
  function tagEl(t) {
    ensureTagCss();
    const e = document.createElement('span'); const style = TAG_STYLES.includes(t.style) ? t.style : 'solid';
    e.className = 'k-tag ' + style; e.style.setProperty('--tb', t.bg); e.style.setProperty('--tf', t.fg);
    if (t.icon) { const i = document.createElement('span'); i.setAttribute('aria-hidden', 'true'); i.textContent = String(t.icon).slice(0, 8); e.appendChild(i); }
    e.appendChild(document.createTextNode(String(t.name).slice(0, 30))); return e;
  }
  function tagsRow(list, cls) {
    const r = document.createElement('div'); r.className = 'k-tags' + (cls ? ' ' + cls : '');
    (list || []).filter(validTag).slice(0, 6).forEach(t => r.appendChild(tagEl(t))); return r;
  }

  /* ---- contraste (WCAG) para avisar al dueño ---- */
  function lum(h) { const f = [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4)); return .2126 * f[0] + .7152 * f[1] + .0722 * f[2]; }
  function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }

  /* Plantillas profesionales (cada una cambia estilo, estructura, encabezado, tarjetas y navegación; no solo colores) */
  const TEMPLATES = [
    { id: 'soft-ui', group: 'pro', recommended: true, name: 'Soft UI', desc: 'Suave, amigable y fácil de leer. La más recomendada.',
      cfg: { template: 'soft-ui', style: 'soft', primary: '#FF3145', secondary: '#2A1F1C', background: '#FBF8F6', textColor: '#2A1F1C', surface: '#FFFFFF', headerStyle: 'centered', hAlign: 'center', bannerH: 'm', itemLayout: 'cards', cardStyle: 'round', imageShape: 'rounded', density: 'normal', nameSize: 30, nameWeight: 800, navFloating: true, navRadius: 26, navBar: 'solid', anim: 'subtle', imgRatio: 'auto', thumb: 72 } },
    { id: 'minimalista', group: 'pro', name: 'Minimalista', desc: 'Fondo limpio, mucho aire y tarjetas discretas.',
      cfg: { template: 'minimalista', style: 'minimal', primary: '#111111', secondary: '#111111', background: '#FFFFFF', textColor: '#111111', surface: '#F7F7F5', headerStyle: 'minimal', hAlign: 'left', itemLayout: 'list', imageShape: 'square', cardStyle: 'square', navStyle: 'underline', density: 'airy', nameSize: 30, nameWeight: 700, catSize: 13, navFloating: false, navBar: 'solid', anim: 'subtle', cardBorder: '#E8E8E4' } },
    { id: 'neomorphism', group: 'pro', name: 'Neomorphism', desc: 'Relieve suave con contraste cuidado.',
      cfg: { template: 'neomorphism', style: 'neo', primary: '#4A5BE8', secondary: '#2D3342', background: '#E6E9EF', textColor: '#2D3342', surface: '#E6E9EF', headerStyle: 'minimal', hAlign: 'left', itemLayout: 'cards', cardStyle: 'round', imageShape: 'rounded', density: 'normal', nameSize: 28, nameWeight: 800, navFloating: true, navRadius: 24, navBar: 'solid', anim: 'subtle', descColor: '#4A5163' } },
    { id: 'glassmorphism', group: 'pro', name: 'Glassmorphism', desc: 'Superficies translúcidas sobre fondo oscuro.',
      cfg: { template: 'glassmorphism', style: 'glass', primary: '#7C8CFF', secondary: '#0B0D17', background: '#10131F', textColor: '#F2F4FA', surface: '#1A1F33', headerStyle: 'centered', hAlign: 'center', bannerH: 'm', itemLayout: 'cards', cardStyle: 'round', imageShape: 'rounded', density: 'normal', nameSize: 30, nameWeight: 800, navFloating: true, navRadius: 28, navBar: 'glass', anim: 'subtle' } },
    { id: 'editorial', group: 'pro', name: 'Editorial premium', desc: 'Tipografía con carácter y jerarquía marcada.',
      cfg: { template: 'editorial', style: 'editorial', primary: '#9B1C1C', secondary: '#1C1917', background: '#F6F1EA', textColor: '#1C1917', surface: '#FFFFFF', headerStyle: 'centered', hAlign: 'center', bannerH: 'm', itemLayout: 'list', imageShape: 'square', imagePosition: 'right', cardStyle: 'square', navStyle: 'underline', density: 'airy', nameSize: 40, nameWeight: 700, titleSize: 30, catSize: 24, catWeight: 700, prodNameSize: 17, navFloating: false, navBar: 'solid', anim: 'subtle', thumb: 76 } },
    { id: 'food-showcase', group: 'pro', name: 'Food showcase', desc: 'Las fotos mandan: cuadrícula visual y comercial.',
      cfg: { template: 'food-showcase', style: 'food', primary: '#E5480F', secondary: '#1B1B1B', background: '#FFFFFF', textColor: '#1B1B1B', surface: '#FFF4EC', headerStyle: 'banner', hAlign: 'left', bannerH: 'm', itemLayout: 'grid', cardStyle: 'round', imageShape: 'rounded', tagPosition: 'overlay', density: 'normal', nameSize: 30, nameWeight: 800, imgRatio: 'portrait', navFloating: true, navRadius: 24, navBar: 'solid', anim: 'dynamic' } },
    { id: 'clasico', group: 'classic', name: 'Clásico', desc: 'Limpio y directo.', cfg: { template: 'clasico' } },
    { id: 'oscuro', group: 'classic', name: 'Noche', desc: 'Fondo oscuro elegante.', cfg: { template: 'oscuro', primary: '#E8B04B', secondary: '#000000', background: '#121212', textColor: '#F4F4F4', surface: '#1C1C1C', headerStyle: 'centered', itemLayout: 'cards', cardStyle: 'soft' } },
    { id: 'minimal', group: 'classic', name: 'Minimal', desc: 'Mucho aire, sin ruido.', cfg: { template: 'minimal', primary: '#111111', secondary: '#111111', headerStyle: 'minimal', navStyle: 'underline', imageShape: 'square', cardStyle: 'square', density: 'airy' } },
    { id: 'vibrante', group: 'classic', name: 'Vibrante', desc: 'Cuadrícula con color.', cfg: { template: 'vibrante', primary: '#FF6B35', secondary: '#1B1B1B', surface: '#FFF3EC', itemLayout: 'grid', imageShape: 'rounded', cardStyle: 'round', headerStyle: 'compact' } },
    { id: 'fresco', group: 'classic', name: 'Fresco', desc: 'Verde natural, tarjetas.', cfg: { template: 'fresco', primary: '#1EA35A', secondary: '#0F2A1D', background: '#F7FBF8', surface: '#E8F4EC', itemLayout: 'cards', imageShape: 'circle', imagePosition: 'right' } },
    { id: 'postres', group: 'classic', name: 'Dulce', desc: 'Suave y acogedor.', cfg: { template: 'postres', primary: '#C2185B', secondary: '#4A1128', background: '#FFF8FA', surface: '#FCE8EF', cardStyle: 'round', imageShape: 'rounded', headerStyle: 'centered', buttonStyle: 'outline' } },
  ];
  /** Lo que se CONSERVA al cambiar de plantilla: textos, redes, qué se muestra u oculta y las opciones avanzadas del plan. */
  const KEEP_ON_TEMPLATE = ADVANCED.concat(['tagline', 'bannerTitle', 'showAbout', 'social', 'showImages', 'showDescriptions', 'showPrices', 'showTags', 'showSearch', 'showHighlights', 'showCategoriesNav', 'showAddress', 'showNav', 'wa', 'els', 'rt']);
  /** Lo que se RESTABLECE (se avisa al dueño): colores, estilo, estructura, tamaños de letra, tarjetas y barra inferior. */
  const RESET_ON_TEMPLATE = 'colores, estilo, estructura, tamaños de letra, tarjetas y barra inferior';
  function applyTemplate(cfg, t) {
    const keep = {}; KEEP_ON_TEMPLATE.forEach(k => { keep[k] = cfg[k]; });
    return normalize({ ...DEFAULTS, ...keep, ...t.cfg });
  }
  /** Colores efectivos (los automáticos resueltos) para avisar de contraste. */
  function effective(c) {
    const n = normalize(c);
    return { title: n.titleColor || n.textColor, desc: n.descColor || mix(n.textColor, n.background, .55), price: n.priceColor || n.textColor, name: n.nameColor || '#FFFFFF', bg: n.background, surface: n.surface, navBg: n.navBg || n.background, navIcon: n.navIcon || mix(n.textColor, n.background, .55), navActive: n.navActive || n.primary, socialBg: n.socialBg || n.background, socialColor: n.socialColor || n.textColor };
  }
  function mix(a, b, t) { const A = [1, 3, 5].map(i => parseInt(a.substr(i, 2), 16)), B = [1, 3, 5].map(i => parseInt(b.substr(i, 2), 16)); return '#' + A.map((v, i) => Math.round(v * t + B[i] * (1 - t)).toString(16).padStart(2, '0')).join('').toUpperCase(); }

  window.KARTTA_DESIGN = { validTag, tagEl, tagsRow, DEFAULTS, ENUM, INTS, WEIGHTS, HEXOPT, FONTS, BLOCKS, ADVANCED, TEMPLATES, RESET_ON_TEMPLATE, normalize, compact, apply, applyTemplate, radiusOf, contrast, effective, lum,
    TX_SLOTS, TX_LABEL, TX_SEL, EL_KINDS, EL_ANCHORS, EL_MAX, gradCss, renderRuns, renderEl, elHref, SOCIAL_TYPES, SOCIAL_LABEL, SOCIAL_ICON, ALLERGENS, parseSocialInput, socialHref, socialVisible, renderSocial };
})();
