/**
 * KARTTA Images AI — helper del navegador.
 * Contrato: window.KARTTA_IMAGE_AI.generate({ restaurantId, image, style, instructions })
 *           window.KARTTA_IMAGE_AI.applyToProduct({ restaurantId, generationId, productId })
 *           window.KARTTA_IMAGE_AI.quota(restaurantId)
 * Toda la seguridad (plan, cuota, permisos) la decide el servidor; aquí solo se llama.
 */
(function () {
  const sb = () => window.KARTTA_SB;
  async function parseError(error) {
    let p = null;
    try { p = await error.context.json(); } catch (_) {}
    const e = new Error(p?.message || 'No se pudo completar la acción. Intenta de nuevo.');
    e.code = p?.error || 'unknown';
    return e;
  }
  async function call(name, body) {
    if (!sb()) throw Object.assign(new Error('Conexión no disponible.'), { code: 'no_client' });
    const { data, error } = await sb().functions.invoke(name, { body });
    if (error) throw await parseError(error);
    return data;
  }
  window.KARTTA_IMAGE_AI = {
    STYLES: [
      { id: 'estudio_blanco', name: 'Estudio blanco', desc: 'Fotografía sobre fondo blanco puro, luz neutra y colores fieles.' },
      { id: 'ilustracion_2d', name: 'Ilustración 2D', desc: 'Ilustración publicitaria limpia. Es un dibujo, no una foto real.' },
      { id: 'cinematografico', name: 'Cinematográfico', desc: 'Luz direccional, contraste elegante y profundidad.' },
      { id: 'publicidad_premium', name: 'Publicidad premium', desc: 'Composición comercial de alta gama con foco en el producto.' },
      { id: 'lujo_minimalista', name: 'Lujo minimalista', desc: 'Fondo neutro refinado, luz suave y mucho espacio limpio.' },
      { id: 'editorial', name: 'Fotografía editorial', desc: 'Calidad de revista gastronómica, luz natural y texturas reales.' },
    ],
    async quota(restaurantId) {
      const { data, error } = await sb().rpc('image_quota', { p_restaurant_id: restaurantId });
      if (error) throw error;
      return data; // { plan_ok, used, limit, remaining }
    },
    async generate({ restaurantId, image, style, instructions }) {
      const fd = new FormData();
      fd.append('restaurant_id', restaurantId);
      fd.append('style', style);
      fd.append('image', image);
      if (instructions) fd.append('instructions', instructions);
      return call('generate-product-image', fd); // { generation_id, url, expires_in, quota }
    },
    async applyToProduct({ restaurantId, generationId, productId }) {
      return call('apply-generated-product-image', { restaurant_id: restaurantId, generation_id: generationId, product_id: productId });
    },
    async askWithPhoto({ restaurantId, image, message }) {
      const fd = new FormData();
      fd.append('restaurant_id', restaurantId); fd.append('message', message); fd.append('image', image);
      return call('ai-assistant-vision', fd); // { reply }
    },
  };
})();
