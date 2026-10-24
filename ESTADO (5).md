# Estado de funcionalidades

Leyenda: ✅ comprobado · 🟡 implementado en el código, falta desplegar/probar · ⏳ pendiente

| Función | Estado | Nota |
|---|---|---|
| Esquema, RLS, límites de plan | ✅ | 56 pruebas SQL de aislamiento entre restaurantes (revertidas). |
| Registro / login con correo | 🟡 | Sin confirmación por correo. Requiere desactivar «Confirm email» en Supabase Auth. |
| Login con Google | ⏳ | Activar el proveedor en Supabase y registrar las URL de retorno. |
| Edad 18+ y consentimientos | 🟡 | `consentimiento.html` + migración `20261022_edad_consentimientos.sql` (falta ejecutarla y probar). |
| Páginas legales y cookies | 🟡 | Campos [PENDIENTE] del responsable legal. |
| Subdominio oficial `kartta.IDENTIFICADOR.food` | 🟡 | Editor en Dominio (solo el centro). Migración `20261024_subdominio_e_imagenes_ia.sql`. Dominios propios eliminados del panel. **El DNS de `*.food` no está resuelto: ver CAMBIOS_FASES.md.** |
| KARTTA Images AI (6 estilos, Pro, 5/día) | 🟡 | Funciones `generate-product-image` y `apply-generated-product-image`, helper `kartta-image-ai.js`. Falta: ejecutar migración, desplegar, secreto `OPENAI_API_KEY`, prueba real. |
| KARTTA AI con fotos (visión) | 🟡 | Función `ai-assistant-vision` (solo análisis, lectura). Falta secreto `GEMINI_API_KEY` y desplegar. |
| KARTTA AI con acciones (editar productos por chat) | ⏳ | No implementado: requiere ver la función `ai-assistant` desplegada. |
| i18n (ES/EN/DE) | ⏳ | No implementado. |
| Asistente de IA (texto) | ⏳ | Función desplegada; falta el secreto de IA. |
| Pagos (Wompi / Mercado Pago) | ⏳ | Tablas listas; falta proveedor y webhooks. |
| Panel de administración global | ⏳ | `platform_admins` listo; falta la interfaz. |
