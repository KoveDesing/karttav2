/**
 * KARTTA — Gestor de cookies / almacenamiento local.
 * Categorías: "necesarias" (siempre activas: sesión) y "preferencias" (tema y acento del panel; opcional, apagada por defecto).
 * Hoy KARTTA no usa analítica ni publicidad, por eso no hay categorías para eso.
 * Se guarda en localStorage["kartta_consent"] = {v, preferences, ts}. Es independiente de los términos.
 * API: KARTTA_COOKIES.get() / .allowed("preferences") / .set({preferences}) / .open()
 */
(function () {
  var KEY = "kartta_consent", V = 1;
  var listeners = [];
  function read() { try { var o = JSON.parse(localStorage.getItem(KEY)); if (o && o.v === V) return o; } catch (e) {} return null; }
  function allowed(cat) { var o = read(); return !!(o && cat === "preferences" && o.preferences === true); }
  function cleanup() { if (!allowed("preferences")) { try { localStorage.removeItem("kartta_prefs"); } catch (e) {} } }
  function set(p) {
    var o = { v: V, preferences: !!(p && p.preferences), ts: new Date().toISOString() };
    try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {}
    try { localStorage.removeItem("kartta_cookies_ok"); } catch (e) {}
    cleanup(); listeners.forEach(function (f) { try { f(o); } catch (e) {} });
    return o;
  }

  var css = ".kck-banner,.kck-modal{font-family:Inter,system-ui,sans-serif;color:#0A0A0A}" +
    ".kck-banner{position:fixed;left:16px;bottom:16px;z-index:9000;max-width:340px;background:#fff;border-radius:16px;padding:16px;box-shadow:0 1px 2px rgba(10,10,10,.05),0 14px 30px -12px rgba(10,10,10,.25);border:1px solid rgba(10,10,10,.06)}" +
    ".kck-banner p{margin:0 0 12px;font-size:12.5px;line-height:1.45;color:#555}.kck-banner a{color:#FF3145;font-weight:600}" +
    ".kck-row{display:flex;gap:8px;flex-wrap:wrap}" +
    ".kck-btn{border:0;border-radius:10px;padding:9px 14px;font:700 12.5px Inter,system-ui,sans-serif;cursor:pointer;background:#EDEDEA;color:#0A0A0A}" +
    ".kck-btn.pri{background:#FF3145;color:#fff}.kck-btn:focus-visible,.kck-sw input:focus-visible+span{outline:2px solid #0A0A0A;outline-offset:2px}" +
    ".kck-modal{position:fixed;inset:0;z-index:9100;background:rgba(10,10,10,.6);display:flex;align-items:center;justify-content:center;padding:16px}" +
    ".kck-card{background:#fff;border-radius:20px;padding:24px;max-width:440px;width:100%;max-height:90vh;overflow:auto}" +
    ".kck-card h2{margin:0 0 6px;font-size:18px}.kck-card p{margin:0 0 14px;font-size:13px;line-height:1.5;color:#555}" +
    ".kck-item{display:flex;gap:14px;align-items:flex-start;justify-content:space-between;padding:12px 0;border-top:1px solid #EDEDEA}" +
    ".kck-item b{font-size:13.5px}.kck-item small{display:block;color:#666;font-size:12px;line-height:1.4;margin-top:2px}" +
    ".kck-sw{position:relative;flex-shrink:0;width:42px;height:24px}.kck-sw input{position:absolute;inset:0;opacity:0;width:100%;height:100%;margin:0;cursor:pointer}" +
    ".kck-sw span{position:absolute;inset:0;background:#C9C9C4;border-radius:99px;transition:background .15s}.kck-sw span:after{content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;background:#fff;border-radius:50%;transition:transform .15s}" +
    ".kck-sw input:checked+span{background:#FF3145}.kck-sw input:checked+span:after{transform:translateX(18px)}.kck-sw input:disabled{cursor:not-allowed}.kck-sw input:disabled+span{opacity:.55}" +
    "@media(max-width:767px){.kck-banner{left:10px;right:10px;max-width:none;bottom:calc(88px + env(safe-area-inset-bottom))}}" +
    "@media(prefers-reduced-motion:reduce){.kck-sw span,.kck-sw span:after{transition:none}}";

  function style() { if (document.getElementById("kck-style")) return; var s = document.createElement("style"); s.id = "kck-style"; s.textContent = css; document.head.appendChild(s); }
  function el(html) { var d = document.createElement("div"); d.innerHTML = html; return d.firstElementChild; }
  function close(n) { if (n && n.parentNode) n.parentNode.removeChild(n); }

  function openModal() {
    style(); if (document.getElementById("kckModal")) return;
    var cur = read();
    var m = el('<div class="kck-modal" id="kckModal" role="dialog" aria-modal="true" aria-labelledby="kckT"><div class="kck-card">' +
      '<h2 id="kckT">Configurar cookies</h2><p>Elige qué podemos guardar en este dispositivo. Puedes cambiarlo cuando quieras desde el pie de página. Más detalle en la <a href="cookies.html" style="color:#FF3145;font-weight:600">política de cookies</a>.</p>' +
      '<div class="kck-item"><div><b>Necesarias</b><small>Mantienen tu sesión iniciada y recuerdan esta decisión. Sin ellas KARTTA no funciona.</small></div><label class="kck-sw"><input type="checkbox" checked disabled aria-label="Necesarias (siempre activas)"><span></span></label></div>' +
      '<div class="kck-item"><div><b>Preferencias</b><small>Guardan en este dispositivo el tema (claro/oscuro) y el color de acento de tu panel para que carguen al instante.</small></div><label class="kck-sw"><input type="checkbox" id="kckPref" aria-label="Preferencias"><span></span></label></div>' +
      '<div class="kck-item"><div><b>Analítica y publicidad</b><small>No las usamos.</small></div></div>' +
      '<div class="kck-row" style="margin-top:14px"><button class="kck-btn pri" id="kckSave" type="button">Guardar</button><button class="kck-btn" id="kckAll" type="button">Aceptar todas</button><button class="kck-btn" id="kckNone" type="button">Rechazar opcionales</button></div></div></div>');
    document.body.appendChild(m);
    m.querySelector("#kckPref").checked = !!(cur && cur.preferences);
    function done(p) { set({ preferences: p }); close(m); close(document.getElementById("kckBanner")); document.removeEventListener("keydown", esc); }
    function esc(e) { if (e.key === "Escape") { close(m); document.removeEventListener("keydown", esc); } }
    m.querySelector("#kckSave").onclick = function () { done(m.querySelector("#kckPref").checked); };
    m.querySelector("#kckAll").onclick = function () { done(true); };
    m.querySelector("#kckNone").onclick = function () { done(false); };
    m.addEventListener("click", function (e) { if (e.target === m) close(m); });
    document.addEventListener("keydown", esc);
    m.querySelector("#kckSave").focus();
  }

  function banner() {
    if (read() || document.getElementById("kckBanner")) return;
    style();
    var b = el('<div class="kck-banner" id="kckBanner" role="region" aria-label="Aviso de cookies"><p>Usamos almacenamiento necesario para mantener tu sesión y, si lo permites, para recordar tus preferencias del panel. No usamos analítica ni publicidad. <a href="cookies.html">Más información</a></p>' +
      '<div class="kck-row"><button class="kck-btn pri" id="kckA" type="button">Aceptar</button><button class="kck-btn" id="kckR" type="button">Rechazar opcionales</button><button class="kck-btn" id="kckC" type="button">Configurar</button></div></div>');
    document.body.appendChild(b);
    b.querySelector("#kckA").onclick = function () { set({ preferences: true }); close(b); };
    b.querySelector("#kckR").onclick = function () { set({ preferences: false }); close(b); };
    b.querySelector("#kckC").onclick = openModal;
  }

  window.KARTTA_COOKIES = { get: read, allowed: allowed, set: set, open: openModal, onChange: function (f) { listeners.push(f); } };
  function init() {
    banner();
    document.addEventListener("click", function (e) {
      var t = e.target.closest && e.target.closest("[data-cookie-settings]");
      if (t) { e.preventDefault(); openModal(); }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
