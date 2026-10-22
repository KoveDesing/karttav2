/**
 * KARTTA — Conexión con Supabase (Auth + Base de datos + Storage)
 * ============================================================
 * Reemplaza a firebase-init.js manteniendo la interfaz que usan las páginas:
 * window.KARTTA_AUTH { signup, login, google, logout, onChange, summary,
 * currentUser, requirements, completeRequirements }.
 *
 * Seguridad: aquí solo va la clave PÚBLICA (publishable). Nunca pongas
 * una clave "service_role" ni "secret" en ningún archivo del navegador.
 * La protección real de los datos está en las políticas RLS de Supabase.
 */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const SUPABASE_URL = "https://ifbvdjvukygvvgiyzgav.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_1hE4YyQLSll7KlIQoUEACQ_QjaoAfLH";
const BUCKET = "kartta-media";

export const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** URL pública de una imagen guardada en Storage ('' si no hay). */
export function imageUrl(path) {
  if (!path) return "";
  return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

function codeError(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

function slugify(texto) {
  return (
    String(texto || "")
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 30)
      .replace(/-$/, "") || "mi-negocio"
  );
}

function randomHex(n) {
  const a = new Uint8Array(Math.ceil(n / 2));
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, n);
}

function mapUser(u) {
  if (!u) return null;
  const m = u.user_metadata || {};
  return {
    uid: u.id,
    email: u.email || "",
    displayName: m.full_name || m.name || "",
    photoURL: m.avatar_url || m.picture || "",
    raw: u,
  };
}

function translateAuthError(error) {
  const msg = String(error?.message || "").toLowerCase();
  if (msg.includes("already registered") || msg.includes("already been registered")) return codeError("email-already-in-use");
  if (msg.includes("invalid login")) return codeError("invalid-credential");
  if (msg.includes("email not confirmed")) return codeError("account-not-active");
  if (msg.includes("password should be")) return codeError("weak-password");
  if (msg.includes("valid email") || msg.includes("invalid email")) return codeError("invalid-email");
  if (error?.status === 429 || msg.includes("rate limit")) return codeError("too-many-requests");
  if (msg.includes("provider") && msg.includes("enabled")) return codeError("provider-disabled");
  return codeError(error?.code || "auth-error", error?.message);
}

/**
 * Requisitos de acceso (mayoría de edad + términos + privacidad).
 * Los decide el SERVIDOR (función public.my_requirements); aquí solo se consulta.
 * Nada de esto se guarda en localStorage ni en user_metadata.
 */
const reqCache = new Map();
function getRequirements(userId, force = false) {
  if (force) reqCache.delete(userId);
  if (!reqCache.has(userId)) {
    const p = sb.rpc("my_requirements").then(({ data, error }) => {
      if (error) throw error;
      return data;
    });
    reqCache.set(userId, p);
    p.catch(() => reqCache.delete(userId));
  }
  return reqCache.get(userId);
}

function goConsent() {
  if (!/consentimiento\.html$/.test(location.pathname)) location.replace("consentimiento.html");
}

/**
 * Garantiza que el usuario tenga un negocio. Se hace con la función
 * public.create_restaurant (el servidor crea negocio + rol de dueño + prueba gratis
 * en un solo paso). Solo se llama cuando los requisitos ya están cumplidos;
 * además la base de datos rechaza crear negocios si faltan (trigger).
 */
const ensured = new Map();
function ensureBusiness(user) {
  if (!user) return Promise.resolve(null);
  if (ensured.has(user.id)) return ensured.get(user.id);
  const p = (async () => {
    const { data: mem, error } = await sb
      .from("restaurant_members").select("restaurant_id").eq("user_id", user.id).limit(1);
    if (error) throw error;
    if (mem && mem.length) return mem[0].restaurant_id;

    const meta = user.user_metadata || {};
    const nombre = meta.business_name || meta.full_name || "Mi negocio";
    let lastErr;
    for (let i = 0; i < 5; i++) {
      const slug = `${slugify(nombre)}-${randomHex(4)}`;
      const { data, error: e2 } = await sb.rpc("create_restaurant", { p_name: nombre, p_slug: slug });
      if (!e2) return data;
      lastErr = e2;
      if (e2.code !== "23505") break; // solo reintenta si el slug ya existía
    }
    throw lastErr;
  })();
  ensured.set(user.id, p);
  p.catch(() => ensured.delete(user.id));
  return p;
}

