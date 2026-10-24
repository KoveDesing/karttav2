import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const ALLOWED_ORIGINS = new Set([
  "https://karttafood.vercel.app",
  "https://kartta.food",
  "https://www.kartta.food",
]);
const BASE_HEADERS = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200, origin = "") => new Response(JSON.stringify(body), {
  status,
  headers: {
    ...BASE_HEADERS,
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://karttafood.vercel.app",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  },
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATEGORIES = new Set(["menu", "product", "order", "payment", "other"]);

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: "origin_not_allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: {
    ...BASE_HEADERS,
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://karttafood.vercel.app",
  }});
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "service_unavailable" }, 503, origin);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400, origin); }
  // Honeypot: answer generically without storing automated submissions.
  if (typeof body.website === "string" && body.website.trim()) return json({ ok: true }, 200, origin);

  const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
  const category = typeof body.category === "string" ? body.category : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const contact = typeof body.contact === "string" ? body.contact.trim().slice(0, 254) : "";
  const page = typeof body.page === "string" ? body.page.trim().slice(0, 300) : "";
  const productId = typeof body.product_id === "string" && body.product_id ? body.product_id : null;

  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) return json({ error: "invalid_restaurant" }, 400, origin);
  if (!CATEGORIES.has(category)) return json({ error: "invalid_category" }, 400, origin);
  if (message.length < 3 || message.length > 4000) return json({ error: "invalid_message" }, 400, origin);
  if (productId && !UUID.test(productId)) return json({ error: "invalid_product" }, 400, origin);
  if (contact && contact.length > 254) return json({ error: "invalid_contact" }, 400, origin);

  const chain = (req.headers.get("x-forwarded-for") || "").split(",").map((x) => x.trim()).filter(Boolean);
  const ip = chain[chain.length - 1] || req.headers.get("cf-connecting-ip") || "unknown";
  const hmacKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(serviceKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", hmacKey, new TextEncoder().encode(ip));
  const fingerprint = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: allowed, error: rateError } = await admin.rpc("consume_menu_report_rate_limit", {
    p_fingerprint: fingerprint,
    p_limit: 3,
    p_window_seconds: 900,
  });
  if (rateError) {
    console.error("menu report rate limit check failed");
    return json({ error: "service_unavailable" }, 503, origin);
  }
  if (allowed !== true) return json({ error: "rate_limited", message: "Has enviado varios reportes. Espera unos minutos e inténtalo de nuevo." }, 429, origin);

  const { data: restaurant, error: restaurantError } = await admin.from("restaurants")
    .select("id,slug").eq("slug", slug).eq("is_published", true).eq("is_suspended", false).maybeSingle();
  if (restaurantError) {
    console.error("menu report restaurant lookup failed");
    return json({ error: "service_unavailable" }, 503, origin);
  }
  if (!restaurant) return json({ error: "restaurant_not_found" }, 404, origin);

  if (productId) {
    const { data: product, error: productError } = await admin.from("products")
      .select("id").eq("id", productId).eq("restaurant_id", restaurant.id).eq("is_active", true).maybeSingle();
    if (productError) return json({ error: "service_unavailable" }, 503, origin);
    if (!product) return json({ error: "invalid_product" }, 400, origin);
  }

  const { data: report, error: insertError } = await admin.from("menu_reports").insert({
    restaurant_id: restaurant.id,
    product_id: productId,
    category,
    message,
    contact: contact || null,
    page: page || null,
    source: "public_menu",
  }).select("id").single();
  if (insertError || !report) {
    console.error("menu report insert failed");
    return json({ error: "could_not_save_report" }, 500, origin);
  }
  return json({ ok: true, reference: report.id }, 201, origin);
});
