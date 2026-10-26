/**
 * KARTTA — Motor de guía interactiva (visita guiada con foco y tarjeta explicativa).
 * Uso: const tour = KARTTA_TOUR.create({ steps, onStep, onExit }); tour.start(index)
 * step = { id, title, text, target:'css'|()=>Element, before:async()=>{}, primary:{label,run}, canSkip, done:()=>bool, doneLabel }
 * El motor NO marca pasos como completados: lo decide `done()` con datos reales del panel.
 */
(function () {
  const CSS = `
  .kt-hole{position:fixed;z-index:100091;border-radius:14px;pointer-events:none;box-shadow:0 0 0 100vmax rgba(8,8,12,.66);outline:3px solid var(--accent,#FF3145);outline-offset:2px;transition:top .25s,left .25s,width .25s,height .25s}
  .kt-dim{position:fixed;inset:0;z-index:100090;background:rgba(8,8,12,.66)}
  .kt-block{position:fixed;z-index:100092;background:transparent}
  .kt-card{position:fixed;z-index:100100;width:min(380px,calc(100vw - 24px));background:var(--panel,#fff);color:var(--text,#333);border:1px solid var(--border,#ddd);border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.45);padding:18px 18px 14px;font-family:inherit;animation:ktIn .28s cubic-bezier(.16,1,.3,1)}
  .kt-card h3{margin:2px 0 6px;font-size:17px;color:var(--strong,#111);line-height:1.25}
  .kt-card p{margin:0 0 12px;font-size:13.5px;line-height:1.55}
  .kt-step{font-size:11.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--accent,#FF3145)}
  .kt-bar{height:5px;border-radius:9px;background:var(--panel2,#eee);overflow:hidden;margin:8px 0 12px}.kt-bar i{display:block;height:100%;background:var(--accent,#FF3145);transition:width .3s}
  .kt-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .kt-row .sp{flex:1}
  .kt-b{min-height:40px;padding:0 14px;border-radius:11px;border:1px solid var(--border,#ddd);background:var(--panel2,#f3f3f3);color:var(--strong,#111);font:inherit;font-weight:700;font-size:13px;cursor:pointer}
  .kt-b.p{background:var(--accent,#FF3145);border-color:var(--accent,#FF3145);color:#fff}
  .kt-b.l{border:0;background:none;color:var(--muted,#777);padding:0 8px}
  .kt-b:disabled{opacity:.5;cursor:default}
  .kt-ok{display:inline-flex;gap:6px;align-items:center;font-size:12px;font-weight:800;color:#1EA35A;margin:0 0 10px}
  .kt-pill{position:fixed;right:16px;bottom:16px;z-index:100100;background:var(--accent,#FF3145);color:#fff;border:0;border-radius:99px;min-height:46px;padding:0 18px;font:inherit;font-weight:800;box-shadow:0 10px 30px rgba(0,0,0,.35);cursor:pointer}
  @keyframes ktIn{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}
  @media (max-width:640px){.kt-card{left:12px !important;right:12px;width:auto;top:auto}}
  @media (prefers-reduced-motion:reduce){.kt-card{animation:none}.kt-hole,.kt-bar i{transition:none}}`;
  let styled = false;
  const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.textContent = h; return e; };
  const reduce = () => matchMedia('(prefers-reduced-motion:reduce)').matches;

  function create(opts) {
    if (!styled) { const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); styled = true; }
    const steps = opts.steps; let i = 0, active = false, paused = false, nodes = [], target = null, opener = null, raf = 0;

    const resolve = (st) => { try { const t = typeof st.target === 'function' ? st.target() : (st.target ? document.querySelector(st.target) : null); return t && t.offsetParent !== null || (t && getComputedStyle(t).position === 'fixed') ? t : null; } catch { return null; } };
    function clear() { nodes.forEach(n => n.remove()); nodes = []; cancelAnimationFrame(raf); removeEventListener('scroll', onMove, true); removeEventListener('resize', onMove); removeEventListener('keydown', onKey, true); }
    function onMove() { cancelAnimationFrame(raf); raf = requestAnimationFrame(layout); }
    function onKey(e) {
      if (!active || paused) return;
      if (e.key === 'Escape') { e.preventDefault(); exit('esc'); }
      else if (e.key === 'Tab') { const f = nodes.find(n => n.classList.contains('kt-card')); if (!f) return; const q = [...f.querySelectorAll('button:not(:disabled)')]; if (!q.length) return; const a = document.activeElement, first = q[0], last = q[q.length - 1]; if (e.shiftKey && (a === first || !f.contains(a))) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && (a === last || !f.contains(a))) { e.preventDefault(); first.focus(); } }
    }
    function layout() {
      if (!active || paused) return;
      const card = nodes.find(n => n.classList.contains('kt-card')); if (!card) return;
      const vw = innerWidth, vh = innerHeight, hole = nodes.find(n => n.classList.contains('kt-hole')), blocks = nodes.filter(n => n.classList.contains('kt-block')), dim = nodes.find(n => n.classList.contains('kt-dim'));
      const small = vw <= 640, cw = card.offsetWidth, ch = card.offsetHeight, M = 12;
      if (target && document.contains(target)) {
        const r = target.getBoundingClientRect(), pad = 6, x = Math.max(0, r.left - pad), y = Math.max(0, r.top - pad), w = Math.min(vw - x, r.width + pad * 2), h = Math.min(vh - y, r.height + pad * 2);
        Object.assign(hole.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px', display: 'block' }); if (dim) dim.style.display = 'none';
        const bx = [[0, 0, vw, y], [0, y + h, vw, Math.max(0, vh - y - h)], [0, y, x, h], [x + w, y, Math.max(0, vw - x - w), h]]; blocks.forEach((b, k) => Object.assign(b.style, { left: bx[k][0] + 'px', top: bx[k][1] + 'px', width: bx[k][2] + 'px', height: bx[k][3] + 'px' }));
        let left, top;
        if (small) { left = M; top = (y + h + M + ch <= vh - M) ? y + h + M : (y - M - ch >= M ? y - M - ch : Math.max(M, vh - ch - M)); card.style.left = left + 'px'; card.style.top = top + 'px'; card.style.bottom = 'auto'; return; }
        left = Math.min(Math.max(M, x + w / 2 - cw / 2), vw - cw - M);
        if (y + h + M + ch <= vh - M) top = y + h + M; else if (y - M - ch >= M) top = y - M - ch;
        else if (x + w + M + cw <= vw - M) { left = x + w + M; top = Math.min(Math.max(M, y), vh - ch - M); }
        else if (x - M - cw >= M) { left = x - M - cw; top = Math.min(Math.max(M, y), vh - ch - M); }
        else { left = (vw - cw) / 2; top = Math.max(M, vh - ch - M); }
        card.style.left = left + 'px'; card.style.top = top + 'px';
      } else {
        hole.style.display = 'none'; if (dim) dim.style.display = 'block'; blocks.forEach(b => { b.style.width = '0'; b.style.height = '0'; });
        card.style.left = Math.max(M, (vw - cw) / 2) + 'px'; card.style.top = small ? 'auto' : Math.max(M, (vh - ch) / 2) + 'px'; if (small) card.style.bottom = M + 'px';
      }
    }
    async function show(n) {
      clear(); i = Math.max(0, Math.min(steps.length - 1, n)); active = true; paused = false;
      document.querySelectorAll('.kt-pill').forEach(x => x.remove());
      const st = steps[i]; if (opts.onStep) opts.onStep(i, st);
      if (st.before) { try { await st.before(); } catch (e) { console.warn(e); } }
      await new Promise(r => setTimeout(r, 60));
      target = resolve(st);
      if (target) { target.scrollIntoView({ behavior: reduce() ? 'auto' : 'smooth', block: 'center' }); await new Promise(r => setTimeout(r, reduce() ? 0 : 380)); }
      if (!active) return;
      const hole = el('div', 'kt-hole'), dim = el('div', 'kt-dim'), blocks = [0, 1, 2, 3].map(() => el('div', 'kt-block'));
      const card = el('div', 'kt-card'); card.setAttribute('role', 'dialog'); card.setAttribute('aria-labelledby', 'kt-t'); card.setAttribute('aria-describedby', 'kt-d');
      card.append(el('div', 'kt-step', 'Paso ' + (i + 1) + ' de ' + steps.length));
      const bar = el('div', 'kt-bar'), fill = el('i'); fill.style.width = ((i + 1) / steps.length * 100) + '%'; bar.append(fill); card.append(bar);
      const h = el('h3', '', st.title); h.id = 'kt-t'; const p = el('p', '', st.text); p.id = 'kt-d'; card.append(h, p);
      const isDone = st.done ? !!st.done() : false; if (isDone) card.append(el('div', 'kt-ok', '✓ ' + (st.doneLabel || 'Este paso ya está completo')));
      const row = el('div', 'kt-row');
      if (i > 0) { const b = el('button', 'kt-b', '← Atrás'); b.type = 'button'; b.onclick = () => show(i - 1); row.append(b); }
      if (st.primary && !isDone) { const b = el('button', 'kt-b p', st.primary.label); b.type = 'button'; b.onclick = async () => { b.disabled = true; try { await st.primary.run(api); } finally { b.disabled = false; } }; row.append(b); }
      row.append(el('span', 'sp'));
      const next = el('button', 'kt-b ' + ((st.primary && !isDone) ? '' : 'p'), i === steps.length - 1 ? 'Terminar' : (st.canSkip && !isDone ? 'Omitir' : 'Continuar')); next.type = 'button';
      next.onclick = () => { if (opts.onNext) opts.onNext(i, st, isDone); i === steps.length - 1 ? exit('done') : show(i + 1); }; row.append(next); card.append(row);
      const ex = el('button', 'kt-b l', 'Salir y continuar después'); ex.type = 'button'; ex.onclick = () => exit('later'); const r2 = el('div', 'kt-row'); r2.style.marginTop = '8px'; r2.append(ex); card.append(r2);
      opener = document.activeElement; nodes = [dim, ...blocks, hole, card]; nodes.forEach(n => document.body.appendChild(n));
      addEventListener('scroll', onMove, true); addEventListener('resize', onMove); addEventListener('keydown', onKey, true);
      layout(); setTimeout(layout, 120); (card.querySelector('.kt-b.p') || next).focus({ preventScroll: true });
    }
    function exit(reason) { const was = active; active = false; paused = false; clear(); document.querySelectorAll('.kt-pill').forEach(x => x.remove()); if (opener && document.contains(opener)) { try { opener.focus({ preventScroll: true }); } catch {} } if (was && opts.onExit) opts.onExit(reason, i); }
    /** Oculta la guía mientras el usuario realiza la acción real (p. ej. el formulario de producto) y deja un botón para volver. */
    function pause(label) { if (!active) return; paused = true; clear(); const b = el('button', 'kt-pill', label || 'Continuar la guía →'); b.type = 'button'; b.onclick = () => { b.remove(); show(i); }; document.body.appendChild(b); }
    const api = { start: (n) => show(n || 0), exit, pause, resume: () => { document.querySelectorAll('.kt-pill').forEach(x => x.remove()); if (active) show(i); }, goto: show, get index() { return i; }, get active() { return active; }, get paused() { return paused; }, refresh: () => { if (active && !paused) show(i); } };
    return api;
  }
  window.KARTTA_TOUR = { create };
})();
