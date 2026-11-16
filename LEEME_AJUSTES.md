# KARTTA — Ajustes del index (rendimiento, sección de celulares y grises)

Sube estos 4 archivos a la raíz del repo (reemplazan a los actuales):
- `index.html`
- `kartta-landing.css`
- `kartta-ui.css`
- `kartta-ui.js`

No se tocó: Supabase, autenticación, pagos, planes, precios, rutas, textos ni ninguna función existente.

## 1. Fluidez
- Modo ligero automático en móviles / equipos modestos / "ahorro de datos": mismas entradas (aparición + movimiento + escala), sin el desenfoque animado, que era lo más caro de pintar.
- En contenedores grandes (carrusel, gráficas, planes, imágenes) se quitó solo el desenfoque de la entrada; el resto de la animación es igual.
- Pantalla de carga: espera máxima de fuentes 2,8 s → 1,8 s, y en el index ya no se apila una segunda pantalla de carga encima de la primera (`kartta-ui.js`).
- Imagen principal del hero: precarga + prioridad alta (antes era `loading="lazy"`, lo contrario a lo que necesita el LCP). Imágenes bajo el pliegue: carga perezosa.
- Celulares flotantes: el listener de scroll ya no fuerza maquetación en cada evento ni trabaja fuera de pantalla.
- Versionado nuevo (`?v=20261116`) para que el navegador descargue los archivos actualizados.

## 2. Sección "Por dentro de KARTTA" (#demo)
- Los 3 celulares son más grandes y están cortados por la mitad (se ve la parte de arriba con la información). El contenido de cada pantalla escala con el celular.
- La sección es ~21 % más corta en escritorio (1558 → 1229 px) y ~23 % en móvil (1224 → 941 px).
- El botón "Crear mi KARTTA" sube justo debajo del corte (antes estaba al final de la sección); mismo enlace y mismo seguimiento (`data-kt`).
- En móvil ahora se ven los 3 celulares (los laterales asoman detrás del central).

## 3. Grises (sin tonos azulados)
- Barra flotante inferior: gradiente gris oscuro neutro `#2B2B2B → #171717` (antes `#1E1E22 → #0E0E10`, con tinte azul). Solo en el index: el dock del panel no cambia.
- Celulares, ficha QR, botones de los celulares y fondos de ventanas: negros azulados (`#0F0F11`, `#3A3A3E`, `#2D2D30`, `rgba(16,16,32,…)`, etc.) → grises neutros.

## Ajuste final
- Título de "Por dentro de KARTTA": "pedidos", "números" y "tiempo real" con el rectángulo coral (`.hl`) y la animación por palabras del resto de la web.
- Los 3 celulares tienen marco negro y esquinas más redondeadas, proporcionales a su tamaño.

## Dashboard (`dashboard.html`)
- Dominio y enlaces: se quitó la card "Mi página / Próximamente"; las otras 2 cards se acomodan solas.
- Franja de prueba: estilo neomorphism en gris oscuro, icono "tt" (Mr Dafoe, blanco) en lugar del número y los días dentro del texto con rectángulo coral ("Te quedan [6 días] de KARTTA Pro"). Botón "Mejorar plan" igual.
