/* KARTTA — fuente única de planes, precios y límites (cliente).
 * La BD (tabla plans) es la autoridad para permisos y el servidor recalcula todo importe antes de cobrar.
 * Importes en pesos enteros (COP), sin redondeos silenciosos. Los códigos coinciden con plans.id de la BD. */
(function (w) {
  'use strict';
  var ANNUAL_DISCOUNT = 50; // % sobre 12 mensualidades
  var PLANS = {
    free: { code: 'free', name: 'Free', rank: 0, monthly: 0,
      tagline: 'Conoce KARTTA y organiza tu menú de forma básica.',
      limits: { products: 20, tables: 5, templates: 2, users: 1, ai_credits: 20 },
      features: ['Página pública básica y menú digital', 'QR de acceso al menú', 'Edición de nombres, precios, descripciones e imágenes'],
      locked: ['Editor visual avanzado', 'Tipografías, iconos y branding', 'Analítica avanzada'] },
    kartta: { code: 'kartta', name: 'KARTTA Pro', rank: 1, monthly: 43900, recommended: true,
      tagline: 'Profesionaliza tu presencia y personaliza tu menú.',
      limits: { products: 500, tables: 30, templates: 'all', users: 5, ai_credits: 300 },
      features: ['Todas las plantillas', 'Editor visual avanzado', 'Colores, tipografías, iconos y estilos', 'Logo y branding del restaurante', 'Analítica del restaurante', 'QR personalizado'] },
    pro: { code: 'pro', name: 'KARTTA Elite', rank: 2, monthly: 84900,
      tagline: 'La experiencia más completa de KARTTA.',
      limits: { products: 2000, tables: 100, templates: 'all', users: 15, ai_credits: 1000 },
      features: ['Todo lo de KARTTA Pro', 'Mayor capacidad de personalización', 'Branding avanzado', 'Analítica avanzada', 'Herramientas de IA de Pro'] }
  };
  // IDs internos: kartta = KARTTA Pro · pro = KARTTA Elite (se conservan por compatibilidad). Ids antiguos → plan vigente (se conservan para no romper datos existentes)
  var LEGACY = { trial: 'free', standard: 'kartta', elite: 'pro', custom: 'pro' };
  var cop = new Intl.NumberFormat('es-CO');
  function fmt(n) { return '$' + cop.format(n) + ' COP'; }
  function price(code, interval) {
    var m = PLANS[code].monthly, full = m * 12;
    if (interval === 'annual' && m) { var total = full * (100 - ANNUAL_DISCOUNT) / 100;
      return { interval: 'annual', main: total / 12, before: m, total: total, full: full, saving: full - total, discount: ANNUAL_DISCOUNT }; }
    return { interval: 'monthly', main: m, before: null, total: m, full: full, saving: 0, discount: 0 };
  }
  w.KARTTA_PLANS = { ANNUAL_DISCOUNT: ANNUAL_DISCOUNT, plans: PLANS, order: ['free', 'kartta', 'pro'], fmt: fmt, price: price,
    resolve: function (id) { id = LEGACY[id] || id; return PLANS[id] ? id : 'free'; },
    get: function (id) { return PLANS[this.resolve(id)]; } };
})(window);
