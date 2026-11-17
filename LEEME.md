# Editor tipo Canva — Fase 1 (elementos)

Archivos: editor.html, menu.html, menu-design.js, 20261117_editor_canva.sql

1. Ejecuta primero `20261117_editor_canva.sql` en Supabase (idempotente, no borra datos; pruébalo en una rama).
2. Sube los 3 archivos al repo.

Qué trae (sobre los elementos del menú):
- Selección con borde y manijas en la vista previa: ancho (laterales) y rotación (arriba, con ajuste cada 15°; Mayús lo fuerza).
- Mayús + clic: selección múltiple. Agrupar / desagrupar (los grupos se mueven juntos).
- Bloquear / desbloquear (también desde Capas con el candado). Un elemento bloqueado no se mueve, edita ni elimina.
- Copiar, cortar, pegar, duplicar; copiar y pegar estilo.
- Formato: negrita, cursiva, subrayado, espaciado de letras, interlineado, opacidad, ancho, rotación, "Centrar y enderezar".
- Atajos: Ctrl+C / X / V / D, Ctrl+Alt+C / V (estilo), Ctrl+G / Ctrl+Mayús+G, Ctrl+Mayús+L, Supr, Esc, flechas (Mayús = ×10), Ctrl+Z / Ctrl+Mayús+Z / Ctrl+Y. No actúan mientras escribes en un campo y también funcionan con el foco dentro de la vista previa.
- Planes: bloqueo y negrita/cursiva/subrayado desde Pro; rotación, opacidad, ancho, espaciado, interlineado y grupos en Elite (igual que el arrastre libre). El servidor lo valida.
- Corregido: el botón "Recuperar Pro" se veía siempre (el CSS ignoraba `hidden`).

Nota: la propiedad de subrayado se llama `ul` (la `u` ya es el enlace).
Siguiente: simuladores iPhone/iPad/MacBook, 50 tipografías + subida de fuentes, biblioteca de plantillas.
