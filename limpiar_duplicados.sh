#!/bin/bash
# Borra duplicados con sufijo (n). Ejecutar desde la RAIZ del repo.
# Por defecto solo MUESTRA lo que borraria. Para borrar de verdad:  ./limpiar_duplicados.sh --borrar
# Incluye tambien kartta-image-ai.js (generacion de imagenes con IA, funcion eliminada).
# Solo incluye copias IDENTICAS byte a byte a otro archivo del repo, mas dashboard (11) y (12) (versiones antiguas verificadas).
MODO="$1"
while IFS= read -r f; do
  [ -e "$f" ] || continue
  if [ "$MODO" = "--borrar" ]; then rm -v -- "$f"; else echo "borraria: $f"; fi
done <<'LISTA'
ARQUITECTURA (1) (2) (3).md
ARQUITECTURA (1) (2).md
ARQUITECTURA (1).md
CAMBIOS_FASES (2).md
ESTADO (3).md
dashboard (11).html
dashboard (12).html
index (5).ts
landing-1 (3).png
landing-1 (4).png
landing-1 (5) (6).png
landing-1 (5).png
landing-1 (6).png
landing-2 (4).webp
landing-2 (5).webp
landing-2 (6).webp
landing-2 (7) (8).webp
landing-2 (7).webp
landing-3 (5).jpg
landing-3 (6).jpg
landing-3 (7).jpg
landing-3 (8).jpg
landing-3 (9).jpg
landing-4 (10).jpg
landing-4 (6).jpg
landing-4 (7).jpg
landing-4 (8).jpg
landing-4 (9).jpg
landing-5 (10).jpg
landing-5 (11).jpg
landing-5 (7).jpg
landing-5 (8).jpg
landing-5 (9).jpg
landing-6 (10).jpg
landing-6 (11).jpg
landing-6 (12).jpg
landing-6 (8).jpg
landing-6 (9).jpg
landing-7 (10).png
landing-7 (11).png
landing-7 (12).png
landing-7 (13).png
landing-7 (9).png
supabase-init (1).js
kartta-image-ai.js
LISTA
