# Estado (24-oct-2026)

Leyenda: ✅ implementado y probado (local/SQL) · 🚀 desplegado en Supabase · 🟡 implementado, NO probado · ⚙️ bloqueado por configuración · ⏳ no implementado

| Función | Estado | Nota |
|---|---|---|
| RLS y aislamiento por restaurante | ✅🚀 revisado | Prueba negativa con 2 usuarios reales: NO EJECUTADA |
| Privilegios de pagos/dominios | ✅🚀 | `payment_events` cerrado; INSERT en `restaurant_domains` revocado |
| Pedidos (`place_order`) | ✅🚀 | Precio en servidor, rechaza ítems no disponibles, antiduplicado 20 s |
| Cuota de imágenes IA (Pro, 5/día, owner/admin) | ✅🚀 | Generación real con OpenAI: NO probada |
| Generar/aplicar imagen (funciones) | 🚀 ⚙️ | Falta confirmar OPENAI_API_KEY y modelo |
| Panel de imágenes IA en dashboard | 🟡 | Sin desplegar el frontend |
| Editor de identificador (slug) + redirección de enlaces viejos | ✅🚀 (BD) · 🟡 (UI) | Formato `kartta.X.food` pendiente de decisión de dominio |
| Chat IA texto | 🚀 ⚙️ | Groq |
| Chat IA con foto (visión) | 🚀 🟡 | Sin probar con foto real |
| Chat IA con historial/memoria, acciones, importar menú | ⏳ | |
| Editor visual (editor.html): plantillas, colores, encabezado, categorías, productos, tipografía, secciones, deshacer/rehacer, borrador + publicar, vista previa real | ✅ probado en navegador con datos simulados · 🚀 validación en BD · 🟡 sin probar con sesión real de Supabase ni desplegado | Tipografía y secciones: solo plan Personalizado (rank ≥ 3) — decisión pendiente |
| Métricas del dashboard | 🟡 | Reales (pedidos pagados); «hoy» en hora de Colombia; sin filtros 24h/7/30/90 |
| Marketing / fidelización / correo | ⏳ | |
| Pagos y suscripciones (Wompi/MP) | ⏳ | Sin proveedor |
| Panel del propietario | 🚀 separado | Proyecto «Kartta Admin» (solo lectura); UI fuera de este repo |
| i18n ES/EN/DE | ⏳ | |
| Precios unificados | ⚙️ | Decisión pendiente |
| Menú público como app móvil (marco en PC) + ficha de producto a pantalla completa | ✅ probado en navegador (datos simulados) · 🟡 sin desplegar | |
| Guía interactiva del panel (9 pasos) + lista de tareas | ✅ probado en navegador (datos simulados) · 🟡 sin desplegar | Progreso en `profiles.prefs.tour` |
| Etiquetas de producto/categoría | ⏳ | Siguiente bloque |
| IA de fotos con autorización al subir imagen | ⏳ | Existe versión en Personalizar (Pro) |
| Etiquetas de producto/categoría | ✅ BD probada · ✅ panel/menú probados (simulado) · 🟡 sin desplegar el frontend | |
| IA de fotos al subir con comparación | ✅ flujo probado (simulado) · ⚙️ generación real sin probar | Plan Pro + OPENAI_API_KEY |
| Buscador, barra inferior, favoritos, destacados | ✅ probado (simulado) | |
| Pedidos con estados y historial | ✅ BD + panel probados | |
| Ordenar productos / Exportar menú | ✅ probado (simulado) | |
| Fidelización, email marketing, planes visibles, variantes/adicionales, pagos | ⏳ | Siguientes bloques |
