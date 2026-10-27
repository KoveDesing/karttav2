/**
 * KARTTA — Modelo de diseño del menú (compartido por menu.html y editor.html).
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
  };
  const DEFAULTS = {
    v: 2, primary: '#FF3145', secondary: '#0A0A0A', background: '#FFFFFF', textColor: '#0A0A0A', surface: '#F5F5F3',
    tagline: '', showImages: true, showDescriptions: true, showPrices: true, showCategoriesNav: true, showAddress: true, showTags: true, showSearch: true, showNav: true, showHighlights: true,
    cardStyle: 'round', buttonStyle: 'solid', size: 'm', headerStyle: 'banner', navStyle: 'pills',
    itemLayout: 'list', imageShape: 'rounded', imagePosition: 'left', tagPosition: 'inline', density: 'normal', radius: null,
    fontHeading: 'Inter', fontBody: 'Inter', blocks: BLOCKS.slice(), announcement: '', footerText: '',
  };
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
    o.v = 2;
    return o;
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

  /** Aplica el diseño a un elemento raíz (html): variables CSS + atributos data-*. */
  function apply(cfg, root) {
    const c = normalize(cfg), s = root.style;
    s.setProperty('--red', c.primary); s.setProperty('--black', c.secondary); s.setProperty('--bg', c.background);
    s.setProperty('--tx', c.textColor); s.setProperty('--surface', c.surface);
    s.setProperty('--rad', radiusOf(c) + 'px'); s.setProperty('--fs', { s: .9, m: 1, l: 1.12 }[c.size]);
    s.setProperty('--backdrop', lum(c.background) < .25 ? '#08080A' : 'color-mix(in srgb, ' + c.primary + ' 9%, #E9E9EC)');
    s.setProperty('--dn', { compact: .7, normal: 1, airy: 1.4 }[c.density]);
    s.setProperty('--fh', `'${c.fontHeading}', -apple-system, sans-serif`); s.setProperty('--fb', `'${c.fontBody}', -apple-system, sans-serif`);
    const d = root.dataset;
    d.hs = c.headerStyle; d.nav = c.navStyle; d.il = c.itemLayout; d.is = c.imageShape; d.ip = c.imagePosition; d.bs = c.buttonStyle;
    d.hsticky = c.blocks[0] === 'header' ? '1' : '0';
    loadFonts(c);
    return c;
  }
  function loadFonts(c) {
    const need = [...new Set([c.fontHeading, c.fontBody])].filter(f => f !== 'Inter');
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

  const TEMPLATES = [
    { id: 'clasico', name: 'Clásico', desc: 'Limpio y directo.', cfg: {} },
    { id: 'oscuro', name: 'Noche', desc: 'Fondo oscuro elegante.', cfg: { primary: '#E8B04B', secondary: '#000000', background: '#121212', textColor: '#F4F4F4', surface: '#1C1C1C', headerStyle: 'centered', itemLayout: 'cards', cardStyle: 'soft' } },
    { id: 'minimal', name: 'Minimal', desc: 'Mucho aire, sin ruido.', cfg: { primary: '#111111', secondary: '#111111', headerStyle: 'minimal', navStyle: 'underline', imageShape: 'square', cardStyle: 'square', density: 'airy' } },
    { id: 'vibrante', name: 'Vibrante', desc: 'Cuadrícula con color.', cfg: { primary: '#FF6B35', secondary: '#1B1B1B', surface: '#FFF3EC', itemLayout: 'grid', imageShape: 'rounded', cardStyle: 'round', headerStyle: 'compact' } },
    { id: 'fresco', name: 'Fresco', desc: 'Verde natural, tarjetas.', cfg: { primary: '#1EA35A', secondary: '#0F2A1D', background: '#F7FBF8', surface: '#E8F4EC', itemLayout: 'cards', imageShape: 'circle', imagePosition: 'right' } },
    { id: 'postres', name: 'Dulce', desc: 'Suave y acogedor.', cfg: { primary: '#C2185B', secondary: '#4A1128', background: '#FFF8FA', surface: '#FCE8EF', cardStyle: 'round', imageShape: 'rounded', headerStyle: 'centered', buttonStyle: 'outline' } },
  ];
  function applyTemplate(cfg, t) {
    const keep = {}; ADVANCED.concat(['tagline', 'showImages', 'showDescriptions', 'showPrices']).forEach(k => { keep[k] = cfg[k]; });
    return normalize({ ...DEFAULTS, ...keep, ...t.cfg });
  }

  window.KARTTA_DESIGN = { validTag, tagEl, tagsRow, DEFAULTS, ENUM, FONTS, BLOCKS, ADVANCED, TEMPLATES, normalize, compact, apply, applyTemplate, radiusOf, contrast };
})();
