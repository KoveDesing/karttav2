# DECISIONES PENDIENTES (necesitan al propietario)

1. **Precios y planes.** Hoy: landing $0 / $43.900 / $84.900 / $249.000; contexto menciona $44.900; BD: solo `pro = 84.900`. Confirmar nombre, precio, periodicidad, impuestos, prueba gratis y límites de cada plan. Hasta entonces la BD no tiene precios de KARTTA ni Personalizado.
2. **Dominio y formato de URL.** `kartta.IDENTIFICADOR.food` exige controlar `IDENTIFICADOR.food` (un dominio completo por restaurante); poseer `kartta.food` NO lo permite. Alternativas: (a) `identificador.kartta.food` con comodín `*.kartta.food` en Vercel; (b) `kartta.food/m/identificador` (lo que funciona hoy como `/m/identificador`). Indicar cuál dominio posees, dónde se administra el DNS y el formato elegido.
3. **Proveedor de IA por función.** Texto: Groq (`openai/gpt-oss-120b`). Visión: Groq (`llama-4-scout`, cambiable por secreto). Imágenes: OpenAI (`gpt-image-2.5-sunburst` en el código desplegado). Confirmar que son las decisiones definitivas y que el modelo de imágenes existe en tu cuenta.
4. **Límites de archivos.** Hoy: imágenes IA 10 MB (servidor) · visión 4 MB · bucket de menú 5 MB. ¿Un único límite? ¿Qué se permite para «subir menú» (PDF/CSV/XLSX)?
5. **Cuotas de IA de texto** (hoy 20/mes gratis, 200/mes Pro+) y regla de imágenes (5/día Pro+): confirmar que siguen vigentes.
6. **Proveedor de pagos** (Wompi/Mercado Pago), estado de aprobación de la cuenta y quién es el titular legal.
7. **Qué es «ingreso cobrado»** y qué estadísticas debe ver el panel del propietario.
8. **CORS:** lista de orígenes permitidos cuando el dominio final exista.
9. **Panel del propietario:** ¿el código de interfaz de «Kartta Admin» se integra a este repo o permanece separado?
10. **Acciones del chat de IA** (editar precios/disponibilidad) con confirmación: ¿se autoriza el alcance?

11. **Qué personalización es de qué plan.** Hoy (según el candado «Personalización avanzada (tipografías, secciones, CSS)» que ya existía): colores, plantillas, disposición, formas, espaciado y textos básicos → todos los planes; **tipografías, orden/visibilidad de secciones, anuncio y texto de pie → solo plan Personalizado (rank ≥ 3)**, impuesto también en la base de datos. «CSS libre» NO se ofrece (riesgo de seguridad). Si quieres abrir más opciones a Pro, cambiar `adv_min_rank` en `validate_menu_design`.
12. **Banner/logo:** siguen subiéndose desde el panel (no desde el editor).
