/* KARTTA · Editor de imagen (foto de perfil y banner).
   API: KARTTA_IMGEDIT.open(file, 'logo' | 'banner') -> Promise<Blob JPEG | null>  (null = canceló)

   MEDIDAS: calculadas desde el CSS real de menu.html, no inventadas.
   - Contenedor del menú: #menuShell { max-width:560px }  -> el encabezado ocupa como máximo 560 px de ancho.
   - Alto del encabezado con banner: html[data-bh="s|m|l"] .mheader { min-height:150 | 210 | 290px } (l = 220 si la pantalla es baja).
   - El banner se pinta con background-size:cover + position:center  => se recorta desde el centro.
   - Móvil de referencia: 390 px de ancho.
   Banner recomendado: 1680 × 630 px (8:3 = 2.67:1) = 560 × 210 a 3× de definición.
   Zona segura (visible en TODOS los casos): ancho 390×290 muestra el 50 % central en horizontal (1.345/2.667);
   ancho 560×150 muestra el 71 % central en vertical (2.667/3.733).
   Logo: .logo-gen { width:var(--logo-sz) } con --logo-sz entre 44 y 72 px (menu-design.js), circular -> 512 × 512 px sobra para 3×. */
(function () {
  'use strict';

  var PRESETS = {
    logo: {
      title: 'Editar foto de perfil', save: 'Guardar foto',
      outW: 512, outH: 512, round: true, quality: 0.86, stageMax: 300, minW: 256,
      rec: [['Tamaño recomendado', '512 × 512 px'], ['Proporción', '1:1 (cuadrada)'], ['Se muestra', 'circular, de 44 a 72 px en tu menú']],
      previews: [{ label: 'Menú', css: 64, round: true }, { label: 'Panel', css: 34, round: true }]
    },
    banner: {
      title: 'Editar banner', save: 'Guardar banner',
      outW: 1680, outH: 630, round: false, quality: 0.82, stageMax: 440, minW: 1120,
      safe: { w: 0.504, h: 0.714 },
      rec: [['Tamaño recomendado', '1680 × 630 px'], ['Proporción', '8:3 (2.67:1)'], ['Mínimo aceptable', '1120 × 420 px'], ['Ancho del menú', '560 px máx. (3× de definición)']],
      devices: [{ k: 'd', label: 'Escritorio', w: 560 }, { k: 'm', label: 'Móvil', w: 390 }],
      heights: [{ k: 's', label: 'Compacto · 150 px', h: 150 }, { k: 'm', label: 'Medio · 210 px', h: 210 }, { k: 'l', label: 'Alto · 290 px', h: 290 }]
    }
  };

  var CSS = '' +
    '.kie-bg{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px;z-index:700}' +
    '.kie{background:var(--panel,#fff);color:var(--text,#222);border:1px solid var(--border,#e5e5e5);border-radius:22px;width:100%;max-width:520px;max-height:94vh;overflow:auto;padding:22px}' +
    '.kie h3{margin:0 0 4px;font-size:19px;font-weight:800;color:var(--strong,#000)}' +
    '.kie .kie-sub{margin:0 0 14px;color:var(--muted,#777);font-size:13px}' +
    '.kie-stagewrap{display:flex;justify-content:center;margin-bottom:12px}' +
    '.kie-stage{position:relative;touch-action:none;cursor:grab;border-radius:14px;overflow:hidden;background:var(--panel2,#f3f3f1);border:1px solid var(--border,#e5e5e5);outline:none}' +
    '.kie-stage:active{cursor:grabbing}.kie-stage:focus-visible{outline:2px solid var(--accent,#FF3145);outline-offset:2px}' +
    '.kie-stage canvas{display:block}' +
    '.kie-ctl{display:flex;align-items:center;gap:10px;margin-bottom:10px}' +
    '.kie-ctl input[type=range]{flex:1;accent-color:var(--accent,#FF3145)}' +
    '.kie-ib{width:36px;height:36px;border-radius:10px;border:1px solid var(--border,#e5e5e5);background:var(--panel2,#f3f3f1);color:var(--strong,#000);display:grid;place-items:center;cursor:pointer}' +
    '.kie-ib:hover{border-color:var(--accent,#FF3145)}.kie-ib:focus-visible{outline:2px solid var(--accent,#FF3145);outline-offset:2px}' +
    '.kie-zv{min-width:44px;text-align:right;font-weight:700;font-size:12.5px;color:var(--strong,#000);font-variant-numeric:tabular-nums}' +
    '.kie-rec{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;background:var(--panel2,#f3f3f1);border:1px solid var(--border,#e5e5e5);border-radius:12px;padding:10px 12px;margin:0 0 12px;font-size:12.5px}' +
    '.kie-rec dt{color:var(--muted,#777)}.kie-rec dd{margin:0;font-weight:700;color:var(--strong,#000)}' +
    '.kie-q{font-size:12.5px;margin:0 0 12px;display:flex;align-items:center;gap:8px;color:var(--muted,#777)}' +
    '.kie-q b{color:var(--strong,#000)}.kie-q.warn b{color:#B45309}' +
    '.kie-chk{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;margin:0 0 12px;color:var(--text,#222);cursor:pointer}' +
    '.kie-chk input{width:16px;height:16px;accent-color:var(--accent,#FF3145)}' +
    '.kie-seg{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px}' +
    '.kie-seg button{min-height:32px;padding:0 11px;border-radius:8px;font-size:12px;font-weight:700;background:var(--panel2,#f3f3f1);border:1px solid var(--border,#e5e5e5);color:var(--muted,#777);cursor:pointer}' +
    '.kie-seg button[aria-pressed="true"]{background:var(--accent,#FF3145);border-color:var(--accent,#FF3145);color:var(--on-accent,#fff)}' +
    '.kie-prevlbl{font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--muted,#777);margin:0 0 6px}' +
    '.kie-prev{display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap;margin-bottom:14px}' +
    '.kie-prev figure{margin:0;text-align:center;font-size:11px;color:var(--muted,#777)}' +
    '.kie-prev canvas{box-sizing:border-box;display:block;border:1px solid var(--border,#e5e5e5);margin:0 auto 4px;background:var(--panel2,#f3f3f1)}' +
    '.kie-foot{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}';

  function injectCss() {
    if (document.getElementById('kie-css')) return;
    var s = document.createElement('style'); s.id = 'kie-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  var ICON = {
    minus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg>',
    plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    reset: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>'
  };

  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (k === 'class') n.className = attrs[k]; else n.setAttribute(k, attrs[k]); });
    if (html != null) n.innerHTML = html;
    return n;
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) return reject(new Error('no-image'));
      if (file.size > 25 * 1024 * 1024) return reject(new Error('too-big'));
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('bad-image')); };
      img.src = url;
    });
  }

  function open(file, kind) {
    var P = PRESETS[kind]; if (!P) return Promise.reject(new Error('preset'));
    injectCss();
    return loadImage(file).then(function (img) {
      return new Promise(function (resolve) {
        var prevFocus = document.activeElement;
        var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
        var fw = Math.max(200, Math.min(P.stageMax, window.innerWidth - 80)), fh = Math.round(fw * P.outH / P.outW);
        var dpr = Math.min(2, window.devicePixelRatio || 1);
        var zoom = 1, ox = 0, oy = 0, showSafe = true, dev = 'd', hgt = 'm';

        /* ---- DOM ---- */
        var bg = el('div', { 'class': 'kie-bg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'kieT' });
        var box = el('div', { 'class': 'kie' });
        box.appendChild(el('h3', { id: 'kieT' }, P.title));
        box.appendChild(el('p', { 'class': 'kie-sub' }, 'Arrastra la imagen para acomodarla y usa el zoom para encuadrarla. Así se verá en tu menú.'));

        var rec = el('dl', { 'class': 'kie-rec' });
        P.rec.forEach(function (r) { rec.appendChild(el('dt', null, r[0])); rec.appendChild(el('dd', null, r[1])); });
        box.appendChild(rec);

        var wrap = el('div', { 'class': 'kie-stagewrap' });
        var stage = el('div', { 'class': 'kie-stage', tabindex: '0', role: 'application', 'aria-label': 'Área de encuadre. Arrastra para mover; flechas para mover; más y menos para el zoom.' });
        stage.style.width = fw + 'px'; stage.style.height = fh + 'px';
        var cv = el('canvas'); cv.width = Math.round(fw * dpr); cv.height = Math.round(fh * dpr); cv.style.width = fw + 'px'; cv.style.height = fh + 'px';
        stage.appendChild(cv); wrap.appendChild(stage); box.appendChild(wrap);
        var cx = cv.getContext('2d');

        var ctl = el('div', { 'class': 'kie-ctl' });
        var bMinus = el('button', { type: 'button', 'class': 'kie-ib', 'aria-label': 'Alejar' }, ICON.minus);
        var rng = el('input', { type: 'range', min: '100', max: '400', step: '1', value: '100', 'aria-label': 'Zoom' });
        var bPlus = el('button', { type: 'button', 'class': 'kie-ib', 'aria-label': 'Acercar' }, ICON.plus);
        var zv = el('span', { 'class': 'kie-zv', 'aria-live': 'polite' }, '100%');
        var bReset = el('button', { type: 'button', 'class': 'kie-ib', 'aria-label': 'Restablecer ajustes', title: 'Restablecer' }, ICON.reset);
        [bMinus, rng, bPlus, zv, bReset].forEach(function (n) { ctl.appendChild(n); });
        box.appendChild(ctl);

        var q = el('p', { 'class': 'kie-q' }); box.appendChild(q);

        var chk = null;
        if (P.safe) {
          var lbl = el('label', { 'class': 'kie-chk' }); chk = el('input', { type: 'checkbox', checked: '' });
          lbl.appendChild(chk); lbl.appendChild(document.createTextNode('Mostrar zona segura (siempre visible en cualquier pantalla)'));
          box.appendChild(lbl);
        }

        /* vistas previas */
        box.appendChild(el('p', { 'class': 'kie-prevlbl' }, 'Vista previa'));
        var prevHost = el('div'); box.appendChild(prevHost);
        var prevCv = [], devBtns = [], hBtns = [];
        if (kind === 'banner') {
          var segD = el('div', { 'class': 'kie-seg', role: 'group', 'aria-label': 'Dispositivo' });
          P.devices.forEach(function (d) { var b = el('button', { type: 'button', 'aria-pressed': String(d.k === dev) }, d.label + ' · ' + d.w + ' px'); b.onclick = function () { dev = d.k; syncSeg(); drawPrev(); }; devBtns.push([d.k, b]); segD.appendChild(b); });
          var segH = el('div', { 'class': 'kie-seg', role: 'group', 'aria-label': 'Alto del encabezado' });
          P.heights.forEach(function (h) { var b = el('button', { type: 'button', 'aria-pressed': String(h.k === hgt) }, h.label); b.onclick = function () { hgt = h.k; syncSeg(); drawPrev(); }; hBtns.push([h.k, b]); segH.appendChild(b); });
          prevHost.appendChild(segD); prevHost.appendChild(segH);
          var pbox = el('div', { 'class': 'kie-prev' }); var fig = el('figure'); var pc = el('canvas'); fig.appendChild(pc);
          var cap = el('figcaption'); fig.appendChild(cap); pbox.appendChild(fig); prevHost.appendChild(pbox); prevCv.push({ c: pc, cap: cap });
        } else {
          var pbox2 = el('div', { 'class': 'kie-prev' });
          P.previews.forEach(function (p) { var f = el('figure'); var c = el('canvas'); c.width = Math.round(p.css * dpr); c.height = Math.round(p.css * dpr); c.style.width = p.css + 'px'; c.style.height = p.css + 'px'; if (p.round) c.style.borderRadius = '50%'; f.appendChild(c); f.appendChild(el('figcaption', null, p.label + ' · ' + p.css + ' px')); pbox2.appendChild(f); prevCv.push({ c: c, p: p }); });
          prevHost.appendChild(pbox2);
        }

        var foot = el('div', { 'class': 'kie-foot' });
        var bCancel = el('button', { type: 'button', 'class': 'btn btn-ghost' }, 'Cancelar');
        var bSave = el('button', { type: 'button', 'class': 'btn btn-accent' }, P.save);
        foot.appendChild(bCancel); foot.appendChild(bSave); box.appendChild(foot);
        bg.appendChild(box); document.body.appendChild(bg);

        /* ---- geometría ---- */
        function base() { return Math.max(fw / iw, fh / ih); }
        function scale() { return base() * zoom; }
        function clamp() {
          var S = scale(), mx = Math.max(0, (iw * S - fw) / 2), my = Math.max(0, (ih * S - fh) / 2);
          ox = Math.min(mx, Math.max(-mx, ox)); oy = Math.min(my, Math.max(-my, oy));
        }
        /* dibuja la composición actual en un canvas de w × h (misma proporción que el marco) */
        function paint(ctx, w, h, k) {
          var S = scale();
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, (fw / 2 + ox - iw * S / 2) * k, (fh / 2 + oy - ih * S / 2) * k, iw * S * k, ih * S * k);
        }
        function drawStage() {
          cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, cv.width, cv.height);
          paint(cx, cv.width, cv.height, cv.width / fw);
          var W = cv.width, H = cv.height;
          if (P.round) {
            cx.save(); cx.fillStyle = 'rgba(0,0,0,.55)'; cx.beginPath(); cx.rect(0, 0, W, H);
            var r = Math.min(W, H) / 2; cx.moveTo(W / 2 + r, H / 2); cx.arc(W / 2, H / 2, r, 0, Math.PI * 2, true); cx.fill('evenodd'); cx.restore();
            cx.strokeStyle = 'rgba(255,255,255,.9)'; cx.lineWidth = 2 * dpr; cx.beginPath(); cx.arc(W / 2, H / 2, r - dpr, 0, Math.PI * 2); cx.stroke();
          } else if (P.safe && showSafe) {
            var sw = W * P.safe.w, sh = H * P.safe.h, sx = (W - sw) / 2, sy = (H - sh) / 2;
            cx.save(); cx.fillStyle = 'rgba(0,0,0,.38)'; cx.beginPath(); cx.rect(0, 0, W, H); cx.rect(sx, sy, sw, sh); cx.fill('evenodd'); cx.restore();
            cx.save(); cx.strokeStyle = 'rgba(255,255,255,.95)'; cx.lineWidth = 1.5 * dpr; cx.setLineDash([6 * dpr, 4 * dpr]); cx.strokeRect(sx, sy, sw, sh); cx.restore();
          }
        }
        function drawPrev() {
          if (kind === 'banner') {
            var d = P.devices.filter(function (x) { return x.k === dev; })[0], hh = P.heights.filter(function (x) { return x.k === hgt; })[0];
            var sc = Math.min(1, (prevHost.clientWidth || (box.clientWidth - 44)) / d.w, 0.8), pw = Math.round(d.w * sc), ph = Math.round(hh.h * sc);
            var c = prevCv[0].c; c.width = Math.round(pw * dpr); c.height = Math.round(ph * dpr); c.style.width = pw + 'px'; c.style.height = ph + 'px';
            var x = c.getContext('2d'), out = document.createElement('canvas'); out.width = 840; out.height = 315; paint(out.getContext('2d'), 840, 315, 840 / fw);
            var ra = out.width / out.height, rb = c.width / c.height, sw, sh, sx, sy;
            if (rb > ra) { sw = out.width; sh = out.width / rb; } else { sh = out.height; sw = out.height * rb; }
            sx = (out.width - sw) / 2; sy = (out.height - sh) / 2;   // cover centrado, igual que el menú
            x.imageSmoothingQuality = 'high'; x.drawImage(out, sx, sy, sw, sh, 0, 0, c.width, c.height);
            prevCv[0].cap.textContent = d.label + ' ' + d.w + ' × ' + hh.h + ' px';
          } else {
            prevCv.forEach(function (o) { var x = o.c.getContext('2d'); x.clearRect(0, 0, o.c.width, o.c.height); paint(x, o.c.width, o.c.height, o.c.width / fw); });
          }
        }
        function quality() {
          var eff = fw / scale();   // píxeles reales de la foto que ocupan el ancho del marco
          var low = eff < P.outW * 0.6 || iw < P.minW;
          q.className = 'kie-q' + (low ? ' warn' : '');
          q.innerHTML = 'Tu imagen: <b>' + iw + ' × ' + ih + ' px</b> · Calidad del encuadre: <b>' + (low ? 'baja, puede verse borrosa' : 'buena') + '</b>';
        }
        function syncSeg() {
          devBtns.forEach(function (a) { a[1].setAttribute('aria-pressed', String(a[0] === dev)); });
          hBtns.forEach(function (a) { a[1].setAttribute('aria-pressed', String(a[0] === hgt)); });
        }
        function refresh() { clamp(); rng.value = String(Math.round(zoom * 100)); zv.textContent = Math.round(zoom * 100) + '%'; drawStage(); drawPrev(); quality(); }
        function setZoom(z) { zoom = Math.min(4, Math.max(1, z)); refresh(); }

        /* ---- interacción ---- */
        var ptrs = {}, lastDist = 0, lastX = 0, lastY = 0;
        function cnt() { return Object.keys(ptrs).length; }
        stage.addEventListener('pointerdown', function (e) {
          stage.setPointerCapture(e.pointerId); ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
          if (cnt() === 1) { lastX = e.clientX; lastY = e.clientY; } else if (cnt() === 2) { var a = Object.keys(ptrs).map(function (k) { return ptrs[k]; }); lastDist = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); }
        });
        stage.addEventListener('pointermove', function (e) {
          if (!ptrs[e.pointerId]) return; ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
          if (cnt() === 1) { ox += e.clientX - lastX; oy += e.clientY - lastY; lastX = e.clientX; lastY = e.clientY; refresh(); }
          else if (cnt() === 2) { var a = Object.keys(ptrs).map(function (k) { return ptrs[k]; }), d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); if (lastDist) setZoom(zoom * d / lastDist); lastDist = d; }
        });
        function up(e) { delete ptrs[e.pointerId]; lastDist = 0; var k = Object.keys(ptrs); if (k.length === 1) { lastX = ptrs[k[0]].x; lastY = ptrs[k[0]].y; } }
        stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
        stage.addEventListener('wheel', function (e) { e.preventDefault(); setZoom(zoom * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
        stage.addEventListener('keydown', function (e) {
          var s = e.shiftKey ? 30 : 10, used = true;
          if (e.key === 'ArrowLeft') ox -= s; else if (e.key === 'ArrowRight') ox += s; else if (e.key === 'ArrowUp') oy -= s; else if (e.key === 'ArrowDown') oy += s;
          else if (e.key === '+' || e.key === '=') { setZoom(zoom + 0.1); return e.preventDefault(); } else if (e.key === '-') { setZoom(zoom - 0.1); return e.preventDefault(); } else used = false;
          if (used) { e.preventDefault(); refresh(); }
        });
        rng.oninput = function () { setZoom(Number(rng.value) / 100); };
        bPlus.onclick = function () { setZoom(zoom + 0.1); }; bMinus.onclick = function () { setZoom(zoom - 0.1); };
        bReset.onclick = function () { zoom = 1; ox = 0; oy = 0; refresh(); };
        if (chk) chk.onchange = function () { showSafe = chk.checked; drawStage(); };

        /* ---- cierre / guardado ---- */
        function close(result) {
          document.removeEventListener('keydown', onKey, true); bg.remove();
          try { if (prevFocus && prevFocus.focus) prevFocus.focus(); } catch (e) { /* noop */ }
          resolve(result);
        }
        function onKey(e) {
          if (e.key === 'Escape') { e.stopPropagation(); close(null); }
          else if (e.key === 'Tab') {   // el foco no sale del cuadro de diálogo
            var f = box.querySelectorAll('button,input,[tabindex="0"]'); if (!f.length) return;
            var first = f[0], last = f[f.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
          }
        }
        document.addEventListener('keydown', onKey, true);
        bCancel.onclick = function () { close(null); };
        bg.addEventListener('pointerdown', function (e) { if (e.target === bg) close(null); });
        bSave.onclick = function () {
          bSave.disabled = true; bSave.textContent = 'Guardando…';
          var out = document.createElement('canvas'); out.width = P.outW; out.height = P.outH;
          paint(out.getContext('2d'), P.outW, P.outH, P.outW / fw);
          out.toBlob(function (b) { if (b) close(b); else { bSave.disabled = false; bSave.textContent = P.save; } }, 'image/jpeg', P.quality);
        };

        refresh(); stage.focus();
      });
    });
  }

  window.KARTTA_IMGEDIT = { open: open, presets: PRESETS };
})();
