# Estado de funcionalidades

Leyenda: ✅ comprobado · 🟡 implementado, falta probar en producción · ⏳ pendiente

| Función | Estado | Nota |
|---|---|---|
| Esquema, RLS, límites de plan | ✅ | 56 pruebas SQL de aislamiento entre restaurantes (revertidas). |
| Registro / login con correo | 🟡 | Requiere confirmar la configuración de Auth (ver abajo). |
| Login con Google | ⏳ | Hay que activar el proveedor en Supabase. |
| Onboarding | 🟡 | Guarda en Supabase y publica el menú. |
| Productos y categorías | 🟡 | Imágenes en Storage (ya no Base64). |
| Editor visual (borrador → publicar) | 🟡 | Colores, tarjetas, tamaño, textos. Plantillas: ⏳. |
| Carta pública y QR por mesa | 🟡 | `/m/<slug>?mesa=N`. |
| Pedidos de clientes | 🟡 | `place_order`; el precio lo fija el servidor. |
| Estadísticas | 🟡 | Ventas = solo pedidos pagados. Visitas = eventos medidos. |
| Asistente de IA | ⏳ | Función desplegada; falta el secreto `GEMINI_API_KEY`. |
| Dominios propios | ⏳ | Se guardan como "por verificar"; falta verificar DNS y agregarlos en Vercel. |
| Pagos (Wompi / Mercado Pago) | ⏳ | Tablas listas; falta el proveedor, webhooks y pruebas en sandbox. |
| Panel de administración global | ⏳ | `platform_admins` listo; falta la interfaz. |
