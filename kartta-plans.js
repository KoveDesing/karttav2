/* KARTTA — fuente única de planes, precios y límites (cliente).
 * La BD (tabla plans) es la autoridad para permisos; esto solo alimenta la interfaz.
 * Importes en pesos enteros (COP). Sin decimales: no hay redondeo silencioso. */
(function (w) {
  'use strict';
  var ANNUAL_DISCOUNT = 27; // %
  var PLANS = {
    free: { code: 'free', name: 'Free', rank: 0, monthly: 0,
      tagline: 'Conoce KARTTA y organiza tu menú de forma básica.',
      limits: { products: 20, tables: 5, templates: 2, users: 1, ai_credits: 20 },
      features: ['Página pública básica y menú digital', 'QR de acceso al menú', 'Edición de nombres, precios, descripciones e imágenes'],
      locked: ['Editor visual avanzado', 'Tipografías, iconos y branding', 'Analítica avanzada'] },
    pro: { code: 'pro', name: 'KARTTA Pro', rank: 1, monthly: 43900, recommended: true,
      tagline: 'Profesionaliza tu presencia y personaliza tu menú.',
      limits: { products: 500, tables: 30, templates: 'all', users: 5, ai_credits: 300 },
      features: ['Todas las plantillas', 'Editor visual avanzado', 'Colores, tipografías, iconos y estilos', 'Logo y branding del restaurante', 'Analítica del restaurante', 'QR personalizado'] },
    elite: { code: 'elite', name: 'KARTTA Elite', rank: 2, monthly: 84900,
      tagline: 'La experiencia más completa de KARTTA.',
      limits: { products: 2000, tables: 100, templates: 'all', users: 15, ai_credits: 1000 },
      features: ['Todo lo de Pro', 'Mayor capacidad de personalización', 'Branding avanzado', 'Analítica avanzada', 'Herramientas de IA de Elite'] }
  };
  // Ids antiguos de la BD/cliente → plan vigente (se conservan para no romper datos existentes)
  var LEGACY = { trial: 'free', kartta: 'pro', custom: 'elite' };
  var cop = new Intl.NumberFormat('es-CO');
  function fmt(n) { return '$' + cop.format(n) + ' COP'; }
  function annual(code) { var m = PLANS[code].monthly; return Math.round(m * 12 * (100 - ANNUAL_DISCOUNT) / 100); }
  function price(code, interval) {
    var m = PLANS[code].monthly, y = annual(code), full = m * 12;
    if (interval === 'annual') return { interval: 'annual', total: y, perMonth: Math.round(y / 12), full: full, saving: full - y, discount: m ? ANNUAL_DISCOUNT : 0 };
    return { interval: 'monthly', total: m, perMonth: m, full: full, saving: 0, discount: 0 };
  }
  w.KARTTA_PLANS = { ANNUAL_DISCOUNT: ANNUAL_DISCOUNT, plans: PLANS, order: ['free', 'pro', 'elite'], fmt: fmt, price: price,
    resolve: function (id) { id = LEGACY[id] || id; return PLANS[id] ? id : 'free'; },
    get: function (id) { return PLANS[this.resolve(id)]; } };
})(window);
