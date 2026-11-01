// KARTTA AI — chat del dashboard (texto y foto) con streaming, historial, memoria y cuota mensual atómica.
// Despliegue: verify_jwt = true. Archivos: index.ts + core.js (misma carpeta).
// Secretos (solo servidor): GROQ_API_KEY. Opcionales: GROQ_TEXT_MODEL, GROQ_VISION_MODEL.
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
//
// Seguridad (todo en el servidor):
//  - Sesión válida + rol owner/admin del restaurante (RLS con el token del usuario).
//  - La cuota y el plan se calculan en la base (ai_reserve_question); el navegador no decide nada.
//  - El modelo solo recibe datos del propio restaurante, su memoria y el historial de ESE chat.
//  - Peticiones de información interna de KARTTA se detienen ANTES de llamar al modelo (core.js).
//  - La salida del modelo se escanea en vivo en busca de secretos o del prompt interno.
//  - El modelo no tiene herramientas: no hay SQL, ni código, ni acceso a tablas.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  REFUSAL, LIMITS, cleanText, detectConfidentialRequest, scanOutput, extractMemoryCommand, formatMemory,
  trimHistory, makeTitle, buildSystemPrompt, readUsage, sseEvent, createSSEParser,
} from "./core.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9_-]{8,80}$/;
const TEXT_MODEL = Deno.env.get("GROQ_TEXT_MODEL") || "openai/gpt-oss-120b";
const VISION_MODEL = Deno.env.get("GROQ_VISION_MODEL") || "meta-llama/llama-4-scout-17b-16e-instruct";
const MAX_IMAGE = 4 * 1024 * 1024;
const MAX_CONVERSATIONS = 200;

