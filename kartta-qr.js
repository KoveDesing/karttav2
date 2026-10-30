/**
 * KARTTA — Editor de QR del menú (fase 1). 100 % en el navegador, sobre el enlace REAL /m/<slug>.
 * Reutiliza qrcodejs (ya cargado en el panel) solo para obtener la matriz; el dibujo es propio
 * (PNG por canvas y SVG vectorial). Corrección de errores H + zona de silencio de 4 módulos.
 * Se bloquea la descarga si el contraste es insuficiente o el código es más claro que el fondo.
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var M = window.KARTTA_MODS, esc = function (s) { return M.esc(s); };
  var DEF = { fg: '#0A0A0A', bg: '#FFFFFF', style: 'square', logo: true, size: 1024 };
  var d = Object.assign({}, DEF), logoImg = null, logoOK = false, saveT = 0, matrix = null, matrixFor = '';

  function lum(hex) { var c = [1, 3, 5].map(function (i) { var v = parseInt(hex.substr(i, 2), 16) / 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
  function check() {
    var r = contrast(d.fg, d.bg);
    if (lum(d.fg) >= lum(d.bg)) return { ok: false, msg: 'El código debe ser más oscuro que el fondo; si no, muchos lectores no lo reconocen.' };
    if (r < 4) return { ok: false, msg: 'Contraste insuficiente (' + r.toFixed(1) + ':1). Necesitas al menos 4:1 para que escanee bien.' };
    return { ok: true, msg: 'Contraste ' + r.toFixed(1) + ':1 — correcto.' };
  }
  function getMatrix(url) {
    if (matrix && matrixFor === url) return matrix;
    var holder = document.createElement('div');
    var q = new window.QRCode(holder, { text: url, width: 64, height: 64, correctLevel: window.QRCode.CorrectLevel.H });
    var o = q._oQRCode, n = o.getModuleCount(), m = [];
    for (var r = 0; r < n; r++) { m.push([]); for (var c = 0; c < n; c++) m[r].push(!!o.isDark(r, c)); }
    matrix = { n: n, m: m }; matrixFor = url; return matrix;
  }
  var inFinder = function (r, c, n) { return (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7); };

  function draw(canvas, size, withLogo) {
    var url = M.ctx.menuURL(), mx = getMatrix(url), n = mx.n, quiet = 4, cell = size / (n + quiet * 2), ctx = canvas.getContext('2d');
    canvas.width = canvas.height = size; ctx.fillStyle = d.bg; ctx.fillRect(0, 0, size, size); ctx.fillStyle = d.fg;
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      if (!mx.m[r][c]) continue; var x = (c + quiet) * cell, y = (r + quiet) * cell, f = inFinder(r, c, n);
      if (d.style === 'dots' && !f) { ctx.beginPath(); ctx.arc(x + cell / 2, y + cell / 2, cell * .46, 0, 6.2832); ctx.fill(); }
      else if (d.style === 'rounded' && !f) { var rr = cell * .32; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, cell + .4, cell + .4, rr) : ctx.rect(x, y, cell + .4, cell + .4); ctx.fill(); }
      else ctx.fillRect(x, y, cell + .4, cell + .4);
    }
    if (withLogo && d.logo && logoOK && logoImg) {
      var box = size * .2, bx = (size - box) / 2; ctx.fillStyle = d.bg; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx - cell, bx - cell, box + cell * 2, box + cell * 2, cell * 1.5) : ctx.rect(bx - cell, bx - cell, box + cell * 2, box + cell * 2); ctx.fill();
      var k = Math.min(box / logoImg.naturalWidth, box / logoImg.naturalHeight), w = logoImg.naturalWidth * k, h = logoImg.naturalHeight * k; ctx.drawImage(logoImg, (size - w) / 2, (size - h) / 2, w, h);
    }
    return canvas;
  }
  function svgString() {
    var url = M.ctx.menuURL(), mx = getMatrix(url), n = mx.n, quiet = 4, T = n + quiet * 2, p = '';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (mx.m[r][c]) {
      var x = c + quiet, y = r + quiet, f = inFinder(r, c, n);
      if (d.style === 'dots' && !f) p += '<circle cx="' + (x + .5) + '" cy="' + (y + .5) + '" r=".46"/>'; else if (d.style === 'rounded' && !f) p += '<rect x="' + x + '" y="' + y + '" width="1.01" height="1.01" rx=".32"/>'; else p += '<rect x="' + x + '" y="' + y + '" width="1.01" height="1.01"/>';
    }
    var logo = '';
    if (d.logo && logoOK && logoImg) { try { var cv = document.createElement('canvas'); cv.width = logoImg.naturalWidth; cv.height = logoImg.naturalHeight; cv.getContext('2d').drawImage(logoImg, 0, 0); var u = cv.toDataURL('image/png'), box = T * .2, bx = (T - box) / 2; logo = '<rect x="' + (bx - 1) + '" y="' + (bx - 1) + '" width="' + (box + 2) + '" height="' + (box + 2) + '" rx="1.5" fill="' + d.bg + '"/><image href="' + u + '" x="' + bx + '" y="' + bx + '" width="' + box + '" height="' + box + '" preserveAspectRatio="xMidYMid meet"/>'; } catch (e) { logo = ''; } }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + T + ' ' + T + '" width="1024" height="1024" shape-rendering="crispEdges"><rect width="' + T + '" height="' + T + '" fill="' + d.bg + '"/><g fill="' + d.fg + '">' + p + '</g>' + logo + '</svg>';
  }
  function loadLogo() {
    var u = M.ctx.negocio.logo; logoImg = null; logoOK = false; if (!u) return Promise.resolve();
    return new Promise(function (res) { var i = new Image(); i.crossOrigin = 'anonymous'; i.onload = function () { logoImg = i; logoOK = true; res(); }; i.onerror = function () { res(); }; i.src = u; });
  }
  function save() {
    clearTimeout(saveT); saveT = setTimeout(function () {
      var C = M.ctx, p = Object.assign({}, C.perfil.prefs || {}); p.qr = Object.assign({}, p.qr || {}); p.qr[C.rid] = { fg: d.fg, bg: d.bg, style: d.style, logo: d.logo };
      C.perfil.prefs = p; C.savePrefs(p);
    }, 800);
  }
  function refresh() {
    var cv = $('qrCanvas'); if (!cv) return; var ck = check();
    draw(cv, 640, true); cv.style.width = '100%'; cv.style.maxWidth = '300px';
    var msg = $('qrMsg'); msg.textContent = ck.msg; msg.className = 'note' + (ck.ok ? '' : ' warn');
    ['qrPng', 'qrSvg', 'qrShare'].forEach(function (id) { var b = $(id); if (b) b.disabled = !ck.ok; });
    $('qrUrl').textContent = M.ctx.menuURL();
    var lg = $('qrLogo'); if (lg) { lg.disabled = !logoOK; $('qrLogoNote').textContent = logoOK ? '' : (M.ctx.negocio.logo ? 'No se pudo leer tu logo para incrustarlo.' : 'Sube tu logo en Configuración para incluirlo.'); }
    // autoverificación cuando el navegador lo permite (si no, no se afirma nada)
    var v = $('qrVerify'); v.textContent = '';
    if ('BarcodeDetector' in window) { try { new window.BarcodeDetector({ formats: ['qr_code'] }).detect(cv).then(function (r) { v.textContent = r[0] && r[0].rawValue === M.ctx.menuURL() ? '✓ Verificado: este QR abre ' + M.ctx.menuURL() : '⚠ No se pudo leer automáticamente; pruébalo con tu celular antes de imprimir.'; }, function () {}); } catch (e) {} }
  }
  function render() {
    var C = M.ctx, host = $('modQr'); if (!host) return;
    var saved = C.perfil && C.perfil.prefs && C.perfil.prefs.qr && C.perfil.prefs.qr[C.rid]; d = Object.assign({}, DEF, saved || {});
    host.innerHTML = '<div class="vhead"><h2>Código QR del menú</h2><p>Apunta siempre a tu enlace real y se actualiza si cambias tu identificador.</p></div>' +
      '<div class="qrwrap"><div class="qrprev"><canvas id="qrCanvas" role="img" aria-label="Vista previa del código QR del menú"></canvas><p class="note" id="qrUrl" style="word-break:break-all;margin:12px 0 0;text-align:center"></p><p class="note" id="qrVerify" style="margin:6px 0 0;text-align:center"></p></div>' +
      '<div class="card qrctl"><div class="two"><div class="field"><label for="qrFg">Color del código</label><input id="qrFg" type="color" value="' + d.fg + '"></div><div class="field"><label for="qrBg">Color de fondo</label><input id="qrBg" type="color" value="' + d.bg + '"></div></div>' +
      '<div class="field"><label for="qrStyle">Estilo</label><select id="qrStyle"><option value="square">Cuadrado</option><option value="rounded">Redondeado</option><option value="dots">Puntos</option></select></div>' +
      '<label class="row" style="gap:8px;font-size:13px;color:var(--text)"><input type="checkbox" id="qrLogo"' + (d.logo ? ' checked' : '') + '> Incluir mi logo en el centro</label><p class="note" id="qrLogoNote" style="margin:-8px 0 0"></p>' +
      '<p class="note" id="qrMsg"></p>' +
      '<div class="row"><button class="btn btn-accent" id="qrPng">Descargar PNG</button><button class="btn btn-ghost" id="qrSvg">Descargar SVG</button><button class="btn btn-ghost" id="qrShare">Compartir</button><button class="btn btn-ghost" id="qrCopy">Copiar enlace</button><button class="btn btn-ghost" id="qrReset">Restablecer</button></div>' +
      '<p class="note">Antes de imprimir, escanéalo con tu celular. Deja un margen blanco alrededor y no lo imprimas a menos de 3 cm.</p></div></div>';
    $('qrStyle').value = d.style;
    loadLogo().then(refresh);
  }
  var fname = function (ext) { return 'qr-' + (M.ctx.slug || 'menu') + '.' + ext; };
  function download(blob, name) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500); }
  function pngBlob() { var cv = document.createElement('canvas'); draw(cv, d.size, true); return new Promise(function (res) { cv.toBlob(res, 'image/png'); }); }
  document.addEventListener('input', function (e) {
    if (!['qrFg', 'qrBg', 'qrStyle', 'qrLogo'].includes(e.target.id)) return;
    d.fg = $('qrFg').value.toUpperCase(); d.bg = $('qrBg').value.toUpperCase(); d.style = $('qrStyle').value; d.logo = $('qrLogo').checked; refresh(); save();
  });
  document.addEventListener('click', async function (e) {
    var id = e.target.closest && e.target.closest('button') && e.target.closest('button').id, C = M.ctx; if (!id || id.indexOf('qr') !== 0) return;
    if (id === 'qrPng') { var b = await pngBlob(); if (!b) return C.toast('No se pudo generar la imagen.'); download(b, fname('png')); }
    else if (id === 'qrSvg') download(new Blob([svgString()], { type: 'image/svg+xml' }), fname('svg'));
    else if (id === 'qrCopy') { try { await navigator.clipboard.writeText(C.menuURL()); C.toast('Enlace copiado.'); } catch (x) { C.toast(C.menuURL()); } }
    else if (id === 'qrReset') {
      d = Object.assign({}, DEF); clearTimeout(saveT);
      var pr = Object.assign({}, C.perfil.prefs || {}); if (pr.qr) { pr.qr = Object.assign({}, pr.qr); delete pr.qr[C.rid]; }
      C.perfil.prefs = pr; C.savePrefs(pr); render(); C.toast('Diseño restablecido.');
    }
    else if (id === 'qrShare') {
      var blob = await pngBlob(), file = blob && new File([blob], fname('png'), { type: 'image/png' });
      if (navigator.canShare && file && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: 'QR de ' + (C.negocio.nombre || 'mi menú'), url: C.menuURL() }); } catch (x) {} }
      else if (navigator.share) { try { await navigator.share({ title: C.negocio.nombre || 'Menú', url: C.menuURL() }); } catch (x) {} }
      else { try { await navigator.clipboard.writeText(C.menuURL()); C.toast('Tu navegador no comparte imágenes: copié el enlace.'); } catch (x) { C.toast(C.menuURL()); } }
    }
  });
  M.views.qr = render;
})();