window.KARTTA_SB = sb;
window.KARTTA_IMG = imageUrl;

window.KARTTA_AUTH = {
  /**
   * Registro con correo y contraseña. NO hay confirmación por correo: si Supabase
   * devuelve sesión, el usuario ya está dentro. (Requiere tener desactivado
   * "Confirm email" en Supabase → Authentication → Sign In / Providers → Email.)
   */
  async signup(email, pass, nombreNegocio) {
    const { data, error } = await sb.auth.signUp({
      email,
      password: pass,
      options: { data: { full_name: nombreNegocio || "", business_name: nombreNegocio || "Mi negocio" } },
    });
    if (error) throw translateAuthError(error);
    // Si el correo ya existía, algunas configuraciones no dan error: devuelven un usuario sin identidades.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw codeError("email-already-in-use");
    }
    if (!data.session) throw codeError("signup-no-session", "signUp no devolvió sesión: revisa que 'Confirm email' esté desactivado en Supabase.");
    return data;
  },

  async login(email, pass) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
    if (error) throw translateAuthError(error);
    return data;
  },

  async google() {
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/dashboard.html` },
    });
    if (error) throw translateAuthError(error);
    return new Promise(() => {}); // la página se redirige a Google
  },

  async logout() {
    ensured.clear();
    reqCache.clear();
    const { error } = await sb.auth.signOut();
    if (error) throw error;
  },

  /** Usuario de la sesión actual (espera a que Supabase termine de recuperar la sesión). */
  async currentUser() {
    const { data } = await sb.auth.getSession();
    return mapUser(data?.session?.user);
  },

  /** Estado de requisitos calculado por el servidor: { ok, adult, blocked, missing[], versions }. */
  async requirements(force = false) {
    const { data } = await sb.auth.getSession();
    const uid = data?.session?.user?.id;
    if (!uid) throw codeError("not-authenticated");
    return getRequirements(uid, force);
  },

  /** Envía edad + aceptaciones al servidor. El servidor calcula la edad y registra versiones. */
  async completeRequirements({ birthDate, ageConfirmed, acceptTerms, acceptPrivacy }) {
    const { data, error } = await sb.rpc("complete_requirements", {
      p_birth_date: birthDate || null,
      p_age_confirmed: ageConfirmed === true,
      p_accept_terms: acceptTerms === true,
      p_accept_privacy: acceptPrivacy === true,
    });
    if (error) throw error;
    const { data: s } = await sb.auth.getSession();
    if (s?.session?.user) reqCache.delete(s.session.user.id);
    return data;
  },

  /**
   * Llama a cb(user|null) al cargar y cada vez que cambia la sesión.
   * Si hay sesión pero faltan requisitos, redirige a consentimiento.html y NO llama a cb:
   * así dashboard y onboarding no se muestran hasta cumplirlos.
   */
  onChange(cb) {
    const { data } = sb.auth.onAuthStateChange((_event, session) => {
      // Se difiere para no bloquear el cliente de Supabase dentro de su propio callback.
      setTimeout(async () => {
        const user = session?.user;
        if (!user) { cb(null); return; }
        try {
          const st = await getRequirements(user.id);
          if (!st || st.ok !== true) { goConsent(); return; }
          await ensureBusiness(user);
        } catch (e) {
          console.warn("[KARTTA] No se pudo preparar la cuenta:", e);
          if (e?.code === "42501" || /requirements_pending/.test(e?.message || "")) { goConsent(); return; }
          if (e?.code === "PGRST202" || e?.code === "42883" || e?.code === "not-authenticated" || /my_requirements/.test(e?.message || "")) { goConsent(); return; }
        }
        cb(mapUser(user));
      }, 0);
    });
    return () => data.subscription.unsubscribe();
  },

  /** Nombre del negocio y de la persona, para la barra superior de la landing. */
  async summary() {
    const { data: sess } = await sb.auth.getSession();
    const uid = sess?.session?.user?.id;
    if (!uid) return null;
    const [{ data: prof }, { data: mem }] = await Promise.all([
      sb.from("profiles").select("full_name,panel_name").eq("id", uid).maybeSingle(),
      sb.from("restaurant_members").select("restaurants(name)").eq("user_id", uid).limit(1),
    ]);
    return {
      persona: prof?.panel_name || prof?.full_name || "",
      negocio: mem?.[0]?.restaurants?.name || "",
    };
  },
};

console.log("[KARTTA] Supabase conectado. window.KARTTA_AUTH está activo.");
