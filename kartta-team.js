/* KARTTA — vista "Equipo" del panel: invitar, ver y quitar usuarios del restaurante.
 * Usa las funciones del servidor list_team / invite_member / revoke_invite / remove_member.
 * El límite de usuarios del plan y los permisos (propietario/administrador) los decide el servidor. */
(function () {
  'use strict';
  var K = window.KARTTA_MODS; if (!K) return;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return K.esc(s); };
  var C = null, team = null, usage = null, busy = false, denied = false;
  var ROLE = { owner: 'Propietario', admin: 'Administrador', staff: 'Personal' };
  var fmtDate = function (iso) { return iso ? new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Bogota' }) : '—'; };

  function errText(e) {
    var m = String((e && e.message) || '');
    if (/user limit/i.test(m)) return 'Llegaste al límite de usuarios de tu plan. Mejora tu plan para invitar a más personas.';
    if (/already a member/i.test(m)) return 'Esa persona ya es parte de tu equipo.';
    if (/invalid email/i.test(m)) return 'Escribe un correo válido.';
    if (/invalid role/i.test(m)) return 'Rol no válido.';
    if (/cannot remove owner/i.test(m)) return 'No se puede quitar al propietario.';
    if (/forbidden/i.test(m) || (e && e.code === '42501')) return 'Solo el propietario o un administrador puede gestionar el equipo.';
    return 'No se pudo completar la acción. Intenta de nuevo.';
  }

  function view() {
    var host = $('modTeam'); if (!host) return;
    if (denied) { host.innerHTML = '<div class="card"><h2 style="margin:0 0 6px">Equipo</h2><p class="sub" style="margin:0">Solo el propietario o un administrador puede gestionar el equipo.</p></div>'; return; }
    if (!team) { host.innerHTML = '<div class="card"><p class="sub" style="margin:0">Cargando tu equipo…</p></div>'; return; }
    var lim = usage && usage.limits ? Number(usage.limits.users) : null;
    var used = team.members.length + team.invites.length;
    var full = lim != null && used >= lim;
    var html = '<div class="card"><div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px"><div><h2 style="margin:0 0 4px">Equipo</h2>' +
      '<p class="sub" style="margin:0">Personas con acceso al panel de ' + esc(C.negocio.nombre || 'tu restaurante') + '.' + (lim != null ? ' <strong>' + used + ' / ' + lim + '</strong> usuarios de tu plan.' : '') + '</p></div></div></div>';
    html += '<div class="card"><h3 style="margin-top:0">Invitar a alguien</h3>' +
      '<form id="teamForm" style="display:grid;gap:10px;max-width:460px"><div class="field"><label for="teamEmail">Correo de la persona</label><input type="email" id="teamEmail" maxlength="254" placeholder="persona@correo.com" autocomplete="off" required></div>' +
      '<div class="field"><label for="teamRole">Rol</label><select id="teamRole"><option value="staff">Personal (pedidos y productos)</option><option value="admin">Administrador (puede invitar)</option></select></div>' +
      '<button class="btn btn-accent" type="submit"' + (full ? ' disabled' : '') + '>Enviar invitación</button></form>' +
      (full ? '<p class="note warn" style="margin:10px 0 0">Llegaste al límite de usuarios de tu plan. <a href="/checkout">Mejorar plan</a></p>' : '') +
      '<p class="note" style="margin:10px 0 0">No enviamos un correo automático: dile a la persona que entre a <strong>kartta.food</strong> y se registre (o inicie sesión) con ese mismo correo. La invitación vale 14 días.</p></div>';
    html += '<div class="card"><h3 style="margin-top:0">Miembros</h3><div style="overflow:auto"><table class="tbl" style="width:100%"><thead><tr><th>Correo</th><th>Rol</th><th>Desde</th><th></th></tr></thead><tbody>' +
      team.members.map(function (m) {
        return '<tr><td>' + esc(m.email) + '</td><td>' + esc(ROLE[m.role] || m.role) + '</td><td>' + fmtDate(m.since) + '</td><td>' +
          (m.role === 'owner' ? '' : '<button class="btn btn-ghost btn-sm" data-team-rm="' + esc(m.user_id) + '">Quitar</button>') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
    if (team.invites.length) {
      html += '<div class="card"><h3 style="margin-top:0">Invitaciones pendientes</h3><div style="overflow:auto"><table class="tbl" style="width:100%"><thead><tr><th>Correo</th><th>Rol</th><th>Vence</th><th></th></tr></thead><tbody>' +
        team.invites.map(function (v) {
          return '<tr><td>' + esc(v.email) + '</td><td>' + esc(ROLE[v.role] || v.role) + '</td><td>' + fmtDate(v.expires_at) + '</td><td><button class="btn btn-ghost btn-sm" data-team-rv="' + esc(v.id) + '">Cancelar</button></td></tr>';
        }).join('') + '</tbody></table></div></div>';
    }
    host.innerHTML = html;
  }

  async function load() {
    try {
      var r = await C.sb.rpc('list_team', { p_restaurant_id: C.rid });
      if (r.error) throw r.error;
      denied = false; team = { members: r.data.members || [], invites: r.data.invites || [] };
      try { var u = await C.sb.rpc('my_plan_usage', { p_restaurant_id: C.rid }); usage = u.error ? null : u.data; } catch (e2) { usage = null; }
      view();
    } catch (e) {
      if (/forbidden/i.test(String(e && e.message)) || (e && e.code === '42501')) { denied = true; view(); return; }
      var h = $('modTeam'); if (h) h.innerHTML = '<div class="card"><p class="note warn" style="margin:0">No pudimos cargar tu equipo. Intenta de nuevo en un momento.</p></div>';
      console.error('[KARTTA team]', e && e.message);
    }
  }

  async function run(fn, okMsg) {
    if (busy) return; busy = true;
    try { var r = await fn(); if (r && r.error) throw r.error; C.toast(okMsg); await load(); }
    catch (e) { C.toast(errText(e)); console.error('[KARTTA team]', e && e.message); }
    finally { busy = false; }
  }

  document.addEventListener('submit', function (e) {
    if (!e.target || e.target.id !== 'teamForm') return; e.preventDefault();
    var email = $('teamEmail').value.trim().toLowerCase(), role = $('teamRole').value;
    run(function () { return C.sb.rpc('invite_member', { p_restaurant_id: C.rid, p_email: email, p_role: role }); }, 'Invitación creada. La persona debe entrar a kartta.food con ' + email + '.');
  });
  document.addEventListener('click', function (e) {
    var rm = e.target.closest('[data-team-rm]'), rv = e.target.closest('[data-team-rv]');
    if (rm) { if (!window.confirm('¿Quitar a esta persona del equipo? Perderá el acceso al panel.')) return; run(function () { return C.sb.rpc('remove_member', { p_restaurant_id: C.rid, p_user_id: rm.dataset.teamRm }); }, 'Persona quitada del equipo.'); }
    if (rv) run(function () { return C.sb.rpc('revoke_invite', { p_invite_id: rv.dataset.teamRv }); }, 'Invitación cancelada.');
  });
  K.views.equipo = function () { C = K.ctx || window.KARTTA_CTX; if (!C) return; team = null; denied = false; view(); load(); };
})();
