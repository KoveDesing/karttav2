/**
 * KARTTA — Inventario (panel). Contrato: window.KARTTA_CTX ({ sb, rid, toast, productos, esc }) + eventos
 * 'kartta:ready' y 'kartta:view'. Todo se lee con RLS (solo el propio restaurante) y todo cambio de existencias
 * pasa por funciones del servidor (inventory_save_item / inventory_move / inventory_deactivate_item):
 * el navegador nunca escribe cantidades directamente. El descuento por pedidos lo hace el servidor (triggers).
 */
(function () {
  'use strict';
  var C = null, $ = function (id) { return document.getElementById(id); };
  var S = { items: [], moves: [], tab: 'todos', q: '', loaded: false, busy: false, timer: null, view: 'stock' };
  var UNITS = { unidad: 'unidades', porcion: 'porciones', kg: 'kg', g: 'g', lb: 'lb', l: 'litros', ml: 'ml', caja: 'cajas', paquete: 'paquetes' };
  var KIND = { inicial: 'Existencia inicial', entrada: 'Entrada', salida: 'Salida manual', ajuste: 'Ajuste', venta: 'Pedido', devolucion: 'Devolución por cancelación' };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fmt = function (n) { return Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 3 }); };
  var when = function (iso) { try { return new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };

  function level(it) { return it.quantity <= 0 ? 'out' : (it.min_stock > 0 && it.quantity <= it.min_stock ? 'low' : 'ok'); }
  function errText(e) {
    var m = String((e && e.message) || '');
    if (m.indexOf('insufficient stock') >= 0) return 'No hay existencia suficiente para esa salida.';
    if (m.indexOf('not allowed') >= 0 || m.indexOf('42501') >= 0) return 'Tu rol no tiene permiso para esta acción.';
    if (m.indexOf('invalid quantity') >= 0) return 'Escribe una cantidad válida.';
    if (m.indexOf('inventory_') >= 0 || m.indexOf('schema cache') >= 0 || m.indexOf('does not exist') >= 0) return 'El inventario aún no está activado en tu base de datos. Falta aplicar la migración 20261110_inventario.sql.';
    return 'No se pudo completar la acción. Intenta de nuevo.';
  }

  function css() {
    if ($('invCss')) return;
    var st = document.createElement('style'); st.id = 'invCss';
    st.textContent = '#modInventory .inv-sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px}' +
      '#modInventory .inv-k{padding:16px;border:1px solid var(--border);border-radius:16px;background:var(--panel)}' +
      '#modInventory .inv-k b{display:block;font-size:26px;color:var(--strong);line-height:1.1}#modInventory .inv-k span{font-size:12.5px;color:var(--muted)}' +
      '#modInventory .inv-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px}' +
      '#modInventory .inv-bar input[type=search]{flex:1;min-width:160px;min-height:40px;padding:0 12px;border-radius:12px;border:1px solid var(--border);background:var(--panel);color:var(--text);font:inherit}' +
      '#modInventory .inv-row{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr) auto;gap:12px;align-items:center;padding:14px 16px;border:1px solid var(--border);border-radius:16px;background:var(--panel);margin-bottom:10px}' +
      '#modInventory .inv-row h4{margin:0;font-size:15px;color:var(--strong);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '#modInventory .inv-row small{display:block;color:var(--muted);font-size:12px;margin-top:3px}' +
      '#modInventory .inv-qty{font-size:20px;font-weight:800;color:var(--strong)}#modInventory .inv-qty small{display:inline;font-size:12px;font-weight:600;margin-left:4px}' +
      '#modInventory .inv-act{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}' +
      '#modInventory .st{display:inline-block;font-size:11px;font-weight:700;padding:3px 9px;border-radius:99px;margin-left:8px;vertical-align:middle}' +
      '#modInventory .st.out{background:rgba(229,72,77,.15);color:#E5484D}#modInventory .st.low{background:rgba(245,165,36,.18);color:#D98A06}#modInventory .st.ok{background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent)}' +
      '#modInventory .inv-mv{display:grid;grid-template-columns:110px minmax(0,1fr) auto;gap:12px;padding:12px 4px;border-top:1px solid var(--border);font-size:13px;align-items:center}' +
      '#modInventory .inv-mv:first-child{border-top:0}#modInventory .inv-mv b.pos{color:#30A46C}#modInventory .inv-mv b.neg{color:#E5484D}' +
      '#invModal .field label{display:block;font-size:12.5px;font-weight:700;margin-bottom:6px;color:var(--strong)}' +
      '#invModal .field input,#invModal .field select{width:100%;min-height:42px;padding:0 12px;border-radius:12px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit}' +
      '#invModal .f2{display:grid;grid-template-columns:1fr 1fr;gap:12px}#invModal .err{color:#E5484D;font-size:12.5px;min-height:18px;margin:8px 0 0}' +
      '@media(max-width:640px){#modInventory .inv-row{grid-template-columns:1fr}#modInventory .inv-act{justify-content:flex-start}#modInventory .inv-mv{grid-template-columns:1fr auto}#modInventory .inv-mv>span:first-child{grid-column:1/-1}}';
    document.head.appendChild(st);
  }

  async function load() {
    var r = await Promise.all([
      C.sb.from('inventory_items').select('id,product_id,name,unit,quantity,min_stock,track_orders,auto_hidden,is_active').eq('restaurant_id', C.rid).eq('is_active', true).order('name'),
      C.sb.from('inventory_movements').select('id,item_id,kind,delta,balance_after,note,created_at').eq('restaurant_id', C.rid).order('created_at', { ascending: false }).limit(120)
    ]);
    if (r[0].error) throw r[0].error;
    S.items = (r[0].data || []).map(function (x) { x.quantity = Number(x.quantity); x.min_stock = Number(x.min_stock); return x; });
    S.moves = (r[1].data || []).map(function (x) { x.delta = Number(x.delta); x.balance_after = Number(x.balance_after); return x; });
    S.loaded = true; badge();
  }
  function badge() {
    var n = S.items.filter(function (i) { return level(i) !== 'ok'; }).length;
    document.querySelectorAll('.sb-item[data-view="inventario"]').forEach(function (b) {
      var el = b.querySelector('.inv-badge'); if (!n) { if (el) el.remove(); return; }
      if (!el) { el = document.createElement('span'); el.className = 'inv-badge'; el.style.cssText = 'margin-left:auto;min-width:20px;height:20px;padding:0 6px;border-radius:99px;background:var(--accent);color:var(--on-accent);font-size:11px;font-weight:800;display:inline-flex;align-items:center;justify-content:center'; b.appendChild(el); }
      el.textContent = n; el.setAttribute('aria-label', n + ' productos con stock bajo o agotados');
    });
  }

  function render() {
    var host = $('modInventory'); if (!host) return; css();
    var items = S.items, out = items.filter(function (i) { return level(i) === 'out'; }).length, low = items.filter(function (i) { return level(i) === 'low'; }).length;
    var list = items.filter(function (i) {
      if (S.tab === 'bajo' && level(i) !== 'low') return false; if (S.tab === 'agotado' && level(i) !== 'out') return false;
      return !S.q || i.name.toLowerCase().indexOf(S.q) >= 0;
    });
    var byId = {}; items.forEach(function (i) { byId[i.id] = i; });
    var h = '<div class="vhead row between"><div><h2>Inventario</h2><p>Existencias de tus productos. Los pedidos descuentan solos y se devuelven si cancelas.</p></div><button class="btn btn-accent" id="invAdd">Agregar al inventario</button></div>';
    h += '<div class="inv-sum"><div class="inv-k"><b>' + items.length + '</b><span>Artículos</span></div><div class="inv-k"><b>' + low + '</b><span>Stock bajo</span></div><div class="inv-k"><b>' + out + '</b><span>Agotados</span></div></div>';
    if (out + low > 0) h += '<div class="notice" role="status">' + (out ? '<b>' + out + ' agotado' + (out > 1 ? 's' : '') + '</b> (ocultos del menú hasta que repongas). ' : '') + (low ? '<b>' + low + '</b> con stock bajo.' : '') + '</div>';
    h += '<div class="inv-bar"><div class="seg" id="invView" role="group" aria-label="Vista"><button data-v="stock" class="' + (S.view === 'stock' ? 'on' : '') + '">Existencias</button><button data-v="mov" class="' + (S.view === 'mov' ? 'on' : '') + '">Movimientos</button></div>';
    if (S.view === 'stock') h += '<div class="seg" id="invTabs" role="group" aria-label="Filtro"><button data-t="todos" class="' + (S.tab === 'todos' ? 'on' : '') + '">Todos</button><button data-t="bajo" class="' + (S.tab === 'bajo' ? 'on' : '') + '">Stock bajo</button><button data-t="agotado" class="' + (S.tab === 'agotado' ? 'on' : '') + '">Agotados</button></div><input type="search" id="invQ" placeholder="Buscar…" aria-label="Buscar en inventario" value="' + esc(S.q) + '">';
    h += '</div>';
    if (S.view === 'mov') {
      h += '<div class="card" style="padding:8px 16px">' + (S.moves.length ? S.moves.map(function (m) {
        var it = byId[m.item_id];
        return '<div class="inv-mv"><span style="color:var(--muted)">' + esc(when(m.created_at)) + '</span><span><b style="color:var(--strong)">' + esc(it ? it.name : 'Artículo retirado') + '</b> · ' + esc(KIND[m.kind] || m.kind) + (m.note ? ' · ' + esc(m.note) : '') + '</span><span><b class="' + (m.delta >= 0 ? 'pos' : 'neg') + '">' + (m.delta >= 0 ? '+' : '') + fmt(m.delta) + '</b> <small style="color:var(--muted)">→ ' + fmt(m.balance_after) + '</small></span></div>';
      }).join('') : '<p class="sub" style="padding:18px 0;margin:0">Todavía no hay movimientos.</p>') + '</div>';
    } else if (!items.length) {
      h += '<div class="card empty"><div class="ic"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v9"/></svg></div><h3>Aún no controlas existencias</h3><p>Agrega un producto, escribe cuántas unidades tienes y KARTTA descontará cada pedido automáticamente.</p><button class="btn btn-accent" id="invAdd2">Agregar al inventario</button></div>';
    } else if (!list.length) {
      h += '<div class="card" style="text-align:center;color:var(--muted)">Nada coincide con ese filtro.</div>';
    } else {
      h += list.map(function (i) {
        var lv = level(i), lab = lv === 'out' ? 'Agotado' : lv === 'low' ? 'Stock bajo' : 'Disponible';
        return '<div class="inv-row" data-id="' + i.id + '"><div style="min-width:0"><h4>' + esc(i.name) + '<span class="st ' + lv + '">' + lab + '</span></h4><small>' + (i.product_id ? (i.track_orders ? 'Descuenta con cada pedido' : 'Sin descuento automático') : 'Insumo (sin producto del menú)') + (i.min_stock > 0 ? ' · mínimo ' + fmt(i.min_stock) : '') + '</small></div>' +
          '<div class="inv-qty">' + fmt(i.quantity) + '<small>' + esc(UNITS[i.unit] || i.unit) + '</small></div>' +
          '<div class="inv-act"><button class="btn btn-ghost btn-sm" data-a="entrada">+ Entrada</button><button class="btn btn-ghost btn-sm" data-a="salida">− Salida</button><button class="btn btn-ghost btn-sm" data-a="ajuste">Ajustar</button><button class="btn btn-ghost btn-sm" data-a="editar">Editar</button></div></div>';
      }).join('');
    }
    host.innerHTML = h;
    var q = $('invQ'); if (q && S.focusQ) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); S.focusQ = false; }
  }

  /* ---------- ventanas ---------- */
  function modal(html) {
    var m = $('invModal'); if (!m) { m = document.createElement('div'); m.id = 'invModal'; m.className = 'modal-bg'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); document.body.appendChild(m); m.addEventListener('click', function (e) { if (e.target === m) close(); }); }
    m.innerHTML = '<div class="modal">' + html + '</div>'; m.classList.add('show');
    var f = m.querySelector('input,select'); if (f) setTimeout(function () { f.focus(); }, 40); return m;
  }
  function close() { S.busy = false; var m = $('invModal'); if (m) m.classList.remove('show'); }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  function unitOpts(sel) { return Object.keys(UNITS).map(function (k) { return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + UNITS[k] + '</option>'; }).join(''); }
  function setErr(t) { var e = $('invErr'); if (e) e.textContent = t || ''; }
  function lock(on) { var b = $('invOk'); if (b) { b.disabled = on; } S.busy = on; }

  function openItem(it) {
    var used = {}; S.items.forEach(function (i) { if (i.product_id) used[i.product_id] = 1; });
    var prods = (C.productos || []).filter(function (p) { return !used[p.id] || (it && it.product_id === p.id); });
    var h = '<h3>' + (it ? 'Editar artículo' : 'Agregar al inventario') + '</h3><p class="sub">' + (it ? 'Cambia el nombre, la unidad o el mínimo. Para cambiar la cantidad usa Entrada, Salida o Ajustar.' : 'Elige un producto de tu menú o crea un insumo.') + '</p>';
    if (!it) h += '<div class="field"><label for="invProd">Producto del menú</label><select id="invProd"><option value="">Insumo sin producto del menú</option>' + prods.map(function (p) { return '<option value="' + p.id + '">' + esc(p.nombre) + '</option>'; }).join('') + '</select></div>';
    h += '<div class="field"><label for="invName">Nombre</label><input id="invName" maxlength="120" value="' + esc(it ? it.name : '') + '" placeholder="Ej: Hamburguesa clásica"></div>' +
      '<div class="f2"><div class="field"><label for="invUnit">Unidad de medida</label><select id="invUnit">' + unitOpts(it ? it.unit : 'unidad') + '</select></div><div class="field"><label for="invMin">Stock mínimo</label><input id="invMin" type="number" inputmode="decimal" min="0" step="any" value="' + (it ? it.min_stock : 0) + '"></div></div>';
    if (!it) h += '<div class="field"><label for="invQty">Cantidad disponible hoy</label><input id="invQty" type="number" inputmode="decimal" min="0" step="any" value="0"></div>';
    h += '<label class="sw" id="invTrackRow" style="border-top:0">Descontar automáticamente con cada pedido<input type="checkbox" id="invTrack" ' + (!it || it.track_orders ? 'checked' : '') + '></label><p class="err" id="invErr" role="alert"></p>' +
      '<div class="row" style="margin-top:14px"><button class="btn btn-ghost" id="invCancel" style="flex:1">Cancelar</button>' + (it ? '<button class="btn btn-danger" id="invDel">Quitar</button>' : '') + '<button class="btn btn-accent" id="invOk" style="flex:1">Guardar</button></div>';
    var m = modal(h), prod = $('invProd'), nm = $('invName');
    function sync() { var pid = prod ? prod.value : (it && it.product_id); $('invTrackRow').style.display = pid ? '' : 'none'; }
    if (prod) prod.onchange = function () { var p = (C.productos || []).find(function (x) { return x.id === prod.value; }); if (p && !nm.value.trim()) nm.value = p.nombre; sync(); };
    sync(); $('invCancel').onclick = close;
    if (it) $('invDel').onclick = async function () {
      if (!confirm('¿Quitar «' + it.name + '» del inventario? Se conserva su historial y el producto del menú no se borra.')) return;
      lock(true); try { var r = await C.sb.rpc('inventory_deactivate_item', { p_item: it.id }); if (r.error) throw r.error; close(); C.toast('Artículo quitado del inventario.'); await refresh(); } catch (e) { setErr(errText(e)); lock(false); }
    };
    $('invOk').onclick = async function () {
      if (S.busy) return;
      var pid = prod ? (prod.value || null) : (it ? it.product_id : null), name = nm.value.trim(), min = Number($('invMin').value || 0), qty = $('invQty') ? Number($('invQty').value || 0) : 0;
      if (!name) return setErr('Escribe un nombre.'); if (min < 0 || qty < 0 || isNaN(min) || isNaN(qty)) return setErr('Las cantidades no pueden ser negativas.');
      lock(true);
      try {
        var r = await C.sb.rpc('inventory_save_item', { p_restaurant: C.rid, p_item: it ? it.id : null, p_product: pid, p_name: name, p_unit: $('invUnit').value, p_min: min, p_track: pid ? $('invTrack').checked : false, p_initial: qty });
        if (r.error) throw r.error; close(); C.toast(it ? 'Cambios guardados.' : 'Agregado al inventario.'); await refresh();
      } catch (e) { setErr(errText(e)); lock(false); }
    };
  }

  function openMove(it, kind) {
    var T = { entrada: ['Registrar entrada', 'Cantidad que ingresa', 'Compra, reposición…'], salida: ['Registrar salida', 'Cantidad que sale', 'Merma, consumo propio…'], ajuste: ['Ajustar existencia', 'Cantidad real que hay ahora', 'Conteo físico…'] }[kind];
    modal('<h3>' + T[0] + '</h3><p class="sub"><b>' + esc(it.name) + '</b> · hay ' + fmt(it.quantity) + ' ' + esc(UNITS[it.unit] || it.unit) + '</p>' +
      '<div class="field"><label for="invQty">' + T[1] + '</label><input id="invQty" type="number" inputmode="decimal" min="0" step="any" ' + (kind === 'ajuste' ? 'value="' + it.quantity + '"' : '') + '></div>' +
      '<div class="field"><label for="invNote">Nota (opcional)</label><input id="invNote" maxlength="200" placeholder="' + T[2] + '"></div><p class="err" id="invErr" role="alert"></p>' +
      '<div class="row" style="margin-top:14px"><button class="btn btn-ghost" id="invCancel" style="flex:1">Cancelar</button><button class="btn btn-accent" id="invOk" style="flex:1">Confirmar</button></div>');
    $('invCancel').onclick = close;
    $('invOk').onclick = async function () {
      if (S.busy) return; var q = Number($('invQty').value);
      if ($('invQty').value === '' || isNaN(q) || q < 0 || (kind !== 'ajuste' && q === 0)) return setErr('Escribe una cantidad válida.');
      if (kind === 'salida' && q > it.quantity) return setErr('No puedes sacar más de lo que hay (' + fmt(it.quantity) + ').');
      lock(true);
      try { var r = await C.sb.rpc('inventory_move', { p_item: it.id, p_kind: kind, p_qty: q, p_note: $('invNote').value.trim() || null }); if (r.error) throw r.error; close(); C.toast('Movimiento registrado.'); await refresh(); }
      catch (e) { setErr(errText(e)); lock(false); }
    };
  }

  async function refresh() {
    try { await load(); render(); if (window.KARTTA_CTX && C.refrescarProductos) C.refrescarProductos(); } catch (e) { console.warn(e); var h = $('modInventory'); if (h) h.innerHTML = '<div class="vhead"><h2>Inventario</h2></div><div class="card notice">' + esc(errText(e)) + '</div>'; }
  }

  function bind() {
    var host = $('modInventory'); if (!host || host.dataset.bound) return; host.dataset.bound = '1';
    host.addEventListener('click', function (e) {
      if (e.target.closest('#invAdd,#invAdd2')) return openItem(null);
      var v = e.target.closest('#invView button'); if (v) { S.view = v.dataset.v; return render(); }
      var t = e.target.closest('#invTabs button'); if (t) { S.tab = t.dataset.t; return render(); }
      var b = e.target.closest('[data-a]'); if (!b) return; var id = b.closest('.inv-row').dataset.id, it = S.items.find(function (x) { return x.id === id; }); if (!it) return;
      if (b.dataset.a === 'editar') openItem(it); else openMove(it, b.dataset.a);
    });
    host.addEventListener('input', function (e) { if (e.target.id === 'invQ') { S.q = e.target.value.trim().toLowerCase(); S.focusQ = true; render(); } });
  }

  async function show() {
    bind(); clearInterval(S.timer);
    if (!S.loaded) { var h = $('modInventory'); if (h) h.innerHTML = '<div class="vhead"><h2>Inventario</h2></div><div class="card" style="color:var(--muted)">Cargando existencias…</div>'; }
    await refresh();
    S.timer = setInterval(function () { var mm = $('invModal'); if (!document.hidden && S.active && !(mm && mm.classList.contains('show'))) refresh(); }, 30000);
  }

  window.addEventListener('kartta:ready', function () { C = window.KARTTA_CTX; load().catch(function () {}); });
  window.addEventListener('kartta:view', function (e) {
    S.active = e.detail === 'inventario';
    if (S.active && C) show(); else clearInterval(S.timer);
  });
})();
