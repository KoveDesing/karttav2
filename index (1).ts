// REEMPLAZADA. La función "ai-assistant-vision" ya no analiza fotos por su cuenta:
// ahora las fotos pasan por "ai-assistant" (misma cuota atómica, mismo historial y mismas protecciones).
// Re-despliega este archivo como "ai-assistant-vision" para que la versión antigua (que contaba con otros
// límites) no pueda usarse para saltarse la cuota, o desactiva esa función en Supabase.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
Deno.serve((req) =>
  req.method === "OPTIONS"
    ? new Response(null, { headers: CORS })
    : new Response(JSON.stringify({ error: "moved", message: "Las fotos ahora se envían desde el chat de IA del panel." }),
        { status: 410, headers: { ...CORS, "Content-Type": "application/json" } }),
);
