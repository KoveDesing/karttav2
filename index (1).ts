// Aplica una imagen generada a un producto. Conserva el archivo anterior (no borra nada).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const URL_ = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!, SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "not_authenticated" }, 401);
  const userClient = createClient(URL_, ANON, { global: { headers: { Authorization: authHeader } } });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user) return json({ error: "not_authenticated" }, 401);

  let body: any; try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const { restaurant_id: rid, generation_id: gid, product_id: pid } = body || {};
  if (![rid, gid, pid].every((x) => typeof x === "string" && UUID.test(x))) return json({ error: "bad_request", message: "Datos inválidos." }, 400);

  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

  // Rol real en el restaurante
  const { data: mem } = await admin.from("restaurant_members").select("role").eq("restaurant_id", rid).eq("user_id", u.user.id).maybeSingle();
  if (!mem || !["owner", "admin"].includes(mem.role)) return json({ error: "forbidden", message: "No tienes permiso en este restaurante." }, 403);

  // La generación y el producto deben ser del MISMO restaurante
  const { data: gen } = await admin.from("image_generations").select("id,status,output_path").eq("id", gid).eq("restaurant_id", rid).maybeSingle();
  if (!gen || gen.status !== "succeeded" || !gen.output_path) return json({ error: "not_found", message: "No encontramos esa imagen generada." }, 404);
  if (!gen.output_path.startsWith(rid + "/")) return json({ error: "forbidden" }, 403);
  const { data: prod } = await admin.from("products").select("id,image_path").eq("id", pid).eq("restaurant_id", rid).maybeSingle();
  if (!prod) return json({ error: "not_found", message: "No encontramos ese producto." }, 404);

  const dl = await admin.storage.from("kartta-ai-images").download(gen.output_path);
  if (dl.error || !dl.data) return json({ error: "storage_error", message: "No se pudo leer la imagen generada." }, 500);

  const newPath = `${rid}/products/${crypto.randomUUID()}.png`;
  const up = await admin.storage.from("kartta-media").upload(newPath, dl.data, { contentType: "image/png", cacheControl: "31536000", upsert: false });
  if (up.error) return json({ error: "storage_error", message: "No se pudo guardar la imagen en tu menú." }, 500);

  const { error: upErr } = await admin.from("products").update({ image_path: newPath }).eq("id", pid).eq("restaurant_id", rid);
  if (upErr) {
    await admin.storage.from("kartta-media").remove([newPath]); // limpia solo el archivo nuevo que acabamos de crear
    return json({ error: "db_error", message: "No se pudo actualizar el producto." }, 500);
  }
  await admin.from("image_generations").update({ applied_product_id: pid, applied_at: new Date().toISOString() }).eq("id", gid);

  // Verificación: leer el estado final
  const { data: after } = await admin.from("products").select("image_path").eq("id", pid).single();
  if (after?.image_path !== newPath) return json({ error: "verify_failed", message: "No pudimos confirmar el cambio." }, 500);
  const { data: pub } = admin.storage.from("kartta-media").getPublicUrl(newPath);
  return json({ ok: true, image_path: newPath, public_url: pub.publicUrl, previous_image_path: prod.image_path || null });
});