function sniff(b: Uint8Array): string | null {
  if (b.length > 12 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  return null;
}
function toB64(b: Uint8Array) { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const groqKey = Deno.env.get("GROQ_API_KEY");
  if (!groqKey) return json({ error: "ai_not_configured", message: "La IA aún no está activada en el servidor." }, 503);

  const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const user = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: u } = await user.auth.getUser();
  if (!u?.user) return json({ error: "unauthorized", message: "Tu sesión expiró. Vuelve a iniciar sesión." }, 401);
  const uid = u.user.id;

  // ---- entrada (JSON para texto, multipart para foto) ----
  let rid = "", cidIn = "", message = "", requestKey = "", image: File | null = null;
  try {
    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const f = await req.formData();
      rid = String(f.get("restaurant_id") ?? ""); cidIn = String(f.get("conversation_id") ?? "");
      message = String(f.get("message") ?? ""); requestKey = String(f.get("request_key") ?? "");
      const im = f.get("image"); if (im instanceof File) image = im;
    } else {
      const b = await req.json();
      rid = String(b?.restaurant_id ?? ""); cidIn = String(b?.conversation_id ?? "");
      message = String(b?.message ?? ""); requestKey = String(b?.request_key ?? "");
    }
  } catch { return json({ error: "bad_request", message: "Solicitud inválida." }, 400); }
  message = cleanText(message, LIMITS.message + 1);
  if (!UUID.test(rid)) return json({ error: "bad_request", message: "Restaurante inválido." }, 400);
  if (cidIn && !UUID.test(cidIn)) return json({ error: "bad_request", message: "Conversación inválida." }, 400);
  if (!KEY.test(requestKey)) return json({ error: "bad_request", message: "Falta la clave de la solicitud." }, 400);
  if (!message && image) message = "Analiza esta foto de mi producto y dime cómo mejorarla.";
  if (!message) return json({ error: "bad_request", message: "Escribe tu pregunta." }, 400);
  if (message.length > LIMITS.message) return json({ error: "message_too_long", message: `El mensaje supera ${LIMITS.message} caracteres.` }, 400);

  let imgBytes: Uint8Array | null = null, imgMime = "";
  if (image) {
    if (image.size === 0 || image.size > MAX_IMAGE) return json({ error: "image_too_large", message: "La imagen debe pesar menos de 4 MB." }, 413);
    imgBytes = new Uint8Array(await image.arrayBuffer()); imgMime = sniff(imgBytes) ?? "";
    if (!imgMime) return json({ error: "bad_image", message: "Usa una imagen JPG, PNG o WEBP." }, 415);
  }
  const kind = imgBytes ? "photo" : "text";
  const model = imgBytes ? VISION_MODEL : TEXT_MODEL;

  // ---- permisos: owner/admin de ESE restaurante (RLS con el token del usuario) ----
  const { data: mem } = await user.from("restaurant_members").select("role").eq("restaurant_id", rid).eq("user_id", uid).maybeSingle();
  if (!mem || !["owner", "admin"].includes(mem.role)) return json({ error: "forbidden", message: "No tienes permiso en este restaurante." }, 403);

  const admin = createClient(url, service);

  // ---- conversación (existente y propia, o nueva) ----
  async function ensureConversation(): Promise<{ id: string; title: string; isNew: boolean } | null> {
    if (cidIn) {
      const { data: c } = await user.from("ai_conversations").select("id,title").eq("id", cidIn).eq("restaurant_id", rid).maybeSingle();
      return c ? { id: c.id, title: c.title, isNew: false } : null;   // RLS: solo existe si es del usuario
    }
    const { count } = await admin.from("ai_conversations").select("id", { count: "exact", head: true }).eq("restaurant_id", rid).eq("user_id", uid);
    if ((count ?? 0) >= MAX_CONVERSATIONS) return null;
    const title = makeTitle(message, !!imgBytes);
    const { data: c, error } = await admin.from("ai_conversations").insert({ restaurant_id: rid, user_id: uid, title }).select("id,title").single();
    return error || !c ? null : { id: c.id, title: c.title, isNew: true };
  }
  const saveMsg = (cid: string, role: string, content: string, extra: Record<string, unknown> = {}) =>
    admin.from("ai_messages").insert({ conversation_id: cid, restaurant_id: rid, role, content: content.slice(0, 12000), ...extra });
  const touch = (cid: string) => admin.from("ai_conversations").update({ last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", cid);

  // ---- 1) Peticiones de información interna: se detienen aquí (sin modelo, sin cupo) ----
  const conf = detectConfidentialRequest(message);
  if (conf.blocked) {
    const conv = await ensureConversation();
    if (cidIn && !conv) return json({ error: "conversation_not_found", message: "No encontré esa conversación." }, 404);
    if (!conv) return json({ error: "too_many_conversations", message: "Tienes demasiadas conversaciones. Elimina algunas para crear otra." }, 409);
    await saveMsg(conv.id, "user", message, { has_image: !!imgBytes });
    await saveMsg(conv.id, "assistant", REFUSAL);
    await touch(conv.id);
    await admin.rpc("ai_log_blocked", { p_restaurant_id: rid, p_user_id: uid, p_conversation_id: conv.id, p_code: "confidential_request", p_kind: kind });
    return json({ blocked: true, reply: REFUSAL, conversation_id: conv.id, title: conv.title });
  }

  // ---- 2) Reserva atómica del cupo (la base decide plan y límite) ----
  const { data: rsv, error: rsvErr } = await admin.rpc("ai_reserve_question", {
    p_restaurant_id: rid, p_user_id: uid, p_request_key: requestKey, p_kind: kind, p_model: model,
  });
  if (rsvErr || !rsv) { console.error("reserve", rsvErr?.message); return json({ error: "quota_unavailable", message: "No pude verificar tu cupo ahora. Intenta de nuevo." }, 503); }
  if (!rsv.ok) {
    const code = String(rsv.error);
    if (code === "monthly_limit" || code === "contact_advisor") {
      await admin.rpc("ai_log_blocked", { p_restaurant_id: rid, p_user_id: uid, p_conversation_id: null, p_code: code, p_kind: kind });
      return json({ error: code, plan_id: rsv.plan_id, plan_name: rsv.plan_name, quota: rsv.quota ?? null, used: rsv.used }, 429);
    }
    if (code === "busy" || code === "too_many_in_flight") return json({ error: "busy", message: "Aún se está procesando otra pregunta. Espera un momento." }, 429);
    if (code === "duplicate_request") return json({ error: "duplicate_request", message: "Esa pregunta ya se envió." }, 409);
    if (code === "forbidden" || code === "suspended") return json({ error: code, message: "No tienes permiso para usar la IA en este restaurante." }, 403);
    return json({ error: code, message: "No se pudo iniciar la pregunta." }, 400);
  }
  const eventId: string = rsv.event_id;
  const failEarly = async (code: string) => {
    await admin.rpc("ai_fail_question", { p_event_id: eventId, p_error_code: code, p_input_tokens: 0, p_output_tokens: 0, p_total_tokens: 0, p_usage_reported: false, p_model: model, p_latency_ms: 0 });
  };

  const conv = await ensureConversation();
  if (!conv) {
    await failEarly(cidIn ? "conversation_not_found" : "conversation_failed");
    return cidIn ? json({ error: "conversation_not_found", message: "No encontré esa conversación." }, 404)
                 : json({ error: "too_many_conversations", message: "Tienes demasiadas conversaciones. Elimina algunas para crear otra." }, 409);
  }
  await admin.rpc("ai_set_event_conversation", { p_event_id: eventId, p_conversation_id: conv.id });

  // ---- 3) Contexto autorizado (solo ESTE restaurante, con RLS) ----
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const [{ data: hist }, { data: memRows }, { data: r }, { data: prods }, { data: orders }, { data: events }] = await Promise.all([
    admin.from("ai_messages").select("role,content").eq("conversation_id", conv.id).order("id", { ascending: false }).limit(24),
    user.from("ai_memory").select("content").eq("restaurant_id", rid).order("created_at").limit(30),
    user.from("restaurants").select("name,city,business_type").eq("id", rid).single(),
    user.from("products").select("name,price,is_available,discount_percent").eq("restaurant_id", rid).limit(300),
    user.from("orders").select("status,total,paid,created_at,order_items(name,quantity)").eq("restaurant_id", rid).gte("created_at", since).limit(1000),
    user.from("menu_events").select("event_type,product_id").eq("restaurant_id", rid).gte("occurred_at", since).limit(5000),
  ]);
  const topItems = new Map<string, number>(); let paidTotal = 0, paidCount = 0;
  for (const o of orders ?? []) {
    if (o.paid) { paidTotal += Number(o.total); paidCount++; }
    for (const i of (o as any).order_items ?? []) topItems.set(i.name, (topItems.get(i.name) ?? 0) + i.quantity);
  }
  const ev = (t: string) => (events ?? []).filter((e) => e.event_type === t).length;
  const contexto = {
    negocio: r, productos_total: prods?.length ?? 0, productos_agotados: (prods ?? []).filter((p) => !p.is_available).length,
    productos: (prods ?? []).slice(0, 60).map((p) => ({ n: cleanText(p.name, 80), p: p.price, ok: p.is_available })),
    ultimos_30_dias: {
      pedidos_recibidos: orders?.length ?? 0, pedidos_pagados: paidCount, ingresos_de_pedidos_pagados_COP: paidTotal,
      productos_mas_pedidos: [...topItems.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
      visitas_al_menu_medidas: ev("menu_view"), escaneos_qr_medidos: ev("qr_scan"),
    },
  };
  const history = trimHistory([...(hist ?? [])].reverse());
  const system = buildSystemPrompt({ memory: formatMemory(memRows ?? []), photo: !!imgBytes });
  const dataBlock = `DATOS:\n${JSON.stringify(contexto)}\n\nPREGUNTA DEL DUENO:\n${message}`;
  const userContent: any = imgBytes
    ? [{ type: "text", text: dataBlock }, { type: "image_url", image_url: { url: `data:${imgMime};base64,${toB64(imgBytes)}` } }]
    : dataBlock;
  await saveMsg(conv.id, "user", message, { has_image: !!imgBytes, event_id: eventId });

  // ---- 4) Streaming ----
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort("timeout"), 70_000);
  req.signal.addEventListener("abort", () => ctrl.abort("client"));
  const enc = new TextEncoder();
  let acc = "", usage: { input: number; output: number; total: number } | null = null;
  let filtered = false, providerCode: string | null = null, settled = false;

  const settle = async (): Promise<{ status: string; completed: boolean; messageId?: number; memorySaved?: boolean }> => {
    if (settled) return { status: "already", completed: false };
    settled = true; clearTimeout(timer);
    const why = String(ctrl.signal.reason ?? "");
    const clientStop = why === "client", timedOut = why === "timeout";
    const latency = Date.now() - started;
    const text = filtered ? REFUSAL : acc.trim();
    const base = { p_input_tokens: usage?.input ?? 0, p_output_tokens: usage?.output ?? 0, p_total_tokens: usage?.total ?? 0, p_usage_reported: !!usage, p_model: model, p_latency_ms: latency };
    const telem = (ok: boolean, code: string | null) => admin.from("ai_call_events").insert({
      restaurant_id: rid, provider: "groq", model, input_tokens: usage?.input ?? 0, output_tokens: usage?.output ?? 0,
      total_tokens: usage?.total ?? 0, latency_ms: latency, ok, error_code: code,
    }).then(() => {}, () => {});
    try {
      if (text) {
        const code = filtered ? "output_filtered" : (!usage ? "usage_missing" : null);
        await admin.rpc("ai_finish_question", { p_event_id: eventId, p_input_tokens: base.p_input_tokens, p_output_tokens: base.p_output_tokens, p_total_tokens: base.p_total_tokens, p_usage_reported: base.p_usage_reported, p_model: model, p_latency_ms: latency, p_error_code: code });
        const status = filtered ? "complete" : clientStop ? "stopped" : (providerCode || timedOut) ? "error" : "complete";
        const { data: m } = await admin.from("ai_messages").insert({ conversation_id: conv.id, restaurant_id: rid, role: "assistant", content: text.slice(0, 12000), status, event_id: eventId }).select("id").single();
        await touch(conv.id); await telem(true, code);
        let memorySaved = false;
        const fact = filtered ? null : extractMemoryCommand(message);
        if (fact) { const { data: mr } = await admin.rpc("ai_memory_add_for", { p_restaurant_id: rid, p_user_id: uid, p_content: fact, p_source: "chat" }); memorySaved = !!mr?.ok; }
        return { status, completed: true, messageId: m?.id, memorySaved };
      }
      const code = clientStop ? "client_aborted" : timedOut ? "timeout" : (providerCode ?? "empty_reply");
      await admin.rpc("ai_fail_question", { p_event_id: eventId, p_error_code: code, p_input_tokens: base.p_input_tokens, p_output_tokens: base.p_output_tokens, p_total_tokens: base.p_total_tokens, p_usage_reported: base.p_usage_reported, p_model: model, p_latency_ms: latency });
      await telem(false, code);
      return { status: code, completed: false };
    } catch (e) { console.error("settle", (e as Error).message); return { status: "settle_error", completed: false }; }
  };

  const stream = new ReadableStream({
    async start(controller) {
      const send = (n: string, d: unknown) => { try { controller.enqueue(enc.encode(sseEvent(n, d))); } catch { /* cliente desconectado */ } };
      const finish = async () => {
        const res = await settle();
        let summary: unknown = null;
        try { const { data } = await user.rpc("ai_usage_summary", { p_restaurant_id: rid }); summary = data; } catch { /* opcional */ }
        if (!res.completed && res.status !== "already") {
          const code = providerCode ?? res.status;
          send("error", { code, message: code === "timeout" ? "La respuesta tardó demasiado. Intenta de nuevo." : code === "client_aborted" ? "Detenido." : "No pude responder ahora. No se descontó ninguna pregunta." });
        }
        send("done", { status: res.status, completed: res.completed, message_id: res.messageId ?? null, memory_saved: !!res.memorySaved, usage: summary });
        try { controller.close(); } catch { /* ya cerrado */ }
      };
      send("meta", { conversation_id: conv.id, title: conv.title, is_new: conv.isNew, event_id: eventId, quota: rsv.quota, used: rsv.used });
      let upstream: Response;
      try {
        upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST", signal: ctrl.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
          body: JSON.stringify({
            model, stream: true, stream_options: { include_usage: true }, max_completion_tokens: imgBytes ? 900 : 1400,
            ...(imgBytes ? { temperature: 0.4 } : {}),
            messages: [{ role: "system", content: system }, ...history, { role: "user", content: userContent }],
          }),
        });
      } catch { await finish(); return; }
      if (!upstream.ok || !upstream.body) {
        console.error("groq", upstream.status, (await upstream.text().catch(() => "")).slice(0, 300));
        providerCode = "provider_http_" + upstream.status; await finish(); return;
      }
      const reader = upstream.body.getReader(), dec = new TextDecoder(), parser = createSSEParser();
      try {
        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const data of parser.push(dec.decode(value, { stream: true }))) {
            if (data === "[DONE]") continue;
            let j: any; try { j = JSON.parse(data); } catch { continue; }
            const us = readUsage(j); if (us) usage = us;
            const piece = j?.choices?.[0]?.delta?.content;
            if (typeof piece === "string" && piece) {
              const clean = piece.replace(/\*/g, "");
              acc += clean;
              if (scanOutput(acc)) { filtered = true; ctrl.abort("filtered"); send("replace", { text: REFUSAL }); break outer; }
              send("delta", { t: clean });
            }
          }
        }
      } catch { if (!providerCode && !filtered && !ctrl.signal.aborted) providerCode = "stream_error"; }
      await finish();
    },
    async cancel() { ctrl.abort("client"); await settle(); },
  });
  return new Response(stream, { headers: { ...CORS, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
});
