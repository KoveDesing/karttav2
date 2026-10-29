# Editor de menús v3 (tipo Canva) — nota técnica

## Archivos
| Archivo | Qué cambió |
|---|---|
| `menu-design.js` | Modelo de diseño v3 (compartido por editor y menú): claves nuevas con los mismos límites que valida la base, 12 plantillas, redes sociales (normalización/validación/iconos), colores efectivos para avisos de contraste. Sin claves nuevas el resultado es idéntico al v2. |
| `menu.html` | Estilos (Minimalista, Soft UI, Neomorphism, Glassmorphism, Editorial, Food), tipografía/color por elemento, banner (título, alineación, altura, oscurecer), tarjetas (proporción, ajuste, posición, separación), barra inferior personalizable (sólida/translúcida/cristal con alternativa sólida, flotante, medidas y colores), redes y sección de contacto, ficha de producto con ingredientes/alérgenos/porción/info, animaciones (`none/subtle/dynamic` + `prefers-reduced-motion`), placeholders de foto. |
| `editor.html` | 10 herramientas: Plantillas (galería con miniaturas reales + vista previa antes de aplicar + primer uso), Diseño, Banner, Texto, Colores, Tarjetas, Navegación, Redes, Productos (CRUD completo) y Secciones. |
| `20261027_editor_menu_v3.sql` | **YA APLICADA** en Supabase (`editor_menu_v3`). Aditiva: 4 columnas en `products`, permisos por columna, trigger de validación, `validate_menu_design` (superset) y `get_public_menu` (+4 campos). |

## Despliegue
Subir **juntos** `menu.html`, `menu-design.js` y `editor.html` a GitHub (Vercel no cachea HTML/JS más allá de revalidar). La migración ya está en la base; el frontend viejo sigue funcionando con ella.

## Reversión
Frontend: restaurar los 3 archivos anteriores. Base: la migración es compatible hacia atrás; si se quisiera deshacer, `drop trigger trg_products_extras on public.products;` y (opcional) `alter table public.products drop column ingredients, drop column allergens, drop column serving, drop column extra_info;` (borra esos datos).

## Decisiones
- Todas las opciones nuevas están disponibles en **todos** los planes. Se mantiene el bloqueo existente del plan Personalizado para fuentes, anuncio, pie y orden de secciones.
- Alérgenos: lista cerrada de 9, marcada por el restaurante; si no marca ninguno, la ficha no muestra el bloque (no afirma “sin alérgenos”).
- Plantilla recomendada: Soft UI. Cambiar de plantilla conserva textos, redes, qué se muestra/oculta y opciones avanzadas; restablece colores, estilo, estructura, tamaños de letra, tarjetas y barra (el editor lo avisa y se puede deshacer).

## Pruebas realizadas (Chromium real; Supabase **simulado**, sin red)
- Menú público: 6 plantillas × (móvil 390 px, 320 px con textos al máximo): sin errores de consola ni desborde horizontal; barra inferior no tapa el pie. 29/29 comprobaciones (ficha, redes seguras, Contacto, Buscar oculto, animación al hacer scroll, reduced-motion, escritorio).
- Editor: 54/54 (primer uso, miniaturas, aplicar/previsualizar/cancelar plantilla, persistencia del borrador, tamaño/color/hex, avisos de contraste, redes, CRUD de productos y categorías, deshacer, publicar, móvil).
- Retrocompatibilidad: 6 diseños v2 antiguos renderizados con el menú anterior y el nuevo: ≤0,9 % de píxeles distintos (el indicador de la barra).
- Base de datos (en transacción revertida y luego sobre producción, solo lectura): 6/6 diseños válidos aceptados, 0 inválidos aceptados, límites exactos de URL (255 ok / 256 no), 16 diseños existentes siguen validando, 10 menús públicos idénticos salvo los 4 campos nuevos.

## NO verificado / no hecho
- No probé con inicio de sesión real ni con dos cuentas: **que un restaurante no pueda editar datos de otro** depende de las políticas RLS existentes (no se tocaron); las consultas del editor filtran por `restaurant_id`, pero no ejecuté la prueba cruzada.
- No ejecuté un pedido real (carrito/mesas/pagos no se modificaron; el menú carga sin errores).
- El panel (`dashboard.html`) no se tocó ni se probó; solo usa `tagEl/tagsRow` de `menu-design.js` (sin cambios).
- No implementado: variantes/extras (el sistema no los tiene), recorte individual por producto (hay posición global centro/arriba/abajo y ajuste Llenar/Completa), tamaños “móvil” separados y visibilidad por dispositivo (el menú siempre usa diseño móvil, también en computadora; los tamaños se escalan solos en pantallas estrechas), foto mejorada con IA y “personalización” premium del producto (siguen en el panel).
- Ingredientes/alérgenos/porción/info se editan solo en el editor (el panel aún no los muestra).
- Cambios visibles en menús existentes: animación sutil de aparición por defecto; en cuadrícula, un producto sin foto ahora muestra un recuadro con su inicial; la barra inferior marca el botón activo.
