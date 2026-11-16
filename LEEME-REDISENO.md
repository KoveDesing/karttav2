# Rediseño visual KARTTA — qué subir

Sube estos archivos a GitHub **en la raíz del repo, reemplazando los existentes** (mismo nombre):

- NUEVOS: `kartta-ui.css`, `kartta-ui.js`
- MODIFICADOS: `index.html`, `dashboard.html`, `editor.html`, `checkout.html`, `checkout.css`,
  `onboarding.html`, `terminos.html`, `privacidad.html`, `cookies.html`, `consentimiento.html`

No cambié lógica, ids, Supabase, pagos, OTP, QR, fidelización ni KARTTA AI.
Cada página solo recibió: `data-kui="..."` en `<html>`, el enlace a `kartta-ui.css`/`kartta-ui.js`
antes de `</head>`, y (index) una sección nueva "Por dentro de KARTTA" antes de Precios.

## Si algo no te gusta
- Para volver a una página a como estaba: sube de nuevo su versión anterior.
- Para apagar TODO el rediseño sin tocar nada más: borra `kartta-ui.css` del repo.

## Nota sobre la fuente del logo
Las páginas piden `/fonts/mr-dafoe.css`. Verifica que en tu repo exista la carpeta `fonts/`
con `mr-dafoe.css` y `MrDafoe-Regular.woff`; si no, el logo saldrá con otra letra.
