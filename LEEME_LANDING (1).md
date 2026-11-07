# KARTTA — Actualización del INDEX (motion + conversión) · versión Master

Sube estos 3 archivos a la raíz del repo (reemplazan a los actuales):
- `index.html`
- `kartta-landing.css`
- `kartta-landing.js`

No se tocó: Supabase, autenticación, Wompi/checkout, `kartta-plans.js`, precios, planes ni rutas.

## Antes de publicar
1. **Duración de la prueba.** La web dice 7 días. Tu migración de pagos deja `billing_settings.trial_days` en **30** por defecto. Ponlo en 7 desde el panel (Finanzas → ajustes) o la web prometerá algo distinto a lo que recibe el cliente. Para cambiar los días en toda la web: `TRIAL_DAYS` al inicio de `kartta-landing.js`.
2. **Ventana emergente "Oferta de lanzamiento".** Antes aparecía a los 4 s y tapaba la pantalla; ahora aparece a los 15 s, nunca sobre el registro, y una vez por sesión (`index.html`, busca `15000`). Si prefieres quitarla, la cinta y los CTA ya cubren esa función.

## Jerarquía de movimiento (no todo rebota)
Cada animación tiene una curva según su importancia (`--kx-ez` en `kartta-landing.css`):
- **Secundarios** (eyebrows, párrafos, listas, FAQ, pie): ease-out, sin rebote.
- **Intermedios** (títulos por palabras, tarjetas, imágenes, píldoras): resorte suave (~3 %).
- **Protagonistas** (`data-strong`: título y CTA del hero, tarjetas de planes, bloque de prueba, promos, CTA final): resorte marcado (~10 %).

## Las animaciones no retrasan el registro
- El visitante sin sesión guardada ve hero, "Entrar" y "Crear mi KARTTA" **sin esperar a Supabase** (antes quedaban ocultos hasta que Supabase respondía, máximo 4 s).
- El CTA principal del hero entra a ~0,5 s y se puede pulsar en cualquier momento (probado con clic real a mitad de animación).
- La barra inferior entra a los 0,15 s. Ningún botón usa `pointer-events:none` mientras anima.
- La cinta resta su altura del relleno del hero: el CTA queda donde estaba, visible sin hacer scroll.

## Publicidad con intención (cada bloque lleva a algo)
| Dónde | Qué ofrece | Destino |
|---|---|---|
| Cinta superior | Prueba 7 días | Registro |
| Hero | Comenzar gratis · Iniciar sesión · Ver cómo funciona | Registro / login / #como-funciona |
| Cómo funciona | "Tu restaurante merece mucho más que un menú digital" | Registro + #precios |
| Espacio propio | Crear mi espacio | Registro |
| Analytics | Ver mis números en KARTTA · Comparar planes | Registro / #precios |
| Diferenciación | "Organiza, presenta y potencia…" | Registro |
| Soluciones | Tarjeta de descubrimiento por tipo de negocio | Registro |
| Precios | Bloque de prueba, planes, comparar planes, Actualizar a Pro | Registro / `/checkout?plan=…` con sesión |
| Final | Crear mi cuenta · Comenzar mi prueba gratuita | Registro |

Con sesión iniciada la cinta y los bloques de prueba se ocultan y los botones de registro pasan a "Ir a mi panel".

## Otros cambios de esta versión
- Barra inferior: al pasar el cursor el icono sube, se inclina a la derecha, escala y vuelve con resorte; al tocar (móvil) hace el mismo pulso.
- Parallax moderado en el hero y en la imagen de personalización (un solo listener pasivo + rAF; solo ≥768 px).
- Botones de plan con flecha animada.
- El carrusel de "Cómo funciona" solo avanza solo mientras está en pantalla.
- Precarga de la imagen del hero para el LCP.

## Cómo ajustar
- Qué animación usa cada sección: lista `MAP` en `kartta-landing.js`.
- Colores, curvas y distancias: variables al inicio de `kartta-landing.css`.
- Respeta `prefers-reduced-motion`: sin animaciones, todo visible.
