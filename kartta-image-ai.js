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
    const MSG = {
      plan_required: 'La generación de imágenes con IA es exclusiva del plan Pro.',
      subscription_inactive: 'Tu plan no está activo. Revisa tu suscripción.',
      forbidden: 'Solo el dueño o un administrador puede usar esta función.',
      daily_limit: 'Ya usaste tus 5 imágenes de hoy. Se reinician a medianoche (hora de Colombia).',
      unsupported_image_type: 'Usa una imagen JPG, PNG o WEBP.',
      image_size_invalid: 'La imagen debe pesar menos de 10 MB.',
      openai_not_configured: 'La generación de imágenes aún no está activada en el servidor.',
      unauthorized: 'Tu sesión expiró. Vuelve a iniciar sesión.'
    };
    const e = new Error(MSG[p?.error] || p?.message || 'No se pudo completar la acción. Intenta de nuevo.');
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
      { id: 'estudio-blanco', name: 'Estudio blanco', desc: 'Fotografía sobre fondo blanco puro, luz neutra y colores fieles.' },
      { id: 'ilustracion-2d', name: 'Ilustración 2D', desc: 'Ilustración publicitaria limpia. Es un dibujo, no una foto real.' },
      { id: 'cinematografico', name: 'Cinematográfico', desc: 'Luz direccional, contraste elegante y profundidad.' },
      { id: 'publicidad-premium', name: 'Publicidad premium', desc: 'Composición comercial de alta gama con foco en el producto.' },
      { id: 'lujo-minimalista', name: 'Lujo minimalista', desc: 'Fondo neutro refinado, luz suave y mucho espacio limpio.' },
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
      return call('generate-product-image', fd); // { generation_id, image_url, remaining_today, daily_limit }
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
